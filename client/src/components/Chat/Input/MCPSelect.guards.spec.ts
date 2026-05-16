import fs from 'fs';
import path from 'path';

describe('MCPSelect.tsx -- chat bar visibility guard', () => {
  const source = fs.readFileSync(path.join(__dirname, 'MCPSelect.tsx'), 'utf8');

  it('does not hide the MCP chat-bar selector solely because nothing is pinned or selected', () => {
    expect(source).not.toMatch(/!isPinned\s*&&\s*mcpValues\?\.\s*length\s*===\s*0/);
  });
});
