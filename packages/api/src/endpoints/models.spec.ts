import axios from 'axios';
import { EModelEndpoint, defaultModels } from 'librechat-data-provider';
import type { AppConfig } from '@librechat/data-schemas';
import {
  fetchModels,
  resolveOllamaBaseURL,
  splitAndTrim,
  filterOpenAITextCompatibleModels,
  getOpenAIModels,
  getGoogleModels,
  getGoogleModelCapabilities,
  getXAIModelCapabilities,
  getBedrockModels,
  getAnthropicModels,
  resolveModelsListMode,
  unionWithLiveDiscovery,
  getOpenAIModelVersionScore,
  sortOpenAIModelsByVersion,
  getAnthropicModelVersionScore,
  sortAnthropicModelsByVersion,
  getGoogleModelVersionScore,
  sortGoogleModelsByVersion,
} from './models';

jest.mock('axios');

jest.mock('~/cache', () => ({
  standardCache: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('~/utils', () => {
  const originalUtils = jest.requireActual('~/utils');
  return {
    ...originalUtils,
    processModelData: jest.fn((...args) => originalUtils.processModelData(...args)),
    logAxiosError: jest.fn(),
    resolveHeaders: jest.fn((options) => options?.headers || {}),
  };
});

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const { standardCache } = jest.requireMock('~/cache');
const { logAxiosError, resolveHeaders } = jest.requireMock('~/utils');
const mockCacheData = new Map<string, unknown>();

beforeEach(() => {
  mockCacheData.clear();
  standardCache.mockImplementation(() => ({
    get: jest.fn().mockImplementation(async (key: string) => mockCacheData.get(key)),
    set: jest.fn().mockImplementation(async (key: string, value: unknown) => {
      mockCacheData.set(key, value);
      return true;
    }),
  }));
});

mockedAxios.get.mockResolvedValue({
  data: {
    data: [{ id: 'model-1' }, { id: 'model-2' }],
  },
});

describe('fetchModels', () => {
  it('fetches models successfully from the API', async () => {
    const models = await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com',
      name: 'TestAPI',
    });

    expect(models).toEqual(['model-1', 'model-2']);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('https://api.test.com/models'),
      expect.any(Object),
    );
  });

  it('adds the user ID to the models query when option and ID are passed', async () => {
    const models = await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com',
      userIdQuery: true,
      name: 'TestAPI',
    });

    expect(models).toEqual(['model-1', 'model-2']);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('https://api.test.com/models?user=user123'),
      expect.any(Object),
    );
  });

  it('should pass custom headers to the API request', async () => {
    const customHeaders = {
      'X-Custom-Header': 'custom-value',
      'X-API-Version': 'v2',
    };

    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com',
      name: 'TestAPI',
      headers: customHeaders,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('https://api.test.com/models'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Custom-Header': 'custom-value',
          'X-API-Version': 'v2',
          Authorization: 'Bearer testApiKey',
        }),
      }),
    );
  });

  it('should handle null headers gracefully', async () => {
    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com',
      name: 'TestAPI',
      headers: null,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('https://api.test.com/models'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer testApiKey',
        }),
      }),
    );
  });

  it('should handle undefined headers gracefully', async () => {
    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com',
      name: 'TestAPI',
      headers: undefined,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.stringContaining('https://api.test.com/models'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer testApiKey',
        }),
      }),
    );
  });

  it('probes /openai/v1/models without api-version for an explicit /openai/v1 Azure URL', async () => {
    await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com/openai/v1',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://example-resource.openai.azure.com/openai/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'api-key': 'azure-key',
        }),
      }),
    );
  });

  it('logs Azure model-discovery failures as warnings because manual deployments can still be used', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Request failed with status code 404'));

    const models = await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com/openai/v1',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
    });

    expect(models).toEqual([]);
    expect(logAxiosError).toHaveBeenCalledWith({
      message: 'Failed to fetch models from Azure azureOpenAI API',
      error: expect.any(Error),
      level: 'warn',
    });
  });

  it('returns empty models for a bare Azure resource root without azureApiVersion', async () => {
    const models = await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
    });

    expect(models).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('probes /models?api-version for a bare Azure resource root when azureApiVersion is provided', async () => {
    await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
      azureApiVersion: '2024-10-21',
    });

    const calledURL = mockedAxios.get.mock.calls[0][0] as string;
    expect(calledURL).toBe(
      'https://example-resource.openai.azure.com/models?api-version=2024-10-21',
    );
    expect(mockedAxios.get).toHaveBeenCalledWith(
      calledURL,
      expect.objectContaining({
        headers: expect.objectContaining({ 'api-key': 'azure-key' }),
      }),
    );
  });

  it('normalizes Azure AI Foundry project endpoints to /openai/v1/models without api-version', async () => {
    await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example-resource.services.ai.azure.com/api/projects/demo-project',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
    });

    // AI Foundry project paths are recognised as direct v1 and normalised at
    // request time, so the probe uses /openai/v1/models without api-version.
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://example-resource.services.ai.azure.com/api/projects/demo-project/openai/v1/models',
      expect.any(Object),
    );
  });

  it('appends api-version to legacy Azure inference model probes', async () => {
    await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example.models.ai.azure.com/v1',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
      azureApiVersion: '2024-10-21',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://example.models.ai.azure.com/v1/models?api-version=2024-10-21',
      expect.objectContaining({
        headers: expect.objectContaining({
          'api-key': 'azure-key',
        }),
      }),
    );
  });

  it('omits api-version from direct /openai/v1 Azure model probes', async () => {
    await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com/openai/v1',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
      azureApiVersion: '2024-10-21',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://example-resource.openai.azure.com/openai/v1/models',
      expect.any(Object),
    );
    // Verify api-version is NOT in the URL
    const calledURL = mockedAxios.get.mock.calls[0][0] as string;
    expect(calledURL).not.toContain('api-version');
  });

  it('probes /openai/deployments/{name}/models?api-version for legacy Azure deployment URLs', async () => {
    await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com/openai/deployments/gpt-4',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
      azureApiVersion: '2024-10-21',
    });

    const calledURL = mockedAxios.get.mock.calls[0][0] as string;
    expect(calledURL).toBe(
      'https://example-resource.openai.azure.com/openai/deployments/gpt-4/models?api-version=2024-10-21',
    );
  });

  it('returns empty models for legacy Azure inference endpoints when no api-version is provided', async () => {
    const models = await fetchModels({
      apiKey: 'azure-key',
      baseURL: 'https://example.models.ai.azure.com/v1',
      azure: true,
      name: EModelEndpoint.azureOpenAI,
    });

    expect(models).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });
});

