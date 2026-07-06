import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { FileSources, LocalStorageKeys } from 'librechat-data-provider';
import type {
  TConversation,
  TEndpointsConfig,
  TModelsConfig,
  TPreset,
} from 'librechat-data-provider';
import { useGetModelsQuery } from 'librechat-data-provider/react-query';
import { useGetEndpointsQuery, useGetStartupConfig } from '~/data-provider';
import type { ExtendedFile } from '~/common';
import store from '~/store';
import useNewConvo from '../useNewConvo';

const mockApplyModelSpecEffects = jest.fn();
const mockMutateAsync = jest.fn();

const mockModelsData = {
  openAI: ['gpt-5.5', 'gpt-5.4'],
  anthropic: ['claude-sonnet-4.5', 'claude-opus-4.5'],
} as unknown as TModelsConfig;

const mockEndpointsConfig = {
  openAI: { type: 'openAI' },
  anthropic: { type: 'anthropic' },
} as unknown as TEndpointsConfig;

const mockStartupConfig = {
  interface: { modelSelect: true },
  modelSpecs: {
    prioritize: true,
    list: [
      {
        name: 'top-model-spec',
        label: 'Top Model Spec',
        default: true,
        preset: {
          endpoint: 'openAI',
          model: 'gpt-5.5',
        },
      },
    ],
  },
};

const anthropicDefaultStartupConfig = {
  interface: { modelSelect: true },
  modelSpecs: {
    prioritize: true,
    list: [
      {
        name: 'admin-default-spec',
        label: 'Admin Default Spec',
        default: true,
        preset: {
          endpoint: 'anthropic',
          model: 'claude-sonnet-4.5',
        },
      },
    ],
  },
};

jest.mock('librechat-data-provider/react-query', () => ({
  useGetModelsQuery: jest.fn(),
}));

jest.mock('~/data-provider', () => ({
  useDeleteFilesMutation: jest.fn(() => ({ mutateAsync: mockMutateAsync })),
  useGetEndpointsQuery: jest.fn(),
  useGetStartupConfig: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useHasAccess: jest.fn(() => true),
}));

jest.mock('../Agents', () => ({
  useApplyModelSpecEffects: jest.fn(() => mockApplyModelSpecEffects),
}));

jest.mock('../Assistants/useAssistantListMap', () => jest.fn(() => ({})));

jest.mock('../Audio', () => ({
  usePauseGlobalAudio: jest.fn(() => ({ pauseGlobalAudio: jest.fn() })),
}));

jest.mock('../useChatBadges', () => ({
  useResetChatBadges: jest.fn(() => jest.fn()),
}));

function renderUseNewConvo({
  defaultPreset,
  initialFiles,
}: {
  defaultPreset?: Partial<TPreset>;
  initialFiles?: Map<string, ExtendedFile>;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <RecoilRoot
          initializeState={({ set }) => {
            if (defaultPreset) {
              set(store.defaultPreset, defaultPreset as TPreset);
            }
            if (initialFiles) {
              set(store.filesByIndex(0), initialFiles);
            }
          }}
        >
          {children}
        </RecoilRoot>
      </MemoryRouter>
    </QueryClientProvider>
  );

  return renderHook(
    () => {
      const newConvo = useNewConvo();
      const conversation = useRecoilValue(store.conversationByIndex(0));
      const files = useRecoilValue(store.filesByIndex(0));
      return { ...newConvo, conversation, files };
    },
    { wrapper },
  );
}

