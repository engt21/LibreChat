const { EModelEndpoint } = require('librechat-data-provider');

describe('VectorDB routing', () => {
  let normalizeRagProvider, resolveRagProvider;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.OPENAI_RAG_API_URL;
    delete process.env.AZURE_OPENAI_RAG_API_URL;
    delete process.env.GOOGLE_RAG_API_URL;
    delete process.env.RAG_API_URL;
    delete process.env.RAG_DEFAULT_PROVIDER;
    ({ normalizeRagProvider, resolveRagProvider } = require('./routing'));
  });

  describe('normalizeRagProvider', () => {
    it('returns null for falsy values', () => {
      expect(normalizeRagProvider(null)).toBeNull();
      expect(normalizeRagProvider(undefined)).toBeNull();
      expect(normalizeRagProvider('')).toBeNull();
    });

    it('normalizes OpenAI aliases to the canonical endpoint constant', () => {
      expect(normalizeRagProvider('openai')).toBe(EModelEndpoint.openAI);
      expect(normalizeRagProvider('OpenAI')).toBe(EModelEndpoint.openAI);
      expect(normalizeRagProvider('assistants')).toBe(EModelEndpoint.openAI);
      expect(normalizeRagProvider(EModelEndpoint.openAI)).toBe(EModelEndpoint.openAI);
    });

    it('normalizes Azure aliases to the canonical endpoint constant', () => {
      expect(normalizeRagProvider('azure')).toBe(EModelEndpoint.azureOpenAI);
      expect(normalizeRagProvider('azure-openai')).toBe(EModelEndpoint.azureOpenAI);
      expect(normalizeRagProvider('azureassistants')).toBe(EModelEndpoint.azureOpenAI);
      expect(normalizeRagProvider(EModelEndpoint.azureOpenAI)).toBe(EModelEndpoint.azureOpenAI);
    });

    it('normalizes Google aliases to the canonical endpoint constant', () => {
      expect(normalizeRagProvider('google')).toBe(EModelEndpoint.google);
      expect(normalizeRagProvider('gemini')).toBe(EModelEndpoint.google);
      expect(normalizeRagProvider(EModelEndpoint.google)).toBe(EModelEndpoint.google);
    });

    it('returns null for unrecognized providers', () => {
      expect(normalizeRagProvider('anthropic')).toBeNull();
      expect(normalizeRagProvider('ollama')).toBeNull();
    });
  });

  describe('resolveRagProvider', () => {
    it('defaults to openAI when no overrides are present', () => {
      expect(resolveRagProvider({})).toBe(EModelEndpoint.openAI);
    });

    it('uses explicit embedding_provider from body over endpoint', () => {
      const req = {
        body: { embedding_provider: 'google', endpoint: 'openAI' },
      };
      expect(resolveRagProvider({ req })).toBe(EModelEndpoint.google);
    });

    it('uses embedding_provider from query params', () => {
      const req = { query: { embedding_provider: 'azure' } };
      expect(resolveRagProvider({ req })).toBe(EModelEndpoint.azureOpenAI);
    });

    it('falls back to endpoint from body when no explicit override', () => {
      const req = { body: { endpoint: 'google' } };
      expect(resolveRagProvider({ req })).toBe(EModelEndpoint.google);
    });

    it('uses endpointType over endpoint when present', () => {
      const req = { body: { endpointType: 'azureOpenAI', endpoint: 'agents' } };
      expect(resolveRagProvider({ req })).toBe(EModelEndpoint.azureOpenAI);
    });

    it('uses metadata ragProvider', () => {
      expect(resolveRagProvider({ metadata: { ragProvider: 'google' } })).toBe(
        EModelEndpoint.google,
      );
    });

    it('uses RAG_DEFAULT_PROVIDER env var when no request overrides', () => {
      process.env.RAG_DEFAULT_PROVIDER = 'google';
      // Re-require to pick up env change
      jest.resetModules();
      const { resolveRagProvider: resolve } = require('./routing');
      expect(resolve({})).toBe(EModelEndpoint.google);
    });
  });

  describe('getRagApiUrl', () => {
    it('returns the provider-specific URL when set', () => {
      process.env.OPENAI_RAG_API_URL = 'http://rag-openai:8100';
      process.env.GOOGLE_RAG_API_URL = 'http://rag-google:8102';
      jest.resetModules();
      const { getRagApiUrl: getUrl } = require('./routing');
      expect(getUrl('openAI')).toBe('http://rag-openai:8100');
      expect(getUrl('google')).toBe('http://rag-google:8102');
    });

    it('falls back to RAG_API_URL when the provider-specific var is not set', () => {
      process.env.RAG_API_URL = 'http://rag-default:8000';
      jest.resetModules();
      const { getRagApiUrl: getUrl } = require('./routing');
      expect(getUrl('google')).toBe('http://rag-default:8000');
    });

    it('returns the Azure-specific URL for Azure providers', () => {
      process.env.AZURE_OPENAI_RAG_API_URL = 'http://rag-azure:8101';
      jest.resetModules();
      const { getRagApiUrl: getUrl } = require('./routing');
      expect(getUrl('azure')).toBe('http://rag-azure:8101');
      expect(getUrl('azureOpenAI')).toBe('http://rag-azure:8101');
    });

    it('defaults to openAI when provider is unrecognized', () => {
      process.env.OPENAI_RAG_API_URL = 'http://rag-openai:8100';
      jest.resetModules();
      const { getRagApiUrl: getUrl } = require('./routing');
      expect(getUrl('anthropic')).toBe('http://rag-openai:8100');
    });
  });
});
