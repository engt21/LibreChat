const LocalFileSearch = require('../LocalFileSearch');

describe('LocalFileSearch', () => {
  it('exposes the local vector-search tool contract', () => {
    const tool = new LocalFileSearch({ override: true });

    expect(tool.name).toBe('local_file_search');
    expect(tool.description).toContain('local LibreChat vector database');
    expect(tool.schema.required).toEqual(['query']);
  });
});
