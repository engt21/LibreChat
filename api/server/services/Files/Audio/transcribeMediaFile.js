const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const mime = require('mime');
const ffmpegPath = require('ffmpeg-static');
const ffprobe = require('ffprobe-static');
const { logger } = require('@librechat/data-schemas');

const ffprobePath = ffprobe.path;

const MAX_STT_UPLOAD_BYTES = 25 * 1024 * 1024;
const TARGET_CHUNK_BYTES = 23 * 1024 * 1024;
const DEFAULT_SEGMENT_SECONDS = 30 * 60;
const MAX_SEGMENT_SECONDS = 10 * 60;
const MAX_GPT4O_SEGMENT_SECONDS = 5 * 60;
const MIN_SEGMENT_SECONDS = 60;
const MAX_PROMPT_CONTEXT_CHARS = 1500;
const MIN_SPEAKER_REFERENCE_SECONDS = 2;
const MAX_SPEAKER_REFERENCE_SECONDS = 10;

const supportedMimeTypes = new Set([
  'audio/flac',
  'audio/m4a',
  'audio/mp3',
  'audio/mp4',
  'audio/mpga',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  'audio/x-flac',
  'audio/x-wav',
  'application/ogg',
]);

const mimeByExtension = {
  '.aif': 'audio/x-aiff',
  '.aiff': 'audio/x-aiff',
  '.amr': 'audio/amr',
  '.avi': 'video/x-msvideo',
  '.caf': 'audio/x-caf',
  '.flac': 'audio/flac',
  '.m4a': 'audio/m4a',
  '.m4b': 'audio/mp4',
  '.m4p': 'audio/mp4',
  '.m4r': 'audio/mp4',
  '.m4v': 'video/x-m4v',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp2': 'audio/mpeg',
  '.mp3': 'audio/mpeg',
  '.mp4': 'audio/mp4',
  '.mpeg': 'audio/mpeg',
  '.mpga': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.wma': 'audio/x-ms-wma',
};

const preferredExtensionByMimeType = {
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'video/matroska': '.mkv',
  'video/x-matroska': '.mkv',
  'video/quicktime': '.mov',
  'video/x-msvideo': '.avi',
  'audio/x-ms-wma': '.wma',
};

function ensureBinary(binaryPath, name) {
  if (!binaryPath) {
    throw new Error(`${name} is not available on this platform`);
  }
}

function trimErrorOutput(output = '') {
  return output.trim().split('\n').slice(-10).join('\n');
}

