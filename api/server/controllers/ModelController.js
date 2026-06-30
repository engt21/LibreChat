const { logger } = require('@librechat/data-schemas');
const {
  CacheKeys,
  EModelEndpoint,
  AuthKeys,
  KnownEndpoints,
  extractEnvVariable,
  isXAIEndpointCandidate,
} = require('librechat-data-provider');
const {
  getAnthropicModels,
  getGoogleModels,
  getOpenAIModels,
  resolveAzureOpenAIDirectConfig,
  isUserProvided,
} = require('@librechat/api');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');
const { getAppConfig } = require('~/server/services/Config/app');
const { filterModelsConfigForUser } = require('~/server/services/ModelAccess');
const { getUserKey, getUserKeyValues } = require('~/models');
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

const getRawUserKey = async (req, name) => {
  if (!req.user?.id) {
    return null;
  }

  const value = await Promise.resolve(
    getUserKey({
      userId: req.user.id,
      name,
    }),
  ).catch(() => null);

  return typeof value === 'string' && value.trim() ? value : null;
};

const parseUserKeyValues = (value) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const getAzureModelLoadState = async ({
  req,
  appConfig,
  fallbackModels = [],
  forceRefresh = false,
}) => {
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

  const rawUserKey = await getRawUserKey(req, EModelEndpoint.azureOpenAI);
  const userValues = parseUserKeyValues(rawUserKey);
  const hasUserApiKey = !!userValues?.apiKey;
  const hasUserBaseURL = !!userValues?.baseURL;
  const hasUserModels = !!userValues?.models;
  const useUserApiKey = hasUserApiKey || userProvidesKey;
  const useUserBaseURL = hasUserBaseURL || userProvidesURL;
  const isUserScopedDiscovery = useUserApiKey || useUserBaseURL || hasUserModels;

  const directAzureConfig = resolveAzureOpenAIDirectConfig({
    apiKey: useUserApiKey ? userValues?.apiKey : azureApiKey,
    baseURL: useUserBaseURL ? userValues?.baseURL : azureBaseURL,
    models: userValues?.models,
  });

  const azureApiVersion =
    directAzureConfig.azureOptions?.azureOpenAIApiVersion || process.env.AZURE_OPENAI_API_VERSION;

  const cacheKey = isUserScopedDiscovery
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
    forceRefresh,
    userProvidedOpenAI:
      isUserScopedDiscovery && (!directAzureConfig.apiKey || !directAzureConfig.baseURL),
  }).catch(() => fallbackModels);

  const cacheableModels = isUserScopedDiscovery
    ? await getOpenAIModels({ azure: true, userProvidedOpenAI: true }).catch(() => fallbackModels)
    : models;

  return {
    models,
    cacheableModels,
    isUserProvided: isUserScopedDiscovery,
  };
};

const getOpenAIUserValues = async (req) => {
  if (!req.user?.id) {
    return null;
  }

  const params = {
    userId: req.user.id,
    name: EModelEndpoint.openAI,
  };

  const values = await Promise.resolve(getUserKeyValues(params)).catch(() => null);
  if (values && typeof values === 'object') {
    return values;
  }

  const apiKey = await Promise.resolve(getUserKey(params)).catch(() => null);
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return { apiKey };
  }

  return null;
};

