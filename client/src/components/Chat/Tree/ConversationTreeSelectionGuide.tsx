import { GitBranch, GitMerge, LocateFixed, Replace } from 'lucide-react';
import type {
  TGenerationGraftMode,
  TGenerationGraftPreviewResponse,
} from 'librechat-data-provider';
import useLocalize from '~/hooks/useLocalize';
import { cn } from '~/utils';
import type { GenerationGraftPendingAction, GenerationGraftPhase } from './useGenerationGraft';
import type { PositionedTreeNode } from './types';
import { getTreeNodeExcerpt, getTreeNodeLabel } from './treeLabels';

type ConversationTreeSelectionGuideProps = {
  focusedNode: PositionedTreeNode | null;
  sourceNode: PositionedTreeNode | null;
  destinationNode: PositionedTreeNode | null;
  mode: TGenerationGraftMode;
  phase: GenerationGraftPhase;
  pendingAction: GenerationGraftPendingAction | null;
  preview: TGenerationGraftPreviewResponse | null;
  canUseFocusedAsSource: boolean;
  canUseFocusedAsDestination: boolean;
  focusedSelectionError: string | null;
  onUseFocusedAsSource: () => void;
  onUseFocusedAsDestination: () => void;
  onClearSource: () => void;
  onClearDestination: () => void;
  onModeChange: (mode: TGenerationGraftMode) => void;
  onRequestPreview: () => void;
  onOpenHelp: () => void;
};

