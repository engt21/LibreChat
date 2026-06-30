const mockMCPServerFind = jest.fn();
const mockMCPServerFindOne = jest.fn();
const mockMCPServerUpdateOne = jest.fn();
const mockUserFind = jest.fn();
const mockAclFind = jest.fn();
const mockGrantPermission = jest.fn();
const mockRevokePermission = jest.fn();
const mockGetAppConfig = jest.fn();
const mockGetEffectiveAppSettings = jest.fn();
const mockUpdateAppSettings = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn(), info: jest.fn() },
  createMethods: jest.fn(() => ({
    findRoleByIdentifier: jest.fn().mockResolvedValue({
      _id: 'viewer-role-id',
      permBits: 1,
    }),
    grantPermission: (...args) => mockGrantPermission(...args),
    revokePermission: (...args) => mockRevokePermission(...args),
  })),
}));

jest.mock('librechat-data-provider', () => ({
  SystemRoles: {
    ADMIN: 'ADMIN',
    USER: 'USER',
  },
  AdminPermissions: {
    SETTINGS_READ: 'settings.read',
    SETTINGS_WRITE: 'settings.write',
  },
  PrincipalType: {
    PUBLIC: 'public',
  },
  ResourceType: {
    MCPSERVER: 'mcpServer',
  },
  AccessRoleIds: {
    MCPSERVER_VIEWER: 'mcpServer_viewer',
  },
  adminSettingsUpdateSchema: { safeParse: jest.fn() },
  adminUserUpdateSchema: {
    safeParse: jest.fn().mockReturnValue({ success: true, data: {} }),
  },
}));

jest.mock('@librechat/api', () => ({
  redactServerSecrets: jest.fn((config) => config),
}), { virtual: true });

jest.mock('mongoose', () => ({}));

jest.mock('~/models', () => ({
  searchUsers: jest.fn(),
  updateUser: jest.fn(),
}));

jest.mock('~/db/models', () => ({
  User: { find: (...args) => mockUserFind(...args), findById: jest.fn() },
  Balance: { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) },
  AdminRole: {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    }),
  },
  Message: { aggregate: jest.fn().mockResolvedValue([]) },
  Transaction: { aggregate: jest.fn().mockResolvedValue([]) },
  Conversation: { aggregate: jest.fn().mockResolvedValue([]) },
  MCPServer: {
    find: (...args) => mockMCPServerFind(...args),
    findOne: (...args) => mockMCPServerFindOne(...args),
    updateOne: (...args) => mockMCPServerUpdateOne(...args),
  },
  Key: { find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) },
  ScheduledJob: { countDocuments: jest.fn().mockResolvedValue(0) },
  AclEntry: {
    find: (...args) => mockAclFind(...args),
  },
}));

jest.mock('~/server/services/Admin/permissions', () => ({
  getAdminAccessState: jest.fn(),
  getAdminRolesByIds: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/server/services/Admin/appSettings', () => ({
  getEffectiveAppSettings: (...args) => mockGetEffectiveAppSettings(...args),
  updateAppSettings: (...args) => mockUpdateAppSettings(...args),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: (...args) => mockGetAppConfig(...args),
}));

jest.mock('~/server/controllers/ModelController', () => ({
  loadModels: jest.fn(),
}));

jest.mock('~/server/services/ModelAccess', () => ({
  normalizeModelPermissions: jest.fn((value) => value ?? { enabled: false, rules: [] }),
  validateModelPermissions: jest.fn(),
}));

jest.mock('~/server/controllers/UserController', () => ({
  deleteUserAccount: jest.fn(),
}));

const {
  getAdminMCPServersController,
  getAdminObservabilityController,
  getAdminSettingsController,
  updateAdminMCPServerPublicationController,
  updateAdminSettingsController,
} = require('~/server/controllers/AdminController');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function mockFindChain(mockFn, value) {
  mockFn.mockReturnValue({
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(value),
    }),
    lean: jest.fn().mockResolvedValue(value),
  });
}

