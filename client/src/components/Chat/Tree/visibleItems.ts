import type { ConversationTreeGraph, ConversationTreeVisibleItem } from './types';

export function buildVisibleTreeItems(
  graph: ConversationTreeGraph,
  collapsedIds: Set<string>,
): ConversationTreeVisibleItem[] {
  const visibleItems: ConversationTreeVisibleItem[] = [];
  const seen = new Set<string>();
  const roots = [...graph.rootIds];

  for (const messageId of graph.orderedIds) {
    if (!roots.includes(messageId)) {
      roots.push(messageId);
    }
  }

  const stack = roots
    .filter((messageId) => graph.nodes.has(messageId))
    .reverse()
    .map((messageId) => ({
      messageId,
      depth: 1,
    }));

  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null || seen.has(current.messageId)) {
      continue;
    }

    const node = graph.nodes.get(current.messageId);
    if (node == null) {
      continue;
    }

    seen.add(current.messageId);

    const hasChildren = node.childIds.length > 0;
    const expanded = hasChildren && !collapsedIds.has(current.messageId);

    visibleItems.push({
      id: current.messageId,
      node,
      depth: current.depth,
      hasChildren,
      expanded,
    });

    if (!expanded) {
      continue;
    }

    for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
      const childId = node.childIds[index];
      if (!seen.has(childId) && graph.nodes.has(childId)) {
        stack.push({
          messageId: childId,
          depth: current.depth + 1,
        });
      }
    }
  }

  return visibleItems;
}
