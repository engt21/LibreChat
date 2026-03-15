const { SystemRoles, AdminPermissions, allAdminPermissions } = require('librechat-data-provider');
const { AdminRole } = require('~/db/models');

async function getAdminRolesByIds(adminRoleIds = []) {
  if (!Array.isArray(adminRoleIds) || adminRoleIds.length === 0) {
    return [];
  }

  return await AdminRole.find({ adminRoleId: { $in: adminRoleIds } })
    .sort({ name: 1 })
    .lean();
}

async function getAdminAccessState(user) {
  if (!user) {
    return {
      isSuperAdmin: false,
      permissions: [],
      adminRoles: [],
    };
  }

  if (user.role === SystemRoles.ADMIN) {
    return {
      isSuperAdmin: true,
      permissions: [...allAdminPermissions],
      adminRoles: [],
    };
  }

  const adminRoles = await getAdminRolesByIds(user.adminRoleIds || []);
  const permissions = Array.from(
    new Set(
      adminRoles
        .flatMap((role) => role.permissions || [])
        .filter((permission) => Object.values(AdminPermissions).includes(permission)),
    ),
  );

  return {
    isSuperAdmin: false,
    permissions,
    adminRoles,
  };
}

async function getEffectiveAdminPermissions(user) {
  const { permissions } = await getAdminAccessState(user);
  return permissions;
}

async function hasAnyAdminAccess(user) {
  const access = await getAdminAccessState(user);
  return access.isSuperAdmin || access.permissions.length > 0;
}

async function hasAdminPermission(user, requiredPermissions, { requireAll = false } = {}) {
  const access = await getAdminAccessState(user);
  if (access.isSuperAdmin) {
    return true;
  }

  const required = Array.isArray(requiredPermissions)
    ? requiredPermissions.filter(Boolean)
    : [requiredPermissions].filter(Boolean);

  if (!required.length) {
    return access.permissions.length > 0;
  }

  if (requireAll) {
    return required.every((permission) => access.permissions.includes(permission));
  }

  return required.some((permission) => access.permissions.includes(permission));
}

module.exports = {
  getAdminRolesByIds,
  getAdminAccessState,
  getEffectiveAdminPermissions,
  hasAnyAdminAccess,
  hasAdminPermission,
};
