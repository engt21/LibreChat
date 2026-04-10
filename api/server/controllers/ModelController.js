const { logger } = require('@librechat/data-schemas');
const {
  CacheKeys,
  EModelEndpoint,
  KnownEndpoints,
  extractEnvVariable,
  isXAIEndpointCandidate,
} = require('librechat-data-provider');
const {
  getGoogleModels,
  getOpenAIModels,
  resolveAzureOpenAIDirectConfig,
  isUserProvided,
} = require('@librechat/api');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');
const { getAppConfig } = require('~/server/services/Config/app');
const { filterModelsConfigForUser } = require('~/server/services/ModelAccess');
const { getUserKeyValues } = require('~/models');
const { getLogStores } = require('~/cache');

let hasCompletedStartupModelRefresh = false;

/**
 * @param {ServerRequest} req
 * @returns {Promise<TModelsConfig>} The models config.
 */
const getModelsConfig = async (req) => {
  const modelsConfig = await loadModels(req);
  return filterModelsConfigForUser(modelsConfig, req.user);
};

const getDynamicCustomEndpoints = (appConfig) => {
  const customEndpoints = Array.isArray(appConfig?.endpoints?.[EModelEndpoint.custom])
    ? appConfig.endpoints[EModelEndpoint.custom]
    : [];

  return customEndpoints.reduce(
    (acc, endpoint) => {
      const endpointName = endpoint?.name;

      if (
        !endpointName ||
        !isXAIEndpointCandidate({
          endpoint: endpointName,
          baseURL: extractEnvVariable(endpoint.baseURL ?? ''),
          defaultParamsEndpoint: endpoint.customParams?.defaultParamsEndpoint,
        })
      ) {
        return acc;
      }

      acc.names.push(endpointName);

      const apiKey = extractEnvVariable(endpoint.apiKey ?? '');
      const baseURL = extractEnvVariable(endpoint.baseURL ?? '');
      if (isUserProvided(apiKey) || isUserProvided(baseURL)) {
        acc.userProvidedNames.push(endpointName);
      }

      return acc;
    },
    { names: [], userProvidedNames: [] },
  );
};

const getStartupRefreshCustomEndpoints = (appConfig) => {
  const customEndpoints = Array.isArray(appConfig?.endpoints?.[EModelEndpoint.custom])
    ? appConfig.endpoints[EModelEndpoint.custom]
    : [];

  return customEndpoints.reduce(
    (acc, endpoint) => {
      const endpointName = endpoint?.name;

      if (!endpointName || endpoint?.models?.fetch !== true) {
        return acc;
      }

      acc.names.push(endpointName);

      const apiKey = extractEnvVariable(endpoint.apiKey ?? '');
      const baseURL = extractEnvVariable(endpoint.baseURL ?? '');
      if (isUserProvided(apiKey) || isUserProvided(baseURL)) {
        acc.userProvidedNames.push(endpointName);
      }

      return acc;
    },
    { names: [], userProvidedNames: [] },
  );
};

const getCustomEndpointRefreshState = (appConfig, includeStartupRefresh = false) => {
  const dynamicCustomEndpoints = getDynamicCustomEndpoints(appConfig);
  const startupRefreshCustomEndpoints = includeStartupRefresh
    ? getStartupRefreshCustomEndpoints(appConfig)
    : { names: [], userProvidedNames: [] };
  const names = [
    ...new Set([
      KnownEndpoints.ollama,
      ...dynamicCustomEndpoints.names,
      ...startupRefreshCustomEndpoints.names,
    ]),
  ];
  const userProvidedNames = [
    ...new Set([
      ...dynamicCustomEndpoints.userProvidedNames,
      ...startupRefreshCustomEndpoints.userProvidedNames,
    ]),
  ];

  return {
    names,
    userProvidedNames,
    cacheableNames: names.filter((endpointName) => !userProvidedNames.includes(endpointName)),
  };
};

const mergeEndpointModels = (baseConfig, endpointNames, nextConfig) =>
  endpointNames.reduce((acc, endpointName) => {
    if (nextConfig[endpointName] === undefined && baseConfig[endpointName] === undefined) {
      return acc;
    }

    acc[endpointName] = nextConfig[endpointName] ?? baseConfig[endpointName] ?? [];
    return acc;
  }, {});

