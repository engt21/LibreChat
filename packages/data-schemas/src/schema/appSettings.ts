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
    mcpDomainFilterMode: {
      type: String,
      enum: ['allowlist', 'denylist'],
      default: 'denylist',
    },
    mcpAllowedDomains: {
      type: [String],
      default: undefined,
    },
  },
  { timestamps: true },
);

export default appSettingsSchema;
