const crypto = require('node:crypto');
const EventEmitter = require('node:events');
const { logger } = require('@librechat/data-schemas');
const {
  Constants,
  EndpointURLs,
  parseTextParts,
  isAgentsEndpoint,
} = require('librechat-data-provider');
const buildEndpointOption = require('~/server/middleware/buildEndpointOption');
const { initializeClient } = require('~/server/services/Endpoints/agents');
const addTitle = require('~/server/services/Endpoints/agents/title');
const { getModelsConfig } = require('~/server/controllers/ModelController');
const { validateModelAccess } = require('~/server/services/ModelAccess');
const { getAppConfig } = require('~/server/services/Config');
const { getMCPServersRegistry } = require('~/config');
const { disposeClient } = require('~/server/cleanup');

function createResponseStub() {
  return {
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return this.headers[name.toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.headersSent = true;
      this.writableEnded = true;
      return payload;
    },
    send(payload) {
      this.body = payload;
      this.headersSent = true;
      this.writableEnded = true;
      return payload;
    },
    write(_chunk) {
      this.headersSent = true;
      return true;
    },
    end(_chunk) {
      this.writableEnded = true;
      return true;
    },
    flush() {},
    flushHeaders() {
      this.headersSent = true;
    },
  };
}

function createInternalRequest({ user, body, config }) {
  const req = new EventEmitter();
  req.user = user;
  req.body = body;
  req.config = config;
  req.baseUrl = EndpointURLs.agents;
  req.path = EndpointURLs.agents;
  req.originalUrl = EndpointURLs.agents;
  req.method = 'POST';
  req.params = {};
  req.query = {};
  req.headers = {};
  req.cookies = {};
  req.ip = '127.0.0.1';
  req.get = (name) => req.headers[name.toLowerCase()];
  req.header = req.get;

  return req;
}

function extractResponsePreview(response) {
  if (typeof response?.text === 'string' && response.text.trim() !== '') {
    return response.text.trim();
  }

  if (Array.isArray(response?.content)) {
    return parseTextParts(response.content, true).trim();
  }

  return '';
}

async function prepareExecutionContext(schedule, user) {
  const conversationId = crypto.randomUUID();
  const safeUser = {
    ...user,
    id: user?.id ?? user?._id?.toString?.() ?? user?._id,
  };

  const config = await getAppConfig({ role: safeUser?.role });
  const body = {
    ...(schedule.target ?? {}),
    endpoint: schedule.target?.endpoint,
    endpointType: schedule.target?.endpointType,
    text: schedule.prompt,
    conversationId,
    parentMessageId: Constants.NO_PARENT,
    isTemporary: false,
    files: [],
  };

  const req = createInternalRequest({ user: safeUser, body, config });
  const res = createResponseStub();

  await buildEndpointOption(req, res, () => {});
  if (!req.body.endpointOption) {
    const message =
      res.body?.text || res.body?.message || `Unable to build scheduled run for ${schedule.name}`;
    throw new Error(message);
  }

  // Revalidate model access at execution time so scheduled runs fail explicitly
  // when admin policy changes have removed the user's access to the target model
  const endpoint = schedule.target?.endpoint;
  const model = req.body.endpointOption?.modelOptions?.model || schedule.target?.model;
  if (model && !isAgentsEndpoint(endpoint)) {
    const modelsConfig = await getModelsConfig(req);
    const validation = await validateModelAccess({ req, res, endpoint, model, modelsConfig });
    if (!validation.isValid) {
      throw new Error(
        validation.text ||
          `Model "${model}" is no longer available for scheduled run "${schedule.name}"`,
      );
    }
  }

  return { req, res, conversationId };
}

/**
 * Validates MCP server auth requirements for a scheduled run.
 *
 * Classifies each referenced MCP server into one of three categories:
 *  1. **Missing / unregistered** – the server name is not found in the registry.
 *     Fails as a registration / discovery error so the operator knows the server
 *     must be created or re-registered before the schedule can run.
 *  2. **Non-OAuth** (`requiresOAuth === false`) – the server does not need an
 *     `access_token` and is callable without OAuth state.
 *  3. **OAuth-requiring** (`requiresOAuth === true`) – the existing access_token
 *     validation is applied: the auth-map entry must exist AND contain a non-empty
 *     `access_token` string.
 *
 * Scheduled runs cannot prompt the user for consent, so unmet auth prerequisites
 * must fail explicitly instead of producing a response with an authorization_url
 * prompt.
 *
 * @param {object} schedule - The schedule being executed
 * @param {object|null} userMCPAuthMap - The MCP auth map returned by initializeClient
 * @param {string} [userId] - The user ID for server config lookups
 */
