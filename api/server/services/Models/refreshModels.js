const { logger } = require('@librechat/data-schemas');
const { CacheKeys, EModelEndpoint, normalizeEndpointName } = require('librechat-data-provider');
const {
  loadModels,
  getModelsConfig,
  resetStartupModelRefresh,
} = require('~/server/controllers/ModelController');
const { getAppConfig } = require('~/server/services/Config/app');
const { getLogStores } = require('~/cache');

/**
 * Returns the list of provider/endpoint names that the workspace currently knows
 * about (the same set the chat picker can show).
 *
 * @param {object} appConfig
 * @returns {string[]}
 */
function getKnownProviderNames(appConfig) {
  const builtIn = [
    EModelEndpoint.openAI,
    EModelEndpoint.anthropic,
    EModelEndpoint.google,
    EModelEndpoint.azureOpenAI,
    EModelEndpoint.assistants,
    EModelEndpoint.azureAssistants,
    EModelEndpoint.bedrock,
  ];

  const customNames = Array.isArray(appConfig?.endpoints?.[EModelEndpoint.custom])
    ? appConfig.endpoints[EModelEndpoint.custom]
        .map((endpoint) => endpoint?.name)
        .filter((name) => typeof name === 'string' && name.length > 0)
        .map(normalizeEndpointName)
    : [];

  return Array.from(new Set([...builtIn, ...customNames]));
}

/**
 * Best-effort wipe of the entire MODEL_QUERIES cache namespace. The keys in this
 * namespace are per-baseURL or per-endpoint and are what `getOpenAIModels`,
 * `fetchAnthropicModels`, the xAI capability fetcher and the Ollama source-map
 * fetcher all read before deciding whether to hit the live provider API.
 *
 * Returns true on success.
 */
async function clearAllModelQueriesCache() {
  const cache = getLogStores(CacheKeys.MODEL_QUERIES);
  if (!cache) {
    return false;
  }

  if (typeof cache.clear === 'function') {
    try {
      await cache.clear();
      return true;
    } catch (error) {
      logger.warn('[refreshModels] cache.clear() failed; falling back to per-key delete', error);
    }
  }

  if (typeof cache.iterator === 'function' && typeof cache.delete === 'function') {
    try {
      const keys = [];
      for await (const [key] of cache.iterator()) {
        keys.push(key);
      }
      await Promise.allSettled(keys.map((key) => cache.delete(key)));
      return true;
    } catch (error) {
      logger.error('[refreshModels] failed to iterate MODEL_QUERIES cache', error);
    }
  }

  return false;
}

/**
 * Deletes cached model-derived config so the next config/model requests rebuild
 * from the per-provider fetches.
 */
async function clearModelsConfigCache() {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  if (!cache || typeof cache.delete !== 'function') {
    return false;
  }

  await Promise.allSettled([
    cache.delete(CacheKeys.MODELS_CONFIG),
    cache.delete(CacheKeys.STARTUP_CONFIG),
  ]);
  return true;
}

async function invalidateModelDiscoveryCaches() {
  await Promise.allSettled([clearAllModelQueriesCache(), clearModelsConfigCache()]);
  resetStartupModelRefresh();
}

/**
 * Build the response payload from the freshly resolved models config.
 *
 * @param {object} modelsConfig - Provider -> string[] map returned by loadModels.
 * @param {string[]} [providerFilter] - When provided, only emit these provider names.
 */
function buildProvidersPayload(modelsConfig, providerFilter) {
  const allProviders = Object.entries(modelsConfig ?? {}).filter(
    ([key, value]) => key !== 'initial' && Array.isArray(value),
  );

  const filtered = providerFilter
    ? allProviders.filter(([key]) => providerFilter.includes(key))
    : allProviders;

  return filtered.reduce((acc, [name, models]) => {
    acc[name] = {
      count: models.length,
      models,
    };
    return acc;
  }, {});
}

/**
 * Refresh every provider's model list.
 *
 * Strategy:
 *  1. Wipe MODEL_QUERIES (per-baseURL caches that getXxxModels consult first).
 *  2. Wipe MODELS_CONFIG (the aggregate cache used by loadModels).
 *  3. Reset the in-process "startup refresh already happened" latch so the
 *     subsequent loadModels call hits the forced-refresh code path for OpenAI
 *     and friends.
 *  4. Call loadModels(req) which will re-fetch from every provider using the
 *     same code paths exercised at server start.
 *
 * @param {ServerRequest} req
 * @returns {Promise<{ refreshedAt: string, providers: Record<string, { count: number, models: string[] }> }>}
 */
async function refreshAllModels(req) {
  await invalidateModelDiscoveryCaches();

  const modelsConfig = await loadModels(req);
  const appConfig = await getAppConfig({ role: req.user?.role }).catch(() => undefined);
  const providers = buildProvidersPayload(modelsConfig, getKnownProviderNames(appConfig));

  logger.info(
    `[refreshModels] full refresh completed (${Object.keys(providers).length} providers)`,
  );

  return {
    refreshedAt: new Date().toISOString(),
    providers,
  };
}

/**
 * Refresh a single provider's model list. Drops the relevant MODEL_QUERIES
 * entries and the aggregate MODELS_CONFIG cache so the next loadModels call
 * re-fetches the requested provider from its API. Other providers are
 * re-resolved as well (they will mostly hit MODEL_QUERIES for unchanged data),
 * but only the requested provider is returned in the payload.
 *
 * @param {ServerRequest} req
 * @param {string} provider
 */
async function refreshProviderModels(req, provider) {
  const normalized = normalizeEndpointName(provider);
  if (!normalized) {
    throw new Error('Provider name is required');
  }

  const appConfig = await getAppConfig({ role: req.user?.role }).catch(() => undefined);
  const known = new Set(getKnownProviderNames(appConfig));
  if (!known.has(normalized)) {
    const error = new Error(`Unknown provider: ${provider}`);
    error.statusCode = 400;
    throw error;
  }

  // We don't have a cheap, reliable way to enumerate per-provider keys inside
  // MODEL_QUERIES (cache keys are baseURL or endpoint-name based), so the
  // safest approach is to wipe the namespace and let the next loadModels
  // re-populate it. This is identical to what the global refresh does, but
  // we only return the requested provider in the response so the UI updates
  // a single row at a time.
  await invalidateModelDiscoveryCaches();

  const modelsConfig = await loadModels(req);
  const providers = buildProvidersPayload(modelsConfig, [normalized]);

  logger.info(`[refreshModels] provider refresh completed for "${normalized}"`);

  return {
    refreshedAt: new Date().toISOString(),
    providers,
  };
}

/**
 * Returns the current models snapshot for the requesting user without forcing
 * a refresh. Useful for surfacing pre-refresh counts in the admin UI.
 *
 * @param {ServerRequest} req
 */
async function getModelsSnapshot(req) {
  const modelsConfig = await getModelsConfig(req);
  const appConfig = await getAppConfig({ role: req.user?.role }).catch(() => undefined);
  const providers = buildProvidersPayload(modelsConfig, getKnownProviderNames(appConfig));

  return {
    refreshedAt: new Date().toISOString(),
    providers,
  };
}

module.exports = {
  refreshAllModels,
  refreshProviderModels,
  getModelsSnapshot,
  // exported for tests
  buildProvidersPayload,
  getKnownProviderNames,
  invalidateModelDiscoveryCaches,
};
