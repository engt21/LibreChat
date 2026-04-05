jest.mock('node:fs/promises', () => ({
  stat: jest.fn(),
  mkdir: jest.fn(),
  rm: jest.fn(),
  readdir: jest.fn(),
  readFile: jest.fn(),
}));

jest.mock('node:child_process', () => ({
  spawn: jest.fn(),
}));

jest.mock('ffmpeg-static', () => '/tmp/ffmpeg');
jest.mock('ffprobe-static', () => ({ path: '/tmp/ffprobe' }));

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const {
  MAX_STT_UPLOAD_BYTES,
  getExtensionForMimeType,
  transcribeMediaFile,
  buildChunkPrompt,
  buildOverrides,
  buildSpeakerReferenceOverrides,
  formatDiarizedSegments,
} = require('./transcribeMediaFile');

function mockSpawnImplementation() {
  spawn.mockImplementation((binaryPath) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();

    process.nextTick(() => {
      if (binaryPath === '/tmp/ffprobe') {
        child.stdout.emit(
          'data',
          Buffer.from(
            JSON.stringify({
              format: { duration: '7200' },
            }),
          ),
        );
      }

      child.emit('close', 0);
    });

    return child;
  });
}

describe('transcribeMediaFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.stat.mockResolvedValue({ size: 1024 });
    fs.mkdir.mockResolvedValue(undefined);
    fs.rm.mockResolvedValue(undefined);
    fs.readdir.mockResolvedValue([]);
    fs.readFile.mockResolvedValue(Buffer.from('audio-buffer'));
    mockSpawnImplementation();
  });

  it('transcribes a supported audio file with the configured provider', async () => {
    const sttService = {
      getProviderSchema: jest
        .fn()
        .mockResolvedValue(['openAI', { model: 'gpt-4o-mini-transcribe' }]),
      sttRequest: jest.fn().mockResolvedValue('Hello world'),
    };

    const result = await transcribeMediaFile({
      req: { user: { id: 'user-1' } },
      filePath: '/tmp/audio.mp3',
      filename: 'audio.mp3',
      mimetype: 'audio/mpeg',
      sttService,
      language: 'en-US',
    });

    expect(sttService.getProviderSchema).toHaveBeenCalledWith({ user: { id: 'user-1' } });
    expect(sttService.sttRequest).toHaveBeenCalledWith(
      'openAI',
      { model: 'gpt-4o-mini-transcribe' },
      expect.objectContaining({
        language: 'en-US',
        audioBuffer: expect.any(Buffer),
        audioFile: expect.objectContaining({
          originalname: 'audio.mp3',
          mimetype: 'audio/mpeg',
          size: 12,
        }),
      }),
    );
    expect(result).toMatchObject({
      text: 'Hello world',
      provider: 'openAI',
      model: 'gpt-4o-mini-transcribe',
      chunkCount: 1,
      converted: false,
      preparedMimeType: 'audio/mpeg',
    });
  });

  it('passes overrides for gpt-4o-transcribe model with prompt', async () => {
    const sttService = {
      getProviderSchema: jest.fn().mockResolvedValue(['openAI', { model: 'whisper-1' }]),
      sttRequest: jest.fn().mockResolvedValue('Hello with prompt'),
    };

    const result = await transcribeMediaFile({
      req: { user: { id: 'user-1' } },
      filePath: '/tmp/audio.mp3',
      filename: 'audio.mp3',
      mimetype: 'audio/mpeg',
      sttService,
      language: 'en',
      transcriptionModel: 'gpt-4o-transcribe',
      prompt: 'This is a music lecture',
    });

    expect(sttService.sttRequest).toHaveBeenCalledWith(
      'openAI',
      expect.any(Object),
      expect.objectContaining({
        overrides: {
          model: 'gpt-4o-transcribe',
          prompt: 'This is a music lecture',
        },
      }),
    );
    expect(result.model).toBe('gpt-4o-transcribe');
    expect(result.text).toBe('Hello with prompt');
  });

  it('normalizes oversized media, chunks it, and carries transcript context forward', async () => {
    fs.stat.mockImplementation(async (filePath) => {
      const sizes = {
        '/tmp/audio.wav': MAX_STT_UPLOAD_BYTES + 1024,
        '/tmp/prepared/normalized.mp3': MAX_STT_UPLOAD_BYTES + 1024,
        '/tmp/prepared/chunks/chunk-000.mp3': 2048,
        '/tmp/prepared/chunks/chunk-001.mp3': 2048,
      };

      return { size: sizes[filePath] ?? 1024 };
    });
    fs.readdir.mockResolvedValue(['chunk-000.mp3', 'chunk-001.mp3']);
    fs.readFile.mockImplementation(async (filePath) => {
      if (filePath.endsWith('chunk-000.mp3')) {
        return Buffer.from('chunk-one');
      }

      if (filePath.endsWith('chunk-001.mp3')) {
        return Buffer.from('chunk-two');
      }

      return Buffer.from('audio-buffer');
    });

    const sttService = {
      getProviderSchema: jest.fn().mockResolvedValue(['openAI', { model: 'gpt-4o-transcribe' }]),
      sttRequest: jest.fn().mockResolvedValueOnce('First chunk').mockResolvedValueOnce('Second'),
    };

    const result = await transcribeMediaFile({
      req: { user: { id: 'user-1' } },
      filePath: '/tmp/audio.wav',
      filename: 'audio.wav',
      mimetype: 'audio/wav',
      sttService,
      language: 'en',
      prompt: 'Preserve music terms.',
    });

    expect(sttService.sttRequest).toHaveBeenNthCalledWith(
      1,
      'openAI',
      { model: 'gpt-4o-transcribe' },
      expect.objectContaining({
        overrides: {
          prompt: 'Preserve music terms.',
        },
      }),
    );
    expect(sttService.sttRequest).toHaveBeenNthCalledWith(
      2,
      'openAI',
      { model: 'gpt-4o-transcribe' },
      expect.objectContaining({
        overrides: {
          prompt: expect.stringContaining('Previous transcript context:\nFirst chunk'),
        },
      }),
    );
    expect(result).toMatchObject({
      text: 'First chunk\n\nSecond',
      chunkCount: 2,
      converted: true,
      preparedMimeType: 'audio/mpeg',
    });
  });

  it('passes diarize overrides and formats speaker segments', async () => {
    const sttService = {
      getProviderSchema: jest.fn().mockResolvedValue(['openAI', { model: 'whisper-1' }]),
      sttRequest: jest.fn().mockResolvedValue({
        text: 'combined text',
        segments: [
          { speaker: 'speaker_0', text: 'Hello', start: 0, end: 1 },
          { speaker: 'speaker_1', text: 'Hi there', start: 1, end: 2 },
        ],
      }),
    };

    const result = await transcribeMediaFile({
      req: { user: { id: 'user-1' } },
      filePath: '/tmp/audio.mp3',
      filename: 'audio.mp3',
      mimetype: 'audio/mpeg',
      sttService,
      language: 'en',
      transcriptionModel: 'gpt-4o-transcribe-diarize',
    });

    expect(sttService.sttRequest).toHaveBeenCalledWith(
      'openAI',
      expect.any(Object),
      expect.objectContaining({
        overrides: {
          model: 'gpt-4o-transcribe-diarize',
          response_format: 'diarized_json',
          chunking_strategy: 'auto',
        },
      }),
    );
    expect(result.model).toBe('gpt-4o-transcribe-diarize');
    expect(result.isDiarize).toBe(true);
    expect(result.text).toBe('[speaker_0]: Hello\n[speaker_1]: Hi there');
  });

  it('passes known speaker references to diarized transcription requests', async () => {
    spawn.mockImplementation((binaryPath) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();

      process.nextTick(() => {
        if (binaryPath === '/tmp/ffprobe') {
          child.stdout.emit(
            'data',
            Buffer.from(
              JSON.stringify({
                format: { duration: '5' },
              }),
            ),
          );
        }

        child.emit('close', 0);
      });

      return child;
    });

    const sttService = {
      getProviderSchema: jest.fn().mockResolvedValue(['openAI', { model: 'whisper-1' }]),
      sttRequest: jest.fn().mockResolvedValue({
        text: 'combined text',
        segments: [{ speaker: 'Alice', text: 'Hello' }],
      }),
    };

    await transcribeMediaFile({
      req: { user: { id: 'user-1' } },
      filePath: '/tmp/audio.mp3',
      filename: 'audio.mp3',
      mimetype: 'audio/mpeg',
      sttService,
      transcriptionModel: 'gpt-4o-transcribe-diarize',
      speakerReferences: [
        {
          name: 'Alice',
          filePath: '/tmp/alice.wav',
          filename: 'alice.wav',
          mimetype: 'audio/wav',
        },
      ],
    });

    expect(sttService.sttRequest).toHaveBeenCalledWith(
      'openAI',
      expect.any(Object),
      expect.objectContaining({
        overrides: expect.objectContaining({
          known_speaker_names: ['Alice'],
          known_speaker_references: [expect.stringContaining('data:audio/wav;base64,')],
        }),
      }),
    );
  });
});

