const {
  SystemRoles,
  adminSettingsUpdateSchema,
  adminUserUpdateSchema,
} = require('librechat-data-provider');
const { searchUsers, updateUser } = require('~/models');
const { User, Balance, AdminRole, Message, Transaction, Conversation } = require('~/db/models');
const { getAdminAccessState, getAdminRolesByIds } = require('~/server/services/Admin/permissions');
const {
  getEffectiveAppSettings,
  updateAppSettings,
} = require('~/server/services/Admin/appSettings');
const { loadModels } = require('~/server/controllers/ModelController');
const {
  normalizeModelPermissions,
  validateModelPermissions,
} = require('~/server/services/ModelAccess');
const { deleteUserAccount } = require('~/server/controllers/UserController');

const USER_FIELDS =
  'name username email provider role adminRoleIds emailVerified twoFactorEnabled termsAccepted personalization modelPermissions favorites createdAt updatedAt';

const LOCAL_OBSERVABILITY_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function getRequestOrigin(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const protocol =
    typeof forwardedProto === 'string' && forwardedProto.length > 0
      ? forwardedProto.split(',')[0].trim()
      : req.protocol;
  const host =
    typeof forwardedHost === 'string' && forwardedHost.length > 0
      ? forwardedHost.split(',')[0].trim()
      : req.get('host');

  if (!host) {
    return null;
  }

  try {
    return new URL(`${protocol}://${host}`);
  } catch {
    return null;
  }
}

