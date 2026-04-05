import path from 'path';
import { AuthKeys, GoogleAuthMode } from 'librechat-data-provider';
import type { GoogleCredentials } from '~/types';
import type { GoogleServiceKey } from '~/utils/key';
import { isUserProvided, loadServiceKey } from '~/utils';

const DEFAULT_GOOGLE_VERTEX_LOCATION = 'us-central1';

export type GoogleClientAuthOptions = {
  apiKey?: string;
  vertexai?: true;
  project?: string;
  location?: string;
  googleAuthOptions?: {
    credentials?: GoogleServiceKey;
  };
};

export type ResolveGoogleClientAuthResult = {
  authMode?: GoogleAuthMode;
  apiKey?: string;
  serviceKey?: GoogleServiceKey;
  projectId?: string;
  location: string;
  useVertex: boolean;
  isConfigured: boolean;
  clientOptions: GoogleClientAuthOptions;
};

export type PrepareGoogleCredentialsOptions = {
  credentials?: string | GoogleCredentials | null;
  rawApiKey?: string | null;
  env?: NodeJS.ProcessEnv;
  acceptRawApiKey?: boolean;
};

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveEnvProjectId(env: NodeJS.ProcessEnv): string | undefined {
  return (
    readString(env.GOOGLE_VERTEX_PROJECT) ??
    readString(env.GOOGLE_PROJECT_ID) ??
    readString(env.GOOGLE_CLOUD_PROJECT) ??
    readString(env.GCLOUD_PROJECT)
  );
}

function resolveEnvLocation(env: NodeJS.ProcessEnv): string {
  return (
    readString(env.GOOGLE_VERTEX_LOCATION) ??
    readString(env.GOOGLE_LOC) ??
    readString(env.GOOGLE_CLOUD_LOCATION) ??
    DEFAULT_GOOGLE_VERTEX_LOCATION
  );
}

function parseGoogleServiceKeySync(value: unknown): GoogleServiceKey | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as GoogleServiceKey;
    } catch (err: unknown) {
      throw new Error(
        `Error parsing Google service account credentials: ${
          err instanceof Error ? err.message : 'Unknown error'
        }`,
      );
    }
  }

  if (typeof value === 'object') {
    return value as GoogleServiceKey;
  }

  return undefined;
}

async function parseGoogleServiceKey(value: unknown): Promise<GoogleServiceKey | undefined> {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    return (await loadServiceKey(value)) ?? undefined;
  }

  if (typeof value === 'object') {
    return value as GoogleServiceKey;
  }

  return undefined;
}

export function normalizeGoogleAuthMode(value?: string | null): GoogleAuthMode | undefined {
  const normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (!normalized) {
    return undefined;
  }

  if (['api_key', 'apikey', 'api', 'gemini_api', 'developer_api'].includes(normalized)) {
    return GoogleAuthMode.API_KEY;
  }

  if (
    [
      'vertex_service_account',
      'service_account',
      'serviceaccount',
      'vertex',
      'vertex_ai',
      'vertex_json',
    ].includes(normalized)
  ) {
    return GoogleAuthMode.VERTEX_SERVICE_ACCOUNT;
  }

  if (
    [
      'vertex_application_default',
      'vertex_application_default_credentials',
      'application_default',
      'application_default_credentials',
      'applicationdefault',
      'adc',
      'vertex_adc',
    ].includes(normalized)
  ) {
    return GoogleAuthMode.VERTEX_APPLICATION_DEFAULT;
  }

  return undefined;
}

