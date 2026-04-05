import mongoose, { Schema } from 'mongoose';
import { FileContext, FileSources } from 'librechat-data-provider';
import type { IMongoFile } from '~/types';

const file: Schema<IMongoFile> = new Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
      required: true,
    },
    conversationId: {
      type: String,
      ref: 'Conversation',
      index: true,
    },
    messageId: {
      type: String,
      index: true,
    },
    file_id: {
      type: String,
      index: true,
      required: true,
    },
    temp_file_id: {
      type: String,
    },
    bytes: {
      type: Number,
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    filepath: {
      type: String,
      required: true,
    },
    object: {
      type: String,
      required: true,
      default: 'file',
    },
    embedded: {
      type: Boolean,
    },
    type: {
      type: String,
      required: true,
    },
    text: {
      type: String,
    },
    context: {
      type: String,
    },
    usage: {
      type: Number,
      required: true,
      default: 0,
    },
    source: {
      type: String,
      default: FileSources.local,
    },
    model: {
      type: String,
    },
    width: Number,
    height: Number,
    metadata: {
      fileIdentifier: String,
      nativeTool: String,
      ragProvider: String,
      ragModel: String,
      transcriptionReference: {
        durationSeconds: Number,
      },
      transcription: {
        status: {
          type: String,
          enum: ['queued', 'processing', 'completed', 'failed'],
        },
        requestedAt: Date,
        startedAt: Date,
        completedAt: Date,
        error: String,
        language: String,
        transcriptionModel: String,
        prompt: String,
        speakerReferences: [
          {
            id: String,
            name: String,
            file_id: String,
          },
        ],
        requestMessageId: String,
        responseMessageId: String,
        conversationId: String,
        chunkCount: Number,
        provider: String,
        model: String,
        converted: Boolean,
        attempts: Number,
        lockUntil: Date,
        lockedBy: String,
      },
      openai: {
        endpoint: String,
        model: String,
        fileId: String,
        vectorStoreId: String,
      },
    },
    expiresAt: {
      type: Date,
      expires: 3600, // 1 hour in seconds
    },
  },
  {
    timestamps: true,
  },
);

file.index({ createdAt: 1, updatedAt: 1 });
file.index(
  { filename: 1, conversationId: 1, context: 1 },
  { unique: true, partialFilterExpression: { context: FileContext.execute_code } },
);

export default file;
