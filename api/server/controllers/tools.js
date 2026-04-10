const { nanoid } = require('nanoid');
const { EnvVar } = require('@librechat/agents');
const { logger } = require('@librechat/data-schemas');
const { checkAccess, loadWebSearchAuth } = require('@librechat/api');
const {
  Tools,
  AuthType,
  Permissions,
  ToolCallTypes,
  PermissionTypes,
} = require('librechat-data-provider');
const { processFileURL, uploadImageBuffer } = require('~/server/services/Files/process');
const { processCodeOutput } = require('~/server/services/Files/Code/process');
const { createToolCall, getToolCallsByConvo } = require('~/models/ToolCall');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const { loadTools } = require('~/app/clients/tools/util');
const { getRoleByName } = require('~/models/Role');
const { getMessage } = require('~/models/Message');

const fieldsMap = {
  [Tools.execute_code]: [EnvVar.CODE_API_KEY],
};

const toolAccessPermType = {
  [Tools.execute_code]: PermissionTypes.RUN_CODE,
};

/**
 * Verifies web search authentication, ensuring each category has at least
 * one fully authenticated service.
 *
 * @param {ServerRequest} req - The request object
 * @param {ServerResponse} res - The response object
 * @returns {Promise<void>} A promise that resolves when the function has completed
 */
const verifyWebSearchAuth = async (req, res) => {
  try {
    const appConfig = req.config;
    const userId = req.user.id;
    /** @type {TCustomConfig['webSearch']} */
    const webSearchConfig = appConfig?.webSearch || {};
    const result = await loadWebSearchAuth({
      userId,
      loadAuthValues,
      webSearchConfig,
      throwError: false,
    });

    return res.status(200).json({
      authenticated: result.authenticated,
      authTypes: result.authTypes,
    });
  } catch (error) {
    console.error('Error in verifyWebSearchAuth:', error);
    return res.status(500).json({ message: error.message });
  }
};

/**
 * @param {ServerRequest} req - The request object, containing information about the HTTP request.
 * @param {ServerResponse} res - The response object, used to send back the desired HTTP response.
 * @returns {Promise<void>} A promise that resolves when the function has completed.
 */
