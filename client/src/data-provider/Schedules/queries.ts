import { useRecoilValue } from 'recoil';
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery } from '@tanstack/react-query';
import type { QueryObserverResult, UseQueryOptions } from '@tanstack/react-query';
import type * as t from 'librechat-data-provider';
import store from '~/store';

export const useScheduledJobsQuery = <TData = t.TScheduledJob[]>(
  config?: UseQueryOptions<t.TScheduledJob[], unknown, TData>,
): QueryObserverResult<TData> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);

  return useQuery<t.TScheduledJob[], unknown, TData>(
    [QueryKeys.scheduledJobs],
    () => dataService.getScheduledJobs(),
    {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};

export const useScheduledJobNotificationsQuery = <TData = t.TScheduledJobNotificationSettings>(
  config?: UseQueryOptions<t.TScheduledJobNotificationSettings, unknown, TData>,
): QueryObserverResult<TData> => {
  const queriesEnabled = useRecoilValue<boolean>(store.queriesEnabled);

  return useQuery<t.TScheduledJobNotificationSettings, unknown, TData>(
    [QueryKeys.scheduledJobNotifications],
    () => dataService.getScheduledJobNotifications(),
    {
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      ...config,
      enabled: (config?.enabled ?? true) === true && queriesEnabled,
    },
  );
};