describe('xAI model discovery', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('falls back to xAI /models when /language-models returns 403 and filters non-chat families', async () => {
    mockedAxios.get.mockImplementationOnce(async () => {
      const error: Error & { response?: { status: number } } = new Error(
        'Request failed with status code 403',
      );
      error.response = { status: 403 };
      throw error;
    });

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'grok-4-0709' },
          { id: 'grok-3-mini' },
          { id: 'grok-2-image-1212' },
          { id: 'grok-code-fast-1' },
        ],
      },
    });

    const models = await fetchModels({
      apiKey: 'xai-key',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai:403-fallback',
    });

    expect(models).toEqual(
      expect.arrayContaining(['grok-4-0709', 'grok-3-mini', 'grok-code-fast-1']),
    );
    expect(models).not.toContain('grok-2-image-1212');
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.x.ai/v1/language-models',
      expect.any(Object),
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.x.ai/v1/models',
      expect.any(Object),
    );
    expect(logAxiosError).toHaveBeenCalledWith({
      message: 'Failed to fetch language-models from xAI API; falling back to /models discovery',
      error: expect.any(Error),
      level: 'warn',
    });
  });

  it('logs xAI /models fallback failures as warnings when discovery remains unavailable', async () => {
    mockedAxios.get.mockImplementation(async () => {
      const error: Error & { response?: { status: number } } = new Error(
        'Request failed with status code 403',
      );
      error.response = { status: 403 };
      throw error;
    });

    const models = await fetchModels({
      apiKey: 'xai-key',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai:403-both-fail',
    });

    expect(models).toEqual([]);
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://api.x.ai/v1/language-models',
      expect.any(Object),
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://api.x.ai/v1/models',
      expect.any(Object),
    );
    expect(logAxiosError).toHaveBeenCalledWith({
      message: 'Failed to fetch language-models from xAI API; falling back to /models discovery',
      error: expect.any(Error),
      level: 'warn',
    });
    expect(logAxiosError).toHaveBeenCalledWith({
      message: 'Failed to fetch models from xAI /models fallback',
      error: expect.any(Error),
      level: 'warn',
    });
  });

  it('fetches xAI language models from /language-models and preserves aliases', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            id: 'grok-4.20-beta-0309-non-reasoning',
            aliases: ['grok-4.20-beta-latest-non-reasoning'],
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
          {
            id: 'grok-imagine-1',
            input_modalities: ['text'],
            output_modalities: ['image'],
          },
        ],
      },
    });

    const models = await fetchModels({
      apiKey: 'xai-key',
      baseURL: 'https://api.x.ai/v1',
      name: 'Grok',
      tokenKey: 'Grok',
    });

    expect(models).toEqual([
      'grok-4.20-beta-0309-non-reasoning',
      'grok-4.20-beta-latest-non-reasoning',
    ]);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.x.ai/v1/language-models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer xai-key' }),
      }),
    );
  });

  it('returns per-endpoint xAI capability maps from app config', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            id: 'grok-4-0709',
            aliases: ['grok-4'],
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        ],
      },
    });

    const capabilities = await getXAIModelCapabilities({
      appConfig: {
        endpoints: {
          [EModelEndpoint.custom]: [
            {
              name: 'Grok',
              apiKey: 'xai-key',
              baseURL: 'https://api.x.ai/v1',
              customParams: {
                defaultParamsEndpoint: 'xai',
              },
            },
          ],
        },
      } as AppConfig,
    });

    expect(capabilities).toEqual({
      Grok: {
        'grok-4-0709': {
          id: 'grok-4-0709',
          aliases: ['grok-4'],
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
        },
        'grok-4': {
          id: 'grok-4-0709',
          aliases: ['grok-4'],
          input_modalities: ['text', 'image'],
          output_modalities: ['text'],
        },
      },
    });
  });

  it('scopes xAI capability cache per user so different users do not share discovery results', async () => {
    // User A discovers models with their API key
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            id: 'grok-4-0709',
            aliases: ['grok-4'],
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        ],
      },
    });

    const userAModels = await fetchModels({
      user: 'user-A',
      apiKey: 'xai-key-A',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai',
    });

    expect(userAModels).toEqual(['grok-4-0709', 'grok-4']);

    // User B discovers models with their different API key
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            id: 'grok-3-mini',
            input_modalities: ['text'],
            output_modalities: ['text'],
          },
        ],
      },
    });

    const userBModels = await fetchModels({
      user: 'user-B',
      apiKey: 'xai-key-B',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai',
    });

    // User B should get their own discovery results, NOT user A's cached results
    expect(userBModels).toEqual(['grok-3-mini']);
    // Both users triggered actual API calls (no cross-user cache hit)
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('shares xAI capability cache when no userId is provided (server-level credentials)', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            id: 'grok-4-0709',
            aliases: ['grok-4'],
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        ],
      },
    });

    // First call without user (server-level)
    const firstCallModels = await fetchModels({
      apiKey: 'server-xai-key',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai',
    });

    expect(firstCallModels).toEqual(['grok-4-0709', 'grok-4']);

    // Second call without user should hit cache (no new API call)
    const secondCallModels = await fetchModels({
      apiKey: 'server-xai-key',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai',
    });

    expect(secondCallModels).toEqual(['grok-4-0709', 'grok-4']);
    // Only one API call - second was served from cache
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('does not let server-level cache contaminate user-specific discovery', async () => {
    // Server-level discovery (no userId) caches results
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            id: 'grok-4-0709',
            aliases: ['grok-4'],
            input_modalities: ['text', 'image'],
            output_modalities: ['text'],
          },
        ],
      },
    });

    const serverModels = await fetchModels({
      apiKey: 'server-xai-key',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai',
    });

    expect(serverModels).toEqual(['grok-4-0709', 'grok-4']);

    // User-specific discovery with different API key should NOT use server cache
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            id: 'grok-3-mini',
            input_modalities: ['text'],
            output_modalities: ['text'],
          },
        ],
      },
    });

    const userModels = await fetchModels({
      user: 'user-1',
      apiKey: 'user-xai-key',
      baseURL: 'https://api.x.ai/v1',
      name: 'xai',
      tokenKey: 'xai',
    });

    // User gets their own results, not the server-cached results
    expect(userModels).toEqual(['grok-3-mini']);
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });
});

