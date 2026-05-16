jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const mockDiscoverImageModels = jest.fn();
const mockCheckAccess = jest.fn();
jest.mock('@librechat/api', () => ({
  discoverImageModels: (...args) => mockDiscoverImageModels(...args),
  checkAccess: (...args) => mockCheckAccess(...args),
}));

const mockLoadAuthValues = jest.fn();
jest.mock('~/server/services/Tools/credentials', () => ({
  loadAuthValues: (...args) => mockLoadAuthValues(...args),
}));

jest.mock('~/server/services/Config/app', () => ({
  getAppConfig: jest.fn().mockResolvedValue({}),
}));

const mockGetRoleByName = jest.fn();
jest.mock('~/models/Role', () => ({ getRoleByName: (...args) => mockGetRoleByName(...args) }));

const mockUpdateUser = jest.fn();
const mockGetUserById = jest.fn();
jest.mock('~/models', () => ({
  updateUser: (...args) => mockUpdateUser(...args),
  getUserById: (...args) => mockGetUserById(...args),
}));

const {
  getImageModelsController,
  getImageGenerationPrefsController,
  updateImageGenerationPrefsController,
} = require('../ImageGenerationController');
const { ImageGenProvider } = require('librechat-data-provider');

function createMockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('ImageGenerationController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckAccess.mockResolvedValue(true);
    mockGetRoleByName.mockResolvedValue({ permissions: { IMAGE_GEN: { USE: true } } });
    mockDiscoverImageModels.mockResolvedValue({ providers: [] });
  });

  describe('getImageModelsController', () => {
    it('returns 403 when permission is denied', async () => {
      mockCheckAccess.mockResolvedValue(false);
      mockGetRoleByName.mockResolvedValue({ permissions: { IMAGE_GEN: { USE: false } } });
      const req = { user: { id: 'user-1', role: 'USER' } };
      const res = createMockRes();
      await getImageModelsController(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('allows legacy roles that do not yet have IMAGE_GEN permissions seeded', async () => {
      mockCheckAccess.mockResolvedValue(false);
      mockGetRoleByName.mockResolvedValue({ permissions: { PROMPTS: { USE: true } } });
      mockDiscoverImageModels.mockResolvedValue({ providers: [] });
      const req = { user: { id: 'u-1', role: 'USER' } };
      const res = createMockRes();
      await getImageModelsController(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('returns 200 with discovered providers when permitted', async () => {
      const fakeProviders = {
        providers: [
          {
            id: ImageGenProvider.openai,
            name: 'OpenAI',
            configured: true,
            credentialSource: 'server',
            models: [{ id: 'gpt-image-1', default: true }],
          },
        ],
      };
      mockDiscoverImageModels.mockResolvedValue(fakeProviders);
      const req = { user: { id: 'u-1', role: 'USER' } };
      const res = createMockRes();
      await getImageModelsController(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(fakeProviders);
      expect(mockDiscoverImageModels).toHaveBeenCalledTimes(1);
      const call = mockDiscoverImageModels.mock.calls[0][0];
      expect(call.user).toBe(req.user);
      expect(typeof call.loadCredential).toBe('function');
    });

    it('returns 500 when discovery throws', async () => {
      mockDiscoverImageModels.mockRejectedValue(new Error('boom'));
      const req = { user: { id: 'u-1', role: 'USER' } };
      const res = createMockRes();
      await getImageModelsController(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe('getImageGenerationPrefsController', () => {
    it('returns 401 when no user is on the request', async () => {
      const req = { user: undefined };
      const res = createMockRes();
      await getImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 403 when permission is denied', async () => {
      mockCheckAccess.mockResolvedValue(false);
      const req = { user: { id: 'u-1', role: 'USER' } };
      const res = createMockRes();
      await getImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('returns the saved prefs when present', async () => {
      const prefs = {
        enabledByDefault: true,
        preferredProvider: ImageGenProvider.flux,
        models: { flux: 'flux-pro-1.1' },
      };
      const req = { user: { id: 'u-1', role: 'USER', imageGenerationPrefs: prefs } };
      const res = createMockRes();
      await getImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ prefs });
    });

    it('returns a default prefs object when none stored', async () => {
      const req = { user: { id: 'u-1', role: 'USER' } };
      const res = createMockRes();
      await getImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.prefs.enabledByDefault).toBe(false);
      expect(payload.prefs.models).toEqual({});
    });
  });

  describe('updateImageGenerationPrefsController', () => {
    it('returns 401 when no user', async () => {
      const req = { user: undefined, body: {} };
      const res = createMockRes();
      await updateImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it('returns 403 when permission is denied', async () => {
      mockCheckAccess.mockResolvedValue(false);
      const req = { user: { id: 'u-1', role: 'USER' }, body: { enabledByDefault: true } };
      const res = createMockRes();
      await updateImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('rejects invalid payload with 400', async () => {
      const req = {
        user: { id: 'u-1', role: 'USER' },
        body: { preferredProvider: 'not-a-real-provider' },
      };
      const res = createMockRes();
      await updateImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('merges valid update, persists, and returns saved prefs', async () => {
      const existing = {
        enabledByDefault: false,
        preferredProvider: undefined,
        models: { google: 'imagen-3.0-generate-002' },
      };
      const req = {
        user: { id: 'u-1', role: 'USER', imageGenerationPrefs: existing },
        body: {
          enabledByDefault: true,
          models: { openai: 'gpt-image-1' },
        },
      };
      mockUpdateUser.mockResolvedValue({ acknowledged: true });
      mockGetUserById.mockResolvedValue({
        imageGenerationPrefs: {
          enabledByDefault: true,
          models: {
            google: 'imagen-3.0-generate-002',
            openai: 'gpt-image-1',
          },
        },
      });

      const res = createMockRes();
      await updateImageGenerationPrefsController(req, res);

      expect(mockUpdateUser).toHaveBeenCalledWith(
        'u-1',
        expect.objectContaining({
          imageGenerationPrefs: expect.objectContaining({
            enabledByDefault: true,
            models: expect.objectContaining({
              google: 'imagen-3.0-generate-002',
              openai: 'gpt-image-1',
            }),
          }),
        }),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].prefs.models.openai).toBe('gpt-image-1');
    });

    it('returns 500 if updateUser throws', async () => {
      mockUpdateUser.mockRejectedValue(new Error('db down'));
      const req = {
        user: { id: 'u-1', role: 'USER', imageGenerationPrefs: {} },
        body: { enabledByDefault: true },
      };
      const res = createMockRes();
      await updateImageGenerationPrefsController(req, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
