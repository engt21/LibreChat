import { FileSources } from 'librechat-data-provider';
import { extractFileContext } from './context';

const makeReq = (tokenLimit = 1000) =>
  ({
    body: { fileTokenLimit: tokenLimit },
    config: { fileConfig: { fileTokenLimit: tokenLimit } },
  }) as never;

const makeImageAttachment = (overrides: Record<string, unknown> = {}) => ({
  file_id: 'file-1',
  filename: 'screenshot.png',
  filepath: '/images/screenshot.png',
  bytes: 123,
  object: 'file' as const,
  type: 'image/png',
  usage: 0,
  source: FileSources.local,
  user: '507f1f77bcf86cd799439011' as never,
  ...overrides,
});

const tokenCountFn = (text: string) => text.length;

describe('extractFileContext', () => {
  it('includes OCR text stored on image attachments', async () => {
    const result = await extractFileContext({
      attachments: [makeImageAttachment({ text: 'Detected OCR text' })],
      req: makeReq(),
      tokenCountFn,
    });

    expect(result).toContain('# "screenshot.png" (OCR text extracted from image)');
    expect(result).toContain('Detected OCR text');
  });

  it('skips image attachments that have no text field', async () => {
    const result = await extractFileContext({
      attachments: [makeImageAttachment({ text: undefined })],
      req: makeReq(),
      tokenCountFn,
    });

    expect(result).toBeUndefined();
  });

  it('skips image attachments with empty-string text', async () => {
    const result = await extractFileContext({
      attachments: [makeImageAttachment({ text: '' })],
      req: makeReq(),
      tokenCountFn,
    });

    expect(result).toBeUndefined();
  });

  it('includes text from non-image file sources without the OCR annotation', async () => {
    const result = await extractFileContext({
      attachments: [
        makeImageAttachment({
          filename: 'report.pdf',
          type: 'application/pdf',
          source: FileSources.text,
          text: 'Report contents here',
        }),
      ],
      req: makeReq(),
      tokenCountFn,
    });

    expect(result).toContain('# "report.pdf"');
    expect(result).not.toContain('OCR text extracted from image');
    expect(result).toContain('Report contents here');
  });

  it('combines OCR image text and regular document text in a single context block', async () => {
    const result = await extractFileContext({
      attachments: [
        makeImageAttachment({ text: 'Screenshot OCR output' }),
        makeImageAttachment({
          file_id: 'file-2',
          filename: 'notes.txt',
          type: 'text/plain',
          source: FileSources.text,
          text: 'Plain text notes',
        }),
      ],
      req: makeReq(),
      tokenCountFn,
    });

    expect(result).toContain('# "screenshot.png" (OCR text extracted from image)');
    expect(result).toContain('Screenshot OCR output');
    expect(result).toContain('# "notes.txt"');
    expect(result).not.toContain('"notes.txt" (OCR text extracted from image)');
    expect(result).toContain('Plain text notes');
  });

  it('annotates JPEG images with OCR text correctly', async () => {
    const result = await extractFileContext({
      attachments: [
        makeImageAttachment({
          filename: 'photo.jpg',
          type: 'image/jpeg',
          text: 'Text from photo',
        }),
      ],
      req: makeReq(),
      tokenCountFn,
    });

    expect(result).toContain('# "photo.jpg" (OCR text extracted from image)');
    expect(result).toContain('Text from photo');
  });

  it('returns undefined for empty attachments array', async () => {
    const result = await extractFileContext({
      attachments: [],
      req: makeReq(),
      tokenCountFn,
    });

    expect(result).toBeUndefined();
  });
});
