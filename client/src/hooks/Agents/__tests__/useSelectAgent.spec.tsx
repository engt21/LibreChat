import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EModelEndpoint } from 'librechat-data-provider';
import type { Agent, TConversation } from 'librechat-data-provider';
import useSelectAgent from '../useSelectAgent';

const mockNewConversation = jest.fn();
const mockGetConversation = jest.fn();
const mockGetDefaultConversation = jest.fn();
const mockGetAgentById = jest.fn();
const mockAgentsMap: Record<string, Partial<Agent>> = {
  'agent-openai-tools': {
    id: 'agent-openai-tools',
    name: 'OpenAI tools agent',
    provider: EModelEndpoint.openAI,
    model: 'gpt-5.6',
  },
};

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      getAgentById: (...args: unknown[]) => mockGetAgentById(...args),
    },
  };
});

jest.mock('~/hooks/useNewConvo', () =>
  jest.fn(() => ({
    newConversation: mockNewConversation,
  })),
);

jest.mock('~/hooks/Conversations/useGetConversation', () =>
  jest.fn(() => mockGetConversation),
);

jest.mock('~/hooks/Conversations/useDefaultConvo', () =>
  jest.fn(() => mockGetDefaultConversation),
);

jest.mock('~/Providers/AgentsMapContext', () => ({
  useAgentsMapContext: jest.fn(() => mockAgentsMap),
}));

jest.mock('~/utils', () => ({
  logger: {
    log: jest.fn(),
  },
}));

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

describe('useSelectAgent attachment persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDefaultConversation.mockImplementation(
      ({ conversation, preset }: { conversation: TConversation; preset: TConversation }) => ({
        ...conversation,
        ...preset,
      }),
    );
    mockGetAgentById.mockResolvedValue(mockAgentsMap['agent-openai-tools'] as Agent);
  });

  afterEach(() => {
    mockGetAgentById.mockReset();
  });

  it('preserves uploads when selecting an OpenAI tools agent from a normal chat', async () => {
    mockGetConversation.mockResolvedValue({
      conversationId: 'new',
      endpoint: EModelEndpoint.openAI,
      model: 'gpt-5.6',
    });

    const { result } = renderHook(() => useSelectAgent(), { wrapper });

    await act(async () => {
      await result.current.onSelect('agent-openai-tools');
    });

    await waitFor(() => expect(mockNewConversation).toHaveBeenCalledTimes(2));
    expect(mockNewConversation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        keepFiles: true,
        keepLatestMessage: true,
      }),
    );
    expect(mockNewConversation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        keepFiles: true,
        keepLatestMessage: true,
      }),
    );
  });

  it('preserves uploads when switching from an assistants-backed tool chat', async () => {
    mockGetConversation.mockResolvedValue({
      conversationId: 'new',
      endpoint: EModelEndpoint.assistants,
      model: 'gpt-4.1',
    });

    const { result } = renderHook(() => useSelectAgent(), { wrapper });

    await act(async () => {
      await result.current.onSelect('agent-openai-tools');
    });

    await waitFor(() => expect(mockNewConversation).toHaveBeenCalledTimes(2));
    expect(mockNewConversation).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ keepFiles: true }),
    );
    expect(mockNewConversation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ keepFiles: true }),
    );
  });
});
