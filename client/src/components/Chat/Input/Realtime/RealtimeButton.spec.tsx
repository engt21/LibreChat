import React from 'react';
import { RecoilRoot } from 'recoil';
import { render, screen } from '@testing-library/react';
import RealtimeButton from './RealtimeButton';

const mockGetMessages = jest.fn(() => []);

jest.mock('~/Providers', () => ({
  useChatContext: () => ({
    getMessages: mockGetMessages,
    latestMessageId: null,
  }),
}));

jest.mock('@librechat/client', () => ({
  TooltipAnchor: ({ render }: { render: React.ReactNode }) => render,
}));

jest.mock('./RealtimeDialog', () => () => null);

describe('RealtimeButton', () => {
  it('renders outside MessagesViewProvider', () => {
    render(
      <RecoilRoot>
        <RealtimeButton />
      </RecoilRoot>,
    );

    expect(screen.getByRole('button', { name: 'Open realtime voice dialog' })).toBeInTheDocument();
    expect(mockGetMessages).toHaveBeenCalled();
  });
});
