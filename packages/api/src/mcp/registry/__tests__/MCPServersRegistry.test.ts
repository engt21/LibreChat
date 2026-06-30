import type * as t from '~/mcp/types';
import { MCPServersRegistry } from '~/mcp/registry/MCPServersRegistry';
import { MCPServerInspector } from '~/mcp/registry/MCPServerInspector';

// Mock MCPServerInspector to avoid actual server connections
jest.mock('~/mcp/registry/MCPServerInspector');

// Mock ServerConfigsDB to avoid mongoose dependency
jest.mock('~/mcp/registry/db/ServerConfigsDB', () => ({
  ServerConfigsDB: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(undefined),
    getAll: jest.fn().mockResolvedValue({}),
    add: jest.fn().mockResolvedValue(undefined),
    addWithServerName: jest.fn().mockResolvedValue(undefined),
    update: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
  })),
}));

const FIXED_TIME = 1699564800000;
const originalDateNow = Date.now;
Date.now = jest.fn(() => FIXED_TIME);

// Mock mongoose for registry initialization
const mockMongoose = {} as typeof import('mongoose');

/**
 * Unit tests for MCPServersRegistry using in-memory cache.
 * For integration tests using Redis-backed cache, see MCPServersRegistry.cache_integration.spec.ts
 */
