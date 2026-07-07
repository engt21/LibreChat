const { CacheKeys } = require('librechat-data-provider');

const mockLogger = {
  error: jest.fn(),
};

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

const {
  ASSISTANT_RUN_COMPLETED_VALUE,
  encodeAssistantRunValue,
  parseAssistantRunValue,
  getActiveGenerationState,
  clearAssistantRunMarker,
} = require('./active');

describe('MessageGrafts active state helpers', () => {
  describe('encodeAssistantRunValue', () => {
    it('encodes thread, run, and response message identifiers in a stable order', () => {
      expect(encodeAssistantRunValue('thread-1', 'run-1', 'assistant-live')).toBe(
        'thread-1:run-1:assistant-live',
      );
    });
  });

  describe('parseAssistantRunValue', () => {
    it('parses the new thread, run, and response message format', () => {
      expect(parseAssistantRunValue('thread-1:run-1:assistant-live')).toEqual({
        threadId: 'thread-1',
        runId: 'run-1',
        responseMessageId: 'assistant-live',
        settling: false,
        completed: false,
      });
    });

    it('keeps legacy thread and run values parseable', () => {
      expect(parseAssistantRunValue('thread-1:run-1')).toEqual({
        threadId: 'thread-1',
        runId: 'run-1',
        responseMessageId: null,
        settling: false,
        completed: false,
      });
    });

    it('treats cancelled as a settling marker', () => {
      expect(parseAssistantRunValue('cancelled')).toEqual({
        threadId: null,
        runId: null,
        responseMessageId: null,
        settling: true,
        completed: false,
      });
    });

    it('treats completed as an inactive tombstone marker', () => {
      expect(parseAssistantRunValue(ASSISTANT_RUN_COMPLETED_VALUE)).toEqual({
        threadId: null,
        runId: null,
        responseMessageId: null,
        settling: false,
        completed: true,
      });
    });
  });

  describe('getActiveGenerationState', () => {
    const makeCache = (value) => ({
      get: jest.fn().mockResolvedValue(value),
    });

    it('returns the owned resumable job as active', async () => {
      const cache = makeCache(null);

      await expect(
        getActiveGenerationState({
          userId: 'user-1',
          conversationId: 'conversation-1',
          generationJobManager: {
            getJob: jest.fn().mockResolvedValue({
              status: 'running',
              userId: 'user-1',
              responseMessageId: 'assistant-live',
            }),
          },
          getLogStores: jest.fn().mockReturnValue(cache),
        }),
      ).resolves.toEqual({
        active: true,
        provider: 'resumable',
        responseMessageId: 'assistant-live',
      });

      expect(cache.get).not.toHaveBeenCalled();
    });

    it("does not expose another user's resumable job as active", async () => {
      const cache = makeCache(null);

      await expect(
        getActiveGenerationState({
          userId: 'user-1',
          conversationId: 'conversation-1',
          generationJobManager: {
            getJob: jest.fn().mockResolvedValue({
              status: 'running',
              userId: 'user-2',
              responseMessageId: 'assistant-live',
            }),
          },
          getLogStores: jest.fn().mockReturnValue(cache),
        }),
      ).resolves.toEqual({
        active: false,
        provider: null,
        responseMessageId: null,
      });

      expect(cache.get).toHaveBeenCalledWith('user-1:conversation-1');
    });

    it('returns the assistants cache marker as active with its response message id', async () => {
      const cache = makeCache('thread-1:run-1:assistant-live');

      await expect(
        getActiveGenerationState({
          userId: 'user-1',
          conversationId: 'conversation-1',
          generationJobManager: {
            getJob: jest.fn().mockResolvedValue(null),
          },
          getLogStores: jest.fn().mockImplementation((key) => {
            expect(key).toBe(CacheKeys.ABORT_KEYS);
            return cache;
          }),
        }),
      ).resolves.toEqual({
        active: true,
        provider: 'assistants',
        responseMessageId: 'assistant-live',
      });
    });

    it('treats cancelled assistants runs as active while they are settling', async () => {
      const cache = makeCache('cancelled');

      await expect(
        getActiveGenerationState({
          userId: 'user-1',
          conversationId: 'conversation-1',
          generationJobManager: {
            getJob: jest.fn().mockResolvedValue(null),
          },
          getLogStores: jest.fn().mockReturnValue(cache),
        }),
      ).resolves.toEqual({
        active: true,
        provider: 'assistants',
        responseMessageId: null,
      });
    });

    it('treats the completion tombstone as inactive', async () => {
      const cache = makeCache(ASSISTANT_RUN_COMPLETED_VALUE);

      await expect(
        getActiveGenerationState({
          userId: 'user-1',
          conversationId: 'conversation-1',
          generationJobManager: {
            getJob: jest.fn().mockResolvedValue(null),
          },
          getLogStores: jest.fn().mockReturnValue(cache),
        }),
      ).resolves.toEqual({
        active: false,
        provider: null,
        responseMessageId: null,
      });
    });

    it('returns inactive when the resumable job is stable and the assistants cache is missing', async () => {
      const cache = makeCache(null);

      await expect(
        getActiveGenerationState({
          userId: 'user-1',
          conversationId: 'conversation-1',
          generationJobManager: {
            getJob: jest.fn().mockResolvedValue({
              status: 'completed',
              userId: 'user-1',
              responseMessageId: 'assistant-live',
            }),
          },
          getLogStores: jest.fn().mockReturnValue(cache),
        }),
      ).resolves.toEqual({
        active: false,
        provider: null,
        responseMessageId: null,
      });
    });

    it('uses a preloaded resumable job snapshot without reading the job store again', async () => {
      const cache = makeCache(null);
      const getJob = jest.fn();
      const preloadedResumableJob = {
        status: 'running',
        metadata: { userId: 'user-1' },
        metadataResponseMessageId: 'assistant-live',
      };

      await expect(
        getActiveGenerationState({
          userId: 'user-1',
          conversationId: 'conversation-1',
          preloadedResumableJob,
          generationJobManager: {
            getJob,
          },
          getLogStores: jest.fn().mockReturnValue(cache),
        }),
      ).resolves.toEqual({
        active: true,
        provider: 'resumable',
        responseMessageId: null,
      });

      expect(getJob).not.toHaveBeenCalled();
      expect(cache.get).not.toHaveBeenCalled();
    });
  });

  describe('clearAssistantRunMarker', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('retries transient delete failures before clearing the marker', async () => {
      const cache = {
        delete: jest
          .fn()
          .mockRejectedValueOnce(new Error('delete failed once'))
          .mockResolvedValueOnce(undefined),
        set: jest.fn(),
      };

      await expect(
        clearAssistantRunMarker({
          cache,
          cacheKey: 'user-1:conversation-1',
          responseMessageId: 'assistant-live',
        }),
      ).resolves.toEqual({
        cleared: true,
        tombstoned: false,
        failed: false,
      });

      expect(cache.delete).toHaveBeenCalledTimes(2);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('writes an inactive completion tombstone when delete retries are exhausted', async () => {
      const cache = {
        delete: jest.fn().mockRejectedValue(new Error('delete failed')),
        set: jest.fn().mockResolvedValue(undefined),
      };

      await expect(
        clearAssistantRunMarker({
          cache,
          cacheKey: 'user-1:conversation-1',
          responseMessageId: 'assistant-live',
        }),
      ).resolves.toEqual({
        cleared: false,
        tombstoned: true,
        failed: false,
      });

      expect(cache.delete).toHaveBeenCalledTimes(3);
      expect(cache.set).toHaveBeenCalledWith('user-1:conversation-1', 'completed', expect.any(Number));
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete active generation marker'),
        expect.any(Object),
      );
    });

    it('logs and returns a failure result when both delete and tombstone writes fail', async () => {
      const cache = {
        delete: jest.fn().mockRejectedValue(new Error('delete failed')),
        set: jest.fn().mockRejectedValue(new Error('tombstone failed')),
      };

      await expect(
        clearAssistantRunMarker({
          cache,
          cacheKey: 'user-1:conversation-1',
          responseMessageId: 'assistant-live',
        }),
      ).resolves.toEqual({
        cleared: false,
        tombstoned: false,
        failed: true,
        error: expect.any(Error),
      });

      expect(cache.delete).toHaveBeenCalledTimes(3);
      expect(cache.set).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to replace active generation marker with inactive tombstone'),
        expect.any(Object),
      );
    });
  });
});
