const CACHE_NAME = "orderflow-v4-cache";
self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  // Network-first for app files to avoid old cached bugs.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});
