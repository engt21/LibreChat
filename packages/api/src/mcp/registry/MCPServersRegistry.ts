import { Keyv } from 'keyv';
import { logger } from '@librechat/data-schemas';
import type { IServerConfigsRepositoryInterface } from './ServerConfigsRepositoryInterface';
import type * as t from '~/mcp/types';
import type { DomainFilterMode } from '~/auth/domain';
import { MCPInspectionFailedError, isMCPDomainNotAllowedError } from '~/mcp/errors';
import { ServerConfigsCacheFactory } from './cache/ServerConfigsCacheFactory';
import { MCPServerInspector } from './MCPServerInspector';
import { ServerConfigsDB } from './db/ServerConfigsDB';
import { cacheConfig } from '~/cache/cacheConfig';

/**
 * Central registry for managing MCP server configurations.
 * Authoritative source of truth for all MCP servers provided by LibreChat.
 *
 * Uses a two-repository architecture:
 * - Cache Repository: Stores YAML-defined configs loaded at startup (in-memory or Redis-backed)
 * - DB Repository: Stores dynamic configs created at runtime (not yet implemented)
 *
 * Query priority: DB configs are checked first, then cache configs.
 * This lets user-managed DB overrides shadow app-level YAML definitions.
 */
export class MCPServersRegistry {
  private static instance: MCPServersRegistry;

  private readonly dbConfigsRepo: IServerConfigsRepositoryInterface;
  private readonly cacheConfigsRepo: IServerConfigsRepositoryInterface;
  private readonly allowedDomains?: string[] | null;
  private readonly domainFilterMode: DomainFilterMode;
  private readonly ssrfExemptions?: string[] | null;
  private publishedServerNames: Set<string> | null;
  private readonly readThroughCache: Keyv<t.ParsedServerConfig>;
  private readonly readThroughCacheAll: Keyv<Record<string, t.ParsedServerConfig>>;
  private readonly pendingGetAllPromises = new Map<
    string,
    Promise<Record<string, t.ParsedServerConfig>>
  >();

  constructor(
    mongoose: typeof import('mongoose'),
    allowedDomains?: string[] | null,
    domainFilterMode: DomainFilterMode = 'allowlist',
    ssrfExemptions?: string[] | null,
    publishedServerNames?: string[] | null,
  ) {
    this.dbConfigsRepo = new ServerConfigsDB(mongoose);
    this.cacheConfigsRepo = ServerConfigsCacheFactory.create('App', false);
    this.allowedDomains = allowedDomains;
    this.domainFilterMode = domainFilterMode;
    this.ssrfExemptions = ssrfExemptions;
    this.publishedServerNames = Array.isArray(publishedServerNames)
      ? new Set(publishedServerNames)
      : null;

    const ttl = cacheConfig.MCP_REGISTRY_CACHE_TTL;

    this.readThroughCache = new Keyv<t.ParsedServerConfig>({
      namespace: 'mcp-registry-read-through',
      ttl,
    });

    this.readThroughCacheAll = new Keyv<Record<string, t.ParsedServerConfig>>({
      namespace: 'mcp-registry-read-through-all',
      ttl,
    });
  }

  /** Creates and initializes the singleton MCPServersRegistry instance */
  public static createInstance(
    mongoose: typeof import('mongoose'),
    allowedDomains?: string[] | null,
    domainFilterMode: DomainFilterMode = 'allowlist',
    ssrfExemptions?: string[] | null,
    publishedServerNames?: string[] | null,
  ): MCPServersRegistry {
    if (!mongoose) {
      throw new Error(
        'MCPServersRegistry creation failed: mongoose instance is required for database operations. ' +
          'Ensure mongoose is initialized before creating the registry.',
      );
    }
    if (MCPServersRegistry.instance) {
      logger.debug('[MCPServersRegistry] Returning existing instance');
      return MCPServersRegistry.instance;
    }
    logger.info('[MCPServersRegistry] Creating new instance');
    MCPServersRegistry.instance = new MCPServersRegistry(
      mongoose,
      allowedDomains,
      domainFilterMode,
      ssrfExemptions,
      publishedServerNames,
    );
    return MCPServersRegistry.instance;
  }

