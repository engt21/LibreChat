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
