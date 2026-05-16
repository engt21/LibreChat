const { Providers } = require('@librechat/agents');
const { logger } = require('@librechat/data-schemas');
const { CacheKeys } = require('librechat-data-provider');
const { refreshGoogleVertexModelAccess } = require('@librechat/api');
const { getLogStores } = require('~/cache');

async function invalidateGoogleSelectorCaches() {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);

  if (!cache || typeof cache.delete !== 'function') {
    return;
  }

  await Promise.allSettled([
    cache.delete(CacheKeys.MODELS_CONFIG),
    cache.delete(CacheKeys.STARTUP_CONFIG),
  ]);
  logger.debug('[Google][Vertex Discovery] Invalidated cached model selectors after refresh');
}

async function maybeRefreshGoogleVertexModelAccess({ error, provider, clientOptions, model }) {
  if (provider !== Providers.VERTEXAI) {
    return false;
  }

  try {
    const refreshed = await refreshGoogleVertexModelAccess({
      error,
      model,
      clientOptions: clientOptions ?? undefined,
    });

    if (refreshed) {
      await invalidateGoogleSelectorCaches();
    }

    return refreshed;
  } catch (refreshError) {
    logger.error(
      '[Google][Vertex Discovery] Failed to refresh callable model cache after access error',
      refreshError,
    );
    return false;
  }
}

module.exports = {
  maybeRefreshGoogleVertexModelAccess,
};
