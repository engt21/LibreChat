import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Shield,
  Users,
  Activity,
  Settings2,
  ExternalLink,
  BarChart3,
  Plus,
  X,
  RefreshCcw,
} from 'lucide-react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import {
  Button,
  Input,
  Label,
  OGDialog,
  Spinner,
  Switch,
  TrashIcon,
  useToastContext,
  OGDialogTrigger,
  OGDialogTemplate,
} from '@librechat/client';
import {
  AdminPermissions,
  SystemRoles,
  alternateName,
  type TAdminRole,
  type TAdminSettings,
  type TAdminPermission,
  type TAdminModelPermissions,
  type TAdminModelRateLimits,
} from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { ContextType } from '~/common';
import { OpenSidebar } from '~/components/Chat/Menus';
import { useAuthContext, useDocumentTitle, useLocalize } from '~/hooks';
import {
  useAdminUserQuery,
  useAdminRolesQuery,
  useAdminUsageQuery,
  useAdminUsersQuery,
  useAdminMCPServersQuery,
  useAdminSettingsQuery,
  useAdminPermissionsQuery,
  useAdminObservabilityQuery,
  useDeleteAdminUserMutation,
  useUpdateAdminUserMutation,
  useUpdateAdminMCPServerPublicationMutation,
  useUpdateAdminSettingsMutation,
  useRefreshAdminModelsMutation,
} from '~/data-provider';

const DEFAULT_SETTINGS: TAdminSettings = {
  settingsId: 'global',
  registrationEnabled: false,
  modelSteeringEnabled: false,
  platformPrompt: null,
  observability: {
    langfuseUrl: '',
    grafanaUrl: '',
    metricsUrl: '',
    prometheusUrl: '',
  },
  byok: {
    providers: {
      openAI: { enabled: false, allowBaseURL: true, fallbackToPlatform: true },
      azureOpenAI: { enabled: false, allowBaseURL: true, fallbackToPlatform: true },
      anthropic: { enabled: false, allowBaseURL: true, fallbackToPlatform: true },
      google: { enabled: false, allowBaseURL: true, fallbackToPlatform: true },
      custom: { enabled: false, allowBaseURL: true, fallbackToPlatform: true },
      bedrock: { enabled: false, allowBaseURL: true, fallbackToPlatform: true },
    },
  },
  mcpDomainFilterMode: 'denylist',
};

const BYOK_PROVIDER_IDS = ['openAI', 'azureOpenAI', 'anthropic', 'google', 'custom', 'bedrock'];
const MODEL_ACCESS_EXCLUDED_ENDPOINTS = new Set(['assistants', 'azureAssistants']);

const DEFAULT_MODEL_PERMISSIONS: TAdminModelPermissions = {
  enabled: false,
  rules: [],
};

const DEFAULT_MODEL_RATE_LIMITS: TAdminModelRateLimits = {
  enabled: false,
  rules: [],
};

