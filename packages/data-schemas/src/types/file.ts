import { Document, Types } from 'mongoose';

export interface IMongoFile extends Omit<Document, 'model'> {
  user: Types.ObjectId;
  conversationId?: string;
  messageId?: string;
  file_id: string;
  temp_file_id?: string;
  bytes: number;
  text?: string;
  filename: string;
  filepath: string;
  object: 'file';
  embedded?: boolean;
  type: string;
  context?: string;
  usage: number;
  source: string;
  model?: string;
  width?: number;
  height?: number;
  metadata?: {
    fileIdentifier?: string;
    nativeTool?: string;
    originalFilepath?: string;
    ragProvider?: string;
    ragModel?: string;
    transcription?: {
      status?: 'queued' | 'processing' | 'completed' | 'failed';
      requestedAt?: Date | null;
      startedAt?: Date | null;
      completedAt?: Date | null;
      error?: string | null;
      language?: string | null;
      transcriptionModel?: string | null;
      prompt?: string | null;
      requestMessageId?: string | null;
      responseMessageId?: string | null;
      conversationId?: string | null;
      chunkCount?: number | null;
      provider?: string | null;
      model?: string | null;
      converted?: boolean;
      attempts?: number;
      lockUntil?: Date | null;
      lockedBy?: string | null;
    };
    openai?: {
      endpoint?: string;
      model?: string;
      fileId?: string;
      vectorStoreId?: string;
    };
  };
  expiresAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}
