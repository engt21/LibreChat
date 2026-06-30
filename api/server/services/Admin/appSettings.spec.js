jest.mock(
  '@librechat/api',
  () => ({
    isEnabled: jest.fn((value) => value === true || value === 'true'),
  }),
  { virtual: true },
);

jest.mock('librechat-data-provider', () => ({
  CacheKeys: {
    CONFIG_STORE: 'CONFIG_STORE',
    APP_CONFIG: 'APP_CONFIG',
    STARTUP_CONFIG: 'STARTUP_CONFIG',
  },
  SystemRoles: {
    USER: 'USER',
    ADMIN: 'ADMIN',
  },
}));

const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
jest.mock('~/db/models', () => ({
  AppSettings: {
    findOne: (...args) => mockFindOne(...args),
    findOneAndUpdate: (...args) => mockFindOneAndUpdate(...args),
  },
}));

const mockDelete = jest.fn().mockResolvedValue(undefined);
jest.mock('~/cache/getLogStores', () => jest.fn(() => ({ delete: mockDelete })));

const {
  getEffectiveAppSettings,
  normalizePlatformPrompt,
  updateAppSettings,
} = require('./appSettings');

function mockFindOneDoc(doc) {
  mockFindOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue(doc),
  });
}

describe('Admin app settings service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDelete.mockResolvedValue(undefined);
    delete process.env.ALLOW_REGISTRATION;
  });

  it('returns null platformPrompt when no prompt is configured', async () => {
    mockFindOneDoc(null);

    const settings = await getEffectiveAppSettings();

    expect(settings.platformPrompt).toBeNull();
  });

  it('normalizes configured platform prompts', async () => {
    mockFindOneDoc({
      settingsId: 'global',
      platformPrompt: '  Platform policy  ',
    });

    const settings = await getEffectiveAppSettings();

    expect(settings.platformPrompt).toBe('Platform policy');
  });

  it('defaults model steering to disabled when no setting is stored', async () => {
    mockFindOneDoc(null);

    const settings = await getEffectiveAppSettings();

    expect(settings.modelSteeringEnabled).toBe(false);
  });

  it('defaults observability links to the VM sidecar ports', async () => {
    mockFindOneDoc(null);

    const settings = await getEffectiveAppSettings();

    expect(settings.observability).toEqual({
      langfuseUrl: 'http://localhost:3000',
      grafanaUrl: 'http://localhost:3001',
      metricsUrl: 'http://localhost:9091',
      prometheusUrl: 'http://localhost:9092',
    });
  });

  it('normalizes empty or non-string platform prompt updates to null', () => {
    expect(normalizePlatformPrompt('  ')).toBeNull();
    expect(normalizePlatformPrompt(null)).toBeNull();
    expect(normalizePlatformPrompt(' Platform policy ')).toBe('Platform policy');
  });

  it('persists platformPrompt updates with existing settings', async () => {
    mockFindOneDoc({ settingsId: 'global', observability: { grafanaUrl: 'http://grafana' } });
    mockFindOneAndUpdate.mockResolvedValue({
      settingsId: 'global',
      platformPrompt: 'Platform policy',
      observability: { grafanaUrl: 'http://grafana' },
    });

    const settings = await updateAppSettings({ platformPrompt: '  Platform policy  ' });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { settingsId: 'global' },
      expect.objectContaining({
        $set: expect.objectContaining({
          platformPrompt: 'Platform policy',
        }),
      }),
      expect.objectContaining({ upsert: true, new: true, lean: true }),
    );
    expect(settings.platformPrompt).toBe('Platform policy');
  });

  it('persists model steering updates', async () => {
    mockFindOneDoc({ settingsId: 'global' });
    mockFindOneAndUpdate.mockResolvedValue({
      settingsId: 'global',
      modelSteeringEnabled: true,
      observability: {},
    });

    const settings = await updateAppSettings({ modelSteeringEnabled: true });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { settingsId: 'global' },
      expect.objectContaining({
        $set: expect.objectContaining({
          modelSteeringEnabled: true,
        }),
      }),
      expect.objectContaining({ upsert: true, new: true, lean: true }),
    );
    expect(settings.modelSteeringEnabled).toBe(true);
  });

  it('returns null MCP published server allowlist by default to preserve existing YAML visibility', async () => {
    mockFindOneDoc(null);

    const settings = await getEffectiveAppSettings();

    expect(settings.mcpPublishedServers).toBeNull();
  });

  it('returns BYOK provider policies disabled by default', async () => {
    mockFindOneDoc(null);

    const settings = await getEffectiveAppSettings();

    expect(settings.byok.providers.openAI).toEqual({
      enabled: false,
      allowBaseURL: true,
      fallbackToPlatform: true,
    });
  });

  it('persists BYOK provider policy updates', async () => {
    mockFindOneDoc({
      settingsId: 'global',
      observability: {},
      byok: { providers: { openAI: { enabled: false } } },
    });
    mockFindOneAndUpdate.mockResolvedValue({
      settingsId: 'global',
      observability: {},
      byok: {
        providers: {
          openAI: {
            enabled: true,
            allowBaseURL: true,
            fallbackToPlatform: true,
          },
        },
      },
    });

    const settings = await updateAppSettings({
      byok: {
        providers: {
          openAI: {
            enabled: true,
            allowBaseURL: true,
            fallbackToPlatform: true,
          },
        },
      },
    });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { settingsId: 'global' },
      expect.objectContaining({
        $set: expect.objectContaining({
          byok: {
            providers: expect.objectContaining({
              openAI: {
                enabled: true,
                allowBaseURL: true,
                fallbackToPlatform: true,
              },
            }),
          },
        }),
      }),
      expect.objectContaining({ upsert: true, new: true, lean: true }),
    );
    expect(settings.byok.providers.openAI.enabled).toBe(true);
  });

  it('persists MCP published server allowlist updates', async () => {
    mockFindOneDoc({ settingsId: 'global', observability: {} });
    mockFindOneAndUpdate.mockResolvedValue({
      settingsId: 'global',
      observability: {},
      mcpPublishedServers: ['arcade-read'],
    });

    const settings = await updateAppSettings({ mcpPublishedServers: ['arcade-read'] });

    expect(mockFindOneAndUpdate).toHaveBeenCalledWith(
      { settingsId: 'global' },
      expect.objectContaining({
        $set: expect.objectContaining({
          mcpPublishedServers: ['arcade-read'],
        }),
      }),
      expect.objectContaining({ upsert: true, new: true, lean: true }),
    );
    expect(settings.mcpPublishedServers).toEqual(['arcade-read']);
  });
});
