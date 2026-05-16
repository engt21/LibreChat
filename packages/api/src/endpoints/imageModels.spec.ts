import axios from 'axios';
import { ImageGenProvider } from 'librechat-data-provider';
import type { IUser } from '@librechat/data-schemas';
import { discoverImageModels, clearImageModelCachesForTests } from './imageModels';

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
    extractBaseURL: jest.fn((url?: string) => (url ? url : undefined)),
    isUserProvided: jest.fn((value: string | undefined) => value === 'user_provided'),
    logAxiosError: jest.fn(),
    resolveHeaders: jest.fn(
      (options: { headers?: Record<string, string> }) => options?.headers || {},
    ),
  };
});

jest.mock('~/utils/azure', () => ({
  isAzureOpenAIBaseURL: jest.fn(() => false),
  normalizeAzureOpenAIBaseURL: jest.fn((url: string) => url),
}));

jest.mock('./google/auth', () => ({
  prepareGoogleCredentials: jest.fn().mockResolvedValue(undefined),
  resolveGoogleClientAuth: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      list: jest.fn().mockResolvedValue({
        page: [],
        pageInternal: undefined,
      }),
    },
  })),
}));

jest.mock('@librechat/data-schemas', () => ({
  ...jest.requireActual('@librechat/data-schemas'),
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

const ORIGINAL_ENV = { ...process.env };

describe('discoverImageModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
    // strip credentials by default; tests will opt-in
    delete process.env.OPENAI_API_KEY;
    delete process.env.AZURE_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.FLUX_API_KEY;
    delete process.env.STABILITY_API_KEY;
    clearImageModelCachesForTests();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns one provider entry per known ImageGenProvider value, in canonical order', async () => {
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });
    const result = await discoverImageModels({});
    const ids = result.providers.map((p) => p.id);
    expect(ids).toEqual([
      ImageGenProvider.openai,
      ImageGenProvider.azureOpenAI,
      ImageGenProvider.google,
      ImageGenProvider.vertex,
      ImageGenProvider.xai,
      ImageGenProvider.flux,
      ImageGenProvider.stability,
    ]);
  });

  it('marks providers without credentials as not configured and returns empty model lists', async () => {
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });
    const result = await discoverImageModels({});
    for (const provider of result.providers) {
      expect(provider.configured).toBe(false);
      expect(provider.models).toEqual([]);
    }
  });

  it('discovers OpenAI image models from /v1/models when API key is set', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('/v1/models')) {
        return {
          data: {
            data: [
              { id: 'gpt-4o' }, // not an image model
              { id: 'gpt-image-1', created: 1700000000 },
              { id: 'dall-e-3', created: 1690000000 },
            ],
          },
        };
      }
      return { data: { data: [] } };
    });
    const result = await discoverImageModels({});
    const openai = result.providers.find((p) => p.id === ImageGenProvider.openai);
    expect(openai).toBeDefined();
    expect(openai?.configured).toBe(true);
    const ids = (openai?.models ?? []).map((m) => m.id);
    expect(ids).toContain('gpt-image-1');
    expect(ids).toContain('dall-e-3');
    expect(ids).not.toContain('gpt-4o');
    // exactly one model marked default
    const defaults = (openai?.models ?? []).filter((m) => m.default);
    expect(defaults.length).toBeLessThanOrEqual(1);
  });

  it('surfaces Azure gpt-image-2 when Azure endpoint credentials are saved by the user', async () => {
    mockedAxios.get.mockRejectedValue(new Error('not found'));
    const result = await discoverImageModels({
      user: { id: 'u-1' } as unknown as IUser,
      loadEndpointKeyValues: async ({ name }) =>
        name === 'azureOpenAI'
          ? {
              apiKey: 'azure-key',
              baseURL: 'https://example.openai.azure.com/openai/v1',
              models: 'gpt-image-2,gpt-4o',
            }
          : undefined,
    });
    const azure = result.providers.find((p) => p.id === ImageGenProvider.azureOpenAI);
    expect(azure?.configured).toBe(true);
    expect((azure?.models ?? []).map((m) => m.id)).toContain('gpt-image-2');
    expect(azure?.models.find((m) => m.id === 'gpt-image-2')?.default).toBe(true);
  });

  it('returns the curated Flux list when FLUX_API_KEY is present', async () => {
    process.env.FLUX_API_KEY = 'flux-test';
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });
    const result = await discoverImageModels({});
    const flux = result.providers.find((p) => p.id === ImageGenProvider.flux);
    expect(flux?.configured).toBe(true);
    expect((flux?.models ?? []).length).toBeGreaterThan(0);
  });

  it('returns the curated Stability list when STABILITY_API_KEY is present', async () => {
    process.env.STABILITY_API_KEY = 'sk-stab';
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });
    const result = await discoverImageModels({});
    const stability = result.providers.find((p) => p.id === ImageGenProvider.stability);
    expect(stability?.configured).toBe(true);
    expect((stability?.models ?? []).length).toBeGreaterThan(0);
  });

  it('falls back to curated Flux list (with notice) when FLUX_API_KEY is unset', async () => {
    mockedAxios.get.mockResolvedValue({ data: { data: [] } });
    const result = await discoverImageModels({});
    const flux = result.providers.find((p) => p.id === ImageGenProvider.flux);
    expect(flux?.configured).toBe(false);
    expect((flux?.models ?? []).length).toBe(0);
  });
});
