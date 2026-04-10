import { FileSources } from 'librechat-data-provider';
import { extractFileContext } from './context';

describe('extractFileContext', () => {
  it('includes OCR text stored on image attachments', async () => {
    const result = await extractFileContext({
      attachments: [
        {
          file_id: 'file-1',
          filename: 'screenshot.png',
          filepath: '/images/screenshot.png',
          bytes: 123,
          object: 'file',
          type: 'image/png',
          usage: 0,
          source: FileSources.local,
          user: '507f1f77bcf86cd799439011' as never,
          text: 'Detected OCR text',
        },
      ],
      req: {
        body: { fileTokenLimit: 1000 },
        config: { fileConfig: { fileTokenLimit: 1000 } },
      } as never,
      tokenCountFn: (text) => text.length,
    });

    expect(result).toContain('# "screenshot.png" (OCR text extracted from image)');
    expect(result).toContain('Detected OCR text');
  });
});
