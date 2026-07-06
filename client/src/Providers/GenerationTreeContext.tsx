import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
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

const GenerationTreeContext = createContext<GenerationTreeContextValue | undefined>(undefined);

export function GenerationTreeProvider({ children }: { children: React.ReactNode }) {
  const { conversation } = useChatContext();
  const conversationId = conversation?.conversationId ?? null;
  const previousConversationIdRef = useRef<string | null>(conversationId);
  const openRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    if (previousConversationIdRef.current === conversationId) {
      return;
    }

    previousConversationIdRef.current = conversationId;
    openRef.current = false;
    setOpen(false);
    setFocusMessageId(null);
    setSourceMessageId(null);
  }, [conversationId]);

  const openTree = useCallback((options?: OpenGenerationTreeOptions) => {
    openRef.current = true;
    setFocusMessageId(options?.focusMessageId ?? null);
    setSourceMessageId(options?.sourceMessageId ?? null);
    setOpen(true);
  }, []);

  const closeTree = useCallback(() => {
    openRef.current = false;
    setOpen(false);
  }, []);

  const handleExitComplete = useCallback(() => {
    if (openRef.current) {
      return;
    }

    setFocusMessageId(null);
    setSourceMessageId(null);
  }, []);

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
            openRef.current = true;
            setOpen(true);
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
