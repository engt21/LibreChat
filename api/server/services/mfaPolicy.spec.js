const { requiresMFAEnrollment } = require('./mfaPolicy');

describe('MFA enforcement policy', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, MFA_ENFORCEMENT: 'all_local' };
    delete process.env.MFA_ENFORCE_AFTER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('requires enrollment for local password users', () => {
    expect(
      requiresMFAEnrollment({
        provider: 'local',
        password: 'hash',
        twoFactorEnabled: false,
      }),
    ).toBe(true);
  });

  test('does not double-enforce enrolled users', () => {
    expect(
      requiresMFAEnrollment({
        provider: 'local',
        password: 'hash',
        twoFactorEnabled: true,
      }),
    ).toBe(false);
  });

  test('does not force enrollment for an explicitly exempt synthetic account', () => {
    expect(
      requiresMFAEnrollment({
        provider: 'local',
        password: 'hash',
        twoFactorEnabled: false,
        mfaEnrollmentExempt: true,
      }),
    ).toBe(false);
  });

  test('leaves federated provider MFA to the identity provider', () => {
    expect(
      requiresMFAEnrollment({
        provider: 'openid',
        twoFactorEnabled: false,
      }),
    ).toBe(false);
  });

  test('honors a future enforcement date', () => {
    process.env.MFA_ENFORCE_AFTER = '2099-01-01T00:00:00Z';
    expect(
      requiresMFAEnrollment({
        provider: 'local',
        password: 'hash',
        twoFactorEnabled: false,
      }),
    ).toBe(false);
  });
});
