import { z } from 'zod';

export enum AdminPermissions {
  USERS_READ = 'users.read',
  USERS_DELETE = 'users.delete',
  USAGE_READ = 'usage.read',
  SETTINGS_READ = 'settings.read',
  SETTINGS_WRITE = 'settings.write',
  OBSERVABILITY_READ = 'observability.read',
}

export const adminPermissionSchema = z.nativeEnum(AdminPermissions);
export type TAdminPermission = z.infer<typeof adminPermissionSchema>;

export const allAdminPermissions = Object.values(AdminPermissions);

export enum DefaultAdminRoleIds {
  WORKSPACE_ADMIN = 'workspace_admin',
  SUPPORT_ADMIN = 'support_admin',
  OBSERVABILITY_ADMIN = 'observability_admin',
}

export const observabilityLinksSchema = z.object({
  langfuseUrl: z.string().optional(),
  grafanaUrl: z.string().optional(),
  metricsUrl: z.string().optional(),
  prometheusUrl: z.string().optional(),
});

export type TObservabilityLinks = z.infer<typeof observabilityLinksSchema>;

export const adminRoleSchema = z.object({
  adminRoleId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  permissions: z.array(adminPermissionSchema),
  isSystem: z.boolean().optional(),
});

export type TAdminRole = z.infer<typeof adminRoleSchema>;

export const defaultAdminRoles = adminRoleSchema.array().parse([
  {
    adminRoleId: DefaultAdminRoleIds.WORKSPACE_ADMIN,
    name: 'Workspace Admin',
    description:
      'View and delete users, manage safe live settings, and open observability dashboards.',
    permissions: [
      AdminPermissions.USERS_READ,
      AdminPermissions.USERS_DELETE,
      AdminPermissions.USAGE_READ,
      AdminPermissions.SETTINGS_READ,
      AdminPermissions.SETTINGS_WRITE,
      AdminPermissions.OBSERVABILITY_READ,
    ],
    isSystem: true,
  },
  {
    adminRoleId: DefaultAdminRoleIds.SUPPORT_ADMIN,
    name: 'Support Admin',
    description: 'View users, inspect usage, and review workspace settings.',
    permissions: [
      AdminPermissions.USERS_READ,
      AdminPermissions.USAGE_READ,
      AdminPermissions.SETTINGS_READ,
    ],
    isSystem: true,
  },
  {
    adminRoleId: DefaultAdminRoleIds.OBSERVABILITY_ADMIN,
    name: 'Observability Admin',
    description: 'Open tracing, metrics, and logging dashboards.',
    permissions: [AdminPermissions.OBSERVABILITY_READ],
    isSystem: true,
  },
]);

export const adminPermissionsResponseSchema = z.object({
  isSuperAdmin: z.boolean(),
  permissions: z.array(adminPermissionSchema),
  adminRoles: z.array(adminRoleSchema),
});

export type TAdminPermissionsResponse = z.infer<typeof adminPermissionsResponseSchema>;

export const adminModelPermissionRuleSchema = z.object({
  endpoint: z.string(),
  models: z.array(z.string()).default([]),
});

export type TAdminModelPermissionRule = z.infer<typeof adminModelPermissionRuleSchema>;

export const adminModelPermissionsSchema = z.object({
  enabled: z.boolean().default(false),
  rules: z.array(adminModelPermissionRuleSchema).default([]),
});

export type TAdminModelPermissions = z.infer<typeof adminModelPermissionsSchema>;

export const adminModelRateLimitRuleSchema = z.object({
  endpoint: z.string(),
  model: z.string(),
  requestsPerDay: z.number().int().positive().nullable().optional(),
  tokensPerDay: z.number().int().positive().nullable().optional(),
});

export type TAdminModelRateLimitRule = z.infer<typeof adminModelRateLimitRuleSchema>;

export const adminModelRateLimitsSchema = z.object({
  enabled: z.boolean().default(false),
  rules: z.array(adminModelRateLimitRuleSchema).default([]),
});

export type TAdminModelRateLimits = z.infer<typeof adminModelRateLimitsSchema>;

export const adminImageGenerationPrefsSchema = z.object({
  enabledByDefault: z.boolean().optional(),
  preferredProvider: z.string().nullable().optional(),
  models: z.record(z.string()).default({}),
});

