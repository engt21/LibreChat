import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { dataService } from 'librechat-data-provider';

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
        'Browse conversation branches and choose a generation to graft.',
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
      com_ui_generation_tree_list: 'Tree list',
      com_ui_generation_tree_status_preview: 'Preview requested',
      com_ui_generation_tree_preview_pending: 'Preview pending',
      com_ui_generation_tree_layout_horizontal: 'Horizontal layout',
      com_ui_generation_tree_layout_vertical: 'Vertical layout',
      com_ui_generation_tree_generation_label: `Generation ${options?.index ?? ''}`.trim(),
      com_ui_generation_tree_node_graft_bridge: 'Graft bridge',
      com_ui_generation_tree_node_prompt: 'Prompt',
      com_ui_generation_tree_node_empty: 'No content',
      com_ui_generation_tree_badge_tool: 'Tool',
      com_ui_generation_tree_badge_file: 'File',
      com_ui_generation_tree_badge_image: 'Image',
      com_ui_generation_tree_badge_reasoning: 'Reasoning',
      com_ui_generation_tree_badge_provenance: 'Provenance',
      com_ui_graft_generation: 'Graft generation',
      com_ui_generation_tree_state_complete: 'Complete',
      com_ui_generation_tree_state_stopped_partial: 'Stopped partial',
      com_ui_generation_tree_state_aborted_partial: 'Aborted partial',
      com_ui_generation_tree_state_errored_partial: 'Errored partial',
      com_ui_generation_tree_state_streaming: 'Streaming',
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

import ConversationTreeDialog from '../ConversationTreeDialog';

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
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    document.elementsFromPoint = originalElementsFromPoint;
  });

  it('renders the full-screen shell and preserves focused/source ids', () => {
    render(
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
    expect(
      screen.getByText('Browse conversation branches and choose a generation to graft.'),
    ).toBeInTheDocument();
  });

  it('persists orientation and collapsed ids across reopen for the same conversation', () => {
    const { unmount } = render(
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

    render(
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
    const { rerender } = render(
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

    render(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-a"
        sourceMessageId="assistant-b"
        onOpenChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('generation-tree-mobile-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('generation-tree-sidebar')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open tree details' }));

    expect(screen.getByTestId('generation-tree-mobile-sheet')).toBeInTheDocument();
    expect(screen.getByRole('tree')).toBeInTheDocument();
  });

  it('never calls createGenerationGraft on a valid drop during task 11 preview flow', () => {
    mockIsSubmitting = false;
    mockStreamStatus = {
      data: {
        active: false,
        responseMessageId: null,
      },
    };

    render(
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

    const { rerender } = render(
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

    expect(screen.getByTestId('generation-tree-mobile-summary')).toHaveTextContent('assistant-a');
  });

  it('resets manual positions after close and reopen within the same conversation', () => {
    mockIsSubmitting = false;
    mockStreamStatus = {
      data: {
        active: false,
        responseMessageId: null,
      },
    };

    const { rerender } = render(
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

    render(
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
});
