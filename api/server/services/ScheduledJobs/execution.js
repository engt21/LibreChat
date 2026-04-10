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
 * Validates that all MCP servers referenced by the schedule have valid OAuth tokens.
 * Scheduled runs cannot prompt the user for consent, so missing/empty auth must fail
 * explicitly instead of producing a response with an authorization_url prompt.
 *
 * @param {object} schedule - The schedule being executed
 * @param {object|null} userMCPAuthMap - The MCP auth map returned by initializeClient
 */
function validateMCPOAuthConsent(schedule, userMCPAuthMap) {
  const mcpServers = schedule.target?.ephemeralAgent?.mcp;
  if (!Array.isArray(mcpServers) || mcpServers.length === 0) {
    return;
  }

  const serversWithMissingAuth = [];
  for (const serverName of mcpServers) {
    if (!serverName) {
      continue;
    }

    const authKey = `${Constants.mcp_prefix}${serverName}`;
    const authEntry = userMCPAuthMap?.[authKey];

    // Auth entry is missing or has no stored token fields → consent incomplete
    if (!authEntry || Object.keys(authEntry).length === 0) {
      serversWithMissingAuth.push(serverName);
    }
  }

  if (serversWithMissingAuth.length > 0) {
    const serverList = serversWithMissingAuth.join(', ');
    throw new Error(
      `OAuth consent is required for MCP server(s): ${serverList}. ` +
        `Complete the OAuth authorization flow interactively before scheduling runs ` +
        `that depend on these tools.`,
    );
  }
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
    validateMCPOAuthConsent(schedule, initialized.userMCPAuthMap);

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

    return {
      success: true,
      conversationId: response.conversationId || conversationId,
      responseMessageId: response.messageId,
      requestMessageId: requestMessage?.messageId,
      response,
      conversation,
      preview: extractResponsePreview(response),
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
};
