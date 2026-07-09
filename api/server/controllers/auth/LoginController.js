const { logger } = require('@librechat/data-schemas');
const { generate2FATempToken } = require('~/server/services/twoFactorService');
const { shouldUseSecureCookie } = require('@librechat/api');
const { setAuthTokens } = require('~/server/services/AuthService');
const { syncUserSuperAdminStatus } = require('~/server/services/Admin/superadmin');
const { requiresMFAEnrollment } = require('~/server/services/mfaPolicy');

const MFA_COOKIE = 'mfa_pending';

function clearPendingCookie(res) {
  res.clearCookie(MFA_COOKIE, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'strict',
    path: '/',
  });
}

function setMFAPendingCookie(res, userId, enrollmentRequired) {
  const secure = shouldUseSecureCookie();
  const cookiePaths = ['/', '/api', '/api/auth', '/api/auth/refresh'];
  const authCookieNames = [
    'refreshToken',
    'token_provider',
    'openid_access_token',
    'openid_id_token',
    'openid_user_id',
  ];

  for (const name of authCookieNames) {
    for (const path of cookiePaths) {
      res.clearCookie(name, { httpOnly: true, secure, path });
    }
  }

  const token = generate2FATempToken(userId, enrollmentRequired);
  res.cookie(MFA_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 5 * 60 * 1000,
  });
}

const loginController = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    req.user = await syncUserSuperAdminStatus(req.user);

    const enrollmentRequired = requiresMFAEnrollment(req.user);
    if (req.user.twoFactorEnabled || enrollmentRequired) {
      setMFAPendingCookie(res, req.user._id, enrollmentRequired);
      return res
        .status(200)
        .json({ twoFAPending: true, mfaEnrollmentRequired: enrollmentRequired });
    }

    const { password: _p, totpSecret: _t, mfaEnrollmentExempt: _m, __v, ...user } = req.user;
    user.id = user._id.toString();

    clearPendingCookie(res);
    const token = await setAuthTokens(req.user._id, res);

    return res.status(200).send({ token, user });
  } catch (err) {
    logger.error('[loginController]', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

module.exports = {
  loginController,
};
