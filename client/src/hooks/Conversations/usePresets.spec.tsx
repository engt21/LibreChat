import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { QueryKeys, type TConversation, type TPreset } from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useGetPresetsQuery } from '~/data-provider';
import store from '~/store';
import usePresets from './usePresets';

const mockNewConversation = jest.fn();
const mockCreatePresetMutate = jest.fn();
const mockReorderPresetsMutate = jest.fn();
const mockUpdatePresetMutate = jest.fn();
let mockUpdatePresetOptions: { onSuccess?: (data: TPreset, variables: TPreset) => void } = {};

jest.mock('@librechat/client', () => ({
  useToastContext: jest.fn(() => ({ showToast: jest.fn() })),
}));

jest.mock('librechat-data-provider/react-query', () => ({
  useCreatePresetMutation: jest.fn(() => ({ mutate: mockCreatePresetMutate })),
  useGetModelsQuery: jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useUpdatePresetMutation: jest.fn((options) => {
    mockUpdatePresetOptions = options;
    return { mutate: mockUpdatePresetMutate };
  }),
  useReorderPresetsMutation: jest.fn(() => ({ mutate: mockReorderPresetsMutate })),
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

function renderUsePresetsHook(
  initialDefaultPreset?: Partial<TPreset>,
  options: {
    initialConversation?: Partial<TConversation>;
    editingPreset?: Partial<TPreset>;
  } = {},
) {
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
          set(store.conversationByIndex(0), {
            conversationId: 'new',
            ...options.initialConversation,
          } as never);
          if (options.editingPreset) {
            set(store.presetByIndex(0), options.editingPreset as TPreset);
          }
        }}
      >
        {children}
      </RecoilRoot>
    </QueryClientProvider>
  );

  const hook = renderHook(
    () => ({
      ...usePresets(),
      conversation: useRecoilValue(store.conversationByIndex(0)),
      editingPreset: useRecoilValue(store.presetByIndex(0)),
    }),
    { wrapper },
  );

  return { ...hook, queryClient };
}

