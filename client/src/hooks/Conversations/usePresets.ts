import filenamify from 'filenamify';
import exportFromJSON from 'export-from-json';
import { useToastContext } from '@librechat/client';
import { QueryKeys, tConvoUpdateSchema } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRecoilCallback, useRecoilState, useSetRecoilState, useRecoilValue } from 'recoil';
import { useCreatePresetMutation, useGetModelsQuery } from 'librechat-data-provider/react-query';
import type { TPreset, TConversation, TEndpointsConfig } from 'librechat-data-provider';
import {
  useUpdatePresetMutation,
  useReorderPresetsMutation,
  useDeletePresetMutation,
  useGetPresetsQuery,
} from '~/data-provider';
import { cleanupPreset, removeUnavailableTools, getConvoSwitchLogic } from '~/utils';
import useGetConversation from '~/hooks/Conversations/useGetConversation';
import useDefaultConvo from '~/hooks/Conversations/useDefaultConvo';
import { useAuthContext } from '~/hooks/AuthContext';
import { NotificationSeverity } from '~/common';
import useNewConvo from '~/hooks/useNewConvo';
import { useLocalize } from '~/hooks';
import store from '~/store';

const presetMetadataFields = new Set([
  '_id',
  'user',
  'title',
  'order',
  'presetId',
  'createdAt',
  'updatedAt',
  'conversationId',
  'defaultPreset',
]);

const presetMatchFields = [
  'endpoint',
  'endpointType',
  'model',
  'spec',
  'agent_id',
  'assistant_id',
] as const;

const normalizeMatchValue = (value: unknown) => (value == null || value === '' ? null : value);

const getPresetConversationSettings = (preset: TPreset): Partial<TConversation> => {
  const cleanedPreset = cleanupPreset({ preset });
  return Object.entries(cleanedPreset).reduce(
    (settings, [key, value]) => {
      if (presetMetadataFields.has(key)) {
        return settings;
      }
      settings[key] = value;
      return settings;
    },
    {} as Record<string, unknown>,
  ) as Partial<TConversation>;
};

const presetMatchesConversation = (conversation: TConversation, preset: TPreset): boolean => {
  const settings = getPresetConversationSettings(preset);
  const hasAnchorField = presetMatchFields.some((field) => normalizeMatchValue(settings[field]));

  if (!hasAnchorField) {
    return false;
  }

  return presetMatchFields.every((field) => {
    const presetValue = normalizeMatchValue(settings[field]);
    if (presetValue == null) {
      return true;
    }
    return normalizeMatchValue(conversation[field]) === presetValue;
  });
};

