const { EModelEndpoint, GoogleAuthMode, SystemRoles } = require('librechat-data-provider');
const {
  buildAzureRealtimeURL,
  buildOpenAIRealtimeURL,
  filterRealtimeProvidersByPolicy,
  resolveRealtimeSessionConfig,
  validateRealtimeModelAccess,
} = require('~/server/services/Realtime/modelService');
const { isXAIRealtimeModel } = require('~/server/services/Realtime/constants');

describe('realtime model service URL builders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GOOGLE_AUTH_MODE;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    delete process.env.GOOGLE_KEY;
  });

  afterAll(() => {
    process.env = originalEnv;
  });
  it('builds an OpenAI realtime websocket URL', () => {
    const url = buildOpenAIRealtimeURL({
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-realtime-1.5',
    });

    expect(url).toBe('wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5');
  });

  it('builds an Azure GA realtime websocket URL with model query param', () => {
    const url = buildAzureRealtimeURL({
      baseURL: 'https://example.openai.azure.com/openai/v1',
      azureOptions: {
        azureOpenAIApiKey: 'test-key',
        azureOpenAIApiDeploymentName: 'my-realtime-deployment',
        azureOpenAIApiVersion: '2025-04-01-preview',
      },
      model: 'gpt-realtime-1.5',
    });

    expect(url).toBe(
      'wss://example.openai.azure.com/openai/v1/realtime?model=my-realtime-deployment',
    );
  });

  it('normalizes a legacy Azure base URL to the GA realtime websocket path', () => {
    const url = buildAzureRealtimeURL({
      baseURL: 'https://example.openai.azure.com/openai',
      azureOptions: {
        azureOpenAIApiKey: 'test-key',
        azureOpenAIApiDeploymentName: 'preview-deployment',
        azureOpenAIApiVersion: '2025-04-01-preview',
      },
      model: 'gpt-realtime-1.5',
    });

    expect(url).toBe('wss://example.openai.azure.com/openai/v1/realtime?model=preview-deployment');
  });

  it('recognizes xAI realtime voice models from discovery results', () => {
    expect(isXAIRealtimeModel('grok-voice-agent')).toBe(true);
    expect(isXAIRealtimeModel('grok-realtime-preview')).toBe(true);
    expect(isXAIRealtimeModel('grok-4')).toBe(false);
  });

  it('builds Google realtime session config with Vertex AI application default credentials', async () => {
    process.env.GOOGLE_AUTH_MODE = GoogleAuthMode.VERTEX_APPLICATION_DEFAULT;
    process.env.GOOGLE_CLOUD_PROJECT = 'vertex-project';
    process.env.GOOGLE_CLOUD_LOCATION = 'us-central1';

    const sessionConfig = await resolveRealtimeSessionConfig({
      req: { user: { id: 'test-user' } },
      endpoint: EModelEndpoint.google,
      model: 'gemini-live-2.5-flash-preview',
    });

    expect(sessionConfig).toMatchObject({
      endpoint: EModelEndpoint.google,
      provider: 'google',
      model: 'gemini-live-2.5-flash-preview',
      clientOptions: {
        vertexai: true,
        project: 'vertex-project',
        location: 'us-central1',
      },
    });
  });
});

