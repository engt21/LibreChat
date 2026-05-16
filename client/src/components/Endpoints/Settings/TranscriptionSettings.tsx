/* eslint-disable i18next/no-literal-string */
import { useCallback, useMemo, useRef, useState } from 'react';
import { v4 } from 'uuid';
import { Dropdown, TextareaAutosize, useToastContext } from '@librechat/client';
import type { ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  dataService,
  FileSources,
  QueryKeys,
  type TFile,
  type TTranscriptionSpeakerReference,
} from 'librechat-data-provider';
import type { TSettingsProps } from '~/common';
import { useUploadTranscriptionReferenceMutation } from '~/data-provider';
import { cn } from '~/utils';
import {
  DIARIZE_TRANSCRIPTION_MODEL,
  supportsTranscriptionPrompt,
  transcriptionModelOptions,
} from '~/components/Nav/SettingsTabs/Speech/STT/transcriptionModels';

function toBatchFile(speakerReference: TTranscriptionSpeakerReference) {
  return {
    file_id: speakerReference.file_id,
    filepath: speakerReference.filepath ?? '',
    embedded: speakerReference.embedded === true,
    source: (speakerReference.source as FileSources) || FileSources.local,
  };
}

const getSpeakerReferenceKey = (speakerReference: TTranscriptionSpeakerReference) =>
  speakerReference.id ?? speakerReference.file_id;

