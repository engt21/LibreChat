import { z } from 'zod';
import { AuthKeys, GoogleAuthMode, googleBaseSchema } from 'librechat-data-provider';
import type { GoogleServiceKey } from '~/utils/key';

export type GoogleParameters = z.infer<typeof googleBaseSchema>;

export type GoogleCredentials = {
  [AuthKeys.GOOGLE_SERVICE_KEY]?: string | GoogleServiceKey;
  [AuthKeys.GOOGLE_API_KEY]?: string;
  [AuthKeys.GOOGLE_AUTH_MODE]?: GoogleAuthMode | string;
  [AuthKeys.GOOGLE_VERTEX_PROJECT]?: string;
  [AuthKeys.GOOGLE_VERTEX_LOCATION]?: string;
};

/**
 * Configuration options for the getLLMConfig function
 */
export interface GoogleConfigOptions {
  modelOptions?: Partial<GoogleParameters>;
  reverseProxyUrl?: string;
  defaultQuery?: Record<string, string | undefined>;
  headers?: Record<string, string>;
  proxy?: string;
  streaming?: boolean;
  authHeader?: boolean;
  /** Default parameters to apply only if fields are undefined */
  defaultParams?: Record<string, unknown>;
  addParams?: Record<string, unknown>;
  dropParams?: string[];
  /** Stream rate delay for controlling token streaming speed */
  streamRate?: number;
  /** Model to use for title generation */
  titleModel?: string;
}
