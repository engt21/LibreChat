import React from 'react';
import useLocalize from '~/hooks/useLocalize';
import { cn } from '~/utils';
import type { TreeOrientation } from './types';

type ConversationTreeToolbarProps = {
  orientation: TreeOrientation;
  arrangeMode: boolean;
  onFitTree: () => void;
  onFitActiveBranch: () => void;
  onFitSelection: () => void;
  onToggleOrientation: () => void;
  onToggleArrangeMode: () => void;
  onResetLayout: () => void;
  onExpandActiveBranch: () => void;
};

function ToolbarButton({
  active = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        'rounded-xl border border-border-medium px-3 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary',
        active && 'border-blue-500 bg-blue-50 text-blue-700',
      )}
      {...props}
    />
  );
}

export default function ConversationTreeToolbar({
  orientation,
  arrangeMode,
  onFitTree,
  onFitActiveBranch,
  onFitSelection,
  onToggleOrientation,
  onToggleArrangeMode,
  onResetLayout,
  onExpandActiveBranch,
}: ConversationTreeToolbarProps) {
  const localize = useLocalize();

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border-light px-4 py-3">
      <ToolbarButton onClick={onFitTree}>{localize('com_ui_generation_tree_fit')}</ToolbarButton>
      <ToolbarButton onClick={onFitActiveBranch}>
        {localize('com_ui_generation_tree_fit_active_branch')}
      </ToolbarButton>
      <ToolbarButton onClick={onFitSelection}>
        {localize('com_ui_generation_tree_fit_selection')}
      </ToolbarButton>
      <ToolbarButton onClick={onExpandActiveBranch}>
        {localize('com_ui_generation_tree_expand_collapse')}
      </ToolbarButton>
      <ToolbarButton
        data-testid="tree-orientation-toggle"
        data-orientation={orientation}
        onClick={onToggleOrientation}
      >
        {orientation === 'horizontal'
          ? localize('com_ui_generation_tree_layout_vertical')
          : localize('com_ui_generation_tree_layout_horizontal')}
      </ToolbarButton>
      <ToolbarButton active={arrangeMode} onClick={onToggleArrangeMode}>
        {localize('com_ui_generation_tree_arrange')}
      </ToolbarButton>
      <ToolbarButton onClick={onResetLayout}>
        {localize('com_ui_generation_tree_reset_layout')}
      </ToolbarButton>
    </div>
  );
}