describe('fetchModels with createTokenConfig true', () => {
  const data = {
    data: [
      {
        id: 'model-1',
        pricing: {
          prompt: '0.002',
          completion: '0.001',
        },
        context_length: 1024,
      },
      {
        id: 'model-2',
        pricing: {
          prompt: '0.003',
          completion: '0.0015',
        },
        context_length: 2048,
      },
    ],
  };

  beforeEach(() => {
    mockedAxios.get.mockResolvedValue({ data });
  });

  it('creates and stores token configuration if createTokenConfig is true', async () => {
    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com',
      createTokenConfig: true,
    });

    const { processModelData } = jest.requireMock('~/utils');
    expect(processModelData).toHaveBeenCalled();
    expect(processModelData).toHaveBeenCalledWith(data);
  });
});

describe('getOpenAIModels', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    mockedAxios.get.mockRejectedValue(new Error('Network error'));
  });

  afterEach(() => {
    process.env = originalEnv;
    mockedAxios.get.mockReset();
  });

  it('returns default models when no environment configurations are provided (and fetch fails)', async () => {
    const models = await getOpenAIModels({ user: 'user456' });
    expect(models).toContain('gpt-4');
  });

  it('returns `AZURE_OPENAI_MODELS` with `azure` flag (and fetch fails)', async () => {
    process.env.AZURE_OPENAI_MODELS = 'azure-model,azure-model-2';
    const models = await getOpenAIModels({ azure: true });
    expect(models).toEqual(expect.arrayContaining(['azure-model', 'azure-model-2']));
  });

  it('fetches Azure models from an explicit /openai/v1 endpoint when credentials are provided', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [{ id: 'gpt-4.1-prod' }, { id: 'gpt-4o-mini' }],
      },
    });

    const models = await getOpenAIModels({
      azure: true,
      openAIApiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com/openai/v1',
    });

    expect(models).toEqual(['gpt-4.1-prod', 'gpt-4o-mini']);
  });

  it('returns manual Azure deployment names when model discovery is unavailable', async () => {
    const models = await getOpenAIModels({
      azure: true,
      openAIApiKey: 'azure-key',
      baseURL: 'https://example-resource.models.ai.azure.com/v1',
      manualModels: ['deployment-a', 'deployment-b'],
    });

    expect(models).toEqual(['deployment-a', 'deployment-b']);
  });

  it('fetches models from legacy Azure inference endpoints when azureApiVersion is provided', async () => {
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [{ id: 'gpt-4.1-turbo' }, { id: 'gpt-4o' }],
      },
    });

    const models = await getOpenAIModels({
      azure: true,
      openAIApiKey: 'azure-key',
      baseURL: 'https://example-resource.models.ai.azure.com/v1',
      azureApiVersion: '2024-10-21',
    });

    expect(models).toEqual(['gpt-4.1-turbo', 'gpt-4o']);
    const calledURL = mockedAxios.get.mock.calls[0][0] as string;
    expect(calledURL).toContain('api-version=2024-10-21');
  });

  it('returns `OPENAI_MODELS` with no flags (and fetch fails)', async () => {
    process.env.OPENAI_MODELS = 'openai-model,openai-model-2';
    const models = await getOpenAIModels({});
    expect(models).toEqual(expect.arrayContaining(['openai-model', 'openai-model-2']));
  });

  it('returns all OpenAI-discovered models while keeping newly discovered GPT-5 variants first', async () => {
    process.env.OPENAI_API_KEY = 'mockedApiKey';
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'gpt-5-mini' },
          { id: 'gpt-5-nano' },
          { id: 'gpt-image-1' },
          { id: 'gpt-4o-realtime-preview' },
        ],
      },
    });

    const models = await getOpenAIModels({ user: 'user456', forceRefresh: true });

    expect(models).toEqual(['gpt-5-mini', 'gpt-5-nano', 'gpt-4o-realtime-preview', 'gpt-image-1']);
  });

  it('bypasses cached OpenAI discovery when forceRefresh is enabled', async () => {
    process.env.OPENAI_API_KEY = 'mockedApiKey';
    mockCacheData.set('https://api.openai.com/v1', ['stale-model']);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [{ id: 'gpt-5-mini' }, { id: 'gpt-5-nano' }],
      },
    });

    const models = await getOpenAIModels({ user: 'user456', forceRefresh: true });

    expect(models).toEqual(['gpt-5-mini', 'gpt-5-nano']);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('does not call OpenAI discovery with the user_provided sentinel when no user key is supplied', async () => {
    process.env.OPENAI_API_KEY = 'user_provided';

    const models = await getOpenAIModels({ user: 'user456', forceRefresh: true });

    expect(models).toEqual(defaultModels[EModelEndpoint.openAI]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('utilizes proxy configuration when PROXY is set', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: [],
      },
    });
    process.env.PROXY = 'http://localhost:8888';
    process.env.OPENAI_API_KEY = 'mockedApiKey';
    await getOpenAIModels({ user: 'user456' });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        httpsAgent: expect.anything(),
      }),
    );
  });
});

describe('filterOpenAITextCompatibleModels', () => {
  it('keeps chat-capable OpenAI models and drops non-chat catalogs', () => {
    expect(
      filterOpenAITextCompatibleModels([
        'gpt-5-mini',
        'gpt-5-nano',
        'gpt-image-1',
        'gpt-4o-realtime-preview',
        'text-embedding-3-small',
      ]),
    ).toEqual(['gpt-5-mini', 'gpt-5-nano']);
  });
});

