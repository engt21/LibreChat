const { EModelEndpoint } = require('librechat-data-provider');

const DEFAULT_OPENAI_REALTIME_MODELS = ['gpt-realtime', 'gpt-realtime-mini', 'gpt-realtime-1.5'];
const DEFAULT_GEMINI_REALTIME_MODELS = ['gemini-live-2.5-flash-preview'];
const DEFAULT_XAI_REALTIME_MODELS = ['grok-voice-agent'];

const DEFAULT_PROVIDER_AUDIO = {
  [EModelEndpoint.openAI]: {
    defaultVoice: 'alloy',
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
    inputSampleRate: 24000,
    outputSampleRate: 24000,
    inputMimeType: 'audio/pcm',
    outputMimeType: 'audio/pcm',
  },
  [EModelEndpoint.azureOpenAI]: {
    defaultVoice: 'alloy',
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
    inputSampleRate: 24000,
    outputSampleRate: 24000,
    inputMimeType: 'audio/pcm',
    outputMimeType: 'audio/pcm',
  },
  [EModelEndpoint.google]: {
    defaultVoice: 'Kore',
    voices: ['Kore', 'Aoede', 'Puck', 'Fenrir'],
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    inputMimeType: 'audio/pcm;rate=16000',
    outputMimeType: 'audio/pcm;rate=24000',
  },
  xai: {
    defaultVoice: 'Eve',
    voices: ['Eve', 'Ara', 'Rex', 'Sal', 'Leo'],
    inputSampleRate: 16000,
    outputSampleRate: 16000,
    inputMimeType: 'audio/pcm',
    outputMimeType: 'audio/pcm',
  },
};

const OPENAI_REALTIME_MODEL_PATTERN = /(?:^|[-.])realtime(?:$|[-.])|(?:^|[-.])realtime$/i;
const GOOGLE_REALTIME_MODEL_PATTERN = /(?:^|[-.])(live|native-audio)(?:$|[-.])/i;
const XAI_REALTIME_MODEL_PATTERN = /(?:^|[-.])(voice(?:-agent)?|realtime)(?:$|[-.])/i;

const uniqueModels = (models = []) => [...new Set(models.filter(Boolean))].sort();

const isOpenAIRealtimeModel = (model = '') => OPENAI_REALTIME_MODEL_PATTERN.test(model);

const isGoogleRealtimeModel = (model = '') => GOOGLE_REALTIME_MODEL_PATTERN.test(model);

const isXAIRealtimeModel = (model = '') => XAI_REALTIME_MODEL_PATTERN.test(model);

module.exports = {
  DEFAULT_OPENAI_REALTIME_MODELS,
  DEFAULT_GEMINI_REALTIME_MODELS,
  DEFAULT_XAI_REALTIME_MODELS,
  DEFAULT_PROVIDER_AUDIO,
  isOpenAIRealtimeModel,
  isGoogleRealtimeModel,
  isXAIRealtimeModel,
  uniqueModels,
};
