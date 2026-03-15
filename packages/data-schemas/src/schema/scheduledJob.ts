import { Schema } from 'mongoose';
import type { IScheduledJob } from '~/types';

const notificationChannelsSchema = new Schema(
  {
    email: {
      type: Boolean,
      default: false,
    },
    sms: {
      type: Boolean,
      default: false,
    },
    push: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const scheduledJobSchema = new Schema<IScheduledJob>(
  {
    scheduleId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: String,
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    prompt: {
      type: String,
      required: true,
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: true,
      index: true,
    },
    cron: {
      type: String,
      required: true,
      trim: true,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
    },
    notifications: {
      type: notificationChannelsSchema,
      default: () => ({ email: false, sms: false, push: false }),
    },
    target: {
      type: Schema.Types.Mixed,
      required: true,
    },
    nextRunAt: {
      type: Date,
      required: true,
      index: true,
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    lastFinishedAt: {
      type: Date,
      default: null,
    },
    lastStatus: {
      type: String,
      enum: ['idle', 'running', 'succeeded', 'failed'],
      default: 'idle',
    },
    lastError: {
      type: String,
      default: null,
    },
    lastConversationId: {
      type: String,
      default: null,
    },
    lastResponseMessageId: {
      type: String,
      default: null,
    },
    lastResponsePreview: {
      type: String,
      default: null,
    },
    lastNotificationResults: {
      type: Schema.Types.Mixed,
      default: null,
    },
    runCount: {
      type: Number,
      default: 0,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    currentRunId: {
      type: String,
      default: null,
    },
    lockUntil: {
      type: Date,
      default: null,
    },
    lockedBy: {
      type: String,
      default: null,
    },
    lastTriggeredBy: {
      type: String,
      enum: ['scheduler', 'manual'],
      default: null,
    },
  },
  { timestamps: true },
);

scheduledJobSchema.index({ user: 1, createdAt: -1 });
scheduledJobSchema.index({ enabled: 1, nextRunAt: 1, lockUntil: 1 });

export default scheduledJobSchema;