describe('getOpenAIModels sorting behavior', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'mockedApiKey';
    mockedAxios.get.mockResolvedValue({
      data: {
        data: [
          { id: 'gpt-3.5-turbo-instruct-0914' },
          { id: 'gpt-3.5-turbo-instruct' },
          { id: 'gpt-3.5-turbo' },
          { id: 'gpt-4-0314' },
          { id: 'gpt-4-turbo-preview' },
        ],
      },
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('puts higher-version models first and sinks instruct to the bottom', async () => {
    const models = await getOpenAIModels({ user: 'user456' });

    // Highest score first (gpt-4 > gpt-3.5), instruct always last regardless
    // of its score.
    const expectedOrder = [
      'gpt-4-0314',
      'gpt-4-turbo-preview',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-instruct-0914',
      'gpt-3.5-turbo-instruct',
    ];
    expect(models).toEqual(expectedOrder);

    expect(models[models.length - 1]).toMatch(/instruct/);
  });
});

describe('fetchModels with Ollama specific logic', () => {
  const mockOllamaData = {
    data: {
      models: [{ name: 'Ollama-Base' }, { name: 'Ollama-Advanced' }],
    },
  };

  beforeEach(() => {
    mockedAxios.get.mockResolvedValue(mockOllamaData);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should fetch Ollama models when name starts with "ollama"', async () => {
    const models = await fetchModels({
      user: 'user789',
      apiKey: 'testApiKey',
      baseURL: 'https://api.ollama.test.com',
      name: 'OllamaAPI',
    });

    expect(models).toEqual(['Ollama-Base', 'Ollama-Advanced']);
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.ollama.test.com/api/tags', {
      headers: {},
      timeout: 5000,
    });
  });

  it('should pass headers and user object to Ollama fetchModels', async () => {
    const customHeaders = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer custom-token',
    };
    const userObject = {
      id: 'user789',
      email: 'test@example.com',
    };

    (resolveHeaders as jest.Mock).mockReturnValueOnce(customHeaders);

    const models = await fetchModels({
      user: 'user789',
      apiKey: 'testApiKey',
      baseURL: 'https://api.ollama.test.com',
      name: 'ollama',
      headers: customHeaders,
      userObject,
    });

    expect(models).toEqual(['Ollama-Base', 'Ollama-Advanced']);
    expect(resolveHeaders).toHaveBeenCalledWith({
      headers: customHeaders,
      user: userObject,
    });
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.ollama.test.com/api/tags', {
      headers: customHeaders,
      timeout: 5000,
    });
  });

  it('should fallback to router /models when Ollama /api/tags is unavailable', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Ollama API error'));
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [{ id: 'default' }, { id: 'fallback-model-1' }, { id: 'fallback-model-2' }],
      },
    });

    const models = await fetchModels({
      user: 'user789',
      apiKey: 'testApiKey',
      baseURL: 'https://api.ollama.test.com/v1/',
      name: 'OllamaAPI',
    });

    expect(models).toEqual(['fallback-model-1', 'fallback-model-2']);
    expect(mockedAxios.get).toHaveBeenNthCalledWith(1, 'https://api.ollama.test.com/api/tags', {
      headers: {},
      timeout: 5000,
    });
    expect(mockedAxios.get).toHaveBeenNthCalledWith(2, 'https://api.ollama.test.com/models', {
      headers: {},
      timeout: 5000,
    });
    expect(logAxiosError).not.toHaveBeenCalled();
  });

  it('should merge models discovered across multiple Ollama base URLs', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          models: [{ name: 'remote-model-1' }, { name: 'shared-model' }],
        },
      })
      .mockRejectedValueOnce(new Error('Router has no /api/tags'))
      .mockResolvedValueOnce({
        data: {
          data: [{ id: 'local-model-1' }, { id: 'shared-model' }, { id: 'default' }],
        },
      });

    const models = await fetchModels({
      user: 'user789',
      apiKey: 'testApiKey',
      baseURL: 'https://remote.ollama.test/v1/',
      baseURLs: ['https://local-router.test/v1/'],
      name: 'ollama',
      disableOllamaFallback: true,
      tokenKey: 'ollama',
    });

    expect(models).toEqual(['remote-model-1', 'shared-model', 'local-model-1']);
    expect(
      await resolveOllamaBaseURL({
        baseURL: 'https://remote.ollama.test/v1/',
        baseURLs: ['https://local-router.test/v1/'],
        model: 'local-model-1',
        tokenKey: 'ollama',
      }),
    ).toBe('https://local-router.test/v1/');
    expect(
      await resolveOllamaBaseURL({
        baseURL: 'https://remote.ollama.test/v1/',
        baseURLs: ['https://local-router.test/v1/'],
        model: 'shared-model',
        tokenKey: 'ollama',
      }),
    ).toBe('https://remote.ollama.test/v1/');
  });

  it('should skip the OpenAI-compatible fallback when strict Ollama detection is enabled', async () => {
    mockedAxios.get.mockRejectedValueOnce(new Error('Ollama API error'));
    mockedAxios.get.mockRejectedValueOnce(new Error('Router models unavailable'));

    const models = await fetchModels({
      user: 'user789',
      apiKey: 'testApiKey',
      baseURL: 'https://api.ollama.test.com',
      name: 'ollama',
      disableOllamaFallback: true,
    });

    expect(models).toEqual([]);
    expect(logAxiosError).toHaveBeenCalledWith({
      message: 'Failed to fetch models from Ollama API while strict Ollama detection is enabled.',
      error: expect.any(Error),
    });
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
  });

  it('should return an empty array if no baseURL is provided', async () => {
    const models = await fetchModels({
      user: 'user789',
      apiKey: 'testApiKey',
      name: 'OllamaAPI',
    });
    expect(models).toEqual([]);
  });

  it('should not fetch Ollama models if the name does not start with "ollama"', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: [{ id: 'model-1' }, { id: 'model-2' }],
      },
    });

    const models = await fetchModels({
      user: 'user789',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com',
      name: 'TestAPI',
    });

    expect(models).toEqual(['model-1', 'model-2']);
    expect(mockedAxios.get).toHaveBeenCalledWith('https://api.test.com/models', expect.any(Object));
  });
});

