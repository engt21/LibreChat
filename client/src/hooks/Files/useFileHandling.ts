import React, { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { v4 } from 'uuid';
import { useSetRecoilState, useRecoilValue, useResetRecoilState } from 'recoil';
import { useToastContext } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  QueryKeys,
  Constants,
  LocalStorageKeys,
  EModelEndpoint,
  EToolResources,
  FileSources,
  dataService,
  mergeFileConfig,
  isAssistantsEndpoint,
  getEndpointFileConfig,
  defaultAssistantsVersion,
} from 'librechat-data-provider';
import debounce from 'lodash/debounce';
import type { TConversation, TEndpointsConfig, TError, TMessage } from 'librechat-data-provider';
import type { ExtendedFile, FileSetter } from '~/common';
import { logger, validateFiles, cachePreview, getCachedPreview, removePreviewEntry } from '~/utils';
import { useGetFileConfig, useUploadFileMutation } from '~/data-provider';
import useLocalize, { TranslationKeys } from '~/hooks/useLocalize';
import { useDelayedUploadToast } from './useDelayedUploadToast';
import { processFileForUpload } from '~/utils/heicConverter';
import { useChatContext } from '~/Providers/ChatContext';
import { ephemeralAgentByConvoId } from '~/store';
import store from '~/store';
import useClientResize from './useClientResize';
import useUpdateFiles from './useUpdateFiles';

type UseFileHandling = {
  fileSetter?: FileSetter;
  fileFilter?: (file: File) => boolean;
  additionalMetadata?: Record<string, string | undefined>;
  /** Overrides `endpoint` for upload routing; also used as `endpointType` fallback when `endpointTypeOverride` is not set */
  endpointOverride?: EModelEndpoint | string;
  /** Overrides `endpointType` independently from `endpointOverride` */
  endpointTypeOverride?: EModelEndpoint | string;
};

export type FileHandlingState = {
  files: Map<string, ExtendedFile>;
  setFiles: FileSetter;
  setFilesLoading?: React.Dispatch<React.SetStateAction<boolean>>;
  conversation?: TConversation | null;
  setConversation?: (conversation: TConversation | null) => void;
  setMessages?: (messages: TMessage[]) => void;
};

const noop = () => {};

const transcribableMediaPattern =
  /\.(aac|aif|aiff|amr|avi|caf|flac|m4a|m4b|m4p|m4r|mkv|mov|mp2|mp3|mp4|mpeg|mpga|oga|ogg|opus|wav|webm|wma)$/i;
const DIARIZE_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe-diarize';

const getNativeUploadTool = ({
  endpoint,
  tool_resource,
}: {
  endpoint?: string;
  tool_resource?: string;
}) => {
  if (
    (endpoint === EModelEndpoint.openAI || endpoint === EModelEndpoint.azureOpenAI) &&
    (tool_resource === EToolResources.execute_code || tool_resource === EToolResources.file_search)
  ) {
    return tool_resource;
  }

  return undefined;
};

const _isTranscribableMediaUpload = ({ filename, type }: { filename?: string; type?: string }) =>
  Boolean(
    (type && (type.startsWith('audio/') || type.startsWith('video/'))) ||
    (filename && transcribableMediaPattern.test(filename)),
  );

const normalizeTranscriptionEndpoint = ({
  endpoint,
  endpointType,
}: {
  endpoint?: string;
  endpointType?: string;
}) => {
  if (endpoint === EModelEndpoint.agents) {
    return endpointType || EModelEndpoint.openAI;
  }

  return endpoint || endpointType;
};

const mergeMessages = (currentMessages: TMessage[] = [], incomingMessages: TMessage[] = []) => {
  const mergedMessages = new Map<string, TMessage>();

  for (const message of [...currentMessages, ...incomingMessages]) {
    if (message?.messageId) {
      mergedMessages.set(message.messageId, message);
    }
  }

  return Array.from(mergedMessages.values()).sort((a, b) => {
    const first = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const second = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return first - second;
  });
};

const getConversationSpeakerReferences = (conversation?: TConversation | null) =>
  (conversation?.transcriptionSpeakerReferences ?? []).filter(
    (speakerReference) => speakerReference?.name && speakerReference?.file_id,
  );

