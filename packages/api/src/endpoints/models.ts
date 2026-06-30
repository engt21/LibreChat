import axios from 'axios';
import { logger } from '@librechat/data-schemas';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  CacheKeys,
  KnownEndpoints,
  EModelEndpoint,
  defaultModels,
  buildGoogleModelCapabilitiesMap,
  buildStaticAnthropicModelCapabilities,
  buildXAIModelCapabilitiesMap,
  getXAITextCompatibleModelNames,
  isXAIEndpointCandidate,
  extractEnvVariable,
} from 'librechat-data-provider';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type {
  TAnthropicModelCapabilities,
  TGoogleModelCapabilities,
  TXAIModelCapabilities,
} from 'librechat-data-provider';
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
const OPENAI_CHAT_LATEST_MODEL = 'chat-latest';
const OPENAI_CHAT_LATEST_ALIASES = new Set([OPENAI_CHAT_LATEST_MODEL, 'gpt-chat-latest']);
const OPENAI_TEXT_MODEL_REGEX = /^(?:chat-latest$|gpt-chat-latest$|chatgpt-|gpt-\d|o\d)/i;
const OPENAI_EXCLUDED_MODEL_REGEX =
  /(?:audio|realtime|image|embedding|moderation|transcribe|transcription|translate|tts|whisper|dall-e|deep-research|computer-use|search-preview|vision|video|sora|codex|instruct)/i;
const OPENAI_DATED_SNAPSHOT_REGEX = /(?:-\d{4}-\d{2}-\d{2}|-\d{4}(?:-[a-z]+)?)$/;
const OPENAI_VERSIONED_CHAT_LATEST_REGEX =
  /^gpt-\d+(?:\.\d+)?-chat-latest(?:-\d{4}-\d{2}-\d{2})?$/i;
const OPENAI_CODENAME_MODEL_REGEX = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/i;
const OPENAI_LEGACY_BASE_MODEL_REGEX = /^(?:ada|babbage|curie|davinci)(?:-|$)/i;

const OPENAI_RELEASE_ORDER = [
  OPENAI_CHAT_LATEST_MODEL,
  'gpt-chat-latest',
  'gpt-5.5',
  'gpt-5.5-pro',
  'gpt-5.4',
  'gpt-5.4-pro',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5.2',
  'gpt-5.2-pro',
  'gpt-5.1',
  'gpt-5',
  'gpt-5-mini',
  'gpt-5-nano',
  'o4-mini',
  'o3',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'o1-pro',
  'gpt-4.5-preview',
  'o3-mini',
  'o1',
  'o1-mini',
  'o1-preview',
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
  'gpt-4',
];

const OPENAI_RELEASE_ORDER_SCORES = new Map(
  OPENAI_RELEASE_ORDER.map((model, index) => [model, 900_000_000 - index * 10_000]),
);

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
  const isAlphaModel = isOpenAIAlphaModel(normalizedModel);
  const isCodenameModel =
    OPENAI_CODENAME_MODEL_REGEX.test(normalizedModel) &&
    !OPENAI_LEGACY_BASE_MODEL_REGEX.test(normalizedModel);

  return (
    normalizedModel !== '' &&
    !OPENAI_EXCLUDED_MODEL_REGEX.test(normalizedModel) &&
    (isAlphaModel ||
      (!isOpenAIDatedSnapshotModel(normalizedModel) &&
        (OPENAI_TEXT_MODEL_REGEX.test(normalizedModel) || isCodenameModel)))
  );
}

export function filterOpenAITextCompatibleModels(models: string[]): string[] {
  return models.filter((model) => isOpenAITextCompatibleModel(model));
}

export function isOpenAIAlphaModel(model: string | null | undefined): boolean {
  return (model ?? '').toLowerCase().includes('-alpha');
}

export function isOpenAIDatedSnapshotModel(model: string | null | undefined): boolean {
  return OPENAI_DATED_SNAPSHOT_REGEX.test((model ?? '').trim());
}

function getOpenAIStableModelId(model: string): string {
  return model.trim().replace(OPENAI_DATED_SNAPSHOT_REGEX, '');
}

