jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn() },
}));
jest.mock('~/server/services/twoFactorService', () => ({
  generate2FATempToken: jest.fn(),
}));
jest.mock('@librechat/api', () => ({
  shouldUseSecureCookie: jest.fn(),
}));
jest.mock('~/server/services/AuthService', () => ({
  setAuthTokens: jest.fn(),
}));
jest.mock('~/server/services/Admin/superadmin', () => ({
  syncUserSuperAdminStatus: jest.fn(),
}));
jest.mock('~/server/services/mfaPolicy', () => ({
  requiresMFAEnrollment: jest.fn(),
}));

const { generate2FATempToken } = require('~/server/services/twoFactorService');
const { shouldUseSecureCookie } = require('@librechat/api');
const { setAuthTokens } = require('~/server/services/AuthService');
const { syncUserSuperAdminStatus } = require('~/server/services/Admin/superadmin');
const { requiresMFAEnrollment } = require('~/server/services/mfaPolicy');
const { loginController } = require('./LoginController');

describe('loginController', () => {
  let req;
  let res;

  beforeEach(() => {
    jest.clearAllMocks();
    shouldUseSecureCookie.mockReturnValue(true);
    syncUserSuperAdminStatus.mockImplementation(async (user) => user);
    requiresMFAEnrollment.mockReturnValue(false);
    generate2FATempToken.mockReturnValue('pending-token');
    setAuthTokens.mockResolvedValue('auth-token');

    req = {
      user: {
        _id: '507f1f77bcf86cd799439011',
        email: 'user@example.com',
        password: 'hashed-password',
        totpSecret: 'secret',
        twoFactorEnabled: false,
        mfaEnrollmentExempt: true,
      },
    };
    res = {
      clearCookie: jest.fn(),
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
    };
  });

  it('returns a distinct MFA-pending response instead of issuing auth tokens', async () => {
    req.user.twoFactorEnabled = true;

    await loginController(req, res);

    expect(setAuthTokens).not.toHaveBeenCalled();
    expect(generate2FATempToken).toHaveBeenCalledWith(req.user._id, false);
    expect(res.cookie).toHaveBeenCalledWith(
      'mfa_pending',
      'pending-token',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
        maxAge: 5 * 60 * 1000,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      twoFAPending: true,
      mfaEnrollmentRequired: false,
    });
  });

  it('clears any stale MFA-pending cookie before issuing a normal session', async () => {
    await loginController(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'mfa_pending',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      }),
    );
    expect(setAuthTokens).toHaveBeenCalledWith(req.user._id, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      token: 'auth-token',
      user: expect.objectContaining({
        _id: req.user._id,
        id: req.user._id,
        email: req.user.email,
      }),
    });
    expect(res.send.mock.calls[0][0].user).not.toHaveProperty('mfaEnrollmentExempt');
  });
});