const useFileHandlingCore = (params: UseFileHandling | undefined, fileState: FileHandlingState) => {
  const localize = useLocalize();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const [errors, setErrors] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const transcriptionPollersRef = useRef<Map<string, number>>(new Map());
  const { startUploadTimer, clearUploadTimer } = useDelayedUploadToast();
  const { files, setFiles, conversation, setConversation, setMessages } = fileState;
  const setFilesLoading = fileState.setFilesLoading ?? noop;
  const setEphemeralAgent = useSetRecoilState(
    ephemeralAgentByConvoId(conversation?.conversationId ?? Constants.NEW_CONVO),
  );
  const globalTranscriptionModel = useRecoilValue<string>(store.transcriptionModel);
  const globalTranscriptionPrompt = useRecoilValue<string>(store.transcriptionPrompt);
  const resetLatestMessage = useResetRecoilState(store.latestMessageFamily(0));
  const setError = (error: string) => setErrors((prevErrors) => [...prevErrors, error]);
  const { addFile, replaceFile, updateFileById, deleteFileById } = useUpdateFiles(
    params?.fileSetter ?? setFiles,
  );
  const { resizeImageIfNeeded } = useClientResize();

  const agent_id = params?.additionalMetadata?.agent_id ?? '';
  const assistant_id = params?.additionalMetadata?.assistant_id ?? '';
  const endpointOverride = params?.endpointOverride;
  const endpointTypeOverride = params?.endpointTypeOverride;
  const endpointType = useMemo(
    () => endpointTypeOverride ?? endpointOverride ?? conversation?.endpointType,
    [endpointTypeOverride, endpointOverride, conversation?.endpointType],
  );
  const endpoint = useMemo(
    () => endpointOverride ?? conversation?.endpoint ?? 'default',
    [endpointOverride, conversation?.endpoint],
  );

  const { data: fileConfig = null } = useGetFileConfig({
    select: (data) => mergeFileConfig(data),
  });

  const displayToast = useCallback(() => {
    if (errors.length > 1) {
      // TODO: this should not be a dynamic localize input!!
      const errorList = Array.from(new Set(errors))
        .map((e, i) => `${i > 0 ? '• ' : ''}${localize(e as TranslationKeys) || e}\n`)
        .join('');
      showToast({
        message: errorList,
        status: 'error',
        duration: 5000,
      });
    } else if (errors.length === 1) {
      // TODO: this should not be a dynamic localize input!!
      const message = localize(errors[0] as TranslationKeys) || errors[0];
      showToast({
        message,
        status: 'error',
        duration: 5000,
      });
    }

    setErrors([]);
  }, [errors, showToast, localize]);

  const debouncedDisplayToast = debounce(displayToast, 250);

  useEffect(() => {
    if (errors.length > 0) {
      debouncedDisplayToast();
    }

    return () => debouncedDisplayToast.cancel();
  }, [errors, debouncedDisplayToast]);

  const clearTranscriptionPoller = useCallback((pollKey: string) => {
    const intervalId = transcriptionPollersRef.current.get(pollKey);
    if (intervalId != null) {
      window.clearInterval(intervalId);
      transcriptionPollersRef.current.delete(pollKey);
    }
  }, []);

  useEffect(() => {
    const pollers = transcriptionPollersRef.current;
    return () => {
      for (const intervalId of pollers.values()) {
        window.clearInterval(intervalId);
      }

      pollers.clear();
    };
  }, []);

  const startTranscriptionPolling = useCallback(
    (
      conversationId: string,
      responseMessageId: string,
      filename: string,
      updateActiveChat: boolean,
    ) => {
      const pollKey = `${conversationId}:${responseMessageId}`;
      clearTranscriptionPoller(pollKey);

      const pollMessages = async () => {
        try {
          const messages = await dataService.getMessagesByConvoId(conversationId);
          queryClient.setQueryData<TMessage[]>([QueryKeys.messages, conversationId], messages);

          if (updateActiveChat && conversation?.conversationId === conversationId) {
            setMessages?.(messages);
          }

          const responseMessage = messages.find(
            (message) => message.messageId === responseMessageId,
          );
          if (!responseMessage) {
            return;
          }

          const meta = responseMessage.metadata as { transcriptionStatus?: string } | undefined;
          const status = meta?.transcriptionStatus;

          if (status === 'processing' || (!status && !responseMessage.error)) {
            return;
          }

          clearTranscriptionPoller(pollKey);
          queryClient.invalidateQueries([QueryKeys.files]);
          queryClient.invalidateQueries([QueryKeys.allConversations]);

          showToast({
            message:
              status === 'failed' || responseMessage.error
                ? `Transcription failed for "${filename}"`
                : `Transcript ready for "${filename}"`,
            status: status === 'failed' || responseMessage.error ? 'error' : 'success',
            duration: status === 'failed' || responseMessage.error ? 5000 : 3000,
          });
        } catch (error) {
          console.warn('audio transcription poll failed', error);
        }
      };

      const intervalId = window.setInterval(() => {
        void pollMessages();
      }, 5000);

      transcriptionPollersRef.current.set(pollKey, intervalId);
      void pollMessages();
    },
    [clearTranscriptionPoller, conversation?.conversationId, queryClient, setMessages, showToast],
  );

  const startQueuedTranscription = useCallback(
    async ({
      data,
      variables,
      tempFileId,
      filename,
      extraSpeakerRefs,
    }: {
      data: { file_id: string };
      variables: FormData;
      tempFileId: string;
      filename: string;
      extraSpeakerRefs?: Array<{ id?: string; name: string; file_id: string }>;
    }) => {
      const normalizedEndpoint = normalizeTranscriptionEndpoint({
        endpoint: (variables.get('endpoint') as string) || undefined,
        endpointType: (variables.get('endpointType') as string) || undefined,
      });
      const effectiveTranscriptionModel =
        conversation?.transcriptionModel || globalTranscriptionModel || undefined;
      const effectiveTranscriptionPrompt =
        conversation?.transcriptionPrompt?.trim() || globalTranscriptionPrompt?.trim() || undefined;

      const payload = {
        file_id: data.file_id,
        endpoint: normalizedEndpoint,
        endpointType: normalizedEndpoint,
        model: (variables.get('model') as string) || undefined,
        transcriptionModel: effectiveTranscriptionModel,
        prompt: effectiveTranscriptionPrompt,
        speakerReferences: [
          ...getConversationSpeakerReferences(conversation).map((speakerReference) => ({
            id: speakerReference.id,
            name: speakerReference.name,
            file_id: speakerReference.file_id,
          })),
          ...(extraSpeakerRefs ?? []),
        ],
      };

      if (
        effectiveTranscriptionModel === DIARIZE_TRANSCRIPTION_MODEL &&
        (conversation?.transcriptionSpeakerReferences?.length ?? 0) >
          payload.speakerReferences.length
      ) {
        showToast({
          message: 'Some diarization speaker references are incomplete and were skipped.',
          status: 'warning',
          duration: 4000,
        });
      }

      const result = await dataService.startAudioTranscription(payload);
      const nextConversationId = result.conversation.conversationId;
      if (!nextConversationId || nextConversationId === Constants.NEW_CONVO) {
        throw new Error('Audio transcription did not return a valid conversation ID.');
      }

      const cachedMessages =
        queryClient.getQueryData<TMessage[]>([QueryKeys.messages, nextConversationId]) ?? [];
      const mergedMessages = mergeMessages(cachedMessages, result.messages);

      queryClient.setQueryData([QueryKeys.conversation, nextConversationId], result.conversation);
      queryClient.setQueryData([QueryKeys.messages, nextConversationId], mergedMessages);
      queryClient.invalidateQueries([QueryKeys.files]);
      queryClient.invalidateQueries([QueryKeys.allConversations]);

      const sourceConvoId = conversation?.conversationId || Constants.NEW_CONVO;
      setFiles(new Map());
      removePreviewEntry(tempFileId);
      removePreviewEntry(data.file_id);
      localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${sourceConvoId}`);
      localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`);

      // Reset latestMessage BEFORE setting conversation/messages so any
      // stale error-state atom is cleared before React re-renders the new
      // transcript conversation.  Without this, a prior error-state message
      // can leave isNotAppendable stuck true and block follow-up chat.
      resetLatestMessage();
      setConversation?.(result.conversation);
      setMessages?.(mergedMessages);
      navigate(`/c/${nextConversationId}`, { replace: true, state: { focusChat: true } });
      startTranscriptionPolling(nextConversationId, result.responseMessageId, filename, true);

      setTimeout(() => {
        localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${sourceConvoId}`);
        localStorage.removeItem(`${LocalStorageKeys.FILES_DRAFT}${Constants.NEW_CONVO}`);
      }, 0);

      showToast({
        message: `Started transcribing "${filename}"`,
        status: 'info',
        duration: 3000,
      });
    },
    [
      setFiles,
      navigate,
      queryClient,
      setConversation,
      setMessages,
      showToast,
      startTranscriptionPolling,
      resetLatestMessage,
      conversation,
      globalTranscriptionModel,
      globalTranscriptionPrompt,
    ],
  );

  const uploadFile = useUploadFileMutation(
    {
      onSuccess: (data, variables) => {
        clearUploadTimer(data.temp_file_id);
        console.log('upload success', data);
        const toolResource = variables.get('tool_resource');
        const uploadedToolResource =
          typeof toolResource === 'string' && toolResource.length > 0 ? toolResource : undefined;
        if (agent_id) {
          queryClient.refetchQueries([QueryKeys.agent, agent_id]);
          return;
        }
        updateFileById(
          data.temp_file_id,
          {
            progress: 0.9,
            filepath: data.filepath,
          },
          assistant_id ? true : false,
        );

        setTimeout(async () => {
          const cachedBlob = getCachedPreview(data.temp_file_id);
          if (cachedBlob && data.file_id !== data.temp_file_id) {
            cachePreview(data.file_id, cachedBlob);
            removePreviewEntry(data.temp_file_id);
          }
          updateFileById(
            data.temp_file_id,
            {
              progress: 1,
              file_id: data.file_id,
              temp_file_id: data.temp_file_id,
              filepath: data.filepath,
              type: data.type,
              height: data.height,
              width: data.width,
              filename: data.filename,
              source:
                data.source ??
                (uploadedToolResource === EToolResources.execute_code
                  ? FileSources.execute_code
                  : undefined),
              embedded: data.embedded,
              ...(uploadedToolResource ? { tool_resource: uploadedToolResource } : {}),
              ...(data.metadata ? { metadata: data.metadata } : {}),
            },
            assistant_id ? true : false,
          );

          // Audio/video files are no longer auto-transcribed on upload.
          // The user triggers transcription explicitly via the inline
          // AudioTranscriptionBar in the chat compose area.
        }, 300);
      },
      onError: (_error, body) => {
        const error = _error as TError | undefined;
        console.log('upload error', error);
        const file_id = body.get('file_id');
        const tool_resource = body.get('tool_resource');
        if (tool_resource === EToolResources.execute_code) {
          setEphemeralAgent((prev) => ({
            ...prev,
            [EToolResources.execute_code]: false,
          }));
        }
        clearUploadTimer(file_id as string);
        deleteFileById(file_id as string);

        let errorMessage = 'com_error_files_upload';

        if (error?.code === 'ERR_CANCELED') {
          errorMessage = 'com_error_files_upload_canceled';
        } else if (error?.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        setError(errorMessage);
      },
    },
    abortControllerRef.current?.signal,
  );

  const startUpload = async (extendedFile: ExtendedFile) => {
    const filename = extendedFile.file?.name ?? 'File';
    startUploadTimer(extendedFile.file_id, filename, extendedFile.size);

    const formData = new FormData();
    formData.append('endpoint', endpoint);
    formData.append('endpointType', endpointType ?? '');
    formData.append('file_id', extendedFile.file_id);

    const width = extendedFile.width ?? 0;
    const height = extendedFile.height ?? 0;
    if (width) {
      formData.append('width', width.toString());
    }
    if (height) {
      formData.append('height', height.toString());
    }

    const metadata = params?.additionalMetadata ?? {};
    if (params?.additionalMetadata) {
      for (const [key, value = ''] of Object.entries(metadata)) {
        if (value) {
          formData.append(key, value);
        }
      }
    }

    if (conversation?.conversationId) {
      formData.append('conversationId', conversation.conversationId);
    }

    if (conversation?.model) {
      formData.append('model', conversation.model);
    }

    if (conversation?.spec) {
      formData.append('spec', conversation.spec);
    }

    if (conversation?.iconURL) {
      formData.append('iconURL', conversation.iconURL);
    }

    const appendFile = () => {
      formData.append('file', extendedFile.file as File, encodeURIComponent(filename));
    };

    if (!isAssistantsEndpoint(endpointType ?? endpoint)) {
      if (!agent_id) {
        formData.append('message_file', 'true');
      }
      const tool_resource = extendedFile.tool_resource;
      if (tool_resource != null) {
        formData.append('tool_resource', tool_resource);

        const nativeTool = getNativeUploadTool({
          endpoint: endpointType ?? endpoint,
          tool_resource,
        });
        if (nativeTool) {
          formData.append('native_tool', nativeTool);
        }
      }
      if (conversation?.agent_id != null && formData.get('agent_id') == null) {
        formData.append('agent_id', conversation.agent_id);
      }

      appendFile();
      uploadFile.mutate(formData);
      return;
    }

    const convoModel = conversation?.model ?? '';
    const convoAssistantId = conversation?.assistant_id ?? '';

    if (!assistant_id) {
      formData.append('message_file', 'true');
    }

    const endpointsConfig = queryClient.getQueryData<TEndpointsConfig>([QueryKeys.endpoints]);
    const version = endpointsConfig?.[endpoint]?.version ?? defaultAssistantsVersion[endpoint];

    if (!assistant_id && convoAssistantId) {
      formData.append('version', version);
      formData.append('model', convoModel);
      formData.append('assistant_id', convoAssistantId);
    }

    const formVersion = (formData.get('version') ?? '') as string;
    if (!formVersion) {
      formData.append('version', version);
    }

    const formModel = (formData.get('model') ?? '') as string;
    if (!formModel) {
      formData.append('model', convoModel);
    }

    appendFile();
    uploadFile.mutate(formData);
  };

  const loadImage = (extendedFile: ExtendedFile, preview: string) => {
    const img = new Image();
    img.onload = async () => {
      extendedFile.width = img.width;
      extendedFile.height = img.height;
      extendedFile = {
        ...extendedFile,
        progress: 0.6,
      };
      replaceFile(extendedFile);

      await startUpload(extendedFile);
    };
    img.src = preview;
  };

  const handleFiles = async (_files: FileList | File[], _toolResource?: string) => {
    abortControllerRef.current = new AbortController();
    const fileList = Array.from(_files);
    /* Validate files */
    let filesAreValid: boolean;
    try {
      const endpointFileConfig = getEndpointFileConfig({
        endpoint,
        fileConfig,
        endpointType,
      });

      filesAreValid = validateFiles({
        files,
        fileList,
        setError,
        fileConfig,
        endpointFileConfig,
        toolResource: _toolResource,
      });
    } catch (error) {
      console.error('file validation error', error);
      setError('com_error_files_validation');
      return;
    }
    if (!filesAreValid) {
      setFilesLoading(false);
      return;
    }

    /* Process files */
    for (const originalFile of fileList) {
      const file_id = v4();
      try {
        // Create initial preview with original file
        const initialPreview = URL.createObjectURL(originalFile);
        cachePreview(file_id, initialPreview);

        // Create initial ExtendedFile to show immediately
        const initialExtendedFile: ExtendedFile = {
          file_id,
          file: originalFile,
          type: originalFile.type,
          preview: initialPreview,
          progress: 0.1, // Show as processing
          size: originalFile.size,
        };

        if (_toolResource != null && _toolResource !== '') {
          initialExtendedFile.tool_resource = _toolResource;
        }

        // Add file immediately to show in UI
        addFile(initialExtendedFile);

        // Check if HEIC conversion is needed and show toast
        const isHEIC =
          originalFile.type === 'image/heic' ||
          originalFile.type === 'image/heif' ||
          originalFile.name.toLowerCase().match(/\.(heic|heif)$/);

        if (isHEIC) {
          showToast({
            message: localize('com_info_heic_converting'),
            status: 'info',
            duration: 3000,
          });
        }

        // Process file for HEIC conversion if needed
        const heicProcessedFile = await processFileForUpload(
          originalFile,
          0.9,
          (conversionProgress) => {
            // Update progress during HEIC conversion (0.1 to 0.5 range for conversion)
            const adjustedProgress = 0.1 + conversionProgress * 0.4;
            replaceFile({
              ...initialExtendedFile,
              progress: adjustedProgress,
            });
          },
        );

        let finalProcessedFile = heicProcessedFile;

        // Apply client-side resizing if available and appropriate
        if (heicProcessedFile.type.startsWith('image/')) {
          try {
            const resizeResult = await resizeImageIfNeeded(heicProcessedFile);
            finalProcessedFile = resizeResult.file;

            // Show toast notification if image was resized
            if (resizeResult.resized && resizeResult.result) {
              const { originalSize, newSize, compressionRatio } = resizeResult.result;
              const originalSizeMB = (originalSize / (1024 * 1024)).toFixed(1);
              const newSizeMB = (newSize / (1024 * 1024)).toFixed(1);
              const savedPercent = Math.round((1 - compressionRatio) * 100);

              showToast({
                message: `Image resized: ${originalSizeMB}MB → ${newSizeMB}MB (${savedPercent}% smaller)`,
                status: 'success',
                duration: 3000,
              });
            }
          } catch (resizeError) {
            console.warn('Image resize failed, using original:', resizeError);
            // Continue with HEIC processed file if resizing fails
          }
        }

        // If file was processed (HEIC converted or resized), update with new file and preview
        if (finalProcessedFile !== originalFile) {
          URL.revokeObjectURL(initialPreview); // Clean up original preview
          const newPreview = URL.createObjectURL(finalProcessedFile);
          cachePreview(file_id, newPreview);

          const updatedExtendedFile: ExtendedFile = {
            ...initialExtendedFile,
            file: finalProcessedFile,
            type: finalProcessedFile.type,
            preview: newPreview,
            progress: 0.5, // Processing complete, ready for upload
            size: finalProcessedFile.size,
          };

          replaceFile(updatedExtendedFile);

          const isImage = finalProcessedFile.type.split('/')[0] === 'image';
          if (isImage) {
            loadImage(updatedExtendedFile, newPreview);
            continue;
          }

          await startUpload(updatedExtendedFile);
        } else {
          // File wasn't processed, proceed with original
          const isImage = originalFile.type.split('/')[0] === 'image';

          // Update progress to show ready for upload
          const readyExtendedFile = {
            ...initialExtendedFile,
            progress: 0.2,
          };
          replaceFile(readyExtendedFile);

          if (isImage) {
            loadImage(readyExtendedFile, initialPreview);
            continue;
          }

          await startUpload(readyExtendedFile);
        }
      } catch (error) {
        deleteFileById(file_id);
        console.log('file handling error', error);
        if (error instanceof Error && error.message.includes('HEIC')) {
          setError('com_error_heic_conversion');
        } else {
          setError('com_error_files_process');
        }
      }
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, _toolResource?: string) => {
    event.stopPropagation();
    if (event.target.files) {
      setFilesLoading(true);
      handleFiles(event.target.files, _toolResource);
      // reset the input
      event.target.value = '';
    }
  };

  const abortUpload = () => {
    if (abortControllerRef.current) {
      logger.log('files', 'Aborting upload');
      abortControllerRef.current.abort('User aborted upload');
      abortControllerRef.current = null;
    }
  };

  const transcribeUploadedFile = useCallback(
    async (
      fileId: string,
      filename: string,
      extraSpeakerRefs?: Array<{ id?: string; name: string; file_id: string }>,
    ) => {
      const extendedFile = files.get(fileId);
      if (!extendedFile) {
        return;
      }

      const formData = new FormData();
      formData.append('endpoint', endpoint);
      formData.append('endpointType', endpointType ?? '');
      if (conversation?.model) {
        formData.append('model', conversation.model);
      }

      try {
        await startQueuedTranscription({
          data: { file_id: extendedFile.file_id ?? fileId },
          variables: formData,
          tempFileId: fileId,
          filename,
          extraSpeakerRefs,
        });
      } catch (_error) {
        const error = _error as TError | undefined;
        const message =
          error?.response?.data?.message ||
          error?.message ||
          `Failed to start transcription for "${filename}"`;
        showToast({ message, status: 'error', duration: 5000 });
      }
    },
    [files, endpoint, endpointType, conversation?.model, startQueuedTranscription, showToast],
  );

  return {
    handleFileChange,
    handleFiles,
    abortUpload,
    transcribeUploadedFile,
    setFiles,
    files,
  };
};

export const useFileHandlingNoChatContext = (
  params: UseFileHandling | undefined,
  fileState: FileHandlingState,
) => useFileHandlingCore(params, fileState);

const useFileHandling = (params?: UseFileHandling) => {
  const { files, setFiles, setFilesLoading, conversation, setConversation, setMessages } =
    useChatContext();

  return useFileHandlingCore(params, {
    files,
    setFiles,
    conversation,
    setConversation,
    setMessages,
    setFilesLoading,
  });
};

export default useFileHandling;
