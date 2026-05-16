import { z } from 'zod';

/**
 * Identifiers for image-generation providers exposed by LibreChat.
 * These are used both as keys in user preferences and as discriminators for
 * which underlying tool / API to dispatch to.
 */
export enum ImageGenProvider {
  openai = 'openai',
  azureOpenAI = 'azureOpenAI',
  google = 'google',
  vertex = 'vertex',
  xai = 'xai',
  flux = 'flux',
  stability = 'stability',
}

export const imageGenProviderOrder: ImageGenProvider[] = [
  ImageGenProvider.openai,
  ImageGenProvider.azureOpenAI,
  ImageGenProvider.google,
  ImageGenProvider.vertex,
  ImageGenProvider.xai,
  ImageGenProvider.flux,
  ImageGenProvider.stability,
];

export const imageGenProviderDisplayName: Record<ImageGenProvider, string> = {
  [ImageGenProvider.openai]: 'OpenAI',
  [ImageGenProvider.azureOpenAI]: 'Azure OpenAI',
  [ImageGenProvider.google]: 'Google Gemini',
  [ImageGenProvider.vertex]: 'Vertex AI',
  [ImageGenProvider.xai]: 'xAI',
  [ImageGenProvider.flux]: 'Black Forest Labs (Flux)',
  [ImageGenProvider.stability]: 'Stability AI',
};

/** Maps each provider to the LibreChat tool key that implements it. */
export const imageGenProviderToolKey: Record<ImageGenProvider, string> = {
  [ImageGenProvider.openai]: 'image_gen_oai',
  [ImageGenProvider.azureOpenAI]: 'image_gen_oai',
  [ImageGenProvider.google]: 'gemini_image_gen',
  [ImageGenProvider.vertex]: 'gemini_image_gen',
  [ImageGenProvider.xai]: 'image_gen_oai',
  [ImageGenProvider.flux]: 'flux',
  [ImageGenProvider.stability]: 'stable-diffusion',
};

/**
 * Patterns that identify image-generation models for OpenAI / Azure OpenAI / xAI.
 * Used both for `/v1/models` filtering and to recognize image-only models elsewhere.
 */
export const openAIImageModelPatterns: RegExp[] = [/^gpt-image(?:-|$)/i, /^dall-?e(?:-|$)/i];

export const xaiImageModelPatterns: RegExp[] = [
  /^grok(?:-[a-z0-9.]+)*-image(?:-|$)/i,
  /^grok-image(?:-|$)/i,
];

/**
 * Patterns that identify Google image models exposed via the Gemini API or Vertex AI.
 * Includes both Imagen-family models and image-modality Gemini models (e.g. nano-banana).
 */
export const googleImageModelPatterns: RegExp[] = [
  /^imagen(?:-|$)/i,
  /^gemini-[\d.]+-flash-image/i,
  /^gemini-[\d.]+-image/i,
  /nano-banana/i,
];

/** Bundled curated lists for providers that do not expose discoverable image-model APIs. */
export const azureOpenAIKnownImageModels: Array<{
  id: string;
  displayName: string;
  releasedAt?: string;
}> = [
  { id: 'gpt-image-2', displayName: 'GPT Image 2' },
  { id: 'gpt-image-1', displayName: 'GPT Image 1' },
];

export const fluxKnownModels: Array<{
  id: string;
  displayName: string;
  releasedAt?: string;
}> = [
  { id: 'flux-pro-1.1-ultra', displayName: 'FLUX 1.1 Pro Ultra', releasedAt: '2024-11-06' },
  { id: 'flux-pro-1.1', displayName: 'FLUX 1.1 Pro', releasedAt: '2024-10-03' },
  { id: 'flux-pro', displayName: 'FLUX Pro', releasedAt: '2024-08-01' },
  { id: 'flux-dev', displayName: 'FLUX Dev', releasedAt: '2024-08-01' },
];

export const stabilityKnownModels: Array<{
  id: string;
  displayName: string;
  releasedAt?: string;
}> = [
  { id: 'sd3.5-large', displayName: 'Stable Diffusion 3.5 Large', releasedAt: '2024-10-22' },
  {
    id: 'sd3.5-large-turbo',
    displayName: 'Stable Diffusion 3.5 Large Turbo',
    releasedAt: '2024-10-22',
  },
  { id: 'sd3.5-medium', displayName: 'Stable Diffusion 3.5 Medium', releasedAt: '2024-10-29' },
  { id: 'sd3-large', displayName: 'Stable Diffusion 3 Large', releasedAt: '2024-06-12' },
  { id: 'sd3-medium', displayName: 'Stable Diffusion 3 Medium', releasedAt: '2024-06-12' },
];

