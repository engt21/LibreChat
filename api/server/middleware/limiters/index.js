const createTTSLimiters = require('./ttsLimiters');
const createSTTLimiters = require('./sttLimiters');

const loginLimiter = require('./loginLimiter');
const loginAccountLimiter = require('./loginAccountLimiter');
const mfaLimiter = require('./mfaLimiter');
const importLimiters = require('./importLimiters');
const uploadLimiters = require('./uploadLimiters');
const forkLimiters = require('./forkLimiters');
const registerLimiter = require('./registerLimiter');
const toolCallLimiter = require('./toolCallLimiter');
const messageLimiters = require('./messageLimiters');
const verifyEmailLimiter = require('./verifyEmailLimiter');
const resetPasswordLimiter = require('./resetPasswordLimiter');

module.exports = {
  ...uploadLimiters,
  ...importLimiters,
  ...messageLimiters,
  ...forkLimiters,
  loginLimiter,
  loginAccountLimiter,
  mfaLimiter,
  registerLimiter,
  toolCallLimiter,
  createTTSLimiters,
  createSTTLimiters,
  verifyEmailLimiter,
  resetPasswordLimiter,
};
