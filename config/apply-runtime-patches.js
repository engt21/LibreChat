#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const agentsDir = path.join(rootDir, 'node_modules', '@librechat', 'agents');
const langchainOpenAIDir = path.join(rootDir, 'node_modules', '@langchain', 'openai');
const langfuseLangchainDir = path.join(rootDir, 'node_modules', '@langfuse', 'langchain');
const librechatApiDir = path.join(rootDir, 'packages', 'api');
const guardedStreamTargets = new Set([
  'src/stream.ts',
  'dist/esm/stream.mjs',
  'dist/cjs/stream.cjs',
]);

const patchTargets = [
  {
    relativePath: 'src/llm/openai/utils/index.ts',
    replacements: [
      {
        from: `  } else if (
    chunk.type === 'response.output_item.added' &&
    'item' in chunk &&
    chunk.item.type === 'reasoning'
  ) {
    const summary: ChatOpenAIReasoningSummary['summary'] | undefined = chunk
      .item.summary
      ? chunk.item.summary.map((s, index) => ({
        ...s,
        index,
      }))
      : undefined;

    additional_kwargs.reasoning = {
      // We only capture ID in the first chunk or else the concatenated result of all chunks will
      // have an ID field that is repeated once per chunk. There is special handling for the \`type\`
      // field that prevents this, however.
      id: chunk.item.id,
      type: chunk.item.type,
      ...(summary ? { summary } : {}),
    };
  } else if (chunk.type === 'response.reasoning_summary_part.added') {
    additional_kwargs.reasoning = {
      type: 'reasoning',
      summary: [{ ...chunk.part, index: chunk.summary_index }],
    };
  } else if (chunk.type === 'response.reasoning_summary_text.delta') {
    additional_kwargs.reasoning = {
      type: 'reasoning',
      summary: [
        { text: chunk.delta, type: 'summary_text', index: chunk.summary_index },
      ],
    };`,
        to: `  } else if (
    chunk.type === 'response.output_item.added' &&
    'item' in chunk &&
    chunk.item.type === 'reasoning'
  ) {
    additional_kwargs.reasoning = {
      // We only capture ID in the first chunk or else the concatenated result of all chunks will
      // have an ID field that is repeated once per chunk. There is special handling for the \`type\`
      // field that prevents this, however.
      id: chunk.item.id,
      type: chunk.item.type,
    };
  } else if (chunk.type === 'response.reasoning_summary_part.done') {
    additional_kwargs.reasoning = {
      type: 'reasoning',
      summary: [{ ...chunk.part, index: chunk.summary_index }],
    };`,
      },
    ],
  },
  {
    relativePath: 'dist/esm/llm/openai/utils/index.mjs',
    replacements: [
      {
        from: `    else if (chunk.type === 'response.output_item.added' &&
        'item' in chunk &&
        chunk.item.type === 'reasoning') {
        const summary = chunk
            .item.summary
            ? chunk.item.summary.map((s, index) => ({
                ...s,
                index,
            }))
            : undefined;
        additional_kwargs.reasoning = {
            // We only capture ID in the first chunk or else the concatenated result of all chunks will
            // have an ID field that is repeated once per chunk. There is special handling for the \`type\`
            // field that prevents this, however.
            id: chunk.item.id,
            type: chunk.item.type,
            ...(summary ? { summary } : {}),
        };
    }
    else if (chunk.type === 'response.reasoning_summary_part.added') {
        additional_kwargs.reasoning = {
            type: 'reasoning',
            summary: [{ ...chunk.part, index: chunk.summary_index }],
        };
    }
    else if (chunk.type === 'response.reasoning_summary_text.delta') {
        additional_kwargs.reasoning = {
            type: 'reasoning',
            summary: [
                { text: chunk.delta, type: 'summary_text', index: chunk.summary_index },
            ],
        };`,
        to: `    else if (chunk.type === 'response.output_item.added' &&
        'item' in chunk &&
        chunk.item.type === 'reasoning') {
        additional_kwargs.reasoning = {
            // We only capture ID in the first chunk or else the concatenated result of all chunks will
            // have an ID field that is repeated once per chunk. There is special handling for the \`type\`
            // field that prevents this, however.
            id: chunk.item.id,
            type: chunk.item.type,
        };
    }
    else if (chunk.type === 'response.reasoning_summary_part.done') {
        additional_kwargs.reasoning = {
            type: 'reasoning',
            summary: [{ ...chunk.part, index: chunk.summary_index }],
        };`,
      },
    ],
  },
  {
    relativePath: 'dist/cjs/llm/openai/utils/index.cjs',
    replacements: [
      {
        from: `    else if (chunk.type === 'response.output_item.added' &&
        'item' in chunk &&
        chunk.item.type === 'reasoning') {
        const summary = chunk
            .item.summary
            ? chunk.item.summary.map((s, index) => ({
                ...s,
                index,
            }))
            : undefined;
        additional_kwargs.reasoning = {
            // We only capture ID in the first chunk or else the concatenated result of all chunks will
            // have an ID field that is repeated once per chunk. There is special handling for the \`type\`
            // field that prevents this, however.
            id: chunk.item.id,
            type: chunk.item.type,
            ...(summary ? { summary } : {}),
        };
    }
    else if (chunk.type === 'response.reasoning_summary_part.added') {
        additional_kwargs.reasoning = {
            type: 'reasoning',
            summary: [{ ...chunk.part, index: chunk.summary_index }],
        };
    }
    else if (chunk.type === 'response.reasoning_summary_text.delta') {
        additional_kwargs.reasoning = {
            type: 'reasoning',
            summary: [
                { text: chunk.delta, type: 'summary_text', index: chunk.summary_index },
            ],
        };`,
        to: `    else if (chunk.type === 'response.output_item.added' &&
        'item' in chunk &&
        chunk.item.type === 'reasoning') {
        additional_kwargs.reasoning = {
            // We only capture ID in the first chunk or else the concatenated result of all chunks will
            // have an ID field that is repeated once per chunk. There is special handling for the \`type\`
            // field that prevents this, however.
            id: chunk.item.id,
            type: chunk.item.type,
        };
    }
    else if (chunk.type === 'response.reasoning_summary_part.done') {
        additional_kwargs.reasoning = {
            type: 'reasoning',
            summary: [{ ...chunk.part, index: chunk.summary_index }],
        };`,
      },
    ],
  },
  {
    relativePath: 'src/llm/openai/index.ts',
    replacements: [
      {
        from: `  static lc_name(): string {
    return 'LibreChatOpenAI';
  }
  protected _getClientOptions(
    options?: OpenAICoreRequestOptions
  ): OpenAICoreRequestOptions {`,
        to: `  static lc_name(): string {
    return 'LibreChatOpenAI';
  }

  protected getLangfuseAzureModelName(): string | undefined {
    const baseURL = this.clientConfig.baseURL?.trim();
    if (!baseURL) {
      return undefined;
    }

    let isAzureEndpoint = false;

    try {
      const url = new URL(baseURL);
      const pathname = url.pathname.replace(/\\/+$/, '');
      const isAzureHost =
        /(?:^|\\.)openai\\.azure\\.com$/i.test(url.hostname) ||
        /(?:^|\\.)cognitiveservices\\.azure\\.com$/i.test(url.hostname);
      const isAzureGatewayPath = /\\/azure-openai(?:$|\\/)/i.test(pathname);
      const isAzureResourcePath =
        /^\\/openai\\/v1$/i.test(pathname) ||
        /^\\/api\\/projects\\/[^/]+\\/openai\\/v1$/i.test(pathname);

      isAzureEndpoint = isAzureGatewayPath || (isAzureHost && isAzureResourcePath);
    } catch {
      isAzureEndpoint = /\\/azure-openai(?:$|\\/)/i.test(baseURL);
    }

    if (!isAzureEndpoint) {
      return undefined;
    }

    const normalizedModel = this.model?.trim();
    if (!normalizedModel) {
      return 'azure-openai/unknown';
    }

    return /^azure-openai\\//i.test(normalizedModel)
      ? normalizedModel
      : \`azure-openai/\${normalizedModel}\`;
  }

  override getLsParams(options?: this['ParsedCallOptions']) {
    const azureModelName = this.getLangfuseAzureModelName();
    if (azureModelName == null) {
      return super.getLsParams(options ?? ({} as this['ParsedCallOptions']));
    }

    const params = this.invocationParams(options);

    return {
      ls_provider: 'azure',
      ls_model_name: azureModelName,
      ls_model_type: 'chat',
      ls_temperature: params.temperature ?? undefined,
      ls_max_tokens: params.max_tokens ?? undefined,
      ls_stop: options?.stop,
    };
  }

  override invocationParams(options?: this['ParsedCallOptions'], extra?: Record<string, unknown>) {
    const params = super.invocationParams(options, extra);
    const azureModelName = this.getLangfuseAzureModelName();
    if (azureModelName != null && params && typeof params === 'object' && 'model' in params) {
      params.model = azureModelName;
    }
    return params;
  }

  protected _getClientOptions(
    options?: OpenAICoreRequestOptions
  ): OpenAICoreRequestOptions {`,
      },
      {
        from: `  static lc_name(): 'LibreChatAzureOpenAI' {
    return 'LibreChatAzureOpenAI';
  }
  /**
   * Returns backwards compatible reasoning parameters from constructor params and call options`,
        to: `  static lc_name(): 'LibreChatAzureOpenAI' {
    return 'LibreChatAzureOpenAI';
  }

  protected getLangfuseModelName(): string {
    const normalizedModel = (this.azureOpenAIApiDeploymentName ?? this.model)?.trim();
    if (!normalizedModel) {
      return 'azure-openai/unknown';
    }

    return /^azure-openai\\//i.test(normalizedModel)
      ? normalizedModel
      : \`azure-openai/\${normalizedModel}\`;
  }

  override getLsParams(options?: this['ParsedCallOptions']) {
    const params = this.invocationParams(options);

    return {
      ls_provider: 'azure',
      ls_model_name: this.getLangfuseModelName(),
      ls_model_type: 'chat',
      ls_temperature: params.temperature ?? undefined,
      ls_max_tokens: params.max_tokens ?? undefined,
      ls_stop: options?.stop,
    };
  }

  override invocationParams(options?: this['ParsedCallOptions'], extra?: Record<string, unknown>) {
    const params = super.invocationParams(options, extra);
    if (params && typeof params === 'object' && 'model' in params) {
      params.model = this.getLangfuseModelName();
    }
    return params;
  }
  /**
   * Returns backwards compatible reasoning parameters from constructor params and call options`,
      },
    ],
  },
  {
    relativePath: 'dist/esm/llm/openai/index.mjs',
    replacements: [
      {
        from: `    static lc_name() {
        return 'LibreChatOpenAI';
    }
    _getClientOptions(options) {`,
        to: `    static lc_name() {
        return 'LibreChatOpenAI';
    }
    getLangfuseAzureModelName() {
        const baseURL = this.clientConfig.baseURL?.trim();
        if (!baseURL) {
            return undefined;
        }
        let isAzureEndpoint = false;
        try {
            const url = new URL(baseURL);
            const pathname = url.pathname.replace(/\\/+$/, '');
            const isAzureHost = /(?:^|\\.)openai\\.azure\\.com$/i.test(url.hostname) ||
                /(?:^|\\.)cognitiveservices\\.azure\\.com$/i.test(url.hostname);
            const isAzureGatewayPath = /\\/azure-openai(?:$|\\/)/i.test(pathname);
            const isAzureResourcePath = /^\\/openai\\/v1$/i.test(pathname) ||
                /^\\/api\\/projects\\/[^/]+\\/openai\\/v1$/i.test(pathname);
            isAzureEndpoint = isAzureGatewayPath || (isAzureHost && isAzureResourcePath);
        }
        catch {
            isAzureEndpoint = /\\/azure-openai(?:$|\\/)/i.test(baseURL);
        }
        if (!isAzureEndpoint) {
            return undefined;
        }
        const normalizedModel = this.model?.trim();
        if (!normalizedModel) {
            return 'azure-openai/unknown';
        }
        return /^azure-openai\\//i.test(normalizedModel)
            ? normalizedModel
            : \`azure-openai/\${normalizedModel}\`;
    }
    getLsParams(options) {
        const azureModelName = this.getLangfuseAzureModelName();
        if (azureModelName == null) {
            return super.getLsParams(options ?? {});
        }
        const params = this.invocationParams(options);
        return {
            ls_provider: 'azure',
            ls_model_name: azureModelName,
            ls_model_type: 'chat',
            ls_temperature: params.temperature ?? undefined,
            ls_max_tokens: params.max_tokens ?? undefined,
            ls_stop: options?.stop,
        };
    }
    invocationParams(options, extra) {
        const params = super.invocationParams(options, extra);
        const azureModelName = this.getLangfuseAzureModelName();
        if (azureModelName != null && params && typeof params === 'object' && 'model' in params) {
            params.model = azureModelName;
        }
        return params;
    }
    _getClientOptions(options) {`,
      },
      {
        from: `    static lc_name() {
        return 'LibreChatAzureOpenAI';
    }
    /**
     * Returns backwards compatible reasoning parameters from constructor params and call options`,
        to: `    static lc_name() {
        return 'LibreChatAzureOpenAI';
    }
    getLangfuseModelName() {
        const normalizedModel = (this.azureOpenAIApiDeploymentName ?? this.model)?.trim();
        if (!normalizedModel) {
            return 'azure-openai/unknown';
        }
        return /^azure-openai\\//i.test(normalizedModel)
            ? normalizedModel
            : \`azure-openai/\${normalizedModel}\`;
    }
    getLsParams(options) {
        const params = this.invocationParams(options);
        return {
            ls_provider: 'azure',
            ls_model_name: this.getLangfuseModelName(),
            ls_model_type: 'chat',
            ls_temperature: params.temperature ?? undefined,
            ls_max_tokens: params.max_tokens ?? undefined,
            ls_stop: options?.stop,
        };
    }
    invocationParams(options, extra) {
        const params = super.invocationParams(options, extra);
        if (params && typeof params === 'object' && 'model' in params) {
            params.model = this.getLangfuseModelName();
        }
        return params;
    }
    /**
     * Returns backwards compatible reasoning parameters from constructor params and call options`,
      },
    ],
  },
  {
    relativePath: 'dist/cjs/llm/openai/index.cjs',
    replacements: [
      {
        from: `    static lc_name() {
        return 'LibreChatOpenAI';
    }
    _getClientOptions(options) {`,
        to: `    static lc_name() {
        return 'LibreChatOpenAI';
    }
    getLangfuseAzureModelName() {
        const baseURL = this.clientConfig.baseURL?.trim();
        if (!baseURL) {
            return undefined;
        }
        let isAzureEndpoint = false;
        try {
            const url = new URL(baseURL);
            const pathname = url.pathname.replace(/\\/+$/, '');
            const isAzureHost = /(?:^|\\.)openai\\.azure\\.com$/i.test(url.hostname) ||
                /(?:^|\\.)cognitiveservices\\.azure\\.com$/i.test(url.hostname);
            const isAzureGatewayPath = /\\/azure-openai(?:$|\\/)/i.test(pathname);
            const isAzureResourcePath = /^\\/openai\\/v1$/i.test(pathname) ||
                /^\\/api\\/projects\\/[^/]+\\/openai\\/v1$/i.test(pathname);
            isAzureEndpoint = isAzureGatewayPath || (isAzureHost && isAzureResourcePath);
        }
        catch {
            isAzureEndpoint = /\\/azure-openai(?:$|\\/)/i.test(baseURL);
        }
        if (!isAzureEndpoint) {
            return undefined;
        }
        const normalizedModel = this.model?.trim();
        if (!normalizedModel) {
            return 'azure-openai/unknown';
        }
        return /^azure-openai\\//i.test(normalizedModel)
            ? normalizedModel
            : \`azure-openai/\${normalizedModel}\`;
    }
    getLsParams(options) {
        const azureModelName = this.getLangfuseAzureModelName();
        if (azureModelName == null) {
            return super.getLsParams(options ?? {});
        }
        const params = this.invocationParams(options);
        return {
            ls_provider: 'azure',
            ls_model_name: azureModelName,
            ls_model_type: 'chat',
            ls_temperature: params.temperature ?? undefined,
            ls_max_tokens: params.max_tokens ?? undefined,
            ls_stop: options?.stop,
        };
    }
    invocationParams(options, extra) {
        const params = super.invocationParams(options, extra);
        const azureModelName = this.getLangfuseAzureModelName();
        if (azureModelName != null && params && typeof params === 'object' && 'model' in params) {
            params.model = azureModelName;
        }
        return params;
    }
    _getClientOptions(options) {`,
      },
      {
        from: `    static lc_name() {
        return 'LibreChatAzureOpenAI';
    }
    /**
     * Returns backwards compatible reasoning parameters from constructor params and call options`,
        to: `    static lc_name() {
        return 'LibreChatAzureOpenAI';
    }
    getLangfuseModelName() {
        const normalizedModel = (this.azureOpenAIApiDeploymentName ?? this.model)?.trim();
        if (!normalizedModel) {
            return 'azure-openai/unknown';
        }
        return /^azure-openai\\//i.test(normalizedModel)
            ? normalizedModel
            : \`azure-openai/\${normalizedModel}\`;
    }
    getLsParams(options) {
        const params = this.invocationParams(options);
        return {
            ls_provider: 'azure',
            ls_model_name: this.getLangfuseModelName(),
            ls_model_type: 'chat',
            ls_temperature: params.temperature ?? undefined,
            ls_max_tokens: params.max_tokens ?? undefined,
            ls_stop: options?.stop,
        };
    }
    invocationParams(options, extra) {
        const params = super.invocationParams(options, extra);
        if (params && typeof params === 'object' && 'model' in params) {
            params.model = this.getLangfuseModelName();
        }
        return params;
    }
    /**
     * Returns backwards compatible reasoning parameters from constructor params and call options`,
      },
    ],
  },
  // ── Web search status event capture (src) ──
  // Capture in_progress/searching status events alongside the existing completed handler
  {
    relativePath: 'src/llm/openai/utils/index.ts',
    replacements: [
      {
        from: `  } else if (
    chunk.type === 'response.web_search_call.completed' ||
    chunk.type === 'response.file_search_call.completed'
  ) {
    generationInfo = {
      tool_outputs: {
        id: chunk.item_id,
        type: chunk.type.replace('response.', '').replace('.completed', ''),
        status: 'completed',
      },
    };
  } else if (chunk.type === 'response.refusal.done') {`,
        legacy: [
          `  } else if (
    chunk.type === 'response.web_search_call.in_progress' ||
    chunk.type === 'response.web_search_call.searching'
  ) {
    generationInfo = {
      web_search_status: {
        item_id: chunk.item_id,
        status: chunk.type.replace('response.web_search_call.', ''),
      },
    };
  } else if (
    chunk.type === 'response.web_search_call.completed' ||
    chunk.type === 'response.file_search_call.completed'
  ) {
    generationInfo = {
      tool_outputs: {
        id: chunk.item_id,
        type: chunk.type.replace('response.', '').replace('.completed', ''),
        status: 'completed',
      },
      ...(chunk.type === 'response.web_search_call.completed'
        ? { web_search_status: { item_id: chunk.item_id, status: 'completed' } }
        : {}),
    };
  } else if (chunk.type === 'response.refusal.done') {`,
        ],
        to: `  } else if (
    chunk.type === 'response.web_search_call.in_progress' ||
    chunk.type === 'response.web_search_call.searching'
  ) {
    generationInfo = {
      web_search_status: {
        item_id: chunk.item_id,
        status: chunk.type.replace('response.web_search_call.', ''),
      },
    };
    response_metadata.web_search_status = generationInfo.web_search_status;
  } else if (
    chunk.type === 'response.web_search_call.completed' ||
    chunk.type === 'response.file_search_call.completed'
  ) {
    generationInfo = {
      tool_outputs: {
        id: chunk.item_id,
        type: chunk.type.replace('response.', '').replace('.completed', ''),
        status: 'completed',
      },
      ...(chunk.type === 'response.web_search_call.completed'
        ? { web_search_status: { item_id: chunk.item_id, status: 'completed' } }
        : {}),
    };
    if (chunk.type === 'response.web_search_call.completed') {
      response_metadata.web_search_status = { item_id: chunk.item_id, status: 'completed' };
    }
  } else if (chunk.type === 'response.refusal.done') {`,
      },
    ],
  },
  // ── Web search status event capture (esm) ──
  {
    relativePath: 'dist/esm/llm/openai/utils/index.mjs',
    replacements: [
      {
        from: `    else if (chunk.type === 'response.web_search_call.completed' ||
        chunk.type === 'response.file_search_call.completed') {
        generationInfo = {
            tool_outputs: {
                id: chunk.item_id,
                type: chunk.type.replace('response.', '').replace('.completed', ''),
                status: 'completed',
            },
        };
    }
    else if (chunk.type === 'response.refusal.done') {`,
        legacy: [
          `    else if (chunk.type === 'response.web_search_call.in_progress' ||
        chunk.type === 'response.web_search_call.searching') {
        generationInfo = {
            web_search_status: {
                item_id: chunk.item_id,
                status: chunk.type.replace('response.web_search_call.', ''),
            },
        };
    }
    else if (chunk.type === 'response.web_search_call.completed' ||
        chunk.type === 'response.file_search_call.completed') {
        generationInfo = {
            tool_outputs: {
                id: chunk.item_id,
                type: chunk.type.replace('response.', '').replace('.completed', ''),
                status: 'completed',
            },
            ...(chunk.type === 'response.web_search_call.completed'
                ? { web_search_status: { item_id: chunk.item_id, status: 'completed' } }
                : {}),
        };
    }
    else if (chunk.type === 'response.refusal.done') {`,
        ],
        to: `    else if (chunk.type === 'response.web_search_call.in_progress' ||
        chunk.type === 'response.web_search_call.searching') {
        generationInfo = {
            web_search_status: {
                item_id: chunk.item_id,
                status: chunk.type.replace('response.web_search_call.', ''),
            },
        };
        response_metadata.web_search_status = generationInfo.web_search_status;
    }
    else if (chunk.type === 'response.web_search_call.completed' ||
        chunk.type === 'response.file_search_call.completed') {
        generationInfo = {
            tool_outputs: {
                id: chunk.item_id,
                type: chunk.type.replace('response.', '').replace('.completed', ''),
                status: 'completed',
            },
            ...(chunk.type === 'response.web_search_call.completed'
                ? { web_search_status: { item_id: chunk.item_id, status: 'completed' } }
                : {}),
        };
        if (chunk.type === 'response.web_search_call.completed') {
            response_metadata.web_search_status = { item_id: chunk.item_id, status: 'completed' };
        }
    }
    else if (chunk.type === 'response.refusal.done') {`,
      },
    ],
  },
  // ── Web search status event capture (cjs) ──
  {
    relativePath: 'dist/cjs/llm/openai/utils/index.cjs',
    replacements: [
      {
        from: `    else if (chunk.type === 'response.web_search_call.completed' ||
        chunk.type === 'response.file_search_call.completed') {
        generationInfo = {
            tool_outputs: {
                id: chunk.item_id,
                type: chunk.type.replace('response.', '').replace('.completed', ''),
                status: 'completed',
            },
        };
    }
    else if (chunk.type === 'response.refusal.done') {`,
        legacy: [
          `    else if (chunk.type === 'response.web_search_call.in_progress' ||
        chunk.type === 'response.web_search_call.searching') {
        generationInfo = {
            web_search_status: {
                item_id: chunk.item_id,
                status: chunk.type.replace('response.web_search_call.', ''),
            },
        };
    }
    else if (chunk.type === 'response.web_search_call.completed' ||
        chunk.type === 'response.file_search_call.completed') {
        generationInfo = {
            tool_outputs: {
                id: chunk.item_id,
                type: chunk.type.replace('response.', '').replace('.completed', ''),
                status: 'completed',
            },
            ...(chunk.type === 'response.web_search_call.completed'
                ? { web_search_status: { item_id: chunk.item_id, status: 'completed' } }
                : {}),
        };
    }
    else if (chunk.type === 'response.refusal.done') {`,
        ],
        to: `    else if (chunk.type === 'response.web_search_call.in_progress' ||
        chunk.type === 'response.web_search_call.searching') {
        generationInfo = {
            web_search_status: {
                item_id: chunk.item_id,
                status: chunk.type.replace('response.web_search_call.', ''),
            },
        };
        response_metadata.web_search_status = generationInfo.web_search_status;
    }
    else if (chunk.type === 'response.web_search_call.completed' ||
        chunk.type === 'response.file_search_call.completed') {
        generationInfo = {
            tool_outputs: {
                id: chunk.item_id,
                type: chunk.type.replace('response.', '').replace('.completed', ''),
                status: 'completed',
            },
            ...(chunk.type === 'response.web_search_call.completed'
                ? { web_search_status: { item_id: chunk.item_id, status: 'completed' } }
                : {}),
        };
        if (chunk.type === 'response.web_search_call.completed') {
            response_metadata.web_search_status = { item_id: chunk.item_id, status: 'completed' };
        }
    }
    else if (chunk.type === 'response.refusal.done') {`,
      },
    ],
  },
  // ── Web search status dispatch in stream handler (src) ──
  {
    relativePath: 'src/stream.ts',
    replacements: [
      {
        from: `import {
  ToolCallTypes,
  ContentTypes,
  GraphEvents,
  StepTypes,
  Providers,
} from '@/common';
import {
  handleServerToolResult,
  handleToolCallChunks,
  handleToolCalls,
} from '@/tools/handlers';
import { getMessageId } from '@/messages';`,
        to: `import {
  ToolCallTypes,
  ContentTypes,
  GraphEvents,
  StepTypes,
  Providers,
} from '@/common';
import {
  handleServerToolResult,
  handleToolCallChunks,
  handleToolCalls,
} from '@/tools/handlers';
import { getMessageId } from '@/messages';
import { safeDispatchCustomEvent } from '@/utils/events';`,
      },
      {
        from: `    /** Set a preliminary message ID if found in empty chunk */
    const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
        legacy: [
          `    // Dispatch web search status events before the empty-content guard
    const webSearchStatus = (chunk.response_metadata as Record<string, unknown> | undefined)?.web_search_status;
    if (webSearchStatus && graph.config) {
      const stepId = graph.getStepIdByKey(stepKey);
      await safeDispatchCustomEvent(
        'on_web_search_status',
        { id: stepId || stepKey, status: webSearchStatus },
        graph.config
      );
    }

    /** Set a preliminary message ID if found in empty chunk */
    const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
        ],
        to: `    // Dispatch web search status events before the empty-content guard
    const webSearchStatus = (chunk.response_metadata as Record<string, unknown> | undefined)?.web_search_status;
    if (webSearchStatus && graph.config) {
      const webSearchStepKey = graph.getStepKey(metadata);
      let webSearchStepId = webSearchStepKey;
      try {
        webSearchStepId = graph.getStepIdByKey(webSearchStepKey);
      } catch (_error) {}
      await safeDispatchCustomEvent(
        'on_web_search_status',
        { id: webSearchStepId, status: webSearchStatus },
        graph.config
      );
    }

    /** Set a preliminary message ID if found in empty chunk */
    const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
      },
    ],
  },
  // ── Web search status dispatch in stream handler (esm) ──
  {
    relativePath: 'dist/esm/stream.mjs',
    replacements: [
      {
        from: `import { handleServerToolResult, handleToolCalls, handleToolCallChunks } from './tools/handlers.mjs';`,
        to: `import { handleServerToolResult, handleToolCalls, handleToolCallChunks } from './tools/handlers.mjs';
import { safeDispatchCustomEvent } from './utils/events.mjs';`,
      },
      {
        from: `        /** Set a preliminary message ID if found in empty chunk */
        const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
        legacy: [
          `        // Dispatch web search status events before the empty-content guard
        const webSearchStatus = chunk.response_metadata?.web_search_status;
        if (webSearchStatus && graph.config) {
            const stepId = graph.getStepIdByKey(stepKey);
            await safeDispatchCustomEvent('on_web_search_status', { id: stepId || stepKey, status: webSearchStatus }, graph.config);
        }
        /** Set a preliminary message ID if found in empty chunk */
        const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
        ],
        to: `        // Dispatch web search status events before the empty-content guard
        const webSearchStatus = chunk.response_metadata?.web_search_status;
        if (webSearchStatus && graph.config) {
            const webSearchStepKey = graph.getStepKey(metadata);
            let webSearchStepId = webSearchStepKey;
            try {
                webSearchStepId = graph.getStepIdByKey(webSearchStepKey);
            }
            catch (_error) { }
            await safeDispatchCustomEvent('on_web_search_status', { id: webSearchStepId, status: webSearchStatus }, graph.config);
        }
        /** Set a preliminary message ID if found in empty chunk */
        const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
      },
    ],
  },
  // ── Web search status dispatch in stream handler (cjs) ──
  {
    relativePath: 'dist/cjs/stream.cjs',
    replacements: [
      {
        from: `var handlers = require('./tools/handlers.cjs');`,
        to: `var handlers = require('./tools/handlers.cjs');
var events = require('./utils/events.cjs');`,
      },
      {
        from: `        /** Set a preliminary message ID if found in empty chunk */
        const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
        legacy: [
          `        // Dispatch web search status events before the empty-content guard
        const webSearchStatus = chunk.response_metadata?.web_search_status;
        if (webSearchStatus && graph.config) {
            const stepId = graph.getStepIdByKey(stepKey);
            await events.safeDispatchCustomEvent('on_web_search_status', { id: stepId || stepKey, status: webSearchStatus }, graph.config);
        }
        /** Set a preliminary message ID if found in empty chunk */
        const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
        ],
        to: `        // Dispatch web search status events before the empty-content guard
        const webSearchStatus = chunk.response_metadata?.web_search_status;
        if (webSearchStatus && graph.config) {
            const webSearchStepKey = graph.getStepKey(metadata);
            let webSearchStepId = webSearchStepKey;
            try {
                webSearchStepId = graph.getStepIdByKey(webSearchStepKey);
            }
            catch (_error) { }
            await events.safeDispatchCustomEvent('on_web_search_status', { id: webSearchStepId, status: webSearchStatus }, graph.config);
        }
        /** Set a preliminary message ID if found in empty chunk */
        const isEmptyChunk = isEmptyContent && !hasToolCallChunks;`,
      },
    ],
  },
  // ── Graph.mjs/Graph.cjs web_search_action patches removed ──
  // @librechat/agents ≥3.1.63 includes native web_search_action dispatch in llm/invoke.mjs/cjs,
  // so the previous Graph.mjs/Graph.cjs patches are no longer needed.
  // ── Fix reasoning item reconstruction to strip id (avoids "required following item" API error) (esm) ──
  {
    relativePath: 'dist/esm/llm/openai/utils/index.mjs',
    replacements: [
      {
        from: `            // reasoning items
            if (additional_kwargs.reasoning && !zdrEnabled) {
                const reasoningItem = _convertReasoningSummaryToOpenAIResponsesParams(additional_kwargs.reasoning);
                input.push(reasoningItem);
            }`,
        to: `            // reasoning items - strip id to avoid "required following item" API errors during reconstruction
            if (additional_kwargs.reasoning && !zdrEnabled) {
                const { id: _rid, ...reasoningWithoutId } = additional_kwargs.reasoning;
                if (reasoningWithoutId.summary) {
                    const reasoningItem = _convertReasoningSummaryToOpenAIResponsesParams(reasoningWithoutId);
                    input.push(reasoningItem);
                }
            }`,
      },
    ],
  },
  // ── Fix reasoning item reconstruction to strip id (cjs) ──
  {
    relativePath: 'dist/cjs/llm/openai/utils/index.cjs',
    replacements: [
      {
        from: `            // reasoning items
            if (additional_kwargs.reasoning && !zdrEnabled) {
                const reasoningItem = _convertReasoningSummaryToOpenAIResponsesParams(additional_kwargs.reasoning);
                input.push(reasoningItem);
            }`,
        to: `            // reasoning items - strip id to avoid "required following item" API errors during reconstruction
            if (additional_kwargs.reasoning && !zdrEnabled) {
                const { id: _rid, ...reasoningWithoutId } = additional_kwargs.reasoning;
                if (reasoningWithoutId.summary) {
                    const reasoningItem = _convertReasoningSummaryToOpenAIResponsesParams(reasoningWithoutId);
                    input.push(reasoningItem);
                }
            }`,
      },
    ],
  },
  // ── Fix reasoning item reconstruction to strip id (src TypeScript) ──
  {
    relativePath: 'src/llm/openai/utils/index.ts',
    replacements: [
      {
        from: `        // reasoning items
        if (additional_kwargs.reasoning && !zdrEnabled) {
          const reasoningItem = _convertReasoningSummaryToOpenAIResponsesParams(
            additional_kwargs.reasoning
          );
          input.push(reasoningItem);
        }`,
        to: `        // reasoning items - strip id to avoid "required following item" API errors during reconstruction
        if (additional_kwargs.reasoning && !zdrEnabled) {
          const { id: _rid, ...reasoningWithoutId } = additional_kwargs.reasoning;
          if (reasoningWithoutId.summary) {
            const reasoningItem = _convertReasoningSummaryToOpenAIResponsesParams(reasoningWithoutId);
            input.push(reasoningItem);
          }
        }`,
      },
    ],
  },
];