describe('fetchModels URL construction with trailing slashes', () => {
  beforeEach(() => {
    mockedAxios.get.mockResolvedValue({
      data: {
        data: [{ id: 'model-1' }, { id: 'model-2' }],
      },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should not create double slashes when baseURL has a trailing slash', async () => {
    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com/v1/',
      name: 'TestAPI',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.test.com/v1/models',
      expect.any(Object),
    );
  });

  it('should handle baseURL without trailing slash normally', async () => {
    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com/v1',
      name: 'TestAPI',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.test.com/v1/models',
      expect.any(Object),
    );
  });

  it('should handle baseURL with multiple trailing slashes', async () => {
    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com/v1///',
      name: 'TestAPI',
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.test.com/v1/models',
      expect.any(Object),
    );
  });

  it('should correctly append query params after stripping trailing slashes', async () => {
    await fetchModels({
      user: 'user123',
      apiKey: 'testApiKey',
      baseURL: 'https://api.test.com/v1/',
      name: 'TestAPI',
      userIdQuery: true,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.test.com/v1/models?user=user123',
      expect.any(Object),
    );
  });
});

describe('splitAndTrim', () => {
  it('should split a string by commas and trim each value', () => {
    const input = ' model1, model2 , model3,model4 ';
    const expected = ['model1', 'model2', 'model3', 'model4'];
    expect(splitAndTrim(input)).toEqual(expected);
  });

  it('should return an empty array for empty input', () => {
    expect(splitAndTrim('')).toEqual([]);
  });

  it('should return an empty array for null input', () => {
    expect(splitAndTrim(null)).toEqual([]);
  });

  it('should return an empty array for undefined input', () => {
    expect(splitAndTrim(undefined)).toEqual([]);
  });

  it('should filter out empty values after trimming', () => {
    const input = 'model1,,  ,model2,';
    const expected = ['model1', 'model2'];
    expect(splitAndTrim(input)).toEqual(expected);
  });
});

describe('getAnthropicModels', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('returns default models when ANTHROPIC_MODELS is not set', async () => {
    delete process.env.ANTHROPIC_MODELS;
    const models = await getAnthropicModels();
    expect(models).toEqual(defaultModels[EModelEndpoint.anthropic]);
  });

  it('returns models from ANTHROPIC_MODELS when set', async () => {
    process.env.ANTHROPIC_MODELS = 'claude-1, claude-2 ';
    const models = await getAnthropicModels();
    expect(models).toEqual(['claude-1', 'claude-2']);
  });

  it('should use Anthropic-specific headers when fetching models', async () => {
    delete process.env.ANTHROPIC_MODELS;
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

    mockedAxios.get.mockResolvedValue({
      data: {
        data: [{ id: 'claude-3' }, { id: 'claude-4' }],
      },
    });

    await fetchModels({
      user: 'user123',
      apiKey: 'test-anthropic-key',
      baseURL: 'https://api.anthropic.com/v1',
      name: EModelEndpoint.anthropic,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'x-api-key': 'test-anthropic-key',
          'anthropic-version': expect.any(String),
        },
      }),
    );
  });

  it('should pass custom headers for Anthropic endpoint', async () => {
    const customHeaders = {
      'X-Custom-Header': 'custom-value',
    };

    mockedAxios.get.mockResolvedValue({
      data: {
        data: [{ id: 'claude-3' }],
      },
    });

    await fetchModels({
      user: 'user123',
      apiKey: 'test-anthropic-key',
      baseURL: 'https://api.anthropic.com/v1',
      name: EModelEndpoint.anthropic,
      headers: customHeaders,
    });

    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'x-api-key': 'test-anthropic-key',
          'anthropic-version': expect.any(String),
        },
      }),
    );
  });

  it('uses a supplied Anthropic user key for live discovery instead of the user_provided sentinel', async () => {
    delete process.env.ANTHROPIC_MODELS;
    process.env.ANTHROPIC_API_KEY = 'user_provided';
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [{ id: 'claude-opus-4-7' }, { id: 'claude-sonnet-4-6' }],
      },
    });

    const models = await getAnthropicModels({
      user: 'user123',
      anthropicApiKey: 'sk-ant-user-key',
      cacheKey: 'anthropic:user123',
      forceRefresh: true,
      userProvidedAnthropic: false,
    });

    expect(models).toEqual(['claude-opus-4-7', 'claude-sonnet-4-6']);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-user-key',
        }),
      }),
    );
  });

  it('bypasses cached Anthropic discovery when forceRefresh is enabled', async () => {
    delete process.env.ANTHROPIC_MODELS;
    process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
    mockCacheData.set('https://api.anthropic.com/v1', ['claude-sonnet-4-5']);
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [{ id: 'claude-opus-4-7' }],
      },
    });

    const models = await getAnthropicModels({ user: 'user123', forceRefresh: true });

    expect(models).toEqual(['claude-opus-4-7']);
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });
});

describe('getGoogleModels', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
    mockedAxios.get.mockResolvedValue({
      data: {
        data: [{ id: 'model-1' }, { id: 'model-2' }],
      },
    });
  });

  it('returns default models when GOOGLE_MODELS and GOOGLE_KEY are not set', async () => {
    delete process.env.GOOGLE_MODELS;
    delete process.env.GOOGLE_KEY;

    const models = await getGoogleModels();

    expect(models).toEqual(defaultModels[EModelEndpoint.google]);
  });

  it('returns models from GOOGLE_MODELS when set', async () => {
    process.env.GOOGLE_MODELS = 'gemini-pro, bard ';

    const models = await getGoogleModels();

    expect(models).toEqual(['gemini-pro', 'bard']);
  });

  it('fetches and filters text-compatible Google models when GOOGLE_KEY is configured', async () => {
    delete process.env.GOOGLE_MODELS;
    process.env.GOOGLE_KEY = 'test-google-key';

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            name: 'models/gemini-2.5-flash',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
            thinking: true,
          },
          {
            name: 'models/gemma-3-27b-it',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/gemini-3-pro-image-preview',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/gemini-2.5-flash-preview-tts',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/gemini-embedding-001',
            supportedGenerationMethods: ['embedContent', 'countTokens'],
          },
        ],
      },
    });

    const models = await getGoogleModels();

    expect(models).toEqual(['gemini-2.5-flash', 'gemma-3-27b-it']);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models?key=test-google-key',
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('returns normalized Google model capabilities for text-compatible models', async () => {
    delete process.env.GOOGLE_MODELS;
    process.env.GOOGLE_KEY = 'test-google-key';

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            name: 'models/gemini-3.1-pro-preview',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
            thinking: true,
            outputTokenLimit: 65536,
          },
          {
            name: 'models/gemini-3-pro-image-preview',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
        ],
      },
    });

    const capabilities = await getGoogleModelCapabilities();

    expect(capabilities).toEqual({
      'gemini-3.1-pro-preview': {
        name: 'gemini-3.1-pro-preview',
        supportedGenerationMethods: ['generateContent', 'countTokens'],
        thinking: true,
        outputTokenLimit: 65536,
      },
    });
  });
});

