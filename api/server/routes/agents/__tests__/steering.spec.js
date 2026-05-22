const express = require('express');
const request = require('supertest');

const mockGenerationJobManager = {
  getJob: jest.fn(),
  abortJob: jest.fn(),
  getActiveJobIdsForUser: jest.fn(),
};
const mockSaveMessage = jest.fn();
const mockGetEffectiveAppSettings = jest.fn();
const mockAgentController = jest.fn();

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  generateCheckAccess: () => (_req, _res, next) => next(),
  skipAgentCheck: jest.fn(),
  GenerationJobManager: mockGenerationJobManager,
  filterMalformedContentParts: (content) => content,
}));

jest.mock('~/server/middleware', () => ({
  moderateText: (_req, _res, next) => next(),
  validateConvoAccess: (_req, _res, next) => next(),
  buildEndpointOption: (req, _res, next) => {
    req.body.endpointOption = { endpoint: req.body.endpoint ?? 'openAI' };
    next();
  },
  canAccessAgentFromBody: () => (_req, _res, next) => next(),
}));

jest.mock('~/server/services/Endpoints/agents', () => ({
  initializeClient: jest.fn(),
}));

jest.mock('~/server/services/Endpoints/agents/title', () => jest.fn());

jest.mock('~/models/Role', () => ({
  getRoleByName: jest.fn(),
}));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
}));

jest.mock('~/server/services/Admin/appSettings', () => ({
  getEffectiveAppSettings: (...args) => mockGetEffectiveAppSettings(...args),
}));

jest.mock('~/server/controllers/agents/request', () =>
  jest.fn((...args) => mockAgentController(...args)),
);

const chatRoutes = require('~/server/routes/agents/chat');

function createApp(user = { id: 'user-1', modelSteeringPrefs: { enabled: true } }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    req.config = {};
    next();
  });
  app.use('/api/agents/chat', chatRoutes);
  return app;
}

function mockRunningJob(overrides = {}) {
  mockGenerationJobManager.getJob.mockResolvedValue({
    status: 'running',
    metadata: { userId: 'user-1', conversationId: 'conversation-1' },
    ...overrides,
  });
}

function mockAbortResult(overrides = {}) {
  mockGenerationJobManager.abortJob.mockResolvedValue({
    success: true,
    jobData: {
      userMessage: { messageId: 'user-message-1' },
      responseMessageId: 'partial-response-1',
      conversationId: 'conversation-1',
      sender: 'Assistant',
      endpoint: 'openAI',
      model: 'gpt-5',
    },
    content: [{ type: 'text', text: 'partial' }],
    text: 'partial',
    ...overrides,
  });
}

describe('Agent model steering route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEffectiveAppSettings.mockResolvedValue({ modelSteeringEnabled: true });
    mockSaveMessage.mockResolvedValue(undefined);
    mockAgentController.mockImplementation((req, res) =>
      res.json({
        streamId: req.body.conversationId,
        conversationId: req.body.conversationId,
        status: 'started',
      }),
    );
  });

  it('rejects steering when the workspace setting is disabled', async () => {
    mockGetEffectiveAppSettings.mockResolvedValue({ modelSteeringEnabled: false });

    const response = await request(createApp())
      .post('/api/agents/chat/steer')
      .send({ text: 'Use bullets', conversationId: 'conversation-1', endpoint: 'openAI' });

    expect(response.status).toBe(403);
    expect(mockGenerationJobManager.abortJob).not.toHaveBeenCalled();
  });

  it('rejects steering when the user preference is disabled', async () => {
    const response = await request(
      createApp({ id: 'user-1', modelSteeringPrefs: { enabled: false } }),
    )
      .post('/api/agents/chat/steer')
      .send({ text: 'Use bullets', conversationId: 'conversation-1', endpoint: 'openAI' });

    expect(response.status).toBe(403);
    expect(mockGenerationJobManager.abortJob).not.toHaveBeenCalled();
  });

  it('rejects empty steering text', async () => {
    const response = await request(createApp())
      .post('/api/agents/chat/steer')
      .send({ text: '   ', conversationId: 'conversation-1', endpoint: 'openAI' });

    expect(response.status).toBe(400);
    expect(mockGenerationJobManager.abortJob).not.toHaveBeenCalled();
  });

  it('rejects attempts to steer another user job', async () => {
    mockRunningJob({ metadata: { userId: 'other-user', conversationId: 'conversation-1' } });

    const response = await request(createApp())
      .post('/api/agents/chat/steer')
      .send({ text: 'Use bullets', conversationId: 'conversation-1', endpoint: 'openAI' });

    expect(response.status).toBe(403);
    expect(mockGenerationJobManager.abortJob).not.toHaveBeenCalled();
  });

  it('saves the partial response and starts a steered continuation', async () => {
    mockRunningJob();
    mockAbortResult();

    const response = await request(createApp()).post('/api/agents/chat/steer').send({
      text: '  Use exactly three bullets  ',
      conversationId: 'conversation-1',
      endpoint: 'openAI',
    });

    expect(response.status).toBe(200);
    expect(mockGenerationJobManager.abortJob).toHaveBeenCalledWith('conversation-1');
    expect(mockSaveMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        messageId: 'partial-response-1',
        parentMessageId: 'user-message-1',
        conversationId: 'conversation-1',
        content: [{ type: 'text', text: 'partial' }],
        text: 'partial',
        unfinished: true,
      }),
      expect.objectContaining({
        context: 'api/server/routes/agents/chat.js - model steering partial response',
      }),
    );
    expect(mockAgentController).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          text: 'Use exactly three bullets',
          conversationId: 'conversation-1',
          parentMessageId: 'partial-response-1',
          isSteering: true,
        }),
      }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(response.body).toEqual({
      streamId: 'conversation-1',
      conversationId: 'conversation-1',
      status: 'started',
    });
  });

  it('fails closed when the partial response cannot be saved', async () => {
    mockRunningJob();
    mockAbortResult();
    mockSaveMessage.mockRejectedValue(new Error('save failed'));

    const response = await request(createApp())
      .post('/api/agents/chat/steer')
      .send({ text: 'Use bullets', conversationId: 'conversation-1', endpoint: 'openAI' });

    expect(response.status).toBe(500);
    expect(mockAgentController).not.toHaveBeenCalled();
  });
});
