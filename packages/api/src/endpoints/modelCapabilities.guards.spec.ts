/**
 * REGRESSION GUARDS for the server-side modelCapabilities exports.
 *
 * On 2026-04-26 a regression took down the entire chat-bar tool selector and Settings
 * tab visibility for the new Image generation feature. The trigger:
 * `api/server/routes/config.js` imports
 *   `{ getAnthropicModelCapabilities, getGoogleModelCapabilities, getXAIModelCapabilities }`
 * from `@librechat/api`. The Anthropic helper had been added to `librechat-data-provider`
 * (with a different signature meant for the client) but never re-exported from the
 * server-side `@librechat/api` package. Every request to `/api/config` therefore threw
 * `getAnthropicModelCapabilities is not a function`, and `useGetStartupConfig` broke
 * silently in the client, which gates the entire BadgeRow + Settings tab ecosystem.
 *
 * This test pins the public surface of `@librechat/api` so the same symbol can never be
 * silently dropped again.
 */

import * as endpoints from './models';

describe('@librechat/api endpoints/models -- public capability helpers guard', () => {
  it('exports getAnthropicModelCapabilities as a function', () => {
    expect(typeof endpoints.getAnthropicModelCapabilities).toBe('function');
  });

  it('exports getGoogleModelCapabilities as a function', () => {
    expect(typeof endpoints.getGoogleModelCapabilities).toBe('function');
  });

  it('exports getXAIModelCapabilities as a function', () => {
    expect(typeof endpoints.getXAIModelCapabilities).toBe('function');
  });

  it('all three capability helpers accept an options object (not positional args)', () => {
    /**
     * Function arity check. All three were unified to `(opts: { user, ..., forceRefresh })`
     * to match how `api/server/routes/config.js` calls them. If a future refactor changes
     * any of them back to positional `(user, vertexModels)` style, the call site in
     * `config.js` will silently break.
     */
    expect(endpoints.getAnthropicModelCapabilities.length).toBeLessThanOrEqual(1);
    expect(endpoints.getGoogleModelCapabilities.length).toBeLessThanOrEqual(1);
    expect(endpoints.getXAIModelCapabilities.length).toBeLessThanOrEqual(1);
  });
});
