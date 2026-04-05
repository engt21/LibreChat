import { useMemo } from 'react';
import {
  getSettingsKeys,
  presetSettings,
  getDefaultParamsEndpoint,
  normalizeXAIModelName,
  getXAIModelCapabilities as resolveXAIModelCapabilities,
  getXAISettingCapabilityState,
} from 'librechat-data-provider';
import type { SettingDefinition } from 'librechat-data-provider';
import type { TModelSelectProps } from '~/common';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import { componentMapping } from '~/components/SidePanel/Parameters/components';

export default function XAISettings({
  conversation,
  setOption,
  models,
  readonly,
}: TModelSelectProps) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const provider = conversation?.endpoint ?? '';
  const settingsEndpoint =
    getDefaultParamsEndpoint(endpointsConfig, provider) ?? conversation?.endpointType ?? provider;
  const normalizedModel = normalizeXAIModelName(conversation?.model ?? '');

  const modelCapabilities = useMemo(() => {
    const endpointCapabilities = startupConfig?.xaiModelCapabilities?.[provider] ?? {};

    return resolveXAIModelCapabilities(
      normalizedModel,
      endpointCapabilities[normalizedModel] ?? null,
    );
  }, [normalizedModel, provider, startupConfig?.xaiModelCapabilities]);

  const parameters = useMemo(() => {
    const [combinedKey, endpointKey] = getSettingsKeys(settingsEndpoint, conversation?.model ?? '');
    const baseParameters = presetSettings[combinedKey] ?? presetSettings[endpointKey];

    if (!baseParameters) {
      return null;
    }

    const mapSetting = (setting: SettingDefinition) => {
      const capabilityState = getXAISettingCapabilityState(setting.key, modelCapabilities);

      if (capabilityState.supported) {
        return setting;
      }

      let baseDescription = '';

      if (setting.description) {
        baseDescription = setting.descriptionCode
          ? (localize(setting.description as TranslationKeys) ?? setting.description)
          : setting.description;
      }

      return {
        ...setting,
        description: [capabilityState.reason, baseDescription].filter(Boolean).join('\n\n'),
        descriptionCode: false,
      } satisfies SettingDefinition;
    };

    return {
      col1: baseParameters.col1.map(mapSetting),
      col2: baseParameters.col2.map(mapSetting),
    };
  }, [conversation?.model, localize, modelCapabilities, settingsEndpoint]);

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

    const { key, default: defaultValue, ...rest } = setting;
    const capabilityState = getXAISettingCapabilityState(key, modelCapabilities);
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
