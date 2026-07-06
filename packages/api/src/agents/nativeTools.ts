import OpenAI, { toFile } from 'openai';
import { Providers } from '@librechat/agents';
import {
  Tools,
  KnownEndpoints,
  CodeInterpreterModes,
  AnthropicAdvisorModel,
  anthropicSettings,
  checkOpenAIStorage,
  EModelEndpoint,
  getAnthropicModelCapabilities,
  getOpenAIModelCapabilities,
} from 'librechat-data-provider';
import type { AgentToolResources, TFile } from 'librechat-data-provider';
import type { IMongoFile } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';
import {
  ANTHROPIC_ADVISOR_TOOL,
  ANTHROPIC_CODE_EXECUTION_TOOL,
  ANTHROPIC_WEB_FETCH_DYNAMIC_TOOL,
  ANTHROPIC_WEB_FETCH_TOOL,
  ANTHROPIC_WEB_SEARCH_DYNAMIC_TOOL,
  ANTHROPIC_WEB_SEARCH_TOOL,
} from '~/endpoints/anthropic/helpers';

export type AgentNativeTools = {
  web_search?: {
    provider: string;
  };
  execute_code?: {
    provider: string;
    file_ids: string[];
  };
  file_search?: {
    provider: string;
    file_ids: string[];
    vector_store_ids: string[];
  };
};

export type NativeToolSelection = {
  stripTools: Set<string>;
  enableWebSearch: boolean;
  requiresResponsesApi: boolean;
  openAIExecuteCode: boolean;
  openAIFileSearch: boolean;
  anthropicCodeExecution: boolean;
  anthropicWebFetch: boolean;
  anthropicAdvisor: boolean;
  anthropicAdvisorModel?: string | null;
  googleCodeExecution: boolean;
};

type OpenAILLMConfig = Record<string, unknown>;

type OpenAIFileMetadata = {
  endpoint?: string;
  model?: string;
  fileId?: string;
  vectorStoreId?: string;
};

type BuildNativeProviderToolsParams = {
  req: ServerRequest;
  provider: string;
  llmConfig: OpenAILLMConfig;
  tool_resources?: AgentToolResources;
  selection: NativeToolSelection;
  getFileBuffer?: (req: ServerRequest, file: IMongoFile) => Promise<Buffer>;
  updateFile?: (data: Partial<IMongoFile> & { file_id: string }) => Promise<IMongoFile | null>;
};

type AnthropicNativeToolOptions = {
  webFetch?: boolean;
  codeExecution?: boolean;
  advisor?: boolean;
  advisorModel?: string | null;
};

const openAIProviders = new Set<string>([
  EModelEndpoint.openAI,
  EModelEndpoint.azureOpenAI,
  Providers.OPENAI,
  Providers.AZURE,
]);

const googleProviders = new Set<string>([
  EModelEndpoint.google,
  Providers.GOOGLE,
  Providers.VERTEXAI,
]);

const anthropicProviders = new Set<string>([EModelEndpoint.anthropic, Providers.ANTHROPIC]);
const xaiProviders = new Set<string>([KnownEndpoints.xai, Providers.XAI]);

const getProviderLabel = (provider: string) => {
  if (anthropicProviders.has(provider)) {
    return Providers.ANTHROPIC;
  }

  if (xaiProviders.has(provider)) {
    return Providers.XAI;
  }

  if (googleProviders.has(provider)) {
    return Providers.GOOGLE;
  }

  return Providers.OPENAI;
};

const getOpenAIEndpoint = (provider: string) => {
  if (provider === EModelEndpoint.azureOpenAI || provider === Providers.AZURE) {
    return EModelEndpoint.azureOpenAI;
  }

  return EModelEndpoint.openAI;
};

const getToolKey = (tool: unknown): string => {
  if (tool == null) {
    return 'null';
  }

  if (typeof tool !== 'object') {
    return String(tool);
  }

  if ('type' in tool && typeof tool.type === 'string') {
    return `type:${tool.type}`;
  }

  return `keys:${Object.keys(tool).sort().join(',')}`;
};

