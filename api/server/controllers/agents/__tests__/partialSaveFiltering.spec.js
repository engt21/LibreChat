const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

const mockGenerationJobManager = {
  createJob: jest.fn(),
  getJob: jest.fn(),
  emitDone: jest.fn(),
  emitChunk: jest.fn(),
  emitError: jest.fn(),
  completeJob: jest.fn(),
  updateMetadata: jest.fn(),
  setContentParts: jest.fn(),
  getResumeState: jest.fn(),
};

const mockSaveMessage = jest.fn();
const mockFilterMalformedContentParts = jest.fn((parts) => parts);
const mockDecrementPendingRequest = jest.fn();
const mockCheckAndIncrementPendingRequest = jest
  .fn()
  .mockResolvedValue({ allowed: true, pendingRequests: 0, limit: 5 });

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  GenerationJobManager: mockGenerationJobManager,
  checkAndIncrementPendingRequest: (...args) => mockCheckAndIncrementPendingRequest(...args),
  decrementPendingRequest: (...args) => mockDecrementPendingRequest(...args),
  filterMalformedContentParts: (...args) => mockFilterMalformedContentParts(...args),
  getViolationInfo: jest.fn(),
  sendEvent: jest.fn(),
  buildMessageFiles: jest.fn(),
  sanitizeMessageForTransmit: jest.fn((msg) => msg),
}));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
}));

jest.mock('~/cache', () => ({
  logViolation: jest.fn(),
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
  clientRegistry: null,
  requestDataMap: new Map(),
}));

jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: jest.fn(),
}));

jest.mock('~/server/services/ModelAccess', () => ({
  validateModelAccess: jest.fn(),
}));

jest.mock('~/server/services/ModelRateLimits', () => ({
  checkAndIncrementModelRequestLimit: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('~/server/middleware', () => ({
  handleAbortError: jest.fn().mockResolvedValue(undefined),
}));

const AgentController = require('../request');

describe('ResumableAgentController partial response persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters orphaned Anthropic web search blocks before saving partial disconnect content', async () => {
    let allSubscribersLeftHandler;
    const job = {
      createdAt: 123,
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: {
        on: jest.fn((event, handler) => {
          if (event === 'allSubscribersLeft') {
            allSubscribersLeftHandler = handler;
          }
        }),
      },
    };
    mockGenerationJobManager.createJob.mockResolvedValue(job);
    mockGenerationJobManager.getResumeState.mockResolvedValue({
      responseMessageId: 'response-msg',
      conversationId: 'conversation-123',
      userMessage: {
        messageId: 'user-msg',
        conversationId: 'conversation-123',
        parentMessageId: 'root',
        text: 'Search the web',
      },
    });

    const orphanContent = [
      {
        type: 'server_tool_use',
        id: 'srvtoolu_orphan',
        name: 'web_search',
        input: { query: 'concert history' },
      },
      { type: 'text', text: 'Partial answer' },
    ];
    const filteredContent = [{ type: 'text', text: 'Partial answer' }];
    mockFilterMalformedContentParts.mockReturnValueOnce(filteredContent);

    const client = {
      sender: 'Claude',
      contentParts: [],
      options: {},
      sendMessage: jest.fn(() => new Promise(() => {})),
    };
    const initializeClient = jest.fn().mockResolvedValue({ client });
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Search the web',
        endpointOption: {
          endpoint: 'agents',
          modelOptions: { model: 'claude-opus-4-7' },
          model_parameters: { model: 'claude-opus-4-7' },
        },
        conversationId: 'conversation-123',
      },
    };
    const res = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      on: jest.fn(),
      headersSent: false,
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);
    expect(allSubscribersLeftHandler).toBeDefined();

    await allSubscribersLeftHandler(orphanContent);

    expect(mockFilterMalformedContentParts).toHaveBeenCalledWith(orphanContent);
    expect(mockSaveMessage).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        messageId: 'response-msg',
        content: filteredContent,
        unfinished: true,
      }),
      expect.objectContaining({
        context: 'api/server/controllers/agents/request.js - partial response on disconnect',
      }),
    );
  });
});
