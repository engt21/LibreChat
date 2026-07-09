import React, { useEffect, useMemo, useRef, useState } from 'react';
import useLocalize from '~/hooks/useLocalize';
import type {
  ConversationTreeGraph,
  ConversationTreeVisibleItem,
  InvalidGraftReason,
} from './types';
import { getInvalidGraftReason } from './graph';
import { getTreeNodeLabel } from './treeLabels';
import { buildVisibleTreeItems } from './visibleItems';

const STABILIZABLE_REASONS = new Set<InvalidGraftReason>([
  'GRAFT_BUSY',
  'GRAFT_REQUIRES_STABILIZATION',
]);

function getItemTitle(
  localize: ReturnType<typeof useLocalize>,
  item: ConversationTreeVisibleItem,
): string {
  return getTreeNodeLabel(localize, item.node);
}

type ConversationTreeListProps = {
  graph: ConversationTreeGraph;
  collapsedIds: Set<string>;
  focusedMessageId: string | null;
  sourceMessageId: string | null;
  destinationMessageId: string | null;
  onFocusMessage: (messageId: string) => void;
  onSelectSource: (messageId: string) => void;
  onSelectDestination: (messageId: string) => void;
  onPreviewRequest: () => void;
  onCollapsedIdsChange: (collapsedIds: Set<string>) => void;
  onCancelSelection: () => void;
  announceStatus?: boolean;
  onStatusTextChange?: (statusText: string) => void;
};

function getInvalidReasonText(
  localize: ReturnType<typeof useLocalize>,
  reason: InvalidGraftReason,
): string {
  switch (reason) {
    case 'INVALID_SOURCE':
      return localize('com_ui_generation_tree_error_source');
    case 'INVALID_DESTINATION':
      return localize('com_ui_generation_tree_error_destination');
    case 'GRAFT_BUSY':
    case 'GRAFT_REQUIRES_STABILIZATION':
      return localize('com_ui_generation_tree_error_busy');
    case 'OVERLAPPING_BRANCHES':
      return localize('com_ui_generation_tree_error_overlap');
    default:
      return localize('com_ui_generation_tree_error_invalid');
  }
}

