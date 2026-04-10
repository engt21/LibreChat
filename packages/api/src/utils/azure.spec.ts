import {
  genAzureChatCompletion,
  getAzureCredentials,
  constructAzureURL,
  sanitizeModelName,
  genAzureEndpoint,
  isAzureOpenAIBaseURL,
  normalizeAzureOpenAIBaseURL,
  resolveAzureOpenAIDirectConfig,
  supportsAzureOpenAIModelListing,
} from './azure';
import type { GenericClient } from '~/types';

describe('sanitizeModelName', () => {
  test('removes periods from the model name', () => {
    const sanitized = sanitizeModelName('model.name');
    expect(sanitized).toBe('modelname');
  });

  test('leaves model name unchanged if no periods are present', () => {
    const sanitized = sanitizeModelName('modelname');
    expect(sanitized).toBe('modelname');
  });
});

describe('genAzureEndpoint', () => {
  test('generates correct endpoint URL', () => {
    const url = genAzureEndpoint({
      azureOpenAIApiInstanceName: 'instanceName',
      azureOpenAIApiDeploymentName: 'deploymentName',
    });
    expect(url).toBe('https://instanceName.openai.azure.com/openai/deployments/deploymentName');
  });
});

describe('genAzureChatCompletion', () => {
  // Test with both deployment name and model name provided
  test('prefers model name over deployment name when both are provided and feature enabled', () => {
    process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = 'true';
    const url = genAzureChatCompletion(
      {
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiDeploymentName: 'deploymentName',
        azureOpenAIApiVersion: 'v1',
      },
      'modelName',
    );
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/modelName/chat/completions?api-version=v1',
    );
  });

  // Test with only deployment name provided
  test('uses deployment name when model name is not provided', () => {
    const url = genAzureChatCompletion({
      azureOpenAIApiInstanceName: 'instanceName',
      azureOpenAIApiDeploymentName: 'deploymentName',
      azureOpenAIApiVersion: 'v1',
    });
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/deploymentName/chat/completions?api-version=v1',
    );
  });

  // Test with only model name provided
  test('uses model name when deployment name is not provided and feature enabled', () => {
    process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = 'true';
    const url = genAzureChatCompletion(
      {
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiVersion: 'v1',
      },
      'modelName',
    );
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/modelName/chat/completions?api-version=v1',
    );
  });

  // Test with neither deployment name nor model name provided
  test('throws error if neither deployment name nor model name is provided', () => {
    expect(() => {
      genAzureChatCompletion({
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiVersion: 'v1',
      });
    }).toThrow(
      'Either a model name with the `AZURE_USE_MODEL_AS_DEPLOYMENT_NAME` setting or a deployment name must be provided if `AZURE_OPENAI_BASEURL` is omitted.',
    );
  });

  // Test with feature disabled but model name provided
  test('ignores model name and uses deployment name when feature is disabled', () => {
    process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = 'false';
    const url = genAzureChatCompletion(
      {
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiDeploymentName: 'deploymentName',
        azureOpenAIApiVersion: 'v1',
      },
      'modelName',
    );
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/deploymentName/chat/completions?api-version=v1',
    );
  });

  // Test with sanitized model name
  test('sanitizes model name when used in URL', () => {
    process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = 'true';
    const url = genAzureChatCompletion(
      {
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiVersion: 'v1',
      },
      'model.name',
    );
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/modelname/chat/completions?api-version=v1',
    );
  });

  // Test with client parameter and model name
  test('updates client with sanitized model name when provided and feature enabled', () => {
    process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = 'true';
    const clientMock = { azure: {} } as GenericClient;
    const url = genAzureChatCompletion(
      {
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiVersion: 'v1',
      },
      'model.name',
      clientMock,
    );
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/modelname/chat/completions?api-version=v1',
    );
    expect(clientMock.azure.azureOpenAIApiDeploymentName).toBe('modelname');
  });

  // Test with client parameter but without model name
  test('does not update client when model name is not provided', () => {
    const clientMock = { azure: {} } as GenericClient;
    const url = genAzureChatCompletion(
      {
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiDeploymentName: 'deploymentName',
        azureOpenAIApiVersion: 'v1',
      },
      undefined,
      clientMock,
    );
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/deploymentName/chat/completions?api-version=v1',
    );
    expect(clientMock.azure.azureOpenAIApiDeploymentName).toBeUndefined();
  });

  // Test with client parameter and deployment name when feature is disabled
  test('does not update client when feature is disabled', () => {
    process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME = 'false';
    const clientMock = { azure: {} } as GenericClient;
    const url = genAzureChatCompletion(
      {
        azureOpenAIApiInstanceName: 'instanceName',
        azureOpenAIApiDeploymentName: 'deploymentName',
        azureOpenAIApiVersion: 'v1',
      },
      'modelName',
      clientMock,
    );
    expect(url).toBe(
      'https://instanceName.openai.azure.com/openai/deployments/deploymentName/chat/completions?api-version=v1',
    );
    expect(clientMock.azure.azureOpenAIApiDeploymentName).toBeUndefined();
  });

  // Reset environment variable after tests
  afterEach(() => {
    delete process.env.AZURE_USE_MODEL_AS_DEPLOYMENT_NAME;
  });
});

