import {
  CodeInterpreterModes,
  EModelEndpoint,
  EToolResources,
  KnownEndpoints,
  Tools,
} from 'librechat-data-provider';
import { Providers } from '@librechat/agents';
import {
  buildNativeProviderTools,
  mergeNativeProviderTools,
  selectNativeTools,
} from './nativeTools';

describe('nativeTools', () => {
  const originalOpenAIRouting = process.env.OPENAI_CODE_INTERPRETER_ROUTING;
  const originalAzureOpenAIRouting = process.env.AZURE_OPENAI_CODE_INTERPRETER_ROUTING;
  const originalGoogleRouting = process.env.GOOGLE_CODE_INTERPRETER_ROUTING;

  afterEach(() => {
    if (originalOpenAIRouting == null) {
      delete process.env.OPENAI_CODE_INTERPRETER_ROUTING;
    } else {
      process.env.OPENAI_CODE_INTERPRETER_ROUTING = originalOpenAIRouting;
    }

    if (originalAzureOpenAIRouting == null) {
      delete process.env.AZURE_OPENAI_CODE_INTERPRETER_ROUTING;
    } else {
      process.env.AZURE_OPENAI_CODE_INTERPRETER_ROUTING = originalAzureOpenAIRouting;
    }

    if (originalGoogleRouting == null) {
      delete process.env.GOOGLE_CODE_INTERPRETER_ROUTING;
    } else {
      process.env.GOOGLE_CODE_INTERPRETER_ROUTING = originalGoogleRouting;
    }
  });

  describe('selectNativeTools', () => {
    it('maps ephemeral OpenAI chat-bar toggles to provider-native tools', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.openAI,
        model: 'gpt-4.1',
        tools: [Tools.web_search, Tools.execute_code, Tools.file_search],
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.openAIExecuteCode).toBe(true);
      expect(selection.openAIFileSearch).toBe(true);
      expect(selection.requiresResponsesApi).toBe(true);
      expect(selection.stripTools).toEqual(
        new Set([Tools.web_search, Tools.execute_code, Tools.file_search]),
      );
    });

    it('keeps OpenAI code execution structured when local managed routing is enabled', () => {
      process.env.OPENAI_CODE_INTERPRETER_ROUTING = 'librechat';

      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.openAI,
        model: 'gpt-4.1',
        tools: [Tools.execute_code, Tools.file_search],
      });

      expect(selection.openAIExecuteCode).toBe(false);
      expect(selection.openAIFileSearch).toBe(true);
      expect(selection.requiresResponsesApi).toBe(true);
      expect(selection.stripTools).toEqual(new Set([Tools.file_search]));
    });

    it('keeps OpenAI web search structured for search-preview models that do not support the native toggle', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.openAI,
        model: 'gpt-4o-search-preview',
        tools: [Tools.web_search],
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.requiresResponsesApi).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });

    it('maps Chat Latest Azure deployments to OpenAI-native web search', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.azureOpenAI,
        model: 'gpt-chat-latest',
        tools: [Tools.web_search],
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.requiresResponsesApi).toBe(true);
      expect(selection.stripTools).toEqual(new Set([Tools.web_search]));
    });

    it.each(['DeepSeek-V3.1', 'grok-4-1-fast-reasoning', 'Phi-4', 'Mistral-Large-3'])(
      'keeps Azure-hosted %s web search structured instead of OpenAI-native',
      (model) => {
        const selection = selectNativeTools({
          agentId: 'ephemeral-agent',
          provider: EModelEndpoint.azureOpenAI,
          model,
          tools: [Tools.web_search, Tools.execute_code, Tools.file_search],
        });

        expect(selection.enableWebSearch).toBe(false);
        expect(selection.openAIExecuteCode).toBe(false);
        expect(selection.openAIFileSearch).toBe(false);
        expect(selection.requiresResponsesApi).toBe(false);
        expect(selection.stripTools.size).toBe(0);
      },
    );

    it('keeps embedding deployments out of OpenAI-native tool routing', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.azureOpenAI,
        model: 'text-embedding-3-small',
        tools: [Tools.web_search, Tools.execute_code, Tools.file_search],
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.openAIExecuteCode).toBe(false);
      expect(selection.openAIFileSearch).toBe(false);
      expect(selection.requiresResponsesApi).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });

    it('keeps Google tools structured when native tools would conflict with attached files', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: Providers.GOOGLE,
        tools: [Tools.execute_code, Tools.web_search],
        tool_resources: {
          [EToolResources.execute_code]: {
            files: [
              {
                user: 'user',
                file_id: 'file-1',
                bytes: 10,
                embedded: false,
                filename: 'data.csv',
                filepath: '/uploads/data.csv',
                object: 'file',
                type: 'text/csv',
                usage: 0,
              },
            ],
          },
        },
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.googleCodeExecution).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });

    it('maps Google web search and code execution when no structured tools remain', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: Providers.GOOGLE,
        tools: [Tools.execute_code, Tools.web_search],
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.googleCodeExecution).toBe(true);
      expect(selection.stripTools).toEqual(new Set([Tools.web_search, Tools.execute_code]));
    });

    it('keeps Google code execution structured when local managed routing is enabled', () => {
      process.env.GOOGLE_CODE_INTERPRETER_ROUTING = 'librechat';

      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: Providers.GOOGLE,
        tools: [Tools.execute_code],
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.googleCodeExecution).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });

    it('maps xAI web search to provider-native routing and requires Responses API', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: KnownEndpoints.xai,
        tools: [Tools.web_search, Tools.execute_code],
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.requiresResponsesApi).toBe(true);
      expect(selection.openAIExecuteCode).toBe(false);
      expect(selection.stripTools).toEqual(new Set([Tools.web_search]));
    });

    it('does not require Responses API for xAI without web_search', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: KnownEndpoints.xai,
        tools: [Tools.execute_code],
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.requiresResponsesApi).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });

    it('maps Anthropic web search natively and uses Anthropic-native code execution only when requested', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.anthropic,
        model: 'claude-opus-4-6',
        tools: [Tools.web_search, Tools.execute_code],
        codeInterpreterMode: CodeInterpreterModes.provider_native,
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.anthropicCodeExecution).toBe(true);
      expect(selection.requiresResponsesApi).toBe(false);
      expect(selection.stripTools).toEqual(new Set([Tools.web_search, Tools.execute_code]));
    });

    it('keeps Anthropic code execution structured when LibreChat-managed mode is selected', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.anthropic,
        model: 'claude-opus-4-6',
        tools: [Tools.web_search, Tools.execute_code],
        codeInterpreterMode: CodeInterpreterModes.librechat,
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.anthropicCodeExecution).toBe(false);
      expect(selection.stripTools).toEqual(new Set([Tools.web_search]));
    });

    it('lets the explicit Anthropic code execution toggle suppress provider-native code execution', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.anthropic,
        model: 'claude-opus-4-6',
        tools: [Tools.web_search, Tools.execute_code],
        codeInterpreterMode: CodeInterpreterModes.provider_native,
        anthropicToolOptions: {
          codeExecution: false,
        },
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.anthropicCodeExecution).toBe(false);
      expect(selection.stripTools).toEqual(new Set([Tools.web_search]));
    });

    it('maps explicit Anthropic web fetch and advisor toggles to native selection', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.anthropic,
        model: 'claude-opus-4-6',
        tools: [Tools.web_search],
        anthropicToolOptions: {
          webFetch: true,
          advisor: true,
          advisorModel: 'claude-opus-4-7',
        },
      });

      expect(selection.enableWebSearch).toBe(true);
      expect(selection.anthropicWebFetch).toBe(true);
      expect(selection.anthropicAdvisor).toBe(true);
      expect(selection.anthropicAdvisorModel).toBe('claude-opus-4-7');
      expect(selection.stripTools).toEqual(new Set([Tools.web_search]));
    });

    it('keeps Anthropic native tools structured when the selected model does not support them', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.anthropic,
        model: 'claude-3-haiku-20240307',
        tools: [Tools.web_search, Tools.execute_code],
        codeInterpreterMode: CodeInterpreterModes.provider_native,
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.anthropicCodeExecution).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });

    it('keeps Anthropic code execution structured when local code files are attached', () => {
      const selection = selectNativeTools({
        agentId: 'ephemeral-agent',
        provider: EModelEndpoint.anthropic,
        model: 'claude-opus-4-6',
        tools: [Tools.execute_code],
        codeInterpreterMode: CodeInterpreterModes.provider_native,
        tool_resources: {
          [EToolResources.execute_code]: {
            files: [
              {
                user: 'user',
                file_id: 'file-1',
                bytes: 10,
                embedded: false,
                filename: 'script.py',
                filepath: '/uploads/script.py',
                object: 'file',
                type: 'text/x-python',
                usage: 0,
              },
            ],
          },
        },
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.anthropicCodeExecution).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });

    it('does not rewrite saved agents', () => {
      const selection = selectNativeTools({
        agentId: 'agent_saved-id',
        provider: EModelEndpoint.openAI,
        tools: [Tools.web_search, Tools.execute_code],
      });

      expect(selection.enableWebSearch).toBe(false);
      expect(selection.requiresResponsesApi).toBe(false);
      expect(selection.stripTools.size).toBe(0);
    });
  });

  describe('mergeNativeProviderTools', () => {
    it('deduplicates provider-native tool descriptors by tool identity', () => {
      const tools = mergeNativeProviderTools(
        [{ type: 'web_search' }, { googleSearch: {} }],
        [{ type: 'web_search' }, { codeExecution: {} }],
      );

      expect(tools).toEqual([{ type: 'web_search' }, { googleSearch: {} }, { codeExecution: {} }]);
    });
  });

  describe('buildNativeProviderTools', () => {
    it('uses the basic Anthropic native web search tool without code execution', async () => {
      const result = await buildNativeProviderTools({
        req: { body: {} } as never,
        provider: EModelEndpoint.anthropic,
        llmConfig: {},
        selection: {
          stripTools: new Set([Tools.web_search]),
          enableWebSearch: true,
          requiresResponsesApi: false,
          openAIExecuteCode: false,
          openAIFileSearch: false,
          anthropicCodeExecution: false,
          anthropicWebFetch: false,
          anthropicAdvisor: false,
          googleCodeExecution: false,
        },
      });

      expect(result.tools).toEqual([
        {
          type: 'web_search_20250305',
          name: 'web_search',
        },
      ]);
    });

    it('uses the dynamic Anthropic native web search tool with code execution', async () => {
      const result = await buildNativeProviderTools({
        req: { body: {} } as never,
        provider: EModelEndpoint.anthropic,
        llmConfig: {},
        selection: {
          stripTools: new Set([Tools.web_search, Tools.execute_code]),
          enableWebSearch: true,
          requiresResponsesApi: false,
          openAIExecuteCode: false,
          openAIFileSearch: false,
          anthropicCodeExecution: true,
          anthropicWebFetch: false,
          anthropicAdvisor: false,
          googleCodeExecution: false,
        },
      });

      expect(result.tools).toEqual([
        {
          type: 'web_search_20260209',
          name: 'web_search',
        },
        {
          type: 'code_execution_20250825',
          name: 'code_execution',
        },
      ]);
    });

    it('uses the current Anthropic native code execution tool identifier', async () => {
      const result = await buildNativeProviderTools({
        req: { body: {} } as never,
        provider: EModelEndpoint.anthropic,
        llmConfig: {},
        selection: {
          stripTools: new Set([Tools.execute_code]),
          enableWebSearch: false,
          requiresResponsesApi: false,
          openAIExecuteCode: false,
          openAIFileSearch: false,
          anthropicCodeExecution: true,
          anthropicWebFetch: false,
          anthropicAdvisor: false,
          googleCodeExecution: false,
        },
      });

      expect(result.tools).toEqual([
        {
          type: 'code_execution_20250825',
          name: 'code_execution',
        },
      ]);
    });

    it('builds Anthropic web fetch and advisor server-tool descriptors', async () => {
      const result = await buildNativeProviderTools({
        req: { body: {} } as never,
        provider: EModelEndpoint.anthropic,
        llmConfig: {},
        selection: {
          stripTools: new Set([Tools.web_search]),
          enableWebSearch: true,
          requiresResponsesApi: false,
          openAIExecuteCode: false,
          openAIFileSearch: false,
          anthropicCodeExecution: false,
          anthropicWebFetch: true,
          anthropicAdvisor: true,
          anthropicAdvisorModel: 'claude-opus-4-7',
          googleCodeExecution: false,
        },
      });

      expect(result.tools).toEqual([
        {
          type: 'web_search_20250305',
          name: 'web_search',
        },
        {
          type: 'web_fetch_20250910',
          name: 'web_fetch',
          citations: {
            enabled: true,
          },
        },
        {
          type: 'advisor_20260301',
          name: 'advisor',
          model: 'claude-opus-4-7',
        },
      ]);
    });
  });
});
