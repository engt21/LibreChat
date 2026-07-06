import { ContentTypes } from 'librechat-data-provider';
import {
  detectMemoryIntent,
  formatMemoryResponseContext,
  normalizeMemoryKey,
} from './memoryPolicy';

describe('memory policy', () => {
  describe('detectMemoryIntent', () => {
    it.each([
      'Use the youtube mcp to thoroughly search all these things.',
      'Search archived pages for this info.',
      'Use code interpreter to create the letter as a word doc.',
      "I'm trying to remember a YA science fiction book title.",
      'Check the original PDF and provide accurate feedback.',
    ])('does not treat one-off work as memory intent: %s', (text) => {
      expect(detectMemoryIntent(text)).toEqual({ intent: 'none' });
    });

    it.each([
      'Remember for me in memories that Barbara Yahr is the music director of GVO.',
      'Save to memory',
      'Then save this to memory after you check the emails.',
      'Save ALL of this to memory.',
      'You MUST use memory and save ALL of this to memory!',
      'You must use memory tool!',
      'Update my memories with the full workshop schedule.',
      'Make sure all this information is in memory.',
      "Don't forget that I prefer HTML email formatting.",
    ])('detects explicit save intent: %s', (text) => {
      expect(detectMemoryIntent(text).intent).toBe('save');
    });

    it.each([
      'Forget that old hotel preference.',
      'Delete the memory about the 2025 workshop.',
      'Remove my old address from memory.',
    ])('detects explicit delete intent: %s', (text) => {
      expect(detectMemoryIntent(text).intent).toBe('delete');
    });

    it('supports administrator-defined intent phrases', () => {
      expect(detectMemoryIntent('Keep this on file for later.', ['keep this on file'])).toEqual({
        intent: 'save',
        evidence: 'keep this on file',
      });
    });
  });

  describe('normalizeMemoryKey', () => {
    it('normalizes model-generated labels to Mongo-safe snake case', () => {
      expect(normalizeMemoryKey('Barbara Yahr - GVO Role & Email')).toBe(
        'barbara_yahr_gvo_role_email',
      );
    });
  });

  describe('formatMemoryResponseContext', () => {
    it('includes assistant text and tool results but excludes thinking', () => {
      const result = formatMemoryResponseContext(
        [
          { type: ContentTypes.THINK, think: 'private reasoning' },
          { type: ContentTypes.TEXT, text: 'The workshop begins August 3.' },
          {
            type: ContentTypes.TOOL_CALL,
            tool_call: { name: 'search_email', args: { q: 'workshop' }, output: 'August 3-8' },
          },
        ],
        2000,
      );

      expect(result).toContain('The workshop begins August 3.');
      expect(result).toContain('August 3-8');
      expect(result).not.toContain('private reasoning');
    });

    it('bounds the completed response context', () => {
      expect(
        formatMemoryResponseContext([{ type: ContentTypes.TEXT, text: 'x'.repeat(100) }], 20),
      ).toHaveLength(20);
    });
  });
});
