import { useEffect } from 'react';
import { useRecoilCallback, useRecoilValue } from 'recoil';
import { Spinner, useToastContext } from '@librechat/client';
import { useParams, useSearchParams } from 'react-router-dom';
import { Constants, EModelEndpoint, SystemRoles } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { TPreset } from 'librechat-data-provider';
import {
  useNewConvo,
  useAppStartup,
  useAssistantListMap,
  useIdChangeEffect,
  useLocalize,
} from '~/hooks';
import {
  useGetConvoIdQuery,
  useGetStartupConfig,
  useGetEndpointsQuery,
  useGetRole,
} from '~/data-provider';
import {
  getDefaultModelSpec,
  getModelSpecPreset,
  processValidSettings,
  logger,
  isNotFoundError,
} from '~/utils';
import { ToolCallsMapProvider } from '~/Providers';
import ChatView from '~/components/Chat/ChatView';
import { NotificationSeverity } from '~/common';
import useAuthRedirect from './useAuthRedirect';
import temporaryStore from '~/store/temporary';
import store from '~/store';

function BootstrapLoading({ label }: { label: string }) {
  return (
    <div className="flex h-screen items-center justify-center" aria-live="polite" role="status">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="text-text-primary" />
        <p className="text-sm text-text-secondary">{label}</p>
      </div>
    </div>
  );
}

function BootstrapError({
  message,
  retryLabel,
  onRetry,
  isRetrying,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  isRetrying?: boolean;
}) {
  return (
    <div className="flex h-screen items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-border-medium bg-surface-primary p-6 text-center shadow-lg">
        <p className="text-sm font-medium text-text-primary" role="alert">
          {message}
        </p>
        <button
          type="button"
          className="mt-4 inline-flex items-center justify-center rounded-lg border border-border-medium px-4 py-2 text-sm font-medium text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onRetry}
          disabled={isRetrying}
        >
          {retryLabel}
        </button>
      </div>
    </div>
  );
}

