const axios = require('axios');
const {
  EModelEndpoint,
  extractEnvVariable,
  isXAIEndpointCandidate,
  mapModelToAzureConfig,
  normalizeGoogleModelName,
} = require('librechat-data-provider');
const {
  constructAzureURL,
  extractBaseURL,
  fetchModels,
  isUserProvided,
  normalizeAzureOpenAIBaseURL,
  prepareGoogleCredentials,
  resolveAzureOpenAIDirectConfig,
  resolveGoogleClientAuth,
  splitAndTrim,
  supportsAzureOpenAIModelListing,
} = require('@librechat/api');
const { getUserKeyValues } = require('~/models');
const {
  ALL_MODELS,
  hasModelRestrictions,
  getAllowedModelsMap,
} = require('~/server/services/ModelAccess');
const {
  DEFAULT_GEMINI_REALTIME_MODELS,
  DEFAULT_OPENAI_REALTIME_MODELS,
  DEFAULT_PROVIDER_AUDIO,
  DEFAULT_XAI_REALTIME_MODELS,
  isGoogleRealtimeModel,
  isOpenAIRealtimeModel,
  isXAIRealtimeModel,
  uniqueModels,
} = require('./constants');

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const getXAIEndpointConfigs = (appConfig) => {
  const customEndpoints = Array.isArray(appConfig?.endpoints?.[EModelEndpoint.custom])
    ? appConfig.endpoints[EModelEndpoint.custom]
    : [];

  return customEndpoints.filter((endpoint) => {
    const endpointName = endpoint?.name;
    const baseURL = extractEnvVariable(endpoint?.baseURL ?? '');

    return (
      endpointName &&
      isXAIEndpointCandidate({
        endpoint: endpointName,
        baseURL,
        defaultParamsEndpoint: endpoint.customParams?.defaultParamsEndpoint,
      })
    );
  });
};

async function getUserValues(req, name) {
  if (!req.user?.id || !name) {
    return null;
  }

  return getUserKeyValues({ userId: req.user.id, name }).catch(() => null);
}

async function resolveGoogleRealtimeAuth({ userValues }) {
  const rawApiKey = process.env.GOOGLE_KEY;
  const requiresUserKey = isUserProvided(rawApiKey);
  const preparedCredentials = await prepareGoogleCredentials({
    credentials: requiresUserKey ? (userValues ?? undefined) : undefined,
    rawApiKey: requiresUserKey ? undefined : rawApiKey,
  });

  return {
    requiresUserKey,
    auth: resolveGoogleClientAuth(preparedCredentials),
  };
}

function buildRealtimeDescriptor({
  endpoint,
  provider,
  label,
  models,
  audioConfig,
  available = true,
  requiresUserKey = false,
  reason,
}) {
  const unique = uniqueModels(models);

  if (unique.length === 0 && !requiresUserKey) {
    return null;
  }

  return {
    endpoint,
    provider,
    label,
    available,
    requiresUserKey,
    reason,
    models: unique,
    defaultModel: unique[0],
    ...audioConfig,
  };
}

async function fetchOpenAIRealtimeModels({ apiKey, baseURL, tokenKey, endpointName }) {
  if (!apiKey || !baseURL) {
    return [];
  }

  const models = await fetchModels({
    apiKey,
    baseURL,
    tokenKey,
    name: endpointName,
  }).catch(() => []);

  return models.filter(isOpenAIRealtimeModel);
}

async function fetchAzureRealtimeModels({ apiKey, baseURL, tokenKey }) {
  if (!apiKey || !baseURL || !supportsAzureOpenAIModelListing(baseURL)) {
    return [];
  }

  const models = await fetchModels({
    apiKey,
    baseURL,
    azure: true,
    tokenKey,
    name: EModelEndpoint.azureOpenAI,
  }).catch(() => []);

  return models.filter(isOpenAIRealtimeModel);
}

