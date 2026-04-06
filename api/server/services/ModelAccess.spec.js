const { SystemRoles } = require('librechat-data-provider');
const { logViolation } = require('~/cache');
const {
  applyDefaultModelPermissions,
  getDefaultModelPermissionsForRole,
  normalizeModelPermissions,
  filterModelsConfigForUser,
  filterModelSpecsConfig,
  validateModelPermissions,
  validateModelAccess,
} = require('./ModelAccess');

jest.mock('~/cache', () => ({
  logViolation: jest.fn(),
}));

describe('ModelAccess', () => {
  const modelsConfig = {
    openAI: ['gpt-4o', 'gpt-5'],
    google: ['gemini-3-flash-preview', 'gemini-2.5-flash-lite'],
    ollama: ['qwen2.5:latest', 'gptossbigctx:latest'],
    LiteLLM: ['gemini-2.5-pro', 'gpt-4o'],
    initial: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('normalizeModelPermissions', () => {
    it('deduplicates and sorts model rules', () => {
      const normalized = normalizeModelPermissions({
        enabled: true,
        rules: [
          { endpoint: 'openAI', models: ['gpt-5', 'gpt-4o', 'gpt-5'] },
          { endpoint: 'openAI', models: ['gpt-4o'] },
          { endpoint: 'LiteLLM', models: ['gpt-4o'] },
        ],
      });

      expect(normalized).toEqual({
        enabled: true,
        rules: [
          { endpoint: 'LiteLLM', models: ['gpt-4o'] },
          { endpoint: 'openAI', models: ['gpt-4o', 'gpt-5'] },
        ],
      });
    });

    it('preserves wildcard endpoint access', () => {
      const normalized = normalizeModelPermissions({
        enabled: true,
        rules: [{ endpoint: 'ollama', models: ['gptossbigctx:latest', '*'] }],
      });

      expect(normalized).toEqual({
        enabled: true,
        rules: [{ endpoint: 'ollama', models: ['*'] }],
      });
    });
  });

  describe('default model permissions', () => {
    it('applies restricted defaults to new non-admin users', () => {
      const result = applyDefaultModelPermissions({ email: 'user@example.com' });
      expect(result.modelPermissions.enabled).toBe(true);
      const endpoints = result.modelPermissions.rules.map((r) => r.endpoint).sort();
      expect(endpoints).toEqual(['anthropic', 'azureOpenAI', 'ollama', 'openAI', 'xai']);
      expect(result.modelPermissions.rules.find((r) => r.endpoint === 'ollama').models).toEqual([
        '*',
      ]);
      expect(
        result.modelPermissions.rules.find((r) => r.endpoint === 'azureOpenAI').models,
      ).toEqual(['*']);
      expect(result.modelPermissions.rules.find((r) => r.endpoint === 'xai').models).toEqual([
        'grok-4-1-fast',
      ]);
      expect(result.modelPermissions.rules.find((r) => r.endpoint === 'openAI').models).toEqual(
        expect.arrayContaining(['gpt-5.4-mini', 'gpt-5.4-nano']),
      );
      expect(result.modelPermissions.rules.find((r) => r.endpoint === 'anthropic').models).toEqual(
        expect.arrayContaining(['claude-sonnet-4-5', 'claude-sonnet-4-6']),
      );
    });

    it('keeps admins unrestricted by default', () => {
      expect(getDefaultModelPermissionsForRole(SystemRoles.ADMIN)).toEqual({
        enabled: false,
        rules: [],
      });
    });
  });

  describe('filterModelsConfigForUser', () => {
    it('returns all models for unrestricted users', () => {
      const result = filterModelsConfigForUser(modelsConfig, {
        role: SystemRoles.USER,
        modelPermissions: { enabled: false, rules: [] },
      });

      expect(result).toEqual(modelsConfig);
    });

    it('returns all models for superadmins even when rules exist', () => {
      const result = filterModelsConfigForUser(modelsConfig, {
        role: SystemRoles.ADMIN,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
        },
      });

      expect(result).toEqual(modelsConfig);
    });

    it('filters models by endpoint for restricted users', () => {
      const result = filterModelsConfigForUser(modelsConfig, {
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [
            { endpoint: 'openAI', models: ['gpt-4o'] },
            { endpoint: 'LiteLLM', models: ['gemini-2.5-pro'] },
          ],
        },
      });

      expect(result).toEqual({
        openAI: ['gpt-4o'],
        google: [],
        ollama: [],
        LiteLLM: ['gemini-2.5-pro'],
        initial: [],
      });
    });

    it('allows all models for wildcard endpoint rules', () => {
      const result = filterModelsConfigForUser(modelsConfig, {
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'ollama', models: ['*'] }],
        },
      });

      expect(result).toEqual({
        openAI: [],
        google: [],
        ollama: ['qwen2.5:latest', 'gptossbigctx:latest'],
        LiteLLM: [],
        initial: [],
      });
    });
  });

  describe('filterModelSpecsConfig', () => {
    it('removes specs whose models are no longer accessible', () => {
      const result = filterModelSpecsConfig(
        {
          enforce: false,
          list: [
            {
              name: 'Allowed spec',
              label: 'Allowed spec',
              preset: { endpoint: 'openAI', model: 'gpt-4o' },
            },
            {
              name: 'Blocked spec',
              label: 'Blocked spec',
              preset: { endpoint: 'openAI', model: 'gpt-5' },
            },
          ],
        },
        {
          openAI: ['gpt-4o'],
        },
      );

      expect(result.list).toHaveLength(1);
      expect(result.list[0].name).toBe('Allowed spec');
    });
  });

  describe('validateModelPermissions', () => {
    it('rejects unknown endpoints or models', () => {
      expect(
        validateModelPermissions(
          {
            enabled: true,
            rules: [{ endpoint: 'missing', models: ['gpt-4o'] }],
          },
          modelsConfig,
        ),
      ).toEqual({
        isValid: false,
        message: 'Invalid endpoint in model permissions: missing',
      });

      expect(
        validateModelPermissions(
          {
            enabled: true,
            rules: [{ endpoint: 'openAI', models: ['missing-model'] }],
          },
          modelsConfig,
        ),
      ).toEqual({
        isValid: false,
        message: 'Invalid model permissions for endpoint openAI',
      });
    });

    it('accepts wildcard endpoint access', () => {
      expect(
        validateModelPermissions(
          {
            enabled: true,
            rules: [{ endpoint: 'ollama', models: ['*'] }],
          },
          modelsConfig,
        ),
      ).toEqual({
        isValid: true,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'ollama', models: ['*'] }],
        },
      });
    });
  });

  describe('validateModelAccess', () => {
    it('logs violations for inaccessible models', async () => {
      const result = await validateModelAccess({
        req: { user: { id: 'user-1' } },
        res: {},
        endpoint: 'openAI',
        model: 'gpt-5',
        modelsConfig: { openAI: ['gpt-4o'] },
      });

      expect(result).toEqual({
        isValid: false,
        text: 'Illegal model request',
      });
      expect(logViolation).toHaveBeenCalledTimes(1);
    });
  });

  describe('first-session default-model alignment (VAL-MODEL-001, VAL-CROSS-001)', () => {
    it('all auth paths apply the same default allowlist for new non-admin users', () => {
      // Simulates the user data shapes from different auth strategies
      // before they call applyDefaultModelPermissions:
      const localRegistration = { email: 'local@example.com', role: SystemRoles.USER };
      const openidNewUser = { email: 'openid@example.com', provider: 'openid' };
      const ldapNewUser = { email: 'ldap@example.com', provider: 'ldap', role: SystemRoles.USER };
      const samlNewUser = { email: 'saml@example.com', provider: 'saml' };
      const socialNewUser = { email: 'social@example.com', provider: 'google' };
      const invitedUser = { email: 'invited@example.com', role: SystemRoles.USER };

      const results = [
        applyDefaultModelPermissions(localRegistration),
        applyDefaultModelPermissions(openidNewUser),
        applyDefaultModelPermissions(ldapNewUser),
        applyDefaultModelPermissions(samlNewUser),
        applyDefaultModelPermissions(socialNewUser),
        applyDefaultModelPermissions(invitedUser),
      ];

      // All should receive the same normalized default allowlist
      const expectedPerms = getDefaultModelPermissionsForRole(SystemRoles.USER);
      for (const result of results) {
        expect(result.modelPermissions).toEqual(expectedPerms);
      }
    });

    it('getDefaultModelPermissionsForRole(USER) includes the documented endpoints', () => {
      const perms = getDefaultModelPermissionsForRole(SystemRoles.USER);
      expect(perms.enabled).toBe(true);

      const endpointMap = new Map(perms.rules.map((r) => [r.endpoint, r.models]));

      // Documented in CUSTOMIZATION_MASTER_DOC.md and README.md
      expect(endpointMap.has('azureOpenAI')).toBe(true);
      expect(endpointMap.get('azureOpenAI')).toEqual(['*']);

      expect(endpointMap.has('ollama')).toBe(true);
      expect(endpointMap.get('ollama')).toEqual(['*']);

      expect(endpointMap.has('openAI')).toBe(true);
      expect(endpointMap.get('openAI')).toEqual(
        expect.arrayContaining(['gpt-5.3-chat-latest', 'gpt-5.4-mini', 'gpt-5.4-nano']),
      );

      expect(endpointMap.has('anthropic')).toBe(true);
      expect(endpointMap.get('anthropic')).toEqual(
        expect.arrayContaining(['claude-sonnet-4-5', 'claude-sonnet-4-6', 'claude-haiku-4-5']),
      );
      // No opus
      expect(endpointMap.get('anthropic')).not.toEqual(expect.arrayContaining(['claude-opus-4']));

      expect(endpointMap.has('xai')).toBe(true);
      expect(endpointMap.get('xai')).toEqual(['grok-4-1-fast']);
    });

    it('superadmin sync after creation does not leave stale model restrictions in behavior', () => {
      // When a superadmin is created through OpenID/LDAP without a role field,
      // applyDefaultModelPermissions sets restricted defaults. After syncUserSuperAdminStatus
      // promotes the role to ADMIN, hasModelRestrictions must still return false.
      const newUser = applyDefaultModelPermissions({ email: 'admin@example.com' });
      expect(newUser.modelPermissions.enabled).toBe(true);

      // Simulate promotion
      newUser.role = SystemRoles.ADMIN;

      // Behavior gate: admin role bypasses restriction checks
      expect(
        filterModelsConfigForUser(modelsConfig, {
          role: newUser.role,
          modelPermissions: newUser.modelPermissions,
        }),
      ).toEqual(modelsConfig);
    });
  });
});
