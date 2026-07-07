import type {
  ConversationTreeLayout,
  ConversationTreeLayoutBounds,
  ConversationTreeTransformState,
  MiniMapGeometry,
  TreeViewportSize,
} from './types';

const MIN_SCALE = 0.25;
const MAX_SCALE = 2;

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) {
    return 1;
  }

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenDeltaToWorldDelta(
  delta: { x: number; y: number },
  scale: number,
): { x: number; y: number } {
  const normalizedScale = clampScale(scale);
  return {
    x: delta.x / normalizedScale,
    y: delta.y / normalizedScale,
  };
}

export function calculateFitTransform(
  bounds: ConversationTreeLayoutBounds,
  viewport: TreeViewportSize,
  padding = 48,
): ConversationTreeTransformState {
  const safeWidth = Math.max(bounds.width, 1);
  const safeHeight = Math.max(bounds.height, 1);
  const availableWidth = Math.max(viewport.width - padding * 2, 1);
  const availableHeight = Math.max(viewport.height - padding * 2, 1);
  const scale = clampScale(Math.min(availableWidth / safeWidth, availableHeight / safeHeight));

  return {
    scale,
    positionX: (viewport.width - bounds.width * scale) / 2 - bounds.minX * scale,
    positionY: (viewport.height - bounds.height * scale) / 2 - bounds.minY * scale,
  };
}

export function getBoundsForNodeIds(
  layout: ConversationTreeLayout,
  messageIds: Iterable<string>,
): ConversationTreeLayoutBounds | null {
  const nodes = [...messageIds]
    .map((id) => layout.nodes.get(id))
    .filter((node): node is NonNullable<typeof node> => node != null);

  if (nodes.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function calculateMiniMapLayout(
  bounds: ConversationTreeLayoutBounds,
  options: {
    width?: number;
    height?: number;
    padding?: number;
  } = {},
): MiniMapGeometry {
  const width = options.width ?? 180;
  const height = options.height ?? 112;
  const padding = options.padding ?? 8;
  const availableWidth = Math.max(width - padding * 2, 1);
  const availableHeight = Math.max(height - padding * 2, 1);
  const scale = Math.min(
    availableWidth / Math.max(bounds.width, 1),
    availableHeight / Math.max(bounds.height, 1),
  );

  return {
    bounds,
    width,
    height,
    padding,
    scale,
    offsetX: padding + (availableWidth - bounds.width * scale) / 2,
    offsetY: padding + (availableHeight - bounds.height * scale) / 2,
  };
}

export function mapWorldPointToMiniMap(
  point: { x: number; y: number },
  geometry: MiniMapGeometry,
): { x: number; y: number } {
  return {
    x: geometry.offsetX + (point.x - geometry.bounds.minX) * geometry.scale,
    y: geometry.offsetY + (point.y - geometry.bounds.minY) * geometry.scale,
  };
}

export function mapMiniMapPointToWorld(
  point: { x: number; y: number },
  geometry: MiniMapGeometry,
): { x: number; y: number } {
  return {
    x: geometry.bounds.minX + (point.x - geometry.offsetX) / geometry.scale,
    y: geometry.bounds.minY + (point.y - geometry.offsetY) / geometry.scale,
  };
}

export function getViewportWorldBounds(
  transform: ConversationTreeTransformState,
  viewport: TreeViewportSize,
): ConversationTreeLayoutBounds {
  const scale = clampScale(transform.scale);
  const minX = -transform.positionX / scale;
  const minY = -transform.positionY / scale;
  const width = viewport.width / scale;
  const height = viewport.height / scale;

  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height,
    width,
    height,
  };
}

export function recenterTransformAtWorldPoint(
  point: { x: number; y: number },
  viewport: TreeViewportSize,
  transform: ConversationTreeTransformState,
): ConversationTreeTransformState {
  const scale = clampScale(transform.scale);

  return {
    scale,
    positionX: viewport.width / 2 - point.x * scale,
    positionY: viewport.height / 2 - point.y * scale,
  };
}
