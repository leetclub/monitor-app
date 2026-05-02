/**
 * Leet Monitor SW — v4
 * Minimal fetch passthrough for PWA installability; no offline caching.
 * Never reject uncaught — failed fetches broke install checks on mobile.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    fetch(event.request).catch(() => new Response('', { status: 408, statusText: 'Network Error' })),
  );
});
