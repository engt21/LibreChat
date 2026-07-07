import {
  loadCollapsedTreeIds,
  loadTreeOrientation,
  saveCollapsedTreeIds,
  saveTreeOrientation,
} from './storage';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  constructor(
    private readonly options: {
      throwOnGet?: boolean;
      throwOnSet?: boolean;
    } = {},
  ) {}

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    if (this.options.throwOnGet) {
      throw new Error('storage unavailable');
    }
    return this.values.has(key) ? (this.values.get(key) ?? null) : null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    if (this.options.throwOnSet) {
      throw new Error('storage unavailable');
    }
    this.values.set(key, value);
  }
}

describe('conversation tree storage', () => {
  it('loads and saves collapsed ids and orientation using conversation-scoped keys', () => {
    const storage = new MemoryStorage();

    saveCollapsedTreeIds('convo-1', ['child-1', 'child-2'], storage);
    saveTreeOrientation('convo-1', 'vertical', storage);

    expect(loadCollapsedTreeIds('convo-1', storage)).toEqual(['child-1', 'child-2']);
    expect(loadTreeOrientation('convo-1', storage)).toBe('vertical');
    expect(storage.getItem('generation-tree:convo-1:collapsed')).toBe(
      JSON.stringify(['child-1', 'child-2']),
    );
    expect(storage.getItem('generation-tree:convo-1:orientation')).toBe('vertical');
  });

  it('returns safe defaults for corrupt JSON or wrong collapsed-value shapes', () => {
    const storage = new MemoryStorage();
    storage.setItem('generation-tree:convo-2:collapsed', '{not json');
    expect(loadCollapsedTreeIds('convo-2', storage)).toEqual([]);

    storage.setItem('generation-tree:convo-2:collapsed', JSON.stringify({ ids: ['x'] }));
    expect(loadCollapsedTreeIds('convo-2', storage)).toEqual([]);

    storage.setItem(
      'generation-tree:convo-2:collapsed',
      JSON.stringify(['ok', 123, null, 'still-ok']),
    );
    expect(loadCollapsedTreeIds('convo-2', storage)).toEqual(['ok', 'still-ok']);
  });

  it('accepts only valid orientation values', () => {
    const storage = new MemoryStorage();
    storage.setItem('generation-tree:convo-5:orientation', 'diagonal');

    expect(loadTreeOrientation('convo-5', storage)).toBe('horizontal');

    saveTreeOrientation('convo-5', 'horizontal', storage);
    expect(loadTreeOrientation('convo-5', storage)).toBe('horizontal');

    saveTreeOrientation('convo-5', 'diagonal' as never, storage);
    expect(loadTreeOrientation('convo-5', storage)).toBe('horizontal');
  });

  it('isolates orientation between conversations', () => {
    const storage = new MemoryStorage();

    saveTreeOrientation('convo-1', 'vertical', storage);
    saveTreeOrientation('convo-2', 'horizontal', storage);

    expect(loadTreeOrientation('convo-1', storage)).toBe('vertical');
    expect(loadTreeOrientation('convo-2', storage)).toBe('horizontal');
  });

  it('handles unavailable storage without throwing', () => {
    const unavailableRead = new MemoryStorage({ throwOnGet: true });
    const unavailableWrite = new MemoryStorage({ throwOnSet: true });

    expect(loadCollapsedTreeIds('convo-3', unavailableRead)).toEqual([]);
    expect(loadTreeOrientation('convo-3', unavailableRead)).toBe('horizontal');
    expect(() => saveCollapsedTreeIds('convo-3', ['child'], unavailableWrite)).not.toThrow();
    expect(() => saveTreeOrientation('convo-3', 'vertical', unavailableWrite)).not.toThrow();
  });

  it('never persists message content or coordinates', () => {
    const storage = new MemoryStorage();

    saveCollapsedTreeIds('convo-4', ['child-1'], storage);
    saveTreeOrientation('convo-4', 'horizontal', storage);

    expect([...Array.from({ length: storage.length }, (_, index) => storage.key(index))]).toEqual([
      'generation-tree:convo-4:collapsed',
      'generation-tree:convo-4:orientation',
    ]);
    expect(storage.getItem('generation-tree:convo-4:collapsed')).not.toContain('message');
    expect(storage.getItem('generation-tree:convo-4:collapsed')).not.toContain('x');
    expect(storage.getItem('generation-tree:convo-4:collapsed')).not.toContain('y');
  });
});
