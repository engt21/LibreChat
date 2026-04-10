import axios from 'axios';
import { logger } from '@librechat/data-schemas';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  CacheKeys,
  KnownEndpoints,
  EModelEndpoint,
  defaultModels,
  buildGoogleModelCapabilitiesMap,
  buildXAIModelCapabilitiesMap,
  getXAITextCompatibleModelNames,
  isXAIEndpointCandidate,
  extractEnvVariable,
} from 'librechat-data-provider';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type { TGoogleModelCapabilities, TXAIModelCapabilities } from 'librechat-data-provider';
import {
  processModelData,
  extractBaseURL,
  isUserProvided,
  resolveHeaders,
  deriveBaseURL,
  logAxiosError,
  inputSchema,
} from '~/utils';
import {
  isAzureOpenAIBaseURL,
  normalizeAzureOpenAIBaseURL,
  supportsAzureOpenAIModelListing,
} from '~/utils/azure';
import { standardCache } from '~/cache';

const GOOGLE_MODEL_CAPABILITIES_CACHE_KEY = `${EModelEndpoint.google}:capabilities`;
const OLLAMA_MODEL_SOURCES_CACHE_KEY_PREFIX = `${KnownEndpoints.ollama}:sources:`;
const XAI_MODEL_CAPABILITIES_CACHE_KEY_PREFIX = `${KnownEndpoints.xai}:capabilities:`;
const OPENAI_TEXT_MODEL_REGEX = /^(?:text-davinci-003|chatgpt-|gpt-\d|o\d)/i;
const OPENAI_EXCLUDED_MODEL_REGEX =
  /(?:audio|realtime|image|embedding|moderation|transcribe|tts|whisper)/i;

interface GoogleModelsResponse {
  models?: TGoogleModelCapabilities[];
}

interface XAIModelsResponse {
  models?: TXAIModelCapabilities[];
}

interface OllamaBaseURLConfig {
  queryURL: string;
  sourceURL: string;
}

type OllamaModelSourceMap = Record<string, string>;

const ollamaModelSourceMaps = new Map<string, OllamaModelSourceMap>();

export interface FetchModelsParams {
  /** User ID for API requests */
  user?: string;
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API */
  baseURL?: string;
  /** Additional base URLs for the API */
  baseURLs?: string[];
  /** Endpoint name (defaults to 'openAI') */
  name?: string;
  /** Whether directEndpoint was configured */
  direct?: boolean;
  /** Whether to fetch from Azure */
  azure?: boolean;
  /** Azure API version for legacy non-/openai/v1 discovery probes */
  azureApiVersion?: string;
  /** Whether to send user ID as query parameter */
  userIdQuery?: boolean;
  /** Whether to create token configuration from API response */
  createTokenConfig?: boolean;
  /** Whether Ollama discovery should avoid falling back to OpenAI-compatible /models */
  disableOllamaFallback?: boolean;
  /** Cache key for token configuration (uses name if omitted) */
  tokenKey?: string;
  /** Optional headers for the request */
  headers?: Record<string, string> | null;
  /** Optional user object for header resolution */
  userObject?: Partial<IUser>;
}

function dedupeURLs(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => typeof url === 'string' && url !== ''))];
}

function getOllamaBaseURLConfigs({
  baseURL,
  baseURLs,
  direct = false,
}: {
  baseURL?: string;
  baseURLs?: string[];
  direct?: boolean;
}): OllamaBaseURLConfig[] {
  const sourceURLs = dedupeURLs([baseURL, ...(baseURLs ?? [])]);

  return sourceURLs.map((sourceURL) => ({
    sourceURL,
    queryURL: direct ? (extractBaseURL(sourceURL) ?? sourceURL) : sourceURL,
  }));
}

function getOllamaModelSourcesCacheKey(tokenKey: string): string {
  return `${OLLAMA_MODEL_SOURCES_CACHE_KEY_PREFIX}${tokenKey}`;
}

/**
 * Fetches Ollama models from the specified base API path.
 * @param baseURL - The Ollama server URL
 * @param options - Optional configuration
 * @returns Promise resolving to array of model names
 */
