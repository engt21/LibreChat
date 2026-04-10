/**
 * Blocked-model enforcement matrix for assistant CRUD surfaces.
 *
 * VAL-MODEL-003: Restricted users attempting to create or update assistants
 * with blocked models must receive model-access errors (400) before any
 * provider-side effects (client init, credential resolution) occur.
 *
 * Covers:
 *  - Assistant v1 create (POST /assistants) — model check before getOpenAIClient
 *  - Assistant v1 patch  (PATCH /assistants/:id) — model check before getOpenAIClient
 *  - Assistant v2 create (POST /assistants) — model check before getOpenAIClient
 *  - Assistant v2 patch  (PATCH /assistants/:id) — model check before getOpenAIClient
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

// Mock OpenAI client helper — should NOT be called when model is blocked
const mockGetOpenAIClient = jest.fn();
jest.mock('../../assistants/helpers', () => ({
  getOpenAIClient: (...args) => mockGetOpenAIClient(...args),
  fetchAssistants: jest.fn(),
}));

jest.mock('~/server/middleware/assistants/validateAuthor', () =>
  jest.fn().mockResolvedValue(undefined),
);

jest.mock('~/server/services/ActionService', () => ({
  validateAndUpdateTool: jest.fn(),
  deleteAssistantActions: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  getCachedTools: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/models/Assistant', () => ({
  updateAssistantDoc: jest.fn().mockResolvedValue({}),
  getAssistants: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/app/clients/tools', () => ({
  manifestToolMap: {},
}));

// Mock deep dependencies that assistant v1.js transitively requires
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn().mockReturnValue({
    processAvatar: jest.fn(),
    deleteFile: jest.fn(),
  }),
}));

jest.mock('~/server/services/Files/process', () => ({
  uploadImageBuffer: jest.fn(),
  filterFile: jest.fn(),
}));

jest.mock('~/models', () => ({
  deleteFileByFilter: jest.fn(),
}));

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
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
/*  Assistant v1 tests                                                 */
/* ------------------------------------------------------------------ */