const verifyToolAuth = async (req, res) => {
  try {
    const { toolId } = req.params;
    if (toolId === Tools.web_search) {
      return await verifyWebSearchAuth(req, res);
    }
    const authFields = fieldsMap[toolId];
    if (!authFields) {
      res.status(404).json({ message: 'Tool not found' });
      return;
    }
    let result;
    try {
      result = await loadAuthValues({
        userId: req.user.id,
        authFields,
        throwError: false,
      });
    } catch (error) {
      logger.error('Error loading auth values', error);
      res.status(200).json({ authenticated: false, message: AuthType.USER_PROVIDED });
      return;
    }
    let isUserProvided = false;
    for (const field of authFields) {
      if (!result[field]) {
        res.status(200).json({ authenticated: false, message: AuthType.USER_PROVIDED });
        return;
      }
      if (!isUserProvided && process.env[field] !== result[field]) {
        isUserProvided = true;
      }
    }
    res.status(200).json({
      authenticated: true,
      message: isUserProvided ? AuthType.USER_PROVIDED : AuthType.SYSTEM_DEFINED,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * @param {ServerRequest} req - The request object, containing information about the HTTP request.
 * @param {ServerResponse} res - The response object, used to send back the desired HTTP response.
 * @param {NextFunction} next - The next middleware function to call.
 * @returns {Promise<void>} A promise that resolves when the function has completed.
 */
const callTool = async (req, res) => {
  try {
    const appConfig = req.config;
    const { toolId = '' } = req.params;
    if (!fieldsMap[toolId]) {
      logger.warn(`[${toolId}/call] User ${req.user.id} attempted call to invalid tool`);
      res.status(404).json({ message: 'Tool not found' });
      return;
    }

    const { partIndex, blockIndex, messageId, conversationId, ...args } = req.body;
    if (!messageId) {
      logger.warn(`[${toolId}/call] User ${req.user.id} attempted call without message ID`);
      res.status(400).json({ message: 'Message ID required' });
      return;
    }

    const message = await getMessage({ user: req.user.id, messageId });
    if (!message) {
      logger.debug(`[${toolId}/call] User ${req.user.id} attempted call with invalid message ID`);
      res.status(404).json({ message: 'Message not found' });
      return;
    }
    logger.debug(`[${toolId}/call] User: ${req.user.id}`);
    let hasAccess = true;
    if (toolAccessPermType[toolId]) {
      hasAccess = await checkAccess({
        user: req.user,
        permissionType: toolAccessPermType[toolId],
        permissions: [Permissions.USE],
        getRoleByName,
      });
    }
    if (!hasAccess) {
      logger.warn(
        `[${toolAccessPermType[toolId]}] Forbidden: Insufficient permissions for User ${req.user.id}: ${Permissions.USE}`,
      );
      return res.status(403).json({ message: 'Forbidden: Insufficient permissions' });
    }
    let loadResult;
    try {
      loadResult = await loadTools({
        user: req.user.id,
        tools: [toolId],
        functions: true,
        options: {
          req,
          returnMetadata: true,
          processFileURL,
          uploadImageBuffer,
        },
        webSearch: appConfig.webSearch,
        fileStrategy: appConfig.fileStrategy,
        imageOutputType: appConfig.imageOutputType,
      });
    } catch (loadError) {
      logger.error(`[${toolId}/call] Error loading tool for user ${req.user.id}:`, loadError);
      return res.status(500).json({ message: `Failed to load tool: ${loadError.message}` });
    }

    const { loadedTools } = loadResult;
    if (!loadedTools || loadedTools.length === 0) {
      logger.warn(`[${toolId}/call] No tools loaded for user ${req.user.id}`);
      return res.status(500).json({ message: 'Tool could not be initialized' });
    }

    const tool = loadedTools[0];
    const toolCallId = `${req.user.id}_${nanoid()}`;

    let result;
    try {
      result = await tool.invoke({
        args,
        name: toolId,
        id: toolCallId,
        type: ToolCallTypes.TOOL_CALL,
      });
    } catch (execError) {
      logger.error(`[${toolId}/call] Execution error for user ${req.user.id}:`, execError);
      const status =
        typeof execError?.status === 'number' && execError.status >= 400 && execError.status < 600
          ? execError.status
          : 500;
      return res.status(status).json({ message: execError.message || 'Tool execution failed' });
    }

    const { content, artifact } = result;
    const toolCallData = {
      toolId,
      messageId,
      partIndex,
      blockIndex,
      conversationId,
      result: content,
      user: req.user.id,
    };

    if (!artifact || !artifact.files || toolId !== Tools.execute_code) {
      createToolCall(toolCallData).catch((error) => {
        logger.error(`Error creating tool call: ${error.message}`);
      });
      return res.status(200).json({
        result: content,
      });
    }

    const artifactPromises = [];
    for (const file of artifact.files) {
      const { id, name } = file;
      artifactPromises.push(
        (async () => {
          const fileMetadata = await processCodeOutput({
            req,
            id,
            name,
            apiKey: tool.apiKey,
            messageId,
            toolCallId,
            conversationId,
            session_id: artifact.session_id,
          });

          if (!fileMetadata) {
            return null;
          }

          return fileMetadata;
        })().catch((error) => {
          logger.error('Error processing code output:', error);
          return null;
        }),
      );
    }
    const attachments = await Promise.all(artifactPromises);
    toolCallData.attachments = attachments;
    createToolCall(toolCallData).catch((error) => {
      logger.error(`Error creating tool call: ${error.message}`);
    });
    res.status(200).json({
      result: content,
      attachments,
    });
  } catch (error) {
    logger.error('[callTool] Unexpected error:', error);
    const status =
      typeof error?.status === 'number' && error.status >= 400 && error.status < 600
        ? error.status
        : 500;
    res.status(status).json({ message: error.message || 'Error calling tool' });
  }
};

const getToolCalls = async (req, res) => {
  try {
    const { conversationId } = req.query;
    const toolCalls = await getToolCallsByConvo(conversationId, req.user.id);
    res.status(200).json(toolCalls);
  } catch (error) {
    logger.error('Error getting tool calls', error);
    res.status(500).json({ message: 'Error getting tool calls' });
  }
};

module.exports = {
  callTool,
  getToolCalls,
  verifyToolAuth,
};
