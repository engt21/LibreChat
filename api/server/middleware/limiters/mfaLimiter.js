const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');
const { removePorts } = require('~/server/utils');

const windowMs = (Number(process.env.MFA_ATTEMPT_WINDOW) || 5) * 60 * 1000;
const max = Number(process.env.MFA_IP_MAX_ATTEMPTS) || 15;

module.exports = rateLimit({
  windowMs,
  max,
  keyGenerator: removePorts,
  store: limiterCache('mfa_limiter'),
  handler: (_req, res) =>
    res.status(429).json({ message: 'Too many verification attempts. Please try again later.' }),
});
