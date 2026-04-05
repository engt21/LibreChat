import { EToolResources } from './assistants';
import type { TConversation, TMessage } from '../schemas';

export enum FileSources {
  local = 'local',
  firebase = 'firebase',
  azure = 'azure',
  azure_blob = 'azure_blob',
  openai = 'openai',
  s3 = 's3',
  vectordb = 'vectordb',
  execute_code = 'execute_code',
  mistral_ocr = 'mistral_ocr',
  azure_mistral_ocr = 'azure_mistral_ocr',
  vertexai_mistral_ocr = 'vertexai_mistral_ocr',
  text = 'text',
  document_parser = 'document_parser',
}

export const checkOpenAIStorage = (source: string) =>
  source === FileSources.openai || source === FileSources.azure;

export enum FileContext {
  avatar = 'avatar',
  unknown = 'unknown',
  agents = 'agents',
  assistants = 'assistants',
  execute_code = 'execute_code',
  image_generation = 'image_generation',
  assistants_output = 'assistants_output',
  transcription_reference = 'transcription_reference',
  message_attachment = 'message_attachment',
  filename = 'filename',
  updatedAt = 'updatedAt',
  source = 'source',
  filterSource = 'filterSource',
  context = 'context',
  bytes = 'bytes',
}

export type EndpointFileConfig = {
  disabled?: boolean;
  fileLimit?: number;
  fileSizeLimit?: number;
  totalSizeLimit?: number;
  supportedMimeTypes?: RegExp[];
};

export type FileConfig = {
  endpoints: {
    [key: string]: EndpointFileConfig;
  };
  fileTokenLimit?: number;
  serverFileSizeLimit?: number;
  avatarSizeLimit?: number;
  clientImageResize?: {
    enabled?: boolean;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  };
  ocr?: {
    supportedMimeTypes?: RegExp[];
  };
  text?: {
    supportedMimeTypes?: RegExp[];
  };
  stt?: {
    supportedMimeTypes?: RegExp[];
  };
  checkType?: (fileType: string, supportedTypes: RegExp[]) => boolean;
};

export type FileConfigInput = {
  endpoints?: {
    [key: string]: EndpointFileConfig;
  };
  serverFileSizeLimit?: number;
  avatarSizeLimit?: number;
  clientImageResize?: {
    enabled?: boolean;
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
  };
  ocr?: {
    supportedMimeTypes?: string[];
  };
  text?: {
    supportedMimeTypes?: string[];
  };
  stt?: {
    supportedMimeTypes?: string[];
  };
  checkType?: (fileType: string, supportedTypes: RegExp[]) => boolean;
};

export type TFile = {
  _id?: string;
  __v?: number;
  user: string;
  conversationId?: string;
  message?: string;
  file_id: string;
  temp_file_id?: string;
  bytes: number;
  embedded: boolean;
  filename: string;
  filepath: string;
  object: 'file';
  type: string;
  usage: number;
  context?: FileContext;
  source?: FileSources;
  filterSource?: FileSources;
  width?: number;
  height?: number;
  expiresAt?: string | Date;
  preview?: string;
  metadata?: {
    fileIdentifier?: string;
    nativeTool?: EToolResources;
    ragProvider?: string;
    ragModel?: string;
    transcriptionReference?: {
      durationSeconds?: number | null;
    };
    transcription?: {
      status?: 'queued' | 'processing' | 'completed' | 'failed';
      requestedAt?: string | Date | null;
      startedAt?: string | Date | null;
      completedAt?: string | Date | null;
      error?: string | null;
      language?: string | null;
      transcriptionModel?: string | null;
      prompt?: string | null;
      speakerReferences?: {
        id?: string;
        name: string;
        file_id: string;
      }[];
      requestMessageId?: string | null;
      responseMessageId?: string | null;
      conversationId?: string | null;
      chunkCount?: number | null;
      provider?: string | null;
      model?: string | null;
      converted?: boolean;
      attempts?: number;
      lockUntil?: string | Date | null;
      lockedBy?: string | null;
    };
    openai?: {
      endpoint?: string;
      model?: string;
      fileId?: string;
      vectorStoreId?: string;
    };
  };
  createdAt?: string | Date;
  updatedAt?: string | Date;
};

export type TFileUpload = TFile & {
  temp_file_id: string;
};

export type AvatarUploadResponse = {
  url: string;
};

export type SpeechToTextResponse = {
  text: string;
};

export type StartAudioTranscriptionRequest = {
  file_id: string;
  conversationId?: string;
  endpoint?: string;
  endpointType?: string;
  model?: string;
  agent_id?: string;
  assistant_id?: string;
  spec?: string;
  iconURL?: string;
  language?: string;
  transcriptionModel?: string;
  prompt?: string;
  speakerReferences?: {
    id?: string;
    name: string;
    file_id: string;
  }[];
};

export type StartAudioTranscriptionResponse = {
  conversation: TConversation;
  messages: TMessage[];
  responseMessageId: string;
};

export type VoiceResponse = string[];

export type UploadMutationOptions = {
  onSuccess?: (data: TFileUpload, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type UploadAvatarOptions = {
  onSuccess?: (data: AvatarUploadResponse, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type SpeechToTextOptions = {
  onSuccess?: (data: SpeechToTextResponse, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type TextToSpeechOptions = {
  onSuccess?: (data: ArrayBuffer, variables: FormData, context?: unknown) => void;
  onMutate?: (variables: FormData) => void | Promise<unknown>;
  onError?: (error: unknown, variables: FormData, context?: unknown) => void;
};

export type VoiceOptions = {
  onSuccess?: (data: VoiceResponse, variables: unknown, context?: unknown) => void;
  onMutate?: () => void | Promise<unknown>;
  onError?: (error: unknown, variables: unknown, context?: unknown) => void;
};

export type DeleteFilesResponse = {
  message: string;
  result: Record<string, unknown>;
};

export type BatchFile = {
  file_id: string;
  filepath: string;
  embedded: boolean;
  source: FileSources;
  temp_file_id?: string;
};

export type DeleteFilesBody = {
  files: BatchFile[];
  agent_id?: string;
  assistant_id?: string;
  tool_resource?: EToolResources;
};

export type DeleteMutationOptions = {
  onSuccess?: (data: DeleteFilesResponse, variables: DeleteFilesBody, context?: unknown) => void;
  onMutate?: (variables: DeleteFilesBody) => void | Promise<unknown>;
  onError?: (error: unknown, variables: DeleteFilesBody, context?: unknown) => void;
};