const isOpenAIProvider = (provider: string) => openAIProviders.has(provider);
const isGoogleProvider = (provider: string) => googleProviders.has(provider);
const isAnthropicProvider = (provider: string) => anthropicProviders.has(provider);
const isXAIProvider = (provider: string) => xaiProviders.has(provider);

const getAdvisorModel = (model?: string | null): AnthropicAdvisorModel =>
  Object.values(AnthropicAdvisorModel).includes(model as AnthropicAdvisorModel)
    ? (model as AnthropicAdvisorModel)
    : anthropicSettings.advisor_model.default;

const PROVIDER_NATIVE_CODE_INTERPRETER = CodeInterpreterModes.provider_native;
const LIBRECHAT_MANAGED_CODE_INTERPRETER = CodeInterpreterModes.librechat;

const parseCodeInterpreterRouting = (value?: string) => {
  if (typeof value !== 'string') {
    return PROVIDER_NATIVE_CODE_INTERPRETER;
  }

  return value.trim().toLowerCase() === LIBRECHAT_MANAGED_CODE_INTERPRETER
    ? LIBRECHAT_MANAGED_CODE_INTERPRETER
    : PROVIDER_NATIVE_CODE_INTERPRETER;
};

const shouldUseProviderNativeCodeInterpreter = (provider: string) => {
  if (provider === EModelEndpoint.azureOpenAI || provider === Providers.AZURE) {
    return (
      parseCodeInterpreterRouting(
        process.env.AZURE_OPENAI_CODE_INTERPRETER_ROUTING ??
          process.env.OPENAI_CODE_INTERPRETER_ROUTING,
      ) === PROVIDER_NATIVE_CODE_INTERPRETER
    );
  }

  if (provider === EModelEndpoint.openAI || provider === Providers.OPENAI) {
    return (
      parseCodeInterpreterRouting(process.env.OPENAI_CODE_INTERPRETER_ROUTING) ===
      PROVIDER_NATIVE_CODE_INTERPRETER
    );
  }

  if (provider === EModelEndpoint.google || provider === Providers.GOOGLE) {
    return (
      parseCodeInterpreterRouting(process.env.GOOGLE_CODE_INTERPRETER_ROUTING) ===
      PROVIDER_NATIVE_CODE_INTERPRETER
    );
  }

  if (provider === Providers.VERTEXAI) {
    return (
      parseCodeInterpreterRouting(process.env.GOOGLE_CODE_INTERPRETER_ROUTING) ===
      PROVIDER_NATIVE_CODE_INTERPRETER
    );
  }

  return false;
};