function runProcess(binaryPath, args) {
  ensureBinary(binaryPath, 'Required media binary');

  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${path.basename(binaryPath)} exited with code ${code}: ${trimErrorOutput(stderr)}`,
        ),
      );
    });
  });
}

function resolveMimeType({ filename, mimetype }) {
  const mimeType = (mimetype || mime.getType(filename || '') || '').toLowerCase();
  if (mimeType) {
    return mimeType;
  }

  const ext = path.extname(filename || '').toLowerCase();
  return mimeByExtension[ext] || 'application/octet-stream';
}

function getMimeTypeForPath(filePath, fallbackMimeType) {
  const ext = path.extname(filePath).toLowerCase();
  return mimeByExtension[ext] || fallbackMimeType || 'audio/mpeg';
}

function getExtensionForMimeType(mimetype, fallbackExtension = '.bin') {
  const preferredExtension = preferredExtensionByMimeType[mimetype];
  if (preferredExtension) {
    return preferredExtension;
  }

  const extension = mime.getExtension(mimetype || '');
  if (extension) {
    return extension.startsWith('.') ? extension : `.${extension}`;
  }

  return fallbackExtension;
}

function isVideoMimeType(mimetype) {
  return mimetype.startsWith('video/');
}

function isDirectlySupportedMimeType(mimetype) {
  return supportedMimeTypes.has(mimetype);
}

function calculateSegmentSeconds(
  durationSeconds,
  byteLength,
  maxSegmentSeconds = MAX_SEGMENT_SECONDS,
) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || byteLength <= 0) {
    return DEFAULT_SEGMENT_SECONDS;
  }

  const bytesPerSecond = byteLength / durationSeconds;
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return DEFAULT_SEGMENT_SECONDS;
  }

  return Math.min(
    maxSegmentSeconds,
    Math.max(MIN_SEGMENT_SECONDS, Math.floor((TARGET_CHUNK_BYTES / bytesPerSecond) * 0.9)),
  );
}

async function probeMediaFile(filePath) {
  const { stdout } = await runProcess(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const probe = JSON.parse(stdout || '{}');
  const durationValue = probe?.format?.duration ?? probe?.streams?.[0]?.duration;
  const durationSeconds = Number.parseFloat(durationValue);

  return {
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
  };
}

async function transcodeToMp3(inputPath, outputPath) {
  await runProcess(ffmpegPath, [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '64k',
    '-c:a',
    'libmp3lame',
    outputPath,
  ]);

  return outputPath;
}

async function splitMediaFile({
  inputPath,
  outputDir,
  extension,
  byteLength,
  durationSeconds,
  maxSegmentSeconds,
}) {
  let segmentSeconds = calculateSegmentSeconds(durationSeconds, byteLength, maxSegmentSeconds);

  while (segmentSeconds >= MIN_SEGMENT_SECONDS) {
    await fs.rm(outputDir, { recursive: true, force: true });
    await fs.mkdir(outputDir, { recursive: true });

    const outputPattern = path.join(outputDir, `chunk-%03d${extension}`);
    await runProcess(ffmpegPath, [
      '-y',
      '-i',
      inputPath,
      '-reset_timestamps',
      '1',
      '-f',
      'segment',
      '-segment_time',
      `${segmentSeconds}`,
      '-c',
      'copy',
      outputPattern,
    ]);

    const chunkNames = (await fs.readdir(outputDir))
      .filter((file) => file.startsWith('chunk-'))
      .sort((a, b) => a.localeCompare(b));

    const chunkPaths = chunkNames.map((file) => path.join(outputDir, file));
    if (chunkPaths.length <= 1) {
      return chunkPaths.length === 1 ? chunkPaths : [inputPath];
    }

    const chunkStats = await Promise.all(chunkPaths.map((file) => fs.stat(file)));
    if (chunkStats.every((stat) => stat.size <= MAX_STT_UPLOAD_BYTES)) {
      return chunkPaths;
    }

    segmentSeconds = Math.floor(segmentSeconds / 2);
  }

  return [inputPath];
}

function buildSegmentFilename(filename, index, total, extension) {
  const parsed = path.parse(filename || 'audio');
  const baseName = parsed.name || 'audio';
  const suffix = total > 1 ? `.part-${String(index + 1).padStart(2, '0')}` : '';
  return `${baseName}${suffix}${extension}`;
}

const WHISPER_MODEL = 'whisper-1';
const DIARIZE_MODEL = 'gpt-4o-transcribe-diarize';
const MODEL_OVERRIDE_SUPPORTED_MODELS = new Set([
  WHISPER_MODEL,
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  DIARIZE_MODEL,
]);
const GPT4O_TRANSCRIBE_MODELS = new Set([
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  DIARIZE_MODEL,
]);
const PROMPT_SUPPORTED_MODELS = new Set([
  WHISPER_MODEL,
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
]);

function getTranscriptionModel(sttSchema, overrideModel) {
  return (
    overrideModel ||
    sttSchema?.model ||
    sttSchema?.azureOpenAIApiDeploymentName ||
    sttSchema?.deploymentName ||
    null
  );
}

function normalizePrompt(prompt) {
  if (typeof prompt !== 'string') {
    return undefined;
  }

  const trimmedPrompt = prompt.trim();
  return trimmedPrompt.length > 0 ? trimmedPrompt : undefined;
}

function supportsPrompt(model) {
  return PROMPT_SUPPORTED_MODELS.has(model);
}

function buildOverrides({ transcriptionModel, configuredModel, prompt }) {
  const effectiveModel = getTranscriptionModel({ model: configuredModel }, transcriptionModel);
  const normalizedPrompt = normalizePrompt(prompt);
  const overrides = {};

  if (transcriptionModel && MODEL_OVERRIDE_SUPPORTED_MODELS.has(transcriptionModel)) {
    overrides.model = transcriptionModel;
  }

  if (effectiveModel === DIARIZE_MODEL) {
    overrides.response_format = 'diarized_json';
    overrides.chunking_strategy = 'auto';
  } else if (normalizedPrompt && supportsPrompt(effectiveModel)) {
    overrides.prompt = normalizedPrompt;
  }

  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

function buildChunkPrompt({ prompt, transcriptParts, model }) {
  if (!supportsPrompt(model)) {
    return normalizePrompt(prompt);
  }

  const promptParts = [];
  const normalizedPrompt = normalizePrompt(prompt);

  if (normalizedPrompt) {
    promptParts.push(normalizedPrompt);
  }

  const transcriptContext = normalizePrompt(transcriptParts.join('\n\n'));
  if (transcriptContext) {
    const contextTail = transcriptContext.slice(-MAX_PROMPT_CONTEXT_CHARS);
    promptParts.push(`Previous transcript context:\n${contextTail}`);
  }

  return promptParts.length > 0 ? promptParts.join('\n\n') : undefined;
}

async function prepareSpeakerReferenceInput({ speakerReference, workspaceDir, index }) {
  const referenceDir = path.join(workspaceDir, 'speaker-references');
  await fs.mkdir(referenceDir, { recursive: true });

  const resolvedMimeType = resolveMimeType({
    filename: speakerReference.filename,
    mimetype: speakerReference.mimetype,
  });

  let preparedPath = speakerReference.filePath;
  let preparedMimeType = resolvedMimeType;
  const preparedName = `speaker-${String(index + 1).padStart(2, '0')}`;

  if (isVideoMimeType(preparedMimeType) || !isDirectlySupportedMimeType(preparedMimeType)) {
    preparedPath = path.join(referenceDir, `${preparedName}.mp3`);
    await transcodeToMp3(speakerReference.filePath, preparedPath);
    preparedMimeType = 'audio/mpeg';
  }

  const { durationSeconds } = await probeMediaFile(preparedPath);
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < MIN_SPEAKER_REFERENCE_SECONDS ||
    durationSeconds > MAX_SPEAKER_REFERENCE_SECONDS
  ) {
    throw new Error(
      `Speaker reference "${speakerReference.name}" must be between ${MIN_SPEAKER_REFERENCE_SECONDS} and ${MAX_SPEAKER_REFERENCE_SECONDS} seconds long.`,
    );
  }

  const referenceBuffer = await fs.readFile(preparedPath);
  const referenceMimeType = getMimeTypeForPath(preparedPath, preparedMimeType);

  return {
    name: speakerReference.name,
    dataUrl: `data:${referenceMimeType};base64,${referenceBuffer.toString('base64')}`,
  };
}

async function buildSpeakerReferenceOverrides({ effectiveModel, speakerReferences, workspaceDir }) {
  if (
    effectiveModel !== DIARIZE_MODEL ||
    !Array.isArray(speakerReferences) ||
    speakerReferences.length === 0
  ) {
    return undefined;
  }

  if (speakerReferences.length > 4) {
    throw new Error('OpenAI diarized transcription supports up to 4 speaker reference clips.');
  }

  const preparedReferences = await Promise.all(
    speakerReferences.map((speakerReference, index) =>
      prepareSpeakerReferenceInput({ speakerReference, workspaceDir, index }),
    ),
  );

  return {
    known_speaker_names: preparedReferences.map((speakerReference) => speakerReference.name),
    known_speaker_references: preparedReferences.map(
      (speakerReference) => speakerReference.dataUrl,
    ),
  };
}

function formatDiarizedSegments(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    return '';
  }

  return segments
    .map((seg) => {
      const speaker = seg.speaker || 'Unknown';
      const text = (seg.text || '').trim();
      return `[${speaker}]: ${text}`;
    })
    .join('\n');
}

async function transcribeMediaFile({
  req,
  filePath,
  filename,
  mimetype,
  sttService,
  language,
  transcriptionModel,
  prompt,
  speakerReferences,
  onChunkComplete,
}) {
  const resolvedMimeType = resolveMimeType({ filename, mimetype });
  const [provider, sttSchema] = await sttService.getProviderSchema(req);
  const effectiveModel = getTranscriptionModel(sttSchema, transcriptionModel);
  const isDiarize = effectiveModel === DIARIZE_MODEL;

  let preparedPath = filePath;
  let preparedMimeType = resolvedMimeType;
  let preparedStat = await fs.stat(preparedPath);
  let converted = false;

  const workspaceDir = path.join(path.dirname(filePath), 'prepared');
  await fs.mkdir(workspaceDir, { recursive: true });
  const speakerReferenceOverrides = await buildSpeakerReferenceOverrides({
    effectiveModel,
    speakerReferences,
    workspaceDir,
  });

  if (
    preparedStat.size > MAX_STT_UPLOAD_BYTES ||
    isVideoMimeType(preparedMimeType) ||
    !isDirectlySupportedMimeType(preparedMimeType)
  ) {
    preparedPath = path.join(workspaceDir, 'normalized.mp3');
    await transcodeToMp3(filePath, preparedPath);
    preparedMimeType = 'audio/mpeg';
    preparedStat = await fs.stat(preparedPath);
    converted = true;
  }

  let chunkPaths = [preparedPath];

  if (preparedStat.size > MAX_STT_UPLOAD_BYTES) {
    const maxSegmentSeconds = GPT4O_TRANSCRIBE_MODELS.has(effectiveModel)
      ? MAX_GPT4O_SEGMENT_SECONDS
      : MAX_SEGMENT_SECONDS;
    const { durationSeconds } = await probeMediaFile(preparedPath);
    const extension = getExtensionForMimeType(
      preparedMimeType,
      path.extname(preparedPath) || '.mp3',
    );
    const chunksDir = path.join(workspaceDir, 'chunks');

    chunkPaths = await splitMediaFile({
      inputPath: preparedPath,
      outputDir: chunksDir,
      extension,
      byteLength: preparedStat.size,
      durationSeconds,
      maxSegmentSeconds,
    });

    const finalChunkStats = await Promise.all(chunkPaths.map((chunkPath) => fs.stat(chunkPath)));
    if (finalChunkStats.some((stat) => stat.size > MAX_STT_UPLOAD_BYTES)) {
      throw new Error('Audio file is too large to transcribe after optimization.');
    }
  }

  const transcriptParts = [];

  for (const [index, chunkPath] of chunkPaths.entries()) {
    const chunkBuffer = await fs.readFile(chunkPath);
    const chunkMimeType = getMimeTypeForPath(chunkPath, preparedMimeType);
    const extension = getExtensionForMimeType(chunkMimeType, path.extname(chunkPath) || '.mp3');
    const combinedOverrides = {
      ...(buildOverrides({
        transcriptionModel,
        configuredModel: sttSchema?.model,
        prompt: buildChunkPrompt({
          prompt,
          transcriptParts,
          model: effectiveModel,
        }),
      }) ?? {}),
      ...(speakerReferenceOverrides ?? {}),
    };

    const overrides = Object.keys(combinedOverrides).length > 0 ? combinedOverrides : undefined;

    const response = await sttService.sttRequest(provider, sttSchema, {
      audioBuffer: chunkBuffer,
      audioFile: {
        originalname: buildSegmentFilename(filename, index, chunkPaths.length, extension),
        mimetype: chunkMimeType,
        size: chunkBuffer.length,
      },
      language,
      overrides,
    });

    if (isDiarize && typeof response === 'object' && response.segments) {
      const formatted = formatDiarizedSegments(response.segments);
      if (formatted) {
        transcriptParts.push(formatted);
      }
    } else {
      const responseText = typeof response === 'string' ? response : response?.text;
      if (responseText?.trim()) {
        transcriptParts.push(responseText.trim());
      }
    }

    if (typeof onChunkComplete === 'function') {
      try {
        await onChunkComplete({
          chunkIndex: index,
          totalChunks: chunkPaths.length,
          partialText: transcriptParts.join('\n\n'),
        });
      } catch (_err) {
        logger.warn('[AudioTranscription] onChunkComplete callback failed', {
          error: _err.message,
        });
      }
    }
  }

  const text = transcriptParts.join('\n\n');

  logger.debug('[AudioTranscription] Media file processed', {
    filename,
    model: effectiveModel,
    chunkCount: chunkPaths.length,
    converted,
    preparedMimeType,
    isDiarize,
  });

  return {
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
    provider,
    model: effectiveModel,
    chunkCount: chunkPaths.length,
    converted,
    preparedMimeType,
    isDiarize,
  };
}

module.exports = {
  MAX_STT_UPLOAD_BYTES,
  DIARIZE_MODEL,
  GPT4O_TRANSCRIBE_MODELS,
  isDirectlySupportedMimeType,
  resolveMimeType,
  getExtensionForMimeType,
  supportsPrompt,
  buildChunkPrompt,
  buildOverrides,
  buildSpeakerReferenceOverrides,
  formatDiarizedSegments,
  probeMediaFile,
  transcribeMediaFile,
};
