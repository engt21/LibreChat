const mockGetUserById = jest.fn();
const mockDeleteMessages = jest.fn();
const mockDeleteAllUserSessions = jest.fn();
const mockDeleteUserById = jest.fn();
const mockDeleteAllSharedLinks = jest.fn();
const mockDeletePresets = jest.fn();
const mockDeleteUserKey = jest.fn();
const mockDeleteConvos = jest.fn();
const mockDeleteFiles = jest.fn();
const mockGetFiles = jest.fn();
const mockUpdateUserPlugins = jest.fn();
const mockUpdateUser = jest.fn();
const mockFindToken = jest.fn();
const mockVerifyOTPOrBackupCode = jest.fn();
const mockDeleteUserPluginAuth = jest.fn();
const mockProcessDeleteRequest = jest.fn();
const mockDeleteToolCalls = jest.fn();
const mockDeleteUserAgents = jest.fn();
const mockDeleteUserPrompts = jest.fn();
const mockDeleteUserScheduledJobs = jest.fn();

jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), info: jest.fn() },
  webSearchKeys: [],
}));

jest.mock('librechat-data-provider', () => ({
  Tools: {},
  CacheKeys: {},
  Constants: { mcp_delimiter: '::', mcp_prefix: 'mcp_' },
  FileSources: {},
  ResourceType: { MCPSERVER: 'mcpServer' },
  PrincipalType: { USER: 'user', GROUP: 'group', PUBLIC: 'public', ROLE: 'role' },
  PermissionBits: { VIEW: 1, EDIT: 2, DELETE: 4, SHARE: 8 },
}));

jest.mock('@librechat/api', () => ({
  MCPOAuthHandler: {},
  MCPTokenStorage: {},
  normalizeHttpError: jest.fn(),
  extractWebSearchEnvVars: jest.fn(),
}));

jest.mock('~/models', () => ({
  deleteAllUserSessions: (...args) => mockDeleteAllUserSessions(...args),
  deleteAllSharedLinks: (...args) => mockDeleteAllSharedLinks(...args),
  updateUserPlugins: (...args) => mockUpdateUserPlugins(...args),
  deleteUserById: (...args) => mockDeleteUserById(...args),
  deleteMessages: (...args) => mockDeleteMessages(...args),
  deletePresets: (...args) => mockDeletePresets(...args),
  deleteUserScheduledJobs: (...args) => mockDeleteUserScheduledJobs(...args),
  deleteUserKey: (...args) => mockDeleteUserKey(...args),
  getUserById: (...args) => mockGetUserById(...args),
  deleteConvos: (...args) => mockDeleteConvos(...args),
  deleteFiles: (...args) => mockDeleteFiles(...args),
  updateUser: (...args) => mockUpdateUser(...args),
  findToken: (...args) => mockFindToken(...args),
  getFiles: (...args) => mockGetFiles(...args),
}));

const mockMCPServerFind = jest.fn();
const mockMCPServerDeleteMany = jest.fn();
const mockAclEntryFind = jest.fn();
const mockAclEntryDeleteMany = jest.fn();
const mockAclEntryCountDocuments = jest.fn();

// Default: AclEntry.find returns empty results (no ownership entries)
mockAclEntryFind.mockReturnValue({
  select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
});
mockAclEntryCountDocuments.mockResolvedValue(0);
mockMCPServerFind.mockReturnValue({
  select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
});
mockMCPServerDeleteMany.mockResolvedValue({ deletedCount: 0 });
mockAclEntryDeleteMany.mockResolvedValue({ deletedCount: 0 });

jest.mock('~/db/models', () => ({
  ConversationTag: { deleteMany: jest.fn() },
  AgentApiKey: { deleteMany: jest.fn() },
  Transaction: { deleteMany: jest.fn() },
  MemoryEntry: { deleteMany: jest.fn() },
  MCPServer: {
    find: (...args) => mockMCPServerFind(...args),
    deleteMany: (...args) => mockMCPServerDeleteMany(...args),
  },
  Assistant: { deleteMany: jest.fn() },
  AclEntry: {
    find: (...args) => mockAclEntryFind(...args),
    deleteMany: (...args) => mockAclEntryDeleteMany(...args),
    countDocuments: (...args) => mockAclEntryCountDocuments(...args),
  },
  Balance: { deleteMany: jest.fn() },
  Action: { deleteMany: jest.fn() },
  Group: { updateMany: jest.fn() },
  Token: { deleteMany: jest.fn() },
  User: {},
}));