describe('AdminController – MCP platform publishing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppConfig.mockResolvedValue({
      mcpConfig: {
        'yaml-server': {
          title: 'YAML Server',
          type: 'streamable-http',
          url: 'https://yaml.example.test/mcp',
        },
      },
    });
    mockGetEffectiveAppSettings.mockResolvedValue({
      mcpPublishedServers: ['yaml-server'],
    });
    mockUpdateAppSettings.mockResolvedValue({
      mcpPublishedServers: [],
    });
    mockFindChain(mockMCPServerFind, [
      {
        _id: { toString: () => 'db-server-id' },
        serverName: 'db-server',
        author: { toString: () => 'owner-id' },
        config: {
          title: 'DB Server',
          type: 'streamable-http',
          url: 'https://db.example.test/mcp',
        },
        createdAt: new Date('2026-01-01'),
        updatedAt: new Date('2026-01-02'),
      },
    ]);
    mockFindChain(mockUserFind, [{ _id: { toString: () => 'owner-id' }, email: 'owner@test.com' }]);
    mockAclFind.mockReturnValue({
      distinct: jest.fn().mockResolvedValue([{ toString: () => 'db-server-id' }]),
    });
    mockMCPServerFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: { toString: () => 'db-server-id' },
        serverName: 'db-server',
      }),
    });
    mockGrantPermission.mockResolvedValue({});
    mockRevokePermission.mockResolvedValue({ deletedCount: 1 });
    mockMCPServerUpdateOne.mockResolvedValue({});
  });

  it('lists YAML and user-defined MCP servers with platform-published status', async () => {
    const req = { user: { id: 'admin-id', role: 'ADMIN' } };
    const res = createRes();

    await getAdminMCPServersController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].servers.map((server) => server.title)).toEqual([
      'DB Server',
      'YAML Server',
    ]);
    expect(res.json).toHaveBeenCalledWith({
      servers: expect.arrayContaining([
        expect.objectContaining({
          serverName: 'yaml-server',
          storage: 'static',
          title: 'YAML Server',
          published: true,
        }),
        expect.objectContaining({
          serverName: 'db-server',
          storage: 'user',
          ownerEmail: 'owner@test.com',
          published: true,
        }),
      ]),
    });
  });

  it('publishes a DB-backed user MCP server by granting public viewer ACL', async () => {
    const req = {
      params: { serverName: 'db-server' },
      body: { published: true },
      user: { id: 'admin-id', role: 'ADMIN' },
    };
    const res = createRes();

    await updateAdminMCPServerPublicationController(req, res);

    expect(mockGrantPermission).toHaveBeenCalledWith(
      'public',
      null,
      'mcpServer',
      expect.anything(),
      1,
      'admin-id',
      undefined,
      'viewer-role-id',
    );
    expect(mockMCPServerUpdateOne).toHaveBeenCalledWith(
      { serverName: 'db-server' },
      expect.objectContaining({
        $set: expect.objectContaining({ publishedBy: 'admin-id' }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ published: true }));
  });

  it('unpublishes a YAML/static MCP server by updating the published allowlist', async () => {
    mockMCPServerFindOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    const req = {
      params: { serverName: 'yaml-server' },
      body: { published: false },
      user: { id: 'admin-id', role: 'ADMIN' },
    };
    const res = createRes();

    await updateAdminMCPServerPublicationController(req, res);

    expect(mockUpdateAppSettings).toHaveBeenCalledWith({ mcpPublishedServers: [] });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'yaml-server',
        storage: 'static',
        published: false,
      }),
    );
  });
});

describe('AdminController – observability links', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function createRequest(host = '192.168.50.104:3080') {
    return {
      headers: {},
      protocol: 'http',
      get: jest.fn((name) => (name === 'host' ? host : undefined)),
    };
  }

  it('returns raw observability settings for the editable settings form', async () => {
    mockGetEffectiveAppSettings.mockResolvedValue({
      settingsId: 'global',
      observability: {
        langfuseUrl: 'http://localhost:3000',
        grafanaUrl: 'http://localhost:3001',
        metricsUrl: 'http://localhost:9091',
        prometheusUrl: 'http://localhost:9092',
      },
    });
    const res = createRes();

    await getAdminSettingsController(createRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        observability: {
          langfuseUrl: 'http://localhost:3000',
          grafanaUrl: 'http://localhost:3001',
          metricsUrl: 'http://localhost:9091',
          prometheusUrl: 'http://localhost:9092',
        },
      }),
    );
  });

  it('resolves observability quick links to the browser-visible request host', async () => {
    mockGetEffectiveAppSettings.mockResolvedValue({
      observability: {
        langfuseUrl: 'http://localhost:3000',
        grafanaUrl: 'http://localhost:3001',
        metricsUrl: 'http://localhost:9091',
        prometheusUrl: 'http://localhost:9092',
      },
    });
    const res = createRes();

    await getAdminObservabilityController(createRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        links: {
          langfuseUrl: 'http://192.168.50.104:3000/',
          grafanaUrl: 'http://192.168.50.104:3001/',
          metricsUrl: 'http://192.168.50.104:9091/',
          prometheusUrl: 'http://192.168.50.104:9092/',
        },
      }),
    );
  });

  it('normalizes same-host observability settings back to localhost on save', async () => {
    const parsedUpdates = {
      registrationEnabled: true,
      observability: {
        langfuseUrl: 'http://192.168.50.104:3000',
        grafanaUrl: 'http://192.168.50.104:3001',
        metricsUrl: 'http://192.168.50.104:9091',
        prometheusUrl: 'http://192.168.50.104:9092',
      },
    };
    require('librechat-data-provider').adminSettingsUpdateSchema.safeParse.mockReturnValue({
      success: true,
      data: parsedUpdates,
    });
    mockUpdateAppSettings.mockResolvedValue({
      settingsId: 'global',
      observability: {
        langfuseUrl: 'http://localhost:3000',
        grafanaUrl: 'http://localhost:3001',
        metricsUrl: 'http://localhost:9091',
        prometheusUrl: 'http://localhost:9092',
      },
    });
    const req = {
      ...createRequest(),
      body: parsedUpdates,
    };
    const res = createRes();

    await updateAdminSettingsController(req, res);

    expect(mockUpdateAppSettings).toHaveBeenCalledWith({
      registrationEnabled: true,
      observability: {
        langfuseUrl: 'http://localhost:3000',
        grafanaUrl: 'http://localhost:3001',
        metricsUrl: 'http://localhost:9091',
        prometheusUrl: 'http://localhost:9092',
      },
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
