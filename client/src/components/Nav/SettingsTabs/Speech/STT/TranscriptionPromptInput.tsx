/* eslint-disable i18next/no-literal-string */
import React from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { TextareaAutosize } from '@librechat/client';
import store from '~/store';
import { cn } from '~/utils';
import { supportsTranscriptionPrompt } from './transcriptionModels';

export default function TranscriptionPromptInput() {
  const transcriptionModel = useRecoilValue<string>(store.transcriptionModel);
  const [transcriptionPrompt, setTranscriptionPrompt] = useRecoilState<string>(
    store.transcriptionPrompt,
  );

  const promptSupported = supportsTranscriptionPrompt(transcriptionModel);
  const labelId = 'transcription-prompt-label';
  const descriptionId = 'transcription-prompt-description';

  return (
    <div className="flex flex-col gap-2">
      <div id={labelId}>Transcription Prompt</div>
      <TextareaAutosize
        value={transcriptionPrompt}
        onChange={(event) => setTranscriptionPrompt(event.target.value)}
        minRows={3}
        disabled={!promptSupported}
        className={cn(
          'w-full rounded-md border border-border-medium px-3 py-2 text-sm text-text-primary focus:outline-none dark:bg-transparent',
          !promptSupported && 'cursor-not-allowed opacity-70',
        )}
        placeholder={
          promptSupported
            ? 'Optional prompt to steer spelling, terminology, or context for the transcript.'
            : 'Prompt is unavailable for diarized transcription.'
        }
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
      />
      <div id={descriptionId} className="text-xs text-text-secondary">
        {promptSupported
          ? 'Used for Whisper, GPT-4o Transcribe, and GPT-4o Mini Transcribe. Leave blank to use the model defaults.'
          : 'Diarized transcription does not accept prompts, so this field is disabled.'}
      </div>
    </div>
  );
}
