/* 오프라인 캐시용 서비스워커.

   전략: 네트워크 우선(network-first), 캐시는 예비용.
   - 온라인이면 항상 서버의 최신 파일을 쓰고, 받은 응답으로 캐시를 갱신한다.
   - 네트워크가 없거나 4초 안에 응답이 없으면 캐시에 있는 사본으로 대체한다.

   왜 캐시 우선이 아닌가: 캐시 우선으로 두면 배포한 새 코드가 반영되지 않고
   예전 화면이 계속 보인다. 오프라인 지원은 예비용 캐시만으로 충분하다. */

const CACHE_VERSION = 'bighistory-6175a918';
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  './index.html',
  './css/styles.css?v=6175a918',
  './js/data.js?v=6175a918',
  './js/timeline.js?v=6175a918',
  './js/vtimeline.js?v=6175a918',
  './js/app.js?v=6175a918',
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
      .catch((err) => console.warn('[sw] 미리 캐시 실패', err))
      .then(() => self.skipWaiting())
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

function fromNetwork(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS);
    fetch(request).then(
      (response) => { clearTimeout(timer); resolve(response); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    fromNetwork(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        // 오프라인에서 주소창으로 들어온 경우에만 앱 화면으로 대체한다.
        if (request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
