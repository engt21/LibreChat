import * as RadixToast from '@radix-ui/react-toast';
import { Provider, createStore } from 'jotai';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NotificationSeverity } from '~/common';
import useToast from '~/hooks/useToast';
import { createToastState, toastState } from '~/store';
import { Toast } from './Toast';

function ToastHarness({ actionSpy }: { actionSpy: jest.Mock }) {
  const { showToast, onOpenChange } = useToast(0);

  return (
    <>
      <button
        type="button"
        onClick={() =>
          showToast({
            message: 'Action toast',
            actionLabel: 'Undo',
            onAction: actionSpy,
            duration: 5000,
            severity: NotificationSeverity.SUCCESS,
          })
        }
      >
        show action toast
      </button>
      <button
        type="button"
        onClick={() =>
          showToast({
            message: 'Label only toast',
            actionLabel: 'Undo',
            duration: 5000,
          })
        }
      >
        show label only toast
      </button>
      <button
        type="button"
        onClick={() =>
          showToast({
            message: 'Callback only toast',
            onAction: actionSpy,
            duration: 5000,
          })
        }
      >
        show callback only toast
      </button>
      <button
        type="button"
        onClick={() =>
          showToast({
            message: 'Plain toast',
            duration: 5000,
          })
        }
      >
        show plain toast
      </button>
      <button
        type="button"
        onClick={() =>
          showToast({
            message: 'Auto hide toast',
            actionLabel: 'Undo',
            onAction: actionSpy,
            duration: 25,
          })
        }
      >
        show auto hide toast
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        close toast
      </button>
    </>
  );
}

function renderToast(actionSpy = jest.fn()) {
  const store = createStore();

  render(
    <RadixToast.Provider>
      <Provider store={store}>
        <ToastHarness actionSpy={actionSpy} />
        <Toast />
        <RadixToast.Viewport />
      </Provider>
    </RadixToast.Provider>,
  );

  return { store, actionSpy };
}

function showToast(buttonName: string) {
  fireEvent.click(screen.getByRole('button', { name: buttonName }));
  act(() => {
    jest.advanceTimersByTime(0);
  });
}

describe('Toast', () => {
  afterEach(() => {
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  it('renders an accessible action button and clicking it runs the callback once and clears action state', () => {
    jest.useFakeTimers();
    const { store, actionSpy } = renderToast();

    showToast('show action toast');

    expect(screen.getByText('Action toast')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(store.get(toastState)).toEqual(createToastState());
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('does not render an action button when the action is incomplete', () => {
    jest.useFakeTimers();
    renderToast();

    showToast('show label only toast');
    expect(screen.getByText('Label only toast')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();

    showToast('show callback only toast');
    expect(screen.getByText('Callback only toast')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('replacing a toast with a plain toast clears any stale action state and keeps plain toasts working', () => {
    jest.useFakeTimers();
    const { store } = renderToast();

    showToast('show action toast');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    showToast('show plain toast');

    expect(screen.getByText('Plain toast')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
    expect(store.get(toastState)).toMatchObject({
      open: true,
      message: 'Plain toast',
      actionLabel: undefined,
      onAction: undefined,
    });
  });

  it('manual close clears stale action fields from toast state', () => {
    jest.useFakeTimers();
    const { store } = renderToast();

    showToast('show action toast');
    fireEvent.click(screen.getByRole('button', { name: 'close toast' }));

    expect(store.get(toastState)).toEqual(createToastState());
  });

  it('auto-hide clears stale action fields from toast state', () => {
    jest.useFakeTimers();
    const { store } = renderToast();

    showToast('show auto hide toast');
    act(() => {
      jest.advanceTimersByTime(25);
    });

    expect(store.get(toastState)).toEqual(createToastState());
  });
});