const langchainPatchTargets = [
  // ── Auto-include web_search_call.results for Responses API (esm) ──
  {
    relativePath: 'dist/chat_models.js',
    replacements: [
      {
        from: `    async *_streamResponseChunks(messages, options, runManager) {
        if (this._useResponseApi(options)) {
            const streamIterable = await this.responseApiWithRetry({
                ...this.invocationParams(options, { streaming: true }),
                input: _convertMessagesToOpenAIResponsesParams(messages, this.model, this.zdrEnabled),
                stream: true,
            }, options);`,
        to: `    async *_streamResponseChunks(messages, options, runManager) {
        if (this._useResponseApi(options)) {
            const invParams = this.invocationParams(options, { streaming: true });
            const hasWebSearch = Array.isArray(invParams.tools) && invParams.tools.some(t => t.type === 'web_search' || t.type === 'web_search_preview');
            if (hasWebSearch && !invParams.include) {
                invParams.include = ['web_search_call.results'];
            }
            const streamIterable = await this.responseApiWithRetry({
                ...invParams,
                input: _convertMessagesToOpenAIResponsesParams(messages, this.model, this.zdrEnabled),
                stream: true,
            }, options);`,
      },
    ],
  },
  // ── Auto-include web_search_call.results for Responses API (cjs) ──
  {
    relativePath: 'dist/chat_models.cjs',
    replacements: [
      {
        from: `    async *_streamResponseChunks(messages, options, runManager) {
        if (this._useResponseApi(options)) {
            const streamIterable = await this.responseApiWithRetry({
                ...this.invocationParams(options, { streaming: true }),
                input: _convertMessagesToOpenAIResponsesParams(messages, this.model, this.zdrEnabled),
                stream: true,
            }, options);`,
        to: `    async *_streamResponseChunks(messages, options, runManager) {
        if (this._useResponseApi(options)) {
            const invParams = this.invocationParams(options, { streaming: true });
            const hasWebSearch = Array.isArray(invParams.tools) && invParams.tools.some(t => t.type === 'web_search' || t.type === 'web_search_preview');
            if (hasWebSearch && !invParams.include) {
                invParams.include = ['web_search_call.results'];
            }
            const streamIterable = await this.responseApiWithRetry({
                ...invParams,
                input: _convertMessagesToOpenAIResponsesParams(messages, this.model, this.zdrEnabled),
                stream: true,
            }, options);`,
      },
    ],
  },
];

