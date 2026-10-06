const CACHE_NAME = 'manzoor-pos-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) {
            return caches.delete(k);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-HTTP(S) and non-GET
  if (!url.protocol.startsWith('http') || event.request.method !== 'GET') return;

  // Never intercept API calls (handled by IndexedDB offline sync engine)
  if (url.pathname.startsWith('/api/')) return;

  // Never intercept Vite internal dev endpoints or node_modules/.vite/deps/
  // Intercepting or caching Vite dev pre-bundled dependencies causes mismatched ?v= hashes and duplicate React instances
  if (
    url.pathname.includes('/node_modules/') ||
    url.pathname.startsWith('/@vite/') ||
    url.pathname.startsWith('/@react-refresh') ||
    url.pathname.startsWith('/@fs/') ||
    url.pathname.startsWith('/src/')
  ) {
    return;
  }

  // Navigation requests: Network-first with offline fallback
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cachedNavigate = await caches.match(event.request);
          if (cachedNavigate) return cachedNavigate;
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) return cachedIndex;
          const cachedRoot = await caches.match('/');
          if (cachedRoot) return cachedRoot;
          return new Response('Offline Mode', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          });
        })
    );
    return;
  }

  // Production built assets (/assets/*, icons, manifest): Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(async () => {
        const cachedResponse = await caches.match(event.request);
        if (cachedResponse) return cachedResponse;
        throw new Error('Asset unavailable offline');
      })
  );
});