/** Per-provider hard-coded "latest preferred" defaults applied when a user has not chosen. */
export const imageGenDefaultModel: Record<ImageGenProvider, string> = {
  [ImageGenProvider.openai]: 'gpt-image-1',
  [ImageGenProvider.azureOpenAI]: 'gpt-image-2',
  [ImageGenProvider.google]: 'gemini-2.5-flash-image',
  [ImageGenProvider.vertex]: 'gemini-2.5-flash-image',
  [ImageGenProvider.xai]: 'grok-2-image',
  [ImageGenProvider.flux]: fluxKnownModels[0]?.id ?? 'flux-pro-1.1-ultra',
  [ImageGenProvider.stability]: stabilityKnownModels[0]?.id ?? 'sd3.5-large',
};

export interface TImageGenModel {
  /** Canonical model identifier (e.g. `gpt-image-1`). */
  id: string;
  /** Human-readable label for the settings UI. */
  displayName?: string;
  /** Loose ISO timestamp for "newest first" sorting; missing for unknown release dates. */
  releasedAt?: string;
  /** Marks the entry that should be picked by default when a user has saved no preference. */
  default?: boolean;
}

export interface TImageGenProviderInfo {
  id: ImageGenProvider;
  name: string;
  /** Whether the server has credentials (env or cached per-user) for this provider. */
  configured: boolean;
  /** Source of credentials: `server` from env, `user` from saved per-user values. */
  credentialSource?: 'server' | 'user' | 'none';
  /** Models discovered or curated for this provider (when configured). */
  models: TImageGenModel[];
  /**
   * Optional notice surfaced in the settings UI when discovery failed but a curated fallback
   * was returned, so users understand the list may be stale.
   */
  notice?: string;
}

export interface TImageGenModelsResponse {
  providers: TImageGenProviderInfo[];
}

/**
 * Tests whether a model identifier looks like an OpenAI / Azure / xAI image model.
 * Used to invert existing `OPENAI_EXCLUDED_MODEL_REGEX` filtering.
 */
export function isOpenAIImageModelName(model: string | null | undefined): boolean {
  const normalized = (model ?? '').trim();
  if (!normalized) return false;
  return openAIImageModelPatterns.some((pattern) => pattern.test(normalized));
}

export function isXAIImageModelName(model: string | null | undefined): boolean {
  const normalized = (model ?? '').trim();
  if (!normalized) return false;
  return xaiImageModelPatterns.some((pattern) => pattern.test(normalized));
}

export function isGoogleImageModelName(model: string | null | undefined): boolean {
  const normalized = (model ?? '').trim();
  if (!normalized) return false;
  return googleImageModelPatterns.some((pattern) => pattern.test(normalized));
}

/**
 * Heuristic "newest first" sort that prefers an explicit `releasedAt`, then a numeric-suffix
 * comparison on the id (so `gpt-image-1.5` beats `gpt-image-1`), then alphanumeric.
 */
export function sortImageModelsByRecency<T extends TImageGenModel>(models: T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...models].sort((a, b) => {
    if (a.releasedAt && b.releasedAt) {
      return b.releasedAt.localeCompare(a.releasedAt);
    }
    if (a.releasedAt && !b.releasedAt) return -1;
    if (!a.releasedAt && b.releasedAt) return 1;
    return collator.compare(b.id, a.id);
  });
}

/**
 * Returns the preferred default model for a provider given a discovered/curated list.
 * Falls back to the hard-coded `imageGenDefaultModel` mapping if the canonical default
 * is not present in the list, then to the first list entry.
 */
export function pickDefaultImageModel(
  provider: ImageGenProvider,
  models: TImageGenModel[],
): string | undefined {
  if (!models.length) return undefined;
  const hardCodedDefault = imageGenDefaultModel[provider];
  if (hardCodedDefault && models.some((model) => model.id === hardCodedDefault)) {
    return hardCodedDefault;
  }
  return models[0]?.id;
}

export const imageGenerationPrefsSchema = z
  .object({
    enabledByDefault: z.boolean().optional(),
    preferredProvider: z.nativeEnum(ImageGenProvider).optional(),
    models: z.record(z.string()).optional(),
  })
  .strict();

export type TImageGenerationPrefs = z.infer<typeof imageGenerationPrefsSchema>;

export const imageGenerationPrefsUpdateSchema = imageGenerationPrefsSchema.partial();
export type TImageGenerationPrefsUpdate = z.infer<typeof imageGenerationPrefsUpdateSchema>;