describe('getAzureCredentials', () => {
  beforeEach(() => {
    process.env.AZURE_API_KEY = 'testApiKey';
    process.env.AZURE_OPENAI_API_INSTANCE_NAME = 'instanceName';
    process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME = 'deploymentName';
    process.env.AZURE_OPENAI_API_VERSION = 'v1';
  });

  test('retrieves Azure OpenAI API credentials from environment variables', () => {
    const credentials = getAzureCredentials();
    expect(credentials).toEqual({
      azureOpenAIApiKey: 'testApiKey',
      azureOpenAIApiInstanceName: 'instanceName',
      azureOpenAIApiDeploymentName: 'deploymentName',
      azureOpenAIApiVersion: 'v1',
    });
  });
});

describe('normalizeAzureOpenAIBaseURL', () => {
  test('normalizes Azure OpenAI resource URLs to the OpenAI v1 route', () => {
    const url = normalizeAzureOpenAIBaseURL('https://example.openai.azure.com');
    expect(url).toBe('https://example.openai.azure.com/openai/v1');
  });

  test('normalizes Azure AI Foundry project URLs to the OpenAI v1 route', () => {
    const url = normalizeAzureOpenAIBaseURL(
      'https://example.services.ai.azure.com/api/projects/demo-project',
    );
    expect(url).toBe('https://example.services.ai.azure.com/api/projects/demo-project/openai/v1');
  });

  test('strips direct inference operation paths for legacy inference endpoints', () => {
    const url = normalizeAzureOpenAIBaseURL(
      'https://example.models.ai.azure.com/v1/chat/completions',
    );
    expect(url).toBe('https://example.models.ai.azure.com/v1');
  });

  test('returns undefined for null/undefined/empty input', () => {
    expect(normalizeAzureOpenAIBaseURL(null)).toBeUndefined();
    expect(normalizeAzureOpenAIBaseURL(undefined)).toBeUndefined();
    expect(normalizeAzureOpenAIBaseURL('')).toBeUndefined();
  });

  test('preserves already-normalized /openai/v1 paths', () => {
    const url = normalizeAzureOpenAIBaseURL('https://example.openai.azure.com/openai/v1');
    expect(url).toBe('https://example.openai.azure.com/openai/v1');
  });

  test('normalizes cognitiveservices.azure.com endpoints', () => {
    const url = normalizeAzureOpenAIBaseURL('https://example.cognitiveservices.azure.com');
    expect(url).toBe('https://example.cognitiveservices.azure.com/openai/v1');
  });

  test('strips trailing deployment path from Azure OpenAI resource URLs', () => {
    const url = normalizeAzureOpenAIBaseURL(
      'https://example.openai.azure.com/openai/deployments/gpt-4',
    );
    expect(url).toBe('https://example.openai.azure.com/openai/v1');
  });

  test('normalizes Azure AI Foundry project URL with trailing /openai suffix', () => {
    const url = normalizeAzureOpenAIBaseURL(
      'https://example.services.ai.azure.com/api/projects/my-project/openai',
    );
    expect(url).toBe('https://example.services.ai.azure.com/api/projects/my-project/openai/v1');
  });

  test('passes non-Azure URLs through unchanged', () => {
    const url = normalizeAzureOpenAIBaseURL('https://api.openai.com/v1');
    expect(url).toBe('https://api.openai.com/v1');
  });

  test('handles legacy inference endpoints with bare /v1', () => {
    const url = normalizeAzureOpenAIBaseURL('https://example.models.ai.azure.com/v1');
    expect(url).toBe('https://example.models.ai.azure.com/v1');
  });

  test('normalizes legacy inference endpoints from root to /v1', () => {
    const url = normalizeAzureOpenAIBaseURL('https://example.inference.ai.azure.com');
    expect(url).toBe('https://example.inference.ai.azure.com/v1');
  });
});

