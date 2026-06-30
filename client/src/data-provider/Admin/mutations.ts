import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationOptions, UseMutationResult } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';

export const useUpdateAdminSettingsMutation = (
  options?: UseMutationOptions<t.TAdminSettings, t.TError | undefined, t.TAdminSettingsUpdate>,
): UseMutationResult<t.TAdminSettings, t.TError | undefined, t.TAdminSettingsUpdate, unknown> => {
  const queryClient = useQueryClient();

  return useMutation(
    [MutationKeys.updateAdminSettings],
    (payload: t.TAdminSettingsUpdate) => dataService.updateAdminSettings(payload),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.adminSettings]);
        queryClient.invalidateQueries([QueryKeys.adminObservability]);
        queryClient.invalidateQueries([QueryKeys.startupConfig]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useUpdateAdminUserMutation = (
  options?: UseMutationOptions<
    t.TAdminUserDetails,
    t.TError | undefined,
    { userId: string; payload: t.TAdminUserUpdate }
  >,
): UseMutationResult<
  t.TAdminUserDetails,
  t.TError | undefined,
  { userId: string; payload: t.TAdminUserUpdate },
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation(
    [MutationKeys.updateAdminUser],
    ({ userId, payload }: { userId: string; payload: t.TAdminUserUpdate }) =>
      dataService.updateAdminUser(userId, payload),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.adminUsers]);
        queryClient.invalidateQueries([QueryKeys.adminUsage]);
        queryClient.invalidateQueries([QueryKeys.adminUser, variables.userId]);
        queryClient.invalidateQueries([QueryKeys.user]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useDeleteAdminUserMutation = (
  options?: UseMutationOptions<void, t.TError | undefined, { userId: string }>,
): UseMutationResult<void, t.TError | undefined, { userId: string }, unknown> => {
  const queryClient = useQueryClient();

  return useMutation(
    [MutationKeys.deleteAdminUser],
    ({ userId }: { userId: string }) => dataService.deleteAdminUser(userId),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.adminUsers]);
        queryClient.invalidateQueries([QueryKeys.adminUsage]);
        queryClient.removeQueries([QueryKeys.adminUser, variables.userId]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useUpdateAdminMCPServerPublicationMutation = (
  options?: UseMutationOptions<
    t.TAdminMCPServer,
    t.TError | undefined,
    { serverName: string; payload: t.TAdminMCPServerPublicationUpdate }
  >,
): UseMutationResult<
  t.TAdminMCPServer,
  t.TError | undefined,
  { serverName: string; payload: t.TAdminMCPServerPublicationUpdate },
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation(
    [MutationKeys.updateAdminMCPServerPublication],
    ({ serverName, payload }) => dataService.updateAdminMCPServerPublication(serverName, payload),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.adminMCPServers]);
        queryClient.invalidateQueries([QueryKeys.mcpServers]);
        queryClient.invalidateQueries([QueryKeys.mcpTools]);
        queryClient.invalidateQueries([QueryKeys.startupConfig]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};

export const useRefreshAdminModelsMutation = (
  options?: UseMutationOptions<
    t.TAdminModelsRefreshResponse,
    t.TError | undefined,
    t.TAdminModelsRefreshRequest | undefined
  >,
): UseMutationResult<
  t.TAdminModelsRefreshResponse,
  t.TError | undefined,
  t.TAdminModelsRefreshRequest | undefined,
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation(
    [MutationKeys.refreshAdminModels],
    (payload?: t.TAdminModelsRefreshRequest) => dataService.refreshAdminModels(payload ?? {}),
    {
      ...options,
      onSuccess: (data, variables, context) => {
        queryClient.invalidateQueries([QueryKeys.models]);
        queryClient.invalidateQueries([QueryKeys.endpoints]);
        queryClient.invalidateQueries([QueryKeys.startupConfig]);
        options?.onSuccess?.(data, variables, context);
      },
    },
  );
};
