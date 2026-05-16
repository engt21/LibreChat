import { Providers } from '@librechat/agents';
import {
  googleSettings,
  removeNullishValues,
  isGoogleThinkingLevelModel,
  getGoogleModelCapabilities as resolveGoogleModelCapabilities,
} from 'librechat-data-provider';
import type { GoogleClientOptions, VertexAIClientOptions } from '@librechat/agents';
import type { GoogleAIToolType } from '@langchain/google-common';
import type * as t from '~/types';
import { isEnabled } from '~/utils';
import { resolveGoogleClientAuth } from './auth';

/** Known Google/Vertex AI parameters that map directly to the client config */
export const knownGoogleParams = new Set([
  'model',
  'modelName',
  'temperature',
  'maxOutputTokens',
  'maxReasoningTokens',
  'topP',
  'topK',
  'seed',
  'presencePenalty',
  'frequencyPenalty',
  'stopSequences',
  'stop',
  'logprobs',
  'topLogprobs',
  'safetySettings',
  'responseModalities',
  'convertSystemMessageToHumanContent',
  'speechConfig',
  'streamUsage',
  'apiKey',
  'baseUrl',
  'location',
  'authOptions',
]);

/**
 * Applies default parameters to the target object only if the field is undefined
 * @param target - The target object to apply defaults to
 * @param defaults - Record of default parameter values
 */
function applyDefaultParams(target: Record<string, unknown>, defaults: Record<string, unknown>) {
  for (const [key, value] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = value;
    }
  }
}

function getThresholdMapping(model: string) {
  const gemini1Pattern = /gemini-(1\.0|1\.5|pro$|1\.0-pro|1\.5-pro|1\.5-flash-001)/;
  const restrictedPattern = /(gemini-(1\.5-flash-8b|2\.0|exp)|learnlm)/;

  if (gemini1Pattern.test(model)) {
    return (value: string) => {
      if (value === 'OFF') {
        return 'BLOCK_NONE';
      }
      return value;
    };
  }

  if (restrictedPattern.test(model)) {
    return (value: string) => {
      if (value === 'OFF' || value === 'HARM_BLOCK_THRESHOLD_UNSPECIFIED') {
        return 'BLOCK_NONE';
      }
      return value;
    };
  }

  return (value: string) => value;
}

export function getSafetySettings(
  model?: string,
): Array<{ category: string; threshold: string }> | undefined {
  if (isEnabled(process.env.GOOGLE_EXCLUDE_SAFETY_SETTINGS)) {
    return undefined;
  }
  const mapThreshold = getThresholdMapping(model ?? '');

  return [
    {
      category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      threshold: mapThreshold(
        process.env.GOOGLE_SAFETY_SEXUALLY_EXPLICIT || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
      ),
    },
    {
      category: 'HARM_CATEGORY_HATE_SPEECH',
      threshold: mapThreshold(
        process.env.GOOGLE_SAFETY_HATE_SPEECH || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
      ),
    },
    {
      category: 'HARM_CATEGORY_HARASSMENT',
      threshold: mapThreshold(
        process.env.GOOGLE_SAFETY_HARASSMENT || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
      ),
    },
    {
      category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
      threshold: mapThreshold(
        process.env.GOOGLE_SAFETY_DANGEROUS_CONTENT || 'HARM_BLOCK_THRESHOLD_UNSPECIFIED',
      ),
    },
    {
      category: 'HARM_CATEGORY_CIVIC_INTEGRITY',
      threshold: mapThreshold(process.env.GOOGLE_SAFETY_CIVIC_INTEGRITY || 'BLOCK_NONE'),
    },
  ];
}

/**
 * Replicates core logic from GoogleClient's constructor and setOptions, plus client determination.
 * Returns an object with the provider label and the final options that would be passed to createLLM.
 *
 * @param credentials - Either a JSON string or an object containing Google keys
 * @param options - The same shape as the "GoogleClient" constructor options
 */

