const CACHE_NAME = 'web-games-cache-v1.1.3';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/sw-register.js',
  '/tavla/index.html', '/tavla/script.js', '/tavla/style.css',
  '/casus-kim/index.html', '/casus-kim/script.js', '/casus-kim/style.css',
  '/chess/index.html', '/chess/script.js', '/chess/style.css',
  '/dama/index.html', '/dama/script.js', '/dama/style.css',
  '/uno/index.html', '/uno/script.js', '/uno/style.css',
  '/sudoku/index.html', '/sudoku/script.js', '/sudoku/style.css',
  '/minefield/index.html', '/minefield/script.js', '/minefield/style.css',
  // Online games — cache HTML/CSS for layout; JS loaded from network (Firebase ESM)
  '/online/tavla/index.html', '/online/tavla/style.css',
  '/online/poker/index.html', '/online/poker/style.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.map(k => { if (k !== CACHE_NAME) return caches.delete(k); })
    )).then(() => self.clients.claim())
  );
});

function isNavigationRequest(req) {
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  // Navigation requests: try network first, fall back to cached page
  if (isNavigationRequest(req)) {
    event.respondWith(
      fetch(req).then((res) => {
        // Update cache with fresh navigation responses
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then(m => m || caches.match('/index.html')))
    );
    return;
  }

  // Other requests: try cache first, then network, then fallback to cache
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Put in cache for future
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return res;
      }).catch(() => {
        // If request failed and it's a navigation to an HTML document, serve index
        if (req.headers.get('accept') && req.headers.get('accept').includes('text/html')) {
          return caches.match('/index.html');
        }
      });
    })
  );
});
