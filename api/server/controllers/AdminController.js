const {
  SystemRoles,
  AccessRoleIds,
  PrincipalType,
  ResourceType,
  adminSettingsUpdateSchema,
  adminUserUpdateSchema,
} = require('librechat-data-provider');
const mongoose = require('mongoose');
const { createMethods } = require('@librechat/data-schemas');
const { redactServerSecrets } = require('@librechat/api');
const { searchUsers, updateUser } = require('~/models');
const {
  User,
  Balance,
  AdminRole,
  Message,
  Transaction,
  Conversation,
  MCPServer,
  Key,
  ScheduledJob,
  AclEntry,
} = require('~/db/models');
const { getAdminAccessState, getAdminRolesByIds } = require('~/server/services/Admin/permissions');
const {
  getEffectiveAppSettings,
  updateAppSettings,
} = require('~/server/services/Admin/appSettings');
const { loadModels } = require('~/server/controllers/ModelController');
const { getAppConfig } = require('~/server/services/Config');
const {
  normalizeModelPermissions,
  validateModelPermissions,
} = require('~/server/services/ModelAccess');
const { deleteUserAccount } = require('~/server/controllers/UserController');

const USER_FIELDS =
  'name username email provider role adminRoleIds emailVerified twoFactorEnabled termsAccepted personalization modelPermissions modelRateLimits imageGenerationPrefs modelSteeringPrefs +notifications favorites createdAt updatedAt';

const LOCAL_OBSERVABILITY_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const OBSERVABILITY_LINK_KEYS = ['langfuseUrl', 'grafanaUrl', 'metricsUrl', 'prometheusUrl'];
const LOCAL_OBSERVABILITY_PORTS = new Set(['3000', '3001', '9090', '9091', '9092']);
const LOKI_EXPLORER_PATH = '/d/loki-all-logs/loki-log-explorer-e28094-all-logs';

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
  const grafanaUrl = resolveObservabilityUrl(observability.grafanaUrl, reqOrigin);
  let lokiUrl = '';

  if (grafanaUrl) {
    try {
      lokiUrl = new URL(LOKI_EXPLORER_PATH, grafanaUrl).toString();
    } catch {
      lokiUrl = '';
    }
  }

  return {
    langfuseUrl: resolveObservabilityUrl(observability.langfuseUrl, reqOrigin),
    grafanaUrl,
    lokiUrl,
    metricsUrl: resolveObservabilityUrl(observability.metricsUrl, reqOrigin),
    prometheusUrl: resolveObservabilityUrl(observability.prometheusUrl, reqOrigin),
  };
}

function formatUrlPreservingRoot(rawUrl, url) {
  const formatted = url.toString();
  if (!rawUrl.endsWith('/') && url.pathname === '/' && !url.search && !url.hash) {
    return formatted.replace(/\/$/, '');
  }
  return formatted;
}

function normalizeObservabilityUrlForStorage(rawUrl, reqOrigin) {
  if (!rawUrl || !reqOrigin) {
    return rawUrl || '';
  }

  try {
    const url = new URL(rawUrl);
    if (url.hostname !== reqOrigin.hostname || !LOCAL_OBSERVABILITY_PORTS.has(url.port)) {
      return rawUrl;
    }

    url.hostname = 'localhost';
    return formatUrlPreservingRoot(rawUrl, url);
  } catch {
    return rawUrl;
  }
}

