const mockDeleteUserAccount = jest.fn();
const mockUserFindById = jest.fn();

jest.mock('librechat-data-provider', () => ({
  SystemRoles: {
    ADMIN: 'ADMIN',
    USER: 'USER',
  },
  adminSettingsUpdateSchema: { safeParse: jest.fn() },
  adminUserUpdateSchema: { safeParse: jest.fn() },
}));

jest.mock('~/models', () => ({
  searchUsers: jest.fn(),
  updateUser: jest.fn(),
}));

jest.mock('~/db/models', () => ({
  User: { findById: (...args) => mockUserFindById(...args) },
  Balance: { find: jest.fn() },
  AdminRole: { find: jest.fn() },
  Message: { aggregate: jest.fn() },
  Transaction: { aggregate: jest.fn() },
  Conversation: { aggregate: jest.fn() },
}));

jest.mock('~/server/services/Admin/permissions', () => ({
  getAdminAccessState: jest.fn(),
  getAdminRolesByIds: jest.fn(),
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
  deleteUserAccount: (...args) => mockDeleteUserAccount(...args),
}));

const { SystemRoles } = require('librechat-data-provider');
const { deleteAdminUserController } = require('~/server/controllers/AdminController');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockFindByIdResult(value) {
  mockUserFindById.mockReturnValue({
    lean: jest.fn().mockResolvedValue(value),
  });
}

describe('deleteAdminUserController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteUserAccount.mockResolvedValue(undefined);
  });

  it('allows a workspace admin to delete a standard user', async () => {
    const targetUser = {
      _id: { toString: () => 'target-user-id' },
      role: SystemRoles.USER,
      email: 'target@example.com',
    };
    const req = {
      params: { userId: 'target-user-id' },
      user: { id: 'workspace-admin-id', role: SystemRoles.USER },
    };
    const res = createRes();

    mockFindByIdResult(targetUser);

    await deleteAdminUserController(req, res);

    expect(mockDeleteUserAccount).toHaveBeenCalledWith({
      req,
      user: {
        id: 'target-user-id',
        _id: targetUser._id,
        email: 'target@example.com',
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'User deleted' });
  });

  it('rejects deleting your own account through the admin route', async () => {
    const req = {
      params: { userId: 'workspace-admin-id' },
      user: { id: 'workspace-admin-id', role: SystemRoles.USER },
    };
    const res = createRes();

    mockFindByIdResult({
      _id: { toString: () => 'workspace-admin-id' },
      role: SystemRoles.USER,
      email: 'admin@example.com',
    });

    await deleteAdminUserController(req, res);

    expect(mockDeleteUserAccount).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Use account settings to delete your own account',
    });
  });

  it('rejects a non-superadmin deleting a superadmin account', async () => {
    const req = {
      params: { userId: 'super-admin-id' },
      user: { id: 'workspace-admin-id', role: SystemRoles.USER },
    };
    const res = createRes();

    mockFindByIdResult({
      _id: { toString: () => 'super-admin-id' },
      role: SystemRoles.ADMIN,
      email: 'super@example.com',
    });

    await deleteAdminUserController(req, res);

    expect(mockDeleteUserAccount).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Only superadmins can delete superadmin accounts',
    });
  });
});
