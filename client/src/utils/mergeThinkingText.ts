function isLikelyContinuationFragment(text: string): boolean {
  const trimmedStart = text.trimStart();

  if (!trimmedStart) {
    return true;
  }

  return /^[a-z0-9'"`([{.,;:!?-]/u.test(trimmedStart);
}

function shouldInsertReasoningBreak(previous: string, next: string): boolean {
  const trimmedNext = next.trimStart();
  if (!trimmedNext || next.startsWith('\n') || /\s$/u.test(previous)) {
    return false;
  }

  if (/^(\*\*|#{1,6}\s|[-*]\s|\d+\.\s)/u.test(trimmedNext)) {
    return true;
  }

  return /^[A-Z]/u.test(trimmedNext) && /[.!?]$/u.test(previous.trimEnd());
}

export function mergeThinkingText(previous: string, next: string): string {
  if (!previous) {
    return next;
  }

  if (!next) {
    return previous;
  }

  if (next.startsWith('\n') || /\s$/u.test(previous) || isLikelyContinuationFragment(next)) {
    return previous + next;
  }

  if (shouldInsertReasoningBreak(previous, next)) {
    return `${previous}\n\n${next}`;
  }

  return previous + next;
}
