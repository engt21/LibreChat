const { logger } = require('@librechat/data-schemas');
const {
  EnvVar,
  Calculator,
  createSearchTool,
  createCodeExecutionTool,
} = require('@librechat/agents');
const {
  checkAccess,
  toolkitParent,
  createSafeUser,
  mcpToolPattern,
  loadWebSearchAuth,
  buildImageToolContext,
  buildWebSearchContext,
} = require('@librechat/api');
const { getMCPServersRegistry } = require('~/config');
const {
  Tools,
  Constants,
  EModelEndpoint,
  WebSearchModes,
  Permissions,
  EToolResources,
  PermissionTypes,
  ImageGenProvider,
  imageGenDefaultModel,
} = require('librechat-data-provider');
const {
  availableTools,
  manifestToolMap,
  // Basic Tools
  GoogleSearchAPI,
  // Structured Tools
  DALLE3,
  FluxAPI,
  OpenWeather,
  StructuredSD,
  StructuredACS,
  TraversaalSearch,
  StructuredWolfram,
  TavilySearchResults,
  createGeminiImageTool,
  createOpenAIImageTools,
  ScientificCalculator,
  CodeInterpreterMath,
} = require('../');
const { primeFiles: primeCodeFiles } = require('~/server/services/Files/Code/process');
const { createFileSearchTool, primeFiles: primeSearchFiles } = require('./fileSearch');
const { getUserPluginAuthValue } = require('~/server/services/PluginService');
const { createMCPTool, createMCPTools } = require('~/server/services/MCP');
const { loadAuthValues } = require('~/server/services/Tools/credentials');
const {
  OLLAMA_WEB_FETCH_TOOL,
  createOllamaWebFetchTool,
  createOllamaWebSearchTool,
  getOllamaWebSearchMode,
} = require('~/server/services/Tools/ollama');
const { getMCPServerTools } = require('~/server/services/Config');
const { getRoleByName } = require('~/models/Role');
const { getUserKeyValues } = require('~/models');
const { getRequestedMCPToolKeys } = require('~/server/services/Tools/mcpToolFilter');

const imageGenDefaultModelOverrides = {
  [ImageGenProvider.azureOpenAI]: 'gpt-image-2',
};

/**
 * Validates the availability and authentication of tools for a user based on environment variables or user-specific plugin authentication values.
 * Tools without required authentication or with valid authentication are considered valid.
 *
 * @param {Object} user The user object for whom to validate tool access.
 * @param {Array<string>} tools An array of tool identifiers to validate. Defaults to an empty array.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of valid tool identifiers.
 */
const validateTools = async (user, tools = []) => {
  try {
    const validToolsSet = new Set(tools);
    const availableToolsToValidate = availableTools.filter((tool) =>
      validToolsSet.has(tool.pluginKey),
    );

    /**
     * Validates the credentials for a given auth field or set of alternate auth fields for a tool.
     * If valid admin or user authentication is found, the function returns early. Otherwise, it removes the tool from the set of valid tools.
     *
     * @param {string} authField The authentication field or fields (separated by "||" for alternates) to validate.
     * @param {string} toolName The identifier of the tool being validated.
     */
    const validateCredentials = async (authField, toolName) => {
      const fields = authField.split('||');
      for (const field of fields) {
        const adminAuth = process.env[field];
        if (adminAuth && adminAuth.length > 0) {
          return;
        }

        let userAuth = null;
        try {
          userAuth = await getUserPluginAuthValue(user, field);
        } catch (err) {
          if (field === fields[fields.length - 1] && !userAuth) {
            throw err;
          }
        }
        if (userAuth && userAuth.length > 0) {
          return;
        }
      }

      validToolsSet.delete(toolName);
    };

    for (const tool of availableToolsToValidate) {
      if (!tool.authConfig || tool.authConfig.length === 0) {
        continue;
      }

      for (const auth of tool.authConfig) {
        await validateCredentials(auth.authField, tool.pluginKey);
      }
    }

    return Array.from(validToolsSet.values());
  } catch (err) {
    logger.error('[validateTools] There was a problem validating tools', err);
    throw new Error(err);
  }
};

/** @typedef {typeof import('@langchain/core/tools').Tool} ToolConstructor */
/** @typedef {import('@langchain/core/tools').Tool} Tool */

