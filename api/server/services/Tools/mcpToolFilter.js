const { Constants } = require('librechat-data-provider');

const { mcp_delimiter } = Constants;

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return Array.from(
    new Set(value.map((item) => String(item).trim()).filter((item) => item.length > 0)),
  );
}

function toMCPToolKey(serverName, toolName) {
  if (toolName.includes(mcp_delimiter)) {
    return toolName.endsWith(`${mcp_delimiter}${serverName}`) ? toolName : null;
  }

  return `${toolName}${mcp_delimiter}${serverName}`;
}

function getRequestedMCPToolKeys(serverName, mcpToolFilter) {
  if (!mcpToolFilter || typeof mcpToolFilter !== 'object') {
    return undefined;
  }

  const selectedTools = normalizeStringArray(mcpToolFilter[serverName]);
  if (selectedTools == null) {
    return undefined;
  }

  return selectedTools
    .map((toolName) => toMCPToolKey(serverName, toolName))
    .filter((toolKey) => toolKey != null);
}

function filterMCPServerToolKeys({ serverName, serverTools, mcpToolFilter }) {
  const requestedKeys = getRequestedMCPToolKeys(serverName, mcpToolFilter);
  if (requestedKeys == null) {
    return Object.keys(serverTools || {});
  }

  const availableToolKeys = new Set(Object.keys(serverTools || {}));
  return requestedKeys.filter((toolKey) => availableToolKeys.has(toolKey));
}

module.exports = {
  filterMCPServerToolKeys,
  getRequestedMCPToolKeys,
};
