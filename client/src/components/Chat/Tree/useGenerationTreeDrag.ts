import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InvalidGraftReason, TreeNodePosition } from './types';
import { getInvalidGraftReason } from './graph';
import { screenDeltaToWorldDelta } from './viewport';

type PointerDragTarget = {
  kind: 'graft' | 'arrange';
  pointerId: number;
  messageId: string;
  startClientX: number;
  startClientY: number;
  startPosition?: TreeNodePosition;
  captureElement: HTMLElement;
};

function resolveNodeIdFromElements(elements: Element[]): string | null {
  for (const element of elements) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    const node = element.closest<HTMLElement>('[data-tree-node-id]');
    const nodeId = node?.dataset.treeNodeId?.trim();
    if (nodeId) {
      return nodeId;
    }
  }

  return null;
}

type UseGenerationTreeDragParams = {
  graph: Parameters<typeof getInvalidGraftReason>[0];
  arrangeMode: boolean;
  scale: number;
  collapsedIds: Set<string>;
  manualPositions: Map<string, TreeNodePosition>;
  layoutPositions: Map<string, TreeNodePosition>;
  onSelectSource: (messageId: string) => void;
  onSelectDestination: (messageId: string) => void;
  onPreviewRequest: () => void;
  onManualPositionChange: (messageId: string, position: TreeNodePosition) => void;
  onCollapsedIdsChange: (collapsedIds: Set<string>) => void;
  onStatusTextChange: (statusText: string) => void;
  onEdgePan: (position: { x: number; y: number }) => void;
  describeInvalidReason: (reason: InvalidGraftReason) => string;
  sourceSelectedText: string;
  previewRequestedText: string;
};