function normalizeObservabilityUpdatesForStorage(updates, req) {
  if (!updates?.observability) {
    return updates;
  }

  const reqOrigin = getRequestOrigin(req);
  if (!reqOrigin) {
    return updates;
  }

  const observability = { ...updates.observability };
  for (const key of OBSERVABILITY_LINK_KEYS) {
    if (observability[key] !== undefined) {
      observability[key] = normalizeObservabilityUrlForStorage(observability[key], reqOrigin);
    }
  }

  return { ...updates, observability };
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

function serializeNotificationsForAdmin(notifications = {}) {
  const pushSubscriptions = Array.isArray(notifications.push?.subscriptions)
    ? notifications.push.subscriptions
    : [];

  return {
    email: {
      enabled: Boolean(notifications.email?.enabled),
      address: notifications.email?.address || '',
    },
    sms: {
      enabled: Boolean(notifications.sms?.enabled),
      provider: notifications.sms?.provider || '',
    },
    push: {
      enabled: Boolean(notifications.push?.enabled),
      subscriptionCount: pushSubscriptions.length,
    },
  };
}

function serializePreferencesForAdmin(user) {
  return {
    personalization: {
      memories: user.personalization?.memories,
    },
    imageGeneration: {
      enabledByDefault: user.imageGenerationPrefs?.enabledByDefault ?? true,
      preferredProvider: user.imageGenerationPrefs?.preferredProvider ?? null,
      models: user.imageGenerationPrefs?.models || {},
    },
    modelSteering: {
      enabled: user.modelSteeringPrefs?.enabled ?? true,
    },
    notifications: serializeNotificationsForAdmin(user.notifications),
  };
}

function normalizeModelRateLimits(modelRateLimits = {}) {
  const seen = new Set();
  const rules = [];

  for (const rule of modelRateLimits.rules || []) {
    const endpoint = typeof rule.endpoint === 'string' ? rule.endpoint.trim() : '';
    const model = typeof rule.model === 'string' ? rule.model.trim() : '';
    if (!endpoint || !model) {
      continue;
    }

    const requestsPerDay =
      Number.isInteger(rule.requestsPerDay) && rule.requestsPerDay > 0 ? rule.requestsPerDay : null;
    const tokensPerDay =
      Number.isInteger(rule.tokensPerDay) && rule.tokensPerDay > 0 ? rule.tokensPerDay : null;
    if (!requestsPerDay && !tokensPerDay) {
      continue;
    }

    const key = `${endpoint}:${model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rules.push({ endpoint, model, requestsPerDay, tokensPerDay });
  }

  return {
    enabled: modelRateLimits.enabled === true,
    rules: rules.sort((a, b) =>
      `${a.endpoint}:${a.model}`.localeCompare(`${b.endpoint}:${b.model}`),
    ),
  };
}

function serializeUserDetails(user, adminRoleMap) {
  return {
    ...serializeUserSummary(user, adminRoleMap),
    modelPermissions: normalizeModelPermissions(user.modelPermissions),
    modelRateLimits: normalizeModelRateLimits(user.modelRateLimits),
    preferences: serializePreferencesForAdmin(user),
  };
}

function serializeMCPServerForAdmin(server) {
  return {
    serverName: server.serverName,
    title: server.config?.title || server.serverName,
    description: server.config?.description || '',
    type: server.config?.type || '',
    url: server.config?.url || '',
    createdAt: server.createdAt,
    updatedAt: server.updatedAt,
  };
}

function serializePlatformMCPServer({ serverName, config, storage, published, owner }) {
  const safeConfig = redactServerSecrets(config || {});
  return {
    serverName,
    storage,
    published,
    title: safeConfig.title || serverName,
    description: safeConfig.description || '',
    type: safeConfig.type || '',
    url: safeConfig.url || '',
    ownerId: owner?.id || '',
    ownerEmail: owner?.email || '',
    createdAt: config?.createdAt,
    updatedAt: config?.updatedAt,
  };
}

function compareAdminMCPServers(left, right) {
  const leftName = left.title || left.serverName || '';
  const rightName = right.title || right.serverName || '';
  return (
    leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' }) ||
    (left.serverName || '').localeCompare(right.serverName || '', undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

function getPublishedStaticServerSet(settings, staticServerNames) {
  return Array.isArray(settings?.mcpPublishedServers)
    ? new Set(settings.mcpPublishedServers)
    : new Set(staticServerNames);
}

async function getPublicMCPResourceIds() {
  if (!AclEntry?.find) {
    return new Set();
  }

  const resourceIds = await AclEntry.find({
    principalType: PrincipalType.PUBLIC,
    resourceType: ResourceType.MCPSERVER,
  }).distinct('resourceId');

  return new Set(resourceIds.map((id) => id.toString()));
}

async function buildMCPAuthorMap(servers) {
  const authorIds = [
    ...new Set(
      servers
        .map((server) => server.author?.toString?.() || String(server.author || ''))
        .filter(Boolean),
    ),
  ];

  if (!authorIds.length || !User?.find) {
    return new Map();
  }

  const authors = await User.find({ _id: { $in: authorIds } }, 'email name username').lean();
  return new Map(
    authors.map((author) => [
      author._id.toString(),
      {
        id: author._id.toString(),
        email: author.email || '',
        name: author.name || author.username || '',
      },
    ]),
  );
}

async function serializeAdminMCPServers() {
  const [appConfig, settings, dbServers, publicResourceIds] = await Promise.all([
    getAppConfig(),
    getEffectiveAppSettings(),
    MCPServer?.find
      ? MCPServer.find({}, 'serverName config author publishedBy publishedAt createdAt updatedAt')
          .sort({ updatedAt: -1 })
          .lean()
      : Promise.resolve([]),
    getPublicMCPResourceIds(),
  ]);

  const staticConfigs = appConfig?.mcpConfig || {};
  const staticServerNames = Object.keys(staticConfigs);
  const publishedStaticServers = getPublishedStaticServerSet(settings, staticServerNames);
  const authorMap = await buildMCPAuthorMap(dbServers);

  const staticServers = Object.entries(staticConfigs).map(([serverName, config]) =>
    serializePlatformMCPServer({
      serverName,
      config,
      storage: 'static',
      published: publishedStaticServers.has(serverName),
    }),
  );

  const userServers = dbServers.map((server) => {
    const ownerId = server.author?.toString?.() || String(server.author || '');
    return serializePlatformMCPServer({
      serverName: server.serverName,
      config: {
        ...(server.config || {}),
        createdAt: server.createdAt,
        updatedAt: server.updatedAt,
      },
      storage: 'user',
      published: publicResourceIds.has(server._id.toString()),
      owner: authorMap.get(ownerId),
    });
  });

  return [...staticServers, ...userServers].sort(compareAdminMCPServers);
}

function isExpiredKey(key) {
  if (!key.expiresAt) {
    return false;
  }
  return new Date(key.expiresAt).getTime() <= Date.now();
}

function serializeBYOKKeyForAdmin(key) {
  return {
    provider: key.name,
    expiresAt: key.expiresAt || null,
    expired: isExpiredKey(key),
  };
}

async function loadAdminUserRelatedData(userId) {
  const [mcpServers, byokKeys, scheduledRunCount] = await Promise.all([
    MCPServer?.find
      ? MCPServer.find({ author: userId }, 'serverName config createdAt updatedAt')
          .sort({ updatedAt: -1 })
          .lean()
      : Promise.resolve([]),
    Key?.find ? Key.find({ userId }, 'name expiresAt').lean() : Promise.resolve([]),
    ScheduledJob?.countDocuments
      ? ScheduledJob.countDocuments({ user: userId })
      : Promise.resolve(0),
  ]);

  return {
    mcpServers: mcpServers.map(serializeMCPServerForAdmin).sort(compareAdminMCPServers),
    byokKeys: byokKeys.map(serializeBYOKKeyForAdmin),
    scheduledRunCount,
  };
}

async function buildAdminUserDetailsResponse(user, adminRoleMap) {
  const [usage] = await buildUsageSummaries([user], adminRoleMap);
  const related = await loadAdminUserRelatedData(user._id.toString());
  const activeByokKeys = related.byokKeys.filter((key) => !key.expired);

  return {
    user: serializeUserDetails(user, adminRoleMap),
    usage: {
      ...usage,
      scheduledRunCount: related.scheduledRunCount,
      mcpServerCount: related.mcpServers.length,
      byokKeyCount: activeByokKeys.length,
    },
    mcpServers: related.mcpServers,
    byokKeys: related.byokKeys,
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
      {
        $group: {
          _id: '$user',
          count: { $sum: 1 },
          lastConversationAt: { $max: '$updatedAt' },
        },
      },
    ]),
    Message.aggregate([
      { $match: { user: { $in: stringIds } } },
      {
        $group: {
          _id: '$user',
          count: { $sum: 1 },
          lastMessageAt: { $max: '$createdAt' },
        },
      },
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
    conversationCounts.map((entry) => [String(entry._id), entry]),
  );
  const messageCountMap = new Map(messageCounts.map((entry) => [String(entry._id), entry]));
  const transactionMap = new Map(transactionStats.map((entry) => [String(entry._id), entry]));

  return users.map((user) => {
    const userId = user._id.toString();
    const transaction = transactionMap.get(userId);
    const conversation = conversationCountMap.get(userId);
    const message = messageCountMap.get(userId);
    const lastActiveAt = [
      conversation?.lastConversationAt,
      message?.lastMessageAt,
      transaction?.lastTransactionAt,
    ]
      .filter(Boolean)
      .map((value) => new Date(value))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      userId,
      name: user.name || '',
      email: user.email,
      role: user.role || SystemRoles.USER,
      adminRoles: getSerializedAdminRoles(user.adminRoleIds || [], adminRoleMap),
      tokenCredits: balanceMap.get(userId)?.tokenCredits || 0,
      conversationCount: conversation?.count || 0,
      messageCount: message?.count || 0,
      transactionCount: transaction?.count || 0,
      lastTransactionAt: transaction?.lastTransactionAt,
      lastActiveAt,
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
  const response = await buildAdminUserDetailsResponse(user, adminRoleMap);
  return res.status(200).json(response);
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

  if (updates.modelRateLimits != null) {
    nextUpdates.modelRateLimits = normalizeModelRateLimits(updates.modelRateLimits);
  }

  if (updates.personalization?.memories != null) {
    nextUpdates['personalization.memories'] = Boolean(updates.personalization.memories);
  }

  if (updates.imageGenerationPrefs != null) {
    nextUpdates.imageGenerationPrefs = {
      enabledByDefault: updates.imageGenerationPrefs.enabledByDefault ?? true,
      preferredProvider: updates.imageGenerationPrefs.preferredProvider ?? null,
      models: updates.imageGenerationPrefs.models || {},
    };
  }

  if (updates.modelSteeringPrefs != null) {
    nextUpdates.modelSteeringPrefs = {
      enabled: updates.modelSteeringPrefs.enabled ?? true,
    };
  }

  if (updates.notifications != null) {
    if (updates.notifications.email?.enabled != null) {
      nextUpdates['notifications.email.enabled'] = Boolean(updates.notifications.email.enabled);
    }
    if (updates.notifications.email?.address != null) {
      nextUpdates['notifications.email.address'] = updates.notifications.email.address;
    }
    if (updates.notifications.sms?.enabled != null) {
      nextUpdates['notifications.sms.enabled'] = Boolean(updates.notifications.sms.enabled);
    }
    if (updates.notifications.sms?.provider != null) {
      nextUpdates['notifications.sms.provider'] = updates.notifications.sms.provider;
    }
    if (updates.notifications.push?.enabled != null) {
      nextUpdates['notifications.push.enabled'] = Boolean(updates.notifications.push.enabled);
    }
  }

  await updateUser(targetUser._id.toString(), nextUpdates);
  const updatedUser = await User.findById(req.params.userId, USER_FIELDS).lean();
  const adminRoleMap = await loadAdminRoleMapForUsers([updatedUser]);
  const response = await buildAdminUserDetailsResponse(updatedUser, adminRoleMap);
  return res.status(200).json(response);
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

const getAdminMCPServersController = async (_req, res) => {
  const servers = await serializeAdminMCPServers();
  return res.status(200).json({ servers });
};

async function updateDBMCPPublication({ server, published, adminUserId }) {
  const methods = createMethods(mongoose);

  if (published) {
    const viewerRole = await methods.findRoleByIdentifier(AccessRoleIds.MCPSERVER_VIEWER);
    if (!viewerRole) {
      throw new Error('MCP server viewer role not found');
    }

    await methods.grantPermission(
      PrincipalType.PUBLIC,
      null,
      ResourceType.MCPSERVER,
      server._id,
      viewerRole.permBits,
      adminUserId,
      undefined,
      viewerRole._id,
    );
    await MCPServer.updateOne(
      { serverName: server.serverName },
      { $set: { publishedBy: adminUserId, publishedAt: new Date() } },
    );
  } else {
    await methods.revokePermission(PrincipalType.PUBLIC, null, ResourceType.MCPSERVER, server._id);
    await MCPServer.updateOne(
      { serverName: server.serverName },
      { $unset: { publishedBy: '', publishedAt: '' } },
    );
  }

  return {
    serverName: server.serverName,
    storage: 'user',
    published,
  };
}

async function updateStaticMCPPublication({ serverName, published }) {
  const appConfig = await getAppConfig();
  const staticServerNames = Object.keys(appConfig?.mcpConfig || {});

  if (!staticServerNames.includes(serverName)) {
    return null;
  }

  const settings = await getEffectiveAppSettings();
  const nextPublishedServers = getPublishedStaticServerSet(settings, staticServerNames);
  if (published) {
    nextPublishedServers.add(serverName);
  } else {
    nextPublishedServers.delete(serverName);
  }

  await updateAppSettings({ mcpPublishedServers: Array.from(nextPublishedServers) });

  return {
    serverName,
    storage: 'static',
    published,
  };
}

const updateAdminMCPServerPublicationController = async (req, res) => {
  const { serverName } = req.params;
  const { published } = req.body || {};

  if (!serverName || typeof published !== 'boolean') {
    return res.status(400).json({ message: 'serverName and boolean published are required' });
  }

  const dbServer = MCPServer?.findOne
    ? await MCPServer.findOne(
        { serverName },
        'serverName config author publishedBy publishedAt createdAt updatedAt',
      ).lean()
    : null;

  if (dbServer) {
    const result = await updateDBMCPPublication({
      server: dbServer,
      published,
      adminUserId: req.user.id,
    });
    return res.status(200).json(result);
  }

  const staticResult = await updateStaticMCPPublication({ serverName, published });
  if (!staticResult) {
    return res.status(404).json({ message: 'MCP server not found' });
  }

  return res.status(200).json(staticResult);
};

const getAdminSettingsController = async (_req, res) => {
  const settings = await getEffectiveAppSettings();
  return res.status(200).json(settings);
};

const updateAdminSettingsController = async (req, res) => {
  const parsedUpdates = adminSettingsUpdateSchema.safeParse(req.body || {});
  if (!parsedUpdates.success) {
    return res.status(400).json({ message: 'Invalid admin settings payload' });
  }

  const updates = normalizeObservabilityUpdatesForStorage(parsedUpdates.data, req);
  const settings = await updateAppSettings(updates);
  return res.status(200).json(settings);
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
  getAdminMCPServersController,
  getAdminUserController,
  getAdminUsersController,
  getAdminSettingsController,
  getAdminPermissionsController,
  getAdminObservabilityController,
  updateAdminUserController,
  updateAdminMCPServerPublicationController,
  updateAdminSettingsController,
  deleteAdminUserController,
  refreshAdminModelsController,
};
