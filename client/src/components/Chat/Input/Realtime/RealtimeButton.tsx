import { useState } from 'react';
import { useRecoilValue } from 'recoil';
import { Constants } from 'librechat-data-provider';
import { Radio } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { cn } from '~/utils';
import RealtimeDialog from './RealtimeDialog';
import { useChatContext } from '~/Providers';
import { ephemeralAgentByConvoId } from '~/store';

type RealtimeButtonProps = {
  disabled?: boolean;
  currentEndpoint?: string | null;
  currentModel?: string | null;
};

export default function RealtimeButton({
  disabled = false,
  currentEndpoint,
  currentModel,
}: RealtimeButtonProps) {
  const [open, setOpen] = useState(false);
  const { getMessages, latestMessageId } = useChatContext();
  const conversationId = getMessages()?.[0]?.conversationId ?? Constants.NEW_CONVO;
  const ephemeralAgent = useRecoilValue(ephemeralAgentByConvoId(conversationId));
  const webSearchEnabled = ephemeralAgent?.web_search === true;

  return (
    <>
      <TooltipAnchor
        description="Open realtime voice dialog"
        render={
          <button
            id="realtime-button"
            type="button"
            aria-label="Open realtime voice dialog"
            onClick={() => setOpen(true)}
            disabled={disabled}
            className={cn(
              'flex size-9 items-center justify-center rounded-full p-1 transition-colors hover:bg-surface-hover',
            )}
            title="Open realtime voice dialog"
          >
            <Radio className="stroke-text-secondary" />
          </button>
        }
      />
      <RealtimeDialog
        open={open}
        setOpen={setOpen}
        currentEndpoint={currentEndpoint}
        currentModel={currentModel}
        conversationId={conversationId}
        parentMessageId={latestMessageId ?? undefined}
        contextEntries={(getMessages() ?? [])
          .filter((message) => message.text && !message.error)
          .slice(-24)
          .map((message) => ({
            role: message.isCreatedByUser ? 'user' : 'assistant',
            text: message.text,
            source: 'text' as const,
          }))}
        tools={webSearchEnabled ? ['web_search'] : []}
      />
    </>
  );
}
