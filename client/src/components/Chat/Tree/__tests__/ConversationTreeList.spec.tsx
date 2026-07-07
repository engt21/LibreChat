import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConversationTreeGraph } from '../types';
import { normalizeConversationGraph } from '../graph';
import ConversationTreeList from '../ConversationTreeList';

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: Record<string, unknown>) =>
    ({
      com_ui_generation_tree_list: 'Tree list',
      com_ui_generation_tree_source: 'Source',
      com_ui_generation_tree_error_invalid: 'Choose a valid generation for this action.',
      com_ui_generation_tree_error_source: 'Choose an assistant generation as the source.',
      com_ui_generation_tree_error_destination:
        'Choose an assistant generation as the destination.',
      com_ui_generation_tree_error_overlap:
        'Choose a different destination outside the source branch.',
      com_ui_generation_tree_error_busy: 'The conversation is still changing. Try again shortly.',
      com_ui_generation_tree_error_select_source:
        'Choose a source generation before requesting a preview.',
      com_ui_generation_tree_status_source_selected:
        'Source selected. Choose a destination generation.',
      com_ui_generation_tree_status_preview: 'Preview requested',
      com_ui_generation_tree_announcer_closed: 'Conversation tree closed.',
      com_ui_generation_tree_generation_label: `Generation ${options?.index ?? ''}`.trim(),
      com_ui_generation_tree_node_graft_bridge: 'Graft bridge',
      com_ui_generation_tree_node_prompt: 'Prompt',
    })[key] ?? key,
}));

type TestMessage = {
  messageId: string;
  parentMessageId?: string | null;
  text: string;
  isCreatedByUser: boolean;
  unfinished?: boolean;
  error?: boolean;
  finish_reason?: string;
};

const createMessage = (overrides: Partial<TestMessage>): TestMessage => ({
  messageId: 'message-1',
  parentMessageId: null,
  text: '',
  isCreatedByUser: false,
  ...overrides,
});

const createGraph = (): ConversationTreeGraph =>
  normalizeConversationGraph([
    createMessage({
      messageId: 'prompt',
      text: 'Prompt',
      isCreatedByUser: true,
    }),
    createMessage({
      messageId: 'assistant-a',
      parentMessageId: 'prompt',
      text: 'Generation 1 answer',
      isCreatedByUser: false,
    }),
    createMessage({
      messageId: 'assistant-b',
      parentMessageId: 'prompt',
      text: 'Generation 2 answer',
      isCreatedByUser: false,
    }),
  ]);

const createLifecycleGraph = (): ConversationTreeGraph =>
  normalizeConversationGraph(
    [
      createMessage({
        messageId: 'prompt',
        text: 'Prompt',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'assistant-stopped',
        parentMessageId: 'prompt',
        text: 'Stopped generation',
        isCreatedByUser: false,
        unfinished: true,
      }),
      createMessage({
        messageId: 'assistant-errored',
        parentMessageId: 'prompt',
        text: 'Errored generation',
        isCreatedByUser: false,
        error: true,
      }),
      createMessage({
        messageId: 'assistant-streaming',
        parentMessageId: 'prompt',
        text: 'Streaming generation',
        isCreatedByUser: false,
      }),
    ],
    { activeMessageIds: new Set(['assistant-streaming']) },
  );

