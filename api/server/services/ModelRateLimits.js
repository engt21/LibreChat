const { standardCache } = require('@librechat/api');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const WINDOW_TTL_SECONDS = 25 * 60 * 60;
const rateLimitCache = standardCache('model-rate-limits', WINDOW_TTL_SECONDS * 1000);

function normalizePart(value) {
  return String(value || '').trim();
}

function getWindowId(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getRules(user) {
  if (user?.modelRateLimits?.enabled !== true) {
    return [];
  }

  return Array.isArray(user.modelRateLimits.rules) ? user.modelRateLimits.rules : [];
}

function matchesRule(rule, endpoint, model) {
  const ruleEndpoint = normalizePart(rule.endpoint);
  const ruleModel = normalizePart(rule.model);
  return (
    (ruleEndpoint === '*' || ruleEndpoint === endpoint) &&
    (ruleModel === '*' || ruleModel === model)
  );
}

function getRuleSpecificity(rule) {
  return (rule.endpoint === '*' ? 0 : 1) + (rule.model === '*' ? 0 : 1);
}

function getMatchingRule({ user, endpoint, model }) {
  const normalizedEndpoint = normalizePart(endpoint);
  const normalizedModel = normalizePart(model);

  return getRules(user)
    .filter((rule) => matchesRule(rule, normalizedEndpoint, normalizedModel))
    .sort((a, b) => getRuleSpecificity(b) - getRuleSpecificity(a))[0];
}

function getCounterKey({ userId, endpoint, model, metric, windowId = getWindowId() }) {
  return [userId, endpoint || '*', model || '*', metric, windowId].join(':');
}

async function getCounter(key) {
  return Number((await rateLimitCache.get(key)) || 0);
}

async function setCounter(key, value) {
  await rateLimitCache.set(key, value, WINDOW_MS);
}

async function checkAndIncrementModelRequestLimit({ user, endpoint, model }) {
  const rule = getMatchingRule({ user, endpoint, model });
  if (!rule) {
    return { allowed: true };
  }

  const userId = user?.id || user?._id?.toString();
  if (!userId) {
    return { allowed: true };
  }

  const common = { userId, endpoint, model };
  const tokenLimit = Number(rule.tokensPerDay) || 0;
  if (tokenLimit > 0) {
    const tokenKey = getCounterKey({ ...common, metric: 'tokens' });
    const tokenCount = await getCounter(tokenKey);
    if (tokenCount >= tokenLimit) {
      return {
        allowed: false,
        type: 'tokens',
        limit: tokenLimit,
        current: tokenCount,
        window: '24h',
      };
    }
  }

  const requestLimit = Number(rule.requestsPerDay) || 0;
  if (requestLimit <= 0) {
    return { allowed: true };
  }

  const requestKey = getCounterKey({ ...common, metric: 'requests' });
  const requestCount = await getCounter(requestKey);
  if (requestCount >= requestLimit) {
    return {
      allowed: false,
      type: 'requests',
      limit: requestLimit,
      current: requestCount,
      window: '24h',
    };
  }

  await setCounter(requestKey, requestCount + 1);
  return { allowed: true, limit: requestLimit, current: requestCount + 1, window: '24h' };
}

async function recordModelTokenUsage({ user, endpoint, model, tokens }) {
  const rule = getMatchingRule({ user, endpoint, model });
  const tokenCount = Number(tokens) || 0;
  if (!rule || tokenCount <= 0 || !rule.tokensPerDay) {
    return;
  }

  const userId = user?.id || user?._id?.toString();
  if (!userId) {
    return;
  }

  const key = getCounterKey({ userId, endpoint, model, metric: 'tokens' });
  const current = await getCounter(key);
  await setCounter(key, current + tokenCount);
}

module.exports = {
  getMatchingRule,
  checkAndIncrementModelRequestLimit,
  recordModelTokenUsage,
};