const getOpenAIModelLoadState = async ({ req, fallbackModels = [], forceRefresh = false }) => {
  const openAIApiKey = process.env.OPENAI_API_KEY;
  const openAIBaseURL = process.env.OPENAI_REVERSE_PROXY;
  const userProvidesKey = isUserProvided(openAIApiKey);
  const userProvidesURL = isUserProvided(openAIBaseURL);

  const userValues = await getOpenAIUserValues(req);

  const hasUserApiKey = !!userValues?.apiKey;
  const hasUserBaseURL = !!userValues?.baseURL;
  const useUserApiKey = hasUserApiKey || userProvidesKey;
  const useUserBaseURL = hasUserBaseURL || userProvidesURL;
  const isUserScopedDiscovery = useUserApiKey || useUserBaseURL;
  const apiKey = useUserApiKey ? userValues?.apiKey : openAIApiKey;
  const baseURL = useUserBaseURL ? userValues?.baseURL : openAIBaseURL;
  const canDiscoverWithoutKey = !!baseURL && !userProvidesURL;
  const cacheKey = isUserScopedDiscovery
    ? `${EModelEndpoint.openAI}:${req.user?.id ?? 'anonymous'}:${baseURL ?? 'default'}`
    : undefined;

  const models = await getOpenAIModels({
    user: req.user?.id,
    openAIApiKey: apiKey,
    baseURL,
    cacheKey,
    forceRefresh,
    userProvidedOpenAI:
      (userProvidesKey && !apiKey) ||
      (userProvidesURL && !baseURL) ||
      (!openAIApiKey && !apiKey && !canDiscoverWithoutKey),
  }).catch(() => fallbackModels);

  const cacheableModels = isUserScopedDiscovery
    ? await getOpenAIModels({ userProvidedOpenAI: true }).catch(() => fallbackModels)
    : models;

  return {
    models,
    cacheableModels,
    isUserProvided: isUserScopedDiscovery,
  };
};

const getAnthropicModelLoadState = async ({
  req,
  appConfig,
  fallbackModels = [],
  forceRefresh = false,
}) => {
  const vertexModels = appConfig?.endpoints?.[EModelEndpoint.anthropic]?.vertexConfig?.modelNames;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const userProvidesKey = isUserProvided(anthropicApiKey);

  const userApiKey = await getRawUserKey(req, EModelEndpoint.anthropic);
  const useUserApiKey = !!userApiKey || userProvidesKey;

  const apiKey = useUserApiKey ? userApiKey : anthropicApiKey;
  const baseURL = process.env.ANTHROPIC_REVERSE_PROXY;
  const cacheKey = useUserApiKey
    ? `${EModelEndpoint.anthropic}:${req.user?.id ?? 'anonymous'}:${baseURL ?? 'default'}`
    : undefined;

  const models = await getAnthropicModels({
    user: req.user?.id,
    vertexModels,
    anthropicApiKey: apiKey,
    baseURL,
    cacheKey,
    forceRefresh,
    userProvidedAnthropic: useUserApiKey && !apiKey,
  }).catch(() => fallbackModels);

  const cacheableModels = useUserApiKey
    ? await getAnthropicModels({ vertexModels, userProvidedAnthropic: true }).catch(
        () => fallbackModels,
      )
    : models;

  return {
    models,
    cacheableModels,
    isUserProvided: useUserApiKey,
  };
};

