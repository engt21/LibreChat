import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationTreeInspector from '../ConversationTreeInspector';
import { normalizeConversationGraph } from '../graph';
import { layoutConversationTree } from '../layout';

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: Record<string, unknown>) =>
    ({
      com_sidepanel_conversation_tree: 'Conversation Tree',
      com_ui_generation_tree_guide_title: 'Append a branch',
      com_ui_generation_tree_guide_description:
        'Use normal taps to choose both ends. Dragging is optional.',
      com_ui_generation_tree_help: 'How to append',
      com_ui_generation_tree_focused_response: 'Focused response',
      com_ui_generation_tree_tap_response_first: 'Tap an assistant response in the tree first.',
      com_ui_generation_tree_source_step: 'Branch to copy',
      com_ui_generation_tree_source_instruction:
        'Tap the first response in the branch you want to copy.',
      com_ui_generation_tree_destination_step: 'Append after',
      com_ui_generation_tree_destination_instruction:
        'Tap the final response in the branch that should come first.',
      com_ui_generation_tree_use_focused_source: 'Use focused response as source',
      com_ui_generation_tree_use_focused_destination: 'Append after focused response',
      com_ui_generation_tree_change: 'Change',
      com_ui_generation_tree_scope: 'What should be copied?',
      com_ui_generation_tree_mode_generation_desc: 'Copies the selected assistant response only.',
      com_ui_generation_tree_mode_subtree_desc:
        'Copies this response and every later message below it.',
      com_ui_generation_tree_recommended: 'Recommended for full threads',
      com_ui_generation_tree_preview_append: 'Preview append',
      com_ui_generation_tree_refresh_preview: 'Refresh preview',
      com_ui_generation_tree_preview_details: 'Preview details',
      com_ui_generation_tree_generation_label: `Generation ${options?.index ?? ''}`.trim(),
      com_ui_generation_tree_generation_position:
        `Generation ${options?.index ?? ''} of ${options?.count ?? ''}`.trim(),
      com_ui_generation_tree_source: 'Source',
      com_ui_generation_tree_destination: 'Destination',
      com_ui_generation_tree_list: 'Tree list',
      com_ui_generation_tree_hide_list: 'Hide list',
      com_ui_generation_tree_mode_generation: 'Only this response',
      com_ui_generation_tree_mode_subtree: 'Whole branch from here',
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
      com_ui_generation_tree_append: 'Append branch',
      com_ui_generation_tree_copied_counts: 'Copied by graft',
      com_ui_generation_tree_continuation_counts: 'Later continuations',
      com_ui_generation_tree_undo_scope_title: 'Undo scope',
      com_ui_generation_tree_undo_scope_description:
        'Deleting later continuations will remove the copied grafted branch and any later follow-up messages.',
      com_ui_generation_tree_undo_target: 'Undo target',
      com_ui_generation_tree_continuation_scope: 'Continuation scope',
      com_ui_generation_tree_continuation_scope_more: `+${options?.count ?? 0} more`,
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
const guidedProps = {
  focusedNode: sourceNode,
  canUseFocusedAsSource: true,
  canUseFocusedAsDestination: true,
  focusedSelectionError: null,
  onUseFocusedAsSource: jest.fn(),
  onUseFocusedAsDestination: jest.fn(),
  onClearSource: jest.fn(),
  onClearDestination: jest.fn(),
  onRequestPreview: jest.fn(),
  onOpenHelp: jest.fn(),
};

describe('ConversationTreeInspector', () => {
  it('renders authoritative badges, counts, warnings, and disables create outside the ready phase', () => {
    render(
      <ConversationTreeInspector
        {...guidedProps}
        sourceNode={sourceNode}
        destinationNode={destinationNode}
        statusText="Preview requested"
        listOpen={false}
        onToggleList={jest.fn()}
        listContent={<div>List content</div>}
        phase="previewing"
        pendingAction={null}
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
          warnings: [
            'Server warning',
            'Partial generations are copied as incomplete prior context.',
            'Server warning',
          ],
          treeRevision: 'server-rev-1',
          requiresStabilization: false,
          activeMessageIds: [],
          conversationActiveWithoutMessageId: false,
          canCreate: true,
        }}
        created={null}
        pendingUndoTarget={null}
        error={null}
        stabilization={null}
        onModeChange={jest.fn()}
        onCreate={jest.fn()}
        onUndo={jest.fn()}
        onConfirmUndoContinuations={jest.fn()}
        onCancelPendingUndoTarget={jest.fn()}
        onStopAndGraft={jest.fn()}
        onWaitForCompletion={jest.fn()}
        onCancelStabilization={jest.fn()}
      />,
    );

    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText('Stopped partial')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('64')).toBeInTheDocument();
    expect(screen.getByText('Server warning')).toBeInTheDocument();
    expect(
      screen.getAllByText('Partial generations are copied as incomplete prior context.'),
    ).toHaveLength(1);
    expect(screen.getAllByText('Server warning')).toHaveLength(1);
    expect(screen.getByTestId('generation-tree-inspector')).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('generation-tree-inspector-scroll')).toHaveClass('overflow-y-auto');
    expect(screen.getByTestId('generation-tree-actions')).toHaveClass('shrink-0');
    expect(screen.getByRole('radio', { name: /Only this response/ })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: /Whole branch from here/ })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Append branch' })).toBeDisabled();
  });

  it('renders stabilization controls and the destructive undo label when continuation details are loaded', () => {
    const onStopAndGraft = jest.fn();
    const onWaitForCompletion = jest.fn();
    const onCancelStabilization = jest.fn();
    const onCancelPendingUndoTarget = jest.fn();
    const onConfirmUndoContinuations = jest.fn();

    render(
      <ConversationTreeInspector
        {...guidedProps}
        sourceNode={sourceNode}
        destinationNode={destinationNode}
        statusText="Preview requested"
        listOpen={false}
        onToggleList={jest.fn()}
        listContent={<div>List content</div>}
        phase="undo-preview"
        pendingAction={null}
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
        pendingUndoTarget={{
          graftId: 'graft-1',
          created: {
            graftId: 'graft-1',
            bridgeMessageId: 'bridge-1',
            copiedRootMessageId: 'copy-1',
            activeCopiedMessageId: 'copy-2',
            copiedMessageCount: 2,
            createdMessages: [],
          },
          details: {
            graftId: 'graft-1',
            bridgeMessageId: 'bridge-1',
            copiedMessageIds: ['copy-1'],
            continuationMessageIds: [
              'continuation-message-0001',
              'continuation-message-0002',
              'continuation-message-0003',
              'continuation-message-0004',
              'continuation-message-0005',
              'continuation-message-0006',
            ],
            copiedCounts: {
              messages: 3,
              toolCalls: 2,
              files: 1,
              images: 0,
              approximateTokens: 120,
            },
            continuationCounts: {
              messages: 6,
              toolCalls: 1,
              files: 2,
              images: 1,
              approximateTokens: 240,
            },
            canUndoWithoutContinuations: false,
            mode: 'generation',
            sourceState: 'complete',
            destinationState: 'complete',
            copiedRootMessageId: 'copy-1',
            activeCopiedMessageId: 'copy-2',
          },
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
        onCancelPendingUndoTarget={onCancelPendingUndoTarget}
        onStopAndGraft={onStopAndGraft}
        onWaitForCompletion={onWaitForCompletion}
        onCancelStabilization={onCancelStabilization}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Stop and graft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wait for it to finish' }));
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' });
    fireEvent.click(cancelButtons[0]);
    fireEvent.click(cancelButtons[1]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Undo graft and delete later continuation' }),
    );

    expect(screen.getByText('Undo scope')).toBeInTheDocument();
    expect(screen.getByText('Copied by graft')).toBeInTheDocument();
    expect(screen.getByText('Later continuations')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('240')).toBeInTheDocument();
    expect(screen.getByText('Continuation scope')).toBeInTheDocument();
    expect(
      screen.getByText('...age-0001, ...age-0002, ...age-0003, ...age-0004, ...age-0005 +1 more'),
    ).toBeInTheDocument();
    expect(onStopAndGraft).toHaveBeenCalled();
    expect(onWaitForCompletion).toHaveBeenCalled();
    expect(onCancelStabilization).toHaveBeenCalled();
    expect(onCancelPendingUndoTarget).toHaveBeenCalled();
    expect(onConfirmUndoContinuations).toHaveBeenCalled();
  });

  it('labels the exact destructive undo target when the current created graft differs from the pending continuation details', () => {
    render(
      <ConversationTreeInspector
        {...guidedProps}
        sourceNode={sourceNode}
        destinationNode={destinationNode}
        statusText="Preview requested"
        listOpen={false}
        onToggleList={jest.fn()}
        listContent={<div>List content</div>}
        phase="undo-preview"
        pendingAction={null}
        mode="generation"
        preview={null}
        created={{
          graftId: 'graft-b',
          bridgeMessageId: 'bridge-b',
          copiedRootMessageId: 'copy-b-1',
          activeCopiedMessageId: 'copy-b-2',
          copiedMessageCount: 2,
          createdMessages: [],
        }}
        pendingUndoTarget={{
          graftId: 'graft-a',
          created: null,
          details: {
            graftId: 'graft-a',
            bridgeMessageId: 'bridge-a',
            copiedMessageIds: ['copy-a-1'],
            continuationMessageIds: ['continuation-message-0001'],
            copiedCounts: {
              messages: 1,
              toolCalls: 0,
              files: 0,
              images: 0,
              approximateTokens: 32,
            },
            continuationCounts: {
              messages: 1,
              toolCalls: 0,
              files: 0,
              images: 0,
              approximateTokens: 16,
            },
            canUndoWithoutContinuations: false,
            mode: 'generation',
            sourceState: 'complete',
            destinationState: 'complete',
            copiedRootMessageId: 'copy-a-1',
            activeCopiedMessageId: 'copy-a-2',
          },
        }}
        error={null}
        stabilization={null}
        onModeChange={jest.fn()}
        onCreate={jest.fn()}
        onUndo={jest.fn()}
        onConfirmUndoContinuations={jest.fn()}
        onCancelPendingUndoTarget={jest.fn()}
        onStopAndGraft={jest.fn()}
        onWaitForCompletion={jest.fn()}
        onCancelStabilization={jest.fn()}
      />,
    );

    expect(screen.getByText('Undo target')).toBeInTheDocument();
    expect(screen.getByText('graft-a')).toBeInTheDocument();
  });

  it('keeps destructive recovery visible and cancellable when no current created graft remains', () => {
    const onConfirmUndoContinuations = jest.fn();
    const onCancelPendingUndoTarget = jest.fn();

    render(
      <ConversationTreeInspector
        {...guidedProps}
        sourceNode={sourceNode}
        destinationNode={destinationNode}
        statusText="Preview requested"
        listOpen={false}
        onToggleList={jest.fn()}
        listContent={<div>List content</div>}
        phase="undo-preview"
        pendingAction={null}
        mode="generation"
        preview={null}
        created={null}
        pendingUndoTarget={{
          graftId: 'graft-a',
          created: null,
          details: {
            graftId: 'graft-a',
            bridgeMessageId: 'bridge-a',
            copiedMessageIds: ['copy-a-1'],
            continuationMessageIds: ['continuation-message-0001'],
            copiedCounts: {
              messages: 1,
              toolCalls: 0,
              files: 0,
              images: 0,
              approximateTokens: 32,
            },
            continuationCounts: {
              messages: 1,
              toolCalls: 0,
              files: 0,
              images: 0,
              approximateTokens: 16,
            },
            canUndoWithoutContinuations: false,
            mode: 'generation',
            sourceState: 'complete',
            destinationState: 'complete',
            copiedRootMessageId: 'copy-a-1',
            activeCopiedMessageId: 'copy-a-2',
          },
        }}
        error={null}
        stabilization={null}
        onModeChange={jest.fn()}
        onCreate={jest.fn()}
        onUndo={jest.fn()}
        onConfirmUndoContinuations={onConfirmUndoContinuations}
        onCancelPendingUndoTarget={onCancelPendingUndoTarget}
        onStopAndGraft={jest.fn()}
        onWaitForCompletion={jest.fn()}
        onCancelStabilization={jest.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(screen.getByText('Undo scope')).toBeInTheDocument();
    expect(screen.getByText('Undo target')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Undo graft and delete later continuation' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onConfirmUndoContinuations).toHaveBeenCalled();
    expect(onCancelPendingUndoTarget).toHaveBeenCalled();
  });

  it('disables destructive controls and exposes busy state while an action is already pending', () => {
    render(
      <ConversationTreeInspector
        {...guidedProps}
        sourceNode={sourceNode}
        destinationNode={destinationNode}
        statusText="Preview requested"
        listOpen={false}
        onToggleList={jest.fn()}
        listContent={<div>List content</div>}
        phase="undo-preview"
        pendingAction="undo-destructive"
        mode="generation"
        preview={{
          conversationId: 'convo-1',
          sourceMessageId: 'source',
          destinationMessageId: 'destination',
          mode: 'generation',
          sourceState: 'complete',
          destinationState: 'complete',
          copiedMessageIds: ['source'],
          activeSourceLeafMessageId: 'source',
          destinationChildCount: 0,
          counts: {
            messages: 1,
            toolCalls: 0,
            files: 0,
            images: 0,
            approximateTokens: 12,
          },
          warnings: [],
          treeRevision: 'server-rev-1',
          requiresStabilization: false,
          activeMessageIds: [],
          conversationActiveWithoutMessageId: false,
          canCreate: true,
        }}
        created={{
          graftId: 'graft-1',
          bridgeMessageId: 'bridge-1',
          copiedRootMessageId: 'copy-1',
          activeCopiedMessageId: 'copy-2',
          copiedMessageCount: 2,
          createdMessages: [],
        }}
        pendingUndoTarget={{
          graftId: 'graft-1',
          created: null,
          details: {
            graftId: 'graft-1',
            bridgeMessageId: 'bridge-1',
            copiedMessageIds: ['copy-1'],
            continuationMessageIds: ['later-1'],
            copiedCounts: {
              messages: 2,
              toolCalls: 0,
              files: 0,
              images: 0,
              approximateTokens: 12,
            },
            continuationCounts: {
              messages: 1,
              toolCalls: 0,
              files: 0,
              images: 0,
              approximateTokens: 8,
            },
            canUndoWithoutContinuations: false,
            mode: 'generation',
            sourceState: 'complete',
            destinationState: 'complete',
            copiedRootMessageId: 'copy-1',
            activeCopiedMessageId: 'copy-2',
          },
        }}
        error={null}
        stabilization={{
          activeMessageIds: ['source'],
          conversationActiveWithoutMessageId: false,
        }}
        onModeChange={jest.fn()}
        onCreate={jest.fn()}
        onUndo={jest.fn()}
        onConfirmUndoContinuations={jest.fn()}
        onCancelPendingUndoTarget={jest.fn()}
        onStopAndGraft={jest.fn()}
        onWaitForCompletion={jest.fn()}
        onCancelStabilization={jest.fn()}
      />,
    );

    expect(screen.getByTestId('generation-tree-inspector')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Append branch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Undo graft and delete later continuation' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop and graft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Wait for it to finish' })).toBeDisabled();
  });
});
