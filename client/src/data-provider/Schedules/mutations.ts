import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { UseMutationResult } from '@tanstack/react-query';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

export const useCreateScheduledJobMutation = (): UseMutationResult<
  t.TScheduledJob,
  unknown,
  t.TScheduledJobCreatePayload,
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation(
    (payload: t.TScheduledJobCreatePayload) => dataService.createScheduledJob(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.scheduledJobs]);
      },
    },
  );
};

export const useUpdateScheduledJobMutation = (): UseMutationResult<
  t.TScheduledJob,
  unknown,
  { scheduleId: string; payload: t.TScheduledJobUpdatePayload },
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation(
    ({ scheduleId, payload }: { scheduleId: string; payload: t.TScheduledJobUpdatePayload }) =>
      dataService.updateScheduledJob(scheduleId, payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.scheduledJobs]);
      },
    },
  );
};

export const useDeleteScheduledJobMutation = (): UseMutationResult<
  void,
  unknown,
  string,
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation((scheduleId: string) => dataService.deleteScheduledJob(scheduleId), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.scheduledJobs]);
    },
  });
};

export const useRunScheduledJobMutation = (): UseMutationResult<
  t.TScheduledJobRunResult,
  unknown,
  string,
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation((scheduleId: string) => dataService.runScheduledJob(scheduleId), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.scheduledJobs]);
    },
  });
};

export const useUpdateScheduledJobNotificationsMutation = (): UseMutationResult<
  t.TScheduledJobNotificationSettings,
  unknown,
  t.TScheduledJobNotificationUpdatePayload,
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation(
    (payload: t.TScheduledJobNotificationUpdatePayload) =>
      dataService.updateScheduledJobNotifications(payload),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.scheduledJobNotifications]);
      },
    },
  );
};

export const useSubscribeScheduledJobPushMutation = (): UseMutationResult<
  t.TScheduledJobNotificationSettings,
  unknown,
  PushSubscriptionJSON,
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation(
    (subscription: PushSubscriptionJSON) => dataService.subscribeScheduledJobPush(subscription),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.scheduledJobNotifications]);
      },
    },
  );
};

export const useUnsubscribeScheduledJobPushMutation = (): UseMutationResult<
  t.TScheduledJobNotificationSettings,
  unknown,
  string,
  unknown
> => {
  const queryClient = useQueryClient();

  return useMutation((endpoint: string) => dataService.unsubscribeScheduledJobPush(endpoint), {
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.scheduledJobNotifications]);
    },
  });
};
