import { useAtom } from 'jotai';
import { useRef, useEffect } from 'react';
import type { TShowToast } from '~/common';
import { NotificationSeverity } from '~/common';
import { createToastState, toastState } from '~/store';

export default function useToast(showDelay = 100) {
  const [toast, setToast] = useAtom(toastState);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearTimers = () => {
    if (showTimerRef.current !== null) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const closeToast = () => {
    clearTimers();
    setToast(createToastState());
  };

  useEffect(() => {
    return () => {
      if (showTimerRef.current !== null) {
        clearTimeout(showTimerRef.current);
      }
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  const showToast = ({
    message,
    severity = NotificationSeverity.SUCCESS,
    showIcon = true,
    duration = 3000, // default duration for the toast to be visible
    status,
    actionLabel,
    onAction,
  }: TShowToast) => {
    clearTimers();

    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      setToast(
        createToastState({
          open: true,
          message,
          severity: (status as NotificationSeverity) ?? severity,
          showIcon,
          actionLabel,
          onAction,
        }),
      );
      hideTimerRef.current = window.setTimeout(() => {
        hideTimerRef.current = null;
        setToast(createToastState());
      }, duration);
    }, showDelay);
  };

  return {
    toast,
    onOpenChange: (open: boolean) => {
      if (open) {
        setToast((prevToast) => ({ ...prevToast, open }));
        return;
      }

      closeToast();
    },
    closeToast,
    showToast,
  };
}
