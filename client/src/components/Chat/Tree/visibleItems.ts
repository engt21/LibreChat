import type { ConversationTreeGraph, ConversationTreeVisibleItem } from './types';

function collectTraversalRoots(graph: ConversationTreeGraph): string[] {
  const roots: string[] = [];
  const seenRoots = new Set<string>();

  for (const messageId of graph.rootIds) {
    if (!graph.nodes.has(messageId) || seenRoots.has(messageId)) {
      continue;
    }

    seenRoots.add(messageId);
    roots.push(messageId);
  }

  for (const messageId of graph.orderedIds) {
    if (!graph.nodes.has(messageId) || seenRoots.has(messageId)) {
      continue;
    }

    seenRoots.add(messageId);
    roots.push(messageId);
  }

  return roots;
}

export function buildVisibleTreeItems(
  graph: ConversationTreeGraph,
  collapsedIds: Set<string>,
): ConversationTreeVisibleItem[] {
  const visibleItems: ConversationTreeVisibleItem[] = [];
  const seen = new Set<string>();
  const roots = collectTraversalRoots(graph);

  const stack = roots.reverse().map((messageId) => ({
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
