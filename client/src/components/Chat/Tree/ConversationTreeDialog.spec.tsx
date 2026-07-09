import React from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithQueryClient } from './queryClientTestUtils';

const mockPreviewMutateAsync = jest.fn();
const mockCreateMutateAsync = jest.fn();
const mockUndoMutateAsync = jest.fn();
const mockShowToast = jest.fn();

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: Record<string, unknown>) =>
    ({
      com_sidepanel_conversation_tree: 'Conversation Tree',
      com_ui_conversation_tree_description:
        'Append one response or a whole branch after another response without changing the original.',
      com_ui_generation_tree_help: 'How to append',
      com_ui_generation_tree_guide_title: 'Append a branch',
      com_ui_generation_tree_guide_description:
        'Use normal taps to choose both ends. Dragging is optional.',
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
      com_ui_generation_tree_source: 'Source',
      com_ui_generation_tree_destination: 'Destination',
      com_ui_generation_tree_generation_label: `Generation ${options?.index ?? ''}`.trim(),
      com_ui_generation_tree_generation_position:
        `Generation ${options?.index ?? ''} of ${options?.count ?? ''}`.trim(),
      com_ui_generation_tree_before_after: 'Branch preview',
      com_ui_generation_tree_preview_pending: 'Preview pending',
      com_ui_generation_tree_append: 'Append branch',
      com_ui_generation_tree_created_success: 'Branch appended.',
      com_ui_generation_tree_undo: 'Undo',
      com_ui_generation_tree_mode_generation: 'Only this response',
      com_ui_generation_tree_mode_subtree: 'Whole branch from here',
      com_ui_generation_tree_list: 'Browse list',
      com_ui_generation_tree_hide_list: 'Hide list',
      com_ui_generation_tree_status_preview: 'Preview requested',
      com_ui_generation_tree_state_complete: 'Complete',
      com_ui_generation_tree_counts_messages: 'Messages',
      com_ui_generation_tree_counts_tool_calls: 'Tool calls',
      com_ui_generation_tree_counts_files: 'Files',
      com_ui_generation_tree_counts_images: 'Images',
      com_ui_generation_tree_counts_tokens: 'Approximate tokens',
      com_ui_none: 'None',
    })[key] ?? key,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');

  return {
    ...actual,
    useMediaQuery: jest.fn(() => false),
    useToastContext: () => ({
      showToast: mockShowToast,
    }),
  };
});

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: () => ({
    conversation: { conversationId: 'convo-1' },
    getMessages: () => [
      {
        messageId: 'prompt',
        text: 'Prompt',
        isCreatedByUser: true,
      },
      {
        messageId: 'assistant-1',
        parentMessageId: 'prompt',
        text: 'Assistant 1',
        isCreatedByUser: false,
      },
      {
        messageId: 'assistant-2',
        parentMessageId: 'prompt',
        text: 'Assistant 2',
        isCreatedByUser: false,
      },
    ],
    latestMessageId: 'assistant-2',
    isSubmitting: false,
  }),
}));

jest.mock('~/data-provider', () => ({
  useStreamStatus: jest.fn(() => ({
    data: {
      active: false,
      responseMessageId: null,
    },
  })),
}));

jest.mock('~/data-provider/Messages/generationGrafts', () => ({
  usePreviewGenerationGraft: () => ({
    mutateAsync: mockPreviewMutateAsync,
    isPending: false,
  }),
  useCreateGenerationGraft: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
  }),
  useUndoGenerationGraft: () => ({
    mutateAsync: mockUndoMutateAsync,
    isPending: false,
  }),
  generationGraftDetailsQueryKey: (conversationId: string, graftId: string) => [
    'generationGraft',
    conversationId,
    graftId,
  ],
}));

import ConversationTreeDialog from './ConversationTreeDialog';

describe('ConversationTreeDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPreviewMutateAsync.mockResolvedValue({
      conversationId: 'convo-1',
      sourceMessageId: 'assistant-1',
      destinationMessageId: 'assistant-2',
      mode: 'generation',
      sourceState: 'complete',
      destinationState: 'complete',
      copiedMessageIds: ['assistant-1'],
      activeSourceLeafMessageId: 'assistant-1',
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
    });
    mockCreateMutateAsync.mockResolvedValue({
      graftId: 'graft-1',
      bridgeMessageId: 'bridge-1',
      copiedRootMessageId: 'copy-1',
      activeCopiedMessageId: 'copy-1',
      copiedMessageCount: 1,
      createdMessages: [
        {
          messageId: 'bridge-1',
          conversationId: 'convo-1',
          text: 'Bridge',
        },
        {
          messageId: 'copy-1',
          conversationId: 'convo-1',
          text: 'Copy',
        },
      ],
    });
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('uses the 200ms fallback exit callback and cancels it when reopened', () => {
    const onExitComplete = jest.fn();
    const onOpenChange = jest.fn();
    const { rerender } = renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        sessionKey="session-1"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const description = screen.getByText(
      'Append one response or a whole branch after another response without changing the original.',
    );

    expect(dialog).toHaveAttribute('aria-describedby', description.getAttribute('id'));
    expect(description.tagName.toLowerCase()).toBe('p');

    rerender(
      <ConversationTreeDialog
        open={false}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        sessionKey="session-1"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(199);
    });

    expect(onExitComplete).not.toHaveBeenCalled();

    rerender(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-2"
        sourceMessageId="assistant-2"
        sessionKey="session-2"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(onExitComplete).not.toHaveBeenCalled();

    rerender(
      <ConversationTreeDialog
        open={false}
        focusMessageId="assistant-2"
        sourceMessageId="assistant-2"
        sessionKey="session-2"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(onExitComplete).toHaveBeenCalledTimes(1);
  });

  it('previews the destination selected by the same drag interaction', async () => {
    const originalElementsFromPoint = document.elementsFromPoint;
    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        sessionKey="drag-preview"
        onOpenChange={jest.fn()}
      />,
    );

    document.elementsFromPoint = jest.fn(() => [screen.getByTestId('tree-node-assistant-2')]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-1'), {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 220,
      clientY: 80,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 220,
      clientY: 80,
    });

    await waitFor(() =>
      expect(mockPreviewMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceMessageId: 'assistant-1',
          destinationMessageId: 'assistant-2',
          mode: 'generation',
        }),
      ),
    );

    document.elementsFromPoint = originalElementsFromPoint;
  });

  it('resets the inspector to a clean selecting state when the same source is reopened with a new session key', async () => {
    const originalElementsFromPoint = document.elementsFromPoint;
    const { rerender } = renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        sessionKey="session-1"
        onOpenChange={jest.fn()}
      />,
    );

    document.elementsFromPoint = jest.fn(() => [screen.getByTestId('tree-node-assistant-2')]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-1'), {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 220,
      clientY: 80,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 220,
      clientY: 80,
    });

    expect(screen.getByRole('status')).toHaveTextContent('Preview requested');

    rerender(
      <ConversationTreeDialog
        open={false}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        sessionKey="session-1"
        onOpenChange={jest.fn()}
      />,
    );

    rerender(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        sessionKey="session-2"
        onOpenChange={jest.fn()}
      />,
    );

    document.elementsFromPoint = originalElementsFromPoint;

    expect(screen.getByRole('button', { name: 'Append branch' })).toBeDisabled();
    expect(screen.getByTestId('generation-tree-selection-guide')).toBeInTheDocument();
    expect(screen.queryByText('Assistant 1 → Assistant 2')).not.toBeInTheDocument();
  });
});
