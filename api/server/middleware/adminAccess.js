const { logger } = require('@librechat/data-schemas');
const {
  hasAnyAdminAccess,
  hasAdminPermission,
  getAdminAccessState,
} = require('~/server/services/Admin/permissions');

function sendAuthError(res, status, message) {
  return res.status(status).json({
    error: status === 401 ? 'Unauthorized' : 'Forbidden',
    message,
  });
}

async function loadAdminAccess(req) {
  if (req.adminAccess) {
    return req.adminAccess;
  }

  const access = await getAdminAccessState(req.user);
  req.adminAccess = access;
  return access;
}

async function requireAnyAdminAccess(req, res, next) {
  try {
    if (!req.user) {
      return sendAuthError(res, 401, 'Authentication required');
    }

    const allowed = await hasAnyAdminAccess(req.user);
    if (!allowed) {
      return sendAuthError(res, 403, 'Admin access required');
    }

    await loadAdminAccess(req);
    return next();
  } catch (error) {
    logger.error('[requireAnyAdminAccess] Failed to evaluate admin access', error);
    return sendAuthError(res, 500, 'Failed to evaluate admin access');
  }
}

function requireAdminPermission(requiredPermissions, options = {}) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return sendAuthError(res, 401, 'Authentication required');
      }

      const allowed = await hasAdminPermission(req.user, requiredPermissions, options);
      if (!allowed) {
        return sendAuthError(res, 403, 'Insufficient admin permissions');
      }

      await loadAdminAccess(req);
      return next();
    } catch (error) {
      logger.error('[requireAdminPermission] Failed to evaluate admin permissions', error);
      return sendAuthError(res, 500, 'Failed to evaluate admin permissions');
    }
  };
}

module.exports = {
  requireAnyAdminAccess,
  requireAdminPermission,
};
