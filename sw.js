'use strict';

// Change this version whenever any file in SHELL changes, including vault.enc.json.
// A replacement worker waits until the open app is closed: no forced reloads.
const VERSION = '2026-10-20-2';
const BASE = new URL('./', self.location.href);
const NAMESPACE = `sneaker-vault:${BASE.pathname}:`;
const SHELL_CACHE = `${NAMESPACE}shell:${VERSION}`;
const IMAGE_CACHE = `${NAMESPACE}images:1`;
const MAX_IMAGES = 120;
const IMAGE_ORIGINS = new Set(['https://images.stockx.com']);
const SHELL = [
  'index.html',
  'assets/app.js',
  'assets/app.css',
  'assets/storage.js',
  'assets/insights.js',
  'assets/importer.js',
  'assets/import-worker.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon.svg',
  'vault.enc.json'
].map(file => new URL(file, BASE).href);
const SHELL_URLS = new Set(SHELL);
const INDEX_URL = new URL('index.html', BASE).href;
let imageWrites = Promise.resolve();

self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});

self.addEventListener('install', event => {
  // addAll commits this batch atomically and rejects non-2xx responses. A failed
  // release therefore cannot replace the previously installed working shell.
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(
    SHELL.map(url => new Request(url, { cache: 'reload', credentials: 'same-origin' }))
  )));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(NAMESPACE) && name !== SHELL_CACHE && name !== IMAGE_CACHE)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

function cacheableImage(response) {
  // Opaque no-CORS responses conceal both HTTP errors and the content type.
  // They still display normally online, but must not poison the offline cache.
  return response.ok && response.type !== 'opaque' && !response.redirected &&
    /^image\//i.test(response.headers.get('content-type') || '');
}

function rememberImage(request, response) {
  // Serialize insertion and eviction so concurrent loads cannot exceed the cap.
  imageWrites = imageWrites.catch(() => {}).then(async () => {
    const cache = await caches.open(IMAGE_CACHE);
    await cache.put(request, response);
    const keys = await cache.keys();
    await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_IMAGES))
      .map(key => cache.delete(key)));
  });
  // Quota errors must never prevent an otherwise valid image from displaying.
  return imageWrites.catch(() => {});
}

async function shellResponse(request, canonicalURL) {
  const cache = await caches.open(SHELL_CACHE);
  const saved = await cache.match(canonicalURL);
  return saved || fetch(request);
}

async function imageResponse(event) {
  const request = event.request;
  try {
    const cache = await caches.open(IMAGE_CACHE);
    const saved = await cache.match(request);
    if (saved && cacheableImage(saved)) return saved;
  } catch (_) {
    // A browser may deny cache storage; the original image request still works.
  }
  const response = await fetch(request);
  if (cacheableImage(response)) event.waitUntil(rememberImage(request, response.clone()));
  return response;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === BASE.origin) {
    if (request.mode === 'navigate' &&
        (url.pathname === BASE.pathname || url.pathname === new URL(INDEX_URL).pathname)) {
      event.respondWith(shellResponse(request, INDEX_URL));
      return;
    }
    if (SHELL_URLS.has(url.href)) {
      event.respondWith(shellResponse(request, url.href));
    }
    return;
  }

  // Only image requests actually made by the app are considered. No prefetch,
  // market polling, background sync, tracking endpoints or URL transformations.
  if (request.destination === 'image' && url.protocol === 'https:' && IMAGE_ORIGINS.has(url.origin)) {
    event.respondWith(imageResponse(event));
  }
});
