import * as endpoints from './api-endpoints';
import {
  createGenerationGraft,
  getGenerationGraft,
  previewGenerationGraft,
  undoGenerationGraft,
} from './data-service';
import request from './request';

jest.mock('./request', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
    deleteWithOptions: jest.fn(),
  },
}));

const mockedRequest = jest.mocked(request);

describe('generation graft endpoints', () => {
  beforeEach(() => {
    mockedRequest.post.mockReset();
    mockedRequest.get.mockReset();
    mockedRequest.deleteWithOptions.mockReset();

    mockedRequest.post.mockResolvedValue(undefined);
    mockedRequest.get.mockResolvedValue(undefined);
    mockedRequest.deleteWithOptions.mockResolvedValue(undefined);
  });

  it('exports the canonical generation graft routes', () => {
    expect(endpoints.generationGraftPreview('convo-1')).toBe('/api/messages/convo-1/grafts/preview');
    expect(endpoints.generationGrafts('convo-1')).toBe('/api/messages/convo-1/grafts');
    expect(endpoints.generationGraft('convo-1', 'graft-1')).toBe(
      '/api/messages/convo-1/grafts/graft-1',
    );
  });

  it('encodes conversation and graft identifiers in generation graft routes', () => {
    expect(endpoints.generationGrafts('convo 1/2')).toBe('/api/messages/convo%201%2F2/grafts');
    expect(endpoints.generationGraftPreview('convo 1/2')).toBe(
      '/api/messages/convo%201%2F2/grafts/preview',
    );
    expect(endpoints.generationGraft('convo 1/2', 'graft 1/2')).toBe(
      '/api/messages/convo%201%2F2/grafts/graft%201%2F2',
    );
  });

  it('composes generationGrafts from the shared messages root helper', () => {
    expect(String(endpoints.generationGrafts)).toContain('messagesRoot');
  });

  it('posts previewGenerationGraft payloads to the preview route', async () => {
    const payload = {
      sourceMessageId: 'source-1',
      destinationMessageId: 'destination-1',
      mode: 'generation' as const,
      expectedTreeRevision: 'rev-1',
    };

    await previewGenerationGraft('convo 1/2', payload);

    expect(mockedRequest.post).toHaveBeenCalledWith(
      '/api/messages/convo%201%2F2/grafts/preview',
      payload,
    );
  });

  it('posts createGenerationGraft payloads to the collection route', async () => {
    const payload = {
      sourceMessageId: 'source-1',
      destinationMessageId: 'destination-1',
      mode: 'subtree' as const,
      idempotencyKey: 'idem-1',
      expectedTreeRevision: 'rev-2',
    };

    await createGenerationGraft('convo 1/2', payload);

    expect(mockedRequest.post).toHaveBeenCalledWith('/api/messages/convo%201%2F2/grafts', payload);
  });

  it('gets generation graft details from the graft route', async () => {
    await getGenerationGraft('convo 1/2', 'graft 1/2');

    expect(mockedRequest.get).toHaveBeenCalledWith(
      '/api/messages/convo%201%2F2/grafts/graft%201%2F2',
    );
  });

  it('deletes generation grafts with an options payload for undo', async () => {
    const payload = { includeContinuations: true };

    await undoGenerationGraft('convo 1/2', 'graft 1/2', payload);

    expect(mockedRequest.deleteWithOptions).toHaveBeenCalledWith(
      '/api/messages/convo%201%2F2/grafts/graft%201%2F2',
      { data: payload },
    );
  });
});
