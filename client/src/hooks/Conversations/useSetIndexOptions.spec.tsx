import { renderHook, act } from '@testing-library/react';
import { WebSearchModes } from 'librechat-data-provider';
import { useChatContext } from '~/Providers/ChatContext';
import usePresetIndexOptions from './usePresetIndexOptions';
import useSetIndexOptions from './useSetIndexOptions';

const mockSetConversation = jest.fn();
const mockSetEphemeralAgent = jest.fn();

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: jest.fn(),
}));

jest.mock('./usePresetIndexOptions', () => jest.fn(() => false));

jest.mock('recoil', () => {
  const actual = jest.requireActual('recoil');

  return {
    ...actual,
    useSetRecoilState: jest.fn(() => mockSetEphemeralAgent),
  };
});

describe('useSetIndexOptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (usePresetIndexOptions as jest.Mock).mockReturnValue(false);
  });

  it('syncs Ollama sidebar web search with the ephemeral agent toggle', () => {
    (useChatContext as jest.Mock).mockReturnValue({
      conversation: {
        conversationId: 'convo-1',
        endpoint: 'Ollama',
      },
      setConversation: mockSetConversation,
    });

    const { result } = renderHook(() => useSetIndexOptions());

    act(() => {
      result.current.setOption('web_search')(true);
    });

    expect(mockSetConversation).toHaveBeenCalledWith(expect.any(Function));
    expect(mockSetEphemeralAgent).toHaveBeenCalledWith(expect.any(Function));

    const updater = mockSetEphemeralAgent.mock.calls[0][0];
    expect(updater(null)).toEqual({
      web_search: true,
      web_search_mode: WebSearchModes.ollama_native,
    });
  });

  it('does not touch the ephemeral agent for non-Ollama endpoints', () => {
    (useChatContext as jest.Mock).mockReturnValue({
      conversation: {
        conversationId: 'convo-2',
        endpoint: 'openAI',
      },
      setConversation: mockSetConversation,
    });

    const { result } = renderHook(() => useSetIndexOptions());

    act(() => {
      result.current.setOption('web_search')(true);
    });

    expect(mockSetConversation).toHaveBeenCalledWith(expect.any(Function));
    expect(mockSetEphemeralAgent).not.toHaveBeenCalled();
  });
});
