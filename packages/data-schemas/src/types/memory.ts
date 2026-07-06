import type { Types, Document } from 'mongoose';

// Base memory interfaces
export interface IMemoryEntry extends Document {
  userId: Types.ObjectId;
  key: string;
  value: string;
  tokenCount?: number;
  updated_at?: Date;
  source?: 'automatic' | 'manual';
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceResponseMessageId?: string;
  sourceModel?: string;
  promptVersion?: string;
  evidence?: string;
}

export interface IMemoryEntryLean {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  key: string;
  value: string;
  tokenCount?: number;
  updated_at?: Date;
  source?: 'automatic' | 'manual';
  sourceConversationId?: string;
  sourceMessageId?: string;
  sourceResponseMessageId?: string;
  sourceModel?: string;
  promptVersion?: string;
  evidence?: string;
  __v?: number;
}

// Method parameter interfaces
export interface SetMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
  value: string;
  tokenCount?: number;
  metadata?: MemorySourceMetadata;
}

export interface MemorySourceMetadata {
  source?: 'automatic' | 'manual';
  conversationId?: string;
  messageId?: string;
  responseMessageId?: string;
  model?: string;
  promptVersion?: string;
  evidence?: string;
}

export type MemoryEventStatus = 'saved' | 'deleted' | 'rejected' | 'failed' | 'no_action';

export interface IMemoryEvent extends Document {
  userId: Types.ObjectId;
  conversationId?: string;
  messageId?: string;
  responseMessageId?: string;
  intent: 'save' | 'delete' | 'none';
  key?: string;
  status: MemoryEventStatus;
  model?: string;
  promptVersion?: string;
  evidence?: string;
  reason?: string;
  createdAt?: Date;
}

export interface RecordMemoryEventParams {
  userId: string | Types.ObjectId;
  conversationId?: string;
  messageId?: string;
  responseMessageId?: string;
  intent: 'save' | 'delete' | 'none';
  key?: string;
  status: MemoryEventStatus;
  model?: string;
  promptVersion?: string;
  evidence?: string;
  reason?: string;
}

export interface DeleteMemoryParams {
  userId: string | Types.ObjectId;
  key: string;
}

export interface GetFormattedMemoriesParams {
  userId: string | Types.ObjectId;
}

// Result interfaces
export interface MemoryResult {
  ok: boolean;
  changed?: boolean;
}

export interface FormattedMemoriesResult {
  withKeys: string;
  withoutKeys: string;
  totalTokens?: number;
  tokenCountsByKey?: Record<string, number>;
}