describe('Assistant v1 blocked-model enforcement (VAL-MODEL-003)', () => {
  const v1 = require('../../assistants/v1');

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetModelsConfig.mockResolvedValue(modelsConfig);
  });

  describe('createAssistant', () => {
    it('rejects blocked model with 400 before calling getOpenAIClient', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          model: BLOCKED_MODEL,
          name: 'Test Assistant',
          instructions: 'Help me',
        },
      };
      const res = makeRes();

      await v1.createAssistant(req, res);

      expect(mockValidateModelAccess).toHaveBeenCalledWith(
        expect.objectContaining({ model: BLOCKED_MODEL, endpoint: BLOCKED_ENDPOINT }),
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
      // Critical: OpenAI client must NOT be initialized for a blocked model
      expect(mockGetOpenAIClient).not.toHaveBeenCalled();
    });

    it('allows accessible model and proceeds to OpenAI client init', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(allowedResult);
      const mockOpenAI = {
        beta: {
          assistants: {
            create: jest.fn().mockResolvedValue({ id: 'asst_test', model: ALLOWED_MODEL }),
          },
        },
        locals: {},
      };
      mockGetOpenAIClient.mockResolvedValue({ openai: mockOpenAI });

      const req = {
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          model: ALLOWED_MODEL,
          name: 'Test Assistant',
          instructions: 'Help me',
        },
      };
      const res = makeRes();

      await v1.createAssistant(req, res);

      expect(mockGetOpenAIClient).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('patchAssistant', () => {
    it('rejects blocked model update with 400 before calling getOpenAIClient', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        params: { id: 'asst_123' },
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          model: BLOCKED_MODEL,
          tools: [],
        },
      };
      const res = makeRes();

      await v1.patchAssistant(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
      expect(mockGetOpenAIClient).not.toHaveBeenCalled();
    });

    it('skips model validation when model is not being changed', async () => {
      const mockOpenAI = {
        beta: {
          assistants: {
            update: jest.fn().mockResolvedValue({ id: 'asst_123' }),
            retrieve: jest.fn().mockResolvedValue({ metadata: { author: 'user-1' } }),
          },
        },
        locals: {},
      };
      mockGetOpenAIClient.mockResolvedValue({ openai: mockOpenAI });

      const req = {
        params: { id: 'asst_123' },
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          name: 'Updated name',
          tools: [],
        },
      };
      const res = makeRes();

      await v1.patchAssistant(req, res);

      // Model validation should NOT be called when model field is absent
      expect(mockValidateModelAccess).not.toHaveBeenCalled();
      expect(mockGetOpenAIClient).toHaveBeenCalled();
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Assistant v2 tests                                                 */
/* ------------------------------------------------------------------ */

describe('Assistant v2 blocked-model enforcement (VAL-MODEL-003)', () => {
  const v2 = require('../../assistants/v2');

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetModelsConfig.mockResolvedValue(modelsConfig);
  });

  describe('createAssistant', () => {
    it('rejects blocked model with 400 before calling getOpenAIClient', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          model: BLOCKED_MODEL,
          name: 'Test Assistant v2',
          instructions: 'Help me',
        },
      };
      const res = makeRes();

      await v2.createAssistant(req, res);

      expect(mockValidateModelAccess).toHaveBeenCalledWith(
        expect.objectContaining({ model: BLOCKED_MODEL, endpoint: BLOCKED_ENDPOINT }),
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
      expect(mockGetOpenAIClient).not.toHaveBeenCalled();
    });

    it('allows accessible model and proceeds to creation', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(allowedResult);
      const mockOpenAI = {
        beta: {
          assistants: {
            create: jest.fn().mockResolvedValue({ id: 'asst_v2', model: ALLOWED_MODEL }),
          },
        },
        locals: {},
      };
      mockGetOpenAIClient.mockResolvedValue({ openai: mockOpenAI });

      const req = {
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          model: ALLOWED_MODEL,
          name: 'Test Assistant v2',
          instructions: 'Help me',
        },
      };
      const res = makeRes();

      await v2.createAssistant(req, res);

      expect(mockGetOpenAIClient).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });

  describe('patchAssistant', () => {
    it('rejects blocked model update with 400 before calling getOpenAIClient', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const req = {
        params: { id: 'asst_v2_123' },
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          model: BLOCKED_MODEL,
          tools: [],
        },
      };
      const res = makeRes();

      await v2.patchAssistant(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ error: BLOCKED_ERROR });
      expect(mockGetOpenAIClient).not.toHaveBeenCalled();
    });

    it('skips model validation when model field is absent in update', async () => {
      const mockOpenAI = {
        beta: {
          assistants: {
            update: jest.fn().mockResolvedValue({ id: 'asst_v2_123' }),
            retrieve: jest.fn().mockResolvedValue({ metadata: { author: 'user-1' } }),
          },
        },
        locals: {},
      };
      mockGetOpenAIClient.mockResolvedValue({ openai: mockOpenAI });

      const req = {
        params: { id: 'asst_v2_123' },
        user: { id: 'user-1' },
        body: {
          endpoint: BLOCKED_ENDPOINT,
          name: 'Renamed',
          tools: [],
        },
      };
      const res = makeRes();

      await v2.patchAssistant(req, res);

      expect(mockValidateModelAccess).not.toHaveBeenCalled();
      expect(mockGetOpenAIClient).toHaveBeenCalled();
    });
  });

  describe('updateAssistant (inner function, used by addResourceFileId/deleteResourceFileId)', () => {
    it('rejects blocked model via inner updateAssistant with statusCode 400', async () => {
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);

      const mockOpenAI = {
        beta: {
          assistants: {
            retrieve: jest.fn().mockResolvedValue({ metadata: { author: 'user-1' } }),
          },
        },
        locals: {},
      };

      try {
        await v2.updateAssistant({
          req: {
            user: { id: 'user-1' },
            body: { endpoint: BLOCKED_ENDPOINT },
          },
          res: makeRes(),
          openai: mockOpenAI,
          assistant_id: 'asst_inner',
          updateData: {
            model: BLOCKED_MODEL,
            tools: [],
          },
        });
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toBe(BLOCKED_ERROR);
        expect(error.statusCode).toBe(400);
      }
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Cross-surface consistency                                          */
/* ------------------------------------------------------------------ */

describe('Blocked-model error format consistency across assistant surfaces (VAL-MODEL-003)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetModelsConfig.mockResolvedValue(modelsConfig);
    mockValidateModelAccess.mockResolvedValue(blockedResult);
  });

  it('all assistant create/update surfaces return JSON {error} on blocked model', async () => {
    const v1 = require('../../assistants/v1');
    const v2 = require('../../assistants/v2');

    const surfaces = [
      {
        name: 'v1 create',
        fn: v1.createAssistant,
        req: {
          user: { id: 'u' },
          body: { endpoint: BLOCKED_ENDPOINT, model: BLOCKED_MODEL, name: 'A' },
        },
      },
      {
        name: 'v1 patch',
        fn: v1.patchAssistant,
        req: {
          params: { id: 'asst_x' },
          user: { id: 'u' },
          body: { endpoint: BLOCKED_ENDPOINT, model: BLOCKED_MODEL, tools: [] },
        },
      },
      {
        name: 'v2 create',
        fn: v2.createAssistant,
        req: {
          user: { id: 'u' },
          body: { endpoint: BLOCKED_ENDPOINT, model: BLOCKED_MODEL, name: 'A' },
        },
      },
      {
        name: 'v2 patch',
        fn: v2.patchAssistant,
        req: {
          params: { id: 'asst_x' },
          user: { id: 'u' },
          body: { endpoint: BLOCKED_ENDPOINT, model: BLOCKED_MODEL, tools: [] },
        },
      },
    ];

    for (const surface of surfaces) {
      mockValidateModelAccess.mockResolvedValueOnce(blockedResult);
      const res = makeRes();
      await surface.fn(surface.req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(String) }),
      );
      expect(mockGetOpenAIClient).not.toHaveBeenCalled();
      jest.clearAllMocks();
      mockGetModelsConfig.mockResolvedValue(modelsConfig);
    }
  });
});
