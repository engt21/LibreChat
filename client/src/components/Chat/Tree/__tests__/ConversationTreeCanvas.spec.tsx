import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ConversationTreeGraph, ConversationTreeLayout } from '../types';
import { normalizeConversationGraph } from '../graph';
import { layoutConversationTree } from '../layout';
import ConversationTreeCanvas from '../ConversationTreeCanvas';

jest.mock('react-zoom-pan-pinch', () => {
  const React = require('react');

  return {
    TransformWrapper: React.forwardRef(
      (
        {
          children,
          onTransformed,
          initialScale = 1,
          initialPositionX = 0,
          initialPositionY = 0,
        }: {
          children: React.ReactNode;
          onTransformed?: (
            ref: unknown,
            state: { scale: number; positionX: number; positionY: number },
          ) => void;
          initialScale?: number;
          initialPositionX?: number;
          initialPositionY?: number;
        },
        ref: React.Ref<{ setTransform: (x: number, y: number, scale: number) => void }>,
      ) => {
        const didInitializeRef = React.useRef(false);

        React.useImperativeHandle(ref, () => ({
          setTransform: (positionX: number, positionY: number, scale: number) => {
            onTransformed?.(null, { scale, positionX, positionY });
          },
        }));

        React.useEffect(() => {
          if (didInitializeRef.current) {
            return;
          }

          didInitializeRef.current = true;
          onTransformed?.(null, {
            scale: initialScale,
            positionX: initialPositionX,
            positionY: initialPositionY,
          });
        }, [initialPositionX, initialPositionY, initialScale, onTransformed]);

        return <div>{children}</div>;
      },
    ),
    TransformComponent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  };
});

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, options?: Record<string, unknown>) =>
    ({
      com_ui_generation_tree_error_invalid: 'Choose a valid generation for this action.',
      com_ui_generation_tree_error_source: 'Choose an assistant generation as the source.',
      com_ui_generation_tree_error_destination:
        'Choose an assistant generation as the destination.',
      com_ui_generation_tree_error_overlap:
        'Choose a different destination outside the source branch.',
      com_ui_generation_tree_error_busy: 'The conversation is still changing. Try again shortly.',
      com_ui_generation_tree_status_source_selected:
        'Source selected. Choose a destination generation.',
      com_ui_generation_tree_status_preview: 'Preview requested',
      com_ui_generation_tree_announcer_opened: 'Conversation tree opened.',
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

type TestMessage = {
  messageId: string;
  parentMessageId?: string | null;
  text: string;
  isCreatedByUser: boolean;
  unfinished?: boolean;
  error?: boolean;
  finish_reason?: string;
  children?: TestMessage[];
};

const createMessage = (overrides: Partial<TestMessage>): TestMessage => ({
  messageId: 'message-1',
  parentMessageId: null,
  text: '',
  isCreatedByUser: false,
  ...overrides,
});

const createGraph = (): { graph: ConversationTreeGraph; layout: ConversationTreeLayout } => {
  const graph = normalizeConversationGraph([
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
      messageId: 'assistant-a-child-user',
      parentMessageId: 'assistant-a',
      text: 'Follow up to generation 1',
      isCreatedByUser: true,
    }),
    createMessage({
      messageId: 'assistant-a-child',
      parentMessageId: 'assistant-a-child-user',
      text: 'Nested generation 1 child',
      isCreatedByUser: false,
    }),
    createMessage({
      messageId: 'assistant-b',
      parentMessageId: 'prompt',
      text: 'Generation 2 answer',
      isCreatedByUser: false,
    }),
  ]);

  return {
    graph,
    layout: layoutConversationTree(graph, { orientation: 'horizontal' }),
  };
};

