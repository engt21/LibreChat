import { initializeOpenAI } from './initialize';
import { getOpenAIConfig } from './config';
import {
  resolveHeaders,
  resolveAzureOpenAIDirectConfig,
  supportsAzureOpenAIModelListing,
  checkUserKeyExpiry,
} from '~/utils';
import { mapModelToAzureConfig } from 'librechat-data-provider';
import type { BaseInitializeParams } from '~/types';

jest.mock('./config', () => ({
  getOpenAIConfig: jest.fn((_apiKey: string, clientOptions: Record<string, unknown>) => ({
    llmConfig: {
      model: (clientOptions.modelOptions as { model: string }).model,
    },
    configOptions: {
      reverseProxyUrl: clientOptions.reverseProxyUrl,
      defaultQuery: clientOptions.defaultQuery,
      headers: clientOptions.headers,
    },
  })),
}));

jest.mock('~/utils', () => ({
  getAzureCredentials: jest.fn(),
  resolveAzureOpenAIDirectConfig: jest.fn(),
  resolveHeaders: jest.fn(({ headers }) => headers),
  isUserProvided: jest.fn(() => false),
  checkUserKeyExpiry: jest.fn(),
  supportsAzureOpenAIModelListing: jest.fn(),
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  mapModelToAzureConfig: jest.fn(),
}));

const mockedGetOpenAIConfig = jest.mocked(getOpenAIConfig);
const mockedResolveHeaders = jest.mocked(resolveHeaders);
const mockedResolveAzureOpenAIDirectConfig = jest.mocked(resolveAzureOpenAIDirectConfig);
const mockedSupportsAzureOpenAIModelListing = jest.mocked(supportsAzureOpenAIModelListing);
const mockedMapModelToAzureConfig = jest.mocked(mapModelToAzureConfig);
const mockedCheckUserKeyExpiry = jest.mocked(checkUserKeyExpiry);

const createParams = (): BaseInitializeParams =>
  ({
    req: {
      config: {
        endpoints: {
          azureOpenAI: {
            modelGroupMap: {
              'gpt-5.4-mini': { group: 'serverless' },
            },
            groupMap: {
              serverless: {},
            },
          },
        },
      },
      body: {},
      user: { id: 'user-1' },
    },
    endpoint: 'azureOpenAI',
    model_parameters: {
      model: 'gpt-5.4-mini',
    },
    db: {
      getUserKeyValues: jest.fn(),
    },
  }) as unknown as BaseInitializeParams;

describe('initializeOpenAI', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      AZURE_API_KEY: 'azure-key',
    };
    mockedResolveHeaders.mockImplementation(({ headers }) => headers);
    mockedResolveAzureOpenAIDirectConfig.mockReturnValue(undefined);
    mockedCheckUserKeyExpiry.mockImplementation(() => undefined);
    mockedGetOpenAIConfig.mockImplementation((_apiKey, clientOptions: Record<string, unknown>) => ({
      llmConfig: {
        model: (clientOptions.modelOptions as { model: string }).model,
      },
      configOptions: {
        reverseProxyUrl: clientOptions.reverseProxyUrl,
        defaultQuery: clientOptions.defaultQuery,
        headers: clientOptions.headers,
      },
    }));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('omits api-version for Azure serverless /openai/v1 routes', async () => {
    mockedSupportsAzureOpenAIModelListing.mockReturnValue(true);
    mockedMapModelToAzureConfig.mockReturnValue({
      azureOptions: {
        azureOpenAIApiKey: 'azure-key',
        azureOpenAIApiInstanceName: 'serverless-instance',
        azureOpenAIApiDeploymentName: 'gpt-5.4-mini',
        azureOpenAIApiVersion: '2024-10-01-preview',
      },
      baseURL: 'https://serverless.openai.azure.com/openai/v1',
      headers: {},
      serverless: true,
    });

    const result = await initializeOpenAI(createParams());

    expect(result.configOptions?.defaultQuery).toBeUndefined();
    expect(result.useLegacyContent).toBe(true);
  });

  it('preserves api-version for Azure serverless legacy inference routes', async () => {
    mockedSupportsAzureOpenAIModelListing.mockReturnValue(false);
    mockedMapModelToAzureConfig.mockReturnValue({
      azureOptions: {
        azureOpenAIApiKey: 'azure-key',
        azureOpenAIApiInstanceName: 'serverless-instance',
        azureOpenAIApiDeploymentName: 'gpt-5.4-mini',
        azureOpenAIApiVersion: '2024-10-01-preview',
      },
      baseURL: 'https://serverless.models.ai.azure.com/v1',
      headers: {},
      serverless: true,
    });

    const result = await initializeOpenAI(createParams());

    expect(result.configOptions?.defaultQuery).toEqual({
      'api-version': '2024-10-01-preview',
    });
  });

  it('uses an admin-enabled OpenAI BYOK override even when a platform key exists', async () => {
    process.env.OPENAI_API_KEY = 'platform-openai-key';
    process.env.OPENAI_REVERSE_PROXY = 'https://platform.example.test/v1';
    const params = createParams();
    params.endpoint = 'openAI';
    params.req.appSettings = {
      byok: {
        providers: {
          openAI: { enabled: true, allowBaseURL: true, fallbackToPlatform: true },
        },
      },
    };
    (params.db.getUserKeyValues as jest.Mock).mockResolvedValue({
      apiKey: 'user-openai-key',
      baseURL: 'https://user.example.test/v1',
    });

    await initializeOpenAI(params);

    expect(params.db.getUserKeyValues).toHaveBeenCalledWith({
      userId: 'user-1',
      name: 'openAI',
    });
    expect(mockedGetOpenAIConfig).toHaveBeenCalledWith(
      'user-openai-key',
      expect.objectContaining({ reverseProxyUrl: 'https://user.example.test/v1' }),
      'openAI',
    );
  });

  it('falls back to the platform OpenAI key when an admin-enabled user key is missing', async () => {
    process.env.OPENAI_API_KEY = 'platform-openai-key';
    process.env.OPENAI_REVERSE_PROXY = 'https://platform.example.test/v1';
    const params = createParams();
    params.endpoint = 'openAI';
    params.req.appSettings = {
      byok: {
        providers: {
          openAI: { enabled: true, allowBaseURL: true, fallbackToPlatform: true },
        },
      },
    };
    (params.db.getUserKeyValues as jest.Mock).mockRejectedValue(new Error('missing user key'));

    await initializeOpenAI(params);

    expect(mockedGetOpenAIConfig).toHaveBeenCalledWith(
      'platform-openai-key',
      expect.objectContaining({ reverseProxyUrl: 'https://platform.example.test/v1' }),
      'openAI',
    );
  });

  it('falls back to the platform OpenAI key when the admin-enabled user key is expired', async () => {
    process.env.OPENAI_API_KEY = 'platform-openai-key';
    const params = createParams();
    params.endpoint = 'openAI';
    params.req.body = { key: '2000-01-01T00:00:00.000Z' };
    params.req.appSettings = {
      byok: {
        providers: {
          openAI: { enabled: true, allowBaseURL: true, fallbackToPlatform: true },
        },
      },
    };
    mockedCheckUserKeyExpiry.mockImplementationOnce(() => {
      throw new Error('expired');
    });

    await initializeOpenAI(params);

    expect(params.db.getUserKeyValues).not.toHaveBeenCalled();
    expect(mockedGetOpenAIConfig).toHaveBeenCalledWith(
      'platform-openai-key',
      expect.any(Object),
      'openAI',
    );
  });
});