async function fetchGoogleRealtimeModels(apiKey) {
  if (!apiKey) {
    return [];
  }

  const url = new URL(GOOGLE_MODELS_URL);
  url.searchParams.set('key', apiKey);

  const response = await axios.get(url.toString(), { timeout: 5000 });
  const models = Array.isArray(response.data?.models) ? response.data.models : [];

  return models.map((model) => normalizeGoogleModelName(model?.name)).filter(isGoogleRealtimeModel);
}

async function fetchXAIRealtimeModels({ apiKey, baseURL, tokenKey, endpointName }) {
  if (!apiKey || !baseURL) {
    return [];
  }

  const models = await fetchModels({
    apiKey,
    baseURL,
    tokenKey,
    name: endpointName,
  }).catch(() => []);

  return models.filter(isXAIRealtimeModel);
}

function hasAzureConfiguredRealtimeAccess(azureConfig, realtimeModels) {
  if (!azureConfig?.groupMap || !azureConfig?.modelGroupMap || realtimeModels.length === 0) {
    return false;
  }

  return realtimeModels.some((modelName) => {
    try {
      const mapped = mapModelToAzureConfig({
        modelName,
        modelGroupMap: azureConfig.modelGroupMap,
        groupMap: azureConfig.groupMap,
      });

      return Boolean(
        mapped?.azureOptions?.azureOpenAIApiKey &&
        (mapped?.baseURL || mapped?.azureOptions?.azureOpenAIApiInstanceName),
      );
    } catch {
      return false;
    }
  });
}

async function getOpenAIRealtimeProvider(req) {
  const rawApiKey = process.env.OPENAI_API_KEY;
  const configuredModels = splitAndTrim(process.env.OPENAI_MODELS).filter(isOpenAIRealtimeModel);
  const requiresUserKey = isUserProvided(rawApiKey);

  if (!rawApiKey && configuredModels.length === 0) {
    return null;
  }

  const userValues = requiresUserKey ? await getUserValues(req, EModelEndpoint.openAI) : null;
  const apiKey = requiresUserKey ? userValues?.apiKey : rawApiKey;
  const baseURL = extractBaseURL(process.env.OPENAI_REVERSE_PROXY ?? '') ?? OPENAI_DEFAULT_BASE_URL;

  let models = configuredModels;
  if (models.length === 0 && apiKey) {
    models = await fetchOpenAIRealtimeModels({
      apiKey,
      baseURL,
      tokenKey: `realtime:${EModelEndpoint.openAI}:${req.user?.id ?? 'server'}`,
      endpointName: EModelEndpoint.openAI,
    });
  }

  if (models.length === 0 && (apiKey || requiresUserKey)) {
    models = DEFAULT_OPENAI_REALTIME_MODELS;
  }

  return buildRealtimeDescriptor({
    endpoint: EModelEndpoint.openAI,
    provider: 'openai',
    label: 'OpenAI',
    models,
    audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.openAI],
    available: Boolean(apiKey),
    requiresUserKey,
    reason:
      requiresUserKey && !apiKey
        ? 'Add your OpenAI key in LibreChat settings to use realtime voice.'
        : undefined,
  });
}

