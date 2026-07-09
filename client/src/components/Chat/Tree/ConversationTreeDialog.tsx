import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import {
  OGDialog,
  OGDialogContent,
  OGDialogDescription,
  OGDialogTitle,
  useMediaQuery,
} from '@librechat/client';
import useLocalize from '~/hooks/useLocalize';
import { useChatContext } from '~/Providers/ChatContext';
import { useStreamStatus } from '~/data-provider';
import type { ConversationTreeViewportCommands, TreeNodePosition, TreeOrientation } from './types';
import {
  loadCollapsedTreeIds,
  loadTreeOrientation,
  saveCollapsedTreeIds,
  saveTreeOrientation,
} from './storage';
import ConversationTreeCanvas from './ConversationTreeCanvas';
import ConversationTreeHelp from './ConversationTreeHelp';
import ConversationTreeInspector from './ConversationTreeInspector';
import ConversationTreeList from './ConversationTreeList';
import ConversationTreeMobileGuideBar from './ConversationTreeMobileGuideBar';
import ConversationTreeToolbar from './ConversationTreeToolbar';
import { getInvalidGraftReason } from './graph';
import useConversationTreeViewModel from './useConversationTreeViewModel';
import useGenerationGraft from './useGenerationGraft';
import type { InvalidGraftReason } from './types';

const EXIT_RESET_DELAY_MS = 200;
const EMPTY_MESSAGES: ReturnType<ReturnType<typeof useChatContext>['getMessages']> = [];
const STABILIZABLE_REASONS = new Set<InvalidGraftReason>([
  'GRAFT_BUSY',
  'GRAFT_REQUIRES_STABILIZATION',
]);

