import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import ConversationTreeInspector from './ConversationTreeInspector';
import ConversationTreeList from './ConversationTreeList';
import ConversationTreeToolbar from './ConversationTreeToolbar';
import useConversationTreeViewModel from './useConversationTreeViewModel';
import useGenerationGraft from './useGenerationGraft';

const EXIT_RESET_DELAY_MS = 200;
const EMPTY_MESSAGES: ReturnType<ReturnType<typeof useChatContext>['getMessages']> = [];

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
  const isMobileRef = useRef(false);
  const { conversation, getMessages, latestMessageId, isSubmitting } = useChatContext();
  const conversationId = conversation?.conversationId ?? '';
  const isMobile = useMediaQuery('(max-width: 767px)');
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
  isMobileRef.current = isMobile;

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
    setListOpen(!isMobileRef.current);
    setMobileSheetOpen(false);
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

  const updateCollapsedIds = useCallback((nextCollapsedIds: Set<string>) => {
    setCollapsedIds(new Set(nextCollapsedIds));
  }, []);

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
        setStatusText(localize('com_ui_generation_tree_status_preview'));
        void generationGraft.requestPreview(generationGraft.destinationMessageId);
        if (isMobile) {
          setMobileSheetOpen(true);
        }
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
        <div className="grid h-full grid-rows-[auto_auto_1fr]">
          <div
            id={liveRegionId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {statusText}
          </div>
          <div className="border-b border-border-light px-4 py-3">
            <OGDialogTitle className="text-base font-semibold">
              {localize('com_sidepanel_conversation_tree')}
            </OGDialogTitle>
            <OGDialogDescription id={descriptionId} className="mt-1 text-sm text-text-secondary">
              {localize('com_ui_conversation_tree_description')}
            </OGDialogDescription>
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

          <div className="relative min-h-0">
            {isMobile ? (
              <div className="grid h-full grid-rows-[1fr_auto]">
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
                    setStatusText(localize('com_ui_generation_tree_status_preview'));
                    void generationGraft.requestPreview(generationGraft.destinationMessageId);
                    setMobileSheetOpen(true);
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
                <div
                  data-testid="generation-tree-mobile-summary"
                  className="flex items-center justify-between gap-3 border-t border-border-light px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs text-text-secondary">
                      {localize('com_ui_generation_tree_source')}:{' '}
                      {generationGraft.sourceMessageId ?? localize('com_ui_none')}
                    </div>
                    <div className="truncate text-sm text-text-primary">
                      {localize('com_ui_generation_tree_destination')}:{' '}
                      {generationGraft.destinationMessageId ??
                        focusMessageId ??
                        localize('com_ui_none')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl border border-border-medium px-3 py-2 text-sm text-text-secondary"
                    onClick={() => setMobileSheetOpen((current) => !current)}
                  >
                    {localize('com_ui_generation_tree_open_sheet')}
                  </button>
                </div>
                {mobileSheetOpen ? (
                  <div
                    data-testid="generation-tree-mobile-sheet"
                    className="absolute inset-x-0 bottom-0 z-10 max-h-[55vh] rounded-t-3xl border border-border-light bg-surface-primary shadow-2xl"
                  >
                    <ConversationTreeInspector
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
                      listOpen={true}
                      onToggleList={() => setMobileSheetOpen(false)}
                      listContent={listContent}
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
                ) : null}
              </div>
            ) : (
              <div className="grid h-full min-h-0 md:grid-cols-[minmax(0,1fr)_360px]">
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
                    setStatusText(localize('com_ui_generation_tree_status_preview'));
                    void generationGraft.requestPreview(generationGraft.destinationMessageId);
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
                  className="min-h-0 border-l border-border-light"
                >
                  <ConversationTreeInspector
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
                    listOpen={listOpen}
                    onToggleList={() => setListOpen((current) => !current)}
                    listContent={listContent}
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
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
