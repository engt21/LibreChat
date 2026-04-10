import { primeResources } from './resources';
import { logger } from '@librechat/data-schemas';
import { EModelEndpoint, EToolResources, AgentCapabilities } from 'librechat-data-provider';
import type { TAgentsEndpoint, TFile } from 'librechat-data-provider';
import type { IUser, AppConfig } from '@librechat/data-schemas';
import type { Request as ServerRequest } from 'express';
import type { TGetFiles } from './resources';

// Mock logger
jest.mock('@librechat/data-schemas', () => ({
  logger: {
    error: jest.fn(),
  },
}));

describe('primeResources', () => {
  let mockReq: ServerRequest & { user?: IUser };
  let mockAppConfig: AppConfig;
  let mockGetFiles: jest.MockedFunction<TGetFiles>;
  let requestFileSet: Set<string>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Setup mock request
    mockReq = {} as unknown as ServerRequest & { user?: IUser };

    // Setup mock appConfig
    mockAppConfig = {
      endpoints: {
        [EModelEndpoint.agents]: {
          capabilities: [AgentCapabilities.context],
        } as TAgentsEndpoint,
      },
    } as AppConfig;

    // Setup mock getFiles function
    mockGetFiles = jest.fn();

    // Setup request file set
    requestFileSet = new Set(['file1', 'file2', 'file3']);
  });

  describe('when `context` capability is enabled and tool_resources has "context" file_ids', () => {
    it('should fetch context files and include them in attachments', async () => {
      const mockOcrFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'ocr-file-1',
          filename: 'document.pdf',
          filepath: '/uploads/document.pdf',
          object: 'file',
          type: 'application/pdf',
          bytes: 1024,
          embedded: false,
          usage: 0,
        },
      ];

      mockGetFiles.mockResolvedValue(mockOcrFiles);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['ocr-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources,
      });

      expect(mockGetFiles).toHaveBeenCalledWith(
        { file_id: { $in: ['ocr-file-1'] } },
        {},
        {},
        { userId: undefined, agentId: undefined },
      );
      expect(result.attachments).toEqual(mockOcrFiles);
      // Context field is deleted after files are fetched and re-categorized
      // Since the file is not embedded and has no special properties, it won't be categorized
      expect(result.tool_resources).toEqual({});
    });
  });

  describe('when `context` capability is disabled', () => {
    it('should not fetch context files even if tool_resources has context file_ids', async () => {
      (mockAppConfig.endpoints![EModelEndpoint.agents] as TAgentsEndpoint).capabilities = [];

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['ocr-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources,
      });

      expect(mockGetFiles).not.toHaveBeenCalled();
      expect(result.attachments).toBeUndefined();
      expect(result.tool_resources).toEqual(tool_resources);
    });
  });

  describe('when attachments are provided', () => {
    it('should process files with fileIdentifier as execute_code resources', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'script.py',
          filepath: '/uploads/script.py',
          object: 'file',
          type: 'text/x-python',
          bytes: 512,
          embedded: false,
          usage: 0,
          metadata: {
            fileIdentifier: 'python-script',
          },
        },
      ];

      const attachments = Promise.resolve(mockFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toEqual(mockFiles);
      expect(result.tool_resources?.[EToolResources.execute_code]?.files).toEqual(mockFiles);
    });

    it('should process embedded files as file_search resources', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file2',
          filename: 'document.txt',
          filepath: '/uploads/document.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 256,
          embedded: true,
          usage: 0,
        },
      ];

      const attachments = Promise.resolve(mockFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toEqual(mockFiles);
      expect(result.tool_resources?.[EToolResources.file_search]?.files).toEqual(mockFiles);
    });

    it('should process image files in requestFileSet as image_edit resources', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'image.png',
          filepath: '/uploads/image.png',
          object: 'file',
          type: 'image/png',
          bytes: 2048,
          embedded: false,
          usage: 0,
          height: 800,
          width: 600,
        },
      ];

      const attachments = Promise.resolve(mockFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toEqual(mockFiles);
      expect(result.tool_resources?.[EToolResources.image_edit]?.files).toEqual(mockFiles);
    });

    it('should not process image files not in requestFileSet', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file-not-in-set',
          filename: 'image.png',
          filepath: '/uploads/image.png',
          object: 'file',
          type: 'image/png',
          bytes: 2048,
          embedded: false,
          usage: 0,
          height: 800,
          width: 600,
        },
      ];

      const attachments = Promise.resolve(mockFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toEqual(mockFiles);
      expect(result.tool_resources?.[EToolResources.image_edit]).toBeUndefined();
    });

    it('should not process image files without height and width', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'image.png',
          filepath: '/uploads/image.png',
          object: 'file',
          type: 'image/png',
          bytes: 2048,
          embedded: false,
          usage: 0,
          // Missing height and width
        },
      ];

      const attachments = Promise.resolve(mockFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toEqual(mockFiles);
      expect(result.tool_resources?.[EToolResources.image_edit]).toBeUndefined();
    });

    it('should filter out null files from attachments', async () => {
      const mockFiles: Array<TFile | null> = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'valid.txt',
          filepath: '/uploads/valid.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 256,
          embedded: false,
          usage: 0,
        },
        null,
        {
          user: 'user1',
          file_id: 'file2',
          filename: 'valid2.txt',
          filepath: '/uploads/valid2.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 128,
          embedded: false,
          usage: 0,
        },
      ];

      const attachments = Promise.resolve(mockFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.[0]?.file_id).toBe('file1');
      expect(result.attachments?.[1]?.file_id).toBe('file2');
    });

    it('should merge existing tool_resources with new files', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'script.py',
          filepath: '/uploads/script.py',
          object: 'file',
          type: 'text/x-python',
          bytes: 512,
          embedded: false,
          usage: 0,
          metadata: {
            fileIdentifier: 'python-script',
          },
        },
      ];

      const existingToolResources = {
        [EToolResources.execute_code]: {
          files: [
            {
              user: 'user1',
              file_id: 'existing-file',
              filename: 'existing.py',
              filepath: '/uploads/existing.py',
              object: 'file' as const,
              type: 'text/x-python',
              bytes: 256,
              embedded: false,
              usage: 0,
            },
          ],
        },
      };

      const attachments = Promise.resolve(mockFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: existingToolResources,
      });

      expect(result.tool_resources?.[EToolResources.execute_code]?.files).toHaveLength(2);
      expect(result.tool_resources?.[EToolResources.execute_code]?.files?.[0]?.file_id).toBe(
        'existing-file',
      );
      expect(result.tool_resources?.[EToolResources.execute_code]?.files?.[1]?.file_id).toBe(
        'file1',
      );
    });
  });

  describe('when both "context" files and "attachments" are provided', () => {
    it('should include both context files and attachment files', async () => {
      const mockOcrFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'ocr-file-1',
          filename: 'document.pdf',
          filepath: '/uploads/document.pdf',
          object: 'file',
          type: 'application/pdf',
          bytes: 1024,
          embedded: false,
          usage: 0,
        },
      ];

      const mockAttachmentFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'attachment.txt',
          filepath: '/uploads/attachment.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 256,
          embedded: false,
          usage: 0,
        },
      ];

      mockGetFiles.mockResolvedValue(mockOcrFiles);
      const attachments = Promise.resolve(mockAttachmentFiles);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['ocr-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources,
      });

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.[0]?.file_id).toBe('ocr-file-1');
      expect(result.attachments?.[1]?.file_id).toBe('file1');
    });

    it('should include both context (as `ocr` resource) files and attachment files', async () => {
      const mockOcrFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'ocr-file-1',
          filename: 'document.pdf',
          filepath: '/uploads/document.pdf',
          object: 'file',
          type: 'application/pdf',
          bytes: 1024,
          embedded: false,
          usage: 0,
        },
      ];

      const mockAttachmentFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'attachment.txt',
          filepath: '/uploads/attachment.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 256,
          embedded: false,
          usage: 0,
        },
      ];

      mockGetFiles.mockResolvedValue(mockOcrFiles);
      const attachments = Promise.resolve(mockAttachmentFiles);

      const tool_resources = {
        [EToolResources.ocr]: {
          file_ids: ['ocr-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources,
      });

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.[0]?.file_id).toBe('ocr-file-1');
      expect(result.attachments?.[1]?.file_id).toBe('file1');
    });

    it('should prevent duplicate files when same file exists in context tool_resource and attachments', async () => {
      const sharedFile: TFile = {
        user: 'user1',
        file_id: 'shared-file-id',
        filename: 'document.pdf',
        filepath: '/uploads/document.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 1024,
        embedded: false,
        usage: 0,
      };

      const mockOcrFiles: TFile[] = [sharedFile];
      const mockAttachmentFiles: TFile[] = [
        sharedFile,
        {
          user: 'user1',
          file_id: 'unique-file',
          filename: 'other.txt',
          filepath: '/uploads/other.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 256,
          embedded: false,
          usage: 0,
        },
      ];

      mockGetFiles.mockResolvedValue(mockOcrFiles);
      const attachments = Promise.resolve(mockAttachmentFiles);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['shared-file-id'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources,
      });

      // Should only have 2 files, not 3 (no duplicate)
      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.filter((f) => f?.file_id === 'shared-file-id')).toHaveLength(1);
      expect(result.attachments?.find((f) => f?.file_id === 'unique-file')).toBeDefined();
    });

    it('should still categorize duplicate files for tool_resources', async () => {
      const sharedFile: TFile = {
        user: 'user1',
        file_id: 'shared-file-id',
        filename: 'script.py',
        filepath: '/uploads/script.py',
        object: 'file',
        type: 'text/x-python',
        bytes: 512,
        embedded: false,
        usage: 0,
        metadata: {
          fileIdentifier: 'python-script',
        },
      };

      const mockOcrFiles: TFile[] = [sharedFile];
      const mockAttachmentFiles: TFile[] = [sharedFile];

      mockGetFiles.mockResolvedValue(mockOcrFiles);
      const attachments = Promise.resolve(mockAttachmentFiles);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['shared-file-id'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources,
      });

      // File should appear only once in attachments
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0]?.file_id).toBe('shared-file-id');

      // But should still be categorized in tool_resources
      expect(result.tool_resources?.[EToolResources.execute_code]?.files).toHaveLength(1);
      expect(result.tool_resources?.[EToolResources.execute_code]?.files?.[0]?.file_id).toBe(
        'shared-file-id',
      );
    });

    it('should handle multiple duplicate files', async () => {
      const file1: TFile = {
        user: 'user1',
        file_id: 'file-1',
        filename: 'doc1.pdf',
        filepath: '/uploads/doc1.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 1024,
        embedded: false,
        usage: 0,
      };

      const file2: TFile = {
        user: 'user1',
        file_id: 'file-2',
        filename: 'doc2.pdf',
        filepath: '/uploads/doc2.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 2048,
        embedded: false,
        usage: 0,
      };

      const uniqueFile: TFile = {
        user: 'user1',
        file_id: 'unique-file',
        filename: 'unique.txt',
        filepath: '/uploads/unique.txt',
        object: 'file',
        type: 'text/plain',
        bytes: 256,
        embedded: false,
        usage: 0,
      };

      const mockOcrFiles: TFile[] = [file1, file2];
      const mockAttachmentFiles: TFile[] = [file1, file2, uniqueFile];

      mockGetFiles.mockResolvedValue(mockOcrFiles);
      const attachments = Promise.resolve(mockAttachmentFiles);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['file-1', 'file-2'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources,
      });

      // Should have 3 files total (2 from context files + 1 unique from attachments)
      expect(result.attachments).toHaveLength(3);

      // Each file should appear only once
      const fileIds = result.attachments?.map((f) => f?.file_id);
      expect(fileIds).toContain('file-1');
      expect(fileIds).toContain('file-2');
      expect(fileIds).toContain('unique-file');

      // Check no duplicates
      const uniqueFileIds = new Set(fileIds);
      expect(uniqueFileIds.size).toBe(fileIds?.length);
    });

    it('should handle files without file_id gracefully', async () => {
      const fileWithoutId: Partial<TFile> = {
        user: 'user1',
        filename: 'no-id.txt',
        filepath: '/uploads/no-id.txt',
        object: 'file',
        type: 'text/plain',
        bytes: 256,
        embedded: false,
        usage: 0,
      };

      const normalFile: TFile = {
        user: 'user1',
        file_id: 'normal-file',
        filename: 'normal.txt',
        filepath: '/uploads/normal.txt',
        object: 'file',
        type: 'text/plain',
        bytes: 512,
        embedded: false,
        usage: 0,
      };

      const mockOcrFiles: TFile[] = [normalFile];
      const mockAttachmentFiles = [fileWithoutId as TFile, normalFile];

      mockGetFiles.mockResolvedValue(mockOcrFiles);
      const attachments = Promise.resolve(mockAttachmentFiles);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['normal-file'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources,
      });

      // Should include file without ID and one instance of normal file
      expect(result.attachments).toHaveLength(2);
      expect(result.attachments?.filter((f) => f?.file_id === 'normal-file')).toHaveLength(1);
      expect(result.attachments?.some((f) => !f?.file_id)).toBe(true);
    });

    it('should prevent duplicates from existing tool_resources', async () => {
      const existingFile: TFile = {
        user: 'user1',
        file_id: 'existing-file',
        filename: 'existing.py',
        filepath: '/uploads/existing.py',
        object: 'file',
        type: 'text/x-python',
        bytes: 512,
        embedded: false,
        usage: 0,
        metadata: {
          fileIdentifier: 'python-script',
        },
      };

      const newFile: TFile = {
        user: 'user1',
        file_id: 'new-file',
        filename: 'new.py',
        filepath: '/uploads/new.py',
        object: 'file',
        type: 'text/x-python',
        bytes: 256,
        embedded: false,
        usage: 0,
        metadata: {
          fileIdentifier: 'python-script',
        },
      };

      const existingToolResources = {
        [EToolResources.execute_code]: {
          files: [existingFile],
        },
      };

      const attachments = Promise.resolve([existingFile, newFile]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: existingToolResources,
      });

      // Should only add the new file to attachments
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments?.[0]?.file_id).toBe('new-file');

      // Should not duplicate the existing file in tool_resources
      expect(result.tool_resources?.[EToolResources.execute_code]?.files).toHaveLength(2);
      const fileIds = result.tool_resources?.[EToolResources.execute_code]?.files?.map(
        (f) => f.file_id,
      );
      expect(fileIds).toEqual(['existing-file', 'new-file']);
    });

    it('should handle duplicates within attachments array', async () => {
      const duplicatedFile: TFile = {
        user: 'user1',
        file_id: 'dup-file',
        filename: 'duplicate.txt',
        filepath: '/uploads/duplicate.txt',
        object: 'file',
        type: 'text/plain',
        bytes: 256,
        embedded: false,
        usage: 0,
      };

      const uniqueFile: TFile = {
        user: 'user1',
        file_id: 'unique-file',
        filename: 'unique.txt',
        filepath: '/uploads/unique.txt',
        object: 'file',
        type: 'text/plain',
        bytes: 128,
        embedded: false,
        usage: 0,
      };

      // Same file appears multiple times in attachments
      const attachments = Promise.resolve([
        duplicatedFile,
        duplicatedFile,
        uniqueFile,
        duplicatedFile,
      ]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      // Should only have 2 unique files
      expect(result.attachments).toHaveLength(2);
      const fileIds = result.attachments?.map((f) => f?.file_id);
      expect(fileIds).toContain('dup-file');
      expect(fileIds).toContain('unique-file');

      // Verify no duplicates
      expect(fileIds?.filter((id) => id === 'dup-file')).toHaveLength(1);
    });

    it('should prevent duplicates across different tool_resource categories', async () => {
      const multiPurposeFile: TFile = {
        user: 'user1',
        file_id: 'multi-file',
        filename: 'data.txt',
        filepath: '/uploads/data.txt',
        object: 'file',
        type: 'text/plain',
        bytes: 512,
        embedded: true, // Will be categorized as file_search
        usage: 0,
      };

      const existingToolResources = {
        [EToolResources.file_search]: {
          files: [multiPurposeFile],
        },
      };

      // Try to add the same file again
      const attachments = Promise.resolve([multiPurposeFile]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: existingToolResources,
      });

      // Should not add to attachments (already exists)
      expect(result.attachments).toHaveLength(0);

      // Should not duplicate in file_search
      expect(result.tool_resources?.[EToolResources.file_search]?.files).toHaveLength(1);
      expect(result.tool_resources?.[EToolResources.file_search]?.files?.[0]?.file_id).toBe(
        'multi-file',
      );
    });

    it('should handle complex scenario with context files, existing tool_resources, and attachments', async () => {
      const ocrFile: TFile = {
        user: 'user1',
        file_id: 'ocr-file',
        filename: 'scan.pdf',
        filepath: '/uploads/scan.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 2048,
        embedded: false,
        usage: 0,
      };

      const existingFile: TFile = {
        user: 'user1',
        file_id: 'existing-file',
        filename: 'code.py',
        filepath: '/uploads/code.py',
        object: 'file',
        type: 'text/x-python',
        bytes: 512,
        embedded: false,
        usage: 0,
        metadata: {
          fileIdentifier: 'python-script',
        },
      };

      const newFile: TFile = {
        user: 'user1',
        file_id: 'new-file',
        filename: 'image.png',
        filepath: '/uploads/image.png',
        object: 'file',
        type: 'image/png',
        bytes: 4096,
        embedded: false,
        usage: 0,
        height: 800,
        width: 600,
      };

      mockGetFiles.mockResolvedValue([ocrFile, existingFile]); // context returns both files
      const attachments = Promise.resolve([existingFile, ocrFile, newFile]); // Attachments has duplicates

      const existingToolResources = {
        [EToolResources.context]: {
          file_ids: ['ocr-file', 'existing-file'],
        },
        [EToolResources.execute_code]: {
          files: [existingFile],
        },
      };

      requestFileSet.add('new-file'); // Only new-file is in request set

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: existingToolResources,
      });

      // Should have 3 unique files total
      expect(result.attachments).toHaveLength(3);
      const attachmentIds = result.attachments?.map((f) => f?.file_id).sort();
      expect(attachmentIds).toEqual(['existing-file', 'new-file', 'ocr-file']);

      // Check tool_resources
      expect(result.tool_resources?.[EToolResources.execute_code]?.files).toHaveLength(1);
      expect(result.tool_resources?.[EToolResources.image_edit]?.files).toHaveLength(1);
      expect(result.tool_resources?.[EToolResources.image_edit]?.files?.[0]?.file_id).toBe(
        'new-file',
      );
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully and log them', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'test.txt',
          filepath: '/uploads/test.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 256,
          embedded: false,
          usage: 0,
        },
      ];

      const attachments = Promise.resolve(mockFiles);
      const error = new Error('Test error');

      // Mock getFiles to throw an error when called for context
      mockGetFiles.mockRejectedValue(error);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['ocr-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources,
      });

      expect(logger.error).toHaveBeenCalledWith('Error priming resources', error);
      expect(result.attachments).toEqual(mockFiles);
      expect(result.tool_resources).toEqual(tool_resources);
    });

    it('should handle promise rejection in attachments', async () => {
      const error = new Error('Attachment error');
      const attachments = Promise.reject(error);

      // The function should now handle rejected attachment promises gracefully
      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments,
        tool_resources: {},
      });

      // Should log both the main error and the attachment error
      expect(logger.error).toHaveBeenCalledWith('Error priming resources', error);
      expect(logger.error).toHaveBeenCalledWith(
        'Error resolving attachments in catch block',
        error,
      );

      // Should return empty array when attachments promise is rejected
      expect(result.attachments).toEqual([]);
      expect(result.tool_resources).toEqual({});
    });
  });

  describe('tool_resources field deletion behavior', () => {
    it('should not mutate the original tool_resources object', async () => {
      const originalToolResources = {
        [EToolResources.context]: {
          file_ids: ['context-file-1'],
          files: [
            {
              user: 'user1',
              file_id: 'context-file-1',
              filename: 'original.txt',
              filepath: '/uploads/original.txt',
              object: 'file' as const,
              type: 'text/plain',
              bytes: 256,
              embedded: false,
              usage: 0,
            },
          ],
        },
        [EToolResources.ocr]: {
          file_ids: ['ocr-file-1'],
        },
      };

      // Create a deep copy to compare later
      const originalCopy = JSON.parse(JSON.stringify(originalToolResources));

      const mockOcrFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'ocr-file-1',
          filename: 'document.pdf',
          filepath: '/uploads/document.pdf',
          object: 'file',
          type: 'application/pdf',
          bytes: 1024,
          embedded: true,
          usage: 0,
        },
      ];

      mockGetFiles.mockResolvedValue(mockOcrFiles);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources: originalToolResources,
      });

      // Original object should remain unchanged
      expect(originalToolResources).toEqual(originalCopy);

      // Result should have modifications
      expect(result.tool_resources?.[EToolResources.ocr]).toBeUndefined();
      expect(result.tool_resources?.[EToolResources.context]).toBeUndefined();
      expect(result.tool_resources?.[EToolResources.file_search]).toBeDefined();
    });

    it('should delete ocr field after merging file_ids with context', async () => {
      const mockOcrFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'ocr-file-1',
          filename: 'document.pdf',
          filepath: '/uploads/document.pdf',
          object: 'file',
          type: 'application/pdf',
          bytes: 1024,
          embedded: true, // Will be categorized as file_search
          usage: 0,
        },
      ];

      mockGetFiles.mockResolvedValue(mockOcrFiles);

      const tool_resources = {
        [EToolResources.ocr]: {
          file_ids: ['ocr-file-1'],
        },
        [EToolResources.context]: {
          file_ids: ['context-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources,
      });

      // OCR field should be deleted after merging
      expect(result.tool_resources?.[EToolResources.ocr]).toBeUndefined();
      // Context field should also be deleted since files were fetched and re-categorized
      expect(result.tool_resources?.[EToolResources.context]).toBeUndefined();
      // File should be categorized as file_search based on embedded=true
      expect(result.tool_resources?.[EToolResources.file_search]?.files).toHaveLength(1);
      expect(result.tool_resources?.[EToolResources.file_search]?.files?.[0]?.file_id).toBe(
        'ocr-file-1',
      );

      // Verify getFiles was called with merged file_ids
      expect(mockGetFiles).toHaveBeenCalledWith(
        { file_id: { $in: ['context-file-1', 'ocr-file-1'] } },
        {},
        {},
        { userId: undefined, agentId: undefined },
      );
    });

    it('should delete context field when fetching and re-categorizing files', async () => {
      const mockContextFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'context-file-1',
          filename: 'script.py',
          filepath: '/uploads/script.py',
          object: 'file',
          type: 'text/x-python',
          bytes: 512,
          embedded: false,
          usage: 0,
          metadata: {
            fileIdentifier: 'python-script',
          },
        },
        {
          user: 'user1',
          file_id: 'context-file-2',
          filename: 'data.txt',
          filepath: '/uploads/data.txt',
          object: 'file',
          type: 'text/plain',
          bytes: 256,
          embedded: true,
          usage: 0,
        },
      ];

      mockGetFiles.mockResolvedValue(mockContextFiles);

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['context-file-1', 'context-file-2'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources,
      });

      // Context field should be deleted after fetching files
      expect(result.tool_resources?.[EToolResources.context]).toBeUndefined();

      // Files should be re-categorized based on their properties
      expect(result.tool_resources?.[EToolResources.execute_code]?.files).toHaveLength(1);
      expect(result.tool_resources?.[EToolResources.execute_code]?.files?.[0]?.file_id).toBe(
        'context-file-1',
      );

      expect(result.tool_resources?.[EToolResources.file_search]?.files).toHaveLength(1);
      expect(result.tool_resources?.[EToolResources.file_search]?.files?.[0]?.file_id).toBe(
        'context-file-2',
      );
    });

    it('should preserve context field when context capability is disabled', async () => {
      // Disable context capability
      (mockAppConfig.endpoints![EModelEndpoint.agents] as TAgentsEndpoint).capabilities = [];

      const tool_resources = {
        [EToolResources.context]: {
          file_ids: ['context-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources,
      });

      // Context field should be preserved when capability is disabled
      expect(result.tool_resources?.[EToolResources.context]).toEqual({
        file_ids: ['context-file-1'],
      });

      // getFiles should not have been called
      expect(mockGetFiles).not.toHaveBeenCalled();
    });

    it('should still delete ocr field even when context capability is disabled', async () => {
      // Disable context capability
      (mockAppConfig.endpoints![EModelEndpoint.agents] as TAgentsEndpoint).capabilities = [];

      const tool_resources = {
        [EToolResources.ocr]: {
          file_ids: ['ocr-file-1'],
        },
        [EToolResources.context]: {
          file_ids: ['context-file-1'],
        },
      };

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources,
      });

      // OCR field should still be deleted (merged into context)
      expect(result.tool_resources?.[EToolResources.ocr]).toBeUndefined();

      // Context field should contain merged file_ids but not be processed
      expect(result.tool_resources?.[EToolResources.context]).toEqual({
        file_ids: ['context-file-1', 'ocr-file-1'],
      });

      // getFiles should not have been called since context is disabled
      expect(mockGetFiles).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle missing appConfig agents endpoint gracefully', async () => {
      const reqWithoutLocals = {} as ServerRequest & { user?: IUser };
      const emptyAppConfig = {} as AppConfig;

      const result = await primeResources({
        req: reqWithoutLocals,
        appConfig: emptyAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources: {
          [EToolResources.context]: {
            file_ids: ['ocr-file-1'],
          },
        },
      });

      expect(mockGetFiles).not.toHaveBeenCalled();
      // When appConfig agents endpoint is missing, context is disabled
      // and no attachments are provided, the function returns undefined
      expect(result.attachments).toBeUndefined();
    });

    it('should handle undefined tool_resources', async () => {
      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet,
        attachments: undefined,
        tool_resources: undefined,
      });

      expect(result.tool_resources).toEqual({});
      expect(result.attachments).toBeUndefined();
    });

    it('should handle empty requestFileSet', async () => {
      const mockFiles: TFile[] = [
        {
          user: 'user1',
          file_id: 'file1',
          filename: 'image.png',
          filepath: '/uploads/image.png',
          object: 'file',
          type: 'image/png',
          bytes: 2048,
          embedded: false,
          usage: 0,
          height: 800,
          width: 600,
        },
      ];

      const attachments = Promise.resolve(mockFiles);
      const emptyRequestFileSet = new Set<string>();

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet: emptyRequestFileSet,
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toEqual(mockFiles);
      expect(result.tool_resources?.[EToolResources.image_edit]).toBeUndefined();
    });
  });

  describe('native file_search rehydration (VAL-PROVIDER-002, VAL-FILES-003)', () => {
    it('should categorize native file_search files into tool_resources and attachments', async () => {
      const nativeFileSearchFile: TFile = {
        user: 'user1',
        file_id: 'native-fs-file-1',
        filename: 'report.pdf',
        filepath: '/uploads/report.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 4096,
        embedded: false,
        usage: 1,
        metadata: { nativeTool: EToolResources.file_search },
      };

      const attachments = Promise.resolve([nativeFileSearchFile]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet: new Set(['native-fs-file-1']),
        attachments,
        tool_resources: {},
      });

      // File should appear in attachments for conversation linkage
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments![0]).toEqual(nativeFileSearchFile);

      // File should also be categorized into file_search tool_resources
      const fsResource = result.tool_resources?.[EToolResources.file_search];
      expect(fsResource).toBeDefined();
      expect(fsResource?.files).toHaveLength(1);
      expect(fsResource?.files?.[0].file_id).toBe('native-fs-file-1');
    });

    it('should categorize embedded files into file_search tool_resources', async () => {
      const embeddedFile: TFile = {
        user: 'user1',
        file_id: 'embedded-file-1',
        filename: 'data.txt',
        filepath: '/uploads/data.txt',
        object: 'file',
        type: 'text/plain',
        bytes: 1024,
        embedded: true,
        usage: 1,
      };

      const attachments = Promise.resolve([embeddedFile]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet: new Set(['embedded-file-1']),
        attachments,
        tool_resources: {},
      });

      expect(result.attachments).toHaveLength(1);
      const fsResource = result.tool_resources?.[EToolResources.file_search];
      expect(fsResource).toBeDefined();
      expect(fsResource?.files).toHaveLength(1);
      expect(fsResource?.files?.[0].file_id).toBe('embedded-file-1');
    });

    it('should not duplicate files already present in tool_resources.file_search', async () => {
      const existingFile: TFile = {
        user: 'user1',
        file_id: 'existing-fs-file',
        filename: 'old-report.pdf',
        filepath: '/uploads/old-report.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 2048,
        embedded: false,
        usage: 1,
        metadata: { nativeTool: EToolResources.file_search },
      };

      const attachments = Promise.resolve([existingFile]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet: new Set(['existing-fs-file']),
        attachments,
        tool_resources: {
          [EToolResources.file_search]: {
            files: [existingFile],
          },
        },
      });

      // Should not have duplicate in file_search
      const fsResource = result.tool_resources?.[EToolResources.file_search];
      expect(fsResource?.files).toHaveLength(1);
      expect(fsResource?.files?.[0].file_id).toBe('existing-fs-file');
    });

    it('should preserve OpenAI metadata on rehydrated native file_search files', async () => {
      const fileWithOpenAIMeta: TFile = {
        user: 'user1',
        file_id: 'rehydrated-file',
        filename: 'report.pdf',
        filepath: '/uploads/report.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 4096,
        embedded: false,
        usage: 2,
        metadata: {
          nativeTool: EToolResources.file_search,
          openai: {
            endpoint: 'openAI',
            model: 'gpt-4o',
            fileId: 'file-abc123',
            vectorStoreId: 'vs-xyz789',
          },
        },
      };

      const attachments = Promise.resolve([fileWithOpenAIMeta]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet: new Set(['rehydrated-file']),
        attachments,
        tool_resources: {},
      });

      // The file should be in both attachments and file_search resources with metadata intact
      expect(result.attachments).toHaveLength(1);
      expect((result.attachments![0] as TFile).metadata).toEqual(fileWithOpenAIMeta.metadata);

      const fsResource = result.tool_resources?.[EToolResources.file_search];
      expect(fsResource?.files).toHaveLength(1);
      expect((fsResource?.files?.[0] as TFile).metadata).toEqual(fileWithOpenAIMeta.metadata);
    });

    it('should handle mixed native file_search and regular attachment files', async () => {
      const nativeFile: TFile = {
        user: 'user1',
        file_id: 'native-file',
        filename: 'report.pdf',
        filepath: '/uploads/report.pdf',
        object: 'file',
        type: 'application/pdf',
        bytes: 4096,
        embedded: false,
        usage: 1,
        metadata: { nativeTool: EToolResources.file_search },
      };

      const regularFile: TFile = {
        user: 'user1',
        file_id: 'regular-file',
        filename: 'photo.jpg',
        filepath: '/uploads/photo.jpg',
        object: 'file',
        type: 'image/jpeg',
        bytes: 2048,
        embedded: false,
        usage: 1,
        height: 600,
        width: 800,
      };

      const attachments = Promise.resolve([nativeFile, regularFile]);

      const result = await primeResources({
        req: mockReq,
        appConfig: mockAppConfig,
        getFiles: mockGetFiles,
        requestFileSet: new Set(['native-file', 'regular-file']),
        attachments,
        tool_resources: {},
      });

      // Both files should be in attachments
      expect(result.attachments).toHaveLength(2);

      // Only native file should be in file_search
      const fsResource = result.tool_resources?.[EToolResources.file_search];
      expect(fsResource?.files).toHaveLength(1);
      expect(fsResource?.files?.[0].file_id).toBe('native-file');

      // Regular image file should be in image_edit (since it's in requestFileSet and has dimensions)
      const ieResource = result.tool_resources?.[EToolResources.image_edit];
      expect(ieResource?.files).toHaveLength(1);
      expect(ieResource?.files?.[0].file_id).toBe('regular-file');
    });
  });
});
