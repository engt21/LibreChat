import type { SearchResultData } from 'librechat-data-provider';

type UnknownRecord = Record<string, unknown>;

type GroundingMetadata = {
  groundingChunks?: unknown[];
  groundingSupports?: unknown[];
  webSearchQueries?: unknown[];
};

type GroundingReference = {
  link: string;
  title?: string;
  attribution?: string;
  snippet?: string;
  type: 'link';
};

type GroundingBundle = {
  searchResult: SearchResultData;
  chunkIndexMap: Map<number, number>;
};

const STANDALONE_MARKER = '\ue202';
const COMPOSITE_START = '\ue200';
const COMPOSITE_END = '\ue201';

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function getArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getDomain(link: string): string | undefined {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function findSegmentRangeByText(
  segmentText: string,
  text: string,
  preferredStartIndex?: number,
): { startIndex: number; endIndex: number } | undefined {
  const matches: number[] = [];
  let currentIndex = text.indexOf(segmentText);

  while (currentIndex !== -1) {
    matches.push(currentIndex);
    currentIndex = text.indexOf(segmentText, currentIndex + 1);
  }

  if (matches.length === 0) {
    return undefined;
  }

  const startIndex =
    preferredStartIndex == null
      ? matches[0]
      : matches.reduce((closest, index) => {
          return Math.abs(index - preferredStartIndex) < Math.abs(closest - preferredStartIndex)
            ? index
            : closest;
        }, matches[0]);

  return {
    startIndex,
    endIndex: startIndex + segmentText.length,
  };
}

function getTerminalContentChar(text: string, endIndex: number): string | undefined {
  let index = endIndex - 1;

  while (index >= 0 && /[\s*_`~\]})"'\u2019\u201d]/.test(text[index])) {
    index -= 1;
  }

  return index >= 0 ? text[index] : undefined;
}

function extendAnchorPastClosers(text: string, index: number): number {
  let nextIndex = index;

  while (nextIndex < text.length && /[*_`~\]})"'\u2019\u201d]/.test(text[nextIndex])) {
    nextIndex += 1;
  }

  return nextIndex;
}

function trimTrailingWhitespaceIndex(text: string, index: number): number {
  let nextIndex = index;

  while (nextIndex > 0 && /\s/.test(text[nextIndex - 1])) {
    nextIndex -= 1;
  }

  return nextIndex;
}

function isSentenceTerminal(char?: string): boolean {
  return char != null && /[.!?\u2026\u3002\uff01\uff1f]/.test(char);
}

function findNextSentenceEnd(
  text: string,
  startIndex: number,
  maxScanLength = 240,
): number | undefined {
  const maxIndex = Math.min(text.length, startIndex + maxScanLength);
  let sawContent = false;

  for (let index = startIndex; index < maxIndex; index += 1) {
    const char = text[index];

    if (!sawContent && /\s/.test(char)) {
      continue;
    }

    sawContent = true;

    if (isSentenceTerminal(char)) {
      return extendAnchorPastClosers(text, index + 1);
    }

    if (char === '\n') {
      const nextChar = text[index + 1];
      if (nextChar === '\n' || nextChar === '#') {
        return trimTrailingWhitespaceIndex(text, index);
      }
    }
  }

  return undefined;
}

