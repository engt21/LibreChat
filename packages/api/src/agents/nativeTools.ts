import OpenAI, { toFile } from 'openai';
import { Providers } from '@librechat/agents';
import {
  Tools,
  checkOpenAIStorage,
  EModelEndpoint,
  isEphemeralAgentId,
} from 'librechat-data-provider';
import type { AgentToolResources, TFile } from 'librechat-data-provider';
import type { IMongoFile } from '@librechat/data-schemas';
import type { ServerRequest } from '~/types';

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

const getProviderLabel = (provider: string) => {
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

export const selectNativeTools = ({
  agentId,
  provider,
  tools,
  tool_resources,
}: {
  agentId: string;
  provider: string;
  tools?: string[];
  tool_resources?: AgentToolResources;
}): NativeToolSelection => {
  const selection: NativeToolSelection = {
    stripTools: new Set<string>(),
    enableWebSearch: false,
    requiresResponsesApi: false,
    openAIExecuteCode: false,
    openAIFileSearch: false,
    googleCodeExecution: false,
  };

  if (!isEphemeralAgentId(agentId)) {
    return selection;
  }

  const requestedTools = new Set(tools ?? []);

  if (isOpenAIProvider(provider)) {
    selection.enableWebSearch = requestedTools.has(Tools.web_search);
    selection.openAIExecuteCode = requestedTools.has(Tools.execute_code);
    selection.openAIFileSearch = requestedTools.has(Tools.file_search);
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

  if (!isGoogleProvider(provider)) {
    return selection;
  }

  const codeFiles = tool_resources?.execute_code?.files ?? [];
  const enableGoogleWebSearch = requestedTools.has(Tools.web_search);
  const enableGoogleCodeExecution =
    requestedTools.has(Tools.execute_code) && codeFiles.length === 0;

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
