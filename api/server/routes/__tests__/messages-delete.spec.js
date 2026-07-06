const mongoose = require('mongoose');
const express = require('express');
const request = require('supertest');
const { v4: uuidv4 } = require('uuid');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('@librechat/agents', () => ({
  sleep: jest.fn(),
}));

jest.mock(
  '@librechat/api',
  () => ({
    unescapeLaTeX: jest.fn((x) => x),
    countTokens: jest.fn().mockResolvedValue(10),
  }),
  { virtual: true },
);

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
}));

jest.mock('~/models', () => ({
  saveConvo: jest.fn(),
  getMessage: jest.fn(),
  saveMessage: jest.fn(),
  getMessages: jest.fn(),
  updateMessage: jest.fn(),
  deleteMessages: jest.fn(),
  deleteMessageBranch: jest.fn(),
}));

jest.mock('~/server/services/Artifacts/update', () => ({
  findAllArtifacts: jest.fn(),
  replaceArtifactContent: jest.fn(),
}));

jest.mock('~/server/middleware/requireJwtAuth', () => (req, res, next) => next());

jest.mock('~/server/middleware', () => ({
  requireJwtAuth: (req, res, next) => next(),
  validateMessageReq: (req, res, next) => next(),
}));

jest.mock('~/models/Conversation', () => ({
  getConvosQueried: jest.fn(),
}));

jest.mock('~/models/Transaction', () => ({
  getTransactions: jest.fn(),
}));

jest.mock('~/db/models', () => ({
  Message: {
    findOne: jest.fn(),
    find: jest.fn(),
    meiliSearch: jest.fn(),
  },
  ToolCall: {
    find: jest.fn(),
  },
}));

/* ─── Model-level tests: real MongoDB, proves cross-user deletion is prevented ─── */

const { messageSchema } = require('@librechat/data-schemas');

describe('deleteMessages – model-level IDOR prevention', () => {
  let mongoServer;
  let Message;

  const ownerUserId = 'user-owner-111';
  const attackerUserId = 'user-attacker-222';

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await Message.deleteMany({});
  });

  it("should NOT delete another user's message when attacker supplies victim messageId", async () => {
    const conversationId = uuidv4();
    const victimMsgId = 'victim-msg-001';

    await Message.create({
      messageId: victimMsgId,
      conversationId,
      user: ownerUserId,
      text: 'Sensitive owner data',
    });

    await Message.deleteMany({ messageId: victimMsgId, user: attackerUserId });

    const victimMsg = await Message.findOne({ messageId: victimMsgId }).lean();
    expect(victimMsg).not.toBeNull();
    expect(victimMsg.user).toBe(ownerUserId);
    expect(victimMsg.text).toBe('Sensitive owner data');
  });

  it("should delete the user's own message", async () => {
    const conversationId = uuidv4();
    const ownMsgId = 'own-msg-001';

    await Message.create({
      messageId: ownMsgId,
      conversationId,
      user: ownerUserId,
      text: 'My message',
    });

    const result = await Message.deleteMany({ messageId: ownMsgId, user: ownerUserId });
    expect(result.deletedCount).toBe(1);

    const deleted = await Message.findOne({ messageId: ownMsgId }).lean();
    expect(deleted).toBeNull();
  });

  it('should scope deletion by conversationId, messageId, and user together', async () => {
    const convoA = uuidv4();
    const convoB = uuidv4();

    await Message.create([
      { messageId: 'msg-a1', conversationId: convoA, user: ownerUserId, text: 'A1' },
      { messageId: 'msg-b1', conversationId: convoB, user: ownerUserId, text: 'B1' },
    ]);

    await Message.deleteMany({ messageId: 'msg-a1', conversationId: convoA, user: attackerUserId });

    const remaining = await Message.find({ user: ownerUserId }).lean();
    expect(remaining).toHaveLength(2);
  });
});

/* ─── Route-level tests: supertest + mocked deleteMessages ─── */

describe('DELETE /:conversationId/:messageId – route handler', () => {
  let app;
  const { deleteMessages } = require('~/models');

  const authenticatedUserId = 'user-owner-123';

  beforeAll(() => {
    const messagesRouter = require('../messages');

    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: authenticatedUserId };
      next();
    });
    app.use('/api/messages', messagesRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should pass user and conversationId in the deleteMessages filter', async () => {
    deleteMessages.mockResolvedValue({ deletedCount: 1 });

    await request(app).delete('/api/messages/convo-1/msg-1');

    expect(deleteMessages).toHaveBeenCalledTimes(1);
    expect(deleteMessages).toHaveBeenCalledWith({
      messageId: 'msg-1',
      conversationId: 'convo-1',
      user: authenticatedUserId,
    });
  });

  it('should return 204 on successful deletion', async () => {
    deleteMessages.mockResolvedValue({ deletedCount: 1 });

    const response = await request(app).delete('/api/messages/convo-1/msg-owned');

    expect(response.status).toBe(204);
    expect(deleteMessages).toHaveBeenCalledWith({
      messageId: 'msg-owned',
      conversationId: 'convo-1',
      user: authenticatedUserId,
    });
  });

  it('should return 500 when deleteMessages throws', async () => {
    deleteMessages.mockRejectedValue(new Error('DB failure'));

    const response = await request(app).delete('/api/messages/convo-1/msg-1');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Internal server error' });
  });
});

