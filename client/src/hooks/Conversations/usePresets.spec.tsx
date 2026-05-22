import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecoilRoot, useRecoilValue } from 'recoil';
import type { TPreset } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useGetPresetsQuery } from '~/data-provider';
import store from '~/store';
import usePresets from './usePresets';

const mockNewConversation = jest.fn();

jest.mock('@librechat/client', () => ({
  useToastContext: jest.fn(() => ({ showToast: jest.fn() })),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useCreatePresetMutation: jest.fn(() => ({ mutate: jest.fn() })),
  useGetModelsQuery: jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useUpdatePresetMutation: jest.fn(() => ({ mutate: jest.fn() })),
  useDeletePresetMutation: jest.fn(() => ({ mutate: jest.fn() })),
  useGetPresetsQuery: jest.fn(),
}));

jest.mock('~/hooks/AuthContext', () => ({
  useAuthContext: jest.fn(() => ({
    user: { id: 'user-1' },
    isAuthenticated: true,
  })),
}));

jest.mock('~/hooks/useNewConvo', () => jest.fn(() => ({ newConversation: mockNewConversation })));

jest.mock('~/hooks/Conversations/useGetConversation', () => jest.fn(() => jest.fn()));
jest.mock('~/hooks/Conversations/useDefaultConvo', () => jest.fn(() => jest.fn()));

jest.mock('~/hooks', () => ({
  useLocalize: jest.fn(() => (key: string) => key),
}));

function renderUsePresets(initialDefaultPreset?: Partial<TPreset>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RecoilRoot
        initializeState={({ set }) => {
          if (initialDefaultPreset) {
            set(store.defaultPreset, initialDefaultPreset as TPreset);
          }
          set(store.conversationByIndex(0), { conversationId: 'new' } as never);
        }}
      >
        {children}
      </RecoilRoot>
    </QueryClientProvider>
  );

  return renderHook(
    () => {
      usePresets();
      return useRecoilValue(store.defaultPreset);
    },
    { wrapper },
  );
}

describe('usePresets default preset loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useGetModelsQuery as jest.Mock).mockReturnValue({ data: { openAI: ['gpt-5.5'] } });
  });

  it('replaces a spec fallback with the user-pinned default preset when presets load', async () => {
    const specFallback = {
      endpoint: 'openAI',
      model: 'gpt-5.5',
      spec: 'default-spec',
    } as Partial<TPreset>;
    const pinnedPreset = {
      presetId: 'preset_pinned',
      defaultPreset: true,
      user: 'user-1',
      title: 'Pinned Claude',
      endpoint: 'anthropic',
      model: 'claude-sonnet-4.5',
    } as Partial<TPreset>;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [pinnedPreset],
      refetch: jest.fn(),
    });

    const { result } = renderUsePresets(specFallback);

    await waitFor(() => {
      expect(result.current?.presetId).toBe('preset_pinned');
      expect(result.current?.endpoint).toBe('anthropic');
      expect(result.current?.model).toBe('claude-sonnet-4.5');
    });

    expect(mockNewConversation).toHaveBeenCalledWith({
      preset: pinnedPreset,
      modelsData: { openAI: ['gpt-5.5'] },
      disableParams: true,
    });
  });
});
