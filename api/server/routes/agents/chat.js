const express = require('express');
const {
  generateCheckAccess,
  skipAgentCheck,
  GenerationJobManager,
  filterMalformedContentParts,
} = require('@librechat/api');
const {
  PermissionTypes,
  Permissions,
  PermissionBits,
  modelSteeringRequestSchema,
} = require('librechat-data-provider');
const { logger } = require('@librechat/data-schemas');
const {
  moderateText,
  // validateModel,
  validateConvoAccess,
  buildEndpointOption,
  canAccessAgentFromBody,
} = require('~/server/middleware');
const { initializeClient } = require('~/server/services/Endpoints/agents');
const AgentController = require('~/server/controllers/agents/request');
const addTitle = require('~/server/services/Endpoints/agents/title');
const { getRoleByName } = require('~/models/Role');
const { saveMessage } = require('~/models');
const { getEffectiveAppSettings } = require('~/server/services/Admin/appSettings');

const router = express.Router();

const checkAgentAccess = generateCheckAccess({
  permissionType: PermissionTypes.AGENTS,
  permissions: [Permissions.USE],
  skipCheck: skipAgentCheck,
  getRoleByName,
});
const checkAgentResourceAccess = canAccessAgentFromBody({
  requiredPermission: PermissionBits.VIEW,
});

router.use(moderateText);
router.use(checkAgentAccess);
router.use(checkAgentResourceAccess);
router.use(validateConvoAccess);
router.use(buildEndpointOption);

const controller = async (req, res, next) => {
  await AgentController(req, res, next, initializeClient, addTitle);
};

async function resolveSteeringJob({ streamId, conversationId, userId }) {
  const candidateIds = [
    streamId,
    conversationId && conversationId !== 'new' ? conversationId : null,
  ].filter(Boolean);

  for (const candidateId of candidateIds) {
    const job = await GenerationJobManager.getJob(candidateId);
    if (job) {
      return { job, streamId: candidateId };
    }
  }

  const activeJobIds = await GenerationJobManager.getActiveJobIdsForUser(userId);
  for (const activeJobId of activeJobIds) {
    const job = await GenerationJobManager.getJob(activeJobId);
    if (job?.metadata?.conversationId === conversationId) {
      return { job, streamId: activeJobId };
    }
  }

  return { job: null, streamId: candidateIds[0] ?? null };
}

const steeringController = async (req, res, next) => {
  const parsed = modelSteeringRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Invalid steering request', details: parsed.error.flatten() });
  }

  const userId = req.user?.id;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  const appSettings = req.appSettings ?? (await getEffectiveAppSettings());
  req.appSettings = appSettings;

  if (appSettings.modelSteeringEnabled !== true) {
    return res.status(403).json({ error: 'Model steering is disabled by the workspace.' });
  }

  if (req.user.modelSteeringPrefs?.enabled === false) {
    return res.status(403).json({ error: 'Model steering is disabled for this account.' });
  }

  const { text, conversationId, streamId } = parsed.data;
  const { job, streamId: jobStreamId } = await resolveSteeringJob({
    streamId,
    conversationId,
    userId,
  });

  if (!job || !jobStreamId) {
    return res.status(404).json({ error: 'Active generation not found.' });
  }

  if (job.metadata?.userId && job.metadata.userId !== userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (job.status !== 'running') {
    return res.status(409).json({ error: 'Generation is not active.' });
  }

  const abortResult = await GenerationJobManager.abortJob(jobStreamId);
  if (!abortResult.success || !abortResult.jobData) {
    return res.status(409).json({ error: 'Unable to stop active generation.' });
  }

  const { jobData, content } = abortResult;
  if (!jobData.userMessage?.messageId || !jobData.responseMessageId) {
    return res.status(409).json({ error: 'Generation cannot be steered before it starts.' });
  }

  const filteredContent = filterMalformedContentParts(content || []);
  const partialMessage = {
    messageId: jobData.responseMessageId,
    parentMessageId: jobData.userMessage.messageId,
    conversationId: jobData.conversationId,
    content: filteredContent,
    text: abortResult.text || '',
    sender: jobData.sender || 'AI',
    endpoint: jobData.endpoint,
    model: jobData.model,
    unfinished: true,
    error: false,
    isCreatedByUser: false,
    user: userId,
  };

  if (req.body?.agent_id) {
    partialMessage.agent_id = req.body.agent_id;
  }

  try {
    await saveMessage(req, partialMessage, {
      context: 'api/server/routes/agents/chat.js - model steering partial response',
    });
  } catch (error) {
    logger.error('[ModelSteering] Failed to save partial response before steering:', error);
    return res.status(500).json({ error: 'Failed to save partial response before steering.' });
  }

  req.body = {
    ...req.body,
    text: text.trim(),
    conversationId: jobData.conversationId,
    parentMessageId: jobData.responseMessageId,
    isSteering: true,
  };

  return controller(req, res, next);
};

/**
 * @route POST / (regular endpoint)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/', controller);

router.post('/steer', steeringController);

/**
 * @route POST /:endpoint (ephemeral agents)
 * @desc Chat with an assistant
 * @access Public
 * @param {express.Request} req - The request object, containing the request data.
 * @param {express.Response} res - The response object, used to send back a response.
 * @returns {void}
 */
router.post('/:endpoint', controller);

module.exports = router;
