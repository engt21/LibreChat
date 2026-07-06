/**
 * Tests for getMCPTools controller — specifically the pre-consent tool discovery
 * and auth state surfacing required by VAL-MCP-004.
 *
 * VAL-MCP-004: Against Arcade-hosted Microsoft tools, LibreChat must prove MCP
 * initialization succeeds by listing tools before provider consent, and a concrete
 * tool invocation must surface `authorization_url` and/or `llm_instructions`
 * continuation metadata instead of marking the MCP server unavailable or
 * initialization failed.
 */

jest.mock('@librechat/data-schemas', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('librechat-data-provider', () => ({
  CacheKeys: { FLOWS: 'flows' },
  Constants: {
    mcp_prefix: 'mcp_',
    mcp_delimiter: '___',
  },
  MCPServerUserInputSchema: { safeParse: jest.fn(() => ({ success: true, data: {} })) },
}));

jest.mock('@librechat/api', () => ({
  MCPErrorCodes: {
    DOMAIN_NOT_ALLOWED: 'MCP_DOMAIN_NOT_ALLOWED',
    INSPECTION_FAILED: 'MCP_INSPECTION_FAILED',
  },
  redactServerSecrets: jest.fn((c) => c),
  redactAllServerSecrets: jest.fn((c) => c),
  isMCPDomainNotAllowedError: jest.fn(() => false),
  isMCPInspectionFailedError: jest.fn(() => false),
}));

const mockGetMCPManager = jest.fn();
const mockGetMCPServersRegistry = jest.fn();
const mockGetFlowStateManager = jest.fn();
jest.mock('~/config', () => ({
  getMCPManager: (...args) => mockGetMCPManager(...args),
  getMCPServersRegistry: (...args) => mockGetMCPServersRegistry(...args),
  getFlowStateManager: (...args) => mockGetFlowStateManager(...args),
}));

const mockReinitMCPServer = jest.fn();
jest.mock('~/server/services/Tools/mcp', () => ({
  reinitMCPServer: (...args) => mockReinitMCPServer(...args),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(() => ({})),
}));

const mockDiscoverAuthServerMetadata = jest.fn();
jest.mock('@modelcontextprotocol/sdk/client/auth.js', () => ({
  discoverAuthorizationServerMetadata: (...args) => mockDiscoverAuthServerMetadata(...args),
}));

jest.mock('~/models', () => ({
  findMCPServerByServerName: jest.fn(),
}));

const mockGetMCPServerTools = jest.fn();
const mockCacheMCPServerTools = jest.fn();
jest.mock('~/server/services/Config', () => ({
  getMCPServerTools: (...args) => mockGetMCPServerTools(...args),
  cacheMCPServerTools: (...args) => mockCacheMCPServerTools(...args),
}));

const { getMCPTools } = require('../mcp');

function createReq(userId = 'user-1') {
  return { user: { id: userId } };
}

function createRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const mockRegistryInstance = {
  getAllServerConfigs: jest.fn(),
  getServerConfig: jest.fn(),
  getOAuthServers: jest.fn().mockResolvedValue(new Set()),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetMCPServersRegistry.mockReturnValue(mockRegistryInstance);
  mockGetMCPServerTools.mockResolvedValue(null);
  mockCacheMCPServerTools.mockResolvedValue(undefined);
  mockGetFlowStateManager.mockReturnValue({});
  mockReinitMCPServer.mockResolvedValue(undefined);
});