async function validateMCPOAuthConsent(schedule, userMCPAuthMap, userId) {
  const mcpServers = schedule.target?.ephemeralAgent?.mcp;
  if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
    return;
  }

  const missingServers = [];
  const serversWithMissingAuth = [];
  /** @type {Map<string, object|undefined>} Server name → serverConfig for servers needing auth */
  const serverConfigsByName = new Map();

  for (const serverName of mcpServers) {
    if (!serverName) {
      continue;
    }

    // Look up the server configuration to determine its auth requirements
    let serverConfig;
    try {
      serverConfig = await getMCPServersRegistry().getServerConfig(serverName, userId);
    } catch {
      // Config lookup failure — treat as missing
    }

    if (!serverConfig) {
      // Server is not registered / not found in the registry
      missingServers.push(serverName);
      continue;
    }

    // Non-OAuth servers are callable without an access_token
    const serverRequiresOAuth = Boolean(serverConfig.requiresOAuth || serverConfig.oauthMetadata);
    if (!serverRequiresOAuth) {
      continue;
    }

    // OAuth-required server: validate that a real access_token is present
    const authKey = `${Constants.mcp_prefix}${serverName}`;
    const authEntry = userMCPAuthMap?.[authKey];

    // Auth entry must exist AND contain a non-empty access_token.
    // An entry with metadata keys but no access_token (e.g. pending consent,
    // revoked token, or partial state) is not a usable OAuth credential.
    const hasValidToken =
      authEntry &&
      typeof authEntry === 'object' &&
      Object.keys(authEntry).length > 0 &&
      typeof authEntry.access_token === 'string' &&
      authEntry.access_token.length > 0;

    if (!hasValidToken) {
      serversWithMissingAuth.push(serverName);
      serverConfigsByName.set(serverName, serverConfig);
    }
  }

  // Report missing / unregistered servers as registration errors, not OAuth errors
  if (missingServers.length > 0) {
    const serverList = missingServers.join(', ');
    throw new Error(
      `MCP server(s) not found or not registered: ${serverList}. ` +
        `Register the server(s) before scheduling runs that depend on their tools.`,
    );
  }

  // Report OAuth-required servers that lack a valid token.
  // Attach structured continuation metadata so callers (e.g. /api/schedules/:id/run)
  // can surface the authorization_url and affected servers instead of only a
  // generic OAuth-consent-required message (VAL-MCP-004).
  if (serversWithMissingAuth.length > 0) {
    const serverList = serversWithMissingAuth.join(', ');
    const error = new Error(
      `OAuth consent is required for MCP server(s): ${serverList}. ` +
        `Complete the OAuth authorization flow interactively before scheduling runs ` +
        `that depend on these tools.`,
    );

    // Build continuation metadata from available server OAuth configs
    const continuationMetadata = {
      servers: [...serversWithMissingAuth],
    };

    // Extract authorization_url from the first server that has it in oauthMetadata
    for (const name of serversWithMissingAuth) {
      const config = serverConfigsByName.get(name);
      const authEndpoint = config?.oauthMetadata?.authorization_endpoint;
      if (typeof authEndpoint === 'string' && authEndpoint.length > 0) {
        continuationMetadata.authorization_url = authEndpoint;
        break;
      }
    }

    error.continuationMetadata = continuationMetadata;
    throw error;
  }
}

/**
 * Detects whether a scheduled run response contains an auth-continuation prompt
 * (e.g. Arcade provider-consent responses with `authorization_url`) instead of
 * real tool output. Such responses look like success to the client pipeline but
 * should be treated as durable failures for scheduled runs because there is no
 * interactive user to follow the authorization link.
 *
 * @param {object} response - The response object from sendMessage
 * @returns {{ isAuthContinuation: boolean, authUrl?: string, llmInstructions?: string }} Detection result with structured continuation metadata
 */