  /** Returns the singleton MCPServersRegistry instance */
  public static getInstance(): MCPServersRegistry {
    if (!MCPServersRegistry.instance) {
      throw new Error('MCPServersRegistry has not been initialized.');
    }
    return MCPServersRegistry.instance;
  }

  public getAllowedDomains(): string[] | null | undefined {
    return this.allowedDomains;
  }

  /** Returns true when no explicit allowedDomains allowlist is configured, enabling SSRF TOCTOU protection */
  public shouldEnableSSRFProtection(): boolean {
    return !Array.isArray(this.allowedDomains) || this.allowedDomains.length === 0;
  }

  public async setPublishedServerNames(serverNames?: string[] | null): Promise<void> {
    this.publishedServerNames = Array.isArray(serverNames) ? new Set(serverNames) : null;
    await this.readThroughCache.clear();
    await this.readThroughCacheAll.clear();
  }

  private isCacheServerPublished(serverName: string): boolean {
    return this.publishedServerNames == null || this.publishedServerNames.has(serverName);
  }

  private filterPublishedCacheConfigs(
    configs: Record<string, t.ParsedServerConfig>,
  ): Record<string, t.ParsedServerConfig> {
    if (this.publishedServerNames == null) {
      return configs;
    }

    return Object.fromEntries(
      Object.entries(configs).filter(([serverName]) => this.isCacheServerPublished(serverName)),
    );
  }

  private sortServerConfigs(
    configs: Record<string, t.ParsedServerConfig>,
  ): Record<string, t.ParsedServerConfig> {
    return Object.fromEntries(
      Object.entries(configs).sort(([leftName, leftConfig], [rightName, rightConfig]) => {
        const leftDisplayName = leftConfig.title || leftName;
        const rightDisplayName = rightConfig.title || rightName;
        return (
          leftDisplayName.localeCompare(rightDisplayName, undefined, {
            numeric: true,
            sensitivity: 'base',
          }) ||
          leftName.localeCompare(rightName, undefined, {
            numeric: true,
            sensitivity: 'base',
          })
        );
      }),
    );
  }

  public async getServerConfig(
    serverName: string,
    userId?: string,
  ): Promise<t.ParsedServerConfig | undefined> {
    const cacheKey = this.getReadThroughCacheKey(serverName, userId);

    if (await this.readThroughCache.has(cacheKey)) {
      return await this.readThroughCache.get(cacheKey);
    }

    const configFromDB = await this.dbConfigsRepo.get(serverName, userId);
    if (configFromDB) {
      await this.readThroughCache.set(cacheKey, configFromDB);
      return configFromDB;
    }

    // YAML config is preloaded into the cache repository.
    const configFromCache = await this.cacheConfigsRepo.get(serverName);
    const publishedConfig =
      configFromCache && this.isCacheServerPublished(serverName) ? configFromCache : undefined;
    await this.readThroughCache.set(cacheKey, publishedConfig);
    return publishedConfig;
  }

  public async getAllServerConfigs(userId?: string): Promise<Record<string, t.ParsedServerConfig>> {
    const cacheKey = userId ?? '__no_user__';

    if (await this.readThroughCacheAll.has(cacheKey)) {
      return (await this.readThroughCacheAll.get(cacheKey)) ?? {};
    }

    const pending = this.pendingGetAllPromises.get(cacheKey);
    if (pending) {
      return pending;
    }

    const fetchPromise = this.fetchAllServerConfigs(cacheKey, userId);
    this.pendingGetAllPromises.set(cacheKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      this.pendingGetAllPromises.delete(cacheKey);
    }
  }

