const jwt = require('jsonwebtoken');
const { logger, encryptV3 } = require('@librechat/data-schemas');
const { shouldUseSecureCookie, standardCache } = require('@librechat/api');
const {
  verifyTOTP,
  getTOTPSecret,
  verifyBackupCode,
  generateTOTPSecret,
  generateBackupCodes,
} = require('~/server/services/twoFactorService');
const { setAuthTokens } = require('~/server/services/AuthService');
const { getUserById, updateUser } = require('~/models');

const MFA_COOKIE = 'mfa_pending';
const MFA_MAX_ATTEMPTS = Number(process.env.MFA_MAX_ATTEMPTS) || 5;
const MFA_ATTEMPT_WINDOW_MS = (Number(process.env.MFA_ATTEMPT_WINDOW) || 5) * 60 * 1000;
const attemptCache = standardCache('mfa-login-attempts', MFA_ATTEMPT_WINDOW_MS);
const safeAppTitle = (process.env.APP_TITLE || 'LibreChat').replace(/\s+/g, '');

function clearPendingCookie(res) {
  res.clearCookie(MFA_COOKIE, {
    httpOnly: true,
    secure: shouldUseSecureCookie(),
    sameSite: 'strict',
    path: '/api/auth/2fa',
  });
}

function readPendingToken(req) {
  return req.cookies?.[MFA_COOKIE];
}

function verifyPendingToken(req) {
  const token = readPendingToken(req);
  if (!token) {
    throw new Error('MFA_PENDING_MISSING');
  }
  const payload = jwt.verify(token, process.env.MFA_TEMP_TOKEN_SECRET || process.env.JWT_SECRET, {
    issuer: process.env.JWT_ISSUER || 'librechat',
    audience: process.env.MFA_TOKEN_AUDIENCE || 'librechat-mfa',
  });
  if (payload.tokenType !== 'mfa_pending' || payload.twoFAPending !== true || !payload.userId) {
    throw new Error('MFA_PENDING_INVALID');
  }
  return payload;
}

async function getAttemptCount(payload) {
  return Number((await attemptCache.get(payload.jti || payload.userId)) || 0);
}

async function recordFailure(payload) {
  const key = payload.jti || payload.userId;
  const attempts = (await getAttemptCount(payload)) + 1;
  await attemptCache.set(key, attempts, MFA_ATTEMPT_WINDOW_MS);
  return attempts;
}

async function clearFailures(payload) {
  await attemptCache.delete(payload.jti || payload.userId);
}

function pendingError(res) {
  clearPendingCookie(res);
  return res.status(401).json({ message: 'Your sign-in verification expired. Please sign in again.' });
}

const setup2FAWithPendingToken = async (req, res) => {
  try {
    const payload = verifyPendingToken(req);
    if (payload.enrollmentRequired !== true) {
      return res.status(400).json({ message: 'MFA enrollment is not required for this sign-in.' });
    }

    const user = await getUserById(payload.userId, '+pendingTotpSecret _id email twoFactorEnabled');
    if (!user || user.twoFactorEnabled) {
      return res.status(400).json({ message: 'MFA enrollment is unavailable for this account.' });
    }

    const secret = generateTOTPSecret();
    const { plainCodes, codeObjects } = await generateBackupCodes();
    await updateUser(user._id, {
      pendingTotpSecret: encryptV3(secret),
      pendingBackupCodes: codeObjects,
    });

    const otpauthUrl = `otpauth://totp/${safeAppTitle}:${user.email}?secret=${secret}&issuer=${safeAppTitle}`;
    return res.status(200).json({ otpauthUrl, backupCodes: plainCodes });
  } catch (error) {
    logger.warn('[setup2FAWithPendingToken] Invalid pending MFA session', { error: error.message });
    return pendingError(res);
  }
};

const verify2FAWithTempToken = async (req, res) => {
  let payload;
  try {
    payload = verifyPendingToken(req);
  } catch (error) {
    logger.warn('[verify2FAWithTempToken] Invalid pending MFA session', { error: error.message });
    return pendingError(res);
  }

  try {
    if ((await getAttemptCount(payload)) >= MFA_MAX_ATTEMPTS) {
      clearPendingCookie(res);
      return res.status(429).json({ message: 'Too many verification attempts. Please sign in again.' });
    }

    const user = await getUserById(
      payload.userId,
      '+totpSecret +backupCodes +pendingTotpSecret +pendingBackupCodes',
    );
    if (!user) {
      return pendingError(res);
    }

    const enrolling = payload.enrollmentRequired === true && !user.twoFactorEnabled;
    const secretSource = enrolling ? user.pendingTotpSecret : user.totpSecret;
    if (!secretSource || (!enrolling && !user.twoFactorEnabled)) {
      return res.status(400).json({ message: 'MFA is not ready for this account.' });
    }

    const { token, backupCode } = req.body;
    if (enrolling && req.body.backupCodesAcknowledged !== true) {
      return res.status(400).json({ message: 'Download and acknowledge your backup codes before completing MFA setup.' });
    }
    const secret = await getTOTPSecret(secretSource);
    let isVerified = false;
    if (token) {
      isVerified = await verifyTOTP(secret, token);
    } else if (!enrolling && backupCode) {
      isVerified = await verifyBackupCode({ user, backupCode });
    }

    if (!isVerified) {
      const attempts = await recordFailure(payload);
      if (attempts >= MFA_MAX_ATTEMPTS) {
        clearPendingCookie(res);
        return res.status(429).json({ message: 'Too many verification attempts. Please sign in again.' });
      }
      return res.status(401).json({ message: 'Invalid verification code.' });
    }

    if (enrolling) {
      await updateUser(user._id, {
        totpSecret: user.pendingTotpSecret,
        backupCodes: user.pendingBackupCodes,
        twoFactorEnabled: true,
        pendingTotpSecret: null,
        pendingBackupCodes: [],
      });
    }

    await clearFailures(payload);
    clearPendingCookie(res);

    const freshUser = await getUserById(user._id, '-password -__v -totpSecret -backupCodes');
    const userData = freshUser.toObject ? freshUser.toObject() : { ...freshUser };
    userData.id = freshUser._id.toString();
    const authToken = await setAuthTokens(user._id, res);
    return res.status(200).json({ token: authToken, user: userData });
  } catch (error) {
    logger.error('[verify2FAWithTempToken]', error);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

module.exports = { setup2FAWithPendingToken, verify2FAWithTempToken };
