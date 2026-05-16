import {
  ImageGenProvider,
  azureOpenAIKnownImageModels,
  fluxKnownModels,
  imageGenDefaultModel,
  imageGenProviderToolKey,
  imageGenerationPrefsSchema,
  imageGenerationPrefsUpdateSchema,
  isGoogleImageModelName,
  isOpenAIImageModelName,
  isXAIImageModelName,
  pickDefaultImageModel,
  sortImageModelsByRecency,
  stabilityKnownModels,
} from './imageGeneration';
import * as endpoints from './api-endpoints';
import { QueryKeys, MutationKeys } from './keys';

describe('imageGeneration helpers', () => {
  describe('isOpenAIImageModelName', () => {
    it.each([
      ['gpt-image-1', true],
      ['gpt-image-2-mini', true],
      ['dall-e-3', true],
      ['dalle-3', true],
      ['dall-e', true],
      ['gpt-4o', false],
      ['', false],
      [null, false],
      [undefined, false],
    ])('returns %p for input %p', (input, expected) => {
      expect(isOpenAIImageModelName(input as string | null | undefined)).toBe(expected);
    });
  });

  describe('isXAIImageModelName', () => {
    it('matches grok-image variants', () => {
      expect(isXAIImageModelName('grok-2-image')).toBe(true);
      expect(isXAIImageModelName('grok-3-image')).toBe(true);
      expect(isXAIImageModelName('grok-image')).toBe(true);
    });
    it('rejects non-image grok models', () => {
      expect(isXAIImageModelName('grok-4-fast')).toBe(false);
      expect(isXAIImageModelName('grok-3')).toBe(false);
    });
  });

  describe('isGoogleImageModelName', () => {
    it('matches Imagen and image-modality Gemini models', () => {
      expect(isGoogleImageModelName('imagen-3.0-generate-002')).toBe(true);
      expect(isGoogleImageModelName('imagen-4')).toBe(true);
      expect(isGoogleImageModelName('gemini-2.5-flash-image')).toBe(true);
      expect(isGoogleImageModelName('gemini-2.5-flash-image-preview')).toBe(true);
      expect(isGoogleImageModelName('models/gemini-2.5-flash-image-nano-banana')).toBe(true);
    });
    it('rejects pure-text Gemini models', () => {
      expect(isGoogleImageModelName('gemini-2.5-pro')).toBe(false);
      expect(isGoogleImageModelName('gemini-2.5-flash')).toBe(false);
    });
  });

  describe('sortImageModelsByRecency', () => {
    it('sorts by releasedAt descending and falls back to numeric collator', () => {
      const sorted = sortImageModelsByRecency([
        { id: 'a-1', releasedAt: '2024-01-01' },
        { id: 'a-2', releasedAt: '2025-01-01' },
        { id: 'a-3' },
      ]);
      expect(sorted.map((m) => m.id)).toEqual(['a-2', 'a-1', 'a-3']);
    });

    it('treats higher numeric suffix as newer when releasedAt is missing', () => {
      const sorted = sortImageModelsByRecency([{ id: 'gpt-image-1' }, { id: 'gpt-image-2' }]);
      expect(sorted[0].id).toBe('gpt-image-2');
    });

    it('does not mutate the source array', () => {
      const input = [{ id: 'a-1' }, { id: 'a-2' }];
      const before = [...input];
      sortImageModelsByRecency(input);
      expect(input).toEqual(before);
    });
  });

  describe('pickDefaultImageModel', () => {
    it('picks the canonical default when present', () => {
      const result = pickDefaultImageModel(ImageGenProvider.openai, [
        { id: 'gpt-image-1' },
        { id: 'dall-e-3' },
      ]);
      expect(result).toBe(imageGenDefaultModel[ImageGenProvider.openai]);
    });

    it('falls back to the first list entry if canonical default missing', () => {
      const result = pickDefaultImageModel(ImageGenProvider.flux, [
        { id: 'flux-non-existent', releasedAt: '2030-01-01' },
        { id: 'flux-other' },
      ]);
      expect(result).toBe('flux-non-existent');
    });

    it('returns undefined for an empty list', () => {
      expect(pickDefaultImageModel(ImageGenProvider.openai, [])).toBeUndefined();
    });
  });

  describe('curated lists', () => {
    it('azure known image models include gpt-image-2 first', () => {
      expect(azureOpenAIKnownImageModels[0].id).toBe('gpt-image-2');
      expect(imageGenDefaultModel[ImageGenProvider.azureOpenAI]).toBe('gpt-image-2');
    });

    it('flux known models are non-empty and sorted newest-first', () => {
      expect(fluxKnownModels.length).toBeGreaterThan(0);
      const sorted = sortImageModelsByRecency(fluxKnownModels);
      expect(sorted[0].id).toBe(fluxKnownModels[0].id);
    });

    it('stability known models are non-empty and sortable newest-first', () => {
      expect(stabilityKnownModels.length).toBeGreaterThan(0);
      const sorted = sortImageModelsByRecency(stabilityKnownModels);
      expect(sorted.length).toBe(stabilityKnownModels.length);
      // Highest releasedAt should bubble to the top.
      const newestRelease = stabilityKnownModels.reduce(
        (latest, model) =>
          model.releasedAt && (!latest || model.releasedAt > latest) ? model.releasedAt : latest,
        '' as string,
      );
      expect(sorted[0].releasedAt).toBe(newestRelease);
    });

    it('imageGenProviderToolKey covers every ImageGenProvider value', () => {
      for (const provider of Object.values(ImageGenProvider)) {
        expect(imageGenProviderToolKey[provider]).toBeTruthy();
      }
    });
  });

  describe('imageGenerationPrefs schemas', () => {
    it('accepts a fully populated prefs object', () => {
      const result = imageGenerationPrefsSchema.parse({
        enabledByDefault: true,
        preferredProvider: ImageGenProvider.openai,
        models: { openai: 'gpt-image-1', google: 'gemini-2.5-flash-image' },
      });
      expect(result.enabledByDefault).toBe(true);
      expect(result.preferredProvider).toBe(ImageGenProvider.openai);
      expect(result.models?.openai).toBe('gpt-image-1');
    });

    it('rejects unknown keys in strict mode', () => {
      expect(() =>
        imageGenerationPrefsSchema.parse({
          enabledByDefault: true,
          unknownKey: true,
        } as unknown),
      ).toThrow();
    });

    it('rejects unknown providers in preferredProvider', () => {
      expect(() =>
        imageGenerationPrefsSchema.parse({ preferredProvider: 'imagine-3' } as unknown),
      ).toThrow();
    });

    it('update schema accepts an empty object', () => {
      const result = imageGenerationPrefsUpdateSchema.parse({});
      expect(result).toEqual({});
    });

    it('update schema accepts partial updates', () => {
      const result = imageGenerationPrefsUpdateSchema.parse({
        models: { flux: 'flux-pro-1.1' },
      });
      expect(result.models?.flux).toBe('flux-pro-1.1');
    });
  });

  describe('image-generation API endpoints + react-query keys', () => {
    it('points imageGenerationModels at the canonical /api/image-generation/models route', () => {
      const url = endpoints.imageGenerationModels();
      expect(url.endsWith('/api/image-generation/models')).toBe(true);
    });

    it('points imageGenerationPrefs at the canonical /api/image-generation/prefs route', () => {
      const url = endpoints.imageGenerationPrefs();
      expect(url.endsWith('/api/image-generation/prefs')).toBe(true);
    });

    it('exports QueryKeys for image generation models and prefs', () => {
      expect(QueryKeys.imageGenerationModels).toBe('imageGenerationModels');
      expect(QueryKeys.imageGenerationPrefs).toBe('imageGenerationPrefs');
    });

    it('exports MutationKeys for updating image generation prefs', () => {
      expect(MutationKeys.updateImageGenerationPrefs).toBe('updateImageGenerationPrefs');
    });
  });
});
