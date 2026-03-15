import {
  extractGroundingMetadata,
  groundingMetadataToSearchResult,
  injectGroundingCitations,
} from '../googleGrounding';

describe('googleGrounding utils', () => {
  const metadata = {
    response_metadata: {
      groundingMetadata: {
        groundingChunks: [
          {
            web: {
              uri: 'https://ai.google.dev/gemini-api/docs/google-search',
              title: 'Grounding with Google Search',
            },
          },
          {
            web: {
              uri: 'https://ai.google.dev/gemini-api/docs/google-search',
              title: 'Grounding with Google Search',
            },
          },
          {
            web: {
              uri: 'https://example.com/report',
              title: 'Example Report',
            },
          },
        ],
        groundingSupports: [
          {
            segment: {
              text: 'Alpha',
              startIndex: 0,
              endIndex: 5,
            },
            groundingChunkIndices: [0],
          },
          {
            segment: {
              text: 'Beta',
              startIndex: 6,
              endIndex: 10,
            },
            groundingChunkIndices: [1, 2],
          },
        ],
        webSearchQueries: ['gemini google search grounding'],
      },
    },
  };

  test('extracts nested grounding metadata', () => {
    const groundingMetadata = extractGroundingMetadata(metadata);

    expect(groundingMetadata).toBeDefined();
    expect(groundingMetadata?.groundingChunks).toHaveLength(3);
    expect(groundingMetadata?.groundingSupports).toHaveLength(2);
  });

  test('extracts snake_case grounding metadata from additional_kwargs', () => {
    const groundingMetadata = extractGroundingMetadata({
      additional_kwargs: {
        grounding_metadata: {
          grounding_chunks: [{ web: { uri: 'https://example.com/live', title: 'Live Source' } }],
          grounding_support: {
            segment: {
              text: 'Live',
              startIndex: 0,
              endIndex: 4,
            },
            groundingChunkIndices: [0],
          },
          web_search_queries: ['latest live news'],
        },
      },
    });

    expect(groundingMetadata).toEqual({
      groundingChunks: [{ web: { uri: 'https://example.com/live', title: 'Live Source' } }],
      groundingSupports: [
        {
          segment: {
            text: 'Live',
            startIndex: 0,
            endIndex: 4,
          },
          groundingChunkIndices: [0],
        },
      ],
      webSearchQueries: ['latest live news'],
    });
  });

  test('maps grounding chunks into search result references', () => {
    const searchResult = groundingMetadataToSearchResult(metadata, 3);

    expect(searchResult).toEqual({
      turn: 3,
      references: [
        {
          type: 'link',
          link: 'https://ai.google.dev/gemini-api/docs/google-search',
          title: 'Grounding with Google Search',
          attribution: 'ai.google.dev',
          snippet: undefined,
        },
        {
          type: 'link',
          link: 'https://example.com/report',
          title: 'Example Report',
          attribution: 'example.com',
          snippet: undefined,
        },
      ],
    });
  });

  test('injects standalone and composite citation markers', () => {
    const annotatedText = injectGroundingCitations('Alpha Beta', metadata, 0);

    expect(annotatedText).toBe(
      `Alpha\ue202turn0ref0 Beta\ue200\ue202turn0ref0\ue202turn0ref1\ue201`,
    );
  });

  test('injects citations into later text parts using offsets', () => {
    expect(injectGroundingCitations('Alpha ', metadata, 0, 0)).toBe(`Alpha\ue202turn0ref0 `);
    expect(injectGroundingCitations('Beta', metadata, 0, 6)).toBe(
      `Beta\ue200\ue202turn0ref0\ue202turn0ref1\ue201`,
    );
  });

  test('prefers exact segment text matching when grounding indices drift', () => {
    const text =
      'This surge is fueled by threats to the Strait of Hormuz—a critical chokepoint for global oil transit. For oil-importing economies (like India), this raises significant fears of "imported inflation," which could force central banks to keep interest rates high for longer, hurting corporate profitability.';
    const firstSegment =
      'This surge is fueled by threats to the Strait of Hormuz—a critical chokepoint for global oil transit.';
    const secondSegment =
      'For oil-importing economies (like India), this raises significant fears of "imported inflation," which could force central banks to keep interest rates high for longer, hurting corporate profitability.';
    const secondStart = text.indexOf(secondSegment);

    const annotatedText = injectGroundingCitations(
      text,
      {
        groundingMetadata: {
          groundingChunks: [
            { web: { uri: 'https://example.com/oil', title: 'Oil' } },
            { web: { uri: 'https://example.com/india', title: 'India' } },
          ],
          groundingSupports: [
            {
              segment: {
                text: firstSegment,
                startIndex: 0,
                endIndex: firstSegment.length + 1,
              },
              groundingChunkIndices: [0],
            },
            {
              segment: {
                text: secondSegment,
                startIndex: secondStart + 1,
                endIndex: secondStart + secondSegment.length + 2,
              },
              groundingChunkIndices: [1],
            },
          ],
        },
      },
      0,
    );

    expect(annotatedText).toContain(`transit.\ue202turn0ref0 For oil-importing`);
    expect(annotatedText).toContain(`profitability.\ue202turn0ref1`);
    expect(annotatedText).not.toContain(`transit. F\ue202turn0ref0`);
    expect(annotatedText).not.toContain(`\ue202turn0ref1r oil-importing`);
  });

  test('moves heading-only grounding supports to the next sentence boundary', () => {
    const text =
      '### 3. Currency and Bond Market Stress\n*   Rupee at All-Time Low: The Indian Rupee has plummeted to a record low.';
    const headingSegment = 'Currency and Bond Market Stress';
    const headingStart = text.indexOf(headingSegment);

    const annotatedText = injectGroundingCitations(
      text,
      {
        groundingMetadata: {
          groundingChunks: [{ web: { uri: 'https://example.com/rupee', title: 'Rupee' } }],
          groundingSupports: [
            {
              segment: {
                text: headingSegment,
                startIndex: headingStart + 2,
                endIndex: headingStart + headingSegment.length + 2,
              },
              groundingChunkIndices: [0],
            },
          ],
        },
      },
      0,
    );

    expect(annotatedText).toContain(`record low.\ue202turn0ref0`);
    expect(annotatedText).not.toContain(`Market Stress\ue202turn0ref0`);
  });

  test('leaves text unchanged when grounding metadata is missing', () => {
    expect(injectGroundingCitations('Plain text', undefined, 0)).toBe('Plain text');
  });
});