const createLifecycleGraph = (): {
  graph: ConversationTreeGraph;
  layout: ConversationTreeLayout;
} => {
  const graph = normalizeConversationGraph(
    [
      createMessage({
        messageId: 'prompt',
        text: 'Prompt',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'assistant-complete',
        parentMessageId: 'prompt',
        text: 'Complete generation',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'assistant-stopped',
        parentMessageId: 'prompt',
        text: 'Stopped generation',
        isCreatedByUser: false,
        unfinished: true,
      }),
      createMessage({
        messageId: 'assistant-aborted',
        parentMessageId: 'prompt',
        text: 'Aborted generation',
        isCreatedByUser: false,
        unfinished: true,
        finish_reason: 'cancelled',
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

  return {
    graph,
    layout: layoutConversationTree(graph, { orientation: 'horizontal' }),
  };
};

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

describe('ConversationTreeCanvas', () => {
  const originalRAF = global.requestAnimationFrame;
  const originalCAF = global.cancelAnimationFrame;
  const originalElementsFromPoint = document.elementsFromPoint;
  const setPointerCapture = jest.fn();
  const releasePointerCapture = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    global.requestAnimationFrame = ((callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0)) as typeof requestAnimationFrame;
    global.cancelAnimationFrame = ((handle: number) =>
      clearTimeout(handle)) as typeof cancelAnimationFrame;
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: setPointerCapture,
    });
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: releasePointerCapture,
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.requestAnimationFrame = originalRAF;
    global.cancelAnimationFrame = originalCAF;
    document.elementsFromPoint = originalElementsFromPoint;
    setPointerCapture.mockReset();
    releasePointerCapture.mockReset();
  });

  it('starts graft drag only from the dedicated handle and opens preview on a valid drop', () => {
    const { graph, layout } = createGraph();
    const onSelectSource = jest.fn();
    const onSelectDestination = jest.fn();
    const onPreviewRequest = jest.fn();
    const onManualPositionChange = jest.fn();
    const onCollapsedIdsChange = jest.fn();
    const onFocusMessage = jest.fn();

    render(
      <ConversationTreeCanvas
        graph={graph}
        layout={layout}
        focusedMessageId="assistant-b"
        sourceMessageId="assistant-b"
        destinationMessageId={null}
        collapsedIds={new Set()}
        arrangeMode={false}
        manualPositions={new Map()}
        onFocusMessage={onFocusMessage}
        onSelectSource={onSelectSource}
        onSelectDestination={onSelectDestination}
        onPreviewRequest={onPreviewRequest}
        onManualPositionChange={onManualPositionChange}
        onCollapsedIdsChange={onCollapsedIdsChange}
      />,
    );

    const destinationNode = screen.getByTestId('tree-node-assistant-a');
    document.elementsFromPoint = jest.fn(() => [destinationNode]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-b'), {
      pointerId: 1,
      clientX: 40,
      clientY: 40,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 220, clientY: 80 });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    fireEvent.pointerUp(window, { pointerId: 1, clientX: 220, clientY: 80 });

    expect(setPointerCapture).toHaveBeenCalled();
    expect(onSelectSource).toHaveBeenCalledWith('assistant-b');
    expect(onSelectDestination).toHaveBeenCalledWith('assistant-a');
    expect(onPreviewRequest).toHaveBeenCalledTimes(1);
    expect(onManualPositionChange).not.toHaveBeenCalled();
  });

  it('keeps node-body dragging reserved for arrange mode', () => {
    const { graph, layout } = createGraph();
    const onManualPositionChange = jest.fn();

    render(
      <ConversationTreeCanvas
        graph={graph}
        layout={layout}
        focusedMessageId="assistant-a"
        sourceMessageId={null}
        destinationMessageId={null}
        collapsedIds={new Set()}
        arrangeMode={false}
        manualPositions={new Map()}
        onFocusMessage={jest.fn()}
        onSelectSource={jest.fn()}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onManualPositionChange={onManualPositionChange}
        onCollapsedIdsChange={jest.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByTestId('tree-node-assistant-a'), {
      pointerId: 2,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(window, {
      pointerId: 2,
      clientX: 160,
      clientY: 140,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(onManualPositionChange).not.toHaveBeenCalled();
  });

  it('divides arrange-mode screen deltas by the current scale', () => {
    const { graph, layout } = createGraph();
    const onManualPositionChange = jest.fn();

    render(
      <ConversationTreeCanvas
        graph={graph}
        layout={layout}
        focusedMessageId="assistant-a"
        sourceMessageId={null}
        destinationMessageId={null}
        collapsedIds={new Set()}
        arrangeMode={true}
        initialTransformState={{ scale: 0.5, positionX: 0, positionY: 0 }}
        manualPositions={new Map()}
        onFocusMessage={jest.fn()}
        onSelectSource={jest.fn()}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onManualPositionChange={onManualPositionChange}
        onCollapsedIdsChange={jest.fn()}
      />,
    );

    dispatchPointerEvent(screen.getByTestId('tree-node-assistant-a'), 'pointerdown', {
      pointerId: 4,
      clientX: 100,
      clientY: 100,
    });
    dispatchPointerEvent(window, 'pointermove', {
      pointerId: 4,
      clientX: 140,
      clientY: 120,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(onManualPositionChange).toHaveBeenCalledWith(
      'assistant-a',
      expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
    );

    const [, position] = onManualPositionChange.mock.calls.at(-1) ?? [];
    expect(position.x - layout.nodes.get('assistant-a')!.x).toBeCloseTo(80, 6);
    expect(position.y - layout.nodes.get('assistant-a')!.y).toBeCloseTo(40, 6);
  });

  it('shows a visible invalid-target reason and auto-expands a collapsed valid target after 600ms', () => {
    const { graph, layout } = createGraph();
    const onCollapsedIdsChange = jest.fn();

    render(
      <ConversationTreeCanvas
        graph={graph}
        layout={layout}
        focusedMessageId="assistant-b"
        sourceMessageId="assistant-b"
        destinationMessageId={null}
        collapsedIds={new Set(['assistant-a'])}
        arrangeMode={false}
        manualPositions={new Map()}
        onFocusMessage={jest.fn()}
        onSelectSource={jest.fn()}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onManualPositionChange={jest.fn()}
        onCollapsedIdsChange={onCollapsedIdsChange}
      />,
    );

    const validTarget = screen.getByTestId('tree-node-assistant-a');
    document.elementsFromPoint = jest
      .fn()
      .mockReturnValueOnce([screen.getByTestId('tree-node-assistant-b')])
      .mockReturnValue([validTarget]);

    fireEvent.pointerDown(screen.getByTestId('graft-handle-assistant-b'), {
      pointerId: 3,
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerMove(window, {
      pointerId: 3,
      clientX: 70,
      clientY: 70,
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByTestId('generation-tree-status')).toHaveTextContent(
      'Choose an assistant generation as the destination.',
    );

    fireEvent.pointerMove(window, {
      pointerId: 3,
      clientX: 210,
      clientY: 80,
    });

    act(() => {
      jest.advanceTimersByTime(599);
    });
    expect(onCollapsedIdsChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(onCollapsedIdsChange).toHaveBeenCalledTimes(1);
  });

  it('renders graft handles for stable partial assistants but not for streaming or prompt nodes', () => {
    const { graph, layout } = createLifecycleGraph();

    render(
      <ConversationTreeCanvas
        graph={graph}
        layout={layout}
        focusedMessageId="assistant-complete"
        sourceMessageId={null}
        destinationMessageId={null}
        collapsedIds={new Set()}
        arrangeMode={false}
        manualPositions={new Map()}
        onFocusMessage={jest.fn()}
        onSelectSource={jest.fn()}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onManualPositionChange={jest.fn()}
        onCollapsedIdsChange={jest.fn()}
      />,
    );

    expect(screen.getByTestId('graft-handle-assistant-complete')).toBeInTheDocument();
    expect(screen.getByTestId('graft-handle-assistant-stopped')).toBeInTheDocument();
    expect(screen.getByTestId('graft-handle-assistant-aborted')).toBeInTheDocument();
    expect(screen.getByTestId('graft-handle-assistant-errored')).toBeInTheDocument();
    expect(screen.queryByTestId('graft-handle-assistant-streaming')).not.toBeInTheDocument();
    expect(screen.queryByTestId('graft-handle-prompt')).not.toBeInTheDocument();
  });

  it('uses bottom-to-top edge geometry in vertical orientation', () => {
    const { graph } = createGraph();
    const layout = layoutConversationTree(graph, { orientation: 'vertical' });
    const source = layout.nodes.get('prompt')!;
    const target = layout.nodes.get('assistant-a')!;
    const expectedPath = `M ${source.x + source.width / 2} ${source.y + source.height} C ${
      source.x + source.width / 2
    } ${source.y + source.height + Math.max((target.y - (source.y + source.height)) / 2, 40)}, ${
      target.x + target.width / 2
    } ${target.y - Math.max((target.y - (source.y + source.height)) / 2, 40)}, ${
      target.x + target.width / 2
    } ${target.y}`;

    const { container } = render(
      <ConversationTreeCanvas
        graph={graph}
        layout={layout}
        focusedMessageId="assistant-a"
        sourceMessageId={null}
        destinationMessageId={null}
        collapsedIds={new Set()}
        arrangeMode={false}
        manualPositions={new Map()}
        orientation="vertical"
        onFocusMessage={jest.fn()}
        onSelectSource={jest.fn()}
        onSelectDestination={jest.fn()}
        onPreviewRequest={jest.fn()}
        onManualPositionChange={jest.fn()}
        onCollapsedIdsChange={jest.fn()}
      />,
    );

    expect(
      Array.from(container.querySelectorAll('path')).some(
        (path) => path.getAttribute('d') === expectedPath,
      ),
    ).toBe(true);
  });
});
