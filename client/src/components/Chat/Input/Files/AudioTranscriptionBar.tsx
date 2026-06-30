/* eslint-disable i18next/no-literal-string */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { v4 } from 'uuid';
import { useRecoilState } from 'recoil';
import { Dropdown, TextareaAutosize, useToastContext } from '@librechat/client';
import { useQueryClient } from '@tanstack/react-query';
import { EToolResources, FileSources, QueryKeys } from 'librechat-data-provider';
import type { ExtendedFile } from '~/common';
import { useChatContext } from '~/Providers';
import { useUploadTranscriptionReferenceMutation } from '~/data-provider';
import store from '~/store';
import { cn } from '~/utils';
import {
  DIARIZE_TRANSCRIPTION_MODEL,
  supportsTranscriptionPrompt,
  transcriptionModelOptions,
} from '~/components/Nav/SettingsTabs/Speech/STT/transcriptionModels';

interface SpeakerRef {
  id: string;
  name: string;
  file_id: string;
  filename?: string;
}

interface AudioTranscriptionBarProps {
  onTranscribe: (
    fileId: string,
    filename: string,
    speakerRefs?: Array<{ id?: string; name: string; file_id: string }>,
  ) => void;
  isTranscribing: boolean;
}

const isCodeInterpreterAttachment = (file: ExtendedFile) =>
  file.tool_resource === EToolResources.execute_code ||
  file.source === FileSources.execute_code ||
  file.metadata?.nativeTool === EToolResources.execute_code ||
  Boolean(file.metadata?.fileIdentifier);

export const getAudioTranscriptionFiles = (files?: Map<string, ExtendedFile>) => {
  const result: Array<{ fileId: string; filename: string }> = [];
  if (!files) {
    return result;
  }

  files.forEach((file, key) => {
    if (isCodeInterpreterAttachment(file)) {
      return;
    }
    const type = file.type ?? '';
    if (type.startsWith('audio/') || type.startsWith('video/')) {
      result.push({ fileId: key, filename: file.filename ?? 'audio' });
    }
  });

  return result;
};

