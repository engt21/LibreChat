import { useEffect, useMemo } from 'react';
import { Checkbox } from '@librechat/client';
import { Controller, useFormContext, useWatch } from 'react-hook-form';
import {
  AgentCapabilities,
  CodeInterpreterModes,
  EModelEndpoint,
  getAnthropicModelCapabilities,
  getGoogleModelCapabilities,
  getOpenAIModelCapabilities,
} from 'librechat-data-provider';
import type { AgentForm, ExtendedFile } from '~/common';
import { useLocalize } from '~/hooks';
import CodeFiles from './Code/Files';
import FileSearch from './FileSearch';

const LOCAL_CODE_TOOL = 'local_code_interpreter';
const LOCAL_FILE_SEARCH_TOOL = 'local_file_search';

export type ProviderToolAvailability = {
  name: string;
  code: boolean;
  codeFiles: boolean;
  exclusive: boolean;
  fileSearch: boolean;
  webSearch: boolean;
};

export function getProviderToolAvailability(
  providerValue: string,
  model: string,
): ProviderToolAvailability {
  const normalizedProvider = providerValue.toLowerCase();

  if (
    providerValue === EModelEndpoint.openAI ||
    providerValue === EModelEndpoint.azureOpenAI ||
    normalizedProvider.includes('openai') ||
    normalizedProvider.includes('azure')
  ) {
    const capabilities = getOpenAIModelCapabilities(model);
    const supportsHostedTools =
      capabilities.supportsOpenAIResponsesApi || capabilities.requiresResponsesApi;
    return {
      name: normalizedProvider.includes('azure') ? 'Azure OpenAI' : 'OpenAI',
      code: supportsHostedTools,
      codeFiles: supportsHostedTools,
      exclusive: false,
      fileSearch: supportsHostedTools,
      webSearch: capabilities.supportsWebSearch,
    };
  }

  if (providerValue === EModelEndpoint.anthropic || normalizedProvider.includes('anthropic')) {
    const capabilities = getAnthropicModelCapabilities(model);
    return {
      name: 'Anthropic',
      code: capabilities.supportsCodeExecution,
      codeFiles: false,
      exclusive: false,
      fileSearch: false,
      webSearch: capabilities.supportsWebSearch,
    };
  }

  if (
    providerValue === EModelEndpoint.google ||
    normalizedProvider.includes('google') ||
    normalizedProvider.includes('gemini') ||
    normalizedProvider.includes('vertex')
  ) {
    const capabilities = getGoogleModelCapabilities(model);
    return {
      name: normalizedProvider.includes('vertex') ? 'Vertex AI' : 'Google',
      code: /^gemini-/i.test(model) && !/^gemini-1\./i.test(model),
      codeFiles: false,
      exclusive: true,
      fileSearch: false,
      webSearch: capabilities.supportsWebSearch,
    };
  }

  if (normalizedProvider.includes('xai') || normalizedProvider.includes('grok')) {
    return {
      name: 'xAI',
      code: false,
      codeFiles: false,
      exclusive: false,
      fileSearch: false,
      webSearch: true,
    };
  }

  return {
    name: providerValue || 'Selected provider',
    code: false,
    codeFiles: false,
    exclusive: false,
    fileSearch: false,
    webSearch: false,
  };
}

