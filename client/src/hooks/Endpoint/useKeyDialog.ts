import { useState, useCallback, useMemo } from 'react';
import { EModelEndpoint } from 'librechat-data-provider';

export const useKeyDialog = () => {
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);
  const [keyDialogEndpoint, setKeyDialogEndpoint] = useState<EModelEndpoint | null>(null);
  const [keyDialogTrigger, setKeyDialogTrigger] = useState<HTMLElement | null>(null);

  const handleOpenKeyDialog = useCallback(
    (ep: EModelEndpoint, e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setKeyDialogTrigger(e.currentTarget instanceof HTMLElement ? e.currentTarget : null);
      setKeyDialogEndpoint(ep);
      setKeyDialogOpen(true);
    },
    [],
  );

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open && keyDialogTrigger) {
        setTimeout(() => {
          keyDialogTrigger.focus();
        }, 5);
      }

      if (!open) {
        setKeyDialogTrigger(null);
      }

      setKeyDialogOpen(open);
    },
    [keyDialogTrigger],
  );

  return useMemo(
    () => ({
      keyDialogOpen,
      keyDialogEndpoint,
      onOpenChange,
      handleOpenKeyDialog,
    }),
    [keyDialogOpen, keyDialogEndpoint, onOpenChange, handleOpenKeyDialog],
  );
};

export default useKeyDialog;