export const selectNativeTools = ({
  agentId: _agentId,
  provider,
  tools,
  tool_resources,
  model,
  codeInterpreterMode,
  anthropicToolOptions,
}: {
  agentId: string;
  provider: string;
  tools?: string[];
  tool_resources?: AgentToolResources;
  model?: string | null;
  codeInterpreterMode?: string;
  anthropicToolOptions?: AnthropicNativeToolOptions;
}): NativeToolSelection => {
  const selection: NativeToolSelection = {
    stripTools: new Set<string>(),
    enableWebSearch: false,
    requiresResponsesApi: false,
    openAIExecuteCode: false,
    openAIFileSearch: false,
    anthropicCodeExecution: false,
    anthropicWebFetch: false,
    anthropicAdvisor: false,
    anthropicAdvisorModel: undefined,
    googleCodeExecution: false,
  };

  const requestedTools = new Set(tools ?? []);

  if (isOpenAIProvider(provider)) {
    const useProviderNativeCodeInterpreter =
      codeInterpreterMode === PROVIDER_NATIVE_CODE_INTERPRETER ||
      (codeInterpreterMode == null && shouldUseProviderNativeCodeInterpreter(provider));
    const openAIModelCapabilities = getOpenAIModelCapabilities(model);
    const supportsOpenAINativeTools =
      openAIModelCapabilities.supportsOpenAIResponsesApi ||
      openAIModelCapabilities.requiresResponsesApi;
    selection.enableWebSearch =
      requestedTools.has(Tools.web_search) && openAIModelCapabilities.supportsWebSearch;
    selection.openAIExecuteCode =
      supportsOpenAINativeTools &&
      useProviderNativeCodeInterpreter &&
      requestedTools.has(Tools.execute_code);
    selection.openAIFileSearch = supportsOpenAINativeTools && requestedTools.has(Tools.file_search);
    selection.requiresResponsesApi =
      selection.enableWebSearch || selection.openAIExecuteCode || selection.openAIFileSearch;

    if (selection.enableWebSearch) {
      selection.stripTools.add(Tools.web_search);
    }
    if (selection.openAIExecuteCode) {
      selection.stripTools.add(Tools.execute_code);
    }
    if (selection.openAIFileSearch) {
      selection.stripTools.add(Tools.file_search);
    }

    return selection;
  }

  if (isAnthropicProvider(provider)) {
    const codeFiles = tool_resources?.execute_code?.files ?? [];
    const anthropicModelCapabilities = getAnthropicModelCapabilities(model);
    const anthropicCodeMode =
      typeof codeInterpreterMode === 'string'
        ? parseCodeInterpreterRouting(codeInterpreterMode)
        : LIBRECHAT_MANAGED_CODE_INTERPRETER;
    const explicitAnthropicCodeExecution =
      typeof anthropicToolOptions?.codeExecution === 'boolean'
        ? anthropicToolOptions.codeExecution
        : undefined;
    const wantsAnthropicCodeExecution =
      explicitAnthropicCodeExecution ??
      (anthropicCodeMode === PROVIDER_NATIVE_CODE_INTERPRETER &&
        requestedTools.has(Tools.execute_code));
    selection.enableWebSearch =
      requestedTools.has(Tools.web_search) && anthropicModelCapabilities.supportsWebSearch;
    selection.anthropicCodeExecution =
      wantsAnthropicCodeExecution === true &&
      anthropicModelCapabilities.supportsCodeExecution &&
      codeFiles.length === 0;
    selection.anthropicWebFetch =
      anthropicToolOptions?.webFetch === true && anthropicModelCapabilities.supportsWebFetch;
    selection.anthropicAdvisor =
      anthropicToolOptions?.advisor === true && anthropicModelCapabilities.supportsAdvisor;
    selection.anthropicAdvisorModel =
      typeof anthropicToolOptions?.advisorModel === 'string'
        ? anthropicToolOptions.advisorModel
        : undefined;

    if (selection.enableWebSearch) {
      selection.stripTools.add(Tools.web_search);
    }

    if (selection.anthropicCodeExecution) {
      selection.stripTools.add(Tools.execute_code);
    }

    return selection;
  }

  if (isXAIProvider(provider)) {
    selection.enableWebSearch = requestedTools.has(Tools.web_search);
    selection.requiresResponsesApi = selection.enableWebSearch;

    if (selection.enableWebSearch) {
      selection.stripTools.add(Tools.web_search);
    }

    return selection;
  }

  if (!isGoogleProvider(provider)) {
    return selection;
  }

  const codeFiles = tool_resources?.execute_code?.files ?? [];
  const enableGoogleWebSearch = requestedTools.has(Tools.web_search);
  const enableGoogleCodeExecution =
    (codeInterpreterMode === PROVIDER_NATIVE_CODE_INTERPRETER ||
      (codeInterpreterMode == null && shouldUseProviderNativeCodeInterpreter(provider))) &&
    requestedTools.has(Tools.execute_code) &&
    codeFiles.length === 0;

  const googleNativeToolSet = new Set<string>();
  if (enableGoogleWebSearch) {
    googleNativeToolSet.add(Tools.web_search);
  }
  if (enableGoogleCodeExecution) {
    googleNativeToolSet.add(Tools.execute_code);
  }

  const hasRemainingStructuredTools = (tools ?? []).some((tool) => !googleNativeToolSet.has(tool));
  if (hasRemainingStructuredTools) {
    return selection;
  }

  selection.enableWebSearch = enableGoogleWebSearch;
  selection.googleCodeExecution = enableGoogleCodeExecution;

  if (selection.enableWebSearch) {
    selection.stripTools.add(Tools.web_search);
  }

  if (selection.googleCodeExecution) {
    selection.stripTools.add(Tools.execute_code);
  }

  return selection;
};

