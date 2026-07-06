import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import useLocalize from '~/hooks/useLocalize';
import ConversationTreeMiniMap from './ConversationTreeMiniMap';
import ConversationTreeNode from './ConversationTreeNode';
import useGenerationTreeDrag from './useGenerationTreeDrag';
import {
  calculateFitTransform,
  getBoundsForNodeIds,
  recenterTransformAtWorldPoint,
} from './viewport';
import { semanticDetail } from './graph';
import type {
  ConversationTreeGraph,
  ConversationTreeLayout,
  ConversationTreeTransformState,
  ConversationTreeViewportCommands,
  InvalidGraftReason,
  TreeOrientation,
  TreeNodePosition,
  TreeViewportSize,
} from './types';

function edgePathForNodes(
  source: NonNullable<ConversationTreeLayout['nodes'] extends Map<string, infer T> ? T : never>,
  target: NonNullable<ConversationTreeLayout['nodes'] extends Map<string, infer T> ? T : never>,
  orientation: TreeOrientation,
): string {
  if (orientation === 'vertical') {
    const startX = source.x + source.width / 2;
    const startY = source.y + source.height;
    const endX = target.x + target.width / 2;
    const endY = target.y;
    const controlOffset = Math.max((endY - startY) / 2, 40);

    return `M ${startX} ${startY} C ${startX} ${startY + controlOffset}, ${endX} ${endY - controlOffset}, ${endX} ${endY}`;
  }

  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const controlOffset = Math.max((endX - startX) / 2, 40);

  return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
}

type ConversationTreeCanvasProps = {
  graph: ConversationTreeGraph;
  layout: ConversationTreeLayout;
  focusedMessageId: string | null;
  sourceMessageId: string | null;
  destinationMessageId: string | null;
  collapsedIds: Set<string>;
  arrangeMode: boolean;
  manualPositions: Map<string, TreeNodePosition>;
  activeBranchIds?: Set<string>;
  initialTransformState?: ConversationTreeTransformState;
  orientation?: TreeOrientation;
  autoFitToken?: string | number;
  statusText?: string;
  onFocusMessage: (messageId: string) => void;
  onSelectSource: (messageId: string) => void;
  onSelectDestination: (messageId: string) => void;
  onPreviewRequest: () => void;
  onManualPositionChange: (messageId: string, position: TreeNodePosition) => void;
  onCollapsedIdsChange: (collapsedIds: Set<string>) => void;
  onStatusTextChange?: (statusText: string) => void;
  onRegisterViewportCommands?: (commands: ConversationTreeViewportCommands) => void;
};

