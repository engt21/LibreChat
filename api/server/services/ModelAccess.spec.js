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
      expect(applyDefaultModelPermissions({ email: 'user@example.com' })).toEqual({
        email: 'user@example.com',
        modelPermissions: {
          enabled: true,
          rules: [
            { endpoint: 'google', models: ['gemini-2.5-flash-lite', 'gemini-3-flash-preview'] },
            { endpoint: 'ollama', models: ['*'] },
            { endpoint: 'openAI', models: ['gpt-5.1'] },
          ],
        },
      });
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
});