describe('getBedrockModels', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns default models when BEDROCK_AWS_MODELS is not set', () => {
    delete process.env.BEDROCK_AWS_MODELS;
    const models = getBedrockModels();
    expect(models).toEqual(defaultModels[EModelEndpoint.bedrock]);
  });

  it('returns models from BEDROCK_AWS_MODELS when set', () => {
    process.env.BEDROCK_AWS_MODELS = 'anthropic.claude-v2, ai21.j2-ultra ';
    const models = getBedrockModels();
    expect(models).toEqual(['anthropic.claude-v2', 'ai21.j2-ultra']);
  });
});

describe('resolveModelsListMode', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to override when no env knob is set', () => {
    delete process.env.OPENAI_MODELS_MODE;
    expect(resolveModelsListMode('OPENAI_MODELS')).toBe('override');
  });

  it('returns merge when *_MODE is "merge" (case-insensitive, whitespace-tolerant)', () => {
    process.env.OPENAI_MODELS_MODE = ' Merge ';
    expect(resolveModelsListMode('OPENAI_MODELS')).toBe('merge');
  });

  it('treats unknown values as override', () => {
    process.env.OPENAI_MODELS_MODE = 'replace';
    expect(resolveModelsListMode('OPENAI_MODELS')).toBe('override');
  });

  it('isolates per-provider knobs (ANTHROPIC vs OPENAI vs GOOGLE)', () => {
    process.env.ANTHROPIC_MODELS_MODE = 'merge';
    delete process.env.OPENAI_MODELS_MODE;
    delete process.env.GOOGLE_MODELS_MODE;
    expect(resolveModelsListMode('ANTHROPIC_MODELS')).toBe('merge');
    expect(resolveModelsListMode('OPENAI_MODELS')).toBe('override');
    expect(resolveModelsListMode('GOOGLE_MODELS')).toBe('override');
  });
});

describe('unionWithLiveDiscovery', () => {
  it('preserves env order at the front and appends new live additions', async () => {
    const merged = await unionWithLiveDiscovery({
      envModels: ['gpt-4o', 'gpt-5'],
      liveFetcher: async () => ['gpt-5-mini', 'gpt-5.5', 'gpt-5.5-pro'],
    });
    expect(merged).toEqual(['gpt-4o', 'gpt-5', 'gpt-5-mini', 'gpt-5.5', 'gpt-5.5-pro']);
  });

  it('deduplicates exact matches while preserving first-seen order', async () => {
    const merged = await unionWithLiveDiscovery({
      envModels: ['gpt-4o', 'gpt-5'],
      liveFetcher: async () => ['gpt-5', 'gpt-5-mini', 'gpt-4o'],
    });
    expect(merged).toEqual(['gpt-4o', 'gpt-5', 'gpt-5-mini']);
  });

  it('falls back to env list when live fetcher throws', async () => {
    const merged = await unionWithLiveDiscovery({
      envModels: ['gpt-4o', 'gpt-5'],
      liveFetcher: async () => {
        throw new Error('boom');
      },
    });
    expect(merged).toEqual(['gpt-4o', 'gpt-5']);
  });

  it('falls back to env list when live fetcher returns empty', async () => {
    const merged = await unionWithLiveDiscovery({
      envModels: ['gpt-4o'],
      liveFetcher: async () => [],
    });
    expect(merged).toEqual(['gpt-4o']);
  });

  it('runs the optional filter on the merged list', async () => {
    const merged = await unionWithLiveDiscovery({
      envModels: ['gpt-4o', 'gpt-image-1'],
      liveFetcher: async () => ['gpt-5.5', 'text-embedding-3-small'],
      filter: filterOpenAITextCompatibleModels,
    });
    expect(merged).toEqual(['gpt-4o', 'gpt-5.5']);
  });
});

