const express = require('express');
const { requireAdmin } = require('@librechat/api');
const { AdminPermissions } = require('librechat-data-provider');
const { requireJwtAuth } = require('~/server/middleware');
const {
  requireAnyAdminAccess,
  requireAdminPermission,
} = require('~/server/middleware/adminAccess');
const {
  getAdminRolesController,
  getAdminUsageController,
  getAdminUserController,
  getAdminUsersController,
  getAdminSettingsController,
  getAdminPermissionsController,
  getAdminObservabilityController,
  updateAdminUserController,
  updateAdminSettingsController,
} = require('~/server/controllers/AdminController');
const authRoutes = require('./auth');

const router = express.Router();

const asyncHandler = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.use(authRoutes);
router.use(requireJwtAuth);

router.get('/permissions', requireAnyAdminAccess, asyncHandler(getAdminPermissionsController));
router.get(
  '/users',
  requireAdminPermission(AdminPermissions.USERS_READ),
  asyncHandler(getAdminUsersController),
);
router.get(
  '/users/:userId',
  requireAdminPermission(AdminPermissions.USERS_READ),
  asyncHandler(getAdminUserController),
);
router.patch('/users/:userId', requireAdmin, asyncHandler(updateAdminUserController));
router.get(
  '/usage',
  requireAdminPermission(AdminPermissions.USAGE_READ),
  asyncHandler(getAdminUsageController),
);
router.get(
  '/settings',
  requireAdminPermission(AdminPermissions.SETTINGS_READ),
  asyncHandler(getAdminSettingsController),
);
router.put(
  '/settings',
  requireAdminPermission(AdminPermissions.SETTINGS_WRITE),
  asyncHandler(updateAdminSettingsController),
);
router.get(
  '/observability',
  requireAdminPermission(AdminPermissions.OBSERVABILITY_READ),
  asyncHandler(getAdminObservabilityController),
);
router.get('/rbac/roles', requireAdmin, asyncHandler(getAdminRolesController));

module.exports = router;
