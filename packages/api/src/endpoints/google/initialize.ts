import { Providers } from '@librechat/agents';
import { EModelEndpoint, ErrorTypes } from 'librechat-data-provider';
import type {
  BaseInitializeParams,
  InitializeResultBase,
  GoogleConfigOptions,
  GoogleCredentials,
} from '~/types';
import { isEnabled, checkUserKeyExpiry } from '~/utils';
import { prepareGoogleCredentials, resolveGoogleClientAuth } from './auth';
import { getGoogleConfig } from './llm';
import { getGoogleModelCapability } from '../models';

function isNoUserKeyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  try {
    return JSON.parse(error.message)?.type === ErrorTypes.NO_USER_KEY;
  } catch {
    return false;
  }
}

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
  const serverCredentials = isUserProvided ? await prepareGoogleCredentials() : undefined;
  const serverGoogleAuth = serverCredentials ? resolveGoogleClientAuth(serverCredentials) : undefined;

  let userKey = null;
  if (expiresAt && isUserProvided) {
    checkUserKeyExpiry(expiresAt, EModelEndpoint.google);
    try {
      userKey = await db.getUserKey({ userId: req.user?.id, name: EModelEndpoint.google });
    } catch (error) {
      if (!isNoUserKeyError(error) || !serverGoogleAuth?.isConfigured) {
        throw error;
      }
    }
  }

  const credentials: GoogleCredentials = await prepareGoogleCredentials({
    credentials: isUserProvided ? (userKey as GoogleCredentials | null) : undefined,
    rawApiKey: isUserProvided ? undefined : GOOGLE_KEY,
  });
  const googleAuth = resolveGoogleClientAuth(credentials);

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

  if (googleAuth.useVertex) {
    const requestedModel =
      typeof model_parameters?.model === 'string' ? model_parameters.model : undefined;
    const modelCapability = await getGoogleModelCapability({
      model: requestedModel,
      googleAuth,
    });

    if (modelCapability?.vertexLocation) {
      clientOptions.vertexLocation = modelCapability.vertexLocation;
    }

    const googleConfig = getGoogleConfig(credentials, clientOptions);
    const primaryLocation =
      modelCapability?.vertexLocation ??
      (typeof (googleConfig.llmConfig as Record<string, unknown>).location === 'string'
        ? ((googleConfig.llmConfig as Record<string, unknown>).location as string)
        : googleAuth.location);
    const fallbackLocations = (modelCapability?.vertexLocations ?? []).filter(
      (location) => location !== primaryLocation,
    );

    if (fallbackLocations.length > 0) {
      const fallbackBaseOptions = { ...(googleConfig.llmConfig as Record<string, unknown>) };
      delete fallbackBaseOptions.fallbacks;

      (googleConfig.llmConfig as Record<string, unknown>).fallbacks = fallbackLocations.map(
        (location) => ({
          provider: Providers.VERTEXAI,
          clientOptions: {
            ...fallbackBaseOptions,
            location,
          },
        }),
      );
    }

    return googleConfig;
  }

  return getGoogleConfig(credentials, clientOptions);
}
