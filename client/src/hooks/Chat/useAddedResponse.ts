import { useCallback } from 'react';
import { useRecoilCallback, useRecoilValue } from 'recoil';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import {
  getEndpointField,
  LocalStorageKeys,
  isAssistantsEndpoint,
  getDefaultParamsEndpoint,
} from 'librechat-data-provider';
import type { TEndpointsConfig, EModelEndpoint, TConversation } from 'librechat-data-provider';
import type { RecoilValue } from 'recoil';
import type { AssistantListItem, NewConversationParams } from '~/common';
import useAssistantListMap from '~/hooks/Assistants/useAssistantListMap';
import { buildDefaultConvo, getDefaultEndpoint } from '~/utils';
import { useGetEndpointsQuery } from '~/data-provider';
import { mainTextareaId } from '~/common';
import store from '~/store';

const FIRST_ADDED_INDEX = 1;

type RecoilSnapshotLike = {
  getLoadable: <T>(value: RecoilValue<T>) => { getValue: () => T };
};

const getNextAddedIndex = (snapshot: RecoilSnapshotLike) => {
  const keys = snapshot.getLoadable<(string | number)[]>(store.conversationKeysAtom).getValue();
  const usedIndexes = new Set<number>();

  for (const key of keys) {
    const numericKey = Number(key);
    if (!Number.isInteger(numericKey) || numericKey < FIRST_ADDED_INDEX) {
      continue;
    }

    const conversation = snapshot
      .getLoadable<TConversation | null>(store.conversationByKeySelector(key))
      .getValue();
    if (conversation) {
      usedIndexes.add(numericKey);
    }
  }

  let nextIndex = FIRST_ADDED_INDEX;
  while (usedIndexes.has(nextIndex)) {
    nextIndex += 1;
  }

  return nextIndex;
};

/**
 * Simplified hook for added conversation state.
 * Provides just the conversation state and a function to generate a new conversation,
 * mirroring the pattern from useNewConvo.
 */
export default function useAddedResponse() {
  const modelsQuery = useGetModelsQuery();
  const assistantsListMap = useAssistantListMap();
  const rootConvo = useRecoilValue(store.conversationByKeySelector(0));
  const { data: endpointsConfig = {} as TEndpointsConfig } = useGetEndpointsQuery();
  const entries = useRecoilValue(store.addedConversationsSelector);
  const conversation = entries[0]?.conversation ?? null;
  const conversations = entries.map((entry) => entry.conversation);

  const buildAddedConversation = useCallback(
    ({ template = {}, preset, modelsData }: NewConversationParams = {}) => {
      let newConversation: TConversation = {
        conversationId: rootConvo?.conversationId ?? 'new',
        title: '',
        endpoint: null,
        ...template,
        createdAt: '',
        updatedAt: '',
      } as TConversation;

      const modelsConfig = modelsData ?? modelsQuery.data;
      const activePreset = preset ?? newConversation;

      const defaultEndpoint = getDefaultEndpoint({
        convoSetup: activePreset,
        endpointsConfig,
      });

      const endpointType = getEndpointField(endpointsConfig, defaultEndpoint, 'type');
      if (!newConversation.endpointType && endpointType) {
        newConversation.endpointType = endpointType;
      } else if (newConversation.endpointType && !endpointType) {
        newConversation.endpointType = undefined;
      }

      const isAssistantEndpoint = isAssistantsEndpoint(defaultEndpoint);
      const assistants: AssistantListItem[] = assistantsListMap[defaultEndpoint ?? ''] ?? [];

      if (
        newConversation.assistant_id &&
        !assistantsListMap[defaultEndpoint ?? '']?.[newConversation.assistant_id]
      ) {
        newConversation.assistant_id = undefined;
      }

      if (!newConversation.assistant_id && isAssistantEndpoint) {
        newConversation.assistant_id =
          localStorage.getItem(`${LocalStorageKeys.ASST_ID_PREFIX}0${defaultEndpoint}`) ??
          assistants[0]?.id;
      }

      if (
        newConversation.assistant_id != null &&
        isAssistantEndpoint &&
        newConversation.conversationId === 'new'
      ) {
        const assistant = assistants.find((asst) => asst.id === newConversation.assistant_id);
        newConversation.model = assistant?.model;
      }

      if (newConversation.assistant_id != null && !isAssistantEndpoint) {
        newConversation.assistant_id = undefined;
      }

      const models = modelsConfig?.[defaultEndpoint ?? ''] ?? [];
      const defaultParamsEndpoint = getDefaultParamsEndpoint(endpointsConfig, defaultEndpoint);
      newConversation = buildDefaultConvo({
        conversation: newConversation,
        lastConversationSetup: preset as TConversation,
        endpoint: defaultEndpoint ?? ('' as EModelEndpoint),
        models,
        defaultParamsEndpoint,
      });

      if (preset?.title != null && preset.title !== '') {
        newConversation.title = preset.title;
      }

      return newConversation;
    },
    [assistantsListMap, endpointsConfig, modelsQuery.data, rootConvo?.conversationId],
  );

  /**
   * Generate a new conversation based on template and preset.
   * Mirrors the logic from useNewConvo's switchToConversation.
   */
  const generateConversation = useRecoilCallback(
    ({ set, snapshot }) =>
      (params: NewConversationParams = {}) => {
        const newConversation = buildAddedConversation(params);
        const nextIndex = getNextAddedIndex(snapshot);

        set(store.conversationKeysAtom, (prevKeys) =>
          prevKeys.includes(nextIndex) ? prevKeys : [...prevKeys, nextIndex],
        );
        set(store.conversationByIndex(nextIndex), newConversation);

        setTimeout(() => {
          const textarea = document.getElementById(mainTextareaId);
          if (textarea) {
            textarea.focus();
          }
        }, 150);

        return newConversation;
      },
    [buildAddedConversation],
  );

  const setConversation = useRecoilCallback(
    ({ set, snapshot }) =>
      (value: TConversation | null | ((current: TConversation | null) => TConversation | null)) => {
        const targetIndex = entries[0]?.index ?? getNextAddedIndex(snapshot);
        const previousConversation =
          entries[0]?.conversation ??
          snapshot
            .getLoadable<TConversation | null>(store.conversationByKeySelector(targetIndex))
            .getValue();
        const nextConversation =
          typeof value === 'function' ? value(previousConversation ?? null) : value;

        set(store.conversationKeysAtom, (prevKeys) =>
          prevKeys.includes(targetIndex) ? prevKeys : [...prevKeys, targetIndex],
        );
        set(store.conversationByIndex(targetIndex), nextConversation);
      },
    [entries],
  );

  const setConversationAtIndex = useRecoilCallback(
    ({ set }) =>
      (targetIndex: string | number, value: TConversation | null) => {
        set(store.conversationKeysAtom, (prevKeys) =>
          prevKeys.includes(targetIndex) ? prevKeys : [...prevKeys, targetIndex],
        );
        set(store.conversationByIndex(targetIndex), value);
      },
    [],
  );

  const removeConversation = useRecoilCallback(
    ({ reset, set }) =>
      (targetIndex: string | number) => {
        reset(store.conversationByIndex(targetIndex));
        set(store.conversationKeysAtom, (prevKeys) =>
          prevKeys.filter((key) => String(key) !== String(targetIndex)),
        );
        reset(store.latestMessageFamily(targetIndex));
        reset(store.submissionByIndex(targetIndex));
    },
    [],
  );

  return {
    conversation,
    conversations,
    entries,
    setConversation,
    setConversationAtIndex,
    removeConversation,
    generateConversation,
  };
}
