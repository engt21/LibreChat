import mongoose, { Schema, Document, Types } from 'mongoose';

const TRANSACTION_PRICING_SOURCES = ['catalog', 'endpoint_config', 'fallback'] as const;

// @ts-ignore
export interface ITransaction extends Document {
  user: Types.ObjectId;
  conversationId?: string;
  tokenType: 'prompt' | 'completion' | 'credits';
  model?: string;
  endpoint?: string;
  context?: string;
  valueKey?: string;
  rate?: number;
  rawAmount?: number;
  tokenValue?: number;
  inputTokens?: number;
  writeTokens?: number;
  readTokens?: number;
  messageId?: string;
  inputTokenCount?: number;
  rateDetail?: Record<string, number>;
  pricingSource?: (typeof TRANSACTION_PRICING_SOURCES)[number];
  pricingSourceDetail?: Record<string, (typeof TRANSACTION_PRICING_SOURCES)[number]>;
  createdAt?: Date;
  updatedAt?: Date;
}

const transactionSchema: Schema<ITransaction> = new Schema(
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
    tokenType: {
      type: String,
      enum: ['prompt', 'completion', 'credits'],
      required: true,
    },
    model: {
      type: String,
      index: true,
    },
    endpoint: {
      type: String,
      index: true,
    },
    context: {
      type: String,
    },
    valueKey: {
      type: String,
    },
    rate: Number,
    rawAmount: Number,
    tokenValue: Number,
    inputTokens: { type: Number },
    writeTokens: { type: Number },
    readTokens: { type: Number },
    messageId: { type: String },
    inputTokenCount: { type: Number },
    rateDetail: {
      type: Map,
      of: Number,
    },
    pricingSource: {
      type: String,
      enum: TRANSACTION_PRICING_SOURCES,
    },
    pricingSourceDetail: {
      type: Map,
      of: {
        type: String,
        enum: TRANSACTION_PRICING_SOURCES,
      },
    },
  },
  {
    timestamps: true,
  },
);

export default transactionSchema;
