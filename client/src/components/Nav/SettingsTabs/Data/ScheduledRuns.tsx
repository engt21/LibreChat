import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArtifactModes,
  EModelEndpoint,
  PermissionBits,
  WebSearchModes,
  type TScheduledJob,
  type TScheduledJobCreatePayload,
} from 'librechat-data-provider';
import {
  Button,
  Dropdown,
  Input,
  Label,
  OGDialog,
  OGDialogClose,
  OGDialogContent,
  OGDialogTitle,
  OGDialogTrigger,
  Spinner,
  Switch,
  Textarea,
  useToastContext,
} from '@librechat/client';
import { Clock3, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  useCreateScheduledJobMutation,
  useDeleteScheduledJobMutation,
  useGetEndpointsQuery,
  useListAgentsQuery,
  useMCPServersQuery,
  useRunScheduledJobMutation,
  useScheduledJobNotificationsQuery,
  useScheduledJobsQuery,
  useSubscribeScheduledJobPushMutation,
  useUnsubscribeScheduledJobPushMutation,
  useUpdateScheduledJobMutation,
  useUpdateScheduledJobNotificationsMutation,
} from '~/data-provider';
import { useAuthContext, useLocalize } from '~/hooks';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';

type ScheduleFormState = {
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  targetMode: 'agent' | 'model';
  agentId: string;
  endpoint: string;
  model: string;
  promptPrefix: string;
  webSearch: boolean;
  webSearchMode: WebSearchModes;
  executeCode: boolean;
  fileSearch: boolean;
  artifacts: ArtifactModes | '';
  mcpServers: string[];
  notifications: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
};

type MCPServerOption = {
  value: string;
  label: string;
  description?: string;
};

type NotificationDraft = {
  emailEnabled: boolean;
  emailAddress: string;
  smsEnabled: boolean;
  smsProvider: 'twilio' | 'carrier_gateway';
  phoneNumber: string;
  gatewayAddress: string;
  pushEnabled: boolean;
};

const DEFAULT_CRON = '0 9 * * *';

function isOllamaEndpoint(endpoint?: string) {
  return String(endpoint ?? '')
    .trim()
    .toLowerCase()
    .startsWith('ollama');
}

function getDefaultWebSearchMode(endpoint: string) {
  return isOllamaEndpoint(endpoint) ? WebSearchModes.ollama_native : WebSearchModes.librechat;
}

function getArtifactMode(value?: string | null): ArtifactModes | '' {
  return Object.values(ArtifactModes).includes(value as ArtifactModes)
    ? (value as ArtifactModes)
    : '';
}

function getBrowserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function getDefaultSmsProvider(capabilities?: {
  smsProviders?: { twilio?: boolean; carrierGateway?: boolean };
}): 'twilio' | 'carrier_gateway' {
  if (capabilities?.smsProviders?.twilio) {
    return 'twilio';
  }

  if (capabilities?.smsProviders?.carrierGateway) {
    return 'carrier_gateway';
  }

  return 'twilio';
}

