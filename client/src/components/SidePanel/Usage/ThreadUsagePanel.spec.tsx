import { render, screen } from '@testing-library/react';
import ThreadUsagePanel, { getVisibleBranchMessageIds } from './ThreadUsagePanel';

const mockUseGetConversationUsage = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetConversationUsage: (...args: unknown[]) => mockUseGetConversationUsage(...args),
}));

jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    conversation: { conversationId: 'conversation-1' },
    getMessages: () => [
      {
        messageId: 'user-1',
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        isCreatedByUser: true,
      },
      { messageId: 'assistant-1', parentMessageId: 'user-1', isCreatedByUser: false },
    ],
    isSubmitting: false,
    latestMessageId: 'assistant-1',
  }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('@librechat/client', () => ({
  Spinner: () => <span data-testid="spinner" />,
}));

describe('ThreadUsagePanel', () => {
  beforeEach(() => {
    mockUseGetConversationUsage.mockReturnValue({
      isLoading: false,
      isFetching: false,
      error: null,
      data: {
        conversationId: 'conversation-1',
        totals: {
          inputTokens: 1200,
          outputTokens: 300,
          cacheReadTokens: 800,
          cacheWriteTokens: 25,
          toolCalls: 4,
          costUsd: 0.00125,
          costComplete: true,
          pricedTurns: 1,
          unpricedTurns: 0,
        },
        currency: 'USD',
        costBasis: 'recorded_transactions',
        turns: [
          {
            messageId: 'assistant-1',
            model: 'gpt-5.6-sol',
            inputTokens: 1200,
            outputTokens: 300,
            cacheReadTokens: 800,
            cacheWriteTokens: 25,
            toolCalls: 4,
            estimated: false,
            costUsd: 0.00125,
            costComplete: true,
          },
        ],
      },
    });
  });

  it('shows total and per-turn provider usage', () => {
    render(<ThreadUsagePanel />);

    expect(screen.getByText('com_sidepanel_usage_by_turn')).toBeInTheDocument();
    expect(screen.getByText('gpt-5.6-sol')).toBeInTheDocument();
    expect(screen.getAllByText('1.2K')).toHaveLength(2);
    expect(screen.getAllByText('4')).toHaveLength(2);
    expect(screen.getAllByText('$0.00125')).toHaveLength(2);
    expect(mockUseGetConversationUsage).toHaveBeenCalledWith(
      'conversation-1',
      ['user-1', 'assistant-1'],
      true,
      10000,
    );
  });

  it('labels partial recorded costs instead of presenting them as complete', () => {
    mockUseGetConversationUsage.mockReturnValueOnce({
      isLoading: false,
      isFetching: false,
      error: null,
      data: {
        conversationId: 'conversation-1',
        currency: 'USD',
        costBasis: 'recorded_transactions',
        totals: {
          inputTokens: 1200,
          outputTokens: 300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: 0,
          costUsd: 0.0002,
          costComplete: false,
          pricedTurns: 1,
          unpricedTurns: 0,
        },
        turns: [
          {
            messageId: 'assistant-1',
            model: 'private-model',
            inputTokens: 1200,
            outputTokens: 300,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: 0,
            estimated: false,
            costUsd: 0.0002,
            costComplete: false,
          },
        ],
      },
    });

    render(<ThreadUsagePanel />);

    expect(screen.getAllByText('≥$0.0002')).toHaveLength(2);
    expect(screen.getByText('com_sidepanel_usage_cost_partial')).toBeInTheDocument();
  });

  it('shows unavailable pricing as unknown rather than zero dollars', () => {
    mockUseGetConversationUsage.mockReturnValueOnce({
      isLoading: false,
      isFetching: false,
      error: null,
      data: {
        conversationId: 'conversation-1',
        currency: 'USD',
        costBasis: 'recorded_transactions',
        totals: {
          inputTokens: 1200,
          outputTokens: 300,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: 0,
          costUsd: null,
          costComplete: false,
          pricedTurns: 0,
          unpricedTurns: 1,
        },
        turns: [
          {
            messageId: 'assistant-1',
            model: 'unpriced-model',
            inputTokens: 1200,
            outputTokens: 300,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            toolCalls: 0,
            estimated: true,
            costUsd: null,
            costComplete: false,
          },
        ],
      },
    });

    render(<ThreadUsagePanel />);

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('com_sidepanel_usage_cost_unavailable')).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });
});

describe('getVisibleBranchMessageIds', () => {
  it('excludes hidden sibling generations from the visible branch', () => {
    const messages = [
      {
        messageId: 'user-1',
        parentMessageId: '00000000-0000-0000-0000-000000000000',
        children: [
          { messageId: 'assistant-hidden', parentMessageId: 'user-1', children: [] },
          {
            messageId: 'assistant-visible',
            parentMessageId: 'user-1',
            children: [{ messageId: 'user-2', parentMessageId: 'assistant-visible', children: [] }],
          },
        ],
      },
    ] as any;

    expect(getVisibleBranchMessageIds(messages, 'user-2')).toEqual([
      'user-1',
      'assistant-visible',
      'user-2',
    ]);
  });
});
