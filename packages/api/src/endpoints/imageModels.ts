/**
 * Image-generation model discovery for the configured providers.
 *
 * Each provider has its own discovery contract:
 *   - OpenAI / Azure OpenAI: filter `/v1/models` for image-only model patterns.
 *   - xAI: reuse `/v1/language-models` capability discovery and filter for image output ids.
 *   - Google Gemini API: filter `models.list` for `imagen` / `*-image` / nano-banana models.
 *   - Vertex AI: same filters but uses the multi-location discovery client.
 *   - Flux (BFL) and Stability AI: curated lists keyed on a configured API key.
 *
 * The unified entry point `discoverImageModels` returns one entry per provider,
 * each marked `configured` only when usable credentials exist (server env or
 * resolved per-user keys). Discovery is intentionally tolerant: when a remote
 * call fails for a configured provider we still return the curated fallback
 * with a `notice` so the user is not blocked.
 */

import axios from 'axios';
import { GoogleGenAI } from '@google/genai';
import { logger } from '@librechat/data-schemas';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  CacheKeys,
  EModelEndpoint,
  ImageGenProvider,
  Time,
  azureOpenAIKnownImageModels,
  fluxKnownModels,
  stabilityKnownModels,
  imageGenDefaultModel,
  imageGenProviderDisplayName,
  imageGenProviderOrder,
  isOpenAIImageModelName,
  isXAIImageModelName,
  isGoogleImageModelName,
  pickDefaultImageModel,
  sortImageModelsByRecency,
  extractEnvVariable,
  isXAIEndpointCandidate,
} from 'librechat-data-provider';
import type { AppConfig, IUser } from '@librechat/data-schemas';
import type {
  TImageGenModel,
  TImageGenProviderInfo,
  TImageGenModelsResponse,
} from 'librechat-data-provider';
import { extractBaseURL, isUserProvided, logAxiosError, resolveHeaders } from '~/utils';
import { isAzureOpenAIBaseURL, normalizeAzureOpenAIBaseURL } from '~/utils/azure';
import { standardCache } from '~/cache';
import { prepareGoogleCredentials, resolveGoogleClientAuth } from './google/auth';
import type { ResolveGoogleClientAuthResult } from './google/auth';

const IMAGE_MODELS_CACHE_PREFIX = 'image-models:';
const IMAGE_MODELS_CACHE_TTL = Time.ONE_HOUR;

interface OpenAIModelEntry {
  id: string;
  created?: number;
}

interface OpenAIModelsResponse {
  data?: OpenAIModelEntry[];
}

interface VertexImageListModel {
  name?: string;
  displayName?: string;
  description?: string;
  supportedActions?: string[];
}

/**
 * Lookup contract supplied by the calling layer for resolving per-user creds.
 * The server-side controller wires this to `loadAuthValues` so we do not depend
 * on the api/ workspace from packages/api.
 */
export type LoadCredentialFn = (params: {
  userId: string;
  authFields: string[];
}) => Promise<Record<string, string | undefined>>;

export type LoadEndpointKeyValuesFn = (params: {
  userId: string;
  name: string;
}) => Promise<Record<string, string | undefined> | undefined>;

export interface DiscoverImageModelsOptions {
  user?: IUser;
  appConfig?: AppConfig;
  loadCredential?: LoadCredentialFn;
  loadEndpointKeyValues?: LoadEndpointKeyValuesFn;
  forceRefresh?: boolean;
}

interface DiscoveryResult {
  models: TImageGenModel[];
  notice?: string;
  configured: boolean;
  credentialSource?: 'server' | 'user' | 'none';
}

const sharedCacheInstances = new Map<string, ReturnType<typeof standardCache>>();

function getModelsCache() {
  const key = `${CacheKeys.MODEL_QUERIES}:image`;
  let cache = sharedCacheInstances.get(key);
  if (!cache) {
    cache = standardCache(`${CacheKeys.MODEL_QUERIES}-image`, IMAGE_MODELS_CACHE_TTL);
    sharedCacheInstances.set(key, cache);
  }
  return cache;
}

function buildModelEntry(id: string, displayName?: string, releasedAt?: string): TImageGenModel {
  return { id, displayName, releasedAt };
}

function dedupeAndSortModels(models: TImageGenModel[]): TImageGenModel[] {
  const seen = new Map<string, TImageGenModel>();
  for (const model of models) {
    if (!seen.has(model.id)) {
      seen.set(model.id, model);
    }
  }
  return sortImageModelsByRecency([...seen.values()]);
}

/**
 * Tries env then per-user plugin auth values. Returns the first non-empty match
 * along with the source (`server` for env, `user` for plugin).
 */
