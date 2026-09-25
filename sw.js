// 오프라인 설치용 서비스워커. tools/stamp.py가 VERSION과 SHELL을 채운다.
const VERSION = 'e2f341dbb113';
const SHELL = [
  './',
  './css/app.css',
  './fonts/gowun-dodum.woff2',
  './fonts/jua.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/icon-maskable.svg',
  './icons/icon.svg',
  './index.html',
  './js/ads.js',
  './js/ai.js',
  './js/anim.js',
  './js/audio.js',
  './js/board.js',
  './js/characters.js',
  './js/fx.js',
  './js/game.js',
  './js/layout.js',
  './js/main.js',
  './js/native.js',
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

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== SHELL_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/tests/') || url.pathname.includes('/dev/')) return;
  // 게임 화면으로 오는 페이지 이동만 캐시의 index.html. privacy.html 같은 다른 페이지는 그대로 네트워크
  if (req.mode === 'navigate') {
    if (!/\/(index\.html)?$/.test(url.pathname)) return;
    e.respondWith(caches.match('./index.html', { ignoreSearch: true }).then(hit => hit || fetch(req)).catch(() => fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
