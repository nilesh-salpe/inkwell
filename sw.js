/* Inkwell service worker — makes the editor work with no network.
   Strategy: network-first for the app shell (so updates land quickly),
   cache-first for immutable CDN libraries and fonts. */
const VERSION = 'inkwell-v18';
const CORE = [
  './',
  './index.html',
  './markdown/',
  './markdown/index.html',
  './json/',
  './json/index.html',
  './yaml/',
  './yaml/index.html',
  './jwt/',
  './jwt/index.html',
  './xml/',
  './xml/index.html',
  './csv/',
  './csv/index.html',
  './id/',
  './id/index.html',
  './escape/',
  './escape/index.html',
  './hash/',
  './hash/index.html',
  './diff/',
  './diff/index.html',
  './regex/',
  './regex/index.html',
  './text/',
  './text/index.html',
  './base/',
  './base/index.html',
  './color/',
  './color/index.html',
  './aes/',
  './aes/index.html',
  './guides/',
  './guides/index.html',
  './guides/markdown-to-pdf/',
  './guides/json-to-csv/',
  './guides/uuid-versions/',
  './assets/css/app.css',
  './assets/js/shell.js',
  './assets/js/markdown.js',
  './assets/js/json.js',
  './assets/js/yaml.js',
  './assets/js/jwt.js',
  './assets/js/xml.js',
  './assets/js/csv.js',
  './assets/js/ids.js',
  './assets/js/escape.js',
  './assets/js/diff.js',
  './assets/js/regex.js',
  './assets/js/regex-worker.js',
  './assets/js/text.js',
  './assets/js/base.js',
  './assets/js/color.js',
  './assets/js/aes.js',
  './assets/js/hash.js',
  './assets/js/hashes.js',
  './assets/js/data-tools.js',
  'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js',
  'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js',
  'https://cdn.jsdelivr.net/npm/dompurify@3.1.6/dist/purify.min.js',
  'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js',
  'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css',
  'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css',
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(CORE.map((u) => c.add(new Request(u, { mode: 'cors' })))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isCdn = url.hostname === 'cdn.jsdelivr.net';
  const isLocal = url.origin === self.location.origin;
  if (!isCdn && !isLocal) return;

  if (isCdn) {                                   /* versioned URLs — safe to cache forever */
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
  );
});