export default function useGenerationTreeDrag({
  graph,
  arrangeMode,
  scale,
  collapsedIds,
  manualPositions,
  layoutPositions,
  onSelectSource,
  onSelectDestination,
  onPreviewRequest,
  onManualPositionChange,
  onCollapsedIdsChange,
  onStatusTextChange,
  onEdgePan,
  describeInvalidReason,
  sourceSelectedText,
  previewRequestedText,
}: UseGenerationTreeDragParams) {
  const dragRef = useRef<PointerDragTarget | null>(null);
  const rafRef = useRef<number | null>(null);
  const latestPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const autoExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoExpandTargetIdRef = useRef<string | null>(null);
  const lostPointerCaptureHandlerRef = useRef<(() => void) | null>(null);
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null);
  const [invalidReason, setInvalidReason] = useState<InvalidGraftReason>(null);
  const hoveredTargetIdRef = useRef<string | null>(null);
  const invalidReasonRef = useRef<InvalidGraftReason>(null);

  const clearAutoExpand = useCallback(() => {
    if (autoExpandTimerRef.current != null) {
      clearTimeout(autoExpandTimerRef.current);
      autoExpandTimerRef.current = null;
    }

    autoExpandTargetIdRef.current = null;
  }, []);

  const detachLostPointerCaptureHandler = useCallback(() => {
    const drag = dragRef.current;
    const handler = lostPointerCaptureHandlerRef.current;
    if (drag == null || handler == null) {
      return;
    }

    drag.captureElement.removeEventListener('lostpointercapture', handler);
    lostPointerCaptureHandlerRef.current = null;
  }, []);

  const releaseCapturedPointer = useCallback(() => {
    const drag = dragRef.current;
    if (drag == null || typeof drag.captureElement.releasePointerCapture !== 'function') {
      return;
    }

    try {
      drag.captureElement.releasePointerCapture(drag.pointerId);
    } catch {
      // Ignore stale capture releases during cancellation.
    }
  }, []);

  const resetDragState = useCallback(() => {
    clearAutoExpand();
    detachLostPointerCaptureHandler();
    setHoveredTargetId(null);
    setInvalidReason(null);
    hoveredTargetIdRef.current = null;
    invalidReasonRef.current = null;
    dragRef.current = null;
    latestPointerRef.current = null;
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, [clearAutoExpand, detachLostPointerCaptureHandler]);

  const processPointerMove = useCallback(() => {
    rafRef.current = null;
    const drag = dragRef.current;
    const latestPointer = latestPointerRef.current;

    if (drag == null || latestPointer == null) {
      return;
    }

    if (drag.kind === 'arrange') {
      const startPosition = drag.startPosition ??
        manualPositions.get(drag.messageId) ??
        layoutPositions.get(drag.messageId) ?? { x: 0, y: 0 };
      const delta = screenDeltaToWorldDelta(
        {
          x: latestPointer.clientX - drag.startClientX,
          y: latestPointer.clientY - drag.startClientY,
        },
        scale,
      );

      onManualPositionChange(drag.messageId, {
        x: startPosition.x + delta.x,
        y: startPosition.y + delta.y,
      });
      return;
    }

    const elements =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(latestPointer.clientX, latestPointer.clientY)
        : [];
    const targetId = resolveNodeIdFromElements(elements);
    const reason =
      targetId == null
        ? 'MESSAGE_NOT_FOUND'
        : getInvalidGraftReason(graph, drag.messageId, targetId);

    setHoveredTargetId(targetId);
    setInvalidReason(reason);
    hoveredTargetIdRef.current = targetId;
    invalidReasonRef.current = reason;

    if (reason != null) {
      onStatusTextChange(describeInvalidReason(reason));
    } else if (targetId != null) {
      onStatusTextChange(sourceSelectedText);
    }

    if (targetId != null && reason == null && collapsedIds.has(targetId)) {
      if (autoExpandTargetIdRef.current !== targetId) {
        clearAutoExpand();
      }

      if (autoExpandTimerRef.current == null) {
        autoExpandTargetIdRef.current = targetId;
        const scheduledTargetId = targetId;
        autoExpandTimerRef.current = setTimeout(() => {
          if (autoExpandTargetIdRef.current !== scheduledTargetId) {
            autoExpandTimerRef.current = null;
            return;
          }

          const nextCollapsedIds = new Set(collapsedIds);
          nextCollapsedIds.delete(scheduledTargetId);
          onCollapsedIdsChange(nextCollapsedIds);
          autoExpandTimerRef.current = null;
          autoExpandTargetIdRef.current = null;
        }, 600);
      }
    } else {
      clearAutoExpand();
    }

    onEdgePan({ x: latestPointer.clientX, y: latestPointer.clientY });
  }, [
    clearAutoExpand,
    collapsedIds,
    describeInvalidReason,
    graph,
    layoutPositions,
    manualPositions,
    onCollapsedIdsChange,
    onEdgePan,
    onManualPositionChange,
    onStatusTextChange,
    scale,
    sourceSelectedText,
  ]);

  const scheduleMove = useCallback(() => {
    if (rafRef.current != null) {
      return;
    }

    rafRef.current = requestAnimationFrame(() => processPointerMove());
  }, [processPointerMove]);

  const flushScheduledMove = useCallback(() => {
    if (rafRef.current == null) {
      return;
    }

    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    processPointerMove();
  }, [processPointerMove]);

  const cancelDrag = useCallback(() => {
    releaseCapturedPointer();
    resetDragState();
  }, [releaseCapturedPointer, resetDragState]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag == null || event.pointerId !== drag.pointerId) {
        return;
      }

      latestPointerRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      scheduleMove();
    };

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag == null || event.pointerId !== drag.pointerId) {
        return;
      }

      flushScheduledMove();

      if (
        drag.kind === 'graft' &&
        hoveredTargetIdRef.current != null &&
        invalidReasonRef.current == null
      ) {
        onSelectDestination(hoveredTargetIdRef.current);
        onPreviewRequest();
        onStatusTextChange(previewRequestedText);
      }

      releaseCapturedPointer();
      resetDragState();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag == null || event.pointerId !== drag.pointerId) {
        return;
      }

      cancelDrag();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        cancelDrag();
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', cancelDrag);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    cancelDrag,
    flushScheduledMove,
    onPreviewRequest,
    onSelectDestination,
    onStatusTextChange,
    previewRequestedText,
    releaseCapturedPointer,
    resetDragState,
    scheduleMove,
  ]);

  const attachLostPointerCaptureHandler = useCallback(
    (element: HTMLElement) => {
      detachLostPointerCaptureHandler();

      const handleLostPointerCapture = () => {
        cancelDrag();
      };

      lostPointerCaptureHandlerRef.current = handleLostPointerCapture;
      element.addEventListener('lostpointercapture', handleLostPointerCapture);
    },
    [cancelDrag, detachLostPointerCaptureHandler],
  );

  const startGraftDrag = useCallback(
    (messageId: string, event: React.PointerEvent<HTMLElement>) => {
      dragRef.current = {
        kind: 'graft',
        pointerId: event.pointerId,
        messageId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        captureElement: event.currentTarget,
      };

      latestPointerRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      hoveredTargetIdRef.current = null;
      invalidReasonRef.current = null;
      setHoveredTargetId(null);
      setInvalidReason(null);
      attachLostPointerCaptureHandler(event.currentTarget);

      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }

      onSelectSource(messageId);
      onStatusTextChange(sourceSelectedText);
    },
    [attachLostPointerCaptureHandler, onSelectSource, onStatusTextChange, sourceSelectedText],
  );

  const startArrangeDrag = useCallback(
    (messageId: string, event: React.PointerEvent<HTMLElement>) => {
      if (!arrangeMode) {
        return;
      }

      dragRef.current = {
        kind: 'arrange',
        pointerId: event.pointerId,
        messageId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startPosition:
          manualPositions.get(messageId) ?? layoutPositions.get(messageId) ?? undefined,
        captureElement: event.currentTarget,
      };

      latestPointerRef.current = {
        clientX: event.clientX,
        clientY: event.clientY,
      };
      attachLostPointerCaptureHandler(event.currentTarget);

      if (typeof event.currentTarget.setPointerCapture === 'function') {
        event.currentTarget.setPointerCapture(event.pointerId);
      }
    },
    [arrangeMode, attachLostPointerCaptureHandler, layoutPositions, manualPositions],
  );

  const handlePropsFor = useCallback(
    (messageId: string) => ({
      onPointerDownHandle: (event: React.PointerEvent<HTMLButtonElement>) =>
        startGraftDrag(messageId, event),
      onPointerDownBody: (event: React.PointerEvent<HTMLDivElement>) =>
        startArrangeDrag(messageId, event),
    }),
    [startArrangeDrag, startGraftDrag],
  );

  return useMemo(
    () => ({
      hoveredTargetId,
      invalidReason,
      handlePropsFor,
    }),
    [handlePropsFor, hoveredTargetId, invalidReason],
  );
}
