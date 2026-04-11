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
jest.mock('~/config', () => ({
  getMCPManager: (...args) => mockGetMCPManager(...args),
  getMCPServersRegistry: (...args) => mockGetMCPServersRegistry(...args),
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
});
