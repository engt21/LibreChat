const fs = require('fs');
const path = require('path');

const REQUEST_CONTROLLER_PATH = path.resolve(__dirname, '../request.js');

describe('agent stream finalizing event guard', () => {
  let source;

  beforeAll(() => {
    source = fs.readFileSync(REQUEST_CONTROLLER_PATH, 'utf8');
  });

  it('emits stream_finalizing before final persistence can keep Stop visible', () => {
    expect(source).toContain("const STREAM_FINALIZING_EVENT = 'stream_finalizing'");
    expect(source).toMatch(
      /GenerationJobManager\.emitChunk\(streamId,\s*\{\s*event:\s*STREAM_FINALIZING_EVENT\s*\}\)[\s\S]*await databasePromise/,
    );
    expect(source).toMatch(
      /sendEvent\(res,\s*\{\s*event:\s*STREAM_FINALIZING_EVENT\s*\}\)[\s\S]*await databasePromise/,
    );
  });
});
