import { normalizeConversationGraph } from './graph';
import {
  HORIZONTAL_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  VERTICAL_GAP,
  layoutConversationTree,
} from './layout';

type TestMessage = {
  messageId?: string | null;
  parentMessageId?: string | null;
  text?: string;
  isCreatedByUser?: boolean;
  metadata?: Record<string, unknown>;
};

const createMessage = (overrides: TestMessage = {}) => ({
  messageId: 'message-1',
  parentMessageId: null,
  text: '',
  isCreatedByUser: false,
  metadata: {},
  ...overrides,
});

describe('conversation tree layout', () => {
  it('centers horizontal parents between children and offsets multiple roots without overlap', () => {
    const graph = normalizeConversationGraph([
      createMessage({ messageId: 'root-a', text: 'root a', isCreatedByUser: true }),
      createMessage({
        messageId: 'a-1',
        parentMessageId: 'root-a',
        text: 'a1',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'a-2',
        parentMessageId: 'root-a',
        text: 'a2',
        isCreatedByUser: false,
      }),
      createMessage({ messageId: 'root-b', text: 'root b', isCreatedByUser: true }),
      createMessage({
        messageId: 'b-1',
        parentMessageId: 'root-b',
        text: 'b1',
        isCreatedByUser: false,
      }),
    ]);

    const layout = layoutConversationTree(graph, { orientation: 'horizontal' });

    expect(layout.nodes.get('a-1')).toMatchObject({ x: NODE_WIDTH + HORIZONTAL_GAP, y: 0 });
    expect(layout.nodes.get('a-2')).toMatchObject({
      x: NODE_WIDTH + HORIZONTAL_GAP,
      y: NODE_HEIGHT + VERTICAL_GAP,
    });
    expect(layout.nodes.get('root-a')).toMatchObject({ x: 0, y: 60 });
    expect(layout.nodes.get('root-b')).toMatchObject({
      x: 0,
      y: (NODE_HEIGHT + VERTICAL_GAP) * 2,
    });
    expect(layout.edges).toEqual([
      { id: 'root-a->a-1', sourceId: 'root-a', targetId: 'a-1' },
      { id: 'root-a->a-2', sourceId: 'root-a', targetId: 'a-2' },
      { id: 'root-b->b-1', sourceId: 'root-b', targetId: 'b-1' },
    ]);
  });

  it('transposes the layout when using vertical orientation', () => {
    const graph = normalizeConversationGraph([
      createMessage({ messageId: 'root', text: 'root', isCreatedByUser: true }),
      createMessage({
        messageId: 'child-a',
        parentMessageId: 'root',
        text: 'a',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'child-b',
        parentMessageId: 'root',
        text: 'b',
        isCreatedByUser: false,
      }),
    ]);

    const layout = layoutConversationTree(graph, { orientation: 'vertical' });

    expect(layout.nodes.get('root')).toMatchObject({ x: 168, y: 0 });
    expect(layout.nodes.get('child-a')).toMatchObject({ x: 0, y: NODE_HEIGHT + VERTICAL_GAP });
    expect(layout.nodes.get('child-b')).toMatchObject({
      x: NODE_WIDTH + HORIZONTAL_GAP,
      y: NODE_HEIGHT + VERTICAL_GAP,
    });
  });

  it('keeps collapsed nodes visible, hides descendants, and reports full hidden counts', () => {
    const graph = normalizeConversationGraph([
      createMessage({ messageId: 'root', text: 'root', isCreatedByUser: true }),
      createMessage({
        messageId: 'branch',
        parentMessageId: 'root',
        text: 'branch',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'leaf-user',
        parentMessageId: 'branch',
        text: 'leaf user',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'leaf-assistant',
        parentMessageId: 'leaf-user',
        text: 'leaf assistant',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'sibling',
        parentMessageId: 'root',
        text: 'sibling',
        isCreatedByUser: false,
      }),
    ]);

    const layout = layoutConversationTree(graph, {
      orientation: 'horizontal',
      collapsedIds: ['branch'],
    });

    expect([...layout.nodes.keys()]).toEqual(['root', 'branch', 'sibling']);
    expect(layout.hiddenDescendantCounts.get('branch')).toBe(2);
    expect(layout.edges).toEqual([
      { id: 'root->branch', sourceId: 'root', targetId: 'branch' },
      { id: 'root->sibling', sourceId: 'root', targetId: 'sibling' },
    ]);
  });

  it('assigns hidden descendants to the first visible collapsed ancestor and ignores stale ids', () => {
    const graph = normalizeConversationGraph([
      createMessage({ messageId: 'root', text: 'root', isCreatedByUser: true }),
      createMessage({
        messageId: 'branch',
        parentMessageId: 'root',
        text: 'branch',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'nested-collapsed',
        parentMessageId: 'branch',
        text: 'nested collapsed',
        isCreatedByUser: true,
      }),
      createMessage({
        messageId: 'leaf-assistant',
        parentMessageId: 'nested-collapsed',
        text: 'leaf assistant',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'sibling',
        parentMessageId: 'root',
        text: 'sibling',
        isCreatedByUser: false,
      }),
    ]);

    const layout = layoutConversationTree(graph, {
      orientation: 'horizontal',
      collapsedIds: ['branch', 'nested-collapsed', 'missing-collapsed-id'],
    });

    expect([...layout.nodes.keys()]).toEqual(['root', 'branch', 'sibling']);
    expect(layout.hiddenDescendantCounts.get('branch')).toBe(2);
    expect(layout.hiddenDescendantCounts.has('nested-collapsed')).toBe(false);
    expect(layout.hiddenDescendantCounts.has('missing-collapsed-id')).toBe(false);
    expect(layout.edges).toEqual([
      { id: 'root->branch', sourceId: 'root', targetId: 'branch' },
      { id: 'root->sibling', sourceId: 'root', targetId: 'sibling' },
    ]);
  });

  it('applies manual positions last and expands bounds to the overridden coordinates', () => {
    const graph = normalizeConversationGraph([
      createMessage({ messageId: 'root', text: 'root', isCreatedByUser: true }),
      createMessage({
        messageId: 'child',
        parentMessageId: 'root',
        text: 'child',
        isCreatedByUser: false,
      }),
    ]);

    const layout = layoutConversationTree(graph, {
      orientation: 'horizontal',
      manualPositions: {
        root: { x: -50, y: 10 },
        child: { x: 400, y: 250 },
      },
    });

    expect(layout.nodes.get('root')).toMatchObject({ x: -50, y: 10 });
    expect(layout.nodes.get('child')).toMatchObject({ x: 400, y: 250 });
    expect(layout.bounds).toEqual({
      minX: -50,
      minY: 10,
      maxX: 640,
      maxY: 342,
      width: 690,
      height: 332,
    });
    expect(Object.prototype.hasOwnProperty.call(graph.nodes.get('root') ?? {}, 'x')).toBe(false);
  });

  it('discards invalid manual position map overrides and keeps finite bounds', () => {
    const graph = normalizeConversationGraph([
      createMessage({ messageId: 'root', text: 'root', isCreatedByUser: true }),
      createMessage({
        messageId: 'child',
        parentMessageId: 'root',
        text: 'child',
        isCreatedByUser: false,
      }),
    ]);

    const layout = layoutConversationTree(graph, {
      orientation: 'horizontal',
      manualPositions: new Map([['root', { x: Number.NaN, y: Number.POSITIVE_INFINITY }]]),
    });

    expect(layout.nodes.get('root')).toMatchObject({ x: 0, y: 0 });
    expect(Number.isFinite(layout.bounds.minX)).toBe(true);
    expect(Number.isFinite(layout.bounds.minY)).toBe(true);
    expect(Number.isFinite(layout.bounds.maxX)).toBe(true);
    expect(Number.isFinite(layout.bounds.maxY)).toBe(true);
  });

  it('returns finite bounds for malformed cycles and for empty graphs', () => {
    const cyclicGraph = normalizeConversationGraph([
      createMessage({
        messageId: 'a',
        parentMessageId: 'b',
        text: 'a',
        isCreatedByUser: false,
      }),
      createMessage({
        messageId: 'b',
        parentMessageId: 'a',
        text: 'b',
        isCreatedByUser: false,
      }),
    ]);

    const cyclicLayout = layoutConversationTree(cyclicGraph, { orientation: 'horizontal' });
    expect([...cyclicLayout.nodes.keys()]).toEqual(['a', 'b']);
    expect(cyclicLayout.edges).toEqual([{ id: 'a->b', sourceId: 'a', targetId: 'b' }]);
    expect(Number.isFinite(cyclicLayout.bounds.minX)).toBe(true);
    expect(Number.isFinite(cyclicLayout.bounds.maxY)).toBe(true);

    const emptyLayout = layoutConversationTree(normalizeConversationGraph([]), {
      orientation: 'horizontal',
    });
    expect(emptyLayout.nodes.size).toBe(0);
    expect(emptyLayout.edges).toEqual([]);
    expect(emptyLayout.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    });
  });
});
