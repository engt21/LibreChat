const mockUserFindById = jest.fn();
const mockUpdateUser = jest.fn();
const mockMCPServerFind = jest.fn();
const mockKeyFind = jest.fn();
const mockScheduledJobCountDocuments = jest.fn();

jest.mock('librechat-data-provider', () => ({
  SystemRoles: {
    ADMIN: 'ADMIN',
    USER: 'USER',
  },
  AccessRoleIds: {
    MCPSERVER_VIEWER: 'mcpserver_viewer',
  },
  PrincipalType: {
    PUBLIC: 'PUBLIC',
  },
  ResourceType: {
    MCPSERVER: 'MCPSERVER',
  },
  adminSettingsUpdateSchema: { safeParse: jest.fn() },
  adminUserUpdateSchema: {
    safeParse: jest.fn().mockReturnValue({
      success: true,
      data: {},
    }),
  },
}));

jest.mock('@librechat/data-schemas', () => ({
  createMethods: jest.fn(() => ({
    findRoleByIdentifier: jest.fn(),
    grantPermission: jest.fn(),
    revokePermission: jest.fn(),
  })),
}));

jest.mock('@librechat/api', () => ({
  redactServerSecrets: jest.fn((value) => value),
}), { virtual: true });

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
  Message: {
    aggregate: jest
      .fn()
      .mockResolvedValue([{ _id: 'target-user-id', count: 5, lastMessageAt: new Date('2026-02-03') }]),
  },
  Transaction: { aggregate: jest.fn().mockResolvedValue([]) },
  Conversation: {
    aggregate: jest.fn().mockResolvedValue([
      { _id: 'target-user-id', count: 3, lastConversationAt: new Date('2026-02-02') },
    ]),
  },
  MCPServer: {
    find: (...args) => mockMCPServerFind(...args),
  },
  Key: {
    find: (...args) => mockKeyFind(...args),
  },
  ScheduledJob: {
    countDocuments: (...args) => mockScheduledJobCountDocuments(...args),
  },
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

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({}),
}));

jest.mock('~/server/services/ModelAccess', () => ({
  normalizeModelPermissions: jest.fn((value) => value ?? { enabled: false, rules: [] }),
  validateModelPermissions: jest.fn(),
}));

jest.mock('~/server/controllers/UserController', () => ({
  deleteUserAccount: jest.fn(),
}));

const { adminUserUpdateSchema } = require('librechat-data-provider');
const {
  getAdminUserController,
  updateAdminUserController,
} = require('~/server/controllers/AdminController');

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

function mockFindChain(mockFn, value) {
  mockFn.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
    lean: jest.fn().mockResolvedValue(value),
  });
}

