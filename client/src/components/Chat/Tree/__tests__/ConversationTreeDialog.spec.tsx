import React from 'react';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { dataService } from 'librechat-data-provider';
import { renderWithQueryClient } from '../queryClientTestUtils';

const mockUseGenerationGraft = jest.fn();

let mockIsMobile = false;
let mockConversationId = 'convo-1';
let mockLatestMessageId = 'assistant-b';
let mockIsSubmitting = true;
let mockStreamStatus = {
  data: {
    active: true,
    responseMessageId: 'assistant-b',
  },
};
let mockMessages = [
  {
    messageId: 'prompt',
    text: 'Prompt',
    isCreatedByUser: true,
  },
  {
    messageId: 'assistant-a',
    parentMessageId: 'prompt',
    text: 'Generation 1',
    isCreatedByUser: false,
  },
  {
    messageId: 'assistant-a-user',
    parentMessageId: 'assistant-a',
    text: 'Follow up 1',
    isCreatedByUser: true,
  },
  {
    messageId: 'assistant-a-child',
    parentMessageId: 'assistant-a-user',
    text: 'Nested generation 1',
    isCreatedByUser: false,
  },
  {
    messageId: 'assistant-b',
    parentMessageId: 'prompt',
    text: 'Generation 2',
    isCreatedByUser: false,
  },
];

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  const createGenerationGraft = jest.fn();

  return {
    ...actual,
    dataService: {
      ...actual.dataService,
      createGenerationGraft,
    },
  };
});

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: Record<string, unknown>) =>
    ({
      com_sidepanel_conversation_tree: 'Conversation Tree',
      com_ui_conversation_tree_description:
        'Append one response or a whole branch after another response without changing the original.',
      com_ui_generation_tree_help: 'How to append',
      com_ui_generation_tree_help_title: 'How branch appending works',
      com_ui_generation_tree_help_intro:
        'Copy a response or a complete branch onto the end of another branch.',
      com_ui_generation_tree_help_quick_title: 'The guided flow',
      com_ui_generation_tree_help_source_title: 'Choose the branch to copy',
      com_ui_generation_tree_help_source_desc:
        'Tap its first assistant response, then choose Use focused response as source.',
      com_ui_generation_tree_help_destination_title: 'Choose the append point',
      com_ui_generation_tree_help_destination_desc:
        'Tap the final assistant response in the branch that should come first, then choose Append after focused response.',
      com_ui_generation_tree_help_scope_title: 'Choose the copy scope',
      com_ui_generation_tree_help_scope_desc:
        'Use Whole branch from here for a complete thread, or Only this response for one answer.',
      com_ui_generation_tree_help_review_title: 'Preview and append',
      com_ui_generation_tree_help_review_desc:
        'Check the message, tool, file, image, and token counts.',
      com_ui_generation_tree_help_example_title:
        'Example: append the full 2 of 2 branch after the 1 of 2 branch',
      com_ui_generation_tree_help_branch_copy: 'Branch to copy',
      com_ui_generation_tree_help_branch_copy_desc:
        'Tap the first Generation 2 of 2 response and select Whole branch from here.',
      com_ui_generation_tree_help_branch_keep: 'Branch that comes first',
      com_ui_generation_tree_help_branch_keep_desc:
        'Tap the final response at the end of the complete Generation 1 of 2 branch.',
      com_ui_generation_tree_help_result:
        'LibreChat copies the full 2 of 2 branch after that final 1 of 2 response.',
      com_ui_generation_tree_help_advanced_title: 'Advanced controls',
      com_ui_generation_tree_help_drag_title: 'Drag and drop',
      com_ui_generation_tree_help_drag_desc: 'Drag the Append handle to open the same preview.',
      com_ui_generation_tree_help_keyboard_title: 'Keyboard and list',
      com_ui_generation_tree_help_keyboard_desc: 'Open Browse list.',
      com_ui_generation_tree_help_undo_title: 'Safe undo',
      com_ui_generation_tree_help_undo_desc: 'Undo removes only the copied branch.',
      com_ui_generation_tree_help_start: 'Start guided append',
      com_ui_back: 'Back',
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
      com_ui_generation_tree_use_as_source_short: 'Use as source',
      com_ui_generation_tree_append_here: 'Append here',
      com_ui_generation_tree_review_append: 'Review append',
      com_ui_generation_tree_source_selected: 'Source selected',
      com_ui_generation_tree_change: 'Change',
      com_ui_generation_tree_scope: 'What should be copied?',
      com_ui_generation_tree_mode_generation: 'Only this response',
      com_ui_generation_tree_mode_generation_desc: 'Copies the selected assistant response only.',
      com_ui_generation_tree_mode_subtree: 'Whole branch from here',
      com_ui_generation_tree_mode_subtree_desc:
        'Copies this response and every later message below it.',
      com_ui_generation_tree_recommended: 'Recommended for full threads',
      com_ui_generation_tree_preview_append: 'Preview append',
      com_ui_generation_tree_refresh_preview: 'Refresh preview',
      com_ui_generation_tree_preview_details: 'Preview details',
      com_ui_generation_tree_source: 'Source',
      com_ui_generation_tree_destination: 'Destination',
      com_ui_generation_tree_fit: 'Fit tree',
      com_ui_generation_tree_fit_active_branch: 'Fit active branch',
      com_ui_generation_tree_fit_selection: 'Fit selection',
      com_ui_generation_tree_orientation: 'Orientation',
      com_ui_generation_tree_arrange: 'Arrange tree',
      com_ui_generation_tree_reset_layout: 'Reset layout',
      com_ui_generation_tree_expand_collapse: 'Expand or collapse',
      com_ui_generation_tree_error_overlap:
        'Choose a different destination outside the source branch.',
      com_ui_generation_tree_error_invalid: 'Choose a valid generation for this action.',
      com_ui_generation_tree_error_source: 'Choose an assistant generation as the source.',
      com_ui_generation_tree_error_destination:
        'Choose an assistant generation as the destination.',
      com_ui_generation_tree_error_select_source:
        'Choose a source generation before requesting a preview.',
      com_ui_generation_tree_error_busy: 'The conversation is still changing. Try again shortly.',
      com_ui_generation_tree_announcer_opened: 'Conversation tree opened.',
      com_ui_generation_tree_announcer_closed: 'Conversation tree closed.',
      com_ui_generation_tree_status_source_selected:
        'Source selected. Choose a destination generation.',
      com_ui_none: 'None',
      com_ui_generation_tree_mobile_summary: 'Tree summary',
      com_ui_generation_tree_open_sheet: 'Open tree details',
      com_ui_close: 'Close',
      com_ui_generation_tree_list: 'Browse list',
      com_ui_generation_tree_hide_list: 'Hide list',
      com_ui_generation_tree_status_preview: 'Preview requested',
      com_ui_generation_tree_preview_pending: 'Preview pending',
      com_ui_generation_tree_layout_horizontal: 'Horizontal layout',
      com_ui_generation_tree_layout_vertical: 'Vertical layout',
      com_ui_generation_tree_generation_label: `Generation ${options?.index ?? ''}`.trim(),
      com_ui_generation_tree_generation_position:
        `Generation ${options?.index ?? ''} of ${options?.count ?? ''}`.trim(),
      com_ui_generation_tree_node_graft_bridge: 'Graft bridge',
      com_ui_generation_tree_node_prompt: 'Prompt',
      com_ui_generation_tree_node_empty: 'No content',
      com_ui_generation_tree_badge_tool: 'Tool',
      com_ui_generation_tree_badge_file: 'File',
      com_ui_generation_tree_badge_image: 'Image',
      com_ui_generation_tree_badge_reasoning: 'Reasoning',
      com_ui_generation_tree_badge_provenance: 'Provenance',
      com_ui_graft_generation: 'Append response or branch',
      com_ui_generation_tree_drag: 'Append',
      com_ui_generation_tree_drag_to_append: 'Drag to append',
      com_ui_generation_tree_state_complete: 'Complete',
      com_ui_generation_tree_state_stopped_partial: 'Stopped partial',
      com_ui_generation_tree_state_aborted_partial: 'Aborted partial',
      com_ui_generation_tree_state_errored_partial: 'Errored partial',
      com_ui_generation_tree_state_streaming: 'Streaming',
      com_ui_generation_tree_append: 'Append branch',
      com_ui_generation_tree_undo: 'Undo',
      com_ui_generation_tree_stop_and_graft: 'Stop and graft',
      com_ui_generation_tree_undo_destructive: 'Undo graft and delete later continuation',
      com_ui_cancel: 'Cancel',
    })[key] ?? key,
}));

