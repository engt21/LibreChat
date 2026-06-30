import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';
import { mergeThinkingText } from './mergeThinkingText';

export { mergeThinkingText } from './mergeThinkingText';

export type IndexedContentPart = {
  idx: number;
  part: TMessageContentParts;
};

const PREFIX_ONLY_FRAGMENT_MAX_LENGTH = 24;
const SUBSTANTIAL_REASONING_LENGTH = 80;

function getThinkText(part?: TMessageContentParts): string | undefined {
  if (part?.type !== ContentTypes.THINK) {
    return undefined;
  }

  return typeof part.think === 'string' ? part.think : part.think?.value;
}

function isPrefixOnlyThinkingFragment(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('**') &&
    !trimmed.endsWith('**') &&
    !trimmed.includes('\n') &&
    trimmed.length <= PREFIX_ONLY_FRAGMENT_MAX_LENGTH
  );
}

function shouldSkipOrphanPrefixFragment(
  currentText: string | undefined,
  fragmentText: string,
  nextText: string | undefined,
): boolean {
  if (!currentText || !isPrefixOnlyThinkingFragment(fragmentText)) {
    return false;
  }

  const currentLooksSubstantial =
    currentText.length >= SUBSTANTIAL_REASONING_LENGTH || currentText.includes('\n');
  if (!currentLooksSubstantial) {
    return false;
  }

  if (!nextText) {
    return true;
  }

  return isPrefixOnlyThinkingFragment(nextText);
}

export function mergeAdjacentThinkingParts(
  content: Array<TMessageContentParts | undefined> | undefined,
): IndexedContentPart[] {
  if (!content) {
    return [];
  }

  const merged: IndexedContentPart[] = [];

  for (let idx = 0; idx < content.length; idx += 1) {
    const part = content[idx];
    if (!part) {
      continue;
    }

    const thinkText = getThinkText(part);
    const previousEntry = merged.at(-1);
    const previousThinkText = previousEntry ? getThinkText(previousEntry.part) : undefined;
    const nextThinkText = getThinkText(content[idx + 1]);

    if (
      thinkText != null &&
      shouldSkipOrphanPrefixFragment(previousThinkText, thinkText, nextThinkText)
    ) {
      continue;
    }

    if (
      thinkText != null &&
      previousEntry?.part.type === ContentTypes.THINK &&
      previousEntry.part.groupId === part.groupId &&
      previousEntry.part.agentId === part.agentId
    ) {
      const mergedThinkText = mergeThinkingText(previousThinkText ?? '', thinkText);
      previousEntry.part = {
        ...previousEntry.part,
        think: mergedThinkText,
      };
      continue;
    }

    merged.push({ idx, part });
  }

  return merged;
}
