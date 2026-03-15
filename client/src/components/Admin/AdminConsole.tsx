import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Shield, Users, Activity, Settings2, ExternalLink, BarChart3 } from 'lucide-react';
import { useOutletContext, useNavigate } from 'react-router-dom';
import { Button, Input, Label, Spinner, Switch, useToastContext } from '@librechat/client';
import {
  AdminPermissions,
  SystemRoles,
  alternateName,
  type TAdminRole,
  type TAdminSettings,
  type TAdminPermission,
  type TAdminModelPermissions,
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
  useAdminSettingsQuery,
  useAdminPermissionsQuery,
  useAdminObservabilityQuery,
  useUpdateAdminUserMutation,
  useUpdateAdminSettingsMutation,
} from '~/data-provider';

const DEFAULT_SETTINGS: TAdminSettings = {
  settingsId: 'global',
  registrationEnabled: false,
  observability: {
    langfuseUrl: '',
    grafanaUrl: '',
    metricsUrl: '',
    prometheusUrl: '',
  },
};

const DEFAULT_MODEL_PERMISSIONS: TAdminModelPermissions = {
  enabled: false,
  rules: [],
};

function normalizeModelPermissions(
  modelPermissions: TAdminModelPermissions | undefined,
): TAdminModelPermissions {
  const endpointMap = new Map<string, Set<string>>();

  for (const rule of modelPermissions?.rules ?? []) {
    const endpoint = rule.endpoint?.trim();
    if (!endpoint) {
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
  const [selectedRole, setSelectedRole] = useState(SystemRoles.USER);
  const [selectedAdminRoleIds, setSelectedAdminRoleIds] = useState<string[]>([]);
  const [selectedModelPermissions, setSelectedModelPermissions] =
    useState<TAdminModelPermissions>(DEFAULT_MODEL_PERMISSIONS);
  const [settingsForm, setSettingsForm] = useState<TAdminSettings>(DEFAULT_SETTINGS);

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
    }
  }, [adminUserQuery.data?.user]);

  useEffect(() => {
    if (adminSettingsQuery.data) {
      setSettingsForm(adminSettingsQuery.data);
    }
  }, [adminSettingsQuery.data]);

  const selectedUser = adminUserQuery.data?.user;
  const selectedUserUsage = adminUserQuery.data?.usage;
  const isSelectedUserSuperAdmin = selectedRole === SystemRoles.ADMIN;

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
      },
    });
  };

  const handleSaveSettings = async () => {
    await updateSettingsMutation.mutateAsync({
      registrationEnabled: settingsForm.registrationEnabled,
      observability: settingsForm.observability,
    });
  };

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
          <h3 className="text-lg font-semibold text-text-primary">
            {selectedUser.name || selectedUser.email}
          </h3>
          <p className="text-sm text-text-secondary">{selectedUser.email}</p>
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
          </div>
        ) : null}

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

                    {adminModelsQuery.isLoading ? (
                      <div className="flex items-center gap-2 text-sm text-text-secondary">
                        <Spinner className="text-text-primary" />
                        {loadingLabel}
                      </div>
                    ) : availableModelEntries.length === 0 ? (
                      <div className="rounded-xl border border-border-light bg-surface-primary p-3 text-sm text-text-secondary">
                        {localize('com_admin_model_access_none_available')}
                      </div>
                    ) : (
                      availableModelEntries.map(([endpoint, models]) => (
                        <div
                          key={endpoint}
                          className="rounded-xl border border-border-light bg-surface-primary p-3"
                        >
                          <div className="font-medium text-text-primary">
                            {alternateName[endpoint as keyof typeof alternateName] || endpoint}
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {models.map((model) => {
                              const checked =
                                selectedModelRuleMap.get(endpoint)?.has(model) ?? false;

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
                      ))
                    )}
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
