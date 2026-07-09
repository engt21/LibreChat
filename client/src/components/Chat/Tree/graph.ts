import type {
  ConversationTreeGraph,
  ConversationTreeMessageLike,
  ConversationTreeNode,
  InvalidGraftReason,
  NormalizeConversationGraphOptions,
  TreeSemanticDetail,
} from './types';

const NO_PARENT_MESSAGE_ID = '00000000-0000-0000-0000-000000000000';
const ABORTED_FINISH_REASONS = new Set(['abort', 'aborted', 'cancelled', 'canceled']);

type GraphEntry = {
  id: string;
  message: ConversationTreeMessageLike;
  explicitParentId: string | null | undefined;
  nestedParentId: string | null;
};

type GraphVisit = {
  message: ConversationTreeMessageLike;
  nestedParentId: string | null;
};

const hasOwn = Object.prototype.hasOwnProperty;

function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeParentId(value: unknown): string | null {
  const parentId = normalizeMessageId(value);
  if (parentId == null || parentId === NO_PARENT_MESSAGE_ID) {
    return null;
  }

  return parentId;
}

function getExplicitParentId(message: ConversationTreeMessageLike): string | null | undefined {
  if (!hasOwn.call(message, 'parentMessageId')) {
    return undefined;
  }

  if (message.parentMessageId === undefined) {
    return undefined;
  }

  return normalizeParentId(message.parentMessageId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function collectEntries(messages: ConversationTreeMessageLike[]): {
  entries: Map<string, GraphEntry>;
  orderedIds: string[];
} {
  const entries = new Map<string, GraphEntry>();
  const orderedIds: string[] = [];
  const seenObjects = new WeakSet<object>();
  const stack: GraphVisit[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message != null) {
      stack.push({ message, nestedParentId: null });
    }
  }

  while (stack.length > 0) {
    const visit = stack.pop();
    if (visit == null) {
      continue;
    }

    const { message, nestedParentId } = visit;
    if (!isRecord(message)) {
      continue;
    }

    const currentId = normalizeMessageId(message.messageId);
    const nextNestedParentId = currentId ?? nestedParentId;

    if (!seenObjects.has(message)) {
      seenObjects.add(message);

      const children = Array.isArray(message.children) ? message.children : [];
      for (let childIndex = children.length - 1; childIndex >= 0; childIndex -= 1) {
        const child = children[childIndex];
        if (child != null) {
          stack.push({ message: child, nestedParentId: nextNestedParentId });
        }
      }
    }

    if (currentId == null) {
      continue;
    }

    const explicitParentId = getExplicitParentId(message);
    const existing = entries.get(currentId);

    if (existing == null) {
      entries.set(currentId, {
        id: currentId,
        message,
        explicitParentId,
        nestedParentId,
      });
      orderedIds.push(currentId);
      continue;
    }

    if (existing.explicitParentId === undefined && explicitParentId !== undefined) {
      existing.explicitParentId = explicitParentId;
    }

    if (existing.nestedParentId == null && nestedParentId != null) {
      existing.nestedParentId = nestedParentId;
    }
  }

  return { entries, orderedIds };
}

function getResolvedParentId(entry: GraphEntry): string | null {
  if (entry.explicitParentId !== undefined) {
    return entry.explicitParentId;
  }

  return entry.nestedParentId;
}

function normalizeResolvedParentId(
  messageId: string,
  parentId: string | null,
  entries: Map<string, GraphEntry>,
): string | null {
  if (parentId == null || parentId === messageId || !entries.has(parentId)) {
    return null;
  }

  return parentId;
}

function classifyRole(message: ConversationTreeMessageLike): ConversationTreeNode['role'] {
  const generationGraft = getNestedRecord(message.metadata, 'generationGraft');
  if (generationGraft?.kind === 'generation_graft') {
    return 'graft_bridge';
  }

  return message.isCreatedByUser === false ? 'assistant' : 'user';
}

function classifyLifecycle(
  messageId: string,
  message: ConversationTreeMessageLike,
  activeMessageIds: Set<string>,
): ConversationTreeNode['lifecycle'] {
  if (activeMessageIds.has(messageId)) {
    return 'streaming';
  }

  if (message.error === true) {
    return 'errored_partial';
  }

  if (message.unfinished === true) {
    const generationTermination = getString(
      isRecord(message.metadata) ? message.metadata.generationTermination : undefined,
    );
    const finishReason = getString(message.finish_reason)?.toLowerCase();

    if (
      (generationTermination != null &&
        ABORTED_FINISH_REASONS.has(generationTermination.toLowerCase())) ||
      (finishReason != null && ABORTED_FINISH_REASONS.has(finishReason))
    ) {
      return 'aborted_partial';
    }

    return 'stopped_partial';
  }

  return 'complete';
}

function getContentPartText(part: unknown): string {
  if (!isRecord(part)) {
    return '';
  }

  if (part.type === 'text') {
    if (typeof part.text === 'string') {
      return part.text;
    }

    if (isRecord(part.text) && typeof part.text.value === 'string') {
      return part.text.value;
    }
  }

  if (part.type === 'error') {
    if (typeof part.error === 'string') {
      return part.error;
    }

    if (typeof part.text === 'string') {
      return part.text;
    }

    if (isRecord(part.text) && typeof part.text.value === 'string') {
      return part.text.value;
    }
  }

  return '';
}

function getVisibleText(message: ConversationTreeMessageLike): string[] {
  const parts: string[] = [];

  if (typeof message.text === 'string' && message.text.length > 0) {
    parts.push(message.text);
  }

  if (typeof message.content === 'string' && message.content.length > 0) {
    parts.push(message.content);
    return parts;
  }

  if (!Array.isArray(message.content)) {
    return parts;
  }

  for (const contentPart of message.content) {
    const text = getContentPartText(contentPart);
    if (text.length > 0) {
      parts.push(text);
    }
  }

  return parts;
}

function buildSearchableText(message: ConversationTreeMessageLike): {
  searchableText: string;
  graftId?: string;
  clonedFromMessageId?: string;
} {
  const generationGraft = getNestedRecord(message.metadata, 'generationGraft');
  const generationGraftCopy = getNestedRecord(message.metadata, 'generationGraftCopy');

  const graftId = getString(generationGraft?.graftId) ?? getString(generationGraftCopy?.graftId);
  const clonedFromMessageId = getString(generationGraftCopy?.clonedFromMessageId);

  const searchableParts = [
    ...getVisibleText(message),
    getString(message.model),
    getString(message.endpoint),
    graftId,
    clonedFromMessageId,
    getString(generationGraft?.sourceConversationId),
    getString(generationGraft?.sourceRootMessageId),
    getString(generationGraft?.destinationMessageId),
    getString(generationGraft?.copiedRootMessageId),
  ].filter((value): value is string => value != null && value.length > 0);

  return {
    searchableText: searchableParts.join('\n').toLowerCase(),
    graftId,
    clonedFromMessageId,
  };
}

function collectAncestorIds(graph: ConversationTreeGraph, messageId: string): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>([messageId]);
  let parentId = graph.parentById.get(messageId) ?? graph.nodes.get(messageId)?.parentId ?? null;

  while (parentId != null) {
    if (seen.has(parentId)) {
      break;
    }

    const parent = graph.nodes.get(parentId);
    if (parent == null) {
      break;
    }

    ancestors.push(parentId);
    seen.add(parentId);
    parentId = graph.parentById.get(parentId) ?? parent.parentId;
  }

  return ancestors;
}

