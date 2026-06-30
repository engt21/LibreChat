import React, { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Download } from 'lucide-react';
import { useToastContext, Button, Label } from '@librechat/client';
import { useForm, Controller } from 'react-hook-form';
import { REGEXP_ONLY_DIGITS, REGEXP_ONLY_DIGITS_AND_CHARS } from 'input-otp';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@librechat/client';
import {
  useSetupPendingTwoFactorMutation,
  useVerifyTwoFactorTempMutation,
} from '~/data-provider';
import { useLocalize } from '~/hooks';

interface VerifyPayload {
  token?: string;
  backupCode?: string;
  backupCodesAcknowledged?: boolean;
}

type TwoFactorFormInputs = {
  token?: string;
  backupCode?: string;
};

const TwoFactorScreen: React.FC = React.memo(() => {
  const [searchParams] = useSearchParams();
  const enrollmentRequired = searchParams.get('enroll') === 'true';
  const { control, handleSubmit, formState: { errors } } = useForm<TwoFactorFormInputs>();
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [useBackup, setUseBackup] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [backupCodesSaved, setBackupCodesSaved] = useState(false);

  const { mutate: setupPendingMFA, isLoading: isSettingUp } = useSetupPendingTwoFactorMutation({
    onSuccess: (result) => {
      setOtpauthUrl(result.otpauthUrl);
      setBackupCodes(result.backupCodes);
    },
    onError: () => {
      showToast({ message: 'Your MFA enrollment session expired. Please sign in again.', status: 'error' });
      window.location.replace('/login');
    },
  });

  useEffect(() => {
    if (enrollmentRequired) {
      setupPendingMFA();
    }
  }, [enrollmentRequired, setupPendingMFA]);

  const { mutate: verifyTempMutate } = useVerifyTwoFactorTempMutation({
    onSuccess: (result) => {
      if (result.token) {
        window.location.replace('/');
      }
    },
    onMutate: () => setIsLoading(true),
    onError: (error: unknown) => {
      setIsLoading(false);
      const err = error as { response?: { data?: { message?: unknown } } };
      const message = typeof err.response?.data?.message === 'string'
        ? err.response.data.message
        : 'Error verifying MFA';
      showToast({ message, status: 'error' });
    },
  });

  const downloadBackupCodes = useCallback(() => {
    const blob = new Blob([
      `LibreChat MFA backup codes\n\n${backupCodes.join('\n')}\n\nEach code can be used once. Store these securely.\n`,
    ], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'librechat-mfa-backup-codes.txt';
    anchor.click();
    URL.revokeObjectURL(url);
    setBackupCodesSaved(true);
  }, [backupCodes]);

  const onSubmit = useCallback((data: TwoFactorFormInputs) => {
    const payload: VerifyPayload = { backupCodesAcknowledged: backupCodesSaved };
    if (!enrollmentRequired && useBackup && data.backupCode) {
      payload.backupCode = data.backupCode;
    } else if (data.token) {
      payload.token = data.token;
    }
    verifyTempMutate(payload);
  }, [backupCodesSaved, enrollmentRequired, useBackup, verifyTempMutate]);

  if (enrollmentRequired && (isSettingUp || !otpauthUrl)) {
    return <div className="mt-6 text-center text-sm text-text-secondary">Preparing secure MFA enrollment…</div>;
  }

  return (
    <div className="mt-4 space-y-5">
      {enrollmentRequired && (
        <div className="space-y-4 text-center">
          <Label className="block text-sm text-text-primary">
            Scan this code with Microsoft Authenticator, Google Authenticator, 1Password, Authy, or another TOTP app.
          </Label>
          <div className="mx-auto w-fit rounded-xl bg-white p-4">
            <QRCodeSVG value={otpauthUrl} size={220} />
          </div>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-secondary p-4">
            {backupCodes.map((code) => <code key={code} className="rounded bg-surface-tertiary p-2">{code}</code>)}
          </div>
          <Button type="button" variant="outline" onClick={downloadBackupCodes} className="w-full gap-2">
            <Download className="h-4 w-4" />
            Download backup codes
          </Button>
          <p className="text-xs text-text-secondary">Download the backup codes before completing setup.</p>
        </div>
      )}
      <form onSubmit={handleSubmit(onSubmit)}>
        <Label className="flex justify-center break-keep text-center text-sm text-text-primary">
          {enrollmentRequired ? 'Enter the six-digit code to finish setup' : localize('com_auth_two_factor')}
        </Label>
        {!useBackup && (
          <div className="my-4 flex justify-center text-text-primary">
            <Controller name="token" control={control} render={({ field: { onChange, value } }) => (
              <InputOTP maxLength={6} value={value ?? ''} onChange={onChange} pattern={REGEXP_ONLY_DIGITS}>
                <InputOTPGroup>
                  <InputOTPSlot index={0} /><InputOTPSlot index={1} /><InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} /><InputOTPSlot index={4} /><InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            )} />
            {errors.token && <span className="text-sm text-red-500">{errors.token.message}</span>}
          </div>
        )}
        {!enrollmentRequired && useBackup && (
          <div className="my-4 flex justify-center text-text-primary">
            <Controller name="backupCode" control={control} render={({ field: { onChange, value } }) => (
              <InputOTP maxLength={8} value={value ?? ''} onChange={onChange} pattern={REGEXP_ONLY_DIGITS_AND_CHARS}>
                <InputOTPGroup>
                  {Array.from({ length: 8 }).map((_, index) => <InputOTPSlot key={index} index={index} />)}
                </InputOTPGroup>
              </InputOTP>
            )} />
          </div>
        )}
        <button
          type="submit"
          disabled={isLoading || (enrollmentRequired && !backupCodesSaved)}
          className="w-full rounded-2xl bg-green-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
        >
          {isLoading ? localize('com_auth_email_verifying_ellipsis') : localize('com_ui_verify')}
        </button>
        {!enrollmentRequired && (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => setUseBackup((value) => !value)} className="text-sm font-medium text-green-600">
              {useBackup ? localize('com_ui_use_2fa_code') : localize('com_ui_use_backup_code')}
            </button>
          </div>
        )}
      </form>
    </div>
  );
});

export default TwoFactorScreen;
