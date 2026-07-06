import {
  adminSettingsSchema,
  adminSettingsUpdateSchema,
  adminMCPServersResponseSchema,
  adminMCPServerPublicationUpdateSchema,
  adminUserDetailsSchema,
  adminUserUpdateSchema,
  adminUsageSummarySchema,
} from './admin';

describe('admin schemas', () => {
  it('parses admin user details with safe preferences, MCP servers, and BYOK status', () => {
    const parsed = adminUserDetailsSchema.parse({
      user: {
        id: 'user-1',
        name: 'Test User',
        username: '',
        email: 'user@example.com',
        provider: 'local',
        role: 'USER',
        adminRoleIds: [],
        adminRoles: [],
        emailVerified: true,
        twoFactorEnabled: false,
        termsAccepted: true,
        memoriesEnabled: false,
        favoritesCount: 0,
        modelPermissions: { enabled: false, rules: [] },
        modelRateLimits: {
          enabled: true,
          rules: [
            {
              endpoint: 'openAI',
              model: 'gpt-5.4-mini',
              requestsPerDay: 10,
              tokensPerDay: 100000,
            },
          ],
        },
        preferences: {
          personalization: { memories: false },
          imageGeneration: {
            enabledByDefault: false,
            preferredProvider: 'openAI',
            models: { openAI: 'gpt-image-1' },
          },
          modelSteering: { enabled: false },
          notifications: {
            email: { enabled: true, address: 'alerts@example.com' },
            sms: { enabled: false, provider: 'twilio' },
            push: { enabled: true, subscriptionCount: 2 },
          },
        },
      },
      usage: {
        userId: 'user-1',
        email: 'user@example.com',
        role: 'USER',
        adminRoles: [],
        tokenCredits: 0,
        conversationCount: 1,
        messageCount: 2,
        transactionCount: 3,
        scheduledRunCount: 4,
        mcpServerCount: 5,
        byokKeyCount: 6,
      },
      mcpServers: [
        {
          serverName: 'research',
          title: 'Research',
          description: '',
          type: 'streamable-http',
          url: 'https://mcp.example.test/mcp',
        },
      ],
      byokKeys: [{ provider: 'openAI', expiresAt: null, expired: false }],
    });

    expect(parsed.user.preferences?.notifications.push?.subscriptionCount).toBe(2);
    expect(parsed.user.modelRateLimits.rules[0].tokensPerDay).toBe(100000);
    expect(parsed.usage.mcpServerCount).toBe(5);
    expect(parsed.mcpServers[0].serverName).toBe('research');
  });

  it('allows only safe preferences in admin user update payloads', () => {
    const parsed = adminUserUpdateSchema.parse({
      personalization: { memories: true },
      imageGenerationPrefs: {
        enabledByDefault: true,
        preferredProvider: null,
        models: {},
      },
      modelSteeringPrefs: { enabled: false },
      modelRateLimits: {
        enabled: true,
        rules: [
          {
            endpoint: 'openAI',
            model: 'gpt-5.4-mini',
            requestsPerDay: 10,
            tokensPerDay: 100000,
          },
        ],
      },
      notifications: {
        email: { enabled: true, address: 'alerts@example.com' },
        sms: { enabled: false, provider: 'twilio' },
        push: {
          enabled: true,
          subscriptions: [{ endpoint: 'must-be-stripped-by-schema' }],
        },
      },
    });

    expect(parsed.notifications?.push).toEqual({ enabled: true });
    expect(parsed.modelRateLimits?.rules[0].requestsPerDay).toBe(10);
  });

  it('keeps new usage metrics optional for existing admin usage responses', () => {
    expect(() =>
      adminUsageSummarySchema.parse({
        userId: 'user-1',
        email: 'user@example.com',
        role: 'USER',
        adminRoles: [],
        tokenCredits: 0,
        conversationCount: 0,
        messageCount: 0,
        transactionCount: 0,
      }),
    ).not.toThrow();
  });

  it('parses admin MCP published-server settings', () => {
    const settings = adminSettingsSchema.parse({
      settingsId: 'global',
      registrationEnabled: true,
      modelSteeringEnabled: false,
      platformPrompt: null,
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
      mcpPublishedServers: ['arcade-read', 'research'],
    });

    expect(settings).toEqual(
      expect.objectContaining({
        byok: {
          providers: {
            openAI: {
              enabled: true,
              allowBaseURL: true,
              fallbackToPlatform: true,
            },
          },
        },
        mcpPublishedServers: ['arcade-read', 'research'],
      }),
    );
    expect(settings.memory.model).toBe('gpt-5.6-terra');
    expect(settings.deterministicTools).toEqual({
      calculator: true,
      textAnalyzer: true,
      stringUtility: true,
      jsonUtility: true,
    });

    expect(
      adminSettingsUpdateSchema.parse({
        byok: {
          providers: {
            openAI: {
              enabled: false,
              allowBaseURL: true,
              fallbackToPlatform: true,
            },
          },
        },
        mcpPublishedServers: ['arcade-read'],
        deterministicTools: {
          calculator: false,
        },
      }),
    ).toEqual({
      byok: {
        providers: {
          openAI: {
            enabled: false,
            allowBaseURL: true,
            fallbackToPlatform: true,
          },
        },
      },
      mcpPublishedServers: ['arcade-read'],
      deterministicTools: {
        calculator: false,
      },
    });
  });

  it('parses admin MCP server list and publication updates', () => {
    expect(
      adminMCPServersResponseSchema.parse({
        servers: [
          {
            serverName: 'arcade-read',
            storage: 'static',
            published: true,
            title: 'Arcade READ',
            type: 'streamable-http',
            url: 'https://api.arcade.dev/mcp/',
          },
        ],
      }).servers[0].published,
    ).toBe(true);

    expect(adminMCPServerPublicationUpdateSchema.parse({ published: false })).toEqual({
      published: false,
    });
  });
});
