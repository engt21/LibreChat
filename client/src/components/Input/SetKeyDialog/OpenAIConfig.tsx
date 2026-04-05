import { EModelEndpoint } from 'librechat-data-provider';
import { useFormContext, Controller } from 'react-hook-form';
import InputWithLabel from './InputWithLabel';

const OpenAIConfig = ({
  endpoint,
  userProvideURL,
}: {
  endpoint: EModelEndpoint | string;
  userProvideURL?: boolean | null;
}) => {
  const { control } = useFormContext();
  const isAzure = endpoint === EModelEndpoint.azureOpenAI;
  return (
    <form className="flex-wrap">
      <Controller
        name="apiKey"
        control={control}
        render={({ field }) => (
          <InputWithLabel
            id="apiKey"
            {...field}
            type="password"
            label={isAzure ? 'Azure API Key' : 'OpenAI API Key'}
            labelClassName="mb-1"
            inputClassName="mb-2"
          />
        )}
      />
      {userProvideURL && (
        <div className="mt-3">
          <Controller
            name="baseURL"
            control={control}
            render={({ field }) => (
              <InputWithLabel
                id="baseURL"
                {...field}
                label={isAzure ? 'Azure Endpoint' : 'API Base URL'}
                subLabel={isAzure ? '(Azure OpenAI or Foundry)' : undefined}
                labelClassName="mb-1"
              />
            )}
          />
        </div>
      )}
      {isAzure && (
        <Controller
          name="models"
          control={control}
          render={({ field }) => (
            <InputWithLabel
              id="models"
              {...field}
              label={'Deployment Names'}
              subLabel={'(Optional comma-separated fallback)'}
              labelClassName="mb-1"
            />
          )}
        />
      )}
    </form>
  );
};

export default OpenAIConfig;
