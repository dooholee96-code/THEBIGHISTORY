/* 오프라인 캐시용 서비스워커.
   - 앱 셸(HTML/CSS/JS/라이브러리)과 매니페스트는 설치 시 미리 캐시합니다.
   - data/*.json 같은 나머지 동일 출처 GET 요청은 처음 불러온 뒤 캐시에 채웁니다.
   - 데이터를 고쳤는데 옛 화면이 보이면 CACHE_VERSION 을 올리세요. */

const CACHE_VERSION = 'bighistory-v1';

const PRECACHE = [
  './',
  './index.html',
  './css/styles.css',
  './js/data.js',
  './js/timeline.js',
  './js/app.js',
  './vendor/vis-timeline/vis-timeline-graph2d.min.js',
  './vendor/vis-timeline/vis-timeline-graph2d.min.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './data/index.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] 미리 캐시 실패', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // 캐시 우선 — 오프라인에서도 즉시 뜨게 하고, 네트워크 응답으로 캐시를 갱신한다.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
