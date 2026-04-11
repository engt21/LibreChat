/**
 * @file WebSearchStatus.spec.tsx
 * Tests that the WebSearchStatus component renders the correct inline
 * activity indicator for all status values the Ollama and provider-native
 * web-search paths emit via `on_web_search_status` SSE events.
 *
 * Covers VAL-REALTIME-004 (inline search status observable during live turns).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import WebSearchStatus from './WebSearchStatus';

describe('WebSearchStatus – inline search status contract (VAL-REALTIME-004)', () => {
  // --- searching (Ollama native path emits this) ---

  it('shows "Searching the web…" with animated dots for "searching" status', () => {
    render(<WebSearchStatus status="searching" isLast={true} />);
    expect(screen.getByText('Searching the web…')).toBeInTheDocument();
    // Animated dots present while active
    expect(screen.getAllByText('.')).toHaveLength(3);
  });

  // --- in_progress (provider-native path emits this) ---

  it('shows "Searching the web…" with animated dots for "in_progress" status', () => {
    render(<WebSearchStatus status="in_progress" isLast={true} />);
    expect(screen.getByText('Searching the web…')).toBeInTheDocument();
    expect(screen.getAllByText('.')).toHaveLength(3);
  });

  // --- completed ---

  it('renders "Web search complete" for completed status when isLast', () => {
    render(<WebSearchStatus status="completed" isLast={true} />);
    expect(screen.getByText('Web search complete')).toBeInTheDocument();
    // No animated dots when completed
    expect(screen.queryAllByText('.')).toHaveLength(0);
  });

  it('returns null for completed status when not isLast (inline indicator cleans up)', () => {
    const { container } = render(<WebSearchStatus status="completed" isLast={false} />);
    expect(container.firstChild).toBeNull();
  });

  // --- unknown/unexpected status ---

  it('renders a fallback label for unknown status values', () => {
    render(<WebSearchStatus status="fetching" isLast={true} />);
    expect(screen.getByText('Web search: fetching')).toBeInTheDocument();
  });

  // --- lifecycle matches Ollama tool callback sequence ---

  it('searching → completed lifecycle leaves a clean final state', () => {
    // Render searching first
    const { rerender } = render(<WebSearchStatus status="searching" isLast={true} />);
    expect(screen.getByText('Searching the web…')).toBeInTheDocument();
    expect(screen.getAllByText('.')).toHaveLength(3);

    // Then complete
    rerender(<WebSearchStatus status="completed" isLast={true} />);
    expect(screen.getByText('Web search complete')).toBeInTheDocument();
    expect(screen.queryAllByText('.')).toHaveLength(0);

    // Once no longer last, disappears
    rerender(<WebSearchStatus status="completed" isLast={false} />);
    expect(screen.queryByText('Web search complete')).not.toBeInTheDocument();
  });
});
