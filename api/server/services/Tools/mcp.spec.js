const mockGetMCPManager = jest.fn();
const mockGetMCPServersRegistry = jest.fn();
const mockFindToken = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('librechat-data-provider', () => ({
  CacheKeys: { FLOWS: 'flows' },
  Constants: { mcp_prefix: 'mcp_' },
}));

jest.mock('~/config', () => ({
  getMCPManager: (...args) => mockGetMCPManager(...args),
  getMCPServersRegistry: (...args) => mockGetMCPServersRegistry(...args),
  getFlowStateManager: jest.fn(() => ({})),
}));

jest.mock('~/models', () => ({
  findToken: (...args) => mockFindToken(...args),
  createToken: jest.fn(),
  updateToken: jest.fn(),
  deleteTokens: jest.fn(),
}));

jest.mock('~/server/services/Config', () => ({
  updateMCPServerTools: jest.fn(),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => ({})),
}));

const { reinitMCPServer } = require('./mcp');

describe('reinitMCPServer OAuth token preflight', () => {
  const serverName = 'microsoft-tools';
  const user = { id: 'user-1' };
  const registry = {
    getServerConfig: jest.fn(),
    reinspectServer: jest.fn(),
  };
  const manager = {
    getConnection: jest.fn(),
    discoverServerTools: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMCPServersRegistry.mockReturnValue(registry);
    mockGetMCPManager.mockReturnValue(manager);
    registry.getServerConfig.mockResolvedValue({
      type: 'streamable-http',
      url: 'https://api.arcade.dev/mcp/microsoft-tools-read',
      requiresOAuth: true,
    });
  });

  it('returns authentication-required without initializing transports when no user token exists', async () => {
    mockFindToken.mockResolvedValue(null);

    const result = await reinitMCPServer({ user, serverName });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        code: 'MCP_AUTHENTICATION_REQUIRED',
        status: 'authentication_required',
        authenticationRequired: true,
        oauthRequired: true,
        serverName,
      }),
    );
    expect(mockFindToken).toHaveBeenCalledWith({
      userId: user.id,
      identifier: `mcp:${serverName}`,
    });
    expect(mockFindToken).toHaveBeenCalledWith({
      userId: user.id,
      identifier: `mcp:${serverName}:refresh`,
    });
    expect(manager.getConnection).not.toHaveBeenCalled();
    expect(manager.discoverServerTools).not.toHaveBeenCalled();
  });

  it('preserves normal initialization when an OAuth token exists', async () => {
    mockFindToken.mockImplementation(async ({ identifier }) =>
      identifier === `mcp:${serverName}` ? { token: 'encrypted-token' } : null,
    );
    const connection = {
      fetchTools: jest.fn().mockResolvedValue([]),
    };
    manager.getConnection.mockResolvedValue(connection);

    const result = await reinitMCPServer({ user, serverName });

    expect(manager.getConnection).toHaveBeenCalledTimes(1);
    expect(manager.discoverServerTools).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        authenticationRequired: false,
        oauthRequired: false,
      }),
    );
  });

  it('preserves normal initialization when only a refresh token exists', async () => {
    mockFindToken.mockImplementation(async ({ identifier }) =>
      identifier === `mcp:${serverName}:refresh` ? { token: 'encrypted-refresh-token' } : null,
    );
    manager.getConnection.mockResolvedValue({
      fetchTools: jest.fn().mockResolvedValue([]),
    });

    const result = await reinitMCPServer({ user, serverName });

    expect(manager.getConnection).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        authenticationRequired: false,
      }),
    );
  });

  it('preserves normal initialization when token lookup fails', async () => {
    mockFindToken.mockRejectedValue(new Error('database unavailable'));
    manager.getConnection.mockResolvedValue({
      fetchTools: jest.fn().mockResolvedValue([]),
    });

    const result = await reinitMCPServer({ user, serverName });

    expect(manager.getConnection).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });
});