export default function AudioTranscriptionBar({
  onTranscribe,
  isTranscribing,
}: AudioTranscriptionBarProps) {
  const { files } = useChatContext();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const [transcriptionModel, setTranscriptionModel] = useRecoilState<string>(
    store.transcriptionModel,
  );
  const [transcriptionPrompt, setTranscriptionPrompt] = useRecoilState<string>(
    store.transcriptionPrompt,
  );

  const [promptExpanded, setPromptExpanded] = useState(false);
  const [speakersExpanded, setSpeakersExpanded] = useState(false);
  const [speakers, setSpeakers] = useState<SpeakerRef[]>([]);
  const [newSpeakerName, setNewSpeakerName] = useState('');
  const [uploadingSpeaker, setUploadingSpeaker] = useState(false);
  const addSpeakerInputRef = useRef<HTMLInputElement>(null);

  const uploadReferenceMutation = useUploadTranscriptionReferenceMutation();

  const audioFiles = useMemo(() => getAudioTranscriptionFiles(files), [files]);

  const handleAddSpeakerClip = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const name = newSpeakerName.trim();
      if (!file) {
        return;
      }
      if (!name) {
        showToast({ message: 'Enter a speaker name first.', status: 'error' });
        event.target.value = '';
        return;
      }
      if (speakers.length >= 4) {
        showToast({ message: 'Maximum 4 speaker reference clips.', status: 'error' });
        event.target.value = '';
        return;
      }

      setUploadingSpeaker(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('file_id', v4());
        const uploaded = await uploadReferenceMutation.mutateAsync(formData);
        setSpeakers((prev) => [
          ...prev,
          {
            id: v4(),
            name,
            file_id: uploaded.file_id,
            filename: uploaded.filename,
          },
        ]);
        setNewSpeakerName('');
        queryClient.invalidateQueries([QueryKeys.files]);
      } catch (err) {
        showToast({
          message: err instanceof Error ? err.message : 'Upload failed.',
          status: 'error',
        });
      } finally {
        setUploadingSpeaker(false);
        event.target.value = '';
      }
    },
    [newSpeakerName, speakers.length, showToast, uploadReferenceMutation, queryClient],
  );

  const handleRemoveSpeaker = useCallback((id: string) => {
    setSpeakers((prev) => prev.filter((s) => s.id !== id));
  }, []);

  if (audioFiles.length === 0) {
    return null;
  }

  const promptSupported = supportsTranscriptionPrompt(transcriptionModel);
  const diarizeEnabled = transcriptionModel === DIARIZE_TRANSCRIPTION_MODEL;

  const handleTranscribe = () => {
    const speakerRefs = diarizeEnabled && speakers.length > 0 ? speakers : undefined;
    for (const { fileId, filename } of audioFiles) {
      onTranscribe(fileId, filename, speakerRefs);
    }
  };

  const stopPropagation = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      onClick={stopPropagation}
      onMouseDown={stopPropagation}
      className={cn(
        'mx-2 mb-1 flex flex-col gap-2 rounded-lg border border-border-medium px-3 py-2',
        'bg-surface-secondary dark:bg-surface-secondary',
      )}
    >
      {/* Row 1: model + prompt toggle + transcribe button */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Model selector */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-text-secondary">Model:</span>
          <Dropdown
            value={transcriptionModel}
            onChange={setTranscriptionModel}
            options={transcriptionModelOptions}
            sizeClasses="w-[180px]"
            testId="AudioTranscriptionBarModelDropdown"
          />
        </div>

        {/* Prompt toggle / inline */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {!promptExpanded ? (
            <button
              type="button"
              onClick={() => setPromptExpanded(true)}
              disabled={!promptSupported}
              className={cn(
                'rounded-md border border-border-medium px-2.5 py-1 text-xs text-text-secondary transition-colors',
                'hover:bg-surface-tertiary dark:hover:bg-surface-tertiary',
                !promptSupported && 'cursor-not-allowed opacity-50',
              )}
            >
              {transcriptionPrompt ? 'Edit prompt...' : 'Add prompt...'}
            </button>
          ) : (
            <div className="flex min-w-0 flex-1 items-start gap-1.5">
              <TextareaAutosize
                value={transcriptionPrompt}
                onChange={(e) => setTranscriptionPrompt(e.target.value)}
                onFocus={(e) => e.stopPropagation()}
                minRows={1}
                maxRows={4}
                disabled={!promptSupported}
                className={cn(
                  'min-w-0 flex-1 rounded-md border border-border-medium px-2.5 py-1 text-xs text-text-primary',
                  'focus:outline-none dark:bg-transparent',
                  !promptSupported && 'cursor-not-allowed opacity-70',
                )}
                placeholder="Prompt to guide transcription (spelling, terminology, context)..."
                aria-label="Transcription Prompt"
              />
              <button
                type="button"
                onClick={() => setPromptExpanded(false)}
                className="mt-0.5 text-xs text-text-secondary hover:text-text-primary"
                aria-label="Close prompt"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* Diarize speakers toggle */}
        {diarizeEnabled && (
          <button
            type="button"
            onClick={() => setSpeakersExpanded((prev) => !prev)}
            className={cn(
              'rounded-md border border-border-medium px-2.5 py-1 text-xs transition-colors',
              speakersExpanded
                ? 'border-blue-500/60 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                : 'text-text-secondary hover:bg-surface-tertiary',
            )}
          >
            Speakers ({speakers.length}/4)
          </button>
        )}

        {/* Transcribe button */}
        <button
          type="button"
          onClick={handleTranscribe}
          disabled={isTranscribing}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors',
            'bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700',
            isTranscribing && 'cursor-not-allowed opacity-60',
          )}
        >
          {isTranscribing ? 'Transcribing...' : 'Transcribe'}
        </button>
      </div>

      {/* Row 2: Speaker references (visible when diarize + expanded) */}
      {diarizeEnabled && speakersExpanded && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border-medium p-2">
          <div className="text-xs text-text-secondary">
            Upload 2-10 second clips of each speaker. Up to 4 speakers.
          </div>

          {/* Existing speakers */}
          {speakers.map((speaker) => (
            <div
              key={speaker.id}
              className="flex items-center gap-2 rounded-md border border-border-medium px-2 py-1"
            >
              <span className="text-xs font-medium text-text-primary">{speaker.name}</span>
              <span className="text-xs text-text-secondary">{speaker.filename ?? 'clip'}</span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => handleRemoveSpeaker(speaker.id)}
                className="text-xs text-red-500 hover:text-red-600"
              >
                Remove
              </button>
            </div>
          ))}

          {/* Add new speaker */}
          {speakers.length < 4 && (
            <div className="flex items-center gap-2">
              <input
                value={newSpeakerName}
                onChange={(e) => setNewSpeakerName(e.target.value)}
                onFocus={(e) => e.stopPropagation()}
                placeholder="Speaker name"
                className="rounded-md border border-border-medium bg-transparent px-2 py-1 text-xs text-text-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={() => addSpeakerInputRef.current?.click()}
                disabled={uploadingSpeaker || !newSpeakerName.trim()}
                className={cn(
                  'rounded-md border border-border-medium px-2 py-1 text-xs text-text-secondary transition-colors',
                  'hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50',
                )}
              >
                {uploadingSpeaker ? 'Uploading...' : 'Upload clip'}
              </button>
              <input
                ref={addSpeakerInputRef}
                type="file"
                accept="audio/*,video/*"
                className="hidden"
                onChange={handleAddSpeakerClip}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
