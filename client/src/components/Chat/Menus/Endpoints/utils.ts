import React from 'react';
import { Bot } from 'lucide-react';
import { EModelEndpoint, isAgentsEndpoint, isAssistantsEndpoint } from 'librechat-data-provider';
import type {
  TModelSpec,
  TAgentsMap,
  TAssistantsMap,
  TEndpointsConfig,
} from 'librechat-data-provider';
import type { useLocalize } from '~/hooks';
import SpecIcon from '~/components/Chat/Menus/Endpoints/components/SpecIcon';
import { Endpoint, SelectedValues } from '~/common';

export function isDeepResearchModelSpec(spec: TModelSpec): boolean {
  const identity = `${spec.name ?? ''} ${spec.label ?? ''}`.toLowerCase();
  return /\bdeep[\s_-]*research\b/u.test(identity);
}

const modelPickerProviderOrder = [
  EModelEndpoint.openAI,
  EModelEndpoint.anthropic,
  EModelEndpoint.azureOpenAI,
  EModelEndpoint.google,
];

export function sortModelPickerEndpoints(endpoints: Endpoint[]): Endpoint[] {
  const getRank = (endpoint: Endpoint) => {
    const exactRank = modelPickerProviderOrder.indexOf(endpoint.value as EModelEndpoint);
    if (exactRank !== -1) {
      return exactRank;
    }

    const identity = `${endpoint.value} ${endpoint.label}`.toLowerCase();
    if (identity.includes('google') || identity.includes('gemini') || identity.includes('vertex')) {
      return 3;
    }
    if (identity.includes('xai') || identity.includes('x.ai') || identity.includes('grok')) {
      return 4;
    }
    if (identity.includes('ollama')) {
      return 5;
    }
    return 100;
  };

  return [...endpoints].sort((left, right) => {
    const rankDifference = getRank(left) - getRank(right);
    if (rankDifference !== 0) {
      return rankDifference;
    }
    return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' });
  });
}

export function isOpenAIAlphaModel(model: string | null | undefined): boolean {
  return typeof model === 'string' && model.toLowerCase().includes('-alpha');
}

export function partitionOpenAIModelsForDisplay(endpoint: Endpoint, models: string[]) {
  if (endpoint.value !== EModelEndpoint.openAI) {
    return { standardModels: models, alphaModels: [] };
  }

  return models.reduce(
    (acc, model) => {
      if (isOpenAIAlphaModel(model)) {
        acc.alphaModels.push(model);
      } else {
        acc.standardModels.push(model);
      }
      return acc;
    },
    { standardModels: [] as string[], alphaModels: [] as string[] },
  );
}

export function filterItems<
  T extends {
    label: string;
    name?: string;
    value?: string;
    models?: Array<{ name: string; isGlobal?: boolean }>;
  },
>(
  items: T[],
  searchValue: string,
  agentsMap: TAgentsMap | undefined,
  assistantsMap: TAssistantsMap | undefined,
): T[] | null {
  const searchTermLower = searchValue.trim().toLowerCase();
  if (!searchTermLower) {
    return null;
  }

  return items.filter((item) => {
    const itemMatches =
      item.label.toLowerCase().includes(searchTermLower) ||
      (item.name && item.name.toLowerCase().includes(searchTermLower)) ||
      (item.value && item.value.toLowerCase().includes(searchTermLower));

    if (itemMatches) {
      return true;
    }

    if (item.models && item.models.length > 0) {
      return item.models.some((modelId) => {
        if (modelId.name.toLowerCase().includes(searchTermLower)) {
          return true;
        }

        if (isAgentsEndpoint(item.value) && agentsMap && modelId.name in agentsMap) {
          const agentName = agentsMap[modelId.name]?.name;
          return typeof agentName === 'string' && agentName.toLowerCase().includes(searchTermLower);
        }

        if (isAssistantsEndpoint(item.value) && assistantsMap) {
          const endpoint = item.value ?? '';
          const assistant = assistantsMap[endpoint][modelId.name];
          if (assistant && typeof assistant.name === 'string') {
            return assistant.name.toLowerCase().includes(searchTermLower);
          }
          return false;
        }

        return false;
      });
    }

    return false;
  });
}