export default function usePresets(index = 0) {
  const localize = useLocalize();
  const hasLoaded = useRef(false);
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const getConversation = useGetConversation(index);
  const { user, isAuthenticated } = useAuthContext();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [presetToDelete, setPresetToDelete] = useState<TPreset | null>(null);

  const modularChat = useRecoilValue(store.modularChat);
  const availableTools = useRecoilValue(store.availableTools);
  const setPresetModalVisible = useSetRecoilState(store.presetModalVisible);
  const [_defaultPreset, setDefaultPreset] = useRecoilState(store.defaultPreset);
  const presetsQuery = useGetPresetsQuery({ enabled: !!user && isAuthenticated });
  const preset = useRecoilValue(store.presetByIndex(index));
  const setPreset = useSetRecoilState(store.presetByIndex(index));
  const conversationId = useRecoilValue(store.conversationIdByIndex(index));
  const { data: modelsData } = useGetModelsQuery();
  const { newConversation } = useNewConvo(index);

  useEffect(() => {
    if (modelsData?.initial) {
      return;
    }

    const { data: presets } = presetsQuery;
    if (_defaultPreset?.defaultPreset === true || !presets || hasLoaded.current) {
      return;
    }

    if (presets && presets.length > 0 && user && presets[0].user !== user.id) {
      presetsQuery.refetch();
      return;
    }

    const pinnedDefaultPreset = presets.find((p) => p.defaultPreset);
    if (!pinnedDefaultPreset) {
      hasLoaded.current = true;
      return;
    }
    setDefaultPreset(pinnedDefaultPreset);
    if (!conversationId || conversationId === 'new') {
      newConversation({
        preset: pinnedDefaultPreset,
        modelsData,
        keepFiles: true,
        disableParams: true,
      });
    }
    hasLoaded.current = true;
    // dependencies are stable and only needed once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetsQuery.data, user, modelsData, conversationId]);

  const setPresets = useCallback(
    (presets: TPreset[]) => {
      queryClient.setQueryData<TPreset[]>([QueryKeys.presets], presets);
    },
    [queryClient],
  );

  const upsertPresetInCache = useCallback(
    (updatedPreset: TPreset) => {
      queryClient.setQueryData<TPreset[]>([QueryKeys.presets], (previousPresets = []) => {
        const nextPresets = previousPresets.map((item) =>
          item.presetId === updatedPreset.presetId ? { ...item, ...updatedPreset } : item,
        );

        if (!nextPresets.some((item) => item.presetId === updatedPreset.presetId)) {
          nextPresets.push(updatedPreset);
        }

        return nextPresets;
      });
    },
    [queryClient],
  );

  const syncSavedPresetToActiveConversation = useRecoilCallback(
    ({ set, snapshot }) =>
      async (updatedPreset: TPreset, previousPreset: TPreset) => {
        if (!updatedPreset?.presetId || updatedPreset.presetId !== previousPreset?.presetId) {
          return;
        }

        const editingPreset = await snapshot.getPromise(store.presetByIndex(index));
        if (editingPreset?.presetId !== updatedPreset.presetId) {
          return;
        }

        const conversation = await snapshot.getPromise(store.conversationByIndex(index));
        if (!conversation || !presetMatchesConversation(conversation, previousPreset)) {
          return;
        }

        const updatedSettings = getPresetConversationSettings(updatedPreset);
        set(store.conversationByIndex(index), (currentConversation) =>
          currentConversation
            ? (tConvoUpdateSchema.parse({
                ...currentConversation,
                ...updatedSettings,
                title: currentConversation.title,
              }) as TConversation)
            : currentConversation,
        );
      },
    [index],
  );

  const deletePresetsMutation = useDeletePresetMutation({
    onMutate: (preset) => {
      if (!preset) {
        setPresets([]);
        return;
      }
      const previousPresets = presetsQuery.data ?? [];
      if (previousPresets) {
        setPresets(previousPresets.filter((p) => p.presetId !== preset.presetId));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries([QueryKeys.presets]);
      showToast({
        message: localize('com_endpoint_preset_delete_success'),
        severity: NotificationSeverity.SUCCESS,
        showIcon: true,
      });
    },
    onError: (error) => {
      queryClient.invalidateQueries([QueryKeys.presets]);
      console.error('Error deleting the preset:', error);
      showToast({
        message: localize('com_endpoint_preset_delete_error'),
        severity: NotificationSeverity.ERROR,
        showIcon: true,
      });
    },
  });
  const createPresetMutation = useCreatePresetMutation();
  const updatePreset = useUpdatePresetMutation({
    onSuccess: (data, preset) => {
      upsertPresetInCache(data);
      setPreset((currentPreset) =>
        currentPreset?.presetId === data.presetId ? { ...currentPreset, ...data } : currentPreset,
      );
      syncSavedPresetToActiveConversation(data, preset);

      const toastTitle = data.title ? `"${data.title}"` : localize('com_endpoint_preset_title');
      let message = `${toastTitle} ${localize('com_ui_saved')}`;
      if (data.defaultPreset && data.presetId !== _defaultPreset?.presetId) {
        message = `${toastTitle} ${localize('com_endpoint_preset_default')}`;
        setDefaultPreset(data);
        newConversation({ preset: data, keepFiles: true, disableParams: true });
      } else if (data.defaultPreset && data.presetId === _defaultPreset?.presetId) {
        setDefaultPreset(data);
      } else if (preset.defaultPreset === false) {
        setDefaultPreset(null);
        message = `${toastTitle} ${localize('com_endpoint_preset_default_removed')}`;
      } else if (_defaultPreset?.presetId === data.presetId) {
        setDefaultPreset(data);
      }
      showToast({
        message,
      });
      queryClient.invalidateQueries([QueryKeys.presets]);
    },
    onError: (error) => {
      console.error('Error updating the preset:', error);
      showToast({
        message: localize('com_endpoint_preset_save_error'),
        severity: NotificationSeverity.ERROR,
      });
    },
  });
  const reorderPresetsMutation = useReorderPresetsMutation({
    onSuccess: (presets) => {
      setPresets(presets);
    },
    onError: (error) => {
      queryClient.invalidateQueries([QueryKeys.presets]);
      console.error('Error reordering presets:', error);
      showToast({
        message: localize('com_endpoint_preset_save_error'),
        severity: NotificationSeverity.ERROR,
      });
    },
  });

  const getDefaultConversation = useDefaultConvo();

  const importPreset = (jsonPreset: TPreset) => {
    createPresetMutation.mutate(
      { ...jsonPreset },
      {
        onSuccess: () => {
          showToast({
            message: localize('com_endpoint_preset_import'),
          });
          queryClient.invalidateQueries([QueryKeys.presets]);
        },
        onError: (error) => {
          console.error('Error uploading the preset:', error);
          showToast({
            message: localize('com_endpoint_preset_import_error'),
            severity: NotificationSeverity.ERROR,
          });
        },
      },
    );
  };

  const onFileSelected = (jsonData: Record<string, unknown>) => {
    const jsonPreset = { ...cleanupPreset({ preset: jsonData }), presetId: null };
    importPreset(jsonPreset);
  };

  const onDuplicatePreset = (sourcePreset: TPreset) => {
    const cleanedPreset = cleanupPreset({ preset: sourcePreset });
    const {
      user: _sourceUser,
      order: _sourceOrder,
      conversationId: _sourceConversationId,
      defaultPreset: _sourceDefaultPreset,
      ...presetSettings
    } = cleanedPreset;
    const title = sourcePreset.title || localize('com_endpoint_preset_title');

    createPresetMutation.mutate(
      {
        ...presetSettings,
        presetId: null,
        defaultPreset: false,
        title: `${title} (${localize('com_ui_copy')})`,
      },
      {
        onSuccess: (duplicatedPreset) => {
          const currentPresets = presetsQuery.data ?? [];
          const sourceIndex = currentPresets.findIndex(
            (currentPreset) => currentPreset.presetId === sourcePreset.presetId,
          );
          const insertIndex = sourceIndex >= 0 ? sourceIndex + 1 : currentPresets.length;
          const nextPresets = [...currentPresets];
          nextPresets.splice(insertIndex, 0, duplicatedPreset);
          onReorderPresets(nextPresets, true);
          showToast({
            message: `"${duplicatedPreset.title}" ${localize('com_ui_saved')}`,
          });
        },
        onError: (error) => {
          console.error('Error duplicating the preset:', error);
          showToast({
            message: localize('com_endpoint_preset_save_error'),
            severity: NotificationSeverity.ERROR,
          });
        },
      },
    );
  };

  const onSelectPreset = (_newPreset: TPreset) => {
    if (!_newPreset) {
      return;
    }

    const conversation = getConversation();
    const newPreset = removeUnavailableTools(_newPreset, availableTools);

    const toastTitle = newPreset.title
      ? `"${newPreset.title}"`
      : localize('com_endpoint_preset_title');

    showToast({
      message: `${toastTitle} ${localize('com_endpoint_preset_selected_title')}`,
      showIcon: false,
      duration: 750,
    });

    const endpointsConfig = queryClient.getQueryData<TEndpointsConfig>([QueryKeys.endpoints]);

    const {
      shouldSwitch,
      isNewModular,
      newEndpointType,
      isCurrentModular,
      isExistingConversation,
    } = getConvoSwitchLogic({
      newEndpoint: newPreset.endpoint ?? '',
      modularChat,
      conversation,
      endpointsConfig,
    });

    newPreset.spec = null;
    newPreset.iconURL = newPreset.iconURL ?? null;
    newPreset.modelLabel = newPreset.modelLabel ?? null;
    const isModular = isCurrentModular && isNewModular && shouldSwitch;
    const disableParams = newPreset.defaultPreset === true;
    if (isExistingConversation && isModular) {
      const currentConvo = getDefaultConversation({
        /* target endpointType is necessary to avoid endpoint mixing */
        conversation: {
          ...(conversation ?? {}),
          spec: null,
          iconURL: null,
          modelLabel: null,
          endpointType: newEndpointType,
        },
        preset: { ...newPreset, endpointType: newEndpointType },
        cleanInput: true,
      });

      /* We don't reset the latest message, only when changing settings mid-converstion */
      newConversation({
        template: currentConvo,
        preset: currentConvo,
        keepLatestMessage: true,
        keepAddedConvos: true,
        keepFiles: true,
        disableParams,
      });
      return;
    }

    newConversation({
      preset: newPreset,
      keepAddedConvos: isModular,
      keepFiles: true,
      disableParams,
    });
  };

  const onChangePreset = (preset: TPreset) => {
    setPreset(preset);
    setPresetModalVisible(true);
  };

  const clearAllPresets = () => deletePresetsMutation.mutate(undefined);

  const onDeletePreset = (preset: TPreset) => {
    setPresetToDelete(preset);
    setShowDeleteDialog(true);
  };

  const confirmDeletePreset = () => {
    if (!presetToDelete) {
      return;
    }
    deletePresetsMutation.mutate(presetToDelete);
    setShowDeleteDialog(false);
    setPresetToDelete(null);
  };

  const submitPreset = useRecoilCallback(
    ({ snapshot }) =>
      async () => {
        const currentPreset = await snapshot.getPromise(store.presetByIndex(index));
        if (!currentPreset) {
          return;
        }

        updatePreset.mutate(cleanupPreset({ preset: currentPreset }));
      },
    [index, updatePreset],
  );

  const onSetDefaultPreset = (preset: TPreset, remove = false) => {
    updatePreset.mutate({ ...preset, defaultPreset: !remove });
  };

  const onReorderPresets = (nextPresets: TPreset[], persist = true) => {
    const orderedPresets = nextPresets
      .filter((nextPreset): nextPreset is TPreset => Boolean(nextPreset?.presetId))
      .map((nextPreset, index) => ({ ...nextPreset, order: index + 1 }));

    setPresets(orderedPresets);

    if (!persist || orderedPresets.length === 0) {
      return;
    }

    reorderPresetsMutation.mutate({
      presetOrder: orderedPresets.map((nextPreset) => ({
        presetId: nextPreset.presetId ?? '',
        order: nextPreset.order ?? 0,
      })),
    });
  };

  const exportPreset = () => {
    if (!preset) {
      return;
    }
    const fileName = filenamify(preset.title || 'preset');
    exportFromJSON({
      data: cleanupPreset({ preset }),
      fileName,
      exportType: exportFromJSON.types.json,
    });
  };

  return {
    presetsQuery,
    onSetDefaultPreset,
    onFileSelected,
    onSelectPreset,
    onChangePreset,
    onDuplicatePreset,
    clearAllPresets,
    onDeletePreset,
    onReorderPresets,
    submitPreset,
    exportPreset,
    showDeleteDialog,
    setShowDeleteDialog,
    presetToDelete,
    confirmDeletePreset,
  };
}