describe('getOpenAIModels merge mode', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    mockedAxios.get.mockReset();
    jest.clearAllMocks();
  });

  it('unions OPENAI_MODELS with all live discovery ids and sorts version-descending', async () => {
    process.env.OPENAI_MODELS = 'gpt-4o,gpt-5';
    process.env.OPENAI_MODELS_MODE = 'merge';
    process.env.OPENAI_API_KEY = 'mockedApiKey';

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'gpt-5' },
          { id: 'gpt-5.5' },
          { id: 'gpt-5.5-pro' },
          { id: 'gpt-image-1' },
          { id: 'text-embedding-3-small' },
        ],
      },
    });

    const models = await getOpenAIModels({ user: 'user-merge', forceRefresh: true });

    // Sorted by version descending: gpt-5.5* (505) > gpt-5 (500) > gpt-4o (400).
    // Provider-returned non-chat ids remain visible instead of being filtered.
    expect(models).toEqual([
      'gpt-5.5',
      'gpt-5.5-pro',
      'gpt-5',
      'gpt-4o',
      'gpt-image-1',
      'text-embedding-3-small',
    ]);
  });

  it('falls back to OPENAI_MODELS (still version-sorted) when live discovery throws', async () => {
    process.env.OPENAI_MODELS = 'gpt-4o,gpt-5';
    process.env.OPENAI_MODELS_MODE = 'merge';
    process.env.OPENAI_API_KEY = 'mockedApiKey';

    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    const models = await getOpenAIModels({ user: 'user-merge', forceRefresh: true });
    // Even on fallback, the merged-mode path runs the sort so gpt-5 (500)
    // beats gpt-4o (400) regardless of env-list ordering.
    expect(models).toEqual(['gpt-5', 'gpt-4o']);
  });

  it('returns OPENAI_MODELS verbatim in override mode (default)', async () => {
    process.env.OPENAI_MODELS = 'gpt-4o,gpt-5';
    delete process.env.OPENAI_MODELS_MODE;
    process.env.OPENAI_API_KEY = 'mockedApiKey';

    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'gpt-5.5' }, { id: 'gpt-5.5-pro' }] },
    });

    const models = await getOpenAIModels({ user: 'user-override', forceRefresh: true });
    expect(models).toEqual(['gpt-4o', 'gpt-5']);
  });

  it('skips live discovery in user-provided context even when merge mode is on', async () => {
    process.env.OPENAI_MODELS = 'gpt-4o,gpt-5';
    process.env.OPENAI_MODELS_MODE = 'merge';
    delete process.env.OPENAI_API_KEY;

    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'gpt-5.5' }] },
    });

    const models = await getOpenAIModels({
      user: 'user-byok',
      userProvidedOpenAI: true,
    });
    expect(models).toEqual(['gpt-4o', 'gpt-5']);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  it('skips the OpenAI text-compat filter and version-sort for Azure deployments in merge mode', async () => {
    process.env.AZURE_OPENAI_MODELS = 'gpt5-prod,gpt-image-prod';
    process.env.AZURE_OPENAI_MODELS_MODE = 'merge';

    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'gpt5-staging' }, { id: 'gpt-realtime-prod' }] },
    });

    const models = await getOpenAIModels({
      azure: true,
      openAIApiKey: 'azure-key',
      baseURL: 'https://example-resource.openai.azure.com/openai/v1',
      forceRefresh: true,
    });

    // Azure deployment names are admin-controlled, so we preserve original
    // order (no version sort) so the operator's intended ranking survives.
    expect(models).toEqual(['gpt5-prod', 'gpt-image-prod', 'gpt5-staging', 'gpt-realtime-prod']);
  });

  it('places newly-discovered gpt-5.5 variants ABOVE legacy gpt-4 / gpt-3.5 ids', async () => {
    process.env.OPENAI_MODELS = 'gpt-5.4,gpt-5.4-pro,gpt-5.5,gpt-5.5-pro';
    process.env.OPENAI_MODELS_MODE = 'merge';
    process.env.OPENAI_API_KEY = 'mockedApiKey';

    // OpenAI API often returns models in chronological-by-creation order;
    // legacy 3.5/4 ids may appear before the freshly-released 5.5 variants.
    mockedAxios.get.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'gpt-3.5-turbo' },
          { id: 'gpt-4' },
          { id: 'gpt-4-0613' },
          { id: 'gpt-5.5-pro-2026-04-23' },
          { id: 'gpt-5.5-2026-04-23' },
          { id: 'gpt-4o' },
        ],
      },
    });

    const models = await getOpenAIModels({ user: 'user-order', forceRefresh: true });

    const indexOf = (id: string) => models.indexOf(id);

    // Every gpt-5.X model must come BEFORE every gpt-4* and gpt-3.5* model.
    expect(indexOf('gpt-5.5')).toBeLessThan(indexOf('gpt-4'));
    expect(indexOf('gpt-5.5-pro-2026-04-23')).toBeLessThan(indexOf('gpt-4'));
    expect(indexOf('gpt-5.5-2026-04-23')).toBeLessThan(indexOf('gpt-4-0613'));
    expect(indexOf('gpt-5.4')).toBeLessThan(indexOf('gpt-4o'));
    expect(indexOf('gpt-5.4')).toBeLessThan(indexOf('gpt-3.5-turbo'));

    // gpt-5.5 group (score 505) sits above gpt-5.4 group (504).
    expect(indexOf('gpt-5.5')).toBeLessThan(indexOf('gpt-5.4'));
  });
});

describe('getAnthropicModels merge mode', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    mockedAxios.get.mockReset();
    jest.clearAllMocks();
  });

  it('unions ANTHROPIC_MODELS with live discovery and sorts version-descending', async () => {
    process.env.ANTHROPIC_MODELS = 'claude-3-5-sonnet,claude-3-opus';
    process.env.ANTHROPIC_MODELS_MODE = 'merge';
    process.env.ANTHROPIC_API_KEY = 'mockedAnthropicKey';

    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'claude-3-opus' }, { id: 'claude-4-sonnet' }] },
    });

    const models = await getAnthropicModels({ user: 'user-merge' });
    // claude-4-sonnet (score 400) > claude-3-5-sonnet (305) > claude-3-opus (300)
    expect(models).toEqual(['claude-4-sonnet', 'claude-3-5-sonnet', 'claude-3-opus']);
  });

  it('returns ANTHROPIC_MODELS verbatim in override mode', async () => {
    process.env.ANTHROPIC_MODELS = 'claude-3-5-sonnet,claude-3-opus';
    delete process.env.ANTHROPIC_MODELS_MODE;
    process.env.ANTHROPIC_API_KEY = 'mockedAnthropicKey';

    mockedAxios.get.mockResolvedValueOnce({
      data: { data: [{ id: 'claude-4-sonnet' }] },
    });

    const models = await getAnthropicModels({ user: 'user-override' });
    expect(models).toEqual(['claude-3-5-sonnet', 'claude-3-opus']);
  });

  it('falls back to ANTHROPIC_MODELS verbatim in merge mode when live fetch throws', async () => {
    process.env.ANTHROPIC_MODELS = 'claude-3-5-sonnet';
    process.env.ANTHROPIC_MODELS_MODE = 'merge';
    process.env.ANTHROPIC_API_KEY = 'mockedAnthropicKey';

    mockedAxios.get.mockRejectedValueOnce(new Error('Network error'));

    const models = await getAnthropicModels({ user: 'user-merge' });
    expect(models).toEqual(['claude-3-5-sonnet']);
  });
});

