const OpenAI = require('openai');

const mockGenerate = jest.fn();
const mockEmitChunk = jest.fn();
const mockLogAxiosError = jest.fn();

jest.mock('openai');
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock(
  'librechat-data-provider',
  () => ({
    ContentTypes: {
      IMAGE_URL: 'image_url',
      TEXT: 'text',
    },
    EImageOutputType: {
      PNG: 'png',
      WEBP: 'webp',
      JPEG: 'jpeg',
    },
  }),
  { virtual: true },
);
jest.mock(
  '@librechat/api',
  () => ({
    logAxiosError: mockLogAxiosError,
    extractBaseURL: (url) => url,
    GenerationJobManager: {
      emitChunk: mockEmitChunk,
    },
    oaiToolkit: {
      image_gen_oai: {
        name: 'image_gen_oai',
        description: 'Generate an image',
        responseFormat: 'content_and_artifact',
        schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
          },
          required: ['prompt'],
        },
      },
      image_edit_oai: {
        name: 'image_edit_oai',
        description: 'Edit an image',
        responseFormat: 'content_and_artifact',
        schema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            image_ids: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['prompt', 'image_ids'],
        },
      },
    },
  }),
  { virtual: true },
);
jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));
jest.mock('~/models', () => ({
  getFiles: jest.fn(),
}));

OpenAI.mockImplementation(() => ({
  images: {
    generate: mockGenerate,
  },
}));

const createOpenAIImageTools = require('../OpenAIImageTools');

async function* streamEvents(events) {
  for (const event of events) {
    yield event;
  }
}

describe('OpenAIImageTools', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      IMAGE_GEN_OAI_API_KEY: 'test-key',
    };
    delete process.env.IMAGE_GEN_OAI_BASEURL;
    delete process.env.IMAGE_GEN_OAI_AZURE_API_VERSION;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('streams GPT image partials, emits attachment previews, and returns completed image artifact', async () => {
    mockGenerate.mockReturnValue(
      streamEvents([
        {
          type: 'image_generation.partial_image',
          partial_image_index: 0,
          b64_json: 'partial-image',
          output_format: 'png',
        },
        {
          type: 'image_generation.completed',
          b64_json: 'final-image',
          output_format: 'png',
        },
      ]),
    );

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      req: { user: { id: 'user-1' } },
      streamId: 'stream-1',
      model: 'gpt-image-2',
      imageOutputType: 'png',
    });

    const result = await imageGenTool.invoke(
      { prompt: 'a watercolor fox' },
      {
        toolCall: { id: 'call-1' },
        metadata: {
          run_id: 'message-1',
          thread_id: 'conversation-1',
        },
      },
    );

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-image-2',
        stream: true,
        partial_images: 3,
        prompt: 'a watercolor fox',
      }),
      expect.objectContaining({ stream: true }),
    );
    expect(mockEmitChunk).toHaveBeenCalledWith('stream-1', {
      event: 'attachment',
      data: expect.objectContaining({
        messageId: 'message-1',
        conversationId: 'conversation-1',
        toolCallId: 'call-1',
        filename: 'image_gen_oai_partial_0.png',
        filepath: 'data:image/png;base64,partial-image',
        partial: true,
      }),
    });
    expect(mockEmitChunk).toHaveBeenCalledWith('stream-1', {
      event: 'attachment',
      data: expect.objectContaining({
        filename: 'image_gen_oai_complete.png',
        filepath: 'data:image/png;base64,final-image',
        partial: false,
      }),
    });
    expect(result.artifact.content[0].image_url.url).toBe('data:image/png;base64,final-image');
  });

  it('keeps Azure image generation on the existing non-streaming path', async () => {
    process.env.IMAGE_GEN_OAI_BASEURL = 'https://example.openai.azure.com/openai/deployments/img';
    process.env.IMAGE_GEN_OAI_AZURE_API_VERSION = '2025-04-01-preview';
    mockGenerate.mockResolvedValue({
      data: [{ b64_json: 'azure-final' }],
      output_format: 'png',
    });

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      req: { user: { id: 'user-1' } },
      streamId: 'stream-1',
      model: 'gpt-image-2',
      imageOutputType: 'png',
    });

    const result = await imageGenTool.invoke(
      { prompt: 'a watercolor fox' },
      {
        toolCall: { id: 'call-1' },
        metadata: {
          run_id: 'message-1',
          thread_id: 'conversation-1',
        },
      },
    );

    expect(mockGenerate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        stream: true,
        partial_images: expect.any(Number),
      }),
      expect.not.objectContaining({ stream: true }),
    );
    expect(mockEmitChunk).not.toHaveBeenCalled();
    expect(result.artifact.content[0].image_url.url).toBe('data:image/png;base64,azure-final');
  });

  it('falls back to non-streaming generation when the streaming request is unsupported', async () => {
    const streamError = new Error('unknown parameter: partial_images');
    streamError.status = 400;
    mockGenerate
      .mockRejectedValueOnce(streamError)
      .mockResolvedValueOnce({ data: [{ b64_json: 'fallback-final' }], output_format: 'png' });

    const [imageGenTool] = createOpenAIImageTools({
      isAgent: true,
      req: { user: { id: 'user-1' } },
      streamId: 'stream-1',
      model: 'gpt-image-2',
      imageOutputType: 'png',
    });

    const result = await imageGenTool.invoke(
      { prompt: 'a watercolor fox' },
      {
        toolCall: { id: 'call-1' },
        metadata: {
          run_id: 'message-1',
          thread_id: 'conversation-1',
        },
      },
    );

    expect(mockGenerate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ stream: true, partial_images: 3 }),
      expect.objectContaining({ stream: true }),
    );
    expect(mockGenerate).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ stream: true }),
      expect.not.objectContaining({ stream: true }),
    );
    expect(result.artifact.content[0].image_url.url).toBe('data:image/png;base64,fallback-final');
    expect(mockLogAxiosError).not.toHaveBeenCalled();
  });
});
