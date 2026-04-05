const { isUserProvided, resolveAzureOpenAIDirectConfig } = require('@librechat/api');
const { EModelEndpoint, removeNullishValues } = require('librechat-data-provider');
const { getUserKey, getUserKeyValues } = require('~/models');
const { getRagApiUrl, normalizeRagProvider, resolveRagProvider } = require('./routing');

const DEFAULT_EMBEDDING_MODELS = {
  [EModelEndpoint.openAI]: process.env.RAG_OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  [EModelEndpoint.azureOpenAI]:
    process.env.RAG_AZURE_EMBEDDING_MODEL ||
    process.env.RAG_OPENAI_EMBEDDING_MODEL ||
    'text-embedding-3-small',
  [EModelEndpoint.google]: process.env.RAG_GOOGLE_EMBEDDING_MODEL || 'gemini-embedding-001',
};

const PROVIDER_HEADER_MAP = {
  [EModelEndpoint.openAI]: 'openai',
  [EModelEndpoint.azureOpenAI]: 'azure',
  [EModelEndpoint.google]: 'google_genai',
};

function resolveEmbeddingModel({ req, provider, metadata = {} }) {
  return (
    req?.body?.embedding_model ??
    req?.query?.embedding_model ??
    metadata?.ragModel ??
    DEFAULT_EMBEDDING_MODELS[provider] ??
    DEFAULT_EMBEDDING_MODELS[EModelEndpoint.openAI]
  );
}

function parseGoogleUserKey(userKey) {
  if (!userKey) {
    return null;
  }

  if (typeof userKey === 'string') {
    try {
      const parsed = JSON.parse(userKey);
      return (
        parsed?.apiKey ??
        parsed?.GOOGLE_API_KEY ??
        parsed?.google_api_key ??
        parsed?.GOOGLE_KEY ??
        userKey
      );
    } catch {
      return userKey;
    }
  }

  return (
    userKey?.apiKey ??
    userKey?.GOOGLE_API_KEY ??
    userKey?.google_api_key ??
    userKey?.GOOGLE_KEY ??
    null
  );
}

async function resolveOpenAICredentials(req) {
  const rawApiKey = process.env.OPENAI_API_KEY;
  const rawBaseURL = process.env.OPENAI_REVERSE_PROXY;
  const userProvidesKey = isUserProvided(rawApiKey);
  const userProvidesURL = isUserProvided(rawBaseURL);

  const userValues =
    req?.user?.id && (userProvidesKey || userProvidesURL)
      ? await getUserKeyValues({ userId: req.user.id, name: EModelEndpoint.openAI }).catch(
          () => null,
        )
      : null;

  return removeNullishValues({
    apiKey: userProvidesKey ? userValues?.apiKey : rawApiKey,
    baseURL: userProvidesURL ? userValues?.baseURL : rawBaseURL,
  });
}

async function resolveAzureCredentials(req) {
  const rawApiKey = process.env.AZURE_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  const rawBaseURL = process.env.AZURE_OPENAI_BASEURL;
  const userProvidesKey = isUserProvided(rawApiKey);
  const userProvidesURL = isUserProvided(rawBaseURL);

  const userValues =
    req?.user?.id && (userProvidesKey || userProvidesURL)
      ? await getUserKeyValues({ userId: req.user.id, name: EModelEndpoint.azureOpenAI }).catch(
          () => null,
        )
      : null;

  const directConfig = resolveAzureOpenAIDirectConfig({
    apiKey: userProvidesKey ? userValues?.apiKey : rawApiKey,
    baseURL: userProvidesURL ? userValues?.baseURL : rawBaseURL,
    models: userValues?.models,
  });

  return removeNullishValues({
    apiKey: directConfig.apiKey,
    endpoint: directConfig.baseURL,
    apiVersion:
      directConfig.azureOptions?.azureOpenAIApiVersion ||
      process.env.AZURE_OPENAI_API_VERSION ||
      process.env.RAG_AZURE_OPENAI_API_VERSION ||
      '2023-05-15',
  });
}

async function resolveGoogleCredentials(req) {
  const rawApiKey =
    process.env.GOOGLE_KEY ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const userProvidesKey = isUserProvided(rawApiKey);
  const userKey =
    req?.user?.id && userProvidesKey
      ? await getUserKey({ userId: req.user.id, name: EModelEndpoint.google }).catch(() => null)
      : null;

  return removeNullishValues({
    apiKey: userProvidesKey ? parseGoogleUserKey(userKey) : parseGoogleUserKey(rawApiKey),
  });
}

async function getRagRequestConfig({ req, provider, metadata = {} }) {
  const resolvedProvider = normalizeRagProvider(provider) || resolveRagProvider({ req, metadata });
  const ragApiUrl = getRagApiUrl(resolvedProvider);
  const model = resolveEmbeddingModel({ req, provider: resolvedProvider, metadata });

  let credentials = {};
  if (resolvedProvider === EModelEndpoint.azureOpenAI) {
    credentials = await resolveAzureCredentials(req);
  } else if (resolvedProvider === EModelEndpoint.google) {
    credentials = await resolveGoogleCredentials(req);
  } else {
    credentials = await resolveOpenAICredentials(req);
  }

  const headers = removeNullishValues({
    'X-RAG-Embedding-Provider': PROVIDER_HEADER_MAP[resolvedProvider],
    'X-RAG-Embedding-Model': model,
    'X-RAG-OpenAI-API-Key': credentials.apiKey,
    'X-RAG-OpenAI-BaseURL': credentials.baseURL,
    'X-RAG-Azure-API-Key': credentials.apiKey,
    'X-RAG-Azure-Endpoint': credentials.endpoint,
    'X-RAG-Azure-API-Version': credentials.apiVersion,
    'X-RAG-Google-API-Key': credentials.apiKey,
  });

  return {
    provider: resolvedProvider,
    model,
    ragApiUrl,
    headers,
  };
}

module.exports = {
  getRagRequestConfig,
};
