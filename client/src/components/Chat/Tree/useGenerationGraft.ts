import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToastContext } from '@librechat/client';
import { QueryKeys, dataService } from 'librechat-data-provider';
import type {
  TGenerationGraftCreateResponse,
  TGenerationGraftDetailsResponse,
  TGenerationGraftErrorCode,
  TGenerationGraftErrorResponse,
  TGenerationGraftMode,
  TGenerationGraftPreviewResponse,
  TMessage,
} from 'librechat-data-provider';
import { v4 } from 'uuid';
import { useChatContext } from '~/Providers/ChatContext';
import useLocalize from '~/hooks/useLocalize';
import {
  generationGraftDetailsQueryKey,
  useCreateGenerationGraft,
  usePreviewGenerationGraft,
} from '~/data-provider/Messages/generationGrafts';
import { fetchStreamStatus } from '~/data-provider/SSE/queries';
import { getInvalidGraftReason } from './graph';
import type { ConversationTreeGraph } from './types';

const STABILIZATION_POLL_INTERVAL_MS = 500;
const STABILIZATION_TIMEOUT_MS = 30_000;

export type GenerationGraftPhase =
  | 'idle'
  | 'selecting'
  | 'previewing'
  | 'stabilization'
  | 'ready'
  | 'creating'
  | 'created'
  | 'undo-preview'
  | 'undoing'
  | 'error';

export type GenerationGraftPendingAction =
  | 'stop'
  | 'wait'
  | 'create'
  | 'undo-safe'
  | 'undo-destructive';

export type ParsedGenerationGraftError = TGenerationGraftErrorResponse & {
  error: string;
  code?: TGenerationGraftErrorCode;
};

export type GenerationGraftStabilizationState = {
  activeMessageIds: string[];
  conversationActiveWithoutMessageId: boolean;
};

type SelectionState = {
  sourceMessageId: string | null;
  destinationMessageId: string | null;
  mode: TGenerationGraftMode;
};

type SelectionSnapshot = SelectionState & {
  activeSourceLeafMessageId: string | null;
};

type UseGenerationGraftOptions = {
  conversationId: string;
  graph: ConversationTreeGraph;
  initialSourceMessageId: string | null;
  treeRevision: string;
  activeLeafMessageId: string | null;
  sessionKey?: string;
  onFocusMessage?: (messageId: string) => void;
  onFitSelection?: () => void;
  onFitCreated?: (messageIds: string[]) => void;
};

type ValidationResult =
  | { kind: 'valid' }
  | { kind: 'error'; error: ParsedGenerationGraftError }
  | { kind: 'stabilization'; stabilization: GenerationGraftStabilizationState };

const STABILIZATION_CODES = new Set<TGenerationGraftErrorCode>([
  'GRAFT_BUSY',
  'GRAFT_REQUIRES_STABILIZATION',
]);

const getBasePhase = ({
  sourceMessageId,
  destinationMessageId,
}: SelectionState): GenerationGraftPhase => {
  if (sourceMessageId == null) {
    return 'idle';
  }

  if (destinationMessageId == null) {
    return 'selecting';
  }

  return 'selecting';
};

const sameSelectionState = (left: SelectionState, right: SelectionState) =>
  left.sourceMessageId === right.sourceMessageId &&
  left.destinationMessageId === right.destinationMessageId &&
  left.mode === right.mode;

function findActiveSourceLeafMessageId(
  graph: ConversationTreeGraph,
  sourceMessageId: string | null,
  activeLeafMessageId: string | null,
): string | null {
  if (sourceMessageId == null || activeLeafMessageId == null) {
    return null;
  }

  let currentMessageId: string | null = activeLeafMessageId;
  while (currentMessageId != null) {
    if (currentMessageId === sourceMessageId) {
      return activeLeafMessageId;
    }

    currentMessageId = graph.parentById.get(currentMessageId) ?? null;
  }

  return null;
}

