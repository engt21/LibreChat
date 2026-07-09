const { SystemRoles } = require('librechat-data-provider');

const LOCAL_PROVIDERS = new Set(['local']);

function parseDate(value) {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLocalPasswordUser(user) {
  return LOCAL_PROVIDERS.has(String(user?.provider || 'local').toLowerCase());
}

function requiresMFAEnrollment(user, now = new Date()) {
  if (!isLocalPasswordUser(user) || user.twoFactorEnabled || user.mfaEnrollmentExempt === true) {
    return false;
  }

  const mode = String(process.env.MFA_ENFORCEMENT || 'off').toLowerCase();
  if (mode === 'off') {
    return false;
  }
  if (mode === 'admins' && user.role !== SystemRoles.ADMIN) {
    return false;
  }

  const enforceAfter = parseDate(process.env.MFA_ENFORCE_AFTER);
  return enforceAfter == null || now >= enforceAfter;
}

module.exports = { isLocalPasswordUser, requiresMFAEnrollment };