export default function ChatRoute() {
  const { isAuthenticated, user } = useAuthRedirect();
  const startupConfigQuery = useGetStartupConfig({
    enabled: isAuthenticated,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const { data: startupConfig } = startupConfigQuery;

  const defaultTemporaryChat = useRecoilValue(temporaryStore.defaultTemporaryChat);
  const setIsTemporary = useRecoilCallback(
    ({ set }) =>
      (value: boolean) => {
        set(temporaryStore.isTemporary, value);
      },
    [],
  );
  useAppStartup({ startupConfig, user });

  const index = 0;
  const [searchParams] = useSearchParams();
  const { conversationId = '' } = useParams();
  useIdChangeEffect(conversationId);
  const { hasSetConversation, conversation } = store.useCreateConversationAtom(index);
  const { newConversation } = useNewConvo();
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const userRoleQuery = useGetRole(SystemRoles.USER, {
    enabled: !!(isAuthenticated && user?.role),
  });

  const modelsQuery = useGetModelsQuery({
    enabled: isAuthenticated,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const initialConvoQuery = useGetConvoIdQuery(conversationId, {
    enabled:
      isAuthenticated && conversationId !== Constants.NEW_CONVO && !hasSetConversation.current,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const endpointsQuery = useGetEndpointsQuery({
    enabled: isAuthenticated,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
  });
  const assistantListMap = useAssistantListMap();

  const isTemporaryChat = conversation && conversation.expiredAt ? true : false;
  const hasInitialModels = Array.isArray(modelsQuery.data?.initial);
  const hasLoadedModels = modelsQuery.data != null && !hasInitialModels;
  const rolesLoaded = userRoleQuery.data != null;
  const isUserRolePending = isAuthenticated && user?.role && !rolesLoaded && !userRoleQuery.isError;
  const isStartupPending =
    isAuthenticated && (startupConfigQuery.isLoading || startupConfig == null);
  const isModelsPending = !!(
    isAuthenticated &&
    (modelsQuery.isLoading || (hasInitialModels && !modelsQuery.isError))
  );
  const isEndpointsPending = !!(isAuthenticated && endpointsQuery.isLoading);
  const isInitialConversationPending = !!(
    isAuthenticated &&
    conversationId !== Constants.NEW_CONVO &&
    initialConvoQuery.isLoading
  );
  const loadingLabel = localize('com_ui_loading');
  const retryLabel = localize('com_ui_retry');

  let bootstrapError: { message: string; onRetry: () => void; isRetrying?: boolean } | undefined;

  if (isAuthenticated && startupConfig == null && startupConfigQuery.isError) {
    bootstrapError = {
      message: localize('com_ui_error_generic'),
      onRetry: () => {
        void startupConfigQuery.refetch();
      },
      isRetrying: startupConfigQuery.isFetching,
    };
  } else if (isAuthenticated && userRoleQuery.data == null && userRoleQuery.isError) {
    bootstrapError = {
      message: localize('com_ui_permissions_failed_load'),
      onRetry: () => {
        void userRoleQuery.refetch();
      },
      isRetrying: userRoleQuery.isFetching,
    };
  } else if (isAuthenticated && endpointsQuery.data == null && endpointsQuery.isError) {
    bootstrapError = {
      message: localize('com_ui_error_generic'),
      onRetry: () => {
        void endpointsQuery.refetch();
      },
      isRetrying: endpointsQuery.isFetching,
    };
  } else if (isAuthenticated && !hasLoadedModels && modelsQuery.isError) {
    bootstrapError = {
      message: localize('com_error_models_not_loaded'),
      onRetry: () => {
        void modelsQuery.refetch();
      },
      isRetrying: modelsQuery.isFetching,
    };
  } else if (
    isAuthenticated &&
    initialConvoQuery.data == null &&
    initialConvoQuery.isError &&
    !isNotFoundError(initialConvoQuery.error)
  ) {
    bootstrapError = {
      message: localize('com_ui_error_generic'),
      onRetry: () => {
        void initialConvoQuery.refetch();
      },
      isRetrying: initialConvoQuery.isFetching,
    };
  }

  const canInitializeConversation = !!(
    startupConfig &&
    rolesLoaded &&
    endpointsQuery.data &&
    hasLoadedModels
  );
  const isConversationBootstrapPending = !!(
    isAuthenticated &&
    !conversation &&
    conversationId &&
    canInitializeConversation &&
    !bootstrapError &&
    (conversationId === Constants.NEW_CONVO ||
      initialConvoQuery.isLoading ||
      initialConvoQuery.data ||
      initialConvoQuery.isError)
  );
  const shouldShowBootstrapLoading =
    isAuthenticated &&
    !conversation &&
    !bootstrapError &&
    (isStartupPending ||
      isUserRolePending ||
      isModelsPending ||
      isEndpointsPending ||
      isInitialConversationPending ||
      isConversationBootstrapPending);

  useEffect(() => {
    if (conversationId === Constants.NEW_CONVO) {
      setIsTemporary(defaultTemporaryChat);
    } else if (isTemporaryChat) {
      setIsTemporary(isTemporaryChat);
    } else {
      setIsTemporary(false);
    }
  }, [conversationId, isTemporaryChat, setIsTemporary, defaultTemporaryChat]);

  /** This effect is mainly for the first conversation state change on first load of the page.
   *  Adjusting this may have unintended consequences on the conversation state.
   */
  useEffect(() => {
    const shouldSetConvo =
      (startupConfig && rolesLoaded && !hasSetConversation.current && !hasInitialModels) ?? false;
    /* Early exit if startupConfig is not loaded and conversation is already set and only initial models have loaded */
    if (!shouldSetConvo) {
      return;
    }

    const isNewConvo = conversationId === Constants.NEW_CONVO;

    const getNewConvoPreset = () => {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      const specPreset = spec ? getModelSpecPreset(spec) : undefined;

      const queryParams: Record<string, string> = {};
      searchParams.forEach((value, key) => {
        if (key !== 'prompt' && key !== 'q' && key !== 'submit') {
          queryParams[key] = value;
        }
      });
      const querySettings = processValidSettings(queryParams);

      return Object.keys(querySettings).length > 0
        ? { ...specPreset, ...querySettings }
        : specPreset;
    };

    if (isNewConvo && endpointsQuery.data && modelsQuery.data) {
      const preset = getNewConvoPreset();

      logger.log('conversation', 'ChatRoute, new convo effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(preset ? { preset } : {}),
      });

      hasSetConversation.current = true;
    } else if (
      conversationId &&
      endpointsQuery.data &&
      modelsQuery.data &&
      initialConvoQuery.isError &&
      isNotFoundError(initialConvoQuery.error)
    ) {
      const result = getDefaultModelSpec(startupConfig);
      const spec = result?.default ?? result?.last;
      showToast({
        message: localize('com_ui_conversation_not_found'),
        severity: NotificationSeverity.WARNING,
      });
      logger.log(
        'conversation',
        'ChatRoute initialConvoQuery isNotFoundError',
        initialConvoQuery.error,
      );
      newConversation({
        modelsData: modelsQuery.data,
        ...(spec ? { preset: getModelSpecPreset(spec) } : {}),
      });
      hasSetConversation.current = true;
    } else if (initialConvoQuery.data && endpointsQuery.data && modelsQuery.data) {
      logger.log('conversation', 'ChatRoute initialConvoQuery', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        /* this is necessary to load all existing settings */
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    } else if (
      isNewConvo &&
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      const preset = getNewConvoPreset();

      logger.log('conversation', 'ChatRoute new convo, assistants effect', conversation);
      newConversation({
        modelsData: modelsQuery.data,
        template: conversation ? conversation : undefined,
        ...(preset ? { preset } : {}),
      });
      hasSetConversation.current = true;
    } else if (
      assistantListMap[EModelEndpoint.assistants] &&
      assistantListMap[EModelEndpoint.azureAssistants]
    ) {
      logger.log('conversation', 'ChatRoute convo, assistants effect', initialConvoQuery.data);
      newConversation({
        template: initialConvoQuery.data,
        preset: initialConvoQuery.data as TPreset,
        modelsData: modelsQuery.data,
        keepLatestMessage: true,
      });
      hasSetConversation.current = true;
    }
    /* Creates infinite render if all dependencies included due to newConversation invocations exceeding call stack before hasSetConversation.current becomes truthy */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    userRoleQuery.data,
    startupConfig,
    initialConvoQuery.data,
    initialConvoQuery.isError,
    endpointsQuery.data,
    hasInitialModels,
    modelsQuery.data,
    assistantListMap,
  ]);

  if (shouldShowBootstrapLoading) {
    return <BootstrapLoading label={loadingLabel} />;
  }

  if (isAuthenticated && !conversation && bootstrapError) {
    return (
      <BootstrapError
        message={bootstrapError.message}
        retryLabel={retryLabel}
        onRetry={bootstrapError.onRetry}
        isRetrying={bootstrapError.isRetrying}
      />
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  // if not a conversation
  if (conversation?.conversationId === Constants.SEARCH) {
    return null;
  }
  // if conversationId not match
  if (!conversation || conversation.conversationId !== conversationId) {
    return <BootstrapLoading label={loadingLabel} />;
  }
  // if conversationId is null
  if (!conversationId) {
    return <BootstrapLoading label={loadingLabel} />;
  }

  return (
    <ToolCallsMapProvider conversationId={conversation.conversationId ?? ''}>
      <ChatView index={index} />
    </ToolCallsMapProvider>
  );
}