function isOpenAIChatLatestModel(model: string): boolean {
  const lower = getOpenAIStableModelId(model).toLowerCase();
  return OPENAI_CHAT_LATEST_ALIASES.has(lower) || OPENAI_VERSIONED_CHAT_LATEST_REGEX.test(lower);
}

function getOpenAIVariantRank(model: string): number {
  const lower = getOpenAIStableModelId(model).toLowerCase();

  if (isOpenAIChatLatestModel(lower)) {
    return 0;
  }
  if (/^gpt-\d+(?:\.\d+)?$/.test(lower)) {
    return 1;
  }
  if (/(?:^|-)pro(?:$|-)/.test(lower)) {
    return 2;
  }
  if (/(?:^|-)mini(?:$|-)/.test(lower)) {
    return 3;
  }
  if (/(?:^|-)nano(?:$|-)/.test(lower)) {
    return 4;
  }
  if (isOpenAIAlphaModel(lower)) {
    return 8;
  }
  return 6;
}

export function getOpenAIModelReleaseScore(model: string): number {
  if (!model || typeof model !== 'string') {
    return -1;
  }

  const lower = getOpenAIStableModelId(model).toLowerCase();
  if (OPENAI_CHAT_LATEST_ALIASES.has(lower)) {
    return lower === OPENAI_CHAT_LATEST_MODEL ? 2_000_000_100 : 2_000_000_000;
  }
  if (OPENAI_VERSIONED_CHAT_LATEST_REGEX.test(lower)) {
    return 1_000_000_000 + getOpenAIModelVersionScore(lower);
  }

  const knownScore = OPENAI_RELEASE_ORDER_SCORES.get(lower);
  if (knownScore != null) {
    return knownScore;
  }

  for (const [knownModel, score] of OPENAI_RELEASE_ORDER_SCORES) {
    if (lower.startsWith(`${knownModel}-`)) {
      return score;
    }
  }

  const versionScore = getOpenAIModelVersionScore(lower);
  if (versionScore > getOpenAIModelVersionScore('gpt-5.5')) {
    return 950_000_000 + versionScore;
  }

  return versionScore;
}

export function normalizeOpenAIChatModels(models: string[]): string[] {
  const filteredModels = filterOpenAITextCompatibleModels(models);
  const chatLatestCandidates = filteredModels.filter(isOpenAIChatLatestModel);
  const chatLatest =
    chatLatestCandidates.find(
      (model) => getOpenAIStableModelId(model).toLowerCase() === OPENAI_CHAT_LATEST_MODEL,
    ) ||
    chatLatestCandidates.find(
      (model) => getOpenAIStableModelId(model).toLowerCase() === 'gpt-chat-latest',
    ) ||
    sortOpenAIModelsByVersion(chatLatestCandidates)[0];
  const collapsedModels = [
    ...(chatLatest ? [chatLatest] : []),
    ...filteredModels.filter((model) => !isOpenAIChatLatestModel(model)),
  ];
  return sortOpenAIModelsByVersion(Array.from(new Set(collapsedModels)));
}

function usesNativeOpenAIModelCatalog(opts: GetOpenAIModelsOptions): boolean {
  return !opts.azure && !opts.assistants && !(opts.baseURL ?? process.env.OPENAI_REVERSE_PROXY);
}

/**
 * Resolve the `*_MODELS_MODE` env knob for a given `*_MODELS` env var.
 *
 * Default is `'override'` (backwards-compatible: env list replaces live discovery).
 * When set to `'merge'`, the env list is unioned with the live-discovered list
 * so newly released provider models (e.g. `gpt-5.5-pro`) automatically appear
 * alongside any curated env-pinned models.
 */
export function resolveModelsListMode(envKey: string): 'override' | 'merge' {
  const raw = (process.env[`${envKey}_MODE`] ?? '').trim().toLowerCase();
  return raw === 'merge' ? 'merge' : 'override';
}

/**
 * Combine env-pinned models with live-discovery results. The env list is
 * preserved in order at the front and live additions are appended; duplicates
 * are removed (case-sensitive, exact-match) while preserving first-seen order.
 *
 * If the live fetcher throws or returns an empty list, we fall back to the env
 * list verbatim — the merge mode must never *lose* curated models because of a
 * transient discovery failure.
 *
 * Optional `filter` runs on the merged list (used for OpenAI/Azure to drop
 * audio/embedding/etc. models the live API surfaces but the chat path rejects).
 */
