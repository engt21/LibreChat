import { EToolResources, FileSources } from 'librechat-data-provider';
import { getAudioTranscriptionFiles } from '../AudioTranscriptionBar';
import type { ExtendedFile } from '~/common';

const audioFile = (overrides: Partial<ExtendedFile> = {}): ExtendedFile => ({
  file_id: 'file-1',
  filename: 'meeting.wav',
  type: 'audio/wav',
  size: 10,
  progress: 1,
  ...overrides,
});

describe('getAudioTranscriptionFiles', () => {
  it('includes normal audio attachments for explicit transcription', () => {
    const files = new Map<string, ExtendedFile>([['file-1', audioFile()]]);

    expect(getAudioTranscriptionFiles(files)).toEqual([
      { fileId: 'file-1', filename: 'meeting.wav' },
    ]);
  });

  it('excludes audio routed to Code Interpreter by tool_resource', () => {
    const files = new Map<string, ExtendedFile>([
      ['file-1', audioFile({ tool_resource: EToolResources.execute_code })],
    ]);

    expect(getAudioTranscriptionFiles(files)).toEqual([]);
  });

  it('excludes audio routed to native Code Interpreter metadata', () => {
    const files = new Map<string, ExtendedFile>([
      ['file-1', audioFile({ metadata: { nativeTool: EToolResources.execute_code } })],
    ]);

    expect(getAudioTranscriptionFiles(files)).toEqual([]);
  });

  it('excludes local Code Interpreter audio uploads by source', () => {
    const files = new Map<string, ExtendedFile>([
      ['file-1', audioFile({ source: FileSources.execute_code })],
    ]);

    expect(getAudioTranscriptionFiles(files)).toEqual([]);
  });

  it('only transcribes regular audio when mixed with Code Interpreter audio', () => {
    const files = new Map<string, ExtendedFile>([
      ['ci-file', audioFile({ file_id: 'ci-file', tool_resource: EToolResources.execute_code })],
      ['audio-file', audioFile({ file_id: 'audio-file', filename: 'note.m4a', type: 'audio/mp4' })],
    ]);

    expect(getAudioTranscriptionFiles(files)).toEqual([
      { fileId: 'audio-file', filename: 'note.m4a' },
    ]);
  });
});
