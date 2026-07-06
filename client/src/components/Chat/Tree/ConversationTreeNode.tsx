import React from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Dot, Grip, LoaderCircle } from 'lucide-react';
import useLocalize from '~/hooks/useLocalize';
import { cn } from '~/utils';
import type { InvalidGraftReason, PositionedTreeNode, TreeSemanticDetail } from './types';

function getNodeTitle(localize: ReturnType<typeof useLocalize>, node: PositionedTreeNode): string {
  if (node.role === 'assistant' && node.generationIndex > 0) {
    return localize('com_ui_generation_tree_generation_label', {
      index: node.generationIndex,
    });
  }

  if (node.role === 'graft_bridge') {
    return localize('com_ui_generation_tree_node_graft_bridge');
  }

  return localize('com_ui_generation_tree_node_prompt');
}

function getExcerpt(localize: ReturnType<typeof useLocalize>, node: PositionedTreeNode): string {
  if (typeof node.message.text === 'string' && node.message.text.trim().length > 0) {
    return node.message.text.trim();
  }

  if (typeof node.message.content === 'string' && node.message.content.trim().length > 0) {
    return node.message.content.trim();
  }

  return localize('com_ui_generation_tree_node_empty');
}

function getLifecycleClass(lifecycle: PositionedTreeNode['lifecycle']) {
  switch (lifecycle) {
    case 'streaming':
      return 'text-blue-600';
    case 'errored_partial':
      return 'text-red-600';
    case 'aborted_partial':
      return 'text-amber-600';
    case 'stopped_partial':
      return 'text-orange-600';
    default:
      return 'text-emerald-600';
  }
}

function getLifecycleLabel(
  localize: ReturnType<typeof useLocalize>,
  lifecycle: PositionedTreeNode['lifecycle'],
) {
  switch (lifecycle) {
    case 'complete':
      return localize('com_ui_generation_tree_state_complete');
    case 'stopped_partial':
      return localize('com_ui_generation_tree_state_stopped_partial');
    case 'aborted_partial':
      return localize('com_ui_generation_tree_state_aborted_partial');
    case 'errored_partial':
      return localize('com_ui_generation_tree_state_errored_partial');
    case 'streaming':
      return localize('com_ui_generation_tree_state_streaming');
    default:
      return localize('com_ui_generation_tree_state_complete');
  }
}

function getBadges(node: PositionedTreeNode): string[] {
  const badges: string[] = [];
  const contentParts = Array.isArray(node.message.content) ? node.message.content : [];

  if (
    contentParts.some(
      (part) =>
        part != null &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type?: string }).type?.includes('tool'),
    )
  ) {
    badges.push('tool');
  }

  if (
    Array.isArray((node.message as { files?: unknown[] }).files) &&
    (node.message as { files: unknown[] }).files.length > 0
  ) {
    badges.push('file');
  }

  if (
    contentParts.some(
      (part) =>
        part != null &&
        typeof part === 'object' &&
        'type' in part &&
        ((part as { type?: string }).type === 'image_file' ||
          (part as { type?: string }).type === 'image_url'),
    )
  ) {
    badges.push('image');
  }

  if (
    contentParts.some(
      (part) =>
        part != null &&
        typeof part === 'object' &&
        'type' in part &&
        (part as { type?: string }).type?.includes('reason'),
    )
  ) {
    badges.push('reasoning');
  }

  if (node.graftId != null || node.clonedFromMessageId != null || node.role === 'graft_bridge') {
    badges.push('provenance');
  }

  return badges;
}

function getBadgeLabel(localize: ReturnType<typeof useLocalize>, badge: string): string {
  switch (badge) {
    case 'tool':
      return localize('com_ui_generation_tree_badge_tool');
    case 'file':
      return localize('com_ui_generation_tree_badge_file');
    case 'image':
      return localize('com_ui_generation_tree_badge_image');
    case 'reasoning':
      return localize('com_ui_generation_tree_badge_reasoning');
    case 'provenance':
      return localize('com_ui_generation_tree_badge_provenance');
    default:
      return badge;
  }
}

function getNodeIndicator(
  invalidReason: InvalidGraftReason,
  lifecycle: PositionedTreeNode['lifecycle'],
) {
  if (lifecycle === 'streaming') {
    return {
      icon: LoaderCircle,
      className: cn('h-3.5 w-3.5 animate-spin', getLifecycleClass(lifecycle)),
    };
  }

  if (invalidReason != null) {
    return {
      icon: CircleAlert,
      className: 'h-3.5 w-3.5 text-red-600',
    };
  }

  return {
    icon: Dot,
    className: cn('h-4 w-4', getLifecycleClass(lifecycle)),
  };
}

