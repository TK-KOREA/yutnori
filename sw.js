// 오프라인 설치용 서비스워커. tools/stamp.py가 VERSION과 SHELL을 채운다.
const VERSION = '7a95e3cc7599';
const SHELL = [
  './',
  './css/app.css',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-maskable.svg',
  './icons/icon.svg',
  './index.html',
  './js/ai.js',
  './js/anim.js',
  './js/audio.js',
  './js/board.js',
  './js/characters.js',
  './js/fx.js',
  './js/game.js',
  './js/layout.js',
  './js/main.js',
  './js/party.js',
  './js/rules.js',
  './js/scene.js',
  './js/sticks.js',
  './js/theme.js',
  './js/ui.js',
  './js/voice.js',
  './manifest.webmanifest',
  './vendor/three/addons/utils/BufferGeometryUtils.js',
  './vendor/three/three.core.min.js',
  './vendor/three/three.module.min.js',
];
const PREFIX = 'yutnori3-';
const SHELL_CACHE = PREFIX + 'shell-' + VERSION;
const FONT_CACHE = PREFIX + 'font';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX + 'shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 글꼴: 한 번 받으면 캐시에서
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }))));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(caches.open(FONT_CACHE).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/tests/') || url.pathname.includes('/dev/')) return;
  // 페이지 이동은 캐시의 index.html
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('./index.html', { ignoreSearch: true }).then(hit => hit || fetch(req)).catch(() => fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
