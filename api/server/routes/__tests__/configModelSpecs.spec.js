/**
 * Tests the /api/config route's modelSpecs filtering for restricted users (VAL-MODEL-003).
 *
 * Proves:
 * 1. Restricted users receive filtered modelSpecs (specs with blocked models removed)
 * 2. Admins receive unfiltered modelSpecs
 * 3. Anonymous (unauthenticated) users receive unfiltered modelSpecs
 * 4. When no modelSpecs are configured, the field is absent for all users
 * 5. Both cached and uncached paths apply filtering
 */

const { SystemRoles, CacheKeys } = require('librechat-data-provider');

/* ---------- Mock stores ---------- */
const mockCacheMap = new Map();
const mockLogStore = {
  get: jest.fn((key) => Promise.resolve(mockCacheMap.get(key) ?? null)),
  set: jest.fn((key, val) => {
    mockCacheMap.set(key, val);
    return Promise.resolve(true);
  }),
  delete: jest.fn((key) => {
    mockCacheMap.delete(key);
    return Promise.resolve(true);
  }),
};
jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => mockLogStore),
}));

/* ---------- Mock optionalJwtAuth ---------- */
let mockReqUser = null;
jest.mock('~/server/middleware/optionalJwtAuth', () => (req, _res, next) => {
  if (mockReqUser) {
    req.user = mockReqUser;
  }
  next();
});

/* ---------- Mock ModelController ---------- */
let mockModelsConfig = {};
jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: jest.fn(() => Promise.resolve(mockModelsConfig)),
}));

/* ---------- Mock getAppConfig ---------- */
let mockAppConfig = {};
jest.mock('~/server/services/Config/app', () => ({
  getAppConfig: jest.fn(() => Promise.resolve(mockAppConfig)),
}));

/* ---------- Mock getEffectiveAppSettings ---------- */
jest.mock('~/server/services/Admin/appSettings', () => ({
  getEffectiveAppSettings: jest.fn(() =>
    Promise.resolve({ registrationEnabled: true }),
  ),
}));

/* ---------- Mock getProjectByName ---------- */
jest.mock('~/models/Project', () => ({
  getProjectByName: jest.fn(() =>
    Promise.resolve({ _id: { toString: () => 'mock-project-id' } }),
  ),
}));

/* ---------- Mock getLdapConfig ---------- */
jest.mock('~/server/services/Config/ldap', () => ({
  getLdapConfig: jest.fn(() => null),
}));

/* ---------- Mock @librechat/data-schemas logger ---------- */
jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

/* ---------- Mock @librechat/api ---------- */
jest.mock('@librechat/api', () => ({
  isEnabled: jest.fn((v) => v === 'true' || v === true),
  getBalanceConfig: jest.fn(() => undefined),
  getGoogleModelCapabilities: jest.fn(() => Promise.resolve(undefined)),
  getXAIModelCapabilities: jest.fn(() => Promise.resolve(undefined)),
}));

const request = require('supertest');
const express = require('express');
const configRoute = require('../config');

const app = express();
app.disable('x-powered-by');
app.use('/api/config', configRoute);

/* ---------- Fixtures ---------- */
const fullModelSpecs = {
  enforce: false,
  list: [
    {
      name: 'GPT-4o Spec',
      label: 'GPT-4o',
      preset: { endpoint: 'openAI', model: 'gpt-4o' },
    },
    {
      name: 'GPT-5 Spec',
      label: 'GPT-5',
      preset: { endpoint: 'openAI', model: 'gpt-5' },
    },
    {
      name: 'Gemini Spec',
      label: 'Gemini',
      preset: { endpoint: 'google', model: 'gemini-pro' },
    },
    {
      name: 'Claude Spec',
      label: 'Claude',
      preset: { endpoint: 'anthropic', model: 'claude-sonnet-4-5' },
    },
  ],
};

/* ---------- Helpers ---------- */
function clearCaches() {
  mockCacheMap.clear();
  mockLogStore.get.mockClear();
  mockLogStore.set.mockClear();
}