jest.mock('~/server/services/PluginService', () => ({
  updateUserPluginAuth: jest.fn(),
  deleteUserPluginAuth: (...args) => mockDeleteUserPluginAuth(...args),
}));

jest.mock('~/server/services/twoFactorService', () => ({
  verifyOTPOrBackupCode: (...args) => mockVerifyOTPOrBackupCode(...args),
}));

jest.mock('~/server/services/AuthService', () => ({
  verifyEmail: jest.fn(),
  resendVerificationEmail: jest.fn(),
}));

jest.mock('~/config', () => ({
  getMCPManager: jest.fn(),
  getFlowStateManager: jest.fn(),
  getMCPServersRegistry: jest.fn(),
}));

jest.mock('~/server/services/Config/getCachedTools', () => ({
  invalidateCachedTools: jest.fn(),
}));

jest.mock('~/server/services/Files/S3/crud', () => ({
  needsRefresh: jest.fn(),
  getNewS3URL: jest.fn(),
}));

jest.mock('~/server/services/Files/process', () => ({
  processDeleteRequest: (...args) => mockProcessDeleteRequest(...args),
}));

jest.mock('~/server/services/Config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('~/models/ToolCall', () => ({
  deleteToolCalls: (...args) => mockDeleteToolCalls(...args),
}));

jest.mock('~/models/Prompt', () => ({
  deleteUserPrompts: (...args) => mockDeleteUserPrompts(...args),
}));

jest.mock('~/models/Agent', () => ({
  deleteUserAgents: (...args) => mockDeleteUserAgents(...args),
}));

jest.mock('~/cache', () => ({
  getLogStores: jest.fn(),
}));

const { deleteUserController, deleteUserMcpServers } = require('~/server/controllers/UserController');
const { getMCPManager } = require('~/config');
const { invalidateCachedTools } = require('~/server/services/Config/getCachedTools');

function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

function stubDeletionMocks() {
  mockDeleteMessages.mockResolvedValue();
  mockDeleteAllUserSessions.mockResolvedValue();
  mockDeleteUserKey.mockResolvedValue();
  mockDeletePresets.mockResolvedValue();
  mockDeleteConvos.mockResolvedValue();
  mockDeleteUserPluginAuth.mockResolvedValue();
  mockDeleteUserById.mockResolvedValue();
  mockDeleteAllSharedLinks.mockResolvedValue();
  mockGetFiles.mockResolvedValue([]);
  mockProcessDeleteRequest.mockResolvedValue();
  mockDeleteFiles.mockResolvedValue();
  mockDeleteToolCalls.mockResolvedValue();
  mockDeleteUserAgents.mockResolvedValue();
  mockDeleteUserPrompts.mockResolvedValue();
}

beforeEach(() => {
  jest.clearAllMocks();
  stubDeletionMocks();
  // Restore default MCP mock behaviors after clearAllMocks
  mockAclEntryFind.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
  });
  mockAclEntryCountDocuments.mockResolvedValue(0);
  mockMCPServerFind.mockReturnValue({
    select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
  });
  mockMCPServerDeleteMany.mockResolvedValue({ deletedCount: 0 });
  mockAclEntryDeleteMany.mockResolvedValue({ deletedCount: 0 });
});

