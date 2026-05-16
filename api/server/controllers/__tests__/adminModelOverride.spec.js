const mockUserFindById = jest.fn();
const mockUpdateUser = jest.fn();

jest.mock('librechat-data-provider', () => ({
  SystemRoles: {
    ADMIN: 'ADMIN',
    USER: 'USER',
  },
  adminSettingsUpdateSchema: { safeParse: jest.fn() },
  adminUserUpdateSchema: {
    safeParse: jest.fn().mockReturnValue({
      success: true,
      data: {},
    }),
  },
}));

jest.mock('~/models', () => ({
  searchUsers: jest.fn(),
  updateUser: (...args) => mockUpdateUser(...args),
}));

jest.mock('~/db/models', () => ({
  User: { find: jest.fn(), findById: (...args) => mockUserFindById(...args) },
  Balance: { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) },
  AdminRole: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
  },
  Message: { aggregate: jest.fn().mockResolvedValue([]) },
  Transaction: { aggregate: jest.fn().mockResolvedValue([]) },
  Conversation: { aggregate: jest.fn().mockResolvedValue([]) },
}));

jest.mock('~/server/services/Admin/permissions', () => ({
  getAdminAccessState: jest.fn(),
  getAdminRolesByIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/server/services/Admin/appSettings', () => ({
  getEffectiveAppSettings: jest.fn(),
  updateAppSettings: jest.fn(),
}));

jest.mock('~/server/controllers/ModelController', () => ({
  loadModels: jest.fn(),
}));

jest.mock('~/server/services/ModelAccess', () => ({
  normalizeModelPermissions: jest.fn((value) => value),
  validateModelPermissions: jest.fn(),
}));

jest.mock('~/server/controllers/UserController', () => ({
  deleteUserAccount: jest.fn(),
}));

const { adminUserUpdateSchema } = require('librechat-data-provider');
const { loadModels } = require('~/server/controllers/ModelController');
const { validateModelPermissions } = require('~/server/services/ModelAccess');
const { updateAdminUserController } = require('~/server/controllers/AdminController');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockFindByIdChain(value) {
  mockUserFindById.mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  });
}

describe('updateAdminUserController – model permission overrides (VAL-MODEL-002)', () => {
  const targetUser = {
    _id: { toString: () => 'target-user-id' },
    role: 'USER',
    email: 'user@example.com',
    name: 'Test User',
    adminRoleIds: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateUser.mockResolvedValue(undefined);
    mockFindByIdChain(targetUser);
  });

  it('applies valid model permission overrides from a superadmin', async () => {
    const modelPermissions = {
      enabled: true,
      rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
    };

    adminUserUpdateSchema.safeParse.mockReturnValue({
      success: true,
      data: { modelPermissions },
    });

    loadModels.mockResolvedValue({ openAI: ['gpt-4o', 'gpt-5'] });
    validateModelPermissions.mockReturnValue({
      isValid: true,
      modelPermissions: {
        enabled: true,
        rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
      },
    });

    const req = {
      params: { userId: 'target-user-id' },
      user: { id: 'superadmin-id', role: 'ADMIN' },
    };
    const res = createRes();

    await updateAdminUserController(req, res);

    expect(validateModelPermissions).toHaveBeenCalledWith(modelPermissions, {
      openAI: ['gpt-4o', 'gpt-5'],
    });
    expect(mockUpdateUser).toHaveBeenCalledWith(
      'target-user-id',
      expect.objectContaining({
        modelPermissions: {
          enabled: true,
          rules: [{ endpoint: 'openAI', models: ['gpt-4o'] }],
        },
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects invalid endpoints in model permissions with 400', async () => {
    const modelPermissions = {
      enabled: true,
      rules: [{ endpoint: 'nonexistent', models: ['some-model'] }],
    };

    adminUserUpdateSchema.safeParse.mockReturnValue({
      success: true,
      data: { modelPermissions },
    });

    loadModels.mockResolvedValue({ openAI: ['gpt-4o'] });
    validateModelPermissions.mockReturnValue({
      isValid: false,
      message: 'Invalid endpoint in model permissions: nonexistent',
    });

    const req = {
      params: { userId: 'target-user-id' },
      user: { id: 'superadmin-id', role: 'ADMIN' },
    };
    const res = createRes();

    await updateAdminUserController(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid endpoint in model permissions: nonexistent',
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects invalid models in model permissions with 400', async () => {
    const modelPermissions = {
      enabled: true,
      rules: [{ endpoint: 'openAI', models: ['nonexistent-model'] }],
    };

    adminUserUpdateSchema.safeParse.mockReturnValue({
      success: true,
      data: { modelPermissions },
    });

    loadModels.mockResolvedValue({ openAI: ['gpt-4o'] });
    validateModelPermissions.mockReturnValue({
      isValid: false,
      message: 'Invalid model permissions for endpoint openAI',
    });

    const req = {
      params: { userId: 'target-user-id' },
      user: { id: 'superadmin-id', role: 'ADMIN' },
    };
    const res = createRes();

    await updateAdminUserController(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid model permissions for endpoint openAI',
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });

  it('rejects invalid update payload with 400', async () => {
    adminUserUpdateSchema.safeParse.mockReturnValue({
      success: false,
    });

    const req = {
      params: { userId: 'target-user-id' },
      user: { id: 'superadmin-id', role: 'ADMIN' },
      body: { invalid: 'payload' },
    };
    const res = createRes();

    await updateAdminUserController(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Invalid admin user update payload',
    });
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});