describe('MCPServersRegistry', () => {
  let registry: MCPServersRegistry;

  const testParsedConfig: t.ParsedServerConfig = {
    type: 'stdio',
    command: 'node',
    args: ['tools.js'],
    requiresOAuth: false,
    serverInstructions: 'Instructions for file_tools_server',
    tools: 'file_read, file_write',
    capabilities: '{"tools":{"listChanged":true}}',
    toolFunctions: {
      file_read_mcp_file_tools_server: {
        type: 'function',
        function: {
          name: 'file_read_mcp_file_tools_server',
          description: 'Read a file',
          parameters: { type: 'object' },
        },
      },
    },
    updatedAt: FIXED_TIME,
  };
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(FIXED_TIME));
  });
  afterAll(() => {
    Date.now = originalDateNow;
  });
  beforeEach(async () => {
    // Reset the singleton instance before each test
    (MCPServersRegistry as unknown as { instance: undefined }).instance = undefined;

    // Create a new instance for testing
    MCPServersRegistry.createInstance(mockMongoose);
    registry = MCPServersRegistry.getInstance();

    // Mock MCPServerInspector.inspect to return the config that's passed in
    jest
      .spyOn(MCPServerInspector, 'inspect')
      .mockImplementation(async (_serverName: string, rawConfig: t.MCPOptions) => {
        return {
          ...testParsedConfig,
          ...rawConfig,
          requiresOAuth: false,
        } as unknown as t.ParsedServerConfig;
      });
    await registry.reset();
  });

  // Tests for the old privateServersCache API have been removed
  // The refactoring simplified the architecture to use unified repositories (cache + DB)
  // instead of the three-tier system (sharedAppServers, sharedUserServers, privateServersCache)

  // Tests for getPrivateServerConfig have been removed
  // The new architecture uses getServerConfig() which checks cache first, then DB
  // Private server functionality is now handled by the DB repository (not yet implemented)

  describe('getAllServerConfigs', () => {
    it('should return servers from cache repository', async () => {
      // Add servers to cache using the new API
      await registry['cacheConfigsRepo'].add('app_server', testParsedConfig);
      await registry['cacheConfigsRepo'].add('user_server', testParsedConfig);

      // getAllServerConfigs should return configs from cache (DB is not implemented yet)
      const configs = await registry.getAllServerConfigs();
      expect(Object.keys(configs)).toHaveLength(2);
      expect(configs).toHaveProperty('app_server');
      expect(configs).toHaveProperty('user_server');
    });

    it('should return servers in alphabetical display-name order', async () => {
      await registry['cacheConfigsRepo'].add('zeta_server', {
        ...testParsedConfig,
        title: 'Zeta',
      } as t.ParsedServerConfig);
      await registry['cacheConfigsRepo'].add('alpha_server_2', {
        ...testParsedConfig,
        title: 'Alpha',
      } as t.ParsedServerConfig);
      await registry['cacheConfigsRepo'].add('alpha_server_1', {
        ...testParsedConfig,
        title: 'Alpha',
      } as t.ParsedServerConfig);

      const configs = await registry.getAllServerConfigs();

      expect(Object.keys(configs)).toEqual(['alpha_server_1', 'alpha_server_2', 'zeta_server']);
    });

    it('should filter cache-backed servers when a published server allowlist is configured', async () => {
      await registry['cacheConfigsRepo'].add('published_server', testParsedConfig);
      await registry['cacheConfigsRepo'].add('hidden_server', testParsedConfig);

      await registry.setPublishedServerNames(['published_server']);

      const configs = await registry.getAllServerConfigs();
      expect(configs).toHaveProperty('published_server');
      expect(configs).not.toHaveProperty('hidden_server');
      await expect(registry.getServerConfig('hidden_server')).resolves.toBeUndefined();
    });

    it('should keep all cache-backed servers visible when no published allowlist is configured', async () => {
      await registry['cacheConfigsRepo'].add('app_server', testParsedConfig);

      await registry.setPublishedServerNames(null);

      const configs = await registry.getAllServerConfigs();
      expect(configs).toHaveProperty('app_server');
      await expect(registry.getServerConfig('app_server')).resolves.toBeDefined();
    });
  });

  describe('reset', () => {
    it('should clear all servers from cache repository', async () => {
      // Add servers to cache using the new API
      await registry.addServer('app_server', testParsedConfig, 'CACHE');
      await registry.addServer('user_server', testParsedConfig, 'CACHE');

      // Verify servers are accessible before reset
      const appConfigBefore = await registry.getServerConfig('app_server');
      const userConfigBefore = await registry.getServerConfig('user_server');
      const allConfigsBefore = await registry.getAllServerConfigs();

      expect(appConfigBefore).toEqual(testParsedConfig);
      expect(userConfigBefore).toEqual(testParsedConfig);
      expect(Object.keys(allConfigsBefore)).toHaveLength(2);

      // Reset everything
      await registry.reset();

      // Verify all servers are cleared after reset
      const appConfigAfter = await registry.getServerConfig('app_server');
      const userConfigAfter = await registry.getServerConfig('user_server');
      const allConfigsAfter = await registry.getAllServerConfigs();

      expect(appConfigAfter).toBeUndefined();
      expect(userConfigAfter).toBeUndefined();
      expect(Object.keys(allConfigsAfter)).toHaveLength(0);
    });
  });

  describe('Storage location routing (getConfigRepository)', () => {
    describe('CACHE storage location', () => {
      it('should route addServer to cache repository', async () => {
        await registry.addServer('cache_server', testParsedConfig, 'CACHE');

        const config = await registry.getServerConfig('cache_server');
        expect(config).toBeDefined();
        expect(config?.type).toBe('stdio');
        if (config && 'command' in config) {
          expect(config.command).toBe('node');
        }
      });

      it('should route updateServer to cache repository', async () => {
        await registry.addServer('cache_server', testParsedConfig, 'CACHE');

        const updatedConfig = { ...testParsedConfig, command: 'python' } as t.ParsedServerConfig;
        await registry.updateServer('cache_server', updatedConfig, 'CACHE');

        const config = await registry.getServerConfig('cache_server');
        expect(config).toBeDefined();
        if (config && 'command' in config) {
          expect(config.command).toBe('python');
        }
      });

      it('should route removeServer to cache repository', async () => {
        await registry.addServer('cache_server', testParsedConfig, 'CACHE');
        // Verify server exists in underlying cache repository (not via getServerConfig to avoid populating read-through cache)
        expect(await registry['cacheConfigsRepo'].get('cache_server')).toBeDefined();

        await registry.removeServer('cache_server', 'CACHE');

        // Verify server is removed from underlying cache repository
        const config = await registry['cacheConfigsRepo'].get('cache_server');
        expect(config).toBeUndefined();
      });
    });

    describe('Invalid storage location', () => {
      it('should throw error for unsupported storage location in addServer', async () => {
        await expect(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          registry.addServer('test_server', testParsedConfig, 'INVALID' as any),
        ).rejects.toThrow('The provided storage location "INVALID" is not supported');
      });

      it('should throw error for unsupported storage location in updateServer', async () => {
        await expect(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          registry.updateServer('test_server', testParsedConfig, 'REDIS' as any),
        ).rejects.toThrow('The provided storage location "REDIS" is not supported');
      });

      it('should throw error for unsupported storage location in removeServer', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(registry.removeServer('test_server', 'S3' as any)).rejects.toThrow(
          'The provided storage location "S3" is not supported',
        );
      });
    });
  });

  describe('reinspectServer', () => {
    it('should throw when called on a healthy (non-stub) server', async () => {
      await registry.addServer('healthy_server', testParsedConfig, 'CACHE');

      await expect(registry.reinspectServer('healthy_server', 'CACHE')).rejects.toThrow(
        'is not in a failed state',
      );
    });

    it('should throw when the server does not exist', async () => {
      await expect(registry.reinspectServer('ghost_server', 'CACHE')).rejects.toThrow(
        'not found in CACHE',
      );
    });
  });

  describe('Read-through cache', () => {
    describe('getServerConfig', () => {
      it('should cache repeated calls for the same server', async () => {
        // Add a server to the cache repository
        await registry['cacheConfigsRepo'].add('test_server', testParsedConfig);

        // Spy on the cache repository get method
        const cacheRepoGetSpy = jest.spyOn(registry['cacheConfigsRepo'], 'get');

        // First call should hit the cache repository
        const config1 = await registry.getServerConfig('test_server');
        expect(config1).toEqual(testParsedConfig);
        expect(cacheRepoGetSpy).toHaveBeenCalledTimes(1);

        // Second call should hit the read-through cache, not the repository
        const config2 = await registry.getServerConfig('test_server');
        expect(config2).toEqual(testParsedConfig);
        expect(cacheRepoGetSpy).toHaveBeenCalledTimes(1); // Still 1, not 2

        // Third call should also hit the read-through cache
        const config3 = await registry.getServerConfig('test_server');
        expect(config3).toEqual(testParsedConfig);
        expect(cacheRepoGetSpy).toHaveBeenCalledTimes(1); // Still 1
      });

      it('should prefer DB configs over cache configs for the same server name', async () => {
        await registry['cacheConfigsRepo'].add('shadowed_server', testParsedConfig);
        const dbConfig = { ...testParsedConfig, command: 'python', dbId: 'db-id' };
        jest.spyOn(registry['dbConfigsRepo'], 'get').mockResolvedValue(dbConfig);

        const config = await registry.getServerConfig('shadowed_server', 'user123');

        expect(config).toEqual(dbConfig);
        if (config && 'command' in config) {
          expect(config.command).toBe('python');
        }
      });

      it('should cache "not found" results to avoid repeated DB lookups', async () => {
        // Spy on the DB repository get method
        const dbRepoGetSpy = jest.spyOn(registry['dbConfigsRepo'], 'get');

        // First call - server doesn't exist, should hit DB
        const config1 = await registry.getServerConfig('nonexistent_server');
        expect(config1).toBeUndefined();
        expect(dbRepoGetSpy).toHaveBeenCalledTimes(1);

        // Second call - should hit read-through cache, not DB
        const config2 = await registry.getServerConfig('nonexistent_server');
        expect(config2).toBeUndefined();
        expect(dbRepoGetSpy).toHaveBeenCalledTimes(1); // Still 1, not 2
      });

      it('should use different cache keys for different userIds', async () => {
        // Spy on the cache repository get method
        const cacheRepoGetSpy = jest.spyOn(registry['cacheConfigsRepo'], 'get');

        // First call without userId
        await registry.getServerConfig('test_server');
        expect(cacheRepoGetSpy).toHaveBeenCalledTimes(1);

        // Call with userId - should be a different cache key, so hits repository again
        await registry.getServerConfig('test_server', 'user123');
        expect(cacheRepoGetSpy).toHaveBeenCalledTimes(2);

        // Repeat call with same userId - should hit read-through cache
        await registry.getServerConfig('test_server', 'user123');
        expect(cacheRepoGetSpy).toHaveBeenCalledTimes(2); // Still 2

        // Call with different userId - should hit repository
        await registry.getServerConfig('test_server', 'user456');
        expect(cacheRepoGetSpy).toHaveBeenCalledTimes(3);
      });
    });

    describe('cache invalidation on mutations', () => {
      it('addServer should invalidate getAllServerConfigs cache so the new server appears immediately', async () => {
        // Seed one server, then call getAllServerConfigs to populate the read-through cache
        await registry.addServer('existing_server', testParsedConfig, 'CACHE');
        const configsBefore = await registry.getAllServerConfigs();
        expect(Object.keys(configsBefore)).toHaveLength(1);

        // Add a second server — this should invalidate the getAllServerConfigs cache
        await registry.addServer('new_server', testParsedConfig, 'CACHE');

        // getAllServerConfigs must include the new server without requiring reset or TTL expiry
        const configsAfter = await registry.getAllServerConfigs();
        expect(Object.keys(configsAfter)).toHaveLength(2);
        expect(configsAfter).toHaveProperty('new_server');
      });

      it('addServer should invalidate getServerConfig cache so the new server is individually retrievable', async () => {
        // Prime a "not found" cache entry
        const notFound = await registry.getServerConfig('brand_new_server');
        expect(notFound).toBeUndefined();

        // Add the server — the stale "not found" must be invalidated
        await registry.addServer('brand_new_server', testParsedConfig, 'CACHE');

        const config = await registry.getServerConfig('brand_new_server');
        expect(config).toBeDefined();
        expect(config?.type).toBe('stdio');
      });

      it('updateServer should invalidate caches so the updated config is visible immediately', async () => {
        await registry.addServer('update_target', testParsedConfig, 'CACHE');

        // Populate the read-through caches
        const configBefore = await registry.getServerConfig('update_target');
        expect(configBefore?.type).toBe('stdio');
        const allBefore = await registry.getAllServerConfigs();
        expect(allBefore['update_target']?.type).toBe('stdio');

        // Update the server
        const updatedConfig = { ...testParsedConfig, command: 'python' } as t.ParsedServerConfig;
        await registry.updateServer('update_target', updatedConfig, 'CACHE');

        // Both read surfaces must reflect the update immediately
        const configAfter = await registry.getServerConfig('update_target');
        expect(configAfter).toBeDefined();
        if (configAfter && 'command' in configAfter) {
          expect(configAfter.command).toBe('python');
        }

        const allAfter = await registry.getAllServerConfigs();
        const entry = allAfter['update_target'];
        expect(entry).toBeDefined();
        if (entry && 'command' in entry) {
          expect(entry.command).toBe('python');
        }
      });

      it('removeServer should invalidate caches so the server disappears immediately', async () => {
        await registry.addServer('remove_target', testParsedConfig, 'CACHE');

        // Populate the read-through caches
        const configBefore = await registry.getServerConfig('remove_target');
        expect(configBefore).toBeDefined();
        const allBefore = await registry.getAllServerConfigs();
        expect(allBefore).toHaveProperty('remove_target');

        // Remove the server
        await registry.removeServer('remove_target', 'CACHE');

        // Both read surfaces must reflect the removal immediately
        const configAfter = await registry.getServerConfig('remove_target');
        expect(configAfter).toBeUndefined();
        const allAfter = await registry.getAllServerConfigs();
        expect(allAfter).not.toHaveProperty('remove_target');
      });

      it('addServerStub should invalidate getAllServerConfigs cache', async () => {
        await registry.addServer('existing_server', testParsedConfig, 'CACHE');
        const configsBefore = await registry.getAllServerConfigs();
        expect(Object.keys(configsBefore)).toHaveLength(1);

        await registry.addServerStub('stub_server', testParsedConfig, 'CACHE');

        const configsAfter = await registry.getAllServerConfigs();
        expect(Object.keys(configsAfter)).toHaveLength(2);
        expect(configsAfter).toHaveProperty('stub_server');
      });
    });

    describe('getAllServerConfigs', () => {
      it('should cache repeated calls', async () => {
        // Add servers to cache
        await registry['cacheConfigsRepo'].add('server1', testParsedConfig);
        await registry['cacheConfigsRepo'].add('server2', testParsedConfig);

        // Spy on the cache repository getAll method
        const cacheRepoGetAllSpy = jest.spyOn(registry['cacheConfigsRepo'], 'getAll');

        // First call should hit the repository
        const configs1 = await registry.getAllServerConfigs();
        expect(Object.keys(configs1)).toHaveLength(2);
        expect(cacheRepoGetAllSpy).toHaveBeenCalledTimes(1);

        // Second call should hit the read-through cache
        const configs2 = await registry.getAllServerConfigs();
        expect(Object.keys(configs2)).toHaveLength(2);
        expect(cacheRepoGetAllSpy).toHaveBeenCalledTimes(1); // Still 1

        // Third call should also hit the read-through cache
        const configs3 = await registry.getAllServerConfigs();
        expect(Object.keys(configs3)).toHaveLength(2);
        expect(cacheRepoGetAllSpy).toHaveBeenCalledTimes(1); // Still 1
      });

      it('should use different cache keys for different userIds', async () => {
        // Spy on the cache repository getAll method
        const cacheRepoGetAllSpy = jest.spyOn(registry['cacheConfigsRepo'], 'getAll');

        // First call without userId
        await registry.getAllServerConfigs();
        expect(cacheRepoGetAllSpy).toHaveBeenCalledTimes(1);

        // Call with userId - should be a different cache key
        await registry.getAllServerConfigs('user123');
        expect(cacheRepoGetAllSpy).toHaveBeenCalledTimes(2);

        // Repeat call with same userId - should hit read-through cache
        await registry.getAllServerConfigs('user123');
        expect(cacheRepoGetAllSpy).toHaveBeenCalledTimes(2); // Still 2

        // Call with different userId - should hit repository
        await registry.getAllServerConfigs('user456');
        expect(cacheRepoGetAllSpy).toHaveBeenCalledTimes(3);
      });
    });
  });
});
