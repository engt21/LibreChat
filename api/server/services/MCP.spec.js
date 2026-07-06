// Mock all dependencies - define mocks before imports
// Mock all dependencies
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

// Create mock registry instance
const mockRegistryInstance = {
  getOAuthServers: jest.fn(() => Promise.resolve(new Set())),
  getAllServerConfigs: jest.fn(() => Promise.resolve({})),
  getServerConfig: jest.fn(() => Promise.resolve(null)),
};

// Create isMCPDomainAllowed mock that can be configured per-test
const mockIsMCPDomainAllowed = jest.fn(() => Promise.resolve(true));

const mockGetAppConfig = jest.fn(() => Promise.resolve({}));
const mockGetMCPAuthenticationRequirement = jest.fn(() => Promise.resolve(null));

jest.mock('@librechat/api', () => {
  const actual = jest.requireActual('@librechat/api');
  return {
    ...actual,
    sendEvent: jest.fn(),
    get isMCPDomainAllowed() {
      return mockIsMCPDomainAllowed;
    },
    GenerationJobManager: {
      emitChunk: jest.fn(),
    },
  };
});

const { logger } = require('@librechat/data-schemas');
const { MCPOAuthHandler } = require('@librechat/api');
const { CacheKeys, Constants } = require('librechat-data-provider');
const { getEffectiveAppSettings } = require('./Admin/appSettings');
const D = Constants.mcp_delimiter;
const {
  createMCPTool,
  createMCPTools,
  getMCPSetupData,
  checkOAuthFlowStatus,
  getServerConnectionStatus,
  createUnavailableToolStub,
  detectMCPConsentContinuation,
} = require('./MCP');

jest.mock('./Config', () => ({
  loadCustomConfig: jest.fn(),
  get getAppConfig() {
    return mockGetAppConfig;
  },
}));

