import { useMemo } from 'react';
import { layoutConversationTree } from './layout';
import { normalizeConversationGraph } from './graph';
import type { ConversationTreeMessageLike, TreeNodePosition, TreeOrientation } from './types';

function collectBranchIds(
  orderedIds: string[],
  parentById: Map<string, string | null>,
  leafMessageId: string | null,
): Set<string> {
  const ids = new Set<string>();
  if (leafMessageId == null) {
    return ids;
  }

  let currentId: string | null = leafMessageId;
  while (currentId != null) {
    if (ids.has(currentId)) {
      break;
    }

    ids.add(currentId);
    currentId = parentById.get(currentId) ?? null;
  }

  if (ids.size === 0 && orderedIds.length > 0) {
    ids.add(orderedIds[orderedIds.length - 1]);
  }

  return ids;
}

export default function useConversationTreeViewModel({
  messages,
  activeMessageIds,
  orientation,
  collapsedIds,
  manualPositions,
  activeLeafMessageId,
}: {
  messages: ConversationTreeMessageLike[];
  activeMessageIds: Iterable<string>;
  orientation: TreeOrientation;
  collapsedIds: Set<string>;
  manualPositions: Map<string, TreeNodePosition>;
  activeLeafMessageId: string | null;
}) {
  const graph = useMemo(
    () => normalizeConversationGraph(messages, { activeMessageIds }),
    [messages, activeMessageIds],
  );

  const layout = useMemo(
    () =>
      layoutConversationTree(graph, {
        orientation,
        collapsedIds,
        manualPositions,
      }),
    [graph, orientation, collapsedIds, manualPositions],
  );

  const activeBranchIds = useMemo(
    () => collectBranchIds(graph.orderedIds, graph.parentById, activeLeafMessageId),
    [graph.orderedIds, graph.parentById, activeLeafMessageId],
  );

  return {
    graph,
    layout,
    activeBranchIds,
  };
}
