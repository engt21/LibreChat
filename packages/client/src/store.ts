import { atom } from 'jotai';
import { NotificationSeverity } from '~/common';

export const langAtom = atom<string>('en');
export const chatDirectionAtom = atom<string>('ltr');
export const fontSizeAtom = atom<string>('text-base');

export type ToastState = {
  open: boolean;
  message: string;
  severity: NotificationSeverity;
  showIcon: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export const createToastState = (overrides: Partial<ToastState> = {}): ToastState => ({
  open: false,
  message: '',
  severity: NotificationSeverity.SUCCESS,
  showIcon: true,
  actionLabel: undefined,
  onAction: undefined,
  ...overrides,
});

export const toastState = atom<ToastState>(createToastState());
