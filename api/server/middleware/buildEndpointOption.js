const { handleError } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const {
  EndpointURLs,
  EModelEndpoint,
  isAgentsEndpoint,
  parseCompactConvo,
  getDefaultParamsEndpoint,
} = require('librechat-data-provider');
const azureAssistants = require('~/server/services/Endpoints/azureAssistants');
const assistants = require('~/server/services/Endpoints/assistants');
const { getEndpointsConfig } = require('~/server/services/Config');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { filterModelSpecsConfig } = require('~/server/services/ModelAccess');
const agents = require('~/server/services/Endpoints/agents');
const { updateFilesUsage } = require('~/models');
const { getEffectiveAppSettings } = require('~/server/services/Admin/appSettings');

const buildFunction = {
  [EModelEndpoint.agents]: agents.buildOptions,
  [EModelEndpoint.assistants]: assistants.buildOptions,
  [EModelEndpoint.azureAssistants]: azureAssistants.buildOptions,
};

function getPlatformPrompt(appSettings) {
  return typeof appSettings?.platformPrompt === 'string' && appSettings.platformPrompt.trim()
    ? appSettings.platformPrompt.trim()
    : '';
}

function combinePromptPrefix(platformPrompt, promptPrefix) {
  const parts = [platformPrompt, promptPrefix].filter(
    (part) => typeof part === 'string' && part.trim(),
  );

  return parts.length ? parts.join('\n\n') : undefined;
}

async function buildEndpointOption(req, res, next) {
  const { endpoint, endpointType } = req.body;

  let endpointsConfig;
  try {
    endpointsConfig = await getEndpointsConfig(req);
  } catch (error) {
    logger.error('Error fetching endpoints config in buildEndpointOption', error);
  }

  const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, endpoint);

  let parsedBody;
  try {
    parsedBody = parseCompactConvo({
      endpoint,
      endpointType,
      conversation: req.body,
      defaultParamsEndpoint,
    });
  } catch (error) {
    logger.error(`Error parsing compact conversation for endpoint ${endpoint}`, error);
    logger.debug({
      'Error parsing compact conversation': { endpoint, endpointType, conversation: req.body },
    });
    return handleError(res, { text: 'Error parsing conversation' });
  }

  const appConfig = req.config;
  const accessibleModelSpecs = appConfig.modelSpecs?.list
    ? filterModelSpecsConfig(appConfig.modelSpecs, await getModelsConfig(req))
    : appConfig.modelSpecs;

  if (accessibleModelSpecs?.list && accessibleModelSpecs?.enforce) {
    /** @type {{ list: TModelSpec[] }}*/
    const { list } = accessibleModelSpecs;
    const { spec } = parsedBody;

    if (!spec) {
      return handleError(res, { text: 'No model spec selected' });
    }

    const currentModelSpec = list.find((s) => s.name === spec);
    if (!currentModelSpec) {
      return handleError(res, { text: 'Invalid model spec' });
    }

    if (endpoint !== currentModelSpec.preset.endpoint) {
      return handleError(res, { text: 'Model spec mismatch' });
    }

    try {
      currentModelSpec.preset.spec = spec;
      parsedBody = parseCompactConvo({
        endpoint,
        endpointType,
        conversation: currentModelSpec.preset,
        defaultParamsEndpoint,
      });
      if (currentModelSpec.iconURL != null && currentModelSpec.iconURL !== '') {
        parsedBody.iconURL = currentModelSpec.iconURL;
      }
    } catch (error) {
      logger.error(`Error parsing model spec for endpoint ${endpoint}`, error);
      return handleError(res, { text: 'Error parsing model spec' });
    }
  } else if (parsedBody.spec && accessibleModelSpecs?.list) {
    // Non-enforced mode: if spec is selected, derive iconURL from model spec
    const modelSpec = accessibleModelSpecs.list.find((s) => s.name === parsedBody.spec);
    if (modelSpec?.iconURL) {
      parsedBody.iconURL = modelSpec.iconURL;
    }
  }

  try {
    const isAgents =
      isAgentsEndpoint(endpoint) || req.baseUrl.startsWith(EndpointURLs[EModelEndpoint.agents]);
    let appSettings = req.appSettings;
    if (!appSettings) {
      try {
        appSettings = await getEffectiveAppSettings();
        req.appSettings = appSettings;
      } catch (error) {
        logger.error('Error fetching app settings in buildEndpointOption', error);
      }
    }

    const platformPrompt = getPlatformPrompt(appSettings);
    if (!isAgents && platformPrompt) {
      parsedBody.promptPrefix = combinePromptPrefix(platformPrompt, parsedBody.promptPrefix);
      req.body.promptPrefix = parsedBody.promptPrefix;
    }

    const builder = isAgents
      ? (...args) => buildFunction[EModelEndpoint.agents](req, ...args)
      : buildFunction[endpointType ?? endpoint];

    // TODO: use object params
    req.body = req.body || {}; // Express 5: ensure req.body exists
    req.body.endpointOption = await builder(endpoint, parsedBody, endpointType);

    if (req.body.files && !isAgents) {
      req.body.endpointOption.attachments = updateFilesUsage(req.body.files);
    }

    next();
  } catch (error) {
    logger.error(
      `Error building endpoint option for endpoint ${endpoint} with type ${endpointType}`,
      error,
    );
    return handleError(res, { text: 'Error building endpoint option' });
  }
}

module.exports = buildEndpointOption;
