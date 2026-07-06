import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dataService, QueryKeys } from 'librechat-data-provider';
import type * as t from 'librechat-data-provider';

const appendCreatedMessages = (
  previousMessages: t.TMessage[] | undefined,
  createdMessages: t.TMessage[] | undefined,
) => {
  const existingMessages = previousMessages ?? [];
  const seenMessageIds = new Set(existingMessages.map((message) => message.messageId));
  const nextMessages = [...existingMessages];

  for (const message of createdMessages ?? []) {
    if (seenMessageIds.has(message.messageId)) {
      continue;
    }

    seenMessageIds.add(message.messageId);
    nextMessages.push(message);
  }

  return nextMessages;
};

const invalidateGenerationGraftQueries = (queryClient: ReturnType<typeof useQueryClient>, conversationId: string) => {
  void queryClient.invalidateQueries({ queryKey: [QueryKeys.messages, conversationId] });
  void queryClient.invalidateQueries({ queryKey: [QueryKeys.toolCalls, conversationId] });
  void queryClient.invalidateQueries({ queryKey: [QueryKeys.conversationUsage, conversationId] });
};

export const generationGraftDetailsQueryKey = (conversationId: string, graftId: string) =>
  ['generationGraft', conversationId, graftId] as const;

export function usePreviewGenerationGraft(conversationId: string) {
  return useMutation({
    mutationFn: (payload: t.TGenerationGraftPreviewRequest) =>
      dataService.previewGenerationGraft(conversationId, payload),
  });
}

export function useCreateGenerationGraft(conversationId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: t.TGenerationGraftCreateRequest) =>
      dataService.createGenerationGraft(conversationId, payload),
    onSuccess: (data) => {
      queryClient.setQueryData<t.TMessage[]>([QueryKeys.messages, conversationId], (previous) =>
        appendCreatedMessages(previous, data.createdMessages),
      );
      invalidateGenerationGraftQueries(queryClient, conversationId);
    },
  });
}

export function useGenerationGraftDetails(
  conversationId: string,
  graftId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: generationGraftDetailsQueryKey(conversationId, graftId),
    queryFn: () => dataService.getGenerationGraft(conversationId, graftId),
    enabled: enabled && Boolean(conversationId) && Boolean(graftId),
    retry: false,
  });
}

export function useUndoGenerationGraft(conversationId: string, graftId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: t.TGenerationGraftUndoRequest) =>
      dataService.undoGenerationGraft(conversationId, graftId, payload),
    onSuccess: () => {
      invalidateGenerationGraftQueries(queryClient, conversationId);
    },
  });
}
