import type { Document, Types } from 'mongoose';
import type { TObservabilityLinks } from 'librechat-data-provider';

export type MCPDomainFilterMode = 'allowlist' | 'denylist';

export type BYOKProviderPolicy = {
  enabled?: boolean;
  allowBaseURL?: boolean;
  fallbackToPlatform?: boolean;
};

export type BYOKSettings = {
  providers?: Record<string, BYOKProviderPolicy>;
};

export type DeterministicToolSettings = {
  calculator?: boolean;
  textAnalyzer?: boolean;
  stringUtility?: boolean;
  jsonUtility?: boolean;
};

export type AppSettings = {
  settingsId: string;
  registrationEnabled?: boolean;
  modelSteeringEnabled?: boolean;
  platformPrompt?: string | null;
  observability?: TObservabilityLinks;
  byok?: BYOKSettings;
  deterministicTools?: DeterministicToolSettings;
  mcpDomainFilterMode?: MCPDomainFilterMode;
  mcpAllowedDomains?: string[];
  mcpPublishedServers?: string[] | null;
  createdAt?: Date;
  updatedAt?: Date;
};

export type IAppSettings = AppSettings &
  Document & {
    _id: Types.ObjectId;
  };
