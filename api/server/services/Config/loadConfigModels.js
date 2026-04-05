const {
  isUserProvided,
  fetchModels,
  standardCache,
  filterOpenAITextCompatibleModels,
} = require('@librechat/api');
const {
  CacheKeys,
  EModelEndpoint,
  KnownEndpoints,
  extractEnvVariable,
  normalizeEndpointName,
} = require('librechat-data-provider');
const { getUserKeyValues } = require('~/models');
const { getAppConfig } = require('./app');

const OLLAMA_CLOUD_TAG = ' ☁';
const OLLAMA_SOURCES_CACHE_PREFIX = `${KnownEndpoints.ollama}:sources:`;

function isOllamaCloudSource(sourceURL) {
  try {
    return new URL(sourceURL).hostname === 'ollama.com';
  } catch {
    return false;
  }
}

function stripOllamaCloudTag(model) {
  return typeof model === 'string' && model.endsWith(OLLAMA_CLOUD_TAG)
    ? model.slice(0, -OLLAMA_CLOUD_TAG.length)
    : model;
}

async function tagOllamaCloudModels(models, tokenKey) {
  if (!Array.isArray(models) || models.length === 0) {
    return models;
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const sourceMap = await modelsCache.get(`${OLLAMA_SOURCES_CACHE_PREFIX}${tokenKey}`);
  if (!sourceMap || typeof sourceMap !== 'object') {
    return models;
  }

  return models.map((model) => {
    const source = sourceMap[model];
    if (source && isOllamaCloudSource(source)) {
      return `${model}${OLLAMA_CLOUD_TAG}`;
    }
    return model;
  });
}

const isStrictOllamaEndpoint = (name, endpoint) =>
  name === KnownEndpoints.ollama && endpoint?.models?.fetch === true;

const isOpenAICompatibleEndpoint = (name, endpoint) => {
  const defaultParamsEndpoint = (endpoint?.customParams?.defaultParamsEndpoint ?? '')
    .trim()
    .toLowerCase();

  return defaultParamsEndpoint === EModelEndpoint.openAI.toLowerCase();
};

const getDefaultModels = (models = {}) =>
  Array.isArray(models.default)
    ? models.default.map((model) => (typeof model === 'string' ? model : model.name))
    : [];

async function resolveCustomEndpointValues(req, endpoint, includeUserProvidedFetch) {
  const resolvedValues = {
    apiKey: extractEnvVariable(endpoint.apiKey),
    baseURL: extractEnvVariable(endpoint.baseURL),
    baseURLs: Array.isArray(endpoint.baseURLs)
      ? endpoint.baseURLs.map((url) => extractEnvVariable(url))
      : [],
  };

  if (
    includeUserProvidedFetch !== true ||
    !req.user?.id ||
    !endpoint.name ||
    (!isUserProvided(resolvedValues.apiKey) && !isUserProvided(resolvedValues.baseURL))
  ) {
    return resolvedValues;
  }

  const userValues = await getUserKeyValues({
    userId: req.user.id,
    name: endpoint.name,
  }).catch(() => null);

  return {
    apiKey: isUserProvided(resolvedValues.apiKey)
      ? (userValues?.apiKey ?? '')
      : resolvedValues.apiKey,
    baseURL: isUserProvided(resolvedValues.baseURL)
      ? (userValues?.baseURL ?? '')
      : resolvedValues.baseURL,
    baseURLs: resolvedValues.baseURLs,
  };
}

/**
 * Load config endpoints from the cached configuration object
 * @function loadConfigModels
 * @param {ServerRequest} req - The Express request object.
 * @param {{ endpointNames?: string[], includeUserProvidedFetch?: boolean }} [options] - Optional endpoint filter.
 */
async function loadConfigModels(req, options = {}) {
  const endpointNameFilter = Array.isArray(options.endpointNames)
    ? new Set(options.endpointNames.map((name) => normalizeEndpointName(name)))
    : null;
  const includeUserProvidedFetch = options.includeUserProvidedFetch === true;
  const appConfig = await getAppConfig({ role: req.user?.role });
  if (!appConfig) {
    return {};
  }
  const modelsConfig = {};
  const includeEndpoint = (name) => !endpointNameFilter || endpointNameFilter.has(name);
  const azureConfig = appConfig.endpoints?.[EModelEndpoint.azureOpenAI];
  const { modelNames } = azureConfig ?? {};

  if (includeEndpoint(EModelEndpoint.azureOpenAI) && modelNames && azureConfig) {
    modelsConfig[EModelEndpoint.azureOpenAI] = modelNames;
  }

  if (
    includeEndpoint(EModelEndpoint.azureAssistants) &&
    azureConfig?.assistants &&
    azureConfig.assistantModels
  ) {
    modelsConfig[EModelEndpoint.azureAssistants] = azureConfig.assistantModels;
  }

  const bedrockConfig = appConfig.endpoints?.[EModelEndpoint.bedrock];
  if (
    includeEndpoint(EModelEndpoint.bedrock) &&
    bedrockConfig?.models &&
    Array.isArray(bedrockConfig.models)
  ) {
    modelsConfig[EModelEndpoint.bedrock] = bedrockConfig.models;
  }

  if (!Array.isArray(appConfig.endpoints?.[EModelEndpoint.custom])) {
    return modelsConfig;
  }

  const customEndpoints = appConfig.endpoints[EModelEndpoint.custom].filter((endpoint) => {
    const normalizedName = normalizeEndpointName(endpoint.name);

    return (
      endpoint.baseURL &&
      endpoint.apiKey &&
      endpoint.name &&
      endpoint.models &&
      (endpoint.models.fetch || endpoint.models.default) &&
      includeEndpoint(normalizedName)
    );
  });

  /**
   * @type {Record<string, Promise<string[]>>}
   * Map for promises keyed by unique combination of baseURL and apiKey */
  const fetchPromisesMap = {};
  /**
   * @type {Record<string, string[]>}
   * Map to associate unique keys with endpoint names; note: one key may can correspond to multiple endpoints */
  const uniqueKeyToEndpointsMap = {};
  /**
   * @type {Record<string, Partial<TEndpoint>>}
   * Map to associate endpoint names to their configurations */
  const endpointsMap = {};

  for (let i = 0; i < customEndpoints.length; i++) {
    const endpoint = customEndpoints[i];
    const {
      models,
      name: configName,
      baseURL,
      baseURLs,
      apiKey,
      headers: endpointHeaders,
    } = endpoint;
    const name = normalizeEndpointName(configName);
    endpointsMap[name] = endpoint;

    const {
      apiKey: resolvedApiKey,
      baseURL: resolvedBaseURL,
      baseURLs: resolvedBaseURLs,
    } = await resolveCustomEndpointValues(
      req,
      { ...endpoint, apiKey, baseURL, baseURLs },
      includeUserProvidedFetch,
    );

    const uniqueKey = `${resolvedBaseURL}__${JSON.stringify(resolvedBaseURLs)}__${resolvedApiKey}`;

    modelsConfig[name] = [];

    if (
      models.fetch &&
      resolvedApiKey &&
      resolvedBaseURL &&
      !isUserProvided(resolvedApiKey) &&
      !isUserProvided(resolvedBaseURL)
    ) {
      const strictOllamaDetection = isStrictOllamaEndpoint(name, endpoint);

      fetchPromisesMap[uniqueKey] =
        fetchPromisesMap[uniqueKey] ||
        fetchModels({
          name,
          apiKey: resolvedApiKey,
          baseURL: resolvedBaseURL,
          baseURLs: resolvedBaseURLs,
          user: req.user.id,
          userObject: req.user,
          headers: endpointHeaders,
          direct: endpoint.directEndpoint,
          userIdQuery: models.userIdQuery,
          disableOllamaFallback: strictOllamaDetection,
        });
      uniqueKeyToEndpointsMap[uniqueKey] = uniqueKeyToEndpointsMap[uniqueKey] || [];
      uniqueKeyToEndpointsMap[uniqueKey].push(name);
      continue;
    }

    modelsConfig[name] = getDefaultModels(models);
  }

  const fetchedData = await Promise.all(Object.values(fetchPromisesMap));
  const uniqueKeys = Object.keys(fetchPromisesMap);

  for (let i = 0; i < fetchedData.length; i++) {
    const currentKey = uniqueKeys[i];
    const modelData = fetchedData[i];
    const associatedNames = uniqueKeyToEndpointsMap[currentKey];

    for (const name of associatedNames) {
      const endpoint = endpointsMap[name];
      const discoveredModels = Array.isArray(modelData) ? modelData : [];
      const filteredDiscoveredModels = isOpenAICompatibleEndpoint(name, endpoint)
        ? filterOpenAITextCompatibleModels(discoveredModels)
        : discoveredModels;

      if (isStrictOllamaEndpoint(name, endpoint)) {
        modelsConfig[name] = await tagOllamaCloudModels(discoveredModels, name);
        continue;
      }

      modelsConfig[name] = !filteredDiscoveredModels.length
        ? getDefaultModels(endpoint.models)
        : filteredDiscoveredModels;
    }
  }

  return modelsConfig;
}

module.exports = loadConfigModels;
module.exports.stripOllamaCloudTag = stripOllamaCloudTag;
module.exports.OLLAMA_CLOUD_TAG = OLLAMA_CLOUD_TAG;
