/** @jest-environment jsdom */

import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueryKeys } from '../keys';
import {
  useRevokeAllUserKeysMutation,
  useRevokeUserKeyMutation,
  useUpdateUserKeysMutation,
} from './react-query-service';
import * as dataService from '../data-service';

jest.mock('../data-service', () => ({
  updateUserKey: jest.fn(),
  revokeUserKey: jest.fn(),
  revokeAllUserKeys: jest.fn(),
}));

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return {
    queryClient,
    wrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children),
  };
};

describe('react-query user key mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates models after saving a user key', async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    jest.mocked(dataService.updateUserKey).mockResolvedValue({} as never);

    const { result } = renderHook(() => useUpdateUserKeysMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: 'xai', value: 'secret', expiresAt: '' });
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.name, 'xai']);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.models]);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.endpoints]);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.startupConfig]);
    });
  });

  it('invalidates models after revoking a user key', async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    jest.mocked(dataService.revokeUserKey).mockResolvedValue({} as never);

    const { result } = renderHook(() => useRevokeUserKeyMutation('xai'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(undefined);
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.name, 'xai']);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.models]);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.endpoints]);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.startupConfig]);
    });
  });

  it('invalidates models after revoking all user keys', async () => {
    const { queryClient, wrapper } = createWrapper();
    const invalidateQueries = jest.spyOn(queryClient, 'invalidateQueries');
    jest.mocked(dataService.revokeAllUserKeys).mockResolvedValue({} as never);

    const { result } = renderHook(() => useRevokeAllUserKeysMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(undefined);
    });

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.name]);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.models]);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.endpoints]);
      expect(invalidateQueries).toHaveBeenCalledWith([QueryKeys.startupConfig]);
    });
  });
});
