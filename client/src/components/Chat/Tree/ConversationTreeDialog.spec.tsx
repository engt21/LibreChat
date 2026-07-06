import React from 'react';
import { act, render, screen } from '@testing-library/react';

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) =>
    ({
      com_sidepanel_conversation_tree: 'Conversation Tree',
      com_ui_conversation_tree_description:
        'Browse conversation branches and choose a generation to graft.',
      com_ui_generation_tree_source: 'Source',
      com_ui_generation_tree_destination: 'Destination',
      com_ui_none: 'None',
    })[key] ?? key,
}));

import ConversationTreeDialog from './ConversationTreeDialog';

describe('ConversationTreeDialog', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it('uses the 200ms fallback exit callback and cancels it when reopened', () => {
    const onExitComplete = jest.fn();
    const onOpenChange = jest.fn();
    const { rerender } = render(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    const dialog = screen.getByRole('dialog');
    const description = screen.getByText(
      'Browse conversation branches and choose a generation to graft.',
    );

    expect(dialog).toHaveAttribute('aria-describedby', description.getAttribute('id'));
    expect(description.tagName.toLowerCase()).toBe('p');

    rerender(
      <ConversationTreeDialog
        open={false}
        focusMessageId="assistant-1"
        sourceMessageId="assistant-1"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(199);
    });

    expect(onExitComplete).not.toHaveBeenCalled();

    rerender(
      <ConversationTreeDialog
        open={true}
        focusMessageId="assistant-2"
        sourceMessageId="assistant-2"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(onExitComplete).not.toHaveBeenCalled();

    rerender(
      <ConversationTreeDialog
        open={false}
        focusMessageId="assistant-2"
        sourceMessageId="assistant-2"
        onOpenChange={onOpenChange}
        onExitComplete={onExitComplete}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(onExitComplete).toHaveBeenCalledTimes(1);
  });
});
