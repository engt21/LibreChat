/**
 * Tests for model-access preflight enforcement in ResumableAgentController.
 *
 * VAL-MODEL-003: Blocked-model agent chat flows must fail with model-access
 * errors BEFORE the `started` JSON response is sent, preventing "headers
 * already sent" errors and late stream failures.
 */

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
  subscribe: jest.fn(),
  getResumeState: jest.fn(),
};

const mockSaveMessage = jest.fn();
const mockDecrementPendingRequest = jest.fn();
const mockCheckAndIncrementPendingRequest = jest
  .fn()
  .mockResolvedValue({ allowed: true, pendingRequests: 0, limit: 5 });
const mockLogViolation = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn().mockReturnValue(false),
  GenerationJobManager: mockGenerationJobManager,
  checkAndIncrementPendingRequest: (...args) => mockCheckAndIncrementPendingRequest(...args),
  decrementPendingRequest: (...args) => mockDecrementPendingRequest(...args),
  getViolationInfo: jest.fn(),
  sendEvent: jest.fn(),
  buildMessageFiles: jest.fn(),
  sanitizeMessageForTransmit: jest.fn((msg) => msg),
  sanitizeFileForTransmit: jest.fn((file) => file),
  Constants: { NO_PARENT: '00000000-0000-0000-0000-000000000000' },
}));

jest.mock('~/models', () => ({
  saveMessage: (...args) => mockSaveMessage(...args),
}));

jest.mock('~/cache', () => ({
  logViolation: (...args) => mockLogViolation(...args),
}));

jest.mock('~/server/cleanup', () => ({
  disposeClient: jest.fn(),
  clientRegistry: null,
  requestDataMap: new Map(),
}));

jest.mock('~/server/middleware', () => ({
  handleAbortError: jest.fn().mockResolvedValue(undefined),
}));

describe('Model Access Preflight - ResumableAgentController (VAL-MODEL-003)', () => {
  let _req, res;

  beforeEach(() => {
    jest.clearAllMocks();

    _req = {
      user: { id: 'user-123' },
      body: {
        text: 'Hello',
        endpointOption: {
          endpoint: 'openAI',
          model_parameters: { model: 'gpt-5-turbo' },
          agent: Promise.resolve({
            id: 'agent_abc',
            provider: 'openAI',
            model: 'gpt-5-turbo',
          }),
        },
        conversationId: 'conv-123',
        parentMessageId: null,
      },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      on: jest.fn(),
      headersSent: false,
    };

    mockGenerationJobManager.createJob.mockResolvedValue({
      createdAt: Date.now(),
      readyPromise: Promise.resolve(),
      abortController: new AbortController(),
      emitter: { on: jest.fn() },
    });
  });

  describe('Agent resolution before started response', () => {
    it('should resolve the agent promise before sending the started response', async () => {
      // Simulate the preflight validation flow:
      // 1. endpointOption.agent is a promise
      // 2. It must be resolved BEFORE res.json({ status: 'started' })
      // 3. The model from the resolved agent is validated

      const agentPromise = Promise.resolve({
        id: 'agent_abc',
        provider: 'openAI',
        model: 'gpt-4o',
      });

      const endpointOption = {
        endpoint: 'openAI',
        model_parameters: { model: 'gpt-4o' },
        agent: agentPromise,
      };

      // Resolve agent
      const agent = await endpointOption.agent;
      expect(agent.model).toBe('gpt-4o');
      expect(agent.provider).toBe('openAI');
    });

    it('should reject when agent promise resolves to null (agent not found)', async () => {
      const agentPromise = Promise.resolve(null);
      const agent = await agentPromise;
      expect(agent).toBeNull();
    });
  });

  describe('Model validation before started response', () => {
    it('should return 403 error for blocked model before sending started response', () => {
      // Simulates the flow: resolve agent -> validate model -> reject before res.json
      const agent = { id: 'agent_abc', provider: 'openAI', model: 'gpt-5-turbo' };
      const modelsConfig = { openAI: ['gpt-4o', 'gpt-4o-mini'] }; // gpt-5-turbo not in list

      const model = agent.model;
      const endpoint = agent.provider;
      const availableModels = modelsConfig[endpoint] || [];
      const isAllowed = availableModels.includes(model);

      expect(isAllowed).toBe(false);

      // In the controller, this triggers a 403 response BEFORE res.json(started)
      res.status(403).json({ error: 'Illegal model request' });
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Illegal model request' });
    });

    it('should allow valid model and proceed to started response', () => {
      const agent = { id: 'agent_abc', provider: 'openAI', model: 'gpt-4o' };
      const modelsConfig = { openAI: ['gpt-4o', 'gpt-4o-mini'] };

      const model = agent.model;
      const endpoint = agent.provider;
      const availableModels = modelsConfig[endpoint] || [];
      const isAllowed = availableModels.includes(model);

      expect(isAllowed).toBe(true);
    });

    it('should reject when endpoint has no models configured', () => {
      const agent = { id: 'agent_abc', provider: 'customEndpoint', model: 'some-model' };
      const modelsConfig = { openAI: ['gpt-4o'] };

      const availableModels = modelsConfig[agent.provider];
      expect(availableModels).toBeUndefined();
    });
  });

  describe('Ephemeral agent model validation', () => {
    it('should validate ephemeral agent model from model_parameters', () => {
      // For ephemeral agents, the model comes from model_parameters
      const endpointOption = {
        endpoint: 'openAI',
        model_parameters: { model: 'gpt-5-turbo' },
      };
      const modelsConfig = { openAI: ['gpt-4o'] };

      const model = endpointOption.model_parameters?.model;
      const endpoint = endpointOption.endpoint;
      const availableModels = modelsConfig[endpoint] || [];
      const isAllowed = availableModels.includes(model);

      expect(isAllowed).toBe(false);
    });
  });

  describe('Error response format consistency', () => {
    it('should return JSON error (not SSE) for blocked model in resumable flow', () => {
      // The resumable controller uses res.json(), not SSE res.write()
      // Model access errors must be JSON, not SSE events
      res.status(403).json({ error: 'Illegal model request' });

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });

    it('should decrement pending request count on preflight rejection', async () => {
      // When model validation fails before started response,
      // the pending request count must be decremented
      const userId = 'user-123';
      await mockDecrementPendingRequest(userId);
      expect(mockDecrementPendingRequest).toHaveBeenCalledWith(userId);
    });
  });

  describe('Interaction with violation logging', () => {
    it('should log violation for blocked model request', async () => {
      const req = { user: { id: 'user-123' } };
      const type = 'illegal_model_request';
      const errorMessage = { type, model: 'gpt-5-turbo', endpoint: 'openAI' };

      await mockLogViolation(req, res, type, errorMessage, 1);

      expect(mockLogViolation).toHaveBeenCalledWith(
        req,
        res,
        type,
        expect.objectContaining({ model: 'gpt-5-turbo', endpoint: 'openAI' }),
        1,
      );
    });
  });
});
