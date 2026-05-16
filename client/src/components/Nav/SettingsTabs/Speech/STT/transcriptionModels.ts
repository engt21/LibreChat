export const DEFAULT_TRANSCRIPTION_MODEL = '';
export const DIARIZE_TRANSCRIPTION_MODEL = 'gpt-4o-transcribe-diarize';

export const transcriptionModelOptions = [
  { value: DEFAULT_TRANSCRIPTION_MODEL, label: 'Default (config)' },
  { value: 'whisper-1', label: 'Whisper-1' },
  { value: 'gpt-4o-transcribe', label: 'GPT-4o Transcribe' },
  { value: 'gpt-4o-mini-transcribe', label: 'GPT-4o Mini Transcribe' },
  { value: DIARIZE_TRANSCRIPTION_MODEL, label: 'GPT-4o Diarize' },
];

export const supportsTranscriptionPrompt = (model: string) => model !== DIARIZE_TRANSCRIPTION_MODEL;
