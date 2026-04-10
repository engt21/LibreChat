jest.mock('@librechat/api', () => ({
  GenerationJobManager: {
    emitChunk: jest.fn(),
  },
  sendEvent: jest.fn(),
}));

const { GenerationJobManager, sendEvent } = require('@librechat/api');
const { createOnWebSearchStatus } = require('./search');

describe('createOnWebSearchStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('emits on_web_search_status via sendEvent for standard (non-resumable) mode', () => {
    const res = { headersSent: true, writableEnded: false };
    const onWebSearchStatus = createOnWebSearchStatus(res, null);

    onWebSearchStatus('searching');

    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect(sendEvent).toHaveBeenCalledWith(res, {
      event: 'on_web_search_status',
      data: { status: { status: 'searching' } },
    });
  });

  test('emits on_web_search_status via GenerationJobManager for resumable mode', () => {
    const res = { headersSent: true, writableEnded: false };
    const onWebSearchStatus = createOnWebSearchStatus(res, 'stream-123');

    onWebSearchStatus('completed');

    expect(GenerationJobManager.emitChunk).toHaveBeenCalledTimes(1);
    expect(GenerationJobManager.emitChunk).toHaveBeenCalledWith('stream-123', {
      event: 'on_web_search_status',
      data: { status: { status: 'completed' } },
    });
    expect(sendEvent).not.toHaveBeenCalled();
  });

  test('does not emit when headers not yet sent and no streamId', () => {
    const res = { headersSent: false, writableEnded: false };
    const onWebSearchStatus = createOnWebSearchStatus(res, null);

    onWebSearchStatus('searching');

    expect(sendEvent).not.toHaveBeenCalled();
    expect(GenerationJobManager.emitChunk).not.toHaveBeenCalled();
  });

  test('does not emit when response is already ended', () => {
    const res = { headersSent: true, writableEnded: true };
    const onWebSearchStatus = createOnWebSearchStatus(res, null);

    onWebSearchStatus('searching');

    expect(sendEvent).not.toHaveBeenCalled();
    expect(GenerationJobManager.emitChunk).not.toHaveBeenCalled();
  });
});