export const mergeNativeProviderTools = (
  existingTools: unknown[] | undefined,
  nativeTools: unknown[],
): unknown[] => {
  if (!nativeTools.length) {
    return existingTools ?? [];
  }

  const mergedTools = [...(existingTools ?? [])];
  const seen = new Set(mergedTools.map((tool) => getToolKey(tool)));

  for (const tool of nativeTools) {
    const key = getToolKey(tool);
    if (seen.has(key)) {
      continue;
    }

    mergedTools.push(tool);
    seen.add(key);
  }

  return mergedTools;
};

const createOpenAIClient = (llmConfig: OpenAILLMConfig): OpenAI => {
  const apiKey = llmConfig.apiKey as string | undefined;
  if (!apiKey) {
    throw new Error('OpenAI API key is required for native OpenAI tools');
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
  };

  if (typeof llmConfig.baseURL === 'string' && llmConfig.baseURL) {
    clientOptions.baseURL = llmConfig.baseURL;
  }
  if (llmConfig.defaultHeaders && typeof llmConfig.defaultHeaders === 'object') {
    clientOptions.defaultHeaders = llmConfig.defaultHeaders as Record<string, string>;
  }
  if (llmConfig.defaultQuery && typeof llmConfig.defaultQuery === 'object') {
    clientOptions.defaultQuery = llmConfig.defaultQuery as Record<string, string>;
  }
  if (typeof llmConfig.maxRetries === 'number') {
    clientOptions.maxRetries = llmConfig.maxRetries;
  }
  if (typeof llmConfig.timeout === 'number') {
    clientOptions.timeout = llmConfig.timeout;
  }
  if (typeof llmConfig.organization === 'string' && llmConfig.organization) {
    clientOptions.organization = llmConfig.organization;
  }
  if (typeof llmConfig.project === 'string' && llmConfig.project) {
    clientOptions.project = llmConfig.project;
  }

  return new OpenAI(clientOptions);
};

const getOpenAIFileMetadata = (file: IMongoFile): OpenAIFileMetadata | undefined => {
  const metadata = file.metadata as
    | (IMongoFile['metadata'] & { openai?: OpenAIFileMetadata })
    | undefined;
  return metadata?.openai;
};

const mergeOpenAIMetadata = ({
  file,
  patch,
}: {
  file: IMongoFile;
  patch: Record<string, string | undefined>;
}) => {
  const openaiMetadata = getOpenAIFileMetadata(file);
  const metadata = {
    ...(file.metadata ?? {}),
    openai: {
      ...(openaiMetadata ?? {}),
      ...patch,
    },
  };

  file.metadata = metadata;
  return metadata;
};

const persistOpenAIMetadata = async ({
  file,
  patch,
  updateFile,
}: {
  file: IMongoFile;
  patch: Record<string, string | undefined>;
  updateFile?: (data: Partial<IMongoFile> & { file_id: string }) => Promise<IMongoFile | null>;
}) => {
  const metadata = mergeOpenAIMetadata({ file, patch });

  if (updateFile) {
    await updateFile({
      file_id: file.file_id,
      metadata,
    });
  }
};