jest.mock('@librechat/client', () => {
  const actual = jest.requireActual('@librechat/client');

  return {
    ...actual,
    useMediaQuery: jest.fn(() => mockIsMobile),
  };
});

jest.mock('~/Providers/ChatContext', () => ({
  useChatContext: () => ({
    conversation: { conversationId: mockConversationId },
    getMessages: () => mockMessages,
    latestMessageId: mockLatestMessageId,
    isSubmitting: mockIsSubmitting,
  }),
}));

jest.mock('~/data-provider', () => ({
  useStreamStatus: jest.fn(() => mockStreamStatus),
}));

jest.mock(
  '../useGenerationGraft',
  () => ({
    __esModule: true,
    default: (...args: unknown[]) => mockUseGenerationGraft(...args),
  }),
  { virtual: true },
);

import ConversationTreeDialog from '../ConversationTreeDialog';

const createGenerationGraftState = (overrides: Record<string, unknown> = {}) => ({
  phase: 'selecting',
  pendingAction: null,
  mode: 'generation',
  sourceMessageId: 'assistant-b',
  destinationMessageId: null,
  preview: null,
  created: null,
  pendingUndoTarget: null,
  error: null,
  stabilization: null,
  canCreate: false,
  selectSourceMessage: jest.fn(),
  selectDestinationMessage: jest.fn(),
  setMode: jest.fn(),
  requestPreview: jest.fn(),
  createGraft: jest.fn(),
  undoGraft: jest.fn(),
  confirmUndoContinuations: jest.fn(),
  cancelPendingUndoTarget: jest.fn(),
  stopAndGraft: jest.fn(),
  waitForCompletion: jest.fn(),
  cancelStabilization: jest.fn(),
  ...overrides,
});

