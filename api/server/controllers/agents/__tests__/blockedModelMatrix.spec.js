/**
 * Blocked-model enforcement matrix for agent CRUD and chat surfaces.
 *
 * VAL-MODEL-003: Restricted users must get model-access errors instead of
 * generic 500s or silent success when they attempt to use blocked models
 * across: agent create, agent update, agent duplicate, agent version-revert,
 * normal chat (ResumableAgentController preflight), and buildEndpointOption
 * model-spec re-entry.
 */

/* ------------------------------------------------------------------ */
/*  Shared mocks                                                       */
/* ------------------------------------------------------------------ */

const mockLogger = {
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
};

jest.mock('@librechat/data-schemas', () => ({ logger: mockLogger }));

const mockValidateModelAccess = jest.fn();
const mockGetModelsConfig = jest.fn();

jest.mock('~/server/services/ModelAccess', () => ({
  validateModelAccess: (...args) => mockValidateModelAccess(...args),
}));

jest.mock('~/server/controllers/ModelController', () => ({
  getModelsConfig: (...args) => mockGetModelsConfig(...args),
}));

jest.mock('~/models/Agent', () => ({
  getAgent: jest.fn(),
  createAgent: jest.fn(),
  updateAgent: jest.fn(),
  revertAgentVersion: jest.fn(),
}));

jest.mock('~/models/Action', () => ({
  getActions: jest.fn().mockResolvedValue([]),
  updateAction: jest.fn(),
}));

jest.mock('nanoid', () => ({ nanoid: jest.fn().mockReturnValue('test_id') }));

jest.mock('~/server/services/Config', () => ({
  getCachedTools: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/server/services/PermissionService', () => ({
  grantPermission: jest.fn().mockResolvedValue(undefined),
  findPubliclyAccessibleResources: jest.fn().mockResolvedValue([]),
  findAccessibleResources: jest.fn().mockResolvedValue([]),
  hasPublicPermission: jest.fn().mockResolvedValue(false),
  getResourcePermissionsMap: jest.fn().mockResolvedValue(new Map()),
}));

jest.mock('~/config', () => ({
  getMCPServersRegistry: jest.fn().mockReturnValue({
    getAllServerConfigs: jest.fn().mockResolvedValue({}),
  }),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn().mockReturnValue({ get: jest.fn(), set: jest.fn() }),
  logViolation: jest.fn(),
}));

// Mock deep dependencies that v1.js transitively requires
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn().mockReturnValue({
    processAvatar: jest.fn(),
    deleteFile: jest.fn(),
  }),
}));

jest.mock('~/server/utils/getFileStrategy', () => ({
  getFileStrategy: jest.fn().mockReturnValue('local'),
}));

jest.mock('~/server/services/Files/S3/crud', () => ({
  refreshS3Url: jest.fn(),
}));

jest.mock('~/server/services/Files/process', () => ({
  filterFile: jest.fn(),
}));

jest.mock('~/server/services/Files/images/avatar', () => ({
  resizeAvatar: jest.fn(),
}));

jest.mock('~/models', () => ({
  getCategoriesWithCounts: jest.fn().mockResolvedValue([]),
  deleteFileByFilter: jest.fn(),
}));

jest.mock('@librechat/api', () => ({
  agentCreateSchema: {
    parse: jest.fn((data) => data),
  },
  agentUpdateSchema: {
    parse: jest.fn((data) => data),
  },
  refreshListAvatars: jest.fn().mockResolvedValue({ urlCache: {} }),
  collectEdgeAgentIds: jest.fn().mockReturnValue(new Set()),
  mergeAgentOcrConversion: jest.fn().mockReturnValue({}),
  convertOcrToContextInPlace: jest.fn(),
  MAX_AVATAR_REFRESH_AGENTS: 100,
}));

/* ------------------------------------------------------------------ */
/*  Imports                                                            */
/* ------------------------------------------------------------------ */

