import { Check, GitMerge, PanelBottomOpen } from 'lucide-react';
import useLocalize from '~/hooks/useLocalize';
import type { PositionedTreeNode } from './types';
import { getTreeNodeExcerpt, getTreeNodeLabel } from './treeLabels';

type ConversationTreeMobileGuideBarProps = {
  focusedNode: PositionedTreeNode | null;
  sourceNode: PositionedTreeNode | null;
  destinationNode: PositionedTreeNode | null;
  canUseFocusedAsSource: boolean;
  canUseFocusedAsDestination: boolean;
  onUseFocusedAsSource: () => void;
  onUseFocusedAsDestination: () => void;
  onOpenDetails: () => void;
};

export default function ConversationTreeMobileGuideBar({
  focusedNode,
  sourceNode,
  destinationNode,
  canUseFocusedAsSource,
  canUseFocusedAsDestination,
  onUseFocusedAsSource,
  onUseFocusedAsDestination,
  onOpenDetails,
}: ConversationTreeMobileGuideBarProps) {
  const localize = useLocalize();
  const focusedLabel = focusedNode
    ? `${getTreeNodeLabel(localize, focusedNode)}: ${getTreeNodeExcerpt(localize, focusedNode)}`
    : localize('com_ui_generation_tree_tap_response_first');

  let action = {
    label: localize('com_ui_generation_tree_review_append'),
    disabled: false,
    onClick: onOpenDetails,
    icon: PanelBottomOpen,
  };

  if (sourceNode == null) {
    action = {
      label: localize('com_ui_generation_tree_use_as_source_short'),
      disabled: !canUseFocusedAsSource,
      onClick: onUseFocusedAsSource,
      icon: GitMerge,
    };
  } else if (destinationNode == null) {
    action = {
      label: localize('com_ui_generation_tree_append_here'),
      disabled: !canUseFocusedAsDestination,
      onClick: onUseFocusedAsDestination,
      icon: GitMerge,
    };
  }
  const ActionIcon = action.icon;

  return (
    <div
      data-testid="generation-tree-mobile-summary"
      className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border-light bg-surface-primary px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
          {sourceNode ? (
            <Check className="size-3.5 text-green-600" aria-hidden="true" />
          ) : (
            <span className="flex size-4 items-center justify-center rounded-full bg-surface-hover text-[10px]">
              1
            </span>
          )}
          {sourceNode
            ? localize('com_ui_generation_tree_source_selected')
            : localize('com_ui_generation_tree_source_step')}
        </div>
        <div className="mt-1 truncate text-xs text-text-secondary" title={focusedLabel}>
          {focusedLabel}
        </div>
      </div>
      <button
        type="button"
        className="flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-surface-submit px-3 py-2 text-sm font-medium text-white hover:bg-surface-submit-hover disabled:opacity-50"
        disabled={action.disabled}
        onClick={action.onClick}
      >
        <ActionIcon className="size-4" aria-hidden="true" />
        {action.label}
      </button>
    </div>
  );
}
