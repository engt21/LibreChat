import { z } from 'zod';
import { CodeInterpreterModes, WebSearchModes } from './config';

export const scheduledJobNotificationChannelsSchema = z.object({
  email: z.boolean().default(false),
  sms: z.boolean().default(false),
  push: z.boolean().default(false),
});

export type TScheduledJobNotificationChannels = z.infer<
  typeof scheduledJobNotificationChannelsSchema
>;

export const scheduledJobTargetSchema = z.object({
  endpoint: z.string(),
  endpointType: z.string().optional(),
  agent_id: z.string().optional(),
  model: z.string().optional(),
  promptPrefix: z.string().optional(),
  spec: z.string().optional(),
  ephemeralAgent: z
    .object({
      web_search: z.boolean().optional(),
      web_search_mode: z.nativeEnum(WebSearchModes).optional(),
      file_search: z.boolean().optional(),
      execute_code: z.boolean().optional(),
      execute_code_mode: z.nativeEnum(CodeInterpreterModes).optional(),
      artifacts: z.string().optional(),
      mcp: z.array(z.string()).optional(),
      image_generation: z.boolean().optional(),
    })
    .optional(),
});

export type TScheduledJobTarget = z.infer<typeof scheduledJobTargetSchema>;

export const scheduledJobNotificationResultSchema = z.object({
  status: z.enum(['sent', 'skipped', 'failed']),
  reason: z.string().optional(),
  destination: z.string().optional(),
  provider: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const scheduledJobSchema = z.object({
  _id: z.string().optional(),
  scheduleId: z.string(),
  user: z.string(),
  name: z.string(),
  prompt: z.string(),
  enabled: z.boolean(),
  cron: z.string(),
  timezone: z.string(),
  notifications: scheduledJobNotificationChannelsSchema,
  target: scheduledJobTargetSchema,
  nextRunAt: z.string().or(z.date()),
  lastRunAt: z.string().or(z.date()).nullable().optional(),
  lastFinishedAt: z.string().or(z.date()).nullable().optional(),
  lastStatus: z.enum(['idle', 'running', 'succeeded', 'failed']).optional(),
  lastError: z.string().nullable().optional(),
  lastConversationId: z.string().nullable().optional(),
  lastResponseMessageId: z.string().nullable().optional(),
  lastResponsePreview: z.string().nullable().optional(),
  lastNotificationResults: z
    .record(z.string(), scheduledJobNotificationResultSchema)
    .nullable()
    .optional(),
  runCount: z.number().optional(),
  failureCount: z.number().optional(),
  lockUntil: z.string().or(z.date()).nullable().optional(),
  createdAt: z.string().or(z.date()).optional(),
  updatedAt: z.string().or(z.date()).optional(),
  isRunning: z.boolean().optional(),
});

export type TScheduledJob = z.infer<typeof scheduledJobSchema>;

export const scheduledJobsSchema = z.array(scheduledJobSchema);

export const scheduledJobNotificationSettingsSchema = z.object({
  email: z.object({
    enabled: z.boolean(),
    address: z.string().default(''),
    verified: z.boolean().optional(),
  }),
  sms: z.object({
    enabled: z.boolean(),
    provider: z.enum(['twilio', 'carrier_gateway']).default('twilio'),
    phoneNumber: z.string().default(''),
    gatewayAddress: z.string().default(''),
  }),
  push: z.object({
    enabled: z.boolean(),
    subscriptionCount: z.number(),
  }),
  capabilities: z.object({
    email: z.boolean(),
    sms: z.boolean(),
    smsProviders: z.object({
      twilio: z.boolean(),
      carrierGateway: z.boolean(),
    }),
    push: z.boolean(),
    pushPublicKey: z.string().nullable().optional(),
  }),
});

export type TScheduledJobNotificationSettings = z.infer<
  typeof scheduledJobNotificationSettingsSchema
>;

export const scheduledJobRunResultSchema = z.object({
  schedule: scheduledJobSchema.optional().nullable(),
  executionResult: z.object({
    conversationId: z.string().nullable(),
    responseMessageId: z.string().nullable(),
    preview: z.string().nullable(),
  }),
  notificationResults: z.record(z.string(), scheduledJobNotificationResultSchema).optional(),
});

export type TScheduledJobRunResult = z.infer<typeof scheduledJobRunResultSchema>;

export type TScheduledJobCreatePayload = {
  name: string;
  prompt: string;
  enabled?: boolean;
  cron: string;
  timezone: string;
  notifications: TScheduledJobNotificationChannels;
  target: TScheduledJobTarget;
};

export type TScheduledJobUpdatePayload = Partial<TScheduledJobCreatePayload>;

export type TScheduledJobNotificationUpdatePayload = {
  email?: {
    enabled?: boolean;
    address?: string;
  };
  sms?: {
    enabled?: boolean;
    provider?: 'twilio' | 'carrier_gateway';
    phoneNumber?: string;
    gatewayAddress?: string;
  };
  push?: {
    enabled?: boolean;
  };
};
