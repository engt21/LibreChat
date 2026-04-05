const { EModelEndpoint, GoogleAuthMode } = require('librechat-data-provider');
const {
  buildAzureRealtimeURL,
  buildOpenAIRealtimeURL,
  resolveRealtimeSessionConfig,
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
