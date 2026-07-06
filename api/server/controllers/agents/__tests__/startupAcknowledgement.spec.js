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
const mockGetModelsConfig = jest.fn();
const mockValidateModelAccess = jest.fn();
const mockModelRateLimit = jest.fn();

jest.mock('@librechat/data-schemas', () => ({ logger: mockLogger }));
jest.mock('@librechat/api', () => ({
  GenerationJobManager: mockGenerationJobManager,
  checkAndIncrementPendingRequest: jest.fn().mockResolvedValue({
    allowed: true,
    pendingRequests: 0,
    limit: 5,
  }),
  decrementPendingRequest: jest.fn(),
  filterMalformedContentParts: jest.fn((parts) => parts),
  getViolationInfo: jest.fn(),
  sendEvent: jest.fn(),
  buildMessageFiles: jest.fn(),
  sanitizeMessageForTransmit: jest.fn((message) => message),
}));
jest.mock('~/models', () => ({ saveMessage: jest.fn() }));
jest.mock('~/cache', () => ({ logViolation: jest.fn() }));
jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
  clientRegistry: null,
  requestDataMap: new Map(),
}));
jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: (...args) => mockGetModelsConfig(...args),
}));
jest.mock('~/server/services/ModelAccess', () => ({
  validateModelAccess: (...args) => mockValidateModelAccess(...args),
}));
jest.mock('~/server/services/ModelRateLimits', () => ({
  checkAndIncrementModelRequestLimit: (...args) => mockModelRateLimit(...args),
}));
jest.mock('~/server/middleware', () => ({ handleAbortError: jest.fn() }));

const AgentController = require('../request');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('resumable agent startup acknowledgement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerationJobManager.createJob.mockResolvedValue({
      createdAt: Date.now(),
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: { on: jest.fn() },
    });
    mockValidateModelAccess.mockResolvedValue({ isValid: true });
    mockModelRateLimit.mockResolvedValue({ allowed: true });
  });

  it('returns the stream identity before slow model discovery completes', async () => {
    const modelDiscovery = deferred();
    mockGetModelsConfig.mockReturnValue(modelDiscovery.promise);
    const client = {
      options: {},
      contentParts: [],
      sendMessage: jest.fn(() => new Promise(() => {})),
    };
    const initializeClient = jest.fn().mockResolvedValue({ client });
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Hello',
        conversationId: 'conversation-123',
        endpointOption: {
          endpoint: 'agents',
          agent: Promise.resolve({
            id: 'agent-123',
            provider: 'openAI',
            model: 'gpt-5.6',
          }),
        },
      },
    };
    const res = {
      headersSent: false,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn().mockReturnThis(),
    };

    const controllerPromise = AgentController(req, res, jest.fn(), initializeClient, null);
    await new Promise((resolve) => setImmediate(resolve));

    expect(res.json).toHaveBeenCalledWith({
      streamId: 'conversation-123',
      conversationId: 'conversation-123',
      status: 'started',
    });
    expect(mockGetModelsConfig).toHaveBeenCalledTimes(1);
    expect(initializeClient).not.toHaveBeenCalled();

    modelDiscovery.resolve({ openAI: ['gpt-5.6'] });
    await controllerPromise;

    expect(mockValidateModelAccess).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'openAI', model: 'gpt-5.6' }),
    );
    expect(initializeClient).toHaveBeenCalledTimes(1);
  });

  it('emits structured model access details through SSE after startup ack', async () => {
    mockGetModelsConfig.mockResolvedValue({ openAI: ['gpt-4o'] });
    mockValidateModelAccess.mockResolvedValue({ isValid: false, text: 'Illegal model request' });

    const initializeClient = jest.fn();
    const req = {
      user: { id: 'user-123' },
      body: {
        text: 'Hello',
        conversationId: 'conversation-123',
        endpointOption: {
          endpoint: 'agents',
          agent: Promise.resolve({
            id: 'agent-123',
            provider: 'openAI',
            model: 'gpt-5.6',
          }),
        },
      },
    };
    const res = {
      headersSent: false,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn().mockReturnThis(),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(res.json).toHaveBeenCalledWith({
      streamId: 'conversation-123',
      conversationId: 'conversation-123',
      status: 'started',
    });
    expect(initializeClient).not.toHaveBeenCalled();

    const [, serializedError] = mockGenerationJobManager.emitError.mock.calls[0];
    expect(JSON.parse(serializedError)).toEqual({
      type: 'illegal_model_request',
      endpoint: 'openAI',
      model: 'gpt-5.6',
      info: 'openAI|gpt-5.6',
      message: 'Illegal model request',
      status: 403,
    });
    expect(mockGenerationJobManager.completeJob).toHaveBeenCalledWith(
      'conversation-123',
      serializedError,
    );
  });

  it('emits structured model rate-limit details through SSE after startup ack', async () => {
    mockGetModelsConfig.mockResolvedValue({ openAI: ['gpt-5.6'] });
    mockValidateModelAccess.mockResolvedValue({ isValid: true });
    mockModelRateLimit.mockResolvedValue({
      allowed: false,
      type: 'requests',
      limit: 3,
      current: 3,
      window: '24h',
    });

    const initializeClient = jest.fn();
    const req = {
      user: { id: 'user-123', modelRateLimits: { enabled: true, rules: [] } },
      body: {
        text: 'Hello',
        conversationId: 'conversation-456',
        endpointOption: {
          endpoint: 'openAI',
          model_parameters: { model: 'gpt-5.6' },
        },
      },
    };
    const res = {
      headersSent: false,
      json: jest.fn(() => {
        res.headersSent = true;
      }),
      status: jest.fn().mockReturnThis(),
    };

    await AgentController(req, res, jest.fn(), initializeClient, null);

    expect(res.json).toHaveBeenCalledWith({
      streamId: 'conversation-456',
      conversationId: 'conversation-456',
      status: 'started',
    });
    expect(initializeClient).not.toHaveBeenCalled();

    const [, serializedError] = mockGenerationJobManager.emitError.mock.calls[0];
    expect(JSON.parse(serializedError)).toEqual({
      type: 'model_rate_limit',
      endpoint: 'openAI',
      model: 'gpt-5.6',
      limit: 3,
      current: 3,
      window: '24h',
      message: 'Model requests limit exceeded.',
      status: 429,
    });
    expect(mockGenerationJobManager.completeJob).toHaveBeenCalledWith(
      'conversation-456',
      serializedError,
    );
  });
});
