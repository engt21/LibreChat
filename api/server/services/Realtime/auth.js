const cookies = require('cookie');
const jwt = require('jsonwebtoken');
const { isEnabled } = require('@librechat/api');
const { SystemRoles } = require('librechat-data-provider');
const { findSession, getUserById } = require('~/models');

function getBearerToken(authorizationHeader = '') {
  if (typeof authorizationHeader !== 'string') {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') {
    return null;
  }

  return token;
}

function verifyToken(token, secret) {
  if (!token || !secret) {
    return null;
  }

  try {
    return jwt.verify(token, secret);
  } catch {
    return null;
  }
}

async function getCookieAuthenticatedUserId(cookieHeader = '') {
  if (typeof cookieHeader !== 'string' || !cookieHeader) {
    return null;
  }

  const parsedCookies = cookies.parse(cookieHeader);
  const tokenProvider = parsedCookies.token_provider;

  if (tokenProvider === 'openid' && isEnabled(process.env.OPENID_REUSE_TOKENS)) {
    const openidPayload = verifyToken(parsedCookies.openid_user_id, process.env.JWT_REFRESH_SECRET);
    return typeof openidPayload?.id === 'string' ? openidPayload.id : null;
  }

  const refreshPayload = verifyToken(parsedCookies.refreshToken, process.env.JWT_REFRESH_SECRET);
  if (typeof refreshPayload?.id !== 'string' || !refreshPayload?.sessionId) {
    return null;
  }

  const session = await findSession({
    userId: refreshPayload.id,
    refreshToken: parsedCookies.refreshToken,
  }).catch(() => null);

  if (!session?.expiration || session.expiration <= new Date()) {
    return null;
  }

  return refreshPayload.id;
}

async function authenticateRealtimeRequest(req) {
  const origin = `http://${req.headers.host || 'localhost'}`;
  const requestURL = new URL(req.url, origin);
  const token = requestURL.searchParams.get('token') || getBearerToken(req.headers.authorization);

  const payload = verifyToken(token, process.env.JWT_SECRET);
  const userId = payload?.id || (await getCookieAuthenticatedUserId(req.headers.cookie));

  if (!userId) {
    const error = new Error('Missing realtime authentication token.');
    error.code = 4401;
    throw error;
  }

  const user = await getUserById(userId, '-password -__v -totpSecret -backupCodes');

  if (!user) {
    const error = new Error('Realtime authentication failed: user not found.');
    error.code = 4401;
    throw error;
  }

  user.id = user._id.toString();
  if (!user.role) {
    user.role = SystemRoles.USER;
  }

  return user;
}

module.exports = {
  authenticateRealtimeRequest,
};