function resolveObservabilityUrl(rawUrl, reqOrigin) {
  if (!rawUrl || !reqOrigin) {
    return rawUrl || '';
  }

  try {
    const url = new URL(rawUrl);
    if (!LOCAL_OBSERVABILITY_HOSTS.has(url.hostname)) {
      return rawUrl;
    }

    url.protocol = reqOrigin.protocol;
    url.hostname = reqOrigin.hostname;
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function resolveObservabilityLinks(observability = {}, req) {
  const reqOrigin = getRequestOrigin(req);

  return {
    langfuseUrl: resolveObservabilityUrl(observability.langfuseUrl, reqOrigin),
    grafanaUrl: resolveObservabilityUrl(observability.grafanaUrl, reqOrigin),
    metricsUrl: resolveObservabilityUrl(observability.metricsUrl, reqOrigin),
    prometheusUrl: resolveObservabilityUrl(observability.prometheusUrl, reqOrigin),
  };
}

function parseLimit(rawLimit, fallback = 50) {
  const parsed = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(parsed, 100);
}

function buildAdminRoleMap(adminRoles) {
  return new Map(adminRoles.map((role) => [role.adminRoleId, role]));
}

function getSerializedAdminRoles(adminRoleIds = [], adminRoleMap) {
  return adminRoleIds.map((roleId) => adminRoleMap.get(roleId)).filter(Boolean);
}

function serializeUserSummary(user, adminRoleMap) {
  const id = user._id.toString();
  return {
    id,
    name: user.name || '',
    username: user.username || '',
    email: user.email,
    provider: user.provider,
    role: user.role || SystemRoles.USER,
    adminRoleIds: user.adminRoleIds || [],
    adminRoles: getSerializedAdminRoles(user.adminRoleIds || [], adminRoleMap),
    emailVerified: Boolean(user.emailVerified),
    twoFactorEnabled: Boolean(user.twoFactorEnabled),
    termsAccepted: Boolean(user.termsAccepted),
    memoriesEnabled: user.personalization?.memories,
    favoritesCount: Array.isArray(user.favorites) ? user.favorites.length : 0,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function serializeUserDetails(user, adminRoleMap) {
  return {
    ...serializeUserSummary(user, adminRoleMap),
    modelPermissions: normalizeModelPermissions(user.modelPermissions),
  };
}

async function loadUsersForAdminList({ q, limit }) {
  if (q && q.trim()) {
    return await searchUsers({
      searchPattern: q.trim(),
      limit,
      fieldsToSelect: USER_FIELDS,
    });
  }

  return await User.find({}, USER_FIELDS).sort({ createdAt: -1 }).limit(limit).lean();
}

async function loadAdminRoleMapForUsers(users) {
  const adminRoleIds = Array.from(
    new Set(users.flatMap((user) => user.adminRoleIds || []).filter(Boolean)),
  );
  const adminRoles = await getAdminRolesByIds(adminRoleIds);
  return buildAdminRoleMap(adminRoles);
}

async function buildUsageSummaries(users, adminRoleMap) {
  if (!users.length) {
    return [];
  }

  const objectIds = users.map((user) => user._id);
  const stringIds = users.map((user) => user._id.toString());

  const [balances, conversationCounts, messageCounts, transactionStats] = await Promise.all([
    Balance.find({ user: { $in: objectIds } }, 'user tokenCredits').lean(),
    Conversation.aggregate([
      { $match: { user: { $in: stringIds } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
    Message.aggregate([
      { $match: { user: { $in: stringIds } } },
      { $group: { _id: '$user', count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { user: { $in: objectIds } } },
      {
        $group: {
          _id: '$user',
          count: { $sum: 1 },
          lastTransactionAt: { $max: '$createdAt' },
        },
      },
    ]),
  ]);

  const balanceMap = new Map(balances.map((balance) => [balance.user.toString(), balance]));
  const conversationCountMap = new Map(
    conversationCounts.map((entry) => [String(entry._id), entry.count]),
  );
  const messageCountMap = new Map(messageCounts.map((entry) => [String(entry._id), entry.count]));
  const transactionMap = new Map(transactionStats.map((entry) => [String(entry._id), entry]));

  return users.map((user) => {
    const userId = user._id.toString();
    const transaction = transactionMap.get(userId);

    return {
      userId,
      name: user.name || '',
      email: user.email,
      role: user.role || SystemRoles.USER,
      adminRoles: getSerializedAdminRoles(user.adminRoleIds || [], adminRoleMap),
      tokenCredits: balanceMap.get(userId)?.tokenCredits || 0,
      conversationCount: conversationCountMap.get(userId) || 0,
      messageCount: messageCountMap.get(userId) || 0,
      transactionCount: transaction?.count || 0,
      lastTransactionAt: transaction?.lastTransactionAt,
    };
  });
}

const getAdminPermissionsController = async (req, res) => {
  const access = req.adminAccess ?? (await getAdminAccessState(req.user));
  return res.status(200).json(access);
};

const getAdminUsersController = async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = parseLimit(req.query.limit);
  const users = await loadUsersForAdminList({ q, limit });
  const adminRoleMap = await loadAdminRoleMapForUsers(users);

  return res.status(200).json({
    users: users.map((user) => serializeUserSummary(user, adminRoleMap)),
  });
};

const getAdminUserController = async (req, res) => {
  const user = await User.findById(req.params.userId, USER_FIELDS).lean();
  if (!user) {
    return res.status(404).json({ message: 'User not found' });
  }

  const adminRoleMap = await loadAdminRoleMapForUsers([user]);
  const [summary] = [serializeUserDetails(user, adminRoleMap)];
  const [usage] = await buildUsageSummaries([user], adminRoleMap);

  return res.status(200).json({ user: summary, usage });
};

const updateAdminUserController = async (req, res) => {
  const parsedUpdates = adminUserUpdateSchema.safeParse(req.body || {});
  if (!parsedUpdates.success) {
    return res.status(400).json({ message: 'Invalid admin user update payload' });
  }

  const updates = parsedUpdates.data;
  const targetUser = await User.findById(req.params.userId, USER_FIELDS).lean();
  if (!targetUser) {
    return res.status(404).json({ message: 'User not found' });
  }

  const nextUpdates = {};
  if (updates.role != null) {
    if (updates.role !== SystemRoles.USER && updates.role !== SystemRoles.ADMIN) {
      return res.status(400).json({ message: 'Invalid role value' });
    }
    nextUpdates.role = updates.role;
  }

  if (updates.adminRoleIds != null) {
    const requestedRoleIds = Array.from(new Set(updates.adminRoleIds.filter(Boolean)));
    const adminRoles = await getAdminRolesByIds(requestedRoleIds);
    if (adminRoles.length !== requestedRoleIds.length) {
      return res.status(400).json({ message: 'One or more admin roles are invalid' });
    }
    nextUpdates.adminRoleIds = requestedRoleIds;
  }

  if (updates.modelPermissions != null) {
    const validation = validateModelPermissions(updates.modelPermissions, await loadModels(req));
    if (!validation.isValid) {
      return res.status(400).json({ message: validation.message });
    }

    nextUpdates.modelPermissions = validation.modelPermissions;
  }

  await updateUser(targetUser._id.toString(), nextUpdates);
  const updatedUser = await User.findById(req.params.userId, USER_FIELDS).lean();
  const adminRoleMap = await loadAdminRoleMapForUsers([updatedUser]);
  const [usage] = await buildUsageSummaries([updatedUser], adminRoleMap);

  return res.status(200).json({
    user: serializeUserDetails(updatedUser, adminRoleMap),
    usage,
  });
};

const deleteAdminUserController = async (req, res) => {
  const targetUser = await User.findById(req.params.userId, USER_FIELDS).lean();
  if (!targetUser) {
    return res.status(404).json({ message: 'User not found' });
  }

  const targetUserId = targetUser._id.toString();
  if (req.user.id === targetUserId) {
    return res.status(400).json({ message: 'Use account settings to delete your own account' });
  }

  const requesterIsSuperAdmin = req.user.role === SystemRoles.ADMIN;
  if (!requesterIsSuperAdmin && targetUser.role === SystemRoles.ADMIN) {
    return res.status(403).json({ message: 'Only superadmins can delete superadmin accounts' });
  }

  await deleteUserAccount({
    req,
    user: {
      id: targetUserId,
      _id: targetUser._id,
      email: targetUser.email,
    },
  });

  return res.status(200).json({ message: 'User deleted' });
};

const getAdminUsageController = async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  const limit = parseLimit(req.query.limit);
  const users = await loadUsersForAdminList({ q, limit });
  const adminRoleMap = await loadAdminRoleMapForUsers(users);
  const usage = await buildUsageSummaries(users, adminRoleMap);

  return res.status(200).json({ users: usage });
};

const getAdminSettingsController = async (req, res) => {
  const settings = await getEffectiveAppSettings();
  return res.status(200).json({
    ...settings,
    observability: resolveObservabilityLinks(settings.observability, req),
  });
};

const updateAdminSettingsController = async (req, res) => {
  const parsedUpdates = adminSettingsUpdateSchema.safeParse(req.body || {});
  if (!parsedUpdates.success) {
    return res.status(400).json({ message: 'Invalid admin settings payload' });
  }

  const updates = parsedUpdates.data;
  const settings = await updateAppSettings(updates);
  return res.status(200).json({
    ...settings,
    observability: resolveObservabilityLinks(settings.observability, req),
  });
};

const getAdminObservabilityController = async (req, res) => {
  const settings = await getEffectiveAppSettings();
  return res.status(200).json({
    links: resolveObservabilityLinks(settings.observability, req),
    providerLogPath: process.env.PROVIDER_LOG_DIR || '/app/logs',
  });
};

const getAdminRolesController = async (_req, res) => {
  const roles = await AdminRole.find({}).sort({ name: 1 }).lean();
  return res.status(200).json(roles);
};

const refreshAdminModelsController = async (req, res) => {
  // Lazy-require so the existing AdminController spec suites don't have to mock
  // the entire MODEL_QUERIES cache wiring just to test unrelated controllers.
  const {
    refreshAllModels,
    refreshProviderModels,
  } = require('~/server/services/Models/refreshModels');

  const provider = typeof req.body?.provider === 'string' ? req.body.provider.trim() : '';

  try {
    const result = provider
      ? await refreshProviderModels(req, provider)
      : await refreshAllModels(req);
    return res.status(200).json(result);
  } catch (error) {
    if (error?.statusCode === 400) {
      return res.status(400).json({ message: error.message });
    }
    throw error;
  }
};

module.exports = {
  getAdminRolesController,
  getAdminUsageController,
  getAdminUserController,
  getAdminUsersController,
  getAdminSettingsController,
  getAdminPermissionsController,
  getAdminObservabilityController,
  updateAdminUserController,
  updateAdminSettingsController,
  deleteAdminUserController,
  refreshAdminModelsController,
};
