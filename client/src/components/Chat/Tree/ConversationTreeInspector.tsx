import React from 'react';
import type {
  TGenerationGraftCreateResponse,
  TGenerationGraftDetailsResponse,
  TGenerationGraftMode,
  TGenerationGraftPreviewResponse,
} from 'librechat-data-provider';
import useLocalize from '~/hooks/useLocalize';
import type {
  ParsedGenerationGraftError,
  GenerationGraftPendingAction,
  GenerationGraftPhase,
  GenerationGraftStabilizationState,
} from './useGenerationGraft';
import type { PositionedTreeNode } from './types';

type ConversationTreeInspectorProps = {
  sourceNode: PositionedTreeNode | null;
  destinationNode: PositionedTreeNode | null;
  statusText: string;
  listOpen: boolean;
  onToggleList: () => void;
  listContent: React.ReactNode;
  phase: GenerationGraftPhase;
  pendingAction: GenerationGraftPendingAction | null;
  mode: TGenerationGraftMode;
  preview: TGenerationGraftPreviewResponse | null;
  created: TGenerationGraftCreateResponse | null;
  undoDetails: TGenerationGraftDetailsResponse | null;
  error: ParsedGenerationGraftError | null;
  stabilization: GenerationGraftStabilizationState | null;
  onModeChange: (mode: TGenerationGraftMode) => void;
  onCreate: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
  onConfirmUndoContinuations: () => void | Promise<void>;
  onStopAndGraft: () => void | Promise<void>;
  onWaitForCompletion: () => void | Promise<void>;
  onCancelStabilization: () => void;
};

function getNodeTitle(localize: ReturnType<typeof useLocalize>, node: PositionedTreeNode | null) {
  return node?.message.text?.toString() ?? localize('com_ui_none');
}

function getLifecycleLabel(localize: ReturnType<typeof useLocalize>, lifecycle?: string | null) {
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
      return null;
  }
}

function SummaryCard({
  label,
  title,
  lifecycle,
}: {
  label: string;
  title: string;
  lifecycle: string | null;
}) {
  return (
    <div className="rounded-2xl border border-border-medium bg-surface-secondary p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium text-text-primary">{title}</div>
      {lifecycle ? (
        <div className="mt-2 inline-flex rounded-full border border-border-light px-2 py-1 text-xs text-text-secondary">
          {lifecycle}
        </div>
      ) : null}
    </div>
  );
}

function CountCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border-medium bg-surface-secondary px-3 py-2">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="text-sm font-medium text-text-primary">{value}</div>
    </div>
  );
}

function normalizeWarningText(warning: string) {
  return warning.trim().toLowerCase();
}

function formatMessageIdSuffix(messageId: string) {
  const trimmedMessageId = messageId.trim();
  if (trimmedMessageId.length <= 8) {
    return trimmedMessageId;
  }

  return `...${trimmedMessageId.slice(-8)}`;
}

function CountSection({
  title,
  counts,
  localize,
}: {
  title: string;
  counts: TGenerationGraftDetailsResponse['copiedCounts'];
  localize: ReturnType<typeof useLocalize>;
}) {
  return (
    <div className="grid gap-2 rounded-2xl border border-border-medium bg-surface-secondary p-3">
      <div className="text-sm font-medium text-text-primary">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <CountCard
          label={localize('com_ui_generation_tree_counts_messages')}
          value={counts.messages}
        />
        <CountCard
          label={localize('com_ui_generation_tree_counts_tool_calls')}
          value={counts.toolCalls}
        />
        <CountCard label={localize('com_ui_generation_tree_counts_files')} value={counts.files} />
        <CountCard label={localize('com_ui_generation_tree_counts_images')} value={counts.images} />
        <CountCard
          label={localize('com_ui_generation_tree_counts_tokens')}
          value={counts.approximateTokens}
        />
      </div>
    </div>
  );
}