const getAzureModelLoadState = async ({ req, appConfig, fallbackModels = [] }) => {
  if (appConfig?.endpoints?.[EModelEndpoint.azureOpenAI]) {
    return {
      models: fallbackModels,
      cacheableModels: fallbackModels,
      isUserProvided: false,
    };
  }

  const azureApiKey = process.env.AZURE_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  const azureBaseURL = process.env.AZURE_OPENAI_BASEURL;
  const userProvidesKey = isUserProvided(azureApiKey);
  const userProvidesURL = isUserProvided(azureBaseURL);

  let userValues = null;
  if ((userProvidesKey || userProvidesURL) && req.user?.id) {
    userValues = await getUserKeyValues({
      userId: req.user.id,
      name: EModelEndpoint.azureOpenAI,
    }).catch(() => null);
  }

  const directAzureConfig = resolveAzureOpenAIDirectConfig({
    apiKey: userProvidesKey ? userValues?.apiKey : azureApiKey,
    baseURL: userProvidesURL ? userValues?.baseURL : azureBaseURL,
    models: userValues?.models,
  });

  const azureApiVersion =
    directAzureConfig.azureOptions?.azureOpenAIApiVersion ||
    process.env.AZURE_OPENAI_API_VERSION;

  const cacheKey =
    userProvidesKey || userProvidesURL
      ? `${EModelEndpoint.azureOpenAI}:${req.user?.id ?? 'anonymous'}:${directAzureConfig.baseURL ?? 'default'}`
      : (directAzureConfig.baseURL ?? EModelEndpoint.azureOpenAI);

  const models = await getOpenAIModels({
    user: req.user?.id,
    azure: true,
    openAIApiKey: directAzureConfig.apiKey,
    baseURL: directAzureConfig.baseURL,
    manualModels: directAzureConfig.manualModels,
    azureApiVersion,
    cacheKey,
    userProvidedOpenAI:
      (userProvidesKey || userProvidesURL) &&
      (!directAzureConfig.apiKey || !directAzureConfig.baseURL),
  }).catch(() => fallbackModels);

  const cacheableModels =
    userProvidesKey || userProvidesURL
      ? await getOpenAIModels({ azure: true, userProvidedOpenAI: true }).catch(() => fallbackModels)
      : models;

  return {
    models,
    cacheableModels,
    isUserProvided: userProvidesKey || userProvidesURL,
  };
};

/**
 * Loads the models from the config.
 * @param {ServerRequest} req - The Express request object.
 * @returns {Promise<TModelsConfig>} The models config.
 */
