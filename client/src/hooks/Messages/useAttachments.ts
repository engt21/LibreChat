import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';
import type { TAttachment, TMessage } from 'librechat-data-provider';
import { useSearchResultsByTurn } from './useSearchResultsByTurn';
import store from '~/store';

export default function useAttachments({
  messageId,
  attachments,
  message,
}: {
  messageId?: string;
  attachments?: TAttachment[];
  message?: Pick<TMessage, 'metadata'>;
}) {
  const messageAttachmentsMap = useRecoilValue(store.messageAttachmentsMap);
  const messageAttachments = useMemo(
    () => attachments ?? messageAttachmentsMap[messageId ?? ''] ?? [],
    [attachments, messageAttachmentsMap, messageId],
  );

  const searchResults = useSearchResultsByTurn({
    attachments: messageAttachments,
    messageMetadata: message?.metadata,
  });

  return {
    attachments: messageAttachments,
    searchResults,
  };
}