function getInvalidReasonText(
  localize: ReturnType<typeof useLocalize>,
  reason: InvalidGraftReason,
): string | null {
  switch (reason) {
    case null:
      return null;
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

type ConversationTreeDialogProps = {
  open: boolean;
  focusMessageId: string | null;
  sourceMessageId: string | null;
  sessionKey?: string;
  onOpenChange: (open: boolean) => void;
  onExitComplete?: () => void;
};

export default function ConversationTreeDialog({
  open,
  focusMessageId,
  sourceMessageId,
  sessionKey,
  onOpenChange,
  onExitComplete,
}: ConversationTreeDialogProps) {
  const localize = useLocalize();
  const descriptionId = useId();
  const liveRegionId = useId();
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitCompletedRef = useRef(false);
  const viewportCommandsRef = useRef<ConversationTreeViewportCommands | null>(null);
  const initializedSessionRef = useRef<string | null>(null);
  const orientationConversationIdRef = useRef('');
  const previousOpenRef = useRef(open);
  const latestMessageIdRef = useRef<string | null>(null);
  const { conversation, getMessages, latestMessageId, isSubmitting } = useChatContext();
  const conversationId = conversation?.conversationId ?? '';
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const [orientation, setOrientation] = useState<TreeOrientation>(() =>
    loadTreeOrientation(conversationId),
  );
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
    () => new Set(loadCollapsedTreeIds(conversationId)),
  );
  const [manualPositions, setManualPositions] = useState<Map<string, TreeNodePosition>>(new Map());
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(focusMessageId);
  const [statusText, setStatusText] = useState('');
  const [arrangeMode, setArrangeMode] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [autoFitToken, setAutoFitToken] = useState(0);
  const { data: streamStatus } = useStreamStatus(conversationId, open, open ? 1_000 : false);
  const rawMessages = getMessages() ?? EMPTY_MESSAGES;
  const activeLeafMessageId =
    (streamStatus?.active ? streamStatus.responseMessageId : null) ??
    (isSubmitting ? latestMessageId : null) ??
    focusMessageId ??
    null;
  const sessionIdentity =
    sessionKey ?? `${conversationId}::${focusMessageId ?? ''}::${sourceMessageId ?? ''}`;
  const treeRevision = useMemo(
    () =>
      [
        streamStatus?.active === true ? 'active' : 'inactive',
        streamStatus?.responseMessageId ?? 'none',
        activeLeafMessageId ?? 'no-leaf',
        ...rawMessages.map(
          (message) =>
            `${message.messageId}:${message.parentMessageId ?? ''}:${message.unfinished ? 1 : 0}:${
              message.error ? 1 : 0
            }:${message.finish_reason ?? ''}`,
        ),
      ].join('|'),
    [activeLeafMessageId, rawMessages, streamStatus?.active, streamStatus?.responseMessageId],
  );

  latestMessageIdRef.current = latestMessageId;

  const finishExit = useCallback(() => {
    if (exitCompletedRef.current || onExitComplete == null) {
      return;
    }

    exitCompletedRef.current = true;

    if (exitTimerRef.current != null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    onExitComplete();
  }, [onExitComplete]);

  useEffect(() => {
    if (exitTimerRef.current != null) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }

    if (open) {
      exitCompletedRef.current = false;
      return;
    }

    if (onExitComplete == null || (focusMessageId == null && sourceMessageId == null)) {
      return;
    }

    exitCompletedRef.current = false;
    exitTimerRef.current = setTimeout(() => finishExit(), EXIT_RESET_DELAY_MS);

    return () => {
      if (exitTimerRef.current != null) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [open, focusMessageId, sourceMessageId, onExitComplete, finishExit]);

  useEffect(() => {
    if (
      !conversationId ||
      orientationConversationIdRef.current.length === 0 ||
      orientationConversationIdRef.current !== conversationId
    ) {
      return;
    }

    saveTreeOrientation(conversationId, orientation);
  }, [conversationId, orientation]);

  useEffect(() => {
    if (!conversationId) {
      return;
    }

    saveCollapsedTreeIds(conversationId, collapsedIds);
  }, [collapsedIds, conversationId]);

  useEffect(() => {
    orientationConversationIdRef.current = conversationId;
    setCollapsedIds(new Set(loadCollapsedTreeIds(conversationId)));
    setOrientation(loadTreeOrientation(conversationId));
    setManualPositions(new Map());
  }, [conversationId]);

  useEffect(() => {
    if (!open) {
      if (previousOpenRef.current) {
        initializedSessionRef.current = null;
        setManualPositions(new Map());
        setStatusText(localize('com_ui_generation_tree_announcer_closed'));
      }
      previousOpenRef.current = false;
      return;
    }

    previousOpenRef.current = true;

    if (initializedSessionRef.current === sessionIdentity) {
      return;
    }

    initializedSessionRef.current = sessionIdentity;
    setFocusedNodeId(focusMessageId ?? sourceMessageId ?? latestMessageIdRef.current ?? null);
    setArrangeMode(false);
    setManualPositions(new Map());
    setStatusText(localize('com_ui_generation_tree_announcer_opened'));
    setListOpen(false);
    setMobileSheetOpen(false);
    setHelpOpen(false);
    setAutoFitToken((currentToken) => currentToken + 1);
  }, [focusMessageId, localize, open, sessionIdentity, sourceMessageId]);

  const activeMessageIds = useMemo(() => {
    const ids = new Set<string>();

    if (!open) {
      return ids;
    }

    if (streamStatus?.active && streamStatus.responseMessageId != null) {
      ids.add(streamStatus.responseMessageId);
    }

    if (isSubmitting && latestMessageId != null) {
      ids.add(latestMessageId);
    }

    return ids;
  }, [isSubmitting, latestMessageId, open, streamStatus?.active, streamStatus?.responseMessageId]);

  const { graph, layout, activeBranchIds } = useConversationTreeViewModel({
    messages: rawMessages,
    activeMessageIds,
    orientation,
    collapsedIds,
    manualPositions,
    activeLeafMessageId,
  });

  const generationGraft = useGenerationGraft({
    conversationId,
    graph,
    initialSourceMessageId: sourceMessageId,
    treeRevision,
    activeLeafMessageId,
    sessionKey: sessionIdentity,
    onFocusMessage: setFocusedNodeId,
    onFitSelection: () => viewportCommandsRef.current?.fitSelection(),
    onFitCreated: (messageIds) => viewportCommandsRef.current?.fitMessageIds(messageIds),
  });

  const sourceNode =
    generationGraft.sourceMessageId != null
      ? (layout.nodes.get(generationGraft.sourceMessageId) ?? null)
      : null;
  const destinationNode =
    generationGraft.destinationMessageId != null
      ? (layout.nodes.get(generationGraft.destinationMessageId) ?? null)
      : null;
  const focusedNode = focusedNodeId != null ? (layout.nodes.get(focusedNodeId) ?? null) : null;
  const focusedDestinationReason =
    generationGraft.sourceMessageId != null && focusedNode != null
      ? getInvalidGraftReason(graph, generationGraft.sourceMessageId, focusedNode.id)
      : null;
  const canUseFocusedAsSource = focusedNode?.role === 'assistant';
  const canUseFocusedAsDestination =
    generationGraft.sourceMessageId != null &&
    focusedNode?.role === 'assistant' &&
    (focusedDestinationReason == null || STABILIZABLE_REASONS.has(focusedDestinationReason));
  const focusedSelectionError =
    generationGraft.sourceMessageId != null && focusedNode != null
      ? getInvalidReasonText(localize, focusedDestinationReason)
      : null;

  const updateCollapsedIds = useCallback((nextCollapsedIds: Set<string>) => {
    setCollapsedIds(new Set(nextCollapsedIds));
  }, []);

  const clearSourceSelection = useCallback(() => {
    generationGraft.selectDestinationMessage(null);
    generationGraft.selectSourceMessage(null);
    setStatusText(localize('com_ui_generation_tree_source_instruction'));
  }, [generationGraft, localize]);

  const clearDestinationSelection = useCallback(() => {
    generationGraft.selectDestinationMessage(null);
    setStatusText(localize('com_ui_generation_tree_status_source_selected'));
  }, [generationGraft, localize]);

  const useFocusedAsSource = useCallback(() => {
    if (!canUseFocusedAsSource || focusedNode == null) {
      return;
    }

    generationGraft.selectDestinationMessage(null);
    generationGraft.selectSourceMessage(focusedNode.id);
    setStatusText(localize('com_ui_generation_tree_status_source_selected'));
    setMobileSheetOpen(false);
  }, [canUseFocusedAsSource, focusedNode, generationGraft, localize]);

  const requestPreview = useCallback(() => {
    setStatusText(localize('com_ui_generation_tree_status_preview'));
    void generationGraft.requestPreview();
    setMobileSheetOpen(true);
  }, [generationGraft, localize]);

  const useFocusedAsDestination = useCallback(() => {
    if (!canUseFocusedAsDestination || focusedNode == null) {
      return;
    }

    generationGraft.selectDestinationMessage(focusedNode.id);
    requestPreview();
  }, [canUseFocusedAsDestination, focusedNode, generationGraft, requestPreview]);

  const listContent = (
    <ConversationTreeList
      graph={graph}
      collapsedIds={collapsedIds}
      focusedMessageId={focusedNodeId}
      sourceMessageId={generationGraft.sourceMessageId}
      destinationMessageId={generationGraft.destinationMessageId}
      onFocusMessage={setFocusedNodeId}
      onSelectSource={(messageId) => {
        generationGraft.selectSourceMessage(messageId);
        setFocusedNodeId(messageId);
      }}
      onSelectDestination={(messageId) => {
        generationGraft.selectDestinationMessage(messageId);
        setFocusedNodeId(messageId);
      }}
      onPreviewRequest={() => {
        requestPreview();
      }}
      onCollapsedIdsChange={updateCollapsedIds}
      onCancelSelection={() => {
        generationGraft.selectDestinationMessage(null);
        setStatusText(localize('com_ui_generation_tree_announcer_closed'));
      }}
      announceStatus={false}
      onStatusTextChange={setStatusText}
    />
  );

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        data-testid="generation-tree-dialog"
        data-focused-message-id={focusMessageId ?? ''}
        data-source-message-id={sourceMessageId ?? ''}
        aria-describedby={descriptionId}
        aria-details={liveRegionId}
        className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border-0 bg-surface-primary p-0 text-text-primary"
        onAnimationEnd={(event) => {
          if ((event.currentTarget as HTMLElement).dataset.state === 'closed') {
            finishExit();
          }
        }}
        onTransitionEnd={(event) => {
          if ((event.currentTarget as HTMLElement).dataset.state === 'closed') {
            finishExit();
          }
        }}
      >
        <div className="grid h-full min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden">
          <div
            id={liveRegionId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {statusText}
          </div>
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-light px-4 py-2.5">
            <div className="min-w-0">
              <OGDialogTitle className="text-base font-semibold">
                {localize('com_sidepanel_conversation_tree')}
              </OGDialogTitle>
              <OGDialogDescription
                id={descriptionId}
                className="mt-0.5 hidden text-sm text-text-secondary sm:block"
              >
                {localize('com_ui_conversation_tree_description')}
              </OGDialogDescription>
            </div>
            <button
              type="button"
              className="flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-border-medium px-3 py-2 text-sm font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              onClick={() => setHelpOpen(true)}
            >
              <CircleHelp className="size-4" aria-hidden="true" />
              {localize('com_ui_generation_tree_help')}
            </button>
          </div>

          <ConversationTreeToolbar
            orientation={orientation}
            arrangeMode={arrangeMode}
            onFitTree={() => viewportCommandsRef.current?.fitTree()}
            onFitActiveBranch={() => viewportCommandsRef.current?.fitActiveBranch()}
            onFitSelection={() => viewportCommandsRef.current?.fitSelection()}
            onToggleOrientation={() => {
              setAutoFitToken((currentToken) => currentToken + 1);
              setOrientation((currentOrientation) =>
                currentOrientation === 'horizontal' ? 'vertical' : 'horizontal',
              );
            }}
            onToggleArrangeMode={() => {
              setArrangeMode((currentArrangeMode) => !currentArrangeMode);
              setStatusText(localize('com_ui_generation_tree_arrange'));
            }}
            onResetLayout={() => {
              setManualPositions(new Map());
              setArrangeMode(false);
              viewportCommandsRef.current?.fitTree();
            }}
            onExpandActiveBranch={() => {
              const nextCollapsedIds = new Set(collapsedIds);
              for (const messageId of activeBranchIds) {
                nextCollapsedIds.delete(messageId);
              }
              setCollapsedIds(nextCollapsedIds);
            }}
          />

          <div
            data-layout={isMobile ? 'compact' : 'desktop'}
            className="relative min-h-0 overflow-hidden"
          >
            {isMobile ? (
              <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden">
                <ConversationTreeCanvas
                  graph={graph}
                  layout={layout}
                  focusedMessageId={focusedNodeId}
                  sourceMessageId={generationGraft.sourceMessageId}
                  destinationMessageId={generationGraft.destinationMessageId}
                  collapsedIds={collapsedIds}
                  arrangeMode={arrangeMode}
                  manualPositions={manualPositions}
                  activeBranchIds={activeBranchIds}
                  orientation={orientation}
                  autoFitToken={autoFitToken}
                  announceStatus={false}
                  statusText={statusText}
                  onFocusMessage={setFocusedNodeId}
                  onSelectSource={(messageId) => {
                    generationGraft.selectSourceMessage(messageId);
                    setFocusedNodeId(messageId);
                  }}
                  onSelectDestination={(messageId) => {
                    generationGraft.selectDestinationMessage(messageId);
                    setFocusedNodeId(messageId);
                  }}
                  onPreviewRequest={() => {
                    requestPreview();
                  }}
                  onManualPositionChange={(messageId, position) =>
                    setManualPositions((currentPositions) => {
                      const nextPositions = new Map(currentPositions);
                      nextPositions.set(messageId, position);
                      return nextPositions;
                    })
                  }
                  onCollapsedIdsChange={updateCollapsedIds}
                  onStatusTextChange={setStatusText}
                  onRegisterViewportCommands={(commands) => {
                    viewportCommandsRef.current = commands;
                  }}
                />
                <ConversationTreeMobileGuideBar
                  focusedNode={focusedNode}
                  sourceNode={sourceNode}
                  destinationNode={destinationNode}
                  canUseFocusedAsSource={canUseFocusedAsSource}
                  canUseFocusedAsDestination={canUseFocusedAsDestination}
                  onUseFocusedAsSource={useFocusedAsSource}
                  onUseFocusedAsDestination={useFocusedAsDestination}
                  onOpenDetails={() => setMobileSheetOpen(true)}
                />
                {mobileSheetOpen ? (
                  <>
                    <button
                      type="button"
                      data-testid="generation-tree-mobile-backdrop"
                      aria-label={localize('com_ui_close')}
                      className="absolute inset-0 z-10 cursor-default bg-black/25"
                      onClick={() => setMobileSheetOpen(false)}
                    />
                    <div
                      data-testid="generation-tree-mobile-sheet"
                      className="absolute inset-x-0 bottom-0 z-20 h-[min(82dvh,720px)] max-h-[calc(100%-0.75rem)] overflow-hidden rounded-t-lg border border-border-light bg-surface-primary shadow-2xl"
                    >
                      <ConversationTreeInspector
                        focusedNode={focusedNode}
                        sourceNode={sourceNode}
                        destinationNode={destinationNode}
                        statusText={statusText}
                        phase={generationGraft.phase}
                        pendingAction={generationGraft.pendingAction}
                        mode={generationGraft.mode}
                        preview={generationGraft.preview}
                        created={generationGraft.created}
                        pendingUndoTarget={generationGraft.pendingUndoTarget}
                        error={generationGraft.error}
                        stabilization={generationGraft.stabilization}
                        canUseFocusedAsSource={canUseFocusedAsSource}
                        canUseFocusedAsDestination={canUseFocusedAsDestination}
                        focusedSelectionError={focusedSelectionError}
                        listOpen={listOpen}
                        onToggleList={() => setListOpen((current) => !current)}
                        onClose={() => setMobileSheetOpen(false)}
                        listContent={listContent}
                        onUseFocusedAsSource={useFocusedAsSource}
                        onUseFocusedAsDestination={useFocusedAsDestination}
                        onClearSource={clearSourceSelection}
                        onClearDestination={clearDestinationSelection}
                        onRequestPreview={requestPreview}
                        onOpenHelp={() => setHelpOpen(true)}
                        onModeChange={generationGraft.setMode}
                        onCreate={() => void generationGraft.createGraft()}
                        onUndo={() => void generationGraft.undoGraft()}
                        onConfirmUndoContinuations={() =>
                          void generationGraft.confirmUndoContinuations()
                        }
                        onCancelPendingUndoTarget={generationGraft.cancelPendingUndoTarget}
                        onStopAndGraft={() => void generationGraft.stopAndGraft()}
                        onWaitForCompletion={() => void generationGraft.waitForCompletion()}
                        onCancelStabilization={generationGraft.cancelStabilization}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            ) : (
              <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_clamp(320px,32vw,440px)] overflow-hidden">
                <ConversationTreeCanvas
                  graph={graph}
                  layout={layout}
                  focusedMessageId={focusedNodeId}
                  sourceMessageId={generationGraft.sourceMessageId}
                  destinationMessageId={generationGraft.destinationMessageId}
                  collapsedIds={collapsedIds}
                  arrangeMode={arrangeMode}
                  manualPositions={manualPositions}
                  activeBranchIds={activeBranchIds}
                  orientation={orientation}
                  autoFitToken={autoFitToken}
                  announceStatus={false}
                  statusText={statusText}
                  onFocusMessage={setFocusedNodeId}
                  onSelectSource={(messageId) => {
                    generationGraft.selectSourceMessage(messageId);
                    setFocusedNodeId(messageId);
                  }}
                  onSelectDestination={(messageId) => {
                    generationGraft.selectDestinationMessage(messageId);
                    setFocusedNodeId(messageId);
                  }}
                  onPreviewRequest={() => {
                    requestPreview();
                    setListOpen(true);
                  }}
                  onManualPositionChange={(messageId, position) =>
                    setManualPositions((currentPositions) => {
                      const nextPositions = new Map(currentPositions);
                      nextPositions.set(messageId, position);
                      return nextPositions;
                    })
                  }
                  onCollapsedIdsChange={updateCollapsedIds}
                  onStatusTextChange={setStatusText}
                  onRegisterViewportCommands={(commands) => {
                    viewportCommandsRef.current = commands;
                  }}
                />
                <aside
                  data-testid="generation-tree-sidebar"
                  className="min-h-0 min-w-0 overflow-hidden border-l border-border-light"
                >
                  <ConversationTreeInspector
                    focusedNode={focusedNode}
                    sourceNode={sourceNode}
                    destinationNode={destinationNode}
                    statusText={statusText}
                    phase={generationGraft.phase}
                    pendingAction={generationGraft.pendingAction}
                    mode={generationGraft.mode}
                    preview={generationGraft.preview}
                    created={generationGraft.created}
                    pendingUndoTarget={generationGraft.pendingUndoTarget}
                    error={generationGraft.error}
                    stabilization={generationGraft.stabilization}
                    canUseFocusedAsSource={canUseFocusedAsSource}
                    canUseFocusedAsDestination={canUseFocusedAsDestination}
                    focusedSelectionError={focusedSelectionError}
                    listOpen={listOpen}
                    onToggleList={() => setListOpen((current) => !current)}
                    listContent={listContent}
                    onUseFocusedAsSource={useFocusedAsSource}
                    onUseFocusedAsDestination={useFocusedAsDestination}
                    onClearSource={clearSourceSelection}
                    onClearDestination={clearDestinationSelection}
                    onRequestPreview={requestPreview}
                    onOpenHelp={() => setHelpOpen(true)}
                    onModeChange={generationGraft.setMode}
                    onCreate={() => void generationGraft.createGraft()}
                    onUndo={() => void generationGraft.undoGraft()}
                    onConfirmUndoContinuations={() =>
                      void generationGraft.confirmUndoContinuations()
                    }
                    onCancelPendingUndoTarget={generationGraft.cancelPendingUndoTarget}
                    onStopAndGraft={() => void generationGraft.stopAndGraft()}
                    onWaitForCompletion={() => void generationGraft.waitForCompletion()}
                    onCancelStabilization={generationGraft.cancelStabilization}
                  />
                </aside>
              </div>
            )}
          </div>
          {helpOpen ? (
            <ConversationTreeHelp
              onClose={() => setHelpOpen(false)}
              onStartGuided={() => {
                setHelpOpen(false);
                setListOpen(false);
                setMobileSheetOpen(false);
                generationGraft.setMode('subtree');
              }}
            />
          ) : null}
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