async function getAzureRealtimeProvider(req, appConfig) {
  const azureConfig = appConfig?.endpoints?.[EModelEndpoint.azureOpenAI];

  if (azureConfig?.modelNames) {
    const models = azureConfig.modelNames.filter(isOpenAIRealtimeModel);
    const available = hasAzureConfiguredRealtimeAccess(azureConfig, models);

    return buildRealtimeDescriptor({
      endpoint: EModelEndpoint.azureOpenAI,
      provider: 'azure',
      label: 'Azure OpenAI',
      models,
      audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.azureOpenAI],
      available,
      reason: available
        ? undefined
        : 'Azure OpenAI realtime models are configured, but no valid Azure realtime credentials were resolved.',
    });
  }

  const rawApiKey = process.env.AZURE_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  const rawBaseURL = process.env.AZURE_OPENAI_BASEURL;
  const envModels = splitAndTrim(process.env.AZURE_OPENAI_MODELS).filter(isOpenAIRealtimeModel);
  const requiresUserKey = isUserProvided(rawApiKey) || isUserProvided(rawBaseURL);

  if (!rawApiKey && !rawBaseURL && envModels.length === 0) {
    return null;
  }

  const userValues = requiresUserKey ? await getUserValues(req, EModelEndpoint.azureOpenAI) : null;
  const directConfig = resolveAzureOpenAIDirectConfig({
    apiKey: isUserProvided(rawApiKey) ? userValues?.apiKey : rawApiKey,
    baseURL: isUserProvided(rawBaseURL) ? userValues?.baseURL : rawBaseURL,
    models: userValues?.models,
  });

  let models =
    envModels.length > 0 ? envModels : directConfig.manualModels.filter(isOpenAIRealtimeModel);
  if (models.length === 0 && directConfig.apiKey && directConfig.baseURL) {
    models = await fetchAzureRealtimeModels({
      apiKey: directConfig.apiKey,
      baseURL: directConfig.baseURL,
      tokenKey: `realtime:${EModelEndpoint.azureOpenAI}:${req.user?.id ?? 'server'}`,
    });
  }

  if (models.length === 0 && (directConfig.apiKey || requiresUserKey)) {
    models = DEFAULT_OPENAI_REALTIME_MODELS;
  }

  return buildRealtimeDescriptor({
    endpoint: EModelEndpoint.azureOpenAI,
    provider: 'azure',
    label: 'Azure OpenAI',
    models,
    audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.azureOpenAI],
    available: Boolean(directConfig.apiKey && (directConfig.baseURL || directConfig.azureOptions)),
    requiresUserKey,
    reason:
      requiresUserKey && (!directConfig.apiKey || !directConfig.baseURL)
        ? 'Add your Azure OpenAI key and base URL in LibreChat settings to use realtime voice.'
        : undefined,
  });
}

async function getGoogleRealtimeProvider(req) {
  const rawApiKey = process.env.GOOGLE_KEY;
  const configuredModels = splitAndTrim(process.env.GOOGLE_MODELS).filter(isGoogleRealtimeModel);
  const userValues = isUserProvided(rawApiKey)
    ? await getUserValues(req, EModelEndpoint.google)
    : null;
  const { requiresUserKey, auth } = await resolveGoogleRealtimeAuth({ userValues });

  if (!requiresUserKey && !auth.isConfigured && configuredModels.length === 0) {
    return null;
  }

  let models = configuredModels;
  if (models.length === 0 && auth.apiKey) {
    models = await fetchGoogleRealtimeModels(auth.apiKey).catch(() => []);
  }

  if (models.length === 0 && (auth.isConfigured || requiresUserKey)) {
    models = DEFAULT_GEMINI_REALTIME_MODELS;
  }

  return buildRealtimeDescriptor({
    endpoint: EModelEndpoint.google,
    provider: 'google',
    label: 'Gemini Live',
    models,
    audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.google],
    available: auth.isConfigured,
    requiresUserKey,
    reason:
      requiresUserKey && !auth.isConfigured
        ? 'Add your Google API key or Vertex AI credentials in LibreChat settings to use Gemini Live.'
        : undefined,
  });
}

async function getXAIRealtimeProviders(req, appConfig) {
  const endpoints = getXAIEndpointConfigs(appConfig);

  const providers = await Promise.all(
    endpoints.map(async (endpoint) => {
      const endpointName = endpoint.name;
      const rawApiKey = extractEnvVariable(endpoint.apiKey ?? '');
      const rawBaseURL = extractEnvVariable(endpoint.baseURL ?? '');
      const requiresUserKey = isUserProvided(rawApiKey) || isUserProvided(rawBaseURL);
      const userValues = requiresUserKey ? await getUserValues(req, endpointName) : null;
      const apiKey = isUserProvided(rawApiKey) ? userValues?.apiKey : rawApiKey;
      const baseURL = isUserProvided(rawBaseURL) ? userValues?.baseURL : rawBaseURL;
      let models = [];

      if (apiKey && baseURL) {
        models = await fetchXAIRealtimeModels({
          apiKey,
          baseURL,
          tokenKey: `realtime:${endpointName}:${req.user?.id ?? 'server'}`,
          endpointName,
        });
      }

      if (models.length === 0 && (apiKey || requiresUserKey)) {
        models = DEFAULT_XAI_REALTIME_MODELS;
      }

      return buildRealtimeDescriptor({
        endpoint: endpointName,
        provider: 'xai',
        label: endpointName === 'xai' ? 'xAI' : endpointName,
        models,
        audioConfig: DEFAULT_PROVIDER_AUDIO.xai,
        available: Boolean(apiKey && baseURL),
        requiresUserKey,
        reason:
          requiresUserKey && (!apiKey || !baseURL)
            ? `Add your ${endpointName} key in LibreChat settings to use realtime voice.`
            : undefined,
      });
    }),
  );

  return providers.filter(Boolean);
}