  private async fetchAllServerConfigs(
    cacheKey: string,
    userId?: string,
  ): Promise<Record<string, t.ParsedServerConfig>> {
    const result = this.sortServerConfigs({
      ...this.filterPublishedCacheConfigs(await this.cacheConfigsRepo.getAll()),
      ...(await this.dbConfigsRepo.getAll(userId)),
    });

    await this.readThroughCacheAll.set(cacheKey, result);
    return result;
  }

  /**
   * Stores a minimal config stub so the server remains "known" to the registry
   * even when inspection fails at startup. This enables reinitialize to recover.
   */
  public async addServerStub(
    serverName: string,
    config: t.MCPOptions,
    storageLocation: 'CACHE' | 'DB',
    userId?: string,
  ): Promise<t.AddServerResult> {
    const configRepo = this.getConfigRepository(storageLocation);
    const stubConfig: t.ParsedServerConfig = { ...config, inspectionFailed: true };
    const result = await configRepo.add(serverName, stubConfig, userId);
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName, userId));
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName));
    await this.readThroughCacheAll.clear();
    return result;
  }

  public async addServer(
    serverName: string,
    config: t.MCPOptions,
    storageLocation: 'CACHE' | 'DB',
    userId?: string,
  ): Promise<t.AddServerResult> {
    const configRepo = this.getConfigRepository(storageLocation);
    let parsedConfig: t.ParsedServerConfig;
    try {
      parsedConfig = await MCPServerInspector.inspect(
        serverName,
        config,
        undefined,
        this.allowedDomains,
        this.domainFilterMode,
        this.ssrfExemptions,
      );
    } catch (error) {
      logger.error(`[MCPServersRegistry] Failed to inspect server "${serverName}":`, error);
      // Preserve domain-specific error for better error handling
      if (isMCPDomainNotAllowedError(error)) {
        throw error;
      }
      throw new MCPInspectionFailedError(serverName, error as Error);
    }
    const result = await configRepo.add(serverName, parsedConfig, userId);
    // Invalidate read-through caches so the new server appears immediately
    // in getAllServerConfigs and getServerConfig (cache freshness fix)
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName, userId));
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName));
    await this.readThroughCacheAll.clear();
    return result;
  }

  public async addServerWithName(
    serverName: string,
    config: t.MCPOptions,
    storageLocation: 'CACHE' | 'DB',
    userId?: string,
  ): Promise<t.AddServerResult> {
    if (storageLocation !== 'DB') {
      return this.addServer(serverName, config, storageLocation, userId);
    }

    let parsedConfig: t.ParsedServerConfig;
    try {
      parsedConfig = await MCPServerInspector.inspect(
        serverName,
        config,
        undefined,
        this.allowedDomains,
        this.domainFilterMode,
        this.ssrfExemptions,
      );
    } catch (error) {
      logger.error(`[MCPServersRegistry] Failed to inspect server "${serverName}":`, error);
      if (isMCPDomainNotAllowedError(error)) {
        throw error;
      }
      throw new MCPInspectionFailedError(serverName, error as Error);
    }

    const result = await (this.dbConfigsRepo as ServerConfigsDB).addWithServerName(
      serverName,
      parsedConfig,
      userId,
    );
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName, userId));
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName));
    await this.readThroughCacheAll.clear();
    return result;
  }

  /**
   * Re-inspects a server that previously failed initialization.
   * Uses the stored stub config to attempt a full inspection and replaces the stub on success.
   */
  public async reinspectServer(
    serverName: string,
    storageLocation: 'CACHE' | 'DB',
    userId?: string,
  ): Promise<t.AddServerResult> {
    const configRepo = this.getConfigRepository(storageLocation);
    const existing = await configRepo.get(serverName, userId);
    if (!existing) {
      throw new Error(`Server "${serverName}" not found in ${storageLocation} for reinspection.`);
    }
    if (!existing.inspectionFailed) {
      throw new Error(
        `Server "${serverName}" is not in a failed state. Use updateServer() instead.`,
      );
    }

    const { inspectionFailed: _, ...configForInspection } = existing;
    let parsedConfig: t.ParsedServerConfig;
    try {
      parsedConfig = await MCPServerInspector.inspect(
        serverName,
        configForInspection,
        undefined,
        this.allowedDomains,
        this.domainFilterMode,
        this.ssrfExemptions,
      );
    } catch (error) {
      logger.error(`[MCPServersRegistry] Reinspection failed for server "${serverName}":`, error);
      if (isMCPDomainNotAllowedError(error)) {
        throw error;
      }
      throw new MCPInspectionFailedError(serverName, error as Error);
    }

    const updatedConfig = { ...parsedConfig, updatedAt: Date.now() };
    await configRepo.update(serverName, updatedConfig, userId);
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName, userId));
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName));
    // Full clear required: getAllServerConfigs is keyed by userId with no reverse index to enumerate cached keys
    await this.readThroughCacheAll.clear();
    return { serverName, config: updatedConfig };
  }

  public async updateServer(
    serverName: string,
    config: t.MCPOptions,
    storageLocation: 'CACHE' | 'DB',
    userId?: string,
  ): Promise<t.ParsedServerConfig> {
    const configRepo = this.getConfigRepository(storageLocation);

    // Merge existing admin API key if not provided in update (needed for inspection)
    let configForInspection = { ...config };
    if (config.apiKey?.source === 'admin' && !config.apiKey?.key) {
      const existingConfig = await configRepo.get(serverName, userId);
      if (existingConfig?.apiKey?.key) {
        configForInspection = {
          ...configForInspection,
          apiKey: {
            ...configForInspection.apiKey!,
            key: existingConfig.apiKey.key,
          },
        };
      }
    }

    let parsedConfig: t.ParsedServerConfig;
    try {
      parsedConfig = await MCPServerInspector.inspect(
        serverName,
        configForInspection,
        undefined,
        this.allowedDomains,
        this.domainFilterMode,
        this.ssrfExemptions,
      );
    } catch (error) {
      logger.error(`[MCPServersRegistry] Failed to inspect server "${serverName}":`, error);
      // Preserve domain-specific error for better error handling
      if (isMCPDomainNotAllowedError(error)) {
        throw error;
      }
      throw new MCPInspectionFailedError(serverName, error as Error);
    }
    await configRepo.update(serverName, parsedConfig, userId);
    // Invalidate read-through caches so the updated config is visible immediately
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName, userId));
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName));
    await this.readThroughCacheAll.clear();
    return parsedConfig;
  }

  // TODO: This is currently used to determine if a server requires OAuth. However, this info can
  // can be determined through config.requiresOAuth. Refactor usages and remove this method.
  public async getOAuthServers(userId?: string): Promise<Set<string>> {
    const allServers = await this.getAllServerConfigs(userId);
    const oauthServers = Object.entries(allServers).filter(([, config]) => config.requiresOAuth);
    return new Set(oauthServers.map(([name]) => name));
  }

  public async reset(): Promise<void> {
    await this.cacheConfigsRepo.reset();
    await this.readThroughCache.clear();
    await this.readThroughCacheAll.clear();
  }

  public async removeServer(
    serverName: string,
    storageLocation: 'CACHE' | 'DB',
    userId?: string,
  ): Promise<void> {
    const configRepo = this.getConfigRepository(storageLocation);
    await configRepo.remove(serverName, userId);
    // Invalidate read-through caches so the removed server disappears immediately
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName, userId));
    await this.readThroughCache.delete(this.getReadThroughCacheKey(serverName));
    await this.readThroughCacheAll.clear();
  }

  private getConfigRepository(storageLocation: 'CACHE' | 'DB'): IServerConfigsRepositoryInterface {
    switch (storageLocation) {
      case 'CACHE':
        return this.cacheConfigsRepo;
      case 'DB':
        return this.dbConfigsRepo;
      default:
        throw new Error(
          `MCPServersRegistry: The provided storage location "${storageLocation}" is not supported`,
        );
    }
  }

  private getReadThroughCacheKey(serverName: string, userId?: string): string {
    return userId ? `${serverName}::${userId}` : serverName;
  }
}
