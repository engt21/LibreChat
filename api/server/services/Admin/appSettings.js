const { isEnabled } = require('@librechat/api');
const { CacheKeys, SystemRoles } = require('librechat-data-provider');
const { AppSettings } = require('~/db/models');
const getLogStores = require('~/cache/getLogStores');

const DEFAULT_SETTINGS_ID = 'global';
const DEFAULT_BYOK_PROVIDER_IDS = [
  'openAI',
  'azureOpenAI',
  'anthropic',
  'google',
  'custom',
  'bedrock',
];

function getDefaultObservabilityLinks() {
  return {
    langfuseUrl: process.env.LANGFUSE_UI_URL || 'http://localhost:3000',
    grafanaUrl: process.env.GRAFANA_UI_URL || 'http://localhost:3001',
    metricsUrl: process.env.METRICS_UI_URL || 'http://localhost:9091',
    prometheusUrl: process.env.PROMETHEUS_UI_URL || 'http://localhost:9092',
  };
}

function getDefaultBYOKSettings() {
  return {
    providers: DEFAULT_BYOK_PROVIDER_IDS.reduce((providers, providerId) => {
      providers[providerId] = {
        enabled: false,
        allowBaseURL: true,
        fallbackToPlatform: true,
      };
      return providers;
    }, {}),
  };
}

function getDefaultMemorySettings() {
  return {
    automaticSaveEnabled: true,
    provider: 'openAI',
    model: 'gpt-5.6-terra',
    instructions: null,
    requireExplicitRequest: true,
    processAfterResponse: true,
    includeAssistantContext: true,
    messageWindowSize: 5,
    contextCharLimit: 60000,
    maxWritesPerTurn: 6,
    maxAttempts: 3,
    processingTimeoutMs: 60000,
    tokenLimit: 6000,
    maxValueTokens: 500,
    charLimit: 4000,
    auditEnabled: true,
    consolidateMemories: true,
    validKeys: [],
    customIntentPhrases: [],
  };
}

function getDefaultDeterministicToolSettings() {
  return {
    calculator: true,
    textAnalyzer: true,
    stringUtility: true,
    jsonUtility: true,
  };
}

function normalizeDeterministicToolSettings(settings) {
  return {
    calculator: settings?.calculator !== false,
    textAnalyzer: settings?.textAnalyzer !== false,
    stringUtility: settings?.stringUtility !== false,
    jsonUtility: settings?.jsonUtility !== false,
  };
}

function normalizeMemorySettings(memory) {
  return {
    ...getDefaultMemorySettings(),
    ...(memory || {}),
    instructions:
      typeof memory?.instructions === 'string' && memory.instructions.trim()
        ? memory.instructions.trim()
        : null,
    validKeys: Array.isArray(memory?.validKeys) ? memory.validKeys : [],
    customIntentPhrases: Array.isArray(memory?.customIntentPhrases)
      ? memory.customIntentPhrases.map((phrase) => phrase.trim()).filter(Boolean)
      : [],
  };
}

function normalizeBYOKSettings(byok) {
  const defaults = getDefaultBYOKSettings();
  const providers = { ...defaults.providers };

  for (const [providerId, policy] of Object.entries(byok?.providers || {})) {
    providers[providerId] = {
      enabled: policy?.enabled === true,
      allowBaseURL: policy?.allowBaseURL !== false,
      fallbackToPlatform: policy?.fallbackToPlatform !== false,
    };
  }

  return { providers };
}

function toEffectiveAppSettings(doc) {
  return {
    settingsId: doc?.settingsId || DEFAULT_SETTINGS_ID,
    registrationEnabled: doc?.registrationEnabled ?? isEnabled(process.env.ALLOW_REGISTRATION),
    modelSteeringEnabled: doc?.modelSteeringEnabled ?? false,
    platformPrompt:
      typeof doc?.platformPrompt === 'string' && doc.platformPrompt.trim()
        ? doc.platformPrompt.trim()
        : null,
    observability: {
      ...getDefaultObservabilityLinks(),
      ...(doc?.observability || {}),
    },
    byok: normalizeBYOKSettings(doc?.byok),
    memory: normalizeMemorySettings(doc?.memory),
    deterministicTools: normalizeDeterministicToolSettings(doc?.deterministicTools),
    mcpDomainFilterMode: doc?.mcpDomainFilterMode ?? 'denylist',
    mcpAllowedDomains: doc?.mcpAllowedDomains ?? [],
    mcpPublishedServers: Array.isArray(doc?.mcpPublishedServers) ? doc.mcpPublishedServers : null,
  };
}