function truncateText(value = '', maxLength = 140) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatDateTime(value?: string | Date | null) {
  if (!value) {
    return '—';
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function createNotificationDraft(
  settings?: {
    email?: { enabled?: boolean; address?: string };
    sms?: {
      enabled?: boolean;
      provider?: 'twilio' | 'carrier_gateway';
      phoneNumber?: string;
      gatewayAddress?: string;
    };
    push?: { enabled?: boolean };
  },
  fallbackEmail = '',
  fallbackSmsProvider: 'twilio' | 'carrier_gateway' = 'twilio',
): NotificationDraft {
  return {
    emailEnabled: settings?.email?.enabled ?? false,
    emailAddress: settings?.email?.address || fallbackEmail,
    smsEnabled: settings?.sms?.enabled ?? false,
    smsProvider: settings?.sms?.provider ?? fallbackSmsProvider,
    phoneNumber: settings?.sms?.phoneNumber || '',
    gatewayAddress: settings?.sms?.gatewayAddress || '',
    pushEnabled: settings?.push?.enabled ?? false,
  };
}

function getScheduleTargetMode(schedule?: TScheduledJob | null): 'agent' | 'model' {
  return schedule?.target?.endpoint === EModelEndpoint.agents ? 'agent' : 'model';
}

function createFormState(
  schedule: TScheduledJob | null,
  fallbackAgentId: string,
  fallbackEndpoint: string,
  fallbackModel: string,
  timezone: string,
): ScheduleFormState {
  if (!schedule) {
    return {
      name: '',
      prompt: '',
      cron: DEFAULT_CRON,
      timezone,
      enabled: true,
      targetMode: fallbackAgentId ? 'agent' : 'model',
      agentId: fallbackAgentId,
      endpoint: fallbackEndpoint,
      model: fallbackModel,
      promptPrefix: '',
      webSearch: false,
      webSearchMode: getDefaultWebSearchMode(fallbackEndpoint),
      executeCode: false,
      fileSearch: false,
      artifacts: '',
      mcpServers: [],
      notifications: {
        email: true,
        sms: false,
        push: false,
      },
    };
  }

  return {
    name: schedule.name,
    prompt: schedule.prompt,
    cron: schedule.cron,
    timezone: schedule.timezone,
    enabled: schedule.enabled !== false,
    targetMode: getScheduleTargetMode(schedule),
    agentId: schedule.target?.agent_id || fallbackAgentId,
    endpoint: schedule.target?.endpoint || fallbackEndpoint,
    model: schedule.target?.model || fallbackModel,
    promptPrefix: schedule.target?.promptPrefix || '',
    webSearch: schedule.target?.ephemeralAgent?.web_search === true,
    webSearchMode:
      schedule.target?.ephemeralAgent?.web_search_mode ||
      getDefaultWebSearchMode(schedule.target?.endpoint || fallbackEndpoint),
    executeCode: schedule.target?.ephemeralAgent?.execute_code === true,
    fileSearch: schedule.target?.ephemeralAgent?.file_search === true,
    artifacts: getArtifactMode(schedule.target?.ephemeralAgent?.artifacts),
    mcpServers: schedule.target?.ephemeralAgent?.mcp || [],
    notifications: {
      email: schedule.notifications?.email === true,
      sms: schedule.notifications?.sms === true,
      push: schedule.notifications?.push === true,
    },
  };
}

function buildPayload(form: ScheduleFormState): TScheduledJobCreatePayload {
  const payload: TScheduledJobCreatePayload = {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    enabled: form.enabled,
    cron: form.cron.trim(),
    timezone: form.timezone.trim(),
    notifications: {
      email: form.notifications.email,
      sms: form.notifications.sms,
      push: form.notifications.push,
    },
    target:
      form.targetMode === 'agent'
        ? {
            endpoint: EModelEndpoint.agents,
            agent_id: form.agentId,
          }
        : {
            endpoint: form.endpoint,
            model: form.model,
            promptPrefix: form.promptPrefix.trim() || undefined,
            ephemeralAgent: {
              web_search: form.webSearch,
              web_search_mode: form.webSearch ? form.webSearchMode : undefined,
              execute_code: form.executeCode,
              file_search: form.fileSearch,
              artifacts: form.artifacts || undefined,
              mcp: form.mcpServers.length ? form.mcpServers : undefined,
            },
          },
  };

  return payload;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export default function ScheduledRuns() {
  const localize = useLocalize();
  const { user } = useAuthContext();
  const { showToast } = useToastContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<TScheduledJob | null>(null);
  const [notificationDirty, setNotificationDirty] = useState(false);
  const [isPushSupported, setIsPushSupported] = useState(false);

  const schedulesQuery = useScheduledJobsQuery();
  const notificationsQuery = useScheduledJobNotificationsQuery();
  const agentsQuery = useListAgentsQuery({ limit: 100, requiredPermission: PermissionBits.VIEW });
  const endpointsQuery = useGetEndpointsQuery();
  const mcpServersQuery = useMCPServersQuery();
  const modelsQuery = useGetModelsQuery();

  const createMutation = useCreateScheduledJobMutation();
  const updateMutation = useUpdateScheduledJobMutation();
  const deleteMutation = useDeleteScheduledJobMutation();
  const runMutation = useRunScheduledJobMutation();
  const updateNotificationsMutation = useUpdateScheduledJobNotificationsMutation();
  const subscribePushMutation = useSubscribeScheduledJobPushMutation();
  const unsubscribePushMutation = useUnsubscribeScheduledJobPushMutation();

  const agentOptions = useMemo(
    () =>
      (agentsQuery.data?.data ?? []).map((agent) => ({
        value: agent.id,
        label: agent.name || agent.description || agent.id,
      })),
    [agentsQuery.data],
  );

  const endpointOptions = useMemo(() => {
    const modelsConfig = modelsQuery.data ?? {};
    const endpointsConfig = endpointsQuery.data ?? {};

    return Object.keys(modelsConfig)
      .filter(
        (endpoint) =>
          endpoint !== EModelEndpoint.agents &&
          endpoint !== EModelEndpoint.assistants &&
          endpoint !== EModelEndpoint.azureAssistants &&
          Array.isArray(modelsConfig[endpoint]) &&
          modelsConfig[endpoint].length > 0,
      )
      .map((endpoint) => ({
        value: endpoint,
        label: endpointsConfig?.[endpoint]?.name || endpoint,
      }));
  }, [endpointsQuery.data, modelsQuery.data]);

  const defaultAgentId = agentOptions[0]?.value || '';
  const defaultEndpoint = endpointOptions[0]?.value || EModelEndpoint.openAI;
  const defaultModel = (modelsQuery.data?.[defaultEndpoint] ?? [])[0] || '';
  const defaultTimezone = getBrowserTimeZone();
  const defaultSmsProvider = getDefaultSmsProvider(notificationsQuery.data?.capabilities);

  const [form, setForm] = useState<ScheduleFormState>(() =>
    createFormState(null, defaultAgentId, defaultEndpoint, defaultModel, defaultTimezone),
  );
  const [notificationDraft, setNotificationDraft] = useState<NotificationDraft>(() =>
    createNotificationDraft(undefined, user?.email || ''),
  );

  const smsProviderOptions = useMemo(() => {
    const options: Array<{ value: 'twilio' | 'carrier_gateway'; label: string }> = [];

    if (notificationsQuery.data?.capabilities?.smsProviders?.twilio) {
      options.push({
        value: 'twilio',
        label: localize('com_ui_schedule_sms_provider_twilio'),
      });
    }

    if (notificationsQuery.data?.capabilities?.smsProviders?.carrierGateway) {
      options.push({
        value: 'carrier_gateway',
        label: localize('com_ui_schedule_sms_provider_gateway'),
      });
    }

    if (options.length === 0) {
      options.push({
        value: 'twilio',
        label: localize('com_ui_schedule_sms_provider_twilio'),
      });
    }

    return options;
  }, [localize, notificationsQuery.data?.capabilities?.smsProviders]);

  const selectedEndpointModels = useMemo(
    () =>
      (modelsQuery.data?.[form.endpoint] ?? []).map((model) => ({ value: model, label: model })),
    [form.endpoint, modelsQuery.data],
  );

  const mcpServerOptions = useMemo<MCPServerOption[]>(() => {
    return Object.entries(mcpServersQuery.data ?? {})
      .filter(([, server]) => server.consumeOnly !== true)
      .map(([serverName, server]) => ({
        value: serverName,
        label: server.title || serverName,
        description: server.description,
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [mcpServersQuery.data]);

  const ollamaWebSearchModeOptions = useMemo(
    () => [
      {
        value: WebSearchModes.librechat,
        label: localize('com_ui_schedule_web_search_mode_librechat'),
      },
      {
        value: WebSearchModes.ollama_native,
        label: localize('com_ui_schedule_web_search_mode_ollama_native'),
      },
      {
        value: WebSearchModes.ollama_mcp,
        label: localize('com_ui_schedule_web_search_mode_ollama_mcp'),
      },
    ],
    [localize],
  );

  const artifactModeOptions = useMemo(
    () => [
      { value: 'none', label: localize('com_ui_schedule_artifacts_none') },
      { value: ArtifactModes.DEFAULT, label: localize('com_ui_schedule_artifacts_default') },
      { value: ArtifactModes.SHADCNUI, label: localize('com_ui_schedule_artifacts_shadcnui') },
      { value: ArtifactModes.CUSTOM, label: localize('com_ui_schedule_artifacts_custom') },
    ],
    [localize],
  );

  const resetForm = useCallback(
    (schedule: TScheduledJob | null) => {
      setForm(
        createFormState(schedule, defaultAgentId, defaultEndpoint, defaultModel, defaultTimezone),
      );
    },
    [defaultAgentId, defaultEndpoint, defaultModel, defaultTimezone],
  );

  useEffect(() => {
    if (!dialogOpen || editingSchedule) {
      return;
    }

    setForm((current) => {
      const next = { ...current };

      if (next.targetMode === 'agent' && !next.agentId && defaultAgentId) {
        next.agentId = defaultAgentId;
      }

      if (next.targetMode === 'model') {
        if (!next.endpoint && defaultEndpoint) {
          next.endpoint = defaultEndpoint;
        }
        if (!next.model) {
          next.model = (modelsQuery.data?.[next.endpoint || defaultEndpoint] ?? [])[0] || '';
        }
      }

      return next;
    });
  }, [defaultAgentId, defaultEndpoint, dialogOpen, editingSchedule, modelsQuery.data]);

  useEffect(() => {
    if (notificationDirty || !notificationsQuery.data) {
      return;
    }

    setNotificationDraft(
      createNotificationDraft(notificationsQuery.data, user?.email || '', defaultSmsProvider),
    );
  }, [defaultSmsProvider, notificationDirty, notificationsQuery.data, user?.email]);

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    setIsPushSupported(supported);
  }, []);

  const handleFormChange = <K extends keyof ScheduleFormState>(
    key: K,
    value: ScheduleFormState[K],
  ) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const handleNotificationChange = <K extends keyof NotificationDraft>(
    key: K,
    value: NotificationDraft[K],
  ) => {
    setNotificationDirty(true);
    setNotificationDraft((current) => ({ ...current, [key]: value }));
  };

  const handleMcpServerToggle = (serverName: string, checked: boolean) => {
    setForm((current) => {
      const nextServers = checked
        ? Array.from(new Set([...current.mcpServers, serverName]))
        : current.mcpServers.filter((value) => value !== serverName);

      return {
        ...current,
        mcpServers: nextServers,
      };
    });
  };

  let mcpServersContent: React.ReactNode;
  if (mcpServersQuery.isLoading) {
    mcpServersContent = (
      <div className="flex items-center gap-2 rounded-lg border border-border-light px-3 py-2 text-sm text-text-secondary">
        <Spinner className="h-4 w-4" />
        {localize('com_ui_loading')}
      </div>
    );
  } else if (mcpServerOptions.length === 0) {
    mcpServersContent = (
      <div className="rounded-lg border border-dashed border-border-medium px-3 py-2 text-sm text-text-secondary">
        {localize('com_ui_schedule_mcp_servers_empty')}
      </div>
    );
  } else {
    mcpServersContent = (
      <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-border-light p-3">
        {mcpServerOptions.map((server) => (
          <label
            key={server.value}
            className="flex items-start gap-3 rounded-md border border-transparent px-2 py-1.5 text-sm hover:bg-surface-secondary"
          >
            <input
              type="checkbox"
              checked={form.mcpServers.includes(server.value)}
              onChange={(event) => handleMcpServerToggle(server.value, event.target.checked)}
            />
            <span className="min-w-0">
              <span className="block font-medium text-text-primary">{server.label}</span>
              {server.description ? (
                <span className="block text-xs text-text-secondary">{server.description}</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>
    );
  }

  const openCreateDialog = () => {
    setEditingSchedule(null);
    resetForm(null);
    setDialogOpen(true);
  };

  const openEditDialog = (schedule: TScheduledJob) => {
    setEditingSchedule(schedule);
    resetForm(schedule);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingSchedule(null);
    resetForm(null);
  };

  const saveSchedule = async () => {
    try {
      const payload = buildPayload(form);
      if (editingSchedule) {
        await updateMutation.mutateAsync({ scheduleId: editingSchedule.scheduleId, payload });
        showToast({ message: localize('com_ui_schedule_updated'), status: 'success' });
      } else {
        await createMutation.mutateAsync(payload);
        showToast({ message: localize('com_ui_schedule_created'), status: 'success' });
      }
      closeDialog();
    } catch (error) {
      const message = error instanceof Error ? error.message : localize('com_ui_schedule_error');
      showToast({ message, status: 'error' });
    }
  };

  const saveNotifications = async () => {
    try {
      await updateNotificationsMutation.mutateAsync({
        email: {
          enabled: notificationDraft.emailEnabled,
          address: notificationDraft.emailAddress,
        },
        sms: {
          enabled: notificationDraft.smsEnabled,
          provider: notificationDraft.smsProvider,
          phoneNumber: notificationDraft.phoneNumber,
          gatewayAddress: notificationDraft.gatewayAddress,
        },
        push: {
          enabled: notificationDraft.pushEnabled,
        },
      });
      setNotificationDirty(false);
      showToast({ message: localize('com_ui_schedule_notifications_saved'), status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : localize('com_ui_schedule_error');
      showToast({ message, status: 'error' });
    }
  };

  const handleRunSchedule = async (scheduleId: string) => {
    try {
      const result = await runMutation.mutateAsync(scheduleId);
      const conversationId = result.executionResult?.conversationId;
      showToast({
        message: conversationId
          ? localize('com_ui_schedule_run_success_with_conversation', { conversationId })
          : localize('com_ui_schedule_run_success'),
        status: 'success',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : localize('com_ui_schedule_error');
      showToast({ message, status: 'error' });
    }
  };

  const handleDeleteSchedule = async (schedule: TScheduledJob) => {
    if (!window.confirm(localize('com_ui_schedule_delete_confirm', { name: schedule.name }))) {
      return;
    }

    try {
      await deleteMutation.mutateAsync(schedule.scheduleId);
      showToast({ message: localize('com_ui_schedule_deleted'), status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : localize('com_ui_schedule_error');
      showToast({ message, status: 'error' });
    }
  };

  const subscribePush = async () => {
    try {
      const publicKey = notificationsQuery.data?.capabilities?.pushPublicKey;
      if (!publicKey) {
        throw new Error(localize('com_ui_schedule_push_not_configured'));
      }
      if (!isPushSupported) {
        throw new Error(localize('com_ui_schedule_push_not_supported'));
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        throw new Error(localize('com_ui_schedule_push_permission_denied'));
      }

      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }

      await subscribePushMutation.mutateAsync(subscription.toJSON());
      setNotificationDirty(false);
      showToast({ message: localize('com_ui_schedule_push_enabled'), status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : localize('com_ui_schedule_error');
      showToast({ message, status: 'error' });
    }
  };

  const unsubscribePush = async () => {
    try {
      if (!isPushSupported) {
        throw new Error(localize('com_ui_schedule_push_not_supported'));
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        throw new Error(localize('com_ui_schedule_push_not_subscribed'));
      }

      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await unsubscribePushMutation.mutateAsync(endpoint);
      setNotificationDirty(false);
      showToast({ message: localize('com_ui_schedule_push_disabled'), status: 'success' });
    } catch (error) {
      const message = error instanceof Error ? error.message : localize('com_ui_schedule_error');
      showToast({ message, status: 'error' });
    }
  };

  const isScheduleSaving = createMutation.isLoading || updateMutation.isLoading;
  const isNotificationsSaving =
    updateNotificationsMutation.isLoading ||
    subscribePushMutation.isLoading ||
    unsubscribePushMutation.isLoading;

  const canSaveSchedule =
    form.name.trim() !== '' &&
    form.prompt.trim() !== '' &&
    form.cron.trim() !== '' &&
    form.timezone.trim() !== '' &&
    ((form.targetMode === 'agent' && form.agentId !== '') ||
      (form.targetMode === 'model' && form.endpoint !== '' && form.model !== ''));

  const hasPushSubscription = (notificationsQuery.data?.push?.subscriptionCount ?? 0) > 0;
  const isCarrierGatewaySms = notificationDraft.smsProvider === 'carrier_gateway';
  const pushSubscriptionButtonLabel = hasPushSubscription
    ? localize('com_ui_schedule_push_refresh')
    : localize('com_ui_schedule_push_enable_browser');

  let schedulesContent: React.ReactNode;

  if (schedulesQuery.isLoading) {
    schedulesContent = (
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <Spinner className="h-4 w-4" />
        {localize('com_ui_loading')}
      </div>
    );
  } else if (schedulesQuery.data && schedulesQuery.data.length > 0) {
    schedulesContent = (
      <div className="space-y-3">
        {schedulesQuery.data.map((schedule) => {
          const channels = [
            schedule.notifications?.email ? localize('com_ui_schedule_channel_email') : null,
            schedule.notifications?.sms ? localize('com_ui_schedule_channel_sms') : null,
            schedule.notifications?.push ? localize('com_ui_schedule_channel_push') : null,
          ].filter(Boolean);

          const targetSummary =
            schedule.target.endpoint === EModelEndpoint.agents
              ? localize('com_ui_schedule_target_agent_value', {
                  value: schedule.target.agent_id || '—',
                })
              : localize('com_ui_schedule_target_model_value', {
                  endpoint: schedule.target.endpoint,
                  model: schedule.target.model || '—',
                });

          return (
            <div key={schedule.scheduleId} className="rounded-lg border border-border-light p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Clock3 className="h-4 w-4 text-text-secondary" />
                    <div className="truncate font-medium">{schedule.name}</div>
                    {!schedule.enabled && (
                      <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary">
                        {localize('com_ui_schedule_disabled_badge')}
                      </span>
                    )}
                    {schedule.isRunning && (
                      <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-text-secondary">
                        {localize('com_ui_schedule_running_badge')}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 text-sm text-text-secondary">{targetSummary}</div>
                  <div className="mt-2 text-sm text-text-secondary">
                    {localize('com_ui_schedule_cron_value', {
                      cron: schedule.cron,
                      timezone: schedule.timezone,
                    })}
                  </div>
                  <div className="mt-2 text-sm text-text-secondary">
                    {localize('com_ui_schedule_next_run_value', {
                      value: formatDateTime(schedule.nextRunAt),
                    })}
                  </div>
                  <div className="mt-1 text-sm text-text-secondary">
                    {localize('com_ui_schedule_last_status_value', {
                      value: schedule.lastStatus || 'idle',
                    })}
                  </div>
                  {channels.length > 0 && (
                    <div className="mt-2 text-xs text-text-secondary">{channels.join(', ')}</div>
                  )}
                  {schedule.lastResponsePreview && (
                    <p className="mt-3 text-sm text-text-primary">
                      {truncateText(schedule.lastResponsePreview, 180)}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 self-end md:self-start">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => handleRunSchedule(schedule.scheduleId)}
                    disabled={runMutation.isLoading || schedule.isRunning}
                  >
                    <Play className="h-4 w-4" />
                    {localize('com_ui_schedule_run_now')}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => openEditDialog(schedule)}
                    disabled={schedule.isRunning}
                    aria-label={localize('com_ui_schedule_edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleDeleteSchedule(schedule)}
                    disabled={deleteMutation.isLoading || schedule.isRunning}
                    aria-label={localize('com_ui_schedule_delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  } else {
    schedulesContent = (
      <div className="rounded-lg border border-dashed border-border-medium p-6 text-sm text-text-secondary">
        {localize('com_ui_schedule_empty')}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border-light p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-base font-semibold">{localize('com_ui_schedule_runs')}</div>
          <p className="mt-1 text-sm text-text-secondary">
            {localize('com_ui_schedule_runs_description')}
          </p>
        </div>
        <OGDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <OGDialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2" onClick={openCreateDialog}>
              <Plus className="h-4 w-4" />
              {localize('com_ui_schedule_new')}
            </Button>
          </OGDialogTrigger>
          <OGDialogContent className="max-w-2xl">
            <OGDialogTitle>
              {editingSchedule ? localize('com_ui_schedule_edit') : localize('com_ui_schedule_new')}
            </OGDialogTitle>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-name">{localize('com_ui_schedule_name')}</Label>
                <Input
                  id="schedule-name"
                  value={form.name}
                  onChange={(event) => handleFormChange('name', event.target.value)}
                  placeholder={localize('com_ui_schedule_name_placeholder')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="schedule-prompt">{localize('com_ui_schedule_prompt')}</Label>
                <Textarea
                  id="schedule-prompt"
                  rows={5}
                  value={form.prompt}
                  onChange={(event) => handleFormChange('prompt', event.target.value)}
                  placeholder={localize('com_ui_schedule_prompt_placeholder')}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="schedule-cron">{localize('com_ui_schedule_cron')}</Label>
                  <Input
                    id="schedule-cron"
                    value={form.cron}
                    onChange={(event) => handleFormChange('cron', event.target.value)}
                    placeholder={DEFAULT_CRON}
                  />
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_schedule_cron_hint')}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schedule-timezone">{localize('com_ui_schedule_timezone')}</Label>
                  <Input
                    id="schedule-timezone"
                    value={form.timezone}
                    onChange={(event) => handleFormChange('timezone', event.target.value)}
                    placeholder={defaultTimezone}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border-light p-3">
                <div>
                  <div className="font-medium">{localize('com_ui_schedule_enabled')}</div>
                  <p className="text-xs text-text-secondary">
                    {localize('com_ui_schedule_enabled_description')}
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(checked) => handleFormChange('enabled', checked)}
                  aria-label={localize('com_ui_schedule_enabled')}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{localize('com_ui_schedule_target_type')}</Label>
                  <Dropdown
                    value={form.targetMode}
                    onChange={(value) => handleFormChange('targetMode', value as 'agent' | 'model')}
                    options={[
                      { value: 'agent', label: localize('com_ui_schedule_target_agent') },
                      { value: 'model', label: localize('com_ui_schedule_target_model') },
                    ]}
                    portal={false}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{localize('com_ui_schedule_notifications')}</Label>
                  <div className="flex flex-wrap gap-3 rounded-lg border border-border-light px-3 py-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.notifications.email}
                        onChange={(event) =>
                          handleFormChange('notifications', {
                            ...form.notifications,
                            email: event.target.checked,
                          })
                        }
                      />
                      {localize('com_ui_schedule_channel_email')}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.notifications.sms}
                        onChange={(event) =>
                          handleFormChange('notifications', {
                            ...form.notifications,
                            sms: event.target.checked,
                          })
                        }
                      />
                      {localize('com_ui_schedule_channel_sms')}
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.notifications.push}
                        onChange={(event) =>
                          handleFormChange('notifications', {
                            ...form.notifications,
                            push: event.target.checked,
                          })
                        }
                      />
                      {localize('com_ui_schedule_channel_push')}
                    </label>
                  </div>
                </div>
              </div>

              {form.targetMode === 'agent' ? (
                <div className="space-y-2">
                  <Label>{localize('com_ui_schedule_target_agent')}</Label>
                  <Dropdown
                    value={form.agentId}
                    onChange={(value) => handleFormChange('agentId', value)}
                    options={agentOptions}
                    portal={false}
                  />
                </div>
              ) : (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>{localize('com_ui_schedule_endpoint')}</Label>
                      <Dropdown
                        value={form.endpoint}
                        onChange={(value) => {
                          handleFormChange('endpoint', value);
                          handleFormChange('model', (modelsQuery.data?.[value] ?? [])[0] || '');
                          handleFormChange('webSearchMode', getDefaultWebSearchMode(value));
                        }}
                        options={endpointOptions}
                        portal={false}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{localize('com_ui_schedule_model')}</Label>
                      <Dropdown
                        value={form.model}
                        onChange={(value) => handleFormChange('model', value)}
                        options={selectedEndpointModels}
                        portal={false}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="schedule-prefix">
                      {localize('com_ui_schedule_instructions')}
                    </Label>
                    <Textarea
                      id="schedule-prefix"
                      rows={3}
                      value={form.promptPrefix}
                      onChange={(event) => handleFormChange('promptPrefix', event.target.value)}
                      placeholder={localize('com_ui_schedule_instructions_placeholder')}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border-light p-3">
                    <div>
                      <div className="font-medium">{localize('com_ui_schedule_web_search')}</div>
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_schedule_web_search_description')}
                      </p>
                    </div>
                    <Switch
                      checked={form.webSearch}
                      onCheckedChange={(checked) => handleFormChange('webSearch', checked)}
                      aria-label={localize('com_ui_schedule_web_search')}
                    />
                  </div>

                  {form.webSearch && isOllamaEndpoint(form.endpoint) && (
                    <div className="space-y-2">
                      <Label>{localize('com_ui_schedule_web_search_mode')}</Label>
                      <Dropdown
                        value={form.webSearchMode}
                        onChange={(value) =>
                          handleFormChange('webSearchMode', value as WebSearchModes)
                        }
                        options={ollamaWebSearchModeOptions}
                        portal={false}
                      />
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_schedule_web_search_mode_description')}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div>
                      <Label>{localize('com_ui_schedule_automation_tools')}</Label>
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_schedule_automation_tools_description')}
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="flex items-center justify-between rounded-lg border border-border-light p-3">
                        <div>
                          <div className="font-medium">
                            {localize('com_ui_schedule_code_interpreter')}
                          </div>
                          <p className="text-xs text-text-secondary">
                            {localize('com_ui_schedule_code_interpreter_description')}
                          </p>
                        </div>
                        <Switch
                          checked={form.executeCode}
                          onCheckedChange={(checked) => handleFormChange('executeCode', checked)}
                          aria-label={localize('com_ui_schedule_code_interpreter')}
                        />
                      </div>

                      <div className="flex items-center justify-between rounded-lg border border-border-light p-3">
                        <div>
                          <div className="font-medium">
                            {localize('com_ui_schedule_file_search')}
                          </div>
                          <p className="text-xs text-text-secondary">
                            {localize('com_ui_schedule_file_search_description')}
                          </p>
                        </div>
                        <Switch
                          checked={form.fileSearch}
                          onCheckedChange={(checked) => handleFormChange('fileSearch', checked)}
                          aria-label={localize('com_ui_schedule_file_search')}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{localize('com_ui_schedule_artifacts_mode')}</Label>
                    <Dropdown
                      value={form.artifacts || 'none'}
                      onChange={(value) =>
                        handleFormChange(
                          'artifacts',
                          value === 'none' ? '' : (value as ArtifactModes),
                        )
                      }
                      options={artifactModeOptions}
                      portal={false}
                    />
                    <p className="text-xs text-text-secondary">
                      {localize('com_ui_schedule_artifacts_mode_description')}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <Label>{localize('com_ui_schedule_mcp_servers')}</Label>
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_schedule_mcp_servers_description')}
                      </p>
                    </div>

                    {mcpServersContent}
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2">
                <OGDialogClose asChild>
                  <Button variant="outline" onClick={closeDialog}>
                    {localize('com_ui_cancel')}
                  </Button>
                </OGDialogClose>
                <Button onClick={saveSchedule} disabled={!canSaveSchedule || isScheduleSaving}>
                  {isScheduleSaving ? <Spinner className="h-4 w-4" /> : localize('com_ui_save')}
                </Button>
              </div>
            </div>
          </OGDialogContent>
        </OGDialog>
      </div>

      <div className="mb-6 rounded-lg border border-border-light p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <div className="font-medium">{localize('com_ui_schedule_notification_methods')}</div>
            <p className="text-xs text-text-secondary">
              {localize('com_ui_schedule_notification_methods_description')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={saveNotifications}
            disabled={!notificationDirty || isNotificationsSaving}
          >
            {isNotificationsSaving ? <Spinner className="h-4 w-4" /> : localize('com_ui_save')}
          </Button>
        </div>

        {notificationsQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <Spinner className="h-4 w-4" />
            {localize('com_ui_loading')}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-border-light p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Label>{localize('com_ui_schedule_channel_email')}</Label>
                  <Switch
                    checked={notificationDraft.emailEnabled}
                    disabled={!notificationsQuery.data?.capabilities?.email}
                    onCheckedChange={(checked) => handleNotificationChange('emailEnabled', checked)}
                    aria-label={localize('com_ui_schedule_channel_email')}
                  />
                </div>
                <Input
                  value={notificationDraft.emailAddress}
                  onChange={(event) => handleNotificationChange('emailAddress', event.target.value)}
                  placeholder={user?.email || 'name@example.com'}
                  disabled={!notificationsQuery.data?.capabilities?.email}
                />
              </div>

              <div className="rounded-lg border border-border-light p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <Label>{localize('com_ui_schedule_channel_sms')}</Label>
                  <Switch
                    checked={notificationDraft.smsEnabled}
                    disabled={!notificationsQuery.data?.capabilities?.sms}
                    onCheckedChange={(checked) => handleNotificationChange('smsEnabled', checked)}
                    aria-label={localize('com_ui_schedule_channel_sms')}
                  />
                </div>

                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>{localize('com_ui_schedule_sms_provider')}</Label>
                    <Dropdown
                      value={notificationDraft.smsProvider}
                      onChange={(value) =>
                        handleNotificationChange(
                          'smsProvider',
                          value as NotificationDraft['smsProvider'],
                        )
                      }
                      options={smsProviderOptions}
                      portal={false}
                      ariaLabel={localize('com_ui_schedule_sms_provider')}
                    />
                  </div>

                  {isCarrierGatewaySms ? (
                    <div className="space-y-2">
                      <Input
                        value={notificationDraft.gatewayAddress}
                        onChange={(event) =>
                          handleNotificationChange('gatewayAddress', event.target.value)
                        }
                        placeholder={localize('com_ui_schedule_sms_gateway_address_placeholder')}
                        disabled={!notificationsQuery.data?.capabilities?.sms}
                      />
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_schedule_sms_gateway_address_description')}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Input
                        value={notificationDraft.phoneNumber}
                        onChange={(event) =>
                          handleNotificationChange('phoneNumber', event.target.value)
                        }
                        placeholder={localize('com_ui_schedule_sms_phone_number_placeholder')}
                        disabled={!notificationsQuery.data?.capabilities?.sms}
                      />
                      <p className="text-xs text-text-secondary">
                        {localize('com_ui_schedule_sms_phone_number_description')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border-light p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <Label>{localize('com_ui_schedule_channel_push')}</Label>
                  <p className="mt-1 text-xs text-text-secondary">
                    {localize('com_ui_schedule_push_description')}
                  </p>
                </div>
                <Switch
                  checked={notificationDraft.pushEnabled}
                  disabled={
                    !notificationsQuery.data?.capabilities?.push ||
                    !isPushSupported ||
                    !notificationsQuery.data?.capabilities?.pushPublicKey
                  }
                  onCheckedChange={(checked) => handleNotificationChange('pushEnabled', checked)}
                  aria-label={localize('com_ui_schedule_channel_push')}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={subscribePush}
                  disabled={
                    !notificationsQuery.data?.capabilities?.push ||
                    !notificationsQuery.data?.capabilities?.pushPublicKey ||
                    !isPushSupported ||
                    subscribePushMutation.isLoading
                  }
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  {pushSubscriptionButtonLabel}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={unsubscribePush}
                  disabled={!hasPushSubscription || unsubscribePushMutation.isLoading}
                >
                  {localize('com_ui_schedule_push_disable_browser')}
                </Button>
                <span className="text-xs text-text-secondary">
                  {localize('com_ui_schedule_push_subscription_count', {
                    count: notificationsQuery.data?.push?.subscriptionCount ?? 0,
                  })}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {schedulesContent}
    </div>
  );
}
