import { useCallback, useMemo, useRef, useState, type ButtonHTMLAttributes } from 'react';
import type {
  TGenerationGraftDetailsResponse,
  TGenerationGraftMetadata,
  TGenerationGraftMode,
  TGenerationGraftStableState,
  TGenerationGraftUndoRequest,
  TMessage,
} from 'librechat-data-provider';
import {
  Button,
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogHeader,
  OGDialogTitle,
  Spinner,
} from '@librechat/client';
import { useLocalize } from '~/hooks';
import { useGenerationTree } from '~/Providers';
import {
  useGenerationGraftDetails,
  useUndoGenerationGraft,
} from '~/data-provider/Messages/generationGrafts';
import { cn } from '~/utils';

const generationGraftStateKeys: Record<TGenerationGraftStableState, string> = {
  complete: 'com_ui_generation_tree_state_complete',
  stopped_partial: 'com_ui_generation_tree_state_stopped_partial',
  aborted_partial: 'com_ui_generation_tree_state_aborted_partial',
  errored_partial: 'com_ui_generation_tree_state_errored_partial',
};

const generationGraftModeKeys: Record<TGenerationGraftMode, string> = {
  generation: 'com_ui_generation_tree_mode_generation',
  subtree: 'com_ui_generation_tree_mode_subtree',
};

const undoStateLabelKeys = {
  idle: 'com_ui_generation_graft_undo',
  fetching: 'com_ui_generation_graft_checking_undo',
  deleting: 'com_ui_generation_graft_undoing',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function getGenerationGraftMetadata(
  message?: Pick<TMessage, 'metadata'> | null,
): TGenerationGraftMetadata | null {
  if (!isRecord(message?.metadata)) {
    return null;
  }

  const generationGraft = message.metadata.generationGraft;
  if (!isRecord(generationGraft) || generationGraft.kind !== 'generation_graft') {
    return null;
  }

  return generationGraft as TGenerationGraftMetadata;
}

export function isGenerationGraftBridgeMessage(message?: Pick<TMessage, 'metadata'> | null) {
  return getGenerationGraftMetadata(message) != null;
}

const getIdSuffix = (value: string | undefined, length = 8) => {
  if (!value) {
    return '';
  }

  return value.length > length ? value.slice(-length) : value;
};

const getActionErrorMessage = (
  localize: ReturnType<typeof useLocalize>,
  error: unknown,
  fallbackKey: string,
) => {
  if (isRecord(error)) {
    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.message;
    }

    if (isRecord(error.response) && isRecord(error.response.data)) {
      if (typeof error.response.data.error === 'string' && error.response.data.error.length > 0) {
        return error.response.data.error;
      }

      if (
        typeof error.response.data.message === 'string' &&
        error.response.data.message.length > 0
      ) {
        return error.response.data.message;
      }
    }
  }

  return localize(fallbackKey);
};

const ActionButton = ({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    className={cn(
      'rounded-lg border border-violet-500/30 px-3 py-2 text-sm font-medium text-text-primary transition-colors',
      'hover:bg-violet-500/10 disabled:cursor-not-allowed disabled:opacity-60',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
      className,
    )}
    {...props}
  >
    {children}
  </button>
);

const MetadataTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-violet-500/20 bg-surface-primary px-3 py-2">
    <div className="text-xs uppercase tracking-wide text-text-secondary">{label}</div>
    <div className="mt-1 break-words font-medium text-text-primary">{value}</div>
  </div>
);

