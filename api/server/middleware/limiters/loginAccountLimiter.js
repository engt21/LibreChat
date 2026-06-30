const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');
const { removePorts } = require('~/server/utils');

const windowMs = (Number(process.env.LOGIN_ACCOUNT_WINDOW) || 15) * 60 * 1000;
const max = Number(process.env.LOGIN_ACCOUNT_MAX) || 10;

module.exports = rateLimit({
  windowMs,
  max,
  store: limiterCache('login_account_limiter'),
  keyGenerator(req) {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email || removePorts(req);
  },
  handler: (_req, res) =>
    res.status(429).json({ message: 'Too many login attempts. Please try again later.' }),
});
