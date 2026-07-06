import { useSetRecoilState } from 'recoil';
import type { QueryClient } from '@tanstack/react-query';
import { QueryKeys, Tools } from 'librechat-data-provider';
import type {
  MemoriesResponse,
  EventSubmission,
  TAttachment,
  TFile,
} from 'librechat-data-provider';
import { handleMemoryArtifact } from '~/utils/memory';
import store from '~/store';

export function mergeStreamingAttachment(
  attachments: TAttachment[],
  incoming: TAttachment,
): TAttachment[] {
  const incomingIsImageStream =
    incoming.partial != null ||
    incoming.partialImageIndex != null ||
    incoming.filepath?.startsWith('data:image/');

  if (!incomingIsImageStream) {
    const partialIndex = attachments.findIndex(
      (attachment) => attachment.toolCallId === incoming.toolCallId && attachment.partial != null,
    );

    if (partialIndex < 0) {
      return [...attachments, incoming];
    }

    const next = [...attachments];
    next[partialIndex] = incoming;
    return next;
  }

  const streamIndex = attachments.findIndex(
    (attachment) =>
      attachment.toolCallId === incoming.toolCallId &&
      (attachment.partial != null ||
        attachment.partialImageIndex != null ||
        attachment.filepath?.startsWith('data:image/')),
  );

  if (streamIndex < 0) {
    return [...attachments, incoming];
  }

  const next = [...attachments];
  next[streamIndex] = incoming;
  return next;
}

export default function useAttachmentHandler(queryClient?: QueryClient) {
  const setAttachmentsMap = useSetRecoilState(store.messageAttachmentsMap);

  return ({ data }: { data: TAttachment; submission: EventSubmission }) => {
    const { messageId } = data;

    const fileData = data as TFile;
    if (
      queryClient &&
      fileData?.file_id &&
      fileData?.filepath &&
      !fileData.filepath.includes('/api/files')
    ) {
      queryClient.setQueryData([QueryKeys.files], (oldData: TFile[] | undefined) => {
        if (!oldData) {
          return [fileData];
        }
        const existingIndex = oldData.findIndex((file) => file.file_id === fileData.file_id);
        if (existingIndex > -1) {
          const updated = [...oldData];
          updated[existingIndex] = { ...oldData[existingIndex], ...fileData };
          return updated;
        }
        return [fileData, ...oldData];
      });
    }

    if (queryClient && data.type === Tools.memory && data[Tools.memory]) {
      const memoryArtifact = data[Tools.memory];

      queryClient.setQueryData([QueryKeys.memories], (oldData: MemoriesResponse | undefined) => {
        if (!oldData) {
          return oldData;
        }

        return handleMemoryArtifact({ memoryArtifact, currentData: oldData }) || oldData;
      });
    }

    setAttachmentsMap((prevMap) => {
      const messageAttachments =
        (prevMap as Record<string, TAttachment[] | undefined>)[messageId] || [];
      return {
        ...prevMap,
        [messageId]: mergeStreamingAttachment(messageAttachments, data),
      };
    });
  };
}
