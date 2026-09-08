/* VerseRain Web Push Service Worker.
 * Two responsibilities:
 *   1. push event → show a notification with the day's verse + a deep link.
 *   2. notificationclick → focus or open the verserain.com tab at the link.
 * Kept tiny on purpose; everything else (verse content, scheduling, who-to-push)
 * happens server-side in the cron worker.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'VerseRain', body: event.data ? event.data.text() : '' }; }

  const title = data.title || '🌧️ VerseRain';
  const options = {
    body: data.body || '',
    icon: data.icon || '/favicon.svg',
    badge: '/favicon.svg',
    data: { url: data.url || 'https://www.verserain.com/' },
    tag: data.tag || 'verserain-daily',
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || 'https://www.verserain.com/';
  const isInternal = targetUrl.includes('verserain.com');
  event.waitUntil(
    (async () => {
      // External targets (e.g. the LINE share sheet for the host's daily
      // "share with your family" prompt) must open in a fresh window — never
      // hijack an open verserain tab by navigating it away to line.me.
      if (!isInternal) {
        return self.clients.openWindow(targetUrl);
      }
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Prefer focusing an existing verserain tab, then navigating it.
      for (const client of allClients) {
        if (client.url.includes('verserain.com')) {
          await client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
