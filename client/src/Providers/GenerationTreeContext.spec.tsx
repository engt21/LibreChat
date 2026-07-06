import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let mockConversationId = 'conversation-1';
let latestExitComplete: (() => void) | undefined;
const renderSnapshots: Array<{
  conversationId: string;
  open: boolean;
  focusMessageId: string | null;
  sourceMessageId: string | null;
}> = [];

jest.mock('./ChatContext', () => ({
  useChatContext: () => ({
    conversation: { conversationId: mockConversationId },
  }),
}));

jest.mock('~/components/Chat/Tree/ConversationTreeDialog', () => ({
  __esModule: true,
  default: ({
    open,
    focusMessageId,
    sourceMessageId,
    sessionKey,
    onOpenChange,
    onExitComplete,
  }: {
    open: boolean;
    focusMessageId: string | null;
    sourceMessageId: string | null;
    sessionKey?: string;
    onOpenChange: (open: boolean) => void;
    onExitComplete?: () => void;
  }) => {
    const React = jest.requireActual<typeof import('react')>('react');
    latestExitComplete = onExitComplete;

    React.useEffect(() => {
      if (open || onExitComplete == null) {
        return;
      }

      const timeout = setTimeout(() => onExitComplete(), 200);
      return () => clearTimeout(timeout);
    }, [open, onExitComplete]);

    return (
      <div
        data-testid="generation-tree-dialog"
        data-open={String(open)}
        data-focused-message-id={focusMessageId ?? ''}
        data-source-message-id={sourceMessageId ?? ''}
        data-session-key={sessionKey ?? ''}
      >
        <button type="button" onClick={() => onOpenChange(false)}>
          close dialog
        </button>
      </div>
    );
  },
}));

import { GenerationTreeProvider, useGenerationTree } from './GenerationTreeContext';

function Controls() {
  const { open, focusMessageId, sourceMessageId, openTree, closeTree } = useGenerationTree();
  renderSnapshots.push({
    conversationId: mockConversationId,
    open,
    focusMessageId,
    sourceMessageId,
  });

  return (
    <>
      <button type="button" onClick={() => openTree({ focusMessageId: 'assistant-1' })}>
        View assistant-1
      </button>
      <button
        type="button"
        onClick={() => openTree({ focusMessageId: 'assistant-2', sourceMessageId: 'assistant-2' })}
      >
        Graft assistant-2
      </button>
      <button
        type="button"
        onClick={() => {
          openTree({ focusMessageId: 'assistant-3', sourceMessageId: 'assistant-3' });
          latestExitComplete?.();
        }}
      >
        Graft assistant-3 with stale exit
      </button>
      <button type="button" onClick={closeTree}>
        Close tree
      </button>
      <output data-testid="provider-state">
        {JSON.stringify({ open, focusMessageId, sourceMessageId })}
      </output>
    </>
  );
}