function detectAuthContinuationResponse(response) {
  const text = extractResponsePreview(response);
  if (!text) {
    return { isAuthContinuation: false };
  }

  // Check if the response text contains an authorization_url pattern,
  // either as parseable JSON or as a recognizable substring.
  // Arcade consent responses return JSON with authorization_url and optionally llm_instructions.
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.authorization_url === 'string' && parsed.authorization_url) {
      const result = { isAuthContinuation: true, authUrl: parsed.authorization_url };
      if (typeof parsed.llm_instructions === 'string' && parsed.llm_instructions) {
        result.llmInstructions = parsed.llm_instructions;
      }
      return result;
    }
  } catch {
    // Not pure JSON — check for embedded JSON or substring patterns
  }

  // Handle multi-part or LLM-wrapped responses where the JSON is embedded
  // Match authorization_url in any JSON-like fragment within the response
  const authUrlMatch = text.match(/"authorization_url"\s*:\s*"(https?:\/\/[^"]+)"/);
  if (authUrlMatch) {
    const result = { isAuthContinuation: true, authUrl: authUrlMatch[1] };
    // Try to extract llm_instructions from the same embedded JSON fragment
    const instructionsMatch = text.match(/"llm_instructions"\s*:\s*"([^"]+)"/);
    if (instructionsMatch) {
      result.llmInstructions = instructionsMatch[1];
    }
    return result;
  }

  return { isAuthContinuation: false };
}

async function executeScheduledRun(schedule, user) {
  const { req, res, conversationId } = await prepareExecutionContext(schedule, user);
  const abortController = new AbortController();
  let client;

  try {
    const initialized = await initializeClient({
      req,
      res,
      signal: abortController.signal,
      endpointOption: req.body.endpointOption,
    });

    client = initialized.client;

    // Validate MCP OAuth consent state before executing — scheduled runs cannot
    // prompt users for consent, so unmet prerequisites must fail explicitly.
    await validateMCPOAuthConsent(schedule, initialized.userMCPAuthMap, req.user.id);

    let requestMessage;
    const response = await client.sendMessage(schedule.prompt, {
      user: req.user.id,
      conversationId,
      parentMessageId: Constants.NO_PARENT,
      abortController,
      userMCPAuthMap: initialized.userMCPAuthMap,
      onStart: (userMessage) => {
        requestMessage = userMessage;
      },
      getReqData: (data = {}) => {
        if (data.userMessage) {
          requestMessage = data.userMessage;
        }
      },
      progressOptions: { res },
    });

    const databasePromise = response.databasePromise;
    delete response.databasePromise;

    const { conversation: conversationData = {} } = await databasePromise;
    const conversation = {
      ...conversationData,
      title:
        conversationData && !conversationData.title ? null : conversationData?.title || 'New Chat',
    };

    if (requestMessage && !req.body.isTemporary) {
      await addTitle(req, {
        text: schedule.prompt,
        response: { ...response, conversationId: response.conversationId || conversationId },
        client,
      }).catch((error) => {
        logger.error('[ScheduledJobs] Failed to generate title for scheduled run', error);
      });
    }

    // Detect auth-continuation responses (e.g. Arcade provider-consent prompts).
    // These look like successful tool output but actually contain an authorization_url
    // that requires interactive user action — scheduled runs cannot follow those links,
    // so they must be recorded as durable failures instead of success previews.
    // The error carries structured `continuationMetadata` (authorization_url,
    // llm_instructions, servers) so callers can surface actionable details
    // rather than only a generic auth error string (VAL-MCP-004).
    const preview = extractResponsePreview(response);
    const authContinuation = detectAuthContinuationResponse(response);
    if (authContinuation.isAuthContinuation) {
      const mcpServers = schedule.target?.ephemeralAgent?.mcp;
      const serverHint =
        Array.isArray(mcpServers) && mcpServers.length > 0 ? mcpServers.join(', ') : 'unknown';
      const servers =
        Array.isArray(mcpServers) && mcpServers.length > 0 ? [...mcpServers] : ['unknown'];
      const error = new Error(
        `MCP tool returned an authorization prompt instead of executing. ` +
          `Provider consent is required for MCP server(s): ${serverHint}. ` +
          `Complete the OAuth authorization flow interactively before scheduling runs ` +
          `that depend on these tools.`,
      );
      // Attach structured continuation metadata for programmatic consumers
      error.continuationMetadata = {
        authorization_url: authContinuation.authUrl,
        servers,
      };
      if (authContinuation.llmInstructions) {
        error.continuationMetadata.llm_instructions = authContinuation.llmInstructions;
      }
      throw error;
    }

    return {
      success: true,
      conversationId: response.conversationId || conversationId,
      responseMessageId: response.messageId,
      requestMessageId: requestMessage?.messageId,
      response,
      conversation,
      preview,
    };
  } catch (error) {
    logger.error('[ScheduledJobs] Scheduled execution failed', error);
    throw error;
  } finally {
    if (client) {
      disposeClient(client);
    }
  }
}

module.exports = {
  executeScheduledRun,
  extractResponsePreview,
  detectAuthContinuationResponse,
};
