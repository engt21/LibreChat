import React, { useEffect, useState } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { AuthKeys, EModelEndpoint, GoogleAuthMode, alternateName } from 'librechat-data-provider';
import {
  useRevokeUserKeyMutation,
  useRevokeAllUserKeysMutation,
} from 'librechat-data-provider/react-query';
import {
  Label,
  Button,
  Spinner,
  OGDialog,
  Dropdown,
  OGDialogTitle,
  OGDialogHeader,
  OGDialogFooter,
  OGDialogContent,
  useToastContext,
  OGDialogTrigger,
} from '@librechat/client';
import type { TDialogProps } from '~/common';
import { useUserKey, useLocalize } from '~/hooks';
import { NotificationSeverity } from '~/common';
import CustomConfig from './CustomEndpoint';
import GoogleConfig from './GoogleConfig';
import OpenAIConfig from './OpenAIConfig';
import OtherConfig from './OtherConfig';
import HelpText from './HelpText';
import { logger } from '~/utils';

const endpointComponents = {
  [EModelEndpoint.google]: GoogleConfig,
  [EModelEndpoint.openAI]: OpenAIConfig,
  [EModelEndpoint.custom]: CustomConfig,
  [EModelEndpoint.azureOpenAI]: OpenAIConfig,
  [EModelEndpoint.assistants]: OpenAIConfig,
  [EModelEndpoint.azureAssistants]: OpenAIConfig,
  default: OtherConfig,
};

const formSet: Set<string> = new Set([
  EModelEndpoint.openAI,
  EModelEndpoint.custom,
  EModelEndpoint.azureOpenAI,
  EModelEndpoint.assistants,
  EModelEndpoint.azureAssistants,
]);

const EXPIRY = {
  THIRTY_MINUTES: { label: 'in 30 minutes', value: 30 * 60 * 1000 },
  TWO_HOURS: { label: 'in 2 hours', value: 2 * 60 * 60 * 1000 },
  TWELVE_HOURS: { label: 'in 12 hours', value: 12 * 60 * 60 * 1000 },
  ONE_DAY: { label: 'in 1 day', value: 24 * 60 * 60 * 1000 },
  ONE_WEEK: { label: 'in 7 days', value: 7 * 24 * 60 * 60 * 1000 },
  ONE_MONTH: { label: 'in 30 days', value: 30 * 24 * 60 * 60 * 1000 },
  NEVER: { label: 'never', value: 0 },
};

const defaultFormValues = {
  apiKey: '',
  baseURL: '',
  models: '',
};

const AZURE_LEGACY_KEYS = [
  'azureOpenAIApiKey',
  'azureOpenAIApiInstanceName',
  'azureOpenAIApiDeploymentName',
  'azureOpenAIApiVersion',
] as const;

const isLegacyAzurePayload = (obj: Record<string, unknown>): boolean =>
  AZURE_LEGACY_KEYS.some((key) => typeof obj[key] === 'string' && obj[key] !== '');

/**
 * Resolves a legacy Azure instance name to a bare root URL without appending
 * `/openai/v1`.  This keeps the stored URL shape aligned with the server-side
 * `getAzureInstanceBaseURL` so that re-saving legacy credentials through the
 * dialog does not collapse bare Azure roots into explicit `/openai/v1` configs
 * (which would drop the required `api-version` on model discovery probes).
 */
const legacyInstanceToBaseURL = (instanceName?: string): string => {
  if (!instanceName) {
    return '';
  }
  if (instanceName.startsWith('http://') || instanceName.startsWith('https://')) {
    return instanceName;
  }
  if (instanceName.includes('.azure.com')) {
    return `https://${instanceName}`;
  }
  return `https://${instanceName}.openai.azure.com`;
};

const extractLegacyAzureFields = (
  obj: Record<string, unknown>,
): { apiKey: string; baseURL: string; models: string } => ({
  apiKey: typeof obj.azureOpenAIApiKey === 'string' ? obj.azureOpenAIApiKey : '',
  baseURL: legacyInstanceToBaseURL(
    typeof obj.azureOpenAIApiInstanceName === 'string' ? obj.azureOpenAIApiInstanceName : undefined,
  ),
  models:
    typeof obj.azureOpenAIApiDeploymentName === 'string' ? obj.azureOpenAIApiDeploymentName : '',
});

