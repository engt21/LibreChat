import React, { useMemo, useCallback } from 'react';
import { ImageGenProvider, imageGenProviderDisplayName } from 'librechat-data-provider';
import type {
  TImageGenModelsResponse,
  TImageGenerationPrefs,
  TImageGenProviderInfo,
} from 'librechat-data-provider';
import { Switch, Spinner, InfoHoverCard, ESide, useToastContext } from '@librechat/client';
import {
  useImageGenerationModelsQuery,
  useImageGenerationPrefsQuery,
  useUpdateImageGenerationPrefsMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

interface ProviderRowProps {
  provider: TImageGenProviderInfo;
  selectedModel: string | undefined;
  onChangeModel: (provider: ImageGenProvider, modelId: string) => void;
}

const ProviderRow: React.FC<ProviderRowProps> = ({ provider, selectedModel, onChangeModel }) => {
  const localize = useLocalize();
  const defaultModel = provider.models.find((m) => m.default)?.id ?? provider.models[0]?.id ?? '';
  const value = selectedModel ?? defaultModel;

  return (
    <div className="flex flex-col gap-1 border-b border-border-light pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-medium text-text-primary">{provider.name}</span>
          {!provider.configured && (
            <span className="text-xs text-text-secondary">
              {localize('com_ui_not_configured') || 'Not configured'}
            </span>
          )}
          {provider.credentialSource === 'user' && (
            <span className="text-xs text-text-secondary">
              {localize('com_ui_user_key') || 'Using your saved key'}
            </span>
          )}
          {provider.notice && (
            <span className="text-xs text-text-secondary">{provider.notice}</span>
          )}
        </div>
        <select
          className="h-9 rounded-md border border-border-medium bg-surface-secondary px-2 text-sm text-text-primary disabled:opacity-60"
          disabled={!provider.configured || provider.models.length === 0}
          value={value}
          onChange={(e) => onChangeModel(provider.id, e.target.value)}
        >
          {provider.models.length === 0 && (
            <option value="">{localize('com_ui_no_models_available') || 'No models'}</option>
          )}
          {provider.models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.displayName ? `${model.displayName} (${model.id})` : model.id}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

function ImageGenerationSettings() {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const modelsQuery = useImageGenerationModelsQuery();
  const prefsQuery = useImageGenerationPrefsQuery();
  const updatePrefs = useUpdateImageGenerationPrefsMutation();

  const modelsResponse: TImageGenModelsResponse | undefined = modelsQuery.data;
  const prefs: TImageGenerationPrefs | undefined = prefsQuery.data?.prefs;

  const preferredProviderOptions = useMemo<ImageGenProvider[]>(() => {
    if (!modelsResponse) return [];
    return modelsResponse.providers
      .filter((p) => p.configured && p.models.length > 0)
      .map((p) => p.id);
  }, [modelsResponse]);

  const onToggleEnabled = useCallback(
    (checked: boolean) => {
      updatePrefs.mutate(
        { enabledByDefault: checked },
        {
          onError: () =>
            showToast({
              message:
                localize('com_ui_error_generic') || 'Failed to save image generation preferences.',
              status: 'error',
            }),
        },
      );
    },
    [updatePrefs, showToast, localize],
  );

  const onChangeModel = useCallback(
    (provider: ImageGenProvider, modelId: string) => {
      updatePrefs.mutate(
        { models: { [provider]: modelId } },
        {
          onError: () =>
            showToast({
              message: localize('com_ui_error_generic') || 'Failed to save model preference.',
              status: 'error',
            }),
        },
      );
    },
    [updatePrefs, showToast, localize],
  );

  const onChangePreferredProvider = useCallback(
    (value: ImageGenProvider | '') => {
      updatePrefs.mutate(
        { preferredProvider: value === '' ? undefined : (value as ImageGenProvider) },
        {
          onError: () =>
            showToast({
              message: localize('com_ui_error_generic') || 'Failed to save preferred provider.',
              status: 'error',
            }),
        },
      );
    },
    [updatePrefs, showToast, localize],
  );

  if (modelsQuery.isLoading || prefsQuery.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (modelsQuery.error) {
    return (
      <div className="p-4 text-sm text-text-secondary">
        {localize('com_ui_error_generic') || 'Failed to load image models.'}
      </div>
    );
  }

  const providers = modelsResponse?.providers ?? [];
  const anyConfigured = providers.some((p) => p.configured);
  const selectedPreferred = prefs?.preferredProvider ?? '';

  return (
    <div className="flex flex-col gap-5 p-1 text-sm text-text-primary">
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-text-primary">
          {localize('com_ui_image_generation') || 'Image Generation'}
        </h3>
        <p className="text-sm text-text-secondary">
          {localize('com_ui_image_generation_description') ||
            'Configure how LibreChat generates images on your behalf. The selected model is used whenever image generation is triggered, either by the chat bar toggle or natural-language intent.'}
        </p>
      </div>

      <div className="flex items-center justify-between rounded-md border border-border-light bg-surface-secondary px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {localize('com_ui_image_generation_enabled_by_default') ||
              'Enable image generation automatically'}
          </span>
          <InfoHoverCard
            side={ESide.Bottom}
            text={
              localize('com_ui_image_generation_enabled_by_default_hint') ||
              'When enabled, the image-generation tool is injected for every new conversation without needing the chat-bar toggle.'
            }
          />
        </div>
        <Switch
          id="image-generation-enabled-by-default"
          aria-labelledby="image-generation-enabled-by-default"
          checked={prefs?.enabledByDefault === true}
          onCheckedChange={onToggleEnabled}
          disabled={!anyConfigured}
        />
      </div>

      <div className="flex flex-col gap-2 rounded-md border border-border-light bg-surface-secondary px-3 py-2">
        <label htmlFor="image-generation-preferred-provider" className="font-medium">
          {localize('com_ui_image_generation_preferred_provider') || 'Preferred provider'}
        </label>
        <select
          id="image-generation-preferred-provider"
          className="h-9 rounded-md border border-border-medium bg-surface-primary px-2 text-sm text-text-primary"
          value={selectedPreferred}
          onChange={(e) => onChangePreferredProvider(e.target.value as ImageGenProvider | '')}
          disabled={!anyConfigured}
        >
          <option value="">
            {localize('com_ui_image_generation_auto') || 'Auto (match current endpoint)'}
          </option>
          {preferredProviderOptions.map((provider) => (
            <option key={provider} value={provider}>
              {imageGenProviderDisplayName[provider]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-3 rounded-md border border-border-light bg-surface-secondary px-3 py-3">
        <h4 className="text-sm font-semibold text-text-primary">
          {localize('com_ui_image_generation_models_per_provider') || 'Default model per provider'}
        </h4>
        <div className="flex flex-col gap-3">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              selectedModel={prefs?.models?.[provider.id]}
              onChangeModel={onChangeModel}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default React.memo(ImageGenerationSettings);
