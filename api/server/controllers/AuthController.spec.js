jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), debug: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));
jest.mock('~/server/services/GraphTokenService', () => ({
  getGraphApiToken: jest.fn(),
}));
jest.mock('~/server/services/AuthService', () => ({
  requestPasswordReset: jest.fn(),
  setOpenIDAuthTokens: jest.fn(),
  resetPassword: jest.fn(),
  setAuthTokens: jest.fn(),
  registerUser: jest.fn(),
}));
jest.mock('~/strategies', () => ({ getOpenIdConfig: jest.fn(), getOpenIdEmail: jest.fn() }));
jest.mock('openid-client', () => ({ refreshTokenGrant: jest.fn() }));
jest.mock('~/models', () => ({
  deleteAllUserSessions: jest.fn(),
  getUserById: jest.fn(),
  findSession: jest.fn(),
  updateUser: jest.fn(),
  findUser: jest.fn(),
}));
jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn(),
  findOpenIDUser: jest.fn(),
  shouldUseSecureCookie: jest.fn(),
}));

const openIdClient = require('openid-client');
const { isEnabled, findOpenIDUser, shouldUseSecureCookie } = require('@librechat/api');
const { graphTokenController, refreshController } = require('./AuthController');
const { getGraphApiToken } = require('~/server/services/GraphTokenService');
const { setAuthTokens, setOpenIDAuthTokens } = require('~/server/services/AuthService');
const { getOpenIdConfig, getOpenIdEmail } = require('~/strategies');
const { findSession, getUserById, updateUser } = require('~/models');

const ORIGINAL_ENV = { ...process.env };