export function parseGoogleCredentials(
  credentials: string | GoogleCredentials | undefined | null,
  acceptRawApiKey = false,
): GoogleCredentials {
  if (!credentials) {
    return {};
  }

  if (acceptRawApiKey && typeof credentials === 'string') {
    return {
      [AuthKeys.GOOGLE_API_KEY]: credentials,
    };
  }

  if (typeof credentials === 'string') {
    try {
      return JSON.parse(credentials) as GoogleCredentials;
    } catch (err: unknown) {
      throw new Error(
        `Error parsing string credentials: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }
  }

  return credentials;
}

export async function prepareGoogleCredentials({
  credentials,
  rawApiKey,
  env = process.env,
  acceptRawApiKey = false,
}: PrepareGoogleCredentialsOptions = {}): Promise<GoogleCredentials> {
  const parsedCredentials = parseGoogleCredentials(credentials, acceptRawApiKey);
  const explicitAuthMode = normalizeGoogleAuthMode(
    readString(parsedCredentials[AuthKeys.GOOGLE_AUTH_MODE]) ?? readString(env.GOOGLE_AUTH_MODE),
  );

  const apiKey =
    readString(parsedCredentials[AuthKeys.GOOGLE_API_KEY]) ??
    (!isUserProvided(rawApiKey) ? readString(rawApiKey) : undefined);

  let serviceKey = await parseGoogleServiceKey(parsedCredentials[AuthKeys.GOOGLE_SERVICE_KEY]);

  const shouldLoadServiceKeyFromEnv =
    !serviceKey &&
    !apiKey &&
    (explicitAuthMode === undefined || explicitAuthMode === GoogleAuthMode.VERTEX_SERVICE_ACCOUNT);

  if (shouldLoadServiceKeyFromEnv) {
    const serviceKeyPath =
      readString(env.GOOGLE_SERVICE_KEY_FILE) ||
      path.join(process.cwd(), 'api', 'data', 'auth.json');
    serviceKey = (await loadServiceKey(serviceKeyPath)) ?? undefined;
  }

  let projectId =
    readString(parsedCredentials[AuthKeys.GOOGLE_VERTEX_PROJECT]) ??
    readString(serviceKey?.project_id);

  const shouldLoadApplicationDefault =
    explicitAuthMode === GoogleAuthMode.VERTEX_APPLICATION_DEFAULT ||
    (!apiKey && !serviceKey && Boolean(readString(env.GOOGLE_APPLICATION_CREDENTIALS)));

  if (!projectId && shouldLoadApplicationDefault) {
    const applicationDefaultPath = readString(env.GOOGLE_APPLICATION_CREDENTIALS);
    if (applicationDefaultPath) {
      const applicationDefaultCredentials = await loadServiceKey(applicationDefaultPath);
      projectId = readString(applicationDefaultCredentials?.project_id);
    }
  }

  projectId = projectId ?? resolveEnvProjectId(env);

  const location =
    readString(parsedCredentials[AuthKeys.GOOGLE_VERTEX_LOCATION]) ?? resolveEnvLocation(env);

  const resolvedAuthMode =
    explicitAuthMode ??
    (apiKey
      ? GoogleAuthMode.API_KEY
      : serviceKey
        ? GoogleAuthMode.VERTEX_SERVICE_ACCOUNT
        : shouldLoadApplicationDefault
          ? GoogleAuthMode.VERTEX_APPLICATION_DEFAULT
          : undefined);

  return {
    ...(apiKey ? { [AuthKeys.GOOGLE_API_KEY]: apiKey } : {}),
    ...(serviceKey ? { [AuthKeys.GOOGLE_SERVICE_KEY]: serviceKey } : {}),
    ...(resolvedAuthMode ? { [AuthKeys.GOOGLE_AUTH_MODE]: resolvedAuthMode } : {}),
    ...(projectId ? { [AuthKeys.GOOGLE_VERTEX_PROJECT]: projectId } : {}),
    ...(location ? { [AuthKeys.GOOGLE_VERTEX_LOCATION]: location } : {}),
  };
}

export function resolveGoogleClientAuth(
  credentials: string | GoogleCredentials | undefined,
  {
    acceptRawApiKey = false,
    env = process.env,
  }: { acceptRawApiKey?: boolean; env?: NodeJS.ProcessEnv } = {},
): ResolveGoogleClientAuthResult {
  const parsedCredentials = parseGoogleCredentials(credentials, acceptRawApiKey);
  const serviceKey = parseGoogleServiceKeySync(parsedCredentials[AuthKeys.GOOGLE_SERVICE_KEY]);
  const apiKey = readString(parsedCredentials[AuthKeys.GOOGLE_API_KEY]);
  const projectId =
    readString(parsedCredentials[AuthKeys.GOOGLE_VERTEX_PROJECT]) ??
    readString(serviceKey?.project_id) ??
    resolveEnvProjectId(env);
  const location =
    readString(parsedCredentials[AuthKeys.GOOGLE_VERTEX_LOCATION]) ?? resolveEnvLocation(env);
  const explicitAuthMode = normalizeGoogleAuthMode(
    readString(parsedCredentials[AuthKeys.GOOGLE_AUTH_MODE]) ?? readString(env.GOOGLE_AUTH_MODE),
  );

  const hasServiceKey = Boolean(serviceKey && Object.keys(serviceKey).length > 0);
  const hasApplicationDefaultCredentials = Boolean(
    explicitAuthMode === GoogleAuthMode.VERTEX_APPLICATION_DEFAULT ||
    readString(env.GOOGLE_APPLICATION_CREDENTIALS),
  );

  const authMode =
    explicitAuthMode ??
    (apiKey
      ? GoogleAuthMode.API_KEY
      : hasServiceKey
        ? GoogleAuthMode.VERTEX_SERVICE_ACCOUNT
        : hasApplicationDefaultCredentials
          ? GoogleAuthMode.VERTEX_APPLICATION_DEFAULT
          : undefined);

  const useVertex = Boolean(authMode && authMode !== GoogleAuthMode.API_KEY);
  const isConfigured =
    authMode === GoogleAuthMode.API_KEY
      ? Boolean(apiKey)
      : authMode === GoogleAuthMode.VERTEX_SERVICE_ACCOUNT
        ? hasServiceKey
        : authMode === GoogleAuthMode.VERTEX_APPLICATION_DEFAULT
          ? hasApplicationDefaultCredentials
          : Boolean(apiKey || hasServiceKey || hasApplicationDefaultCredentials);

  const clientOptions: GoogleClientAuthOptions = useVertex
    ? {
        vertexai: true,
        ...(projectId ? { project: projectId } : {}),
        location,
        ...(hasServiceKey ? { googleAuthOptions: { credentials: serviceKey } } : {}),
      }
    : {
        ...(apiKey ? { apiKey } : {}),
      };

  return {
    authMode,
    apiKey,
    serviceKey,
    projectId,
    location,
    useVertex,
    isConfigured,
    clientOptions,
  };
}
