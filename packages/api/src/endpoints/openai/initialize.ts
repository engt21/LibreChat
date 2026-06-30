import { ErrorTypes, EModelEndpoint, mapModelToAzureConfig } from 'librechat-data-provider';
import type {
  BaseInitializeParams,
  InitializeResultBase,
  OpenAIConfigOptions,
  UserKeyValues,
} from '~/types';
import {
  getAzureCredentials,
  resolveAzureOpenAIDirectConfig,
  resolveHeaders,
  isUserProvided,
  checkUserKeyExpiry,
  supportsAzureOpenAIModelListing,
} from '~/utils';
import { validateEndpointURL } from '~/auth';
import { getOpenAIConfig } from './config';

/**
 * Initializes OpenAI options for agent usage. This function always returns configuration
 * options and never creates a client instance (equivalent to optionsOnly=true behavior).
 *
 * @param params - Configuration parameters
 * @returns Promise resolving to OpenAI configuration options
 * @throws Error if API key is missing or user key has expired
 */
export async function initializeOpenAI({
  req,
  endpoint,
  model_parameters,
  db,
}: BaseInitializeParams): Promise<InitializeResultBase> {
  const appConfig = req.config;
  const { PROXY, OPENAI_API_KEY, AZURE_API_KEY, OPENAI_REVERSE_PROXY, AZURE_OPENAI_BASEURL } =
    process.env;

  const { key: expiresAt } = req.body;
  const modelName = model_parameters?.model as string | undefined;

  const credentials = {
    [EModelEndpoint.openAI]: OPENAI_API_KEY,
    [EModelEndpoint.azureOpenAI]: AZURE_API_KEY,
  };

  const baseURLOptions = {
    [EModelEndpoint.openAI]: OPENAI_REVERSE_PROXY,
    [EModelEndpoint.azureOpenAI]: AZURE_OPENAI_BASEURL,
  };

  const userProvidesKey = isUserProvided(credentials[endpoint as keyof typeof credentials]);
  const userProvidesURL = isUserProvided(baseURLOptions[endpoint as keyof typeof baseURLOptions]);
  const byokPolicy = req.appSettings?.byok?.providers?.[endpoint];
  const adminBYOKEnabled = byokPolicy?.enabled === true;
  const allowAdminBaseURL = adminBYOKEnabled && byokPolicy?.allowBaseURL !== false;
  const fallbackToPlatform = adminBYOKEnabled && byokPolicy?.fallbackToPlatform !== false;

  let userValues: UserKeyValues | null = null;
  const shouldResolveUserValues =
    (userProvidesKey || userProvidesURL || adminBYOKEnabled || allowAdminBaseURL) && !!req.user?.id;
  let skipUserValues = false;

  if (expiresAt && shouldResolveUserValues) {
    try {
      checkUserKeyExpiry(expiresAt, endpoint);
    } catch (error) {
      if (!fallbackToPlatform) {
        throw error;
      }
      skipUserValues = true;
    }
  }

  if (shouldResolveUserValues && !skipUserValues) {
    try {
      userValues = await db.getUserKeyValues({ userId: req.user?.id ?? '', name: endpoint });
    } catch (error) {
      if (
        !fallbackToPlatform ||
        !credentials[endpoint as keyof typeof credentials] ||
        (userProvidesKey && !adminBYOKEnabled)
      ) {
        throw error;
      }
    }
  }

  let apiKey =
    userProvidesKey || adminBYOKEnabled
      ? userValues?.apiKey
      : credentials[endpoint as keyof typeof credentials];
  if (!apiKey && fallbackToPlatform) {
    apiKey = credentials[endpoint as keyof typeof credentials];
  }

  const baseURL =
    userProvidesURL || allowAdminBaseURL
      ? userValues?.baseURL
      : baseURLOptions[endpoint as keyof typeof baseURLOptions];
  const resolvedBaseURL =
    baseURL || (fallbackToPlatform ? baseURLOptions[endpoint as keyof typeof baseURLOptions] : '');

  if ((userProvidesURL || allowAdminBaseURL) && resolvedBaseURL) {
    await validateEndpointURL(resolvedBaseURL, endpoint);
  }

  const clientOptions: OpenAIConfigOptions = {
    proxy: PROXY ?? undefined,
    reverseProxyUrl: resolvedBaseURL || undefined,
    streaming: true,
  };

  const isAzureOpenAI = endpoint === EModelEndpoint.azureOpenAI;
  const azureConfig = isAzureOpenAI && appConfig?.endpoints?.[EModelEndpoint.azureOpenAI];
  const directAzureConfig =
    isAzureOpenAI && !azureConfig
      ? resolveAzureOpenAIDirectConfig({
          apiKey,
          baseURL: resolvedBaseURL,
          models: userValues?.models,
        })
      : undefined;
  let isServerless = false;

  if (isAzureOpenAI && azureConfig) {
    const { modelGroupMap, groupMap } = azureConfig;
    const {
      azureOptions,
      baseURL: configBaseURL,
      headers = {},
      serverless,
    } = mapModelToAzureConfig({
      modelName: modelName || '',
      modelGroupMap,
      groupMap,
    });
    isServerless = serverless === true;

    clientOptions.reverseProxyUrl = configBaseURL ?? clientOptions.reverseProxyUrl;
    clientOptions.headers = resolveHeaders({
      headers: { ...headers, ...(clientOptions.headers ?? {}) },
      user: req.user,
    });

    const groupName = modelGroupMap[modelName || '']?.group;
    if (groupName && groupMap[groupName]) {
      clientOptions.addParams = groupMap[groupName]?.addParams;
      clientOptions.dropParams = groupMap[groupName]?.dropParams;
    }

    apiKey = azureOptions.azureOpenAIApiKey;
    clientOptions.azure = !isServerless ? azureOptions : undefined;

    if (isServerless) {
      clientOptions.defaultQuery =
        azureOptions.azureOpenAIApiVersion &&
        !supportsAzureOpenAIModelListing(clientOptions.reverseProxyUrl)
          ? { 'api-version': azureOptions.azureOpenAIApiVersion }
          : undefined;

      if (!clientOptions.headers) {
        clientOptions.headers = {};
      }
      clientOptions.headers['api-key'] = apiKey;
    }
  } else if (isAzureOpenAI) {
    if (directAzureConfig?.baseURL) {
      clientOptions.reverseProxyUrl = directAzureConfig.baseURL;
      apiKey = directAzureConfig.apiKey;
    }

    if (directAzureConfig?.isLegacyCredentialPayload && directAzureConfig.azureOptions) {
      clientOptions.azure = directAzureConfig.azureOptions;
      apiKey = directAzureConfig.azureOptions.azureOpenAIApiKey;
    } else if (!directAzureConfig?.baseURL) {
      clientOptions.azure = getAzureCredentials();
      apiKey = clientOptions.azure ? clientOptions.azure.azureOpenAIApiKey : undefined;
    }
  }

  if (
    isAzureOpenAI &&
    (userProvidesURL || allowAdminBaseURL) &&
    !clientOptions.reverseProxyUrl &&
    !clientOptions.azure
  ) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_BASE_URL,
      }),
    );
  }

  if (userProvidesKey && !apiKey) {
    throw new Error(
      JSON.stringify({
        type: ErrorTypes.NO_USER_KEY,
      }),
    );
  }

  if (!apiKey) {
    throw new Error(`${endpoint} API Key not provided.`);
  }

  const modelOptions = {
    ...(model_parameters ?? {}),
    model: modelName,
    user: req.user?.id,
  };

  const finalClientOptions: OpenAIConfigOptions = {
    ...clientOptions,
    modelOptions,
  };

  const options = getOpenAIConfig(apiKey, finalClientOptions, endpoint);

  /** Set useLegacyContent for Azure serverless deployments */
  if (isServerless) {
    (options as InitializeResultBase).useLegacyContent = true;
  }

  const openAIConfig = appConfig?.endpoints?.[EModelEndpoint.openAI];
  const allConfig = appConfig?.endpoints?.all;
  const azureRate = modelName?.includes('gpt-4') ? 30 : 17;

  let streamRate: number | undefined;

  if (isAzureOpenAI && azureConfig) {
    streamRate = azureConfig.streamRate ?? azureRate;
  } else if (!isAzureOpenAI && openAIConfig) {
    streamRate = openAIConfig.streamRate;
  }

  if (allConfig?.streamRate) {
    streamRate = allConfig.streamRate;
  }

  if (streamRate) {
    options.llmConfig._lc_stream_delay = streamRate;
  }

  return options;
}
