import { useMemo } from 'react';
import { VisuallyHidden } from '@ariakit/react';
import { Spinner, TooltipAnchor } from '@librechat/client';
import { CheckCircle2, MousePointerClick } from 'lucide-react';
import {
  EModelEndpoint,
  getAnthropicQuickSelectModelNames,
  isAgentsEndpoint,
  isAssistantsEndpoint,
} from 'librechat-data-provider';
import type { TModelSpec } from 'librechat-data-provider';
import type { Endpoint } from '~/common';
import { useGetStartupConfig } from '~/data-provider';
import { CustomMenu as Menu, CustomMenuItem as MenuItem } from '../CustomMenu';
import { useModelSelectorContext } from '../ModelSelectorContext';
import { renderEndpointModels } from './EndpointModelItem';
import { EndpointSettingsButton, canShowEndpointSettingsButton } from './EndpointSettingsButton';
import { ModelSpecItem } from './ModelSpecItem';
import { filterModels, partitionOpenAIModelsForDisplay } from '../utils';
import { useLocalize } from '~/hooks';

interface EndpointItemProps {
  endpoint: Endpoint;
  endpointIndex: number;
}

/**
 * Lazily-rendered content for an endpoint submenu. By extracting this into a
 * separate component, the expensive model-list rendering (and per-item hooks
 * such as MutationObservers in EndpointModelItem) only runs when the submenu
 * is actually mounted — which Ariakit defers via `unmountOnHide`.
 */
function EndpointMenuContent({
  endpoint,
  endpointIndex,
}: {
  endpoint: Endpoint;
  endpointIndex: number;
}) {
  const localize = useLocalize();
  const { agentsMap, assistantsMap, modelSpecs, selectedValues, endpointSearchValues } =
    useModelSelectorContext();
  const { data: startupConfig } = useGetStartupConfig();
  const { modelSpec: selectedSpec } = selectedValues;
  const searchValue = endpointSearchValues[endpoint.value] || '';

  const endpointSpecs = useMemo(() => {
    if (!modelSpecs || !modelSpecs.length) {
      return [];
    }
    return modelSpecs.filter((spec: TModelSpec) => spec.group === endpoint.value);
  }, [modelSpecs, endpoint.value]);

  if (isAssistantsEndpoint(endpoint.value) && endpoint.models === undefined) {
    return (
      <div
        className="flex items-center justify-center p-2"
        role="status"
        aria-label={localize('com_ui_loading')}
      >
        <Spinner aria-hidden="true" />
      </div>
    );
  }

  const filteredModels = searchValue
    ? filterModels(
        endpoint,
        (endpoint.models || []).map((model) => model.name),
        searchValue,
        agentsMap,
        assistantsMap,
      )
    : null;
  const anthropicModelNames = endpoint.models?.map((model) => model.name) ?? [];
  const anthropicQuickSelectModels =
    !searchValue && endpoint.value === EModelEndpoint.anthropic
      ? getAnthropicQuickSelectModelNames(
          anthropicModelNames,
          startupConfig?.anthropicModelCapabilities,
          4,
        )
      : [];
  const remainingAnthropicModels =
    endpoint.value === EModelEndpoint.anthropic
      ? anthropicModelNames.filter((model) => !anthropicQuickSelectModels.includes(model))
      : [];
  const renderOpenAIModels = (modelNames: string[]) => {
    const { standardModels, alphaModels } = partitionOpenAIModelsForDisplay(endpoint, modelNames);

    return (
      <>
        {renderEndpointModels(endpoint, endpoint.models ?? [], standardModels, endpointIndex)}
        {alphaModels.length > 0 && (
          <Menu
            id={`${endpoint.value}-alpha-models-menu`}
            label={
              <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                {localize('com_endpoint_openai_alpha_models')}
              </span>
            }
          >
            {renderEndpointModels(endpoint, endpoint.models ?? [], alphaModels, endpointIndex)}
          </Menu>
        )}
      </>
    );
  };
  const renderModelContent = () => {
    if (filteredModels) {
      return endpoint.value === EModelEndpoint.openAI
        ? renderOpenAIModels(filteredModels)
        : renderEndpointModels(endpoint, endpoint.models || [], filteredModels, endpointIndex);
    }

    if (!endpoint.models) {
      return null;
    }

    if (endpoint.value === EModelEndpoint.anthropic) {
      return (
        <>
          {anthropicQuickSelectModels.length > 0 && (
            <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
              {localize('com_endpoint_quick_select')}
            </div>
          )}
          {renderEndpointModels(
            endpoint,
            endpoint.models,
            anthropicQuickSelectModels,
            endpointIndex,
          )}
          {remainingAnthropicModels.length > 0 && anthropicQuickSelectModels.length > 0 && (
            <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-text-secondary">
              {localize('com_endpoint_all_models')}
            </div>
          )}
          {renderEndpointModels(endpoint, endpoint.models, remainingAnthropicModels, endpointIndex)}
        </>
      );
    }

    if (endpoint.value === EModelEndpoint.openAI) {
      return renderOpenAIModels(endpoint.models.map((model) => model.name));
    }

    return renderEndpointModels(endpoint, endpoint.models, undefined, endpointIndex);
  };

  return (
    <>
      {endpointSpecs.map((spec: TModelSpec) => (
        <ModelSpecItem key={spec.name} spec={spec} isSelected={selectedSpec === spec.name} />
      ))}
      {renderModelContent()}
    </>
  );
}

