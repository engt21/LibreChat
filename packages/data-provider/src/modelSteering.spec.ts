import * as endpoints from './api-endpoints';
import { MutationKeys, QueryKeys } from './keys';
import {
  modelSteeringPrefsSchema,
  modelSteeringPrefsUpdateSchema,
  modelSteeringRequestSchema,
} from './modelSteering';

describe('model steering schemas and endpoints', () => {
  it('accepts model steering preferences', () => {
    expect(modelSteeringPrefsSchema.parse({ enabled: false })).toEqual({ enabled: false });
  });

  it('rejects unknown preference keys', () => {
    expect(() => modelSteeringPrefsSchema.parse({ enabled: true, unknown: true })).toThrow();
  });

  it('accepts partial preference updates', () => {
    expect(modelSteeringPrefsUpdateSchema.parse({})).toEqual({});
    expect(modelSteeringPrefsUpdateSchema.parse({ enabled: true })).toEqual({ enabled: true });
  });

  it('validates steering requests while preserving chat payload fields', () => {
    const parsed = modelSteeringRequestSchema.parse({
      text: '  Use bullets  ',
      conversationId: 'conversation-1',
      endpoint: 'openAI',
    });

    expect(parsed.text).toBe('Use bullets');
    expect(parsed.conversationId).toBe('conversation-1');
    expect(parsed.endpoint).toBe('openAI');
  });

  it('rejects empty steering text', () => {
    expect(() =>
      modelSteeringRequestSchema.parse({ text: '   ', conversationId: 'conversation-1' }),
    ).toThrow();
  });

  it('exports the canonical model steering prefs route and query keys', () => {
    expect(endpoints.modelSteeringPrefs().endsWith('/api/model-steering/prefs')).toBe(true);
    expect(QueryKeys.modelSteeringPrefs).toBe('modelSteeringPrefs');
    expect(MutationKeys.updateModelSteeringPrefs).toBe('updateModelSteeringPrefs');
  });
});