function hasBranchOverlap(
  graph: ConversationTreeGraph,
  sourceId: string,
  destinationId: string,
): boolean {
  if (sourceId === destinationId) {
    return true;
  }

  const sourceAncestors = collectAncestorIds(graph, sourceId);
  if (sourceAncestors.includes(destinationId)) {
    return true;
  }

  const destinationAncestors = collectAncestorIds(graph, destinationId);
  return destinationAncestors.includes(sourceId);
}

export function normalizeConversationGraph(
  messages: ConversationTreeMessageLike[],
  options: NormalizeConversationGraphOptions = {},
): ConversationTreeGraph {
  const messageList = Array.isArray(messages) ? messages : [];
  const { entries, orderedIds } = collectEntries(messageList);
  const activeMessageIds = new Set(options.activeMessageIds ?? []);
  const parentById = new Map<string, string | null>();
  const childrenByParent = new Map<string | null, string[]>();
  const nodes = new Map<string, ConversationTreeNode>();

  childrenByParent.set(null, []);

  for (const id of orderedIds) {
    const entry = entries.get(id);
    if (entry == null) {
      continue;
    }

    const resolvedParentId = normalizeResolvedParentId(id, getResolvedParentId(entry), entries);
    parentById.set(id, resolvedParentId);
  }

  for (const id of orderedIds) {
    const entry = entries.get(id);
    if (entry == null) {
      continue;
    }

    const normalizedParentId = parentById.get(id) ?? null;

    const siblings = childrenByParent.get(normalizedParentId) ?? [];
    siblings.push(id);
    childrenByParent.set(normalizedParentId, siblings);
    childrenByParent.set(id, childrenByParent.get(id) ?? []);
  }

  for (const id of orderedIds) {
    const entry = entries.get(id);
    if (entry == null) {
      continue;
    }

    const childIds = [...(childrenByParent.get(id) ?? [])];
    const role = classifyRole(entry.message);
    const lifecycle = classifyLifecycle(id, entry.message, activeMessageIds);
    const { searchableText, graftId, clonedFromMessageId } = buildSearchableText(entry.message);

    nodes.set(id, {
      id,
      parentId: parentById.get(id) ?? null,
      childIds,
      message: entry.message,
      role,
      lifecycle,
      generationIndex: 0,
      generationCount: 0,
      graftId,
      clonedFromMessageId,
      searchableText,
    });
  }

  for (const childIds of childrenByParent.values()) {
    const assistantChildIds = childIds.filter(
      (childId) => nodes.get(childId)?.role === 'assistant',
    );
    const generationCount = assistantChildIds.length;

    assistantChildIds.forEach((childId, index) => {
      const childNode = nodes.get(childId);
      if (childNode == null) {
        return;
      }

      childNode.generationIndex = index + 1;
      childNode.generationCount = generationCount;
    });
  }

  return {
    nodes,
    orderedIds,
    rootIds: [...(childrenByParent.get(null) ?? [])],
    parentById,
    childrenByParent,
    activeMessageIds,
  };
}