export default function ConversationTreeInspector({
  sourceNode,
  destinationNode,
  statusText,
  listOpen,
  onToggleList,
  listContent,
  phase,
  pendingAction,
  mode,
  preview,
  created,
  undoDetails,
  error,
  stabilization,
  onModeChange,
  onCreate,
  onUndo,
  onConfirmUndoContinuations,
  onStopAndGraft,
  onWaitForCompletion,
  onCancelStabilization,
}: ConversationTreeInspectorProps) {
  const localize = useLocalize();
  const sourceLifecycle =
    getLifecycleLabel(localize, preview?.sourceState ?? sourceNode?.lifecycle ?? null) ?? null;
  const destinationLifecycle =
    getLifecycleLabel(localize, preview?.destinationState ?? destinationNode?.lifecycle ?? null) ??
    null;
  const counts = preview?.counts ?? null;
  const hasPartialSelection =
    preview?.sourceState != null &&
    (preview.sourceState !== 'complete' || preview.destinationState !== 'complete');
  const warningMessages = (() => {
    const nextWarnings: string[] = [];
    const seenWarnings = new Set<string>();
    const appendWarning = (warning: string | null | undefined) => {
      if (typeof warning !== 'string') {
        return;
      }

      const trimmedWarning = warning.trim();
      if (trimmedWarning.length === 0) {
        return;
      }

      const normalizedWarning = normalizeWarningText(trimmedWarning);
      if (seenWarnings.has(normalizedWarning)) {
        return;
      }

      seenWarnings.add(normalizedWarning);
      nextWarnings.push(trimmedWarning);
    };

    for (const warning of preview?.warnings ?? []) {
      appendWarning(warning);
    }

    if (hasPartialSelection) {
      appendWarning(localize('com_ui_generation_tree_partial_warning'));
    }

    return nextWarnings;
  })();
  const actionPending = pendingAction != null;
  const createDisabled = phase !== 'ready' || preview?.canCreate !== true || actionPending;
  const isBusy =
    phase === 'previewing' ||
    phase === 'creating' ||
    phase === 'stabilization' ||
    phase === 'undoing' ||
    actionPending;
  const continuationScope = (() => {
    const continuationIds = undoDetails?.continuationMessageIds ?? [];
    const visibleIds = continuationIds
      .filter(
        (messageId): messageId is string =>
          typeof messageId === 'string' && messageId.trim().length > 0,
      )
      .slice(0, 5)
      .map((messageId) => formatMessageIdSuffix(messageId));
    const hiddenCount = Math.max(continuationIds.length - visibleIds.length, 0);

    return {
      visibleIds,
      hiddenCount,
    };
  })();

  return (
    <div
      data-testid="generation-tree-inspector"
      aria-busy={isBusy}
      className="flex h-full min-h-0 flex-col gap-3 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">
            {localize('com_sidepanel_conversation_tree')}
          </h3>
          <p className="text-xs text-text-secondary">{statusText}</p>
        </div>
        <button
          type="button"
          className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-secondary"
          onClick={onToggleList}
        >
          {localize('com_ui_generation_tree_list')}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SummaryCard
          label={localize('com_ui_generation_tree_source')}
          title={getNodeTitle(localize, sourceNode)}
          lifecycle={sourceLifecycle}
        />
        <SummaryCard
          label={localize('com_ui_generation_tree_destination')}
          title={getNodeTitle(localize, destinationNode)}
          lifecycle={destinationLifecycle}
        />
      </div>

      <div
        role="radiogroup"
        aria-label={localize('com_ui_generation_tree_before_after')}
        className="grid gap-2 sm:grid-cols-2"
      >
        <label className="flex items-center gap-2 rounded-xl border border-border-medium px-3 py-2 text-sm">
          <input
            type="radio"
            name="generation-graft-mode"
            checked={mode === 'generation'}
            onChange={() => onModeChange('generation')}
          />
          {localize('com_ui_generation_tree_mode_generation')}
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-border-medium px-3 py-2 text-sm">
          <input
            type="radio"
            name="generation-graft-mode"
            checked={mode === 'subtree'}
            onChange={() => onModeChange('subtree')}
          />
          {localize('com_ui_generation_tree_mode_subtree')}
        </label>
      </div>

      {counts ? (
        <div className="grid grid-cols-2 gap-2">
          <CountCard
            label={localize('com_ui_generation_tree_counts_messages')}
            value={counts.messages}
          />
          <CountCard
            label={localize('com_ui_generation_tree_counts_tool_calls')}
            value={counts.toolCalls}
          />
          <CountCard label={localize('com_ui_generation_tree_counts_files')} value={counts.files} />
          <CountCard
            label={localize('com_ui_generation_tree_counts_images')}
            value={counts.images}
          />
          <CountCard
            label={localize('com_ui_generation_tree_counts_tokens')}
            value={counts.approximateTokens}
          />
        </div>
      ) : null}

      {warningMessages.length > 0 ? (
        <div className="grid gap-2">
          {warningMessages.map((warning) => (
            <div
              key={warning}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-text-primary"
            >
              {warning}
            </div>
          ))}
        </div>
      ) : null}

      {preview ? (
        <div className="rounded-2xl border border-dashed border-border-medium bg-surface-secondary px-3 py-3 text-sm text-text-secondary">
          <div className="font-medium text-text-primary">
            {localize('com_ui_generation_tree_before_after')}
          </div>
          <div className="mt-1">
            {getNodeTitle(localize, sourceNode)} → {getNodeTitle(localize, destinationNode)}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border-medium bg-surface-secondary px-3 py-3 text-sm text-text-secondary">
          {phase === 'previewing'
            ? localize('com_ui_generation_tree_status_preview')
            : localize('com_ui_generation_tree_preview_pending')}
        </div>
      )}

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-text-primary"
        >
          {error.error}
        </div>
      ) : null}

      {created && undoDetails ? (
        <div className="grid gap-3 rounded-2xl border border-border-medium bg-surface-primary p-3">
          <div>
            <div className="text-sm font-medium text-text-primary">
              {localize('com_ui_generation_tree_undo_scope_title')}
            </div>
            <div className="text-xs text-text-secondary">
              {localize('com_ui_generation_tree_undo_scope_description')}
            </div>
          </div>
          <div className="rounded-xl border border-border-medium bg-surface-secondary px-3 py-2 text-sm text-text-primary">
            <div className="text-xs uppercase tracking-wide text-text-secondary">
              {localize('com_ui_generation_tree_undo_target')}
            </div>
            <div className="mt-1 break-all font-medium">{undoDetails.graftId}</div>
          </div>
          <CountSection
            title={localize('com_ui_generation_tree_copied_counts')}
            counts={undoDetails.copiedCounts}
            localize={localize}
          />
          <CountSection
            title={localize('com_ui_generation_tree_continuation_counts')}
            counts={undoDetails.continuationCounts}
            localize={localize}
          />
          {continuationScope.visibleIds.length > 0 ? (
            <div className="rounded-xl border border-border-medium bg-surface-secondary px-3 py-2 text-sm text-text-primary">
              <div className="text-xs uppercase tracking-wide text-text-secondary">
                {localize('com_ui_generation_tree_continuation_scope')}
              </div>
              <div className="mt-1 break-words">
                {continuationScope.visibleIds.join(', ')}
                {continuationScope.hiddenCount > 0
                  ? ` ${localize('com_ui_generation_tree_continuation_scope_more', {
                      count: continuationScope.hiddenCount,
                    })}`
                  : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {stabilization ? (
        <div className="grid gap-2 rounded-2xl border border-border-medium bg-surface-secondary p-3">
          <button
            type="button"
            className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-primary"
            aria-busy={pendingAction === 'stop'}
            disabled={actionPending}
            onClick={onStopAndGraft}
          >
            {localize('com_ui_generation_tree_stop_and_graft')}
          </button>
          <button
            type="button"
            className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-primary"
            aria-busy={pendingAction === 'wait'}
            disabled={actionPending}
            onClick={onWaitForCompletion}
          >
            {localize('com_ui_generation_tree_wait_to_finish')}
          </button>
          <button
            type="button"
            className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-secondary"
            onClick={onCancelStabilization}
          >
            {localize('com_ui_cancel')}
          </button>
        </div>
      ) : null}

      <div className="grid gap-2">
        <button
          type="button"
          aria-busy={pendingAction === 'create'}
          className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-primary disabled:opacity-50"
          disabled={createDisabled}
          onClick={() => void onCreate()}
        >
          {localize('com_ui_generation_tree_create')}
        </button>
        {created ? (
          <button
            type="button"
            aria-busy={pendingAction === 'undo-safe'}
            className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-primary disabled:opacity-50"
            disabled={actionPending}
            onClick={() => void onUndo()}
          >
            {localize('com_ui_generation_tree_undo')}
          </button>
        ) : null}
        {created && undoDetails ? (
          <button
            type="button"
            aria-busy={pendingAction === 'undo-destructive'}
            className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-primary disabled:opacity-50"
            disabled={actionPending}
            onClick={() => void onConfirmUndoContinuations()}
          >
            {localize('com_ui_generation_tree_undo_destructive')}
          </button>
        ) : null}
      </div>

      {listOpen ? <div className="min-h-0 flex-1 overflow-auto">{listContent}</div> : null}
    </div>
  );
}