describe('Azure endpoint helpers', () => {
  test('detects Azure-hosted model endpoints', () => {
    expect(isAzureOpenAIBaseURL('https://example.services.ai.azure.com/openai/v1')).toBe(true);
    expect(isAzureOpenAIBaseURL('https://api.openai.com/v1')).toBe(false);
  });

  test('detects whether Azure model listing is supported only for explicit /openai/v1 paths', () => {
    // Explicit /openai/v1 → supported (no api-version needed)
    expect(supportsAzureOpenAIModelListing('https://example.openai.azure.com/openai/v1')).toBe(
      true,
    );
    // Bare root Azure resource → NOT supported (legacy shape, needs api-version)
    expect(supportsAzureOpenAIModelListing('https://example.openai.azure.com')).toBe(false);
    // Legacy inference host → NOT supported
    expect(supportsAzureOpenAIModelListing('https://example.models.ai.azure.com/v1')).toBe(false);
  });

  test('isAzureOpenAIBaseURL returns false for null/undefined/empty', () => {
    expect(isAzureOpenAIBaseURL(null)).toBe(false);
    expect(isAzureOpenAIBaseURL(undefined)).toBe(false);
    expect(isAzureOpenAIBaseURL('')).toBe(false);
  });

  test('isAzureOpenAIBaseURL detects all Azure host patterns', () => {
    expect(isAzureOpenAIBaseURL('https://my-resource.openai.azure.com/openai/v1')).toBe(true);
    expect(isAzureOpenAIBaseURL('https://my-resource.cognitiveservices.azure.com')).toBe(true);
    expect(isAzureOpenAIBaseURL('https://my-resource.services.ai.azure.com')).toBe(true);
    expect(isAzureOpenAIBaseURL('https://my-resource.models.ai.azure.com')).toBe(true);
    expect(isAzureOpenAIBaseURL('https://my-resource.inference.ai.azure.com')).toBe(true);
  });

  test('supportsAzureOpenAIModelListing returns false for null/undefined', () => {
    expect(supportsAzureOpenAIModelListing(null)).toBe(false);
    expect(supportsAzureOpenAIModelListing(undefined)).toBe(false);
  });

  test('supportsAzureOpenAIModelListing allows AI Foundry project paths (all forms)', () => {
    expect(
      supportsAzureOpenAIModelListing(
        'https://example.services.ai.azure.com/api/projects/my-proj/openai/v1',
      ),
    ).toBe(true);
    // AI Foundry project without /openai/v1 suffix is still a direct-v1 shape
    expect(
      supportsAzureOpenAIModelListing(
        'https://example.services.ai.azure.com/api/projects/my-proj',
      ),
    ).toBe(true);
    expect(
      supportsAzureOpenAIModelListing(
        'https://example.services.ai.azure.com/api/projects/my-proj/openai',
      ),
    ).toBe(true);
  });

  test('supportsAzureOpenAIModelListing returns false for deployment and bare root URLs', () => {
    expect(
      supportsAzureOpenAIModelListing('https://example.openai.azure.com'),
    ).toBe(false);
    expect(
      supportsAzureOpenAIModelListing(
        'https://example.openai.azure.com/openai/deployments/gpt-4',
      ),
    ).toBe(false);
  });
});

