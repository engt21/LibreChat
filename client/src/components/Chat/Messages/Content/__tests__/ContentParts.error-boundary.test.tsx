import React from 'react';
import { render, screen } from '@testing-library/react';
import { ContentTypes } from 'librechat-data-provider';
import ContentParts from '../ContentParts';

jest.mock('../Part', () => ({
  __esModule: true,
  default: () => {
    throw new Error('broken message part');
  },
}));

jest.mock('../MemoryArtifacts', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('~/components/Web/Sources', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../Container', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
}));

jest.mock('../MessageContent', () => ({
  ErrorMessage: ({ text }) => <div role="alert">{text}</div>,
}));

describe('ContentParts render safety', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('shows an inline error when a message part renderer throws', () => {
    expect(() =>
      render(
        <ContentParts
          content={[{ type: ContentTypes.TEXT, text: { value: 'hello' } }]}
          messageId="message-1"
          isCreatedByUser={false}
          isLast={true}
          isSubmitting={false}
          isLatestMessage={true}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This message part could not be displayed.',
    );
  });
});
