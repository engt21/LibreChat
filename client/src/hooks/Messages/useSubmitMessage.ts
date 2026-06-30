import { useCallback } from 'react';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import { Constants, replaceSpecialVars } from 'librechat-data-provider';
import { useChatContext, useChatFormContext, useAddedChatContext } from '~/Providers';
import { useAuthContext } from '~/hooks/AuthContext';
import { mainTextareaId } from '~/common';
import { setDraft } from '~/utils';
import store from '~/store';

export default function useSubmitMessage() {
  const { user } = useAuthContext();
  const methods = useChatFormContext();
  const { conversation: addedConvo, conversations: addedConvos } = useAddedChatContext();
  const {
    ask,
    index,
    conversation,
    getMessages,
    setMessages,
    canSteerGeneration,
    steerGeneration,
  } = useChatContext();
  const latestMessage = useRecoilValue(store.latestMessageFamily(index));

  const autoSendPrompts = useRecoilValue(store.autoSendPrompts);
  const setActivePrompt = useSetRecoilState(store.activePromptByIndex(index));

  const clearMessageInput = useCallback(
    (conversationId?: string | null) => {
      methods.reset({ text: '' });
      methods.setValue('text', '', { shouldValidate: true });
      setDraft({ id: `${Constants.PENDING_CONVO}`, value: '' });
      setDraft({ id: `${Constants.NEW_CONVO}`, value: '' });
      if (conversationId && conversationId !== Constants.NEW_CONVO) {
        setDraft({ id: conversationId, value: '' });
      }

      const textarea = document.getElementById(mainTextareaId) as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.value = '';
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    [methods],
  );

  const submitMessage = useCallback(
    (data?: { text: string }) => {
      if (!data) {
        return console.warn('No data provided to submitMessage');
      }
      const rootMessages = getMessages();
      const isLatestInRootMessages = rootMessages?.some(
        (message) => message.messageId === latestMessage?.messageId,
      );
      if (!isLatestInRootMessages && latestMessage) {
        setMessages([...(rootMessages || []), latestMessage]);
      }

      if (canSteerGeneration) {
        if (steerGeneration(data.text)) {
          clearMessageInput(latestMessage?.conversationId ?? conversation?.conversationId);
        }
        return;
      }

      ask(
        {
          text: data.text,
        },
        {
          addedConvo: addedConvo ?? undefined,
          addedConvos: addedConvos.length > 0 ? addedConvos : undefined,
        },
      );
      clearMessageInput(conversation?.conversationId);
    },
    [
      ask,
      clearMessageInput,
      addedConvo,
      addedConvos,
      setMessages,
      getMessages,
      latestMessage,
      conversation?.conversationId,
      canSteerGeneration,
      steerGeneration,
    ],
  );

  const submitPrompt = useCallback(
    (text: string) => {
      const parsedText = replaceSpecialVars({ text, user });
      if (autoSendPrompts) {
        submitMessage({ text: parsedText });
        return;
      }

      const currentText = methods.getValues('text');
      const newText = currentText.trim().length > 1 ? `\n${parsedText}` : parsedText;
      setActivePrompt(newText);
    },
    [autoSendPrompts, submitMessage, setActivePrompt, methods, user],
  );

  return { submitMessage, submitPrompt };
}
