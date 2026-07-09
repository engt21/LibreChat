const test = require('node:test');
const assert = require('node:assert/strict');
const { PERSONAS, buildPersonaUpdate } = require('./dev-seed-validation-personas');

test('validation personas include the documented Playwright account', () => {
  assert.equal(
    PERSONAS.some((persona) => persona.email === 'playwright@test.local'),
    true,
  );
});

test('every seeded persona is reset to a deterministic no-MFA state', () => {
  for (const persona of PERSONAS) {
    const update = buildPersonaUpdate({
      persona,
      hashedPassword: 'hashed-password',
      modelPermissions: { enabled: false, rules: [] },
    });

    assert.equal(update.$set.twoFactorEnabled, false);
    assert.equal(update.$set.mfaEnrollmentExempt, true);
    assert.deepEqual(update.$set.refreshToken, []);
    assert.deepEqual(update.$unset, {
      totpSecret: '',
      backupCodes: '',
      pendingTotpSecret: '',
      pendingBackupCodes: '',
    });
  }
});
