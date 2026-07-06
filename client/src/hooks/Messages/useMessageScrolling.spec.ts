import { Constants } from 'librechat-data-provider';
import { shouldAutoScrollOnOpen } from './useMessageScrolling';

describe('shouldAutoScrollOnOpen', () => {
  it('waits for persisted messages before scrolling an existing conversation', () => {
    expect(
      shouldAutoScrollOnOpen({
        autoScroll: true,
        conversationId: 'conversation-1',
        messageCount: 0,
      }),
    ).toBe(false);

    expect(
      shouldAutoScrollOnOpen({
        autoScroll: true,
        conversationId: 'conversation-1',
        messageCount: 4,
      }),
    ).toBe(true);
  });

  it('does not auto-scroll new conversations or when disabled', () => {
    expect(
      shouldAutoScrollOnOpen({
        autoScroll: true,
        conversationId: Constants.NEW_CONVO,
        messageCount: 4,
      }),
    ).toBe(false);
    expect(
      shouldAutoScrollOnOpen({
        autoScroll: false,
        conversationId: 'conversation-1',
        messageCount: 4,
      }),
    ).toBe(false);
  });
});