function normalizeModelPermissions(
  modelPermissions: TAdminModelPermissions | undefined,
): TAdminModelPermissions {
  const endpointMap = new Map<string, Set<string>>();

  for (const rule of modelPermissions?.rules ?? []) {
    const endpoint = rule.endpoint?.trim();
    if (!endpoint || MODEL_ACCESS_EXCLUDED_ENDPOINTS.has(endpoint)) {
      continue;
    }

    const models = endpointMap.get(endpoint) ?? new Set<string>();
    for (const model of rule.models ?? []) {
      const normalizedModel = model?.trim();
      if (normalizedModel) {
        models.add(normalizedModel);
      }
    }
    endpointMap.set(endpoint, models);
  }

  return {
    enabled: modelPermissions?.enabled === true,
    rules: Array.from(endpointMap.entries())
      .map(([endpoint, models]) => ({
        endpoint,
        models: Array.from(models).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.endpoint.localeCompare(b.endpoint)),
  };
}

function normalizeModelRateLimits(
  modelRateLimits: TAdminModelRateLimits | undefined,
): TAdminModelRateLimits {
  const seen = new Set<string>();
  const rules: TAdminModelRateLimits['rules'] = [];

  for (const rule of modelRateLimits?.rules ?? []) {
    const endpoint = rule.endpoint?.trim();
    const model = rule.model?.trim();
    if (!endpoint || !model) {
      continue;
    }

    const requestsPerDay =
      Number.isInteger(rule.requestsPerDay) && Number(rule.requestsPerDay) > 0
        ? Number(rule.requestsPerDay)
        : null;
    const tokensPerDay =
      Number.isInteger(rule.tokensPerDay) && Number(rule.tokensPerDay) > 0
        ? Number(rule.tokensPerDay)
        : null;
    if (!requestsPerDay && !tokensPerDay) {
      continue;
    }

    const key = `${endpoint}:${model}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rules.push({ endpoint, model, requestsPerDay, tokensPerDay });
  }

  return {
    enabled: modelRateLimits?.enabled === true,
    rules: rules.sort((a, b) =>
      `${a.endpoint}:${a.model}`.localeCompare(`${b.endpoint}:${b.model}`),
    ),
  };
}

function SectionCard({
  title,
  description,
  icon,
  children,
}: {
  title: string;
  description?: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border-light bg-surface-primary p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-xl bg-surface-tertiary p-2 text-text-primary">{icon}</div>
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {description ? <p className="text-sm text-text-secondary">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function AccessBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-full border border-border-light bg-surface-secondary px-2 py-1 text-xs font-medium text-text-primary">
      {label}
    </span>
  );
}

function hasPermission(
  isSuperAdmin: boolean,
  permissions: TAdminPermission[],
  permission: AdminPermissions,
) {
  return isSuperAdmin || permissions.includes(permission);
}

export default function AdminConsole() {
  const navigate = useNavigate();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { user } = useAuthContext();
  const { navVisible, setNavVisible } = useOutletContext<ContextType>();

  const [userSearch, setUserSearch] = useState('');
  const [usageSearch, setUsageSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isDeleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState(SystemRoles.USER);
  const [selectedAdminRoleIds, setSelectedAdminRoleIds] = useState<string[]>([]);
  const [selectedModelPermissions, setSelectedModelPermissions] =
    useState<TAdminModelPermissions>(DEFAULT_MODEL_PERMISSIONS);
  const [selectedModelRateLimits, setSelectedModelRateLimits] =
    useState<TAdminModelRateLimits>(DEFAULT_MODEL_RATE_LIMITS);
  const [selectedMemoriesEnabled, setSelectedMemoriesEnabled] = useState(true);
  const [selectedImageGenerationEnabled, setSelectedImageGenerationEnabled] = useState(true);
  const [selectedModelSteeringEnabled, setSelectedModelSteeringEnabled] = useState(true);
  const [settingsForm, setSettingsForm] = useState<TAdminSettings>(DEFAULT_SETTINGS);
  const [newMcpDomain, setNewMcpDomain] = useState('');
  const [activeRefreshProvider, setActiveRefreshProvider] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  useDocumentTitle(`${localize('com_nav_admin_console')} | LibreChat`);

  const yesLabel = localize('com_ui_yes');
  const noLabel = localize('com_ui_no');
  const loadingLabel = localize('com_ui_loading');

  const resolveRoleLabel = (role?: string) => {
    if (role === SystemRoles.ADMIN) {
      return localize('com_ui_admin');
    }

    if (role === SystemRoles.USER) {
      return localize('com_ui_user');
    }

    return role || localize('com_ui_user');
  };

  const isPotentialAdmin =
    user?.role === SystemRoles.ADMIN || (user?.adminRoleIds?.length ?? 0) > 0;

  const adminPermissionsQuery = useAdminPermissionsQuery({
    enabled: isPotentialAdmin,
  });

  const isSuperAdmin = adminPermissionsQuery.data?.isSuperAdmin === true;
  const currentPermissions = adminPermissionsQuery.data?.permissions ?? [];

  const canReadUsers = hasPermission(isSuperAdmin, currentPermissions, AdminPermissions.USERS_READ);
  const canDeleteUsers = hasPermission(
    isSuperAdmin,
    currentPermissions,
    AdminPermissions.USERS_DELETE,
  );
  const canReadUsage = hasPermission(isSuperAdmin, currentPermissions, AdminPermissions.USAGE_READ);
  const canReadSettings = hasPermission(
    isSuperAdmin,
    currentPermissions,
    AdminPermissions.SETTINGS_READ,
  );
  const canWriteSettings = hasPermission(
    isSuperAdmin,
    currentPermissions,
    AdminPermissions.SETTINGS_WRITE,
  );
  const canReadObservability = hasPermission(
    isSuperAdmin,
    currentPermissions,
    AdminPermissions.OBSERVABILITY_READ,
  );

  const adminUsersQuery = useAdminUsersQuery(
    { q: userSearch, limit: 50 },
    { enabled: canReadUsers },
  );

  const adminUserQuery = useAdminUserQuery(selectedUserId, {
    enabled: canReadUsers && !!selectedUserId,
  });

  const adminUsageQuery = useAdminUsageQuery(
    { q: usageSearch, limit: 50 },
    { enabled: canReadUsage },
  );

  const adminMCPServersQuery = useAdminMCPServersQuery({ enabled: canReadSettings });
  const adminSettingsQuery = useAdminSettingsQuery({ enabled: canReadSettings });
  const adminObservabilityQuery = useAdminObservabilityQuery({ enabled: canReadObservability });
  const adminRolesQuery = useAdminRolesQuery({ enabled: isSuperAdmin });
  const adminModelsQuery = useGetModelsQuery({ enabled: isSuperAdmin });

  const updateSettingsMutation = useUpdateAdminSettingsMutation({
    onSuccess: () => {
      showToast({ message: localize('com_admin_settings_saved'), status: 'success' });
    },
    onError: (error) => {
      showToast({
        message: error?.message || localize('com_admin_settings_save_error'),
        status: 'error',
      });
    },
  });

  const updateAdminUserMutation = useUpdateAdminUserMutation({
    onSuccess: () => {
      showToast({ message: localize('com_admin_user_access_updated'), status: 'success' });
    },
    onError: (error) => {
      showToast({
        message: error?.message || localize('com_admin_user_access_update_error'),
        status: 'error',
      });
    },
  });

  const deleteAdminUserMutation = useDeleteAdminUserMutation({
    onSuccess: (_data, variables) => {
      setDeleteDialogOpen(false);
      setSelectedUserId((current) => (current === variables.userId ? null : current));
      showToast({ message: localize('com_admin_user_deleted'), status: 'success' });
    },
    onError: (error) => {
      showToast({
        message: error?.message || localize('com_admin_user_delete_error'),
        status: 'error',
      });
    },
  });

  const updateAdminMCPServerPublicationMutation = useUpdateAdminMCPServerPublicationMutation({
    onSuccess: () => {
      showToast({ message: 'MCP server publication updated', status: 'success' });
    },
    onError: (error) => {
      showToast({
        message: error?.message || 'Failed to update MCP server publication',
        status: 'error',
      });
    },
  });

  const refreshModelsMutation = useRefreshAdminModelsMutation({
    onSuccess: (data, variables) => {
      const providerNames = Object.keys(data?.providers ?? {});
      const totalModels = providerNames.reduce(
        (sum, name) => sum + (data?.providers?.[name]?.count ?? 0),
        0,
      );
      const requestedProvider = variables?.provider ?? '';

      if (requestedProvider) {
        const providerData = data?.providers?.[requestedProvider];
        const displayName =
          alternateName[requestedProvider as keyof typeof alternateName] || requestedProvider;
        showToast({
          message: localize('com_admin_models_refreshed', {
            0: displayName,
            1: String(providerData?.count ?? 0),
          }),
          status: 'success',
        });
      } else {
        showToast({
          message: localize('com_admin_models_refreshed_all', {
            0: String(providerNames.length),
            1: String(totalModels),
          }),
          status: 'success',
        });
      }

      setLastRefreshAt(data?.refreshedAt ?? new Date().toISOString());
      setActiveRefreshProvider(null);
    },
    onError: (error) => {
      showToast({
        message: error?.message || localize('com_admin_models_refresh_error'),
        status: 'error',
      });
      setActiveRefreshProvider(null);
    },
  });

  useEffect(() => {
    if (updateSettingsMutation.isError && !updateSettingsMutation.error?.message) {
      showToast({ message: localize('com_admin_settings_save_error'), status: 'error' });
    }
  }, [localize, showToast, updateSettingsMutation.error?.message, updateSettingsMutation.isError]);

  useEffect(() => {
    if (!isPotentialAdmin) {
      navigate('/c/new', { replace: true });
    }
  }, [isPotentialAdmin, navigate]);

  useEffect(() => {
    if (adminPermissionsQuery.isError) {
      navigate('/c/new', { replace: true });
    }
  }, [adminPermissionsQuery.isError, navigate]);

  useEffect(() => {
    if (!selectedUserId && adminUsersQuery.data?.users?.length) {
      setSelectedUserId(adminUsersQuery.data.users[0].id);
    }
  }, [adminUsersQuery.data?.users, selectedUserId]);

  useEffect(() => {
    if (adminUserQuery.data?.user) {
      setSelectedRole(
        adminUserQuery.data.user.role === SystemRoles.ADMIN ? SystemRoles.ADMIN : SystemRoles.USER,
      );
      setSelectedAdminRoleIds(adminUserQuery.data.user.adminRoleIds ?? []);
      setSelectedModelPermissions(
        normalizeModelPermissions(adminUserQuery.data.user.modelPermissions),
      );
      setSelectedModelRateLimits(
        normalizeModelRateLimits(adminUserQuery.data.user.modelRateLimits),
      );
      setSelectedMemoriesEnabled(
        adminUserQuery.data.user.preferences?.personalization?.memories ??
          adminUserQuery.data.user.memoriesEnabled ??
          true,
      );
      setSelectedImageGenerationEnabled(
        adminUserQuery.data.user.preferences?.imageGeneration?.enabledByDefault ?? true,
      );
      setSelectedModelSteeringEnabled(
        adminUserQuery.data.user.preferences?.modelSteering?.enabled ?? true,
      );
    }
  }, [adminUserQuery.data?.user]);

  useEffect(() => {
    if (adminSettingsQuery.data) {
      setSettingsForm(adminSettingsQuery.data);
    }
  }, [adminSettingsQuery.data]);

  useEffect(() => {
    setDeleteDialogOpen(false);
  }, [selectedUserId]);

  const selectedUser = adminUserQuery.data?.user;
  const selectedUserUsage = adminUserQuery.data?.usage;
  const isSelectedUserSuperAdmin = selectedRole === SystemRoles.ADMIN;
  const canDeleteSelectedUser =
    canDeleteUsers &&
    selectedUser != null &&
    selectedUser.id !== user?.id &&
    (isSuperAdmin || selectedUser.role !== SystemRoles.ADMIN);

  const handleToggleAdminRole = (roleId: string) => {
    setSelectedAdminRoleIds((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId],
    );
  };

  const availableModelEntries = useMemo(
    () =>
      Object.entries(adminModelsQuery.data ?? {})
        .filter(
          ([endpoint, models]) =>
            endpoint !== 'initial' && Array.isArray(models) && models.length > 0,
        )
        .map(
          ([endpoint, models]) =>
            [endpoint, [...models].sort((a, b) => a.localeCompare(b))] as const,
        )
        .sort((a, b) => a[0].localeCompare(b[0])),
    [adminModelsQuery.data],
  );
  const modelAccessEntries = useMemo(
    () =>
      availableModelEntries.filter(
        ([endpoint]) => !MODEL_ACCESS_EXCLUDED_ENDPOINTS.has(endpoint),
      ),
    [availableModelEntries],
  );

  const selectedModelRuleMap = useMemo(
    () =>
      new Map(
        (selectedModelPermissions.rules ?? []).map((rule) => [rule.endpoint, new Set(rule.models)]),
      ),
    [selectedModelPermissions.rules],
  );

  const toggleModelPermission = (endpoint: string, model: string) => {
    setSelectedModelPermissions((current) => {
      const next = normalizeModelPermissions(current);
      const endpointMap = new Map(next.rules.map((rule) => [rule.endpoint, new Set(rule.models)]));
      const models = endpointMap.get(endpoint) ?? new Set<string>();

      if (models.has(model)) {
        models.delete(model);
      } else {
        models.add(model);
      }

      if (models.size === 0) {
        endpointMap.delete(endpoint);
      } else {
        endpointMap.set(endpoint, models);
      }

      return normalizeModelPermissions({
        enabled: current.enabled,
        rules: Array.from(endpointMap.entries()).map(([entryEndpoint, entryModels]) => ({
          endpoint: entryEndpoint,
          models: Array.from(entryModels),
        })),
      });
    });
  };

  const updateModelRateLimitRule = (
    index: number,
    key: 'endpoint' | 'model' | 'requestsPerDay' | 'tokensPerDay',
    value: string,
  ) => {
    setSelectedModelRateLimits((current) => ({
      ...current,
      rules: (current.rules ?? []).map((rule, ruleIndex) => {
        if (ruleIndex !== index) {
          return rule;
        }
        if (key === 'requestsPerDay' || key === 'tokensPerDay') {
          const numericValue = value.trim() ? Number(value) : null;
          return {
            ...rule,
            [key]: Number.isFinite(numericValue) && numericValue ? numericValue : null,
          };
        }
        return { ...rule, [key]: value };
      }),
    }));
  };

  const addModelRateLimitRule = () => {
    setSelectedModelRateLimits((current) => ({
      ...current,
      rules: [
        ...(current.rules ?? []),
        { endpoint: '', model: '', requestsPerDay: null, tokensPerDay: null },
      ],
    }));
  };

  const removeModelRateLimitRule = (index: number) => {
    setSelectedModelRateLimits((current) => ({
      ...current,
      rules: (current.rules ?? []).filter((_, ruleIndex) => ruleIndex !== index),
    }));
  };

  const handleSaveUserAccess = async () => {
    if (!selectedUserId) {
      return;
    }

    await updateAdminUserMutation.mutateAsync({
      userId: selectedUserId,
      payload: {
        role: selectedRole,
        adminRoleIds: selectedAdminRoleIds,
        modelPermissions: normalizeModelPermissions(selectedModelPermissions),
        modelRateLimits: normalizeModelRateLimits(selectedModelRateLimits),
        personalization: { memories: selectedMemoriesEnabled },
        imageGenerationPrefs: {
          ...(selectedUser?.preferences?.imageGeneration ?? {}),
          enabledByDefault: selectedImageGenerationEnabled,
          models: selectedUser?.preferences?.imageGeneration?.models ?? {},
        },
        modelSteeringPrefs: { enabled: selectedModelSteeringEnabled },
      },
    });
  };

  const handleToggleMCPPublication = (serverName: string, published: boolean) => {
    updateAdminMCPServerPublicationMutation.mutate({
      serverName,
      payload: { published },
    });
  };

  const updateBYOKProviderPolicy = (
    providerId: string,
    key: 'enabled' | 'allowBaseURL' | 'fallbackToPlatform',
    value: boolean,
  ) => {
    setSettingsForm((current) => {
      const currentPolicy = current.byok?.providers?.[providerId] ?? {};
      const nextPolicy = {
        enabled: currentPolicy.enabled ?? false,
        allowBaseURL: currentPolicy.allowBaseURL ?? true,
        fallbackToPlatform: currentPolicy.fallbackToPlatform ?? true,
      };
      nextPolicy[key] = value;

      return {
        ...current,
        byok: {
          providers: {
            ...(current.byok?.providers ?? {}),
            [providerId]: nextPolicy,
          },
        },
      };
    });
  };

  const handleSaveSettings = async () => {
    await updateSettingsMutation.mutateAsync({
      registrationEnabled: settingsForm.registrationEnabled,
      modelSteeringEnabled: settingsForm.modelSteeringEnabled,
      platformPrompt: settingsForm.platformPrompt?.trim() ? settingsForm.platformPrompt : null,
      observability: settingsForm.observability,
      byok: settingsForm.byok,
      mcpDomainFilterMode: settingsForm.mcpDomainFilterMode ?? 'denylist',
      mcpAllowedDomains: settingsForm.mcpAllowedDomains ?? [],
    });
  };

  const handleRefreshAllProviders = () => {
    setActiveRefreshProvider('__all__');
    refreshModelsMutation.mutate(undefined);
  };

  const handleRefreshProvider = (provider: string) => {
    setActiveRefreshProvider(provider);
    refreshModelsMutation.mutate({ provider });
  };

  let modelAccessOptionsContent: ReactNode;
  if (adminModelsQuery.isLoading) {
    modelAccessOptionsContent = (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="text-text-primary" />
        {loadingLabel}
      </div>
    );
  } else if (modelAccessEntries.length === 0) {
    modelAccessOptionsContent = (
      <div className="rounded-xl border border-border-light bg-surface-primary p-3 text-sm text-text-secondary">
        {localize('com_admin_model_access_none_available')}
      </div>
    );
  } else {
    modelAccessOptionsContent = modelAccessEntries.map(([endpoint, models]) => (
      <div key={endpoint} className="rounded-xl border border-border-light bg-surface-primary p-3">
        <div className="font-medium text-text-primary">
          {alternateName[endpoint as keyof typeof alternateName] || endpoint}
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {models.map((model) => {
            const checked = selectedModelRuleMap.get(endpoint)?.has(model) ?? false;

            return (
              <label
                key={`${endpoint}-${model}`}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-light bg-surface-secondary p-3"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleModelPermission(endpoint, model)}
                  className="mt-1"
                />
                <div className="text-sm text-text-primary">{model}</div>
              </label>
            );
          })}
        </div>
      </div>
    ));
  }

  const adminUsers = adminUsersQuery.data?.users ?? [];
  const usageUsers = adminUsageQuery.data?.users ?? [];

  let userListContent: ReactNode;
  if (adminUsersQuery.isLoading) {
    userListContent = (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="text-text-primary" />
        {loadingLabel}
      </div>
    );
  } else {
    userListContent = adminUsers.map((adminUser) => {
      const isSelected = adminUser.id === selectedUserId;

      return (
        <button
          key={adminUser.id}
          type="button"
          onClick={() => setSelectedUserId(adminUser.id)}
          className={`rounded-xl border px-3 py-3 text-left transition ${
            isSelected
              ? 'border-text-primary bg-surface-tertiary'
              : 'border-border-light bg-surface-primary hover:bg-surface-tertiary'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-medium text-text-primary">
                {adminUser.name || adminUser.email}
              </div>
              <div className="text-xs text-text-secondary">{adminUser.email}</div>
            </div>
            <AccessBadge label={resolveRoleLabel(adminUser.role)} />
          </div>
          {adminUser.adminRoles.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {adminUser.adminRoles.map((role) => (
                <AccessBadge key={`${adminUser.id}-${role.adminRoleId}`} label={role.name} />
              ))}
            </div>
          ) : null}
        </button>
      );
    });
  }

  let selectedUserContent: ReactNode;
  if (selectedUserId == null) {
    selectedUserContent = (
      <p className="text-sm text-text-secondary">{localize('com_admin_select_user')}</p>
    );
  } else if (adminUserQuery.isLoading) {
    selectedUserContent = (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="text-text-primary" />
        {loadingLabel}
      </div>
    );
  } else if (!selectedUser) {
    selectedUserContent = (
      <p className="text-sm text-text-secondary">{localize('com_admin_user_details_error')}</p>
    );
  } else {
    selectedUserContent = (
      <div className="space-y-5">
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">
                {selectedUser.name || selectedUser.email}
              </h3>
              <p className="text-sm text-text-secondary">{selectedUser.email}</p>
            </div>

            {canDeleteSelectedUser ? (
              <OGDialog open={isDeleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <OGDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <span className="flex items-center gap-2">
                      <TrashIcon />
                      {localize('com_admin_delete_user')}
                    </span>
                  </Button>
                </OGDialogTrigger>
                <OGDialogTemplate
                  title={localize('com_admin_delete_user')}
                  className="max-w-[450px]"
                  main={
                    <div className="space-y-2 text-sm text-text-secondary">
                      <p>{localize('com_admin_delete_user_confirm')}</p>
                      <p>{localize('com_admin_delete_user_desc')}</p>
                    </div>
                  }
                  selection={{
                    selectHandler: () =>
                      deleteAdminUserMutation.mutate({ userId: selectedUser.id }),
                    selectClasses: 'bg-red-600 hover:bg-red-700 dark:hover:bg-red-800 text-white',
                    isLoading: deleteAdminUserMutation.isLoading,
                    selectText: localize('com_ui_delete'),
                  }}
                />
              </OGDialog>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-border-light bg-surface-primary p-3">
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_ui_provider')}
            </div>
            <div className="mt-1 text-sm text-text-primary">{selectedUser.provider}</div>
          </div>
          <div className="rounded-xl border border-border-light bg-surface-primary p-3">
            <div className="text-xs uppercase text-text-secondary">{localize('com_ui_role')}</div>
            <div className="mt-1 text-sm text-text-primary">
              {resolveRoleLabel(selectedUser.role)}
            </div>
          </div>
          <div className="rounded-xl border border-border-light bg-surface-primary p-3">
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_email_verified')}
            </div>
            <div className="mt-1 text-sm text-text-primary">
              {selectedUser.emailVerified ? yesLabel : noLabel}
            </div>
          </div>
          <div className="rounded-xl border border-border-light bg-surface-primary p-3">
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_two_factor_auth')}
            </div>
            <div className="mt-1 text-sm text-text-primary">
              {selectedUser.twoFactorEnabled ? yesLabel : noLabel}
            </div>
          </div>
          <div className="rounded-xl border border-border-light bg-surface-primary p-3">
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_terms_accepted')}
            </div>
            <div className="mt-1 text-sm text-text-primary">
              {selectedUser.termsAccepted ? yesLabel : noLabel}
            </div>
          </div>
          <div className="rounded-xl border border-border-light bg-surface-primary p-3">
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_favorites_saved')}
            </div>
            <div className="mt-1 text-sm text-text-primary">{selectedUser.favoritesCount}</div>
          </div>
        </div>

        {selectedUserUsage ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_admin_balance')}
              </div>
              <div className="mt-1 text-sm text-text-primary">{selectedUserUsage.tokenCredits}</div>
            </div>
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_admin_conversations')}
              </div>
              <div className="mt-1 text-sm text-text-primary">
                {selectedUserUsage.conversationCount}
              </div>
            </div>
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_admin_messages')}
              </div>
              <div className="mt-1 text-sm text-text-primary">{selectedUserUsage.messageCount}</div>
            </div>
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_admin_transactions')}
              </div>
              <div className="mt-1 text-sm text-text-primary">
                {selectedUserUsage.transactionCount}
              </div>
            </div>
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_ui_schedule_runs')}
              </div>
              <div className="mt-1 text-sm text-text-primary">
                {selectedUserUsage.scheduledRunCount ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_ui_mcp_servers')}
              </div>
              <div className="mt-1 text-sm text-text-primary">
                {selectedUserUsage.mcpServerCount ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_admin_byok_keys')}
              </div>
              <div className="mt-1 text-sm text-text-primary">
                {selectedUserUsage.byokKeyCount ?? 0}
              </div>
            </div>
            <div className="rounded-xl border border-border-light bg-surface-primary p-3">
              <div className="text-xs uppercase text-text-secondary">
                {localize('com_admin_last_active')}
              </div>
              <div className="mt-1 text-sm text-text-primary">
                {selectedUserUsage.lastActiveAt
                  ? new Date(selectedUserUsage.lastActiveAt).toLocaleString()
                  : '—'}
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border-light bg-surface-primary p-4">
          <h4 className="font-semibold text-text-primary">{localize('com_admin_preferences')}</h4>
          <p className="mt-1 text-sm text-text-secondary">
            {localize('com_admin_preferences_desc')}
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-surface-secondary p-3">
              <span className="text-sm text-text-primary">{localize('com_ui_memories')}</span>
              <Switch
                checked={selectedMemoriesEnabled}
                onCheckedChange={setSelectedMemoriesEnabled}
                aria-label="Memories"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-surface-secondary p-3">
              <span className="text-sm text-text-primary">
                {localize('com_admin_image_generation_by_default')}
              </span>
              <Switch
                checked={selectedImageGenerationEnabled}
                onCheckedChange={setSelectedImageGenerationEnabled}
                aria-label="Image generation by default"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-border-light bg-surface-secondary p-3">
              <span className="text-sm text-text-primary">{localize('com_ui_model_steering')}</span>
              <Switch
                checked={selectedModelSteeringEnabled}
                onCheckedChange={setSelectedModelSteeringEnabled}
                aria-label="Model steering"
              />
            </label>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-border-light bg-surface-primary p-4">
            <h4 className="font-semibold text-text-primary">
              {localize('com_admin_user_mcp_servers')}
            </h4>
            <div className="mt-3 space-y-2">
              {(adminUserQuery.data?.mcpServers ?? []).length > 0 ? (
                adminUserQuery.data?.mcpServers.map((server) => (
                  <div
                    key={server.serverName}
                    className="rounded-xl border border-border-light bg-surface-secondary p-3"
                  >
                    <div className="font-medium text-text-primary">
                      {server.title || server.serverName}
                    </div>
                    <div className="text-xs text-text-secondary">{server.url || server.type}</div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-text-secondary">
                  {localize('com_admin_no_user_mcp_servers')}
                </p>
              )}
            </div>
          </div>
          <div className="rounded-2xl border border-border-light bg-surface-primary p-4">
            <h4 className="font-semibold text-text-primary">
              {localize('com_admin_byok_provider_status')}
            </h4>
            <div className="mt-3 flex flex-wrap gap-2">
              {(adminUserQuery.data?.byokKeys ?? []).length > 0 ? (
                adminUserQuery.data?.byokKeys.map((key) => (
                  <AccessBadge
                    key={key.provider}
                    label={`${key.provider}${key.expired ? ' (expired)' : ''}`}
                  />
                ))
              ) : (
                <p className="text-sm text-text-secondary">
                  {localize('com_admin_no_user_byok_keys')}
                </p>
              )}
            </div>
          </div>
        </div>

        {isSuperAdmin ? (
          <div className="rounded-2xl border border-border-light bg-surface-primary p-4">
            <h4 className="font-semibold text-text-primary">
              {localize('com_admin_manage_access')}
            </h4>
            <p className="mt-1 text-sm text-text-secondary">
              {localize('com_admin_manage_access_desc')}
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="admin-user-role">{localize('com_admin_global_role')}</Label>
                <select
                  id="admin-user-role"
                  className="mt-2 flex h-10 w-full rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary"
                  value={selectedRole}
                  onChange={(event) =>
                    setSelectedRole(
                      event.target.value === SystemRoles.ADMIN
                        ? SystemRoles.ADMIN
                        : SystemRoles.USER,
                    )
                  }
                >
                  <option value={SystemRoles.USER}>{localize('com_ui_user')}</option>
                  <option value={SystemRoles.ADMIN}>{localize('com_ui_admin')}</option>
                </select>
              </div>

              <div>
                <div className="text-sm font-medium text-text-primary">
                  {localize('com_admin_lower_tier_roles')}
                </div>
                <div className="mt-2 grid gap-2">
                  {(adminRolesQuery.data ?? []).map((role: TAdminRole) => (
                    <label
                      key={role.adminRoleId}
                      className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-light bg-surface-secondary p-3"
                    >
                      <input
                        type="checkbox"
                        checked={selectedAdminRoleIds.includes(role.adminRoleId)}
                        onChange={() => handleToggleAdminRole(role.adminRoleId)}
                        className="mt-1"
                      />
                      <div>
                        <div className="font-medium text-text-primary">{role.name}</div>
                        <div className="text-xs text-text-secondary">{role.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-border-light bg-surface-secondary p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-text-primary">
                      {localize('com_admin_model_access')}
                    </div>
                    <div className="mt-1 text-sm text-text-secondary">
                      {localize('com_admin_model_access_desc')}
                    </div>
                  </div>
                  <Switch
                    checked={selectedModelPermissions.enabled}
                    onCheckedChange={(checked) =>
                      setSelectedModelPermissions((current) => ({ ...current, enabled: checked }))
                    }
                    disabled={isSelectedUserSuperAdmin}
                    aria-label={localize('com_admin_model_access')}
                  />
                </div>

                {isSelectedUserSuperAdmin ? (
                  <div className="mt-3 rounded-xl border border-border-light bg-surface-primary p-3 text-sm text-text-secondary">
                    {localize('com_admin_model_access_superadmin_note')}
                  </div>
                ) : null}

                {selectedModelPermissions.enabled ? (
                  <div className="mt-4 space-y-3">
                    <div className="text-sm text-text-secondary">
                      {localize('com_admin_model_access_select_desc')}
                    </div>

                    {modelAccessOptionsContent}
                  </div>
                ) : null}
              </div>

              <div className="rounded-2xl border border-border-light bg-surface-secondary p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-text-primary">
                      {localize('com_admin_model_rate_limits')}
                    </div>
                    <div className="mt-1 text-sm text-text-secondary">
                      {localize('com_admin_model_rate_limits_desc')}
                    </div>
                  </div>
                  <Switch
                    checked={selectedModelRateLimits.enabled}
                    onCheckedChange={(checked) =>
                      setSelectedModelRateLimits((current) => ({ ...current, enabled: checked }))
                    }
                    aria-label={localize('com_admin_model_rate_limits')}
                  />
                </div>

                {selectedModelRateLimits.enabled ? (
                  <div className="mt-4 space-y-3">
                    {(selectedModelRateLimits.rules ?? []).map((rule, index) => (
                      <div
                        key={`model-rate-limit-${index}`}
                        className="grid gap-2 rounded-xl border border-border-light bg-surface-primary p-3 md:grid-cols-[1fr_1fr_120px_120px_auto]"
                      >
                        <Input
                          value={rule.endpoint}
                          onChange={(event) =>
                            updateModelRateLimitRule(index, 'endpoint', event.target.value)
                          }
                          placeholder="endpoint"
                        />
                        <Input
                          value={rule.model}
                          onChange={(event) =>
                            updateModelRateLimitRule(index, 'model', event.target.value)
                          }
                          placeholder="model"
                        />
                        <Input
                          value={rule.requestsPerDay ?? ''}
                          type="number"
                          min={1}
                          onChange={(event) =>
                            updateModelRateLimitRule(index, 'requestsPerDay', event.target.value)
                          }
                          placeholder="requests/day"
                        />
                        <Input
                          value={rule.tokensPerDay ?? ''}
                          type="number"
                          min={1}
                          onChange={(event) =>
                            updateModelRateLimitRule(index, 'tokensPerDay', event.target.value)
                          }
                          placeholder="tokens/day"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => removeModelRateLimitRule(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}

                    <Button type="button" variant="outline" onClick={addModelRateLimitRule}>
                      <Plus className="h-4 w-4" />
                      {localize('com_admin_add_rate_limit')}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="submit"
                  disabled={updateAdminUserMutation.isLoading}
                  onClick={handleSaveUserAccess}
                >
                  {localize('com_admin_save_access')}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  let usageContent: ReactNode;
  if (adminUsageQuery.isLoading) {
    usageContent = (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="text-text-primary" />
        {loadingLabel}
      </div>
    );
  } else {
    usageContent = usageUsers.map((usage) => (
      <div
        key={usage.userId}
        className="rounded-2xl border border-border-light bg-surface-secondary p-4"
      >
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="font-medium text-text-primary">{usage.name || usage.email}</div>
            <div className="text-xs text-text-secondary">{usage.email}</div>
          </div>
          <AccessBadge label={resolveRoleLabel(usage.role)} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_balance')}
            </div>
            <div className="text-text-primary">{usage.tokenCredits}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_transactions')}
            </div>
            <div className="text-text-primary">{usage.transactionCount}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_conversations')}
            </div>
            <div className="text-text-primary">{usage.conversationCount}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-text-secondary">
              {localize('com_admin_messages')}
            </div>
            <div className="text-text-primary">{usage.messageCount}</div>
          </div>
        </div>
      </div>
    ));
  }

  let adminMCPServersContent: ReactNode;
  if (adminMCPServersQuery.isLoading) {
    adminMCPServersContent = (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="text-text-primary" />
        {loadingLabel}
      </div>
    );
  } else {
    adminMCPServersContent = (adminMCPServersQuery.data?.servers ?? []).map((server) => (
      <div
        key={`${server.storage}-${server.serverName}`}
        className="rounded-2xl border border-border-light bg-surface-secondary p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-text-primary">{server.title || server.serverName}</div>
            <div className="text-xs text-text-secondary">{server.serverName}</div>
            <div className="mt-1 text-xs text-text-secondary">
              {server.storage === 'static' ? 'Platform YAML' : server.ownerEmail || 'User-defined'}
            </div>
          </div>
          <Switch
            checked={server.published}
            onCheckedChange={(checked) => handleToggleMCPPublication(server.serverName, checked)}
            disabled={!canWriteSettings || updateAdminMCPServerPublicationMutation.isLoading}
            aria-label={`Publish ${server.serverName}`}
          />
        </div>
        {server.url ? (
          <div className="mt-3 break-all text-xs text-text-secondary">{server.url}</div>
        ) : null}
        <div className="mt-3">
          <AccessBadge
            label={server.published ? 'Published to all users' : 'Hidden from all users'}
          />
        </div>
      </div>
    ));

    if ((adminMCPServersQuery.data?.servers ?? []).length === 0) {
      adminMCPServersContent = (
        <p className="text-sm text-text-secondary">
          {localize('com_admin_no_mcp_servers_configured')}
        </p>
      );
    }
  }

  if (!isPotentialAdmin || adminPermissionsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="text-text-primary" />
      </div>
    );
  }

  if (!adminPermissionsQuery.data) {
    return null;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-presentation">
      <div className="bg-presentation/95 sticky top-0 z-10 border-b border-border-light px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-3">
          {!navVisible ? <OpenSidebar setNavVisible={setNavVisible} /> : null}
          <div>
            <h1 className="text-2xl font-semibold text-text-primary">
              {localize('com_nav_admin_console')}
            </h1>
            <p className="text-sm text-text-secondary">{localize('com_admin_subtitle')}</p>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6">
        <SectionCard
          title={localize('com_admin_current_access')}
          description={localize('com_admin_current_access_desc')}
          icon={<Shield className="h-5 w-5" />}
        >
          <div className="flex flex-wrap gap-2">
            {isSuperAdmin ? <AccessBadge label={localize('com_admin_superadmin')} /> : null}
            {adminPermissionsQuery.data.adminRoles.map((role) => (
              <AccessBadge key={role.adminRoleId} label={role.name} />
            ))}
            {currentPermissions.map((permission) => (
              <AccessBadge key={permission} label={permission} />
            ))}
          </div>
        </SectionCard>

        {canReadUsers ? (
          <SectionCard
            title={localize('com_admin_users')}
            description={localize('com_admin_users_desc')}
            icon={<Users className="h-5 w-5" />}
          >
            <div className="grid gap-4 lg:grid-cols-[minmax(320px,1fr)_minmax(0,1.4fr)]">
              <div className="rounded-2xl border border-border-light bg-surface-secondary p-4">
                <Label htmlFor="admin-user-search">{localize('com_admin_search_users')}</Label>
                <Input
                  id="admin-user-search"
                  value={userSearch}
                  onChange={(event) => setUserSearch(event.target.value)}
                  placeholder={localize('com_admin_search_users_placeholder')}
                  className="mt-2"
                />
                <div className="mt-4 flex max-h-[480px] flex-col gap-2 overflow-y-auto">
                  {userListContent}
                </div>
              </div>

              <div className="rounded-2xl border border-border-light bg-surface-secondary p-4">
                {selectedUserContent}
              </div>
            </div>
          </SectionCard>
        ) : null}

        {canReadUsage ? (
          <SectionCard
            title={localize('com_ui_usage')}
            description={localize('com_admin_usage_desc')}
            icon={<BarChart3 className="h-5 w-5" />}
          >
            <Label htmlFor="admin-usage-search">{localize('com_admin_search_usage')}</Label>
            <Input
              id="admin-usage-search"
              value={usageSearch}
              onChange={(event) => setUsageSearch(event.target.value)}
              placeholder={localize('com_admin_search_usage_placeholder')}
              className="mt-2"
            />

            <div className="mt-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{usageContent}</div>
          </SectionCard>
        ) : null}

        {canReadSettings ? (
          <SectionCard
            title={localize('com_admin_mcp_server_publishing')}
            description={localize('com_admin_mcp_server_publishing_desc')}
            icon={<Settings2 className="h-5 w-5" />}
          >
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{adminMCPServersContent}</div>
          </SectionCard>
        ) : null}

        {canReadSettings ? (
          <SectionCard
            title={localize('com_admin_workspace_settings')}
            description={localize('com_admin_workspace_settings_desc')}
            icon={<Settings2 className="h-5 w-5" />}
          >
            <div className="space-y-4 rounded-2xl border border-border-light bg-surface-secondary p-4">
              <div className="flex items-center justify-between gap-4 rounded-xl border border-border-light bg-surface-primary p-4">
                <div>
                  <div className="font-medium text-text-primary">
                    {localize('com_admin_registration_enabled')}
                  </div>
                  <div className="text-sm text-text-secondary">
                    {localize('com_admin_registration_enabled_desc')}
                  </div>
                </div>
                <Switch
                  checked={settingsForm.registrationEnabled}
                  onCheckedChange={(checked) =>
                    setSettingsForm((current) => ({ ...current, registrationEnabled: checked }))
                  }
                  disabled={!canWriteSettings}
                  aria-label={localize('com_admin_registration_enabled')}
                />
              </div>

              <div className="flex items-center justify-between gap-4 rounded-xl border border-border-light bg-surface-primary p-4">
                <div>
                  <div className="font-medium text-text-primary">
                    {localize('com_admin_model_steering_enabled')}
                  </div>
                  <div className="text-sm text-text-secondary">
                    {localize('com_admin_model_steering_enabled_desc')}
                  </div>
                </div>
                <Switch
                  checked={settingsForm.modelSteeringEnabled}
                  onCheckedChange={(checked) =>
                    setSettingsForm((current) => ({ ...current, modelSteeringEnabled: checked }))
                  }
                  disabled={!canWriteSettings}
                  aria-label={localize('com_admin_model_steering_enabled')}
                />
              </div>

              <div className="rounded-xl border border-border-light bg-surface-primary p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Label htmlFor="platform-prompt">{localize('com_admin_platform_prompt')}</Label>
                    <div className="mt-1 text-sm text-text-secondary">
                      {localize('com_admin_platform_prompt_desc')}
                    </div>
                  </div>
                  <div className="text-xs text-text-secondary">
                    {(settingsForm.platformPrompt ?? '').length}/20000
                  </div>
                </div>
                <textarea
                  id="platform-prompt"
                  value={settingsForm.platformPrompt ?? ''}
                  maxLength={20000}
                  rows={8}
                  onChange={(event) =>
                    setSettingsForm((current) => ({
                      ...current,
                      platformPrompt: event.target.value,
                    }))
                  }
                  disabled={!canWriteSettings}
                  className="mt-3 min-h-[180px] w-full rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-ring-primary disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={localize('com_admin_platform_prompt_placeholder')}
                />
                {canWriteSettings && settingsForm.platformPrompt ? (
                  <div className="mt-3 flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setSettingsForm((current) => ({
                          ...current,
                          platformPrompt: null,
                        }))
                      }
                    >
                      {localize('com_ui_clear')}
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="langfuse-url">{localize('com_admin_langfuse_url')}</Label>
                  <Input
                    id="langfuse-url"
                    value={settingsForm.observability.langfuseUrl || ''}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        observability: {
                          ...current.observability,
                          langfuseUrl: event.target.value,
                        },
                      }))
                    }
                    disabled={!canWriteSettings}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="grafana-url">{localize('com_admin_grafana_url')}</Label>
                  <Input
                    id="grafana-url"
                    value={settingsForm.observability.grafanaUrl || ''}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        observability: {
                          ...current.observability,
                          grafanaUrl: event.target.value,
                        },
                      }))
                    }
                    disabled={!canWriteSettings}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="metrics-url">{localize('com_admin_metrics_url')}</Label>
                  <Input
                    id="metrics-url"
                    value={settingsForm.observability.metricsUrl || ''}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        observability: {
                          ...current.observability,
                          metricsUrl: event.target.value,
                        },
                      }))
                    }
                    disabled={!canWriteSettings}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="prometheus-url">{localize('com_admin_prometheus_url')}</Label>
                  <Input
                    id="prometheus-url"
                    value={settingsForm.observability.prometheusUrl || ''}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        observability: {
                          ...current.observability,
                          prometheusUrl: event.target.value,
                        },
                      }))
                    }
                    disabled={!canWriteSettings}
                    className="mt-2"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-border-light bg-surface-primary p-4">
                <div>
                  <div className="font-medium text-text-primary">
                    {localize('com_admin_byok_provider_policies')}
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">
                    {localize('com_admin_byok_provider_policies_desc')}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {BYOK_PROVIDER_IDS.map((providerId) => {
                    const policy = settingsForm.byok?.providers?.[providerId] ?? {
                      enabled: false,
                      allowBaseURL: true,
                      fallbackToPlatform: true,
                    };
                    const providerLabel =
                      alternateName[providerId as keyof typeof alternateName] || providerId;

                    return (
                      <div
                        key={providerId}
                        className="rounded-xl border border-border-light bg-surface-secondary p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-text-primary">{providerLabel}</div>
                          <Switch
                            checked={policy.enabled === true}
                            onCheckedChange={(checked) =>
                              updateBYOKProviderPolicy(providerId, 'enabled', checked)
                            }
                            disabled={!canWriteSettings}
                            aria-label={`Enable BYOK for ${providerLabel}`}
                          />
                        </div>

                        <div className="mt-3 space-y-2 text-sm">
                          <label className="flex items-center justify-between gap-3 text-text-secondary">
                            <span>{localize('com_admin_allow_user_base_url')}</span>
                            <Switch
                              checked={policy.allowBaseURL !== false}
                              onCheckedChange={(checked) =>
                                updateBYOKProviderPolicy(providerId, 'allowBaseURL', checked)
                              }
                              disabled={!canWriteSettings}
                              aria-label={`Allow user base URL for ${providerLabel}`}
                            />
                          </label>
                          <label className="flex items-center justify-between gap-3 text-text-secondary">
                            <span>{localize('com_admin_fallback_to_platform_key')}</span>
                            <Switch
                              checked={policy.fallbackToPlatform !== false}
                              onCheckedChange={(checked) =>
                                updateBYOKProviderPolicy(providerId, 'fallbackToPlatform', checked)
                              }
                              disabled={!canWriteSettings}
                              aria-label={`Fallback to platform key for ${providerLabel}`}
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-border-light bg-surface-primary p-4">
                <div>
                  <div className="font-medium text-text-primary">
                    {localize('com_admin_mcp_domain_filter')}
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">
                    {localize('com_admin_mcp_domain_filter_desc')}
                  </div>
                </div>

                <div className="mt-3">
                  <Label htmlFor="mcp-filter-mode">{localize('com_admin_mcp_filter_mode')}</Label>
                  <select
                    id="mcp-filter-mode"
                    className="mt-2 flex h-10 w-full rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary"
                    value={settingsForm.mcpDomainFilterMode ?? 'denylist'}
                    disabled={!canWriteSettings}
                    onChange={(event) =>
                      setSettingsForm((current) => ({
                        ...current,
                        mcpDomainFilterMode: event.target.value as 'allowlist' | 'denylist',
                      }))
                    }
                  >
                    <option value="denylist">
                      {localize('com_admin_mcp_filter_mode_denylist')}
                    </option>
                    <option value="allowlist">
                      {localize('com_admin_mcp_filter_mode_allowlist')}
                    </option>
                  </select>
                </div>

                <div className="mt-4">
                  <div className="font-medium text-text-primary">
                    {settingsForm.mcpDomainFilterMode === 'allowlist'
                      ? localize('com_admin_mcp_domains_label_allowlist')
                      : localize('com_admin_mcp_domains_label_denylist')}
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">
                    {settingsForm.mcpDomainFilterMode === 'allowlist'
                      ? localize('com_admin_mcp_domains_desc_allowlist')
                      : localize('com_admin_mcp_domains_desc_denylist')}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {(settingsForm.mcpAllowedDomains ?? []).map((domain, index) => (
                    <div
                      key={`mcp-domain-${index}`}
                      className="flex items-center gap-2 rounded-lg border border-border-light bg-surface-secondary px-3 py-2"
                    >
                      <span className="flex-1 text-sm text-text-primary">{domain}</span>
                      {canWriteSettings ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSettingsForm((current) => ({
                              ...current,
                              mcpAllowedDomains: (current.mcpAllowedDomains ?? []).filter(
                                (_, i) => i !== index,
                              ),
                            }))
                          }
                          className="rounded p-1 text-text-secondary hover:bg-surface-tertiary hover:text-text-primary"
                          aria-label={`Remove ${domain}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {canWriteSettings ? (
                  <div className="mt-3 flex gap-2">
                    <Input
                      value={newMcpDomain}
                      onChange={(event) => setNewMcpDomain(event.target.value)}
                      placeholder={localize('com_admin_mcp_domain_placeholder')}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          const trimmed = newMcpDomain.trim();
                          if (
                            trimmed &&
                            !(settingsForm.mcpAllowedDomains ?? []).includes(trimmed)
                          ) {
                            setSettingsForm((current) => ({
                              ...current,
                              mcpAllowedDomains: [...(current.mcpAllowedDomains ?? []), trimmed],
                            }));
                            setNewMcpDomain('');
                          }
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const trimmed = newMcpDomain.trim();
                        if (trimmed && !(settingsForm.mcpAllowedDomains ?? []).includes(trimmed)) {
                          setSettingsForm((current) => ({
                            ...current,
                            mcpAllowedDomains: [...(current.mcpAllowedDomains ?? []), trimmed],
                          }));
                          setNewMcpDomain('');
                        }
                      }}
                    >
                      <Plus className="h-4 w-4" />
                      {localize('com_admin_mcp_add_domain')}
                    </Button>
                  </div>
                ) : null}
              </div>

              {canWriteSettings ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="submit"
                    disabled={updateSettingsMutation.isLoading}
                    onClick={handleSaveSettings}
                  >
                    {localize('com_admin_save_settings')}
                  </Button>
                </div>
              ) : null}
            </div>
          </SectionCard>
        ) : null}

        {canWriteSettings ? (
          <SectionCard
            title={localize('com_admin_model_discovery')}
            description={localize('com_admin_model_discovery_desc')}
            icon={<RefreshCcw className="h-5 w-5" />}
          >
            <div className="space-y-4 rounded-2xl border border-border-light bg-surface-secondary p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-text-secondary">
                  {lastRefreshAt
                    ? localize('com_admin_models_last_refresh', {
                        0: new Date(lastRefreshAt).toLocaleString(),
                      })
                    : null}
                </div>
                <Button
                  type="button"
                  variant="submit"
                  disabled={refreshModelsMutation.isLoading}
                  onClick={handleRefreshAllProviders}
                >
                  <span className="flex items-center gap-2">
                    {refreshModelsMutation.isLoading && activeRefreshProvider === '__all__' ? (
                      <Spinner className="text-text-primary" />
                    ) : (
                      <RefreshCcw className="h-4 w-4" />
                    )}
                    {localize('com_admin_refresh_all_models')}
                  </span>
                </Button>
              </div>

              {availableModelEntries.length === 0 ? (
                <div className="rounded-xl border border-border-light bg-surface-primary p-3 text-sm text-text-secondary">
                  {localize('com_admin_models_no_providers')}
                </div>
              ) : (
                <div className="grid gap-2">
                  {availableModelEntries.map(([endpoint, models]) => {
                    const displayName =
                      alternateName[endpoint as keyof typeof alternateName] || endpoint;
                    const isThisProviderRefreshing =
                      refreshModelsMutation.isLoading && activeRefreshProvider === endpoint;

                    return (
                      <div
                        key={`refresh-${endpoint}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-light bg-surface-primary p-3"
                      >
                        <div>
                          <div className="font-medium text-text-primary">{displayName}</div>
                          <div className="text-xs text-text-secondary">
                            {localize('com_admin_models_count', { 0: String(models.length) })}
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          disabled={refreshModelsMutation.isLoading}
                          onClick={() => handleRefreshProvider(endpoint)}
                        >
                          <span className="flex items-center gap-2">
                            {isThisProviderRefreshing ? (
                              <Spinner className="text-text-primary" />
                            ) : (
                              <RefreshCcw className="h-4 w-4" />
                            )}
                            {localize('com_admin_refresh_provider')}
                          </span>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </SectionCard>
        ) : null}

        {canReadObservability ? (
          <SectionCard
            title={localize('com_admin_observability')}
            description={localize('com_admin_observability_desc')}
            icon={<Activity className="h-5 w-5" />}
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Langfuse', url: adminObservabilityQuery.data?.links.langfuseUrl },
                { label: 'Grafana', url: adminObservabilityQuery.data?.links.grafanaUrl },
                { label: 'Loki Explorer', url: adminObservabilityQuery.data?.links.lokiUrl },
                { label: 'Metrics', url: adminObservabilityQuery.data?.links.metricsUrl },
                { label: 'Prometheus', url: adminObservabilityQuery.data?.links.prometheusUrl },
              ].map((link) => (
                <div
                  key={link.label}
                  className="rounded-2xl border border-border-light bg-surface-secondary p-4"
                >
                  <div className="font-medium text-text-primary">{link.label}</div>
                  <div className="mt-1 break-all text-xs text-text-secondary">
                    {link.url || localize('com_admin_not_configured')}
                  </div>
                  {link.url ? (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-blue-600"
                    >
                      {localize('com_ui_open_var', { 0: link.label })}{' '}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-xl border border-border-light bg-surface-secondary p-4 text-sm text-text-secondary">
              {localize('com_admin_provider_log_path', {
                0: adminObservabilityQuery.data?.providerLogPath || '/app/logs',
              })}
            </div>
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
}
