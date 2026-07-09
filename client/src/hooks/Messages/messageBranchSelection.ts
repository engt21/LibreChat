import { buildTree } from 'librechat-data-provider';
import type { TMessage } from 'librechat-data-provider';

export type MessageBranchSelection = {
  atomKey: string;
  siblingIndex: number;
};

function findMessagePath(
  messages: TMessage[],
  targetMessageId: string,
  path: TMessage[] = [],
): TMessage[] | null {
  for (const message of messages) {
    const nextPath = [...path, message];
    if (message.messageId === targetMessageId) {
      return nextPath;
    }

    const childPath = findMessagePath(message.children ?? [], targetMessageId, nextPath);
    if (childPath != null) {
      return childPath;
    }
  }

  return null;
}

export function getMessageBranchSelections(
  messages: TMessage[],
  targetMessageId: string,
  rootAtomKey: string,
): MessageBranchSelection[] {
  if (!rootAtomKey || !targetMessageId) {
    return [];
  }

  const messageTree = buildTree({ messages }) ?? [];
  const path = findMessagePath(messageTree, targetMessageId);
  if (path == null) {
    return [];
  }

  return path.flatMap((message, index) => {
    const parent = index === 0 ? null : path[index - 1];
    const siblings = parent?.children ?? messageTree;
    const visibleIndex = siblings.findIndex((sibling) => sibling.messageId === message.messageId);

    if (visibleIndex < 0) {
      return [];
    }

    return [
      {
        atomKey: parent?.messageId ?? rootAtomKey,
        siblingIndex: siblings.length - visibleIndex - 1,
      },
    ];
  });
}
