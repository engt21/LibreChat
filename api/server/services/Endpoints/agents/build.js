const { logger } = require('@librechat/data-schemas');
const { isAgentsEndpoint, removeNullishValues, Constants } = require('librechat-data-provider');
const { loadAgent } = require('~/models/Agent');

const buildOptions = (req, endpoint, parsedBody, endpointType) => {
  const {
    spec,
    iconURL,
    agent_id,
    addedConvo: _addedConvo,
    addedConvos: _addedConvos,
    ...model_parameters
  } = parsedBody;
  const agentPromise = loadAgent({
    req,
    spec,
    agent_id: isAgentsEndpoint(endpoint) ? agent_id : Constants.EPHEMERAL_AGENT_ID,
    endpoint,
    model_parameters,
  }).catch((error) => {
    logger.error(`[/agents/:${agent_id}] Error retrieving agent during build options step`, error);
    return undefined;
  });

  /** @type {import('librechat-data-provider').TConversation | undefined} */
  const addedConvo = req.body?.addedConvo;
  /** @type {import('librechat-data-provider').TConversation[] | undefined} */
  const addedConvos = Array.isArray(req.body?.addedConvos)
    ? req.body.addedConvos.filter(
        (convo) => convo && typeof convo === 'object' && !Array.isArray(convo),
      )
    : undefined;

  return removeNullishValues({
    spec,
    iconURL,
    endpoint,
    agent_id,
    endpointType,
    model_parameters,
    agent: agentPromise,
    addedConvo,
    addedConvos,
  });
};

module.exports = { buildOptions };