const langfusePatchTargets = [
  // ── Prevent Langfuse from overwriting model name with raw API response model_name ──
  // Azure API responses return bare model names (e.g. "gpt-5.4-mini") without the
  // "azure-openai/" prefix we set in invocationParams. The extractModelNameFromMetadata
  // method runs at generation END and overwrites the correct START model name.
  // Fix: return undefined so the invocationParams model name is preserved.
  {
    relativePath: 'dist/index.mjs',
    replacements: [
      {
        from: `  extractModelNameFromMetadata(generation) {
    try {
      return "message" in generation && (generation["message"] instanceof AIMessage || generation["message"] instanceof AIMessageChunk) ? generation["message"].response_metadata.model_name : void 0;
    } catch {
    }
  }`,
        to: `  extractModelNameFromMetadata(generation) {
    return void 0;
  }`,
      },
    ],
  },
  {
    relativePath: 'dist/index.cjs',
    replacements: [
      {
        from: `  extractModelNameFromMetadata(generation) {
    try {
      return "message" in generation && (generation["message"] instanceof import_messages.AIMessage || generation["message"] instanceof import_messages.AIMessageChunk) ? generation["message"].response_metadata.model_name : void 0;
    } catch {
    }
  }`,
        to: `  extractModelNameFromMetadata(generation) {
    return void 0;
  }`,
      },
    ],
  },
];