async function getRealtimeModelsResponse(req, appConfig) {
  const providerResults = await Promise.all([
    getOpenAIRealtimeProvider(req),
    getAzureRealtimeProvider(req, appConfig),
    getGoogleRealtimeProvider(req),
  ]);

  const xaiProviders = await getXAIRealtimeProviders(req, appConfig);

  return {
    wsPath: '/api/realtime/ws',
    providers: [...providerResults.filter(Boolean), ...xaiProviders],
  };
}

function buildOpenAIRealtimeURL({ baseURL, model }) {
  const resolvedBaseURL = baseURL || OPENAI_DEFAULT_BASE_URL;
  const url = new URL(`${resolvedBaseURL.replace(/\/+$/, '')}/realtime`);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.searchParams.set('model', model);
  return url.toString();
}

function resolveAzureBaseURL({ baseURL, azureOptions }) {
  if (baseURL) {
    return constructAzureURL({ baseURL, azureOptions });
  }

  const instanceName = azureOptions?.azureOpenAIApiInstanceName;
  if (!instanceName) {
    return undefined;
  }

  let endpoint = instanceName;

  if (!instanceName.startsWith('http://') && !instanceName.startsWith('https://')) {
    endpoint = instanceName.includes('.azure.com')
      ? `https://${instanceName}`
      : `https://${instanceName}.openai.azure.com`;
  }

  return normalizeAzureOpenAIBaseURL(endpoint) ?? `${endpoint.replace(/\/+$/, '')}/openai/v1`;
}

function buildAzureRealtimeURL({ baseURL, azureOptions, model }) {
  const resolvedBaseURL = resolveAzureBaseURL({ baseURL, azureOptions });
  const deploymentName = azureOptions?.azureOpenAIApiDeploymentName ?? model;

  if (!resolvedBaseURL || !deploymentName) {
    throw new Error('Azure realtime requires both a base URL and deployment name.');
  }

  const normalizedBaseURL = normalizeAzureOpenAIBaseURL(resolvedBaseURL) ?? resolvedBaseURL;
  const url = new URL(normalizedBaseURL);
  const pathname = (url.pathname || '').replace(/\/+$/, '');
  const isV1Path = /\/v1$/i.test(pathname);

  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = `${pathname}/realtime`;

  if (isV1Path) {
    url.searchParams.set('model', deploymentName);
  } else {
    url.searchParams.set('deployment', deploymentName);
    if (azureOptions?.azureOpenAIApiVersion) {
      url.searchParams.set('api-version', azureOptions.azureOpenAIApiVersion);
    }
  }

  return url.toString();
}

async function resolveOpenAISessionConfig({ req, model }) {
  const rawApiKey = process.env.OPENAI_API_KEY;
  const requiresUserKey = isUserProvided(rawApiKey);
  const userValues = requiresUserKey ? await getUserValues(req, EModelEndpoint.openAI) : null;
  const apiKey = requiresUserKey ? userValues?.apiKey : rawApiKey;

  if (!apiKey) {
    throw new Error('OpenAI realtime requires an API key.');
  }

  const baseURL = extractBaseURL(process.env.OPENAI_REVERSE_PROXY ?? '') ?? OPENAI_DEFAULT_BASE_URL;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'OpenAI-Beta': 'realtime=v1',
  };

  if (process.env.OPENAI_ORGANIZATION && baseURL.includes('openai')) {
    headers['OpenAI-Organization'] = process.env.OPENAI_ORGANIZATION;
  }

  return {
    endpoint: EModelEndpoint.openAI,
    provider: 'openai',
    model,
    wsURL: buildOpenAIRealtimeURL({ baseURL, model }),
    headers,
    audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.openAI],
    transcriptionModel: 'gpt-4o-mini-transcribe',
  };
}