type ToolToggleProps = {
  checked: boolean;
  description: string;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

function ToolToggle({ checked, description, label, onCheckedChange }: ToolToggleProps) {
  const id = `agent-tool-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <label
      id={`${id}-label`}
      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-light bg-surface-secondary p-3"
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        className="mt-0.5 h-4 w-4"
        aria-labelledby={`${id}-label`}
      />
      <span className="flex flex-col gap-1">
        <span className="font-medium text-text-primary">{label}</span>
        <span className="text-xs text-text-secondary">{description}</span>
      </span>
    </label>
  );
}

export default function ToolCapabilities({
  agentId,
  codeFiles,
  knowledgeFiles,
}: {
  agentId: string;
  codeFiles?: [string, ExtendedFile][];
  knowledgeFiles?: [string, ExtendedFile][];
}) {
  const localize = useLocalize();
  const { control, getValues, setValue } = useFormContext<AgentForm>();
  const provider = useWatch({ control, name: 'provider' });
  const model = useWatch({ control, name: 'model' }) ?? '';
  const tools = useWatch({ control, name: 'tools' }) ?? [];
  const providerValue = String(typeof provider === 'string' ? provider : (provider?.value ?? ''));
  const providerTools = useMemo(
    () => getProviderToolAvailability(providerValue, model),
    [model, providerValue],
  );

  const localCodeEnabled = tools.includes(LOCAL_CODE_TOOL);
  const localFileSearchEnabled = tools.includes(LOCAL_FILE_SEARCH_TOOL);
  const providerCodeEnabled = useWatch({ control, name: AgentCapabilities.execute_code });
  const providerFileSearchEnabled = useWatch({ control, name: AgentCapabilities.file_search });
  const providerWebSearchEnabled = useWatch({ control, name: AgentCapabilities.web_search });

  useEffect(() => {
    if (!providerTools.code && providerCodeEnabled) {
      setValue(AgentCapabilities.execute_code, false, { shouldDirty: true });
    }
    if (!providerTools.fileSearch && providerFileSearchEnabled) {
      setValue(AgentCapabilities.file_search, false, { shouldDirty: true });
    }
    if (!providerTools.webSearch && providerWebSearchEnabled) {
      setValue(AgentCapabilities.web_search, false, { shouldDirty: true });
    }
  }, [
    providerCodeEnabled,
    providerFileSearchEnabled,
    providerTools,
    providerWebSearchEnabled,
    setValue,
  ]);

  const clearProviderTools = () => {
    setValue(AgentCapabilities.execute_code, false, { shouldDirty: true });
    setValue(AgentCapabilities.file_search, false, { shouldDirty: true });
    setValue(AgentCapabilities.web_search, false, { shouldDirty: true });
  };

  const clearLocalTools = () => {
    const current = getValues('tools') ?? [];
    setValue(
      'tools',
      current.filter((tool) => tool !== LOCAL_CODE_TOOL && tool !== LOCAL_FILE_SEARCH_TOOL),
      { shouldDirty: true },
    );
  };

  const setStructuredTool = (toolId: string, enabled: boolean) => {
    if (enabled && providerTools.exclusive) {
      clearProviderTools();
    }
    const current = getValues('tools') ?? [];
    setValue(
      'tools',
      enabled
        ? Array.from(new Set([...current, toolId]))
        : current.filter((tool) => tool !== toolId),
      { shouldDirty: true },
    );
  };

  const setProviderCode = (enabled: boolean) => {
    if (enabled && providerTools.exclusive) {
      clearLocalTools();
    }
    setValue(AgentCapabilities.execute_code, enabled, { shouldDirty: true });
    setValue(
      'model_parameters.execute_code_mode' as never,
      CodeInterpreterModes.provider_native as never,
      { shouldDirty: true },
    );
  };

  const setProviderCapability = (
    capability: AgentCapabilities.file_search | AgentCapabilities.web_search,
    enabled: boolean,
  ) => {
    if (enabled && providerTools.exclusive) {
      clearLocalTools();
    }
    setValue(capability, enabled, { shouldDirty: true });
  };

  return (
    <div className="mb-4 flex w-full flex-col gap-4">
      <div>
        <h3 className="mb-2 font-medium text-text-primary">
          {localize('com_agents_provider_tools')}
        </h3>
        <div className="grid gap-2">
          {providerTools.webSearch && (
            <Controller
              name={AgentCapabilities.web_search}
              control={control}
              render={({ field }) => (
                <ToolToggle
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    setProviderCapability(AgentCapabilities.web_search, checked)
                  }
                  label={`${providerTools.name} Web Search`}
                  description={`Use ${providerTools.name}'s hosted web-search tool for this model.`}
                />
              )}
            />
          )}
          {providerTools.code && (
            <ToolToggle
              checked={providerCodeEnabled}
              onCheckedChange={setProviderCode}
              label={`${providerTools.name} Code Interpreter`}
              description={`Use ${providerTools.name}'s provider-native code execution.`}
            />
          )}
          {providerTools.fileSearch && (
            <Controller
              name={AgentCapabilities.file_search}
              control={control}
              render={({ field }) => (
                <ToolToggle
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    setProviderCapability(AgentCapabilities.file_search, checked)
                  }
                  label={`${providerTools.name} File Search`}
                  description={`Use ${providerTools.name}'s hosted file/vector search.`}
                />
              )}
            />
          )}
          {!providerTools.webSearch && !providerTools.code && !providerTools.fileSearch && (
            <p className="text-xs text-text-secondary">
              {localize('com_agents_provider_tools_unavailable')}
            </p>
          )}
        </div>
      </div>

      <div>
        <h3 className="mb-2 font-medium text-text-primary">{localize('com_agents_local_tools')}</h3>
        <div className="grid gap-2">
          <ToolToggle
            checked={localCodeEnabled}
            onCheckedChange={(checked) => setStructuredTool(LOCAL_CODE_TOOL, checked)}
            label="Local Code Interpreter"
            description="Use your self-hosted sandbox, independent of the model provider."
          />
          <ToolToggle
            checked={localFileSearchEnabled}
            onCheckedChange={(checked) => setStructuredTool(LOCAL_FILE_SEARCH_TOOL, checked)}
            label="Local File & Vector Search"
            description="Upload files and use the local vector database, independent of provider."
          />
        </div>
      </div>

      {providerCodeEnabled && providerTools.codeFiles && (
        <CodeFiles
          agent_id={agentId}
          files={codeFiles}
          enabled={true}
          agentTool={AgentCapabilities.execute_code}
          title={`${providerTools.name} Code Interpreter files`}
        />
      )}
      {localCodeEnabled && (
        <CodeFiles
          agent_id={agentId}
          files={codeFiles}
          enabled={true}
          agentTool={LOCAL_CODE_TOOL}
          title="Local Code Interpreter files"
        />
      )}
      {providerFileSearchEnabled && (
        <FileSearch
          agent_id={agentId}
          files={knowledgeFiles}
          enabled={true}
          showToggle={false}
          agentTool={AgentCapabilities.file_search}
          title={`${providerTools.name} File Search uploads`}
        />
      )}
      {localFileSearchEnabled && (
        <FileSearch
          agent_id={agentId}
          files={knowledgeFiles}
          enabled={true}
          showToggle={false}
          agentTool={LOCAL_FILE_SEARCH_TOOL}
          title="Local File & Vector Search uploads"
        />
      )}
    </div>
  );
}
