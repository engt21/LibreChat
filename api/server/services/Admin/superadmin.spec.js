/**
 * superadmin.spec.js
 *
 * Covers VAL-ADMIN-003: SUPERADMIN_EMAILS auto-promotes matching users on startup
 * and during auth flows.
 *
 * Tests the superadmin module's allowlist parsing, email normalization,
 * per-user promotion (used at login time), and bulk startup sync.
 */

jest.mock('@librechat/data-schemas', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));
jest.mock('librechat-data-provider', () => ({
  SystemRoles: { USER: 'USER', ADMIN: 'ADMIN' },
}));
jest.mock('~/db/models', () => {
  const mockFindResult = { lean: jest.fn() };
  return {
    User: {
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(() => mockFindResult),
      updateMany: jest.fn(),
      _mockFindResult: mockFindResult,
    },
  };
});

const { User } = require('~/db/models');
const {
  normalizeAdminEmail,
  getConfiguredSuperAdminEmails,
  isConfiguredSuperAdminEmail,
  syncUserSuperAdminStatus,
  syncConfiguredSuperAdmins,
} = require('./superadmin');

describe('superadmin module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // -----------------------------------------------------------------------
  // normalizeAdminEmail
  // -----------------------------------------------------------------------
  describe('normalizeAdminEmail', () => {
    it('lowercases and trims an email', () => {
      expect(normalizeAdminEmail('  Admin@Example.COM  ')).toBe('admin@example.com');
    });

    it('returns empty string for non-string input', () => {
      expect(normalizeAdminEmail(null)).toBe('');
      expect(normalizeAdminEmail(undefined)).toBe('');
      expect(normalizeAdminEmail(42)).toBe('');
    });
  });

  // -----------------------------------------------------------------------
  // getConfiguredSuperAdminEmails
  // -----------------------------------------------------------------------
  describe('getConfiguredSuperAdminEmails', () => {
    it('parses comma-separated emails', () => {
      process.env.SUPERADMIN_EMAILS = 'alice@example.com, bob@example.com';
      expect(getConfiguredSuperAdminEmails()).toEqual(['alice@example.com', 'bob@example.com']);
    });

    it('deduplicates case-insensitively', () => {
      process.env.SUPERADMIN_EMAILS = 'Alice@Example.com,alice@example.com';
      expect(getConfiguredSuperAdminEmails()).toEqual(['alice@example.com']);
    });

    it('handles whitespace and multiple separators', () => {
      process.env.SUPERADMIN_EMAILS = 'a@b.com , , c@d.com  e@f.com';
      expect(getConfiguredSuperAdminEmails()).toEqual(['a@b.com', 'c@d.com', 'e@f.com']);
    });

    it('returns empty array when env var is unset', () => {
      delete process.env.SUPERADMIN_EMAILS;
      expect(getConfiguredSuperAdminEmails()).toEqual([]);
    });

    it('returns empty array when env var is empty string', () => {
      process.env.SUPERADMIN_EMAILS = '';
      expect(getConfiguredSuperAdminEmails()).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // isConfiguredSuperAdminEmail
  // -----------------------------------------------------------------------
  describe('isConfiguredSuperAdminEmail', () => {
    beforeEach(() => {
      process.env.SUPERADMIN_EMAILS = 'superadmin@test.com, other@test.com';
    });

    it('returns true for an allowlisted email (case-insensitive)', () => {
      expect(isConfiguredSuperAdminEmail('superadmin@test.com')).toBe(true);
      expect(isConfiguredSuperAdminEmail('SUPERADMIN@TEST.COM')).toBe(true);
      expect(isConfiguredSuperAdminEmail('  SuperAdmin@Test.com  ')).toBe(true);
    });

    it('returns false for a non-allowlisted email', () => {
      expect(isConfiguredSuperAdminEmail('stranger@test.com')).toBe(false);
    });

    it('returns false for empty / null / undefined input', () => {
      expect(isConfiguredSuperAdminEmail('')).toBe(false);
      expect(isConfiguredSuperAdminEmail(null)).toBe(false);
      expect(isConfiguredSuperAdminEmail(undefined)).toBe(false);
    });

    it('returns false when SUPERADMIN_EMAILS is unset', () => {
      delete process.env.SUPERADMIN_EMAILS;
      expect(isConfiguredSuperAdminEmail('superadmin@test.com')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // syncUserSuperAdminStatus  (login-time per-user promotion)
  // -----------------------------------------------------------------------
  describe('syncUserSuperAdminStatus', () => {
    const allowlistedEmail = 'allowed@test.com';

    beforeEach(() => {
      process.env.SUPERADMIN_EMAILS = allowlistedEmail;
      User.findByIdAndUpdate.mockResolvedValue({});
    });

    it('promotes an allowlisted USER to ADMIN on login', async () => {
      const user = { _id: 'uid1', email: allowlistedEmail, role: 'USER' };
      const result = await syncUserSuperAdminStatus(user);

      expect(result.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith('uid1', {
        $set: { role: 'ADMIN' },
      });
    });

    it('repromotes an allowlisted user who was demoted back to USER', async () => {
      // Simulate a demote-and-relogin scenario:
      // An admin manually sets the user role back to USER, then the user logs in again.
      const demotedUser = { _id: 'uid2', email: allowlistedEmail, role: 'USER' };
      const result = await syncUserSuperAdminStatus(demotedUser);

      expect(result.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith('uid2', {
        $set: { role: 'ADMIN' },
      });
    });

    it('does NOT promote a user whose email is not in the allowlist', async () => {
      const user = { _id: 'uid3', email: 'stranger@test.com', role: 'USER' };
      const result = await syncUserSuperAdminStatus(user);

      expect(result.role).toBe('USER');
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('is a no-op when the user is already ADMIN', async () => {
      const user = { _id: 'uid4', email: allowlistedEmail, role: 'ADMIN' };
      const result = await syncUserSuperAdminStatus(user);

      expect(result.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('is a no-op when user is null', async () => {
      const result = await syncUserSuperAdminStatus(null);
      expect(result).toBeNull();
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('is a no-op when user has no email', async () => {
      const user = { _id: 'uid5', role: 'USER' };
      const result = await syncUserSuperAdminStatus(user);
      expect(result.role).toBe('USER');
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('is a no-op when user has no _id or id', async () => {
      const user = { email: allowlistedEmail, role: 'USER' };
      const result = await syncUserSuperAdminStatus(user);
      expect(result.role).toBe('USER');
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('handles case-insensitive email matching for promotion', async () => {
      const user = { _id: 'uid6', email: 'ALLOWED@TEST.COM', role: 'USER' };
      const result = await syncUserSuperAdminStatus(user);

      expect(result.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('uses user.id when user._id is absent', async () => {
      const user = { id: 'uid7', email: allowlistedEmail, role: 'USER' };
      const result = await syncUserSuperAdminStatus(user);

      expect(result.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith('uid7', {
        $set: { role: 'ADMIN' },
      });
    });
  });

  // -----------------------------------------------------------------------
  // syncConfiguredSuperAdmins  (startup bulk sync)
  // -----------------------------------------------------------------------
  describe('syncConfiguredSuperAdmins', () => {
    it('returns zeros when SUPERADMIN_EMAILS is unset', async () => {
      delete process.env.SUPERADMIN_EMAILS;
      const result = await syncConfiguredSuperAdmins();
      expect(result).toEqual({ configured: 0, matched: 0, promoted: 0 });
    });

    it('promotes matched non-ADMIN users at startup', async () => {
      process.env.SUPERADMIN_EMAILS = 'alice@test.com, bob@test.com';

      User._mockFindResult.lean.mockResolvedValue([
        { _id: 'a1', email: 'alice@test.com', role: 'USER' },
        { _id: 'b1', email: 'bob@test.com', role: 'ADMIN' },
      ]);
      User.updateMany.mockResolvedValue({ modifiedCount: 1 });

      const result = await syncConfiguredSuperAdmins();
      expect(result).toEqual({ configured: 2, matched: 2, promoted: 1 });

      // updateMany should target only non-ADMIN users
      expect(User.updateMany).toHaveBeenCalledWith(
        {
          email: { $in: ['alice@test.com', 'bob@test.com'] },
          role: { $ne: 'ADMIN' },
        },
        { $set: { role: 'ADMIN' } },
      );
    });

    it('repromotes previously demoted users at startup', async () => {
      process.env.SUPERADMIN_EMAILS = 'admin@test.com';

      // Simulate: user was demoted (role=USER) but still in allowlist
      User._mockFindResult.lean.mockResolvedValue([
        { _id: 'a1', email: 'admin@test.com', role: 'USER' },
      ]);
      User.updateMany.mockResolvedValue({ modifiedCount: 1 });

      const result = await syncConfiguredSuperAdmins();
      expect(result).toEqual({ configured: 1, matched: 1, promoted: 1 });
    });

    it('handles no matched users in the database', async () => {
      process.env.SUPERADMIN_EMAILS = 'ghost@test.com';

      User._mockFindResult.lean.mockResolvedValue([]);
      User.updateMany.mockResolvedValue({ modifiedCount: 0 });

      const result = await syncConfiguredSuperAdmins();
      expect(result).toEqual({ configured: 1, matched: 0, promoted: 0 });
    });

    it('handles all matched users already ADMIN', async () => {
      process.env.SUPERADMIN_EMAILS = 'already@test.com';

      User._mockFindResult.lean.mockResolvedValue([
        { _id: 'a1', email: 'already@test.com', role: 'ADMIN' },
      ]);
      User.updateMany.mockResolvedValue({ modifiedCount: 0 });

      const result = await syncConfiguredSuperAdmins();
      expect(result).toEqual({ configured: 1, matched: 1, promoted: 0 });
    });
  });

  // -----------------------------------------------------------------------
  // VAL-ADMIN-003 scenario: demote → relogin → repromotion
  // -----------------------------------------------------------------------
  describe('VAL-ADMIN-003: demote-and-relogin repromotion flow', () => {
    const allowlistedEmail = 'superadmin@company.com';

    beforeEach(() => {
      process.env.SUPERADMIN_EMAILS = allowlistedEmail;
      User.findByIdAndUpdate.mockResolvedValue({});
      User._mockFindResult.lean.mockResolvedValue([]);
      User.updateMany.mockResolvedValue({ modifiedCount: 0 });
    });

    it('an allowlisted user who was manually demoted gets repromoted on next login', async () => {
      // Step 1: user is allowlisted and was ADMIN
      const userAsAdmin = { _id: 'uid-sa', email: allowlistedEmail, role: 'ADMIN' };
      const r1 = await syncUserSuperAdminStatus(userAsAdmin);
      expect(r1.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();

      // Step 2: admin manually demotes user to USER (simulated)
      const demotedUser = { _id: 'uid-sa', email: allowlistedEmail, role: 'USER' };

      // Step 3: user logs in again → should be repromoted
      const r2 = await syncUserSuperAdminStatus(demotedUser);
      expect(r2.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith('uid-sa', {
        $set: { role: 'ADMIN' },
      });
    });

    it('a non-allowlisted user stays demoted after relogin', async () => {
      const nonAllowlisted = { _id: 'uid-normal', email: 'regular@company.com', role: 'USER' };
      const result = await syncUserSuperAdminStatus(nonAllowlisted);
      expect(result.role).toBe('USER');
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('startup sync also repromotes demoted allowlisted users', async () => {
      User._mockFindResult.lean.mockResolvedValue([
        { _id: 'uid-sa', email: allowlistedEmail, role: 'USER' },
      ]);
      User.updateMany.mockResolvedValue({ modifiedCount: 1 });

      const result = await syncConfiguredSuperAdmins();
      expect(result.promoted).toBe(1);
    });

    it('validates that the validation persona email must be in the allowlist for promotion', async () => {
      // This test proves that val-superadmin@dev.local would NOT be promoted
      // unless it's actually in SUPERADMIN_EMAILS
      process.env.SUPERADMIN_EMAILS = 'real-admin@company.com';

      const mismatchedPersona = {
        _id: 'uid-val',
        email: 'val-superadmin@dev.local',
        role: 'USER',
      };
      const result = await syncUserSuperAdminStatus(mismatchedPersona);
      expect(result.role).toBe('USER');
      expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('validates that the validation persona IS promoted when in the allowlist', async () => {
      process.env.SUPERADMIN_EMAILS = 'real-admin@company.com, val-superadmin@dev.local';

      const matchedPersona = {
        _id: 'uid-val',
        email: 'val-superadmin@dev.local',
        role: 'USER',
      };
      const result = await syncUserSuperAdminStatus(matchedPersona);
      expect(result.role).toBe('ADMIN');
      expect(User.findByIdAndUpdate).toHaveBeenCalled();
    });
  });
});
