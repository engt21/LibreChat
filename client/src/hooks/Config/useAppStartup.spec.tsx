import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import type { TPreset, TStartupConfig } from 'librechat-data-provider';
import store from '~/store';
import useAppStartup from './useAppStartup';

jest.mock('react-gtm-module', () => ({
  initialize: jest.fn(),
}));

jest.mock('./useSpeechSettingsInit', () => jest.fn());

jest.mock('~/data-provider', () => ({
  useMCPServersQuery: jest.fn(() => ({ data: {}, isLoading: false })),
  useMCPToolsQuery: jest.fn(),
}));

jest.mock('~/data-provider/Tools/queries', () => ({
  useMCPConnectionStatusQuery: jest.fn(() => ({ data: undefined })),
}));

jest.mock('~/hooks/MCP', () => ({
  useAutoConnectMCP: jest.fn(),
  useMCPServerManager: jest.fn(() => ({
    availableMCPServers: [],
    initializeServer: jest.fn(),
    isInitializing: false,
  })),
}));

const startupConfig = {
  modelSpecs: {
    prioritize: true,
    list: [
      {
        name: 'default-spec',
        label: 'Default Spec',
        default: true,
        preset: {
          endpoint: 'openAI',
          model: 'gpt-5.5',
        },
      },
    ],
  },
} as TStartupConfig;

function renderUseAppStartup(initialDefaultPreset?: Partial<TPreset>) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <RecoilRoot
      initializeState={({ set }) => {
        if (initialDefaultPreset) {
          set(store.defaultPreset, initialDefaultPreset as TPreset);
        }
      }}
    >
      {children}
    </RecoilRoot>
  );

  return renderHook(
    () => {
      useAppStartup({ startupConfig });
      return useRecoilValue(store.defaultPreset);
    },
    { wrapper },
  );
}

describe('useAppStartup default preset initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('sets the default model spec when no default preset is loaded', async () => {
    const { result } = renderUseAppStartup();

    await waitFor(() => {
      expect(result.current?.endpoint).toBe('openAI');
      expect(result.current?.model).toBe('gpt-5.5');
      expect(result.current?.spec).toBe('default-spec');
    });
  });

  it('does not overwrite a user-pinned default preset with the default model spec', async () => {
    const pinnedPreset = {
      presetId: 'preset_pinned',
      defaultPreset: true,
      title: 'Pinned Claude',
      endpoint: 'anthropic',
      model: 'claude-sonnet-4.5',
    } as Partial<TPreset>;

    const { result } = renderUseAppStartup(pinnedPreset);

    await waitFor(() => {
      expect(result.current?.presetId).toBe('preset_pinned');
      expect(result.current?.endpoint).toBe('anthropic');
      expect(result.current?.model).toBe('claude-sonnet-4.5');
      expect(result.current?.spec).toBeUndefined();
    });
  });
});
