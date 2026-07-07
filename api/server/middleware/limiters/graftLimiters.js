const rateLimit = require('express-rate-limit');
const { limiterCache } = require('@librechat/api');
const { logger } = require('@librechat/data-schemas');
const logViolation = require('~/cache/logViolation');

function parsePositiveInt(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function createHandler(limiter) {
  return async (req, res) => {
    const type = 'generation_graft_limit';
    const details = {
      type,
      limiter,
    };

    try {
      await logViolation(req, res, type, details);
    } catch (error) {
      logger.error('Error logging generation graft rate limit violation:', error);
    }

    res.status(429).json({ message: 'Too many graft requests. Try again later.' });
  };
}

function createLimiter({ name, max, keyGenerator, handler }) {
  const options = {
    windowMs: parsePositiveInt('GRAFT_RATE_WINDOW_MINUTES', 1) * 60 * 1000,
    max,
    handler,
    store: limiterCache(name),
  };

  if (keyGenerator) {
    options.keyGenerator = keyGenerator;
  }

  return rateLimit(options);
}

function createGraftLimiters() {
  return {
    graftPreviewIpLimiter: createLimiter({
      name: 'graft_preview_ip_limiter',
      max: parsePositiveInt('GRAFT_PREVIEW_IP_MAX', 120),
      handler: createHandler('preview-ip'),
    }),
    graftPreviewUserLimiter: createLimiter({
      name: 'graft_preview_user_limiter',
      max: parsePositiveInt('GRAFT_PREVIEW_USER_MAX', 60),
      keyGenerator: (req) => req.user?.id,
      handler: createHandler('preview-user'),
    }),
    graftMutationIpLimiter: createLimiter({
      name: 'graft_mutation_ip_limiter',
      max: parsePositiveInt('GRAFT_MUTATION_IP_MAX', 30),
      handler: createHandler('mutation-ip'),
    }),
    graftMutationUserLimiter: createLimiter({
      name: 'graft_mutation_user_limiter',
      max: parsePositiveInt('GRAFT_MUTATION_USER_MAX', 10),
      keyGenerator: (req) => req.user?.id,
      handler: createHandler('mutation-user'),
    }),
  };
}

module.exports = { createGraftLimiters };
