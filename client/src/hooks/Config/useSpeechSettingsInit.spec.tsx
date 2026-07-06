import { renderHook, waitFor } from '@testing-library/react';
import { RecoilRoot, useRecoilValue } from 'recoil';
import { useGetCustomConfigSpeechQuery } from 'librechat-data-provider/react-query';
import useSpeechSettingsInit from './useSpeechSettingsInit';
import store from '~/store';

jest.mock('librechat-data-provider/react-query', () => ({
  useGetCustomConfigSpeechQuery: jest.fn(),
}));

const mockUseGetCustomConfigSpeechQuery = useGetCustomConfigSpeechQuery as jest.Mock;

function useInitializedEngine() {
  useSpeechSettingsInit(true);
  return useRecoilValue(store.engineSTT);
}

describe('useSpeechSettingsInit', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseGetCustomConfigSpeechQuery.mockReturnValue({
      data: { sttExternal: true },
    });
  });

  it('migrates the legacy browser default to configured external STT', async () => {
    localStorage.setItem('engineSTT', JSON.stringify('browser'));

    const { result } = renderHook(() => useInitializedEngine(), {
      wrapper: RecoilRoot,
    });

    await waitFor(() => expect(result.current).toBe('external'));
    expect(localStorage.getItem('externalSTTMigrationV1')).toBe('complete');
  });

  it('preserves an intentional browser STT choice after migration', async () => {
    localStorage.setItem('engineSTT', JSON.stringify('browser'));
    localStorage.setItem('externalSTTMigrationV1', 'complete');

    const { result } = renderHook(() => useInitializedEngine(), {
      wrapper: RecoilRoot,
    });

    await waitFor(() => expect(result.current).toBe('browser'));
  });
});
