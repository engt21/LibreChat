import { Schema } from 'mongoose';
import type { IMemoryEvent } from '~/types/memory';

const MemoryEventSchema: Schema<IMemoryEvent> = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    conversationId: { type: String, index: true },
    messageId: { type: String, index: true },
    responseMessageId: { type: String },
    intent: { type: String, enum: ['save', 'delete', 'none'], required: true },
    key: { type: String },
    status: {
      type: String,
      enum: ['saved', 'deleted', 'rejected', 'failed', 'no_action'],
      required: true,
    },
    model: { type: String },
    promptVersion: { type: String },
    evidence: { type: String },
    reason: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

MemoryEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export default MemoryEventSchema;
