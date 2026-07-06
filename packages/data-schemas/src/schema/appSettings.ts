import { Schema } from 'mongoose';
import type { IAppSettings } from '~/types';

const appSettingsSchema = new Schema<IAppSettings>(
  {
    settingsId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    registrationEnabled: {
      type: Boolean,
      default: undefined,
    },
    modelSteeringEnabled: {
      type: Boolean,
      default: undefined,
    },
    platformPrompt: {
      type: String,
      default: undefined,
    },
    observability: {
      type: {
        langfuseUrl: {
          type: String,
        },
        grafanaUrl: {
          type: String,
        },
        metricsUrl: {
          type: String,
        },
        prometheusUrl: {
          type: String,
        },
      },
      default: {},
    },
    byok: {
      type: {
        providers: {
          type: Schema.Types.Mixed,
          default: {},
        },
      },
      default: { providers: {} },
    },
    memory: {
      type: {
        automaticSaveEnabled: { type: Boolean },
        provider: { type: String },
        model: { type: String },
        instructions: { type: String },
        requireExplicitRequest: { type: Boolean },
        processAfterResponse: { type: Boolean },
        includeAssistantContext: { type: Boolean },
        messageWindowSize: { type: Number },
        contextCharLimit: { type: Number },
        maxWritesPerTurn: { type: Number },
        maxAttempts: { type: Number },
        processingTimeoutMs: { type: Number },
        tokenLimit: { type: Number },
        maxValueTokens: { type: Number },
        charLimit: { type: Number },
        auditEnabled: { type: Boolean },
        consolidateMemories: { type: Boolean },
        validKeys: { type: [String] },
        customIntentPhrases: { type: [String] },
      },
      default: {},
    },
    deterministicTools: {
      type: {
        calculator: { type: Boolean },
        textAnalyzer: { type: Boolean },
        stringUtility: { type: Boolean },
        jsonUtility: { type: Boolean },
      },
      default: {},
    },
    mcpDomainFilterMode: {
      type: String,
      enum: ['allowlist', 'denylist'],
      default: 'denylist',
    },
    mcpAllowedDomains: {
      type: [String],
      default: undefined,
    },
    mcpPublishedServers: {
      type: [String],
      default: undefined,
    },
  },
  { timestamps: true },
);

export default appSettingsSchema;