async function resolveAzureSessionConfig({ req, appConfig, model }) {
  const azureConfig = appConfig?.endpoints?.[EModelEndpoint.azureOpenAI];

  if (azureConfig?.groupMap && azureConfig?.modelGroupMap) {
    const mapped = mapModelToAzureConfig({
      modelName: model,
      modelGroupMap: azureConfig.modelGroupMap,
      groupMap: azureConfig.groupMap,
    });

    return {
      endpoint: EModelEndpoint.azureOpenAI,
      provider: 'azure',
      model,
      wsURL: buildAzureRealtimeURL({
        baseURL: mapped.baseURL,
        azureOptions: mapped.azureOptions,
        model,
      }),
      headers: {
        ...(mapped.headers ?? {}),
        'api-key': mapped.azureOptions.azureOpenAIApiKey,
        'OpenAI-Beta': 'realtime=v1',
      },
      audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.azureOpenAI],
      transcriptionModel: null,
    };
  }

  const rawApiKey = process.env.AZURE_API_KEY ?? process.env.AZURE_OPENAI_API_KEY;
  const rawBaseURL = process.env.AZURE_OPENAI_BASEURL;
  const userValues =
    isUserProvided(rawApiKey) || isUserProvided(rawBaseURL)
      ? await getUserValues(req, EModelEndpoint.azureOpenAI)
      : null;

  const directConfig = resolveAzureOpenAIDirectConfig({
    apiKey: isUserProvided(rawApiKey) ? userValues?.apiKey : rawApiKey,
    baseURL: isUserProvided(rawBaseURL) ? userValues?.baseURL : rawBaseURL,
    models: userValues?.models,
  });

  const apiKey = directConfig.apiKey;
  const azureOptions = directConfig.azureOptions;

  if (!apiKey || (!directConfig.baseURL && !azureOptions)) {
    throw new Error('Azure OpenAI realtime requires both an API key and base URL.');
  }

  return {
    endpoint: EModelEndpoint.azureOpenAI,
    provider: 'azure',
    model,
    wsURL: buildAzureRealtimeURL({
      baseURL: directConfig.baseURL,
      azureOptions,
      model,
    }),
    headers: {
      'api-key': apiKey,
      'OpenAI-Beta': 'realtime=v1',
    },
    audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.azureOpenAI],
    transcriptionModel: null,
  };
}

async function resolveGoogleSessionConfig({ req, model }) {
  const rawApiKey = process.env.GOOGLE_KEY;
  const userValues = isUserProvided(rawApiKey)
    ? await getUserValues(req, EModelEndpoint.google)
    : null;
  const { auth } = await resolveGoogleRealtimeAuth({ userValues });

  if (!auth.isConfigured) {
    throw new Error('Gemini Live requires a Google API key or Vertex AI credentials.');
  }

  return {
    endpoint: EModelEndpoint.google,
    provider: 'google',
    model,
    clientOptions: auth.clientOptions,
    audioConfig: DEFAULT_PROVIDER_AUDIO[EModelEndpoint.google],
  };
}