describe('getGoogleModels merge mode', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    mockedAxios.get.mockReset();
    jest.clearAllMocks();
  });

  it('unions GOOGLE_MODELS with live discovery results', async () => {
    process.env.GOOGLE_MODELS = 'gemini-2.5-flash,gemini-2.5-pro';
    process.env.GOOGLE_MODELS_MODE = 'merge';
    process.env.GOOGLE_KEY = 'mockedGoogleKey';

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            name: 'models/gemini-2.5-pro',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
          {
            name: 'models/gemini-3.1-pro',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
        ],
      },
    });

    const models = await getGoogleModels();
    // gemini-3.1-pro (301) > gemini-2.5-* (205, stable order)
    expect(models).toEqual(['gemini-3.1-pro', 'gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('returns GOOGLE_MODELS verbatim in override mode', async () => {
    process.env.GOOGLE_MODELS = 'gemini-2.5-flash';
    delete process.env.GOOGLE_MODELS_MODE;
    process.env.GOOGLE_KEY = 'mockedGoogleKey';

    mockedAxios.get.mockResolvedValueOnce({
      data: {
        models: [
          {
            name: 'models/gemini-3.1-pro',
            supportedGenerationMethods: ['generateContent', 'countTokens'],
          },
        ],
      },
    });

    const models = await getGoogleModels();
    expect(models).toEqual(['gemini-2.5-flash']);
  });
});

describe('getOpenAIModelVersionScore', () => {
  it.each([
    ['gpt-5.5-pro', 505],
    ['gpt-5.5', 505],
    ['gpt-5.4-mini', 504],
    ['gpt-5', 500],
    ['gpt-4.1', 401],
    ['gpt-4o', 400],
    ['gpt-4', 400],
    ['gpt-4-turbo-preview', 400],
    ['gpt-3.5-turbo', 305],
    ['gpt-3.5-turbo-instruct', 305],
    ['chatgpt-4o-latest', 400],
    ['o4-mini', 400],
    ['o3-pro', 300],
    ['o1', 100],
    ['davinci-002', -1],
    ['unknown-model', -1],
    ['', -1],
  ])('scores %s as %i', (model, score) => {
    expect(getOpenAIModelVersionScore(model)).toBe(score);
  });
});

describe('sortOpenAIModelsByVersion', () => {
  it('places higher gpt-X.Y versions first and sinks instruct to the end', () => {
    const sorted = sortOpenAIModelsByVersion([
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-instruct',
      'gpt-4',
      'gpt-4-turbo-preview',
      'gpt-5',
      'gpt-5.5-pro-2026-04-23',
      'gpt-5.5',
    ]);
    expect(sorted).toEqual([
      'gpt-5.5-pro-2026-04-23',
      'gpt-5.5',
      'gpt-5',
      'gpt-4',
      'gpt-4-turbo-preview',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-instruct',
    ]);
  });

  it('keeps the curated env-list order stable within a single version', () => {
    const sorted = sortOpenAIModelsByVersion([
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.4-pro',
    ]);
    expect(sorted).toEqual(['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.4-pro']);
  });

  it('mixes o-series with gpt by score (o4-mini ≈ gpt-4)', () => {
    const sorted = sortOpenAIModelsByVersion(['gpt-3.5-turbo', 'o4-mini', 'gpt-5', 'o1', 'gpt-4o']);
    // gpt-5 (500) → [o4-mini, gpt-4o] (both 400) → o1 (100) → gpt-3.5-turbo (305)
    expect(sorted[0]).toBe('gpt-5');
    expect(sorted.indexOf('o4-mini')).toBeLessThan(sorted.indexOf('gpt-3.5-turbo'));
    expect(sorted.indexOf('gpt-4o')).toBeLessThan(sorted.indexOf('o1'));
  });

  it('puts unknown models above instruct but below known versions', () => {
    const sorted = sortOpenAIModelsByVersion([
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-instruct',
      'davinci-002',
      'gpt-5',
    ]);
    expect(sorted).toEqual(['gpt-5', 'gpt-3.5-turbo', 'davinci-002', 'gpt-3.5-turbo-instruct']);
  });
});

describe('getAnthropicModelVersionScore', () => {
  it.each([
    ['claude-opus-4-6', 406],
    ['claude-sonnet-4-5', 405],
    ['claude-haiku-4-5-20251001', 405],
    ['claude-3-7-sonnet', 307],
    ['claude-3-5-sonnet', 305],
    ['claude-3-opus', 300],
    ['claude-3-haiku-20240307', 300],
    ['gpt-4', -1],
  ])('scores %s as %i', (model, score) => {
    expect(getAnthropicModelVersionScore(model)).toBe(score);
  });
});

describe('sortAnthropicModelsByVersion', () => {
  it('places newer Claude versions first', () => {
    const sorted = sortAnthropicModelsByVersion([
      'claude-3-5-sonnet',
      'claude-3-opus',
      'claude-opus-4-6',
      'claude-sonnet-4-5',
      'claude-3-7-sonnet',
    ]);
    expect(sorted).toEqual([
      'claude-opus-4-6',
      'claude-sonnet-4-5',
      'claude-3-7-sonnet',
      'claude-3-5-sonnet',
      'claude-3-opus',
    ]);
  });
});

describe('getGoogleModelVersionScore', () => {
  it.each([
    ['gemini-3.1-pro-preview', 301],
    ['gemini-3.1-flash-lite-preview', 301],
    ['gemini-2.5-flash', 205],
    ['gemini-2.0-flash', 200],
    ['gemma-3-27b-it', -1],
  ])('scores %s as %i', (model, score) => {
    expect(getGoogleModelVersionScore(model)).toBe(score);
  });
});

describe('sortGoogleModelsByVersion', () => {
  it('places newer Gemini versions first and falls through unknowns', () => {
    const sorted = sortGoogleModelsByVersion([
      'gemini-2.0-flash',
      'gemini-2.5-flash',
      'gemini-3.1-pro',
      'gemini-2.5-pro',
      'gemma-3-27b-it',
    ]);
    expect(sorted).toEqual([
      'gemini-3.1-pro',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-2.0-flash',
      'gemma-3-27b-it',
    ]);
  });
});
