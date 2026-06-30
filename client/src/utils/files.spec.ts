import { EToolResources } from 'librechat-data-provider';
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

  it('allows raw files with unknown MIME type for code interpreter uploads', () => {
    const setError = jest.fn();
    const endpointFileConfig: EndpointFileConfig = {
      fileLimit: 10,
      fileSizeLimit: 10 * 1024 * 1024,
      totalSizeLimit: 20 * 1024 * 1024,
      supportedMimeTypes: [/^text\/plain$/],
      disabled: false,
    };

    const result = validateFiles({
      files: new Map(),
      fileList: [new File(['raw'], 'sample.custom-binary')],
      setError,
      endpointFileConfig,
      toolResource: EToolResources.execute_code,
      fileConfig: null,
    });

    expect(result).toBe(true);
    expect(setError).not.toHaveBeenCalled();
  });

  it('still rejects unknown MIME types for non-code uploads', () => {
    const setError = jest.fn();
    const endpointFileConfig: EndpointFileConfig = {
      fileLimit: 10,
      fileSizeLimit: 10 * 1024 * 1024,
      totalSizeLimit: 20 * 1024 * 1024,
      supportedMimeTypes: [/^text\/plain$/],
      disabled: false,
    };

    const result = validateFiles({
      files: new Map(),
      fileList: [new File(['raw'], 'sample.custom-binary')],
      setError,
      endpointFileConfig,
      fileConfig: null,
    });

    expect(result).toBe(false);
    expect(setError).toHaveBeenCalledWith(
      'Unable to determine file type for: sample.custom-binary',
    );
  });
});
