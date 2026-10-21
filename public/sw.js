/* Service worker do Nexo: só exibe notificações e abre o app ao clicar nelas.
   Não guarda páginas em cache, então nunca serve uma versão antiga do site. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/** Aceita apenas caminhos internos do app, como /app/home. */
const safePath = (value) => (typeof value === 'string' && /^\/app(\/[a-z-]*)?$/.test(value) ? value : '/app');

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin !== self.location.origin) continue;
      await client.focus();
      client.postMessage({ type: 'nexo:navigate', url: path });
      return;
    }
    await self.clients.openWindow(path);
  })());
});