/* ─── Conversation usage route: provider accounting + branch filtering ─── */

describe('POST /:conversationId/usage – route handler', () => {
  let app;
  const { Message, ToolCall } = require('~/db/models');
  const { getTransactions } = require('~/models/Transaction');

  beforeAll(() => {
    const messagesRouter = require('../messages');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: 'usage-user-123' };
      next();
    });
    app.use('/api/messages', messagesRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    ToolCall.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([]),
    });
  });

  it('aggregates recorded input, output, cache, and tool usage for visible messages', async () => {
    Message.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            messageId: 'user-1',
            conversationId: 'convo-usage',
            isCreatedByUser: true,
            tokenCount: 10,
          },
          {
            messageId: 'assistant-1',
            conversationId: 'convo-usage',
            isCreatedByUser: false,
            tokenCount: 20,
            model: 'gpt-5.6-sol',
            content: [{ type: 'tool_call', tool_call_id: 'call-1' }],
          },
        ]),
      }),
    });
    getTransactions.mockResolvedValue([
      {
        messageId: 'assistant-1',
        tokenType: 'prompt',
        inputTokens: -100,
        readTokens: -40,
        writeTokens: -5,
      },
      { messageId: 'assistant-1', tokenType: 'completion', rawAmount: -25 },
    ]);

    const response = await request(app)
      .post('/api/messages/convo-usage/usage')
      .send({ messageIds: ['user-1', 'assistant-1'] });

    expect(response.status).toBe(200);
    expect(Message.find).toHaveBeenCalledWith({
      conversationId: 'convo-usage',
      user: 'usage-user-123',
      messageId: { $in: ['user-1', 'assistant-1'] },
    });
    expect(response.body.totals).toEqual({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 40,
      cacheWriteTokens: 5,
      toolCalls: 1,
    });
    expect(response.body.turns[0]).toEqual(
      expect.objectContaining({
        messageId: 'assistant-1',
        model: 'gpt-5.6-sol',
        estimated: false,
      }),
    );
  });

  it('merges persisted and embedded tool calls without double-counting matching tools', async () => {
    Message.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          {
            messageId: 'assistant-1',
            conversationId: 'convo-usage',
            isCreatedByUser: false,
            tokenCount: 20,
            content: [
              {
                type: 'tool_call',
                tool_call_id: 'call-1',
                tool_call: { name: 'execute_code' },
              },
            ],
          },
        ]),
      }),
    });
    ToolCall.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { messageId: 'assistant-1', toolId: 'execute_code' },
        { messageId: 'assistant-1', toolId: 'execute_code' },
        { messageId: 'assistant-1', toolId: 'web_search' },
      ]),
    });
    getTransactions.mockResolvedValue([]);

    const response = await request(app)
      .post('/api/messages/convo-usage/usage')
      .send({ messageIds: ['assistant-1'] });

    expect(response.status).toBe(200);
    expect(ToolCall.find).toHaveBeenCalledWith({
      conversationId: 'convo-usage',
      user: 'usage-user-123',
      messageId: { $in: ['assistant-1'] },
    });
    expect(response.body.turns[0].toolCalls).toBe(3);
    expect(response.body.totals.toolCalls).toBe(3);
  });

});


describe('DELETE /:conversationId/:messageId/branch – route handler', () => {
  let app;
  const { deleteMessageBranch } = require('~/models');

  beforeAll(() => {
    const messagesRouter = require('../messages');
    app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.user = { id: 'branch-user-123' };
      next();
    });
    app.use('/api/messages', messagesRouter);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the deleted count for a successful generation-tree deletion', async () => {
    deleteMessageBranch.mockResolvedValue({ status: 'deleted', deletedCount: 4 });

    const response = await request(app).delete('/api/messages/convo-1/assistant-1/branch');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ deletedCount: 4 });
    expect(deleteMessageBranch).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: 'branch-user-123' } }),
      { conversationId: 'convo-1', messageId: 'assistant-1' },
    );
  });

  it.each([
    ['not_found', 404, 'Message not found'],
    ['invalid_target', 400, 'User messages cannot be discarded as generations'],
  ])('maps %s results to a safe response', async (status, expectedStatus, error) => {
    deleteMessageBranch.mockResolvedValue({ status, deletedCount: 0 });

    const response = await request(app).delete('/api/messages/convo-1/assistant-1/branch');

    expect(response.status).toBe(expectedStatus);
    expect(response.body).toEqual({ error });
  });
});