async function resolveCredential({
  user,
  loadCredential,
  envCandidates,
  authFields,
}: {
  user?: IUser;
  loadCredential?: LoadCredentialFn;
  envCandidates: string[];
  authFields: string[];
}): Promise<{ value?: string; source: 'server' | 'user' | 'none' }> {
  for (const envName of envCandidates) {
    const envValue = process.env[envName];
    if (envValue && envValue.trim() !== '' && !isUserProvided(envValue)) {
      return { value: envValue, source: 'server' };
    }
  }

  if (user?.id && loadCredential && authFields.length > 0) {
    try {
      const values = await loadCredential({ userId: user.id, authFields });
      for (const field of authFields) {
        const v = values?.[field];
        if (v && v.trim() !== '') {
          return { value: v, source: 'user' };
        }
      }
    } catch (err) {
      logger.debug?.('[imageModels] Failed to load per-user credential', err);
    }
  }

  return { source: 'none' };
}

/* -------------------------- OpenAI / Azure OpenAI -------------------------- */

async function fetchOpenAIImageModelIds({
  apiKey,
  baseURL,
  azure = false,
  azureApiVersion,
  headers,
  user,
}: {
  apiKey: string;
  baseURL?: string;
  azure?: boolean;
  azureApiVersion?: string;
  headers?: Record<string, string> | null;
  user?: IUser;
}): Promise<string[]> {
  if (!apiKey) {
    return [];
  }

  const resolvedHeaders: Record<string, string> = {
    ...(resolveHeaders({ headers: headers ?? undefined, user }) ?? {}),
  };

  if (azure) {
    resolvedHeaders['api-key'] = apiKey;
  } else {
    resolvedHeaders.Authorization = `Bearer ${apiKey}`;
  }

  const probeBase =
    azure && baseURL && isAzureOpenAIBaseURL(baseURL)
      ? (normalizeAzureOpenAIBaseURL(baseURL) ?? baseURL)
      : (baseURL ?? 'https://api.openai.com/v1');

  const url = new URL(`${probeBase.replace(/\/+$/, '')}/models`);
  if (azure && azureApiVersion && !probeBase.includes('/openai/v1')) {
    url.searchParams.append('api-version', azureApiVersion);
  }

  const options: Parameters<typeof axios.get>[1] = {
    headers: resolvedHeaders,
    timeout: 5000,
  };

  if (process.env.PROXY) {
    (options as { httpsAgent?: HttpsProxyAgent<string> }).httpsAgent = new HttpsProxyAgent(
      process.env.PROXY,
    );
  }

  try {
    const response = await axios.get<OpenAIModelsResponse>(url.toString(), options);
    const ids = (response.data?.data ?? []).map((entry) => entry.id).filter(Boolean);
    return ids.filter((id) => isOpenAIImageModelName(id));
  } catch (error) {
    logAxiosError({
      message: `Failed to discover image models from ${azure ? 'Azure OpenAI' : 'OpenAI'} API`,
      error: error as Error,
    });
    return [];
  }
}

async function discoverOpenAIImageModels({
  user,
  loadCredential,
}: {
  user?: IUser;
  loadCredential?: LoadCredentialFn;
}): Promise<DiscoveryResult> {
  const credential = await resolveCredential({
    user,
    loadCredential,
    envCandidates: ['IMAGE_GEN_OAI_API_KEY', 'OPENAI_API_KEY'],
    authFields: ['IMAGE_GEN_OAI_API_KEY', 'OPENAI_API_KEY'],
  });

  if (!credential.value) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  const baseURL = extractBaseURL(process.env.IMAGE_GEN_OAI_BASEURL ?? '') ?? undefined;
  const ids = await fetchOpenAIImageModelIds({
    apiKey: credential.value,
    baseURL,
    user,
  });

  let models = ids.map((id) => buildModelEntry(id));
  let notice: string | undefined;

  if (models.length === 0) {
    models = [buildModelEntry(imageGenDefaultModel[ImageGenProvider.openai])];
    notice = 'Could not list OpenAI image models from /v1/models. Showing the recommended default.';
  }

  return {
    configured: true,
    credentialSource: credential.source,
    models: dedupeAndSortModels(models),
    notice,
  };
}

