import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import SiblingSwitch from './SiblingSwitch';

const mockMutate = jest.fn();
const mockShowToast = jest.fn();

jest.mock('librechat-data-provider/react-query', () => ({
  useDeleteMessageBranchMutation: () => ({ mutate: mockMutate, isLoading: false }),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    ({
      com_ui_cancel: 'Cancel',
      com_ui_delete_generation_route: 'Delete route',
      com_ui_delete_generation_route_description:
        'This permanently deletes the prompt, all generated answers and thoughts, and every message that continues from them. It will be as if this prompt was never run.',
      com_ui_delete_generation_route_title: 'Delete this prompt and all generations?',
    })[key] ?? key,
}));

jest.mock('@librechat/client', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Spinner: () => <div data-testid="spinner" />,
  OGDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogClose: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  OGDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  OGDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useToastContext: () => ({ showToast: mockShowToast }),
}));

describe('SiblingSwitch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a delete-route action for alternate assistant generations', () => {
    render(
      <SiblingSwitch
        message={{
          messageId: 'generation-b',
          conversationId: 'conversation-1',
          isCreatedByUser: false,
        }}
        siblingIdx={1}
        siblingCount={2}
        setSiblingIdx={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete generation tree' })).toBeVisible();
    expect(screen.getByText('2 / 2')).toBeVisible();
  });

  it('does not show a delete action when no message is provided', () => {
    render(<SiblingSwitch siblingIdx={0} siblingCount={1} setSiblingIdx={jest.fn()} />);

    expect(
      screen.queryByRole('button', { name: 'Delete generation tree' }),
    ).not.toBeInTheDocument();
  });

  it('confirms and deletes the selected route', () => {
    render(
      <SiblingSwitch
        message={{
          messageId: 'generation-b',
          conversationId: 'conversation-1',
          isCreatedByUser: false,
        }}
        siblingIdx={1}
        siblingCount={2}
        setSiblingIdx={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete generation tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));

    expect(mockMutate).toHaveBeenCalledWith(
      { conversationId: 'conversation-1', messageId: 'generation-b' },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
  });

  it('does not delete while the selected generation is unfinished', () => {
    render(
      <SiblingSwitch
        message={{
          messageId: 'generation-b',
          conversationId: 'conversation-1',
          isCreatedByUser: false,
          unfinished: true,
        }}
        siblingIdx={1}
        siblingCount={2}
        setSiblingIdx={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete generation tree' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete route' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('allows deletion when the selected generation is finished', () => {
    render(
      <SiblingSwitch
        message={{
          messageId: 'generation-b',
          conversationId: 'conversation-1',
          isCreatedByUser: false,
          unfinished: false,
        }}
        siblingIdx={1}
        siblingCount={2}
        setSiblingIdx={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete generation tree' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Delete route' })).toBeEnabled();
  });

  it('allows deleting the full generation tree when only one generation remains', () => {
    render(
      <SiblingSwitch
        message={{
          messageId: 'generation-a',
          conversationId: 'conversation-1',
          isCreatedByUser: false,
        }}
        siblingIdx={0}
        siblingCount={1}
        setSiblingIdx={jest.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Delete generation tree' })).toBeEnabled();
  });
  it('finishes a successful final-tree deletion without leaving a loading state', () => {
    mockMutate.mockImplementationOnce((_payload, options) => options.onSuccess());
    render(
      <SiblingSwitch
        message={{
          messageId: 'generation-a',
          conversationId: 'conversation-1',
          isCreatedByUser: false,
        }}
        siblingIdx={0}
        siblingCount={1}
        setSiblingIdx={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete generation tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete route' }));

    expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Generation tree deleted' }),
    );
  });

});
