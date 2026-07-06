import { memo } from 'react';
import { Spinner } from '@librechat/client';
import { useLocalize } from '~/hooks';

const PlaceholderRow = memo(function PlaceholderRow() {
  const localize = useLocalize();

  return (
    <div
      className="mt-1 flex min-h-[31px] items-center gap-2 text-sm text-text-secondary"
      role="status"
      aria-live="polite"
    >
      <Spinner className="size-4" />
      <span>{localize('com_ui_generating')}</span>
    </div>
  );
});
PlaceholderRow.displayName = 'PlaceholderRow';

export default PlaceholderRow;
