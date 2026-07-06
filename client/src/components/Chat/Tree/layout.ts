import type {
  ConversationTreeGraph,
  ConversationTreeLayout,
  ConversationTreeLayoutBounds,
  ConversationTreeLayoutEdge,
  ConversationTreeLayoutOptions,
  PositionedTreeNode,
  TreeNodePosition,
} from './types';

export const NODE_WIDTH = 240;
export const NODE_HEIGHT = 92;
export const HORIZONTAL_GAP = 96;
export const VERTICAL_GAP = 28;

type Span = {
  start: number;
  end: number;
};

function getSecondarySize(orientation: ConversationTreeLayoutOptions['orientation']): number {
  return orientation === 'horizontal' ? NODE_HEIGHT : NODE_WIDTH;
}

function getSecondaryGap(orientation: ConversationTreeLayoutOptions['orientation']): number {
  return orientation === 'horizontal' ? VERTICAL_GAP : HORIZONTAL_GAP;
}

function getPrimaryOffset(
  orientation: ConversationTreeLayoutOptions['orientation'],
  depth: number,
): number {
  if (orientation === 'horizontal') {
    return depth * (NODE_WIDTH + HORIZONTAL_GAP);
  }

  return depth * (NODE_HEIGHT + VERTICAL_GAP);
}

function getSecondaryStart(
  orientation: ConversationTreeLayoutOptions['orientation'],
  node: PositionedTreeNode,
): number {
  return orientation === 'horizontal' ? node.y : node.x;
}

function toPosition(
  orientation: ConversationTreeLayoutOptions['orientation'],
  depth: number,
  secondaryStart: number,
): TreeNodePosition {
  if (orientation === 'horizontal') {
    return {
      x: getPrimaryOffset(orientation, depth),
      y: secondaryStart,
    };
  }

  return {
    x: secondaryStart,
    y: getPrimaryOffset(orientation, depth),
  };
}

function normalizeManualPositions(
  manualPositions: ConversationTreeLayoutOptions['manualPositions'],
): Map<string, TreeNodePosition> {
  if (manualPositions == null) {
    return new Map();
  }

  if (manualPositions instanceof Map) {
    return new Map(manualPositions);
  }

  const entries = Object.entries(manualPositions).filter(
    (entry): entry is [string, TreeNodePosition] => {
      const [id, position] = entry;
      return (
        typeof id === 'string' &&
        position != null &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y)
      );
    },
  );

  return new Map(entries);
}

function getTraversalRootsWithHidden(
  graph: ConversationTreeGraph,
  hiddenIds: Set<string>,
): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();

  for (const id of graph.rootIds) {
    if (graph.nodes.has(id) && !seen.has(id) && !hiddenIds.has(id)) {
      roots.push(id);
      seen.add(id);
    }
  }

  for (const id of graph.orderedIds) {
    if (graph.nodes.has(id) && !seen.has(id) && !hiddenIds.has(id)) {
      roots.push(id);
      seen.add(id);
    }
  }

  return roots;
}

function countHiddenDescendants(graph: ConversationTreeGraph, rootId: string): number {
  const visited = new Set<string>([rootId]);
  const stack = [...(graph.nodes.get(rootId)?.childIds ?? [])];
  let count = 0;

  while (stack.length > 0) {
    const currentId = stack.pop();
    if (currentId == null || visited.has(currentId)) {
      continue;
    }

    const currentNode = graph.nodes.get(currentId);
    if (currentNode == null) {
      continue;
    }

    visited.add(currentId);
    count += 1;

    for (let index = currentNode.childIds.length - 1; index >= 0; index -= 1) {
      stack.push(currentNode.childIds[index]);
    }
  }

  return count;
}

function computeBounds(nodes: Iterable<PositionedTreeNode>): ConversationTreeLayoutBounds {
  const positionedNodes = [...nodes];
  if (positionedNodes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of positionedNodes) {
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

export function layoutConversationTree(
  graph: ConversationTreeGraph,
  options: ConversationTreeLayoutOptions,
): ConversationTreeLayout {
  const { orientation } = options;
  const collapsedIds = new Set(options.collapsedIds ?? []);
  const manualPositions = normalizeManualPositions(options.manualPositions);
  const positionedById = new Map<string, PositionedTreeNode>();
  const hiddenDescendantCounts = new Map<string, number>();
  const hiddenIds = new Set<string>();
  const edges: ConversationTreeLayoutEdge[] = [];
  const secondarySize = getSecondarySize(orientation);
  const secondaryGap = getSecondaryGap(orientation);
  let nextSecondaryStart = 0;

  for (const collapsedId of collapsedIds) {
    const visited = new Set<string>([collapsedId]);
    const stack = [...(graph.nodes.get(collapsedId)?.childIds ?? [])];

    while (stack.length > 0) {
      const currentId = stack.pop();
      if (currentId == null || visited.has(currentId)) {
        continue;
      }

      const currentNode = graph.nodes.get(currentId);
      if (currentNode == null) {
        continue;
      }

      visited.add(currentId);
      hiddenIds.add(currentId);

      for (let index = currentNode.childIds.length - 1; index >= 0; index -= 1) {
        stack.push(currentNode.childIds[index]);
      }
    }
  }

  const traversalRoots = getTraversalRootsWithHidden(graph, hiddenIds);

  const placeNode = (messageId: string, depth: number, path: Set<string>): Span | null => {
    if (path.has(messageId)) {
      return null;
    }

    const existingNode = positionedById.get(messageId);
    if (existingNode != null) {
      const start = getSecondaryStart(orientation, existingNode);
      return {
        start,
        end: start + secondarySize,
      };
    }

    const graphNode = graph.nodes.get(messageId);
    if (graphNode == null) {
      return null;
    }

    const nextPath = new Set(path);
    nextPath.add(messageId);

    const visibleChildren: Array<{ id: string; span: Span }> = [];
    if (collapsedIds.has(messageId)) {
      hiddenDescendantCounts.set(messageId, countHiddenDescendants(graph, messageId));
    } else {
      for (const childId of graphNode.childIds) {
        if (!graph.nodes.has(childId) || nextPath.has(childId)) {
          continue;
        }

        const childSpan = placeNode(childId, depth + 1, nextPath);
        if (childSpan != null) {
          visibleChildren.push({ id: childId, span: childSpan });
        }
      }
    }

    let secondaryStart = nextSecondaryStart;
    if (visibleChildren.length > 0) {
      secondaryStart =
        (visibleChildren[0].span.start + visibleChildren[visibleChildren.length - 1].span.end) / 2 -
        secondarySize / 2;
    } else {
      nextSecondaryStart += secondarySize + secondaryGap;
    }

    const position = toPosition(orientation, depth, secondaryStart);
    positionedById.set(messageId, {
      ...graphNode,
      ...position,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });

    for (const child of visibleChildren) {
      edges.push({
        id: `${messageId}->${child.id}`,
        sourceId: messageId,
        targetId: child.id,
      });
    }

    return {
      start: secondaryStart,
      end: secondaryStart + secondarySize,
    };
  };

  for (const rootId of traversalRoots) {
    placeNode(rootId, 0, new Set());
  }

  const nodes = new Map<string, PositionedTreeNode>();
  for (const id of graph.orderedIds) {
    const positionedNode = positionedById.get(id);
    if (positionedNode == null) {
      continue;
    }

    const manualPosition = manualPositions.get(id);
    nodes.set(id, {
      ...positionedNode,
      ...(manualPosition ?? {}),
    });
  }

  return {
    nodes,
    edges,
    bounds: computeBounds(nodes.values()),
    hiddenDescendantCounts,
  };
}