const getOpenAIUploadable = async ({
  req,
  file,
  openai,
  getFileBuffer,
}: {
  req: ServerRequest;
  file: IMongoFile;
  openai: OpenAI;
  getFileBuffer?: (req: ServerRequest, file: IMongoFile) => Promise<Buffer>;
}) => {
  let buffer: Buffer;

  if (checkOpenAIStorage(file.source ?? '')) {
    const response = await openai.files.content(file.file_id);
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    if (!getFileBuffer) {
      throw new Error(`Unable to download file "${file.filename}" for native OpenAI tools`);
    }

    buffer = await getFileBuffer(req, file);
  }

  return toFile(buffer, file.filename, {
    type: file.type,
  });
};

const ensureOpenAIFileId = async ({
  req,
  file,
  openai,
  endpoint,
  model,
  getFileBuffer,
  updateFile,
}: {
  req: ServerRequest;
  file: IMongoFile;
  openai: OpenAI;
  endpoint: string;
  model?: string;
  getFileBuffer?: (req: ServerRequest, file: IMongoFile) => Promise<Buffer>;
  updateFile?: (data: Partial<IMongoFile> & { file_id: string }) => Promise<IMongoFile | null>;
}) => {
  const existingMetadata = getOpenAIFileMetadata(file);
  const existingFileId = existingMetadata?.fileId;
  if (existingFileId) {
    if (existingMetadata?.endpoint == null || existingMetadata?.model == null) {
      await persistOpenAIMetadata({
        file,
        patch: {
          endpoint,
          model,
          fileId: existingFileId,
        },
        updateFile,
      });
    }

    return existingFileId;
  }

  const uploadable = await getOpenAIUploadable({
    req,
    file,
    openai,
    getFileBuffer,
  });

  const uploadedFile = await openai.files.create({
    file: uploadable,
    purpose: 'assistants',
  });

  await persistOpenAIMetadata({
    file,
    patch: {
      endpoint,
      model,
      fileId: uploadedFile.id,
    },
    updateFile,
  });

  return uploadedFile.id;
};

const ensureOpenAIVectorStoreId = async ({
  req,
  file,
  openai,
  endpoint,
  model,
  getFileBuffer,
  updateFile,
}: {
  req: ServerRequest;
  file: IMongoFile;
  openai: OpenAI;
  endpoint: string;
  model?: string;
  getFileBuffer?: (req: ServerRequest, file: IMongoFile) => Promise<Buffer>;
  updateFile?: (data: Partial<IMongoFile> & { file_id: string }) => Promise<IMongoFile | null>;
}) => {
  const existingMetadata = getOpenAIFileMetadata(file);
  const existingVectorStoreId = existingMetadata?.vectorStoreId;
  if (existingVectorStoreId) {
    if (existingMetadata?.endpoint == null || existingMetadata?.model == null) {
      await persistOpenAIMetadata({
        file,
        patch: {
          endpoint,
          model,
          fileId: existingMetadata?.fileId,
          vectorStoreId: existingVectorStoreId,
        },
        updateFile,
      });
    }

    return existingVectorStoreId;
  }

  const openAIFileId = await ensureOpenAIFileId({
    req,
    file,
    openai,
    endpoint,
    model,
    getFileBuffer,
    updateFile,
  });

  const vectorStore = await openai.vectorStores.create({
    name: file.filename,
    expires_after: {
      anchor: 'last_active_at',
      days: 7,
    },
  });

  await openai.vectorStores.files.createAndPoll(vectorStore.id, {
    file_id: openAIFileId,
  });

  await persistOpenAIMetadata({
    file,
    patch: {
      endpoint,
      model,
      fileId: openAIFileId,
      vectorStoreId: vectorStore.id,
    },
    updateFile,
  });

  return vectorStore.id;
};

const toMongoFiles = (files?: TFile[]) =>
  (files ?? []).map((file) => file as unknown as IMongoFile);

