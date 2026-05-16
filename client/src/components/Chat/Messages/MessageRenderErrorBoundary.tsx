import React from 'react';

export const MESSAGE_RENDER_ERROR =
  'This message could not be displayed. The rest of the chat is still available.';

type MessageRenderErrorBoundaryProps = {
  children: React.ReactNode;
  resetKey: string;
};

type MessageRenderErrorBoundaryState = {
  hasError: boolean;
};

class MessageRenderErrorBoundary extends React.Component<
  MessageRenderErrorBoundaryProps,
  MessageRenderErrorBoundaryState
> {
  state: MessageRenderErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): MessageRenderErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Message render error:', error, errorInfo);
  }

  componentDidUpdate(prevProps: MessageRenderErrorBoundaryProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="m-auto justify-center p-4 py-2 md:gap-6">
          <div className="mx-auto flex w-full max-w-[55rem] flex-1 gap-3">
            <div
              role="alert"
              aria-live="polite"
              className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-gray-600 dark:text-gray-200"
            >
              {MESSAGE_RENDER_ERROR}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default MessageRenderErrorBoundary;
