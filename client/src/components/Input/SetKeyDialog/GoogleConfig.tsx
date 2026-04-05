import React from 'react';
import { object, string } from 'zod';
import { Dropdown, Label } from '@librechat/client';
import { AuthKeys, GoogleAuthMode } from 'librechat-data-provider';
import type { TConfigProps } from '~/common';
import FileUpload from '~/components/Chat/Input/Files/FileUpload';
import { useLocalize } from '~/hooks';
import InputWithLabel from './InputWithLabel';

const CredentialsSchema = object({
  client_email: string().email().min(3),
  project_id: string().min(3),
  private_key: string().min(601),
});

const validGoogleAuthModes = new Set(Object.values(GoogleAuthMode));

const validateCredentials = (credentials: Record<string, unknown>) => {
  const result = CredentialsSchema.safeParse(credentials);
  return result.success;
};

function parseGoogleKeyState(userKey: string): Record<string, string> {
  if (!userKey) {
    return {};
  }

  try {
    const parsed = JSON.parse(userKey);

    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        [AuthKeys.GOOGLE_API_KEY]: userKey,
      };
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        if (typeof value === 'string') {
          return [[key, value]];
        }

        if (
          key === AuthKeys.GOOGLE_SERVICE_KEY &&
          value != null &&
          typeof value === 'object' &&
          !Array.isArray(value)
        ) {
          return [[key, JSON.stringify(value)]];
        }

        return [];
      }),
    );
  } catch {
    return {
      [AuthKeys.GOOGLE_API_KEY]: userKey,
    };
  }
}

