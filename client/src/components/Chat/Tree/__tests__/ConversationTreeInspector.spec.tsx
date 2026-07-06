import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationTreeInspector from '../ConversationTreeInspector';
import { normalizeConversationGraph } from '../graph';
import { layoutConversationTree } from '../layout';

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) =>
    ({
      com_sidepanel_conversation_tree: 'Conversation Tree',
      com_ui_generation_tree_source: 'Source',
      com_ui_generation_tree_destination: 'Destination',
      com_ui_generation_tree_list: 'Tree list',
      com_ui_generation_tree_mode_generation: 'Generation only',
      com_ui_generation_tree_mode_subtree: 'Generation and subtree',
      com_ui_generation_tree_state_complete: 'Complete',
      com_ui_generation_tree_state_stopped_partial: 'Stopped partial',
      com_ui_generation_tree_partial_warning:
        'Partial generations are copied as incomplete prior context.',
      com_ui_generation_tree_counts_messages: 'Messages',
      com_ui_generation_tree_counts_tool_calls: 'Tool calls',
      com_ui_generation_tree_counts_files: 'Files',
      com_ui_generation_tree_counts_images: 'Images',
      com_ui_generation_tree_counts_tokens: 'Approximate tokens',
      com_ui_generation_tree_before_after: 'Branch preview',
      com_ui_generation_tree_create: 'Create graft',
      com_ui_generation_tree_wait_to_finish: 'Wait for it to finish',
      com_ui_generation_tree_stop_and_graft: 'Stop and graft',
      com_ui_cancel: 'Cancel',
      com_ui_generation_tree_undo: 'Undo',
      com_ui_generation_tree_undo_destructive: 'Undo graft and delete later continuation',
      com_ui_generation_tree_status_preview: 'Preview requested',
      com_ui_none: 'None',
    })[key] ?? key,
}));

const graph = normalizeConversationGraph([
  {
    messageId: 'prompt',
    text: 'Prompt',
    isCreatedByUser: true,
  },
  {
    messageId: 'source',
    parentMessageId: 'prompt',
    text: 'Source answer',
    isCreatedByUser: false,
  },
  {
    messageId: 'destination',
    parentMessageId: 'prompt',
    text: 'Destination answer',
    isCreatedByUser: false,
    unfinished: true,
  },
]);

const layout = layoutConversationTree(graph, { orientation: 'horizontal' });
const sourceNode = layout.nodes.get('source') ?? null;
const destinationNode = layout.nodes.get('destination') ?? null;

describe('ConversationTreeInspector', () => {
  it('renders authoritative badges, counts, warnings, and disables create outside the ready phase', () => {
    render(
      <ConversationTreeInspector
        sourceNode={sourceNode}
        destinationNode={destinationNode}
        statusText="Preview requested"
        listOpen={false}
        onToggleList={jest.fn()}
        listContent={<div>List content</div>}
        phase="previewing"
        mode="subtree"
        preview={{
          conversationId: 'convo-1',
          sourceMessageId: 'source',
          destinationMessageId: 'destination',
          mode: 'subtree',
          sourceState: 'complete',
          destinationState: 'stopped_partial',
          copiedMessageIds: ['source'],
          activeSourceLeafMessageId: 'source',
          destinationChildCount: 0,
          counts: {
            messages: 2,
            toolCalls: 1,
            files: 1,
            images: 1,
            approximateTokens: 64,
          },
          warnings: ['Partial'],
          treeRevision: 'server-rev-1',
          requiresStabilization: false,
          activeMessageIds: [],
          conversationActiveWithoutMessageId: false,
          canCreate: true,
        }}
        created={null}
        undoDetails={null}
        error={null}
        stabilization={null}
        onModeChange={jest.fn()}
        onCreate={jest.fn()}
        onUndo={jest.fn()}
        onConfirmUndoContinuations={jest.fn()}
        onStopAndGraft={jest.fn()}
        onWaitForCompletion={jest.fn()}
        onCancelStabilization={jest.fn()}
      />,
    );

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Stopped partial')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(
      screen.getByText('Partial generations are copied as incomplete prior context.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Generation only' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Generation and subtree' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Create graft' })).toBeDisabled();
  });

  it('renders stabilization controls and the destructive undo label when continuation details are loaded', () => {
    const onStopAndGraft = jest.fn();
    const onWaitForCompletion = jest.fn();
    const onCancelStabilization = jest.fn();
    const onConfirmUndoContinuations = jest.fn();

    render(
      <ConversationTreeInspector
        sourceNode={sourceNode}
        destinationNode={destinationNode}
        statusText="Preview requested"
        listOpen={false}
        onToggleList={jest.fn()}
        listContent={<div>List content</div>}
        phase="undo-preview"
        mode="generation"
        preview={null}
        created={{
          graftId: 'graft-1',
          bridgeMessageId: 'bridge-1',
          copiedRootMessageId: 'copy-1',
          activeCopiedMessageId: 'copy-2',
          copiedMessageCount: 2,
          createdMessages: [],
        }}
        undoDetails={{
          graftId: 'graft-1',
          bridgeMessageId: 'bridge-1',
          copiedMessageIds: ['copy-1'],
          continuationMessageIds: ['later-1'],
          copiedCounts: {
            messages: 1,
            toolCalls: 0,
            files: 0,
            images: 0,
            approximateTokens: 10,
          },
          continuationCounts: {
            messages: 1,
            toolCalls: 0,
            files: 0,
            images: 0,
            approximateTokens: 12,
          },
          canUndoWithoutContinuations: false,
          mode: 'generation',
          sourceState: 'complete',
          destinationState: 'complete',
          copiedRootMessageId: 'copy-1',
          activeCopiedMessageId: 'copy-2',
        }}
        error={{
          error: 'Busy',
          code: 'GRAFT_REQUIRES_STABILIZATION',
        }}
        stabilization={{
          activeMessageIds: ['source'],
          conversationActiveWithoutMessageId: false,
        }}
        onModeChange={jest.fn()}
        onCreate={jest.fn()}
        onUndo={jest.fn()}
        onConfirmUndoContinuations={onConfirmUndoContinuations}
        onStopAndGraft={onStopAndGraft}
        onWaitForCompletion={onWaitForCompletion}
        onCancelStabilization={onCancelStabilization}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop and graft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wait for it to finish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Undo graft and delete later continuation' }),
    );

    expect(onStopAndGraft).toHaveBeenCalled();
    expect(onWaitForCompletion).toHaveBeenCalled();
    expect(onCancelStabilization).toHaveBeenCalled();
    expect(onConfirmUndoContinuations).toHaveBeenCalled();
  });
});
