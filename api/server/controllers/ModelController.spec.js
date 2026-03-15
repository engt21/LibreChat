const { CacheKeys } = require('librechat-data-provider');

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
  },
}));

jest.mock('@librechat/api', () => ({
  getGoogleModels: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  loadDefaultModels: jest.fn(),
  loadConfigModels: jest.fn(),
}));

jest.mock('~/server/services/ModelAccess', () => ({
  filterModelsConfigForUser: jest.fn((modelsConfig) => modelsConfig),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

const { getGoogleModels } = require('@librechat/api');
const { loadConfigModels } = require('~/server/services/Config');
const { getLogStores } = require('~/cache');
const { loadModels } = require('./ModelController');

describe('ModelController loadModels', () => {
  const mockReq = { user: { id: 'user-1' } };
  let mockCache;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    getLogStores.mockReturnValue(mockCache);
  });

  it('keeps the cached models config when Google and Ollama models are unchanged', async () => {
    const cachedModelsConfig = {
      google: ['gemini-2.5-flash'],
      ollama: ['gptossbigctx:latest'],
    };

    mockCache.get.mockResolvedValue(cachedModelsConfig);
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    loadConfigModels.mockResolvedValue({ ollama: ['gptossbigctx:latest'] });

    const result = await loadModels(mockReq);

    expect(loadConfigModels).toHaveBeenCalledWith(mockReq, { endpointNames: ['ollama'] });
    expect(result).toBe(cachedModelsConfig);
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(getLogStores).toHaveBeenCalledWith(CacheKeys.CONFIG_STORE);
  });

  it('refreshes the cached config when the detected Ollama tags change', async () => {
    mockCache.get.mockResolvedValue({
      google: ['gemini-2.5-flash'],
      ollama: ['old-model:latest'],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    loadConfigModels.mockResolvedValue({ ollama: ['gptossbigctx:latest'] });

    const result = await loadModels(mockReq);

    expect(mockCache.set).toHaveBeenCalledWith(CacheKeys.MODELS_CONFIG, {
      google: ['gemini-2.5-flash'],
      ollama: ['gptossbigctx:latest'],
    });
    expect(result).toEqual({
      google: ['gemini-2.5-flash'],
      ollama: ['gptossbigctx:latest'],
    });
  });
});
