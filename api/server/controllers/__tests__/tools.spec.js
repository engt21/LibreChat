/**
 * Tests for callTool controller – managed code execution path
 * (VAL-FILES-007: managed code interpreter on the chat surface)
 */
jest.mock('@librechat/data-schemas', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('@librechat/agents', () => ({
  EnvVar: { CODE_API_KEY: 'LIBRECHAT_CODE_API_KEY' },
}));

jest.mock('@librechat/api', () => ({
  checkAccess: jest.fn().mockResolvedValue(true),
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
}));

jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-nanoid'),
}));

jest.mock('~/server/services/Files/process', () => ({
  processFileURL: jest.fn(),
  uploadImageBuffer: jest.fn(),
}));

jest.mock('~/server/services/Files/Code/process', () => ({
  processCodeOutput: jest.fn(),
}));

jest.mock('~/models/ToolCall', () => ({
  createToolCall: jest.fn().mockResolvedValue({}),
  getToolCallsByConvo: jest.fn().mockResolvedValue([]),
}));

jest.mock('~/server/services/Tools/credentials', () => ({
  loadAuthValues: jest.fn().mockResolvedValue({
    LIBRECHAT_CODE_API_KEY: 'test-api-key',
  }),
}));

jest.mock('~/models/Message', () => ({
  getMessage: jest.fn(),
}));

jest.mock('~/models/Role', () => ({
  getRoleByName: jest.fn(),
}));

const mockInvoke = jest.fn();
const mockLoadTools = jest.fn();

jest.mock('~/app/clients/tools/util', () => ({
  loadTools: (...args) => mockLoadTools(...args),
}));

const { Tools, ToolCallTypes } = require('librechat-data-provider');
const { getMessage } = require('~/models/Message');
const { processCodeOutput } = require('~/server/services/Files/Code/process');
const { createToolCall } = require('~/models/ToolCall');
const { callTool, getToolCalls, verifyToolAuth } = require('../../controllers/tools');

function createMockReq(overrides = {}) {
  return {
    user: { id: 'user-1', role: 'USER' },
    params: { toolId: Tools.execute_code },
    body: {
      messageId: 'msg-1',
      conversationId: 'conv-1',
      partIndex: 0,
      blockIndex: 0,
      lang: 'python',
      code: 'print(2+2)',
    },
    config: {
      webSearch: {},
      fileStrategy: 'local',
      imageOutputType: 'webp',
      fileConfig: {},
    },
    ...overrides,
  };
}

function createMockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('callTool controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMessage.mockResolvedValue({ messageId: 'msg-1', user: 'user-1' });
    mockLoadTools.mockResolvedValue({
      loadedTools: [
        {
          name: Tools.execute_code,
          invoke: mockInvoke,
          apiKey: 'test-api-key',
        },
      ],
    });
    mockInvoke.mockResolvedValue({
      content: 'stdout:\n4\n',
      artifact: null,
    });
  });

  it('returns 404 for unknown tool IDs', async () => {
    const req = createMockReq({ params: { toolId: 'nonexistent_tool' } });
    const res = createMockRes();
    await callTool(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Tool not found' });
  });

  it('returns 400 when messageId is missing', async () => {
    const req = createMockReq();
    delete req.body.messageId;
    const res = createMockRes();
    await callTool(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 404 when message does not exist', async () => {
    getMessage.mockResolvedValue(null);
    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('executes managed code and returns result without artifacts', async () => {
    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    expect(mockLoadTools).toHaveBeenCalledWith(
      expect.objectContaining({
        user: 'user-1',
        tools: [Tools.execute_code],
        functions: true,
      }),
    );
    expect(mockInvoke).toHaveBeenCalledWith(
      expect.objectContaining({
        name: Tools.execute_code,
        type: ToolCallTypes.TOOL_CALL,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ result: 'stdout:\n4\n' });
  });

  it('processes code output files and returns attachments', async () => {
    mockInvoke.mockResolvedValue({
      content: 'stdout:\n4\nGenerated files:\n- /mnt/data/output.csv',
      artifact: {
        session_id: 'sess-1',
        files: [{ id: 'file-1', name: 'output.csv' }],
      },
    });

    processCodeOutput.mockResolvedValue({
      file_id: 'local-file-1',
      filename: 'output.csv',
      filepath: '/uploads/user-1/local-file-1__output.csv',
      type: 'text/csv',
      messageId: 'msg-1',
      toolCallId: expect.any(String),
    });

    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    expect(processCodeOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        req,
        id: 'file-1',
        name: 'output.csv',
        session_id: 'sess-1',
        messageId: 'msg-1',
        conversationId: 'conv-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.any(String),
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: 'output.csv' }),
        ]),
      }),
    );
  });

  it('handles processCodeOutput failure gracefully (null file metadata)', async () => {
    mockInvoke.mockResolvedValue({
      content: 'Generated files:\n- /mnt/data/output.csv',
      artifact: {
        session_id: 'sess-1',
        files: [{ id: 'file-1', name: 'output.csv' }],
      },
    });
    processCodeOutput.mockResolvedValue(null);

    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.any(String),
        attachments: [null],
      }),
    );
  });

  it('returns 500 with error detail when tool invocation fails', async () => {
    mockInvoke.mockRejectedValue(new Error('Execution error:\n\nHTTP error! status: 502'));
    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Execution error') }),
    );
  });

  it('forwards upstream error status codes from tool execution', async () => {
    const upstreamError = new Error('Bad Request: invalid code');
    upstreamError.status = 400;
    mockInvoke.mockRejectedValue(upstreamError);
    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Bad Request: invalid code' }),
    );
  });

  it('returns 500 when tool fails to load (empty loadedTools)', async () => {
    mockLoadTools.mockResolvedValue({ loadedTools: [] });
    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Tool could not be initialized' }),
    );
  });

  it('returns 500 with load error detail when loadTools throws', async () => {
    mockLoadTools.mockRejectedValue(new Error('No API key provided'));
    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('No API key') }),
    );
  });

  it('records tool call data with attachments in createToolCall', async () => {
    mockInvoke.mockResolvedValue({
      content: 'stdout:\nDone\nGenerated files:\n- /mnt/data/plot.png',
      artifact: {
        session_id: 'sess-1',
        files: [{ id: 'img-1', name: 'plot.png' }],
      },
    });
    processCodeOutput.mockResolvedValue({
      file_id: 'local-img-1',
      filename: 'plot.png',
      filepath: '/images/user-1/local-img-1.webp',
      type: 'image/webp',
      messageId: 'msg-1',
      toolCallId: 'user-1_mock-nanoid',
    });

    const req = createMockReq();
    const res = createMockRes();
    await callTool(req, res);

    // createToolCall is called fire-and-forget; verify it was called with attachments
    expect(createToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        toolId: Tools.execute_code,
        messageId: 'msg-1',
        conversationId: 'conv-1',
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: 'plot.png' }),
        ]),
      }),
    );
  });
});
