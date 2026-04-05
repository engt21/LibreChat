import { EModelEndpoint } from 'librechat-data-provider';
import { isEnabled } from './common';
import type { AzureOptions, GenericClient } from '~/types';

const azureResourceHostRegex =
  /(^|\.)((openai|cognitiveservices)\.azure\.com|services\.ai\.azure\.com)$/i;
const azureLegacyInferenceHostRegex = /(^|\.)(models|inference)\.ai\.azure\.com$/i;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const stripKnownAzureOperation = (pathname: string) => {
  const cleanedPath = trimTrailingSlash(pathname || '/');

  return cleanedPath
    .replace(/\/(chat\/completions|completions|responses|embeddings|models)$/i, '')
    .replace(/\/(chat\/completions|responses|embeddings|models)$/i, '');
};

const getAzureInstanceBaseURL = (instanceName?: string) => {
  if (!instanceName) {
    return undefined;
  }

  if (instanceName.startsWith('http://') || instanceName.startsWith('https://')) {
    return instanceName;
  }

  if (instanceName.includes('.azure.com')) {
    return `https://${instanceName}`;
  }

  return `https://${instanceName}.openai.azure.com`;
};

const isAzureOptions = (value: unknown): value is AzureOptions => {
  if (value == null || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  return [
    'azureOpenAIApiKey',
    'azureOpenAIApiInstanceName',
    'azureOpenAIApiDeploymentName',
    'azureOpenAIApiVersion',
  ].some((key) => typeof record[key] === 'string' && record[key] !== '');
};

export interface AzureOpenAIDirectConfig {
  apiKey?: string;
  baseURL?: string;
  manualModels: string[];
  azureOptions?: AzureOptions;
  isLegacyCredentialPayload: boolean;
}

export function isAzureOpenAIBaseURL(baseURL?: string | null): boolean {
  if (!baseURL) {
    return false;
  }

  try {
    const url = new URL(baseURL);
    return (
      azureResourceHostRegex.test(url.hostname) || azureLegacyInferenceHostRegex.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function normalizeAzureOpenAIBaseURL(baseURL?: string | null): string | undefined {
  if (!baseURL) {
    return undefined;
  }

  try {
    const url = new URL(baseURL);
    const originalPathname = url.pathname || '/';
    const originalTrimmedPathname = trimTrailingSlash(originalPathname) || '/';
    const trimmedPathname = stripKnownAzureOperation(originalPathname);

    if (azureResourceHostRegex.test(url.hostname)) {
      if (
        /^\/models$/i.test(originalTrimmedPathname) ||
        /^\/openai\/v1$/i.test(originalTrimmedPathname)
      ) {
        url.pathname = originalPathname;
      } else if (/^\/api\/projects\/[^/]+$/i.test(trimmedPathname)) {
        url.pathname = `${trimmedPathname}/openai/v1`;
      } else if (/^\/api\/projects\/[^/]+\/openai$/i.test(trimmedPathname)) {
        url.pathname = `${trimmedPathname}/v1`;
      } else if (/^\/api\/projects\/[^/]+\/openai\/v1$/i.test(originalTrimmedPathname)) {
        url.pathname = originalPathname;
      } else if (
        trimmedPathname === '' ||
        trimmedPathname === '/' ||
        trimmedPathname === '/openai' ||
        /^\/openai\/deployments\/[^/]+$/i.test(trimmedPathname)
      ) {
        url.pathname = '/openai/v1';
      }
    } else if (azureLegacyInferenceHostRegex.test(url.hostname)) {
      if (/^\/v1$/i.test(originalTrimmedPathname)) {
        url.pathname = originalPathname;
      } else if (trimmedPathname === '' || trimmedPathname === '/') {
        url.pathname = '/v1';
      } else if (/^\/v1$/i.test(trimmedPathname)) {
        url.pathname = '/v1';
      }
    }

    return url.toString();
  } catch {
    return baseURL;
  }
}

export function supportsAzureOpenAIModelListing(baseURL?: string | null): boolean {
  const normalizedBaseURL = normalizeAzureOpenAIBaseURL(baseURL);
  if (!normalizedBaseURL) {
    return false;
  }

  try {
    const url = new URL(normalizedBaseURL);
    const pathname = trimTrailingSlash(url.pathname || '');
    return (
      azureResourceHostRegex.test(url.hostname) &&
      (/^\/openai\/v1$/i.test(pathname) || /^\/api\/projects\/[^/]+\/openai\/v1$/i.test(pathname))
    );
  } catch {
    return false;
  }
}

export function isAzureOpenAIEndpointCandidate({
  endpoint,
  baseURL,
  defaultParamsEndpoint,
}: {
  endpoint?: string | null;
  baseURL?: string | null;
  defaultParamsEndpoint?: string | null;
}): boolean {
  return (
    endpoint === EModelEndpoint.azureOpenAI ||
    defaultParamsEndpoint === EModelEndpoint.azureOpenAI ||
    isAzureOpenAIBaseURL(baseURL)
  );
}

export function resolveAzureOpenAIDirectConfig({
  apiKey,
  baseURL,
  models,
}: {
  apiKey?: string | null;
  baseURL?: string | null;
  models?: string | string[] | null;
}): AzureOpenAIDirectConfig {
  let resolvedApiKey = apiKey?.trim() || undefined;
  let azureOptions: AzureOptions | undefined;
  let isLegacyCredentialPayload = false;

  if (resolvedApiKey) {
    try {
      const parsedValue = JSON.parse(resolvedApiKey) as unknown;
      if (isAzureOptions(parsedValue)) {
        azureOptions = parsedValue;
        resolvedApiKey = parsedValue.azureOpenAIApiKey;
        isLegacyCredentialPayload = true;
      }
    } catch {
      // Ignore non-JSON API key payloads.
    }
  }

  const resolvedBaseURL = normalizeAzureOpenAIBaseURL(
    baseURL ?? getAzureInstanceBaseURL(azureOptions?.azureOpenAIApiInstanceName),
  );

  const manualModels = Array.isArray(models)
    ? models.map((model) => model.trim()).filter(Boolean)
    : (models ?? '')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean);

  return {
    apiKey: resolvedApiKey,
    baseURL: resolvedBaseURL,
    manualModels,
    azureOptions,
    isLegacyCredentialPayload,
  };
}

/**
 * Sanitizes the model name to be used in the URL by removing or replacing disallowed characters.
 * @param modelName - The model name to be sanitized.
 * @returns The sanitized model name.
 */
export const sanitizeModelName = (modelName: string): string => {
  // Replace periods with empty strings and other disallowed characters as needed.
  return modelName.replace(/\./g, '');
};

/**
 * Generates the Azure OpenAI API endpoint URL.
 * @param params - The parameters object.
 * @param params.azureOpenAIApiInstanceName - The Azure OpenAI API instance name.
 * @param params.azureOpenAIApiDeploymentName - The Azure OpenAI API deployment name.
 * @returns The complete endpoint URL for the Azure OpenAI API.
 */
export const genAzureEndpoint = ({
  azureOpenAIApiInstanceName,
  azureOpenAIApiDeploymentName,
}: {
  azureOpenAIApiInstanceName: string;
  azureOpenAIApiDeploymentName: string;
}): string => {
  // Support both old (.openai.azure.com) and new (.cognitiveservices.azure.com) endpoint formats
  // If instanceName already includes a full domain, use it as-is
  if (azureOpenAIApiInstanceName.includes('.azure.com')) {
    return `https://${azureOpenAIApiInstanceName}/openai/deployments/${azureOpenAIApiDeploymentName}`;
  }
  // Legacy format for backward compatibility
  return `https://${azureOpenAIApiInstanceName}.openai.azure.com/openai/deployments/${azureOpenAIApiDeploymentName}`;
};

/**
 * Generates the Azure OpenAI API chat completion endpoint URL with the API version.
 * If both deploymentName and modelName are provided, modelName takes precedence.
 * @param azureConfig - The Azure configuration object.
 * @param azureConfig.azureOpenAIApiInstanceName - The Azure OpenAI API instance name.
 * @param azureConfig.azureOpenAIApiDeploymentName - The Azure OpenAI API deployment name (optional).
 * @param azureConfig.azureOpenAIApiVersion - The Azure OpenAI API version.
 * @param modelName - The model name to be included in the deployment name (optional).
 * @param client - The API Client class for optionally setting properties (optional).
 * @returns The complete chat completion endpoint URL for the Azure OpenAI API.
 * @throws Error if neither azureOpenAIApiDeploymentName nor modelName is provided.
 */
export const genAzureChatCompletion = (
  {
    azureOpenAIApiInstanceName,
    azureOpenAIApiDeploymentName,
    azureOpenAIApiVersion,
  }: {
    azureOpenAIApiInstanceName: string;
    azureOpenAIApiDeploymentName?: string;
    azureOpenAIApiVersion: string;
  },
  modelName?: string,
  client?: GenericClient,
): string => {
  // Determine the deployment segment of the URL based on provided modelName or azureOpenAIApiDeploymentName
  let deploymentSegment: string;
  if (isEnabled(process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME) && modelName) {
    const sanitizedModelName = sanitizeModelName(modelName);
    deploymentSegment = sanitizedModelName;
    if (client && typeof client === 'object') {
      client.azure.azureOpenAIApiDeploymentName = sanitizedModelName;
    }
  } else if (azureOpenAIApiDeploymentName) {
    deploymentSegment = azureOpenAIApiDeploymentName;
  } else if (!process.env.AZURE_OPENAI_BASEURL) {
    throw new Error(
      'Either a model name with the `AZURE_USE_MODEL_AS_DEPLOYMENT_NAME` setting or a deployment name must be provided if `AZURE_OPENAI_BASEURL` is omitted.',
    );
  } else {
    deploymentSegment = '';
  }

  return `https://${azureOpenAIApiInstanceName}.openai.azure.com/openai/deployments/${deploymentSegment}/chat/completions?api-version=${azureOpenAIApiVersion}`;
};

/**
 * Retrieves the Azure OpenAI API credentials from environment variables.
 * @returns An object containing the Azure OpenAI API credentials.
 */
export const getAzureCredentials = (): AzureOptions => {
  return {
    azureOpenAIApiKey: process.env.AZURE_API_KEY ?? process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIApiInstanceName: process.env.AZURE_OPENAI_API_INSTANCE_NAME,
    azureOpenAIApiDeploymentName: process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME,
    azureOpenAIApiVersion: process.env.AZURE_OPENAI_API_VERSION,
  };
};

/**
 * Constructs a URL by replacing placeholders in the baseURL with values from the azure object.
 * It specifically looks for '${INSTANCE_NAME}' and '${DEPLOYMENT_NAME}' within the baseURL and replaces
 * them with 'azureOpenAIApiInstanceName' and 'azureOpenAIApiDeploymentName' from the azure object.
 * If the respective azure property is not provided, the placeholder is replaced with an empty string.
 *
 * @param params - The parameters object.
 * @param params.baseURL - The baseURL to inspect for replacement placeholders.
 * @param params.azureOptions - The azure options object containing the instance and deployment names.
 * @returns The complete baseURL with credentials injected for the Azure OpenAI API.
 */
export function constructAzureURL({
  baseURL,
  azureOptions,
}: {
  baseURL: string;
  azureOptions?: AzureOptions;
}): string {
  let finalURL = baseURL;

  // Replace INSTANCE_NAME and DEPLOYMENT_NAME placeholders with actual values if available
  if (azureOptions) {
    finalURL = finalURL.replace('${INSTANCE_NAME}', azureOptions.azureOpenAIApiInstanceName ?? '');
    finalURL = finalURL.replace(
      '${DEPLOYMENT_NAME}',
      azureOptions.azureOpenAIApiDeploymentName ?? '',
    );
  }

  return finalURL;
}
