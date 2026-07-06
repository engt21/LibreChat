const mockSendEvent = jest.fn();
const mockInitializeClient = jest.fn();
const mockCheckMessageGaps = jest.fn();
const mockRecordUsage = jest.fn();
const mockDeleteMessages = jest.fn();
const mockGetConvo = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();
const mockCacheDelete = jest.fn();

jest.mock('@librechat/api', () => ({
  sendEvent: (...args) => mockSendEvent(...args),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('~/server/services/Endpoints/assistants', () => ({
  initializeClient: (...args) => mockInitializeClient(...args),
}));

jest.mock('~/server/services/Threads', () => ({
  checkMessageGaps: (...args) => mockCheckMessageGaps(...args),
  recordUsage: (...args) => mockRecordUsage(...args),
}));

jest.mock('~/models/Message', () => ({
  deleteMessages: (...args) => mockDeleteMessages(...args),
}));

jest.mock('~/models/Conversation', () => ({
  getConvo: (...args) => mockGetConvo(...args),
}));

jest.mock('~/cache/getLogStores', () => jest.fn(() => ({
  get: (...args) => mockCacheGet(...args),
  set: (...args) => mockCacheSet(...args),
  delete: (...args) => mockCacheDelete(...args),
})));

const { abortRun } = require('./abortRun');

describe('abortRun', () => {
  const conversationId = '11111111-1111-4111-8111-111111111111';

  let req;
  let res;
  let openai;

  beforeEach(() => {
    jest.clearAllMocks();

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

    mockInitializeClient.mockResolvedValue({ openai });
    mockGetConvo.mockResolvedValue({ conversationId, title: 'Conversation' });
    mockCheckMessageGaps.mockResolvedValue([{ messageId: 'assistant-live' }]);

    req = {
      body: {
        abortKey: `${conversationId}:assistant-live`,
        endpoint: 'assistants',
      },
      user: { id: 'user-1' },
    };

    res = {
      headersSent: false,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      json: jest.fn(),
      end: jest.fn(),
    };
  });

  it('keeps the cancelled marker through reconciliation and clears it after stable messages are returned', async () => {
    mockCacheGet.mockResolvedValue('thread-1:run-1:assistant-live');

    await abortRun(req, res);

    expect(mockCacheSet).toHaveBeenCalledWith(
      `user-1:${conversationId}`,
      'cancelled',
      expect.any(Number),
    );
    expect(openai.beta.threads.runs.cancel).toHaveBeenCalledWith('run-1', {
      thread_id: 'thread-1',
    });
    expect(mockDeleteMessages).toHaveBeenCalledWith({
      user: 'user-1',
      unfinished: true,
      conversationId,
    });
    expect(mockCheckMessageGaps).toHaveBeenCalledWith({
      openai,
      run_id: 'run-1',
      endpoint: 'assistants',
      thread_id: 'thread-1',
      conversationId,
      latestMessageId: 'assistant-live',
    });
    expect(mockCacheDelete).toHaveBeenCalledWith(`user-1:${conversationId}`);
    expect(mockCacheSet.mock.invocationCallOrder[0]).toBeLessThan(
      mockCheckMessageGaps.mock.invocationCallOrder[0],
    );
    expect(mockCheckMessageGaps.mock.invocationCallOrder[0]).toBeLessThan(
      mockCacheDelete.mock.invocationCallOrder[0],
    );
    expect(res.json).toHaveBeenCalledWith({
      final: true,
      conversation: { conversationId, title: 'Conversation' },
      runMessages: [{ messageId: 'assistant-live' }],
    });
  });

  it('leaves the cancelled marker in place when reconciliation fails', async () => {
    mockCacheGet.mockResolvedValue('thread-1:run-1:assistant-live');
    mockCheckMessageGaps.mockRejectedValue(new Error('reconcile failed'));

    await expect(abortRun(req, res)).rejects.toThrow('reconcile failed');

    expect(mockCacheSet).toHaveBeenCalledWith(
      `user-1:${conversationId}`,
      'cancelled',
      expect.any(Number),
    );
    expect(mockCacheDelete).not.toHaveBeenCalled();
  });

  it('returns the reconciled abort response when marker delete falls back to an inactive tombstone', async () => {
    mockCacheGet.mockResolvedValue('thread-1:run-1:assistant-live');
    mockCacheDelete.mockRejectedValue(new Error('delete failed'));
    mockCacheSet.mockResolvedValue(undefined);

    await abortRun(req, res);

    expect(mockCheckMessageGaps).toHaveBeenCalledTimes(1);
    expect(mockCacheDelete).toHaveBeenCalledTimes(3);
    expect(mockCacheSet).toHaveBeenNthCalledWith(
      2,
      `user-1:${conversationId}`,
      'completed',
      expect.any(Number),
    );
    expect(res.json).toHaveBeenCalledWith({
      final: true,
      conversation: { conversationId, title: 'Conversation' },
      runMessages: [{ messageId: 'assistant-live' }],
    });
  });
});
