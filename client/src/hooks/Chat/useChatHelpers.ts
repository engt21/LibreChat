import { useCallback, useMemo, useRef, useState } from 'react';
import { Constants, QueryKeys, isAssistantsEndpoint } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useRecoilState, useRecoilValue, useResetRecoilState, useSetRecoilState } from 'recoil';
import type { TMessage } from 'librechat-data-provider';
import {
  useGetStartupConfig,
  useGetUserQuery,
  useStopGenerationMutation,
  type ActiveJobsResponse,
} from '~/data-provider';
import useChatFunctions from '~/hooks/Chat/useChatFunctions';
import useNewConvo from '~/hooks/useNewConvo';
import store from '~/store';

// this to be set somewhere else
export default function useChatHelpers(index = 0, paramId?: string) {
  const clearAllSubmissions = store.useClearSubmissionState();
  const [files, setFiles] = useRecoilState(store.filesByIndex(index));
  const [filesLoading, setFilesLoading] = useState(false);

  const queryClient = useQueryClient();
  const stopMutation = useStopGenerationMutation();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: user } = useGetUserQuery();

  const { newConversation } = useNewConvo(index);
  const { useCreateConversationAtom } = store;
  const { conversation, setConversation } = useCreateConversationAtom(index);
  const { conversationId, endpoint, endpointType } = conversation ?? {};

  /** Use paramId (from URL) as primary source for query key - this must match what ChatView uses
  Falling back to conversationId (Recoil) only if paramId is not available */
  const queryParam = paramId === 'new' ? paramId : (paramId ?? conversationId ?? '');

  const resetLatestMessage = useResetRecoilState(store.latestMessageFamily(index));
  const [isSubmitting, setIsSubmitting] = useRecoilState(store.isSubmittingFamily(index));
  const [latestMessage, setLatestMessage] = useRecoilState(store.latestMessageFamily(index));
  const showStopButton = useRecoilValue(store.showStopButtonByIndex(index));

  const latestMessageId = latestMessage?.messageId;
  const latestMessageDepth = latestMessage?.depth;
  const latestMessageRef = useRef(latestMessage);
  latestMessageRef.current = latestMessage;

  const setSiblingIdx = useSetRecoilState(
    store.messagesSiblingIdxFamily(latestMessage?.parentMessageId ?? null),
  );

  const setMessages = useCallback(
    (messages: TMessage[]) => {
      queryClient.setQueryData<TMessage[]>([QueryKeys.messages, queryParam], messages);
      if (queryParam === 'new' && conversationId && conversationId !== 'new') {
        queryClient.setQueryData<TMessage[]>([QueryKeys.messages, conversationId], messages);
      }
    },
    [queryParam, queryClient, conversationId],
  );

  const getMessages = useCallback(() => {
    return queryClient.getQueryData<TMessage[]>([QueryKeys.messages, queryParam]);
  }, [queryParam, queryClient]);

  /* Conversation */
  // const setActiveConvos = useSetRecoilState(store.activeConversations);

  // const setConversation = useCallback(
  //   (convoUpdate: TConversation) => {
  //     _setConversation(prev => {
  //       const { conversationId: convoId } = prev ?? { conversationId: null };
  //       const { conversationId: currentId } = convoUpdate;
  //       if (currentId && convoId && convoId !== 'new' && convoId !== currentId) {
  //         // for now, we delete the prev convoId from activeConversations
  //         const newActiveConvos = { [currentId]: true };
  //         setActiveConvos(newActiveConvos);
  //       }
  //       return convoUpdate;
  //     });
  //   },
  //   [_setConversation, setActiveConvos],
  // );

  const setSubmission = useSetRecoilState(store.submissionByIndex(index));

  const { ask: _ask, regenerate: _regenerate } = useChatFunctions({
    index,
    files,
    setFiles,
    getMessages,
    setMessages,
    isSubmitting,
    conversation,
    latestMessage,
    setSubmission,
    setLatestMessage,
  });

  const askRef = useRef(_ask);
  askRef.current = _ask;
  const ask: typeof _ask = useCallback((...args) => askRef.current(...args), []);

  const regenerateRef = useRef(_regenerate);
  regenerateRef.current = _regenerate;
  const regenerate: typeof _regenerate = useCallback(
    (...args) => regenerateRef.current(...args),
    [],
  );

  const continueGeneration = useCallback(() => {
    const currentLatest = latestMessageRef.current;
    if (!currentLatest) {
      console.error('Failed to regenerate the message: latestMessage not found.');
      return;
    }

    const messages = getMessages();

    const parentMessage = messages?.find(
      (element) => element.messageId == currentLatest.parentMessageId,
    );

    if (parentMessage && parentMessage.isCreatedByUser) {
      ask({ ...parentMessage }, { isContinued: true, isRegenerate: true, isEdited: true });
    } else {
      console.error(
        'Failed to regenerate the message: parentMessage not found, or not created by user.',
      );
    }
  }, [getMessages, ask]);

  /**
   * Stop generation and allow the server to persist any partial content before refetch.
   */
  const stopGenerating = useCallback(async () => {
    const actualEndpoint = endpointType ?? endpoint;
    const isAssistants = isAssistantsEndpoint(actualEndpoint);
    console.log('[useChatHelpers] stopGenerating called', {
      conversationId,
      endpoint,
      endpointType,
      actualEndpoint,
      isAssistants,
    });

    // For non-assistants endpoints (using resumable streams), call abort endpoint first
    const targetConversationId =
      conversationId && conversationId !== Constants.NEW_CONVO
        ? conversationId
        : latestMessageRef.current?.conversationId;

    if (targetConversationId && !isAssistants) {
      queryClient.setQueryData<ActiveJobsResponse>([QueryKeys.activeJobs], (old) => ({
        activeJobIds: (old?.activeJobIds ?? []).filter((id) => id !== targetConversationId),
      }));
    }

    if (!targetConversationId) {
      clearAllSubmissions();
      return;
    }

    try {
      console.log('[useChatHelpers] Calling abort mutation for:', targetConversationId);
      await stopMutation.mutateAsync({
        conversationId: targetConversationId,
        endpoint: actualEndpoint,
        latestMessageId: latestMessageRef.current?.messageId,
      });
      console.log('[useChatHelpers] Abort mutation succeeded');
    } catch (error) {
      console.error('[useChatHelpers] Abort failed:', error);
    } finally {
      clearAllSubmissions();
      await queryClient.invalidateQueries([QueryKeys.messages, targetConversationId]);
    }
  }, [conversationId, endpoint, endpointType, stopMutation, clearAllSubmissions, queryClient]);

  const handleStopGenerating = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      stopGenerating();
    },
    [stopGenerating],
  );

  const handleRegenerate = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      const parentMessageId = latestMessageRef.current?.parentMessageId ?? '';
      if (!parentMessageId) {
        console.error('Failed to regenerate the message: parentMessageId not found.');
        return;
      }
      regenerate({ parentMessageId });
    },
    [regenerate],
  );

  const handleContinue = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      continueGeneration();
      setSiblingIdx(0);
    },
    [continueGeneration, setSiblingIdx],
  );

  const actualEndpoint = endpointType ?? endpoint;
  const steeringConversationId =
    conversationId && conversationId !== Constants.NEW_CONVO
      ? conversationId
      : latestMessage?.conversationId;

  const canSteerGeneration =
    startupConfig?.modelSteeringEnabled === true &&
    user?.modelSteeringPrefs?.enabled !== false &&
    isSubmitting &&
    showStopButton &&
    !!actualEndpoint &&
    !isAssistantsEndpoint(actualEndpoint) &&
    !!steeringConversationId &&
    steeringConversationId !== Constants.NEW_CONVO;

  const steerGeneration = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const currentLatest = latestMessageRef.current;
      const targetConversationId =
        conversationId && conversationId !== Constants.NEW_CONVO
          ? conversationId
          : currentLatest?.conversationId;

      if (!trimmed || !targetConversationId || targetConversationId === Constants.NEW_CONVO) {
        return false;
      }

      ask(
        {
          text: trimmed,
          conversationId: targetConversationId,
          parentMessageId: currentLatest?.messageId ?? null,
        },
        {
          isSteering: true,
          overrideMessages: getMessages() ?? [],
        },
      );
      setSiblingIdx(0);
      return true;
    },
    [ask, conversationId, getMessages, setSiblingIdx],
  );

  const [preset, setPreset] = useRecoilState(store.presetByIndex(index));
  const [showPopover, setShowPopover] = useRecoilState(store.showPopoverFamily(index));
  const [abortScroll, setAbortScroll] = useRecoilState(store.abortScrollFamily(index));
  const [optionSettings, setOptionSettings] = useRecoilState(store.optionSettingsFamily(index));

  return useMemo(
    () => ({
      newConversation,
      conversation,
      setConversation,
      isSubmitting,
      setIsSubmitting,
      getMessages,
      setMessages,
      setSiblingIdx,
      latestMessageId,
      latestMessageDepth,
      setLatestMessage,
      resetLatestMessage,
      ask,
      index,
      regenerate,
      stopGenerating,
      handleStopGenerating,
      handleRegenerate,
      handleContinue,
      canSteerGeneration,
      steerGeneration,
      showPopover,
      setShowPopover,
      abortScroll,
      setAbortScroll,
      preset,
      setPreset,
      optionSettings,
      setOptionSettings,
      files,
      setFiles,
      filesLoading,
      setFilesLoading,
    }),
    [
      newConversation,
      conversation,
      setConversation,
      isSubmitting,
      setIsSubmitting,
      getMessages,
      setMessages,
      setSiblingIdx,
      latestMessageId,
      latestMessageDepth,
      setLatestMessage,
      resetLatestMessage,
      ask,
      index,
      regenerate,
      stopGenerating,
      handleStopGenerating,
      handleRegenerate,
      handleContinue,
      canSteerGeneration,
      steerGeneration,
      showPopover,
      setShowPopover,
      abortScroll,
      setAbortScroll,
      preset,
      setPreset,
      optionSettings,
      setOptionSettings,
      files,
      setFiles,
      filesLoading,
      setFilesLoading,
    ],
  );
}