function applyReplacement(contents, replacement, filePath) {
  if (contents.includes(replacement.to)) {
    return contents;
  }

  if (replacement.legacy) {
    for (const legacyReplacement of replacement.legacy) {
      if (contents.includes(legacyReplacement)) {
        return contents.replace(legacyReplacement, replacement.to);
      }
    }
  }

  if (!contents.includes(replacement.from)) {
    throw new Error(`Could not find expected snippet in ${filePath}`);
  }

  return contents.replace(replacement.from, replacement.to);
}

function validatePatchedFile(relativePath, contents) {
  if (!guardedStreamTargets.has(relativePath)) {
    return;
  }

  const webSearchStatusBlockMatch = contents.match(
    /const webSearchStatus[\s\S]*?const isEmptyChunk = isEmptyContent && !hasToolCallChunks;/,
  );

  if (webSearchStatusBlockMatch == null) {
    throw new Error(
      `[apply-runtime-patches] Missing web search status dispatch block in ${relativePath}`,
    );
  }

  const webSearchStatusBlock = webSearchStatusBlockMatch[0];

  if (webSearchStatusBlock.includes('graph.getStepIdByKey(stepKey)')) {
    throw new Error(
      `[apply-runtime-patches] Refusing to keep buggy web search status patch in ${relativePath}: stepKey is referenced before initialization`,
    );
  }

  if (!webSearchStatusBlock.includes('const webSearchStepKey = graph.getStepKey(metadata);')) {
    throw new Error(
      `[apply-runtime-patches] Missing webSearchStepKey safeguard in ${relativePath}`,
    );
  }

  if (!webSearchStatusBlock.includes('graph.getStepIdByKey(webSearchStepKey)')) {
    throw new Error(`[apply-runtime-patches] Missing webSearchStepId lookup in ${relativePath}`);
  }

  if (!webSearchStatusBlock.includes('id: webSearchStepId')) {
    throw new Error(
      `[apply-runtime-patches] Missing safe web search status dispatch payload in ${relativePath}`,
    );
  }
}