describe('buildOverrides', () => {
  it('returns undefined for empty model selections', () => {
    expect(buildOverrides({ transcriptionModel: '' })).toBeUndefined();
    expect(buildOverrides({})).toBeUndefined();
  });

  it('returns model+prompt for gpt-4o-transcribe', () => {
    expect(buildOverrides({ transcriptionModel: 'gpt-4o-transcribe', prompt: 'test' })).toEqual({
      model: 'gpt-4o-transcribe',
      prompt: 'test',
    });
  });

  it('returns prompt-only overrides when the configured model supports prompts', () => {
    expect(buildOverrides({ configuredModel: 'whisper-1', prompt: 'test' })).toEqual({
      prompt: 'test',
    });
  });

  it('returns explicit whisper overrides with prompt', () => {
    expect(buildOverrides({ transcriptionModel: 'whisper-1', prompt: 'names matter' })).toEqual({
      model: 'whisper-1',
      prompt: 'names matter',
    });
  });

  it('returns diarized overrides for gpt-4o-transcribe-diarize', () => {
    expect(
      buildOverrides({ transcriptionModel: 'gpt-4o-transcribe-diarize', prompt: 'ignored' }),
    ).toEqual({
      model: 'gpt-4o-transcribe-diarize',
      response_format: 'diarized_json',
      chunking_strategy: 'auto',
    });
  });
});

