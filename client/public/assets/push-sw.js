self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = {
      body: event.data ? event.data.text() : '',
    };
  }

  const title = payload.title || 'LibreChat';
  const body = payload.body || 'You have a new scheduled LibreChat update.';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: payload.tag || 'librechat-scheduled-run',
      icon: payload.icon || '/assets/icon-192x192.png',
      badge: payload.badge || '/assets/favicon-32x32.png',
      data: {
        url: payload.url || '/',
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(event.notification?.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
