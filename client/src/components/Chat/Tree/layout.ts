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

function isFiniteTreeNodePosition(value: unknown): value is TreeNodePosition {
  return (
    value != null &&
    typeof value === 'object' &&
    Number.isFinite((value as TreeNodePosition).x) &&
    Number.isFinite((value as TreeNodePosition).y)
  );
}

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
    return new Map(
      [...manualPositions].filter((entry): entry is [string, TreeNodePosition] => {
        const [id, position] = entry;
        return typeof id === 'string' && isFiniteTreeNodePosition(position);
      }),
    );
  }

  const entries = Object.entries(manualPositions).filter(
    (entry): entry is [string, TreeNodePosition] => {
      const [id, position] = entry;
      return typeof id === 'string' && isFiniteTreeNodePosition(position);
    },
  );

  return new Map(entries);
}

function getTraversalRoots(graph: ConversationTreeGraph): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();

  for (const id of graph.rootIds) {
    if (graph.nodes.has(id) && !seen.has(id)) {
      roots.push(id);
      seen.add(id);
    }
  }

  for (const id of graph.orderedIds) {
    if (graph.nodes.has(id) && !seen.has(id)) {
      roots.push(id);
      seen.add(id);
    }
  }

  return roots;
}

function collectVisibilityState(
  graph: ConversationTreeGraph,
  collapsedIds: Set<string>,
): {
  visibleIds: Set<string>;
  hiddenDescendantCounts: Map<string, number>;
} {
  const visibleIds = new Set<string>();
  const hiddenDescendantCounts = new Map<string, number>();
  const assignedOwners = new Map<string, string | null>();

  const visit = (messageId: string, ownerId: string | null) => {
    if (assignedOwners.has(messageId)) {
      return;
    }

    const graphNode = graph.nodes.get(messageId);
    if (graphNode == null) {
      return;
    }

    assignedOwners.set(messageId, ownerId);

    if (ownerId === null) {
      visibleIds.add(messageId);

      const childOwnerId = collapsedIds.has(messageId) ? messageId : null;
      for (const childId of graphNode.childIds) {
        visit(childId, childOwnerId);
      }
      return;
    }

    hiddenDescendantCounts.set(ownerId, (hiddenDescendantCounts.get(ownerId) ?? 0) + 1);
    for (const childId of graphNode.childIds) {
      visit(childId, ownerId);
    }
  };

  for (const rootId of getTraversalRoots(graph)) {
    visit(rootId, null);
  }

  return {
    visibleIds,
    hiddenDescendantCounts,
  };
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
  const edges: ConversationTreeLayoutEdge[] = [];
  const secondarySize = getSecondarySize(orientation);
  const secondaryGap = getSecondaryGap(orientation);
  const { visibleIds, hiddenDescendantCounts } = collectVisibilityState(graph, collapsedIds);
  const placing = new Set<string>();
  let nextSecondaryStart = 0;

  const placeNode = (messageId: string, depth: number): Span | null => {
    const existingNode = positionedById.get(messageId);
    if (existingNode != null) {
      const start = getSecondaryStart(orientation, existingNode);
      return {
        start,
        end: start + secondarySize,
      };
    }

    if (placing.has(messageId)) {
      return null;
    }

    const graphNode = graph.nodes.get(messageId);
    if (graphNode == null) {
      return null;
    }

    placing.add(messageId);

    const visibleChildren: Array<{ id: string; span: Span }> = [];
    if (!collapsedIds.has(messageId)) {
      for (const childId of graphNode.childIds) {
        if (!visibleIds.has(childId) || !graph.nodes.has(childId)) {
          continue;
        }

        const childSpan = placeNode(childId, depth + 1);
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

    placing.delete(messageId);

    return {
      start: secondaryStart,
      end: secondaryStart + secondarySize,
    };
  };

  for (const rootId of getTraversalRoots(graph)) {
    if (!visibleIds.has(rootId)) {
      continue;
    }
    placeNode(rootId, 0);
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