jest.mock('~/config', () => ({
  getMCPManager: jest.fn(),
  getFlowStateManager: jest.fn(),
  getOAuthReconnectionManager: jest.fn(),
  getMCPServersRegistry: jest.fn(() => mockRegistryInstance),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

jest.mock('~/models', () => ({
  findToken: jest.fn(),
  createToken: jest.fn(),
  updateToken: jest.fn(),
}));

jest.mock('./Tools/mcp', () => ({
  reinitMCPServer: jest.fn(),
  getMCPAuthenticationRequirement: (...args) => mockGetMCPAuthenticationRequirement(...args),
}));

jest.mock('./GraphTokenService', () => ({
  getGraphApiToken: jest.fn(),
}));

jest.mock('./Admin/appSettings', () => ({
  getEffectiveAppSettings: jest.fn().mockResolvedValue({ mcpAllowedDomains: [] }),
}));

describe('tests for the new helper functions used by the MCP connection status endpoints', () => {
  let mockGetMCPManager;
  let mockGetFlowStateManager;
  let mockGetLogStores;
  let mockGetOAuthReconnectionManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(MCPOAuthHandler, 'generateFlowId');

    mockGetMCPManager = require('~/config').getMCPManager;
    mockGetFlowStateManager = require('~/config').getFlowStateManager;
    mockGetLogStores = require('~/cache').getLogStores;
    mockGetOAuthReconnectionManager = require('~/config').getOAuthReconnectionManager;
  });

  describe('getMCPSetupData', () => {
    const mockUserId = 'user-123';
    const mockConfig = {
      server1: { type: 'stdio' },
      server2: { type: 'http' },
    };

    beforeEach(() => {
      mockGetMCPManager.mockReturnValue({
        appConnections: { getLoaded: jest.fn(() => new Map()) },
        getUserConnections: jest.fn(() => new Map()),
      });
      mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set());
      mockRegistryInstance.getAllServerConfigs.mockResolvedValue(mockConfig);
    });

    it('should successfully return MCP setup data', async () => {
      mockRegistryInstance.getAllServerConfigs.mockResolvedValue(mockConfig);

      const mockAppConnections = new Map([['server1', { status: 'connected' }]]);
      const mockUserConnections = new Map([['server2', { status: 'disconnected' }]]);
      const mockOAuthServers = new Set(['server2']);

      const mockMCPManager = {
        appConnections: { getLoaded: jest.fn(() => Promise.resolve(mockAppConnections)) },
        getUserConnections: jest.fn(() => mockUserConnections),
      };
      mockGetMCPManager.mockReturnValue(mockMCPManager);
      mockRegistryInstance.getOAuthServers.mockResolvedValue(mockOAuthServers);

      const result = await getMCPSetupData(mockUserId);

      expect(mockRegistryInstance.getAllServerConfigs).toHaveBeenCalledWith(mockUserId);
      expect(mockGetMCPManager).toHaveBeenCalledWith(mockUserId);
      expect(mockMCPManager.appConnections.getLoaded).toHaveBeenCalled();
      expect(mockMCPManager.getUserConnections).toHaveBeenCalledWith(mockUserId);
      expect(mockRegistryInstance.getOAuthServers).toHaveBeenCalledWith(mockUserId);

      expect(result).toEqual({
        mcpConfig: mockConfig,
        appConnections: mockAppConnections,
        userConnections: mockUserConnections,
        oauthServers: mockOAuthServers,
      });
    });

    it('should throw error when MCP config not found', async () => {
      mockRegistryInstance.getAllServerConfigs.mockResolvedValue(null);
      await expect(getMCPSetupData(mockUserId)).rejects.toThrow('MCP config not found');
    });

    it('should handle null values from MCP manager gracefully', async () => {
      mockRegistryInstance.getAllServerConfigs.mockResolvedValue(mockConfig);

      const mockMCPManager = {
        appConnections: { getLoaded: jest.fn(() => Promise.resolve(null)) },
        getUserConnections: jest.fn(() => null),
      };
      mockGetMCPManager.mockReturnValue(mockMCPManager);
      mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set());

      const result = await getMCPSetupData(mockUserId);

      expect(result).toEqual({
        mcpConfig: mockConfig,
        appConnections: new Map(),
        userConnections: new Map(),
        oauthServers: new Set(),
      });
    });
  });

  describe('checkOAuthFlowStatus', () => {
    const mockUserId = 'user-123';
    const mockServerName = 'test-server';
    const mockFlowId = 'flow-123';

    beforeEach(() => {
      const mockFlowsCache = {};
      const mockFlowManager = {
        getFlowState: jest.fn(),
      };

      mockGetLogStores.mockReturnValue(mockFlowsCache);
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);
      MCPOAuthHandler.generateFlowId.mockReturnValue(mockFlowId);
    });

    it('should return false flags when no flow state exists', async () => {
      const mockFlowManager = { getFlowState: jest.fn(() => null) };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);

      const result = await checkOAuthFlowStatus(mockUserId, mockServerName);

      expect(mockGetLogStores).toHaveBeenCalledWith(CacheKeys.FLOWS);
      expect(MCPOAuthHandler.generateFlowId).toHaveBeenCalledWith(mockUserId, mockServerName);
      expect(mockFlowManager.getFlowState).toHaveBeenCalledWith(mockFlowId, 'mcp_oauth');
      expect(result).toEqual({ hasActiveFlow: false, hasFailedFlow: false });
    });

    it('should detect failed flow when status is FAILED', async () => {
      const mockFlowState = {
        status: 'FAILED',
        createdAt: Date.now() - 60000, // 1 minute ago
        ttl: 180000,
      };
      const mockFlowManager = { getFlowState: jest.fn(() => mockFlowState) };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);

      const result = await checkOAuthFlowStatus(mockUserId, mockServerName);

      expect(result).toEqual({ hasActiveFlow: false, hasFailedFlow: true });
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Found failed OAuth flow'),
        expect.objectContaining({
          flowId: mockFlowId,
          status: 'FAILED',
        }),
      );
    });

    it('should detect failed flow when flow has timed out', async () => {
      const mockFlowState = {
        status: 'PENDING',
        createdAt: Date.now() - 200000, // 200 seconds ago (> 180s TTL)
        ttl: 180000,
      };
      const mockFlowManager = { getFlowState: jest.fn(() => mockFlowState) };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);

      const result = await checkOAuthFlowStatus(mockUserId, mockServerName);

      expect(result).toEqual({ hasActiveFlow: false, hasFailedFlow: true });
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Found failed OAuth flow'),
        expect.objectContaining({
          timedOut: true,
        }),
      );
    });

    it('should detect failed flow when TTL not specified and flow exceeds default TTL', async () => {
      const mockFlowState = {
        status: 'PENDING',
        createdAt: Date.now() - 200000, // 200 seconds ago (> 180s default TTL)
        // ttl not specified, should use 180000 default
      };
      const mockFlowManager = { getFlowState: jest.fn(() => mockFlowState) };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);

      const result = await checkOAuthFlowStatus(mockUserId, mockServerName);

      expect(result).toEqual({ hasActiveFlow: false, hasFailedFlow: true });
    });

    it('should detect active flow when status is PENDING and within TTL', async () => {
      const mockFlowState = {
        status: 'PENDING',
        createdAt: Date.now() - 60000, // 1 minute ago (< 180s TTL)
        ttl: 180000,
      };
      const mockFlowManager = { getFlowState: jest.fn(() => mockFlowState) };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);

      const result = await checkOAuthFlowStatus(mockUserId, mockServerName);

      expect(result).toEqual({ hasActiveFlow: true, hasFailedFlow: false });
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Found active OAuth flow'),
        expect.objectContaining({
          flowId: mockFlowId,
        }),
      );
    });

    it('should return false flags for other statuses', async () => {
      const mockFlowState = {
        status: 'COMPLETED',
        createdAt: Date.now() - 60000,
        ttl: 180000,
      };
      const mockFlowManager = { getFlowState: jest.fn(() => mockFlowState) };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);

      const result = await checkOAuthFlowStatus(mockUserId, mockServerName);

      expect(result).toEqual({ hasActiveFlow: false, hasFailedFlow: false });
    });

    it('should handle errors gracefully', async () => {
      const mockError = new Error('Flow state error');
      const mockFlowManager = {
        getFlowState: jest.fn(() => {
          throw mockError;
        }),
      };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);

      const result = await checkOAuthFlowStatus(mockUserId, mockServerName);

      expect(result).toEqual({ hasActiveFlow: false, hasFailedFlow: false });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error checking OAuth flows'),
        mockError,
      );
    });
  });

  describe('getServerConnectionStatus', () => {
    const mockUserId = 'user-123';
    const mockServerName = 'test-server';
    const mockConfig = { updatedAt: Date.now() };

    it('should return app connection state when available', async () => {
      const appConnections = new Map([
        [
          mockServerName,
          {
            connectionState: 'connected',
            isStale: jest.fn(() => false),
          },
        ],
      ]);
      const userConnections = new Map();
      const oauthServers = new Set();

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: false,
        connectionState: 'connected',
      });
    });

    it('should fallback to user connection state when app connection not available', async () => {
      const appConnections = new Map();
      const userConnections = new Map([
        [
          mockServerName,
          {
            connectionState: 'connecting',
            isStale: jest.fn(() => false),
          },
        ],
      ]);
      const oauthServers = new Set();

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: false,
        connectionState: 'connecting',
      });
    });

    it('should default to disconnected when no connections exist', async () => {
      const appConnections = new Map();
      const userConnections = new Map();
      const oauthServers = new Set();

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: false,
        connectionState: 'disconnected',
      });
    });

    it('should prioritize app connection over user connection', async () => {
      const appConnections = new Map([
        [
          mockServerName,
          {
            connectionState: 'connected',
            isStale: jest.fn(() => false),
          },
        ],
      ]);
      const userConnections = new Map([
        [
          mockServerName,
          {
            connectionState: 'disconnected',
            isStale: jest.fn(() => false),
          },
        ],
      ]);
      const oauthServers = new Set();

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: false,
        connectionState: 'connected',
      });
    });

    it('should indicate OAuth requirement when server is in OAuth servers set', async () => {
      const appConnections = new Map();
      const userConnections = new Map();
      const oauthServers = new Set([mockServerName]);

      // Mock OAuthReconnectionManager
      const mockOAuthReconnectionManager = {
        isReconnecting: jest.fn(() => false),
      };
      mockGetOAuthReconnectionManager.mockReturnValue(mockOAuthReconnectionManager);

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result.requiresOAuth).toBe(true);
    });

    it('should handle OAuth flow status when disconnected and requires OAuth with failed flow', async () => {
      const appConnections = new Map();
      const userConnections = new Map();
      const oauthServers = new Set([mockServerName]);

      // Mock OAuthReconnectionManager
      const mockOAuthReconnectionManager = {
        isReconnecting: jest.fn(() => false),
      };
      mockGetOAuthReconnectionManager.mockReturnValue(mockOAuthReconnectionManager);

      // Mock flow state to return failed flow
      const mockFlowManager = {
        getFlowState: jest.fn(() => ({
          status: 'FAILED',
          createdAt: Date.now() - 60000,
          ttl: 180000,
        })),
      };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);
      mockGetLogStores.mockReturnValue({});
      MCPOAuthHandler.generateFlowId.mockReturnValue('test-flow-id');

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: true,
        connectionState: 'error',
      });
    });

    it('should handle OAuth flow status when disconnected and requires OAuth with active flow', async () => {
      const appConnections = new Map();
      const userConnections = new Map();
      const oauthServers = new Set([mockServerName]);

      // Mock OAuthReconnectionManager
      const mockOAuthReconnectionManager = {
        isReconnecting: jest.fn(() => false),
      };
      mockGetOAuthReconnectionManager.mockReturnValue(mockOAuthReconnectionManager);

      // Mock flow state to return active flow
      const mockFlowManager = {
        getFlowState: jest.fn(() => ({
          status: 'PENDING',
          createdAt: Date.now() - 60000, // 1 minute ago
          ttl: 180000, // 3 minutes TTL
        })),
      };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);
      mockGetLogStores.mockReturnValue({});
      MCPOAuthHandler.generateFlowId.mockReturnValue('test-flow-id');

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: true,
        connectionState: 'connecting',
      });
    });

    it('should handle OAuth flow status when disconnected and requires OAuth with no flow', async () => {
      const appConnections = new Map();
      const userConnections = new Map();
      const oauthServers = new Set([mockServerName]);

      // Mock OAuthReconnectionManager
      const mockOAuthReconnectionManager = {
        isReconnecting: jest.fn(() => false),
      };
      mockGetOAuthReconnectionManager.mockReturnValue(mockOAuthReconnectionManager);

      // Mock flow state to return no flow
      const mockFlowManager = {
        getFlowState: jest.fn(() => null),
      };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);
      mockGetLogStores.mockReturnValue({});
      MCPOAuthHandler.generateFlowId.mockReturnValue('test-flow-id');

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: true,
        connectionState: 'disconnected',
      });
    });

    it('should return connecting state when OAuth server is reconnecting', async () => {
      const appConnections = new Map();
      const userConnections = new Map();
      const oauthServers = new Set([mockServerName]);

      // Mock OAuthReconnectionManager to return true for isReconnecting
      const mockOAuthReconnectionManager = {
        isReconnecting: jest.fn(() => true),
      };
      mockGetOAuthReconnectionManager.mockReturnValue(mockOAuthReconnectionManager);

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: true,
        connectionState: 'connecting',
      });
      expect(mockOAuthReconnectionManager.isReconnecting).toHaveBeenCalledWith(
        mockUserId,
        mockServerName,
      );
    });

    it('should not check OAuth flow status when server is connected', async () => {
      const mockFlowManager = {
        getFlowState: jest.fn(),
      };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);
      mockGetLogStores.mockReturnValue({});

      const appConnections = new Map([
        [
          mockServerName,
          {
            connectionState: 'connected',
            isStale: jest.fn(() => false),
          },
        ],
      ]);
      const userConnections = new Map();
      const oauthServers = new Set([mockServerName]);

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: true,
        connectionState: 'connected',
      });

      // Should not call flow manager since server is connected
      expect(mockFlowManager.getFlowState).not.toHaveBeenCalled();
    });

    it('should not check OAuth flow status when server does not require OAuth', async () => {
      const mockFlowManager = {
        getFlowState: jest.fn(),
      };
      mockGetFlowStateManager.mockReturnValue(mockFlowManager);
      mockGetLogStores.mockReturnValue({});

      const appConnections = new Map();
      const userConnections = new Map();
      const oauthServers = new Set(); // Server not in OAuth servers

      const result = await getServerConnectionStatus(
        mockUserId,
        mockServerName,
        mockConfig,
        appConnections,
        userConnections,
        oauthServers,
      );

      expect(result).toEqual({
        requiresOAuth: false,
        connectionState: 'disconnected',
      });

      // Should not call flow manager since server doesn't require OAuth
      expect(mockFlowManager.getFlowState).not.toHaveBeenCalled();
    });
  });
});