function getNaturalCitationEnd(
  text: string,
  range: { startIndex: number; endIndex: number },
  segment: UnknownRecord,
): number {
  const segmentText = getString(segment.text)?.trimEnd();
  const extendedEndIndex = extendAnchorPastClosers(text, range.endIndex);
  const terminalChar = getTerminalContentChar(text, extendedEndIndex);

  if (
    (segmentText &&
      /[.!?\u2026\u3002\uff01\uff1f](?:[*_`~\]})"'\u2019\u201d]+)?$/.test(segmentText)) ||
    isSentenceTerminal(terminalChar)
  ) {
    return extendedEndIndex;
  }

  return findNextSentenceEnd(text, extendedEndIndex) ?? extendedEndIndex;
}

function getSegmentRange(segment: UnknownRecord, text: string, textOffset = 0) {
  const startIndex = getNumber(segment.startIndex);
  const endIndex = getNumber(segment.endIndex);
  const segmentText = getString(segment.text);

  const tryDirectTextMatch = () => {
    if (!segmentText) {
      return undefined;
    }

    const preferredStartIndex =
      startIndex != null && startIndex >= textOffset
        ? Math.max(startIndex - textOffset, 0)
        : undefined;

    return findSegmentRangeByText(segmentText, text, preferredStartIndex);
  };

  if (endIndex != null && endIndex > textOffset && endIndex <= textOffset + text.length) {
    const localEndIndex = endIndex - textOffset;
    const localStartIndex = startIndex != null ? Math.max(startIndex - textOffset, 0) : undefined;

    if (
      localStartIndex != null &&
      localStartIndex >= 0 &&
      localEndIndex > localStartIndex &&
      localEndIndex <= text.length
    ) {
      const localRange = { startIndex: localStartIndex, endIndex: localEndIndex };

      if (!segmentText || text.slice(localRange.startIndex, localRange.endIndex) === segmentText) {
        return localRange;
      }

      const directMatchRange = tryDirectTextMatch();
      if (directMatchRange) {
        return directMatchRange;
      }
    }

    if (localEndIndex > 0 && localEndIndex <= text.length) {
      const directMatchRange = tryDirectTextMatch();
      if (directMatchRange) {
        return directMatchRange;
      }

      return { startIndex: Math.max(localEndIndex - 1, 0), endIndex: localEndIndex };
    }
  }

  if (
    startIndex != null &&
    endIndex != null &&
    startIndex >= 0 &&
    endIndex > startIndex &&
    endIndex <= text.length
  ) {
    const directRange = { startIndex, endIndex };

    if (!segmentText || text.slice(directRange.startIndex, directRange.endIndex) === segmentText) {
      return directRange;
    }

    const directMatchRange = tryDirectTextMatch();
    if (directMatchRange) {
      return directMatchRange;
    }
  }

  if (!segmentText) {
    return undefined;
  }

  return tryDirectTextMatch();
}

function getSupportChunkIndices(support: UnknownRecord): number[] {
  const groundingChunkIndices = Array.isArray(support.groundingChunkIndices)
    ? support.groundingChunkIndices
    : [];

  return groundingChunkIndices.filter((index): index is number => typeof index === 'number');
}

function extractGroundingReference(chunk: unknown): GroundingReference | undefined {
  const chunkRecord = asRecord(chunk);
  if (!chunkRecord) {
    return undefined;
  }

  const nestedSource =
    asRecord(chunkRecord.web) ??
    asRecord(chunkRecord.retrievedContext) ??
    asRecord(chunkRecord.source) ??
    chunkRecord;

  const link =
    getString(nestedSource.uri) ??
    getString(nestedSource.url) ??
    getString(chunkRecord.uri) ??
    getString(chunkRecord.url);

  if (!link) {
    return undefined;
  }

  return {
    type: 'link',
    link,
    title:
      getString(nestedSource.title) ??
      getString(chunkRecord.title) ??
      getString(nestedSource.domain) ??
      getDomain(link),
    attribution:
      getString(nestedSource.domain) ??
      getString(nestedSource.attribution) ??
      getString(chunkRecord.attribution) ??
      getDomain(link),
    snippet:
      getString(nestedSource.snippet) ??
      getString(chunkRecord.snippet) ??
      getString(nestedSource.text) ??
      getString(chunkRecord.text),
  };
}

export function extractGroundingMetadata(metadata?: UnknownRecord): GroundingMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  const normalizeGroundingMetadata = (candidate?: UnknownRecord): GroundingMetadata | undefined => {
    if (!candidate) {
      return undefined;
    }

    const groundingChunks =
      getArray(candidate.groundingChunks) ?? getArray(candidate.grounding_chunks);
    const groundingSupports =
      getArray(candidate.groundingSupports) ??
      getArray(candidate.grounding_supports) ??
      getArray(candidate.groundingSupport) ??
      getArray(candidate.grounding_support) ??
      (candidate.groundingSupport != null ? [candidate.groundingSupport] : undefined) ??
      (candidate.grounding_support != null ? [candidate.grounding_support] : undefined);
    const webSearchQueries =
      getArray(candidate.webSearchQueries) ?? getArray(candidate.web_search_queries);

    if (!groundingChunks && !groundingSupports && !webSearchQueries) {
      return undefined;
    }

    return {
      groundingChunks,
      groundingSupports,
      webSearchQueries,
    };
  };

  const candidates = [
    metadata,
    asRecord(metadata.groundingMetadata),
    asRecord(metadata.grounding_metadata),
    asRecord(asRecord(metadata.response_metadata)?.groundingMetadata),
    asRecord(asRecord(metadata.response_metadata)?.grounding_metadata),
    asRecord(asRecord(metadata.additional_kwargs)?.groundingMetadata),
    asRecord(asRecord(metadata.additional_kwargs)?.grounding_metadata),
  ].filter((candidate): candidate is UnknownRecord => candidate != null);

  for (const candidate of candidates) {
    const groundingMetadata = normalizeGroundingMetadata(candidate);
    if (groundingMetadata) {
      return groundingMetadata;
    }
  }

  return undefined;
}

function buildGroundingBundle(metadata?: UnknownRecord, turn = 0): GroundingBundle | undefined {
  const groundingMetadata = extractGroundingMetadata(metadata);
  if (!groundingMetadata?.groundingChunks?.length) {
    return undefined;
  }

  const references: GroundingReference[] = [];
  const chunkIndexMap = new Map<number, number>();
  const linkIndexMap = new Map<string, number>();

  groundingMetadata.groundingChunks.forEach((chunk, chunkIndex) => {
    const reference = extractGroundingReference(chunk);
    if (!reference) {
      return;
    }

    let referenceIndex = linkIndexMap.get(reference.link);
    if (referenceIndex == null) {
      referenceIndex = references.length;
      references.push(reference);
      linkIndexMap.set(reference.link, referenceIndex);
    }

    chunkIndexMap.set(chunkIndex, referenceIndex);
  });

  if (references.length === 0) {
    return undefined;
  }

  return {
    searchResult: {
      turn,
      references: references as SearchResultData['references'],
    },
    chunkIndexMap,
  };
}

export function groundingMetadataToSearchResult(
  metadata?: UnknownRecord,
  turn = 0,
): SearchResultData | undefined {
  return buildGroundingBundle(metadata, turn)?.searchResult;
}

export function injectGroundingCitations(
  text: string,
  metadata?: UnknownRecord,
  turn = 0,
  textOffset = 0,
): string {
  if (!text || text.includes(STANDALONE_MARKER)) {
    return text;
  }

  const groundingMetadata = extractGroundingMetadata(metadata);
  if (!groundingMetadata?.groundingSupports?.length) {
    return text;
  }

  const groundingBundle = buildGroundingBundle(metadata, turn);
  if (!groundingBundle) {
    return text;
  }

  const groupedSupports = new Map<string, { endIndex: number; refs: Set<number> }>();

  groundingMetadata.groundingSupports.forEach((support) => {
    const supportRecord = asRecord(support);
    const segment = asRecord(supportRecord?.segment);

    if (!supportRecord || !segment) {
      return;
    }

    const range = getSegmentRange(segment, text, textOffset);
    if (!range) {
      return;
    }

    const refs = getSupportChunkIndices(supportRecord)
      .map((index) => groundingBundle.chunkIndexMap.get(index))
      .filter((index): index is number => index != null);

    if (refs.length === 0) {
      return;
    }

    const naturalEndIndex = getNaturalCitationEnd(text, range, segment);
    const key = `${naturalEndIndex}`;
    const existing = groupedSupports.get(key) ?? {
      endIndex: naturalEndIndex,
      refs: new Set<number>(),
    };

    refs.forEach((ref) => existing.refs.add(ref));
    groupedSupports.set(key, existing);
  });

  if (groupedSupports.size === 0) {
    return text;
  }

  const sortedSupports = Array.from(groupedSupports.values()).sort(
    (a, b) => b.endIndex - a.endIndex,
  );

  let annotatedText = text;

  sortedSupports.forEach(({ endIndex, refs }) => {
    const refIndices = Array.from(refs).sort((a, b) => a - b);
    if (refIndices.length === 0) {
      return;
    }

    const marker =
      refIndices.length === 1
        ? `${STANDALONE_MARKER}turn${turn}ref${refIndices[0]}`
        : `${COMPOSITE_START}${refIndices
            .map((refIndex) => `${STANDALONE_MARKER}turn${turn}ref${refIndex}`)
            .join('')}${COMPOSITE_END}`;

    annotatedText = `${annotatedText.slice(0, endIndex)}${marker}${annotatedText.slice(endIndex)}`;
  });

  return annotatedText;
}
