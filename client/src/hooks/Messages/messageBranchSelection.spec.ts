import type { TMessage } from 'librechat-data-provider';
import { getMessageBranchSelections } from './messageBranchSelection';

const message = (messageId: string, parentMessageId: string | null = null): TMessage =>
  ({
    messageId,
    parentMessageId,
    text: messageId,
  }) as TMessage;

describe('getMessageBranchSelections', () => {
  it('selects every ancestor needed to show a graft appended under the first root branch', () => {
    const messages = [
      message('prompt'),
      message('generation-1', 'prompt'),
      message('generation-2', 'prompt'),
      message('bridge', 'generation-1'),
      message('copy', 'bridge'),
    ];

    expect(getMessageBranchSelections(messages, 'copy', 'conversation-1')).toEqual([
      { atomKey: 'conversation-1', siblingIndex: 0 },
      { atomKey: 'prompt', siblingIndex: 1 },
      { atomKey: 'generation-1', siblingIndex: 0 },
      { atomKey: 'bridge', siblingIndex: 0 },
    ]);
  });

  it('selects the requested child at multiple sibling levels', () => {
    const messages = [
      message('root'),
      message('branch-a', 'root'),
      message('branch-b', 'root'),
      message('branch-a-child-1', 'branch-a'),
      message('branch-a-child-2', 'branch-a'),
    ];

    expect(getMessageBranchSelections(messages, 'branch-a-child-1', 'conversation-1')).toEqual([
      { atomKey: 'conversation-1', siblingIndex: 0 },
      { atomKey: 'root', siblingIndex: 1 },
      { atomKey: 'branch-a', siblingIndex: 1 },
    ]);
  });

  it('returns no selections when the target is unavailable', () => {
    expect(getMessageBranchSelections([message('root')], 'missing', 'conversation-1')).toEqual([]);
  });
});
