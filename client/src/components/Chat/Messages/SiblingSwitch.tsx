import { useState } from 'react';
import axios from 'axios';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { useDeleteMessageBranchMutation } from 'librechat-data-provider/react-query';
import {
  Button,
  Spinner,
  OGDialog,
  OGDialogClose,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogContent,
  useToastContext,
} from '@librechat/client';
import type { TMessageProps } from '~/common';
import { NotificationSeverity } from '~/common';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type TSiblingSwitchProps = Pick<
  TMessageProps,
  'message' | 'siblingIdx' | 'siblingCount' | 'setSiblingIdx'
>;

export default function SiblingSwitch({
  siblingIdx,
  siblingCount,
  setSiblingIdx,
  message,
}: TSiblingSwitchProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const conversationId = message?.conversationId ?? '';
  const messageId = message?.messageId ?? '';
  const isGenerationActive = message?.unfinished === true;
  const canDeleteGeneration = message != null && !message.isCreatedByUser;
  const deleteBranch = useDeleteMessageBranchMutation(conversationId);

  if (siblingIdx === undefined) {
    return null;
  } else if (siblingCount === undefined) {
    return null;
  }

  const previous = () => {
    setSiblingIdx && setSiblingIdx(siblingIdx - 1);
  };

  const next = () => {
    setSiblingIdx && setSiblingIdx(siblingIdx + 1);
  };

  const discardRoute = () => {
    if (!conversationId || !messageId || isGenerationActive || deleteBranch.isLoading) {
      return;
    }

    deleteBranch.mutate(
      { conversationId, messageId },
      {
        onSuccess: () => {
          setConfirmDelete(false);
          showToast({
            message: 'Generation tree deleted',
            severity: NotificationSeverity.SUCCESS,
            showIcon: true,
          });
        },
        onError: (error) => {
          const responseMessage = axios.isAxiosError<{ error?: string }>(error)
            ? error.response?.data?.error
            : undefined;
          showToast({
            message: responseMessage ?? 'Failed to delete generation route',
            severity: NotificationSeverity.ERROR,
            showIcon: true,
          });
        },
      },
    );
  };

  const buttonStyle = cn(
    'hover-button rounded-lg p-1.5 text-text-secondary-alt',
    'hover:text-text-primary hover:bg-surface-hover',
    'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
    'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
  );

  return siblingCount > 1 || canDeleteGeneration ? (
    <>
      <nav
        className="visible flex items-center justify-center gap-2 self-center pt-0 text-xs"
        aria-label="Sibling message navigation"
      >
        {siblingCount > 1 && (
          <>
            <button
              className={buttonStyle}
              type="button"
              onClick={previous}
              disabled={siblingIdx == 0}
              aria-label="Previous sibling message"
              aria-disabled={siblingIdx == 0}
            >
              <ChevronLeft size="19" aria-hidden="true" />
            </button>
            <span
              className="flex-shrink-0 flex-grow tabular-nums"
              aria-live="polite"
              aria-atomic="true"
              role="status"
            >
              {siblingIdx + 1} / {siblingCount}
            </span>
            <button
              className={buttonStyle}
              type="button"
              onClick={next}
              disabled={siblingIdx == siblingCount - 1}
              aria-label="Next sibling message"
              aria-disabled={siblingIdx == siblingCount - 1}
            >
              <ChevronRight size="19" aria-hidden="true" />
            </button>
          </>
        )}
        {canDeleteGeneration && (
          <button
            className={cn(buttonStyle, 'text-red-500 hover:text-red-600')}
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={isGenerationActive || deleteBranch.isLoading}
            aria-label="Delete generation tree"
          >
            <Trash2 size="17" aria-hidden="true" />
          </button>
        )}
      </nav>
      <OGDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <OGDialogContent
          className="w-11/12 max-w-md"
          showCloseButton={false}
          aria-describedby="delete-generation-route-description"
        >
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_ui_delete_generation_route_title')}</OGDialogTitle>
          </OGDialogHeader>
          <p id="delete-generation-route-description" className="text-sm text-text-secondary">
            {localize('com_ui_delete_generation_route_description')}
          </p>
          <div className="flex justify-end gap-4 pt-4">
            <OGDialogClose asChild>
              <Button variant="outline">{localize('com_ui_cancel')}</Button>
            </OGDialogClose>
            <Button
              variant="destructive"
              onClick={discardRoute}
              disabled={
                !conversationId || !messageId || isGenerationActive || deleteBranch.isLoading
              }
            >
              {deleteBranch.isLoading ? <Spinner /> : localize('com_ui_delete_generation_route')}
            </Button>
          </div>
        </OGDialogContent>
      </OGDialog>
    </>
  ) : null;
}
