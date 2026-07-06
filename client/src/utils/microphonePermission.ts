type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
  brave?: {
    isBrave?: () => Promise<boolean>;
  };
};

export class MicrophoneAccessError extends Error {
  permissionDenied: boolean;

  constructor(message: string, permissionDenied = false) {
    super(message);
    this.name = 'MicrophoneAccessError';
    this.permissionDenied = permissionDenied;
  }
}

function isIOS() {
  return /iPad|iPhone|iPod/i.test(navigator.userAgent);
}

function isStandaloneWebApp() {
  const standaloneNavigator = navigator as NavigatorWithStandalone;
  return (
    standaloneNavigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches === true
  );
}

function isSafari() {
  return (
    /Safari/i.test(navigator.userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|OPR/i.test(navigator.userAgent)
  );
}

function isBrave() {
  return (
    /Brave/i.test(navigator.userAgent) || Boolean((navigator as NavigatorWithStandalone).brave)
  );
}

export function getMicrophonePermissionHelp() {
  if (isIOS() && isStandaloneWebApp()) {
    return (
      'Microphone access is blocked for this iPhone Home Screen web app. Open this same site in Safari, ' +
      'tap the Page Menu beside the address, open Website Settings, set Microphone to Ask or Allow, and reload. ' +
      'Then fully close and reopen the Home Screen app. If it remains blocked, remove the Home Screen app and add it again.'
    );
  }

  if (isIOS()) {
    return (
      'Microphone access is blocked in iPhone Safari. Tap the Page Menu beside the address, open Website Settings, ' +
      'set Microphone to Ask or Allow, and reload. Also check Settings > Apps > Safari > Microphone and choose Ask or Allow.'
    );
  }

  if (isBrave()) {
    return (
      'Microphone access is blocked in Brave. Click the tune icon beside the address, open Site settings, set Microphone ' +
      'to Allow, and reload. If it is still blocked, check Brave Settings > Privacy and security > Site & Shield Settings > Microphone.'
    );
  }

  if (isSafari()) {
    return (
      'Microphone access is blocked in Safari. Open Safari > Settings > Websites > Microphone, set this site to Allow, ' +
      'then reload. Also confirm Safari is enabled in System Settings > Privacy & Security > Microphone.'
    );
  }

  return (
    'Microphone access is blocked for this site. Open the site permissions beside the address, set Microphone to Allow, ' +
    'then reload. Also confirm the browser has microphone access in your operating system settings.'
  );
}

function permissionError() {
  return new MicrophoneAccessError(getMicrophonePermissionHelp(), true);
}

export async function requestMicrophoneStream(): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneAccessError(
      'Microphone access requires HTTPS and a browser with audio recording support.',
    );
  }

  try {
    const permissionStatus = await navigator.permissions?.query({
      name: 'microphone' as PermissionName,
    });
    if (permissionStatus?.state === 'denied') {
      throw permissionError();
    }
  } catch (error) {
    if (error instanceof MicrophoneAccessError) {
      throw error;
    }
  }

  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === 'NotAllowedError' || error.name === 'SecurityError')
    ) {
      throw permissionError();
    }

    if (error instanceof DOMException && error.name === 'NotFoundError') {
      throw new MicrophoneAccessError('No microphone was found on this device.');
    }

    throw new MicrophoneAccessError(
      'The microphone could not be opened. Check that another app is not using it and that browser microphone access is enabled.',
    );
  }
}

export function notifyMicrophoneAccessError(error: unknown) {
  const microphoneError =
    error instanceof MicrophoneAccessError
      ? error
      : new MicrophoneAccessError('Failed to start the microphone.');

  if (microphoneError.permissionDenied && typeof window.alert === 'function') {
    window.alert(microphoneError.message);
  }

  return microphoneError.message;
}
