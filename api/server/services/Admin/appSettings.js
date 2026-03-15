const { isEnabled } = require('@librechat/api');
const { CacheKeys, SystemRoles } = require('librechat-data-provider');
const { AppSettings } = require('~/db/models');
const getLogStores = require('~/cache/getLogStores');

const DEFAULT_SETTINGS_ID = 'global';

function getDefaultObservabilityLinks() {
  return {
    langfuseUrl: process.env.LANGFUSE_UI_URL || 'http://localhost:3000',
    grafanaUrl: process.env.GRAFANA_UI_URL || 'http://localhost:3001',
    metricsUrl: process.env.METRICS_UI_URL || 'http://localhost:9091',
    prometheusUrl: process.env.PROMETHEUS_UI_URL || 'http://localhost:9090',
  };
}

function toEffectiveAppSettings(doc) {
  return {
    settingsId: doc?.settingsId || DEFAULT_SETTINGS_ID,
    registrationEnabled: doc?.registrationEnabled ?? isEnabled(process.env.ALLOW_REGISTRATION),
    observability: {
      ...getDefaultObservabilityLinks(),
      ...(doc?.observability || {}),
    },
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
    appConfigCache.delete('_BASE_'),
    appConfigCache.delete(SystemRoles.USER),
    appConfigCache.delete(SystemRoles.ADMIN),
  ]);
}

async function updateAppSettings(updates, settingsId = DEFAULT_SETTINGS_ID) {
  const current = await getAppSettingsDoc(settingsId);
  const nextObservability = {
    ...(current?.observability || {}),
    ...(updates?.observability || {}),
  };

  const persistedUpdates = {
    ...(updates?.registrationEnabled !== undefined
      ? { registrationEnabled: updates.registrationEnabled }
      : {}),
    observability: nextObservability,
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
  return toEffectiveAppSettings(updated);
}

module.exports = {
  DEFAULT_SETTINGS_ID,
  getDefaultObservabilityLinks,
  getAppSettingsDoc,
  getEffectiveAppSettings,
  invalidateAppSettingsCaches,
  updateAppSettings,
};
