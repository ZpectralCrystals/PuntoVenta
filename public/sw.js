const CACHE_NAME = 'aqptuning-pos-v1';
const APP_SHELL = ['/manifest.webmanifest', '/pos-icon.svg'];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const page = await fetch('/', { cache: 'reload' });
  const html = await page.clone().text();
  await cache.put('/', page);
  const assets = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"?#]+)"/g)].map((match) => match[1]);
  await cache.addAll([...APP_SHELL, ...new Set(assets)]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || (url.origin === self.location.origin && url.pathname.startsWith('/api/'))) return;

  if (url.origin !== self.location.origin) {
    if (request.destination !== 'image') return;
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
      return response;
    })),
  );
});
