/* Service worker: deixa o app abrir offline.
   As notas em si já ficam no localStorage — isso aqui cacheia só a "casca". */

const VERSION = 'notas-v5';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/app.js',
  './assets/editor.js',
  './assets/config.js',
  './assets/icon.svg',
  './assets/icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // CDN e Supabase passam direto

  // Rede primeiro (pra pegar deploys novos), cache como rede de segurança.
  // `no-cache` não desliga o cache: manda revalidar sempre. O servidor
  // responde 304 quando nada mudou, então continua barato — mas some a
  // janela de 10 minutos em que o GitHub Pages servia arquivo velho.
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        const copy = res.clone();
        caches.open(VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
  );
});
