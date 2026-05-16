import { memo } from 'react';
import { Search } from 'lucide-react';
import { cn } from '~/utils';

type WebSearchStatusProps = {
  status: string;
  isLast: boolean;
};

const statusLabels: Record<string, string> = {
  in_progress: 'Searching the web\u2026',
  searching: 'Searching the web\u2026',
  completed: 'Web search complete',
};

/**
 * Shows an inline activity indicator when a provider's native web search
 * (e.g. OpenAI web_search_preview) is running.
 *
 * Receives status transitions via on_web_search_status events:
 * in_progress -> searching -> completed
 */
const WebSearchStatus = memo(({ status, isLast }: WebSearchStatusProps) => {
  const isActive = status !== 'completed';
  const label = statusLabels[status] ?? `Web search: ${status}`;

  // Once completed and no longer the latest streaming part, hide entirely
  if (!isActive && !isLast) {
    return null;
  }

  return (
    <div
      className={cn(
        'my-1 flex items-center gap-2 text-sm text-text-secondary transition-opacity duration-300',
        isActive ? 'opacity-100' : 'opacity-0',
      )}
    >
      <Search className={cn('h-4 w-4 flex-shrink-0', isActive && 'animate-pulse')} />
      <span>{label}</span>
      {isActive && (
        <span className="inline-flex gap-0.5">
          <span className="animate-bounce" style={{ animationDelay: '0ms' }}>
            .
          </span>
          <span className="animate-bounce" style={{ animationDelay: '150ms' }}>
            .
          </span>
          <span className="animate-bounce" style={{ animationDelay: '300ms' }}>
            .
          </span>
        </span>
      )}
    </div>
  );
});

WebSearchStatus.displayName = 'WebSearchStatus';

export default WebSearchStatus;
