const mockRecordUsage = jest.fn();
const mockCheckMessageGaps = jest.fn();
const mockSendResponse = jest.fn();
const mockGetConvo = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockCacheDelete = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('~/server/services/Threads', () => ({
  recordUsage: (...args) => mockRecordUsage(...args),
  checkMessageGaps: (...args) => mockCheckMessageGaps(...args),
}));

jest.mock('~/server/middleware/error', () => ({
  sendResponse: (...args) => mockSendResponse(...args),
}));

jest.mock('~/models/Conversation', () => ({
  getConvo: (...args) => mockGetConvo(...args),
}));

jest.mock('~/cache/getLogStores', () => jest.fn(() => ({
  get: (...args) => mockCacheGet(...args),
  set: (...args) => mockCacheSet(...args),
  delete: (...args) => mockCacheDelete(...args),
})));

const { createErrorHandler } = require('./errors');

describe('assistants error handler', () => {
  let req;
  let res;
  let openai;
  let getContext;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    req = {
      user: { id: 'user-1' },
    };

    res = {
      end: jest.fn(),
    };

    openai = {
      beta: {
        threads: {
          runs: {
            cancel: jest.fn().mockResolvedValue({ id: 'run-1', status: 'cancelled' }),
            retrieve: jest.fn().mockResolvedValue({
              usage: { prompt_tokens: 3, completion_tokens: 5 },
              model: 'gpt-test',
            }),
          },
        },
      },
    };

    mockGetConvo.mockResolvedValue({ conversationId: 'conversation-1' });
    mockCheckMessageGaps.mockResolvedValue([{ messageId: 'assistant-live', content: [] }]);

    getContext = () => ({
      openai,
      run_id: 'run-1',
      endpoint: 'assistants',
      cacheKey: 'user-1:conversation-1',
      thread_id: 'thread-1',
      completedRun: false,
      assistant_id: 'assistant-1',
      conversationId: 'conversation-1',
      parentMessageId: 'user-message-1',
      responseMessageId: 'assistant-live',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks the run as cancelled before reconciliation and clears the marker after reconciliation succeeds', async () => {
    mockCacheGet.mockResolvedValue('thread-1:run-1:assistant-live');

    const handleError = createErrorHandler({ req, res, getContext });
    const promise = handleError(new Error('boom'));

    await jest.runAllTimersAsync();
    await promise;

    expect(mockCacheSet).toHaveBeenCalledWith(
      'user-1:conversation-1',
      'cancelled',
      expect.any(Number),
    );
    expect(openai.beta.threads.runs.cancel).toHaveBeenCalledWith('run-1', {
      thread_id: 'thread-1',
    });
    expect(mockCheckMessageGaps).toHaveBeenCalledWith({
      openai,
      run_id: 'run-1',
      endpoint: 'assistants',
      thread_id: 'thread-1',
      conversationId: 'conversation-1',
      latestMessageId: 'assistant-live',
    });
    expect(mockCacheDelete).toHaveBeenCalledWith('user-1:conversation-1');
    expect(mockCacheSet.mock.invocationCallOrder[0]).toBeLessThan(
      mockCheckMessageGaps.mock.invocationCallOrder[0],
    );
    expect(mockCheckMessageGaps.mock.invocationCallOrder[0]).toBeLessThan(
      mockCacheDelete.mock.invocationCallOrder[0],
    );
  });

  it('does not clear the cancelled marker when abortRun already owns cancellation', async () => {
    mockCacheGet.mockResolvedValue('cancelled');

    const handleError = createErrorHandler({ req, res, getContext });
    const promise = handleError(new Error('boom'));

    await jest.runAllTimersAsync();
    await promise;

    expect(mockCacheSet).not.toHaveBeenCalled();
    expect(mockCacheDelete).not.toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
  });

  it('keeps the cancelled marker when reconciliation fails', async () => {
    mockCacheGet.mockResolvedValue('thread-1:run-1:assistant-live');
    mockCheckMessageGaps.mockRejectedValue(new Error('reconcile failed'));

    const handleError = createErrorHandler({ req, res, getContext });
    const promise = handleError(new Error('boom'));

    await jest.runAllTimersAsync();
    await promise;

    expect(mockCacheSet).toHaveBeenCalledWith(
      'user-1:conversation-1',
      'cancelled',
      expect.any(Number),
    );
    expect(mockCacheDelete).not.toHaveBeenCalled();
    expect(mockSendResponse).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({
        thread_id: 'thread-1',
        assistant_id: 'assistant-1',
        conversationId: 'conversation-1',
        messageId: 'assistant-live',
      }),
      'The Assistant run failed',
    );
  });

  it('returns the reconciled final event when marker delete falls back to an inactive tombstone', async () => {
    mockCacheGet.mockResolvedValue('thread-1:run-1:assistant-live');
    mockCacheDelete.mockRejectedValue(new Error('delete failed'));
    mockCacheSet.mockResolvedValue(undefined);

    const handleError = createErrorHandler({ req, res, getContext });
    const promise = handleError(new Error('boom'));

    await jest.runAllTimersAsync();
    await promise;

    expect(mockCheckMessageGaps).toHaveBeenCalledTimes(1);
    expect(mockCacheDelete).toHaveBeenCalledTimes(3);
    expect(mockCacheSet).toHaveBeenCalledWith(
      'user-1:conversation-1',
      'completed',
      expect.any(Number),
    );
    expect(mockSendResponse).toHaveBeenCalledWith(
      req,
      res,
      expect.objectContaining({
        final: true,
        conversation: { conversationId: 'conversation-1' },
        runMessages: expect.any(Array),
      }),
    );
  });
});
