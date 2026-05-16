import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  QueryKeys,
  MutationKeys,
  dataService,
} from 'librechat-data-provider';
import type { UseMutationResult } from '@tanstack/react-query';
import type {
  TImageGenerationPrefs,
  TImageGenerationPrefsUpdate,
} from 'librechat-data-provider';

export const useUpdateImageGenerationPrefsMutation = (): UseMutationResult<
  { prefs: TImageGenerationPrefs },
  unknown,
  TImageGenerationPrefsUpdate
> => {
  const queryClient = useQueryClient();
  return useMutation<
    { prefs: TImageGenerationPrefs },
    unknown,
    TImageGenerationPrefsUpdate
  >({
    mutationKey: [MutationKeys.updateImageGenerationPrefs],
    mutationFn: (payload) => dataService.updateImageGenerationPrefs(payload),
    onSuccess: (response) => {
      queryClient.setQueryData<{ prefs: TImageGenerationPrefs }>(
        [QueryKeys.imageGenerationPrefs],
        response,
      );
    },
  });
};