const DestructiveUndoDialog = ({
  messageId,
  open,
  undoPending,
  description,
  onOpenChange,
  onConfirm,
}: {
  messageId: string;
  open: boolean;
  undoPending: boolean;
  description: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) => {
  const localize = useLocalize();

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        className="w-11/12 max-w-md"
        aria-describedby={
          description.length > 0 ? `${messageId}-graft-dialog-description` : undefined
        }
      >
        <OGDialogHeader>
          <OGDialogTitle>{localize('com_ui_generation_graft_undo_confirm_title')}</OGDialogTitle>
        </OGDialogHeader>
        {description.length > 0 ? (
          <OGDialogDescription id={`${messageId}-graft-dialog-description`}>
            {description}
          </OGDialogDescription>
        ) : null}
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="outline" disabled={undoPending} onClick={() => onOpenChange(false)}>
            {localize('com_ui_cancel')}
          </Button>
          <Button
            variant="destructive"
            aria-busy={undoPending}
            disabled={undoPending}
            onClick={onConfirm}
          >
            {undoPending ? (
              <span className="inline-flex items-center gap-2">
                <Spinner className="size-4" />
                <span>{localize('com_ui_generation_graft_undo')}</span>
              </span>
            ) : (
              localize('com_ui_generation_graft_undo')
            )}
          </Button>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
};

function GraftBridgeCardInner({
  message,
  generationGraft,
}: {
  message: TMessage;
  generationGraft: TGenerationGraftMetadata;
}) {
  const localize = useLocalize();
  const { openTree } = useGenerationTree();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingUndoDetails, setPendingUndoDetails] =
    useState<TGenerationGraftDetailsResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const detailsFlightRef = useRef<Promise<TGenerationGraftDetailsResponse | null> | null>(null);
  const deleteFlightRef = useRef<Promise<void> | null>(null);

  const conversationId = message.conversationId ?? '';
  const messageId = message.messageId ?? '';
  const {
    data: details,
    isFetching,
    refetch,
  } = useGenerationGraftDetails(conversationId, generationGraft.graftId, false);
  const undoGenerationGraft = useUndoGenerationGraft(conversationId, generationGraft.graftId);
  const undoPending = undoGenerationGraft.isPending || undoGenerationGraft.isLoading;
  const actionPending = isFetching || undoPending;
  const copiedCount = details?.copiedMessageIds.length ?? generationGraft.copiedMessageIds.length;
  const sourceIdSuffix = getIdSuffix(generationGraft.sourceRootMessageId);
  const regionTitleId = `${messageId}-graft-bridge-title`;
  const regionSummaryId = `${messageId}-graft-bridge-summary`;

  const sourceStateLabel = localize(generationGraftStateKeys[generationGraft.sourceState]);
  const destinationStateLabel = localize(
    generationGraftStateKeys[generationGraft.destinationState],
  );
  const modeLabel = localize(generationGraftModeKeys[generationGraft.mode]);
  let undoState: keyof typeof undoStateLabelKeys = 'idle';
  if (isFetching) {
    undoState = 'fetching';
  } else if (undoPending) {
    undoState = 'deleting';
  }
  const undoLabel = localize(undoStateLabelKeys[undoState]);

  const dialogDescription = useMemo(() => {
    if (pendingUndoDetails == null) {
      return '';
    }

    return localize('com_ui_generation_graft_undo_confirm_description', {
      copiedCount: pendingUndoDetails.copiedMessageIds.length,
      continuationCount: pendingUndoDetails.continuationMessageIds.length,
    });
  }, [localize, pendingUndoDetails]);

  const closeConfirmDialog = useCallback(() => {
    setConfirmOpen(false);
    setPendingUndoDetails(null);
  }, []);

  const performUndoLocked = useCallback(
    async (payload: TGenerationGraftUndoRequest) => {
      if (deleteFlightRef.current != null) {
        return deleteFlightRef.current;
      }

      const deletePromise = (async () => {
        try {
          setActionError(null);
          await undoGenerationGraft.mutateAsync(payload);
          closeConfirmDialog();
        } catch (error) {
          setActionError(
            getActionErrorMessage(localize, error, 'com_ui_generation_graft_details_error'),
          );
        }
      })().finally(() => {
        deleteFlightRef.current = null;
      });

      deleteFlightRef.current = deletePromise;
      return deletePromise;
    },
    [closeConfirmDialog, localize, undoGenerationGraft],
  );

  const fetchExactDetailsLocked = useCallback(async () => {
    if (detailsFlightRef.current != null) {
      return detailsFlightRef.current;
    }

    const detailsPromise = (async () => {
      const result = await refetch();
      const exactDetails = result.data ?? null;

      if (exactDetails == null) {
        setActionError(
          getActionErrorMessage(localize, result.error, 'com_ui_generation_graft_details_error'),
        );
      }

      return exactDetails;
    })().finally(() => {
      detailsFlightRef.current = null;
    });

    detailsFlightRef.current = detailsPromise;
    return detailsPromise;
  }, [localize, refetch]);

  const handleUndo = useCallback(async () => {
    if (
      !conversationId ||
      !generationGraft.graftId ||
      detailsFlightRef.current != null ||
      deleteFlightRef.current != null
    ) {
      return;
    }

    try {
      setActionError(null);
      const exactDetails = await fetchExactDetailsLocked();

      if (exactDetails == null) {
        return;
      }

      if (exactDetails.canUndoWithoutContinuations) {
        await performUndoLocked({});
        return;
      }

      setPendingUndoDetails(exactDetails);
      setConfirmOpen(true);
    } catch (error) {
      setActionError(
        getActionErrorMessage(localize, error, 'com_ui_generation_graft_details_error'),
      );
    }
  }, [
    conversationId,
    fetchExactDetailsLocked,
    generationGraft.graftId,
    localize,
    performUndoLocked,
  ]);

  return (
    <>
      <section
        aria-labelledby={regionTitleId}
        aria-describedby={regionSummaryId}
        className="text-message flex min-h-[20px] flex-col gap-3 overflow-visible"
      >
        <div className="rounded-2xl border border-dashed border-violet-500/40 bg-violet-500/5 px-4 py-3 text-sm text-text-secondary">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h3 id={regionTitleId} className="font-medium text-text-primary">
                {localize('com_ui_generation_graft_card_title')}
              </h3>
              <p id={regionSummaryId} className="mt-1 break-words">
                {localize('com_ui_generation_graft_summary', {
                  sourceId: sourceIdSuffix,
                })}
              </p>
            </div>
            <div className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-700 dark:text-violet-300">
              {localize('com_ui_generation_graft_copied_messages', {
                count: copiedCount,
              })}
            </div>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetadataTile
              label={localize('com_ui_generation_tree_source')}
              value={localize('com_ui_generation_graft_source_id', {
                sourceId: sourceIdSuffix,
              })}
            />
            <MetadataTile
              label={localize('com_ui_generation_tree_source')}
              value={sourceStateLabel}
            />
            <MetadataTile
              label={localize('com_ui_generation_tree_destination')}
              value={destinationStateLabel}
            />
            <MetadataTile label={localize('com_ui_generation_tree_mode')} value={modeLabel} />
          </div>

          {actionError ? (
            <div
              role="alert"
              className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-text-primary"
            >
              {actionError}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <ActionButton
              aria-label={localize('com_ui_generation_graft_view_tree')}
              disabled={!messageId || undoPending}
              onClick={() => messageId && openTree({ focusMessageId: messageId })}
            >
              {localize('com_ui_generation_graft_view_tree')}
            </ActionButton>
            <ActionButton
              aria-busy={actionPending}
              aria-label={undoLabel}
              disabled={!conversationId || actionPending}
              onClick={() => void handleUndo()}
            >
              {actionPending ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner className="size-4" />
                  <span>{undoLabel}</span>
                </span>
              ) : (
                undoLabel
              )}
            </ActionButton>
          </div>
        </div>
      </section>

      <DestructiveUndoDialog
        messageId={messageId}
        open={confirmOpen}
        undoPending={undoPending}
        description={dialogDescription}
        onOpenChange={(open) => {
          if (open) {
            return;
          }

          closeConfirmDialog();
        }}
        onConfirm={() => void performUndoLocked({ includeContinuations: true })}
      />
    </>
  );
}

export default function GraftBridgeCard({ message }: { message: TMessage }) {
  const generationGraft = getGenerationGraftMetadata(message);

  if (generationGraft == null) {
    return null;
  }

  return <GraftBridgeCardInner message={message} generationGraft={generationGraft} />;
}