export async function unionWithLiveDiscovery({
  envModels,
  liveFetcher,
  filter,
}: {
  envModels: string[];
  liveFetcher: () => Promise<string[]>;
  filter?: (models: string[]) => string[];
}): Promise<string[]> {
  let liveModels: string[] = [];
  try {
    liveModels = await liveFetcher();
  } catch (error) {
    logger.error('[unionWithLiveDiscovery] live fetch failed; returning env list verbatim', error);
    return [...envModels];
  }

  if (!Array.isArray(liveModels) || liveModels.length === 0) {
    return [...envModels];
  }

  const combined = [...envModels, ...liveModels];
  const filtered = filter ? filter(combined) : combined;
  return Array.from(new Set(filtered));
}

/**
 * Numeric sort key for an OpenAI model id. Higher = newer/frontier so callers
 * sort DESCENDING by this score to put the latest gpt-5.X / o-series models at
 * the top of the chat picker.
 *
 *   gpt-5.5-pro              → 505 (5*100 + 5)
 *   gpt-5                    → 500
 *   gpt-4.1-mini             → 401
 *   gpt-4o / gpt-4-turbo     → 400
 *   o4-mini                  → 400 (o-series treated as gpt-N for ordering)
 *   gpt-3.5-turbo            → 305
 *   chatgpt-4o-latest        → 400
 *   unknown / non-OpenAI ids → -1 (sorts to the end before instruct)
 *
 * NOTE: This is intentionally regex-based (not a full semver parser) so it
 * keeps working as OpenAI ships new families (e.g., `gpt-5.5`, `gpt-5.6`,
 * `o5`, future variants) without having to update an explicit allow-list.
 */
export function getOpenAIModelVersionScore(model: string): number {
  if (!model || typeof model !== 'string') {
    return -1;
  }
  const m = model.toLowerCase();

  let match = m.match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (match) {
    return parseInt(match[1], 10) * 100 + (match[2] ? parseInt(match[2], 10) : 0);
  }

  match = m.match(/^chatgpt-(\d+)(?:\.(\d+))?/);
  if (match) {
    return parseInt(match[1], 10) * 100 + (match[2] ? parseInt(match[2], 10) : 0);
  }

  match = m.match(/^o(\d+)/);
  if (match) {
    return parseInt(match[1], 10) * 100;
  }

  return -1;
}

/**
 * Stable sort that puts current/recent OpenAI chat models first. The primary
 * order is maintained from OpenAI's published chat/responses model order, with
 * `chat-latest` pinned above dated families and a semantic fallback for future
 * GPT/o-series ids.
 *
 * Applied to live discovery and env+live unions so newly-released frontier ids
 * rank near the top of the picker instead of following provider API order.
 */
export function sortOpenAIModelsByVersion(models: string[]): string[] {
  const indexMap = new Map<string, number>();
  models.forEach((m, i) => {
    if (!indexMap.has(m)) indexMap.set(m, i);
  });

  return models.slice().sort((a, b) => {
    const va = getOpenAIModelReleaseScore(a);
    const vb = getOpenAIModelReleaseScore(b);
    if (va !== vb) return vb - va;

    const variantA = getOpenAIVariantRank(a);
    const variantB = getOpenAIVariantRank(b);
    if (variantA !== variantB) return variantA - variantB;

    return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
  });
}

/**
 * Numeric sort key for an Anthropic model id. Higher = newer.
 *   claude-4-6 / claude-opus-4-6 → 406
 *   claude-sonnet-4-5            → 405
 *   claude-3-7-sonnet            → 307
 *   claude-3-5-sonnet            → 305
 *   claude-3-haiku               → 300
 *   anything else                → -1
 */
export function getAnthropicModelVersionScore(model: string): number {
  if (!model || typeof model !== 'string') {
    return -1;
  }
  const m = model.toLowerCase();
  // Match `claude-<major>-<minor>` regardless of intervening words like
  // `opus`/`sonnet`/`haiku`. Examples: claude-3-5-sonnet, claude-opus-4-6,
  // claude-sonnet-4-5-20250929.
  const match = m.match(/^claude(?:-[a-z]+)*-(\d+)(?:-(\d+))?/);
  if (!match) return -1;
  const major = parseInt(match[1], 10);
  const minor = match[2] ? parseInt(match[2], 10) : 0;
  return major * 100 + minor;
}

