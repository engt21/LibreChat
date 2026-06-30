const { logger } = require('@librechat/data-schemas');
const {
  Constants,
  Permissions,
  ResourceType,
  SystemRoles,
  PermissionTypes,
  isAgentsEndpoint,
  isEphemeralAgentId,
} = require('librechat-data-provider');
const { checkPermission } = require('~/server/services/PermissionService');
const { canAccessResource } = require('./canAccessResource');
const { getRoleByName } = require('~/models/Role');
const { getAgent } = require('~/models/Agent');

/**
 * Resolves custom agent ID (e.g., "agent_abc123") to a MongoDB document.
 * @param {string} agentCustomId - Custom agent ID from request body
 * @returns {Promise<Object|null>} Agent document with _id field, or null if ephemeral/not found
 */
const resolveAgentIdFromBody = async (agentCustomId) => {
  if (isEphemeralAgentId(agentCustomId)) {
    return null;
  }
  return getAgent({ id: agentCustomId });
};

/**
 * Creates a `canAccessResource` middleware for the given agent ID
 * and chains to the provided continuation on success.
 *
 * @param {string} agentId - The agent's custom string ID (e.g., "agent_abc123")
 * @param {number} requiredPermission - Permission bit(s) required
 * @param {import('express').Request} req
 * @param {import('express').Response} res - Written on deny; continuation called on allow
 * @param {Function} continuation - Called when the permission check passes
 * @returns {Promise<void>}
 */
const checkAgentResourceAccess = (agentId, requiredPermission, req, res, continuation) => {
  const middleware = canAccessResource({
    resourceType: ResourceType.AGENT,
    requiredPermission,
    resourceIdParam: 'agent_id',
    idResolver: () => resolveAgentIdFromBody(agentId),
  });

  const tempReq = {
    ...req,
    params: { ...req.params, agent_id: agentId },
  };

  return middleware(tempReq, res, continuation);
};

const getAddedConvosFromBody = (body) => {
  const addedConvos = Array.isArray(body?.addedConvos)
    ? body.addedConvos.filter(
        (convo) => convo && typeof convo === 'object' && !Array.isArray(convo),
      )
    : [];

  if (addedConvos.length > 0) {
    return addedConvos;
  }

  const addedConvo = body?.addedConvo;
  if (!addedConvo || typeof addedConvo !== 'object' || Array.isArray(addedConvo)) {
    return [];
  }

  return [addedConvo];
};

/**
 * Middleware factory that validates MULTI_CONVO:USE role permission and, when
 * added conversation agent IDs are non-ephemeral agents, the same resource-level permission
 * required for the primary agent (`requiredPermission`). Caches the resolved agent
 * documents on `req.resolvedAddedAgents` to avoid duplicate DB fetches in `loadAddedAgent`.
 *
 * @param {number} requiredPermission - Permission bit(s) to check on the added agent resource
 * @returns {(req: import('express').Request, res: import('express').Response, next: Function) => Promise<void>}
 */
const checkAddedConvoAccess = (requiredPermission) => async (req, res, next) => {
  const addedConvos = getAddedConvosFromBody(req.body);
  if (addedConvos.length === 0) {
    return next();
  }

  try {
    if (!req.user?.role) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions for multi-conversation',
      });
    }

    if (req.user.role !== SystemRoles.ADMIN) {
      const role = await getRoleByName(req.user.role);
      const hasMultiConvo = role?.permissions?.[PermissionTypes.MULTI_CONVO]?.[Permissions.USE];
      if (!hasMultiConvo) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Multi-conversation feature is not enabled',
        });
      }
    }

    if (req.user.role === SystemRoles.ADMIN) {
      return next();
    }

    const resolvedAddedAgents = {};
    for (const addedConvo of addedConvos) {
      const addedAgentId = addedConvo.agent_id;
      if (!addedAgentId || typeof addedAgentId !== 'string' || isEphemeralAgentId(addedAgentId)) {
        continue;
      }

      const agent = await resolveAgentIdFromBody(addedAgentId);
      if (!agent) {
        return res.status(404).json({
          error: 'Not Found',
          message: `${ResourceType.AGENT} not found`,
        });
      }

      const hasPermission = await checkPermission({
        userId: req.user.id,
        role: req.user.role,
        resourceType: ResourceType.AGENT,
        resourceId: agent._id,
        requiredPermission,
      });

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Insufficient permissions to access this ${ResourceType.AGENT}`,
        });
      }

      resolvedAddedAgents[addedAgentId] = agent;
      req.resolvedAddedAgent ??= agent;
    }

    req.resolvedAddedAgents = resolvedAddedAgents;
    return next();
  } catch (error) {
    logger.error('Failed to validate addedConvo access permissions', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to validate addedConvo access permissions',
    });
  }
};

/**
 * Middleware factory that checks agent access permissions from request body.
 * Validates both the primary agent_id and, when present, added conversation agent IDs
 * (which also requires MULTI_CONVO:USE role permission).
 *
 * @param {Object} options - Configuration options
 * @param {number} options.requiredPermission - The permission bit required (1=view, 2=edit, 4=delete, 8=share)
 * @returns {Function} Express middleware function
 *
 * @example
 * router.post('/chat',
 *   canAccessAgentFromBody({ requiredPermission: PermissionBits.VIEW }),
 *   buildEndpointOption,
 *   chatController
 * );
 */
const canAccessAgentFromBody = (options) => {
  const { requiredPermission } = options;

  if (!requiredPermission || typeof requiredPermission !== 'number') {
    throw new Error('canAccessAgentFromBody: requiredPermission is required and must be a number');
  }

  const addedConvoMiddleware = checkAddedConvoAccess(requiredPermission);

  return async (req, res, next) => {
    try {
      const { endpoint, agent_id } = req.body;
      let agentId = agent_id;

      if (!isAgentsEndpoint(endpoint)) {
        agentId = Constants.EPHEMERAL_AGENT_ID;
      }

      if (!agentId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'agent_id is required in request body',
        });
      }

      // Skip permission checks for ephemeral agents
      if (isEphemeralAgentId(agentId)) {
        return addedConvoMiddleware(req, res, next);
      }

      return checkAgentResourceAccess(agentId, requiredPermission, req, res, () => {
        return addedConvoMiddleware(req, res, next);
      });
    } catch (error) {
      logger.error('Failed to validate agent access permissions', error);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to validate agent access permissions',
      });
    }
  };
};

module.exports = {
  canAccessAgentFromBody,
};
