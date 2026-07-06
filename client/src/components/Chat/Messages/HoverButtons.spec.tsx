import React from 'react';
import { render, screen } from '@testing-library/react';

const mockUseGenerationsByLatest = jest.fn();

jest.mock('recoil', () => ({
  useRecoilState: () => [false, jest.fn()],
}));

jest.mock('~/hooks', () => ({
  useGenerationsByLatest: (...args: unknown[]) => mockUseGenerationsByLatest(...args),
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/components/Conversations', () => ({
  Fork: ({ messageId }: { messageId: string }) => <div data-testid={`fork-${messageId}`}>Fork</div>,
}));

jest.mock('~/components/Chat/Tree/GenerationTreeActions', () => ({
  __esModule: true,
  default: ({ message }: { message: { messageId?: string } }) => (
    <div data-testid={`generation-tree-actions-${message.messageId ?? 'missing'}`}>Tree</div>
  ),
}));

jest.mock('./MessageAudio', () => () => null);
jest.mock('./Feedback', () => () => null);
jest.mock('~/store', () => ({
  __esModule: true,
  default: {
    textToSpeech: 'text-to-speech',
  },
}));

import HoverButtons from './HoverButtons';

const baseConversation = { conversationId: 'conversation-1', endpoint: 'openAI' } as any;

const baseProps = {
  index: 0,
  isEditing: false,
  enterEdit: jest.fn(),
  copyToClipboard: jest.fn(),
  conversation: baseConversation,
  isSubmitting: false,
  regenerate: jest.fn(),
  handleContinue: jest.fn(),
  latestMessageId: 'assistant-1',
  isLast: false,
};

describe('HoverButtons', () => {
  beforeEach(() => {
    mockUseGenerationsByLatest.mockReturnValue({
      hideEditButton: true,
      regenerateEnabled: true,
      continueSupported: false,
      forkingSupported: true,
      isEditableEndpoint: false,
    });
  });

  it('mounts tree actions immediately after Fork for assistant messages', () => {
    const { container } = render(
      <HoverButtons
        {...baseProps}
        message={{ messageId: 'assistant-1', isCreatedByUser: false }}
      />,
    );

    const children = Array.from(container.firstElementChild?.children ?? []).map(
      (node) => (node as HTMLElement).dataset.testid ?? '',
    );

    expect(children).toContain('fork-assistant-1');
    expect(children).toContain('generation-tree-actions-assistant-1');
    expect(children.indexOf('generation-tree-actions-assistant-1')).toBe(
      children.indexOf('fork-assistant-1') + 1,
    );
  });

  it('renders tree actions for errored assistant messages before regenerate', () => {
    const { container } = render(
      <HoverButtons
        {...baseProps}
        message={{ messageId: 'assistant-error', isCreatedByUser: false, error: true }}
      />,
    );

    expect(screen.getByTestId('generation-tree-actions-assistant-error')).toBeInTheDocument();
    expect(screen.getByTitle('com_ui_regenerate')).toBeInTheDocument();

    const children = Array.from(container.firstElementChild?.children ?? []).map((node) => {
      const element = node as HTMLElement;
      return element.dataset.testid || element.getAttribute('title') || '';
    });

    expect(children.indexOf('generation-tree-actions-assistant-error')).toBeLessThan(
      children.indexOf('com_ui_regenerate'),
    );
  });
});