describe('GenerationTreeProvider', () => {
  beforeEach(() => {
    mockConversationId = 'conversation-1';
    latestExitComplete = undefined;
    renderSnapshots.length = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('opens focused browse mode and source-selected graft mode', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'View assistant-1' }));
    expect(screen.getByTestId('generation-tree-dialog')).toHaveAttribute(
      'data-focused-message-id',
      'assistant-1',
    );
    expect(screen.getByTestId('generation-tree-dialog')).toHaveAttribute(
      'data-source-message-id',
      '',
    );

    await user.click(screen.getByRole('button', { name: 'Graft assistant-2' }));
    expect(screen.getByTestId('generation-tree-dialog')).toHaveAttribute(
      'data-focused-message-id',
      'assistant-2',
    );
    expect(screen.getByTestId('generation-tree-dialog')).toHaveAttribute(
      'data-source-message-id',
      'assistant-2',
    );
  });

  it('keeps ids through the exit window and clears them after the reset delay', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Graft assistant-2' }));
    await user.click(screen.getByRole('button', { name: 'Close tree' }));

    expect(screen.getByTestId('provider-state')).toHaveTextContent('"open":false');
    expect(screen.getByTestId('provider-state')).toHaveTextContent(
      '"focusMessageId":"assistant-2"',
    );
    expect(screen.getByTestId('provider-state')).toHaveTextContent(
      '"sourceMessageId":"assistant-2"',
    );

    act(() => {
      jest.advanceTimersByTime(199);
    });

    expect(screen.getByTestId('provider-state')).toHaveTextContent(
      '"focusMessageId":"assistant-2"',
    );

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(screen.getByTestId('provider-state')).toHaveTextContent('"focusMessageId":null');
    expect(screen.getByTestId('provider-state')).toHaveTextContent('"sourceMessageId":null');
  });

  it('cancels a pending reset when reopened before exit completes', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'View assistant-1' }));
    await user.click(screen.getByRole('button', { name: 'Close tree' }));

    act(() => {
      jest.advanceTimersByTime(100);
    });

    await user.click(screen.getByRole('button', { name: 'Graft assistant-2' }));

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(screen.getByTestId('provider-state')).toHaveTextContent('"open":true');
    expect(screen.getByTestId('provider-state')).toHaveTextContent(
      '"focusMessageId":"assistant-2"',
    );
    expect(screen.getByTestId('provider-state')).toHaveTextContent(
      '"sourceMessageId":"assistant-2"',
    );
  });

  it('keeps a reopened selection when a stale exit callback fires before effects flush', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'View assistant-1' }));
    await user.click(screen.getByRole('button', { name: 'Close tree' }));
    await user.click(screen.getByRole('button', { name: 'Graft assistant-3 with stale exit' }));

    expect(screen.getByTestId('provider-state')).toHaveTextContent('"open":true');
    expect(screen.getByTestId('provider-state')).toHaveTextContent(
      '"focusMessageId":"assistant-3"',
    );
    expect(screen.getByTestId('provider-state')).toHaveTextContent(
      '"sourceMessageId":"assistant-3"',
    );
  });

  it('passes a fresh dialog session key when the same source is reopened', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    render(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Graft assistant-2' }));
    const firstSessionKey = screen
      .getByTestId('generation-tree-dialog')
      .getAttribute('data-session-key');

    await user.click(screen.getByRole('button', { name: 'Close tree' }));
    await user.click(screen.getByRole('button', { name: 'Graft assistant-2' }));

    expect(screen.getByTestId('generation-tree-dialog')).toHaveAttribute(
      'data-source-message-id',
      'assistant-2',
    );
    expect(screen.getByTestId('generation-tree-dialog').getAttribute('data-session-key')).not.toBe(
      firstSessionKey,
    );
  });

  it('closes and clears stale ids when the conversation changes', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    const { rerender } = render(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Graft assistant-2' }));

    mockConversationId = 'conversation-2';
    rerender(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    expect(screen.getByTestId('provider-state')).toHaveTextContent('"open":false');
    expect(screen.getByTestId('provider-state')).toHaveTextContent('"focusMessageId":null');
    expect(screen.getByTestId('provider-state')).toHaveTextContent('"sourceMessageId":null');
  });

  it('never renders stale open, focus, or source state for a new conversation', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    const { rerender } = render(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Graft assistant-2' }));
    renderSnapshots.length = 0;

    mockConversationId = 'conversation-2';
    rerender(
      <GenerationTreeProvider>
        <Controls />
      </GenerationTreeProvider>,
    );

    expect(renderSnapshots).toEqual(
      expect.arrayContaining([
        {
          conversationId: 'conversation-2',
          open: false,
          focusMessageId: null,
          sourceMessageId: null,
        },
      ]),
    );
    expect(
      renderSnapshots.some(
        (snapshot) =>
          snapshot.conversationId === 'conversation-2' &&
          (snapshot.open ||
            snapshot.focusMessageId === 'assistant-2' ||
            snapshot.sourceMessageId === 'assistant-2'),
      ),
    ).toBe(false);
  });
});
