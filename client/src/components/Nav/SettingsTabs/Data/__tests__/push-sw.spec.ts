/**
 * @file Tests for push-sw.js service worker behavior (VAL-SCHED-009)
 *
 * Validates:
 * - push event shows notification with correct title, body, icon, badge, and data
 * - notificationclick event focuses existing window or opens new window with conversation URL
 */

/* ─── Service-worker globals mock ─────────────────────────────────── */

const mockShowNotification = jest.fn().mockResolvedValue(undefined);
const mockMatchAll = jest.fn();
const mockOpenWindow = jest.fn();
const mockFocus = jest.fn().mockResolvedValue(undefined);

let pushListener: ((event: any) => void) | null = null;
let notificationClickListener: ((event: any) => void) | null = null;

// Simulate service worker global `self`
const swSelf: Record<string, unknown> = {
  addEventListener: jest.fn((type: string, handler: (...args: any[]) => void) => {
    if (type === 'push') {
      pushListener = handler;
    }
    if (type === 'notificationclick') {
      notificationClickListener = handler;
    }
  }),
  registration: {
    showNotification: mockShowNotification,
  },
  clients: {
    matchAll: mockMatchAll,
    openWindow: mockOpenWindow,
  },
  location: {
    origin: 'https://chat.example.com',
  },
};

// Assign to global self before loading the SW script
Object.assign(globalThis, { self: swSelf });

describe('push-sw.js service worker', () => {
  beforeAll(() => {
    // Load the service worker script which registers listeners on `self`
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(require('path').resolve(__dirname, '../../../../../../public/assets/push-sw.js'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('push event handling', () => {
    function createPushEvent(payload: Record<string, unknown> | null) {
      let waitUntilPromise: Promise<unknown> | null = null;
      return {
        data: payload
          ? {
              json: () => payload,
              text: () => JSON.stringify(payload),
            }
          : null,
        waitUntil: (p: Promise<unknown>) => {
          waitUntilPromise = p;
        },
        getWaitUntilPromise: () => waitUntilPromise,
      };
    }

    it('shows notification with provided title and body', async () => {
      const event = createPushEvent({
        title: 'Schedule Complete',
        body: 'Your daily summary is ready.',
        url: '/c/conv-123',
      });

      pushListener!(event);
      await event.getWaitUntilPromise();

      expect(mockShowNotification).toHaveBeenCalledWith('Schedule Complete', {
        body: 'Your daily summary is ready.',
        tag: 'librechat-scheduled-run',
        icon: '/assets/icon-192x192.png',
        badge: '/assets/favicon-32x32.png',
        data: { url: '/c/conv-123' },
      });
    });

    it('uses default title and body when payload is empty', async () => {
      const event = createPushEvent({});

      pushListener!(event);
      await event.getWaitUntilPromise();

      expect(mockShowNotification).toHaveBeenCalledWith(
        'LibreChat',
        expect.objectContaining({
          body: 'You have a new scheduled LibreChat update.',
          data: { url: '/' },
        }),
      );
    });

    it('uses custom tag and icon when provided', async () => {
      const event = createPushEvent({
        title: 'Test',
        body: 'test body',
        tag: 'custom-tag',
        icon: '/custom-icon.png',
        badge: '/custom-badge.png',
      });

      pushListener!(event);
      await event.getWaitUntilPromise();

      expect(mockShowNotification).toHaveBeenCalledWith(
        'Test',
        expect.objectContaining({
          tag: 'custom-tag',
          icon: '/custom-icon.png',
          badge: '/custom-badge.png',
        }),
      );
    });

    it('handles null data gracefully', async () => {
      const event = createPushEvent(null);

      pushListener!(event);
      await event.getWaitUntilPromise();

      expect(mockShowNotification).toHaveBeenCalledWith(
        'LibreChat',
        expect.objectContaining({
          body: expect.any(String),
        }),
      );
    });
  });

  describe('notification click handling (VAL-SCHED-009 click-through)', () => {
    function createNotificationClickEvent(url?: string) {
      let waitUntilPromise: Promise<unknown> | null = null;
      const notification = {
        data: { url: url ?? '/' },
        close: jest.fn(),
      };
      return {
        notification,
        waitUntil: (p: Promise<unknown>) => {
          waitUntilPromise = p;
        },
        getWaitUntilPromise: () => waitUntilPromise,
      };
    }

    it('closes the notification on click', async () => {
      mockMatchAll.mockResolvedValue([]);
      mockOpenWindow.mockResolvedValue(undefined);

      const event = createNotificationClickEvent('/c/conv-123');
      notificationClickListener!(event);
      await event.getWaitUntilPromise();

      expect(event.notification.close).toHaveBeenCalled();
    });

    it('focuses existing window when URL matches', async () => {
      mockMatchAll.mockResolvedValue([
        {
          url: 'https://chat.example.com/c/conv-123',
          focus: mockFocus,
        },
      ]);

      const event = createNotificationClickEvent('/c/conv-123');
      notificationClickListener!(event);
      await event.getWaitUntilPromise();

      expect(mockFocus).toHaveBeenCalled();
      expect(mockOpenWindow).not.toHaveBeenCalled();
    });

    it('opens new window when no matching window exists', async () => {
      mockMatchAll.mockResolvedValue([
        { url: 'https://chat.example.com/c/different-conv', focus: mockFocus },
      ]);
      mockOpenWindow.mockResolvedValue(undefined);

      const event = createNotificationClickEvent('/c/conv-123');
      notificationClickListener!(event);
      await event.getWaitUntilPromise();

      expect(mockOpenWindow).toHaveBeenCalledWith('https://chat.example.com/c/conv-123');
      expect(mockFocus).not.toHaveBeenCalled();
    });

    it('uses root URL when notification data URL is missing', async () => {
      mockMatchAll.mockResolvedValue([]);
      mockOpenWindow.mockResolvedValue(undefined);

      const event = createNotificationClickEvent(undefined);
      notificationClickListener!(event);
      await event.getWaitUntilPromise();

      expect(mockOpenWindow).toHaveBeenCalledWith('https://chat.example.com/');
    });
  });
});