describe('usePresets default preset loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdatePresetOptions = {};
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
      keepFiles: true,
      disableParams: true,
    });
  });

  it('preserves uploaded files when selecting a preset', () => {
    const preset = {
      presetId: 'preset_files',
      user: 'user-1',
      title: 'Claude with files',
      endpoint: 'anthropic',
      model: 'claude-sonnet-4.5',
    } as TPreset;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [preset],
      refetch: jest.fn(),
    });

    const { result } = renderUsePresetsHook();

    act(() => {
      result.current.onSelectPreset(preset);
    });

    expect(mockNewConversation).toHaveBeenCalledWith({
      preset: expect.objectContaining({
        presetId: preset.presetId,
        endpoint: preset.endpoint,
        model: preset.model,
      }),
      keepAddedConvos: false,
      keepFiles: true,
      disableParams: false,
    });
  });

  it('preserves uploaded files when a saved preset becomes the default', () => {
    const oldPreset = {
      presetId: 'preset_openai',
      user: 'user-1',
      title: 'OpenAI images',
      endpoint: 'openAI',
      model: 'gpt-5.5',
      defaultPreset: false,
    } as TPreset;
    const updatedPreset = {
      ...oldPreset,
      defaultPreset: true,
    } as TPreset;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [oldPreset],
      refetch: jest.fn(),
    });

    renderUsePresetsHook();

    act(() => {
      mockUpdatePresetOptions.onSuccess?.(updatedPreset, oldPreset);
    });

    expect(mockNewConversation).toHaveBeenCalledWith({
      preset: updatedPreset,
      keepFiles: true,
      disableParams: true,
    });
  });

  it('persists a user-defined preset order', () => {
    const firstPreset = {
      presetId: 'preset_first',
      user: 'user-1',
      title: 'First',
      endpoint: 'openAI',
      model: 'gpt-5.5',
    } as TPreset;
    const secondPreset = {
      presetId: 'preset_second',
      user: 'user-1',
      title: 'Second',
      endpoint: 'anthropic',
      model: 'claude-sonnet-4.5',
    } as TPreset;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [firstPreset, secondPreset],
      refetch: jest.fn(),
    });

    const { result, queryClient } = renderUsePresetsHook();

    act(() => {
      result.current.onReorderPresets([secondPreset, firstPreset], true);
    });

    expect(queryClient.getQueryData([QueryKeys.presets])).toEqual([
      { ...secondPreset, order: 1 },
      { ...firstPreset, order: 2 },
    ]);
    expect(mockReorderPresetsMutate).toHaveBeenCalledWith({
      presetOrder: [
        { presetId: 'preset_second', order: 1 },
        { presetId: 'preset_first', order: 2 },
      ],
    });
  });

  it('duplicates a preset as an unpinned copy immediately after its source', () => {
    const pinnedPreset = {
      presetId: 'preset_pinned',
      user: 'user-1',
      title: 'Pinned Claude',
      endpoint: 'anthropic',
      model: 'claude-sonnet-4.5',
      defaultPreset: true,
      order: 1,
    } as TPreset;
    const trailingPreset = {
      presetId: 'preset_trailing',
      user: 'user-1',
      title: 'Trailing',
      endpoint: 'openAI',
      model: 'gpt-5.5',
      order: 2,
    } as TPreset;
    const duplicatedPreset = {
      ...pinnedPreset,
      presetId: 'preset_copy',
      title: 'Pinned Claude (com_ui_copy)',
      defaultPreset: false,
    } as TPreset;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [pinnedPreset, trailingPreset],
      refetch: jest.fn(),
    });

    const { result, queryClient } = renderUsePresetsHook(pinnedPreset);

    act(() => {
      result.current.onDuplicatePreset(pinnedPreset);
    });

    expect(mockCreatePresetMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        presetId: null,
        title: 'Pinned Claude (com_ui_copy)',
        endpoint: 'anthropic',
        model: 'claude-sonnet-4.5',
        defaultPreset: false,
      }),
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
    expect(mockCreatePresetMutate.mock.calls[0][0]).not.toHaveProperty('user');
    expect(mockCreatePresetMutate.mock.calls[0][0]).not.toHaveProperty('order');

    act(() => {
      mockCreatePresetMutate.mock.calls[0][1].onSuccess(duplicatedPreset);
    });

    expect(queryClient.getQueryData([QueryKeys.presets])).toEqual([
      { ...pinnedPreset, order: 1 },
      { ...duplicatedPreset, order: 2 },
      { ...trailingPreset, order: 3 },
    ]);
    expect(mockReorderPresetsMutate).toHaveBeenCalledWith({
      presetOrder: [
        { presetId: 'preset_pinned', order: 1 },
        { presetId: 'preset_copy', order: 2 },
        { presetId: 'preset_trailing', order: 3 },
      ],
    });
  });

  it('updates the presets cache immediately after a preset save succeeds', () => {
    const oldPreset = {
      presetId: 'preset_first',
      user: 'user-1',
      title: 'Old title',
      endpoint: 'openAI',
      model: 'gpt-5.5',
    } as TPreset;
    const updatedPreset = {
      ...oldPreset,
      title: 'Updated title',
      temperature: 0.4,
    } as TPreset;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [oldPreset],
      refetch: jest.fn(),
    });

    const { queryClient } = renderUsePresetsHook();
    queryClient.setQueryData([QueryKeys.presets], [oldPreset]);

    act(() => {
      mockUpdatePresetOptions.onSuccess?.(updatedPreset, oldPreset);
    });

    expect(queryClient.getQueryData([QueryKeys.presets])).toEqual([updatedPreset]);
  });

  it('syncs a saved edited preset into the active matching conversation', async () => {
    const oldPreset = {
      presetId: 'preset_first',
      user: 'user-1',
      title: 'Old title',
      endpoint: 'openAI',
      model: 'gpt-5.5',
      temperature: 0.2,
    } as TPreset;
    const updatedPreset = {
      ...oldPreset,
      title: 'Updated title',
      temperature: 0.4,
    } as TPreset;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [oldPreset],
      refetch: jest.fn(),
    });

    const { result } = renderUsePresetsHook(undefined, {
      editingPreset: oldPreset,
      initialConversation: {
        conversationId: 'new',
        title: 'New Chat',
        endpoint: 'openAI',
        model: 'gpt-5.5',
        temperature: 0.2,
      },
    });

    act(() => {
      mockUpdatePresetOptions.onSuccess?.(updatedPreset, oldPreset);
    });

    await waitFor(() => {
      expect(result.current.conversation?.temperature).toBe(0.4);
    });
    expect(result.current.conversation?.title).toBe('New Chat');
    expect(result.current.editingPreset?.title).toBe('Updated title');
  });

  it('syncs saved Anthropic server-tool preset fields into the active matching conversation', async () => {
    const oldPreset = {
      presetId: 'preset_anthropic',
      user: 'user-1',
      title: 'Claude tools',
      endpoint: 'anthropic',
      model: 'claude-sonnet-4-6',
      web_search: true,
      web_fetch: false,
      anthropic_code_execution: false,
      anthropic_advisor: false,
      anthropic_advisor_model: 'claude-opus-4-8',
    } as TPreset;
    const updatedPreset = {
      ...oldPreset,
      web_fetch: true,
      anthropic_code_execution: true,
      anthropic_advisor: true,
      anthropic_advisor_model: 'claude-opus-4-7',
    } as TPreset;

    (useGetPresetsQuery as jest.Mock).mockReturnValue({
      data: [oldPreset],
      refetch: jest.fn(),
    });

    const { result } = renderUsePresetsHook(undefined, {
      editingPreset: oldPreset,
      initialConversation: {
        conversationId: 'new',
        title: 'New Claude Chat',
        endpoint: 'anthropic',
        model: 'claude-sonnet-4-6',
        web_search: true,
        web_fetch: false,
        anthropic_code_execution: false,
        anthropic_advisor: false,
        anthropic_advisor_model: 'claude-opus-4-8',
      },
    });

    act(() => {
      mockUpdatePresetOptions.onSuccess?.(updatedPreset, oldPreset);
    });

    await waitFor(() => {
      expect(result.current.conversation?.web_fetch).toBe(true);
    });
    expect(result.current.conversation?.anthropic_code_execution).toBe(true);
    expect(result.current.conversation?.anthropic_advisor).toBe(true);
    expect(result.current.conversation?.anthropic_advisor_model).toBe('claude-opus-4-7');
    expect(result.current.conversation?.title).toBe('New Claude Chat');
  });
});
