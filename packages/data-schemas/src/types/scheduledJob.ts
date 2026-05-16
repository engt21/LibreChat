import type { Document, Types } from 'mongoose';

export type ScheduledJobTarget = {
  endpoint: string;
  endpointType?: string;
  agent_id?: string;
  model?: string;
  promptPrefix?: string;
  spec?: string;
  ephemeralAgent?: {
    web_search?: boolean;
    web_search_mode?: string;
    file_search?: boolean;
    execute_code?: boolean;
    execute_code_mode?: string;
    mcp?: string[];
    artifacts?: string;
  };
};

export type ScheduledJobNotificationChannels = {
  email?: boolean;
  sms?: boolean;
  push?: boolean;
};

export type ScheduledJobNotificationResult = {
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  destination?: string;
  provider?: string;
  details?: Record<string, unknown>;
};

export type ScheduledJob = {
  scheduleId: string;
  user: string;
  name: string;
  prompt: string;
  enabled?: boolean;
  cron: string;
  timezone: string;
  notifications?: ScheduledJobNotificationChannels;
  target: ScheduledJobTarget;
  nextRunAt: Date;
  lastRunAt?: Date | null;
  lastFinishedAt?: Date | null;
  lastStatus?: 'idle' | 'running' | 'succeeded' | 'failed';
  lastError?: string | null;
  lastConversationId?: string | null;
  lastResponseMessageId?: string | null;
  lastResponsePreview?: string | null;
  lastNotificationResults?: Record<string, ScheduledJobNotificationResult> | null;
  runCount?: number;
  failureCount?: number;
  currentRunId?: string | null;
  lockUntil?: Date | null;
  lockedBy?: string | null;
  lastTriggeredBy?: 'scheduler' | 'manual' | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type IScheduledJob = ScheduledJob &
  Document & {
    _id: Types.ObjectId;
  };
