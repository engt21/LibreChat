import React from 'react';
import { render, screen } from '@testing-library/react';
import { RecoilRoot } from 'recoil';
import MultiMessage from '../MultiMessage';
import { MESSAGE_RENDER_ERROR } from '../MessageRenderErrorBoundary';

jest.mock('~/components/Messages/MessageContent', () => ({
  __esModule: true,
  default: () => {
    throw new Error('broken message render');
  },
}));

jest.mock('../MessageParts', () => ({
  __esModule: true,
  default: () => <div>message parts</div>,
}));

jest.mock('../Message', () => ({
  __esModule: true,
  default: () => <div>plain message</div>,
}));

describe('MultiMessage render safety', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('shows an inline fallback when a structured message render throws', () => {
    expect(() =>
      render(
        <RecoilRoot>
          <MultiMessage
            messageId="conversation-1"
            messagesTree={[
              {
                messageId: 'message-1',
                endpoint: 'anthropic',
                content: [{ type: 'text', text: { value: 'hello' } }],
                isCreatedByUser: false,
              } as any,
            ]}
          />
        </RecoilRoot>,
      ),
    ).not.toThrow();

    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE_RENDER_ERROR);
  });
});
