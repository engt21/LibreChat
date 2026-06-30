const { logger } = require('@librechat/data-schemas');
const { initializeAgent, validateAgentModel } = require('@librechat/api');
const getStream = require('get-stream');
const { appendAgentIdSuffix } = require('librechat-data-provider');
const { loadAddedAgent, setGetAgent, ADDED_AGENT_ID } = require('~/models/loadAddedAgent');
const { getConvoFiles } = require('~/models/Conversation');
const { getAgent } = require('~/models/Agent');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const db = require('~/models');

async function getFileBuffer(req, file) {
  const source = file.source ?? 'local';
  const { getDownloadStream } = getStrategyFunctions(source);
  const stream = await getDownloadStream(req, file.filepath);
  return getStream.buffer(stream);
}

// Initialize the getAgent dependency
setGetAgent(getAgent);

const getAddedConvos = (endpointOption) => {
  const addedConvos = Array.isArray(endpointOption.addedConvos)
    ? endpointOption.addedConvos.filter(
        (convo) => convo && typeof convo === 'object' && !Array.isArray(convo),
      )
    : [];

  if (addedConvos.length > 0) {
    return addedConvos;
  }

  const addedConvo = endpointOption.addedConvo;
  if (!addedConvo || typeof addedConvo !== 'object' || Array.isArray(addedConvo)) {
    return [];
  }

  return [addedConvo];
};

/**
 * Process added conversations for parallel agent execution.
 * Creates parallel agent configs from added conversations.
 *
 * When an added agent has no incoming edges, it becomes a start node
 * and runs in parallel with the primary agent automatically.
 *
 * Edge cases handled:
 * - Primary agent has edges (handoffs): Added agent runs in parallel with primary,
 *   but doesn't participate in the primary's handoff graph
 * - Primary agent has agent_ids (legacy chain): Added agent runs in parallel with primary,
 *   but doesn't participate in the chain
 * - Primary agent has both: Added agent is independent, runs parallel from start
 *
 * @param {Object} params
 * @param {import('express').Request} params.req
 * @param {import('express').Response} params.res
 * @param {Object} params.endpointOption - The endpoint option containing addedConvo
 * @param {Object} params.modelsConfig - The models configuration
 * @param {Function} params.logViolation - Function to log violations
 * @param {Function} params.loadTools - Function to load agent tools
 * @param {Array} params.requestFiles - Request files
 * @param {string} params.conversationId - The conversation ID
 * @param {string} [params.parentMessageId] - The parent message ID for thread filtering
 * @param {Set} params.allowedProviders - Set of allowed providers
 * @param {Map} params.agentConfigs - Map of agent configs to add to
 * @param {string} params.primaryAgentId - The primary agent ID
 * @param {Object|undefined} params.userMCPAuthMap - User MCP auth map to merge into
 * @returns {Promise<{
 *   userMCPAuthMap: Object|undefined,
 *   agentToolContexts: Array<{
 *     agentId: string,
 *     agent: Object,
 *     toolRegistry?: import('@librechat/agents').LCToolRegistry,
 *     userMCPAuthMap?: Record<string, Record<string, string>>,
 *     tool_resources?: Object,
 *   }>,
 * }>} The updated userMCPAuthMap and added-agent execution contexts
 */
const processAddedConvo = async ({
  req,
  res,
  endpointOption,
  modelsConfig,
  logViolation,
  loadTools,
  requestFiles,
  conversationId,
  parentMessageId,
  allowedProviders,
  agentConfigs,
  primaryAgentId,
  primaryAgent,
  userMCPAuthMap,
}) => {
  const addedConvos = getAddedConvos(endpointOption);
  const agentToolContexts = [];
  if (addedConvos.length === 0) {
    return { userMCPAuthMap, agentToolContexts };
  }

  for (const [index, addedConvo] of addedConvos.entries()) {
    const addedIndex = index + 1;
    logger.debug('[processAddedConvo] Processing added conversation', {
      index: addedIndex,
      model: addedConvo.model,
      agentId: addedConvo.agent_id,
      endpoint: addedConvo.endpoint,
    });

    try {
      const addedAgent = await loadAddedAgent({
        req,
        conversation: addedConvo,
        primaryAgent,
        index: addedIndex,
      });
      if (!addedAgent) {
        continue;
      }

      const addedOriginalProvider = addedAgent.provider;

      const addedValidation = await validateAgentModel({
        req,
        res,
        modelsConfig,
        logViolation,
        agent: addedAgent,
      });

      if (!addedValidation.isValid) {
        logger.warn(
          `[processAddedConvo] Added agent validation failed: ${addedValidation.error?.message}`,
        );
        continue;
      }

      const addedConfig = await initializeAgent(
        {
          req,
          res,
          loadTools,
          requestFiles,
          conversationId,
          parentMessageId,
          agent: addedAgent,
          endpointOption,
          allowedProviders,
        },
        {
          getConvoFiles,
          getFiles: db.getFiles,
          getFileBuffer,
          getUserKey: db.getUserKey,
          getMessages: db.getMessages,
          updateFile: db.updateFile,
          updateFilesUsage: db.updateFilesUsage,
          getUserCodeFiles: db.getUserCodeFiles,
          getUserKeyValues: db.getUserKeyValues,
          getToolFilesByIds: db.getToolFilesByIds,
          getCodeGeneratedFiles: db.getCodeGeneratedFiles,
        },
      );

      // Restore the selected endpoint/provider for execution-time tool routing.
      // initializeAgent may normalize provider values for model clients.
      addedAgent.provider = addedOriginalProvider;

      if (userMCPAuthMap != null) {
        Object.assign(userMCPAuthMap, addedConfig.userMCPAuthMap ?? {});
      } else {
        userMCPAuthMap = addedConfig.userMCPAuthMap;
      }

      const addedAgentId = addedConfig.id || appendAgentIdSuffix(ADDED_AGENT_ID, addedIndex);
      agentConfigs.set(addedAgentId, addedConfig);
      agentToolContexts.push({
        agentId: addedAgentId,
        agent: addedAgent,
        toolRegistry: addedConfig.toolRegistry,
        userMCPAuthMap: addedConfig.userMCPAuthMap,
        tool_resources: addedConfig.tool_resources,
      });

      // No edges needed - agent without incoming edges becomes a start node
      // and runs in parallel with the primary agent automatically.
      // This is independent of any edges/agent_ids the primary agent has.

      logger.debug(
        `[processAddedConvo] Added parallel agent: ${addedAgentId} (primary: ${primaryAgentId}, ` +
          `primary has edges: ${!!endpointOption.edges}, primary has agent_ids: ${!!endpointOption.agent_ids})`,
      );
    } catch (err) {
      logger.error('[processAddedConvo] Error processing addedConvo for parallel agent', err);
    }
  }

  return { userMCPAuthMap, agentToolContexts };
};

module.exports = {
  processAddedConvo,
  ADDED_AGENT_ID,
};