function patchFile(relativePath, replacements, baseDir = agentsDir) {
  const filePath = path.join(baseDir, relativePath);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing patch target: ${filePath}`);
  }

  let contents = fs.readFileSync(filePath, 'utf8');
  const originalContents = contents;

  for (const replacement of replacements) {
    contents = applyReplacement(contents, replacement, filePath);
  }

  validatePatchedFile(relativePath, contents);

  if (contents !== originalContents) {
    fs.writeFileSync(filePath, contents, 'utf8');
    console.log(`[apply-runtime-patches] patched ${relativePath}`);
  } else {
    console.log(`[apply-runtime-patches] already patched ${relativePath}`);
  }
}

function applyRuntimePatches(targets = patchTargets) {
  if (!fs.existsSync(agentsDir)) {
    throw new Error(`Missing dependency directory: ${agentsDir}`);
  }

  for (const target of targets) {
    patchFile(target.relativePath, target.replacements);
  }

  if (fs.existsSync(langchainOpenAIDir)) {
    for (const target of langchainPatchTargets) {
      patchFile(target.relativePath, target.replacements, langchainOpenAIDir);
    }
  }

  if (fs.existsSync(langfuseLangchainDir)) {
    for (const target of langfusePatchTargets) {
      patchFile(target.relativePath, target.replacements, langfuseLangchainDir);
    }
  }

  if (fs.existsSync(librechatApiDir)) {
    const librechatApiDistDir = path.join(librechatApiDir, 'dist');
    if (fs.existsSync(librechatApiDistDir)) {
      for (const target of librechatApiPatchTargets) {
        patchFile(target.relativePath, target.replacements, librechatApiDir);
      }
    } else {
      console.log('[apply-runtime-patches] Skipping packages/api patches (dist not yet built)');
    }
  }
}

const librechatApiPatchTargets = [
  {
    relativePath: 'dist/index.js',
    replacements: [
      {
        description:
          'Increase default agent context window fallback from 18000 to 128000 for Ollama/custom endpoints',
        from: `options.endpointTokenConfig), 18000);`,
        to: `options.endpointTokenConfig), 128000);`,
      },
      {
        description: 'Increase agent context num fallback from 18000 to 128000',
        from: `const agentMaxContextNum = Number(agentMaxContextTokens) || 18000;`,
        to: `const agentMaxContextNum = Number(agentMaxContextTokens) || 128000;`,
      },
    ],
  },
];

if (require.main === module) {
  applyRuntimePatches();
}

module.exports = {
  agentsDir,
  langchainOpenAIDir,
  langfuseLangchainDir,
  librechatApiDir,
  applyReplacement,
  applyRuntimePatches,
  patchFile,
  patchTargets,
  langchainPatchTargets,
  langfusePatchTargets,
  librechatApiPatchTargets,
  validatePatchedFile,
};