const parseSavedFormValues = (value: string) => {
  if (!value) {
    return defaultFormValues;
  }

  try {
    const parsedValue = JSON.parse(value);

    if (parsedValue == null || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return {
        ...defaultFormValues,
        apiKey: value,
      };
    }

    // Top-level legacy Azure payload (no current-format apiKey key present)
    if (isLegacyAzurePayload(parsedValue) && !('apiKey' in parsedValue)) {
      return extractLegacyAzureFields(parsedValue);
    }

    let apiKey = typeof parsedValue.apiKey === 'string' ? parsedValue.apiKey : '';
    let baseURL = typeof parsedValue.baseURL === 'string' ? parsedValue.baseURL : '';

    let models = '';
    if (typeof parsedValue.models === 'string') {
      models = parsedValue.models;
    } else if (Array.isArray(parsedValue.models)) {
      models = parsedValue.models.join(',');
    }

    // Nested legacy Azure payload inside apiKey (JSON-in-apiKey)
    if (apiKey) {
      try {
        const nested = JSON.parse(apiKey);
        if (
          nested != null &&
          typeof nested === 'object' &&
          !Array.isArray(nested) &&
          isLegacyAzurePayload(nested)
        ) {
          const legacy = extractLegacyAzureFields(nested);
          apiKey = legacy.apiKey;
          if (!baseURL) {
            baseURL = legacy.baseURL;
          }
          if (!models) {
            models = legacy.models;
          }
        }
      } catch {
        // apiKey is not JSON — keep as-is
      }
    }

    return { apiKey, baseURL, models };
  } catch {
    return {
      ...defaultFormValues,
      apiKey: value,
    };
  }
};

const validGoogleAuthModes = new Set(Object.values(GoogleAuthMode));

const getGoogleAuthMode = (value: unknown) => {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string') {
    if (validGoogleAuthModes.has(value as GoogleAuthMode)) {
      return value as GoogleAuthMode;
    }

    return undefined;
  }

  return undefined;
};

const getMissingGoogleFields = (userKey: string): string[] => {
  if (!userKey) {
    return ['Google configuration'];
  }

  try {
    const parsedValue = JSON.parse(userKey);

    if (parsedValue == null || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      return userKey.trim() ? [] : ['Google API key'];
    }

    const apiKey =
      typeof parsedValue[AuthKeys.GOOGLE_API_KEY] === 'string'
        ? parsedValue[AuthKeys.GOOGLE_API_KEY].trim()
        : '';
    const serviceKey =
      typeof parsedValue[AuthKeys.GOOGLE_SERVICE_KEY] === 'string'
        ? parsedValue[AuthKeys.GOOGLE_SERVICE_KEY].trim()
        : parsedValue[AuthKeys.GOOGLE_SERVICE_KEY] != null &&
            typeof parsedValue[AuthKeys.GOOGLE_SERVICE_KEY] === 'object'
          ? JSON.stringify(parsedValue[AuthKeys.GOOGLE_SERVICE_KEY])
          : '';
    const authMode =
      getGoogleAuthMode(parsedValue[AuthKeys.GOOGLE_AUTH_MODE]) ??
      (apiKey
        ? GoogleAuthMode.API_KEY
        : serviceKey
          ? GoogleAuthMode.VERTEX_SERVICE_ACCOUNT
          : GoogleAuthMode.API_KEY);

    if (authMode === GoogleAuthMode.API_KEY) {
      return apiKey ? [] : ['Google API key'];
    }

    if (authMode === GoogleAuthMode.VERTEX_SERVICE_ACCOUNT) {
      return serviceKey ? [] : ['Google service account JSON'];
    }

    return [];
  } catch {
    return userKey.trim() ? [] : ['Google API key'];
  }
};