export default function TranscriptionSettings({
  conversation,
  setOption,
  readonly,
}: TSettingsProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [uploadingReferenceId, setUploadingReferenceId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const speakerReferences = useMemo(
    () => conversation?.transcriptionSpeakerReferences ?? [],
    [conversation?.transcriptionSpeakerReferences],
  );
  const transcriptionModel = conversation?.transcriptionModel ?? '';
  const transcriptionPrompt = conversation?.transcriptionPrompt ?? '';
  const promptLabelId = 'session-transcription-prompt-label';
  const promptSupported = supportsTranscriptionPrompt(transcriptionModel);
  const diarizeEnabled = transcriptionModel === DIARIZE_TRANSCRIPTION_MODEL;

  const setSpeakerReferences = useCallback(
    (nextSpeakerReferences: TTranscriptionSpeakerReference[]) =>
      setOption('transcriptionSpeakerReferences')(nextSpeakerReferences),
    [setOption],
  );

  const uploadReferenceMutation = useUploadTranscriptionReferenceMutation();

  const deleteSpeakerReferenceFile = useCallback(
    async (speakerReference: TTranscriptionSpeakerReference) => {
      if (!speakerReference.filepath) {
        return;
      }

      await dataService.deleteFiles({
        files: [toBatchFile(speakerReference)],
      });

      queryClient.setQueryData<TFile[] | undefined>([QueryKeys.files], (currentFiles) =>
        (currentFiles ?? []).filter((file) => file.file_id !== speakerReference.file_id),
      );
    },
    [queryClient],
  );

  const uploadReferenceFile = useCallback(
    async ({ file, name }: { file: File; name: string }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('file_id', v4());
      const uploadedReference = await uploadReferenceMutation.mutateAsync(formData);

      return {
        id: v4(),
        name,
        file_id: uploadedReference.file_id,
        filename: uploadedReference.filename,
        filepath: uploadedReference.filepath,
        type: uploadedReference.type,
        bytes: uploadedReference.bytes,
        durationSeconds:
          uploadedReference.metadata?.transcriptionReference?.durationSeconds ?? null,
        embedded: uploadedReference.embedded,
        source: uploadedReference.source,
      };
    },
    [uploadReferenceMutation],
  );

  const handleAddReference = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const name = newSpeakerName.trim();

      if (!file) {
        return;
      }

      if (!name) {
        showToast({
          message: 'Enter a speaker name before uploading a reference clip.',
          status: 'error',
        });
        event.target.value = '';
        return;
      }

      if (speakerReferences.length >= 4) {
        showToast({
          message: 'OpenAI diarized transcription supports up to 4 speaker reference clips.',
          status: 'error',
        });
        event.target.value = '';
        return;
      }

      setUploadingReferenceId('new');

      try {
        const speakerReference = await uploadReferenceFile({ file, name });
        setSpeakerReferences([...speakerReferences, speakerReference]);
        setNewSpeakerName('');
      } catch (error) {
        showToast({
          message:
            error instanceof Error ? error.message : 'Failed to upload the speaker reference clip.',
          status: 'error',
        });
      } finally {
        setUploadingReferenceId(null);
        event.target.value = '';
      }
    },
    [newSpeakerName, showToast, speakerReferences, uploadReferenceFile, setSpeakerReferences],
  );

  const handleReplaceReference = useCallback(
    async (speakerReference: TTranscriptionSpeakerReference, file?: File | null) => {
      if (!file) {
        return;
      }

      setUploadingReferenceId(speakerReference.id ?? speakerReference.file_id);

      try {
        const nextSpeakerReference = await uploadReferenceFile({
          file,
          name: speakerReference.name,
        });
        setSpeakerReferences(
          speakerReferences.map((reference) =>
            getSpeakerReferenceKey(reference) === getSpeakerReferenceKey(speakerReference)
              ? nextSpeakerReference
              : reference,
          ),
        );

        await deleteSpeakerReferenceFile(speakerReference);
      } catch (error) {
        showToast({
          message:
            error instanceof Error
              ? error.message
              : 'Failed to replace the speaker reference clip.',
          status: 'error',
        });
      } finally {
        setUploadingReferenceId(null);
      }
    },
    [
      deleteSpeakerReferenceFile,
      setSpeakerReferences,
      showToast,
      speakerReferences,
      uploadReferenceFile,
    ],
  );

  const handleRemoveReference = useCallback(
    async (speakerReference: TTranscriptionSpeakerReference) => {
      setSpeakerReferences(
        speakerReferences.filter(
          (reference) =>
            getSpeakerReferenceKey(reference) !== getSpeakerReferenceKey(speakerReference),
        ),
      );

      if (!speakerReference.filepath) {
        return;
      }

      try {
        await deleteSpeakerReferenceFile(speakerReference);
      } catch (error) {
        showToast({
          message:
            error instanceof Error ? error.message : 'Failed to remove the speaker reference clip.',
          status: 'error',
        });
      }
    },
    [deleteSpeakerReferenceFile, setSpeakerReferences, showToast, speakerReferences],
  );

  if (!conversation) {
    return null;
  }

  return (
    <div className="mt-6 border-t border-border-medium pt-6">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">Transcription settings</h3>
        <p className="mt-1 text-xs text-text-secondary">
          These settings stay with this chat session and are used for future audio or video uploads.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm text-text-primary">Transcription model</div>
            <div className="text-xs text-text-secondary">
              Choose the model used when attached audio or video files are auto-transcribed.
            </div>
          </div>
          <Dropdown
            value={transcriptionModel}
            onChange={(value) => setOption('transcriptionModel')(value)}
            options={transcriptionModelOptions}
            sizeClasses="w-[220px]"
            testId="SessionTranscriptionModelDropdown"
            className={cn('z-50', readonly && 'pointer-events-none opacity-70')}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div id={promptLabelId} className="text-sm text-text-primary">
            Transcription prompt
          </div>
          <TextareaAutosize
            value={transcriptionPrompt}
            onChange={(event) => setOption('transcriptionPrompt')(event.target.value)}
            minRows={3}
            disabled={readonly || !promptSupported}
            aria-labelledby={promptLabelId}
            className={cn(
              'w-full rounded-md border border-border-medium px-3 py-2 text-sm text-text-primary focus:outline-none dark:bg-transparent',
              (readonly || !promptSupported) && 'cursor-not-allowed opacity-70',
            )}
            placeholder={
              promptSupported
                ? 'Optional prompt to steer spelling, terminology, or context for the transcript.'
                : 'Prompt is unavailable for diarized transcription.'
            }
          />
          <div className="text-xs text-text-secondary">
            {promptSupported
              ? 'Used for Whisper, GPT-4o Transcribe, and GPT-4o Mini Transcribe.'
              : 'Diarized transcription does not accept prompts.'}
          </div>
        </div>

        {diarizeEnabled ? (
          <div className="flex flex-col gap-3 rounded-lg border border-border-medium p-4">
            <div>
              <div className="text-sm text-text-primary">Known speakers</div>
              <div className="text-xs text-text-secondary">
                Upload up to 4 short clips, each 2-10 seconds, to help diarized transcripts label
                speakers.
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-md border border-dashed border-border-medium p-3">
              <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                Speaker name
              </label>
              <input
                value={newSpeakerName}
                onChange={(event) => setNewSpeakerName(event.target.value)}
                disabled={readonly || speakerReferences.length >= 4}
                className="rounded-md border border-border-medium bg-transparent px-3 py-2 text-sm text-text-primary focus:outline-none"
                placeholder="e.g. Alice"
              />
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => addInputRef.current?.click()}
                  disabled={
                    readonly || speakerReferences.length >= 4 || uploadingReferenceId != null
                  }
                  className="rounded-md border border-border-medium px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {uploadingReferenceId === 'new' ? 'Uploading clip…' : 'Upload speaker clip'}
                </button>
                <span className="text-xs text-text-secondary">
                  {speakerReferences.length}/4 added
                </span>
              </div>
              <input
                ref={addInputRef}
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={handleAddReference}
                disabled={readonly || speakerReferences.length >= 4}
              />
            </div>

            <div className="flex flex-col gap-3">
              {speakerReferences.length === 0 ? (
                <div className="text-xs text-text-secondary">
                  No speaker reference clips added yet.
                </div>
              ) : (
                speakerReferences.map((speakerReference) => {
                  const referenceKey = getSpeakerReferenceKey(speakerReference);
                  const isUploading = uploadingReferenceId === referenceKey;

                  return (
                    <div
                      key={referenceKey}
                      className="flex flex-col gap-3 rounded-md border border-border-medium p-3"
                    >
                      <div className="flex flex-col gap-2">
                        <label className="text-xs font-medium uppercase tracking-wide text-text-secondary">
                          Speaker name
                        </label>
                        <input
                          value={speakerReference.name}
                          onChange={(event) =>
                            setSpeakerReferences(
                              speakerReferences.map((reference) =>
                                getSpeakerReferenceKey(reference) ===
                                getSpeakerReferenceKey(speakerReference)
                                  ? { ...reference, name: event.target.value }
                                  : reference,
                              ),
                            )
                          }
                          disabled={readonly}
                          className="rounded-md border border-border-medium bg-transparent px-3 py-2 text-sm text-text-primary focus:outline-none"
                        />
                      </div>
                      <div className="text-xs text-text-secondary">
                        {speakerReference.filename ?? 'Uploaded clip'}
                        {speakerReference.durationSeconds != null
                          ? ` • ${speakerReference.durationSeconds.toFixed(1)}s`
                          : ''}
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="rounded-md border border-border-medium px-3 py-2 text-sm text-text-primary transition-colors hover:bg-surface-hover">
                          <span>{isUploading ? 'Uploading…' : 'Replace clip'}</span>
                          <input
                            type="file"
                            accept="audio/*,video/*"
                            className="hidden"
                            disabled={readonly || isUploading}
                            onChange={(event) =>
                              void handleReplaceReference(speakerReference, event.target.files?.[0])
                            }
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleRemoveReference(speakerReference)}
                          disabled={readonly || isUploading}
                          className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-border-medium p-4 text-xs text-text-secondary">
            Speaker reference clips are available when using <strong>GPT-4o Diarize</strong>.
          </div>
        )}
      </div>
    </div>
  );
}