function dispatchPointerEvent(
  target: EventTarget,
  type: string,
  coordinates: { pointerId: number; clientX: number; clientY: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: coordinates.clientX,
    clientY: coordinates.clientY,
  });

  Object.defineProperty(event, 'pointerId', {
    configurable: true,
    value: coordinates.pointerId,
  });

  target.dispatchEvent(event);
}

describe('ConversationTreeDialog', () => {
  const originalElementsFromPoint = document.elementsFromPoint;

  beforeEach(() => {
    mockIsMobile = false;
    mockConversationId = 'convo-1';
    mockLatestMessageId = 'assistant-b';
    mockIsSubmitting = true;
    mockStreamStatus = {
      data: {
        active: true,
        responseMessageId: 'assistant-b',
      },
    };
    window.localStorage.clear();
    jest.useFakeTimers();
    (dataService.createGenerationGraft as jest.Mock).mockReset();
    (dataService.createGenerationGraft as jest.Mock).mockResolvedValue({} as never);
    mockUseGenerationGraft.mockReturnValue(createGenerationGraftState());
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    document.elementsFromPoint = originalElementsFromPoint;
  });

  it('renders the full-screen shell and preserves focused/source ids', () => {
    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    const dialog = screen.getByTestId('generation-tree-dialog');
    expect(dialog).toHaveClass(
      'h-[100dvh]',
      'max-h-[100dvh]',
      'w-screen',
      'max-w-none',
      'rounded-none',
      'border-0',
    );
    expect(dialog).toHaveAttribute('data-focused-message-id', 'assistant-a');
    expect(dialog).toHaveAttribute('data-source-message-id', 'assistant-b');
    expect(screen.getByRole('button', { name: 'Fit tree' })).toBeInTheDocument();
    expect(screen.getByTestId('generation-tree-toolbar')).toHaveClass('overflow-x-auto');
    expect(screen.getByTestId('generation-tree-toolbar')).not.toHaveClass('flex-wrap');
    expect(screen.getByTestId('generation-tree-sidebar')).toHaveClass('overflow-hidden');
    expect(screen.getByTestId('generation-tree-inspector-scroll')).toHaveClass('overflow-y-auto');
    expect(screen.getByTestId('generation-tree-actions')).toHaveClass('shrink-0');
    expect(
      screen.getByText(
        'Append one response or a whole branch after another response without changing the original.',
      ),
    ).toBeInTheDocument();
  });

  it('requests a preview from drag and drop without creating immediately', () => {
    mockIsSubmitting = false;
    mockStreamStatus = {
      data: {
        active: false,
        responseMessageId: null,
      },
    };
    const requestPreview = jest.fn();
    const createGraft = jest.fn();
    mockUseGenerationGraft.mockReturnValue(
      createGenerationGraftState({
        requestPreview,
        createGraft,
      }),
    );

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    const originalElementsFromPoint = document.elementsFromPoint;
    document.elementsFromPoint = jest.fn(() => [screen.getByTestId('tree-node-assistant-a')]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-b'), {
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

    document.elementsFromPoint = originalElementsFromPoint;

    expect(requestPreview).toHaveBeenCalledWith();
    expect(createGraft).not.toHaveBeenCalled();
  });

  it('renders the create action disabled until the hook reaches the ready phase', () => {
    mockUseGenerationGraft.mockReturnValue(
      createGenerationGraftState({
        phase: 'previewing',
        canCreate: false,
        preview: {
          conversationId: 'convo-1',
          sourceMessageId: 'assistant-b',
          destinationMessageId: 'assistant-a',
          mode: 'generation',
          sourceState: 'complete',
          destinationState: 'complete',
          copiedMessageIds: ['assistant-b'],
          activeSourceLeafMessageId: 'assistant-b',
          destinationChildCount: 0,
          counts: {
            messages: 1,
            toolCalls: 0,
            files: 0,
            images: 0,
            approximateTokens: 24,
          },
          warnings: [],
          treeRevision: 'server-rev-1',
          requiresStabilization: false,
          activeMessageIds: [],
          conversationActiveWithoutMessageId: false,
          canCreate: true,
        },
      }),
    );

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Append branch' })).toBeDisabled();
  });

  it('persists orientation and collapsed ids across reopen for the same conversation', () => {
    const { unmount } = renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('tree-orientation-toggle'));
    fireEvent.click(screen.getByTestId('collapse-toggle-assistant-a'));

    unmount();

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('tree-orientation-toggle')).toHaveAttribute(
      'data-orientation',
      'vertical',
    );
    expect(screen.queryByTestId('tree-node-assistant-a-child')).not.toBeInTheDocument();
  });

  it('isolates orientation between conversation ids', () => {
    const { rerender } = renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('tree-orientation-toggle'));
    expect(screen.getByTestId('tree-orientation-toggle')).toHaveAttribute(
      'data-orientation',
      'vertical',
    );

    mockConversationId = 'convo-2';
    rerender(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('tree-orientation-toggle')).toHaveAttribute(
      'data-orientation',
      'horizontal',
    );

    mockConversationId = 'convo-1';
    rerender(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('tree-orientation-toggle')).toHaveAttribute(
      'data-orientation',
      'vertical',
    );
  });

  it('renders a mobile summary bar and bottom-sheet list treatment on narrow screens', () => {
    mockIsMobile = true;
    const selectDestinationMessage = jest.fn();
    const requestPreview = jest.fn();
    mockUseGenerationGraft.mockReturnValue(
      createGenerationGraftState({
        selectDestinationMessage,
        requestPreview,
      }),
    );

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('generation-tree-mobile-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('generation-tree-sidebar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Append here' }));

    expect(screen.getByTestId('generation-tree-mobile-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('generation-tree-mobile-sheet')).toHaveClass(
      'max-h-[calc(100%-0.75rem)]',
      'overflow-hidden',
    );
    expect(selectDestinationMessage).toHaveBeenCalledWith('assistant-a');
    expect(requestPreview).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('generation-tree-mobile-backdrop'));
    expect(screen.queryByTestId('generation-tree-mobile-sheet')).not.toBeInTheDocument();
  });

  it('opens a worked help page and starts the recommended whole-branch flow', () => {
    const setMode = jest.fn();
    mockUseGenerationGraft.mockReturnValue(createGenerationGraftState({ setMode }));

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'How to append' })[0]);

    expect(screen.getByTestId('generation-tree-help')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Example: append the full 2 of 2 branch after the 1 of 2 branch',
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start guided append' }));

    expect(setMode).toHaveBeenCalledWith('subtree');
    expect(screen.queryByTestId('generation-tree-help')).not.toBeInTheDocument();
  });

  it('uses a normal tap plus explicit action to choose a source response', () => {
    const selectDestinationMessage = jest.fn();
    const selectSourceMessage = jest.fn();
    mockUseGenerationGraft.mockReturnValue(
      createGenerationGraftState({
        sourceMessageId: null,
        selectDestinationMessage,
        selectSourceMessage,
      }),
    );

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId={null}
        onOpenChange={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use focused response as source' }));

    expect(selectDestinationMessage).toHaveBeenCalledWith(null);
    expect(selectSourceMessage).toHaveBeenCalledWith('assistant-a');
  });

  it('never calls createGenerationGraft on a valid drop during task 11 preview flow', () => {
    mockIsSubmitting = false;
    mockStreamStatus = {
      data: {
        active: false,
        responseMessageId: null,
      },
    };

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    const destinationNode = screen.getByTestId('tree-node-assistant-a');
    document.elementsFromPoint = jest.fn(() => [destinationNode]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-b'), {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 200,
      clientY: 80,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 200,
      clientY: 80,
    });

    expect(dataService.createGenerationGraft).not.toHaveBeenCalled();
    expect(screen.getByTestId('generation-tree-inspector')).toHaveTextContent('Preview requested');
  });

  it('does not reset selected destination when latest message and mobile state change while open', () => {
    mockIsSubmitting = false;
    mockStreamStatus = {
      data: {
        active: false,
        responseMessageId: null,
      },
    };

    const { rerender } = renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    const destinationNode = screen.getByTestId('tree-node-assistant-a');
    document.elementsFromPoint = jest.fn(() => [destinationNode]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-b'), {
      pointerId: 2,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerMove(window, {
      pointerId: 2,
      clientX: 200,
      clientY: 80,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    fireEvent.pointerUp(window, {
      pointerId: 2,
      clientX: 200,
      clientY: 80,
    });

    expect(screen.getByTestId('generation-tree-inspector')).toHaveTextContent('Generation 1');

    mockLatestMessageId = 'assistant-a-child';
    mockIsSubmitting = false;
    mockIsMobile = true;

    rerender(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('generation-tree-mobile-summary')).toHaveTextContent(
      'Generation 1 of 2',
    );
    expect(screen.getByRole('button', { name: 'Append here' })).toBeInTheDocument();
  });

  it('resets manual positions after close and reopen within the same conversation', () => {
    mockIsSubmitting = false;
    mockStreamStatus = {
      data: {
        active: false,
        responseMessageId: null,
      },
    };

    const { rerender } = renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    const node = screen.getByTestId('tree-node-assistant-a');
    const originalLeft = node.style.left;
    const originalTop = node.style.top;

    fireEvent.click(screen.getByRole('button', { name: 'Arrange tree' }));
    dispatchPointerEvent(node, 'pointerdown', {
      pointerId: 5,
      clientX: 100,
      clientY: 100,
    });
    dispatchPointerEvent(window, 'pointermove', {
      pointerId: 5,
      clientX: 140,
      clientY: 130,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByTestId('tree-node-assistant-a').style.left).not.toBe(originalLeft);
    expect(screen.getByTestId('tree-node-assistant-a').style.top).not.toBe(originalTop);

    rerender(
      <ConversationTreeDialog
        open={false}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    rerender(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('tree-node-assistant-a').style.left).toBe(originalLeft);
    expect(screen.getByTestId('tree-node-assistant-a').style.top).toBe(originalTop);
  });

  it('announces drag status updates through a polite live region', () => {
    mockIsSubmitting = false;
    mockStreamStatus = {
      data: {
        active: false,
        responseMessageId: null,
      },
    };

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    document.elementsFromPoint = jest.fn(() => [screen.getByTestId('tree-node-prompt')]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-b'), {
      pointerId: 6,
      clientX: 40,
      clientY: 40,
    });
    fireEvent.pointerMove(window, {
      pointerId: 6,
      clientX: 60,
      clientY: 60,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      'Choose an assistant generation as the destination.',
    );
  });

  it('keeps the visual canvas out of the keyboard path while the tree list remains functional', async () => {
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });

    renderWithQueryClient(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('graft-handle-assistant-a')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('collapse-toggle-assistant-a')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('generation-tree-minimap')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('generation-tree-minimap')).toHaveAttribute('focusable', 'false');
    expect(screen.queryByRole('button', { name: /graft generation/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browse list' }));
    const source = screen.getAllByRole('treeitem', { name: /generation 1/i })[0];
    await user.click(source);
    await user.keyboard(' ');

    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Source selected. Choose a destination generation.',
    );
  });
});
