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
  const stack: Array<{ messageId: string; ownerId: string | null }> = [];

  for (const rootId of getTraversalRoots(graph)) {
    stack.push({ messageId: rootId, ownerId: null });
    while (stack.length > 0) {
      const current = stack.pop();
      if (current == null || assignedOwners.has(current.messageId)) {
        continue;
      }

      const graphNode = graph.nodes.get(current.messageId);
      if (graphNode == null) {
        continue;
      }

      assignedOwners.set(current.messageId, current.ownerId);

      if (current.ownerId === null) {
        visibleIds.add(current.messageId);
      } else {
        hiddenDescendantCounts.set(
          current.ownerId,
          (hiddenDescendantCounts.get(current.ownerId) ?? 0) + 1,
        );
      }

      const childOwnerId =
        current.ownerId === null && collapsedIds.has(current.messageId)
          ? current.messageId
          : current.ownerId;
      for (let index = graphNode.childIds.length - 1; index >= 0; index -= 1) {
        stack.push({
          messageId: graphNode.childIds[index],
          ownerId: childOwnerId,
        });
      }
    }
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
  let nextSecondaryStart = 0;
  const placing = new Set<string>();
  const spansById = new Map<string, Span>();

  type PlacementFrame = {
    messageId: string;
    depth: number;
    childIds: string[];
    childIndex: number;
    visibleChildren: Array<{ id: string; span: Span }>;
    initialized: boolean;
  };

  for (const rootId of getTraversalRoots(graph)) {
    if (!visibleIds.has(rootId)) {
      continue;
    }

    const stack: PlacementFrame[] = [
      {
        messageId: rootId,
        depth: 0,
        childIds: [],
        childIndex: 0,
        visibleChildren: [],
        initialized: false,
      },
    ];

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];

      if (!frame.initialized) {
        const existingNode = positionedById.get(frame.messageId);
        if (existingNode != null) {
          spansById.set(frame.messageId, {
            start: getSecondaryStart(orientation, existingNode),
            end: getSecondaryStart(orientation, existingNode) + secondarySize,
          });
          stack.pop();
          if (stack.length > 0) {
            const parentFrame = stack[stack.length - 1];
            const existingSpan = spansById.get(frame.messageId);
            if (existingSpan != null) {
              parentFrame.visibleChildren.push({ id: frame.messageId, span: existingSpan });
            }
          }
          continue;
        }

        if (placing.has(frame.messageId)) {
          stack.pop();
          continue;
        }

        const graphNode = graph.nodes.get(frame.messageId);
        if (graphNode == null) {
          stack.pop();
          continue;
        }

        placing.add(frame.messageId);
        frame.initialized = true;
        frame.childIds = collapsedIds.has(frame.messageId)
          ? []
          : graphNode.childIds.filter(
              (childId) => visibleIds.has(childId) && graph.nodes.has(childId),
            );
        continue;
      }

      if (frame.childIndex < frame.childIds.length) {
        const childId = frame.childIds[frame.childIndex];
        frame.childIndex += 1;

        stack.push({
          messageId: childId,
          depth: frame.depth + 1,
          childIds: [],
          childIndex: 0,
          visibleChildren: [],
          initialized: false,
        });
        continue;
      }

      const graphNode = graph.nodes.get(frame.messageId);
      if (graphNode == null) {
        placing.delete(frame.messageId);
        stack.pop();
        continue;
      }

      let secondaryStart = nextSecondaryStart;
      if (frame.visibleChildren.length > 0) {
        secondaryStart =
          (frame.visibleChildren[0].span.start +
            frame.visibleChildren[frame.visibleChildren.length - 1].span.end) /
            2 -
          secondarySize / 2;
      } else {
        nextSecondaryStart += secondarySize + secondaryGap;
      }

      const position = toPosition(orientation, frame.depth, secondaryStart);
      positionedById.set(frame.messageId, {
        ...graphNode,
        ...position,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });

      for (const child of frame.visibleChildren) {
        edges.push({
          id: `${frame.messageId}->${child.id}`,
          sourceId: frame.messageId,
          targetId: child.id,
        });
      }

      const span = {
        start: secondaryStart,
        end: secondaryStart + secondarySize,
      };
      spansById.set(frame.messageId, span);
      placing.delete(frame.messageId);
      stack.pop();

      if (stack.length > 0) {
        stack[stack.length - 1].visibleChildren.push({
          id: frame.messageId,
          span,
        });
      }
    }
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
