import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ConversationTreeMiniMap from '../ConversationTreeMiniMap';
import type { ConversationTreeLayout } from '../types';

function createLayout(): ConversationTreeLayout {
  return {
    nodes: new Map([
      [
        'root',
        {
          id: 'root',
          parentId: null,
          childIds: ['child'],
          message: { messageId: 'root', text: 'Root', isCreatedByUser: true },
          role: 'user',
          lifecycle: 'complete',
          generationIndex: 0,
          generationCount: 0,
          searchableText: 'root',
          x: 0,
          y: 0,
          width: 240,
          height: 92,
        },
      ],
      [
        'child',
        {
          id: 'child',
          parentId: 'root',
          childIds: [],
          message: { messageId: 'child', text: 'Child', isCreatedByUser: false },
          role: 'assistant',
          lifecycle: 'complete',
          generationIndex: 1,
          generationCount: 1,
          searchableText: 'child',
          x: 320,
          y: 0,
          width: 240,
          height: 92,
        },
      ],
    ]),
    edges: [{ id: 'root-child', sourceId: 'root', targetId: 'child' }],
    bounds: {
      minX: 0,
      minY: 0,
      maxX: 560,
      maxY: 92,
      width: 560,
      height: 92,
    },
    hiddenDescendantCounts: new Map(),
  };
}

describe('ConversationTreeMiniMap', () => {
  it('stays out of the accessibility tree and stops dragging after pointer leave', () => {
    const onRecenter = jest.fn();

    render(
      <ConversationTreeMiniMap
        layout={createLayout()}
        activeBranchIds={new Set(['child'])}
        sourceMessageId={null}
        destinationMessageId={null}
        transformState={{ scale: 1, positionX: 0, positionY: 0 }}
        viewportSize={{ width: 600, height: 400 }}
        onRecenter={onRecenter}
      />,
    );

    const minimap = screen.getByTestId('generation-tree-minimap');
    Object.defineProperty(minimap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 180, height: 112 }),
    });

    expect(minimap).toHaveAttribute('aria-hidden', 'true');
    expect(minimap).toHaveAttribute('focusable', 'false');
    expect(minimap).toHaveAttribute('tabindex', '-1');

    fireEvent.pointerDown(minimap, { clientX: 20, clientY: 20 });
    fireEvent.pointerLeave(minimap);
    fireEvent.pointerMove(minimap, { clientX: 40, clientY: 30 });

    expect(onRecenter).toHaveBeenCalledTimes(1);
  });

  it('stops dragging after pointer cancel', () => {
    const onRecenter = jest.fn();

    render(
      <ConversationTreeMiniMap
        layout={createLayout()}
        activeBranchIds={new Set(['child'])}
        sourceMessageId={null}
        destinationMessageId={null}
        transformState={{ scale: 1, positionX: 0, positionY: 0 }}
        viewportSize={{ width: 600, height: 400 }}
        onRecenter={onRecenter}
      />,
    );

    const minimap = screen.getByTestId('generation-tree-minimap');
    Object.defineProperty(minimap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 0, top: 0, width: 180, height: 112 }),
    });

    fireEvent.pointerDown(minimap, { clientX: 20, clientY: 20 });
    fireEvent.pointerCancel(minimap);
    fireEvent.pointerMove(minimap, { clientX: 60, clientY: 40 });

    expect(onRecenter).toHaveBeenCalledTimes(1);
  });
});
