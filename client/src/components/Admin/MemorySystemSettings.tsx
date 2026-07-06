/* eslint-disable i18next/no-literal-string */
import { Input, Label, Switch } from '@librechat/client';
import type { TAdminMemorySettings } from 'librechat-data-provider';

type Props = {
  value: TAdminMemorySettings;
  modelEntries: ReadonlyArray<readonly [string, string[]]>;
  disabled?: boolean;
  onChange: (value: TAdminMemorySettings) => void;
};

const NumberField = ({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) => (
  <div>
    <Label htmlFor={id}>{label}</Label>
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className="mt-1"
    />
  </div>
);

const Toggle = ({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}) => (
  <div className="flex items-center justify-between gap-4 rounded-lg border border-border-light p-3">
    <div>
      <div className="font-medium text-text-primary">{label}</div>
      <div className="text-sm text-text-secondary">{description}</div>
    </div>
    <Switch
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      aria-label={label}
    />
  </div>
);

export default function MemorySystemSettings({ value, modelEntries, disabled, onChange }: Props) {
  const update = <K extends keyof TAdminMemorySettings>(
    key: K,
    nextValue: TAdminMemorySettings[K],
  ) => onChange({ ...value, [key]: nextValue });
  const availableProviders = modelEntries.map(([provider]) => provider);
  const availableModels = modelEntries.find(([provider]) => provider === value.provider)?.[1] ?? [];
  const providerOptions = availableProviders.includes(value.provider)
    ? availableProviders
    : [value.provider, ...availableProviders];
  const modelOptions = availableModels.includes(value.model)
    ? availableModels
    : [value.model, ...availableModels];

  return (
    <div className="rounded-xl border border-border-light bg-surface-primary p-4">
      <div>
        <div className="font-medium text-text-primary">Memory system</div>
        <div className="mt-1 text-sm text-text-secondary">
          Controls explicit memory intent detection, post-response extraction, storage limits, and
          audit behavior. Changes apply after the app-settings cache refreshes.
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Toggle
          label="Automatic memory mutations"
          description="Permit the memory worker to save or delete after an eligible user request."
          checked={value.automaticSaveEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => update('automaticSaveEnabled', checked)}
        />
        <Toggle
          label="Require explicit memory request"
          description="Block ordinary research, tool, formatting, and one-off task requests."
          checked={value.requireExplicitRequest}
          disabled={disabled}
          onCheckedChange={(checked) => update('requireExplicitRequest', checked)}
        />
        <Toggle
          label="Process after response"
          description="Let the memory worker use completed research and tool results."
          checked={value.processAfterResponse}
          disabled={disabled}
          onCheckedChange={(checked) => update('processAfterResponse', checked)}
        />
        <Toggle
          label="Include assistant/tool context"
          description="Include bounded final response and tool-result context in extraction."
          checked={value.includeAssistantContext}
          disabled={disabled}
          onCheckedChange={(checked) => update('includeAssistantContext', checked)}
        />
        <Toggle
          label="Consolidate related memories"
          description="Prompt the worker to update existing keys and avoid near-duplicates."
          checked={value.consolidateMemories}
          disabled={disabled}
          onCheckedChange={(checked) => update('consolidateMemories', checked)}
        />
        <Toggle
          label="Audit memory mutations"
          description="Store 90-day save, delete, rejection, failure, and no-action events."
          checked={value.auditEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => update('auditEnabled', checked)}
        />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="memory-provider">Provider</Label>
          <select
            id="memory-provider"
            value={value.provider}
            disabled={disabled}
            onChange={(event) => {
              const provider = event.target.value;
              const firstModel = modelEntries.find(([entry]) => entry === provider)?.[1]?.[0];
              onChange({ ...value, provider, model: firstModel ?? value.model });
            }}
            className="mt-1 h-10 w-full rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary"
          >
            {providerOptions.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
                {!availableProviders.includes(provider) ? ' (configured, unavailable)' : ''}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-text-secondary">
            Providers come from the signed-in administrator&apos;s effective model access.
          </div>
        </div>
        <div>
          <Label htmlFor="memory-model">Model</Label>
          <select
            id="memory-model"
            value={value.model}
            disabled={disabled}
            onChange={(event) => update('model', event.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-border-light bg-surface-primary px-3 text-sm text-text-primary"
          >
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
                {!availableModels.includes(model) ? ' (configured, unavailable)' : ''}
              </option>
            ))}
          </select>
          <div className="mt-1 text-xs text-text-secondary">
            Models are the currently available models for the selected provider.
          </div>
        </div>
        <NumberField
          id="memory-window"
          label="Recent message window"
          value={value.messageWindowSize}
          min={1}
          max={20}
          disabled={disabled}
          onChange={(next) => update('messageWindowSize', next)}
        />
        <NumberField
          id="memory-context-limit"
          label="Extraction context character limit"
          value={value.contextCharLimit}
          min={1000}
          max={100000}
          disabled={disabled}
          onChange={(next) => update('contextCharLimit', next)}
        />
        <NumberField
          id="memory-max-writes"
          label="Maximum writes per turn"
          value={value.maxWritesPerTurn}
          min={1}
          max={10}
          disabled={disabled}
          onChange={(next) => update('maxWritesPerTurn', next)}
        />
        <NumberField
          id="memory-max-attempts"
          label="Worker attempts"
          value={value.maxAttempts}
          min={1}
          max={3}
          disabled={disabled}
          onChange={(next) => update('maxAttempts', next)}
        />
        <NumberField
          id="memory-timeout"
          label="Processing timeout (milliseconds)"
          value={value.processingTimeoutMs}
          min={1000}
          max={60000}
          disabled={disabled}
          onChange={(next) => update('processingTimeoutMs', next)}
        />
        <NumberField
          id="memory-total-tokens"
          label="Total memory token limit"
          value={value.tokenLimit ?? 6000}
          min={100}
          max={100000}
          disabled={disabled}
          onChange={(next) => update('tokenLimit', next)}
        />
        <NumberField
          id="memory-value-tokens"
          label="Maximum tokens per memory"
          value={value.maxValueTokens}
          min={25}
          max={5000}
          disabled={disabled}
          onChange={(next) => update('maxValueTokens', next)}
        />
        <NumberField
          id="memory-char-limit"
          label="Maximum characters per memory"
          value={value.charLimit}
          min={100}
          max={50000}
          disabled={disabled}
          onChange={(next) => update('charLimit', next)}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="memory-valid-keys">Allowed keys</Label>
          <div className="mt-1 text-xs text-text-secondary">
            Optional comma-separated lowercase snake_case keys. Empty allows normalized dynamic
            keys.
          </div>
          <textarea
            id="memory-valid-keys"
            rows={4}
            value={value.validKeys.join(', ')}
            disabled={disabled}
            onChange={(event) =>
              update(
                'validKeys',
                event.target.value
                  .split(',')
                  .map((key) => key.trim())
                  .filter(Boolean),
              )
            }
            className="mt-2 w-full rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary"
          />
        </div>
        <div>
          <Label htmlFor="memory-intent-phrases">Additional intent phrases</Label>
          <div className="mt-1 text-xs text-text-secondary">
            One phrase per line. Matching is case-insensitive and treated as an explicit save
            request.
          </div>
          <textarea
            id="memory-intent-phrases"
            rows={4}
            value={value.customIntentPhrases.join('\n')}
            disabled={disabled}
            onChange={(event) =>
              update(
                'customIntentPhrases',
                event.target.value
                  .split('\n')
                  .map((phrase) => phrase.trim())
                  .filter(Boolean),
              )
            }
            className="mt-2 w-full rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary"
          />
        </div>
      </div>

      <div className="mt-4">
        <Label htmlFor="memory-instructions">Advanced memory worker instructions</Label>
        <div className="mt-1 text-xs text-text-secondary">
          Leave empty to use the hardened built-in prompt. A custom prompt replaces the built-in
          prompt and can weaken safety guarantees.
        </div>
        <textarea
          id="memory-instructions"
          rows={8}
          maxLength={20000}
          value={value.instructions ?? ''}
          disabled={disabled}
          onChange={(event) => update('instructions', event.target.value || null)}
          className="mt-2 w-full rounded-md border border-border-light bg-transparent px-3 py-2 text-sm text-text-primary"
        />
      </div>
    </div>
  );
}
