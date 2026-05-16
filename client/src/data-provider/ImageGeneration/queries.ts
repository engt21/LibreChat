import { useRecoilValue } from 'recoil';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type {
  TImageGenModelsResponse,
  TImageGenerationPrefs,
} from 'librechat-data-provider';
import store from '~/store';

export const useImageGenerationModelsQuery = (
  config?: UseQueryOptions<TImageGenModelsResponse>,
): QueryObserverResult<TImageGenModelsResponse> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<TImageGenModelsResponse>(
    [QueryKeys.imageGenerationModels],
    () => dataService.getImageGenerationModels(),
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useImageGenerationPrefsQuery = (
  config?: UseQueryOptions<{ prefs: TImageGenerationPrefs }>,
): QueryObserverResult<{ prefs: TImageGenerationPrefs }> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);
  return useQuery<{ prefs: TImageGenerationPrefs }>(
    [QueryKeys.imageGenerationPrefs],
    () => dataService.getImageGenerationPrefs(),
    {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
