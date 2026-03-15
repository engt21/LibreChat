const { logger } = require('@librechat/data-schemas');
const { CacheKeys, EModelEndpoint, KnownEndpoints } = require('librechat-data-provider');
const { getGoogleModels } = require('@librechat/api');
const { loadDefaultModels, loadConfigModels } = require('~/server/services/Config');
const { filterModelsConfigForUser } = require('~/server/services/ModelAccess');
const { getLogStores } = require('~/cache');

/**
 * @param {ServerRequest} req
 * @returns {Promise<TModelsConfig>} The models config.
 */
const getModelsConfig = async (req) => {
  const modelsConfig = await loadModels(req);
  return filterModelsConfigForUser(modelsConfig, req.user);
};

/**
 * Loads the models from the config.
 * @param {ServerRequest} req - The Express request object.
 * @returns {Promise<TModelsConfig>} The models config.
 */
async function loadModels(req) {
  const cache = getLogStores(CacheKeys.CONFIG_STORE);
  const cachedModelsConfig = await cache.get(CacheKeys.MODELS_CONFIG);
  if (cachedModelsConfig) {
    const googleModels = await getGoogleModels().catch(
      () => cachedModelsConfig[EModelEndpoint.google],
    );
    const dynamicConfigModels = await loadConfigModels(req, {
      endpointNames: [KnownEndpoints.ollama],
    }).catch(() => ({ [KnownEndpoints.ollama]: cachedModelsConfig[KnownEndpoints.ollama] }));
    const ollamaModels = dynamicConfigModels[KnownEndpoints.ollama];

    if (
      JSON.stringify(cachedModelsConfig[EModelEndpoint.google] ?? []) !==
        JSON.stringify(googleModels ?? []) ||
      JSON.stringify(cachedModelsConfig[KnownEndpoints.ollama] ?? []) !==
        JSON.stringify(ollamaModels ?? [])
    ) {
      const refreshedModelsConfig = {
        ...cachedModelsConfig,
        [EModelEndpoint.google]: googleModels ?? [],
        ...(ollamaModels !== undefined || cachedModelsConfig[KnownEndpoints.ollama] !== undefined
          ? { [KnownEndpoints.ollama]: ollamaModels ?? [] }
          : {}),
      };

      await cache.set(CacheKeys.MODELS_CONFIG, refreshedModelsConfig);
      return refreshedModelsConfig;
    }

    return cachedModelsConfig;
  }
  const defaultModelsConfig = await loadDefaultModels(req);
  const customModelsConfig = await loadConfigModels(req);

  const modelConfig = { ...defaultModelsConfig, ...customModelsConfig };

  await cache.set(CacheKeys.MODELS_CONFIG, modelConfig);
  return modelConfig;
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