async function fetchOllamaModels(
  baseURL: string,
  options: { headers?: Record<string, string> | null; user?: Partial<IUser> } = {},
): Promise<string[]> {
  if (!baseURL) {
    return [];
  }

  const ollamaEndpoint = deriveBaseURL(baseURL);

  const resolvedHeaders = resolveHeaders({
    headers: options.headers ?? undefined,
    user: options.user,
  });

  try {
    const response = await axios.get<{ models: Array<{ name: string }> }>(
      `${ollamaEndpoint}/api/tags`,
      {
        headers: resolvedHeaders,
        timeout: 5000,
      },
    );

    return response.data.models.map((tag) => tag.name);
  } catch {
    const response = await axios.get<{ data: Array<{ id: string }> }>(`${ollamaEndpoint}/models`, {
      headers: resolvedHeaders,
      timeout: 5000,
    });

    return response.data.data
      .map((model) => model.id)
      .filter((model) => model.toLowerCase() !== 'default');
  }
}

async function fetchOllamaModelsFromEndpoints({
  baseURL,
  baseURLs,
  direct = false,
  headers,
  userObject,
  tokenKey,
}: {
  baseURL?: string;
  baseURLs?: string[];
  direct?: boolean;
  headers?: Record<string, string> | null;
  userObject?: Partial<IUser>;
  tokenKey: string;
}): Promise<{ models: string[]; sourceMap: OllamaModelSourceMap }> {
  const urls = getOllamaBaseURLConfigs({ baseURL, baseURLs, direct });

  if (urls.length === 0) {
    return { models: [], sourceMap: {} };
  }

  const sourceMap: OllamaModelSourceMap = {};
  const models = new Set<string>();
  let lastError: Error | undefined;

  for (const urlConfig of urls) {
    try {
      const endpointModels = await fetchOllamaModels(urlConfig.queryURL, {
        headers,
        user: userObject,
      });

      for (const model of endpointModels) {
        if (sourceMap[model] == null) {
          sourceMap[model] = urlConfig.sourceURL;
        }

        models.add(model);
      }
    } catch (error) {
      lastError = error as Error;
    }
  }

  if (models.size === 0 && lastError) {
    throw lastError;
  }

  ollamaModelSourceMaps.set(tokenKey, sourceMap);

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  await modelsCache.set(getOllamaModelSourcesCacheKey(tokenKey), sourceMap);

  return { models: [...models], sourceMap };
}

export async function resolveOllamaBaseURL({
  baseURL,
  baseURLs,
  headers,
  userObject,
  model,
  direct = false,
  tokenKey,
}: {
  baseURL?: string;
  baseURLs?: string[];
  headers?: Record<string, string> | null;
  userObject?: Partial<IUser>;
  model?: string;
  direct?: boolean;
  tokenKey: string;
}): Promise<string | undefined> {
  const sourceURLs = getOllamaBaseURLConfigs({ baseURL, baseURLs, direct }).map(
    (urlConfig) => urlConfig.sourceURL,
  );

  if (sourceURLs.length === 0) {
    return baseURL;
  }

  if (!model) {
    return sourceURLs[0];
  }

  let sourceMap = ollamaModelSourceMaps.get(tokenKey);

  if (sourceMap?.[model] == null) {
    const fetchedModels = await fetchOllamaModelsFromEndpoints({
      baseURL,
      baseURLs,
      direct,
      headers,
      userObject,
      tokenKey,
    });
    sourceMap = fetchedModels.sourceMap;
  }

  return sourceMap?.[model] ?? sourceURLs[0];
}

/**
 * Splits a string by commas and trims each resulting value.
 * @param input - The input string to split.
 * @returns An array of trimmed values.
 */
