import type { ConversationTreeGraph } from '../types';
import { buildVisibleTreeItems } from '../visibleItems';

function createGraph(): ConversationTreeGraph {
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
          searchableText: 'root',
        },
      ],
      [
        'child',
        {
          id: 'child',
          parentId: 'root',
          childIds: ['root'],
          message: { messageId: 'child', text: 'Child', isCreatedByUser: false },
          role: 'assistant',
          lifecycle: 'complete',
          generationIndex: 1,
          searchableText: 'child',
        },
      ],
      [
        'orphan',
        {
          id: 'orphan',
          parentId: null,
          childIds: [],
          message: { messageId: 'orphan', text: 'Orphan', isCreatedByUser: false },
          role: 'assistant',
          lifecycle: 'complete',
          generationIndex: 2,
          searchableText: 'orphan',
        },
      ],
    ]),
    orderedIds: ['root', 'child', 'orphan'],
    rootIds: ['root'],
    parentById: new Map([
      ['root', null],
      ['child', 'root'],
      ['orphan', null],
    ]),
    childrenByParent: new Map(),
    activeMessageIds: new Set(),
  };
}

describe('buildVisibleTreeItems', () => {
  it('uses a shared iterative traversal that is cycle-safe and includes disconnected nodes', () => {
    const items = buildVisibleTreeItems(createGraph(), new Set());

    expect(items.map((item) => item.id)).toEqual(['root', 'child', 'orphan']);
    expect(items.find((item) => item.id === 'child')?.depth).toBe(2);
  });

  it('handles large root and disconnected sets without duplicating traversal entries', () => {
    const count = 400;
    const nodes = new Map(createGraph().nodes);
    const orderedIds = ['root', 'child', 'orphan'];

    for (let index = 0; index < count; index += 1) {
      const id = `bulk-${index}`;
      nodes.set(id, {
        id,
        parentId: null,
        childIds: [],
        message: { messageId: id, text: `Bulk ${index}`, isCreatedByUser: false },
        role: 'assistant',
        lifecycle: 'complete',
        generationIndex: index + 3,
        searchableText: id,
      });
      orderedIds.push(id);
    }

    const items = buildVisibleTreeItems(
      {
        ...createGraph(),
        nodes,
        orderedIds,
        rootIds: ['root', 'root'],
      },
      new Set(),
    );

    expect(items).toHaveLength(count + 3);
    expect(new Set(items.map((item) => item.id)).size).toBe(count + 3);
    expect(items[0]?.id).toBe('root');
    expect(items.at(-1)?.id).toBe(`bulk-${count - 1}`);
  });
});
