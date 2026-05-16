import React, { useMemo, useState, useEffect, useCallback } from 'react';
import keyBy from 'lodash/keyBy';
import { RotateCcw } from 'lucide-react';
import {
  EModelEndpoint,
  excludedKeys,
  paramSettings,
  getSettingsKeys,
  getDefaultParamsEndpoint,
  getEndpointField,
  SettingDefinition,
  tConvoUpdateSchema,
  normalizeAnthropicModelName,
  normalizeGoogleModelName,
  normalizeOpenAIModelName,
  isXAIEndpointCandidate,
  getAnthropicModelCapabilities as resolveAnthropicModelCapabilities,
  getOpenAIModelCapabilities as resolveOpenAIModelCapabilities,
  getAnthropicSettingCapabilityState,
  getGoogleModelCapabilities as resolveGoogleModelCapabilities,
  getOpenAISettingCapabilityState,
  resolveOpenAIResponsesApiEnabled,
  getGoogleSettingCapabilityState,
  normalizeXAIModelName,
  getXAIModelCapabilities as resolveXAIModelCapabilities,
  getXAISettingCapabilityState,
} from 'librechat-data-provider';
import type { TPreset } from 'librechat-data-provider';
import { SaveAsPresetDialog } from '~/components/Endpoints';
import { useSetIndexOptions, useLocalize } from '~/hooks';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { componentMapping } from './components';
import { useChatContext } from '~/Providers';
import { logger } from '~/utils';