/**
 * Resolves the preferred image-generation model for a given tool based on the
 * current user's saved preferences. Falls back to `undefined`, which makes each
 * tool honor its own env-var default.
 *
 * @param {object} params
 * @param {string} params.toolKey - Image tool key (e.g. `image_gen_oai`, `gemini_image_gen`, `flux`, `stable-diffusion`).
 * @param {string | undefined} params.endpoint - Current endpoint (used to pick OAI vs xAI vs Azure).
 * @param {IUser | undefined} params.user - The current user, when available.
 * @returns {string | undefined}
 */
function resolveImageModelOverride({ toolKey, endpoint, user }) {
  const prefs = user?.imageGenerationPrefs;
  if (!prefs?.models) {
    return undefined;
  }
  /** @param {ImageGenProvider} provider */
  const pickFor = (provider) =>
    prefs.models?.[provider] ||
    imageGenDefaultModelOverrides[provider] ||
    imageGenDefaultModel[provider];

  if (toolKey === 'flux') {
    return pickFor(ImageGenProvider.flux);
  }
  if (toolKey === 'stable-diffusion') {
    return pickFor(ImageGenProvider.stability);
  }
  if (toolKey === 'gemini_image_gen') {
    return pickFor(ImageGenProvider.google) || pickFor(ImageGenProvider.vertex);
  }
  if (toolKey === 'image_gen_oai') {
    const normalizedEndpoint = (endpoint ?? '').toString().toLowerCase();
    if (normalizedEndpoint.includes('xai')) {
      return pickFor(ImageGenProvider.xai);
    }
    if (normalizedEndpoint.includes('azure')) {
      return pickFor(ImageGenProvider.azureOpenAI);
    }
    return pickFor(ImageGenProvider.openai);
  }
  return undefined;
}

async function loadOpenAIImageAuthValues({ userId }) {
  const authValues = await loadAuthValues({
    userId,
    authFields: getAuthFields('image_gen_oai'),
    throwError: false,
  });
  if (authValues.IMAGE_GEN_OAI_API_KEY || authValues.OPENAI_API_KEY) {
    return authValues;
  }
  try {
    const openAIValues = await getUserKeyValues({ userId, name: EModelEndpoint.openAI });
    if (openAIValues?.apiKey) {
      authValues.OPENAI_API_KEY = openAIValues.apiKey;
    }
  } catch {
    // Optional fallback; the tool constructor will raise a clear error if no key exists.
  }
  return authValues;
}

/**
 * Initializes a tool with authentication values for the given user, supporting alternate authentication fields.
 * Authentication fields can have alternates separated by "||", and the first defined variable will be used.
 *
 * @param {string} userId The user ID for which the tool is being loaded.
 * @param {Array<string>} authFields Array of strings representing the authentication fields. Supports alternate fields delimited by "||".
 * @param {ToolConstructor} ToolConstructor The constructor function for the tool to be initialized.
 * @param {Object} options Optional parameters to be passed to the tool constructor alongside authentication values.
 * @returns {() => Promise<Tool>} An Async function that, when called, asynchronously initializes and returns an instance of the tool with authentication.
 */
const loadToolWithAuth = (userId, authFields, ToolConstructor, options = {}) => {
  return async function () {
    const authValues = await loadAuthValues({ userId, authFields });
    return new ToolConstructor({ ...options, ...authValues, userId });
  };
};

/**
 * @param {string} toolKey
 * @returns {Array<string>}
 */
const getAuthFields = (toolKey) => {
  return manifestToolMap[toolKey]?.authConfig.map((auth) => auth.authField) ?? [];
};

/**
 *
 * @param {object} params
 * @param {string} params.user
 * @param {Record<string, Record<string, string>>} [object.userMCPAuthMap]
 * @param {AbortSignal} [object.signal]
 * @param {Pick<Agent, 'id' | 'provider' | 'model'>} [params.agent]
 * @param {string} [params.model]
 * @param {EModelEndpoint} [params.endpoint]
 * @param {LoadToolOptions} [params.options]
 * @param {boolean} [params.useSpecs]
 * @param {Array<string>} params.tools
 * @param {boolean} [params.functions]
 * @param {boolean} [params.returnMap]
 * @param {AppConfig['webSearch']} [params.webSearch]
 * @param {AppConfig['fileStrategy']} [params.fileStrategy]
 * @param {AppConfig['imageOutputType']} [params.imageOutputType]
 * @returns {Promise<{ loadedTools: Tool[], toolContextMap: Object<string, any> } | Record<string,Tool>>}
 */
