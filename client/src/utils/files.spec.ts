import type { EndpointFileConfig } from 'librechat-data-provider';
import { validateFiles } from './files';

describe('validateFiles', () => {
  it('does not reject uploads solely because they exceed fileLimit', () => {
    const setError = jest.fn();
    const endpointFileConfig: EndpointFileConfig = {
      fileLimit: 1,
      fileSizeLimit: 10 * 1024 * 1024,
      totalSizeLimit: 20 * 1024 * 1024,
      supportedMimeTypes: [/^text\/plain$/],
      disabled: false,
    };

    const result = validateFiles({
      files: new Map(),
      fileList: [
        new File(['first'], 'first.txt', { type: 'text/plain' }),
        new File(['second'], 'second.txt', { type: 'text/plain' }),
      ],
      setError,
      endpointFileConfig,
      fileConfig: null,
    });

    expect(result).toBe(true);
    expect(setError).not.toHaveBeenCalled();
  });
});