function getNodeMetaLabel(
  localize: ReturnType<typeof useLocalize>,
  node: PositionedTreeNode,
): string {
  if (node.message.model != null) {
    return node.message.model;
  }

  if (node.message.endpoint != null) {
    return node.message.endpoint;
  }

  return getLifecycleLabel(localize, node.lifecycle);
}

type ConversationTreeNodeProps = {
  node: PositionedTreeNode;
  detail: TreeSemanticDetail;
  hiddenDescendantCount?: number;
  focused: boolean;
  sourceSelected: boolean;
  destinationSelected: boolean;
  activeBranch: boolean;
  dropTarget: boolean;
  invalidReason: InvalidGraftReason;
  onToggleCollapsed: (messageId: string) => void;
  onPointerDownHandle: React.PointerEventHandler<HTMLButtonElement>;
  onPointerDownBody: React.PointerEventHandler<HTMLDivElement>;
};

const ConversationTreeNode = React.memo(function ConversationTreeNode({
  node,
  detail,
  hiddenDescendantCount = 0,
  focused,
  sourceSelected,
  destinationSelected,
  activeBranch,
  dropTarget,
  invalidReason,
  onToggleCollapsed,
  onPointerDownHandle,
  onPointerDownBody,
}: ConversationTreeNodeProps) {
  const localize = useLocalize();
  const excerpt = getExcerpt(localize, node);
  const badges = getBadges(node);
  const title = getNodeTitle(localize, node);
  const hasChildren = node.childIds.length > 0;
  const isCollapsed = hasChildren && hiddenDescendantCount > 0;
  const indicator = getNodeIndicator(invalidReason, node.lifecycle);
  const IndicatorIcon = indicator.icon;
  let collapseToggle: React.ReactNode = null;

  if (hiddenDescendantCount > 0) {
    collapseToggle = (
      <button
        type="button"
        data-testid={`collapse-toggle-${node.id}`}
        className="tree-node-control ml-auto flex items-center gap-1 rounded-full border border-border-medium px-2 py-0.5"
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onToggleCollapsed(node.id)}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        <span>{hiddenDescendantCount}</span>
      </button>
    );
  } else if (hasChildren) {
    collapseToggle = (
      <button
        type="button"
        data-testid={`collapse-toggle-${node.id}`}
        className="tree-node-control ml-auto rounded-full border border-border-medium px-2 py-0.5"
        tabIndex={-1}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onToggleCollapsed(node.id)}
        aria-expanded={!isCollapsed}
      >
        <ChevronDown className="h-3 w-3" />
      </button>
    );
  }

  return (
    <div
      data-testid={`tree-node-${node.id}`}
      data-tree-node-id={node.id}
      className={cn(
        'absolute isolate flex h-[92px] w-[240px] flex-col rounded-2xl border bg-surface-primary text-left shadow-sm transition-colors',
        focused && 'ring-2 ring-ring-primary',
        sourceSelected && 'border-violet-500 shadow-violet-100',
        destinationSelected && 'border-blue-500 shadow-blue-100',
        activeBranch && 'bg-surface-secondary',
        dropTarget && invalidReason == null && 'border-blue-500',
        invalidReason != null && 'border-red-400',
      )}
      style={{
        left: node.x,
        top: node.y,
      }}
      aria-hidden="true"
      onPointerDown={onPointerDownBody}
    >
      <div className="flex flex-1 flex-col gap-2 p-3 text-left">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-secondary">
              <IndicatorIcon className={indicator.className} />
              <span>{title}</span>
            </div>
            {detail !== 'far' ? (
              <div className="truncate text-sm font-medium text-text-primary">
                {getNodeMetaLabel(localize, node)}
              </div>
            ) : null}
          </div>
          {node.role === 'assistant' && node.lifecycle !== 'streaming' ? (
            <button
              type="button"
              data-testid={`graft-handle-${node.id}`}
              className="graft-handle tree-node-control rounded-lg border border-border-medium p-1 text-text-secondary hover:text-text-primary"
              tabIndex={-1}
              onPointerDown={(event) => {
                event.stopPropagation();
                onPointerDownHandle(event);
              }}
              aria-label={`${localize('com_ui_graft_generation')}: ${title}`}
            >
              <Grip className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {detail !== 'far' ? (
          <p
            className={cn(
              'text-xs text-text-secondary',
              detail === 'near' ? 'line-clamp-3 whitespace-pre-wrap' : 'truncate',
            )}
          >
            {excerpt}
          </p>
        ) : null}

        <div className="mt-auto flex items-center gap-1 text-[11px] text-text-secondary">
          {badges.map((badge) => (
            <span key={badge} className="rounded-full bg-surface-hover px-2 py-0.5">
              {getBadgeLabel(localize, badge)}
            </span>
          ))}
          {collapseToggle}
        </div>
      </div>
    </div>
  );
});

export default ConversationTreeNode;