export type TAdminImageGenerationPrefs = z.infer<typeof adminImageGenerationPrefsSchema>;

export const adminModelSteeringPrefsSchema = z.object({
  enabled: z.boolean().optional(),
});

export type TAdminModelSteeringPrefs = z.infer<typeof adminModelSteeringPrefsSchema>;

export const adminNotificationPrefsSchema = z.object({
  email: z
    .object({
      enabled: z.boolean().optional(),
      address: z.string().optional(),
    })
    .optional(),
  sms: z
    .object({
      enabled: z.boolean().optional(),
      provider: z.string().optional(),
    })
    .optional(),
  push: z
    .object({
      enabled: z.boolean().optional(),
      subscriptionCount: z.number().optional(),
    })
    .optional(),
});

export type TAdminNotificationPrefs = z.infer<typeof adminNotificationPrefsSchema>;

export const adminUserPreferencesSchema = z.object({
  personalization: z
    .object({
      memories: z.boolean().optional(),
    })
    .default({}),
  imageGeneration: adminImageGenerationPrefsSchema.default({
    enabledByDefault: true,
    preferredProvider: null,
    models: {},
  }),
  modelSteering: adminModelSteeringPrefsSchema.default({ enabled: true }),
  notifications: adminNotificationPrefsSchema.default({}),
});

export type TAdminUserPreferences = z.infer<typeof adminUserPreferencesSchema>;

export const adminUserSummarySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  username: z.string().optional(),
  email: z.string(),
  provider: z.string(),
  role: z.string(),
  adminRoleIds: z.array(z.string()).default([]),
  adminRoles: z.array(adminRoleSchema).default([]),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  termsAccepted: z.boolean(),
  memoriesEnabled: z.boolean().optional(),
  favoritesCount: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type TAdminUserSummary = z.infer<typeof adminUserSummarySchema>;

export const adminUserDetailsUserSchema = adminUserSummarySchema.extend({
  modelPermissions: adminModelPermissionsSchema.default({ enabled: false, rules: [] }),
  modelRateLimits: adminModelRateLimitsSchema.default({ enabled: false, rules: [] }),
  preferences: adminUserPreferencesSchema.optional(),
});

export type TAdminUserDetailsUser = z.infer<typeof adminUserDetailsUserSchema>;

export const adminUserListResponseSchema = z.object({
  users: z.array(adminUserSummarySchema),
});

export type TAdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;

export const adminUsageSummarySchema = z.object({
  userId: z.string(),
  name: z.string().optional(),
  email: z.string(),
  role: z.string(),
  adminRoles: z.array(adminRoleSchema).default([]),
  tokenCredits: z.number(),
  conversationCount: z.number(),
  messageCount: z.number(),
  transactionCount: z.number(),
  lastTransactionAt: z.string().optional(),
  lastActiveAt: z.union([z.string(), z.date()]).optional(),
  scheduledRunCount: z.number().optional(),
  mcpServerCount: z.number().optional(),
  byokKeyCount: z.number().optional(),
});

export type TAdminUsageSummary = z.infer<typeof adminUsageSummarySchema>;

export const adminUsageResponseSchema = z.object({
  users: z.array(adminUsageSummarySchema),
});

export type TAdminUsageResponse = z.infer<typeof adminUsageResponseSchema>;