describe('ConversationTreeList', () => {
  it('supports keyboard source and destination selection', async () => {
    const user = userEvent.setup();
    const graph = createGraph();
    const onSelectSource = jest.fn();
    const onSelectDestination = jest.fn();
    const onPreviewRequest = jest.fn();

    render(
      <ConversationTreeList
        graph={graph}
        collapsedIds={new Set()}
        focusedMessageId="assistant-b"
        sourceMessageId="assistant-b"
        destinationMessageId={null}
        onFocusMessage={jest.fn()}
        onSelectSource={onSelectSource}
        onSelectDestination={onSelectDestination}
        onPreviewRequest={onPreviewRequest}
        onCollapsedIdsChange={jest.fn()}
        onCancelSelection={jest.fn()}
      />,
    );

    const source = screen.getByRole('treeitem', { name: /generation 2/i });
    await user.click(source);
    await user.keyboard(' ');

    const destination = screen.getByRole('treeitem', { name: /generation 1/i });
    await user.click(destination);
    await user.keyboard('{Enter}');

    expect(onSelectSource).toHaveBeenCalledWith('assistant-b');
    expect(onSelectDestination).toHaveBeenCalledWith('assistant-a');
    expect(onPreviewRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('generation-tree-list-status')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('generation-tree-list-status')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('supports roving keyboard navigation and escape cancellation', async () => {
    const user = userEvent.setup();
    const graph = createGraph();
    const onCancelSelection = jest.fn();
    const onFocusMessage = jest.fn();

    render(
      <ConversationTreeList
        graph={graph}
        collapsedIds={new Set()}
        focusedMessageId="assistant-a"
        sourceMessageId="assistant-b"
        destinationMessageId={null}
        onFocusMessage={onFocusMessage}
        onSelectSource={jest.fn()}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onCollapsedIdsChange={jest.fn()}
        onCancelSelection={onCancelSelection}
      />,
    );

    const firstGeneration = screen.getByRole('treeitem', { name: /generation 1/i });
    await user.click(firstGeneration);

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: /generation 2/i })).toHaveFocus();

    await user.keyboard('{Home}');
    expect(screen.getByRole('treeitem', { name: /prompt/i })).toHaveFocus();

    await user.keyboard('{End}');
    expect(screen.getByRole('treeitem', { name: /generation 2/i })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onCancelSelection).toHaveBeenCalledTimes(1);
    expect(onFocusMessage).toHaveBeenCalled();
  });

  it('treats stopped and errored assistant generations as valid source and destination candidates', async () => {
    const user = userEvent.setup();
    const graph = createLifecycleGraph();
    const onSelectSource = jest.fn();
    const onSelectDestination = jest.fn();
    const onPreviewRequest = jest.fn();

    render(
      <ConversationTreeList
        graph={graph}
        collapsedIds={new Set()}
        focusedMessageId="assistant-stopped"
        sourceMessageId="assistant-stopped"
        destinationMessageId={null}
        onFocusMessage={jest.fn()}
        onSelectSource={onSelectSource}
        onSelectDestination={onSelectDestination}
        onPreviewRequest={onPreviewRequest}
        onCollapsedIdsChange={jest.fn()}
        onCancelSelection={jest.fn()}
      />,
    );

    const source = screen.getByRole('treeitem', { name: /generation 1/i });
    await user.click(source);
    await user.keyboard(' ');

    const destination = screen.getByRole('treeitem', { name: /generation 2/i });
    await user.click(destination);
    await user.keyboard('{Enter}');

    expect(onSelectSource).toHaveBeenCalledWith('assistant-stopped');
    expect(onSelectDestination).toHaveBeenCalledWith('assistant-errored');
    expect(onPreviewRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('generation-tree-list-status')).toHaveTextContent(
      'Preview requested',
    );
  });

  it('blocks actively streaming generations while keeping the status visible', async () => {
    const user = userEvent.setup();
    const graph = createLifecycleGraph();
    const onSelectSource = jest.fn();

    render(
      <ConversationTreeList
        graph={graph}
        collapsedIds={new Set()}
        focusedMessageId="assistant-streaming"
        sourceMessageId={null}
        destinationMessageId={null}
        onFocusMessage={jest.fn()}
        onSelectSource={onSelectSource}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onCollapsedIdsChange={jest.fn()}
        onCancelSelection={jest.fn()}
      />,
    );

    const streamingNode = screen.getByRole('treeitem', { name: /generation 3/i });
    await user.click(streamingNode);
    await user.keyboard(' ');

    expect(onSelectSource).not.toHaveBeenCalled();
    expect(screen.getByTestId('generation-tree-list-status')).toHaveTextContent(
      'The conversation is still changing. Try again shortly.',
    );
  });

  it('announces keyboard validation errors through the live status region', async () => {
    const user = userEvent.setup();
    const graph = createGraph();

    render(
      <ConversationTreeList
        graph={graph}
        collapsedIds={new Set()}
        focusedMessageId="assistant-a"
        sourceMessageId={null}
        destinationMessageId={null}
        onFocusMessage={jest.fn()}
        onSelectSource={jest.fn()}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onCollapsedIdsChange={jest.fn()}
        onCancelSelection={jest.fn()}
      />,
    );

    await user.click(screen.getByRole('treeitem', { name: /generation 1/i }));
    await user.keyboard('{Enter}');

    expect(screen.getByTestId('generation-tree-list-status')).toHaveTextContent(
      'Choose a source generation before requesting a preview.',
    );
  });
});
