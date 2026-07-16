const CACHE_NAME = 'hawari-cache-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/favicon.png',
  '/manifest.json'
];

// Install Event: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate Event: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event: intercept network requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypass cache for Supabase API and external CDNs if they need real-time data
  if (url.origin.includes('supabase.co') || event.request.method !== 'GET') {
    return; // Let browser handle it directly
  }

  // Network-First with Cache Fallback for maximum reliability
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful GET responses for our own origin
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache if network is offline
        return caches.match(event.request);
      })
  );
});