export const adminMCPServerSchema = z.object({
  serverName: z.string(),
  storage: z.enum(['static', 'user']),
  published: z.boolean(),
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.string().optional(),
  url: z.string().optional(),
  ownerId: z.string().optional(),
  ownerEmail: z.string().optional(),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type TAdminMCPServer = z.infer<typeof adminMCPServerSchema>;

export const adminMCPServersResponseSchema = z.object({
  servers: z.array(adminMCPServerSchema),
});

export type TAdminMCPServersResponse = z.infer<typeof adminMCPServersResponseSchema>;

export const adminMCPServerPublicationUpdateSchema = z.object({
  published: z.boolean(),
});

export type TAdminMCPServerPublicationUpdate = z.infer<
  typeof adminMCPServerPublicationUpdateSchema
>;

export const adminUserDetailsSchema = z.object({
  user: adminUserDetailsUserSchema,
  usage: adminUsageSummarySchema,
  mcpServers: z
    .array(
      z.object({
        serverName: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        type: z.string().optional(),
        url: z.string().optional(),
        createdAt: z.union([z.string(), z.date()]).optional(),
        updatedAt: z.union([z.string(), z.date()]).optional(),
      }),
    )
    .default([]),
  byokKeys: z
    .array(
      z.object({
        provider: z.string(),
        expiresAt: z.union([z.string(), z.date()]).nullable().optional(),
        expired: z.boolean(),
      }),
    )
    .default([]),
});

export type TAdminUserDetails = z.infer<typeof adminUserDetailsSchema>;

export const mcpDomainFilterModeSchema = z.enum(['allowlist', 'denylist']);
export type MCPDomainFilterMode = z.infer<typeof mcpDomainFilterModeSchema>;
export const platformPromptSchema = z.string().max(20000).nullable();

export const adminBYOKProviderPolicySchema = z.object({
  enabled: z.boolean().default(false),
  allowBaseURL: z.boolean().default(true),
  fallbackToPlatform: z.boolean().default(true),
});

export type TAdminBYOKProviderPolicy = z.infer<typeof adminBYOKProviderPolicySchema>;

export const adminBYOKSettingsSchema = z.object({
  providers: z.record(adminBYOKProviderPolicySchema).default({}),
});

export type TAdminBYOKSettings = z.infer<typeof adminBYOKSettingsSchema>;

export const adminSettingsSchema = z.object({
  settingsId: z.string(),
  registrationEnabled: z.boolean(),
  modelSteeringEnabled: z.boolean(),
  platformPrompt: platformPromptSchema,
  observability: observabilityLinksSchema,
  byok: adminBYOKSettingsSchema.default({ providers: {} }),
  mcpDomainFilterMode: mcpDomainFilterModeSchema.optional(),
  mcpAllowedDomains: z.array(z.string()).optional(),
  mcpPublishedServers: z.array(z.string()).optional().nullable(),
});

export type TAdminSettings = z.infer<typeof adminSettingsSchema>;

export const adminSettingsUpdateSchema = z.object({
  registrationEnabled: z.boolean().optional(),
  modelSteeringEnabled: z.boolean().optional(),
  platformPrompt: platformPromptSchema.optional(),
  observability: observabilityLinksSchema.partial().optional(),
  byok: adminBYOKSettingsSchema.partial().optional(),
  mcpDomainFilterMode: mcpDomainFilterModeSchema.optional(),
  mcpAllowedDomains: z.array(z.string()).optional(),
  mcpPublishedServers: z.array(z.string()).optional().nullable(),
});

export type TAdminSettingsUpdate = z.infer<typeof adminSettingsUpdateSchema>;

export const adminObservabilitySchema = z.object({
  links: observabilityLinksSchema,
  providerLogPath: z.string(),
});

export type TAdminObservability = z.infer<typeof adminObservabilitySchema>;

export const adminUserUpdateSchema = z.object({
  role: z.string().optional(),
  adminRoleIds: z.array(z.string()).optional(),
  modelPermissions: adminModelPermissionsSchema.optional(),
  modelRateLimits: adminModelRateLimitsSchema.optional(),
  personalization: z
    .object({
      memories: z.boolean().optional(),
    })
    .optional(),
  imageGenerationPrefs: adminImageGenerationPrefsSchema.optional(),
  modelSteeringPrefs: adminModelSteeringPrefsSchema.optional(),
  notifications: adminNotificationPrefsSchema.optional(),
});

export type TAdminUserUpdate = z.infer<typeof adminUserUpdateSchema>;

export type AdminListParams = {
  q?: string;
  limit?: number;
};

export const adminModelsRefreshProviderSchema = z.object({
  count: z.number(),
  models: z.array(z.string()),
});

export type TAdminModelsRefreshProvider = z.infer<typeof adminModelsRefreshProviderSchema>;

export const adminModelsRefreshResponseSchema = z.object({
  refreshedAt: z.string(),
  providers: z.record(adminModelsRefreshProviderSchema),
});

export type TAdminModelsRefreshResponse = z.infer<typeof adminModelsRefreshResponseSchema>;

export const adminModelsRefreshRequestSchema = z.object({
  provider: z.string().optional(),
});

export type TAdminModelsRefreshRequest = z.infer<typeof adminModelsRefreshRequestSchema>;