export const buildNativeProviderTools = async ({
  req,
  provider,
  llmConfig,
  tool_resources,
  selection,
  getFileBuffer,
  updateFile,
}: BuildNativeProviderToolsParams): Promise<{
  tools: unknown[];
  nativeTools?: AgentNativeTools;
}> => {
  const providerLabel = getProviderLabel(provider);
  const nativeTools: AgentNativeTools = {};
  const tools: unknown[] = [];

  if (selection.enableWebSearch) {
    nativeTools.web_search = { provider: providerLabel };
  }

  if (isAnthropicProvider(provider)) {
    if (selection.enableWebSearch) {
      tools.push({
        type: selection.anthropicCodeExecution
          ? ANTHROPIC_WEB_SEARCH_DYNAMIC_TOOL
          : ANTHROPIC_WEB_SEARCH_TOOL,
        name: 'web_search',
      });
    }

    if (selection.anthropicWebFetch) {
      tools.push({
        type: selection.anthropicCodeExecution
          ? ANTHROPIC_WEB_FETCH_DYNAMIC_TOOL
          : ANTHROPIC_WEB_FETCH_TOOL,
        name: 'web_fetch',
        citations: {
          enabled: true,
        },
      });
    }

    if (selection.anthropicCodeExecution) {
      tools.push({
        type: ANTHROPIC_CODE_EXECUTION_TOOL,
        name: 'code_execution',
      });
      nativeTools.execute_code = {
        provider: providerLabel,
        file_ids: [],
      };
    }

    if (selection.anthropicAdvisor) {
      tools.push({
        type: ANTHROPIC_ADVISOR_TOOL,
        name: 'advisor',
        model: getAdvisorModel(selection.anthropicAdvisorModel),
      });
    }

    return {
      tools,
      nativeTools: Object.keys(nativeTools).length ? nativeTools : undefined,
    };
  }

  if (isGoogleProvider(provider)) {
    if (selection.googleCodeExecution) {
      tools.push({ codeExecution: {} });
      nativeTools.execute_code = {
        provider: providerLabel,
        file_ids: [],
      };
    }

    return {
      tools,
      nativeTools: Object.keys(nativeTools).length ? nativeTools : undefined,
    };
  }

  if (!isOpenAIProvider(provider)) {
    return { tools };
  }

  const endpoint = getOpenAIEndpoint(provider);
  const model = (llmConfig.model as string | undefined) ?? (req.body?.model as string | undefined);
  const openai =
    selection.openAIExecuteCode || selection.openAIFileSearch
      ? createOpenAIClient(llmConfig)
      : undefined;

  if (selection.openAIExecuteCode) {
    if (!openai) {
      throw new Error('OpenAI client is required for native code interpreter support');
    }

    const files = toMongoFiles(tool_resources?.execute_code?.files);
    const openAIFileIds = await Promise.all(
      files.map((file) =>
        ensureOpenAIFileId({
          req,
          file,
          openai,
          endpoint,
          model,
          getFileBuffer,
          updateFile,
        }),
      ),
    );

    tools.push({
      type: 'code_interpreter',
      container:
        openAIFileIds.length > 0
          ? {
              type: 'auto',
              file_ids: openAIFileIds,
            }
          : { type: 'auto' },
    });

    nativeTools.execute_code = {
      provider: providerLabel,
      file_ids: files.map((file) => file.file_id),
    };
  }

  if (selection.openAIFileSearch) {
    if (!openai) {
      throw new Error('OpenAI client is required for native file search support');
    }

    const files = toMongoFiles(tool_resources?.file_search?.files);
    const vectorStoreIds = await Promise.all(
      files.map((file) =>
        ensureOpenAIVectorStoreId({
          req,
          file,
          openai,
          endpoint,
          model,
          getFileBuffer,
          updateFile,
        }),
      ),
    );

    if (vectorStoreIds.length > 0) {
      tools.push({
        type: 'file_search',
        vector_store_ids: vectorStoreIds,
      });

      nativeTools.file_search = {
        provider: providerLabel,
        file_ids: files.map((file) => file.file_id),
        vector_store_ids: vectorStoreIds,
      };
    }
  }

  return {
    tools,
    nativeTools: Object.keys(nativeTools).length ? nativeTools : undefined,
  };
};