describe('buildChunkPrompt', () => {
  it('includes the user prompt and trailing transcript context for follow-up chunks', () => {
    expect(
      buildChunkPrompt({
        prompt: 'Use orchestra names.',
        transcriptParts: ['Opening remarks', 'Cello section enters'],
        model: 'gpt-4o-transcribe',
      }),
    ).toContain('Previous transcript context:\nOpening remarks\n\nCello section enters');
  });

  it('returns the trimmed base prompt for unsupported models', () => {
    expect(
      buildChunkPrompt({
        prompt: 'Ignored',
        transcriptParts: ['prior'],
        model: 'gpt-4o-transcribe-diarize',
      }),
    ).toBe('Ignored');
  });
});

describe('getExtensionForMimeType', () => {
  it('prefers mp3 for audio/mpeg chunk files', () => {
    expect(getExtensionForMimeType('audio/mpeg')).toBe('.mp3');
  });
});

describe('formatDiarizedSegments', () => {
  it('formats segments with speaker labels', () => {
    const result = formatDiarizedSegments([
      { speaker: 'Alice', text: 'Hello' },
      { speaker: 'Bob', text: 'Hi there' },
    ]);
    expect(result).toBe('[Alice]: Hello\n[Bob]: Hi there');
  });

  it('returns empty string for empty/missing segments', () => {
    expect(formatDiarizedSegments([])).toBe('');
    expect(formatDiarizedSegments(undefined)).toBe('');
  });
});

describe('buildSpeakerReferenceOverrides', () => {
  it('returns undefined for non-diarized models', async () => {
    await expect(
      buildSpeakerReferenceOverrides({
        effectiveModel: 'gpt-4o-transcribe',
        speakerReferences: [{ name: 'Alice', filePath: '/tmp/a.wav' }],
        workspaceDir: '/tmp/workspace',
      }),
    ).resolves.toBeUndefined();
  });
});
