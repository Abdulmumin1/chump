const CACHE_NAME = 'chump-cache-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Simple pass-through fetch handler required by browsers for PWA installation
  event.respondWith(fetch(event.request));
});