export default function ConversationTreeCanvas({
  graph,
  layout,
  focusedMessageId,
  sourceMessageId,
  destinationMessageId,
  collapsedIds,
  arrangeMode,
  manualPositions,
  activeBranchIds = new Set<string>(),
  initialTransformState,
  orientation = 'horizontal',
  autoFitToken = 'default',
  statusText,
  onFocusMessage,
  onSelectSource,
  onSelectDestination,
  onPreviewRequest,
  onManualPositionChange,
  onCollapsedIdsChange,
  onStatusTextChange,
  onRegisterViewportCommands,
}: ConversationTreeCanvasProps) {
  const localize = useLocalize();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const fitFrameRef = useRef<number | null>(null);
  const appliedAutoFitTokenRef = useRef<string | number | null>(null);
  const [viewportSize, setViewportSize] = useState<TreeViewportSize>({ width: 0, height: 0 });
  const [transformState, setTransformState] = useState<ConversationTreeTransformState>(
    initialTransformState ?? { scale: 1, positionX: 0, positionY: 0 },
  );
  const [localStatusText, setLocalStatusText] = useState<string>('');

  const updateStatusText = useCallback(
    (nextStatusText: string) => {
      setLocalStatusText(nextStatusText);
      onStatusTextChange?.(nextStatusText);
    },
    [onStatusTextChange],
  );

  const applyTransform = useCallback((nextTransform: ConversationTreeTransformState) => {
    setTransformState(nextTransform);
    transformRef.current?.setTransform(
      nextTransform.positionX,
      nextTransform.positionY,
      nextTransform.scale,
      0,
    );
  }, []);

  const fitBounds = useCallback(
    (bounds: typeof layout.bounds | null) => {
      if (bounds == null || viewportSize.width === 0 || viewportSize.height === 0) {
        return;
      }

      applyTransform(calculateFitTransform(bounds, viewportSize, 40));
    },
    [applyTransform, viewportSize],
  );

  const fitTree = useCallback(() => fitBounds(layout.bounds), [fitBounds, layout.bounds]);

  const fitActiveBranch = useCallback(() => {
    fitBounds(getBoundsForNodeIds(layout, activeBranchIds));
  }, [activeBranchIds, fitBounds, layout]);

  const fitSelection = useCallback(() => {
    const selectionIds = [sourceMessageId, destinationMessageId].filter(
      (value): value is string => value != null,
    );
    fitBounds(getBoundsForNodeIds(layout, selectionIds));
  }, [destinationMessageId, fitBounds, layout, sourceMessageId]);

  const recenterOnWorldPoint = useCallback(
    (point: { x: number; y: number }) => {
      applyTransform(recenterTransformAtWorldPoint(point, viewportSize, transformState));
    },
    [applyTransform, transformState, viewportSize],
  );

  useEffect(() => {
    onRegisterViewportCommands?.({
      fitTree,
      fitActiveBranch,
      fitSelection,
      recenterOnWorldPoint,
    });
  }, [fitActiveBranch, fitSelection, fitTree, onRegisterViewportCommands, recenterOnWorldPoint]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (element == null || typeof ResizeObserver !== 'function') {
      return;
    }

    const updateViewportSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({
        width: rect.width,
        height: rect.height,
      });
    };

    updateViewportSize();

    const observer = new ResizeObserver(() => {
      if (fitFrameRef.current != null) {
        cancelAnimationFrame(fitFrameRef.current);
      }

      fitFrameRef.current = requestAnimationFrame(() => {
        fitFrameRef.current = null;
        updateViewportSize();
      });
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (fitFrameRef.current != null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (
      viewportSize.width === 0 ||
      viewportSize.height === 0 ||
      appliedAutoFitTokenRef.current === autoFitToken
    ) {
      return;
    }

    fitTree();
    appliedAutoFitTokenRef.current = autoFitToken;
  }, [autoFitToken, fitTree, viewportSize.height, viewportSize.width]);

  const describeInvalidReason = useCallback(
    (reason: InvalidGraftReason) => {
      switch (reason) {
        case 'INVALID_SOURCE':
          return localize('com_ui_generation_tree_error_source');
        case 'INVALID_DESTINATION':
          return localize('com_ui_generation_tree_error_destination');
        case 'GRAFT_BUSY':
        case 'GRAFT_REQUIRES_STABILIZATION':
          return localize('com_ui_generation_tree_error_busy');
        case 'OVERLAPPING_BRANCHES':
          return localize('com_ui_generation_tree_error_overlap');
        default:
          return localize('com_ui_generation_tree_error_invalid');
      }
    },
    [localize],
  );

  const handleEdgePan = useCallback(
    (position: { x: number; y: number }) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect == null) {
        return;
      }

      let deltaX = 0;
      let deltaY = 0;
      const edgeThreshold = 48;

      if (position.x - rect.left < edgeThreshold) {
        deltaX = 16;
      } else if (rect.right - position.x < edgeThreshold) {
        deltaX = -16;
      }

      if (position.y - rect.top < edgeThreshold) {
        deltaY = 16;
      } else if (rect.bottom - position.y < edgeThreshold) {
        deltaY = -16;
      }

      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      applyTransform({
        ...transformState,
        positionX: transformState.positionX + deltaX,
        positionY: transformState.positionY + deltaY,
      });
    },
    [applyTransform, transformState],
  );

  const { hoveredTargetId, invalidReason, handlePropsFor } = useGenerationTreeDrag({
    graph,
    arrangeMode,
    scale: transformState.scale,
    collapsedIds,
    manualPositions,
    layoutPositions: new Map(
      Array.from(layout.nodes.entries()).map(([messageId, node]) => [
        messageId,
        { x: node.x, y: node.y },
      ]),
    ),
    onSelectSource,
    onSelectDestination,
    onPreviewRequest,
    onManualPositionChange,
    onCollapsedIdsChange,
    onStatusTextChange: updateStatusText,
    onEdgePan: handleEdgePan,
    describeInvalidReason,
    sourceSelectedText: localize('com_ui_generation_tree_status_source_selected'),
    previewRequestedText: localize('com_ui_generation_tree_status_preview'),
  });

  const detail = semanticDetail(transformState.scale);
  const renderedNodes = useMemo(
    () =>
      graph.orderedIds
        .map((messageId) => layout.nodes.get(messageId))
        .filter((node): node is NonNullable<typeof node> => node != null),
    [graph.orderedIds, layout.nodes],
  );
  const resolvedStatusText =
    localStatusText || statusText || localize('com_ui_generation_tree_announcer_opened');

  return (
    <div ref={wrapperRef} className="relative h-full min-h-0 overflow-hidden bg-surface-secondary">
      <TransformWrapper
        ref={transformRef}
        initialScale={initialTransformState?.scale ?? 1}
        initialPositionX={initialTransformState?.positionX ?? 0}
        initialPositionY={initialTransformState?.positionY ?? 0}
        minScale={0.25}
        maxScale={2}
        limitToBounds={false}
        centerOnInit={false}
        wheel={{ step: 0.08 }}
        panning={{
          velocityDisabled: true,
          excluded: ['graft-handle', 'tree-node-control'],
        }}
        alignmentAnimation={{ disabled: true }}
        onTransformed={(_, state) =>
          setTransformState({
            scale: state.scale,
            positionX: state.positionX,
            positionY: state.positionY,
          })
        }
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%', overflow: 'hidden' }}
          contentStyle={{
            position: 'relative',
            width: `${Math.max(layout.bounds.maxX + 120, 1)}px`,
            height: `${Math.max(layout.bounds.maxY + 120, 1)}px`,
          }}
        >
          <svg className="pointer-events-none absolute inset-0 overflow-visible">
            {layout.edges.map((edge) => {
              const source = layout.nodes.get(edge.sourceId);
              const target = layout.nodes.get(edge.targetId);
              if (source == null || target == null) {
                return null;
              }

              return (
                <path
                  key={edge.id}
                  d={edgePathForNodes(source, target, orientation)}
                  fill="none"
                  stroke="rgb(148 163 184)"
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          {renderedNodes.map((node) => {
            const { onPointerDownHandle, onPointerDownBody } = handlePropsFor(node.id);
            return (
              <ConversationTreeNode
                key={node.id}
                node={node}
                detail={detail}
                hiddenDescendantCount={layout.hiddenDescendantCounts.get(node.id)}
                focused={focusedMessageId === node.id}
                sourceSelected={sourceMessageId === node.id}
                destinationSelected={destinationMessageId === node.id}
                activeBranch={activeBranchIds.has(node.id)}
                dropTarget={hoveredTargetId === node.id}
                invalidReason={hoveredTargetId === node.id ? invalidReason : null}
                onToggleCollapsed={(messageId) => {
                  const nextCollapsedIds = new Set(collapsedIds);
                  if (nextCollapsedIds.has(messageId)) {
                    nextCollapsedIds.delete(messageId);
                  } else {
                    nextCollapsedIds.add(messageId);
                  }
                  onCollapsedIdsChange(nextCollapsedIds);
                }}
                onPointerDownHandle={onPointerDownHandle}
                onPointerDownBody={onPointerDownBody}
                onFocusMessage={onFocusMessage}
              />
            );
          })}
        </TransformComponent>
      </TransformWrapper>

      <div className="bg-surface-primary/95 pointer-events-none absolute bottom-4 left-4 rounded-xl border border-border-medium px-3 py-2 text-xs text-text-secondary">
        <span data-testid="generation-tree-status">{resolvedStatusText}</span>
      </div>

      <div className="absolute bottom-4 right-4">
        <ConversationTreeMiniMap
          layout={layout}
          activeBranchIds={activeBranchIds}
          sourceMessageId={sourceMessageId}
          destinationMessageId={destinationMessageId}
          transformState={transformState}
          viewportSize={viewportSize}
          onRecenter={recenterOnWorldPoint}
        />
      </div>
    </div>
  );
}
