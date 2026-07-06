import React, { useMemo, useRef } from 'react';
import { cn } from '~/utils';
import type {
  ConversationTreeLayout,
  ConversationTreeLayoutBounds,
  ConversationTreeTransformState,
  MiniMapGeometry,
  TreeViewportSize,
} from './types';
import {
  calculateMiniMapLayout,
  getViewportWorldBounds,
  mapMiniMapPointToWorld,
  mapWorldPointToMiniMap,
} from './viewport';

type ConversationTreeMiniMapProps = {
  layout: ConversationTreeLayout;
  activeBranchIds: Set<string>;
  sourceMessageId: string | null;
  destinationMessageId: string | null;
  transformState: ConversationTreeTransformState;
  viewportSize: TreeViewportSize;
  onRecenter: (point: { x: number; y: number }) => void;
};

function boundsToRect(bounds: ConversationTreeLayoutBounds, geometry: MiniMapGeometry) {
  const topLeft = mapWorldPointToMiniMap({ x: bounds.minX, y: bounds.minY }, geometry);
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bounds.width * geometry.scale,
    height: bounds.height * geometry.scale,
  };
}

function getNodeStroke(
  nodeId: string,
  activeBranchIds: Set<string>,
  sourceMessageId: string | null,
  destinationMessageId: string | null,
): string {
  if (nodeId === destinationMessageId) {
    return 'rgb(37 99 235)';
  }

  if (nodeId === sourceMessageId) {
    return 'rgb(124 58 237)';
  }

  if (activeBranchIds.has(nodeId)) {
    return 'rgb(15 118 110)';
  }

  return 'rgb(148 163 184)';
}

export default function ConversationTreeMiniMap({
  layout,
  activeBranchIds,
  sourceMessageId,
  destinationMessageId,
  transformState,
  viewportSize,
  onRecenter,
}: ConversationTreeMiniMapProps) {
  const draggingRef = useRef(false);
  const geometry = useMemo(() => calculateMiniMapLayout(layout.bounds), [layout.bounds]);
  const viewportBounds = useMemo(
    () => getViewportWorldBounds(transformState, viewportSize),
    [transformState, viewportSize],
  );
  const viewportRect = boundsToRect(viewportBounds, geometry);

  const handlePointer = (clientX: number, clientY: number, currentTarget: SVGSVGElement) => {
    const rect = currentTarget.getBoundingClientRect();
    onRecenter(
      mapMiniMapPointToWorld(
        {
          x: clientX - rect.left,
          y: clientY - rect.top,
        },
        geometry,
      ),
    );
  };

  return (
    <svg
      data-testid="generation-tree-minimap"
      width={geometry.width}
      height={geometry.height}
      viewBox={`0 0 ${geometry.width} ${geometry.height}`}
      className="rounded-xl border border-border-medium bg-surface-primary"
      onPointerDown={(event) => {
        draggingRef.current = true;
        handlePointer(event.clientX, event.clientY, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) {
          return;
        }

        handlePointer(event.clientX, event.clientY, event.currentTarget);
      }}
      onPointerUp={() => {
        draggingRef.current = false;
      }}
      onPointerLeave={() => {
        draggingRef.current = false;
      }}
    >
      <rect width={geometry.width} height={geometry.height} rx={12} className="fill-transparent" />
      {Array.from(layout.nodes.values()).map((node) => {
        const point = mapWorldPointToMiniMap({ x: node.x, y: node.y }, geometry);
        const stroke = getNodeStroke(
          node.id,
          activeBranchIds,
          sourceMessageId,
          destinationMessageId,
        );

        return (
          <rect
            key={node.id}
            x={point.x}
            y={point.y}
            width={Math.max(node.width * geometry.scale, 2)}
            height={Math.max(node.height * geometry.scale, 2)}
            rx={2}
            className={cn('fill-transparent')}
            stroke={stroke}
            strokeWidth={node.id === destinationMessageId || node.id === sourceMessageId ? 1.5 : 1}
          />
        );
      })}
      <rect
        x={viewportRect.x}
        y={viewportRect.y}
        width={viewportRect.width}
        height={viewportRect.height}
        rx={6}
        fill="rgba(59, 130, 246, 0.08)"
        stroke="rgb(59 130 246)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