export default function Parameters() {
  const localize = useLocalize();
  const { conversation, setConversation } = useChatContext();
  const { setOption } = useSetIndexOptions();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [preset, setPreset] = useState<TPreset | null>(null);

  const { data: endpointsConfig = {} } = useGetEndpointsQuery();
  const { data: startupConfig } = useGetStartupConfig();
  const provider = conversation?.endpoint ?? '';
  const model = conversation?.model ?? '';

  const bedrockRegions = useMemo(() => {
    return endpointsConfig?.[conversation?.endpoint ?? '']?.availableRegions ?? [];
  }, [endpointsConfig, conversation?.endpoint]);

  const endpointType = useMemo(
    () => getEndpointField(endpointsConfig, conversation?.endpoint, 'type'),
    [conversation?.endpoint, endpointsConfig],
  );

  const defaultParamsEndpoint = useMemo(
    () => getDefaultParamsEndpoint(endpointsConfig, provider),
    [endpointsConfig, provider],
  );
  const settingsEndpoint = defaultParamsEndpoint ?? endpointType ?? provider;

  const xaiModelCapabilities = useMemo(() => {
    if (!isXAIEndpointCandidate({ endpoint: provider, defaultParamsEndpoint })) {
      return null;
    }

    const normalizedModel = normalizeXAIModelName(model);

    return resolveXAIModelCapabilities(
      normalizedModel,
      startupConfig?.xaiModelCapabilities?.[provider]?.[normalizedModel] ?? null,
    );
  }, [defaultParamsEndpoint, model, provider, startupConfig?.xaiModelCapabilities]);

  const googleModelCapabilities = useMemo(() => {
    if (settingsEndpoint !== EModelEndpoint.google) {
      return null;
    }

    const normalizedModel = normalizeGoogleModelName(model);

    return resolveGoogleModelCapabilities(
      normalizedModel,
      startupConfig?.googleModelCapabilities?.[normalizedModel],
    );
  }, [model, settingsEndpoint, startupConfig?.googleModelCapabilities]);

  const anthropicModelCapabilities = useMemo(() => {
    if (settingsEndpoint !== EModelEndpoint.anthropic) {
      return null;
    }

    const normalizedModel = normalizeAnthropicModelName(model);

    return resolveAnthropicModelCapabilities(
      normalizedModel,
      startupConfig?.anthropicModelCapabilities?.[normalizedModel],
    );
  }, [model, settingsEndpoint, startupConfig?.anthropicModelCapabilities]);

  const openAIModelCapabilities = useMemo(() => {
    if (
      xaiModelCapabilities != null ||
      settingsEndpoint === EModelEndpoint.google ||
      settingsEndpoint === EModelEndpoint.anthropic
    ) {
      return null;
    }

    return resolveOpenAIModelCapabilities(normalizeOpenAIModelName(model));
  }, [model, settingsEndpoint, xaiModelCapabilities]);

  const responsesApiEnabled = openAIModelCapabilities
    ? resolveOpenAIResponsesApiEnabled(openAIModelCapabilities, {
        useResponsesApi: conversation?.useResponsesApi,
        endpoint: provider,
      })
    : false;

  const parameters = useMemo((): SettingDefinition[] => {
    const customParams = endpointsConfig[provider]?.customParams ?? {};
    const [combinedKey, endpointKey] = getSettingsKeys(endpointType ?? provider, model);
    const overriddenEndpointKey = customParams.defaultParamsEndpoint ?? endpointKey;
    const defaultParams = paramSettings[combinedKey] ?? paramSettings[overriddenEndpointKey] ?? [];
    const overriddenParams = endpointsConfig[provider]?.customParams?.paramDefinitions ?? [];
    const overriddenParamsMap = keyBy(overriddenParams, 'key');
    return defaultParams
      .filter((param) => param != null)
      .map((param) => (overriddenParamsMap[param.key] as SettingDefinition) ?? param);
  }, [endpointType, endpointsConfig, model, provider]);

  const anthropicThinkingDefault = useMemo(() => {
    const thinkingSetting = parameters.find((setting) => setting?.key === 'thinking');
    return typeof thinkingSetting?.default === 'boolean' ? thinkingSetting.default : undefined;
  }, [parameters]);

  useEffect(() => {
    if (!parameters) {
      return;
    }

    // const defaultValueMap = new Map();
    // const paramKeys = new Set(
    //   parameters.map((setting) => {
    //     if (setting.default != null) {
    //       defaultValueMap.set(setting.key, setting.default);
    //     }
    //     return setting.key;
    //   }),
    // );
    const paramKeys = new Set(
      parameters.filter((setting) => setting != null).map((setting) => setting.key),
    );
    setConversation((prev) => {
      if (!prev) {
        return prev;
      }

      const updatedConversation = { ...prev };

      const conversationKeys = Object.keys(updatedConversation);
      const updatedKeys: string[] = [];
      conversationKeys.forEach((key) => {
        // const defaultValue = defaultValueMap.get(key);
        // if (paramKeys.has(key) && defaultValue != null && prev[key] != null) {
        //   updatedKeys.push(key);
        //   updatedConversation[key] = defaultValue;
        //   return;
        // }

        if (paramKeys.has(key)) {
          return;
        }

        if (excludedKeys.has(key)) {
          return;
        }

        if (prev[key] != null) {
          updatedKeys.push(key);
          delete updatedConversation[key];
        }
      });

      logger.log('parameters', 'parameters effect, updated keys:', updatedKeys);

      return updatedConversation;
    });
  }, [parameters, setConversation]);

  const resetParameters = useCallback(() => {
    setConversation((prev) => {
      if (!prev) {
        return prev;
      }

      const updatedConversation = { ...prev };
      const resetKeys: string[] = [];

      Object.keys(updatedConversation).forEach((key) => {
        if (excludedKeys.has(key)) {
          return;
        }

        if (updatedConversation[key] !== undefined) {
          resetKeys.push(key);
          delete updatedConversation[key];
        }
      });

      logger.log('parameters', 'parameters reset, affected keys:', resetKeys);
      return updatedConversation;
    });
  }, [setConversation]);

  const openDialog = useCallback(() => {
    const newPreset = tConvoUpdateSchema.parse({
      ...conversation,
    }) as TPreset;
    setPreset(newPreset);
    setIsDialogOpen(true);
  }, [conversation]);

  if (!parameters) {
    return null;
  }

  return (
    <div className="h-auto max-w-full overflow-x-hidden p-3">
      <div className="grid grid-cols-2 gap-4">
        {' '}
        {/* This is the parent element containing all settings */}
        {/* Below is an example of an applied dynamic setting, each be contained by a div with the column span specified */}
        {parameters.map((setting) => {
          const Component = componentMapping[setting.component];
          if (!Component) {
            return null;
          }
          const { key, default: settingDefaultValue, ...rest } = setting;
          const defaultValue =
            key === 'useResponsesApi' && openAIModelCapabilities
              ? resolveOpenAIResponsesApiEnabled(openAIModelCapabilities, { endpoint: provider })
              : settingDefaultValue;

          if (
            openAIModelCapabilities?.hasKnownCapabilities &&
            key === 'reasoning_effort' &&
            openAIModelCapabilities.reasoningEffortOptions.length > 0
          ) {
            rest.options = openAIModelCapabilities.reasoningEffortOptions;

            if (rest.enumMappings) {
              rest.enumMappings = openAIModelCapabilities.reasoningEffortOptions.reduce<
                Record<string, string | number | boolean>
              >((acc, option) => {
                const mapping = rest.enumMappings?.[option];

                if (mapping != null) {
                  acc[option] = mapping;
                }

                return acc;
              }, {});
            }
          }

          if (key === 'region' && bedrockRegions.length) {
            rest.options = bedrockRegions;
          }

          if (anthropicModelCapabilities && key === 'maxOutputTokens' && rest.range) {
            rest.range = {
              ...rest.range,
              max: anthropicModelCapabilities.maxOutputTokensMax,
            };
          }

          if (anthropicModelCapabilities && key === 'effort') {
            rest.options = anthropicModelCapabilities.effortOptions;

            if (rest.enumMappings) {
              rest.enumMappings = anthropicModelCapabilities.effortOptions.reduce<
                Record<string, string | number | boolean>
              >((acc, option) => {
                const mapping = rest.enumMappings?.[option];

                if (mapping != null) {
                  acc[option] = mapping;
                }

                return acc;
              }, {});
            }
          }

          let capabilityState: { supported: boolean; reason?: string } = { supported: true };

          if (anthropicModelCapabilities) {
            capabilityState = getAnthropicSettingCapabilityState(key, anthropicModelCapabilities, {
              thinking: conversation?.thinking,
              defaultThinking: anthropicThinkingDefault,
            });
          } else if (xaiModelCapabilities) {
            capabilityState = getXAISettingCapabilityState(key, xaiModelCapabilities);
          } else if (googleModelCapabilities) {
            capabilityState = getGoogleSettingCapabilityState(key, googleModelCapabilities);
          } else if (openAIModelCapabilities) {
            capabilityState = getOpenAISettingCapabilityState(key, openAIModelCapabilities, {
              useResponsesApi: responsesApiEnabled,
              endpoint: provider,
              reasoningEffort: conversation?.reasoning_effort,
            });
          }

          if (!capabilityState.supported) {
            let baseDescription = '';

            if (rest.description) {
              baseDescription = rest.descriptionCode
                ? (localize(rest.description as never) ?? rest.description)
                : rest.description;
            }

            rest.description = [capabilityState.reason, baseDescription]
              .filter(Boolean)
              .join('\n\n');
            rest.descriptionCode = false;
          }

          return (
            <Component
              key={key}
              settingKey={key}
              defaultValue={defaultValue}
              {...rest}
              readonly={!capabilityState.supported}
              setOption={setOption}
              conversation={conversation}
            />
          );
        })}
      </div>
      <div className="mt-4 flex justify-center">
        <button
          type="button"
          onClick={resetParameters}
          className="btn btn-neutral flex w-full items-center justify-center gap-2 px-4 py-2 text-sm"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          {localize('com_ui_reset_var', { 0: localize('com_ui_model_parameters') })}
        </button>
      </div>
      <div className="mt-2 flex justify-center">
        <button
          onClick={openDialog}
          className="btn btn-primary focus:shadow-outline flex w-full items-center justify-center px-4 py-2 font-semibold text-white hover:bg-green-600 focus:border-green-500"
          type="button"
        >
          {localize('com_endpoint_save_as_preset')}
        </button>
      </div>
      {preset && (
        <SaveAsPresetDialog open={isDialogOpen} onOpenChange={setIsDialogOpen} preset={preset} />
      )}
    </div>
  );
}