describe('getMCPTools — pre-consent tool discovery (VAL-MCP-004)', () => {
  it('should return tools + authState for pending-consent OAuth server via discoverServerTools', async () => {
    // Simulate an Arcade-hosted OAuth server that has tools discoverable before consent
    const rawDiscoveredTools = [
      {
        name: 'Microsoft_ListCalendarEvents',
        description: 'List calendar events',
        inputSchema: { type: 'object' },
      },
      {
        name: 'Microsoft_SendEmail',
        description: 'Send an email',
        inputSchema: { type: 'object' },
      },
    ];

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
      iconPath: '/icons/arcade.svg',
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    // getServerToolFunctions returns null (no connection established yet)
    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: rawDiscoveredTools,
        oauthRequired: true,
        oauthUrl: 'https://login.microsoftonline.com/authorize',
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-microsoft'];
    expect(server).toBeDefined();

    // Tools should be discovered even before consent
    expect(server.tools).toHaveLength(2);
    expect(server.tools[0].name).toBe('Microsoft_ListCalendarEvents');
    expect(server.tools[1].name).toBe('Microsoft_SendEmail');

    // Auth state should indicate pending consent
    expect(server.authState).toBe('pending_consent');

    // Continuation metadata should be present
    expect(server.oauthUrl).toBe('https://login.microsoftonline.com/authorize');

    // discoverServerTools must receive user context for per-user config lookup
    expect(mockManager.discoverServerTools).toHaveBeenCalledWith(
      expect.objectContaining({ serverName: 'arcade-microsoft', user: { id: 'user-1' } }),
    );
  });

  it('should classify authenticated availableTools as authorized before anonymous discovery', async () => {
    const availableTools = {
      'MicrosoftOutlookMail_SearchEmails___microsoft-tools': {
        type: 'function',
        function: {
          name: 'MicrosoftOutlookMail_SearchEmails___microsoft-tools',
          description: 'Search Outlook mail',
          parameters: { type: 'object' },
        },
      },
    };

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'microsoft-tools': {
        type: 'streamable-http',
        url: 'https://api.arcade.dev/mcp/microsoft-tools-read',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'streamable-http',
      url: 'https://api.arcade.dev/mcp/microsoft-tools-read',
      requiresOAuth: true,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['microsoft-tools']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn(),
    };
    mockGetMCPManager.mockReturnValue(mockManager);
    mockReinitMCPServer.mockResolvedValue({
      oauthRequired: false,
      availableTools,
      tools: [],
    });

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['microsoft-tools'];
    expect(server).toBeDefined();
    expect(server.authState).toBe('authorized');
    expect(server.tools).toEqual([
      {
        name: 'MicrosoftOutlookMail_SearchEmails',
        pluginKey: 'MicrosoftOutlookMail_SearchEmails___microsoft-tools',
        description: 'Search Outlook mail',
      },
    ]);
    expect(mockReinitMCPServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'microsoft-tools',
        returnOnOAuth: true,
      }),
    );
    expect(mockManager.discoverServerTools).not.toHaveBeenCalled();
  });

  it('should surface authentication-required without falling back to transport discovery', async () => {
    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'microsoft-tools': {
        type: 'streamable-http',
        url: 'https://api.arcade.dev/mcp/microsoft-tools-read',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'streamable-http',
      url: 'https://api.arcade.dev/mcp/microsoft-tools-read',
      requiresOAuth: true,
      oauthMetadata: {
        authorization_servers: ['https://login.microsoftonline.com/common/v2.0'],
      },
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['microsoft-tools']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn(),
    };
    mockGetMCPManager.mockReturnValue(mockManager);
    mockReinitMCPServer.mockResolvedValue({
      success: false,
      code: 'MCP_AUTHENTICATION_REQUIRED',
      status: 'authentication_required',
      authenticationRequired: true,
      oauthRequired: true,
      oauthUrl: null,
      tools: null,
      availableTools: null,
      serverName: 'microsoft-tools',
      message: "MCP server 'microsoft-tools' requires authentication",
    });

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.servers['microsoft-tools']).toEqual(
      expect.objectContaining({
        authState: 'not_connected',
        authenticationRequired: expect.objectContaining({
          code: 'MCP_AUTHENTICATION_REQUIRED',
          status: 'authentication_required',
        }),
      }),
    );
    expect(mockManager.discoverServerTools).not.toHaveBeenCalled();
    expect(mockDiscoverAuthServerMetadata).not.toHaveBeenCalled();
  });

  it('should surface authState "authorized" for fully authorized OAuth servers', async () => {
    // Server has an active connection with tools
    const processedTools = {
      'Microsoft_ListCalendarEvents___arcade-microsoft': {
        type: 'function',
        function: {
          name: 'Microsoft_ListCalendarEvents___arcade-microsoft',
          description: 'List calendar events',
          parameters: { type: 'object' },
        },
      },
    };

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
      iconPath: '/icons/arcade.svg',
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(processedTools),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-microsoft'];
    expect(server).toBeDefined();
    expect(server.tools).toHaveLength(1);
    expect(server.authState).toBe('authorized');
  });

  it('should surface authState "not_connected" when no tools discovered and no OAuth URL', async () => {
    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: null,
        oauthRequired: true,
        oauthUrl: null,
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-microsoft'];
    expect(server).toBeDefined();
    expect(server.authState).toBe('not_connected');
    expect(server.tools).toHaveLength(0);
  });

  it('should not surface authState for non-OAuth servers', async () => {
    const processedTools = {
      'do_something___local-server': {
        type: 'function',
        function: {
          name: 'do_something___local-server',
          description: 'Does something',
          parameters: { type: 'object' },
        },
      },
    };

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'local-server': {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set());

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(processedTools),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['local-server'];
    expect(server).toBeDefined();
    expect(server.tools).toHaveLength(1);
    // Non-OAuth servers should not have authState
    expect(server.authState).toBeUndefined();
    expect(server.oauthUrl).toBeUndefined();
  });

  it('should fall back to stored config toolFunctions when cache and connection are empty', async () => {
    const storedToolFunctions = {
      'list_files___local-server': {
        type: 'function',
        function: {
          name: 'list_files___local-server',
          description: 'List files',
          parameters: { type: 'object' },
        },
      },
    };

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'local-server': {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      toolFunctions: storedToolFunctions,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set());

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['local-server'];
    expect(server).toBeDefined();
    expect(server.tools).toEqual([
      {
        name: 'list_files',
        pluginKey: 'list_files___local-server',
        description: 'List files',
      },
    ]);
  });

  it('should fall back to pre-consent reinit when discovery has no tools and no oauthUrl', async () => {
    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: null,
        oauthRequired: true,
        oauthUrl: null,
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);
    mockReinitMCPServer.mockResolvedValue({
      oauthRequired: true,
      oauthUrl: 'https://login.microsoftonline.com/authorize',
      availableTools: {
        'Microsoft_ListCalendarEvents___arcade-microsoft': {
          type: 'function',
          function: {
            name: 'Microsoft_ListCalendarEvents___arcade-microsoft',
            description: 'List calendar events',
            parameters: { type: 'object' },
          },
        },
      },
    });

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-microsoft'];
    expect(server).toBeDefined();
    expect(server.authState).toBe('pending_consent');
    expect(server.oauthUrl).toBe('https://login.microsoftonline.com/authorize');
    expect(server.tools).toEqual([
      {
        name: 'Microsoft_ListCalendarEvents',
        pluginKey: 'Microsoft_ListCalendarEvents___arcade-microsoft',
        description: 'List calendar events',
      },
    ]);
    expect(mockReinitMCPServer).toHaveBeenCalledWith(
      expect.objectContaining({
        serverName: 'arcade-microsoft',
        returnOnOAuth: true,
      }),
    );
  });

  it('should fall back to discoverServerTools when getServerToolFunctions throws for OAuth server', async () => {
    const rawDiscoveredTools = [
      {
        name: 'GitHub_ListRepos',
        description: 'List repositories',
        inputSchema: { type: 'object' },
      },
    ];

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-github': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/github-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/github-tools',
      requiresOAuth: true,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-github']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockRejectedValue(new Error('No user connection')),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: rawDiscoveredTools,
        oauthRequired: true,
        oauthUrl: null,
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-github'];
    expect(server).toBeDefined();
    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe('GitHub_ListRepos');
    expect(server.authState).toBe('pending_consent');
    expect(mockManager.discoverServerTools).toHaveBeenCalledWith(
      expect.objectContaining({ serverName: 'arcade-github', user: { id: 'user-1' } }),
    );
  });

  it('should handle mixed OAuth and non-OAuth servers correctly', async () => {
    const localTools = {
      'search___local-server': {
        type: 'function',
        function: {
          name: 'search___local-server',
          description: 'Search function',
          parameters: { type: 'object' },
        },
      },
    };
    const arcadeDiscoveredTools = [
      {
        name: 'Microsoft_ListEmails',
        description: 'List emails',
        inputSchema: { type: 'object' },
      },
    ];

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'local-server': { type: 'stdio', command: 'node', args: [] },
      'arcade-microsoft': { type: 'sse', url: 'https://api.arcade.dev', requiresOAuth: true },
    });
    mockRegistryInstance.getServerConfig.mockImplementation(async (name) => {
      if (name === 'local-server') {
        return { type: 'stdio', command: 'node', args: [] };
      }
      return { type: 'sse', url: 'https://api.arcade.dev', requiresOAuth: true };
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockImplementation(async (_userId, serverName) => {
        if (serverName === 'local-server') {
          return localTools;
        }
        return null; // OAuth server not yet connected
      }),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: arcadeDiscoveredTools,
        oauthRequired: true,
        oauthUrl: 'https://login.microsoftonline.com/authorize',
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);

    // Non-OAuth server
    const localServer = res.body.servers['local-server'];
    expect(localServer).toBeDefined();
    expect(localServer.tools).toHaveLength(1);
    expect(localServer.authState).toBeUndefined();

    // OAuth server with discovered tools
    const arcadeServer = res.body.servers['arcade-microsoft'];
    expect(arcadeServer).toBeDefined();
    expect(arcadeServer.tools).toHaveLength(1);
    expect(arcadeServer.authState).toBe('pending_consent');
    expect(arcadeServer.oauthUrl).toBe('https://login.microsoftonline.com/authorize');
  });

  it('should resolve oauthUrl from authorization_servers when discovery and reinit return no URL (VAL-MCP-004)', async () => {
    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
      oauthMetadata: {
        authorization_servers: ['https://cloud.arcade.dev/oauth2'],
      },
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    // discoverServerTools returns tools but no oauthUrl
    const rawDiscoveredTools = [
      {
        name: 'Microsoft_ListCalendarEvents',
        description: 'List calendar events',
        inputSchema: { type: 'object' },
      },
    ];
    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: rawDiscoveredTools,
        oauthRequired: true,
        oauthUrl: null,
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    // reinitMCPServer also returns no oauthUrl
    mockReinitMCPServer.mockResolvedValue(undefined);

    // Mock auth server metadata discovery to return authorization_endpoint
    mockDiscoverAuthServerMetadata.mockResolvedValue({
      authorization_endpoint: 'https://cloud.arcade.dev/oauth2/authorize',
      token_endpoint: 'https://cloud.arcade.dev/oauth2/token',
      issuer: 'https://cloud.arcade.dev/oauth2',
    });

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-microsoft'];
    expect(server).toBeDefined();
    expect(server.tools).toHaveLength(1);
    expect(server.authState).toBe('pending_consent');
    // oauthUrl should be resolved from authorization_servers via server metadata discovery
    expect(server.oauthUrl).toBe('https://cloud.arcade.dev/oauth2/authorize');
    expect(mockDiscoverAuthServerMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://cloud.arcade.dev/oauth2' }),
    );
  });

  it('should fall back to authorization_server URL when metadata discovery fails (VAL-MCP-004)', async () => {
    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
      oauthMetadata: {
        authorization_servers: ['https://cloud.arcade.dev/oauth2'],
      },
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: null,
        oauthRequired: true,
        oauthUrl: null,
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    mockReinitMCPServer.mockResolvedValue(undefined);
    // Metadata discovery fails
    mockDiscoverAuthServerMetadata.mockRejectedValue(new Error('Network error'));

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-microsoft'];
    expect(server).toBeDefined();
    expect(server.authState).toBe('pending_consent');
    // Should fall back to the authorization_server URL itself
    expect(server.oauthUrl).toBe('https://cloud.arcade.dev/oauth2');
  });

  it('should cache pre-consent discovered raw tools for future fallback (VAL-MCP-004)', async () => {
    const rawDiscoveredTools = [
      {
        name: 'Microsoft_ListCalendarEvents',
        description: 'List calendar events',
        inputSchema: { type: 'object' },
      },
    ];

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: rawDiscoveredTools,
        oauthRequired: true,
        oauthUrl: 'https://login.microsoftonline.com/authorize',
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    // Verify cacheMCPServerTools was called with the converted raw tools
    expect(mockCacheMCPServerTools).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        serverName: 'arcade-microsoft',
        serverTools: expect.objectContaining({
          'Microsoft_ListCalendarEvents___arcade-microsoft': expect.objectContaining({
            type: 'function',
            function: expect.objectContaining({
              name: 'Microsoft_ListCalendarEvents___arcade-microsoft',
              description: 'List calendar events',
            }),
          }),
        }),
      }),
    );
  });

  it('should cache pre-consent discovered tool functions from reinit for future fallback (VAL-MCP-004)', async () => {
    const reinitToolFunctions = {
      'Microsoft_ListCalendarEvents___arcade-microsoft': {
        type: 'function',
        function: {
          name: 'Microsoft_ListCalendarEvents___arcade-microsoft',
          description: 'List calendar events',
          parameters: { type: 'object' },
        },
      },
    };

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    const mockManager = {
      getServerToolFunctions: jest.fn().mockResolvedValue(null),
      discoverServerTools: jest.fn().mockResolvedValue({
        tools: null,
        oauthRequired: true,
        oauthUrl: null,
      }),
    };
    mockGetMCPManager.mockReturnValue(mockManager);
    mockReinitMCPServer.mockResolvedValue({
      oauthRequired: true,
      oauthUrl: 'https://login.microsoftonline.com/authorize',
      availableTools: reinitToolFunctions,
    });

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    // Verify cacheMCPServerTools was called with the reinit-discovered tool functions
    expect(mockCacheMCPServerTools).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        serverName: 'arcade-microsoft',
        serverTools: reinitToolFunctions,
      }),
    );
  });

  it('should use cached tools on subsequent request after pre-consent discovery (VAL-MCP-004)', async () => {
    // Simulate cached tools being available from a previous pre-consent discovery
    const cachedTools = {
      'Microsoft_ListCalendarEvents___arcade-microsoft': {
        type: 'function',
        function: {
          name: 'Microsoft_ListCalendarEvents___arcade-microsoft',
          description: 'List calendar events',
          parameters: { type: 'object' },
        },
      },
    };

    mockRegistryInstance.getAllServerConfigs.mockResolvedValue({
      'arcade-microsoft': {
        type: 'sse',
        url: 'https://api.arcade.dev/mcp/microsoft-tools',
        requiresOAuth: true,
      },
    });
    mockRegistryInstance.getServerConfig.mockResolvedValue({
      type: 'sse',
      url: 'https://api.arcade.dev/mcp/microsoft-tools',
      requiresOAuth: true,
    });
    mockRegistryInstance.getOAuthServers.mockResolvedValue(new Set(['arcade-microsoft']));

    // Cache hit — previously discovered tools are available
    mockGetMCPServerTools.mockResolvedValue(cachedTools);

    const mockManager = {
      getServerToolFunctions: jest.fn(),
      discoverServerTools: jest.fn(),
    };
    mockGetMCPManager.mockReturnValue(mockManager);

    const req = createReq();
    const res = createRes();
    await getMCPTools(req, res);

    expect(res.statusCode).toBe(200);
    const server = res.body.servers['arcade-microsoft'];
    expect(server).toBeDefined();
    expect(server.tools).toHaveLength(1);
    expect(server.tools[0].name).toBe('Microsoft_ListCalendarEvents');

    // Should NOT have called getServerToolFunctions or discoverServerTools
    // because cache hit short-circuits
    expect(mockManager.getServerToolFunctions).not.toHaveBeenCalled();
    expect(mockManager.discoverServerTools).not.toHaveBeenCalled();
  });
});