export function EndpointItem({ endpoint, endpointIndex }: EndpointItemProps) {
  const localize = useLocalize();
  const {
    selectedValues,
    handleOpenKeyDialog,
    handleSelectEndpoint,
    endpointSearchValues,
    setEndpointSearchValue,
    isSuperAdmin,
  } = useModelSelectorContext();
  const { endpoint: selectedEndpoint, modelSpec: selectedSpec } = selectedValues;

  const searchValue = endpointSearchValues[endpoint.value] || '';

  const isAssistantsNotLoaded =
    isAssistantsEndpoint(endpoint.value) && endpoint.models === undefined;

  const renderIconLabel = () => (
    <div className="flex min-w-0 items-center gap-2">
      {endpoint.icon && (
        <div className="flex shrink-0 items-center justify-center" aria-hidden="true">
          {endpoint.icon}
        </div>
      )}
      <span className="truncate text-left">{endpoint.label}</span>
    </div>
  );

  const isEndpointSelected = !selectedSpec && selectedEndpoint === endpoint.value;
  const showSettingsButton = isSuperAdmin && canShowEndpointSettingsButton(endpoint);

  if (endpoint.hasModels) {
    const placeholder =
      isAgentsEndpoint(endpoint.value) || isAssistantsEndpoint(endpoint.value)
        ? localize('com_endpoint_search_var', { 0: endpoint.label })
        : localize('com_endpoint_search_endpoint_models', { 0: endpoint.label });
    return (
      <Menu
        id={`endpoint-${endpoint.value}-menu`}
        key={`endpoint-${endpoint.value}-item`}
        searchValue={searchValue}
        onSearch={(value) => setEndpointSearchValue(endpoint.value, value)}
        combobox={<input placeholder=" " />}
        comboboxLabel={placeholder}
        onClick={() => handleSelectEndpoint(endpoint)}
        label={
          <div className="group flex w-full min-w-0 items-center justify-between gap-1.5 py-1 text-sm">
            {renderIconLabel()}
            <div className="flex shrink-0 items-center gap-1">
              {showSettingsButton && (
                <EndpointSettingsButton
                  endpoint={endpoint}
                  handleOpenKeyDialog={handleOpenKeyDialog}
                />
              )}
              {isEndpointSelected && (
                <>
                  <CheckCircle2 className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
                  <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
                </>
              )}
            </div>
          </div>
        }
      >
        <EndpointMenuContent endpoint={endpoint} endpointIndex={endpointIndex} />
      </Menu>
    );
  } else {
    return (
      <MenuItem
        id={`endpoint-${endpoint.value}-menu`}
        key={`endpoint-${endpoint.value}-item`}
        onClick={() => handleSelectEndpoint(endpoint)}
        aria-selected={isEndpointSelected || undefined}
        className="group flex w-full cursor-pointer items-center justify-between gap-1.5 py-2 text-sm"
      >
        {renderIconLabel()}
        <div className="flex shrink-0 items-center gap-2">
          {showSettingsButton && (
            <EndpointSettingsButton endpoint={endpoint} handleOpenKeyDialog={handleOpenKeyDialog} />
          )}
          {isAssistantsNotLoaded && (
            <TooltipAnchor
              description={localize('com_ui_click_to_view_var', { 0: endpoint.label })}
              side="top"
              render={
                <span className="flex items-center">
                  <MousePointerClick className="size-4 text-text-secondary" aria-hidden="true" />
                </span>
              }
            />
          )}
          {isEndpointSelected && !isAssistantsNotLoaded && (
            <>
              <CheckCircle2 className="size-4 shrink-0 text-text-primary" aria-hidden="true" />
              <VisuallyHidden>{localize('com_a11y_selected')}</VisuallyHidden>
            </>
          )}
        </div>
      </MenuItem>
    );
  }
}

export function renderEndpoints(mappedEndpoints: Endpoint[]) {
  return mappedEndpoints
    .filter((endpoint) => !isAgentsEndpoint(endpoint.value))
    .map((endpoint, index) => (
      <EndpointItem
        endpoint={endpoint}
        endpointIndex={index}
        key={`endpoint-${endpoint.value}-${index}`}
      />
    ));
}
