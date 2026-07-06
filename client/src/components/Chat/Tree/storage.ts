import type { TreeOrientation } from './types';

const DEFAULT_ORIENTATION: TreeOrientation = 'horizontal';
const ORIENTATION_STORAGE_KEY = 'generation-tree:orientation';

function getCollapsedStorageKey(conversationId: string): string {
  return `generation-tree:${conversationId}:collapsed`;
}

function getStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) {
    return storage;
  }

  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizeCollapsedIds(ids: Iterable<string>): string[] {
  const normalizedIds: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) {
      continue;
    }

    seen.add(id);
    normalizedIds.push(id);
  }

  return normalizedIds;
}

export function loadCollapsedTreeIds(conversationId: string, storage?: Storage | null): string[] {
  const resolvedStorage = getStorage(storage);
  if (resolvedStorage == null) {
    return [];
  }

  try {
    const rawValue = resolvedStorage.getItem(getCollapsedStorageKey(conversationId));
    if (rawValue == null) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeCollapsedIds(
      parsed.filter((value): value is string => typeof value === 'string'),
    );
  } catch {
    return [];
  }
}

export function saveCollapsedTreeIds(
  conversationId: string,
  collapsedIds: Iterable<string>,
  storage?: Storage | null,
): void {
  const resolvedStorage = getStorage(storage);
  if (resolvedStorage == null) {
    return;
  }

  try {
    resolvedStorage.setItem(
      getCollapsedStorageKey(conversationId),
      JSON.stringify(normalizeCollapsedIds(collapsedIds)),
    );
  } catch {
    // Ignore storage failures so tree state never breaks the conversation UI.
  }
}

export function loadTreeOrientation(storage?: Storage | null): TreeOrientation {
  const resolvedStorage = getStorage(storage);
  if (resolvedStorage == null) {
    return DEFAULT_ORIENTATION;
  }

  try {
    const rawValue = resolvedStorage.getItem(ORIENTATION_STORAGE_KEY);
    return rawValue === 'horizontal' || rawValue === 'vertical' ? rawValue : DEFAULT_ORIENTATION;
  } catch {
    return DEFAULT_ORIENTATION;
  }
}

export function saveTreeOrientation(orientation: TreeOrientation, storage?: Storage | null): void {
  if (orientation !== 'horizontal' && orientation !== 'vertical') {
    return;
  }

  const resolvedStorage = getStorage(storage);
  if (resolvedStorage == null) {
    return;
  }

  try {
    resolvedStorage.setItem(ORIENTATION_STORAGE_KEY, orientation);
  } catch {
    // Ignore storage failures so tree state never breaks the conversation UI.
  }
}