function createLocalValidationError(
  localize: ReturnType<typeof useLocalize>,
  code: TGenerationGraftErrorCode,
): ParsedGenerationGraftError {
  switch (code) {
    case 'INVALID_SOURCE':
      return { error: localize('com_ui_generation_tree_error_source'), code };
    case 'INVALID_DESTINATION':
      return { error: localize('com_ui_generation_tree_error_destination'), code };
    case 'OVERLAPPING_BRANCHES':
      return { error: localize('com_ui_generation_tree_error_overlap'), code };
    case 'GRAFT_BUSY':
    case 'GRAFT_REQUIRES_STABILIZATION':
      return { error: localize('com_ui_generation_tree_error_busy'), code };
    case 'TREE_CHANGED':
      return { error: localize('com_ui_generation_tree_error_stale'), code };
    default:
      return { error: localize('com_ui_generation_tree_error_invalid'), code };
  }
}

function createTimeoutError(localize: ReturnType<typeof useLocalize>): ParsedGenerationGraftError {
  return {
    error: localize('com_ui_generation_tree_error_timeout'),
    code: 'GRAFT_REQUIRES_STABILIZATION',
  };
}

function createUndoDetailsError(
  localize: ReturnType<typeof useLocalize>,
): ParsedGenerationGraftError {
  return {
    error: localize('com_ui_generation_tree_error_undo_details'),
    code: 'GRAFT_HAS_CONTINUATIONS',
  };
}

function parseGenerationGraftError(
  error: unknown,
  localize: ReturnType<typeof useLocalize>,
): ParsedGenerationGraftError {
  const responseData =
    error != null &&
    typeof error === 'object' &&
    'response' in error &&
    error.response != null &&
    typeof error.response === 'object' &&
    'data' in error.response &&
    error.response.data != null &&
    typeof error.response.data === 'object'
      ? (error.response.data as Partial<TGenerationGraftErrorResponse>)
      : null;

  const code =
    responseData?.code ??
    (error != null && typeof error === 'object' && 'code' in error
      ? (error.code as TGenerationGraftErrorCode | undefined)
      : undefined);

  return {
    error:
      responseData?.error ??
      responseData?.message ??
      (error instanceof Error ? error.message : undefined) ??
      createLocalValidationError(localize, code ?? 'GRAFT_INVALID_REQUEST').error,
    code,
    activeMessageIds: Array.isArray(responseData?.activeMessageIds)
      ? responseData.activeMessageIds.filter((value): value is string => typeof value === 'string')
      : undefined,
    continuationMessageIds: Array.isArray(responseData?.continuationMessageIds)
      ? responseData.continuationMessageIds.filter(
          (value): value is string => typeof value === 'string',
        )
      : undefined,
    conversationActiveWithoutMessageId: responseData?.conversationActiveWithoutMessageId === true,
  };
}

function getLocalStabilizationState(
  graph: ConversationTreeGraph,
  snapshot: SelectionSnapshot,
): GenerationGraftStabilizationState {
  const activeMessageIds: string[] = [];
  const candidates = [
    snapshot.sourceMessageId,
    snapshot.destinationMessageId,
    snapshot.activeSourceLeafMessageId,
  ];

  for (const candidate of candidates) {
    if (candidate == null || activeMessageIds.includes(candidate)) {
      continue;
    }

    if (graph.activeMessageIds.has(candidate)) {
      activeMessageIds.push(candidate);
    }
  }

  return {
    activeMessageIds,
    conversationActiveWithoutMessageId: false,
  };
}

function getCreatedFitMessageIds(createdResponse: TGenerationGraftCreateResponse): string[] {
  const seenMessageIds = new Set<string>();
  const fitMessageIds: string[] = [];

  for (const messageId of [
    createdResponse.bridgeMessageId,
    createdResponse.copiedRootMessageId,
    ...createdResponse.createdMessages.map((message) => message.messageId),
    createdResponse.activeCopiedMessageId,
  ]) {
    if (typeof messageId !== 'string' || messageId.length === 0 || seenMessageIds.has(messageId)) {
      continue;
    }

    seenMessageIds.add(messageId);
    fitMessageIds.push(messageId);
  }

  return fitMessageIds;
}

