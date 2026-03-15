const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { User } = require('~/db/models');

const SUPERADMIN_EMAILS_ENV = 'SUPERADMIN_EMAILS';

function normalizeAdminEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function getConfiguredSuperAdminEmails() {
  return Array.from(
    new Set(
      (process.env[SUPERADMIN_EMAILS_ENV] || '')
        .split(/[\s,]+/)
        .map(normalizeAdminEmail)
        .filter(Boolean),
    ),
  );
}

function isConfiguredSuperAdminEmail(email) {
  const normalizedEmail = normalizeAdminEmail(email);
  if (!normalizedEmail) {
    return false;
  }

  return getConfiguredSuperAdminEmails().includes(normalizedEmail);
}

async function syncUserSuperAdminStatus(user) {
  if (!user?.email || !isConfiguredSuperAdminEmail(user.email) || user.role === SystemRoles.ADMIN) {
    return user;
  }

  const userId = user._id?.toString?.() ?? user.id;
  if (!userId) {
    return user;
  }

  await User.findByIdAndUpdate(userId, { $set: { role: SystemRoles.ADMIN } });
  user.role = SystemRoles.ADMIN;

  logger.info(
    `[superadmin] Promoted allowlisted user to ADMIN: ${normalizeAdminEmail(user.email)}`,
  );
  return user;
}

async function syncConfiguredSuperAdmins() {
  const configuredEmails = getConfiguredSuperAdminEmails();
  if (!configuredEmails.length) {
    return { configured: 0, matched: 0, promoted: 0 };
  }

  const matchedUsers = await User.find(
    { email: { $in: configuredEmails } },
    '_id email role',
  ).lean();
  const updateResult = await User.updateMany(
    {
      email: { $in: configuredEmails },
      role: { $ne: SystemRoles.ADMIN },
    },
    { $set: { role: SystemRoles.ADMIN } },
  );

  if (matchedUsers.length > 0) {
    logger.info(
      `[superadmin] Synced ${updateResult.modifiedCount ?? 0} of ${matchedUsers.length} configured allowlisted users`,
      {
        configuredEmails,
        matchedUsers: matchedUsers.map((user) => ({ email: user.email, role: user.role })),
      },
    );
  }

  return {
    configured: configuredEmails.length,
    matched: matchedUsers.length,
    promoted: updateResult.modifiedCount ?? 0,
  };
}

module.exports = {
  SUPERADMIN_EMAILS_ENV,
  normalizeAdminEmail,
  getConfiguredSuperAdminEmails,
  isConfiguredSuperAdminEmail,
  syncUserSuperAdminStatus,
  syncConfiguredSuperAdmins,
};