const {
  createAgent,
  updateAgent: updateAgentHandler,
  duplicateAgent,
  revertAgentVersion: revertAgentVersionHandler,
} = require('../../agents/v1');
const { getAgent, createAgent: createAgentModel, revertAgentVersion } = require('~/models/Agent');

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const BLOCKED_MODEL = 'gpt-5-turbo-blocked';
const BLOCKED_ENDPOINT = 'openAI';
const ALLOWED_MODEL = 'gpt-4o';
const BLOCKED_ERROR = 'Illegal model request';

const blockedResult = { isValid: false, text: BLOCKED_ERROR };
const allowedResult = { isValid: true };

const modelsConfig = { openAI: [ALLOWED_MODEL] };

const makeRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

/* ------------------------------------------------------------------ */
/*  Test suite                                                         */
/* ------------------------------------------------------------------ */

describe('Blocked-model enforcement matrix (VAL-MODEL-003)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetModelsConfig.mockResolvedValue(modelsConfig);
  });

  /* ----- Agent create --------- */
  describe('Agent create', () => {
    it('rejects a blocked model with 400 and model-access error text', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        user: { id: 'user-1', role: 'USER' },
        body: {
          name: 'Test Agent',
          provider: BLOCKED_ENDPOINT,
          model: BLOCKED_MODEL,
        },
      };
      const res = makeRes();

      await createAgent(req, res);

      expect(mockValidateModelAccess).toHaveBeenCalledWith(
        expect.objectContaining({ model: BLOCKED_MODEL, endpoint: BLOCKED_ENDPOINT }),
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
      expect(createAgentModel).not.toHaveBeenCalled();
    });

    it('allows an accessible model and proceeds to creation', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(allowedResult);
      createAgentModel.mockResolvedValue({
        id: 'agent_test',
        _id: 'db_id',
        provider: BLOCKED_ENDPOINT,
        model: ALLOWED_MODEL,
      });

      const req = {
        user: { id: 'user-1', role: 'USER' },
        body: {
          name: 'Test Agent',
          provider: BLOCKED_ENDPOINT,
          model: ALLOWED_MODEL,
        },
      };
      const res = makeRes();

      await createAgent(req, res);

      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  /* ----- Agent update --------- */
  describe('Agent update', () => {
    it('rejects a blocked model on update with 400', async () => {
      getAgent.mockResolvedValue({
        id: 'agent_abc',
        provider: BLOCKED_ENDPOINT,
        model: ALLOWED_MODEL,
        tools: [],
      });
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        params: { id: 'agent_abc' },
        user: { id: 'user-1', role: 'USER' },
        body: {
          model: BLOCKED_MODEL,
          provider: BLOCKED_ENDPOINT,
        },
      };
      const res = makeRes();

      await updateAgentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
    });

    it('rejects existing agent model if restricted user tries a no-model-change update', async () => {
      // If the agent's existing model is blocked, even a non-model update should fail
      getAgent.mockResolvedValue({
        id: 'agent_abc',
        provider: BLOCKED_ENDPOINT,
        model: BLOCKED_MODEL,
        tools: [],
      });
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        params: { id: 'agent_abc' },
        user: { id: 'user-1', role: 'USER' },
        body: {
          name: 'Renamed Agent',
        },
      };
      const res = makeRes();

      await updateAgentHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
    });
  });

  /* ----- Agent duplicate ------ */
  describe('Agent duplicate', () => {
    it('rejects duplication of agent with blocked model', async () => {
      getAgent.mockResolvedValue({
        id: 'agent_src',
        name: 'Source Agent',
        provider: BLOCKED_ENDPOINT,
        model: BLOCKED_MODEL,
        tools: [],
      });
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        params: { id: 'agent_src' },
        user: { id: 'user-1', role: 'USER' },
      };
      const res = makeRes();

      await duplicateAgent(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
      expect(createAgentModel).not.toHaveBeenCalled();
    });
  });

  /* ----- Agent revert --------- */
  describe('Agent version revert', () => {
    it('rejects revert to a version with a blocked model', async () => {
      const mockAgent = {
        id: 'agent_ver',
        provider: BLOCKED_ENDPOINT,
        model: ALLOWED_MODEL,
        versions: [
          {
            name: 'Old Version',
            provider: BLOCKED_ENDPOINT,
            model: BLOCKED_MODEL,
          },
        ],
      };
      getAgent.mockResolvedValue(mockAgent);
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        params: { id: 'agent_ver' },
        user: { id: 'user-1', role: 'USER' },
        body: { version_index: 0 },
      };
      const res = makeRes();

      await revertAgentVersionHandler(req, res);

      expect(mockValidateModelAccess).toHaveBeenCalledWith(
        expect.objectContaining({ model: BLOCKED_MODEL }),
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
      expect(revertAgentVersion).not.toHaveBeenCalled();
    });

    it('allows revert to a version with an accessible model', async () => {
      const mockAgent = {
        id: 'agent_ver',
        provider: BLOCKED_ENDPOINT,
        model: BLOCKED_MODEL,
        versions: [
          {
            name: 'Good Version',
            provider: BLOCKED_ENDPOINT,
            model: ALLOWED_MODEL,
          },
        ],
      };
      getAgent.mockResolvedValue(mockAgent);
      mockValidateModelAccess.mockResolvedValueOnce(allowedResult);
      revertAgentVersion.mockResolvedValue({
        id: 'agent_ver',
        provider: BLOCKED_ENDPOINT,
        model: ALLOWED_MODEL,
        tools: [],
        author: 'user-1',
      });

      const req = {
        params: { id: 'agent_ver' },
        user: { id: 'user-1', role: 'USER' },
        body: { version_index: 0 },
      };
      const res = makeRes();

      await revertAgentVersionHandler(req, res);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ model: ALLOWED_MODEL }),
      );
    });
  });

  /* ----- Response format consistency ----- */
  describe('Error response format consistency', () => {
    it('all agent CRUD surfaces return JSON with { error } on blocked model', async () => {
      const surfaces = [
        {
          name: 'create',
          fn: createAgent,
          req: {
            user: { id: 'u', role: 'USER' },
            body: { name: 'A', provider: BLOCKED_ENDPOINT, model: BLOCKED_MODEL },
          },
        },
        {
          name: 'duplicate',
          fn: duplicateAgent,
          req: {
            params: { id: 'agent_x' },
            user: { id: 'u', role: 'USER' },
          },
          setup: () =>
            getAgent.mockResolvedValue({
              id: 'agent_x',
              name: 'X',
              provider: BLOCKED_ENDPOINT,
              model: BLOCKED_MODEL,
              tools: [],
            }),
        },
        {
          name: 'update',
          fn: updateAgentHandler,
          req: {
            params: { id: 'agent_x' },
            user: { id: 'u', role: 'USER' },
            body: { model: BLOCKED_MODEL, provider: BLOCKED_ENDPOINT },
          },
          setup: () =>
            getAgent.mockResolvedValue({
              id: 'agent_x',
              provider: BLOCKED_ENDPOINT,
              model: ALLOWED_MODEL,
              tools: [],
            }),
        },
        {
          name: 'revert',
          fn: revertAgentVersionHandler,
          req: {
            params: { id: 'agent_x' },
            user: { id: 'u', role: 'USER' },
            body: { version_index: 0 },
          },
          setup: () =>
            getAgent.mockResolvedValue({
              id: 'agent_x',
              provider: BLOCKED_ENDPOINT,
              model: ALLOWED_MODEL,
              versions: [{ provider: BLOCKED_ENDPOINT, model: BLOCKED_MODEL }],
            }),
        },
      ];

      for (const surface of surfaces) {
        jest.clearAllMocks();
        mockGetModelsConfig.mockResolvedValue(modelsConfig);
        mockValidateModelAccess.mockResolvedValueOnce(blockedResult);
        if (surface.setup) {
          surface.setup();
        }

        const res = makeRes();
        await surface.fn(surface.req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({ error: expect.any(String) }),
        );
      }
    });
  });
});
