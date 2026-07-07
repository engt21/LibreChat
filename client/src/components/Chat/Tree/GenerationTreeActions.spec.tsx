import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockOpenTree = jest.fn();

jest.mock('~/Providers', () => ({
  useGenerationTree: () => ({
    openTree: mockOpenTree,
  }),
}));

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) =>
    ({
      com_ui_view_in_conversation_tree: 'View in conversation tree',
      com_ui_graft_generation: 'Graft generation',
    })[key] ?? key,
}));

import GenerationTreeActions from './GenerationTreeActions';

describe('GenerationTreeActions', () => {
  beforeEach(() => {
    mockOpenTree.mockReset();
  });

  it('renders browse and graft actions for assistant messages with a message id', async () => {
    const user = userEvent.setup();

    render(
      <GenerationTreeActions message={{ messageId: 'assistant-1', isCreatedByUser: false }} />,
    );

    await user.click(screen.getByRole('button', { name: 'View in conversation tree' }));
    expect(mockOpenTree).toHaveBeenNthCalledWith(1, { focusMessageId: 'assistant-1' });

    await user.click(screen.getByRole('button', { name: 'Graft generation' }));
    expect(mockOpenTree).toHaveBeenNthCalledWith(2, {
      focusMessageId: 'assistant-1',
      sourceMessageId: 'assistant-1',
    });
  });

  it('does not render for user messages or assistant messages missing ids', () => {
    const { rerender } = render(
      <GenerationTreeActions message={{ messageId: 'user-1', isCreatedByUser: true }} />,
    );

    expect(
      screen.queryByRole('button', { name: 'View in conversation tree' }),
    ).not.toBeInTheDocument();

    rerender(<GenerationTreeActions message={{ isCreatedByUser: false }} />);

    expect(screen.queryByRole('button', { name: 'Graft generation' })).not.toBeInTheDocument();
  });

  it('keeps actions available for partial and errored assistant messages', () => {
    render(
      <GenerationTreeActions
        message={{
          messageId: 'assistant-2',
          isCreatedByUser: false,
          unfinished: true,
          error: true,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: 'View in conversation tree' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Graft generation' })).toBeInTheDocument();
  });

  it('keeps final-message actions visible without hover-only opacity classes', () => {
    render(
      <GenerationTreeActions
        message={{ messageId: 'assistant-last', isCreatedByUser: false }}
        isLast={true}
      />,
    );

    expect(screen.getByRole('button', { name: 'View in conversation tree' })).not.toHaveClass(
      'md:opacity-0',
    );
    expect(screen.getByRole('button', { name: 'Graft generation' })).not.toHaveClass(
      'md:opacity-0',
    );
  });
});
