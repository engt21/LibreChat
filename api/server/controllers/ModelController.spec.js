const { CacheKeys } = require('librechat-data-provider');

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
  },
}));

jest.mock(
  '@librechat/api',
  () => ({
    getAnthropicModels: jest.fn(),
    getGoogleModels: jest.fn(),
    getOpenAIModels: jest.fn(),
    resolveAzureOpenAIDirectConfig: jest.fn(),
    isUserProvided: jest.fn((value) => value === 'user_provided'),
  }),
  { virtual: true },
);

jest.mock('~/server/services/Config', () => ({
  loadDefaultModels: jest.fn(),
  loadConfigModels: jest.fn(),
}));

jest.mock('~/server/services/Config/app', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('~/server/services/ModelAccess', () => ({
  filterModelsConfigForUser: jest.fn((modelsConfig) => modelsConfig),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

jest.mock('~/models', () => ({
  getUserKey: jest.fn(),
  getUserKeyValues: jest.fn(),
}));

describe('ModelController loadModels', () => {
  const mockReq = { user: { id: 'user-1' } };
  let mockCache;
  let originalEnv;
  let getAnthropicModels;
  let getGoogleModels;
  let getOpenAIModels;
  let resolveAzureOpenAIDirectConfig;
  let loadConfigModels;
  let getAppConfig;
  let getLogStores;
  let getUserKey;
  let getUserKeyValues;
  let loadModels;
  let getModelsConfig;
  let resetStartupModelRefresh;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    originalEnv = process.env;
    process.env = { ...originalEnv };
    ({
      getAnthropicModels,
      getGoogleModels,
      getOpenAIModels,
      resolveAzureOpenAIDirectConfig,
    } = require('@librechat/api'));
    ({ loadConfigModels } = require('~/server/services/Config'));
    ({ getAppConfig } = require('~/server/services/Config/app'));
    ({ getLogStores } = require('~/cache'));
    ({ getUserKey, getUserKeyValues } = require('~/models'));
    ({ loadModels, getModelsConfig, resetStartupModelRefresh } = require('./ModelController'));
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
    };
    getLogStores.mockReturnValue(mockCache);
    getAppConfig.mockResolvedValue({});
    getUserKey.mockRejectedValue(new Error('missing user key'));
    getAnthropicModels.mockResolvedValue([]);
    getOpenAIModels.mockResolvedValue([]);
    resolveAzureOpenAIDirectConfig.mockReturnValue({
      apiKey: undefined,
      baseURL: undefined,
      manualModels: [],
      isLegacyCredentialPayload: false,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reuses the permission-filtered model snapshot across requests for the same user', async () => {
    const cachedModelsConfig = {
      openAI: ['gpt-5.6'],
      anthropic: [],
      assistants: [],
      azureOpenAI: [],
      google: [],
      ollama: [],
    };
    mockCache.get.mockResolvedValue(cachedModelsConfig);
    loadConfigModels.mockResolvedValue({ ollama: [] });

    const first = await getModelsConfig({ user: { id: 'user-1', role: 'USER' } });
    const second = await getModelsConfig({ user: { id: 'user-1', role: 'USER' } });

    expect(first).toBeDefined();
    expect(second).toBe(first);
    expect(mockCache.get).toHaveBeenCalledTimes(1);
  });

  it('clears per-user model snapshots when discovery caches are reset', async () => {
    const cachedModelsConfig = {
      openAI: ['gpt-5.6'],
      anthropic: [],
      assistants: [],
      azureOpenAI: [],
      google: [],
      ollama: [],
    };
    mockCache.get.mockResolvedValue(cachedModelsConfig);
    loadConfigModels.mockResolvedValue({ ollama: [] });

    await getModelsConfig({ user: { id: 'user-1', role: 'USER' } });
    resetStartupModelRefresh();
    await getModelsConfig({ user: { id: 'user-1', role: 'USER' } });

    expect(mockCache.get).toHaveBeenCalledTimes(2);
  });

  it('keeps the cached models config when Google and Ollama models are unchanged', async () => {
    const cachedModelsConfig = {
      anthropic: [],
      assistants: [],
      azureOpenAI: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      ollama: ['gptossbigctx:latest'],
    };

    mockCache.get.mockResolvedValue(cachedModelsConfig);
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    loadConfigModels.mockResolvedValue({ ollama: ['gptossbigctx:latest'] });

    const result = await loadModels(mockReq);

    expect(loadConfigModels).toHaveBeenCalledWith(mockReq, {
      endpointNames: ['ollama'],
      includeUserProvidedFetch: true,
    });
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
      anthropic: [],
      assistants: [],
      azureOpenAI: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      ollama: ['gptossbigctx:latest'],
    });
    expect(result).toEqual({
      anthropic: [],
      assistants: [],
      azureOpenAI: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      ollama: ['gptossbigctx:latest'],
    });
  });

  it('refreshes cached OpenAI discovery on startup even when a shared cache entry already exists', async () => {
    mockCache.get.mockResolvedValue({
      anthropic: [],
      google: ['gemini-2.5-flash'],
      openAI: ['gpt-4o'],
      assistants: ['gpt-4o'],
      azureOpenAI: [],
      ollama: ['gptossbigctx:latest'],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    getOpenAIModels.mockImplementation(({ azure, assistants, forceRefresh }) => {
      if (azure) {
        return Promise.resolve([]);
      }
      if (assistants) {
        return Promise.resolve(forceRefresh ? ['gpt-5-mini'] : ['gpt-4o']);
      }

      if (forceRefresh) {
        return Promise.resolve(['gpt-5-mini', 'gpt-5-nano']);
      }

      return Promise.resolve([]);
    });
    loadConfigModels.mockResolvedValue({ ollama: ['gptossbigctx:latest'] });

    const result = await loadModels(mockReq);

    expect(getOpenAIModels).toHaveBeenCalledWith(
      expect.objectContaining({ user: 'user-1', forceRefresh: true }),
    );
    expect(getOpenAIModels).toHaveBeenCalledWith(
      expect.objectContaining({ assistants: true, forceRefresh: true }),
    );
    expect(mockCache.set).toHaveBeenCalledWith(CacheKeys.MODELS_CONFIG, {
      anthropic: [],
      google: ['gemini-2.5-flash'],
      openAI: ['gpt-5-mini', 'gpt-5-nano'],
      assistants: ['gpt-5-mini'],
      azureOpenAI: [],
      ollama: ['gptossbigctx:latest'],
    });
    expect(result).toEqual({
      anthropic: [],
      google: ['gemini-2.5-flash'],
      openAI: ['gpt-5-mini', 'gpt-5-nano'],
      assistants: ['gpt-5-mini'],
      azureOpenAI: [],
      ollama: ['gptossbigctx:latest'],
    });
  });

  it('returns user-specific xAI discovery results without persisting them into the shared cache', async () => {
    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      azureOpenAI: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      xai: ['grok-4-0709'],
    });
    getAppConfig.mockResolvedValue({
      endpoints: {
        custom: [
          {
            name: 'xai',
            apiKey: 'user_provided',
            baseURL: 'https://api.x.ai/v1',
            customParams: { defaultParamsEndpoint: 'xai' },
          },
        ],
      },
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    loadConfigModels.mockResolvedValue({ xai: ['grok-4-1212'] });

    const result = await loadModels(mockReq);

    expect(loadConfigModels).toHaveBeenCalledWith(mockReq, {
      endpointNames: ['ollama', 'xai'],
      includeUserProvidedFetch: true,
    });
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(result).toEqual({
      anthropic: [],
      assistants: [],
      azureOpenAI: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      xai: ['grok-4-1212'],
    });
  });

  it('returns user-specific Azure discovery results without persisting them into the shared cache', async () => {
    process.env.AZURE_API_KEY = 'user_provided';
    process.env.AZURE_OPENAI_BASEURL = 'user_provided';

    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      azureOpenAI: ['shared-deployment'],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    getUserKey.mockImplementation(({ name }) =>
      name === 'azureOpenAI'
        ? Promise.resolve(
            JSON.stringify({
              apiKey: 'azure-user-key',
              baseURL: 'https://example.openai.azure.com',
              models: 'user-deployment',
            }),
          )
        : Promise.reject(new Error('missing user key')),
    );
    // resolveAzureOpenAIDirectConfig no longer normalises the URL – the bare
    // root is preserved so downstream helpers can distinguish explicit /openai/v1
    // from legacy shapes.
    resolveAzureOpenAIDirectConfig.mockReturnValue({
      apiKey: 'azure-user-key',
      baseURL: 'https://example.openai.azure.com',
      manualModels: ['user-deployment'],
      isLegacyCredentialPayload: false,
    });
    getOpenAIModels.mockImplementation(({ azure, userProvidedOpenAI, assistants }) => {
      if (assistants) {
        return Promise.resolve([]);
      }

      if (azure && userProvidedOpenAI) {
        return Promise.resolve(['shared-deployment']);
      }

      if (azure) {
        return Promise.resolve(['user-deployment']);
      }

      return Promise.resolve([]);
    });
    loadConfigModels.mockResolvedValue({});

    const result = await loadModels(mockReq);

    expect(getUserKey).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'azureOpenAI',
    });
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(result).toEqual({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      azureOpenAI: ['user-deployment'],
    });
  });

  it('uses a saved OpenAI user key for discovery when no shared OpenAI key is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_REVERSE_PROXY;

    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: ['gpt-5-mini'],
      azureOpenAI: [],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    getUserKeyValues.mockResolvedValue({
      apiKey: 'openai-user-key',
    });
    getOpenAIModels.mockImplementation(
      ({ azure, assistants, openAIApiKey, userProvidedOpenAI }) => {
        if (azure || assistants) {
          return Promise.resolve([]);
        }

        if (userProvidedOpenAI) {
          return Promise.resolve(['gpt-5-mini']);
        }

        if (openAIApiKey === 'openai-user-key') {
          return Promise.resolve(['gpt-5.6', 'kepler-alpha']);
        }

        return Promise.resolve([]);
      },
    );
    loadConfigModels.mockResolvedValue({});

    const result = await loadModels(mockReq);

    expect(getUserKeyValues).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'openAI',
    });
    expect(getOpenAIModels).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        openAIApiKey: 'openai-user-key',
        cacheKey: 'openAI:user-1:default',
        forceRefresh: true,
      }),
    );
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(result).toEqual({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: ['gpt-5.6', 'kepler-alpha'],
      azureOpenAI: [],
    });
  });

  it('prefers a saved OpenAI user key over a configured shared OpenAI key for discovery', async () => {
    process.env.OPENAI_API_KEY = 'shared-openai-key';

    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: ['gpt-5-mini'],
      azureOpenAI: [],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    getUserKeyValues.mockResolvedValue({
      apiKey: 'openai-user-key',
    });
    getOpenAIModels.mockImplementation(
      ({ azure, assistants, openAIApiKey, userProvidedOpenAI }) => {
        if (azure || assistants) {
          return Promise.resolve([]);
        }

        if (userProvidedOpenAI) {
          return Promise.resolve(['gpt-5-mini']);
        }

        if (openAIApiKey === 'openai-user-key') {
          return Promise.resolve(['gpt-5.6', 'kepler-alpha']);
        }

        return Promise.resolve(['shared-only-model']);
      },
    );
    loadConfigModels.mockResolvedValue({});

    const result = await loadModels(mockReq);

    expect(getOpenAIModels).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        openAIApiKey: 'openai-user-key',
        cacheKey: 'openAI:user-1:default',
        forceRefresh: true,
      }),
    );
    expect(mockCache.set).not.toHaveBeenCalled();
    expect(result.openAI).toEqual(['gpt-5.6', 'kepler-alpha']);
  });

  it('uses a plain saved OpenAI key for model discovery when JSON key values are unavailable', async () => {
    process.env.OPENAI_API_KEY = 'shared-openai-key';

    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: ['gpt-5-mini'],
      azureOpenAI: [],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    getUserKeyValues.mockRejectedValue(new Error('invalid json key'));
    getUserKey.mockResolvedValue('plain-openai-user-key');
    getOpenAIModels.mockImplementation(
      ({ azure, assistants, openAIApiKey, userProvidedOpenAI }) => {
        if (azure || assistants) {
          return Promise.resolve([]);
        }

        if (userProvidedOpenAI) {
          return Promise.resolve(['gpt-5-mini']);
        }

        if (openAIApiKey === 'plain-openai-user-key') {
          return Promise.resolve(['gpt-5.6-sol', 'mercury-alpha']);
        }

        return Promise.resolve(['shared-only-model']);
      },
    );
    loadConfigModels.mockResolvedValue({});

    const result = await loadModels(mockReq);

    expect(getUserKey).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'openAI',
    });
    expect(getOpenAIModels).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        openAIApiKey: 'plain-openai-user-key',
        cacheKey: 'openAI:user-1:default',
        forceRefresh: true,
      }),
    );
    expect(result.openAI).toEqual(['gpt-5.6-sol', 'mercury-alpha']);
  });

  it('prefers a saved Anthropic key over a configured shared key for discovery', async () => {
    process.env.ANTHROPIC_API_KEY = 'shared-anthropic-key';
    mockCache.get.mockResolvedValue({
      anthropic: ['claude-shared'],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      azureOpenAI: [],
    });
    getUserKey.mockImplementation(({ name }) =>
      name === 'anthropic'
        ? Promise.resolve('user-anthropic-key')
        : Promise.reject(new Error('missing user key')),
    );
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    getAnthropicModels.mockImplementation(({ anthropicApiKey, userProvidedAnthropic }) => {
      if (userProvidedAnthropic) {
        return Promise.resolve(['claude-shared']);
      }
      return Promise.resolve(
        anthropicApiKey === 'user-anthropic-key' ? ['claude-user-only'] : ['claude-shared'],
      );
    });
    loadConfigModels.mockResolvedValue({});

    const result = await loadModels(mockReq);

    expect(getAnthropicModels).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        anthropicApiKey: 'user-anthropic-key',
        cacheKey: 'anthropic:user-1:default',
        forceRefresh: true,
      }),
    );
    expect(result.anthropic).toEqual(['claude-user-only']);
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('prefers a saved Google API key over a configured shared key for discovery', async () => {
    process.env.GOOGLE_KEY = 'shared-google-key';
    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      google: ['gemini-shared'],
      openAI: [],
      azureOpenAI: [],
    });
    getUserKey.mockImplementation(({ name }) =>
      name === 'google'
        ? Promise.resolve(JSON.stringify({ GOOGLE_API_KEY: 'user-google-key' }))
        : Promise.reject(new Error('missing user key')),
    );
    getGoogleModels.mockImplementation(({ googleApiKey, userProvidedGoogle } = {}) => {
      if (userProvidedGoogle) {
        return Promise.resolve(['gemini-shared']);
      }
      return Promise.resolve(
        googleApiKey === 'user-google-key' ? ['gemini-user-only'] : ['gemini-shared'],
      );
    });
    loadConfigModels.mockResolvedValue({});

    const result = await loadModels(mockReq);

    expect(getGoogleModels).toHaveBeenCalledWith(
      expect.objectContaining({
        googleApiKey: 'user-google-key',
        cacheKey: 'google:user-1:capabilities',
        forceRefresh: true,
      }),
    );
    expect(result.google).toEqual(['gemini-user-only']);
    expect(mockCache.set).not.toHaveBeenCalled();
  });

  it('refreshes the shared cache when direct Azure models change', async () => {
    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      azureOpenAI: ['old-deployment'],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    resolveAzureOpenAIDirectConfig.mockReturnValue({
      apiKey: 'azure-key',
      baseURL: 'https://example.openai.azure.com',
      manualModels: [],
      isLegacyCredentialPayload: false,
    });
    getOpenAIModels.mockImplementation(({ azure, assistants }) => {
      if (assistants) {
        return Promise.resolve([]);
      }

      if (azure) {
        return Promise.resolve(['new-deployment']);
      }

      return Promise.resolve([]);
    });
    loadConfigModels.mockResolvedValue({});

    const result = await loadModels(mockReq);

    expect(mockCache.set).toHaveBeenCalledWith(CacheKeys.MODELS_CONFIG, {
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      azureOpenAI: ['new-deployment'],
    });
    expect(result).toEqual({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      azureOpenAI: ['new-deployment'],
    });
  });

  it('passes azureApiVersion through to getOpenAIModels for legacy Azure credential payloads', async () => {
    process.env.AZURE_API_KEY = 'user_provided';
    process.env.AZURE_OPENAI_BASEURL = 'user_provided';

    mockCache.get.mockResolvedValue({
      anthropic: [],
      assistants: [],
      google: ['gemini-2.5-flash'],
      openAI: [],
      azureOpenAI: [],
    });
    getGoogleModels.mockResolvedValue(['gemini-2.5-flash']);
    getUserKey.mockImplementation(({ name }) =>
      name === 'azureOpenAI'
        ? Promise.resolve(
            JSON.stringify({
              apiKey: JSON.stringify({
                azureOpenAIApiKey: 'azure-key',
                azureOpenAIApiInstanceName: 'example.models.ai.azure.com',
                azureOpenAIApiDeploymentName: 'gpt-4-dep',
                azureOpenAIApiVersion: '2024-10-21',
              }),
              baseURL: 'https://example.models.ai.azure.com/v1',
              models: 'gpt-4-dep',
            }),
          )
        : Promise.reject(new Error('missing user key')),
    );
    resolveAzureOpenAIDirectConfig.mockReturnValue({
      apiKey: 'azure-key',
      baseURL: 'https://example.models.ai.azure.com/v1',
      manualModels: ['gpt-4-dep'],
      azureOptions: {
        azureOpenAIApiKey: 'azure-key',
        azureOpenAIApiInstanceName: 'example.models.ai.azure.com',
        azureOpenAIApiDeploymentName: 'gpt-4-dep',
        azureOpenAIApiVersion: '2024-10-21',
      },
      isLegacyCredentialPayload: true,
    });
    getOpenAIModels.mockImplementation(({ azure, assistants }) => {
      if (assistants) {
        return Promise.resolve([]);
      }
      if (azure) {
        return Promise.resolve(['gpt-4-dep']);
      }
      return Promise.resolve([]);
    });
    loadConfigModels.mockResolvedValue({});

    await loadModels(mockReq);

    expect(getOpenAIModels).toHaveBeenCalledWith(
      expect.objectContaining({
        azure: true,
        azureApiVersion: '2024-10-21',
        baseURL: 'https://example.models.ai.azure.com/v1',
      }),
    );
  });
});