async function discoverAzureOpenAIImageModels({
  user,
  loadCredential,
  loadEndpointKeyValues,
}: {
  user?: IUser;
  loadCredential?: LoadCredentialFn;
  loadEndpointKeyValues?: LoadEndpointKeyValuesFn;
}): Promise<DiscoveryResult> {
  const credential = await resolveCredential({
    user,
    loadCredential,
    envCandidates: ['AZURE_API_KEY', 'AZURE_OPENAI_API_KEY', 'IMAGE_GEN_OAI_API_KEY'],
    authFields: ['AZURE_API_KEY', 'AZURE_OPENAI_API_KEY'],
  });

  const envBaseURL =
    extractEnvVariable(process.env.IMAGE_GEN_OAI_BASEURL ?? '') ||
    extractEnvVariable(process.env.AZURE_OPENAI_BASEURL ?? '');
  let endpointKeyValues: Record<string, string | undefined> | undefined;
  if (user?.id && loadEndpointKeyValues && (!envBaseURL || isUserProvided(envBaseURL))) {
    try {
      endpointKeyValues = await loadEndpointKeyValues({
        userId: user.id,
        name: EModelEndpoint.azureOpenAI,
      });
    } catch (err) {
      logger.debug?.('[imageModels] Failed to load Azure endpoint key values', err);
    }
  }

  const baseURL =
    envBaseURL && !isUserProvided(envBaseURL) ? envBaseURL : endpointKeyValues?.baseURL;
  const apiKey = credential.value || endpointKeyValues?.apiKey;

  if (!apiKey || !baseURL || isUserProvided(baseURL)) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  const azureApiVersion =
    process.env.IMAGE_GEN_OAI_AZURE_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION;

  const ids = await fetchOpenAIImageModelIds({
    apiKey,
    baseURL,
    azure: true,
    azureApiVersion,
    user,
  });

  const manualImageModels = (endpointKeyValues?.models ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter((model) => isOpenAIImageModelName(model))
    .map((model) => buildModelEntry(model));
  const curatedModels = azureOpenAIKnownImageModels.map((model) =>
    buildModelEntry(model.id, model.displayName, model.releasedAt),
  );
  let models = [...ids.map((id) => buildModelEntry(id)), ...manualImageModels];
  let notice: string | undefined;

  if (models.length === 0) {
    models = curatedModels;
    notice = 'Could not list Azure OpenAI image deployments. Showing known Azure image model ids.';
  } else {
    models = [...models, ...curatedModels];
  }

  return {
    configured: true,
    credentialSource: credential.source !== 'none' ? credential.source : 'user',
    models: dedupeAndSortModels(models),
    notice,
  };
}

/* -------------------------------- xAI ------------------------------------ */

async function discoverXAIImageModels({
  user,
  appConfig,
  loadCredential,
}: {
  user?: IUser;
  appConfig?: AppConfig;
  loadCredential?: LoadCredentialFn;
}): Promise<DiscoveryResult> {
  const customEndpoints = appConfig?.endpoints?.[EModelEndpoint.custom] ?? [];
  let resolvedApiKey: string | undefined;
  let resolvedBaseURL: string | undefined;
  let credentialSource: 'server' | 'user' | 'none' = 'none';

  for (const endpoint of customEndpoints) {
    const endpointName = endpoint?.name;
    const baseURL = extractEnvVariable(endpoint?.baseURL ?? '');
    if (
      !endpointName ||
      !endpoint?.apiKey ||
      !baseURL ||
      !isXAIEndpointCandidate({
        endpoint: endpointName,
        baseURL,
        defaultParamsEndpoint: endpoint.customParams?.defaultParamsEndpoint,
      })
    ) {
      continue;
    }
    const apiKeyEnv = extractEnvVariable(endpoint.apiKey);
    if (apiKeyEnv && !isUserProvided(apiKeyEnv)) {
      resolvedApiKey = apiKeyEnv;
      resolvedBaseURL = endpoint.directEndpoint ? (extractBaseURL(baseURL) ?? baseURL) : baseURL;
      credentialSource = 'server';
      break;
    }
    if (user?.id && loadCredential && isUserProvided(apiKeyEnv)) {
      try {
        const values = await loadCredential({
          userId: user.id,
          authFields: ['XAI_API_KEY'],
        });
        const userKey = values?.XAI_API_KEY;
        if (userKey) {
          resolvedApiKey = userKey;
          resolvedBaseURL = endpoint.directEndpoint
            ? (extractBaseURL(baseURL) ?? baseURL)
            : baseURL;
          credentialSource = 'user';
          break;
        }
      } catch (err) {
        logger.debug?.('[imageModels] Failed to load xAI per-user credential', err);
      }
    }
  }

  if (!resolvedApiKey || !resolvedBaseURL) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  try {
    const url = new URL(`${resolvedBaseURL.replace(/\/+$/, '')}/language-models`);
    const response = await axios.get<{
      models?: Array<{ id?: string; aliases?: string[]; output_modalities?: string[] }>;
    }>(url.toString(), {
      headers: { Authorization: `Bearer ${resolvedApiKey}` },
      timeout: 5000,
    });
    const ids: string[] = [];
    for (const model of response.data?.models ?? []) {
      if (!model?.id) continue;
      const outputs = (model.output_modalities ?? []).map((o) => (o ?? '').toLowerCase());
      const supportsImageOutput = outputs.includes('image');
      if (supportsImageOutput || isXAIImageModelName(model.id)) {
        ids.push(model.id);
        for (const alias of model.aliases ?? []) {
          if (alias && (supportsImageOutput || isXAIImageModelName(alias))) {
            ids.push(alias);
          }
        }
      }
    }

    let models = ids.map((id) => buildModelEntry(id));
    let notice: string | undefined;
    if (models.length === 0) {
      models = [buildModelEntry(imageGenDefaultModel[ImageGenProvider.xai])];
      notice = 'Could not list xAI image models. Showing the recommended default.';
    }

    return {
      configured: true,
      credentialSource,
      models: dedupeAndSortModels(models),
      notice,
    };
  } catch (error) {
    logAxiosError({
      message: 'Failed to discover image models from xAI /language-models',
      error: error as Error,
    });
    return {
      configured: true,
      credentialSource,
      models: [buildModelEntry(imageGenDefaultModel[ImageGenProvider.xai])],
      notice: 'xAI discovery failed. Showing the recommended default.',
    };
  }
}

/* ----------------------------- Google / Vertex --------------------------- */

async function discoverGoogleApiImageModels({
  user,
  loadCredential,
}: {
  user?: IUser;
  loadCredential?: LoadCredentialFn;
}): Promise<DiscoveryResult> {
  const credential = await resolveCredential({
    user,
    loadCredential,
    envCandidates: ['GEMINI_API_KEY', 'GOOGLE_KEY'],
    authFields: ['GEMINI_API_KEY', 'GOOGLE_KEY'],
  });

  if (!credential.value) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  try {
    const client = new GoogleGenAI({ apiKey: credential.value });
    const modelPager = (await client.models.list({
      config: { pageSize: 100 },
    })) as AsyncIterable<{ name?: string; displayName?: string }>;

    const ids: string[] = [];
    const display: Record<string, string | undefined> = {};
    for await (const model of modelPager) {
      const id = (model.name ?? '').replace(/^models\//, '').trim();
      if (!id) continue;
      if (!isGoogleImageModelName(id)) continue;
      ids.push(id);
      display[id] = model.displayName ?? undefined;
    }

    let models = ids.map((id) => buildModelEntry(id, display[id]));
    let notice: string | undefined;
    if (models.length === 0) {
      models = [buildModelEntry(imageGenDefaultModel[ImageGenProvider.google])];
      notice = 'Could not list Google image models. Showing the recommended default.';
    }

    return {
      configured: true,
      credentialSource: credential.source,
      models: dedupeAndSortModels(models),
      notice,
    };
  } catch (error) {
    logger.warn(
      `[imageModels] Google API discovery failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      configured: true,
      credentialSource: credential.source,
      models: [buildModelEntry(imageGenDefaultModel[ImageGenProvider.google])],
      notice: 'Google discovery failed. Showing the recommended default.',
    };
  }
}

async function discoverVertexImageModels(): Promise<DiscoveryResult> {
  const credentials = await prepareGoogleCredentials().catch(() => undefined);
  if (!credentials) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  let auth: ResolveGoogleClientAuthResult;
  try {
    auth = resolveGoogleClientAuth(credentials);
  } catch {
    return { configured: false, credentialSource: 'none', models: [] };
  }
  if (!auth.useVertex || !auth.isConfigured) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  const location = auth.location || 'us-central1';
  try {
    const client = new GoogleGenAI({
      ...auth.clientOptions,
      location,
    });
    const modelPager = (await client.models.list({
      config: { pageSize: 100 },
    })) as AsyncIterable<VertexImageListModel>;

    const ids: string[] = [];
    const display: Record<string, string | undefined> = {};
    for await (const model of modelPager) {
      const id = (model.name ?? '').replace(/^.*models\//, '').trim();
      if (!id) continue;
      if (!isGoogleImageModelName(id)) continue;
      ids.push(id);
      display[id] = model.displayName ?? undefined;
    }

    let models = ids.map((id) => buildModelEntry(id, display[id]));
    let notice: string | undefined;
    if (models.length === 0) {
      models = [buildModelEntry(imageGenDefaultModel[ImageGenProvider.vertex])];
      notice = 'Could not list Vertex image models. Showing the recommended default.';
    }

    return {
      configured: true,
      credentialSource: 'server',
      models: dedupeAndSortModels(models),
      notice,
    };
  } catch (error) {
    logger.warn(
      `[imageModels] Vertex discovery failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return {
      configured: true,
      credentialSource: 'server',
      models: [buildModelEntry(imageGenDefaultModel[ImageGenProvider.vertex])],
      notice: 'Vertex discovery failed. Showing the recommended default.',
    };
  }
}

/* ------------------------------- Flux / SAI ------------------------------ */

async function discoverFluxImageModels({
  user,
  loadCredential,
}: {
  user?: IUser;
  loadCredential?: LoadCredentialFn;
}): Promise<DiscoveryResult> {
  const credential = await resolveCredential({
    user,
    loadCredential,
    envCandidates: ['FLUX_API_KEY'],
    authFields: ['FLUX_API_KEY'],
  });

  if (!credential.value) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  return {
    configured: true,
    credentialSource: credential.source,
    models: dedupeAndSortModels(
      fluxKnownModels.map((m) => buildModelEntry(m.id, m.displayName, m.releasedAt)),
    ),
  };
}

async function discoverStabilityImageModels({
  user,
  loadCredential,
}: {
  user?: IUser;
  loadCredential?: LoadCredentialFn;
}): Promise<DiscoveryResult> {
  const credential = await resolveCredential({
    user,
    loadCredential,
    envCandidates: ['STABILITY_API_KEY', 'SAI_API_KEY', 'SD_API_KEY'],
    authFields: ['STABILITY_API_KEY', 'SAI_API_KEY', 'SD_API_KEY'],
  });

  if (!credential.value) {
    return { configured: false, credentialSource: 'none', models: [] };
  }

  return {
    configured: true,
    credentialSource: credential.source,
    models: dedupeAndSortModels(
      stabilityKnownModels.map((m) => buildModelEntry(m.id, m.displayName, m.releasedAt)),
    ),
  };
}

/* --------------------------------- entry --------------------------------- */

function buildProviderInfo(
  provider: ImageGenProvider,
  result: DiscoveryResult,
): TImageGenProviderInfo {
  const defaultModel = pickDefaultImageModel(provider, result.models);
  return {
    id: provider,
    name: imageGenProviderDisplayName[provider],
    configured: result.configured,
    credentialSource: result.credentialSource,
    notice: result.notice,
    models: result.models.map((model) => ({
      ...model,
      default: defaultModel === model.id,
    })),
  };
}

export async function discoverImageModels(
  options: DiscoverImageModelsOptions = {},
): Promise<TImageGenModelsResponse> {
  const { user, loadCredential, loadEndpointKeyValues, appConfig, forceRefresh = false } = options;

  const cacheKey = `${IMAGE_MODELS_CACHE_PREFIX}${user?.id ?? 'anon'}`;
  const cache = getModelsCache();
  if (!forceRefresh) {
    try {
      const cached = (await cache.get(cacheKey)) as TImageGenModelsResponse | undefined;
      if (cached) {
        return cached;
      }
    } catch (err) {
      logger.debug?.('[imageModels] cache read failed', err);
    }
  }

  const [openai, azureOpenAI, xai, google, vertex, flux, stability] = await Promise.all([
    discoverOpenAIImageModels({ user, loadCredential }),
    discoverAzureOpenAIImageModels({ user, loadCredential, loadEndpointKeyValues }),
    discoverXAIImageModels({ user, appConfig, loadCredential }),
    discoverGoogleApiImageModels({ user, loadCredential }),
    discoverVertexImageModels(),
    discoverFluxImageModels({ user, loadCredential }),
    discoverStabilityImageModels({ user, loadCredential }),
  ]);

  const byProvider: Record<ImageGenProvider, DiscoveryResult> = {
    [ImageGenProvider.openai]: openai,
    [ImageGenProvider.azureOpenAI]: azureOpenAI,
    [ImageGenProvider.xai]: xai,
    [ImageGenProvider.google]: google,
    [ImageGenProvider.vertex]: vertex,
    [ImageGenProvider.flux]: flux,
    [ImageGenProvider.stability]: stability,
  };

  const providers = imageGenProviderOrder.map((provider) =>
    buildProviderInfo(provider, byProvider[provider]),
  );

  const response: TImageGenModelsResponse = { providers };
  try {
    await cache.set(cacheKey, response, IMAGE_MODELS_CACHE_TTL);
  } catch (err) {
    logger.debug?.('[imageModels] cache write failed', err);
  }
  return response;
}

export function clearImageModelCachesForTests(): void {
  sharedCacheInstances.clear();
}
