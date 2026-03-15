import { useMemo } from 'react';
import {
  getSettingsKeys,
  presetSettings,
  normalizeGoogleModelName,
  getGoogleModelCapabilities as resolveGoogleModelCapabilities,
  getGoogleSettingCapabilityState,
} from 'librechat-data-provider';
import type { SettingDefinition } from 'librechat-data-provider';
import type { TModelSelectProps } from '~/common';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';
import type { TranslationKeys } from '~/hooks';
import { componentMapping } from '~/components/SidePanel/Parameters/components';

export default function GoogleSettings({
  conversation,
  setOption,
  models,
  readonly,
}: TModelSelectProps) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const normalizedModel = normalizeGoogleModelName(conversation?.model ?? '');

  const modelCapabilities = useMemo(
    () =>
      resolveGoogleModelCapabilities(
        normalizedModel,
        startupConfig?.googleModelCapabilities?.[normalizedModel],
      ),
    [normalizedModel, startupConfig?.googleModelCapabilities],
  );

  const parameters = useMemo(() => {
    const [combinedKey, endpointKey] = getSettingsKeys(
      conversation?.endpointType ?? conversation?.endpoint ?? '',
      conversation?.model ?? '',
    );

    const baseParameters = presetSettings[combinedKey] ?? presetSettings[endpointKey];

    if (!baseParameters) {
      return null;
    }

    const mapSetting = (setting: SettingDefinition) => {
      const capabilityState = getGoogleSettingCapabilityState(setting.key, modelCapabilities);

      const nextSetting: SettingDefinition = { ...setting };

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

      if (setting.key === 'temperature') {
        nextSetting.default = modelCapabilities.temperatureDefault;
        if (setting.range) {
          nextSetting.range = {
            ...setting.range,
            max: modelCapabilities.temperatureMax,
          };
        }
      } else if (setting.key === 'topP') {
        nextSetting.default = modelCapabilities.topPDefault;
      } else if (setting.key === 'topK') {
        nextSetting.default = modelCapabilities.topKDefault;
        if (setting.range) {
          nextSetting.range = {
            ...setting.range,
            max: modelCapabilities.topKMax,
          };
        }
      } else if (setting.key === 'maxOutputTokens') {
        nextSetting.default = modelCapabilities.maxOutputTokensDefault;
        if (setting.range) {
          nextSetting.range = {
            ...setting.range,
            max: modelCapabilities.maxOutputTokensMax,
          };
        }
      }

      return nextSetting;
    };

    return {
      col1: baseParameters.col1.map(mapSetting),
      col2: baseParameters.col2.map(mapSetting),
    };
  }, [conversation, localize, modelCapabilities]);

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
    const capabilityState = getGoogleSettingCapabilityState(key, modelCapabilities);
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