async function resolveXAISessionConfig({ req, appConfig, endpointName, model }) {
  const endpoint = getXAIEndpointConfigs(appConfig).find((config) => config.name === endpointName);

  if (!endpoint) {
    throw new Error(`xAI realtime endpoint "${endpointName}" is not configured.`);
  }

  const rawApiKey = extractEnvVariable(endpoint.apiKey ?? '');
  const rawBaseURL = extractEnvVariable(endpoint.baseURL ?? '');
  const userValues =
    isUserProvided(rawApiKey) || isUserProvided(rawBaseURL)
      ? await getUserValues(req, endpointName)
      : null;
  const apiKey = isUserProvided(rawApiKey) ? userValues?.apiKey : rawApiKey;
  const baseURL = isUserProvided(rawBaseURL) ? userValues?.baseURL : rawBaseURL;
  const resolvedBaseURL = endpoint.directEndpoint
    ? (extractBaseURL(baseURL ?? '') ?? baseURL)
    : baseURL;

  if (!apiKey || !resolvedBaseURL) {
    throw new Error(
      `xAI realtime endpoint "${endpointName}" requires both an API key and base URL.`,
    );
  }

  const selectedModel = model || DEFAULT_XAI_REALTIME_MODELS[0];
  const discoveredModels = await fetchXAIRealtimeModels({
    apiKey,
    baseURL: resolvedBaseURL,
    tokenKey: `realtime:${endpointName}:${req.user?.id ?? 'server'}`,
    endpointName,
  });

  if (discoveredModels.length > 0 && !discoveredModels.includes(selectedModel)) {
    throw new Error(
      `xAI realtime model "${selectedModel}" is not available for endpoint "${endpointName}".`,
    );
  }

  const url = new URL(`${resolvedBaseURL.replace(/\/+$/, '')}/realtime`);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';

  return {
    endpoint: endpointName,
    provider: 'xai',
    model: selectedModel,
    wsURL: url.toString(),
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    audioConfig: DEFAULT_PROVIDER_AUDIO.xai,
  };
}

/**
 * Filter realtime provider descriptors against the user's model-access policy.
 * Admins and unrestricted users see all providers/models unchanged.
 * Restricted users see only the models allowed by their modelPermissions rules.
 * Providers with no remaining models after filtering are dropped entirely.
 */
function filterRealtimeProvidersByPolicy(providers, user) {
  if (!hasModelRestrictions(user)) {
    return providers;
  }

  const allowedMap = getAllowedModelsMap(user);

  return providers
    .map((provider) => {
      const allowed = allowedMap.get(provider.endpoint);

      if (!allowed) {
        return null;
      }

      if (allowed.has(ALL_MODELS)) {
        return provider;
      }

      const filteredModels = provider.models.filter((model) => allowed.has(model));

      if (filteredModels.length === 0) {
        return null;
      }

      return {
        ...provider,
        models: filteredModels,
        defaultModel: filteredModels[0],
      };
    })
    .filter(Boolean);
}

/**
 * Validate that the requested endpoint/model combination is allowed for the user.
 * Throws with a descriptive message if the user is restricted and the model is blocked.
 */
function validateRealtimeModelAccess({ user, endpoint, model }) {
  if (!hasModelRestrictions(user)) {
    return;
  }

  const allowedMap = getAllowedModelsMap(user);
  const allowed = allowedMap.get(endpoint);

  if (!allowed) {
    throw new Error(
      `Realtime provider "${endpoint}" is not available for your account. Contact an administrator.`,
    );
  }

  if (allowed.has(ALL_MODELS)) {
    return;
  }

  if (!allowed.has(model)) {
    throw new Error(
      `Realtime model "${model}" is not available for your account. Contact an administrator.`,
    );
  }
}

async function resolveRealtimeSessionConfig({ req, appConfig, endpoint, model }) {
  if (endpoint === EModelEndpoint.openAI) {
    return resolveOpenAISessionConfig({ req, model });
  }

  if (endpoint === EModelEndpoint.azureOpenAI) {
    return resolveAzureSessionConfig({ req, appConfig, model });
  }

  if (endpoint === EModelEndpoint.google) {
    return resolveGoogleSessionConfig({ req, model });
  }

  return resolveXAISessionConfig({ req, appConfig, endpointName: endpoint, model });
}

module.exports = {
  buildAzureRealtimeURL,
  buildOpenAIRealtimeURL,
  filterRealtimeProvidersByPolicy,
  getRealtimeModelsResponse,
  resolveRealtimeSessionConfig,
  validateRealtimeModelAccess,
};