describe('AdminController – user preferences and metrics', () => {
  const targetUser = {
    _id: { toString: () => 'target-user-id' },
    role: 'USER',
    email: 'user@example.com',
    provider: 'local',
    name: 'Test User',
    adminRoleIds: [],
    emailVerified: true,
    twoFactorEnabled: false,
    termsAccepted: true,
    personalization: { memories: false },
    modelRateLimits: {
      enabled: true,
      rules: [{ endpoint: 'openAI', model: 'gpt-5.4-mini', requestsPerDay: 5, tokensPerDay: 1000 }],
    },
    imageGenerationPrefs: {
      enabledByDefault: false,
      preferredProvider: 'openAI',
      models: { openAI: 'gpt-image-1' },
    },
    modelSteeringPrefs: { enabled: false },
    notifications: {
      email: { enabled: true, address: 'alerts@example.com' },
      sms: { enabled: false, provider: 'twilio', phoneNumber: '+15555550123' },
      push: {
        enabled: true,
        subscriptions: [
          {
            endpoint: 'https://push.example.test',
            keys: { p256dh: 'secret-p256dh', auth: 'secret-auth' },
          },
        ],
      },
    },
    favorites: [{ model: 'gpt-5.5', endpoint: 'openAI' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByIdChain(targetUser);
    mockUpdateUser.mockResolvedValue(undefined);
    mockFindChain(mockMCPServerFind, [
      {
        serverName: 'research-server',
        config: {
          title: 'Research Server',
          type: 'streamable-http',
          url: 'https://mcp.example.test/mcp',
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
    ]);
    mockFindChain(mockKeyFind, [
      { name: 'openAI', expiresAt: null },
      { name: 'anthropic', expiresAt: new Date('2020-01-01') },
    ]);
    mockScheduledJobCountDocuments.mockResolvedValue(2);
  });

  it('returns safe preferences, BYOK provider status, MCP servers, and schedule metrics for a selected user', async () => {
    const req = {
      params: { userId: 'target-user-id' },
      user: { id: 'admin-id', role: 'ADMIN' },
    };
    const res = createRes();

    await getAdminUserController(req, res);

    expect(mockUserFindById).toHaveBeenCalledWith(
      'target-user-id',
      expect.stringContaining('+notifications'),
    );
    expect(mockMCPServerFind).toHaveBeenCalledWith(
      { author: 'target-user-id' },
      expect.any(String),
    );
    expect(mockKeyFind).toHaveBeenCalledWith({ userId: 'target-user-id' }, 'name expiresAt');
    expect(mockScheduledJobCountDocuments).toHaveBeenCalledWith({ user: 'target-user-id' });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          modelRateLimits: {
            enabled: true,
            rules: [
              {
                endpoint: 'openAI',
                model: 'gpt-5.4-mini',
                requestsPerDay: 5,
                tokensPerDay: 1000,
              },
            ],
          },
          preferences: {
            personalization: { memories: false },
            imageGeneration: {
              enabledByDefault: false,
              preferredProvider: 'openAI',
              models: { openAI: 'gpt-image-1' },
            },
            modelSteering: { enabled: false },
            notifications: {
              email: { enabled: true, address: 'alerts@example.com' },
              sms: { enabled: false, provider: 'twilio' },
              push: { enabled: true, subscriptionCount: 1 },
            },
          },
        }),
        usage: expect.objectContaining({
          scheduledRunCount: 2,
          mcpServerCount: 1,
          byokKeyCount: 1,
          lastActiveAt: new Date('2026-02-03'),
        }),
        mcpServers: [
          expect.objectContaining({
            serverName: 'research-server',
            title: 'Research Server',
            type: 'streamable-http',
            url: 'https://mcp.example.test/mcp',
          }),
        ],
        byokKeys: [
          { provider: 'openAI', expiresAt: null, expired: false },
          { provider: 'anthropic', expiresAt: new Date('2020-01-01'), expired: true },
        ],
      }),
    );
  });

  it('updates only safe user preferences from the admin user detail page', async () => {
    adminUserUpdateSchema.safeParse.mockReturnValue({
      success: true,
      data: {
        personalization: { memories: true },
        imageGenerationPrefs: {
          enabledByDefault: true,
          preferredProvider: 'google',
          models: { google: 'imagen-4' },
        },
        modelSteeringPrefs: { enabled: true },
        modelRateLimits: {
          enabled: true,
          rules: [
            {
              endpoint: 'openAI',
              model: 'gpt-5.4-mini',
              requestsPerDay: 3,
              tokensPerDay: 2000,
            },
          ],
        },
        notifications: {
          email: { enabled: false, address: 'new@example.com' },
          sms: { enabled: true, provider: 'carrier_gateway' },
          push: { enabled: false, subscriptions: [{ endpoint: 'must-not-save' }] },
        },
      },
    });

    const req = {
      params: { userId: 'target-user-id' },
      user: { id: 'admin-id', role: 'ADMIN' },
    };
    const res = createRes();

    await updateAdminUserController(req, res);

    expect(mockUpdateUser).toHaveBeenCalledWith(
      'target-user-id',
      expect.objectContaining({
        'personalization.memories': true,
        imageGenerationPrefs: {
          enabledByDefault: true,
          preferredProvider: 'google',
          models: { google: 'imagen-4' },
        },
        modelSteeringPrefs: { enabled: true },
        modelRateLimits: {
          enabled: true,
          rules: [
            {
              endpoint: 'openAI',
              model: 'gpt-5.4-mini',
              requestsPerDay: 3,
              tokensPerDay: 2000,
            },
          ],
        },
        'notifications.email.enabled': false,
        'notifications.email.address': 'new@example.com',
        'notifications.sms.enabled': true,
        'notifications.sms.provider': 'carrier_gateway',
        'notifications.push.enabled': false,
      }),
    );
    expect(mockUpdateUser.mock.calls[0][1]).not.toHaveProperty('notifications.push.subscriptions');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
