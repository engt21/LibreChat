import { renderHook, act } from '@testing-library/react';
import { EModelEndpoint, WebSearchModes } from 'librechat-data-provider';
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

  it('syncs non-Ollama sidebar web search with the ephemeral agent toggle (without Ollama mode)', () => {
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
    expect(mockSetEphemeralAgent).toHaveBeenCalledWith(expect.any(Function));

    const updater = mockSetEphemeralAgent.mock.calls[0][0];
    const updated = updater(null);
    expect(updated).toEqual({ web_search: true });
    expect(updated).not.toHaveProperty('web_search_mode');
  });

  it('syncs Anthropic sidebar server-tool settings with the ephemeral agent request state', () => {
    (useChatContext as jest.Mock).mockReturnValue({
      conversation: {
        conversationId: 'convo-3',
        endpoint: EModelEndpoint.anthropic,
      },
      setConversation: mockSetConversation,
    });

    const { result } = renderHook(() => useSetIndexOptions());

    act(() => {
      result.current.setOption('web_fetch')(true);
      result.current.setOption('anthropic_code_execution')(false);
      result.current.setOption('anthropic_advisor_model')('claude-opus-4-7');
    });

    const webFetchUpdater = mockSetEphemeralAgent.mock.calls[0][0];
    const codeExecutionUpdater = mockSetEphemeralAgent.mock.calls[1][0];
    const advisorModelUpdater = mockSetEphemeralAgent.mock.calls[2][0];

    expect(webFetchUpdater(null)).toEqual({ web_fetch: true });
    expect(codeExecutionUpdater({ web_fetch: true })).toEqual({
      web_fetch: true,
      anthropic_code_execution: false,
    });
    expect(advisorModelUpdater({ anthropic_code_execution: false })).toEqual({
      anthropic_code_execution: false,
      anthropic_advisor_model: 'claude-opus-4-7',
    });
  });
});
