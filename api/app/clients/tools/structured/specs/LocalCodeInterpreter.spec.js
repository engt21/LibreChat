const axios = require('axios');

jest.mock('axios');

const LocalCodeInterpreter = require('../LocalCodeInterpreter');

describe('LocalCodeInterpreter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('executes code through the self-hosted bridge', async () => {
    axios.post.mockResolvedValue({ data: { stdout: '7\n', stderr: '', exit_code: 0 } });
    const tool = new LocalCodeInterpreter({
      CODE_INTERPRETER_URL: 'http://code-interpreter.local/v1',
      CODE_INTERPRETER_API_KEY: 'test-key',
    });

    const result = JSON.parse(await tool._call({ code: 'print(3 + 4)', language: 'python' }));

    expect(result.stdout).toBe('7\n');
    expect(axios.post).toHaveBeenCalledWith(
      'http://code-interpreter.local/v1/exec',
      { lang: 'python', code: 'print(3 + 4)' },
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
      }),
    );
  });
});
