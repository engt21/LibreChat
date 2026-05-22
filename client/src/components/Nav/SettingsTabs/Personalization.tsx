import { useState, useEffect } from 'react';
import { Switch, useToastContext } from '@librechat/client';
import {
  useGetUserQuery,
  useUpdateMemoryPreferencesMutation,
  useUpdateModelSteeringPrefsMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

interface PersonalizationProps {
  hasMemoryOptOut: boolean;
  hasModelSteering: boolean;
  hasAnyPersonalizationFeature: boolean;
}

export default function Personalization({
  hasMemoryOptOut,
  hasModelSteering,
  hasAnyPersonalizationFeature,
}: PersonalizationProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const { data: user } = useGetUserQuery();
  const [referenceSavedMemories, setReferenceSavedMemories] = useState(true);
  const [modelSteeringEnabled, setModelSteeringEnabled] = useState(true);

  const updateMemoryPreferencesMutation = useUpdateMemoryPreferencesMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
      // Revert the toggle on error
      setReferenceSavedMemories((prev) => !prev);
    },
  });

  const updateModelSteeringPrefsMutation = useUpdateModelSteeringPrefsMutation({
    onSuccess: () => {
      showToast({
        message: localize('com_ui_preferences_updated'),
        status: 'success',
      });
    },
    onError: () => {
      showToast({
        message: localize('com_ui_error_updating_preferences'),
        status: 'error',
      });
      setModelSteeringEnabled((prev) => !prev);
    },
  });

  // Initialize state from user data
  useEffect(() => {
    if (user?.personalization?.memories !== undefined) {
      setReferenceSavedMemories(user.personalization.memories);
    }
  }, [user?.personalization?.memories]);

  useEffect(() => {
    setModelSteeringEnabled(user?.modelSteeringPrefs?.enabled !== false);
  }, [user?.modelSteeringPrefs?.enabled]);

  const handleMemoryToggle = (checked: boolean) => {
    setReferenceSavedMemories(checked);
    updateMemoryPreferencesMutation.mutate({ memories: checked });
  };

  const handleModelSteeringToggle = (checked: boolean) => {
    setModelSteeringEnabled(checked);
    updateModelSteeringPrefsMutation.mutate({ enabled: checked });
  };

  if (!hasAnyPersonalizationFeature) {
    return (
      <div className="flex flex-col gap-3 text-sm text-text-primary">
        <div className="text-text-secondary">{localize('com_ui_no_personalization_available')}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm text-text-primary">
      {/* Memory Settings Section */}
      {hasMemoryOptOut && (
        <>
          <div className="border-b border-border-medium pb-3">
            <div className="text-base font-semibold">{localize('com_ui_memory')}</div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div id="reference-saved-memories-label" className="flex items-center gap-2">
                {localize('com_ui_reference_saved_memories')}
              </div>
              <div
                id="reference-saved-memories-description"
                className="mt-1 text-xs text-text-secondary"
              >
                {localize('com_ui_reference_saved_memories_description')}
              </div>
            </div>
            <Switch
              checked={referenceSavedMemories}
              onCheckedChange={handleMemoryToggle}
              disabled={updateMemoryPreferencesMutation.isLoading}
              aria-labelledby="reference-saved-memories-label"
              aria-describedby="reference-saved-memories-description"
            />
          </div>
        </>
      )}

      {hasModelSteering && (
        <>
          <div className="border-b border-border-medium pb-3 pt-2">
            <div className="text-base font-semibold">{localize('com_ui_model_steering')}</div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <div id="model-steering-label" className="flex items-center gap-2">
                {localize('com_ui_enable_model_steering')}
              </div>
              <div id="model-steering-description" className="mt-1 text-xs text-text-secondary">
                {localize('com_ui_enable_model_steering_description')}
              </div>
            </div>
            <Switch
              checked={modelSteeringEnabled}
              onCheckedChange={handleModelSteeringToggle}
              disabled={updateModelSteeringPrefsMutation.isLoading}
              aria-labelledby="model-steering-label"
              aria-describedby="model-steering-description"
            />
          </div>
        </>
      )}
    </div>
  );
}
