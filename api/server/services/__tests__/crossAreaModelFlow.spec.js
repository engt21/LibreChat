/**
 * Cross-area flow tests for VAL-CROSS-001:
 * Registration gating, super-admin sync, and default model restrictions stay aligned.
 *
 * These tests verify that the model access and registration subsystems compose correctly
 * end to end without relying on a running server.
 */

const { SystemRoles, KnownEndpoints, EModelEndpoint } = require('librechat-data-provider');

// Must require after librechat-data-provider is available
const {
  applyDefaultModelPermissions,
  getDefaultModelPermissionsForRole,
  hasModelRestrictions,
  filterModelsConfigForUser,
} = require('~/server/services/ModelAccess');

describe('cross-area: registration + superadmin sync + default model restrictions (VAL-CROSS-001)', () => {
  // fullModelsConfig represents the complete catalog served to admins.
  // Non-admin users receive only the subset matching DEFAULT_NON_ADMIN_MODEL_PERMISSIONS.
  const fullModelsConfig = {
    [EModelEndpoint.openAI]: ['gpt-4o', 'gpt-5.3-chat-latest', 'gpt-5.4-mini', 'gpt-5.4-nano'],
    [EModelEndpoint.anthropic]: [
      'claude-sonnet-4-5',
      'claude-opus-4',
      'claude-haiku-4-5',
      'claude-3',
    ],
    [EModelEndpoint.google]: ['gemini-2.5-pro', 'gemini-3-flash-preview'],
    [KnownEndpoints.ollama]: ['qwen2.5:latest', 'gptossbigctx:latest'],
    [KnownEndpoints.xai]: ['grok-4-1-fast', 'grok-3'],
    LiteLLM: ['gemini-2.5-pro', 'gpt-4o'],
    initial: [],
  };

  describe('non-admin user provisioning', () => {
    it('applyDefaultModelPermissions restricts a plain user with no existing permissions', () => {
      const userData = { email: 'invited@example.com', role: SystemRoles.USER };
      const result = applyDefaultModelPermissions(userData);

      expect(result.modelPermissions).toBeDefined();
      expect(result.modelPermissions.enabled).toBe(true);
      expect(result.modelPermissions.rules.length).toBeGreaterThan(0);
    });

    it('does not overwrite existing modelPermissions', () => {
      const existing = {
        enabled: true,
        rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
      };
      const userData = { email: 'user@example.com', modelPermissions: existing };
      const result = applyDefaultModelPermissions(userData);

      expect(result.modelPermissions).toBe(existing);
    });

    it('restricted user sees only the default allowed models after filtering', () => {
      const userData = applyDefaultModelPermissions({ email: 'user@example.com' });
      const filteredConfig = filterModelsConfigForUser(fullModelsConfig, {
        role: SystemRoles.USER,
        modelPermissions: userData.modelPermissions,
      });

      // Should have only the allowlisted OpenAI models (gpt-4o is not in the default allowlist)
      expect(filteredConfig[EModelEndpoint.openAI]).toEqual([
        'gpt-5.3-chat-latest',
        'gpt-5.4-mini',
        'gpt-5.4-nano',
      ]);
      // Should have only the allowlisted Anthropic models (claude-opus-4 is not in default allowlist)
      expect(filteredConfig[EModelEndpoint.anthropic]).toEqual(
        expect.arrayContaining(['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-3']),
      );
      expect(filteredConfig[EModelEndpoint.anthropic]).not.toContain('claude-opus-4');
      // Google has no default rule — all models should be filtered out
      expect(filteredConfig[EModelEndpoint.google]).toEqual([]);
      // Should have all Ollama models (wildcard)
      expect(filteredConfig[KnownEndpoints.ollama]).toEqual(
        fullModelsConfig[KnownEndpoints.ollama],
      );
      // xAI should only include the allowlisted model
      expect(filteredConfig[KnownEndpoints.xai]).toEqual(['grok-4-1-fast']);
      // Should have no LiteLLM models (not in default rules)
      expect(filteredConfig.LiteLLM).toEqual([]);
    });
  });

  describe('admin user provisioning', () => {
    it('does not apply restrictions to admin accounts', () => {
      const adminData = { email: 'admin@example.com', role: SystemRoles.ADMIN };
      const result = applyDefaultModelPermissions(adminData);

      // Admin users should not have modelPermissions set
      expect(result.modelPermissions).toBeUndefined();
    });

    it('getDefaultModelPermissionsForRole returns disabled restrictions for admin', () => {
      const adminPerms = getDefaultModelPermissionsForRole(SystemRoles.ADMIN);
      expect(adminPerms.enabled).toBe(false);
      expect(adminPerms.rules).toEqual([]);
    });

    it('admin user sees all models without filtering', () => {
      const filteredConfig = filterModelsConfigForUser(fullModelsConfig, {
        role: SystemRoles.ADMIN,
      });

      expect(filteredConfig).toEqual(fullModelsConfig);
    });

    it('admin user with explicit restrictions still sees all models (admin role bypasses)', () => {
      const filteredConfig = filterModelsConfigForUser(fullModelsConfig, {
        role: SystemRoles.ADMIN,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
        },
      });

      expect(filteredConfig).toEqual(fullModelsConfig);
    });
  });

  describe('hasModelRestrictions aligns with role', () => {
    it('restricted user has model restrictions', () => {
      const userData = applyDefaultModelPermissions({ email: 'user@example.com' });
      expect(
        hasModelRestrictions({
          role: SystemRoles.USER,
          modelPermissions: userData.modelPermissions,
        }),
      ).toBe(true);
    });

    it('admin never has model restrictions', () => {
      expect(hasModelRestrictions({ role: SystemRoles.ADMIN })).toBe(false);
    });

    it('user without modelPermissions has no restrictions', () => {
      expect(hasModelRestrictions({ role: SystemRoles.USER })).toBe(false);
    });

    it('user with restrictions disabled has no restrictions', () => {
      expect(
        hasModelRestrictions({
          role: SystemRoles.USER,
          modelPermissions: { enabled: false, rules: [] },
        }),
      ).toBe(false);
    });
  });
});