export function getGoogleConfig(
  credentials: string | t.GoogleCredentials | undefined,
  options: t.GoogleConfigOptions = {},
  acceptRawApiKey = false,
) {
  const authConfig = resolveGoogleClientAuth(credentials, { acceptRawApiKey });
  const apiKey = authConfig.apiKey ?? null;
  const reverseProxyUrl = options.reverseProxyUrl;
  const authHeader = options.authHeader;
  const requestedModelOptions = options.modelOptions || {};
  const modelName = (requestedModelOptions.model ?? '') as string;
  const modelCapabilities = resolveGoogleModelCapabilities(modelName);

  const {
    web_search,
    thinkingLevel: requestedThinkingLevel,
    thinking: requestedThinking,
    thinkingBudget: requestedThinkingBudget,
    ...modelOptions
  } = requestedModelOptions;

  const thinking = modelCapabilities.supportsThinking
    ? requestedThinking ?? googleSettings.thinking.default
    : false;
  const thinkingBudget = modelCapabilities.supportsThinkingBudget
    ? requestedThinkingBudget ?? googleSettings.thinkingBudget.default
    : undefined;
  const thinkingLevel = modelCapabilities.supportsThinkingLevel
    ? requestedThinkingLevel
    : undefined;

  let enableWebSearch = web_search;

  const llmConfig: GoogleClientOptions | VertexAIClientOptions = removeNullishValues(
    {
      ...(modelOptions || {}),
      model: modelOptions?.model ?? '',
      maxRetries: 2,
      topP: modelOptions?.topP ?? undefined,
      topK: modelOptions?.topK ?? undefined,
      temperature: modelOptions?.temperature ?? undefined,
      maxOutputTokens: modelOptions?.maxOutputTokens ?? undefined,
    },
    true,
  );

  /** Used only for Safety Settings */
  llmConfig.safetySettings = getSafetySettings(llmConfig.model);

  const provider = authConfig.useVertex ? Providers.VERTEXAI : Providers.GOOGLE;

  if (provider === Providers.VERTEXAI) {
    const vertexAuthOptions = removeNullishValues(
      {
        ...(authConfig.serviceKey ? { credentials: { ...authConfig.serviceKey } } : {}),
        ...(authConfig.projectId ? { projectId: authConfig.projectId } : {}),
      },
      true,
    );

    if (Object.keys(vertexAuthOptions).length > 0) {
      (llmConfig as VertexAIClientOptions).authOptions = vertexAuthOptions;
    }

    (llmConfig as VertexAIClientOptions).location = options.vertexLocation ?? authConfig.location;
  } else if (apiKey && provider === Providers.GOOGLE) {
    llmConfig.apiKey = apiKey;
  } else {
    throw new Error(
      'Invalid credentials provided. Please provide a valid Google API key, Vertex AI service account JSON, or Vertex AI application default credentials.',
    );
  }

  /**
   * Gemini 3+ uses a qualitative `thinkingLevel` ('minimal'|'low'|'medium'|'high')
   * instead of the numeric `thinkingBudget` used by Gemini 2.5 and earlier.
   * When thinking is supported and enabled, we send `thinkingConfig`
   * with `includeThoughts: true`. The `thinkingBudget` param is ignored for Gemini 3+.
   *
   * For Vertex AI, top-level `includeThoughts` is still required because
   * `@langchain/google-common`'s `formatGenerationConfig` reads it separately
   * from `thinkingConfig` — they serve different purposes in the request pipeline.
   */
  const isGemini3Plus = modelCapabilities.supportsThinkingLevel;

  if (isGemini3Plus && thinking) {
    const thinkingConfig: { includeThoughts: boolean; thinkingLevel?: string } = {
      includeThoughts: true,
    };
    if (thinkingLevel) {
      thinkingConfig.thinkingLevel = thinkingLevel as string;
    }
    if (provider === Providers.GOOGLE) {
      (llmConfig as GoogleClientOptions).thinkingConfig = thinkingConfig;
    } else if (provider === Providers.VERTEXAI) {
      (llmConfig as Record<string, unknown>).thinkingConfig = thinkingConfig;
      (llmConfig as VertexAIClientOptions).includeThoughts = true;
    }
  } else if (!isGemini3Plus) {
    const shouldEnableThinking =
      modelCapabilities.supportsThinkingBudget &&
      thinking &&
      thinkingBudget != null &&
      (thinkingBudget > 0 || thinkingBudget === -1);

    if (shouldEnableThinking && provider === Providers.GOOGLE) {
      (llmConfig as GoogleClientOptions).thinkingConfig = {
        thinkingBudget,
        includeThoughts: Boolean(thinking),
      };
    } else if (shouldEnableThinking && provider === Providers.VERTEXAI) {
      (llmConfig as VertexAIClientOptions).thinkingBudget = thinkingBudget;
      (llmConfig as VertexAIClientOptions).includeThoughts = Boolean(thinking);
    }
  }

  /*
  let legacyOptions = {};
  // Filter out any "examples" that are empty
  legacyOptions.examples = (legacyOptions.examples ?? [])
    .filter(Boolean)
    .filter((obj) => obj?.input?.content !== '' && obj?.output?.content !== '');

  // If user has "examples" from legacyOptions, push them onto llmConfig
  if (legacyOptions.examples?.length) {
    llmConfig.examples = legacyOptions.examples.map((ex) => {
      const { input, output } = ex;
      if (!input?.content || !output?.content) {return undefined;}
      return {
        input: new HumanMessage(input.content),
        output: new AIMessage(output.content),
      };
    }).filter(Boolean);
  }
  */

  if (reverseProxyUrl) {
    (llmConfig as GoogleClientOptions).baseUrl = reverseProxyUrl;
  }

  if (authHeader && apiKey) {
    (llmConfig as GoogleClientOptions).customHeaders = {
      Authorization: `Bearer ${apiKey}`,
    };
  }

  /** Handle defaultParams first - only process Google-native params if undefined */
  if (options.defaultParams && typeof options.defaultParams === 'object') {
    for (const [key, value] of Object.entries(options.defaultParams)) {
      /** Handle web_search separately - don't add to config */
      if (key === 'web_search') {
        if (enableWebSearch === undefined && typeof value === 'boolean') {
          enableWebSearch = value;
        }
        continue;
      }

      if (knownGoogleParams.has(key)) {
        /** Route known Google params to llmConfig only if undefined */
        applyDefaultParams(llmConfig as Record<string, unknown>, { [key]: value });
      }
      /** Leave other params for transform to handle - they might be OpenAI params */
    }
  }

  /** Handle addParams - can override defaultParams */
  if (options.addParams && typeof options.addParams === 'object') {
    for (const [key, value] of Object.entries(options.addParams)) {
      /** Handle web_search separately - don't add to config */
      if (key === 'web_search') {
        if (typeof value === 'boolean') {
          enableWebSearch = value;
        }
        continue;
      }

      if (knownGoogleParams.has(key)) {
        /** Route known Google params to llmConfig */
        (llmConfig as Record<string, unknown>)[key] = value;
      }
      /** Leave other params for transform to handle - they might be OpenAI params */
    }
  }

  /** Handle dropParams - only drop from Google config */
  if (options.dropParams && Array.isArray(options.dropParams)) {
    options.dropParams.forEach((param) => {
      if (param === 'web_search') {
        enableWebSearch = false;
        return;
      }

      if (param in llmConfig) {
        delete (llmConfig as Record<string, unknown>)[param];
      }
    });
  }

  const tools: GoogleAIToolType[] = [];

  if (enableWebSearch && modelCapabilities.supportsWebSearch) {
    tools.push({ googleSearch: {} });
  }

  // Return the final shape
  return {
    /** @type {GoogleAIToolType[]} */
    tools,
    /** @type {Providers.GOOGLE | Providers.VERTEXAI} */
    provider,
    /** @type {GoogleClientOptions | VertexAIClientOptions} */
    llmConfig,
  };
}