export function sortAnthropicModelsByVersion(models: string[]): string[] {
  const indexMap = new Map<string, number>();
  models.forEach((m, i) => {
    if (!indexMap.has(m)) indexMap.set(m, i);
  });
  return models.slice().sort((a, b) => {
    const va = getAnthropicModelVersionScore(a);
    const vb = getAnthropicModelVersionScore(b);
    if (va !== vb) return vb - va;
    return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
  });
}

/**
 * Numeric sort key for a Google Gemini model id. Higher = newer.
 *   gemini-3.1-pro    → 301
 *   gemini-2.5-flash  → 205
 *   gemini-2.0-flash  → 200
 *   anything else     → -1
 */
export function getGoogleModelVersionScore(model: string): number {
  if (!model || typeof model !== 'string') {
    return -1;
  }
  const m = model.toLowerCase();
  const match = m.match(/^gemini-(\d+)(?:\.(\d+))?/);
  if (!match) return -1;
  const major = parseInt(match[1], 10);
  const minor = match[2] ? parseInt(match[2], 10) : 0;
  return major * 100 + minor;
}

export function sortGoogleModelsByVersion(models: string[]): string[] {
  const indexMap = new Map<string, number>();
  models.forEach((m, i) => {
    if (!indexMap.has(m)) indexMap.set(m, i);
  });
  return models.slice().sort((a, b) => {
    const va = getGoogleModelVersionScore(a);
    const vb = getGoogleModelVersionScore(b);
    if (va !== vb) return vb - va;
    return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
  });
}

function getXAIModelCapabilitiesCacheKey(tokenKey: string, userId?: string): string {
  const userSuffix = userId ? `:user:${userId}` : '';
  return `${XAI_MODEL_CAPABILITIES_CACHE_KEY_PREFIX}${tokenKey}${userSuffix}`;
}