export function filterModels(
  endpoint: Endpoint,
  models: string[],
  searchValue: string,
  agentsMap: TAgentsMap | undefined,
  assistantsMap: TAssistantsMap | undefined,
): string[] {
  const searchTermLower = searchValue.trim().toLowerCase();
  if (!searchTermLower) {
    return models;
  }

  return models.filter((modelId) => {
    let modelName = modelId;

    if (isAgentsEndpoint(endpoint.value) && agentsMap && agentsMap[modelId]) {
      modelName = agentsMap[modelId]?.name || modelId;
    } else if (
      isAssistantsEndpoint(endpoint.value) &&
      assistantsMap &&
      assistantsMap[endpoint.value]
    ) {
      const assistant = assistantsMap[endpoint.value][modelId];
      modelName =
        typeof assistant.name === 'string' && assistant.name ? (assistant.name as string) : modelId;
    }

    return modelName.toLowerCase().includes(searchTermLower);
  });
}

export function getSelectedIcon({
  mappedEndpoints,
  selectedValues,
  modelSpecs,
  endpointsConfig,
}: {
  mappedEndpoints: Endpoint[];
  selectedValues: SelectedValues;
  modelSpecs: TModelSpec[];
  endpointsConfig: TEndpointsConfig;
}): React.ReactNode | null {
  const { endpoint, model, modelSpec } = selectedValues;

  if (modelSpec) {
    const spec = modelSpecs.find((s) => s.name === modelSpec);
    if (!spec) {
      return null;
    }
    const { showIconInHeader = true } = spec;
    if (!showIconInHeader) {
      return null;
    }
    return React.createElement(SpecIcon, {
      currentSpec: spec,
      endpointsConfig,
    });
  }

  if (endpoint && model) {
    const selectedEndpoint = mappedEndpoints.find((e) => e.value === endpoint);
    if (!selectedEndpoint) {
      return null;
    }

    if (selectedEndpoint.modelIcons?.[model]) {
      const iconUrl = selectedEndpoint.modelIcons[model];
      return React.createElement(
        'div',
        { className: 'h-5 w-5 overflow-hidden rounded-full' },
        React.createElement('img', {
          src: iconUrl,
          alt: model,
          className: 'h-full w-full object-cover',
        }),
      );
    }

    return (
      selectedEndpoint.icon ||
      React.createElement(Bot, {
        size: 20,
        className: 'icon-md shrink-0 text-text-primary',
      })
    );
  }

  if (endpoint) {
    const selectedEndpoint = mappedEndpoints.find((e) => e.value === endpoint);
    return selectedEndpoint?.icon || null;
  }

  return null;
}

export const getDisplayValue = ({
  localize,
  mappedEndpoints,
  selectedValues,
  modelSpecs,
  agentsMap,
}: {
  localize: ReturnType<typeof useLocalize>;
  selectedValues: SelectedValues;
  mappedEndpoints: Endpoint[];
  modelSpecs: TModelSpec[];
  agentsMap?: TAgentsMap;
}) => {
  if (selectedValues.modelSpec) {
    const spec = modelSpecs.find((s) => s.name === selectedValues.modelSpec);
    return spec?.label || spec?.name || localize('com_ui_select_model');
  }

  if (selectedValues.model && selectedValues.endpoint) {
    const endpoint = mappedEndpoints.find((e) => e.value === selectedValues.endpoint);
    if (!endpoint) {
      return localize('com_ui_select_model');
    }

    if (
      isAgentsEndpoint(endpoint.value) &&
      endpoint.agentNames &&
      endpoint.agentNames[selectedValues.model]
    ) {
      return endpoint.agentNames[selectedValues.model];
    } else if (isAgentsEndpoint(endpoint.value) && agentsMap) {
      const agent = agentsMap[selectedValues.model];
      return agent?.name || selectedValues.model;
    }

    if (
      isAssistantsEndpoint(endpoint.value) &&
      endpoint.assistantNames &&
      endpoint.assistantNames[selectedValues.model]
    ) {
      return endpoint.assistantNames[selectedValues.model];
    }

    return selectedValues.model;
  }

  if (selectedValues.endpoint) {
    const endpoint = mappedEndpoints.find((e) => e.value === selectedValues.endpoint);
    return endpoint?.label || localize('com_ui_select_model');
  }

  return localize('com_ui_select_model');
};
