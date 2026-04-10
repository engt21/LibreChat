const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const mime = require('mime');
const { logger } = require('@librechat/data-schemas');
const { sanitizeMessageForTransmit } = require('@librechat/api');
const { Constants, FileSources, EModelEndpoint } = require('librechat-data-provider');
const { File } = require('~/db/models');
const {
  getConvo,
  getMessages,
  saveConvo,
  saveMessage,
  updateMessage,
  updateFile,
  getFiles,
} = require('~/models');
const { getAppConfig } = require('~/server/services/Config');
const { getStrategyFunctions } = require('~/server/services/Files/strategies');
const { STTService } = require('./STTService');
const { transcribeMediaFile, resolveMimeType } = require('./transcribeMediaFile');

const RUNNER_ID = `audio-transcription-runner:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
const POLL_INTERVAL_MS = Number.parseInt(
  process.env.AUDIO_TRANSCRIPTION_POLL_INTERVAL_MS ?? '5000',
  10,
);
const LEASE_MS = Number.parseInt(process.env.AUDIO_TRANSCRIPTION_LEASE_MS ?? '7200000', 10);
const MAX_CONCURRENT_TRANSCRIPTIONS = Number.parseInt(
  process.env.AUDIO_TRANSCRIPTION_MAX_CONCURRENT ?? '1',
  10,
);

const TRANSCRIPTION_STATUS = {
  queued: 'queued',
  processing: 'processing',
  completed: 'completed',
  failed: 'failed',
};

const mediaExtensionPattern =
  /\.(aac|aif|aiff|amr|avi|caf|flac|m4a|m4b|m4p|m4r|mkv|mov|mp2|mp3|mp4|mpeg|mpga|oga|ogg|opus|wav|webm|wma)$/i;

let runnerHandle = null;
let stopped = false;
let _tickPromise = null;
const activeJobs = new Map();

function isTranscribableMediaFile(file) {
  const mimeType = resolveMimeType({
    filename: file?.filename,
    mimetype: file?.type,
  });

  return (
    mimeType.startsWith('audio/') ||
    mimeType.startsWith('video/') ||
    mediaExtensionPattern.test(file?.filename || '')
  );
}

function uniqueValues(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeConversationFields(bodyFields = {}) {
  const requestedEndpoint =
    bodyFields.endpoint === EModelEndpoint.agents
      ? bodyFields.endpointType || EModelEndpoint.openAI
      : bodyFields.endpoint || EModelEndpoint.openAI;

  return {
    endpoint: requestedEndpoint,
    endpointType: bodyFields.endpointType || requestedEndpoint,
    model: bodyFields.model,
    transcriptionModel: bodyFields.transcriptionModel || null,
    transcriptionPrompt: bodyFields.prompt || null,
    transcriptionSpeakerReferences: normalizeSpeakerReferences(bodyFields.speakerReferences),
  };
}

function normalizeSpeakerReferences(speakerReferences = []) {
  if (!Array.isArray(speakerReferences)) {
    return [];
  }

  return speakerReferences
    .filter((speakerReference) => speakerReference?.name && speakerReference?.file_id)
    .slice(0, 4)
    .map((speakerReference) => ({
      id: speakerReference.id || undefined,
      name: String(speakerReference.name).trim(),
      file_id: speakerReference.file_id,
      filename: speakerReference.filename || undefined,
      filepath: speakerReference.filepath || undefined,
      type: speakerReference.type || undefined,
      bytes: typeof speakerReference.bytes === 'number' ? speakerReference.bytes : undefined,
      durationSeconds:
        typeof speakerReference.durationSeconds === 'number'
          ? speakerReference.durationSeconds
          : undefined,
      embedded: speakerReference.embedded === true,
      source: speakerReference.source || undefined,
    }));
}

function buildConversationTitle(filename) {
  const parsed = path.parse(filename || 'audio');
  const baseName = parsed.name || 'Audio transcript';
  const truncated = baseName.slice(0, 72);
  return `Transcript: ${truncated}`;
}

function buildRequestMessageText(filename) {
  return `Please transcribe the attached file "${filename}".`;
}

function buildPendingResponseText(filename) {
  return `Transcribing "${filename}"...\n\n*Preparing audio for transcription...*`;
}

function buildProgressResponseText(filename, partialText, chunkIndex, totalChunks) {
  const progress =
    totalChunks > 1 ? `*Transcribing... (${chunkIndex + 1}/${totalChunks} segments)*` : '';
  const text = partialText?.trim();
  if (!text) {
    return `Transcript for "${filename}"\n\n${progress}`;
  }

  return `Transcript for "${filename}"\n\n${text}${progress ? `\n\n---\n${progress}` : ''}`;
}

function buildCompletedResponseText(filename, transcriptText) {
  const text = transcriptText?.trim();
  if (!text) {
    return `Transcript for "${filename}"\n\nNo speech was detected.`;
  }

  return `Transcript for "${filename}"\n\n${text}`;
}

function buildFailureResponseText(filename, errorMessage) {
  return `Failed to transcribe "${filename}".\n\n${errorMessage}`;
}

function getMessageAttachment(file, conversationId, messageId) {
  return {
    file_id: file.file_id,
    filename: file.filename,
    filepath: file.filepath,
    type: file.type,
    source: file.source,
    bytes: file.bytes,
    width: file.width,
    height: file.height,
    embedded: file.embedded,
    conversationId,
    message: messageId,
  };
}

function buildRunnerRequest(userId, language) {
  return {
    user: {
      id: userId,
    },
    body: language ? { language } : {},
  };
}

async function saveConversationState(
  req,
  { conversationId, existingConvo, fileId, bodyFields = {} },
) {
  const normalizedConversationFields = normalizeConversationFields(bodyFields);
  const title =
    existingConvo?.title && existingConvo.title !== 'New Chat'
      ? existingConvo.title
      : buildConversationTitle(bodyFields.filename ?? '');

  return saveConvo(
    req,
    {
      conversationId,
      title,
      endpoint: existingConvo?.endpoint ?? normalizedConversationFields.endpoint,
      endpointType: existingConvo?.endpointType ?? normalizedConversationFields.endpointType,
      model: existingConvo?.model ?? normalizedConversationFields.model,
      transcriptionModel:
        existingConvo?.transcriptionModel ?? normalizedConversationFields.transcriptionModel,
      transcriptionPrompt:
        existingConvo?.transcriptionPrompt ?? normalizedConversationFields.transcriptionPrompt,
      transcriptionSpeakerReferences:
        existingConvo?.transcriptionSpeakerReferences ??
        normalizedConversationFields.transcriptionSpeakerReferences,
      files: uniqueValues([...(existingConvo?.files ?? []), fileId]),
    },
    { context: 'POST /api/files/transcribe' },
  );
}

async function getExistingTranscriptionResponse(req, file) {
  const transcription = file?.metadata?.transcription;
  if (
    !transcription?.conversationId ||
    !transcription?.requestMessageId ||
    !transcription?.responseMessageId
  ) {
    return null;
  }

  const conversation = await getConvo(req.user.id, transcription.conversationId);
  if (!conversation) {
    return null;
  }

  const messages = await getMessages({
    user: req.user.id,
    conversationId: transcription.conversationId,
    messageId: {
      $in: [transcription.requestMessageId, transcription.responseMessageId],
    },
  });

  return {
    conversation,
    messages: messages.map((message) => sanitizeMessageForTransmit(message)),
    responseMessageId: transcription.responseMessageId,
  };
}

async function claimNextQueuedTranscription() {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);

  return File.findOneAndUpdate(
    {
      'metadata.transcription.status': {
        $in: [TRANSCRIPTION_STATUS.queued, TRANSCRIPTION_STATUS.processing],
      },
      'metadata.transcription.responseMessageId': { $exists: true },
      $or: [
        { 'metadata.transcription.status': TRANSCRIPTION_STATUS.queued },
        { 'metadata.transcription.lockUntil': { $exists: false } },
        { 'metadata.transcription.lockUntil': null },
        { 'metadata.transcription.lockUntil': { $lte: now } },
      ],
    },
    {
      $set: {
        'metadata.transcription.status': TRANSCRIPTION_STATUS.processing,
        'metadata.transcription.startedAt': now,
        'metadata.transcription.lockUntil': leaseUntil,
        'metadata.transcription.lockedBy': RUNNER_ID,
        'metadata.transcription.error': null,
      },
      $inc: {
        'metadata.transcription.attempts': 1,
      },
    },
    {
      new: true,
      sort: {
        'metadata.transcription.requestedAt': 1,
        createdAt: 1,
      },
    },
  ).lean();
}

async function downloadFileToTemp(req, file, tempDir) {
  const mimeExtension = mime.getExtension(file.type || '');
  const extension =
    path.extname(file.filename || '') || (mimeExtension ? `.${mimeExtension}` : '') || '.bin';
  const outputPath = path.join(tempDir, `source${extension}`);
  const source = file.source ?? FileSources.local;
  const { getDownloadStream } = getStrategyFunctions(source);

  if (!getDownloadStream) {
    throw new Error(`Download is not supported for file source "${source}".`);
  }

  try {
    const downloadStream = await getDownloadStream(req, file.filepath);
    await pipeline(downloadStream, fs.createWriteStream(outputPath));
  } catch (downloadError) {
    // Surface a clear message instead of a raw ENOENT so operators can
    // diagnose whether the stored filepath is stale or the volume mount
    // is misconfigured.
    const reason =
      downloadError.code === 'ENOENT' ? 'file not found on disk' : downloadError.message;
    throw new Error(
      `Could not download "${file.filename}" for transcription (source=${source}, filepath=${file.filepath}): ${reason}`,
    );
  }
  return outputPath;
}

async function loadSpeakerReferenceFiles({ userId, req, speakerReferences, tempDir }) {
  const speakerReferenceIds = speakerReferences.map((speakerReference) => speakerReference.file_id);
  const referenceFiles = await getFiles({
    user: userId,
    file_id: { $in: speakerReferenceIds },
  });
  const referenceFileMap = new Map(
    referenceFiles.map((referenceFile) => [referenceFile.file_id, referenceFile]),
  );

  return Promise.all(
    speakerReferences.map(async (speakerReference, index) => {
      const referenceFile = referenceFileMap.get(speakerReference.file_id);

      if (!referenceFile) {
        throw new Error(`Speaker reference "${speakerReference.name}" could not be found.`);
      }

      if (!isTranscribableMediaFile(referenceFile)) {
        throw new Error(
          `Speaker reference "${speakerReference.name}" must be an audio or video clip.`,
        );
      }

      const referenceTempDir = path.join(tempDir, `speaker-reference-${index + 1}`);
      await fsp.mkdir(referenceTempDir, { recursive: true });
      const referencePath = await downloadFileToTemp(req, referenceFile, referenceTempDir);

      return {
        name: speakerReference.name,
        filePath: referencePath,
        filename: referenceFile.filename,
        mimetype: referenceFile.type,
      };
    }),
  );
}

async function updateConversationTimestamp(req, conversationId) {
  const conversation = await getConvo(req.user.id, conversationId);
  if (!conversation) {
    return;
  }

  await saveConvo(req, conversation, {
    context: 'Audio transcription completion',
  });
}

async function completeTranscriptionJob(file, result) {
  const transcription = file.metadata?.transcription ?? {};
  const req = buildRunnerRequest(file.user, transcription.language);
  req.config = await getAppConfig();

  await updateFile({
    file_id: file.file_id,
    text: result.text,
    usage: Math.max(file.usage ?? 0, 1),
    metadata: {
      ...(file.metadata ?? {}),
      transcription: {
        ...transcription,
        status: TRANSCRIPTION_STATUS.completed,
        completedAt: new Date(),
        provider: result.provider,
        model: result.model,
        chunkCount: result.chunkCount,
        converted: result.converted,
        error: null,
        lockUntil: null,
        lockedBy: null,
      },
    },
  });

  try {
    await updateMessage(
      req,
      {
        messageId: transcription.responseMessageId,
        sender: 'Transcription',
        text: buildCompletedResponseText(file.filename, result.text),
        unfinished: false,
        error: false,
        model: result.model ?? undefined,
        metadata: {
          type: 'audio_transcription',
          file_id: file.file_id,
          transcriptionStatus: 'completed',
          chunkCount: result.chunkCount,
          provider: result.provider,
          model: result.model,
        },
      },
      { context: 'Audio transcription completion' },
    );
  } catch (updateError) {
    logger.warn('[AudioTranscription] Could not update response message (may have been deleted)', {
      file_id: file.file_id,
      messageId: transcription.responseMessageId,
      error: updateError.message,
    });
  }

  await updateConversationTimestamp(req, transcription.conversationId);
}

async function failTranscriptionJob(file, error) {
  const transcription = file.metadata?.transcription ?? {};
  const req = buildRunnerRequest(file.user, transcription.language);
  req.config = await getAppConfig();
  const errorMessage = error?.message || 'Transcription failed.';

  await updateFile({
    file_id: file.file_id,
    usage: Math.max(file.usage ?? 0, 1),
    metadata: {
      ...(file.metadata ?? {}),
      transcription: {
        ...transcription,
        status: TRANSCRIPTION_STATUS.failed,
        completedAt: new Date(),
        error: errorMessage,
        lockUntil: null,
        lockedBy: null,
      },
    },
  });

  if (transcription.responseMessageId) {
    try {
      await updateMessage(
        req,
        {
          messageId: transcription.responseMessageId,
          sender: 'Transcription',
          text: buildFailureResponseText(file.filename, errorMessage),
          unfinished: false,
          error: true,
          metadata: {
            type: 'audio_transcription',
            file_id: file.file_id,
            transcriptionStatus: 'failed',
            error: errorMessage,
          },
        },
        { context: 'Audio transcription failure' },
      );
    } catch (updateError) {
      logger.warn('[AudioTranscription] Could not update failure message (may have been deleted)', {
        file_id: file.file_id,
        messageId: transcription.responseMessageId,
        error: updateError.message,
      });
    }
  }

  if (transcription.conversationId) {
    await updateConversationTimestamp(req, transcription.conversationId);
  }
}

async function processClaimedTranscription(file) {
  const transcription = file.metadata?.transcription ?? {};
  const req = buildRunnerRequest(file.user, transcription.language);
  req.config = await getAppConfig();

  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'librechat-transcription-'));

  try {
    const sourcePath = await downloadFileToTemp(req, file, tempDir);
    const speakerReferences = normalizeSpeakerReferences(transcription.speakerReferences);
    const speakerReferenceFiles = speakerReferences.length
      ? await loadSpeakerReferenceFiles({
          userId: file.user,
          req,
          speakerReferences,
          tempDir,
        })
      : undefined;
    const sttService = STTService.getInstance();

    const onChunkComplete = async ({ chunkIndex, totalChunks, partialText }) => {
      if (totalChunks <= 1) {
        return;
      }
      try {
        await updateMessage(
          req,
          {
            messageId: transcription.responseMessageId,
            text: buildProgressResponseText(file.filename, partialText, chunkIndex, totalChunks),
            metadata: {
              type: 'audio_transcription',
              file_id: file.file_id,
              transcriptionStatus: 'processing',
              chunksCompleted: chunkIndex + 1,
              totalChunks,
            },
          },
          { context: 'Audio transcription progress' },
        );
      } catch (_err) {
        logger.warn('[AudioTranscription] Progress update failed', {
          file_id: file.file_id,
          error: _err.message,
        });
      }
    };

    const result = await transcribeMediaFile({
      req,
      filePath: sourcePath,
      filename: file.filename,
      mimetype: file.type,
      sttService,
      language: transcription.language,
      transcriptionModel: transcription.transcriptionModel || undefined,
      prompt: transcription.prompt || undefined,
      speakerReferences: speakerReferenceFiles,
      onChunkComplete,
    });

    await completeTranscriptionJob(file, result);
  } catch (error) {
    logger.error('[AudioTranscription] Failed to process audio transcription job', {
      file_id: file.file_id,
      error: error.message,
    });
    await failTranscriptionJob(file, error);
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

async function _runTickBody() {
  while (activeJobs.size < MAX_CONCURRENT_TRANSCRIPTIONS) {
    if (stopped) {
      break;
    }

    const file = await claimNextQueuedTranscription();
    if (!file) {
      break;
    }

    const jobPromise = processClaimedTranscription(file).finally(() => {
      activeJobs.delete(file.file_id);
      if (!stopped) {
        setImmediate(() => {
          void runAudioTranscriptionTick();
        });
      }
    });

    activeJobs.set(file.file_id, jobPromise);
  }
}

function runAudioTranscriptionTick() {
  if (_tickPromise || stopped) {
    return _tickPromise ?? Promise.resolve();
  }

  const p = _runTickBody().finally(() => {
    _tickPromise = null;
  });
  _tickPromise = p;
  return p;
}

function kickAudioTranscriptionRunner() {
  setImmediate(() => {
    void runAudioTranscriptionTick();
  });
}

function startAudioTranscriptionRunner() {
  if (runnerHandle) {
    return;
  }

  stopped = false;

  logger.info(
    `[AudioTranscription] Starting runner ${RUNNER_ID} (poll=${POLL_INTERVAL_MS}ms, lease=${LEASE_MS}ms, maxConcurrent=${MAX_CONCURRENT_TRANSCRIPTIONS})`,
  );

  runnerHandle = setInterval(() => {
    void runAudioTranscriptionTick();
  }, POLL_INTERVAL_MS);

  kickAudioTranscriptionRunner();
}

/**
 * Stop the audio transcription runner and optionally drain in-flight work.
 * When called without arguments (or `drain=false`), it stops the polling
 * interval immediately.  When called with `drain=true` it also awaits
 * any in-progress tick **and** all active transcription jobs so callers
 * (e.g. test teardown) can be sure no Mongo operations fire after the
 * runner is stopped.
 *
 * Setting `stopped = true` first prevents the tick from claiming new work
 * and prevents completed jobs from scheduling follow-up ticks.
 *
 * @param {{ drain?: boolean }} [options]
 * @returns {Promise<void>}
 */
async function stopAudioTranscriptionRunner({ drain = false } = {}) {
  stopped = true;

  if (runnerHandle) {
    clearInterval(runnerHandle);
    runnerHandle = null;
  }

  if (drain) {
    // Await the in-progress tick so any job it is about to push into
    // activeJobs lands before we snapshot.
    if (_tickPromise) {
      await _tickPromise;
    }

    // Now drain every job the tick may have started.
    if (activeJobs.size > 0) {
      await Promise.allSettled(Array.from(activeJobs.values()));
    }
  }
}

async function createAudioTranscriptionRequest(req) {
  const { file_id } = req.body;

  if (!file_id) {
    throw new Error('file_id is required.');
  }

  const file = await File.findOne({ file_id, user: req.user.id }).lean();
  if (!file) {
    const error = new Error('File not found.');
    error.statusCode = 404;
    throw error;
  }

  if ([FileSources.openai, FileSources.azure].includes(file.source)) {
    const error = new Error('Audio transcription is not supported for assistant-managed files.');
    error.statusCode = 400;
    throw error;
  }

  if (!isTranscribableMediaFile(file)) {
    const error = new Error('Only audio and audio-containing media files can be transcribed.');
    error.statusCode = 400;
    throw error;
  }

  const existingResponse = await getExistingTranscriptionResponse(req, file);
  if (existingResponse) {
    kickAudioTranscriptionRunner();
    return existingResponse;
  }

  const normalizedConversationFields = normalizeConversationFields(req.body);
  const conversationId = crypto.randomUUID();
  const parentMessageId = Constants.NO_PARENT;

  const requestMessageId = crypto.randomUUID();
  const responseMessageId = crypto.randomUUID();
  const attachment = getMessageAttachment(file, conversationId, requestMessageId);

  const requestMessage = await saveMessage(
    req,
    {
      messageId: requestMessageId,
      conversationId,
      parentMessageId,
      sender: 'User',
      text: buildRequestMessageText(file.filename),
      endpoint: normalizedConversationFields.endpoint,
      model: normalizedConversationFields.model,
      isCreatedByUser: true,
      files: [attachment],
      metadata: {
        type: 'audio_transcription',
        file_id: file.file_id,
      },
    },
    { context: 'POST /api/files/transcribe request message' },
  );

  const responseMessage = await saveMessage(
    req,
    {
      messageId: responseMessageId,
      conversationId,
      parentMessageId: requestMessageId,
      sender: 'Transcription',
      text: buildPendingResponseText(file.filename),
      endpoint: normalizedConversationFields.endpoint,
      model: normalizedConversationFields.model,
      isCreatedByUser: false,
      unfinished: false,
      error: false,
      metadata: {
        type: 'audio_transcription',
        file_id: file.file_id,
        transcriptionStatus: 'processing',
      },
    },
    { context: 'POST /api/files/transcribe response message' },
  );

  const conversation = await saveConversationState(req, {
    conversationId,
    existingConvo: undefined,
    fileId: file.file_id,
    bodyFields: {
      ...req.body,
      filename: file.filename,
    },
  });

  await updateFile({
    file_id: file.file_id,
    conversationId,
    messageId: requestMessageId,
    usage: Math.max(file.usage ?? 0, 1),
    metadata: {
      ...(file.metadata ?? {}),
      transcription: {
        ...(file.metadata?.transcription ?? {}),
        status: TRANSCRIPTION_STATUS.queued,
        requestedAt: new Date(),
        startedAt: null,
        completedAt: null,
        error: null,
        language: req.body.language || null,
        transcriptionModel: req.body.transcriptionModel || null,
        prompt: req.body.prompt || null,
        speakerReferences: normalizeSpeakerReferences(req.body.speakerReferences),
        requestMessageId,
        responseMessageId,
        conversationId,
        chunkCount: null,
        provider: null,
        model: null,
        converted: false,
        attempts: 0,
        lockUntil: null,
        lockedBy: null,
      },
    },
  });

  kickAudioTranscriptionRunner();

  return {
    conversation,
    messages: [requestMessage, responseMessage].map((message) =>
      sanitizeMessageForTransmit(message),
    ),
    responseMessageId,
  };
}

module.exports = {
  createAudioTranscriptionRequest,
  isTranscribableMediaFile,
  kickAudioTranscriptionRunner,
  startAudioTranscriptionRunner,
  stopAudioTranscriptionRunner,
};
