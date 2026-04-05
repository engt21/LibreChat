import { EModelEndpoint } from 'librechat-data-provider';
import type {
  BaseInitializeParams,
  InitializeResultBase,
  GoogleConfigOptions,
  GoogleCredentials,
} from '~/types';
import { isEnabled, checkUserKeyExpiry } from '~/utils';
import { prepareGoogleCredentials } from './auth';
import { getGoogleConfig } from './llm';

/**
 * Initializes Google/Vertex AI endpoint configuration.
 * Supports both API key authentication and service account credentials.
 *
 * @param params - Configuration parameters
 * @returns Promise resolving to Google configuration options
 * @throws Error if no valid credentials are provided
 */
export async function initializeGoogle({
  req,
  endpoint,
  model_parameters,
  db,
}: BaseInitializeParams): Promise<InitializeResultBase> {
  void endpoint;
  const appConfig = req.config;
  const { GOOGLE_KEY, GOOGLE_REVERSE_PROXY, GOOGLE_AUTH_HEADER, PROXY } = process.env;
  const isUserProvided = GOOGLE_KEY === 'user_provided';
  const { key: expiresAt } = req.body;

  let userKey = null;
  if (expiresAt && isUserProvided) {
    checkUserKeyExpiry(expiresAt, EModelEndpoint.google);
    userKey = await db.getUserKey({ userId: req.user?.id, name: EModelEndpoint.google });
  }

  const credentials: GoogleCredentials = await prepareGoogleCredentials({
    credentials: isUserProvided ? (userKey as GoogleCredentials | null) : undefined,
    rawApiKey: isUserProvided ? undefined : GOOGLE_KEY,
  });

  let clientOptions: GoogleConfigOptions = {};

  /** @type {undefined | TBaseEndpoint} */
  const allConfig = appConfig?.endpoints?.all;
  /** @type {undefined | TBaseEndpoint} */
  const googleConfig = appConfig?.endpoints?.[EModelEndpoint.google];

  if (googleConfig) {
    clientOptions.streamRate = googleConfig.streamRate;
    clientOptions.titleModel = googleConfig.titleModel;
  }

  if (allConfig) {
    clientOptions.streamRate = allConfig.streamRate;
  }

  clientOptions = {
    reverseProxyUrl: GOOGLE_REVERSE_PROXY ?? undefined,
    authHeader: isEnabled(GOOGLE_AUTH_HEADER) ?? undefined,
    proxy: PROXY ?? undefined,
    modelOptions: model_parameters ?? {},
    ...clientOptions,
  };

  return getGoogleConfig(credentials, clientOptions);
}