function SelectionStep({
  number,
  title,
  node,
  instruction,
  actionLabel,
  actionDisabled,
  onAction,
  onClear,
}: {
  number: number;
  title: string;
  node: PositionedTreeNode | null;
  instruction: string;
  actionLabel: string;
  actionDisabled: boolean;
  onAction: () => void;
  onClear: (() => void) | null;
}) {
  const localize = useLocalize();

  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-2 px-3 py-3">
      <div className="flex size-7 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-text-primary">
        {number}
      </div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-text-primary">{title}</h4>
            {node ? (
              <>
                <div className="mt-0.5 truncate text-xs font-medium text-text-primary">
                  {getTreeNodeLabel(localize, node)}
                </div>
                <div className="line-clamp-2 break-words text-xs text-text-secondary">
                  {getTreeNodeExcerpt(localize, node)}
                </div>
              </>
            ) : (
              <p className="mt-0.5 text-xs text-text-secondary">{instruction}</p>
            )}
          </div>
          {node && onClear ? (
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
              onClick={onClear}
            >
              {localize('com_ui_generation_tree_change')}
            </button>
          ) : null}
        </div>
        {!node ? (
          <button
            type="button"
            className="mt-2 min-h-10 w-full rounded-md border border-border-medium px-3 py-2 text-sm font-medium text-text-primary disabled:opacity-50"
            disabled={actionDisabled}
            onClick={onAction}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ScopeOption({
  checked,
  icon,
  label,
  description,
  recommended = false,
  onChange,
}: {
  checked: boolean;
  icon: React.ReactNode;
  label: string;
  description: string;
  recommended?: boolean;
  onChange: () => void;
}) {
  const localize = useLocalize();

  return (
    <label
      className={cn(
        'flex min-h-20 cursor-pointer items-start gap-3 rounded-md border px-3 py-3',
        checked ? 'border-blue-500 bg-blue-500/10' : 'border-border-medium hover:bg-surface-hover',
      )}
    >
      <input
        type="radio"
        name="generation-graft-mode"
        className="mt-1"
        checked={checked}
        onChange={onChange}
      />
      <span className="mt-0.5 shrink-0 text-text-secondary" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-text-primary">
          {label}
          {recommended ? (
            <span className="rounded-sm bg-surface-hover px-1.5 py-0.5 text-[11px] font-normal text-text-secondary">
              {localize('com_ui_generation_tree_recommended')}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-text-secondary">{description}</span>
      </span>
    </label>
  );
}

export default function ConversationTreeSelectionGuide({
  focusedNode,
  sourceNode,
  destinationNode,
  mode,
  phase,
  pendingAction,
  preview,
  canUseFocusedAsSource,
  canUseFocusedAsDestination,
  focusedSelectionError,
  onUseFocusedAsSource,
  onUseFocusedAsDestination,
  onClearSource,
  onClearDestination,
  onModeChange,
  onRequestPreview,
  onOpenHelp,
}: ConversationTreeSelectionGuideProps) {
  const localize = useLocalize();
  const hasSelection = sourceNode != null && destinationNode != null;
  const previewMatchesMode = preview?.mode === mode;
  const isPreviewBusy = phase === 'previewing' || pendingAction != null;
  const previewDisabled = !hasSelection || isPreviewBusy;

  return (
    <section
      data-testid="generation-tree-selection-guide"
      aria-labelledby="generation-tree-guide-title"
      className="overflow-hidden rounded-lg border border-border-medium"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border-light bg-surface-secondary px-3 py-3">
        <div className="flex min-w-0 items-start gap-2">
          <GitMerge className="mt-0.5 size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <div>
            <h3
              id="generation-tree-guide-title"
              className="text-sm font-semibold text-text-primary"
            >
              {localize('com_ui_generation_tree_guide_title')}
            </h3>
            <p className="text-xs text-text-secondary">
              {localize('com_ui_generation_tree_guide_description')}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs font-medium text-text-secondary underline-offset-4 hover:text-text-primary hover:underline"
          onClick={onOpenHelp}
        >
          {localize('com_ui_generation_tree_help')}
        </button>
      </div>

      <div className="border-b border-border-light px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <LocateFixed className="size-4 shrink-0 text-text-secondary" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium uppercase text-text-secondary">
              {localize('com_ui_generation_tree_focused_response')}
            </div>
            <div className="truncate text-sm text-text-primary">
              {focusedNode
                ? `${getTreeNodeLabel(localize, focusedNode)}: ${getTreeNodeExcerpt(localize, focusedNode)}`
                : localize('com_ui_generation_tree_tap_response_first')}
            </div>
          </div>
        </div>
      </div>

      <ol className="divide-y divide-border-light">
        <SelectionStep
          number={1}
          title={localize('com_ui_generation_tree_source_step')}
          node={sourceNode}
          instruction={localize('com_ui_generation_tree_source_instruction')}
          actionLabel={localize('com_ui_generation_tree_use_focused_source')}
          actionDisabled={!canUseFocusedAsSource}
          onAction={onUseFocusedAsSource}
          onClear={sourceNode ? onClearSource : null}
        />
        <SelectionStep
          number={2}
          title={localize('com_ui_generation_tree_destination_step')}
          node={destinationNode}
          instruction={localize('com_ui_generation_tree_destination_instruction')}
          actionLabel={localize('com_ui_generation_tree_use_focused_destination')}
          actionDisabled={!canUseFocusedAsDestination}
          onAction={onUseFocusedAsDestination}
          onClear={destinationNode ? onClearDestination : null}
        />
      </ol>

      {sourceNode != null && destinationNode == null && focusedSelectionError ? (
        <div className="border-t border-border-light px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {focusedSelectionError}
        </div>
      ) : null}

      <div className="border-t border-border-light px-3 py-3">
        <div className="mb-2 flex items-center gap-2">
          <Replace className="size-4 text-text-secondary" aria-hidden="true" />
          <h4 className="text-sm font-medium text-text-primary">
            {localize('com_ui_generation_tree_scope')}
          </h4>
        </div>
        <div
          role="radiogroup"
          aria-label={localize('com_ui_generation_tree_scope')}
          className="grid gap-2"
        >
          <ScopeOption
            checked={mode === 'generation'}
            icon={<Replace className="size-4" />}
            label={localize('com_ui_generation_tree_mode_generation')}
            description={localize('com_ui_generation_tree_mode_generation_desc')}
            onChange={() => onModeChange('generation')}
          />
          <ScopeOption
            checked={mode === 'subtree'}
            icon={<GitBranch className="size-4" />}
            label={localize('com_ui_generation_tree_mode_subtree')}
            description={localize('com_ui_generation_tree_mode_subtree_desc')}
            recommended
            onChange={() => onModeChange('subtree')}
          />
        </div>
      </div>

      <div className="border-t border-border-light px-3 py-3">
        <button
          type="button"
          aria-busy={isPreviewBusy}
          className="min-h-11 w-full rounded-md bg-surface-submit px-3 py-2 text-sm font-medium text-white hover:bg-surface-submit-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={previewDisabled}
          onClick={onRequestPreview}
        >
          {previewMatchesMode && phase === 'ready'
            ? localize('com_ui_generation_tree_refresh_preview')
            : localize('com_ui_generation_tree_preview_append')}
        </button>
      </div>
    </section>
  );
}
