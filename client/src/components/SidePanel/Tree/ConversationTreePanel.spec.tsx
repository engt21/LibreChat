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
      com_sidepanel_conversation_tree: 'Conversation Tree',
      com_ui_open_conversation_tree: 'Open conversation tree',
      com_ui_conversation_tree_description: 'Browse and graft conversation branches.',
    })[key] ?? key,
}));

import ConversationTreePanel from './ConversationTreePanel';

describe('ConversationTreePanel', () => {
  beforeEach(() => {
    mockOpenTree.mockReset();
  });

  it('shows a description and opens the shared tree dialog', async () => {
    const user = userEvent.setup();

    render(<ConversationTreePanel />);

    expect(screen.getByText('Browse and graft conversation branches.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Open conversation tree' }));

    expect(mockOpenTree).toHaveBeenCalledWith();
  });
});