function buildXAIRequestOptions(
  apiKey: string,
  headers: Record<string, string> | null | undefined,
  userObject?: Partial<IUser>,
): {
  headers: Record<string, string>;
  timeout: number;
  httpsAgent?: HttpsProxyAgent<string>;
} {
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

  return options;
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

  const options = buildXAIRequestOptions(apiKey, headers, userObject);
  const trimmedBaseURL = baseURL.replace(/\/+$/, '');
  let xaiModelCapabilities: Record<string, TXAIModelCapabilities> | undefined;

  try {
    const url = new URL(`${trimmedBaseURL}/language-models`);
    const response = await axios.get<XAIModelsResponse>(url.toString(), options);
    xaiModelCapabilities = buildXAIModelCapabilitiesMap(response.data.models ?? []);
  } catch (error) {
    logAxiosError({
      message: 'Failed to fetch language-models from xAI API; falling back to /models discovery',
      error: error as Error,
      level: 'warn',
    });
  }

  /**
   * xAI's `/v1/language-models` endpoint returns 403 for some key tiers/scopes.
   * Fall back to the standard OpenAI-compatible `/v1/models` listing and
   * synthesize id-only capability entries so downstream code still has a
   * canonical map to work with. Text-incompatible families (image/video/tts)
   * are filtered out via `buildXAIModelCapabilitiesMap`.
   */
  if (!xaiModelCapabilities || Object.keys(xaiModelCapabilities).length === 0) {
    try {
      const url = new URL(`${trimmedBaseURL}/models`);
      const response = await axios.get<{ data?: Array<{ id?: string }> }>(url.toString(), options);
      const idOnlyCapabilities: TXAIModelCapabilities[] = (response.data?.data ?? [])
        .map((item) => (typeof item?.id === 'string' ? { id: item.id } : null))
        .filter((item): item is TXAIModelCapabilities => item != null);
      if (idOnlyCapabilities.length > 0) {
        xaiModelCapabilities = buildXAIModelCapabilitiesMap(idOnlyCapabilities);
      }
    } catch (error) {
      logAxiosError({
        message: 'Failed to fetch models from xAI /models fallback',
        error: error as Error,
        level: 'warn',
      });
    }
  }

  if (!xaiModelCapabilities || Object.keys(xaiModelCapabilities).length === 0) {
    return undefined;
  }

  await modelsCache.set(cacheKey, xaiModelCapabilities);
  return xaiModelCapabilities;
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

async function fetchGoogleModelCapabilities({
  googleApiKey,
  cacheKey = GOOGLE_MODEL_CAPABILITIES_CACHE_KEY,
  forceRefresh = false,
}: {
  googleApiKey?: string;
  cacheKey?: string;
  forceRefresh?: boolean;
} = {}): Promise<Record<string, TGoogleModelCapabilities> | undefined> {
  const apiKey = googleApiKey ?? process.env.GOOGLE_KEY;

  if (!apiKey || isUserProvided(apiKey)) {
    return undefined;
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const cachedCapabilities = forceRefresh ? null : await modelsCache.get(cacheKey);

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

    await modelsCache.set(cacheKey, googleModelCapabilities);

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
  // Normalise Azure URLs for the actual HTTP request, but check the original shape
  // first so we can distinguish explicit /openai/v1 from legacy roots/deployments.
  const resolvedBaseURL = azure ? (normalizeAzureOpenAIBaseURL(baseURL) ?? baseURL) : baseURL;

  if (!resolvedBaseURL && ollamaBaseURLs.length === 0 && !azure) {
    return models;
  }

  if (!apiKey) {
    return models;
  }

  /** Whether the *original* (pre-normalisation) URL already carries /openai/v1 */
  const isDirectAzureV1 = azure && supportsAzureOpenAIModelListing(baseURL);
  /** Whether this is a legacy Azure endpoint that requires api-version on model probes */
  const isLegacyAzureEndpoint =
    azure && !isDirectAzureV1 && isAzureOpenAIBaseURL(baseURL) && !!azureApiVersion;

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

    // For explicit /openai/v1 Azure configs, use the normalised URL (no api-version).
    // For legacy Azure roots/deployments, use the original URL shape with api-version.
    const probeBase = isLegacyAzureEndpoint ? (baseURL ?? '') : (resolvedBaseURL ?? '');
    const url = new URL(`${probeBase.replace(/\/+$/, '')}/models`);
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
    logAxiosError({ message: logMessage, error: error as Error, level: 'warn' });
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
    // For Azure, preserve the original URL shape so fetchModels can distinguish
    // explicit /openai/v1 configs from legacy roots/deployments. Normalization
    // happens inside fetchModels at request-construction time.
    baseURL = opts.azure ? reverseProxyUrl : (extractBaseURL(reverseProxyUrl) ?? openaiBaseURL);
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const cacheKey = opts.cacheKey ?? baseURL;
  const shouldNormalizeOpenAIChatModels = usesNativeOpenAIModelCatalog(opts);

  const cachedModels = opts.forceRefresh ? null : await modelsCache.get(cacheKey);
  if (cachedModels) {
    const cached = cachedModels as string[];
    return shouldNormalizeOpenAIChatModels ? normalizeOpenAIChatModels(cached) : cached;
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
    return shouldNormalizeOpenAIChatModels ? normalizeOpenAIChatModels(_models) : _models;
  }

  if (shouldNormalizeOpenAIChatModels) {
    models = normalizeOpenAIChatModels(models);
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
  const usesUserProvidedOpenAISentinel =
    !opts.azure && isUserProvided(process.env.OPENAI_API_KEY) && !opts.openAIApiKey;

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
    const envModels = splitAndTrim(process.env[key]);
    const shouldAlwaysMergeNativeOpenAI =
      key === 'OPENAI_MODELS' && usesNativeOpenAIModelCatalog(opts);
    if (shouldAlwaysMergeNativeOpenAI || resolveModelsListMode(key) === 'merge') {
      // Skip live fetch when the user only supplies their own credentials
      // upstream; fetchOpenAIModels would just hit the shared key anyway and
      // leak admin-curated discovery into a user-provided context.
      if (
        (opts.userProvidedOpenAI || usesUserProvidedOpenAISentinel) &&
        (!opts.openAIApiKey || (opts.azure && !opts.baseURL))
      ) {
        return shouldAlwaysMergeNativeOpenAI ? normalizeOpenAIChatModels(envModels) : envModels;
      }

      const merged = await unionWithLiveDiscovery({
        envModels,
        // Pass an empty seed so a discovery failure surfaces as `[]` (which
        // unionWithLiveDiscovery treats as fallback) instead of leaking the
        // built-in defaults into the merged list.
        liveFetcher: () => fetchOpenAIModels(opts, []),
      });
      return opts.azure || opts.assistants ? merged : normalizeOpenAIChatModels(merged);
    }
    return envModels;
  }

  if (
    (opts.userProvidedOpenAI || usesUserProvidedOpenAISentinel) &&
    (!opts.openAIApiKey || (opts.azure && !opts.baseURL))
  ) {
    return !opts.azure && !opts.assistants ? normalizeOpenAIChatModels(models) : models;
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
  opts: {
    user?: string;
    anthropicApiKey?: string;
    baseURL?: string;
    cacheKey?: string;
    forceRefresh?: boolean;
  } = {},
  _models: string[] = [],
): Promise<string[]> {
  let models = _models.slice() ?? [];
  const apiKey = opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  const anthropicBaseURL = 'https://api.anthropic.com/v1';
  let baseURL = opts.baseURL ?? anthropicBaseURL;
  const reverseProxyUrl = process.env.ANTHROPIC_REVERSE_PROXY;

  if (!opts.baseURL && reverseProxyUrl) {
    baseURL = extractBaseURL(reverseProxyUrl) ?? anthropicBaseURL;
  }

  if (!apiKey || isUserProvided(apiKey)) {
    return models;
  }

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const cacheKey = opts.cacheKey ?? baseURL;

  const cachedModels = opts.forceRefresh ? null : await modelsCache.get(cacheKey);
  if (cachedModels) {
    return cachedModels as string[];
  }

  if (baseURL) {
    models = await fetchModels({
      apiKey,
      baseURL,
      user: opts.user,
      name: EModelEndpoint.anthropic,
      tokenKey: cacheKey,
    });
  }

  if (models.length === 0) {
    return _models;
  }

  models = sortAnthropicModelsByVersion(models);
  await modelsCache.set(cacheKey, models);
  return models;
}

/**
 * Gets Anthropic models from environment or API.
 * @param opts - Options for fetching models
 * @returns Promise resolving to array of model IDs
 */
export async function getAnthropicModels(
  opts: {
    user?: string;
    vertexModels?: string[];
    anthropicApiKey?: string;
    baseURL?: string;
    cacheKey?: string;
    forceRefresh?: boolean;
    userProvidedAnthropic?: boolean;
  } = {},
): Promise<string[]> {
  const models = defaultModels[EModelEndpoint.anthropic];

  // Vertex AI models from YAML config take priority
  if (opts.vertexModels && opts.vertexModels.length > 0) {
    return opts.vertexModels;
  }

  if (process.env.ANTHROPIC_MODELS) {
    const envModels = splitAndTrim(process.env.ANTHROPIC_MODELS);
    if (resolveModelsListMode('ANTHROPIC_MODELS') === 'merge') {
      if (opts.userProvidedAnthropic && !opts.anthropicApiKey) {
        return envModels;
      }
      const merged = await unionWithLiveDiscovery({
        envModels,
        // Pass empty seed so a failed live fetch surfaces as `[]` (which the
        // helper treats as fallback) instead of leaking the static defaults.
        liveFetcher: () => fetchAnthropicModels(opts, []),
      });
      return sortAnthropicModelsByVersion(merged);
    }
    return envModels;
  }

  if (opts.userProvidedAnthropic && !opts.anthropicApiKey) {
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

const ANTHROPIC_MODEL_CAPABILITIES_CACHE_KEY_PREFIX = `${EModelEndpoint.anthropic}:capabilities:`;

function getAnthropicCapabilitiesCacheKey(userId?: string, baseURL?: string): string {
  const u = userId ? `:user:${userId}` : ':global';
  const b = baseURL ? `:${baseURL}` : '';
  return `${ANTHROPIC_MODEL_CAPABILITIES_CACHE_KEY_PREFIX}${u}${b}`;
}

/**
 * Server-side capability map for Anthropic models. The startup config caches
 * the resulting Record so the chat-bar / model dropdown UI can decide which
 * controls to render (thinking, web search, code execution, etc.).
 *
 * Discovery order:
 *   1. cached map (unless `forceRefresh`)
 *   2. user/admin-supplied vertex model names (no remote call required)
 *   3. environment-defined `ANTHROPIC_MODELS`
 *   4. live `/v1/models` lookup via `getAnthropicModels`
 *   5. defaults from `librechat-data-provider`
 *
 * The returned shape is the same as the data-provider client-side helper
 * (id → metadata) so client utils (`getAnthropicModelCapabilities`) can resolve
 * per-model capabilities without re-running discovery.
 */
export async function getAnthropicModelCapabilities({
  user,
  vertexModels,
  forceRefresh = false,
}: {
  user?: string;
  vertexModels?: string[];
  forceRefresh?: boolean;
} = {}): Promise<Record<string, TAnthropicModelCapabilities> | undefined> {
  const baseURL = process.env.ANTHROPIC_REVERSE_PROXY
    ? (extractBaseURL(process.env.ANTHROPIC_REVERSE_PROXY) ?? 'https://api.anthropic.com/v1')
    : 'https://api.anthropic.com/v1';

  const modelsCache = standardCache(CacheKeys.MODEL_QUERIES);
  const cacheKey = getAnthropicCapabilitiesCacheKey(user, baseURL);

  if (!forceRefresh) {
    try {
      const cached = (await modelsCache.get(cacheKey)) as
        | Record<string, TAnthropicModelCapabilities>
        | undefined;
      if (cached) {
        return cached;
      }
    } catch (err) {
      logger.debug?.('[anthropic-capabilities] cache read failed', err);
    }
  }

  let modelNames: string[] = [];
  try {
    modelNames = await getAnthropicModels({ user, vertexModels, forceRefresh });
  } catch (err) {
    logger.error?.('[anthropic-capabilities] failed to load Anthropic models list', err);
    modelNames = defaultModels[EModelEndpoint.anthropic] ?? [];
  }

  const capabilities = buildStaticAnthropicModelCapabilities(modelNames);
  if (!capabilities || Object.keys(capabilities).length === 0) {
    return undefined;
  }

  try {
    await modelsCache.set(cacheKey, capabilities);
  } catch (err) {
    logger.debug?.('[anthropic-capabilities] cache write failed', err);
  }

  return capabilities;
}

/**
 * Looks up the capabilities for a specific Google/Vertex model id.
 * Accepts a googleAuth argument for API compatibility; Vertex-specific
 * routing is handled by the caller once capabilities are returned.
 *
 * @param params.model - The canonical model id, e.g. `gemini-2.5-pro`.
 */
export async function getGoogleModelCapability({
  model,
}: {
  model?: string | null;
  googleAuth?: unknown;
} = {}): Promise<TGoogleModelCapabilities | undefined> {
  if (!model) {
    return undefined;
  }
  const capabilities = await fetchGoogleModelCapabilities();
  if (!capabilities) {
    return undefined;
  }
  return capabilities[model] ?? capabilities[`models/${model}`] ?? undefined;
}

/**
 * Gets Google models from environment, API, or defaults.
 * @returns Array of model IDs
 */
export async function getGoogleModels(
  opts: {
    googleApiKey?: string;
    cacheKey?: string;
    forceRefresh?: boolean;
    userProvidedGoogle?: boolean;
  } = {},
): Promise<string[]> {
  let models = defaultModels[EModelEndpoint.google];

  if (process.env.GOOGLE_MODELS) {
    const envModels = splitAndTrim(process.env.GOOGLE_MODELS);
    if (resolveModelsListMode('GOOGLE_MODELS') === 'merge') {
      const merged = await unionWithLiveDiscovery({
        envModels,
        liveFetcher: async () => {
          if (opts.userProvidedGoogle && !opts.googleApiKey) {
            return [];
          }
          const capabilities = await fetchGoogleModelCapabilities(opts);
          return capabilities ? Object.keys(capabilities) : [];
        },
      });
      return sortGoogleModelsByVersion(merged);
    }
    return envModels;
  }

  if (opts.userProvidedGoogle && !opts.googleApiKey) {
    return models;
  }

  const googleModelCapabilities = await fetchGoogleModelCapabilities(opts);

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