export default function ConversationTreeList({
  graph,
  collapsedIds,
  focusedMessageId,
  sourceMessageId,
  onFocusMessage,
  onSelectSource,
  onSelectDestination,
  onPreviewRequest,
  onCollapsedIdsChange,
  onCancelSelection,
  announceStatus = true,
  onStatusTextChange,
}: ConversationTreeListProps) {
  const localize = useLocalize();
  const items = useMemo(() => buildVisibleTreeItems(graph, collapsedIds), [collapsedIds, graph]);
  const [activeId, setActiveId] = useState<string | null>(focusedMessageId ?? items[0]?.id ?? null);
  const [statusText, setStatusText] = useState('');
  const itemRefs = useRef(new Map<string, HTMLButtonElement | null>());

  useEffect(() => {
    if (focusedMessageId != null) {
      setActiveId(focusedMessageId);
    }
  }, [focusedMessageId]);

  useEffect(() => {
    if (activeId == null) {
      return;
    }

    itemRefs.current.get(activeId)?.focus();
  }, [activeId]);

  const activeIndex = activeId == null ? -1 : items.findIndex((item) => item.id === activeId);

  const moveToIndex = (index: number) => {
    const nextItem = items[index];
    if (nextItem == null) {
      return;
    }

    setActiveId(nextItem.id);
    onFocusMessage(nextItem.id);
  };

  const updateStatusText = (nextStatusText: string) => {
    setStatusText(nextStatusText);
    onStatusTextChange?.(nextStatusText);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="text-xs text-text-secondary">{localize('com_ui_generation_tree_list')}</div>
      <div className="min-w-0 overflow-hidden rounded-lg border border-border-medium p-2">
        <div role="tree" className="flex flex-col gap-1">
          {items.map((item) => (
            <button
              key={item.id}
              ref={(element) => {
                itemRefs.current.set(item.id, element);
              }}
              type="button"
              role="treeitem"
              tabIndex={activeId === item.id ? 0 : -1}
              aria-level={item.depth}
              aria-expanded={item.hasChildren ? item.expanded : undefined}
              aria-selected={activeId === item.id}
              className="min-h-10 min-w-0 truncate rounded-md px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover"
              style={{ paddingLeft: `${Math.min(item.depth * 12, 48)}px` }}
              title={getItemTitle(localize, item)}
              onFocus={() => {
                setActiveId(item.id);
                onFocusMessage(item.id);
              }}
              onKeyDown={(event) => {
                switch (event.key) {
                  case 'ArrowDown':
                    event.preventDefault();
                    moveToIndex(Math.min(activeIndex + 1, items.length - 1));
                    break;
                  case 'ArrowUp':
                    event.preventDefault();
                    moveToIndex(Math.max(activeIndex - 1, 0));
                    break;
                  case 'Home':
                    event.preventDefault();
                    moveToIndex(0);
                    break;
                  case 'End':
                    event.preventDefault();
                    moveToIndex(items.length - 1);
                    break;
                  case 'ArrowLeft':
                    event.preventDefault();
                    if (item.hasChildren && item.expanded) {
                      const nextCollapsedIds = new Set(collapsedIds);
                      nextCollapsedIds.add(item.id);
                      onCollapsedIdsChange(nextCollapsedIds);
                    } else if (item.node.parentId != null) {
                      const parentIndex = items.findIndex(
                        (entry) => entry.id === item.node.parentId,
                      );
                      if (parentIndex >= 0) {
                        moveToIndex(parentIndex);
                      }
                    }
                    break;
                  case 'ArrowRight':
                    event.preventDefault();
                    if (item.hasChildren && !item.expanded) {
                      const nextCollapsedIds = new Set(collapsedIds);
                      nextCollapsedIds.delete(item.id);
                      onCollapsedIdsChange(nextCollapsedIds);
                    } else if (item.node.childIds[0] != null) {
                      const childIndex = items.findIndex(
                        (entry) => entry.id === item.node.childIds[0],
                      );
                      if (childIndex >= 0) {
                        moveToIndex(childIndex);
                      }
                    }
                    break;
                  case ' ':
                    event.preventDefault();
                    if (item.node.role !== 'assistant') {
                      updateStatusText(getInvalidReasonText(localize, 'INVALID_SOURCE'));
                      break;
                    }
                    onSelectSource(item.id);
                    updateStatusText(localize('com_ui_generation_tree_status_source_selected'));
                    break;
                  case 'Enter':
                    event.preventDefault();
                    if (sourceMessageId == null) {
                      updateStatusText(localize('com_ui_generation_tree_error_select_source'));
                      break;
                    }

                    {
                      const invalidReason = getInvalidGraftReason(graph, sourceMessageId, item.id);
                      if (invalidReason != null && !STABILIZABLE_REASONS.has(invalidReason)) {
                        updateStatusText(getInvalidReasonText(localize, invalidReason));
                        break;
                      }
                    }

                    onSelectDestination(item.id);
                    onPreviewRequest();
                    updateStatusText(localize('com_ui_generation_tree_status_preview'));
                    break;
                  case 'Escape':
                    event.preventDefault();
                    onCancelSelection();
                    updateStatusText(localize('com_ui_generation_tree_announcer_closed'));
                    break;
                  default:
                    break;
                }
              }}
            >
              {getItemTitle(localize, item)}
            </button>
          ))}
        </div>
      </div>
      <div
        data-testid="generation-tree-list-status"
        role={announceStatus ? 'status' : undefined}
        aria-live={announceStatus ? 'polite' : undefined}
        aria-atomic={announceStatus ? 'true' : undefined}
        className="text-xs text-text-secondary"
      >
        {statusText}
      </div>
    </div>
  );
}
