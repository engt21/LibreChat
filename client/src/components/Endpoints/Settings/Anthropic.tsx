import { useMemo } from 'react';
import { getSettingsKeys, getDefaultParamsEndpoint } from 'librechat-data-provider';
import type { SettingDefinition } from 'librechat-data-provider';
import type { TModelSelectProps } from '~/common';
import { useGetEndpointsQuery } from '~/data-provider';
import { componentMapping } from '~/components/SidePanel/Parameters/components';
import { presetSettings } from 'librechat-data-provider';

export default function AnthropicSettings({
  conversation,
  setOption,
  models,
  readonly,
}: TModelSelectProps) {
  const { data: endpointsConfig } = useGetEndpointsQuery();

  const parameters = useMemo(() => {
    const settingsEndpoint =
      getDefaultParamsEndpoint(endpointsConfig, conversation?.endpoint ?? '') ??
      conversation?.endpointType ??
      conversation?.endpoint ??
      '';
    const [combinedKey, endpointKey] = getSettingsKeys(settingsEndpoint, conversation?.model ?? '');
    return presetSettings[combinedKey] ?? presetSettings[endpointKey];
  }, [conversation, endpointsConfig]);

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

    const props = {
      key,
      settingKey: key,
      defaultValue,
      ...rest,
      readonly,
      setOption,
      conversation,
    };

    if (key === 'model') {
      return <Component {...props} options={models} />;
    }

    return <Component {...props} />;
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