describe('graphTokenController', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    isEnabled.mockReturnValue(true);

    req = {
      user: {
        openidId: 'oid-123',
        provider: 'openid',
        federatedTokens: {
          access_token: 'federated-access-token',
          id_token: 'federated-id-token',
        },
      },
      headers: { authorization: 'Bearer app-jwt-which-is-id-token' },
      query: { scopes: 'https://graph.microsoft.com/.default' },
    };

    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    getGraphApiToken.mockResolvedValue({
      access_token: 'graph-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('should pass federatedTokens.access_token as OBO assertion, not the auth header bearer token', async () => {
    await graphTokenController(req, res);

    expect(getGraphApiToken).toHaveBeenCalledWith(
      req.user,
      'federated-access-token',
      'https://graph.microsoft.com/.default',
    );
    expect(getGraphApiToken).not.toHaveBeenCalledWith(
      expect.anything(),
      'app-jwt-which-is-id-token',
      expect.anything(),
    );
  });

  it('should return the graph token response on success', async () => {
    await graphTokenController(req, res);

    expect(res.json).toHaveBeenCalledWith({
      access_token: 'graph-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
    });
  });

  it('should return 403 when user is not authenticated via Entra ID', async () => {
    req.user.provider = 'google';
    req.user.openidId = undefined;

    await graphTokenController(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(getGraphApiToken).not.toHaveBeenCalled();
  });

  it('should return 403 when OPENID_REUSE_TOKENS is not enabled', async () => {
    isEnabled.mockReturnValue(false);

    await graphTokenController(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(getGraphApiToken).not.toHaveBeenCalled();
  });

  it('should return 400 when scopes query param is missing', async () => {
    req.query.scopes = undefined;

    await graphTokenController(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(getGraphApiToken).not.toHaveBeenCalled();
  });

  it('should return 401 when federatedTokens.access_token is missing', async () => {
    req.user.federatedTokens = {};

    await graphTokenController(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(getGraphApiToken).not.toHaveBeenCalled();
  });

  it('should return 401 when federatedTokens is absent entirely', async () => {
    req.user.federatedTokens = undefined;

    await graphTokenController(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(getGraphApiToken).not.toHaveBeenCalled();
  });

  it('should return 500 when getGraphApiToken throws', async () => {
    getGraphApiToken.mockRejectedValue(new Error('OBO exchange failed'));

    await graphTokenController(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Failed to obtain Microsoft Graph token',
    });
  });
});

describe('refreshController – OpenID path', () => {
  const mockTokenset = {
    claims: jest.fn(),
    access_token: 'new-access',
    id_token: 'new-id',
    refresh_token: 'new-refresh',
  };

  const baseClaims = {
    sub: 'oidc-sub-123',
    oid: 'oid-456',
    email: 'user@example.com',
    exp: 9999999999,
  };

  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();

    isEnabled.mockReturnValue(true);
    getOpenIdConfig.mockReturnValue({ some: 'config' });
    openIdClient.refreshTokenGrant.mockResolvedValue(mockTokenset);
    mockTokenset.claims.mockReturnValue(baseClaims);
    getOpenIdEmail.mockReturnValue(baseClaims.email);
    setOpenIDAuthTokens.mockReturnValue('new-app-token');
    updateUser.mockResolvedValue({});

    req = {
      headers: { cookie: 'token_provider=openid; refreshToken=stored-refresh' },
      session: {},
    };

    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      redirect: jest.fn(),
    };
  });

  it('should call getOpenIdEmail with token claims and use result for findOpenIDUser', async () => {
    const user = {
      _id: 'user-db-id',
      email: baseClaims.email,
      openidId: baseClaims.sub,
    };
    findOpenIDUser.mockResolvedValue({ user, error: null, migration: false });

    await refreshController(req, res);

    expect(getOpenIdEmail).toHaveBeenCalledWith(baseClaims);
    expect(findOpenIDUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: baseClaims.email }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should use OPENID_EMAIL_CLAIM-resolved value when claim is present in token', async () => {
    const claimsWithUpn = { ...baseClaims, upn: 'user@corp.example.com' };
    mockTokenset.claims.mockReturnValue(claimsWithUpn);
    getOpenIdEmail.mockReturnValue('user@corp.example.com');

    const user = {
      _id: 'user-db-id',
      email: 'user@corp.example.com',
      openidId: baseClaims.sub,
    };
    findOpenIDUser.mockResolvedValue({ user, error: null, migration: false });

    await refreshController(req, res);

    expect(getOpenIdEmail).toHaveBeenCalledWith(claimsWithUpn);
    expect(findOpenIDUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@corp.example.com' }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should fall back to claims.email when configured claim is absent from token claims', async () => {
    getOpenIdEmail.mockReturnValue(baseClaims.email);

    const user = {
      _id: 'user-db-id',
      email: baseClaims.email,
      openidId: baseClaims.sub,
    };
    findOpenIDUser.mockResolvedValue({ user, error: null, migration: false });

    await refreshController(req, res);

    expect(findOpenIDUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: baseClaims.email }),
    );
  });

  it('should update openidId when migration is triggered on refresh', async () => {
    const user = { _id: 'user-db-id', email: baseClaims.email, openidId: null };
    findOpenIDUser.mockResolvedValue({ user, error: null, migration: true });

    await refreshController(req, res);

    expect(updateUser).toHaveBeenCalledWith(
      'user-db-id',
      expect.objectContaining({ provider: 'openid', openidId: baseClaims.sub }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 401 and redirect to /login when findOpenIDUser returns no user', async () => {
    findOpenIDUser.mockResolvedValue({ user: null, error: null, migration: false });

    await refreshController(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  it('should return 401 and redirect when findOpenIDUser returns an error', async () => {
    findOpenIDUser.mockResolvedValue({ user: null, error: 'AUTH_FAILED', migration: false });

    await refreshController(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  it('should skip OpenID path when token_provider is not openid', async () => {
    req.headers.cookie = 'token_provider=local; refreshToken=some-token';

    await refreshController(req, res);

    expect(openIdClient.refreshTokenGrant).not.toHaveBeenCalled();
  });

  it('should skip OpenID path when OPENID_REUSE_TOKENS is disabled', async () => {
    isEnabled.mockReturnValue(false);

    await refreshController(req, res);

    expect(openIdClient.refreshTokenGrant).not.toHaveBeenCalled();
  });

  it('should return 200 with token not provided when refresh token is absent', async () => {
    req.headers.cookie = 'token_provider=openid';
    req.session = {};

    await refreshController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('Refresh token not provided');
  });
});

describe('refreshController – pending MFA', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MFA_TEMP_TOKEN_SECRET = 'mfa-secret';
    process.env.JWT_ISSUER = 'librechat';
    process.env.MFA_TOKEN_AUDIENCE = 'librechat-mfa';
    shouldUseSecureCookie.mockReturnValue(true);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('returns a distinct MFA-pending auth state instead of a retryable refresh failure', async () => {
    const jwt = require('jsonwebtoken');
    const pendingToken = jwt.sign(
      {
        userId: '507f1f77bcf86cd799439011',
        tokenType: 'mfa_pending',
        twoFAPending: true,
        enrollmentRequired: true,
      },
      process.env.MFA_TEMP_TOKEN_SECRET,
      {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.MFA_TOKEN_AUDIENCE,
      },
    );
    const req = {
      headers: { cookie: `mfa_pending=${pendingToken}; refreshToken=existing-refresh` },
      session: {},
    };
    const res = {
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
      redirect: jest.fn(),
    };

    await refreshController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      twoFAPending: true,
      mfaEnrollmentRequired: true,
    });
    expect(res.clearCookie).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(findSession).not.toHaveBeenCalled();
  });

  it('clears an expired MFA-pending cookie and falls back to the normal unauthenticated refresh response', async () => {
    const jwt = require('jsonwebtoken');
    const expiredPendingToken = jwt.sign(
      {
        userId: '507f1f77bcf86cd799439011',
        tokenType: 'mfa_pending',
        twoFAPending: true,
      },
      process.env.MFA_TEMP_TOKEN_SECRET,
      {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.MFA_TOKEN_AUDIENCE,
        expiresIn: -1,
      },
    );
    const req = {
      headers: { cookie: `mfa_pending=${expiredPendingToken}` },
      session: {},
    };
    const res = {
      clearCookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      send: jest.fn(),
      redirect: jest.fn(),
    };

    await refreshController(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'mfa_pending',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('Refresh token not provided');
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
describe('refreshController – persistent local sessions', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    process.env.JWT_ISSUER = 'librechat';
    process.env.JWT_REFRESH_AUDIENCE = 'librechat-refresh';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('looks up the signed session ID so parallel refresh rotation survives restarts', async () => {
    const jwt = require('jsonwebtoken');
    const userId = '507f1f77bcf86cd799439011';
    const sessionId = '507f191e810c19729de860ea';
    const refreshToken = jwt.sign(
      { id: userId, sessionId, tokenType: 'refresh' },
      process.env.JWT_REFRESH_SECRET,
      {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_REFRESH_AUDIENCE,
        jwtid: sessionId,
      },
    );
    const session = { _id: sessionId, expiration: new Date(Date.now() + 60_000) };
    const user = { _id: userId };
    const req = {
      headers: { cookie: `refreshToken=${refreshToken}; token_provider=librechat` },
      query: {},
      session: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      redirect: jest.fn(),
    };

    getUserById.mockResolvedValue(user);
    findSession.mockResolvedValue(session);
    setAuthTokens.mockResolvedValue('access-token');

    await refreshController(req, res);

    expect(findSession).toHaveBeenCalledWith({ userId, sessionId }, { lean: false });
    expect(setAuthTokens).toHaveBeenCalledWith(userId, res, session);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ token: 'access-token', user });
  });

  it('preserves the session and returns 503 when MongoDB is temporarily unavailable', async () => {
    const jwt = require('jsonwebtoken');
    const userId = '507f1f77bcf86cd799439011';
    const sessionId = '507f191e810c19729de860ea';
    const refreshToken = jwt.sign(
      { id: userId, sessionId, tokenType: 'refresh' },
      process.env.JWT_REFRESH_SECRET,
      {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_REFRESH_AUDIENCE,
        jwtid: sessionId,
      },
    );
    const req = {
      headers: { cookie: `refreshToken=${refreshToken}; token_provider=librechat` },
      query: {},
      session: {},
    };
    const res = {
      set: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      redirect: jest.fn(),
    };

    getUserById.mockResolvedValue({ _id: userId });
    findSession.mockResolvedValue({
      _id: sessionId,
      expiration: new Date(Date.now() + 60_000),
    });
    setAuthTokens.mockRejectedValue(
      Object.assign(new Error('Failed to generate refresh token'), {
        name: 'SessionError',
        code: 'GENERATE_TOKEN_FAILED',
      }),
    );

    await refreshController(req, res);

    expect(res.set).toHaveBeenCalledWith('Retry-After', '2');
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.send).toHaveBeenCalledWith('Authentication service temporarily unavailable');
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('rejects mismatched signed session claims', async () => {
    const jwt = require('jsonwebtoken');
    const refreshToken = jwt.sign(
      {
        id: '507f1f77bcf86cd799439011',
        sessionId: '507f191e810c19729de860ea',
        tokenType: 'refresh',
      },
      process.env.JWT_REFRESH_SECRET,
      {
        issuer: process.env.JWT_ISSUER,
        audience: process.env.JWT_REFRESH_AUDIENCE,
        jwtid: '507f191e810c19729de860eb',
      },
    );
    const req = {
      headers: { cookie: `refreshToken=${refreshToken}; token_provider=librechat` },
      query: {},
      session: {},
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
      redirect: jest.fn(),
    };

    await refreshController(req, res);

    expect(findSession).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith('Invalid refresh token');
  });
});