const loadTools = async ({
  user,
  agent,
  model,
  signal,
  endpoint,
  userMCPAuthMap,
  tools = [],
  options = {},
  functions = true,
  returnMap = false,
  webSearch,
  fileStrategy,
  imageOutputType,
}) => {
  const toolConstructors = {
    flux: FluxAPI,
    calculator: Calculator,
    scientific_calculator: ScientificCalculator,
    code_interpreter_math: CodeInterpreterMath,
    google: GoogleSearchAPI,
    open_weather: OpenWeather,
    wolfram: StructuredWolfram,
    'stable-diffusion': StructuredSD,
    'azure-ai-search': StructuredACS,
    traversaal_search: TraversaalSearch,
    tavily_search_results_json: TavilySearchResults,
  };

  const customConstructors = {
    image_gen_oai: async (toolContextMap) => {
      const authValues = await loadOpenAIImageAuthValues({ userId: user });
      const imageFiles = options.tool_resources?.[EToolResources.image_edit]?.files ?? [];
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: `${EToolResources.image_edit}_oai`,
        contextDescription: 'image editing',
      });
      if (toolContext) {
        toolContextMap.image_edit_oai = toolContext;
      }
      const modelOverride = resolveImageModelOverride({
        toolKey: 'image_gen_oai',
        endpoint: agent?.provider ?? endpoint,
        user: options.req?.user,
      });
      return createOpenAIImageTools({
        ...authValues,
        isAgent: !!agent,
        req: options.req,
        res: options.res,
        streamId: options.streamId ?? options.req?._resumableStreamId ?? null,
        imageOutputType,
        fileStrategy,
        imageFiles,
        model: modelOverride,
      });
    },
    gemini_image_gen: async (toolContextMap) => {
      const authFields = getAuthFields('gemini_image_gen');
      const authValues = await loadAuthValues({ userId: user, authFields, throwError: false });
      const imageFiles = options.tool_resources?.[EToolResources.image_edit]?.files ?? [];
      const toolContext = buildImageToolContext({
        imageFiles,
        toolName: 'gemini_image_gen',
        contextDescription: 'image context',
      });
      if (toolContext) {
        toolContextMap.gemini_image_gen = toolContext;
      }
      const modelOverride = resolveImageModelOverride({
        toolKey: 'gemini_image_gen',
        endpoint: agent?.provider ?? endpoint,
        user: options.req?.user,
      });
      return createGeminiImageTool({
        ...authValues,
        isAgent: !!agent,
        req: options.req,
        imageFiles,
        userId: user,
        fileStrategy,
        model: modelOverride,
      });
    },
  };

  const requestedTools = {};
  const ollamaWebSearchMode = getOllamaWebSearchMode({
    endpoint: agent?.provider ?? endpoint,
    ephemeralAgent: options.req?.body?.ephemeralAgent,
    requestBody: options.req?.body,
    agentTools: agent?.tools,
    model: agent?.model ?? options.req?.body?.model,
    enabled:
      tools.includes(Tools.web_search) ||
      tools.includes(OLLAMA_WEB_FETCH_TOOL) ||
      options.req?.body?.web_search === true,
  });

  if (functions === true) {
    toolConstructors.dalle = DALLE3;
  }

  /** @type {ImageGenOptions} */
  const imageGenOptions = {
    isAgent: !!agent,
    req: options.req,
    fileStrategy,
    processFileURL: options.processFileURL,
    returnMetadata: options.returnMetadata,
    uploadImageBuffer: options.uploadImageBuffer,
  };

  const fluxModelOverride = resolveImageModelOverride({
    toolKey: 'flux',
    endpoint: agent?.provider ?? endpoint,
    user: options.req?.user,
  });
  const stableDiffusionModelOverride = resolveImageModelOverride({
    toolKey: 'stable-diffusion',
    endpoint: agent?.provider ?? endpoint,
    user: options.req?.user,
  });

  const toolOptions = {
    flux: { ...imageGenOptions, model: fluxModelOverride },
    dalle: imageGenOptions,
    'stable-diffusion': { ...imageGenOptions, model: stableDiffusionModelOverride },
    gemini_image_gen: imageGenOptions,
  };

  /** @type {Record<string, string>} */
  const toolContextMap = {};
  const requestedMCPTools = {};

  for (const tool of tools) {
    if (tool === Tools.execute_code) {
      requestedTools[tool] = async () => {
        const authValues = await loadAuthValues({
          userId: user,
          authFields: [EnvVar.CODE_API_KEY],
        });
        const codeApiKey = authValues[EnvVar.CODE_API_KEY];
        const { files, toolContext } = await primeCodeFiles(
          {
            ...options,
            agentId: agent?.id,
          },
          codeApiKey,
        );
        if (toolContext) {
          toolContextMap[tool] = toolContext;
        }
        const CodeExecutionTool = createCodeExecutionTool({
          user_id: user,
          files,
          ...authValues,
        });
        CodeExecutionTool.apiKey = codeApiKey;
        return CodeExecutionTool;
      };
      continue;
    } else if (tool === Tools.file_search) {
      requestedTools[tool] = async () => {
        const { files, toolContext } = await primeSearchFiles({
          ...options,
          agentId: agent?.id,
        });
        if (toolContext) {
          toolContextMap[tool] = toolContext;
        }

        /** @type {boolean | undefined} Check if user has FILE_CITATIONS permission */
        let fileCitations;
        if (fileCitations == null && options.req?.user != null) {
          try {
            fileCitations = await checkAccess({
              user: options.req.user,
              permissionType: PermissionTypes.FILE_CITATIONS,
              permissions: [Permissions.USE],
              getRoleByName,
            });
          } catch (error) {
            logger.error('[handleTools] FILE_CITATIONS permission check failed:', error);
            fileCitations = false;
          }
        }

        return createFileSearchTool({
          userId: user,
          files,
          entity_id: agent?.id,
          fileCitations,
          req: options.req,
        });
      };
      continue;
    } else if (tool === Tools.web_search) {
      if (ollamaWebSearchMode === WebSearchModes.ollama_native) {
        const { onSearchResults, onWebSearchStatus } = options?.[Tools.web_search] ?? {};
        requestedTools[tool] = async () => {
          toolContextMap[tool] = buildWebSearchContext();
          return createOllamaWebSearchTool({ onSearchResults, onWebSearchStatus });
        };
        continue;
      }

      const result = await loadWebSearchAuth({
        userId: user,
        loadAuthValues,
        webSearchConfig: webSearch,
      });
      const { onSearchResults, onGetHighlights } = options?.[Tools.web_search] ?? {};
      requestedTools[tool] = async () => {
        toolContextMap[tool] = buildWebSearchContext();
        return createSearchTool({
          ...result.authResult,
          onSearchResults,
          onGetHighlights,
          logger,
        });
      };
      continue;
    } else if (tool === OLLAMA_WEB_FETCH_TOOL) {
      if (ollamaWebSearchMode !== WebSearchModes.ollama_native) {
        continue;
      }

      requestedTools[tool] = async () => createOllamaWebFetchTool();
      continue;
    } else if (tool && mcpToolPattern.test(tool)) {
      const [toolName, serverName] = tool.split(Constants.mcp_delimiter);
      if (toolName === Constants.mcp_server) {
        /** Placeholder used for UI purposes */
        continue;
      }
      const serverConfig = serverName
        ? await getMCPServersRegistry().getServerConfig(serverName, user)
        : null;
      if (!serverConfig) {
        logger.warn(
          `MCP server "${serverName}" for "${toolName}" tool is not configured${agent?.id != null && agent.id ? ` but attached to "${agent.id}"` : ''}`,
        );
        continue;
      }
      if (toolName === Constants.mcp_all) {
        const requestedToolKeys = getRequestedMCPToolKeys(
          serverName,
          options.req?.body?.ephemeralAgent?.mcpToolFilter,
        );
        if (requestedToolKeys != null) {
          if (requestedToolKeys.length === 0) {
            continue;
          }
          requestedMCPTools[serverName] = requestedToolKeys.map((toolKey) => ({
            type: 'single',
            toolKey,
            serverName,
            config: serverConfig,
          }));
        } else {
          requestedMCPTools[serverName] = [
            {
              type: 'all',
              serverName,
              config: serverConfig,
            },
          ];
        }
        continue;
      }

      requestedMCPTools[serverName] = requestedMCPTools[serverName] || [];
      requestedMCPTools[serverName].push({
        type: 'single',
        toolKey: tool,
        serverName,
        config: serverConfig,
      });
      continue;
    }

    const toolKey = customConstructors[tool] ? tool : toolkitParent[tool];
    if (toolKey && customConstructors[toolKey]) {
      if (!requestedTools[toolKey]) {
        let cached;
        requestedTools[toolKey] = async () => {
          cached ??= customConstructors[toolKey](toolContextMap);
          return cached;
        };
      }
      requestedTools[tool] = requestedTools[toolKey];
      continue;
    }

    if (toolConstructors[tool]) {
      const options = toolOptions[tool] || {};
      const toolInstance = loadToolWithAuth(
        user,
        getAuthFields(tool),
        toolConstructors[tool],
        options,
      );
      requestedTools[tool] = toolInstance;
      continue;
    }
  }

  if (returnMap) {
    return requestedTools;
  }

  const toolPromises = [];
  for (const tool of tools) {
    const validTool = requestedTools[tool];
    if (validTool) {
      toolPromises.push(
        validTool().catch((error) => {
          logger.error(`Error loading tool ${tool}:`, error);
          return null;
        }),
      );
    }
  }

  const loadedTools = (await Promise.all(toolPromises)).flatMap((plugin) => plugin || []);
  const mcpToolPromises = [];
  /** MCP server tools are initialized sequentially by server */
  let index = -1;
  const failedMCPServers = new Set();
  const safeUser = createSafeUser(options.req?.user);
  for (const [serverName, toolConfigs] of Object.entries(requestedMCPTools)) {
    index++;
    /** @type {LCAvailableTools} */
    let availableTools;
    for (const config of toolConfigs) {
      try {
        if (failedMCPServers.has(serverName)) {
          continue;
        }
        const mcpParams = {
          index,
          signal,
          user: safeUser,
          userMCPAuthMap,
          res: options.res,
          streamId: options.req?._resumableStreamId || null,
          model: agent?.model ?? model,
          serverName: config.serverName,
          provider: agent?.provider ?? endpoint,
          config: config.config,
        };

        if (config.type === 'all' && toolConfigs.length === 1) {
          /** Handle async loading for single 'all' tool config */
          mcpToolPromises.push(
            createMCPTools(mcpParams).catch((error) => {
              logger.error(`Error loading ${serverName} tools:`, error);
              return null;
            }),
          );
          continue;
        }
        if (!availableTools) {
          if (config.config?.toolFunctions && Object.keys(config.config.toolFunctions).length > 0) {
            availableTools = config.config.toolFunctions;
          }
        }
        if (!availableTools) {
          try {
            availableTools = await getMCPServerTools(safeUser.id, serverName);
          } catch (error) {
            logger.error(`Error fetching available tools for MCP server ${serverName}:`, error);
          }
        }

        /** Handle synchronous loading */
        const mcpTool =
          config.type === 'all'
            ? await createMCPTools(mcpParams)
            : await createMCPTool({
                ...mcpParams,
                availableTools,
                toolKey: config.toolKey,
              });

        if (Array.isArray(mcpTool)) {
          loadedTools.push(...mcpTool);
        } else if (mcpTool) {
          loadedTools.push(mcpTool);
        } else {
          failedMCPServers.add(serverName);
          logger.warn(
            `MCP tool creation failed for "${config.toolKey}", server may be unavailable or unauthenticated.`,
          );
        }
      } catch (error) {
        logger.error(`Error loading MCP tool for server ${serverName}:`, error);
      }
    }
  }
  loadedTools.push(...(await Promise.all(mcpToolPromises)).flatMap((plugin) => plugin || []));
  return { loadedTools, toolContextMap };
};

module.exports = {
  loadToolWithAuth,
  validateTools,
  loadTools,
};