describe('deleteUserController - 2FA enforcement', () => {
  it('proceeds with deletion when 2FA is not enabled', async () => {
    const req = { user: { id: 'user1', _id: 'user1', email: 'a@b.com' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({ _id: 'user1', twoFactorEnabled: false });

    await deleteUserController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ message: 'User deleted' });
    expect(mockDeleteMessages).toHaveBeenCalled();
    expect(mockVerifyOTPOrBackupCode).not.toHaveBeenCalled();
  });

  it('proceeds with deletion when user has no 2FA record', async () => {
    const req = { user: { id: 'user1', _id: 'user1', email: 'a@b.com' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue(null);

    await deleteUserController(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ message: 'User deleted' });
  });

  it('returns error when 2FA is enabled and verification fails with 400', async () => {
    const req = { user: { id: 'user1', _id: 'user1' }, body: {} };
    const res = createRes();
    mockGetUserById.mockResolvedValue({
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    });
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: false, status: 400 });

    await deleteUserController(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockDeleteMessages).not.toHaveBeenCalled();
  });

  it('returns 401 when 2FA is enabled and invalid TOTP token provided', async () => {
    const existingUser = {
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    };
    const req = { user: { id: 'user1', _id: 'user1' }, body: { token: 'wrong' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue(existingUser);
    mockVerifyOTPOrBackupCode.mockResolvedValue({
      verified: false,
      status: 401,
      message: 'Invalid token or backup code',
    });

    await deleteUserController(req, res);

    expect(mockVerifyOTPOrBackupCode).toHaveBeenCalledWith({
      user: existingUser,
      token: 'wrong',
      backupCode: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token or backup code' });
    expect(mockDeleteMessages).not.toHaveBeenCalled();
  });

  it('returns 401 when 2FA is enabled and invalid backup code provided', async () => {
    const existingUser = {
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
      backupCodes: [],
    };
    const req = { user: { id: 'user1', _id: 'user1' }, body: { backupCode: 'bad-code' } };
    const res = createRes();
    mockGetUserById.mockResolvedValue(existingUser);
    mockVerifyOTPOrBackupCode.mockResolvedValue({
      verified: false,
      status: 401,
      message: 'Invalid token or backup code',
    });

    await deleteUserController(req, res);

    expect(mockVerifyOTPOrBackupCode).toHaveBeenCalledWith({
      user: existingUser,
      token: undefined,
      backupCode: 'bad-code',
    });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockDeleteMessages).not.toHaveBeenCalled();
  });

  it('deletes account when valid TOTP token provided with 2FA enabled', async () => {
    const existingUser = {
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
    };
    const req = {
      user: { id: 'user1', _id: 'user1', email: 'a@b.com' },
      body: { token: '123456' },
    };
    const res = createRes();
    mockGetUserById.mockResolvedValue(existingUser);
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: true });

    await deleteUserController(req, res);

    expect(mockVerifyOTPOrBackupCode).toHaveBeenCalledWith({
      user: existingUser,
      token: '123456',
      backupCode: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ message: 'User deleted' });
    expect(mockDeleteMessages).toHaveBeenCalled();
  });

  it('deletes account when valid backup code provided with 2FA enabled', async () => {
    const existingUser = {
      _id: 'user1',
      twoFactorEnabled: true,
      totpSecret: 'enc-secret',
      backupCodes: [{ codeHash: 'h1', used: false }],
    };
    const req = {
      user: { id: 'user1', _id: 'user1', email: 'a@b.com' },
      body: { backupCode: 'valid-code' },
    };
    const res = createRes();
    mockGetUserById.mockResolvedValue(existingUser);
    mockVerifyOTPOrBackupCode.mockResolvedValue({ verified: true });

    await deleteUserController(req, res);

    expect(mockVerifyOTPOrBackupCode).toHaveBeenCalledWith({
      user: existingUser,
      token: undefined,
      backupCode: 'valid-code',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({ message: 'User deleted' });
    expect(mockDeleteMessages).toHaveBeenCalled();
  });
});

describe('deleteUserMcpServers - sole-owner semantics', () => {
  const mongoose = require('mongoose');
  const userId = '507f1f77bcf86cd799439011';
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const serverId1 = new mongoose.Types.ObjectId('607f1f77bcf86cd799439001');
  const serverId2 = new mongoose.Types.ObjectId('607f1f77bcf86cd799439002');
  const serverId3 = new mongoose.Types.ObjectId('607f1f77bcf86cd799439003');
  const otherUserId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439099');

  /** Helper: set up AclEntry.find to return different results for different queries */
  function setupAclEntryFind(calls) {
    let callIndex = 0;
    mockAclEntryFind.mockImplementation(() => {
      const result = calls[callIndex] || [];
      callIndex++;
      return {
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }),
      };
    });
  }

  it('deletes a sole-owned MCP server (user has DELETE permission, no other USER with DELETE)', async () => {
    // First AclEntry.find: user's owner entries (USER principal with DELETE bit)
    // Second AclEntry.find: legacy authored servers migration check (empty)
    setupAclEntryFind([
      [{ resourceId: serverId1 }], // user's DELETE-bearing entries
      [],                          // migrated entries for legacy check
    ]);

    // No other USER principals with DELETE on this server
    mockAclEntryCountDocuments.mockResolvedValue(0);

    // MCPServer.find for legacy authored servers: none
    mockMCPServerFind.mockImplementation((query) => {
      if (query.author) {
        return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
      }
      // MCPServer.find for sole-owned server names
      return {
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: serverId1, serverName: 'test-server' }]),
        }),
      };
    });

    getMCPManager.mockReturnValue({
      disconnectUserConnection: jest.fn().mockResolvedValue(undefined),
    });

    await deleteUserMcpServers(userId);

    // Should delete ACL entries for the sole-owned server
    expect(mockAclEntryDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'mcpServer',
        resourceId: { $in: expect.arrayContaining([serverId1]) },
      }),
    );
    // Should delete the server itself
    expect(mockMCPServerDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: expect.arrayContaining([serverId1]) },
      }),
    );
  });

  it('does NOT delete server when another USER principal also has DELETE permission', async () => {
    // User's owner entries
    setupAclEntryFind([
      [{ resourceId: serverId1 }], // user has DELETE on serverId1
      [],                          // legacy migration check
    ]);

    // Another USER with DELETE exists
    mockAclEntryCountDocuments.mockResolvedValue(1);

    // No legacy authored servers
    mockMCPServerFind.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    await deleteUserMcpServers(userId);

    // Should NOT delete any servers or ACL entries
    expect(mockMCPServerDeleteMany).not.toHaveBeenCalled();
    expect(mockAclEntryDeleteMany).not.toHaveBeenCalled();
  });

  it('does NOT count non-USER principals (GROUP, ROLE) as competing owners', async () => {
    // User has DELETE on serverId1
    setupAclEntryFind([
      [{ resourceId: serverId1 }],
      [],                          // legacy migration check
    ]);

    // No other USER with DELETE (GROUP/ROLE entries should not count)
    mockAclEntryCountDocuments.mockResolvedValue(0);

    mockMCPServerFind.mockImplementation((query) => {
      if (query.author) {
        return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
      }
      return {
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: serverId1, serverName: 'shared-server' }]),
        }),
      };
    });

    getMCPManager.mockReturnValue({
      disconnectUserConnection: jest.fn().mockResolvedValue(undefined),
    });

    await deleteUserMcpServers(userId);

    // Should delete: GROUP/ROLE principals don't count as competing owners
    expect(mockMCPServerDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: expect.arrayContaining([serverId1]) },
      }),
    );
  });

  it('preserves legacy pre-ACL authored servers that have no ACL entries', async () => {
    // No ACL-based ownership entries
    setupAclEntryFind([
      [],   // no user DELETE entries
      [],   // legacy migration check: no migrated entries
    ]);

    // Legacy authored servers exist
    mockMCPServerFind.mockImplementation((query) => {
      if (query.author) {
        return {
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: serverId2, serverName: 'legacy-server' },
            ]),
          }),
        };
      }
      return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
    });

    getMCPManager.mockReturnValue({
      disconnectUserConnection: jest.fn().mockResolvedValue(undefined),
    });

    await deleteUserMcpServers(userId);

    // Should delete legacy server
    expect(mockMCPServerDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: expect.arrayContaining([serverId2]) },
      }),
    );
  });

  it('skips legacy authored servers that have been migrated to ACL', async () => {
    // No ACL-based owner entries for this user
    setupAclEntryFind([
      [],                                          // no DELETE entries for user
      [{ resourceId: serverId2 }],                 // serverId2 has been migrated to ACL
    ]);

    // Legacy authored servers - serverId2 is authored but already migrated
    mockMCPServerFind.mockImplementation((query) => {
      if (query.author) {
        return {
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: serverId2, serverName: 'migrated-server' },
            ]),
          }),
        };
      }
      return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
    });

    await deleteUserMcpServers(userId);

    // Should NOT delete: the authored server was migrated to ACL
    expect(mockMCPServerDeleteMany).not.toHaveBeenCalled();
    expect(mockAclEntryDeleteMany).not.toHaveBeenCalled();
  });

  it('handles mixed: sole-owned ACL server + non-sole-owned server + legacy server', async () => {
    // User has DELETE on serverId1 and serverId2
    setupAclEntryFind([
      [{ resourceId: serverId1 }, { resourceId: serverId2 }],
      [],   // legacy migration check - no migrated entries
    ]);

    // serverId1 has no other USER DELETE owners; serverId2 does
    mockAclEntryCountDocuments.mockImplementation((query) => {
      const resourceId = query.resourceId;
      if (resourceId === serverId1) {
        return Promise.resolve(0); // sole owned
      }
      return Promise.resolve(1); // shared
    });

    // Legacy server: serverId3
    mockMCPServerFind.mockImplementation((query) => {
      if (query.author) {
        return {
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: serverId3, serverName: 'legacy-server' },
            ]),
          }),
        };
      }
      // Load server names for sole-owned
      return {
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: serverId1, serverName: 'sole-server' }]),
        }),
      };
    });

    getMCPManager.mockReturnValue({
      disconnectUserConnection: jest.fn().mockResolvedValue(undefined),
    });

    await deleteUserMcpServers(userId);

    // Should delete serverId1 (sole-owned) and serverId3 (legacy), NOT serverId2 (shared)
    expect(mockMCPServerDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: { $in: expect.arrayContaining([serverId1, serverId3]) },
      }),
    );

    // Verify serverId2 is NOT in the deletion list
    const deleteCall = mockMCPServerDeleteMany.mock.calls[0][0];
    expect(deleteCall._id.$in).not.toContainEqual(serverId2);
  });

  it('only considers USER principals with DELETE permission as owners for the target user', async () => {
    // This is the key semantic test: the ownerEntries query must filter by
    // principalType === 'user' AND permBits includes DELETE bit
    setupAclEntryFind([
      [{ resourceId: serverId1 }],
      [],
    ]);

    mockAclEntryCountDocuments.mockResolvedValue(0);

    mockMCPServerFind.mockImplementation((query) => {
      if (query.author) {
        return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
      }
      return {
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: serverId1, serverName: 'owned-server' }]),
        }),
      };
    });

    getMCPManager.mockReturnValue({
      disconnectUserConnection: jest.fn().mockResolvedValue(undefined),
    });

    await deleteUserMcpServers(userId);

    // Verify the first AclEntry.find call filters by principalType and DELETE permBits
    const firstFindCall = mockAclEntryFind.mock.calls[0][0];
    expect(firstFindCall).toMatchObject({
      principalId: userObjectId,
      principalType: 'user',
      resourceType: 'mcpServer',
      permBits: expect.objectContaining({ $bitsAllSet: 4 }), // DELETE = 4
    });
  });

  it('only counts other USER principals with DELETE as competing owners', async () => {
    setupAclEntryFind([
      [{ resourceId: serverId1 }],
      [],
    ]);

    mockAclEntryCountDocuments.mockResolvedValue(1);

    mockMCPServerFind.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    await deleteUserMcpServers(userId);

    // Verify countDocuments query filters by principalType USER and DELETE permBits
    const countCall = mockAclEntryCountDocuments.mock.calls[0][0];
    expect(countCall).toMatchObject({
      resourceType: 'mcpServer',
      resourceId: serverId1,
      principalType: 'user',
      principalId: { $ne: userObjectId },
      permBits: expect.objectContaining({ $bitsAllSet: 4 }),
    });
  });

  it('disconnects MCP sessions and invalidates caches for deleted servers', async () => {
    setupAclEntryFind([
      [{ resourceId: serverId1 }],
      [],
    ]);

    mockAclEntryCountDocuments.mockResolvedValue(0);

    const mockDisconnect = jest.fn().mockResolvedValue(undefined);
    getMCPManager.mockReturnValue({
      disconnectUserConnection: mockDisconnect,
    });

    mockMCPServerFind.mockImplementation((query) => {
      if (query.author) {
        return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) };
      }
      return {
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ _id: serverId1, serverName: 'my-server' }]),
        }),
      };
    });

    await deleteUserMcpServers(userId);

    expect(mockDisconnect).toHaveBeenCalledWith(userId, 'my-server');
    expect(invalidateCachedTools).toHaveBeenCalledWith({
      userId,
      serverName: 'my-server',
    });
  });

  it('returns silently when no servers to delete', async () => {
    setupAclEntryFind([
      [],  // no ownership entries
      [],  // no legacy migration check results
    ]);

    mockMCPServerFind.mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    });

    await deleteUserMcpServers(userId);

    expect(mockMCPServerDeleteMany).not.toHaveBeenCalled();
    expect(mockAclEntryDeleteMany).not.toHaveBeenCalled();
  });
});
