import { ContentTypes } from 'librechat-data-provider';
import { mergeAdjacentThinkingParts, mergeThinkingText } from '../streamingReasoning';

describe('mergeThinkingText', () => {
  it('keeps mid-word fragments together without adding a separator', () => {
    expect(mergeThinkingText('**Gather', 'ing credible sources**')).toBe(
      '**Gathering credible sources**',
    );
  });

  it('inserts a blank line before a new markdown reasoning step', () => {
    expect(
      mergeThinkingText(
        'I need to gather the necessary information.',
        '**Verifying concert claims**\n\nI should confirm the program archive.',
      ),
    ).toBe(
      'I need to gather the necessary information.\n\n**Verifying concert claims**\n\nI should confirm the program archive.',
    );
  });

  it('inserts a blank line before a new plain-text step after sentence punctuation', () => {
    expect(
      mergeThinkingText('the web to gather the necessary information.', 'Verifying concert claims'),
    ).toBe('the web to gather the necessary information.\n\nVerifying concert claims');
  });
});

describe('mergeAdjacentThinkingParts', () => {
  it('merges adjacent think parts into one rendered reasoning block', () => {
    const merged = mergeAdjacentThinkingParts([
      { type: ContentTypes.THINK, think: '**Searching for information**\n\nChecking sources.' },
      { type: ContentTypes.THINK, think: '**Verifying concert claims**\n\nLooking at archives.' },
      { type: ContentTypes.TEXT, text: 'Final answer.' },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].part.type).toBe(ContentTypes.THINK);
    expect(merged[0].part.think).toBe(
      '**Searching for information**\n\nChecking sources.\n\n**Verifying concert claims**\n\nLooking at archives.',
    );
    expect(merged[1].part.type).toBe(ContentTypes.TEXT);
  });

  it('drops orphaned prefix fragments after substantial reasoning text', () => {
    const merged = mergeAdjacentThinkingParts([
      { type: ContentTypes.THINK, think: '**Gather' },
      {
        type: ContentTypes.THINK,
        think:
          'ing credible sources**\n\nI’m planning to gather information from credible sources before proceeding.',
      },
      { type: ContentTypes.THINK, think: '**Research' },
      { type: ContentTypes.THINK, think: '**Preparing' },
      { type: ContentTypes.TEXT, text: 'Final answer.' },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].part.think).toBe(
      '**Gathering credible sources**\n\nI’m planning to gather information from credible sources before proceeding.',
    );
  });
});