export default function useGenerationGraft({
  conversationId,
  graph,
  initialSourceMessageId,
  treeRevision,
  activeLeafMessageId,
  sessionKey,
  onFocusMessage,
  onFitSelection,
  onFitCreated,
}: UseGenerationGraftOptions) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { showToast } = useToastContext();
  const { stopGenerating, setLatestMessage } = useChatContext();
  const previewMutation = usePreviewGenerationGraft(conversationId);
  const createMutation = useCreateGenerationGraft(conversationId);
  const sessionIdentity = sessionKey ?? `${conversationId}::${initialSourceMessageId ?? ''}`;
  const [selection, setSelection] = useState<SelectionState>({
    sourceMessageId: initialSourceMessageId,
    destinationMessageId: null,
    mode: 'generation',
  });
  const [phase, setPhase] = useState<GenerationGraftPhase>(
    getBasePhase({
      sourceMessageId: initialSourceMessageId,
      destinationMessageId: null,
      mode: 'generation',
    }),
  );
  const [preview, setPreview] = useState<TGenerationGraftPreviewResponse | null>(null);
  const [previewRevision, setPreviewRevision] = useState<string | null>(null);
  const [created, setCreated] = useState<TGenerationGraftCreateResponse | null>(null);
  const [undoDetails, setUndoDetails] = useState<TGenerationGraftDetailsResponse | null>(null);
  const [error, setError] = useState<ParsedGenerationGraftError | null>(null);
  const [stabilization, setStabilization] = useState<GenerationGraftStabilizationState | null>(
    null,
  );
  const [pendingAction, setPendingAction] = useState<GenerationGraftPendingAction | null>(null);
  const [queuedStabilizationRetry, setQueuedStabilizationRetry] = useState<{
    operationToken: number;
    sessionIdentity: string;
    selection: SelectionState;
  } | null>(null);
  const activeSourceLeafMessageId = useMemo(
    () => findActiveSourceLeafMessageId(graph, selection.sourceMessageId, activeLeafMessageId),
    [activeLeafMessageId, graph, selection.sourceMessageId],
  );
  const graphRef = useRef(graph);
  const activeLeafMessageIdRef = useRef(activeLeafMessageId);
  const treeRevisionRef = useRef(treeRevision);
  const sessionIdentityRef = useRef(sessionIdentity);
  const selectionRef = useRef<SelectionSnapshot>({
    ...selection,
    activeSourceLeafMessageId,
  });
  const createdRef = useRef<TGenerationGraftCreateResponse | null>(null);
  const undoDetailsRef = useRef<TGenerationGraftDetailsResponse | null>(null);
  const stabilizationRef = useRef<GenerationGraftStabilizationState | null>(stabilization);
  const operationTokenRef = useRef(0);
  const isMountedRef = useRef(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingActionRef = useRef<GenerationGraftPendingAction | null>(null);
  const idempotencyStateRef = useRef<{ tupleKey: string | null; key: string | null }>({
    tupleKey: null,
    key: null,
  });
  const previousTreeSignalRef = useRef({
    treeRevision,
    activeSourceLeafMessageId,
  });
  const currentGraftId = created?.graftId ?? undoDetails?.graftId ?? '';

  graphRef.current = graph;
  activeLeafMessageIdRef.current = activeLeafMessageId;
  treeRevisionRef.current = treeRevision;
  sessionIdentityRef.current = sessionIdentity;
  selectionRef.current = {
    ...selection,
    activeSourceLeafMessageId,
  };
  createdRef.current = created;
  undoDetailsRef.current = undoDetails;
  stabilizationRef.current = stabilization;

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const bumpOperationToken = useCallback(() => {
    operationTokenRef.current += 1;
    return operationTokenRef.current;
  }, []);

  const clearPendingAction = useCallback(() => {
    pendingActionRef.current = null;
    setPendingAction(null);
  }, []);

  const beginPendingAction = useCallback((nextAction: GenerationGraftPendingAction) => {
    if (pendingActionRef.current != null) {
      return false;
    }

    pendingActionRef.current = nextAction;
    setPendingAction(nextAction);
    return true;
  }, []);

  const resetIdempotencyState = useCallback(() => {
    idempotencyStateRef.current = {
      tupleKey: null,
      key: null,
    };
  }, []);

  const resetTransientState = useCallback(
    ({ preserveCreated = false }: { preserveCreated?: boolean } = {}) => {
      setPreview(null);
      setPreviewRevision(null);
      setUndoDetails(null);
      setError(null);
      setStabilization(null);
      if (!preserveCreated) {
        setCreated(null);
      }
    },
    [],
  );

  const applySelection = useCallback(
    (nextSelection: SelectionState) => {
      clearPendingTimeout();
      bumpOperationToken();
      clearPendingAction();
      resetIdempotencyState();
      setQueuedStabilizationRetry(null);
      selectionRef.current = {
        ...nextSelection,
        activeSourceLeafMessageId: findActiveSourceLeafMessageId(
          graphRef.current,
          nextSelection.sourceMessageId,
          activeLeafMessageIdRef.current,
        ),
      };
      setSelection(nextSelection);
      resetTransientState();
      setPhase(getBasePhase(nextSelection));
    },
    [
      bumpOperationToken,
      clearPendingAction,
      clearPendingTimeout,
      resetIdempotencyState,
      resetTransientState,
    ],
  );

  const previewMatchesCurrentSelection = useCallback(
    (candidate: TGenerationGraftPreviewResponse | null) =>
      candidate != null &&
      candidate.sourceMessageId === selection.sourceMessageId &&
      candidate.destinationMessageId === selection.destinationMessageId &&
      candidate.mode === selection.mode &&
      previewRevision === treeRevision,
    [
      previewRevision,
      selection.destinationMessageId,
      selection.mode,
      selection.sourceMessageId,
      treeRevision,
    ],
  );

  const validateSelection = useCallback(
    (snapshot: SelectionSnapshot): ValidationResult => {
      if (snapshot.sourceMessageId == null) {
        return {
          kind: 'error',
          error: createLocalValidationError(localize, 'INVALID_SOURCE'),
        };
      }

      if (snapshot.destinationMessageId == null) {
        return {
          kind: 'error',
          error: createLocalValidationError(localize, 'INVALID_DESTINATION'),
        };
      }

      const invalidReason = getInvalidGraftReason(
        graph,
        snapshot.sourceMessageId,
        snapshot.destinationMessageId,
      );

      if (invalidReason == null) {
        return { kind: 'valid' };
      }

      if (STABILIZATION_CODES.has(invalidReason)) {
        return {
          kind: 'stabilization',
          stabilization: getLocalStabilizationState(graph, snapshot),
        };
      }

      return {
        kind: 'error',
        error: createLocalValidationError(localize, invalidReason),
      };
    },
    [graph, localize],
  );

  const tupleKey = useMemo(() => {
    if (selection.sourceMessageId == null || selection.destinationMessageId == null) {
      return null;
    }

    return JSON.stringify({
      sourceMessageId: selection.sourceMessageId,
      destinationMessageId: selection.destinationMessageId,
      mode: selection.mode,
      activeSourceLeafMessageId,
      treeRevision,
    });
  }, [
    activeSourceLeafMessageId,
    selection.destinationMessageId,
    selection.mode,
    selection.sourceMessageId,
    treeRevision,
  ]);

  const getIdempotencyKey = useCallback(() => {
    if (tupleKey == null) {
      return null;
    }

    if (
      idempotencyStateRef.current.tupleKey === tupleKey &&
      idempotencyStateRef.current.key != null
    ) {
      return idempotencyStateRef.current.key;
    }

    const nextKey = v4();
    idempotencyStateRef.current = {
      tupleKey,
      key: nextKey,
    };
    return nextKey;
  }, [tupleKey]);

  const invalidateTupleIdempotencyKey = useCallback(() => {
    if (tupleKey != null && idempotencyStateRef.current.tupleKey === tupleKey) {
      idempotencyStateRef.current = {
        tupleKey,
        key: null,
      };
    }
  }, [tupleKey]);

  const requestPreview = useCallback(
    async (
      nextDestinationMessageId?: string | null,
      options: { bypassLocalStabilizationCheck?: boolean } = {},
    ) => {
      const snapshot: SelectionSnapshot = {
        ...selectionRef.current,
        destinationMessageId:
          nextDestinationMessageId === undefined
            ? selectionRef.current.destinationMessageId
            : nextDestinationMessageId,
      };

      const validation = validateSelection(snapshot);
      if (validation.kind === 'error') {
        clearPendingTimeout();
        setError(validation.error);
        setPreview(null);
        setPreviewRevision(null);
        setStabilization(null);
        setPhase('error');
        return null;
      }

      if (validation.kind === 'stabilization' && options.bypassLocalStabilizationCheck !== true) {
        clearPendingTimeout();
        setError(null);
        setPreview(null);
        setPreviewRevision(null);
        setStabilization(validation.stabilization);
        setPhase('stabilization');
        return null;
      }

      clearPendingTimeout();
      const operationToken = bumpOperationToken();
      setError(null);
      setPreview(null);
      setPreviewRevision(null);
      setCreated(null);
      setUndoDetails(null);
      setStabilization(null);
      setPhase('previewing');

      try {
        const previewResponse = await previewMutation.mutateAsync({
          sourceMessageId: snapshot.sourceMessageId!,
          destinationMessageId: snapshot.destinationMessageId!,
          mode: snapshot.mode,
          sourceActiveLeafMessageId: snapshot.activeSourceLeafMessageId ?? undefined,
          expectedTreeRevision: treeRevision,
        });

        if (!isMountedRef.current || operationToken !== operationTokenRef.current) {
          return null;
        }

        setPreview(previewResponse);
        setPreviewRevision(treeRevision);
        setPhase(previewResponse.canCreate === true ? 'ready' : 'error');
        if (previewResponse.canCreate === true) {
          onFitSelection?.();
        }
        return previewResponse;
      } catch (caughtError) {
        if (!isMountedRef.current || operationToken !== operationTokenRef.current) {
          return null;
        }

        const parsedError = parseGenerationGraftError(caughtError, localize);
        if (parsedError.code != null && STABILIZATION_CODES.has(parsedError.code)) {
          setError(null);
          setStabilization({
            activeMessageIds: parsedError.activeMessageIds ?? [],
            conversationActiveWithoutMessageId:
              parsedError.conversationActiveWithoutMessageId === true,
          });
          setPhase('stabilization');
          return null;
        }

        if (parsedError.code === 'TREE_CHANGED') {
          invalidateTupleIdempotencyKey();
        }

        setError(parsedError);
        setPhase('error');
        return null;
      }
    },
    [
      bumpOperationToken,
      clearPendingTimeout,
      invalidateTupleIdempotencyKey,
      localize,
      onFitSelection,
      previewMutation,
      treeRevision,
      validateSelection,
    ],
  );
  const invalidateUndoRelatedQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.messages, conversationId] });
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.toolCalls, conversationId] });
    void queryClient.invalidateQueries({ queryKey: [QueryKeys.conversationUsage, conversationId] });
    void queryClient.invalidateQueries({
      queryKey: ['generationGraft', conversationId],
      exact: false,
    });
  }, [conversationId, queryClient]);

  const retryPreviewAfterStabilization = useCallback(
    async (operationToken: number) => {
      const snapshot = selectionRef.current;
      if (snapshot.sourceMessageId == null || snapshot.destinationMessageId == null) {
        return null;
      }

      setError(null);
      setPreview(null);
      setPreviewRevision(null);
      setCreated(null);
      setUndoDetails(null);
      setStabilization(null);
      setPhase('previewing');

      try {
        const previewResponse = await previewMutation.mutateAsync({
          sourceMessageId: snapshot.sourceMessageId,
          destinationMessageId: snapshot.destinationMessageId,
          mode: snapshot.mode,
          sourceActiveLeafMessageId: snapshot.activeSourceLeafMessageId ?? undefined,
          expectedTreeRevision: treeRevisionRef.current,
        });

        if (!isMountedRef.current || operationToken !== operationTokenRef.current) {
          return null;
        }

        setPreview(previewResponse);
        setPreviewRevision(treeRevisionRef.current);
        setPhase(previewResponse.canCreate === true ? 'ready' : 'error');
        if (previewResponse.canCreate === true) {
          onFitSelection?.();
        }
        return previewResponse;
      } catch (caughtError) {
        if (!isMountedRef.current || operationToken !== operationTokenRef.current) {
          return null;
        }

        const parsedError = parseGenerationGraftError(caughtError, localize);
        if (parsedError.code === 'TREE_CHANGED') {
          invalidateTupleIdempotencyKey();
        }

        setError(parsedError);
        setPhase('error');
        return null;
      }
    },
    [invalidateTupleIdempotencyKey, localize, onFitSelection, previewMutation],
  );

  const waitForStabilization = useCallback(
    async ({ stop }: { stop: boolean }) => {
      const action = stop ? 'stop' : 'wait';
      if (!beginPendingAction(action)) {
        return null;
      }

      const selectionSnapshot: SelectionState = {
        sourceMessageId: selectionRef.current.sourceMessageId,
        destinationMessageId: selectionRef.current.destinationMessageId,
        mode: selectionRef.current.mode,
      };
      const operationToken = operationTokenRef.current;
      const sessionSnapshot = sessionIdentityRef.current;

      clearPendingTimeout();
      setError(null);
      setPhase('stabilization');

      try {
        if (stop) {
          await stopGenerating?.();
        }

        const startedAt = Date.now();

        while (isMountedRef.current) {
          const streamStatus = await fetchStreamStatus(conversationId);
          if (
            !isMountedRef.current ||
            operationToken !== operationTokenRef.current ||
            sessionSnapshot !== sessionIdentityRef.current
          ) {
            return null;
          }

          const isActive =
            streamStatus?.active === true ||
            (streamStatus?.responseMessageId == null &&
              stabilizationRef.current?.conversationActiveWithoutMessageId === true);

          if (!isActive) {
            await queryClient.refetchQueries({
              queryKey: [QueryKeys.messages, conversationId],
            });
            await Promise.resolve();
            await Promise.resolve();

            if (
              !isMountedRef.current ||
              operationToken !== operationTokenRef.current ||
              sessionSnapshot !== sessionIdentityRef.current
            ) {
              return null;
            }

            if (!sameSelectionState(selectionSnapshot, selectionRef.current)) {
              return null;
            }

            setQueuedStabilizationRetry({
              operationToken,
              sessionIdentity: sessionSnapshot,
              selection: selectionSnapshot,
            });
            return null;
          }

          if (Date.now() - startedAt >= STABILIZATION_TIMEOUT_MS) {
            if (isMountedRef.current && operationToken === operationTokenRef.current) {
              setError(createTimeoutError(localize));
              setPhase('error');
            }
            return null;
          }

          await new Promise<void>((resolve) => {
            timeoutRef.current = setTimeout(() => resolve(), STABILIZATION_POLL_INTERVAL_MS);
          });
        }
      } finally {
        if (pendingActionRef.current === action) {
          clearPendingAction();
        }
      }

      return null;
    },
    [
      beginPendingAction,
      clearPendingAction,
      clearPendingTimeout,
      conversationId,
      localize,
      queryClient,
      stopGenerating,
    ],
  );

  const loadUndoDetails = useCallback(
    async (graftId: string) => {
      if (graftId.length === 0) {
        return null;
      }

      const details = await queryClient.fetchQuery({
        queryKey: generationGraftDetailsQueryKey(conversationId, graftId),
        queryFn: () => dataService.getGenerationGraft(conversationId, graftId),
        retry: false,
      });

      if (isMountedRef.current) {
        setUndoDetails(details);
      }

      return details;
    },
    [conversationId, queryClient],
  );

  const resetDisplayedGraftState = useCallback((graftId: string) => {
    const isCurrentDisplayedGraft =
      createdRef.current?.graftId === graftId || undoDetailsRef.current?.graftId === graftId;

    if (!isCurrentDisplayedGraft) {
      return null;
    }

    setCreated(null);
    setUndoDetails(null);
    setPreview(null);
    setPreviewRevision(null);
    setStabilization(null);
    setPhase(getBasePhase(selectionRef.current));
    return null;
  }, []);

  const undoSpecificGraft = useCallback(
    async (graftId: string, includeContinuations: boolean) => {
      if (graftId.length === 0) {
        return null;
      }

      const action = includeContinuations ? 'undo-destructive' : 'undo-safe';
      if (!beginPendingAction(action)) {
        return null;
      }

      const operationToken = operationTokenRef.current;
      const isCurrentDisplayedGraft =
        createdRef.current?.graftId === graftId || undoDetailsRef.current?.graftId === graftId;

      if (isCurrentDisplayedGraft) {
        setError(null);
        setPhase('undoing');
      }

      try {
        const undoResponse = await dataService.undoGenerationGraft(conversationId, graftId, {
          includeContinuations,
        });
        invalidateUndoRelatedQueries();

        if (!isMountedRef.current || operationToken !== operationTokenRef.current) {
          return undoResponse;
        }

        resetDisplayedGraftState(graftId);
        return undoResponse;
      } catch (caughtError) {
        if (!isMountedRef.current || operationToken !== operationTokenRef.current) {
          return null;
        }

        const parsedError = parseGenerationGraftError(caughtError, localize);
        if (!includeContinuations && parsedError.code === 'GRAFT_HAS_CONTINUATIONS') {
          if (isCurrentDisplayedGraft) {
            setError(parsedError);
          }

          try {
            await loadUndoDetails(graftId);
            if (
              isCurrentDisplayedGraft &&
              isMountedRef.current &&
              operationToken === operationTokenRef.current
            ) {
              setPhase('undo-preview');
            }
          } catch {
            if (
              isCurrentDisplayedGraft &&
              isMountedRef.current &&
              operationToken === operationTokenRef.current
            ) {
              setUndoDetails(null);
              setError(createUndoDetailsError(localize));
              setPhase('created');
            }
          }
          return null;
        }

        if (isCurrentDisplayedGraft) {
          setError(parsedError);
          setPhase(includeContinuations ? 'undo-preview' : 'error');
        }
        throw caughtError;
      } finally {
        if (pendingActionRef.current === action) {
          clearPendingAction();
        }
      }
    },
    [
      beginPendingAction,
      clearPendingAction,
      conversationId,
      invalidateUndoRelatedQueries,
      loadUndoDetails,
      localize,
      resetDisplayedGraftState,
    ],
  );

  const undoGraft = useCallback(
    () => undoSpecificGraft(currentGraftId, false),
    [currentGraftId, undoSpecificGraft],
  );

  const confirmUndoContinuations = useCallback(() => {
    if (currentGraftId.length === 0 || undoDetails == null) {
      return null;
    }

    return undoSpecificGraft(currentGraftId, true);
  }, [currentGraftId, undoDetails, undoSpecificGraft]);

  const createGraft = useCallback(async () => {
    if (!previewMatchesCurrentSelection(preview) || preview?.canCreate !== true) {
      return null;
    }

    if (!beginPendingAction('create')) {
      return null;
    }

    const idempotencyKey = getIdempotencyKey();
    if (idempotencyKey == null) {
      clearPendingAction();
      return null;
    }

    const operationToken = operationTokenRef.current;
    setError(null);
    setPhase('creating');

    try {
      const createdResponse = await createMutation.mutateAsync({
        sourceMessageId: preview.sourceMessageId,
        destinationMessageId: preview.destinationMessageId,
        mode: preview.mode,
        sourceActiveLeafMessageId: activeSourceLeafMessageId ?? undefined,
        idempotencyKey,
        expectedTreeRevision: preview.treeRevision,
      });

      if (!isMountedRef.current || operationToken !== operationTokenRef.current) {
        return createdResponse;
      }

      setCreated(createdResponse);
      setUndoDetails(null);
      setStabilization(null);
      setPhase('created');

      const latestMessage =
        createdResponse.createdMessages.find(
          (message) => message.messageId === createdResponse.activeCopiedMessageId,
        ) ??
        ({
          messageId: createdResponse.activeCopiedMessageId,
          conversationId,
        } as TMessage);
      setLatestMessage?.(latestMessage);
      onFocusMessage?.(createdResponse.activeCopiedMessageId);
      onFitCreated?.(getCreatedFitMessageIds(createdResponse));
      showToast({
        message: localize('com_ui_generation_tree_created_success'),
        status: 'success',
        duration: 10_000,
        actionLabel: localize('com_ui_generation_tree_undo'),
        onAction: () => {
          void undoSpecificGraft(createdResponse.graftId, false);
        },
      });
      return createdResponse;
    } catch (caughtError) {
      const parsedError = parseGenerationGraftError(caughtError, localize);
      if (parsedError.code === 'TREE_CHANGED') {
        invalidateTupleIdempotencyKey();
      }
      setError(parsedError);
      setPhase('error');
      throw caughtError;
    } finally {
      if (pendingActionRef.current === 'create') {
        clearPendingAction();
      }
    }
  }, [
    beginPendingAction,
    clearPendingAction,
    activeSourceLeafMessageId,
    conversationId,
    createMutation,
    getIdempotencyKey,
    invalidateTupleIdempotencyKey,
    localize,
    onFitCreated,
    onFocusMessage,
    preview,
    previewMatchesCurrentSelection,
    setLatestMessage,
    showToast,
    undoSpecificGraft,
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      clearPendingTimeout();
      bumpOperationToken();
      clearPendingAction();
      setQueuedStabilizationRetry(null);
    };
  }, [bumpOperationToken, clearPendingAction, clearPendingTimeout]);

  useEffect(() => {
    if (queuedStabilizationRetry == null) {
      return;
    }

    if (
      queuedStabilizationRetry.operationToken !== operationTokenRef.current ||
      queuedStabilizationRetry.sessionIdentity !== sessionIdentityRef.current ||
      !sameSelectionState(queuedStabilizationRetry.selection, selectionRef.current)
    ) {
      setQueuedStabilizationRetry(null);
      return;
    }

    setQueuedStabilizationRetry(null);
    void retryPreviewAfterStabilization(queuedStabilizationRetry.operationToken);
  }, [
    queuedStabilizationRetry,
    retryPreviewAfterStabilization,
    treeRevision,
    activeSourceLeafMessageId,
  ]);

  useEffect(() => {
    const treeSignalChanged =
      previousTreeSignalRef.current.treeRevision !== treeRevision ||
      previousTreeSignalRef.current.activeSourceLeafMessageId !== activeSourceLeafMessageId;

    previousTreeSignalRef.current = {
      treeRevision,
      activeSourceLeafMessageId,
    };

    if (!treeSignalChanged) {
      return;
    }

    if (phase === 'stabilization' || phase === 'creating') {
      return;
    }

    if (phase === 'created' || phase === 'undo-preview' || phase === 'undoing') {
      return;
    }

    clearPendingTimeout();
    bumpOperationToken();
    clearPendingAction();
    resetIdempotencyState();
    setQueuedStabilizationRetry(null);
    resetTransientState();
    setPhase(getBasePhase(selectionRef.current));
  }, [
    activeSourceLeafMessageId,
    bumpOperationToken,
    clearPendingAction,
    clearPendingTimeout,
    phase,
    resetIdempotencyState,
    setQueuedStabilizationRetry,
    resetTransientState,
    treeRevision,
  ]);

  useEffect(() => {
    const nextSelection: SelectionState = {
      sourceMessageId: initialSourceMessageId,
      destinationMessageId: null,
      mode: 'generation',
    };

    clearPendingTimeout();
    bumpOperationToken();
    clearPendingAction();
    resetIdempotencyState();
    setQueuedStabilizationRetry(null);
    selectionRef.current = {
      ...nextSelection,
      activeSourceLeafMessageId: findActiveSourceLeafMessageId(
        graphRef.current,
        nextSelection.sourceMessageId,
        activeLeafMessageIdRef.current,
      ),
    };
    setSelection(nextSelection);
    setPhase(getBasePhase(nextSelection));
    resetTransientState();
  }, [
    bumpOperationToken,
    clearPendingAction,
    clearPendingTimeout,
    initialSourceMessageId,
    resetIdempotencyState,
    setQueuedStabilizationRetry,
    resetTransientState,
    sessionIdentity,
  ]);

  return {
    phase,
    pendingAction,
    sourceMessageId: selection.sourceMessageId,
    destinationMessageId: selection.destinationMessageId,
    mode: selection.mode,
    preview,
    created,
    undoDetails,
    error,
    stabilization,
    canCreate:
      phase === 'ready' && previewMatchesCurrentSelection(preview) && preview?.canCreate === true,
    selectSourceMessage: (sourceMessageId: string | null) =>
      applySelection({
        sourceMessageId,
        destinationMessageId: selectionRef.current.destinationMessageId,
        mode: selectionRef.current.mode,
      }),
    selectDestinationMessage: (destinationMessageId: string | null) =>
      applySelection({
        sourceMessageId: selectionRef.current.sourceMessageId,
        destinationMessageId,
        mode: selectionRef.current.mode,
      }),
    setMode: (mode: TGenerationGraftMode) =>
      applySelection({
        sourceMessageId: selectionRef.current.sourceMessageId,
        destinationMessageId: selectionRef.current.destinationMessageId,
        mode,
      }),
    requestPreview,
    createGraft,
    undoGraft,
    confirmUndoContinuations,
    stopAndGraft: () => waitForStabilization({ stop: true }),
    waitForCompletion: () => waitForStabilization({ stop: false }),
    cancelStabilization: () => {
      clearPendingTimeout();
      bumpOperationToken();
      clearPendingAction();
      setQueuedStabilizationRetry(null);
      setStabilization(null);
      setError(null);
      setPhase(getBasePhase(selectionRef.current));
    },
  };
}