const GoogleConfig = ({ userKey, setUserKey }: Pick<TConfigProps, 'userKey' | 'setUserKey'>) => {
  const localize = useLocalize();
  const googleKeyState = parseGoogleKeyState(userKey);
  const hasApiKey = Boolean(googleKeyState[AuthKeys.GOOGLE_API_KEY]?.trim());
  const hasStoredServiceKey = Boolean(googleKeyState[AuthKeys.GOOGLE_SERVICE_KEY]);
  const savedAuthMode = googleKeyState[AuthKeys.GOOGLE_AUTH_MODE];
  const authMode = validGoogleAuthModes.has(savedAuthMode as GoogleAuthMode)
    ? (savedAuthMode as GoogleAuthMode)
    : hasApiKey
      ? GoogleAuthMode.API_KEY
      : hasStoredServiceKey
        ? GoogleAuthMode.VERTEX_SERVICE_ACCOUNT
        : GoogleAuthMode.API_KEY;
  const serviceKeyStatus = localize('com_endpoint_config_key_import_json_key_success');
  const authModeOptions = [
    {
      label: localize('com_endpoint_config_google_auth_api_key'),
      value: GoogleAuthMode.API_KEY,
    },
    {
      label: localize('com_endpoint_config_google_auth_service_account'),
      value: GoogleAuthMode.VERTEX_SERVICE_ACCOUNT,
    },
    {
      label: localize('com_endpoint_config_google_auth_adc'),
      value: GoogleAuthMode.VERTEX_APPLICATION_DEFAULT,
    },
  ];
  const authModeDescription = {
    [GoogleAuthMode.API_KEY]: localize('com_endpoint_config_google_auth_api_key_info'),
    [GoogleAuthMode.VERTEX_SERVICE_ACCOUNT]: localize(
      'com_endpoint_config_google_auth_service_account_info',
    ),
    [GoogleAuthMode.VERTEX_APPLICATION_DEFAULT]: localize(
      'com_endpoint_config_google_auth_adc_info',
    ),
  };
  const selectedAuthModeLabel =
    authModeOptions.find((option) => option.value === authMode)?.label ?? authModeOptions[0].label;
  const showServiceAccountUpload = authMode === GoogleAuthMode.VERTEX_SERVICE_ACCOUNT;
  const showVertexFields = authMode !== GoogleAuthMode.API_KEY;

  const updateGoogleKeys = (updates: Record<string, string>) => {
    setUserKey(
      JSON.stringify({
        ...googleKeyState,
        ...updates,
      }),
    );
  };

  const handleAuthModeChange = (nextLabel: string) => {
    const nextAuthMode = authModeOptions.find((option) => option.label === nextLabel)?.value;
    if (!nextAuthMode) {
      return;
    }

    updateGoogleKeys({
      [AuthKeys.GOOGLE_AUTH_MODE]: nextAuthMode,
    });
  };

  return (
    <>
      <div className="mt-4 flex items-center justify-between gap-4">
        <Label className="text-left text-sm font-medium">
          {localize('com_endpoint_config_google_auth_mode')}
        </Label>
        <Dropdown
          label={localize('com_endpoint_config_google_auth_mode')}
          value={selectedAuthModeLabel}
          onChange={handleAuthModeChange}
          options={authModeOptions.map((option) => option.label)}
          sizeClasses="w-[260px]"
          portal={false}
        />
      </div>
      <p className="mt-2 text-xs text-text-secondary">{authModeDescription[authMode]}</p>
      {showServiceAccountUpload && (
        <>
          <div className="mt-4 flex flex-row">
            <Label htmlFor={AuthKeys.GOOGLE_SERVICE_KEY} className="text-left text-sm font-medium">
              {localize('com_endpoint_config_google_service_key')}
            </Label>
            <Label className="mx-1 text-right text-sm text-text-secondary">
              {localize('com_endpoint_config_google_cloud_platform')}
            </Label>
            <br />
          </div>
          <FileUpload
            id={AuthKeys.GOOGLE_SERVICE_KEY}
            className="w-full"
            containerClassName="dark:bg-gray-700 h-10 max-h-10 w-full resize-none py-2 dark:ring-1 dark:ring-gray-600"
            text={localize('com_endpoint_config_key_import_json_key')}
            successText={localize('com_endpoint_config_key_import_json_key_success')}
            invalidText={localize('com_endpoint_config_key_import_json_key_invalid')}
            validator={validateCredentials}
            onFileSelected={(data) => {
              updateGoogleKeys({
                [AuthKeys.GOOGLE_SERVICE_KEY]: JSON.stringify(data),
                [AuthKeys.GOOGLE_AUTH_MODE]: GoogleAuthMode.VERTEX_SERVICE_ACCOUNT,
                ...(typeof data.project_id === 'string'
                  ? { [AuthKeys.GOOGLE_VERTEX_PROJECT]: data.project_id }
                  : {}),
              });
            }}
          />
        </>
      )}
      {hasStoredServiceKey && (
        <p className="mt-2 text-xs text-text-secondary">{serviceKeyStatus}</p>
      )}
      {authMode === GoogleAuthMode.API_KEY && (
        <InputWithLabel
          id={AuthKeys.GOOGLE_API_KEY}
          type="password"
          value={googleKeyState[AuthKeys.GOOGLE_API_KEY] ?? ''}
          onChange={(e: { target: { value: string } }) =>
            updateGoogleKeys({
              [AuthKeys.GOOGLE_API_KEY]: e.target.value ?? '',
            })
          }
          label={localize('com_endpoint_config_google_api_key')}
          subLabel={localize('com_endpoint_config_google_gemini_api')}
        />
      )}
      {showVertexFields && (
        <>
          <InputWithLabel
            id={AuthKeys.GOOGLE_VERTEX_PROJECT}
            value={googleKeyState[AuthKeys.GOOGLE_VERTEX_PROJECT] ?? ''}
            onChange={(e: { target: { value: string } }) =>
              updateGoogleKeys({
                [AuthKeys.GOOGLE_VERTEX_PROJECT]: e.target.value ?? '',
              })
            }
            label={localize('com_endpoint_config_google_vertex_project')}
            subLabel={localize('com_ui_optional')}
          />
          <InputWithLabel
            id={AuthKeys.GOOGLE_VERTEX_LOCATION}
            value={googleKeyState[AuthKeys.GOOGLE_VERTEX_LOCATION] ?? ''}
            onChange={(e: { target: { value: string } }) =>
              updateGoogleKeys({
                [AuthKeys.GOOGLE_VERTEX_LOCATION]: e.target.value ?? '',
              })
            }
            label={localize('com_endpoint_config_google_vertex_location')}
            subLabel={localize('com_ui_optional')}
          />
        </>
      )}
    </>
  );
};

export default GoogleConfig;
