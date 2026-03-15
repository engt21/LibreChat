import { z } from 'zod';

export enum AdminPermissions {
  USERS_READ = 'users.read',
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
      'View users and usage, manage safe live settings, and open observability dashboards.',
    permissions: [
      AdminPermissions.USERS_READ,
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
});

export type TAdminUsageSummary = z.infer<typeof adminUsageSummarySchema>;

export const adminUsageResponseSchema = z.object({
  users: z.array(adminUsageSummarySchema),
});

export type TAdminUsageResponse = z.infer<typeof adminUsageResponseSchema>;

export const adminUserDetailsSchema = z.object({
  user: adminUserDetailsUserSchema,
  usage: adminUsageSummarySchema,
});

export type TAdminUserDetails = z.infer<typeof adminUserDetailsSchema>;

export const adminSettingsSchema = z.object({
  settingsId: z.string(),
  registrationEnabled: z.boolean(),
  observability: observabilityLinksSchema,
});

export type TAdminSettings = z.infer<typeof adminSettingsSchema>;

export const adminSettingsUpdateSchema = z.object({
  registrationEnabled: z.boolean().optional(),
  observability: observabilityLinksSchema.partial().optional(),
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
});

export type TAdminUserUpdate = z.infer<typeof adminUserUpdateSchema>;

export type AdminListParams = {
  q?: string;
  limit?: number;
};