async function getAppSettingsDoc(settingsId = DEFAULT_SETTINGS_ID) {
  return await AppSettings.findOne({ settingsId }).lean();
}

async function getEffectiveAppSettings(settingsId = DEFAULT_SETTINGS_ID) {
  const doc = await getAppSettingsDoc(settingsId);
  return toEffectiveAppSettings(doc);
}

async function invalidateAppSettingsCaches() {
  const configCache = getLogStores(CacheKeys.CONFIG_STORE);
  const appConfigCache = getLogStores(CacheKeys.APP_CONFIG);

  await Promise.all([
    configCache.delete(CacheKeys.STARTUP_CONFIG),
    configCache.delete(CacheKeys.ENDPOINT_CONFIG),
    appConfigCache.delete('_BASE_'),
    appConfigCache.delete(SystemRoles.USER),
    appConfigCache.delete(SystemRoles.ADMIN),
  ]);
}

async function syncMCPPublishedServerSettings(mcpPublishedServers) {
  try {
    const { getMCPServersRegistry } = require('~/config');
    const registry = getMCPServersRegistry();
    if (typeof registry?.setPublishedServerNames === 'function') {
      await registry.setPublishedServerNames(mcpPublishedServers);
    }
  } catch {
    // MCP registry may not be initialized in tests or early startup.
  }
}

function normalizePlatformPrompt(platformPrompt) {
  if (typeof platformPrompt !== 'string') {
    return null;
  }

  const trimmed = platformPrompt.trim();
  return trimmed || null;
}

async function updateAppSettings(updates, settingsId = DEFAULT_SETTINGS_ID) {
  const current = await getAppSettingsDoc(settingsId);
  const nextObservability = {
    ...(current?.observability || {}),
    ...(updates?.observability || {}),
  };
  const nextBYOK =
    updates?.byok !== undefined
      ? normalizeBYOKSettings({
          providers: {
            ...(current?.byok?.providers || {}),
            ...(updates.byok?.providers || {}),
          },
        })
      : undefined;
  const nextMemory =
    updates?.memory !== undefined
      ? normalizeMemorySettings({
          ...(current?.memory || {}),
          ...(updates.memory || {}),
        })
      : undefined;
  const nextDeterministicTools =
    updates?.deterministicTools !== undefined
      ? normalizeDeterministicToolSettings({
          ...(current?.deterministicTools || {}),
          ...(updates.deterministicTools || {}),
        })
      : undefined;

  const persistedUpdates = {
    ...(updates?.registrationEnabled !== undefined
      ? { registrationEnabled: updates.registrationEnabled }
      : {}),
    ...(updates?.modelSteeringEnabled !== undefined
      ? { modelSteeringEnabled: updates.modelSteeringEnabled }
      : {}),
    ...(updates?.platformPrompt !== undefined
      ? { platformPrompt: normalizePlatformPrompt(updates.platformPrompt) }
      : {}),
    observability: nextObservability,
    ...(nextBYOK !== undefined ? { byok: nextBYOK } : {}),
    ...(nextMemory !== undefined ? { memory: nextMemory } : {}),
    ...(nextDeterministicTools !== undefined ? { deterministicTools: nextDeterministicTools } : {}),
    ...(updates?.mcpDomainFilterMode !== undefined
      ? { mcpDomainFilterMode: updates.mcpDomainFilterMode }
      : {}),
    ...(updates?.mcpAllowedDomains !== undefined
      ? { mcpAllowedDomains: updates.mcpAllowedDomains }
      : {}),
    ...(updates?.mcpPublishedServers !== undefined
      ? { mcpPublishedServers: updates.mcpPublishedServers }
      : {}),
  };

  const updated = await AppSettings.findOneAndUpdate(
    { settingsId },
    {
      $set: persistedUpdates,
      $setOnInsert: { settingsId },
    },
    { upsert: true, new: true, lean: true },
  );

  await invalidateAppSettingsCaches();
  if (updates?.mcpPublishedServers !== undefined) {
    await syncMCPPublishedServerSettings(updated.mcpPublishedServers ?? null);
  }
  return toEffectiveAppSettings(updated);
}

module.exports = {
  DEFAULT_SETTINGS_ID,
  getDefaultObservabilityLinks,
  getDefaultBYOKSettings,
  getDefaultMemorySettings,
  getDefaultDeterministicToolSettings,
  getAppSettingsDoc,
  getEffectiveAppSettings,
  invalidateAppSettingsCaches,
  normalizePlatformPrompt,
  normalizeMemorySettings,
  normalizeDeterministicToolSettings,
  updateAppSettings,
};
