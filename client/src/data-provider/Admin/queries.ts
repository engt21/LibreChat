import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';
import { QueryKeys, dataService } from 'librechat-data-provider';

export const useAdminPermissionsQuery = (
  config?: UseQueryOptions<t.TAdminPermissionsResponse>,
): QueryObserverResult<t.TAdminPermissionsResponse> => {
  return useQuery<t.TAdminPermissionsResponse>(
    [QueryKeys.adminPermissions],
    () => dataService.getAdminPermissions(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: false,
      ...config,
    },
  );
};

export const useAdminUsersQuery = (
  params: t.AdminListParams = {},
  config?: UseQueryOptions<t.TAdminUserListResponse>,
): QueryObserverResult<t.TAdminUserListResponse> => {
  return useQuery<t.TAdminUserListResponse>(
    [QueryKeys.adminUsers, params],
    () => dataService.getAdminUsers(params),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      keepPreviousData: true,
      retry: false,
      ...config,
    },
  );
};

export const useAdminUserQuery = (
  userId: string | null,
  config?: UseQueryOptions<t.TAdminUserDetails>,
): QueryObserverResult<t.TAdminUserDetails> => {
  return useQuery<t.TAdminUserDetails>(
    [QueryKeys.adminUser, userId],
    () => dataService.getAdminUser(userId as string),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      enabled: Boolean(userId) && (config?.enabled ?? true),
      ...config,
    },
  );
};

export const useAdminUsageQuery = (
  params: t.AdminListParams = {},
  config?: UseQueryOptions<t.TAdminUsageResponse>,
): QueryObserverResult<t.TAdminUsageResponse> => {
  return useQuery<t.TAdminUsageResponse>(
    [QueryKeys.adminUsage, params],
    () => dataService.getAdminUsage(params),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      keepPreviousData: true,
      retry: false,
      ...config,
    },
  );
};

export const useAdminSettingsQuery = (
  config?: UseQueryOptions<t.TAdminSettings>,
): QueryObserverResult<t.TAdminSettings> => {
  return useQuery<t.TAdminSettings>(
    [QueryKeys.adminSettings],
    () => dataService.getAdminSettings(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      ...config,
    },
  );
};

export const useAdminObservabilityQuery = (
  config?: UseQueryOptions<t.TAdminObservability>,
): QueryObserverResult<t.TAdminObservability> => {
  return useQuery<t.TAdminObservability>(
    [QueryKeys.adminObservability],
    () => dataService.getAdminObservability(),
    {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      ...config,
    },
  );
};

export const useAdminRolesQuery = (
  config?: UseQueryOptions<t.TAdminRole[]>,
): QueryObserverResult<t.TAdminRole[]> => {
  return useQuery<t.TAdminRole[]>([QueryKeys.adminRoles], () => dataService.getAdminRoles(), {
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
    ...config,
  });
};
