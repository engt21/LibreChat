import type { Document, Types } from 'mongoose';
import type { TObservabilityLinks } from 'librechat-data-provider';

export type MCPDomainFilterMode = 'allowlist' | 'denylist';

export type AppSettings = {
  settingsId: string;
  registrationEnabled?: boolean;
  observability?: TObservabilityLinks;
  mcpDomainFilterMode?: MCPDomainFilterMode;
  mcpAllowedDomains?: string[];
  createdAt?: Date;
  updatedAt?: Date;
};

export type IAppSettings = AppSettings &
  Document & {
    _id: Types.ObjectId;
  };
