const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const { logger } = require('@librechat/data-schemas');
const { FileSources } = require('librechat-data-provider');
const { logAxiosError, generateShortLivedToken } = require('@librechat/api');
const { getRagApiUrl } = require('./routing');
const { getRagRequestConfig } = require('./auth');

const RAG_REQUEST_TIMEOUT_MS = 120000;
const RAG_MAX_RETRIES = 3;
const RAG_INITIAL_BACKOFF_MS = 1000;

/**
 * Determines whether an axios error is retryable (server/network errors, not client errors).
 * @param {Error} error
 * @returns {boolean}
 */
function isRetryableError(error) {
  if (!error.response) {
    return true; // network error, timeout, ECONNREFUSED, etc.
  }
  const status = error.response.status;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Executes an async function with exponential backoff retry.
 * @param {Function} fn - Async function to execute.
 * @param {Object} options
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.initialBackoffMs=1000]
 * @param {string} [options.operationName='operation']
 * @returns {Promise<*>}
 */
async function withRetry(fn, { maxRetries = RAG_MAX_RETRIES, initialBackoffMs = RAG_INITIAL_BACKOFF_MS, operationName = 'operation' } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries && isRetryableError(error)) {
        const backoff = initialBackoffMs * Math.pow(2, attempt);
        logger.warn(
          `[VectorDB] ${operationName} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoff}ms: ${error.message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

/**
 * Deletes a file from the vector database. This function takes a file object, constructs the full path, and
 * verifies the path's validity before deleting the file. If the path is invalid, an error is thrown.
 *
 * @param {ServerRequest} req - The request object from Express.
 * @param {MongoFile} file - The file object to be deleted. It should have a `filepath` property that is
 *                           a string representing the path of the file relative to the publicPath.
 *
 * @returns {Promise<void>}
 *          A promise that resolves when the file has been successfully deleted, or throws an error if the
 *          file path is invalid or if there is an error in deletion.
 */
const deleteVectors = async (req, file) => {
  const ragProvider = file?.metadata?.ragProvider;
  const ragApiUrl = getRagApiUrl(ragProvider);

  if (!file.embedded || !ragApiUrl) {
    return;
  }
  try {
    const jwtToken = generateShortLivedToken(req.user.id);

    return await withRetry(
      () =>
        axios.delete(`${ragApiUrl}/documents`, {
          headers: {
            Authorization: `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
            accept: 'application/json',
          },
          data: [file.file_id],
          timeout: RAG_REQUEST_TIMEOUT_MS,
        }),
      { operationName: 'deleteVectors' },
    );
  } catch (error) {
    logAxiosError({
      error,
      message: 'Error deleting vectors',
    });
    if (
      error.response &&
      error.response.status !== 404 &&
      (error.response.status < 200 || error.response.status >= 300)
    ) {
      logger.warn('Error deleting vectors, file will not be deleted');
      throw new Error(error.message || 'An error occurred during file deletion.');
    }
  }
};

/**
 * Uploads a file to the configured Vector database
 *
 * @param {Object} params - The params object.
 * @param {Object} params.req - The request object from Express. It should have a `user` property with an `id` representing the user
 * @param {Express.Multer.File} params.file - The file object, which is part of the request. The file object should
 *                                     have a `path` property that points to the location of the uploaded file.
 * @param {string} params.file_id - The file ID.
 * @param {string} [params.entity_id] - The entity ID for shared resources.
 * @param {string} [params.endpointType] - The endpoint type hint for RAG provider resolution.
 * @param {Object} [params.storageMetadata] - Storage metadata for dual storage pattern.
 *
 * @returns {Promise<{ filepath: string, bytes: number }>}
 *          A promise that resolves to an object containing:
 *            - filepath: The path where the file is saved.
 *            - bytes: The size of the file in bytes.
 */
async function uploadVectors({ req, file, file_id, entity_id, endpointType, storageMetadata }) {
  const { provider, model, ragApiUrl, headers: ragHeaders } = await getRagRequestConfig({
    req,
    provider: endpointType,
  });

  if (!ragApiUrl) {
    throw new Error('RAG API URL not defined');
  }

  try {
    const jwtToken = generateShortLivedToken(req.user.id);
    const formData = new FormData();
    formData.append('file_id', file_id);
    formData.append('file', fs.createReadStream(file.path));
    if (entity_id != null && entity_id) {
      formData.append('entity_id', entity_id);
    }

    // Include storage metadata for RAG API to store with embeddings
    if (storageMetadata) {
      formData.append('storage_metadata', JSON.stringify(storageMetadata));
    }

    const formHeaders = formData.getHeaders();

    const response = await withRetry(
      () =>
        axios.post(`${ragApiUrl}/embed`, formData, {
          headers: {
            Authorization: `Bearer ${jwtToken}`,
            accept: 'application/json',
            ...ragHeaders,
            ...formHeaders,
          },
          timeout: RAG_REQUEST_TIMEOUT_MS,
        }),
      { operationName: 'uploadVectors' },
    );

    const responseData = response.data;
    logger.debug('Response from embedding file', responseData);

    if (responseData.known_type === false) {
      throw new Error(`File embedding failed. The filetype ${file.mimetype} is not supported`);
    }

    if (!responseData.status) {
      throw new Error('File embedding failed.');
    }

    return {
      bytes: file.size,
      filename: file.originalname,
      filepath: FileSources.vectordb,
      embedded: Boolean(responseData.known_type),
      provider,
      model,
    };
  } catch (error) {
    logAxiosError({
      error,
      message: 'Error uploading vectors',
    });
    throw new Error(error.message || 'An error occurred during file upload.');
  }
}

module.exports = {
  deleteVectors,
  uploadVectors,
};
