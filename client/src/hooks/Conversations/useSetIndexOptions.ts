import {
  Constants,
  TPreset,
  TConversation,
  EModelEndpoint,
  KnownEndpoints,
  WebSearchModes,
  tConvoUpdateSchema,
} from 'librechat-data-provider';
import { useSetRecoilState } from 'recoil';
import type { TSetExample, TSetOption, TSetOptionsPayload } from '~/common';
import usePresetIndexOptions from './usePresetIndexOptions';
import { useChatContext } from '~/Providers/ChatContext';
import { ephemeralAgentByConvoId } from '~/store';

type TUseSetOptions = (preset?: TPreset | boolean | null) => TSetOptionsPayload;

const anthropicEphemeralOptionKeys = new Set([
  'web_fetch',
  'anthropic_code_execution',
  'anthropic_advisor',
  'anthropic_advisor_model',
  'fast_mode',
]);

const useSetIndexOptions: TUseSetOptions = (preset = false) => {
  const { conversation, setConversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? Constants.NEW_CONVO;
  const setEphemeralAgent = useSetRecoilState(ephemeralAgentByConvoId(conversationId));

  const result = usePresetIndexOptions(preset);

  if (result && typeof result !== 'boolean') {
    return result;
  }

  const setOption: TSetOption = (param) => (newValue) => {
    const update = {};
    update[param] = newValue;
    const currentEndpoint = conversation?.endpoint;
    const isOllamaEndpoint =
      typeof currentEndpoint === 'string' &&
      currentEndpoint.toLowerCase().startsWith(KnownEndpoints.ollama);
    const isAnthropicEndpoint = currentEndpoint === EModelEndpoint.anthropic;

    if (param === 'presetOverride') {
      const currentOverride = conversation?.presetOverride || {};
      update['presetOverride'] = {
        ...currentOverride,
        ...(newValue as unknown as Partial<TPreset>),
      };
    }

    // Auto-enable Responses API when web search is enabled (only for OpenAI/Azure/Custom endpoints)
    if (param === 'web_search' && newValue === true) {
      const isOpenAICompatible =
        currentEndpoint === EModelEndpoint.openAI ||
        currentEndpoint === EModelEndpoint.azureOpenAI ||
        currentEndpoint === EModelEndpoint.custom;

      if (isOpenAICompatible) {
        const currentUseResponsesApi = conversation?.useResponsesApi ?? false;
        if (!currentUseResponsesApi) {
          update['useResponsesApi'] = true;
        }
      }
    }

    // Sync web_search sidebar toggle to ephemeralAgent so chat bar badges stay in sync
    if (param === 'web_search') {
      setEphemeralAgent((prevAgent) => ({
        ...(prevAgent ?? {}),
        web_search: newValue === true,
        ...(isOllamaEndpoint && newValue === true
          ? { web_search_mode: prevAgent?.web_search_mode ?? WebSearchModes.ollama_native }
          : {}),
      }));
    }

    if (
      isAnthropicEndpoint &&
      typeof param === 'string' &&
      anthropicEphemeralOptionKeys.has(param)
    ) {
      setEphemeralAgent((prevAgent) => ({
        ...(prevAgent ?? {}),
        [param]: newValue,
      }));
    }

    setConversation(
      (prevState) =>
        tConvoUpdateSchema.parse({
          ...prevState,
          ...update,
        }) as TConversation,
    );
  };

  const setExample: TSetExample = (i, type, newValue = null) => {
    const update = {};
    const current = conversation?.examples?.slice() || [];
    const currentExample = { ...current[i] };
    currentExample[type] = { content: newValue };
    current[i] = currentExample;
    update['examples'] = current;
    setConversation(
      (prevState) =>
        tConvoUpdateSchema.parse({
          ...prevState,
          ...update,
        }) as TConversation,
    );
  };

  const addExample: () => void = () => {
    const update = {};
    const current = conversation?.examples?.slice() || [];
    current.push({ input: { content: '' }, output: { content: '' } });
    update['examples'] = current;
    setConversation(
      (prevState) =>
        tConvoUpdateSchema.parse({
          ...prevState,
          ...update,
        }) as TConversation,
    );
  };

  const removeExample: () => void = () => {
    const update = {};
    const current = conversation?.examples?.slice() || [];
    if (current.length <= 1) {
      update['examples'] = [{ input: { content: '' }, output: { content: '' } }];
      setConversation(
        (prevState) =>
          tConvoUpdateSchema.parse({
            ...prevState,
            ...update,
          }) as TConversation,
      );
      return;
    }
    current.pop();
    update['examples'] = current;
    setConversation(
      (prevState) =>
        tConvoUpdateSchema.parse({
          ...prevState,
          ...update,
        }) as TConversation,
    );
  };

  return {
    setOption,
    setExample,
    addExample,
    removeExample,
  };
};

export default useSetIndexOptions;
