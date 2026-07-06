const mockLogger = {
  error: jest.fn(),
};

jest.mock('@librechat/data-schemas', () => ({
  logger: mockLogger,
}));

const { finalizeAssistantCompletion } = require('./finalize');

describe('finalizeAssistantCompletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('waits for assistant message persistence before clearing the active marker', async () => {
    const callOrder = [];
    const userMessagePromise = Promise.resolve().then(() => {
      callOrder.push('userMessagePromise');
    });
    const saveAssistantMessage = jest.fn().mockImplementation(async () => {
      callOrder.push('saveAssistantMessage:start');
      await Promise.resolve();
      callOrder.push('saveAssistantMessage:end');
    });
    const cache = {
      delete: jest.fn().mockImplementation(async () => {
        callOrder.push('cache.delete');
      }),
    };
    const afterPersist = jest.fn().mockImplementation(async () => {
      callOrder.push('afterPersist');
    });
    let finalMessageSaved = false;

    await finalizeAssistantCompletion({
      req: {},
      responseMessage: { messageId: 'assistant-live' },
      model: 'assistant-model',
      userMessagePromise,
      saveAssistantMessage,
      cache,
      cacheKey: 'user-1:conversation-1',
      onPersisted: () => {
        finalMessageSaved = true;
        callOrder.push('onPersisted');
      },
      afterPersist,
    });

    expect(finalMessageSaved).toBe(true);
    expect(saveAssistantMessage).toHaveBeenCalledTimes(1);
    expect(cache.delete).toHaveBeenCalledWith('user-1:conversation-1');
    expect(callOrder).toEqual([
      'userMessagePromise',
      'saveAssistantMessage:start',
      'saveAssistantMessage:end',
      'onPersisted',
      'cache.delete',
      'afterPersist',
    ]);
  });

  it('does not clear the active marker if assistant message persistence fails', async () => {
    const saveAssistantMessage = jest.fn().mockRejectedValue(new Error('save failed'));
    const cache = {
      delete: jest.fn(),
      set: jest.fn(),
    };
    const onPersisted = jest.fn();

    await expect(
      finalizeAssistantCompletion({
        req: {},
        responseMessage: { messageId: 'assistant-live' },
        model: 'assistant-model',
        saveAssistantMessage,
        cache,
        cacheKey: 'user-1:conversation-1',
        onPersisted,
      }),
    ).rejects.toThrow('save failed');

    expect(onPersisted).not.toHaveBeenCalled();
    expect(cache.delete).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('swallows post-save metadata or usage failures after the saved generation is already stable', async () => {
    const saveAssistantMessage = jest.fn().mockResolvedValue({ messageId: 'assistant-live' });
    const cache = {
      delete: jest.fn().mockResolvedValue(undefined),
      set: jest.fn(),
    };
    const afterPersist = jest.fn().mockRejectedValue(new Error('metadata failed'));
    const onPersisted = jest.fn();

    await expect(
      finalizeAssistantCompletion({
        req: {},
        responseMessage: { messageId: 'assistant-live' },
        model: 'assistant-model',
        saveAssistantMessage,
        cache,
        cacheKey: 'user-1:conversation-1',
        onPersisted,
        afterPersist,
      }),
    ).resolves.toBeUndefined();

    expect(saveAssistantMessage).toHaveBeenCalledTimes(1);
    expect(onPersisted).toHaveBeenCalledTimes(1);
    expect(cache.delete).toHaveBeenCalledWith('user-1:conversation-1');
    expect(afterPersist).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      '[/assistants/chat/] Error finalizing completed run metadata',
      expect.any(Error),
    );
  });

  it('logs cleanup failure but still resolves after persistence is already stable', async () => {
    const cache = {
      delete: jest.fn().mockRejectedValue(new Error('delete failed')),
      set: jest.fn().mockRejectedValue(new Error('tombstone failed')),
    };

    await expect(
      finalizeAssistantCompletion({
        req: {},
        responseMessage: { messageId: 'assistant-live' },
        model: 'assistant-model',
        saveAssistantMessage: jest.fn().mockResolvedValue({ messageId: 'assistant-live' }),
        cache,
        cacheKey: 'user-1:conversation-1',
      }),
    ).resolves.toBeUndefined();

    expect(cache.delete).toHaveBeenCalledTimes(3);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to replace active generation marker with inactive tombstone'),
      expect.any(Object),
    );
  });
});
