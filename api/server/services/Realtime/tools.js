const { zodToJsonSchema } = require('zod-to-json-schema');
const { Tools, EModelEndpoint } = require('librechat-data-provider');
const { loadTools } = require('~/app/clients/tools/util');

const REALTIME_SUPPORTED_TOOLS = new Set([Tools.web_search]);

function isZodSchema(schema) {
  return schema && typeof schema === 'object' && '_def' in schema;
}

function normalizeRequestedTools(tools = []) {
  if (!Array.isArray(tools)) {
    return [];
  }

  return [...new Set(tools.filter((tool) => REALTIME_SUPPORTED_TOOLS.has(tool)))];
}

async function loadRealtimeTools({ req, appConfig, endpoint, model, tools }) {
  const requestedTools = normalizeRequestedTools(tools);
  if (requestedTools.length === 0) {
    return { definitions: [], toolMap: new Map(), enabledTools: [] };
  }

  const { loadedTools = [] } = await loadTools({
    user: req.user.id,
    model,
    endpoint: endpoint || EModelEndpoint.openAI,
    tools: requestedTools,
    functions: true,
    options: {
      req,
      returnMetadata: true,
    },
    webSearch: appConfig.webSearch,
    fileStrategy: appConfig.fileStrategy,
    imageOutputType: appConfig.imageOutputType,
  });

  const definitions = loadedTools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: isZodSchema(tool.schema) ? zodToJsonSchema(tool.schema) : tool.schema,
  }));

  return {
    definitions,
    enabledTools: loadedTools.map((tool) => tool.name),
    toolMap: new Map(loadedTools.map((tool) => [tool.name, tool])),
  };
}

async function executeRealtimeTool({ toolMap, name, argumentsText }) {
  const tool = toolMap.get(name);
  if (!tool) {
    throw new Error(`Realtime tool is unavailable: ${name}`);
  }

  let args = {};
  if (argumentsText) {
    args = JSON.parse(argumentsText);
  }

  const result = await tool.invoke(args);
  return typeof result === 'string' ? result : JSON.stringify(result);
}

module.exports = {
  REALTIME_SUPPORTED_TOOLS,
  normalizeRequestedTools,
  loadRealtimeTools,
  executeRealtimeTool,
};
