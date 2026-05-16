import type { TConversation } from './schemas';

export type TRealtimeProviderType = 'openai' | 'azure' | 'google' | 'xai';

export type TRealtimeAudioConfig = {
  defaultVoice?: string;
  voices?: string[];
  inputSampleRate: number;
  outputSampleRate: number;
  inputMimeType: string;
  outputMimeType: string;
};

export type TRealtimeProviderDescriptor = TRealtimeAudioConfig & {
  endpoint: string;
  provider: TRealtimeProviderType;
  label: string;
  available: boolean;
  requiresUserKey?: boolean;
  reason?: string;
  models: string[];
  defaultModel?: string;
};

export type TRealtimeModelsResponse = {
  wsPath: string;
  providers: TRealtimeProviderDescriptor[];
};

export type TRealtimeConversationEntry = {
  role: 'user' | 'assistant';
  text: string;
  source: 'voice' | 'text';
};

export type TSaveRealtimeConversationRequest = {
  endpoint: string;
  model: string;
  instructions?: string;
  startedAt?: string;
  endedAt?: string;
  entries: TRealtimeConversationEntry[];
};

export type TSaveRealtimeConversationResponse = TConversation;
