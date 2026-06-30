import { Schema } from 'mongoose';
import type { MCPServerDocument } from '~/types';

const mcpServerSchema = new Schema<MCPServerDocument>(
  {
    serverName: {
      type: String,
      index: true,
      unique: true,
      required: true,
    },
    config: {
      type: Schema.Types.Mixed,
      required: true,
      // Config contains: title, description, url, oauth, etc.
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    publishedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: undefined,
    },
    publishedAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

mcpServerSchema.index({ updatedAt: -1, _id: 1 });

export default mcpServerSchema;
