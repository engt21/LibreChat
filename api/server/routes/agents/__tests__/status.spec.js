const express = require('express');
const request = require('supertest');

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

const mockGenerationJobManager = {
  getJob: jest.fn(),
  getResumeState: jest.fn(),
  getActiveJobIdsForUser: jest.fn(),
};

const mockGetActiveGenerationState = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: mockLogger,
}));

jest.mock('@librechat/api', () => ({
  ...jest.requireActual('@librechat/api'),
  isEnabled: jest.fn().mockReturnValue(false),
  GenerationJobManager: mockGenerationJobManager,
}));

jest.mock('~/server/services/MessageGrafts/active', () => ({
  getActiveGenerationState: (...args) => mockGetActiveGenerationState(...args),
}));

jest.mock('~/models', () => ({
  saveMessage: jest.fn(),
}));

jest.mock('~/server/middleware', () => ({
  uaParser: (req, res, next) => next(),
  checkBan: (req, res, next) => next(),
  requireJwtAuth: (req, res, next) => {
    req.user = { id: 'test-user-123' };
    next();
  },
  messageIpLimiter: (req, res, next) => next(),
  configMiddleware: (req, res, next) => next(),
  messageUserLimiter: (req, res, next) => next(),
}));

jest.mock('~/server/routes/agents/chat', () => require('express').Router());
jest.mock('~/server/routes/agents/v1', () => ({
  v1: require('express').Router(),
}));

const agentRoutes = require('~/server/routes/agents/index');

describe('Agent Status Endpoint', () => {
  let app;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/agents', agentRoutes);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /chat/status/:conversationId', () => {
    it('reports assistants activity from the canonical resolver and becomes inactive after marker deletion', async () => {
      const conversationId = 'conversation-assistants-1';

      mockGetActiveGenerationState
        .mockResolvedValueOnce({
          active: true,
          provider: 'assistants',
          responseMessageId: 'assistant-live',
        })
        .mockResolvedValueOnce({
          active: false,
          provider: null,
          responseMessageId: null,
        });

      mockGenerationJobManager.getJob.mockResolvedValue(null);

      const activeResponse = await request(app).get(`/api/agents/chat/status/${conversationId}`);

      expect(activeResponse.status).toBe(200);
      expect(activeResponse.body).toEqual({
        active: true,
        provider: 'assistants',
        responseMessageId: 'assistant-live',
      });
      expect(mockGetActiveGenerationState).toHaveBeenNthCalledWith(1, {
        userId: 'test-user-123',
        conversationId,
        preloadedResumableJob: null,
      });
      expect(mockGenerationJobManager.getJob).toHaveBeenCalledTimes(1);
      expect(mockGenerationJobManager.getResumeState).not.toHaveBeenCalled();

      const inactiveResponse = await request(app).get(`/api/agents/chat/status/${conversationId}`);

      expect(inactiveResponse.status).toBe(200);
      expect(inactiveResponse.body).toEqual({
        active: false,
        provider: null,
        responseMessageId: null,
      });
      expect(mockGetActiveGenerationState).toHaveBeenNthCalledWith(2, {
        userId: 'test-user-123',
        conversationId,
        preloadedResumableJob: null,
      });
      expect(mockGenerationJobManager.getJob).toHaveBeenCalledTimes(2);
    });

    it('preserves resumable status fields for an owned running job', async () => {
      const conversationId = 'conversation-resumable-1';
      const resumeState = {
        aggregatedContent: [{ type: 'text', text: 'partial response' }],
        runSteps: [],
      };

      mockGetActiveGenerationState.mockResolvedValue({
        active: true,
        provider: 'resumable',
        responseMessageId: 'assistant-live',
      });
      mockGenerationJobManager.getJob.mockResolvedValue({
        status: 'running',
        createdAt: 123456,
        metadata: { userId: 'test-user-123' },
      });
      mockGenerationJobManager.getResumeState.mockResolvedValue(resumeState);

      const response = await request(app).get(`/api/agents/chat/status/${conversationId}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        active: true,
        provider: 'resumable',
        responseMessageId: 'assistant-live',
        streamId: conversationId,
        status: 'running',
        aggregatedContent: [{ type: 'text', text: 'partial response' }],
        createdAt: 123456,
        resumeState,
      });
      expect(mockGenerationJobManager.getJob).toHaveBeenCalledTimes(1);
      expect(mockGetActiveGenerationState).toHaveBeenCalledWith({
        userId: 'test-user-123',
        conversationId,
        preloadedResumableJob: {
          status: 'running',
          createdAt: 123456,
          metadata: { userId: 'test-user-123' },
        },
      });
    });

    it("keeps the resumable ownership check and does not expose another user's running job", async () => {
      const conversationId = 'conversation-foreign-1';

      mockGetActiveGenerationState.mockResolvedValue({
        active: false,
        provider: null,
        responseMessageId: null,
      });
      mockGenerationJobManager.getJob.mockResolvedValue({
        status: 'running',
        createdAt: 123456,
        metadata: { userId: 'other-user-456' },
      });

      const response = await request(app).get(`/api/agents/chat/status/${conversationId}`);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Unauthorized' });
      expect(mockGenerationJobManager.getJob).toHaveBeenCalledTimes(1);
      expect(mockGetActiveGenerationState).toHaveBeenCalledWith({
        userId: 'test-user-123',
        conversationId,
        preloadedResumableJob: {
          status: 'running',
          createdAt: 123456,
          metadata: { userId: 'other-user-456' },
        },
      });
      expect(mockGenerationJobManager.getResumeState).not.toHaveBeenCalled();
    });
  });
});
