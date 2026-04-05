const jwt = require('jsonwebtoken');

jest.mock('~/models', () => ({
  findSession: jest.fn(),
  getUserById: jest.fn(),
}));

const { findSession, getUserById } = require('~/models');
const { authenticateRealtimeRequest } = require('~/server/services/Realtime/auth');

describe('authenticateRealtimeRequest', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    delete process.env.OPENID_REUSE_TOKENS;

    getUserById.mockResolvedValue({ _id: '507f1f77bcf86cd799439011' });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('authenticates with the websocket query token', async () => {
    const token = jwt.sign({ id: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET);

    const user = await authenticateRealtimeRequest({
      url: `/api/realtime/ws?token=${token}`,
      headers: { host: 'localhost:3080' },
    });

    expect(findSession).not.toHaveBeenCalled();
    expect(getUserById).toHaveBeenCalledWith(
      '507f1f77bcf86cd799439011',
      '-password -__v -totpSecret -backupCodes',
    );
    expect(user.id).toBe('507f1f77bcf86cd799439011');
  });

  it('falls back to the refresh-token cookie when no access token is present', async () => {
    const refreshToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011', sessionId: '507f191e810c19729de860ea' },
      process.env.JWT_REFRESH_SECRET,
    );

    findSession.mockResolvedValue({ expiration: new Date(Date.now() + 60_000) });

    const user = await authenticateRealtimeRequest({
      url: '/api/realtime/ws',
      headers: {
        host: 'localhost:3080',
        cookie: `refreshToken=${refreshToken}; token_provider=librechat`,
      },
    });

    expect(findSession).toHaveBeenCalledWith({
      userId: '507f1f77bcf86cd799439011',
      refreshToken,
    });
    expect(user.id).toBe('507f1f77bcf86cd799439011');
  });

  it('falls back to the refresh-token cookie when the query token is stale or invalid', async () => {
    const refreshToken = jwt.sign(
      { id: '507f1f77bcf86cd799439011', sessionId: '507f191e810c19729de860ea' },
      process.env.JWT_REFRESH_SECRET,
    );

    findSession.mockResolvedValue({ expiration: new Date(Date.now() + 60_000) });

    const user = await authenticateRealtimeRequest({
      url: '/api/realtime/ws?token=stale-token',
      headers: {
        host: 'localhost:3080',
        cookie: `refreshToken=${refreshToken}; token_provider=librechat`,
      },
    });

    expect(user.id).toBe('507f1f77bcf86cd799439011');
  });

  it('accepts the signed openid_user_id cookie when OpenID token reuse is enabled', async () => {
    process.env.OPENID_REUSE_TOKENS = 'true';
    const openidUserId = jwt.sign(
      { id: '507f1f77bcf86cd799439011' },
      process.env.JWT_REFRESH_SECRET,
    );

    const user = await authenticateRealtimeRequest({
      url: '/api/realtime/ws',
      headers: {
        host: 'localhost:3080',
        cookie: `token_provider=openid; openid_user_id=${openidUserId}`,
      },
    });

    expect(findSession).not.toHaveBeenCalled();
    expect(user.id).toBe('507f1f77bcf86cd799439011');
  });
});
