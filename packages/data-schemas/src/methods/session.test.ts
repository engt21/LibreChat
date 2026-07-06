import mongoose from 'mongoose';
import { createSessionMethods } from './session';
import { hashToken, signPayload } from '~/crypto';
import type { ISession } from '~/types/session';

jest.mock('~/crypto', () => ({
  hashToken: jest.fn(),
  signPayload: jest.fn(),
}));

describe('Session Methods', () => {
  const mockHashToken = hashToken as jest.MockedFunction<typeof hashToken>;
  const mockSignPayload = signPayload as jest.MockedFunction<typeof signPayload>;

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.JWT_REFRESH_SECRET;
    delete process.env.JWT_ISSUER;
    delete process.env.JWT_REFRESH_AUDIENCE;
  });

  it('issues purpose-bound refresh tokens with matching verifier claims', async () => {
    process.env.JWT_REFRESH_SECRET = 'refresh-secret';
    mockSignPayload.mockResolvedValue('refresh-token');
    mockHashToken.mockResolvedValue('refresh-token-hash');

    const expiration = new Date(Date.now() + 60_000);
    const session = {
      _id: new mongoose.Types.ObjectId(),
      user: new mongoose.Types.ObjectId(),
      expiration,
      save: jest.fn().mockResolvedValue(undefined),
    } as unknown as ISession;

    const { generateRefreshToken } = createSessionMethods(mongoose);
    await generateRefreshToken(session);

    expect(mockSignPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          id: session.user,
          sessionId: session._id,
          tokenType: 'refresh',
        }),
        secret: 'refresh-secret',
        issuer: 'librechat',
        audience: 'librechat-refresh',
        jwtId: session._id.toString(),
      }),
    );
    expect(session.refreshTokenHash).toBe('refresh-token-hash');
    expect(session.save).toHaveBeenCalledTimes(1);
  });
});
