import { GitMerge, Network } from 'lucide-react';
import type { TMessage } from 'librechat-data-provider';
import useLocalize from '~/hooks/useLocalize';
import { useGenerationTree } from '~/Providers';
import { cn } from '~/utils';

const baseButtonClassName = cn(
  'hover-button rounded-lg p-1.5 text-text-secondary-alt',
  'hover:bg-surface-hover hover:text-text-primary',
  'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white',
);

export default function GenerationTreeActions({
  message,
  isLast = false,
}: {
  message: Partial<TMessage>;
  isLast?: boolean;
}) {
  const localize = useLocalize();
  const { openTree } = useGenerationTree();
  const messageId = message.messageId;
  const buttonClassName = cn(
    baseButtonClassName,
    message.error !== true &&
      isLast !== true &&
      'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
  );

  if (message.isCreatedByUser !== false || !messageId) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        title={localize('com_ui_view_in_conversation_tree')}
        aria-label={localize('com_ui_view_in_conversation_tree')}
        onClick={() => openTree({ focusMessageId: messageId })}
      >
        <Network size={19} />
      </button>
      <button
        type="button"
        className={buttonClassName}
        title={localize('com_ui_graft_generation')}
        aria-label={localize('com_ui_graft_generation')}
        onClick={() =>
          openTree({
            focusMessageId: messageId,
            sourceMessageId: messageId,
          })
        }
      >
        <GitMerge size={19} />
      </button>
    </>
  );
}