describe('filterRealtimeProvidersByPolicy', () => {
  const mockProviders = [
    {
      endpoint: EModelEndpoint.openAI,
      provider: 'openai',
      label: 'OpenAI',
      available: true,
      requiresUserKey: false,
      models: ['gpt-realtime', 'gpt-realtime-mini', 'gpt-realtime-1.5'],
      defaultModel: 'gpt-realtime',
    },
    {
      endpoint: EModelEndpoint.google,
      provider: 'google',
      label: 'Gemini Live',
      available: true,
      requiresUserKey: false,
      models: ['gemini-live-2.5-flash-preview'],
      defaultModel: 'gemini-live-2.5-flash-preview',
    },
    {
      endpoint: 'xai',
      provider: 'xai',
      label: 'xAI',
      available: true,
      requiresUserKey: false,
      models: ['grok-voice-agent'],
      defaultModel: 'grok-voice-agent',
    },
  ];

  it('returns all providers for admin users', () => {
    const user = { role: SystemRoles.ADMIN };
    const result = filterRealtimeProvidersByPolicy(mockProviders, user);
    expect(result).toEqual(mockProviders);
  });

  it('returns all providers for unrestricted users', () => {
    const user = {
      role: SystemRoles.USER,
      modelPermissions: { enabled: false, rules: [] },
    };
    const result = filterRealtimeProvidersByPolicy(mockProviders, user);
    expect(result).toEqual(mockProviders);
  });

  it('filters models by endpoint for restricted users', () => {
    const user = {
      role: SystemRoles.USER,
      modelPermissions: {
        enabled: true,
        rules: [{ endpoint: EModelEndpoint.openAI, models: ['gpt-realtime-1.5'] }],
      },
    };
    const result = filterRealtimeProvidersByPolicy(mockProviders, user);

    expect(result).toHaveLength(1);
    expect(result[0].endpoint).toBe(EModelEndpoint.openAI);
    expect(result[0].models).toEqual(['gpt-realtime-1.5']);
    expect(result[0].defaultModel).toBe('gpt-realtime-1.5');
  });

  it('drops providers whose endpoint has no matching rules', () => {
    const user = {
      role: SystemRoles.USER,
      modelPermissions: {
        enabled: true,
        rules: [{ endpoint: EModelEndpoint.google, models: ['gemini-live-2.5-flash-preview'] }],
      },
    };
    const result = filterRealtimeProvidersByPolicy(mockProviders, user);

    expect(result).toHaveLength(1);
    expect(result[0].endpoint).toBe(EModelEndpoint.google);
  });

  it('allows all models for wildcard rules', () => {
    const user = {
      role: SystemRoles.USER,
      modelPermissions: {
        enabled: true,
        rules: [
          { endpoint: EModelEndpoint.openAI, models: ['*'] },
          { endpoint: EModelEndpoint.google, models: ['gemini-live-2.5-flash-preview'] },
        ],
      },
    };
    const result = filterRealtimeProvidersByPolicy(mockProviders, user);

    const openai = result.find((p) => p.endpoint === EModelEndpoint.openAI);
    expect(openai.models).toEqual(['gpt-realtime', 'gpt-realtime-mini', 'gpt-realtime-1.5']);
  });

  it('drops providers when no models survive filtering', () => {
    const user = {
      role: SystemRoles.USER,
      modelPermissions: {
        enabled: true,
        rules: [{ endpoint: EModelEndpoint.openAI, models: ['gpt-5.1'] }],
      },
    };
    const result = filterRealtimeProvidersByPolicy(mockProviders, user);

    expect(result).toHaveLength(0);
  });
});

describe('validateRealtimeModelAccess', () => {
  it('allows admin users without restriction checks', () => {
    expect(() =>
      validateRealtimeModelAccess({
        user: { role: SystemRoles.ADMIN },
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-realtime-1.5',
      }),
    ).not.toThrow();
  });

  it('allows unrestricted users', () => {
    expect(() =>
      validateRealtimeModelAccess({
        user: {
          role: SystemRoles.USER,
          modelPermissions: { enabled: false, rules: [] },
        },
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-realtime-1.5',
      }),
    ).not.toThrow();
  });

  it('allows a model that matches the user policy', () => {
    expect(() =>
      validateRealtimeModelAccess({
        user: {
          role: SystemRoles.USER,
          modelPermissions: {
            enabled: true,
            rules: [{ endpoint: EModelEndpoint.openAI, models: ['gpt-realtime-1.5'] }],
          },
        },
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-realtime-1.5',
      }),
    ).not.toThrow();
  });

  it('rejects an endpoint that has no rules for the user', () => {
    expect(() =>
      validateRealtimeModelAccess({
        user: {
          role: SystemRoles.USER,
          modelPermissions: {
            enabled: true,
            rules: [{ endpoint: EModelEndpoint.google, models: ['gemini-live-2.5-flash-preview'] }],
          },
        },
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-realtime-1.5',
      }),
    ).toThrow(/not available for your account/);
  });

  it('rejects a model that is not in the user allowlist for the endpoint', () => {
    expect(() =>
      validateRealtimeModelAccess({
        user: {
          role: SystemRoles.USER,
          modelPermissions: {
            enabled: true,
            rules: [{ endpoint: EModelEndpoint.openAI, models: ['gpt-5.1'] }],
          },
        },
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-realtime-1.5',
      }),
    ).toThrow(/not available for your account/);
  });

  it('allows any model when the user has a wildcard rule for the endpoint', () => {
    expect(() =>
      validateRealtimeModelAccess({
        user: {
          role: SystemRoles.USER,
          modelPermissions: {
            enabled: true,
            rules: [{ endpoint: EModelEndpoint.openAI, models: ['*'] }],
          },
        },
        endpoint: EModelEndpoint.openAI,
        model: 'gpt-realtime-1.5',
      }),
    ).not.toThrow();
  });
});
