import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MutationKeys, QueryKeys, dataService } from 'librechat-data-provider';
import type { UseMutationOptions } from '@tanstack/react-query';
import type { TModelSteeringPrefs, TModelSteeringPrefsUpdate } from 'librechat-data-provider';

export type UpdateModelSteeringPrefsResponse = {
  prefs: TModelSteeringPrefs;
};

export const useUpdateModelSteeringPrefsMutation = (
  options?: UseMutationOptions<UpdateModelSteeringPrefsResponse, Error, TModelSteeringPrefsUpdate>,
) => {
  const queryClient = useQueryClient();
  return useMutation<UpdateModelSteeringPrefsResponse, Error, TModelSteeringPrefsUpdate>(
    [MutationKeys.updateModelSteeringPrefs],
    (payload: TModelSteeringPrefsUpdate) => dataService.updateModelSteeringPrefs(payload),
    {
      ...options,
      onSuccess: (...params) => {
        queryClient.invalidateQueries([QueryKeys.user]);
        options?.onSuccess?.(...params);
      },
    },
  );
};
