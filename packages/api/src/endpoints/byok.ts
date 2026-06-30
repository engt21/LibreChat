import type { ServerRequest, UserKeyValues } from '~/types';
import { checkUserKeyExpiry } from '~/utils';

type KeyStore = {
  getUserKey: (params: { userId: string; name: string }) => Promise<string>;
  getUserKeyValues: (params: { userId: string; name: string }) => Promise<UserKeyValues>;
};

type AdminBYOKPolicy = {
  enabled?: boolean;
  allowBaseURL?: boolean;
  fallbackToPlatform?: boolean;
};

type ResolveCommonParams = {
  req: ServerRequest;
  db: KeyStore;
  endpoint: string;
  expiresAt?: string;
  userProvided: boolean;
  platformAvailable: boolean;
  fallbackOnMissing?: boolean;
  fallbackOnExpired?: boolean;
};

export function getAdminBYOKPolicy(req: ServerRequest, endpoint: string): AdminBYOKPolicy {
  const providers = req.appSettings?.byok?.providers ?? {};
  return providers[endpoint] ?? providers[endpoint.toLowerCase()] ?? providers.custom ?? {};
}

export function isAdminBYOKEnabled(req: ServerRequest, endpoint: string): boolean {
  return getAdminBYOKPolicy(req, endpoint).enabled === true;
}

function canFallbackToPlatform(params: ResolveCommonParams, reason: 'expired' | 'missing') {
  if (!params.platformAvailable) {
    return false;
  }

  const policy = getAdminBYOKPolicy(params.req, params.endpoint);
  if (policy.enabled === true && policy.fallbackToPlatform !== false) {
    return true;
  }

  return reason === 'expired'
    ? params.fallbackOnExpired === true
    : params.fallbackOnMissing === true;
}

function shouldResolveUserKey(params: ResolveCommonParams) {
  return (
    (params.userProvided || isAdminBYOKEnabled(params.req, params.endpoint)) &&
    !!params.req.user?.id
  );
}

function checkExpiryOrFallback(params: ResolveCommonParams) {
  if (!params.expiresAt || !shouldResolveUserKey(params)) {
    return false;
  }

  try {
    checkUserKeyExpiry(params.expiresAt, params.endpoint);
    return false;
  } catch (error) {
    if (!canFallbackToPlatform(params, 'expired')) {
      throw error;
    }
    return true;
  }
}

export async function resolveUserKeyWithFallback(
  params: ResolveCommonParams,
): Promise<string | null> {
  if (!shouldResolveUserKey(params) || checkExpiryOrFallback(params)) {
    return null;
  }

  try {
    return await params.db.getUserKey({
      userId: params.req.user?.id ?? '',
      name: params.endpoint,
    });
  } catch (error) {
    if (canFallbackToPlatform(params, 'missing')) {
      return null;
    }
    throw error;
  }
}

export async function resolveUserKeyValuesWithFallback(
  params: ResolveCommonParams,
): Promise<UserKeyValues | null> {
  if (!shouldResolveUserKey(params) || checkExpiryOrFallback(params)) {
    return null;
  }

  try {
    return await params.db.getUserKeyValues({
      userId: params.req.user?.id ?? '',
      name: params.endpoint,
    });
  } catch (error) {
    if (canFallbackToPlatform(params, 'missing')) {
      return null;
    }
    throw error;
  }
}
