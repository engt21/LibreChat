import { render, screen } from '@testing-library/react';
import PlaceholderRow from './PlaceholderRow';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => (key === 'com_ui_generating' ? 'Generating…' : key),
}));

jest.mock('@librechat/client', () => ({
  Spinner: ({ className }: { className?: string }) => <div data-testid="spinner" className={className} />,
}));

describe('PlaceholderRow', () => {
  it('immediately announces that generation is in progress', () => {
    render(<PlaceholderRow />);

    expect(screen.getByRole('status')).toHaveTextContent('Generating…');
    expect(screen.getByTestId('spinner')).toBeVisible();
  });
});
