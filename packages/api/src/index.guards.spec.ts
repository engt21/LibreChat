/**
 * REGRESSION GUARDS for the public surface of @librechat/api.
 *
 * `api/server/routes/config.js` and friends import a fixed set of helpers from this
 * package by NAME. If any of those names disappears from `index.ts`'s re-export tree,
 * the API container crash-loops on startup OR `/api/config` throws on every request.
 * Either way the BadgeRow / Settings tabs in the SPA quietly break.
 *
 * Pinning the surface here makes accidental drops loud (red CI), instead of silent
 * (white-screen-of-death in production).
 */

import * as pkg from './index';

const REQUIRED_EXPORTS = [
  // Model capabilities (consumed by api/server/routes/config.js)
  'getAnthropicModelCapabilities',
  'getGoogleModelCapabilities',
  'getXAIModelCapabilities',
  // Underlying model discovery helpers
  'getAnthropicModels',
  'getGoogleModels',
  'fetchOpenAIModels',
  'getOpenAIModels',
  // Image generation discovery (consumed by api/server/controllers/ImageGenerationController.js)
  'discoverImageModels',
];

describe('@librechat/api -- public surface guard', () => {
  for (const name of REQUIRED_EXPORTS) {
    it(`re-exports ${name}`, () => {
      expect(typeof (pkg as Record<string, unknown>)[name]).toBe('function');
    });
  }
});