/* ---------- Tests ---------- */
describe('/api/config modelSpecs filtering (VAL-MODEL-003)', () => {
  afterEach(() => {
    clearCaches();
    mockReqUser = null;
    mockModelsConfig = {};
    mockAppConfig = {};
  });

  describe('when modelSpecs are configured', () => {
    beforeEach(() => {
      mockAppConfig = { modelSpecs: fullModelSpecs };
    });

    it('restricted users receive only the model specs matching their allowed models', async () => {
      // Restricted user can only see gpt-4o on openAI and nothing on google/anthropic
      mockReqUser = {
        id: 'user-restricted',
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
        },
      };
      // getModelsConfig returns the already-filtered models for this user
      mockModelsConfig = {
        openAI: ['gpt-4o'],
        google: [],
        anthropic: [],
      };

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.modelSpecs).toBeDefined();
      expect(res.body.modelSpecs.list).toBeDefined();
      expect(res.body.modelSpecs.enforce).toBe(false);

      // Only the gpt-4o spec should survive filtering
      const specNames = res.body.modelSpecs.list.map((s) => s.name);
      expect(specNames).toContain('GPT-4o Spec');
      expect(specNames).not.toContain('GPT-5 Spec');
      expect(specNames).not.toContain('Gemini Spec');
      expect(specNames).not.toContain('Claude Spec');
      expect(res.body.modelSpecs.list).toHaveLength(1);
    });

    it('restricted users with multiple allowed endpoints see matching specs from each', async () => {
      mockReqUser = {
        id: 'user-multi',
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [
            { endpoint: 'openAI', models: ['gpt-4o'] },
            { endpoint: 'anthropic', models: ['claude-sonnet-4-5'] },
          ],
        },
      };
      mockModelsConfig = {
        openAI: ['gpt-4o'],
        google: [],
        anthropic: ['claude-sonnet-4-5'],
      };

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      const specNames = res.body.modelSpecs.list.map((s) => s.name);
      expect(specNames).toContain('GPT-4o Spec');
      expect(specNames).toContain('Claude Spec');
      expect(specNames).not.toContain('GPT-5 Spec');
      expect(specNames).not.toContain('Gemini Spec');
      expect(res.body.modelSpecs.list).toHaveLength(2);
    });

    it('admin users receive the full unfiltered modelSpecs', async () => {
      mockReqUser = {
        id: 'user-admin',
        role: SystemRoles.ADMIN,
      };
      // getModelsConfig returns ALL models for admins
      mockModelsConfig = {
        openAI: ['gpt-4o', 'gpt-5'],
        google: ['gemini-pro'],
        anthropic: ['claude-sonnet-4-5'],
      };

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.modelSpecs).toBeDefined();
      expect(res.body.modelSpecs.list).toHaveLength(4);
    });

    it('anonymous (unauthenticated) users receive unfiltered modelSpecs', async () => {
      mockReqUser = null; // no user

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      // filterStartupConfigForUser short-circuits when !req.user
      expect(res.body.modelSpecs).toBeDefined();
      expect(res.body.modelSpecs.list).toHaveLength(4);
    });

    it('cached config path also filters modelSpecs for restricted users', async () => {
      // Pre-populate the startup config cache with modelSpecs
      const cachedPayload = {
        appTitle: 'Test',
        modelSpecs: fullModelSpecs,
        serverDomain: 'http://localhost:3080',
      };
      mockCacheMap.set(CacheKeys.STARTUP_CONFIG, cachedPayload);

      mockReqUser = {
        id: 'user-cached',
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'google', models: ['gemini-pro'] }],
        },
      };
      mockModelsConfig = {
        openAI: [],
        google: ['gemini-pro'],
        anthropic: [],
      };

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.modelSpecs).toBeDefined();
      expect(res.body.modelSpecs.list).toHaveLength(1);
      expect(res.body.modelSpecs.list[0].name).toBe('Gemini Spec');
    });

    it('restricted user with no matching endpoints receives empty modelSpecs list', async () => {
      mockReqUser = {
        id: 'user-no-match',
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'ollama', models: ['*'] }],
        },
      };
      // No openAI/google/anthropic available
      mockModelsConfig = {
        ollama: ['qwen2.5:latest'],
        openAI: [],
        google: [],
        anthropic: [],
      };

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.modelSpecs).toBeDefined();
      expect(res.body.modelSpecs.list).toEqual([]);
    });
  });

  describe('when no modelSpecs are configured', () => {
    beforeEach(() => {
      mockAppConfig = {}; // no modelSpecs
    });

    it('response does not contain modelSpecs for any user', async () => {
      mockReqUser = {
        id: 'user-any',
        role: SystemRoles.USER,
      };

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      // modelSpecs should be absent (undefined serializes to absent in JSON)
      expect(res.body.modelSpecs).toBeUndefined();
    });
  });

  describe('filtering does not reintroduce failures (VAL-MODEL-003 regression guard)', () => {
    it('does not 500 when getModelsConfig returns partial endpoint data', async () => {
      mockAppConfig = { modelSpecs: fullModelSpecs };
      mockReqUser = {
        id: 'user-partial',
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
        },
      };
      // getModelsConfig returns only openAI, no google or anthropic keys at all
      mockModelsConfig = { openAI: ['gpt-4o'] };

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.modelSpecs).toBeDefined();
      // Specs for missing endpoints are kept (filterModelSpecsConfig keeps specs
      // whose endpoint is not an array - treats unknown endpoints as passthrough)
      const specNames = res.body.modelSpecs.list.map((s) => s.name);
      expect(specNames).toContain('GPT-4o Spec');
      // GPT-5 is not in the allowed openAI list
      expect(specNames).not.toContain('GPT-5 Spec');
    });

    it('does not 500 when getModelsConfig returns empty object', async () => {
      mockAppConfig = { modelSpecs: fullModelSpecs };
      mockReqUser = {
        id: 'user-empty-models',
        role: SystemRoles.USER,
        modelPermissions: {
          enabled: true,
          rules: [],
        },
      };
      mockModelsConfig = {};

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      // All specs are kept because no endpoint arrays exist to filter against
      expect(res.body.modelSpecs).toBeDefined();
    });
  });
});
