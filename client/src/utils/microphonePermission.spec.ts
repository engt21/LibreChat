import {
  getMicrophonePermissionHelp,
  MicrophoneAccessError,
  notifyMicrophoneAccessError,
  requestMicrophoneStream,
} from './microphonePermission';

function setUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  });
}

describe('microphonePermission', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: false });
    Object.defineProperty(window.navigator, 'brave', { configurable: true, value: undefined });
    Object.defineProperty(window.navigator, 'permissions', {
      configurable: true,
      value: { query: jest.fn().mockResolvedValue({ state: 'prompt' }) },
    });
    Object.defineProperty(window.navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: jest.fn() },
    });
    jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('does not call getUserMedia when permission is already denied', async () => {
    (navigator.permissions.query as jest.Mock).mockResolvedValue({ state: 'denied' });

    await expect(requestMicrophoneStream()).rejects.toMatchObject({
      permissionDenied: true,
    });
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('requests a microphone with Safari-compatible constraints', async () => {
    const stream = {} as MediaStream;
    (navigator.mediaDevices.getUserMedia as jest.Mock).mockResolvedValue(stream);

    await expect(requestMicrophoneStream()).resolves.toBe(stream);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
  });

  it('provides Home Screen recovery instructions on iPhone', () => {
    setUserAgent('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1');
    Object.defineProperty(window.navigator, 'standalone', { configurable: true, value: true });

    expect(getMicrophonePermissionHelp()).toContain('Home Screen web app');
  });

  it('provides Brave recovery instructions', () => {
    setUserAgent('Mozilla/5.0 Chrome/125.0.0.0 Safari/537.36');
    Object.defineProperty(window.navigator, 'brave', { configurable: true, value: {} });

    expect(getMicrophonePermissionHelp()).toContain('Brave');
  });

  it('shows a recovery alert for permission denial', () => {
    const error = new MicrophoneAccessError('Allow the microphone.', true);

    expect(notifyMicrophoneAccessError(error)).toBe('Allow the microphone.');
    expect(window.alert).toHaveBeenCalledWith('Allow the microphone.');
  });
});