const RevokeKeysButton = ({
  endpoint,
  disabled,
  setDialogOpen,
}: {
  endpoint: string;
  disabled: boolean;
  setDialogOpen: (open: boolean) => void;
}) => {
  const localize = useLocalize();
  const [open, setOpen] = useState(false);
  const { showToast } = useToastContext();
  const revokeKeyMutation = useRevokeUserKeyMutation(endpoint);
  const revokeKeysMutation = useRevokeAllUserKeysMutation();

  const handleSuccess = () => {
    showToast({
      message: localize('com_ui_revoke_key_success'),
      status: NotificationSeverity.SUCCESS,
    });

    if (!setDialogOpen) {
      return;
    }

    setDialogOpen(false);
  };

  const handleError = () => {
    showToast({
      message: localize('com_ui_revoke_key_error'),
      status: NotificationSeverity.ERROR,
    });
  };

  const onClick = () => {
    revokeKeyMutation.mutate(
      {},
      {
        onSuccess: handleSuccess,
        onError: handleError,
      },
    );
  };

  const isLoading = revokeKeyMutation.isLoading || revokeKeysMutation.isLoading;

  return (
    <div className="flex items-center justify-between">
      <OGDialog open={open} onOpenChange={setOpen}>
        <OGDialogTrigger asChild>
          <Button
            variant="destructive"
            className="flex items-center justify-center rounded-lg transition-colors duration-200"
            onClick={() => setOpen(true)}
            disabled={disabled}
          >
            {localize('com_ui_revoke')}
          </Button>
        </OGDialogTrigger>
        <OGDialogContent className="max-w-[450px]">
          <OGDialogHeader>
            <OGDialogTitle>{localize('com_ui_revoke_key_endpoint', { 0: endpoint })}</OGDialogTitle>
          </OGDialogHeader>
          <div className="py-4">
            <Label className="text-left text-sm font-medium">
              {localize('com_ui_revoke_key_confirm')}
            </Label>
          </div>
          <OGDialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {localize('com_ui_cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={onClick}
              disabled={isLoading}
              className="bg-destructive text-white transition-all duration-200 hover:bg-destructive/80"
            >
              {isLoading ? <Spinner /> : localize('com_ui_revoke')}
            </Button>
          </OGDialogFooter>
        </OGDialogContent>
      </OGDialog>
    </div>
  );
};

const SetKeyDialog = ({
  open,
  onOpenChange,
  endpoint,
  endpointType,
  userProvideURL,
}: Pick<TDialogProps, 'open' | 'onOpenChange'> & {
  endpoint: EModelEndpoint | string;
  endpointType?: EModelEndpoint;
  userProvideURL?: boolean | null;
}) => {
  const methods = useForm({
    defaultValues: defaultFormValues,
  });

  const [userKey, setUserKey] = useState('');
  const [expiresAtLabel, setExpiresAtLabel] = useState(EXPIRY.NEVER.label);
  const { getExpiry, getValue, saveUserKey, isLoading } = useUserKey(endpoint, {
    includeValue: open,
  });
  const { showToast } = useToastContext();
  const localize = useLocalize();
  const expiryTime = getExpiry();
  const savedKeyValue = getValue();
  const formEndpoint = endpointType ?? endpoint;
  const isFormEndpoint = formSet.has(endpoint) || formSet.has(formEndpoint);

  const expirationOptions = Object.values(EXPIRY);

  useEffect(() => {
    if (!open) {
      return;
    }

    if (isFormEndpoint) {
      methods.reset(parseSavedFormValues(savedKeyValue));
      return;
    }

    setUserKey(savedKeyValue);
  }, [open, endpoint, formEndpoint, isFormEndpoint, methods, savedKeyValue]);

  const handleExpirationChange = (label: string) => {
    setExpiresAtLabel(label);
  };

  const submit = () => {
    const selectedOption = expirationOptions.find((option) => option.label === expiresAtLabel);
    let expiresAt: number | null;

    if (selectedOption?.value === 0) {
      expiresAt = null;
    } else {
      expiresAt = Date.now() + (selectedOption ? selectedOption.value : 0);
    }

    const saveKey = (key: string, merge = false) => {
      try {
        saveUserKey(key, expiresAt, merge);
        showToast({
          message: localize('com_ui_save_key_success'),
          status: NotificationSeverity.SUCCESS,
        });
        onOpenChange(false);
      } catch (error) {
        logger.error('Error saving user key:', error);
        showToast({
          message: localize('com_ui_save_key_error'),
          status: NotificationSeverity.ERROR,
        });
      }
    };

    if (formSet.has(endpoint) || formSet.has(endpointType ?? '')) {
      // TODO: handle other user provided options besides baseURL and apiKey
      methods.handleSubmit((data) => {
        const isAzure = endpoint === EModelEndpoint.azureOpenAI;
        const shouldMergeExistingValues = Boolean(expiryTime);

        const emptyValues = Object.keys(data).filter((key) => {
          if (key === 'models') {
            return false;
          }
          if (shouldMergeExistingValues && (key === 'apiKey' || key === 'baseURL')) {
            return false;
          }
          if (key === 'baseURL' && !(userProvideURL ?? false)) {
            return false;
          }
          return data[key] === '';
        });

        if (emptyValues.length > 0) {
          showToast({
            message: 'The following fields are required: ' + emptyValues.join(', '),
            status: 'error',
          });
          onOpenChange(true);
          return;
        }

        const { apiKey, baseURL, models } = data;
        const userProvidedData = Object.fromEntries(
          Object.entries({
            apiKey,
            baseURL,
            ...(isAzure ? { models } : {}),
          }).filter(([, value]) => value !== ''),
        );

        if (shouldMergeExistingValues && Object.keys(userProvidedData).length === 0) {
          showToast({
            message: localize('com_ui_key_required'),
            status: NotificationSeverity.ERROR,
          });
          onOpenChange(true);
          return;
        }

        saveKey(JSON.stringify(userProvidedData), shouldMergeExistingValues);
        methods.reset(defaultFormValues);
      })();
      return;
    }

    if (endpoint === EModelEndpoint.google) {
      const missingGoogleFields = getMissingGoogleFields(userKey);

      if (missingGoogleFields.length > 0) {
        showToast({
          message: 'The following fields are required: ' + missingGoogleFields.join(', '),
          status: NotificationSeverity.ERROR,
        });
        onOpenChange(true);
        return;
      }
    }

    if (!userKey.trim()) {
      showToast({
        message: localize('com_ui_key_required'),
        status: NotificationSeverity.ERROR,
      });
      return;
    }

    saveKey(userKey);
    setUserKey('');
  };

  const EndpointComponent =
    endpointComponents[endpointType ?? endpoint] ?? endpointComponents['default'];

  return (
    <OGDialog open={open} onOpenChange={onOpenChange}>
      <OGDialogContent className="w-11/12 max-w-2xl">
        <OGDialogHeader>
          <OGDialogTitle>
            {`${localize('com_endpoint_config_key_for')} ${alternateName[endpoint] ?? endpoint}`}
          </OGDialogTitle>
        </OGDialogHeader>
        <div className="grid w-full items-center gap-2 py-4">
          <small className="text-red-600">
            {expiryTime === 'never'
              ? localize('com_endpoint_config_key_never_expires')
              : `${localize('com_endpoint_config_key_encryption')} ${new Date(
                  expiryTime ?? 0,
                ).toLocaleString()}`}
          </small>
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <Spinner />
              <span>{localize('com_ui_loading')}</span>
            </div>
          )}
          <Dropdown
            label="Expires "
            value={expiresAtLabel}
            onChange={handleExpirationChange}
            options={expirationOptions.map((option) => option.label)}
            sizeClasses="w-[185px]"
            portal={false}
          />
          <div className="mt-2" />
          <FormProvider {...methods}>
            <EndpointComponent
              userKey={userKey}
              endpoint={endpoint}
              setUserKey={setUserKey}
              userProvideURL={userProvideURL}
            />
          </FormProvider>
          <HelpText endpoint={endpoint} />
        </div>
        <OGDialogFooter>
          <RevokeKeysButton
            endpoint={endpoint}
            disabled={isLoading || !(expiryTime ?? '')}
            setDialogOpen={onOpenChange}
          />
          <Button variant="submit" onClick={submit} disabled={isLoading}>
            {localize('com_ui_submit')}
          </Button>
        </OGDialogFooter>
      </OGDialogContent>
    </OGDialog>
  );
};

export default SetKeyDialog;