export function getInvalidGraftReason(
  graph: ConversationTreeGraph,
  sourceId: string,
  destinationId: string,
): InvalidGraftReason {
  const source = graph.nodes.get(sourceId);
  const destination = graph.nodes.get(destinationId);

  if (source == null || destination == null) {
    return 'MESSAGE_NOT_FOUND';
  }

  if (source.role !== 'assistant') {
    return 'INVALID_SOURCE';
  }

  if (source.lifecycle === 'streaming' || destination?.lifecycle === 'streaming') {
    return 'GRAFT_REQUIRES_STABILIZATION';
  }

  if (destination.role !== 'assistant') {
    return 'INVALID_DESTINATION';
  }

  if (sourceId === destinationId) {
    return 'INVALID_DESTINATION';
  }

  if (hasBranchOverlap(graph, sourceId, destinationId)) {
    return 'OVERLAPPING_BRANCHES';
  }

  return null;
}

export function searchTreeNodes(
  graph: ConversationTreeGraph,
  query: string,
): ConversationTreeNode[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const matches: ConversationTreeNode[] = [];
  for (const id of graph.orderedIds) {
    const node = graph.nodes.get(id);
    if (node?.searchableText.includes(normalizedQuery)) {
      matches.push(node);
    }
  }

  return matches;
}

export function semanticDetail(scale: number): TreeSemanticDetail {
  if (scale < 0.55) {
    return 'far';
  }

  if (scale < 1.05) {
    return 'medium';
  }

  return 'near';
}
