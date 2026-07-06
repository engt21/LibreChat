import { useCallback, useEffect, useRef } from 'react';
import { OGDialog, OGDialogContent, OGDialogTitle } from '@librechat/client';
import useLocalize from '~/hooks/useLocalize';

const EXIT_RESET_DELAY_MS = 200;

type ConversationTreeDialogProps = {
  open: boolean;
  focusMessageId: string | null;
  sourceMessageId: string | null;
  onOpenChange: (open: boolean) => void;
  onExitComplete?: () => void;
};

export default function ConversationTreeDialog({
  open,
  focusMessageId,
  sourceMessageId,
  onOpenChange,
  onExitComplete,
}: ConversationTreeDialogProps) {
  const localize = useLocalize();
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitCompletedRef = useRef(false);

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

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent
        data-testid="generation-tree-dialog"
        data-focused-message-id={focusMessageId ?? ''}
        data-source-message-id={sourceMessageId ?? ''}
        className="h-[85vh] max-h-[85vh] w-[96vw] max-w-5xl overflow-hidden border-border-light bg-surface-primary p-0 text-text-primary"
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
        <div className="flex h-full flex-col">
          <OGDialogTitle className="border-b border-border-light px-4 py-3 text-base font-semibold">
            {localize('com_sidepanel_conversation_tree')}
          </OGDialogTitle>
          <div className="flex flex-1 flex-col gap-3 px-4 py-3">
            <p className="text-sm text-text-secondary">
              {localize('com_ui_conversation_tree_description')}
            </p>
            <div className="grid gap-2 rounded-lg border border-dashed border-border-medium bg-surface-secondary p-3 text-sm text-text-secondary">
              <div>
                <span className="font-medium text-text-primary">
                  {localize('com_ui_generation_tree_source')}:
                </span>{' '}
                {sourceMessageId ?? localize('com_ui_none')}
              </div>
              <div>
                <span className="font-medium text-text-primary">
                  {localize('com_ui_generation_tree_destination')}:
                </span>{' '}
                {focusMessageId ?? localize('com_ui_none')}
              </div>
            </div>
          </div>
        </div>
      </OGDialogContent>
    </OGDialog>
  );
}
