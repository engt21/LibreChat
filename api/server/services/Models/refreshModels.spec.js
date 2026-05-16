jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock('~/server/controllers/ModelController', () => ({
  loadModels: jest.fn(),
  getModelsConfig: jest.fn(),
  resetStartupModelRefresh: jest.fn(),
}));

jest.mock('~/server/services/Config/app', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

const { CacheKeys, EModelEndpoint } = require('librechat-data-provider');

describe('refreshModels service', () => {
  let loadModels;
  let resetStartupModelRefresh;
  let getAppConfig;
  let getLogStores;
  let modelQueriesCache;
  let configStoreCache;
  let refreshAllModels;
  let refreshProviderModels;
  let buildProvidersPayload;
  let getKnownProviderNames;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();

    ({ loadModels, resetStartupModelRefresh } = require('~/server/controllers/ModelController'));
    ({ getAppConfig } = require('~/server/services/Config/app'));
    ({ getLogStores } = require('~/cache'));

    modelQueriesCache = {
      clear: jest.fn().mockResolvedValue(undefined),
    };

    configStoreCache = {
      delete: jest.fn().mockResolvedValue(true),
    };

    getLogStores.mockImplementation((key) => {
      if (key === CacheKeys.MODEL_QUERIES) {
        return modelQueriesCache;
      }
      if (key === CacheKeys.CONFIG_STORE) {
        return configStoreCache;
      }
      return null;
    });

    getAppConfig.mockResolvedValue({
      endpoints: {
        [EModelEndpoint.custom]: [{ name: 'xai' }, { name: 'ollama' }],
      },
    });

    loadModels.mockResolvedValue({
      [EModelEndpoint.openAI]: ['gpt-5', 'gpt-5.5', 'gpt-5.5-pro'],
      [EModelEndpoint.anthropic]: ['claude-4-sonnet'],
      [EModelEndpoint.google]: ['gemini-2.5-pro'],
      [EModelEndpoint.azureOpenAI]: [],
      [EModelEndpoint.assistants]: [],
      [EModelEndpoint.bedrock]: [],
      xai: ['grok-4'],
      ollama: ['llama4:latest'],
      initial: 'should-be-filtered-out',
    });

    ({
      refreshAllModels,
      refreshProviderModels,
      buildProvidersPayload,
      getKnownProviderNames,
    } = require('./refreshModels'));
  });

  describe('refreshAllModels', () => {
    it('clears caches, resets the startup latch, and returns every known provider', async () => {
      const req = { user: { id: 'admin-1' } };

      const result = await refreshAllModels(req);

      expect(modelQueriesCache.clear).toHaveBeenCalledTimes(1);
      expect(configStoreCache.delete).toHaveBeenCalledWith(CacheKeys.MODELS_CONFIG);
      expect(configStoreCache.delete).toHaveBeenCalledWith(CacheKeys.STARTUP_CONFIG);
      expect(resetStartupModelRefresh).toHaveBeenCalledTimes(1);
      expect(loadModels).toHaveBeenCalledWith(req);

      expect(result.refreshedAt).toEqual(expect.any(String));
      expect(Object.keys(result.providers).sort()).toEqual(
        [
          EModelEndpoint.anthropic,
          EModelEndpoint.assistants,
          EModelEndpoint.azureOpenAI,
          EModelEndpoint.bedrock,
          EModelEndpoint.google,
          EModelEndpoint.openAI,
          'ollama',
          'xai',
        ].sort(),
      );

      expect(result.providers[EModelEndpoint.openAI]).toEqual({
        count: 3,
        models: ['gpt-5', 'gpt-5.5', 'gpt-5.5-pro'],
      });
      expect(result.providers.xai).toEqual({ count: 1, models: ['grok-4'] });
      expect(result.providers).not.toHaveProperty('initial');
    });

    it('falls back to per-key delete when cache.clear is unavailable', async () => {
      delete modelQueriesCache.clear;
      modelQueriesCache.delete = jest.fn().mockResolvedValue(true);
      modelQueriesCache.iterator = async function* iterator() {
        yield ['key-a', null];
        yield ['key-b', null];
      };

      const req = { user: { id: 'admin-1' } };
      await refreshAllModels(req);

      expect(modelQueriesCache.delete).toHaveBeenCalledWith('key-a');
      expect(modelQueriesCache.delete).toHaveBeenCalledWith('key-b');
    });
  });

  describe('refreshProviderModels', () => {
    it('refreshes a single known provider and only returns that provider', async () => {
      const req = { user: { id: 'admin-1' } };

      const result = await refreshProviderModels(req, EModelEndpoint.openAI);

      expect(modelQueriesCache.clear).toHaveBeenCalledTimes(1);
      expect(configStoreCache.delete).toHaveBeenCalledWith(CacheKeys.MODELS_CONFIG);
      expect(configStoreCache.delete).toHaveBeenCalledWith(CacheKeys.STARTUP_CONFIG);
      expect(resetStartupModelRefresh).toHaveBeenCalledTimes(1);
      expect(loadModels).toHaveBeenCalledWith(req);

      expect(Object.keys(result.providers)).toEqual([EModelEndpoint.openAI]);
      expect(result.providers[EModelEndpoint.openAI]).toEqual({
        count: 3,
        models: ['gpt-5', 'gpt-5.5', 'gpt-5.5-pro'],
      });
    });

    it('rejects unknown providers with a 400-shaped error', async () => {
      const req = { user: { id: 'admin-1' } };
      await expect(refreshProviderModels(req, 'not-a-real-provider')).rejects.toMatchObject({
        message: 'Unknown provider: not-a-real-provider',
        statusCode: 400,
      });
      expect(loadModels).not.toHaveBeenCalled();
    });

    it('rejects empty/blank provider names', async () => {
      const req = { user: { id: 'admin-1' } };
      await expect(refreshProviderModels(req, '   ')).rejects.toMatchObject({
        message: 'Unknown provider:    ',
      });
      expect(loadModels).not.toHaveBeenCalled();
    });

    it('accepts custom endpoint names from app config', async () => {
      const req = { user: { id: 'admin-1' } };

      const result = await refreshProviderModels(req, 'xai');

      expect(Object.keys(result.providers)).toEqual(['xai']);
      expect(result.providers.xai).toEqual({ count: 1, models: ['grok-4'] });
    });
  });

  describe('buildProvidersPayload', () => {
    it('filters out the initial sentinel and non-array entries', () => {
      const payload = buildProvidersPayload({
        openAI: ['gpt-5'],
        google: ['gemini-2.5-pro'],
        initial: 'openAI',
        broken: { not: 'an array' },
      });

      expect(Object.keys(payload).sort()).toEqual(['google', 'openAI']);
    });

    it('respects the provider filter when provided', () => {
      const payload = buildProvidersPayload(
        {
          openAI: ['gpt-5'],
          google: ['gemini-2.5-pro'],
        },
        ['openAI'],
      );

      expect(Object.keys(payload)).toEqual(['openAI']);
    });
  });

  describe('getKnownProviderNames', () => {
    it('always returns the built-in providers even with no app config', () => {
      const names = getKnownProviderNames(undefined);
      expect(names).toEqual(
        expect.arrayContaining([
          EModelEndpoint.openAI,
          EModelEndpoint.anthropic,
          EModelEndpoint.google,
          EModelEndpoint.azureOpenAI,
          EModelEndpoint.assistants,
          EModelEndpoint.azureAssistants,
          EModelEndpoint.bedrock,
        ]),
      );
    });

    it('appends custom endpoint names', () => {
      const names = getKnownProviderNames({
        endpoints: {
          [EModelEndpoint.custom]: [{ name: 'xai' }, { name: 'ollama' }, { name: '' }],
        },
      });

      expect(names).toEqual(expect.arrayContaining(['xai', 'ollama']));
      expect(names.filter((name) => name === '')).toHaveLength(0);
    });
  });
});
