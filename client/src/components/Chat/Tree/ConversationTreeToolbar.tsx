import React from 'react';
import {
  Columns3,
  Focus,
  Maximize2,
  Move,
  RotateCcw,
  Route,
  Rows3,
  UnfoldVertical,
} from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
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

type ToolbarButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  active?: boolean;
  label: string;
  icon: React.ReactNode;
};

function ToolbarButton({ active = false, label, icon, className, ...props }: ToolbarButtonProps) {
  return (
    <TooltipAnchor
      description={label}
      render={
        <button
          type="button"
          aria-label={label}
          title={label}
          className={cn(
            'flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-border-medium px-3',
            'text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            active && 'border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300',
            className,
          )}
          {...props}
        />
      }
    >
      {icon}
      <span className="whitespace-nowrap text-xs font-medium">{label}</span>
    </TooltipAnchor>
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
  const orientationLabel =
    orientation === 'horizontal'
      ? localize('com_ui_generation_tree_layout_vertical')
      : localize('com_ui_generation_tree_layout_horizontal');

  return (
    <div
      data-testid="generation-tree-toolbar"
      className="flex min-h-14 shrink-0 items-center gap-2 overflow-x-auto border-b border-border-light px-3 py-2"
    >
      <ToolbarButton
        label={localize('com_ui_generation_tree_fit')}
        icon={<Maximize2 className="size-4" aria-hidden="true" />}
        onClick={onFitTree}
      />
      <ToolbarButton
        label={localize('com_ui_generation_tree_fit_active_branch')}
        icon={<Route className="size-4" aria-hidden="true" />}
        onClick={onFitActiveBranch}
      />
      <ToolbarButton
        label={localize('com_ui_generation_tree_fit_selection')}
        icon={<Focus className="size-4" aria-hidden="true" />}
        onClick={onFitSelection}
      />
      <ToolbarButton
        label={localize('com_ui_generation_tree_expand_collapse')}
        icon={<UnfoldVertical className="size-4" aria-hidden="true" />}
        onClick={onExpandActiveBranch}
      />
      <div className="mx-1 h-6 w-px shrink-0 bg-border-light" aria-hidden="true" />
      <ToolbarButton
        data-testid="tree-orientation-toggle"
        data-orientation={orientation}
        label={orientationLabel}
        icon={
          orientation === 'horizontal' ? (
            <Rows3 className="size-4" aria-hidden="true" />
          ) : (
            <Columns3 className="size-4" aria-hidden="true" />
          )
        }
        onClick={onToggleOrientation}
      />
      <ToolbarButton
        active={arrangeMode}
        label={localize('com_ui_generation_tree_arrange')}
        icon={<Move className="size-4" aria-hidden="true" />}
        onClick={onToggleArrangeMode}
      />
      <ToolbarButton
        label={localize('com_ui_generation_tree_reset_layout')}
        icon={<RotateCcw className="size-4" aria-hidden="true" />}
        onClick={onResetLayout}
      />
    </div>
  );
}
