const mongoose = require('mongoose');
const { logger } = require('@librechat/data-schemas');
const { mergeAppTools, getAppConfig } = require('./Config');
const { getEffectiveAppSettings } = require('./Admin/appSettings');
const { createMCPServersRegistry, createMCPManager } = require('~/config');

/**
 * Initialize MCP servers
 */
async function initializeMCPs() {
  const appConfig = await getAppConfig();
  const mcpServers = appConfig.mcpConfig;

  // Merge domains from yaml config and admin settings (MongoDB).
  // In denylist mode the first argument to the registry is the *deny* list, so yaml
  // allowedDomains (semantically "allow these hosts") must NOT appear there — they
  // only serve as SSRF exemptions.  In allowlist mode both sources are merged into
  // the allow list as before.
  const yamlDomains = appConfig?.mcpSettings?.allowedDomains;
  let mergedDomains = yamlDomains;
  let domainFilterMode = 'denylist';
  try {
    const adminSettings = await getEffectiveAppSettings();
    const adminDomains = adminSettings?.mcpAllowedDomains;
    domainFilterMode = adminSettings?.mcpDomainFilterMode || 'denylist';
    const hasYaml = Array.isArray(yamlDomains) && yamlDomains.length > 0;
    const hasAdmin = Array.isArray(adminDomains) && adminDomains.length > 0;

    if (domainFilterMode === 'denylist') {
      // In denylist mode the registry argument is a *deny* list.
      // yaml allowedDomains are operator-approved hosts and must NOT be denied;
      // only admin-configured entries populate the denylist.
      mergedDomains = hasAdmin ? adminDomains : [];
    } else if (hasYaml || hasAdmin) {
      // In allowlist mode, merge yaml + admin entries into the allow list.
      mergedDomains = [
        ...new Set([...(hasYaml ? yamlDomains : []), ...(hasAdmin ? adminDomains : [])]),
      ];
    }
  } catch {
    logger.debug('[MCP] Could not load admin settings for domain merge during init');
  }

  // yaml allowedDomains always serve as SSRF exemptions regardless of filter mode,
  // allowing operators to approve private-network MCP servers via yaml config.
  const ssrfExemptions = Array.isArray(yamlDomains) && yamlDomains.length > 0 ? yamlDomains : [];

  try {
    createMCPServersRegistry(mongoose, mergedDomains, domainFilterMode, ssrfExemptions);
  } catch (error) {
    logger.error('[MCP] Failed to initialize MCPServersRegistry:', error);
    throw error;
  }

  try {
    const mcpManager = await createMCPManager(mcpServers || {});

    if (mcpServers && Object.keys(mcpServers).length > 0) {
      const mcpTools = (await mcpManager.getAppToolFunctions()) || {};
      await mergeAppTools(mcpTools);
      const serverCount = Object.keys(mcpServers).length;
      const toolCount = Object.keys(mcpTools).length;
      logger.info(
        `[MCP] Initialized with ${serverCount} configured ${serverCount === 1 ? 'server' : 'servers'} and ${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}.`,
      );
    } else {
      logger.debug('[MCP] No servers configured. MCPManager ready for UI-based servers.');
    }
  } catch (error) {
    logger.error('[MCP] Failed to initialize MCPManager:', error);
    throw error;
  }
}

module.exports = initializeMCPs;
