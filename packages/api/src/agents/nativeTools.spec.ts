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
  });
});
