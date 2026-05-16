import { useState } from 'react';
import { Radio } from 'lucide-react';
import { TooltipAnchor } from '@librechat/client';
import { cn } from '~/utils';
import RealtimeDialog from './RealtimeDialog';

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
      />
    </>
  );
}