const getGoogleModelLoadState = async ({ req, fallbackModels = [], forceRefresh = false }) => {
  const googleApiKey = process.env.GOOGLE_KEY;
  const userProvidesKey = isUserProvided(googleApiKey);
  const rawUserKey = await getRawUserKey(req, EModelEndpoint.google);
  const userValues = parseUserKeyValues(rawUserKey);
  const userApiKey = userValues?.[AuthKeys.GOOGLE_API_KEY] ?? (userValues ? null : rawUserKey);
  const useUserApiKey = !!userApiKey || userProvidesKey;
  const apiKey = useUserApiKey ? userApiKey : googleApiKey;
  const cacheKey = useUserApiKey
    ? `${EModelEndpoint.google}:${req.user?.id ?? 'anonymous'}:capabilities`
    : undefined;

  const models = await getGoogleModels({
    googleApiKey: apiKey,
    cacheKey,
    forceRefresh,
    userProvidedGoogle: useUserApiKey && !apiKey,
  }).catch(() => fallbackModels);

  const cacheableModels = useUserApiKey
    ? await getGoogleModels({ userProvidedGoogle: true }).catch(() => fallbackModels)
    : models;

  return {
    models,
    cacheableModels,
    isUserProvided: useUserApiKey,
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
    const openAIModelLoadState = await getOpenAIModelLoadState({
      req,
      fallbackModels: cachedModelsConfig[EModelEndpoint.openAI] ?? [],
      forceRefresh: shouldForceStartupModelRefresh,
    }).catch(() => ({
      models: cachedModelsConfig[EModelEndpoint.openAI] ?? [],
      cacheableModels: cachedModelsConfig[EModelEndpoint.openAI] ?? [],
      isUserProvided: false,
    }));
    const anthropicModelLoadState = await getAnthropicModelLoadState({
      req,
      appConfig,
      fallbackModels: cachedModelsConfig[EModelEndpoint.anthropic] ?? [],
      forceRefresh: shouldForceStartupModelRefresh,
    }).catch(() => ({
      models: cachedModelsConfig[EModelEndpoint.anthropic] ?? [],
      cacheableModels: cachedModelsConfig[EModelEndpoint.anthropic] ?? [],
      isUserProvided: false,
    }));
    const googleModelLoadState = await getGoogleModelLoadState({
      req,
      fallbackModels: cachedModelsConfig[EModelEndpoint.google] ?? [],
      forceRefresh: shouldForceStartupModelRefresh,
    }).catch(() => ({
      models: cachedModelsConfig[EModelEndpoint.google] ?? [],
      cacheableModels: cachedModelsConfig[EModelEndpoint.google] ?? [],
      isUserProvided: false,
    }));
    const assistantModels = shouldForceStartupModelRefresh
      ? await getOpenAIModels({ assistants: true, forceRefresh: true }).catch(
          () => cachedModelsConfig[EModelEndpoint.assistants] ?? [],
        )
      : (cachedModelsConfig[EModelEndpoint.assistants] ?? []);
    const azureModelLoadState = await getAzureModelLoadState({
      req,
      appConfig,
      fallbackModels: cachedModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
      forceRefresh: shouldForceStartupModelRefresh,
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
      JSON.stringify(openAIModelLoadState.cacheableModels ?? []);
    const hasUserSpecificOpenAIChanges =
      openAIModelLoadState.isUserProvided &&
      JSON.stringify(cachedModelsConfig[EModelEndpoint.openAI] ?? []) !==
        JSON.stringify(openAIModelLoadState.models ?? []);
    const hasAnthropicModelChanges =
      JSON.stringify(cachedModelsConfig[EModelEndpoint.anthropic] ?? []) !==
      JSON.stringify(anthropicModelLoadState.cacheableModels ?? []);
    const hasUserSpecificAnthropicChanges =
      anthropicModelLoadState.isUserProvided &&
      JSON.stringify(cachedModelsConfig[EModelEndpoint.anthropic] ?? []) !==
        JSON.stringify(anthropicModelLoadState.models ?? []);
    const hasGoogleModelChanges =
      JSON.stringify(cachedModelsConfig[EModelEndpoint.google] ?? []) !==
      JSON.stringify(googleModelLoadState.cacheableModels ?? []);
    const hasUserSpecificGoogleChanges =
      googleModelLoadState.isUserProvided &&
      JSON.stringify(cachedModelsConfig[EModelEndpoint.google] ?? []) !==
        JSON.stringify(googleModelLoadState.models ?? []);
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
      [EModelEndpoint.openAI]: openAIModelLoadState.models ?? [],
      [EModelEndpoint.anthropic]: anthropicModelLoadState.models ?? [],
      [EModelEndpoint.assistants]: assistantModels ?? [],
      [EModelEndpoint.google]: googleModelLoadState.models ?? [],
      [EModelEndpoint.azureOpenAI]: azureModelLoadState.models ?? [],
      ...mergeEndpointModels(cachedModelsConfig, dynamicEndpointNames, dynamicConfigModels),
    };

    if (
      hasOpenAIModelChanges ||
      hasAnthropicModelChanges ||
      hasAssistantModelChanges ||
      hasGoogleModelChanges ||
      hasDynamicModelChanges ||
      hasAzureModelChanges
    ) {
      const refreshedModelsConfig = {
        ...cachedModelsConfig,
        [EModelEndpoint.openAI]: openAIModelLoadState.cacheableModels ?? [],
        [EModelEndpoint.anthropic]: anthropicModelLoadState.cacheableModels ?? [],
        [EModelEndpoint.assistants]: assistantModels ?? [],
        [EModelEndpoint.google]: googleModelLoadState.cacheableModels ?? [],
        [EModelEndpoint.azureOpenAI]: azureModelLoadState.cacheableModels ?? [],
        ...mergeEndpointModels(
          cachedModelsConfig,
          cacheableDynamicEndpointNames,
          dynamicConfigModels,
        ),
      };

      await cache.set(CacheKeys.MODELS_CONFIG, refreshedModelsConfig);
      if (
        hasUserSpecificDynamicChanges ||
        hasUserSpecificAzureChanges ||
        hasUserSpecificOpenAIChanges ||
        hasUserSpecificAnthropicChanges ||
        hasUserSpecificGoogleChanges
      ) {
        return completeStartupModelRefresh(responseModelsConfig);
      }

      return completeStartupModelRefresh(refreshedModelsConfig);
    }

    if (
      hasUserSpecificDynamicChanges ||
      hasUserSpecificAzureChanges ||
      hasUserSpecificOpenAIChanges ||
      hasUserSpecificAnthropicChanges ||
      hasUserSpecificGoogleChanges
    ) {
      return completeStartupModelRefresh(responseModelsConfig);
    }

    return completeStartupModelRefresh(cachedModelsConfig);
  }
  const defaultModelsConfig = await loadDefaultModels(req, {
    forceOpenAIRefresh: shouldForceStartupModelRefresh,
    forceAnthropicRefresh: shouldForceStartupModelRefresh,
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
    forceRefresh: shouldForceStartupModelRefresh,
  }).catch(() => ({
    models: defaultModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
    cacheableModels: defaultModelsConfig[EModelEndpoint.azureOpenAI] ?? [],
    isUserProvided: false,
  }));
  const openAIModelLoadState = await getOpenAIModelLoadState({
    req,
    fallbackModels: defaultModelsConfig[EModelEndpoint.openAI] ?? [],
    forceRefresh: shouldForceStartupModelRefresh,
  }).catch(() => ({
    models: defaultModelsConfig[EModelEndpoint.openAI] ?? [],
    cacheableModels: defaultModelsConfig[EModelEndpoint.openAI] ?? [],
    isUserProvided: false,
  }));
  const anthropicModelLoadState = await getAnthropicModelLoadState({
    req,
    appConfig,
    fallbackModels: defaultModelsConfig[EModelEndpoint.anthropic] ?? [],
    forceRefresh: shouldForceStartupModelRefresh,
  }).catch(() => ({
    models: defaultModelsConfig[EModelEndpoint.anthropic] ?? [],
    cacheableModels: defaultModelsConfig[EModelEndpoint.anthropic] ?? [],
    isUserProvided: false,
  }));
  const googleModelLoadState = await getGoogleModelLoadState({
    req,
    fallbackModels: defaultModelsConfig[EModelEndpoint.google] ?? [],
    forceRefresh: shouldForceStartupModelRefresh,
  }).catch(() => ({
    models: defaultModelsConfig[EModelEndpoint.google] ?? [],
    cacheableModels: defaultModelsConfig[EModelEndpoint.google] ?? [],
    isUserProvided: false,
  }));

  defaultModelsConfig[EModelEndpoint.openAI] = openAIModelLoadState.cacheableModels ?? [];
  defaultModelsConfig[EModelEndpoint.anthropic] = anthropicModelLoadState.cacheableModels ?? [];
  defaultModelsConfig[EModelEndpoint.google] = googleModelLoadState.cacheableModels ?? [];
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
      [EModelEndpoint.openAI]: openAIModelLoadState.models ?? [],
      [EModelEndpoint.anthropic]: anthropicModelLoadState.models ?? [],
      [EModelEndpoint.google]: googleModelLoadState.models ?? [],
      [EModelEndpoint.azureOpenAI]: azureModelLoadState.models ?? [],
      ...mergeEndpointModels(modelConfig, dynamicEndpointNames, dynamicConfigModels),
    };
  } else {
    responseConfig = {
      ...modelConfig,
      [EModelEndpoint.openAI]: openAIModelLoadState.models ?? [],
      [EModelEndpoint.anthropic]: anthropicModelLoadState.models ?? [],
      [EModelEndpoint.google]: googleModelLoadState.models ?? [],
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

/**
 * Resets the in-process startup-refresh latch so the next call to {@link loadModels}
 * forces a live re-fetch from every provider. Used by the admin "refresh models"
 * action to bypass the once-per-process cache shortcut.
 */
function resetStartupModelRefresh() {
  hasCompletedStartupModelRefresh = false;
}

module.exports = { modelController, loadModels, getModelsConfig, resetStartupModelRefresh };
