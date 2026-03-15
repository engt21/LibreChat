const { isUserProvided, fetchModels } = require('@librechat/api');
const {
  EModelEndpoint,
  KnownEndpoints,
  extractEnvVariable,
  normalizeEndpointName,
} = require('librechat-data-provider');
const { getAppConfig } = require('./app');

const isStrictOllamaEndpoint = (name, endpoint) =>
  name === KnownEndpoints.ollama && endpoint?.models?.fetch === true;

/**
 * Load config endpoints from the cached configuration object
 * @function loadConfigModels
 * @param {ServerRequest} req - The Express request object.
 * @param {{ endpointNames?: string[] }} [options] - Optional endpoint filter.
 */
async function loadConfigModels(req, options = {}) {
  const endpointNameFilter = Array.isArray(options.endpointNames)
    ? new Set(options.endpointNames.map((name) => normalizeEndpointName(name)))
    : null;
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

    const API_KEY = extractEnvVariable(apiKey);
    const BASE_URL = extractEnvVariable(baseURL);
    const BASE_URLS = Array.isArray(baseURLs) ? baseURLs.map((url) => extractEnvVariable(url)) : [];

    const uniqueKey = `${BASE_URL}__${JSON.stringify(BASE_URLS)}__${API_KEY}`;

    modelsConfig[name] = [];

    if (models.fetch && !isUserProvided(API_KEY) && !isUserProvided(BASE_URL)) {
      const strictOllamaDetection = isStrictOllamaEndpoint(name, endpoint);

      fetchPromisesMap[uniqueKey] =
        fetchPromisesMap[uniqueKey] ||
        fetchModels({
          name,
          apiKey: API_KEY,
          baseURL: BASE_URL,
          baseURLs: BASE_URLS,
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

    if (Array.isArray(models.default)) {
      modelsConfig[name] = models.default.map((model) =>
        typeof model === 'string' ? model : model.name,
      );
    }
  }

  const fetchedData = await Promise.all(Object.values(fetchPromisesMap));
  const uniqueKeys = Object.keys(fetchPromisesMap);

  for (let i = 0; i < fetchedData.length; i++) {
    const currentKey = uniqueKeys[i];
    const modelData = fetchedData[i];
    const associatedNames = uniqueKeyToEndpointsMap[currentKey];

    for (const name of associatedNames) {
      const endpoint = endpointsMap[name];

      if (isStrictOllamaEndpoint(name, endpoint)) {
        modelsConfig[name] = Array.isArray(modelData) ? modelData : [];
        continue;
      }

      modelsConfig[name] = !modelData?.length ? (endpoint.models.default ?? []) : modelData;
    }
  }

  return modelsConfig;
}

module.exports = loadConfigModels;
