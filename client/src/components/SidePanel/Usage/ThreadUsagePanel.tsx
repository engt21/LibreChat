import { useMemo } from 'react';
import { Constants } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';
import { Spinner } from '@librechat/client';
import { useGetConversationUsage } from '~/data-provider';
import { useChatContext } from '~/Providers';
import { useLocalize } from '~/hooks';

const formatter = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function formatCount(value: number) {
  return formatter.format(Math.max(value, 0));
}

function formatUsd(value: number | null) {
  if (value == null) {
    return '—';
  }

  let maximumFractionDigits = 2;
  if (value > 0 && value < 0.01) {
    maximumFractionDigits = 6;
  } else if (value < 1) {
    maximumFractionDigits = 4;
  }
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits,
  }).format(Math.max(value, 0));
}

function formatRecordedCost(value: number | null, complete: boolean) {
  const formatted = formatUsd(value);
  return !complete && value != null ? `≥${formatted}` : formatted;
}

function flattenMessages(messages: TMessage[]): TMessage[] {
  const result: TMessage[] = [];
  const visit = (message: TMessage) => {
    result.push(message);
    for (const child of message.children ?? []) {
      visit(child);
    }
  };
  messages.forEach(visit);
  return result;
}

export function getVisibleBranchMessageIds(
  messages: TMessage[],
  latestMessageId?: string | null,
): string[] {
  const flatMessages = flattenMessages(messages);
  if (!latestMessageId) {
    return flatMessages.map((message) => message.messageId).filter((id): id is string => !!id);
  }

  const byId = new Map(
    flatMessages
      .filter((message): message is TMessage & { messageId: string } => !!message.messageId)
      .map((message) => [message.messageId, message]),
  );
  const branchIds: string[] = [];
  const visited = new Set<string>();
  let current = byId.get(latestMessageId);
  while (current?.messageId && !visited.has(current.messageId)) {
    visited.add(current.messageId);
    branchIds.push(current.messageId);
    current = current.parentMessageId ? byId.get(current.parentMessageId) : undefined;
  }

  return branchIds.reverse();
}

function UsageMetric({ label, value, status }: { label: string; value: string; status?: string }) {
  return (
    <div className="rounded-md border border-border-light bg-surface-secondary px-3 py-2">
      <div className="text-xs text-text-secondary">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums text-text-primary">{value}</div>
      {status && <div className="mt-1 text-[10px] text-text-secondary">{status}</div>}
    </div>
  );
}

export default function ThreadUsagePanel() {
  const localize = useLocalize();
  const { conversation, getMessages, isSubmitting, latestMessageId } = useChatContext();
  const conversationId = conversation?.conversationId ?? '';
  const messageIds = useMemo(
    () => getVisibleBranchMessageIds(getMessages() ?? [], latestMessageId),
    [getMessages, latestMessageId],
  );
  const enabled =
    conversationId.length > 0 &&
    conversationId !== Constants.NEW_CONVO &&
    conversationId !== Constants.PENDING_CONVO &&
    messageIds.length > 0;
  const { data, isLoading, isFetching, error } = useGetConversationUsage(
    conversationId,
    messageIds,
    enabled,
    isSubmitting ? 2500 : 10000,
  );

  if (!enabled) {
    return (
      <div className="px-3 py-6 text-sm text-text-secondary">
        {localize('com_sidepanel_thread_usage_empty')}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-6 text-sm text-text-secondary" role="status">
        <Spinner className="h-4 w-4" />
        {localize('com_sidepanel_thread_usage_loading')}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-3 py-6 text-sm text-red-500" role="alert">
        {localize('com_sidepanel_thread_usage_error')}
      </div>
    );
  }

  return (
    <section className="space-y-4 px-3 pb-4" aria-label={localize('com_sidepanel_thread_usage')}>
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-text-secondary">{localize('com_sidepanel_thread_usage_hint')}</p>
        {isFetching && <Spinner className="h-3.5 w-3.5" />}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <UsageMetric
          label={localize('com_sidepanel_usage_input')}
          value={formatCount(data.totals.inputTokens)}
        />
        <UsageMetric
          label={localize('com_sidepanel_usage_output')}
          value={formatCount(data.totals.outputTokens)}
        />
        <UsageMetric
          label={localize('com_sidepanel_usage_cache_read')}
          value={formatCount(data.totals.cacheReadTokens)}
        />
        <UsageMetric
          label={localize('com_sidepanel_usage_cache_write')}
          value={formatCount(data.totals.cacheWriteTokens)}
        />
        <UsageMetric
          label={localize('com_sidepanel_usage_tool_calls')}
          value={formatCount(data.totals.toolCalls)}
        />
        <UsageMetric
          label={localize('com_sidepanel_usage_cost')}
          value={formatRecordedCost(data.totals.costUsd, data.totals.costComplete)}
          status={
            data.totals.costComplete
              ? undefined
              : localize(
                  data.totals.costUsd == null
                    ? 'com_sidepanel_usage_cost_unavailable'
                    : 'com_sidepanel_usage_cost_partial',
                )
          }
        />
        <UsageMetric
          label={localize('com_sidepanel_usage_turns')}
          value={formatCount(data.turns.length)}
        />
      </div>

      <p className="text-[11px] text-text-secondary">{localize('com_sidepanel_usage_cost_hint')}</p>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-text-primary">
          {localize('com_sidepanel_usage_by_turn')}
        </h3>
        {data.turns.map((turn, index) => (
          <details
            key={turn.messageId}
            className="rounded-md border border-border-light bg-background px-3 py-2"
          >
            <summary className="cursor-pointer list-none text-sm text-text-primary">
              <span className="font-medium">
                {localize('com_sidepanel_usage_turn')} {index + 1}
              </span>
              <span className="ml-2 text-xs text-text-secondary">
                {turn.model || turn.endpoint || localize('com_ui_unknown')}
              </span>
              {turn.estimated && (
                <span className="ml-2 rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
                  {localize('com_sidepanel_usage_estimated')}
                </span>
              )}
            </summary>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <dt className="text-text-secondary">{localize('com_sidepanel_usage_input')}</dt>
              <dd className="text-right tabular-nums">{formatCount(turn.inputTokens)}</dd>
              <dt className="text-text-secondary">{localize('com_sidepanel_usage_output')}</dt>
              <dd className="text-right tabular-nums">{formatCount(turn.outputTokens)}</dd>
              <dt className="text-text-secondary">{localize('com_sidepanel_usage_cache_read')}</dt>
              <dd className="text-right tabular-nums">{formatCount(turn.cacheReadTokens)}</dd>
              <dt className="text-text-secondary">{localize('com_sidepanel_usage_cache_write')}</dt>
              <dd className="text-right tabular-nums">{formatCount(turn.cacheWriteTokens)}</dd>
              <dt className="text-text-secondary">{localize('com_sidepanel_usage_tool_calls')}</dt>
              <dd className="text-right tabular-nums">{formatCount(turn.toolCalls)}</dd>
              <dt className="text-text-secondary">{localize('com_sidepanel_usage_cost')}</dt>
              <dd className="text-right tabular-nums">
                {formatRecordedCost(turn.costUsd, turn.costComplete)}
              </dd>
            </dl>
          </details>
        ))}
      </div>
    </section>
  );
}
