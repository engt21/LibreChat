import React from 'react';
import { render, screen } from '@testing-library/react';
import WebSearchStatus from '../Parts/WebSearchStatus';

describe('WebSearchStatus', () => {
  it('renders "Searching the web…" for in_progress status', () => {
    render(<WebSearchStatus status="in_progress" isLast={true} />);
    expect(screen.getByText('Searching the web…')).toBeInTheDocument();
  });

  it('renders "Searching the web…" for searching status', () => {
    render(<WebSearchStatus status="searching" isLast={true} />);
    expect(screen.getByText('Searching the web…')).toBeInTheDocument();
  });

  it('renders "Web search complete" for completed status when isLast', () => {
    render(<WebSearchStatus status="completed" isLast={true} />);
    expect(screen.getByText('Web search complete')).toBeInTheDocument();
  });

  it('returns null for completed status when not isLast', () => {
    const { container } = render(<WebSearchStatus status="completed" isLast={false} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows animated dots when active (in_progress)', () => {
    render(<WebSearchStatus status="in_progress" isLast={true} />);
    const dots = screen.getAllByText('.');
    expect(dots.length).toBe(3);
  });

  it('shows animated dots when active (searching)', () => {
    render(<WebSearchStatus status="searching" isLast={true} />);
    const dots = screen.getAllByText('.');
    expect(dots.length).toBe(3);
  });

  it('does not show animated dots when completed', () => {
    render(<WebSearchStatus status="completed" isLast={true} />);
    // When completed + isLast, it renders with opacity-0 but no animated dots
    expect(screen.queryAllByText('.')).toHaveLength(0);
  });

  it('renders a fallback label for unknown status', () => {
    render(<WebSearchStatus status="unknown_status" isLast={true} />);
    expect(screen.getByText('Web search: unknown_status')).toBeInTheDocument();
  });
});