describe('useNewConvo default preset selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useGetModelsQuery as jest.Mock).mockReturnValue({ data: mockModelsData });
    (useGetEndpointsQuery as jest.Mock).mockReturnValue({ data: mockEndpointsConfig });
    (useGetStartupConfig as jest.Mock).mockReturnValue({ data: mockStartupConfig });
  });

  it('uses a pinned preset for new chats instead of the prioritized top model spec', async () => {
    const pinnedPreset: Partial<TPreset> = {
      presetId: 'preset_pinned',
      defaultPreset: true,
      title: 'Pinned Claude',
      endpoint: 'anthropic',
      model: 'claude-sonnet-4.5',
    };

    const { result } = renderUseNewConvo({ defaultPreset: pinnedPreset });

    act(() => {
      result.current.newConversation();
    });

    await waitFor(() => {
      expect(result.current.conversation?.endpoint).toBe('anthropic');
      expect(result.current.conversation?.model).toBe('claude-sonnet-4.5');
    });
  });

  it('keeps a pinned preset ahead of the last manually selected model', async () => {
    localStorage.setItem(
      `${LocalStorageKeys.LAST_CONVO_SETUP}_0`,
      JSON.stringify({ endpoint: 'openAI', model: 'gpt-5.5' } satisfies Partial<TConversation>),
    );

    const pinnedPreset: Partial<TPreset> = {
      presetId: 'preset_pinned',
      defaultPreset: true,
      title: 'Pinned Claude',
      endpoint: 'anthropic',
      model: 'claude-opus-4.5',
    };

    const { result } = renderUseNewConvo({ defaultPreset: pinnedPreset });

    act(() => {
      result.current.newConversation();
    });

    await waitFor(() => {
      expect(result.current.conversation?.endpoint).toBe('anthropic');
      expect(result.current.conversation?.model).toBe('claude-opus-4.5');
    });
  });

  it('uses the configured default spec even after a manual model selection', async () => {
    (useGetStartupConfig as jest.Mock).mockReturnValue({ data: anthropicDefaultStartupConfig });
    localStorage.setItem(
      `${LocalStorageKeys.LAST_CONVO_SETUP}_0`,
      JSON.stringify({ endpoint: 'openAI', model: 'gpt-5.4' } satisfies Partial<TConversation>),
    );
    localStorage.setItem(LocalStorageKeys.LAST_MODEL, JSON.stringify({ openAI: 'gpt-5.4' }));

    const adminDefaultSpecPreset: Partial<TPreset> = {
      endpoint: 'anthropic',
      model: 'claude-sonnet-4.5',
      spec: 'admin-default-spec',
    };

    const { result } = renderUseNewConvo({ defaultPreset: adminDefaultSpecPreset });

    act(() => {
      result.current.newConversation();
    });

    await waitFor(() => {
      expect(result.current.conversation?.endpoint).toBe('anthropic');
      expect(result.current.conversation?.model).toBe('claude-sonnet-4.5');
    });
  });
});

describe('useNewConvo local file handling', () => {
  const localFile = {
    file_id: 'file-local-pdf',
    temp_file_id: 'temp-local-pdf',
    filepath: '/app/uploads/file-local-pdf.pdf',
    filename: 'local.pdf',
    size: 1024,
    progress: 1,
    source: FileSources.local,
  } as ExtendedFile;

  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    (useGetModelsQuery as jest.Mock).mockReturnValue({ data: mockModelsData });
    (useGetEndpointsQuery as jest.Mock).mockReturnValue({ data: mockEndpointsConfig });
    (useGetStartupConfig as jest.Mock).mockReturnValue({ data: mockStartupConfig });
  });

  it('preserves active tools during an explicitly compatible model transition', async () => {
    const { result } = renderUseNewConvo();

    act(() => {
      result.current.newConversation({
        preset: { endpoint: 'openAI', model: 'gpt-5.6', spec: 'top-model-spec' },
        keepTools: true,
      });
    });

    await waitFor(() => {
      expect(mockApplyModelSpecEffects).toHaveBeenCalledWith(
        expect.objectContaining({
          specName: 'top-model-spec',
          preserveExisting: true,
        }),
      );
    });
  });

  it('preserves local uploads during model or preset changes', async () => {
    const { result } = renderUseNewConvo({
      initialFiles: new Map([[localFile.file_id, localFile]]),
    });

    act(() => {
      result.current.newConversation({
        preset: { endpoint: 'anthropic', model: 'claude-sonnet-4.5' },
        keepFiles: true,
      });
    });

    await waitFor(() => {
      expect(result.current.conversation?.endpoint).toBe('anthropic');
    });
    expect(result.current.files.get(localFile.file_id)).toEqual(localFile);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('still clears local uploads for an actual new chat', () => {
    const { result } = renderUseNewConvo({
      initialFiles: new Map([[localFile.file_id, localFile]]),
    });

    act(() => {
      result.current.newConversation();
    });

    expect(result.current.files.size).toBe(0);
  });
});
