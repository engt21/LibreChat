import { useMemo, useCallback } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';
import { useUserKeyQuery, useUpdateUserKeysMutation } from 'librechat-data-provider/react-query';
import { useGetEndpointsQuery } from '~/data-provider';

const useUserKey = (endpoint: string, options?: { includeValue?: boolean }) => {
  const { data: endpointsConfig } = useGetEndpointsQuery();
  const config = endpointsConfig?.[endpoint ?? ''];

  const { azure } = config ?? {};
  let keyName = endpoint;

  if (azure) {
    keyName = EModelEndpoint.azureOpenAI;
  }

  const updateKey = useUpdateUserKeysMutation();
  const checkUserKey = useUserKeyQuery(keyName, undefined, {
    includeValue: options?.includeValue,
  });

  const getExpiry = useCallback(() => {
    if (checkUserKey.data) {
      return checkUserKey.data.expiresAt || 'never';
    }
  }, [checkUserKey.data]);

  const getValue = useCallback(() => checkUserKey.data?.value ?? '', [checkUserKey.data?.value]);

  const checkExpiry = useCallback(() => {
    const expiresAt = getExpiry();
    if (!expiresAt) {
      return true;
    }

    const expiresAtDate = new Date(expiresAt);
    if (expiresAtDate < new Date()) {
      return false;
    }
    return true;
  }, [getExpiry]);

  const saveUserKey = useCallback(
    (userKey: string, expiresAt: number | null, merge = false) => {
      const dateStr = expiresAt ? new Date(expiresAt).toISOString() : '';
      updateKey.mutate({
        name: keyName,
        value: userKey,
        expiresAt: dateStr,
        merge,
      });
    },
    [updateKey, keyName],
  );

  return useMemo(
    () => ({ getExpiry, getValue, checkExpiry, saveUserKey, isLoading: checkUserKey.isLoading }),
    [getExpiry, getValue, checkExpiry, saveUserKey, checkUserKey.isLoading],
  );
};

export default useUserKey;
