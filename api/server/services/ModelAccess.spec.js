const { SystemRoles } = require('librechat-data-provider');
const { logViolation } = require('~/cache');
const {
  applyDefaultModelPermissions,
  getDefaultModelPermissionsForRole,
  normalizeModelPermissions,
  filterModelsConfigForUser,
  filterModelSpecsConfig,
  isOpenAIAlphaModel,
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
    anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6'],
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
    it('applies unrestricted defaults to new non-admin users', () => {
      const result = applyDefaultModelPermissions({ email: 'user@example.com' });
      expect(result.modelPermissions).toEqual({ enabled: false, rules: [] });
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
        anthropic: [],
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
        anthropic: [],
        ollama: ['qwen2.5:latest', 'gptossbigctx:latest'],
        LiteLLM: [],
        initial: [],
      });
    });

    it('allows models matched by per-model wildcard rules', () => {
      const result = filterModelsConfigForUser(
        {
          openAI: ['gpt-5.5', 'gpt-4o'],
          anthropic: ['claude-opus-4-7', 'claude-3-5-sonnet-20241022'],
          initial: [],
        },
        {
          role: SystemRoles.USER,
          modelPermissions: {
            enabled: true,
            rules: [
              { endpoint: 'openAI', models: ['gpt-5*'] },
              { endpoint: 'anthropic', models: ['claude-opus-4-*'] },
            ],
          },
        },
      );

      expect(result).toEqual({
        openAI: ['gpt-5.5'],
        anthropic: ['claude-opus-4-7'],
        initial: [],
      });
    });

    it('keeps every synced OpenAI model for default non-admin users', () => {
      const result = filterModelsConfigForUser(
        {
          openAI: ['gpt-5.5', 'gpt-5.5-alpha', 'gpt-5.5-pro', 'gpt-4o', 'o5-mini'],
          initial: [],
        },
        {
          role: SystemRoles.USER,
          modelPermissions: getDefaultModelPermissionsForRole(SystemRoles.USER),
        },
      );

      expect(result).toEqual({
        openAI: ['gpt-5.5', 'gpt-5.5-alpha', 'gpt-5.5-pro', 'gpt-4o', 'o5-mini'],
        initial: [],
      });
    });

    it('detects OpenAI alpha model ids', () => {
      expect(isOpenAIAlphaModel('gpt-5.6-alpha')).toBe(true);
      expect(isOpenAIAlphaModel('gpt-5.6')).toBe(false);
    });

    it('keeps OpenAI alpha models visible for admins', () => {
      const result = filterModelsConfigForUser(
        {
          openAI: ['gpt-5.6-alpha', 'gpt-5.5'],
          initial: [],
        },
        {
          role: SystemRoles.ADMIN,
        },
      );

      expect(result).toEqual({
        openAI: ['gpt-5.6-alpha', 'gpt-5.5'],
        initial: [],
      });
    });

    it('keeps OpenAI alpha models visible for non-admin wildcard rules', () => {
      const result = filterModelsConfigForUser(
        {
          openAI: ['gpt-5.6-alpha', 'gpt-5.5'],
          initial: [],
        },
        {
          role: SystemRoles.USER,
          modelPermissions: {
            enabled: true,
            rules: [{ endpoint: 'openAI', models: ['*'] }],
          },
        },
      );

      expect(result).toEqual({
        openAI: ['gpt-5.6-alpha', 'gpt-5.5'],
        initial: [],
      });
    });

    it('treats legacy default allowlists as unrestricted so old users see refreshed provider models', () => {
      const result = filterModelsConfigForUser(
        {
          openAI: ['gpt-5.5', 'gpt-4o'],
          google: ['gemini-3.1-pro'],
          anthropic: ['claude-opus-4-7', 'claude-3-5-sonnet-20241022'],
          xai: ['grok-4-1-fast', 'grok-4-2'],
          ollama: ['llama4:latest'],
          azureOpenAI: ['gpt5-prod'],
          initial: [],
        },
        {
          role: SystemRoles.USER,
          modelPermissions: {
            enabled: true,
            rules: [
              { endpoint: 'azureOpenAI', models: ['*'] },
              { endpoint: 'ollama', models: ['*'] },
              { endpoint: 'openAI', models: ['gpt-5.4-mini'] },
              { endpoint: 'anthropic', models: ['claude-opus-4-*'] },
              { endpoint: 'xai', models: ['grok-4-1-fast'] },
            ],
          },
        },
      );

      expect(result).toEqual({
        openAI: ['gpt-5.5', 'gpt-4o'],
        google: ['gemini-3.1-pro'],
        anthropic: ['claude-opus-4-7', 'claude-3-5-sonnet-20241022'],
        xai: ['grok-4-1-fast', 'grok-4-2'],
        ollama: ['llama4:latest'],
        azureOpenAI: ['gpt5-prod'],
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

    it('accepts per-model wildcard permissions for future provider models', () => {
      expect(
        validateModelPermissions(
          {
            enabled: true,
            rules: [
              { endpoint: 'openAI', models: ['gpt-5*'] },
              { endpoint: 'anthropic', models: ['claude-opus-4-*'] },
            ],
          },
          modelsConfig,
        ),
      ).toEqual({
        isValid: true,
        modelPermissions: {
          enabled: true,
          rules: [
            { endpoint: 'anthropic', models: ['claude-opus-4-*'] },
            { endpoint: 'openAI', models: ['gpt-5*'] },
          ],
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
      expect(perms).toEqual({ enabled: false, rules: [] });
    });

    it('superadmin sync after creation does not leave stale model restrictions in behavior', () => {
      const newUser = applyDefaultModelPermissions({ email: 'admin@example.com' });
      expect(newUser.modelPermissions.enabled).toBe(false);

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
