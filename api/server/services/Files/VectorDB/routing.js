const { EModelEndpoint } = require('librechat-data-provider');

const providerEnvMap = {
  [EModelEndpoint.openAI]: 'OPENAI_RAG_API_URL',
  [EModelEndpoint.azureOpenAI]: 'AZURE_OPENAI_RAG_API_URL',
  [EModelEndpoint.google]: 'GOOGLE_RAG_API_URL',
};

function normalizeRagProvider(value) {
  if (!value) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();

  if (
    normalized === 'openai' ||
    normalized === EModelEndpoint.openAI.toLowerCase() ||
    normalized === 'assistants'
  ) {
    return EModelEndpoint.openAI;
  }

  if (
    normalized === 'azure' ||
    normalized === 'azure-openai' ||
    normalized === EModelEndpoint.azureOpenAI.toLowerCase() ||
    normalized === 'azureassistants'
  ) {
    return EModelEndpoint.azureOpenAI;
  }

  if (
    normalized === 'google' ||
    normalized === 'gemini' ||
    normalized === EModelEndpoint.google.toLowerCase()
  ) {
    return EModelEndpoint.google;
  }

  return null;
}

function resolveRagProvider({ req, metadata = {} } = {}) {
  const override = normalizeRagProvider(
    req?.body?.embedding_provider ?? req?.query?.embedding_provider ?? metadata?.ragProvider,
  );
  if (override) {
    return override;
  }

  const endpointProvider = normalizeRagProvider(
    req?.body?.endpointType ??
      req?.body?.endpoint ??
      req?.query?.endpointType ??
      req?.query?.endpoint,
  );
  if (endpointProvider) {
    return endpointProvider;
  }

  return normalizeRagProvider(process.env.RAG_DEFAULT_PROVIDER) ?? EModelEndpoint.openAI;
}

function getRagApiUrl(provider) {
  const normalizedProvider = normalizeRagProvider(provider) ?? EModelEndpoint.openAI;
  const providerEnv = providerEnvMap[normalizedProvider];
  return process.env[providerEnv] || process.env.RAG_API_URL;
}

module.exports = {
  normalizeRagProvider,
  resolveRagProvider,
  getRagApiUrl,
};