describe('resolveAzureOpenAIDirectConfig', () => {
  test('parses legacy stored Azure credentials and preserves the un-normalised root URL', () => {
    const config = resolveAzureOpenAIDirectConfig({
      apiKey: JSON.stringify({
        azureOpenAIApiKey: 'azure-key',
        azureOpenAIApiInstanceName: 'example-instance',
        azureOpenAIApiDeploymentName: 'gpt-4.1-prod',
        azureOpenAIApiVersion: '2024-10-21',
      }),
      models: 'gpt-4.1-prod, gpt-4o-mini',
    });

    // The URL is the bare root resolved from the instance name – not normalised
    // to /openai/v1 – so callers can distinguish legacy shapes from direct /openai/v1.
    expect(config).toMatchObject({
      apiKey: 'azure-key',
      baseURL: 'https://example-instance.openai.azure.com',
      manualModels: ['gpt-4.1-prod', 'gpt-4o-mini'],
      isLegacyCredentialPayload: true,
    });
  });

  test('parses plain API key with explicit baseURL', () => {
    const config = resolveAzureOpenAIDirectConfig({
      apiKey: 'plain-api-key',
      baseURL: 'https://my-resource.openai.azure.com/openai/v1',
      models: ['gpt-4o', 'gpt-4.1'],
    });

    expect(config).toMatchObject({
      apiKey: 'plain-api-key',
      baseURL: 'https://my-resource.openai.azure.com/openai/v1',
      manualModels: ['gpt-4o', 'gpt-4.1'],
      isLegacyCredentialPayload: false,
    });
    expect(config.azureOptions).toBeUndefined();
  });

  test('handles missing apiKey and baseURL gracefully', () => {
    const config = resolveAzureOpenAIDirectConfig({});

    expect(config.apiKey).toBeUndefined();
    expect(config.baseURL).toBeUndefined();
    expect(config.manualModels).toEqual([]);
    expect(config.isLegacyCredentialPayload).toBe(false);
  });

  test('splits comma-separated model string and trims whitespace', () => {
    const config = resolveAzureOpenAIDirectConfig({
      models: '  gpt-4o , gpt-4.1-mini , ',
    });

    expect(config.manualModels).toEqual(['gpt-4o', 'gpt-4.1-mini']);
  });

  test('resolves legacy instance name to bare Azure base URL without normalising path', () => {
    const config = resolveAzureOpenAIDirectConfig({
      apiKey: JSON.stringify({
        azureOpenAIApiKey: 'key',
        azureOpenAIApiInstanceName: 'my-instance.cognitiveservices.azure.com',
        azureOpenAIApiDeploymentName: 'dep',
        azureOpenAIApiVersion: '2024-10-21',
      }),
    });

    // Bare root – not normalised to /openai/v1
    expect(config.baseURL).toBe('https://my-instance.cognitiveservices.azure.com');
  });
});

describe('constructAzureURL', () => {
  test('replaces both placeholders when both properties are provided', () => {
    const url = constructAzureURL({
      baseURL: 'https://example.com/${INSTANCE_NAME}/${DEPLOYMENT_NAME}',
      azureOptions: {
        azureOpenAIApiInstanceName: 'instance1',
        azureOpenAIApiDeploymentName: 'deployment1',
      },
    });
    expect(url).toBe('https://example.com/instance1/deployment1');
  });

  test('replaces only INSTANCE_NAME when only azureOpenAIApiInstanceName is provided', () => {
    const url = constructAzureURL({
      baseURL: 'https://example.com/${INSTANCE_NAME}/${DEPLOYMENT_NAME}',
      azureOptions: {
        azureOpenAIApiInstanceName: 'instance2',
      },
    });
    expect(url).toBe('https://example.com/instance2/');
  });

  test('replaces only DEPLOYMENT_NAME when only azureOpenAIApiDeploymentName is provided', () => {
    const url = constructAzureURL({
      baseURL: 'https://example.com/${INSTANCE_NAME}/${DEPLOYMENT_NAME}',
      azureOptions: {
        azureOpenAIApiDeploymentName: 'deployment2',
      },
    });
    expect(url).toBe('https://example.com//deployment2');
  });

  test('does not replace any placeholders when azure object is empty', () => {
    const url = constructAzureURL({
      baseURL: 'https://example.com/${INSTANCE_NAME}/${DEPLOYMENT_NAME}',
      azureOptions: {},
    });
    expect(url).toBe('https://example.com//');
  });

  test('returns baseURL as is when `azureOptions` object is not provided', () => {
    const url = constructAzureURL({
      baseURL: 'https://example.com/${INSTANCE_NAME}/${DEPLOYMENT_NAME}',
    });
    expect(url).toBe('https://example.com/${INSTANCE_NAME}/${DEPLOYMENT_NAME}');
  });

  test('returns baseURL as is when no placeholders are set', () => {
    const url = constructAzureURL({
      baseURL: 'https://example.com/my_custom_instance/my_deployment',
      azureOptions: {
        azureOpenAIApiInstanceName: 'instance1',
        azureOpenAIApiDeploymentName: 'deployment1',
      },
    });
    expect(url).toBe('https://example.com/my_custom_instance/my_deployment');
  });

  test('returns regular Azure OpenAI baseURL with placeholders set', () => {
    const baseURL =
      'https://${INSTANCE_NAME}.openai.azure.com/openai/deployments/${DEPLOYMENT_NAME}';
    const url = constructAzureURL({
      baseURL,
      azureOptions: {
        azureOpenAIApiInstanceName: 'instance1',
        azureOpenAIApiDeploymentName: 'deployment1',
      },
    });
    expect(url).toBe('https://instance1.openai.azure.com/openai/deployments/deployment1');
  });
});
