import { useMemo } from 'react';
import {
  getSettingsKeys,
  presetSettings,
  getDefaultParamsEndpoint,
  normalizeOpenAIModelName,
  getOpenAIModelCapabilities as resolveOpenAIModelCapabilities,
  getOpenAISettingCapabilityState,
  resolveOpenAIResponsesApiEnabled,
} from 'librechat-data-provider';
import type { SettingDefinition } from 'librechat-data-provider';
import type { TModelSelectProps } from '~/common';
import { useGetEndpointsQuery } from '~/data-provider';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import { componentMapping } from '~/components/SidePanel/Parameters/components';

export default function OpenAISettings({
  conversation,
  setOption,
  models,
  readonly,
}: TModelSelectProps) {
  const localize = useLocalize();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const provider = conversation?.endpoint ?? '';
  const settingsEndpoint =
    getDefaultParamsEndpoint(endpointsConfig, provider) ?? conversation?.endpointType ?? provider;
  const normalizedModel = normalizeOpenAIModelName(conversation?.model ?? '');

  const modelCapabilities = useMemo(
    () => resolveOpenAIModelCapabilities(normalizedModel),
    [normalizedModel],
  );
  const responsesApiEnabled = resolveOpenAIResponsesApiEnabled(modelCapabilities, {
    useResponsesApi: conversation?.useResponsesApi,
    endpoint: provider,
  });

  const parameters = useMemo(() => {
    const [combinedKey, endpointKey] = getSettingsKeys(settingsEndpoint, conversation?.model ?? '');
    const baseParameters = presetSettings[combinedKey] ?? presetSettings[endpointKey];

    if (!baseParameters) {
      return null;
    }

    const mapSetting = (setting: SettingDefinition) => {
      const capabilityState = getOpenAISettingCapabilityState(setting.key, modelCapabilities, {
        useResponsesApi: responsesApiEnabled,
        endpoint: provider,
        reasoningEffort: conversation?.reasoning_effort,
      });

      const nextSetting: SettingDefinition = { ...setting };

      if (
        setting.key === 'reasoning_effort' &&
        modelCapabilities.reasoningEffortOptions.length > 0
      ) {
        nextSetting.options = modelCapabilities.reasoningEffortOptions;

        if (setting.enumMappings) {
          nextSetting.enumMappings = modelCapabilities.reasoningEffortOptions.reduce<
            Record<string, string | number | boolean>
          >((acc, option) => {
            const mapping = setting.enumMappings?.[option];

            if (mapping != null) {
              acc[option] = mapping;
            }

            return acc;
          }, {});
        }
      }

      if (!capabilityState.supported) {
        let baseDescription = '';

        if (setting.description) {
          baseDescription = setting.descriptionCode
            ? (localize(setting.description as TranslationKeys) ?? setting.description)
            : setting.description;
        }

        nextSetting.description = [capabilityState.reason, baseDescription]
          .filter(Boolean)
          .join('\n\n');
        nextSetting.descriptionCode = false;
      }

      return nextSetting;
    };

    return {
      col1: baseParameters.col1.map(mapSetting),
      col2: baseParameters.col2.map(mapSetting),
    };
  }, [
    conversation?.model,
    conversation?.reasoning_effort,
    localize,
    modelCapabilities,
    provider,
    responsesApiEnabled,
    settingsEndpoint,
  ]);

  if (!parameters) {
    return null;
  }

  const renderComponent = (setting: SettingDefinition | undefined) => {
    if (!setting) {
      return null;
    }
    const Component = componentMapping[setting.component];
    if (!Component) {
      return null;
    }
    const { key, default: settingDefaultValue, ...rest } = setting;
    const defaultValue =
      key === 'useResponsesApi'
        ? resolveOpenAIResponsesApiEnabled(modelCapabilities, { endpoint: provider })
        : settingDefaultValue;
    const capabilityState = getOpenAISettingCapabilityState(key, modelCapabilities, {
      useResponsesApi: responsesApiEnabled,
      endpoint: provider,
      reasoningEffort: conversation?.reasoning_effort,
    });

    const props = {
      settingKey: key,
      defaultValue,
      ...rest,
      readonly: readonly || !capabilityState.supported,
      setOption,
      conversation,
    };

    if (key === 'model') {
      return <Component key={key} {...props} options={models} />;
    }

    return <Component key={key} {...props} />;
  };

  return (
    <div className="h-auto max-w-full overflow-x-hidden p-3">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-5">
        <div className="flex flex-col gap-6 md:col-span-3">
          {parameters.col1.map(renderComponent)}
        </div>
        <div className="flex flex-col gap-6 md:col-span-2">
          {parameters.col2.map(renderComponent)}
        </div>
      </div>
    </div>
  );
}
