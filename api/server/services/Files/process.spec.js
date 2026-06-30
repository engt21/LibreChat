jest.mock('uuid', () => ({ v4: jest.fn(() => 'mock-uuid') }));

jest.mock('@librechat/data-schemas', () => ({
  logger: { warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
}));

jest.mock('@librechat/agents', () => ({
  EnvVar: { CODE_API_KEY: 'CODE_API_KEY' },
}));

jest.mock('@librechat/api', () => ({
  sanitizeFilename: jest.fn((n) => n),
  parseText: jest.fn().mockResolvedValue({ text: '', bytes: 0 }),
  processAudioFile: jest.fn(),
}));

jest.mock('librechat-data-provider', () => ({
  ...jest.requireActual('librechat-data-provider'),
  mergeFileConfig: jest.fn(),
}));

jest.mock('~/server/services/Files/images', () => ({
  convertImage: jest.fn(),
  resizeAndConvert: jest.fn(),
  resizeImageBuffer: jest.fn(),
}));

jest.mock('~/server/controllers/assistants/v2', () => ({
  addResourceFileId: jest.fn(),
  deleteResourceFileId: jest.fn(),
}));

jest.mock('~/models/Agent', () => ({
  addAgentResourceFile: jest.fn().mockResolvedValue({}),
  removeAgentResourceFiles: jest.fn(),
}));

jest.mock('~/server/controllers/assistants/helpers', () => ({
  getOpenAIClient: jest.fn(),
}));

jest.mock('~/server/services/Tools/credentials', () => ({
  loadAuthValues: jest.fn(),
}));

jest.mock('~/models', () => ({
  createFile: jest.fn().mockResolvedValue({ file_id: 'created-file-id' }),
  updateFile: jest.fn().mockResolvedValue({ file_id: 'created-file-id', text: 'updated text' }),
  updateFileUsage: jest.fn(),
  deleteFiles: jest.fn(),
}));

jest.mock('~/server/utils/getFileStrategy', () => ({
  getFileStrategy: jest.fn().mockReturnValue('local'),
}));

jest.mock('~/server/services/Config', () => ({
  checkCapability: jest.fn().mockResolvedValue(true),
}));

jest.mock('~/server/utils/queue', () => ({
  LB_QueueAsyncCall: jest.fn(),
}));

jest.mock('~/server/services/Files/strategies', () => ({
  getStrategyFunctions: jest.fn(),
}));

jest.mock('~/server/utils', () => ({
  determineFileType: jest.fn(),
}));

jest.mock('~/server/services/Files/Audio/STTService', () => ({
  STTService: { getInstance: jest.fn() },
}));

const {
  EModelEndpoint,
  EToolResources,
  FileSources,
  AgentCapabilities,
} = require('librechat-data-provider');
const { mergeFileConfig } = require('librechat-data-provider');
const { checkCapability } = require('~/server/services/Config');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { filterFile, processAgentFileUpload } = require('./process');

const PDF_MIME = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS_MIME = 'application/vnd.ms-excel';
const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';
const ODT_MIME = 'application/vnd.oasis.opendocument.text';
const ODP_MIME = 'application/vnd.oasis.opendocument.presentation';
const ODG_MIME = 'application/vnd.oasis.opendocument.graphics';

const makeReq = ({ mimetype = PDF_MIME, ocrConfig = null } = {}) => ({
  user: { id: 'user-123' },
  file: {
    path: '/tmp/upload.bin',
    originalname: 'upload.bin',
    filename: 'upload-uuid.bin',
    mimetype,
  },
  body: { model: 'gpt-4o' },
  config: {
    fileConfig: {},
    fileStrategy: 'local',
    ocr: ocrConfig,
  },
});

const makeMetadata = () => ({
  agent_id: 'agent-abc',
  tool_resource: EToolResources.context,
  file_id: 'file-uuid-123',
});

const mockRes = {
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnValue({}),
};

const makeFileConfig = ({ ocrSupportedMimeTypes = [] } = {}) => ({
  checkType: (mime, types) => (types ?? []).includes(mime),
  ocr: { supportedMimeTypes: ocrSupportedMimeTypes },
  stt: { supportedMimeTypes: [] },
  text: { supportedMimeTypes: [] },
});

describe('processAgentFileUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRes.status.mockReturnThis();
    mockRes.json.mockReturnValue({});
    checkCapability.mockResolvedValue(true);
    getStrategyFunctions.mockReturnValue({
      handleFileUpload: jest
        .fn()
        .mockResolvedValue({ text: 'extracted text', bytes: 42, filepath: 'doc://result' }),
    });
    mergeFileConfig.mockReturnValue(makeFileConfig());
  });

  describe('filterFile raw code interpreter uploads', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const strictConfig = {
      endpoints: {
        default: {
          fileSizeLimit: 512 * 1024 * 1024,
          totalSizeLimit: 512 * 1024 * 1024,
          supportedMimeTypes: [/^text\/plain$/],
          disabled: false,
        },
        agents: {
          fileSizeLimit: 512 * 1024 * 1024,
          totalSizeLimit: 512 * 1024 * 1024,
          supportedMimeTypes: [/^text\/plain$/],
          disabled: false,
        },
        assistants: {
          fileSizeLimit: 512 * 1024 * 1024,
          totalSizeLimit: 512 * 1024 * 1024,
          supportedMimeTypes: [/^text\/plain$/],
          disabled: false,
        },
      },
      checkType: (mime, types = []) => types.some((regex) => regex.test(mime)),
      serverFileSizeLimit: 512 * 1024 * 1024,
      avatarSizeLimit: 2 * 1024 * 1024,
    };

    beforeEach(() => {
      mergeFileConfig.mockReturnValue(strictConfig);
    });

    test('allows unsupported MIME types for execute_code uploads', () => {
      const req = makeReq({ mimetype: 'application/octet-stream' });
      req.file.size = 12;
      req.body = {
        endpoint: EModelEndpoint.agents,
        file_id: uuid,
        tool_resource: EToolResources.execute_code,
      };

      expect(() => filterFile({ req })).not.toThrow();
    });

    test('still rejects unsupported MIME types outside execute_code uploads', () => {
      const req = makeReq({ mimetype: 'application/octet-stream' });
      req.file.size = 12;
      req.body = {
        endpoint: EModelEndpoint.agents,
        file_id: uuid,
      };

      expect(() => filterFile({ req })).toThrow('Unsupported file type');
    });

    test('does not apply the raw-file bypass to Assistants uploads', () => {
      const req = makeReq({ mimetype: 'application/octet-stream' });
      req.file.size = 12;
      req.body = {
        endpoint: EModelEndpoint.assistants,
        file_id: uuid,
        tool_resource: EToolResources.execute_code,
      };

      expect(() => filterFile({ req })).toThrow('Unsupported file type');
    });
  });

  describe('OCR strategy selection', () => {
    test.each([
      ['PDF', PDF_MIME],
      ['DOCX', DOCX_MIME],
      ['XLSX', XLSX_MIME],
      ['XLS', XLS_MIME],
      ['ODS', ODS_MIME],
      ['Excel variant (msexcel)', 'application/msexcel'],
      ['Excel variant (x-msexcel)', 'application/x-msexcel'],
    ])('uses document_parser automatically for %s when no OCR is configured', async (_, mime) => {
      mergeFileConfig.mockReturnValue(makeFileConfig());
      const req = makeReq({ mimetype: mime, ocrConfig: null });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('does not check OCR capability when using automatic document_parser fallback', async () => {
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).not.toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('uses the configured OCR strategy when OCR is set up for the file type', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.mistral_ocr);
    });

    test('uses document_parser as default when OCR is configured but no strategy is specified', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { supportedMimeTypes: [PDF_MIME] },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('throws when configured OCR capability is not enabled for the agent', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      checkCapability.mockResolvedValue(false);
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow('OCR capability is not enabled for Agents');
    });

    test('uses document_parser (no capability check) when OCR capability returns false but no OCR config', async () => {
      checkCapability.mockResolvedValue(false);
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).not.toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('uses document_parser when OCR is configured but the file type is not in OCR supported types', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const req = makeReq({
        mimetype: DOCX_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).not.toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
      expect(getStrategyFunctions).not.toHaveBeenCalledWith(FileSources.mistral_ocr);
    });

    test('does not invoke any OCR strategy for unsupported MIME types without OCR config', async () => {
      const req = makeReq({ mimetype: 'text/plain', ocrConfig: null });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow('File type text/plain is not supported for text parsing.');

      expect(getStrategyFunctions).not.toHaveBeenCalled();
    });

    test.each([
      ['ODT', ODT_MIME],
      ['ODP', ODP_MIME],
      ['ODG', ODG_MIME],
    ])('routes %s through configured OCR when OCR supports the type', async (_, mime) => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [mime] }));
      const req = makeReq({
        mimetype: mime,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() });

      expect(checkCapability).toHaveBeenCalledWith(expect.anything(), AgentCapabilities.ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.mistral_ocr);
    });

    test('throws instead of falling back to parseText when document_parser fails for a document MIME type', async () => {
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockRejectedValue(new Error('No text found in document')),
      });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });
      const { parseText } = require('@librechat/api');

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow(/image-based and requires an OCR service/);

      expect(parseText).not.toHaveBeenCalled();
    });

    test('falls back to document_parser when configured OCR fails for a document MIME type', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      const failingUpload = jest.fn().mockRejectedValue(new Error('OCR API returned 500'));
      const fallbackUpload = jest
        .fn()
        .mockResolvedValue({ text: 'parsed text', bytes: 11, filepath: 'doc://result' });
      getStrategyFunctions
        .mockReturnValueOnce({ handleFileUpload: failingUpload })
        .mockReturnValueOnce({ handleFileUpload: fallbackUpload });
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).resolves.not.toThrow();

      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.mistral_ocr);
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.document_parser);
    });

    test('throws when both configured OCR and document_parser fallback fail', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockRejectedValue(new Error('failure')),
      });
      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });
      const { parseText } = require('@librechat/api');

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow(/image-based and requires an OCR service/);

      expect(parseText).not.toHaveBeenCalled();
    });
  });

  describe('text size guard', () => {
    test('throws before writing to MongoDB when extracted text exceeds 15MB', async () => {
      const oversizedText = 'x'.repeat(15 * 1024 * 1024 + 1);
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockResolvedValue({
          text: oversizedText,
          bytes: Buffer.byteLength(oversizedText, 'utf8'),
          filepath: 'doc://result',
        }),
      });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });
      const { createFile } = require('~/models');

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).rejects.toThrow(/exceeds the 15MB storage limit/);

      expect(createFile).not.toHaveBeenCalled();
    });

    test('succeeds when extracted text is within the 15MB limit', async () => {
      const okText = 'x'.repeat(1024);
      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockResolvedValue({
          text: okText,
          bytes: Buffer.byteLength(okText, 'utf8'),
          filepath: 'doc://result',
        }),
      });
      const req = makeReq({ mimetype: PDF_MIME, ocrConfig: null });

      await expect(
        processAgentFileUpload({ req, res: mockRes, metadata: makeMetadata() }),
      ).resolves.not.toThrow();
    });
  });

  describe('image context uploads', () => {
    test('stores image attachments and OCR text together when context mode is used', async () => {
      const { createFile, updateFile } = require('~/models');
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: ['image/png'] }));

      const ocrUpload = jest.fn().mockResolvedValue({
        text: 'screenshot text',
        bytes: 15,
        filepath: 'ocr://result',
      });
      const imageUpload = jest.fn().mockResolvedValue({
        filepath: '/images/screenshot.png',
        bytes: 123,
        width: 100,
        height: 200,
      });

      getStrategyFunctions
        .mockReturnValueOnce({ handleFileUpload: ocrUpload })
        .mockReturnValueOnce({ handleImageUpload: imageUpload });

      const req = makeReq({
        mimetype: 'image/png',
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });
      req.file.originalname = 'screenshot.png';
      req.config.imageOutputType = 'png';

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      await expect(processAgentFileUpload({ req, res: mockRes, metadata })).resolves.not.toThrow();

      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.mistral_ocr);
      expect(imageUpload).toHaveBeenCalled();
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          filepath: '/images/screenshot.png',
        }),
        true,
      );
      expect(updateFile).toHaveBeenCalledWith({
        file_id: 'created-file-id',
        text: 'screenshot text',
      });
    });
  });

  describe('native OpenAI message uploads', () => {
    test('stores execute_code message attachments locally when native OpenAI code interpreter is requested', async () => {
      const { createFile } = require('~/models');
      const { loadAuthValues } = require('~/server/services/Tools/credentials');
      const uploadLocalFile = jest.fn().mockResolvedValue({
        bytes: 12,
        filename: 'native.csv',
        filepath: '/uploads/native.csv',
      });
      getStrategyFunctions.mockReturnValue({ handleFileUpload: uploadLocalFile });

      const req = makeReq({ mimetype: 'text/csv' });
      const metadata = {
        file_id: 'file-uuid-123',
        tool_resource: EToolResources.execute_code,
        native_tool: EToolResources.execute_code,
        message_file: true,
        endpointType: EModelEndpoint.openAI,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      expect(loadAuthValues).not.toHaveBeenCalled();
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.local);
      expect(uploadLocalFile).toHaveBeenCalled();
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          context: 'message_attachment',
          metadata: { nativeTool: EToolResources.execute_code },
        }),
        true,
      );
    });

    test('stores file_search message attachments without vectorizing when native OpenAI file search is requested', async () => {
      const { createFile } = require('~/models');
      const uploadLocalFile = jest.fn().mockResolvedValue({
        bytes: 24,
        filename: 'knowledge.txt',
        filepath: '/uploads/knowledge.txt',
      });
      getStrategyFunctions.mockReturnValue({ handleFileUpload: uploadLocalFile });

      const req = makeReq({ mimetype: 'text/plain' });
      const metadata = {
        file_id: 'file-uuid-123',
        tool_resource: EToolResources.file_search,
        native_tool: EToolResources.file_search,
        message_file: true,
        endpointType: EModelEndpoint.openAI,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      expect(checkCapability).not.toHaveBeenCalledWith(
        expect.anything(),
        AgentCapabilities.file_search,
      );
      expect(getStrategyFunctions).toHaveBeenCalledWith(FileSources.local);
      expect(uploadLocalFile).toHaveBeenCalled();
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          context: 'message_attachment',
          metadata: { nativeTool: EToolResources.file_search },
        }),
        true,
      );
    });

    test('stores Azure native file_search uploads locally with nativeTool metadata', async () => {
      const { createFile } = require('~/models');
      const uploadLocalFile = jest.fn().mockResolvedValue({
        bytes: 30,
        filename: 'azure-doc.pdf',
        filepath: '/uploads/azure-doc.pdf',
      });
      getStrategyFunctions.mockReturnValue({ handleFileUpload: uploadLocalFile });

      const req = makeReq({ mimetype: 'application/pdf' });
      const metadata = {
        file_id: 'file-uuid-123',
        tool_resource: EToolResources.file_search,
        native_tool: EToolResources.file_search,
        message_file: true,
        endpointType: EModelEndpoint.azureOpenAI,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      expect(checkCapability).not.toHaveBeenCalledWith(
        expect.anything(),
        AgentCapabilities.file_search,
      );
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          context: 'message_attachment',
          metadata: { nativeTool: EToolResources.file_search },
        }),
        true,
      );
    });

    test('non-OpenAI/Azure endpoints do not produce nativeTool metadata even with native_tool hint', async () => {
      const { createFile } = require('~/models');
      const uploadLocalFile = jest.fn().mockResolvedValue({
        bytes: 20,
        filename: 'google-doc.txt',
        filepath: '/uploads/google-doc.txt',
        embedded: false,
      });
      jest.mock('./VectorDB/crud', () => ({
        uploadVectors: jest.fn().mockResolvedValue({
          embedded: true,
          provider: 'google',
          model: 'text-embedding-004',
          filename: 'google-doc.txt',
        }),
      }));
      getStrategyFunctions.mockReturnValue({ handleFileUpload: uploadLocalFile });

      const req = makeReq({ mimetype: 'text/plain' });
      req.body.model = 'gemini-2.0-flash';
      const metadata = {
        file_id: 'file-uuid-123',
        agent_id: 'agent-abc',
        tool_resource: EToolResources.file_search,
        native_tool: EToolResources.file_search,
        message_file: true,
        endpointType: EModelEndpoint.google,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      // Google should NOT get nativeTool because getNativeUploadTool only supports openAI/azure
      const createFileCall = createFile.mock.calls[0][0];
      expect(createFileCall.metadata?.nativeTool).toBeUndefined();
    });
  });

  describe('file_search dual storage for RAG files (VAL-FILES-001)', () => {
    test('uploads to both storage and vector DB, persisting ragProvider metadata', async () => {
      const { createFile } = require('~/models');
      const storageUpload = jest.fn().mockResolvedValue({
        bytes: 100,
        filename: 'knowledge.pdf',
        filepath: '/uploads/knowledge.pdf',
      });

      jest.mock('./VectorDB/crud', () => ({
        uploadVectors: jest.fn().mockResolvedValue({
          embedded: true,
          provider: 'google',
          model: 'text-embedding-004',
          filename: 'knowledge.pdf',
        }),
      }));

      getStrategyFunctions.mockReturnValue({ handleFileUpload: storageUpload });

      const req = makeReq({ mimetype: 'application/pdf' });
      req.body.model = 'gemini-2.0-flash';
      const metadata = {
        file_id: 'file-uuid-123',
        agent_id: 'agent-abc',
        tool_resource: EToolResources.file_search,
        message_file: false,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      expect(storageUpload).toHaveBeenCalled();
      const { uploadVectors } = require('./VectorDB/crud');
      expect(uploadVectors).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
        }),
      );
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          embedded: true,
          metadata: expect.objectContaining({
            ragProvider: 'google',
            ragModel: 'text-embedding-004',
          }),
        }),
        true,
      );
    });

    test('passes endpointType to uploadVectors so provider is resolved from request metadata', async () => {
      const { createFile } = require('~/models');
      const storageUpload = jest.fn().mockResolvedValue({
        bytes: 50,
        filename: 'doc.txt',
        filepath: '/uploads/doc.txt',
      });

      // Get the hoisted mock and reconfigure it for this test
      const { uploadVectors } = require('./VectorDB/crud');
      uploadVectors.mockResolvedValue({
        embedded: true,
        provider: 'azureOpenAI',
        model: 'text-embedding-3-small',
        filename: 'doc.txt',
      });

      getStrategyFunctions.mockReturnValue({ handleFileUpload: storageUpload });

      const req = makeReq({ mimetype: 'text/plain' });
      req.body.endpointType = 'azureOpenAI';
      req.body.model = 'gpt-4o';
      const metadata = {
        file_id: 'file-uuid-123',
        agent_id: 'agent-abc',
        tool_resource: EToolResources.file_search,
        endpointType: 'azureOpenAI',
        message_file: false,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      expect(uploadVectors).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          endpointType: 'azureOpenAI',
        }),
      );

      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            ragProvider: 'azureOpenAI',
            ragModel: 'text-embedding-3-small',
          }),
        }),
        true,
      );
    });
  });

  describe('image context mode (VAL-FILES-002)', () => {
    test('routes image uploads through createImageContextFile even without OCR config', async () => {
      const { createFile } = require('~/models');
      mergeFileConfig.mockReturnValue(makeFileConfig());

      const imageUpload = jest.fn().mockResolvedValue({
        filepath: '/images/screenshot.png',
        bytes: 456,
        width: 800,
        height: 600,
      });

      getStrategyFunctions.mockReturnValue({ handleImageUpload: imageUpload });

      const req = makeReq({ mimetype: 'image/png', ocrConfig: null });
      req.file.originalname = 'screenshot.png';
      req.config.imageOutputType = 'png';

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      // Image should be processed as an image, NOT parsed as text
      expect(imageUpload).toHaveBeenCalled();
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          filepath: '/images/screenshot.png',
          type: 'image/png',
        }),
        true,
      );
    });

    test('routes image through OCR then preserves both image and text when OCR is configured', async () => {
      const { createFile, updateFile } = require('~/models');
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: ['image/jpeg'] }));

      const ocrUpload = jest.fn().mockResolvedValue({
        text: 'OCR extracted text from photo',
        bytes: 30,
        filepath: 'ocr://result',
      });
      const imageUpload = jest.fn().mockResolvedValue({
        filepath: '/images/photo.jpg',
        bytes: 789,
        width: 1920,
        height: 1080,
      });

      getStrategyFunctions
        .mockReturnValueOnce({ handleFileUpload: ocrUpload })
        .mockReturnValueOnce({ handleImageUpload: imageUpload });

      const req = makeReq({
        mimetype: 'image/jpeg',
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });
      req.file.originalname = 'photo.jpg';
      req.config.imageOutputType = 'jpeg';

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      expect(ocrUpload).toHaveBeenCalled();
      expect(imageUpload).toHaveBeenCalled();
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          filepath: '/images/photo.jpg',
        }),
        true,
      );
      expect(updateFile).toHaveBeenCalledWith({
        file_id: 'created-file-id',
        text: 'OCR extracted text from photo',
      });
    });

    test('does not produce binary dump for image uploads in context mode without OCR', async () => {
      const { parseText } = require('@librechat/api');
      mergeFileConfig.mockReturnValue(makeFileConfig());

      const imageUpload = jest.fn().mockResolvedValue({
        filepath: '/images/diagram.png',
        bytes: 999,
        width: 640,
        height: 480,
      });

      getStrategyFunctions.mockReturnValue({ handleImageUpload: imageUpload });

      const req = makeReq({ mimetype: 'image/png', ocrConfig: null });
      req.file.originalname = 'diagram.png';
      req.config.imageOutputType = 'png';

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      // parseText should NOT be called on images
      expect(parseText).not.toHaveBeenCalled();
      // Image upload handler should be used instead
      expect(imageUpload).toHaveBeenCalled();
    });

    test('response includes text field when OCR text is persisted on the image record', async () => {
      const { updateFile } = require('~/models');
      updateFile.mockResolvedValue({
        file_id: 'created-file-id',
        filepath: '/images/receipt.png',
        type: 'image/png',
        text: 'Total: $42.00',
        width: 400,
        height: 300,
      });
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: ['image/png'] }));

      const ocrUpload = jest.fn().mockResolvedValue({
        text: 'Total: $42.00',
        bytes: 14,
        filepath: 'ocr://result',
      });
      const imageUpload = jest.fn().mockResolvedValue({
        filepath: '/images/receipt.png',
        bytes: 500,
        width: 400,
        height: 300,
      });

      getStrategyFunctions
        .mockReturnValueOnce({ handleFileUpload: ocrUpload })
        .mockReturnValueOnce({ handleImageUpload: imageUpload });

      const req = makeReq({
        mimetype: 'image/png',
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });
      req.file.originalname = 'receipt.png';
      req.config.imageOutputType = 'png';

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'created-file-id',
          text: 'Total: $42.00',
        }),
      );
    });

    test('does not call updateFile when OCR returns whitespace-only text', async () => {
      const { createFile, updateFile } = require('~/models');
      createFile.mockResolvedValue({
        file_id: 'created-file-id',
        filepath: '/images/blank.png',
        type: 'image/png',
      });
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: ['image/png'] }));

      const ocrUpload = jest.fn().mockResolvedValue({
        text: '   \n  ',
        bytes: 6,
        filepath: 'ocr://result',
      });
      const imageUpload = jest.fn().mockResolvedValue({
        filepath: '/images/blank.png',
        bytes: 200,
        width: 100,
        height: 100,
      });

      getStrategyFunctions
        .mockReturnValueOnce({ handleFileUpload: ocrUpload })
        .mockReturnValueOnce({ handleImageUpload: imageUpload });

      const req = makeReq({
        mimetype: 'image/png',
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });
      req.file.originalname = 'blank.png';
      req.config.imageOutputType = 'png';

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      await processAgentFileUpload({ req, res: mockRes, metadata });

      // Image should be created but text should NOT be updated for whitespace-only
      expect(imageUpload).toHaveBeenCalled();
      expect(updateFile).not.toHaveBeenCalled();
    });

    test('preserves vision attachment when OCR extraction fails for an image', async () => {
      const { createFile, updateFile } = require('~/models');
      createFile.mockResolvedValue({
        file_id: 'created-file-id',
        filepath: '/images/photo.jpg',
        type: 'image/jpeg',
      });
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: ['image/jpeg'] }));

      const ocrUpload = jest.fn().mockRejectedValue(new Error('OCR service unavailable'));
      const documentParserUpload = jest.fn().mockRejectedValue(new Error('Unsupported image'));
      const imageUpload = jest.fn().mockResolvedValue({
        filepath: '/images/photo.jpg',
        bytes: 1000,
        width: 1920,
        height: 1080,
      });

      getStrategyFunctions
        .mockReturnValueOnce({ handleFileUpload: ocrUpload })
        .mockReturnValueOnce({ handleFileUpload: documentParserUpload })
        .mockReturnValueOnce({ handleImageUpload: imageUpload });

      const req = makeReq({
        mimetype: 'image/jpeg',
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });
      req.file.originalname = 'photo.jpg';
      req.config.imageOutputType = 'jpeg';

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      // When both OCR and document parser fail for images, the image should
      // still be preserved as a vision attachment via createImageContextFile
      // rather than throwing an error (VAL-FILES-002).
      await expect(processAgentFileUpload({ req, res: mockRes, metadata })).resolves.not.toThrow();

      // Image upload handler should still be called for the vision attachment
      expect(imageUpload).toHaveBeenCalled();
      expect(createFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file_id: 'file-uuid-123',
          filepath: '/images/photo.jpg',
          type: 'image/jpeg',
        }),
        true,
      );
      // updateFile should not have been called since OCR failed
      expect(updateFile).not.toHaveBeenCalled();
    });

    test('still throws for non-image documents when OCR extraction fails', async () => {
      mergeFileConfig.mockReturnValue(makeFileConfig({ ocrSupportedMimeTypes: [PDF_MIME] }));

      getStrategyFunctions.mockReturnValue({
        handleFileUpload: jest.fn().mockRejectedValue(new Error('failure')),
      });

      const req = makeReq({
        mimetype: PDF_MIME,
        ocrConfig: { strategy: FileSources.mistral_ocr },
      });

      const metadata = {
        ...makeMetadata(),
        message_file: true,
      };

      await expect(processAgentFileUpload({ req, res: mockRes, metadata })).rejects.toThrow(
        /image-based and requires an OCR service/,
      );
    });
  });
});