describe('User parameter passing tests', () => {
  let mockReinitMCPServer;
  let mockGetFlowStateManager;
  let mockGetLogStores;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReinitMCPServer = require('./Tools/mcp').reinitMCPServer;
    mockGetFlowStateManager = require('~/config').getFlowStateManager;
    mockGetLogStores = require('~/cache').getLogStores;

    // Setup default mocks
    mockGetLogStores.mockReturnValue({});
    mockGetFlowStateManager.mockReturnValue({
      createFlowWithHandler: jest.fn(),
      failFlow: jest.fn(),
    });

    // Reset domain validation mock to default (allow all)
    mockIsMCPDomainAllowed.mockReset();
    mockIsMCPDomainAllowed.mockResolvedValue(true);

    // Reset registry mocks
    mockRegistryInstance.getServerConfig.mockReset();
    mockRegistryInstance.getServerConfig.mockResolvedValue(null);

    // Reset getAppConfig mock to default (no restrictions)
    mockGetAppConfig.mockReset();
    mockGetAppConfig.mockResolvedValue({});
  });

  describe('createMCPTools', () => {
    it('should pass user parameter to reinitMCPServer when calling reconnectServer internally', async () => {
      const mockUser = { id: 'test-user-123', name: 'Test User' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };
      const mockSignal = new AbortController().signal;

      mockReinitMCPServer.mockResolvedValue({
        tools: [{ name: 'test-tool' }],
        availableTools: {
          [`test-tool${D}test-server`]: {
            function: {
              description: 'Test tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        },
      });

      await createMCPTools({
        res: mockRes,
        user: mockUser,
        serverName: 'test-server',
        provider: 'openai',
        signal: mockSignal,
        userMCPAuthMap: {},
      });

      // Verify reinitMCPServer was called with the user
      expect(mockReinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          user: mockUser,
          serverName: 'test-server',
        }),
      );
      expect(mockReinitMCPServer.mock.calls[0][0].user).toBe(mockUser);
    });

    it('should throw error if user is not provided', async () => {
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      mockReinitMCPServer.mockResolvedValue({
        tools: [],
        availableTools: {},
      });

      // Call without user should throw error
      await expect(
        createMCPTools({
          res: mockRes,
          user: undefined,
          serverName: 'test-server',
          provider: 'openai',
          userMCPAuthMap: {},
        }),
      ).rejects.toThrow("Cannot read properties of undefined (reading 'id')");

      // Verify reinitMCPServer was not called due to early error
      expect(mockReinitMCPServer).not.toHaveBeenCalled();
    });
  });

  describe('createMCPTool', () => {
    it('should pass user parameter to reinitMCPServer when tool not in cache', async () => {
      const mockUser = { id: 'test-user-456', email: 'test@example.com' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };
      const mockSignal = new AbortController().signal;

      mockReinitMCPServer.mockResolvedValue({
        availableTools: {
          [`test-tool${D}test-server`]: {
            function: {
              description: 'Test tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        },
      });

      // Call without availableTools to trigger reinit
      await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        signal: mockSignal,
        userMCPAuthMap: {},
        availableTools: undefined, // Force reinit
      });

      // Verify reinitMCPServer was called with the user
      expect(mockReinitMCPServer).toHaveBeenCalledWith(
        expect.objectContaining({
          user: mockUser,
          serverName: 'test-server',
        }),
      );
      expect(mockReinitMCPServer.mock.calls[0][0].user).toBe(mockUser);
    });

    it('should not call reinitMCPServer when tool is in cache', async () => {
      const mockUser = { id: 'test-user-789' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      const availableTools = {
        [`test-tool${D}test-server`]: {
          function: {
            description: 'Cached tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      };

      await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: availableTools,
      });

      // Verify reinitMCPServer was NOT called since tool was in cache
      expect(mockReinitMCPServer).not.toHaveBeenCalled();
    });
  });

  describe('reinitMCPServer (via reconnectServer)', () => {
    it('should always receive user parameter when called from createMCPTools', async () => {
      const mockUser = { id: 'user-001', role: 'admin' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // Track all calls to reinitMCPServer
      const reinitCalls = [];
      mockReinitMCPServer.mockImplementation((params) => {
        reinitCalls.push(params);
        return Promise.resolve({
          tools: [{ name: 'tool1' }, { name: 'tool2' }],
          availableTools: {
            [`tool1${D}server1`]: { function: { description: 'Tool 1', parameters: {} } },
            [`tool2${D}server1`]: { function: { description: 'Tool 2', parameters: {} } },
          },
        });
      });

      await createMCPTools({
        res: mockRes,
        user: mockUser,
        serverName: 'server1',
        provider: 'anthropic',
        userMCPAuthMap: {},
      });

      // Verify all calls to reinitMCPServer had the user
      expect(reinitCalls.length).toBeGreaterThan(0);
      reinitCalls.forEach((call) => {
        expect(call.user).toBe(mockUser);
        expect(call.user.id).toBe('user-001');
      });
    });

    it('should always receive user parameter when called from createMCPTool', async () => {
      const mockUser = { id: 'user-002', permissions: ['read', 'write'] };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // Track all calls to reinitMCPServer
      const reinitCalls = [];
      mockReinitMCPServer.mockImplementation((params) => {
        reinitCalls.push(params);
        return Promise.resolve({
          availableTools: {
            [`my-tool${D}my-server`]: {
              function: { description: 'My Tool', parameters: {} },
            },
          },
        });
      });

      await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `my-tool${D}my-server`,
        provider: 'google',
        userMCPAuthMap: {},
        availableTools: undefined, // Force reinit
      });

      // Verify the call to reinitMCPServer had the user
      expect(reinitCalls.length).toBe(1);
      expect(reinitCalls[0].user).toBe(mockUser);
      expect(reinitCalls[0].user.id).toBe('user-002');
    });
  });

  describe('Runtime domain validation', () => {
    it('should skip tool creation when domain is not allowed', async () => {
      const mockUser = { id: 'domain-test-user', role: 'user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // Mock server config with URL (remote server)
      mockRegistryInstance.getServerConfig.mockResolvedValue({
        url: 'https://disallowed-domain.com/sse',
      });

      // Mock getAppConfig to return domain restrictions
      mockGetAppConfig.mockResolvedValue({
        mcpSettings: { allowedDomains: ['allowed-domain.com'] },
      });

      // Mock domain validation to return false (domain not allowed)
      mockIsMCPDomainAllowed.mockResolvedValueOnce(false);

      const result = await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: {
          [`test-tool${D}test-server`]: {
            function: {
              description: 'Test tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        },
      });

      // Should return undefined for disallowed domain
      expect(result).toBeUndefined();

      // Should not call reinitMCPServer since domain check failed
      expect(mockReinitMCPServer).not.toHaveBeenCalled();

      // Verify getAppConfig was called with user role
      expect(mockGetAppConfig).toHaveBeenCalledWith({ role: 'user' });

      // Verify domain validation was called with correct parameters
      // getMergedMCPDomainConfig defaults filterMode to 'denylist' when admin settings
      // don't specify mcpDomainFilterMode, so the third argument is 'denylist'.
      // The fourth argument is ssrfExemptions (yaml allowedDomains).
      expect(mockIsMCPDomainAllowed).toHaveBeenCalledWith(
        { url: 'https://disallowed-domain.com/sse' },
        [],
        'denylist',
        ['allowed-domain.com'],
      );
    });

    it('should use only admin domains as the denylist while retaining yaml SSRF exemptions', async () => {
      const mockUser = { id: 'domain-test-user', role: 'user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      mockRegistryInstance.getServerConfig.mockResolvedValue({
        url: 'http://192.168.50.4:8769/mcp',
      });
      mockGetAppConfig.mockResolvedValue({
        mcpSettings: { allowedDomains: ['http://192.168.50.4:8769'] },
      });
      getEffectiveAppSettings.mockResolvedValueOnce({
        mcpAllowedDomains: ['blocked-domain.com'],
        mcpDomainFilterMode: 'denylist',
      });
      mockIsMCPDomainAllowed.mockResolvedValueOnce(true);

      await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `search_videos${D}youtube-search`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: {
          [`search_videos${D}youtube-search`]: {
            function: {
              description: 'Search YouTube videos',
              parameters: { type: 'object', properties: {} },
            },
          },
        },
      });

      expect(mockIsMCPDomainAllowed).toHaveBeenCalledWith(
        { url: 'http://192.168.50.4:8769/mcp' },
        ['blocked-domain.com'],
        'denylist',
        ['http://192.168.50.4:8769'],
      );
    });

    it('should merge yaml and admin domains in allowlist mode', async () => {
      const mockUser = { id: 'domain-test-user', role: 'user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      mockRegistryInstance.getServerConfig.mockResolvedValue({
        url: 'https://allowed-domain.com/sse',
      });
      mockGetAppConfig.mockResolvedValue({
        mcpSettings: { allowedDomains: ['yaml-allowed.com'] },
      });
      getEffectiveAppSettings.mockResolvedValueOnce({
        mcpAllowedDomains: ['admin-allowed.com'],
        mcpDomainFilterMode: 'allowlist',
      });
      mockIsMCPDomainAllowed.mockResolvedValueOnce(true);

      await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: {
          [`test-tool${D}test-server`]: {
            function: {
              description: 'Test tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        },
      });

      expect(mockIsMCPDomainAllowed).toHaveBeenCalledWith(
        { url: 'https://allowed-domain.com/sse' },
        ['yaml-allowed.com', 'admin-allowed.com'],
        'allowlist',
        ['yaml-allowed.com'],
      );
    });

    it('should allow tool creation when domain is allowed', async () => {
      const mockUser = { id: 'domain-test-user', role: 'admin' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // Mock server config with URL (remote server)
      mockRegistryInstance.getServerConfig.mockResolvedValue({
        url: 'https://allowed-domain.com/sse',
      });

      // Mock getAppConfig to return domain restrictions
      mockGetAppConfig.mockResolvedValue({
        mcpSettings: { allowedDomains: ['allowed-domain.com'] },
      });

      // Mock domain validation to return true (domain allowed)
      mockIsMCPDomainAllowed.mockResolvedValueOnce(true);

      const availableTools = {
        [`test-tool${D}test-server`]: {
          function: {
            description: 'Test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      };

      const result = await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools,
      });

      // Should create tool successfully
      expect(result).toBeDefined();

      // Verify getAppConfig was called with user role
      expect(mockGetAppConfig).toHaveBeenCalledWith({ role: 'admin' });
    });

    it('should skip domain validation for stdio transports (no URL)', async () => {
      const mockUser = { id: 'stdio-test-user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // Mock server config without URL (stdio transport)
      mockRegistryInstance.getServerConfig.mockResolvedValue({
        command: 'npx',
        args: ['@modelcontextprotocol/server'],
      });

      // Mock getAppConfig (should not be called for stdio)
      mockGetAppConfig.mockResolvedValue({
        mcpSettings: { allowedDomains: ['restricted-domain.com'] },
      });

      const availableTools = {
        [`test-tool${D}test-server`]: {
          function: {
            description: 'Test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      };

      const result = await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools,
      });

      // Should create tool successfully without domain check
      expect(result).toBeDefined();

      // Should not call getAppConfig or isMCPDomainAllowed for stdio transport (no URL)
      expect(mockGetAppConfig).not.toHaveBeenCalled();
      expect(mockIsMCPDomainAllowed).not.toHaveBeenCalled();
    });

    it('should return empty array from createMCPTools when domain is not allowed', async () => {
      const mockUser = { id: 'domain-test-user', role: 'user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // Mock server config with URL (remote server)
      const serverConfig = { url: 'https://disallowed-domain.com/sse' };
      mockRegistryInstance.getServerConfig.mockResolvedValue(serverConfig);

      // Mock getAppConfig to return domain restrictions
      mockGetAppConfig.mockResolvedValue({
        mcpSettings: { allowedDomains: ['allowed-domain.com'] },
      });

      // Mock domain validation to return false (domain not allowed)
      mockIsMCPDomainAllowed.mockResolvedValueOnce(false);

      const result = await createMCPTools({
        res: mockRes,
        user: mockUser,
        serverName: 'test-server',
        provider: 'openai',
        userMCPAuthMap: {},
        config: serverConfig,
      });

      // Should return empty array for disallowed domain
      expect(result).toEqual([]);

      // Should not call reinitMCPServer since domain check failed early
      expect(mockReinitMCPServer).not.toHaveBeenCalled();

      // Verify getAppConfig was called with user role
      expect(mockGetAppConfig).toHaveBeenCalledWith({ role: 'user' });
    });

    it('should use user role when fetching domain restrictions', async () => {
      const adminUser = { id: 'admin-user', role: 'admin' };
      const regularUser = { id: 'regular-user', role: 'user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      mockRegistryInstance.getServerConfig.mockResolvedValue({
        url: 'https://some-domain.com/sse',
      });

      // Mock different responses based on role
      mockGetAppConfig
        .mockResolvedValueOnce({ mcpSettings: { allowedDomains: ['admin-allowed.com'] } })
        .mockResolvedValueOnce({ mcpSettings: { allowedDomains: ['user-allowed.com'] } });

      mockIsMCPDomainAllowed.mockResolvedValue(true);

      const availableTools = {
        [`test-tool${D}test-server`]: {
          function: {
            description: 'Test tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      };

      // Call with admin user
      await createMCPTool({
        res: mockRes,
        user: adminUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools,
      });

      // Reset and call with regular user
      mockRegistryInstance.getServerConfig.mockResolvedValue({
        url: 'https://some-domain.com/sse',
      });

      await createMCPTool({
        res: mockRes,
        user: regularUser,
        toolKey: `test-tool${D}test-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools,
      });

      // Verify getAppConfig was called with correct roles
      expect(mockGetAppConfig).toHaveBeenNthCalledWith(1, { role: 'admin' });
      expect(mockGetAppConfig).toHaveBeenNthCalledWith(2, { role: 'user' });
    });
  });

  describe('createUnavailableToolStub', () => {
    it('should return a tool whose _call returns a valid CONTENT_AND_ARTIFACT two-tuple', async () => {
      const stub = createUnavailableToolStub('myTool', 'myServer');
      // invoke() goes through langchain's base tool, which checks responseFormat.
      // CONTENT_AND_ARTIFACT requires [content, artifact] — a bare string would throw:
      //   "Tool response format is "content_and_artifact" but the output was not a two-tuple"
      const result = await stub.invoke({});
      // If we reach here without throwing, the two-tuple format is correct.
      // invoke() returns the content portion of [content, artifact] as a string.
      expect(result).toContain('temporarily unavailable');
    });
  });

  describe('negative tool cache and throttle interaction', () => {
    it('should cache tool as missing even when throttled (cross-user dedup)', async () => {
      const mockUser = { id: 'throttle-test-user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // First call: reconnect succeeds but tool not found
      mockReinitMCPServer.mockResolvedValueOnce({
        availableTools: {},
      });

      await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `missing-tool${D}cache-dedup-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: undefined,
      });

      // Second call within 10s for DIFFERENT tool on same server:
      // reconnect is throttled (returns null), tool is still cached as missing.
      // This is intentional: the cache acts as cross-user dedup since the
      // throttle is per-user-per-server and can't prevent N different users
      // from each triggering their own reconnect.
      const result2 = await createMCPTool({
        res: mockRes,
        user: mockUser,
        toolKey: `other-tool${D}cache-dedup-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: undefined,
      });

      expect(result2).toBeDefined();
      expect(result2.name).toContain('other-tool');
      expect(mockReinitMCPServer).toHaveBeenCalledTimes(1);
    });

    it('should prevent user B from triggering reconnect when user A already cached the tool', async () => {
      const userA = { id: 'cache-user-A' };
      const userB = { id: 'cache-user-B' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // User A: real reconnect, tool not found → cached
      mockReinitMCPServer.mockResolvedValueOnce({
        availableTools: {},
      });

      await createMCPTool({
        res: mockRes,
        user: userA,
        toolKey: `shared-tool${D}cross-user-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: undefined,
      });

      expect(mockReinitMCPServer).toHaveBeenCalledTimes(1);

      // User B requests the SAME tool within 10s.
      // The negative cache is keyed by toolKey (no user prefix), so user B
      // gets a cache hit and no reconnect fires. This is the cross-user
      // storm protection: without this, user B's unthrottled first request
      // would trigger a second reconnect to the same server.
      const result = await createMCPTool({
        res: mockRes,
        user: userB,
        toolKey: `shared-tool${D}cross-user-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: undefined,
      });

      expect(result).toBeDefined();
      expect(result.name).toContain('shared-tool');
      // reinitMCPServer still called only once — user B hit the cache
      expect(mockReinitMCPServer).toHaveBeenCalledTimes(1);
    });

    it('should prevent user B from triggering reconnect for throttle-cached tools', async () => {
      const userA = { id: 'storm-user-A' };
      const userB = { id: 'storm-user-B' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // User A: real reconnect for tool-1, tool not found → cached
      mockReinitMCPServer.mockResolvedValueOnce({
        availableTools: {},
      });

      await createMCPTool({
        res: mockRes,
        user: userA,
        toolKey: `tool-1${D}storm-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: undefined,
      });

      // User A: tool-2 on same server within 10s → throttled → cached from throttle
      await createMCPTool({
        res: mockRes,
        user: userA,
        toolKey: `tool-2${D}storm-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: undefined,
      });

      expect(mockReinitMCPServer).toHaveBeenCalledTimes(1);

      // User B requests tool-2 — gets cache hit from the throttle-cached entry.
      // Without this caching, user B would trigger a real reconnect since
      // user B has their own throttle key and hasn't reconnected yet.
      const result = await createMCPTool({
        res: mockRes,
        user: userB,
        toolKey: `tool-2${D}storm-server`,
        provider: 'openai',
        userMCPAuthMap: {},
        availableTools: undefined,
      });

      expect(result).toBeDefined();
      expect(result.name).toContain('tool-2');
      // Still only 1 real reconnect — user B was protected by the cache
      expect(mockReinitMCPServer).toHaveBeenCalledTimes(1);
    });
  });

  describe('createMCPTools throttle handling', () => {
    it('should return empty array with debug log when reconnect is throttled', async () => {
      const mockUser = { id: 'throttle-tools-user' };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      // First call: real reconnect
      mockReinitMCPServer.mockResolvedValueOnce({
        tools: [{ name: 'tool1' }],
        availableTools: {
          [`tool1${D}throttle-tools-server`]: {
            function: { description: 'Tool 1', parameters: {} },
          },
        },
      });

      await createMCPTools({
        res: mockRes,
        user: mockUser,
        serverName: 'throttle-tools-server',
        provider: 'openai',
        userMCPAuthMap: {},
      });

      // Second call within 10s — throttled
      const result = await createMCPTools({
        res: mockRes,
        user: mockUser,
        serverName: 'throttle-tools-server',
        provider: 'openai',
        userMCPAuthMap: {},
      });

      expect(result).toEqual([]);
      // reinitMCPServer called only once — second was throttled
      expect(mockReinitMCPServer).toHaveBeenCalledTimes(1);
      // Should log at debug level (not warn) for throttled case
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Reconnect throttled'));
    });
  });

  describe('User parameter integrity', () => {
    it('should preserve user object properties through the call chain', async () => {
      const complexUser = {
        id: 'complex-user',
        name: 'John Doe',
        email: 'john@example.com',
        metadata: { subscription: 'premium', settings: { theme: 'dark' } },
      };
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      let capturedUser = null;
      mockReinitMCPServer.mockImplementation((params) => {
        capturedUser = params.user;
        return Promise.resolve({
          tools: [{ name: 'test' }],
          availableTools: {
            [`test${D}server`]: { function: { description: 'Test', parameters: {} } },
          },
        });
      });

      await createMCPTools({
        res: mockRes,
        user: complexUser,
        serverName: 'server',
        provider: 'openai',
        userMCPAuthMap: {},
      });

      // Verify the complete user object was passed
      expect(capturedUser).toEqual(complexUser);
      expect(capturedUser.id).toBe('complex-user');
      expect(capturedUser.metadata.subscription).toBe('premium');
      expect(capturedUser.metadata.settings.theme).toBe('dark');
    });

    it('should throw error when user is null', async () => {
      const mockRes = { write: jest.fn(), flush: jest.fn() };

      mockReinitMCPServer.mockResolvedValue({
        tools: [],
        availableTools: {},
      });

      await expect(
        createMCPTools({
          res: mockRes,
          user: null,
          serverName: 'test-server',
          provider: 'openai',
          userMCPAuthMap: {},
        }),
      ).rejects.toThrow("Cannot read properties of null (reading 'id')");

      // Verify reinitMCPServer was not called due to early error
      expect(mockReinitMCPServer).not.toHaveBeenCalled();
    });
  });
});

describe('detectMCPConsentContinuation (VAL-MCP-004)', () => {
  it('detects pure JSON consent response with authorization_url and llm_instructions', () => {
    const consentJson = JSON.stringify({
      authorization_url:
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
      llm_instructions: 'Please share the authorization link with the user.',
    });
    const result = [[{ type: 'text', text: consentJson }], null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(true);
    expect(detection.authUrl).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
    );
    expect(detection.llmInstructions).toBe('Please share the authorization link with the user.');
  });

  it('detects consent response with authorization_url only (no llm_instructions)', () => {
    const consentJson = JSON.stringify({
      authorization_url: 'https://login.microsoftonline.com/authorize',
    });
    const result = [[{ type: 'text', text: consentJson }], null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(true);
    expect(detection.authUrl).toBe('https://login.microsoftonline.com/authorize');
    expect(detection.llmInstructions).toBeUndefined();
  });

  it('detects embedded JSON consent in multi-part text content', () => {
    const consentJson = JSON.stringify({
      authorization_url: 'https://cloud.arcade.dev/oauth2/authorize',
      llm_instructions: 'Provider authorization needed.',
    });
    const multiPartText = 'Microsoft Outlook authorization required.\n\n' + consentJson;
    const result = [[{ type: 'text', text: multiPartText }], null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(true);
    expect(detection.authUrl).toBe('https://cloud.arcade.dev/oauth2/authorize');
    expect(detection.llmInstructions).toBe('Provider authorization needed.');
  });

  it('detects consent from string content (non-array)', () => {
    const consentJson = JSON.stringify({
      authorization_url: 'https://login.microsoftonline.com/authorize',
      llm_instructions: 'Please authorize.',
    });
    const result = [consentJson, null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(true);
    expect(detection.authUrl).toBe('https://login.microsoftonline.com/authorize');
  });

  it('detects consent from multi-item array content', () => {
    const item1 = { type: 'text', text: 'Authorization required.' };
    const consentJson = JSON.stringify({
      authorization_url: 'https://login.microsoftonline.com/authorize',
    });
    const item2 = { type: 'text', text: consentJson };
    const result = [[item1, item2], null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(true);
  });

  it('returns isConsent: false for normal tool output', () => {
    const result = [[{ type: 'text', text: 'Here are your calendar events: ...' }], null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(false);
  });

  it('returns isConsent: false for empty content', () => {
    const result = [[], null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(false);
  });

  it('returns isConsent: false for non-array result', () => {
    expect(detectMCPConsentContinuation(null).isConsent).toBe(false);
    expect(detectMCPConsentContinuation(undefined).isConsent).toBe(false);
    expect(detectMCPConsentContinuation('text').isConsent).toBe(false);
  });

  it('returns isConsent: false for text mentioning authorization but without valid JSON URL', () => {
    const result = [
      [{ type: 'text', text: 'You need to complete the authorization process at the provider.' }],
      null,
    ];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(false);
  });

  it('does not false-positive on JSON with authorization_url as empty string', () => {
    const json = JSON.stringify({ authorization_url: '', llm_instructions: 'test' });
    const result = [[{ type: 'text', text: json }], null];
    const detection = detectMCPConsentContinuation(result);
    expect(detection.isConsent).toBe(false);
  });
});

describe('createMCPTool — consent delta emission (VAL-MCP-004)', () => {
  const { sendEvent, GenerationJobManager } = require('@librechat/api');
  const { GraphEvents } = require('@librechat/agents');

  let mockGetMCPManager;
  let mockGetFlowStateManager;
  let mockGetLogStores;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMCPAuthenticationRequirement.mockResolvedValue(null);

    mockGetMCPManager = require('~/config').getMCPManager;
    mockGetFlowStateManager = require('~/config').getFlowStateManager;
    mockGetLogStores = require('~/cache').getLogStores;

    const mockFlowManager = {
      getFlowState: jest.fn().mockResolvedValue(null),
      createFlowWithHandler: jest.fn().mockImplementation(async (_id, _type, handler) => {
        return handler();
      }),
    };

    mockGetLogStores.mockReturnValue({});
    mockGetFlowStateManager.mockReturnValue(mockFlowManager);
  });

  it('should return structured authentication-required without calling the transport', async () => {
    const mockCallTool = jest.fn();
    mockGetMCPManager.mockReturnValue({ callTool: mockCallTool });
    mockGetMCPAuthenticationRequirement.mockResolvedValue({
      success: false,
      code: 'MCP_AUTHENTICATION_REQUIRED',
      status: 'authentication_required',
      authenticationRequired: true,
      oauthRequired: true,
      serverName: 'arcade-microsoft',
      toolName: 'Microsoft_ListCalendarEvents',
      message: "MCP server 'arcade-microsoft' requires authentication",
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      url: 'https://api.arcade.dev/mcp/microsoft',
      requiresOAuth: true,
    });

    const toolInstance = await createMCPTool({
      res: { write: jest.fn(), flush: jest.fn() },
      user: { id: 'user-1', role: 'user' },
      toolKey: `Microsoft_ListCalendarEvents${D}arcade-microsoft`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools: {
        [`Microsoft_ListCalendarEvents${D}arcade-microsoft`]: {
          function: {
            description: 'List calendar events',
            parameters: { type: 'object', properties: {} },
          },
        },
      },
    });

    const result = await toolInstance.invoke(
      { input: 'list my events' },
      {
        configurable: {
          user: { id: 'user-1' },
          user_id: 'user-1',
          userMCPAuthMap: {},
        },
        metadata: {
          provider: 'openai',
          thread_id: 'thread-1',
          run_id: 'run-1',
        },
        toolCall: {
          id: 'call-auth-required',
          name: 'Microsoft_ListCalendarEvents',
          type: 'tool_call_chunk',
          args: '{}',
        },
      },
    );

    expect(JSON.stringify(result)).toContain('MCP_AUTHENTICATION_REQUIRED');
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it('should emit structured auth delta event when tool result contains consent continuation', async () => {
    const consentJson = JSON.stringify({
      authorization_url:
        'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
      llm_instructions: 'Please share the authorization link with the user.',
    });

    const mockCallTool = jest.fn().mockResolvedValue([[{ type: 'text', text: consentJson }], null]);

    mockGetMCPManager.mockReturnValue({
      callTool: mockCallTool,
    });

    const mockRes = { write: jest.fn(), flush: jest.fn() };

    mockRegistryInstance.getServerConfig.mockResolvedValue({
      url: 'https://api.arcade.dev/mcp/microsoft',
      requiresOAuth: true,
    });

    const availableTools = {
      [`Microsoft_ListCalendarEvents${D}arcade-microsoft`]: {
        function: {
          description: 'List calendar events',
          parameters: { type: 'object', properties: {} },
        },
      },
    };

    const toolInstance = await createMCPTool({
      res: mockRes,
      user: { id: 'user-1', role: 'user' },
      toolKey: `Microsoft_ListCalendarEvents${D}arcade-microsoft`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools,
    });

    expect(toolInstance).toBeDefined();

    // Invoke the tool to trigger the consent detection
    const toolResult = await toolInstance.invoke(
      { input: 'list my events' },
      {
        configurable: {
          user: { id: 'user-1' },
          user_id: 'user-1',
          userMCPAuthMap: {},
        },
        metadata: {
          provider: 'openai',
          thread_id: 'thread-1',
          run_id: 'run-1',
        },
        toolCall: {
          id: 'call-1',
          name: 'Microsoft_ListCalendarEvents',
          type: 'tool_call_chunk',
          args: '{}',
          stepId: 'step-1',
        },
      },
    );

    // The tool result should still contain the consent text (passed through to LLM)
    expect(toolResult).toBeDefined();

    // sendEvent should have been called with structured auth delta
    expect(sendEvent).toHaveBeenCalledWith(
      mockRes,
      expect.objectContaining({
        event: GraphEvents.ON_RUN_STEP_DELTA,
        data: expect.objectContaining({
          id: 'step-1',
          delta: expect.objectContaining({
            auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=abc',
            expires_at: expect.any(Number),
          }),
        }),
      }),
    );
  });

  it('should NOT emit auth delta for normal (non-consent) tool output', async () => {
    const normalOutput = 'Here are your calendar events for today: Meeting at 10am, Lunch at noon.';

    const mockCallTool = jest
      .fn()
      .mockResolvedValue([[{ type: 'text', text: normalOutput }], null]);

    mockGetMCPManager.mockReturnValue({
      callTool: mockCallTool,
    });

    const mockRes = { write: jest.fn(), flush: jest.fn() };

    mockRegistryInstance.getServerConfig.mockResolvedValue({
      url: 'https://api.arcade.dev/mcp/microsoft',
    });

    const availableTools = {
      [`Microsoft_ListCalendarEvents${D}arcade-microsoft`]: {
        function: {
          description: 'List calendar events',
          parameters: { type: 'object', properties: {} },
        },
      },
    };

    const toolInstance = await createMCPTool({
      res: mockRes,
      user: { id: 'user-1', role: 'user' },
      toolKey: `Microsoft_ListCalendarEvents${D}arcade-microsoft`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools,
    });

    await toolInstance.invoke(
      { input: 'list my events' },
      {
        configurable: {
          user: { id: 'user-1' },
          user_id: 'user-1',
          userMCPAuthMap: {},
        },
        metadata: {
          provider: 'openai',
          thread_id: 'thread-1',
          run_id: 'run-1',
        },
        toolCall: {
          id: 'call-2',
          name: 'Microsoft_ListCalendarEvents',
          type: 'tool_call_chunk',
          args: '{}',
          stepId: 'step-2',
        },
      },
    );

    // sendEvent should NOT have been called with auth delta for normal output
    const authCalls = sendEvent.mock.calls.filter(
      (call) =>
        call[1]?.event === GraphEvents.ON_RUN_STEP_DELTA && call[1]?.data?.delta?.auth != null,
    );
    expect(authCalls).toHaveLength(0);
  });

  it('should emit auth delta via GenerationJobManager.emitChunk when streamId is present', async () => {
    const consentJson = JSON.stringify({
      authorization_url: 'https://cloud.arcade.dev/oauth2/authorize',
      llm_instructions: 'Provider authorization needed.',
    });

    const mockCallTool = jest.fn().mockResolvedValue([[{ type: 'text', text: consentJson }], null]);

    mockGetMCPManager.mockReturnValue({
      callTool: mockCallTool,
    });

    const mockRes = { write: jest.fn(), flush: jest.fn() };

    mockRegistryInstance.getServerConfig.mockResolvedValue({
      url: 'https://api.arcade.dev/mcp/github',
    });

    const availableTools = {
      [`GitHub_ListRepos${D}arcade-github`]: {
        function: {
          description: 'List repos',
          parameters: { type: 'object', properties: {} },
        },
      },
    };

    // Create tool with streamId to test resumable stream path
    const toolInstance = await createMCPTool({
      res: mockRes,
      user: { id: 'user-1', role: 'user' },
      toolKey: `GitHub_ListRepos${D}arcade-github`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools,
      streamId: 'stream-123',
    });

    await toolInstance.invoke(
      { input: 'list repos' },
      {
        configurable: {
          user: { id: 'user-1' },
          user_id: 'user-1',
          userMCPAuthMap: {},
        },
        metadata: {
          provider: 'openai',
          thread_id: 'thread-1',
          run_id: 'run-1',
        },
        toolCall: {
          id: 'call-3',
          name: 'GitHub_ListRepos',
          type: 'tool_call_chunk',
          args: '{}',
          stepId: 'step-3',
        },
      },
    );

    // When streamId is present, GenerationJobManager.emitChunk should be used
    expect(GenerationJobManager.emitChunk).toHaveBeenCalledWith(
      'stream-123',
      expect.objectContaining({
        event: GraphEvents.ON_RUN_STEP_DELTA,
        data: expect.objectContaining({
          id: 'step-3',
          delta: expect.objectContaining({
            auth: 'https://cloud.arcade.dev/oauth2/authorize',
          }),
        }),
      }),
    );
  });
});

describe('createMCPTool — invocation-time OAuth gating respects requiresOAuth (VAL-MCP-001)', () => {
  let mockGetMCPManager;
  let mockGetFlowStateManager;
  let mockGetLogStores;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetMCPManager = require('~/config').getMCPManager;
    mockGetFlowStateManager = require('~/config').getFlowStateManager;
    mockGetLogStores = require('~/cache').getLogStores;

    const mockFlowManager = {
      getFlowState: jest.fn().mockResolvedValue(null),
      createFlowWithHandler: jest.fn().mockImplementation(async (_id, _type, handler) => {
        return handler();
      }),
    };

    mockGetLogStores.mockReturnValue({});
    mockGetFlowStateManager.mockReturnValue(mockFlowManager);
  });

  it('should NOT wrap 401 errors as "OAuth authentication required" for non-OAuth servers', async () => {
    const mockCallTool = jest.fn().mockRejectedValue(new Error('Non-200 status code (401)'));

    mockGetMCPManager.mockReturnValue({
      callTool: mockCallTool,
    });

    const mockRes = { write: jest.fn(), flush: jest.fn() };

    // Non-OAuth server config
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      url: 'http://localhost:4567/mcp',
      requiresOAuth: false,
    });

    const availableTools = {
      [`echo${D}local-server`]: {
        function: {
          description: 'Echo tool',
          parameters: { type: 'object', properties: {} },
        },
      },
    };

    const toolInstance = await createMCPTool({
      res: mockRes,
      user: { id: 'user-1', role: 'user' },
      toolKey: `echo${D}local-server`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools,
    });

    expect(toolInstance).toBeDefined();

    // Invoke the tool — should get generic error, NOT OAuth error
    await expect(
      toolInstance.invoke(
        { input: 'test' },
        {
          configurable: {
            user: { id: 'user-1' },
            user_id: 'user-1',
            userMCPAuthMap: {},
          },
          metadata: {
            provider: 'openai',
            thread_id: 'thread-1',
            run_id: 'run-1',
          },
          toolCall: {
            id: 'call-1',
            name: 'echo',
            type: 'tool_call_chunk',
            args: '{}',
          },
        },
      ),
    ).rejects.toThrow(/tool call failed/);

    // Crucially, the error should NOT say "OAuth authentication required"
    await expect(
      toolInstance.invoke(
        { input: 'test' },
        {
          configurable: {
            user: { id: 'user-1' },
            user_id: 'user-1',
            userMCPAuthMap: {},
          },
          metadata: {
            provider: 'openai',
            thread_id: 'thread-1',
            run_id: 'run-1',
          },
          toolCall: {
            id: 'call-2',
            name: 'echo',
            type: 'tool_call_chunk',
            args: '{}',
          },
        },
      ),
    ).rejects.not.toThrow(/OAuth authentication required/);
  });

  it('should wrap 401 errors as "OAuth authentication required" for OAuth servers', async () => {
    const mockCallTool = jest.fn().mockRejectedValue(new Error('Non-200 status code (401)'));

    mockGetMCPManager.mockReturnValue({
      callTool: mockCallTool,
    });

    const mockRes = { write: jest.fn(), flush: jest.fn() };

    // OAuth server config
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      url: 'https://api.arcade.dev/mcp/microsoft',
      requiresOAuth: true,
    });

    const availableTools = {
      [`ListEvents${D}arcade-microsoft`]: {
        function: {
          description: 'List events',
          parameters: { type: 'object', properties: {} },
        },
      },
    };

    const toolInstance = await createMCPTool({
      res: mockRes,
      user: { id: 'user-1', role: 'user' },
      toolKey: `ListEvents${D}arcade-microsoft`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools,
    });

    expect(toolInstance).toBeDefined();

    // Invoke the tool — should get OAuth error for OAuth server
    await expect(
      toolInstance.invoke(
        { input: 'test' },
        {
          configurable: {
            user: { id: 'user-1' },
            user_id: 'user-1',
            userMCPAuthMap: {},
          },
          metadata: {
            provider: 'openai',
            thread_id: 'thread-1',
            run_id: 'run-1',
          },
          toolCall: {
            id: 'call-1',
            name: 'ListEvents',
            type: 'tool_call_chunk',
            args: '{}',
          },
        },
      ),
    ).rejects.toThrow(/OAuth authentication required/);
  });

  it('should NOT wrap 401 as OAuth when server has no requiresOAuth or oauthMetadata', async () => {
    const mockCallTool = jest.fn().mockRejectedValue(new Error('authentication timeout'));

    mockGetMCPManager.mockReturnValue({
      callTool: mockCallTool,
    });

    const mockRes = { write: jest.fn(), flush: jest.fn() };

    // Server config with neither requiresOAuth nor oauthMetadata (e.g., stdio server)
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    const availableTools = {
      [`run${D}local-stdio`]: {
        function: {
          description: 'Run command',
          parameters: { type: 'object', properties: {} },
        },
      },
    };

    const toolInstance = await createMCPTool({
      res: mockRes,
      user: { id: 'user-1', role: 'user' },
      toolKey: `run${D}local-stdio`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools,
    });

    expect(toolInstance).toBeDefined();

    // Invoke — generic error, NOT OAuth
    await expect(
      toolInstance.invoke(
        { input: 'test' },
        {
          configurable: {
            user: { id: 'user-1' },
            user_id: 'user-1',
            userMCPAuthMap: {},
          },
          metadata: {
            provider: 'openai',
            thread_id: 'thread-1',
            run_id: 'run-1',
          },
          toolCall: {
            id: 'call-1',
            name: 'run',
            type: 'tool_call_chunk',
            args: '{}',
          },
        },
      ),
    ).rejects.toThrow(/tool call failed/);
  });

  it('should still wrap as OAuth when server has oauthMetadata even if requiresOAuth is false', async () => {
    const mockCallTool = jest.fn().mockRejectedValue(new Error('Non-200 status code (401)'));

    mockGetMCPManager.mockReturnValue({
      callTool: mockCallTool,
    });

    const mockRes = { write: jest.fn(), flush: jest.fn() };

    // Server with oauthMetadata but requiresOAuth=false (e.g., Arcade-style)
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      url: 'https://arcade.example.com/mcp',
      requiresOAuth: false,
      oauthMetadata: { authorization_servers: ['https://auth.example.com'] },
    });

    const availableTools = {
      [`search${D}arcade-server`]: {
        function: {
          description: 'Search',
          parameters: { type: 'object', properties: {} },
        },
      },
    };

    const toolInstance = await createMCPTool({
      res: mockRes,
      user: { id: 'user-1', role: 'user' },
      toolKey: `search${D}arcade-server`,
      provider: 'openai',
      userMCPAuthMap: {},
      availableTools,
    });

    expect(toolInstance).toBeDefined();

    // Invoke — should get OAuth error because oauthMetadata is present
    await expect(
      toolInstance.invoke(
        { input: 'test' },
        {
          configurable: {
            user: { id: 'user-1' },
            user_id: 'user-1',
            userMCPAuthMap: {},
          },
          metadata: {
            provider: 'openai',
            thread_id: 'thread-1',
            run_id: 'run-1',
          },
          toolCall: {
            id: 'call-1',
            name: 'search',
            type: 'tool_call_chunk',
            args: '{}',
          },
        },
      ),
    ).rejects.toThrow(/OAuth authentication required/);
  });
});
