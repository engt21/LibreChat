import React, {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ConversationTreeDialog from '~/components/Chat/Tree/ConversationTreeDialog';
import { useChatContext } from './ChatContext';

type OpenGenerationTreeOptions = {
  focusMessageId?: string;
  sourceMessageId?: string;
};

type GenerationTreeContextValue = {
  open: boolean;
  focusMessageId: string | null;
  sourceMessageId: string | null;
  openTree: (options?: OpenGenerationTreeOptions) => void;
  closeTree: () => void;
};

type GenerationTreeSession = {
  ownerConversationId: string | null;
  sessionId: number;
  open: boolean;
  focusMessageId: string | null;
  sourceMessageId: string | null;
};

const GenerationTreeContext = createContext<GenerationTreeContextValue | undefined>(undefined);

export function GenerationTreeProvider({ children }: { children: React.ReactNode }) {
  const { conversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? null;
  const nextSessionIdRef = useRef(0);
  const buildSession = useCallback(
    (
      ownerConversationId: string | null,
      open: boolean,
      focusMessageId: string | null,
      sourceMessageId: string | null,
    ): GenerationTreeSession => ({
      ownerConversationId,
      sessionId: ++nextSessionIdRef.current,
      open,
      focusMessageId,
      sourceMessageId,
    }),
    [],
  );

  const [session, setSession] = useState<GenerationTreeSession>(() =>
    buildSession(conversationId, false, null, null),
  );
  const sessionRef = useRef(session);

  const commitSession = useCallback((nextSession: GenerationTreeSession) => {
    sessionRef.current = nextSession;
    setSession(nextSession);
  }, []);

  useLayoutEffect(() => {
    if (sessionRef.current.ownerConversationId === conversationId) {
      return;
    }

    commitSession(buildSession(conversationId, false, null, null));
  }, [conversationId, commitSession, buildSession]);

  const isOwnedByCurrentConversation = session.ownerConversationId === conversationId;
  const open = isOwnedByCurrentConversation ? session.open : false;
  const focusMessageId = isOwnedByCurrentConversation ? session.focusMessageId : null;
  const sourceMessageId = isOwnedByCurrentConversation ? session.sourceMessageId : null;

  const openTree = useCallback(
    (options?: OpenGenerationTreeOptions) => {
      commitSession(
        buildSession(
          conversationId,
          true,
          options?.focusMessageId ?? null,
          options?.sourceMessageId ?? null,
        ),
      );
    },
    [buildSession, commitSession, conversationId],
  );

  const closeTree = useCallback(() => {
    const currentSession = sessionRef.current;

    if (currentSession.ownerConversationId !== conversationId || currentSession.open === false) {
      return;
    }

    commitSession({
      ...currentSession,
      open: false,
    });
  }, [commitSession, conversationId]);

  const exitOwnerConversationId = session.ownerConversationId;
  const exitSessionId = session.sessionId;
  const handleExitComplete = useCallback(() => {
    const currentSession = sessionRef.current;

    if (
      currentSession.ownerConversationId !== exitOwnerConversationId ||
      currentSession.sessionId !== exitSessionId ||
      currentSession.open
    ) {
      return;
    }

    if (currentSession.focusMessageId == null && currentSession.sourceMessageId == null) {
      return;
    }

    commitSession({
      ...currentSession,
      focusMessageId: null,
      sourceMessageId: null,
    });
  }, [commitSession, exitOwnerConversationId, exitSessionId]);

  const value = useMemo(
    () => ({
      open,
      focusMessageId,
      sourceMessageId,
      openTree,
      closeTree,
    }),
    [open, focusMessageId, sourceMessageId, openTree, closeTree],
  );

  return (
    <GenerationTreeContext.Provider value={value}>
      {children}
      <ConversationTreeDialog
        open={open}
        focusMessageId={focusMessageId}
        sourceMessageId={sourceMessageId}
        onOpenChange={(nextOpen) => {
          if (nextOpen) {
            const currentSession = sessionRef.current;
            const preservedFocusMessageId =
              currentSession.ownerConversationId === conversationId
                ? currentSession.focusMessageId
                : null;
            const preservedSourceMessageId =
              currentSession.ownerConversationId === conversationId
                ? currentSession.sourceMessageId
                : null;

            commitSession(
              buildSession(conversationId, true, preservedFocusMessageId, preservedSourceMessageId),
            );
            return;
          }

          closeTree();
        }}
        onExitComplete={handleExitComplete}
      />
    </GenerationTreeContext.Provider>
  );
}

export function useGenerationTree() {
  const context = useContext(GenerationTreeContext);

  if (context == null) {
    throw new Error('useGenerationTree must be used within GenerationTreeProvider');
  }

  return context;
}