async function loadModels(req) {
  const shouldForceStartupModelRefresh = hasCompletedStartupModelRefresh !== true;
  const completeStartupModelRefresh = (value) => {
    if (shouldForceStartupModelRefresh) {
      hasCompletedStartupModelRefresh = true;
    }

    return value;
  };
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const cachedModelsConfig = await cache.get(CacheKeys.MODELS_CONFIG);
  if (cachedModelsConfig) {
    const appConfig = await getAppConfig({ role: req.user?.role }).catch((error) => {
      logger.error('Error loading app config for model refresh:', error);
      return undefined;
    });
    const customEndpointRefreshState = getCustomEndpointRefreshState(
      appConfig,
      shouldForceStartupModelRefresh,
    );
    const dynamicEndpointNames = customEndpointRefreshState.names;
    const cacheableDynamicEndpointNames = customEndpointRefreshState.cacheableNames;
    const googleModels = await getGoogleModels().catch(
      () => cachedModelsConfig[EModelEndpoint.google],
    );
    const openAIModels = shouldForceStartupModelRefresh
      ? await getOpenAIModels({ user: req.user?.id, forceRefresh: true }).catch(
          () => cachedModelsConfig[EModelEndpoint.openAI] ?? [],
        )
      : (cachedModelsConfig[EModelEndpoint.openAI] ?? []);
    const assistantModels = shouldForceStartupModelRefresh
      ? await getOpenAIModels({ assistants: true, forceRefresh: true }).catch(
          () => cachedModelsConfig[EModelEndpoint.assistants] ?? [],
        )
      : (cachedModelsConfig[EModelEndpoint.assistants] ?? []);
    const azureModelLoadState = await getAzureModelLoadState({
      req,
      appConfig,
      fallbackModels: cachedModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
    }).catch(() => ({
      models: cachedModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
      cacheableModels: cachedModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
      isUserProvided: false,
    }));
    const dynamicConfigModels = await loadConfigModels(req, {
      endpointNames: dynamicEndpointNames,
      includeUserProvidedFetch: true,
    }).catch(() =>
      dynamicEndpointNames.reduce(
        (acc, endpointName) => ({
          ...acc,
          [endpointName]: cachedModelsConfig[endpointName],
        }),
        {},
      ),
    );
    const hasDynamicModelChanges = cacheableDynamicEndpointNames.some(
      (endpointName) =>
        JSON.stringify(cachedModelsConfig[endpointName] ?? []) !==
        JSON.stringify(dynamicConfigModels[endpointName] ?? []),
    );
    const hasUserSpecificDynamicChanges = customEndpointRefreshState.userProvidedNames.some(
      (endpointName) =>
        JSON.stringify(cachedModelsConfig[endpointName] ?? []) !==
        JSON.stringify(dynamicConfigModels[endpointName] ?? []),
    );
    const hasOpenAIModelChanges =
      JSON.stringify(cachedModelsConfig[EModelEndpoint.openAI] ?? []) !==
      JSON.stringify(openAIModels ?? []);
    const hasAssistantModelChanges =
      JSON.stringify(cachedModelsConfig[EModelEndpoint.assistants] ?? []) !==
      JSON.stringify(assistantModels ?? []);
    const hasAzureModelChanges =
      JSON.stringify(cachedModelsConfig[EModelEndpoint.azureOpenAI] ?? []) !==
      JSON.stringify(azureModelLoadState.cacheableModels ?? []);
    const hasUserSpecificAzureChanges =
      azureModelLoadState.isUserProvided &&
      JSON.stringify(cachedModelsConfig[EModelEndpoint.azureOpenAI] ?? []) !==
        JSON.stringify(azureModelLoadState.models ?? []);

    const responseModelsConfig = {
      ...cachedModelsConfig,
      [EModelEndpoint.openAI]: openAIModels ?? [],
      [EModelEndpoint.assistants]: assistantModels ?? [],
      [EModelEndpoint.google]: googleModels ?? [],
      [EModelEndpoint.azureOpenAI]: azureModelLoadState.models ?? [],
      ...mergeEndpointModels(cachedModelsConfig, dynamicEndpointNames, dynamicConfigModels),
    };

    if (
      hasOpenAIModelChanges ||
      hasAssistantModelChanges ||
      JSON.stringify(cachedModelsConfig[EModelEndpoint.google] ?? []) !==
        JSON.stringify(googleModels ?? []) ||
      hasDynamicModelChanges ||
      hasAzureModelChanges
    ) {
      const refreshedModelsConfig = {
        ...cachedModelsConfig,
        [EModelEndpoint.openAI]: openAIModels ?? [],
        [EModelEndpoint.assistants]: assistantModels ?? [],
        [EModelEndpoint.google]: googleModels ?? [],
        [EModelEndpoint.azureOpenAI]: azureModelLoadState.cacheableModels ?? [],
        ...mergeEndpointModels(
          cachedModelsConfig,
          cacheableDynamicEndpointNames,
          dynamicConfigModels,
        ),
      };

      await cache.set(CacheKeys.MODELS_CONFIG, refreshedModelsConfig);
      if (hasUserSpecificDynamicChanges || hasUserSpecificAzureChanges) {
        return completeStartupModelRefresh(responseModelsConfig);
      }

      return completeStartupModelRefresh(refreshedModelsConfig);
    }

    if (hasUserSpecificDynamicChanges || hasUserSpecificAzureChanges) {
      return completeStartupModelRefresh(responseModelsConfig);
    }

    return completeStartupModelRefresh(cachedModelsConfig);
  }
  const defaultModelsConfig = await loadDefaultModels(req, {
    forceOpenAIRefresh: shouldForceStartupModelRefresh,
  });
  const appConfig = await getAppConfig({ role: req.user?.role }).catch((error) => {
    logger.error('Error loading app config for initial model load:', error);
    return undefined;
  });
  const customModelsConfig = await loadConfigModels(req);
  const azureModelLoadState = await getAzureModelLoadState({
    req,
    appConfig,
    fallbackModels: defaultModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
  }).catch(() => ({
    models: defaultModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
    cacheableModels: defaultModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
    isUserProvided: false,
  }));

  defaultModelsConfig[EModelEndpoint.azureOpenAI] = azureModelLoadState.cacheableModels ?? [];

  const modelConfig = { ...defaultModelsConfig, ...customModelsConfig };

  const customEndpointRefreshState = getCustomEndpointRefreshState(
    appConfig,
    shouldForceStartupModelRefresh,
  );
  const dynamicEndpointNames = customEndpointRefreshState.names;

  let responseConfig = modelConfig;
  if (dynamicEndpointNames.length > 0) {
    const dynamicConfigModels = await loadConfigModels(req, {
      endpointNames: dynamicEndpointNames,
      includeUserProvidedFetch: true,
    }).catch(() => ({}));

    responseConfig = {
      ...modelConfig,
      [EModelEndpoint.azureOpenAI]: azureModelLoadState.models ?? [],
      ...mergeEndpointModels(modelConfig, dynamicEndpointNames, dynamicConfigModels),
    };
  } else {
    responseConfig = {
      ...modelConfig,
      [EModelEndpoint.azureOpenAI]: azureModelLoadState.models ?? [],
    };
  }

  await cache.set(CacheKeys.MODELS_CONFIG, modelConfig);
  return completeStartupModelRefresh(responseConfig);
}

async function modelController(req, res) {
  try {
    const modelConfig = await getModelsConfig(req);
    res.send(modelConfig);
  } catch (error) {
    logger.error('Error fetching models:', error);
    res.status(500).send({ error: error.message });
  }
}

module.exports = { modelController, loadModels, getModelsConfig };
