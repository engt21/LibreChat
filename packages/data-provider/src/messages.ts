import type { TFile } from './types/files';
import type { TMessage } from './types';

export type TConversationUsageTurn = {
  messageId: string;
  createdAt?: string;
  model?: string;
  endpoint?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  estimated: boolean;
};

export type TConversationUsage = {
  conversationId: string;
  totals: Omit<
    TConversationUsageTurn,
    'messageId' | 'createdAt' | 'model' | 'endpoint' | 'estimated'
  >;
  turns: TConversationUsageTurn[];
};

export type ParentMessage = TMessage & { children: TMessage[]; depth: number };
export function buildTree({
  messages,
  fileMap,
}: {
  messages: (TMessage | undefined)[] | null;
  fileMap?: Record<string, TFile>;
}) {
  if (messages === null) {
    return null;
  }

  const messageMap: Record<string, ParentMessage> = {};
  const rootMessages: TMessage[] = [];
  const childrenCount: Record<string, number> = {};

  messages.forEach((message) => {
    if (!message) {
      return;
    }
    const parentId = message.parentMessageId ?? '';
    childrenCount[parentId] = (childrenCount[parentId] || 0) + 1;

    const extendedMessage: ParentMessage = {
      ...message,
      children: [],
      depth: 0,
      siblingIndex: childrenCount[parentId] - 1,
    };

    if (message.files && fileMap) {
      extendedMessage.files = message.files.map((file) => fileMap[file.file_id ?? ''] ?? file);
    }

    messageMap[message.messageId] = extendedMessage;

    const parentMessage = messageMap[parentId];
    if (parentMessage) {
      parentMessage.children.push(extendedMessage);
      extendedMessage.depth = parentMessage.depth + 1;
    } else {
      rootMessages.push(extendedMessage);
    }
  });

  return rootMessages;
}
