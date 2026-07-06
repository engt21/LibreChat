import React from 'react';
import { render, screen } from '@testing-library/react';
import OpenAIImageGen from '../Parts/OpenAIImageGen/OpenAIImageGen';

jest.mock('~/utils', () => ({
  cn: (...classes: (string | boolean | undefined | null)[]) =>
    classes
      .flat(Infinity)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' '),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

jest.mock('~/components/Chat/Messages/Content/Image', () => ({
  __esModule: true,
  default: ({ altText, imagePath }: { altText: string; imagePath: string }) => (
    <div data-testid="image-component" data-alt={altText} data-src={imagePath} />
  ),
}));

jest.mock('../Parts/OpenAIImageGen/ProgressText', () => ({
  __esModule: true,
  default: ({ progress, error }: { progress: number; error: boolean }) => (
    <div data-testid="progress-text" data-progress={progress} data-error={String(error)} />
  ),
}));

describe('OpenAIImageGen', () => {
  const defaultProps = {
    initialProgress: 0.1,
    isSubmitting: true,
    toolName: 'image_gen_oai',
    args: '{"prompt":"a cat","quality":"high","size":"1024x1024"}',
    output: null as string | null,
    attachments: undefined,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not render a synthetic image placeholder before provider data arrives', () => {
    render(<OpenAIImageGen {...defaultProps} initialProgress={0.5} />);
    expect(screen.queryByTestId('image-component')).not.toBeInTheDocument();
    expect(screen.getByTestId('progress-text')).toBeInTheDocument();
  });

  it('shows the real streamed partial image during generation', () => {
    render(
      <OpenAIImageGen
        {...defaultProps}
        initialProgress={0.5}
        attachments={[
          {
            filename: 'partial.png',
            filepath: 'data:image/png;base64,partial',
            conversationId: 'conv1',
          } as never,
        ]}
      />,
    );

    expect(screen.getByTestId('image-component')).toHaveAttribute(
      'data-src',
      'data:image/png;base64,partial',
    );
  });

  it('shows only the latest URL-backed transient provider preview', () => {
    render(
      <OpenAIImageGen
        {...defaultProps}
        initialProgress={0.5}
        attachments={[
          {
            filename: 'partial-1.png',
            filepath: 'https://provider.example/partial-1.png',
            partial: true,
            partialImageIndex: 0,
            conversationId: 'conv1',
          } as never,
          {
            filename: 'partial-2.png',
            filepath: 'https://provider.example/partial-2.png',
            partial: true,
            partialImageIndex: 1,
            conversationId: 'conv1',
          } as never,
        ]}
      />,
    );

    expect(screen.getAllByTestId('image-component')).toHaveLength(1);
    expect(screen.getByTestId('image-component')).toHaveAttribute(
      'data-src',
      'https://provider.example/partial-2.png',
    );
  });

  it('uses the latest attachment so the final image replaces streamed previews', () => {
    render(
      <OpenAIImageGen
        {...defaultProps}
        initialProgress={1}
        isSubmitting={false}
        attachments={[
          {
            filename: 'partial.png',
            filepath: 'data:image/png;base64,partial',
            conversationId: 'conv1',
          } as never,
          {
            filename: 'final.png',
            filepath: '/images/final.png',
            conversationId: 'conv1',
          } as never,
        ]}
      />,
    );

    expect(screen.getByTestId('image-component')).toHaveAttribute('data-src', '/images/final.png');
  });

  it('renders every persisted image returned by a multi-image generation', () => {
    render(
      <OpenAIImageGen
        {...defaultProps}
        initialProgress={1}
        isSubmitting={false}
        attachments={[
          {
            file_id: 'file-1',
            filename: 'first.png',
            filepath: '/images/first.png',
            conversationId: 'conv1',
          } as never,
          {
            file_id: 'file-2',
            filename: 'second.png',
            filepath: '/images/second.png',
            conversationId: 'conv1',
          } as never,
        ]}
      />,
    );

    expect(screen.getAllByTestId('image-component')).toHaveLength(2);
    expect(screen.getAllByTestId('image-component')[0]).toHaveAttribute(
      'data-src',
      '/images/first.png',
    );
    expect(screen.getAllByTestId('image-component')[1]).toHaveAttribute(
      'data-src',
      '/images/second.png',
    );
  });

  it('applies image sizing only after a provider image exists', () => {
    const { container } = render(
      <OpenAIImageGen
        {...defaultProps}
        initialProgress={0.5}
        attachments={[
          {
            filename: 'partial.png',
            filepath: 'data:image/png;base64,partial',
            conversationId: 'conv1',
          } as never,
        ]}
      />,
    );

    expect(container.querySelector('[class*="max-h-"]')?.className).toContain('max-h-[45vh]');
    expect(container.querySelector('[class*="h-[45vh]"]')?.className).toContain('w-full');
  });

  it('handles invalid JSON args without rendering a fake image', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    render(<OpenAIImageGen {...defaultProps} args="invalid json" />);
    expect(screen.queryByTestId('image-component')).not.toBeInTheDocument();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('silently accepts incomplete streamed JSON args', () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    render(<OpenAIImageGen {...defaultProps} args='{\"prompt\":\"a cat\"' />);
    expect(screen.queryByTestId('image-component')).not.toBeInTheDocument();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('shows error state when output contains an error', () => {
    render(
      <OpenAIImageGen
        {...defaultProps}
        output="Error processing tool call"
        isSubmitting={false}
        initialProgress={0.5}
      />,
    );
    expect(screen.getByTestId('progress-text')).toHaveAttribute('data-error', 'true');
  });
});