export function splitAndTrim(input: string | null | undefined): string[] {
  if (!input || typeof input !== 'string') {
    return [];
  }
  return input
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isOpenAITextCompatibleModel(model: string | null | undefined): boolean {
  const normalizedModel = (model ?? '').trim();

  return (
    normalizedModel !== '' &&
    OPENAI_TEXT_MODEL_REGEX.test(normalizedModel) &&
    !OPENAI_EXCLUDED_MODEL_REGEX.test(normalizedModel)
  );
}

export function filterOpenAITextCompatibleModels(models: string[]): string[] {
  return models.filter((model) => isOpenAITextCompatibleModel(model));
}

function getXAIModelCapabilitiesCacheKey(tokenKey: string, userId?: string): string {
  const userSuffix = userId ? `:user:${userId}` : '';
  return `${XAI_MODEL_CAPABILITIES_CACHE_KEY_PREFIX}${tokenKey}${userSuffix}`;
}

async function fetchXAIModelCapabilities({
  apiKey,
  baseURL,
  tokenKey,
  headers,
  userObject,
  userId,
}: {
  apiKey: string;
  baseURL?: string;
  tokenKey: string;
  headers?: Record<string, string> | null;
  userObject?: Partial<IUser>;
  /** When provided, scopes the capability cache to this user so per-user credentials cannot leak across users. */
  userId?: string;
}): Promise<Record<string, TXAIModelCapabilities> | undefined> {
  if (!apiKey || !baseURL) {
    return undefined;
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const cacheKey = getXAIModelCapabilitiesCacheKey(tokenKey, userId);
  const cachedCapabilities = await modelsCache.get(cacheKey);

  if (cachedCapabilities) {
    return cachedCapabilities as Record<string, TXAIModelCapabilities>;
  }

  try {
    const resolvedHeaders = resolveHeaders({
      headers: headers ?? undefined,
      user: userObject,
    });

    const options: {
      headers: Record<string, string>;
      timeout: number;
      httpsAgent?: HttpsProxyAgent<string>;
    } = {
      headers: {
        ...(resolvedHeaders ?? {}),
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 5000,
    };

    if (process.env.PROXY) {
      options.httpsAgent = new HttpsProxyAgent(process.env.PROXY);
    }

    const url = new URL(`${baseURL.replace(/\/+$/, '')}/language-models`);
    const response = await axios.get<XAIModelsResponse>(url.toString(), options);
    const xaiModelCapabilities = buildXAIModelCapabilitiesMap(response.data.models ?? []);

    await modelsCache.set(cacheKey, xaiModelCapabilities);

    return xaiModelCapabilities;
  } catch (error) {
    logAxiosError({
      message: 'Failed to fetch models from xAI API',
      error: error as Error,
    });

    return undefined;
  }
}

export async function getXAIModelCapabilities({
  appConfig,
  userObject,
}: {
  appConfig?: AppConfig;
  userObject?: Partial<IUser>;
} = {}): Promise<Record<string, Record<string, TXAIModelCapabilities>> | undefined> {
  const customEndpoints = appConfig?.endpoints?.[EModelEndpoint.custom];

  if (!Array.isArray(customEndpoints) || customEndpoints.length === 0) {
    return undefined;
  }

  const capabilityEntries = await Promise.all(
    customEndpoints.map(async (endpoint) => {
      const endpointName = endpoint?.name;
      const resolvedBaseURL = extractEnvVariable(endpoint?.baseURL ?? '');

      if (
        !endpointName ||
        !endpoint?.apiKey ||
        !resolvedBaseURL ||
        !isXAIEndpointCandidate({
          endpoint: endpointName,
          baseURL: resolvedBaseURL,
          defaultParamsEndpoint: endpoint.customParams?.defaultParamsEndpoint,
        })
      ) {
        return undefined;
      }

      const apiKey = extractEnvVariable(endpoint.apiKey);
      const baseURL = endpoint.directEndpoint
        ? (extractBaseURL(resolvedBaseURL) ?? resolvedBaseURL)
        : resolvedBaseURL;

      if (!apiKey || !baseURL || isUserProvided(apiKey) || isUserProvided(baseURL)) {
        return undefined;
      }

      const capabilities = await fetchXAIModelCapabilities({
        apiKey,
        baseURL,
        tokenKey: endpointName,
        headers: endpoint.headers,
        userObject,
      });

      if (!capabilities || Object.keys(capabilities).length === 0) {
        return undefined;
      }

      return [endpointName, capabilities] as const;
    }),
  );

  const xaiModelCapabilities = capabilityEntries.reduce<
    Record<string, Record<string, TXAIModelCapabilities>>
  >((acc, entry) => {
    if (entry == null) {
      return acc;
    }

    const [endpointName, capabilities] = entry;
    acc[endpointName] = capabilities;
    return acc;
  }, {});

  return Object.keys(xaiModelCapabilities).length > 0 ? xaiModelCapabilities : undefined;
}

async function fetchGoogleModelCapabilities(): Promise<
  Record<string, TGoogleModelCapabilities> | undefined
> {
  const apiKey = process.env.GOOGLE_KEY;

  if (!apiKey || isUserProvided(apiKey)) {
    return undefined;
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const cachedCapabilities = await modelsCache.get(GOOGLE_MODEL_CAPABILITIES_CACHE_KEY);

  if (cachedCapabilities) {
    return cachedCapabilities as Record<string, TGoogleModelCapabilities>;
  }

  try {
    const options: {
      timeout: number;
      httpsAgent?: HttpsProxyAgent<string>;
    } = {
      timeout: 5000,
    };

    if (process.env.PROXY) {
      options.httpsAgent = new HttpsProxyAgent(process.env.PROXY);
    }

    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
    url.searchParams.set('key', apiKey);

    const response = await axios.get<GoogleModelsResponse>(url.toString(), options);
    const googleModelCapabilities = buildGoogleModelCapabilitiesMap(response.data.models ?? []);

    await modelsCache.set(GOOGLE_MODEL_CAPABILITIES_CACHE_KEY, googleModelCapabilities);

    return googleModelCapabilities;
  } catch (error) {
    logAxiosError({
      message: 'Failed to fetch models from Google Gemini API',
      error: error as Error,
    });

    return undefined;
  }
}

/**
 * Fetches models from the specified base API path or Azure, based on the provided configuration.
 *
 * @param params - The parameters for fetching the models.
 * @returns A promise that resolves to an array of model identifiers.
 */
export async function fetchModels({
  user,
  apiKey,
  baseURL: _baseURL,
  baseURLs: _baseURLs,
  name = EModelEndpoint.openAI,
  direct = false,
  azure = false,
  azureApiVersion,
  userIdQuery = false,
  createTokenConfig = true,
  disableOllamaFallback = false,
  tokenKey,
  headers,
  userObject,
}: FetchModelsParams): Promise<string[]> {
  let models: string[] = [];
  const ollamaBaseURLs = getOllamaBaseURLConfigs({
    baseURL: _baseURL,
    baseURLs: _baseURLs,
    direct,
  }).map((urlConfig) => urlConfig.sourceURL);
  const baseURL = direct ? (extractBaseURL(_baseURL ?? '') ?? undefined) : _baseURL;
  const resolvedBaseURL = azure ? (normalizeAzureOpenAIBaseURL(baseURL) ?? baseURL) : baseURL;

  if (!resolvedBaseURL && ollamaBaseURLs.length === 0 && !azure) {
    return models;
  }

  if (!apiKey) {
    return models;
  }

  /** Whether the resolved URL uses the direct /openai/v1 route that does not need api-version */
  const isDirectAzureV1 = azure && supportsAzureOpenAIModelListing(resolvedBaseURL);
  /** Whether the resolved URL is a legacy Azure endpoint that requires api-version on probes */
  const isLegacyAzureEndpoint =
    azure && !isDirectAzureV1 && isAzureOpenAIBaseURL(resolvedBaseURL) && !!azureApiVersion;

  if (azure && !isDirectAzureV1 && !isLegacyAzureEndpoint) {
    return models;
  }

  if (name && name.toLowerCase().startsWith(KnownEndpoints.ollama)) {
    try {
      const ollamaModels = await fetchOllamaModelsFromEndpoints({
        baseURL: _baseURL,
        baseURLs: _baseURLs,
        direct,
        headers,
        userObject,
        tokenKey: tokenKey ?? name,
      });
      return ollamaModels.models;
    } catch (ollamaError) {
      const logMessage = disableOllamaFallback
        ? 'Failed to fetch models from Ollama API while strict Ollama detection is enabled.'
        : 'Failed to fetch models from Ollama API. Attempting to fetch via OpenAI-compatible endpoint.';
      logAxiosError({ message: logMessage, error: ollamaError as Error });

      if (disableOllamaFallback) {
        return [];
      }
    }
  }

  if (isXAIEndpointCandidate({ endpoint: name, baseURL })) {
    const xaiModelCapabilities = await fetchXAIModelCapabilities({
      apiKey,
      baseURL,
      tokenKey: tokenKey ?? name,
      headers,
      userObject,
      userId: user,
    });
    const xaiModels = xaiModelCapabilities
      ? getXAITextCompatibleModelNames(Object.values(xaiModelCapabilities))
      : [];

    if (xaiModels.length > 0) {
      return xaiModels;
    }
  }

  try {
    const options: {
      headers: Record<string, string>;
      timeout: number;
      httpsAgent?: HttpsProxyAgent<string>;
    } = {
      headers: {
        ...(headers ?? {}),
      },
      timeout: 5000,
    };

    if (name === EModelEndpoint.anthropic) {
      options.headers = {
        'x-api-key': apiKey,
        'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
      };
    } else if (azure) {
      options.headers['api-key'] = apiKey;
    } else {
      options.headers.Authorization = `Bearer ${apiKey}`;
    }

    if (process.env.PROXY) {
      options.httpsAgent = new HttpsProxyAgent(process.env.PROXY);
    }

    if (!azure && process.env.OPENAI_ORGANIZATION && resolvedBaseURL?.includes('openai')) {
      options.headers['OpenAI-Organization'] = process.env.OPENAI_ORGANIZATION;
    }

    const url = new URL(`${(resolvedBaseURL ?? '').replace(/\/+$/, '')}/models`);
    if (isLegacyAzureEndpoint && azureApiVersion) {
      url.searchParams.append('api-version', azureApiVersion);
    }
    if (user && userIdQuery) {
      url.searchParams.append('user', user);
    }
    const res = await axios.get(url.toString(), options);

    const input = res.data;

    const validationResult = inputSchema.safeParse(input);
    if (validationResult.success && createTokenConfig) {
      const endpointTokenConfig = processModelData(input);
      const cache = standardCache(CacheKeys.TOKEN_CONFIG);
      await cache.set(tokenKey ?? name, endpointTokenConfig);
    }
    models = input.data.map((item: { id: string }) => item.id);
  } catch (error) {
    const logMessage = `Failed to fetch models from ${azure ? 'Azure ' : ''}${name} API`;
    logAxiosError({ message: logMessage, error: error as Error });
  }

  return models;
}

/** Options for fetching OpenAI models */
export interface GetOpenAIModelsOptions {
  /** User ID for API requests */
  user?: string;
  /** Whether to fetch from Azure */
  azure?: boolean;
  /** Whether to fetch models for the Assistants endpoint */
  assistants?: boolean;
  /** OpenAI API key (if not using environment variable) */
  openAIApiKey?: string;
  /** Explicit base URL override (used for Azure direct endpoints) */
  baseURL?: string;
  /** Manual fallback models when model discovery is unavailable */
  manualModels?: string[];
  /** Optional cache key override */
  cacheKey?: string;
  /** Whether user provides their own API key */
  userProvidedOpenAI?: boolean;
  /** Whether to bypass cached model discovery results */
  forceRefresh?: boolean;
  /** Azure API version for legacy non-/openai/v1 discovery probes */
  azureApiVersion?: string;
}

/**
 * Fetches models from OpenAI or Azure based on the provided options.
 * @param opts - Options for fetching models
 * @param _models - Fallback models array
 * @returns Promise resolving to array of model IDs
 */
export async function fetchOpenAIModels(
  opts: GetOpenAIModelsOptions,
  _models: string[] = [],
): Promise<string[]> {
  let models = _models.slice() ?? [];
  const apiKey = opts.azure
    ? (opts.openAIApiKey ?? process.env.AZURE_API_KEY ?? process.env.AZURE_OPENAI_API_KEY)
    : (opts.openAIApiKey ?? process.env.OPENAI_API_KEY);
  const openaiBaseURL = 'https://api.openai.com/v1';
  let baseURL = opts.azure
    ? (opts.baseURL ?? process.env.AZURE_OPENAI_BASEURL ?? '')
    : openaiBaseURL;
  let reverseProxyUrl = opts.baseURL ?? process.env.OPENAI_REVERSE_PROXY;

  if (opts.assistants && process.env.ASSISTANTS_BASE_URL) {
    reverseProxyUrl = process.env.ASSISTANTS_BASE_URL;
  } else if (opts.azure) {
    reverseProxyUrl = opts.baseURL ?? process.env.AZURE_OPENAI_BASEURL;
  }

  if (reverseProxyUrl) {
    baseURL = opts.azure
      ? (normalizeAzureOpenAIBaseURL(reverseProxyUrl) ?? reverseProxyUrl)
      : (extractBaseURL(reverseProxyUrl) ?? openaiBaseURL);
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const cacheKey = opts.cacheKey ?? baseURL;

  const cachedModels = opts.forceRefresh ? null : await modelsCache.get(cacheKey);
  if (cachedModels) {
    return cachedModels as string[];
  }

  if (baseURL || opts.azure) {
    models = await fetchModels({
      apiKey: apiKey ?? '',
      baseURL,
      azure: opts.azure,
      azureApiVersion: opts.azureApiVersion,
      user: opts.user,
      tokenKey: opts.cacheKey,
      name: opts.azure ? EModelEndpoint.azureOpenAI : EModelEndpoint.openAI,
    });
  }

  if (models.length === 0) {
    return _models;
  }

  if (!opts.azure && baseURL === openaiBaseURL) {
    models = filterOpenAITextCompatibleModels(models);
    const instructModels = models.filter((model) => model.includes('instruct'));
    const otherModels = models.filter((model) => !model.includes('instruct'));
    models = otherModels.concat(instructModels);
  }

  await modelsCache.set(cacheKey, models);
  return models;
}

/**
 * Loads the default models for OpenAI or Azure.
 * @param opts - Options for getting models
 * @returns Promise resolving to array of model IDs
 */
export async function getOpenAIModels(opts: GetOpenAIModelsOptions = {}): Promise<string[]> {
  let models = defaultModels[EModelEndpoint.openAI];

  if (opts.assistants) {
    models = defaultModels[EModelEndpoint.assistants];
  } else if (opts.azure) {
    models = defaultModels[EModelEndpoint.openAI];
  }

  if (opts.manualModels && opts.manualModels.length > 0) {
    models = opts.manualModels;
  }

  let key: string;
  if (opts.assistants) {
    key = 'ASSISTANTS_MODELS';
  } else if (opts.azure) {
    key = 'AZURE_OPENAI_MODELS';
  } else {
    key = 'OPENAI_MODELS';
  }

  if (process.env[key] && !(opts.azure && opts.manualModels && opts.manualModels.length > 0)) {
    return splitAndTrim(process.env[key]);
  }

  if (opts.userProvidedOpenAI && (!opts.openAIApiKey || (opts.azure && !opts.baseURL))) {
    return models;
  }

  return await fetchOpenAIModels(opts, models);
}

/**
 * Fetches models from the Anthropic API.
 * @param opts - Options for fetching models
 * @param _models - Fallback models array
 * @returns Promise resolving to array of model IDs
 */
export async function fetchAnthropicModels(
  opts: { user?: string } = {},
  _models: string[] = [],
): Promise<string[]> {
  let models = _models.slice() ?? [];
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropicBaseURL = 'https://api.anthropic.com/v1';
  let baseURL = anthropicBaseURL;
  const reverseProxyUrl = process.env.ANTHROPIC_REVERSE_PROXY;

  if (reverseProxyUrl) {
    baseURL = extractBaseURL(reverseProxyUrl) ?? anthropicBaseURL;
  }

  if (!apiKey) {
    return models;
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);

  const cachedModels = await modelsCache.get(baseURL);
  if (cachedModels) {
    return cachedModels as string[];
  }

  if (baseURL) {
    models = await fetchModels({
      apiKey,
      baseURL,
      user: opts.user,
      name: EModelEndpoint.anthropic,
      tokenKey: EModelEndpoint.anthropic,
    });
  }

  if (models.length === 0) {
    return _models;
  }

  await modelsCache.set(baseURL, models);
  return models;
}

/**
 * Gets Anthropic models from environment or API.
 * @param opts - Options for fetching models
 * @returns Promise resolving to array of model IDs
 */
export async function getAnthropicModels(
  opts: { user?: string; vertexModels?: string[] } = {},
): Promise<string[]> {
  const models = defaultModels[EModelEndpoint.anthropic];

  // Vertex AI models from YAML config take priority
  if (opts.vertexModels && opts.vertexModels.length > 0) {
    return opts.vertexModels;
  }

  if (process.env.ANTHROPIC_MODELS) {
    return splitAndTrim(process.env.ANTHROPIC_MODELS);
  }

  if (isUserProvided(process.env.ANTHROPIC_API_KEY)) {
    return models;
  }

  try {
    return await fetchAnthropicModels(opts, models);
  } catch (error) {
    logger.error('Error fetching Anthropic models:', error);
    return models;
  }
}

export async function getGoogleModelCapabilities(): Promise<
  Record<string, TGoogleModelCapabilities> | undefined
> {
  return fetchGoogleModelCapabilities();
}

/**
 * Gets Google models from environment, API, or defaults.
 * @returns Array of model IDs
 */
export async function getGoogleModels(): Promise<string[]> {
  let models = defaultModels[EModelEndpoint.google];

  if (process.env.GOOGLE_MODELS) {
    return splitAndTrim(process.env.GOOGLE_MODELS);
  }

  const googleModelCapabilities = await fetchGoogleModelCapabilities();

  if (googleModelCapabilities && Object.keys(googleModelCapabilities).length > 0) {
    models = Object.keys(googleModelCapabilities);
  }

  return models;
}

/**
 * Gets Bedrock models from environment or defaults.
 * @returns Array of model IDs
 */
export function getBedrockModels(): string[] {
  let models = defaultModels[EModelEndpoint.bedrock];
  if (process.env.BEDROCK_AWS_MODELS) {
    models = splitAndTrim(process.env.BEDROCK_AWS_MODELS);
  }
  return models;
}
