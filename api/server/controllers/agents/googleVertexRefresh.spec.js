const { Providers } = require('@librechat/agents');
const { CacheKeys } = require('librechat-data-provider');
const { maybeRefreshGoogleVertexModelAccess } = require('./googleVertexRefresh');
const { refreshGoogleVertexModelAccess } = require('@librechat/api');
const { getLogStores } = require('~/cache');

jest.mock('@librechat/api', () => ({
  refreshGoogleVertexModelAccess: jest.fn(),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('maybeRefreshGoogleVertexModelAccess', () => {
  let mockCache;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache = {
      delete: jest.fn().mockResolvedValue(true),
    };
    getLogStores.mockReturnValue(mockCache);
  });

  it('skips refresh work for non-Vertex providers', async () => {
    const refreshed = await maybeRefreshGoogleVertexModelAccess({
      provider: Providers.GOOGLE,
      error: new Error('Publisher Model access error'),
      clientOptions: {
        model: 'gemini-3.1-pro-preview',
      },
    });

    expect(refreshed).toBe(false);
    expect(refreshGoogleVertexModelAccess).not.toHaveBeenCalled();
    expect(getLogStores).not.toHaveBeenCalled();
  });

  it('invalidates cached model selectors after a successful refresh', async () => {
    refreshGoogleVertexModelAccess.mockResolvedValue(true);

    const refreshed = await maybeRefreshGoogleVertexModelAccess({
      provider: Providers.VERTEXAI,
      error: new Error('Publisher Model access error'),
      clientOptions: {
        model: 'gemini-3.1-pro-preview',
      },
      model: 'gemini-3.1-pro-preview',
    });

    expect(refreshed).toBe(true);
    expect(refreshGoogleVertexModelAccess).toHaveBeenCalledWith({
      error: expect.any(Error),
      model: 'gemini-3.1-pro-preview',
      clientOptions: {
        model: 'gemini-3.1-pro-preview',
      },
    });
    expect(getLogStores).toHaveBeenCalledWith(CacheKeys.CONFIG_STORE);
    expect(mockCache.delete).toHaveBeenNthCalledWith(1, CacheKeys.MODELS_CONFIG);
    expect(mockCache.delete).toHaveBeenNthCalledWith(2, CacheKeys.STARTUP_CONFIG);
  });

  it('does not invalidate selectors when refresh is not needed', async () => {
    refreshGoogleVertexModelAccess.mockResolvedValue(false);

    const refreshed = await maybeRefreshGoogleVertexModelAccess({
      provider: Providers.VERTEXAI,
      error: new Error('Publisher Model access error'),
      clientOptions: {
        model: 'gemini-3.1-pro-preview',
      },
    });

    expect(refreshed).toBe(false);
    expect(getLogStores).not.toHaveBeenCalled();
    expect(mockCache.delete).not.toHaveBeenCalled();
  });
});
