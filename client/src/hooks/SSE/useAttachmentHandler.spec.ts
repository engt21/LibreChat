import type { TAttachment } from 'librechat-data-provider';
import { mergeStreamingAttachment } from './useAttachmentHandler';

const attachment = (overrides: Partial<TAttachment>): TAttachment =>
  ({
    messageId: 'message-1',
    toolCallId: 'tool-1',
    conversationId: 'conversation-1',
    filename: 'image.png',
    filepath: 'data:image/png;base64,first',
    ...overrides,
  }) as TAttachment;

describe('mergeStreamingAttachment', () => {
  it('replaces partial images for the same tool call', () => {
    const first = attachment({ partial: true, partialImageIndex: 0 });
    const second = attachment({
      partial: true,
      partialImageIndex: 1,
      filepath: 'data:image/png;base64,second',
    });

    expect(mergeStreamingAttachment([first], second)).toEqual([second]);
  });

  it('replaces the streamed preview with the completed image event', () => {
    const partial = attachment({ partial: true, partialImageIndex: 2 });
    const completed = attachment({
      partial: false,
      partialImageIndex: undefined,
      filepath: 'data:image/png;base64,complete',
    });

    expect(mergeStreamingAttachment([partial], completed)).toEqual([completed]);
  });

  it('replaces the streamed preview with the persisted final attachment', () => {
    const partial = attachment({ partial: true, partialImageIndex: 2 });
    const persisted = attachment({
      partial: undefined,
      partialImageIndex: undefined,
      filepath: '/images/final.png',
      file_id: 'file-1',
    });

    expect(mergeStreamingAttachment([partial], persisted)).toEqual([persisted]);
  });

  it('keeps attachments from different tool calls', () => {
    const first = attachment({ partial: true });
    const second = attachment({ toolCallId: 'tool-2', partial: true });

    expect(mergeStreamingAttachment([first], second)).toEqual([first, second]);
  });
});
