/*!
 * TodoMemo - 나의 투두리스트 메모장
 * Copyright (c) 2026 Kimwonhee. All rights reserved.
 *
 * 이 앱은 무료로 자유롭게 공유·재배포할 수 있습니다.
 * 단, 원본을 수정하거나 개작하여 배포할 수 없으며, 상업적 이용을 금지합니다.
 * 재배포 시 제작자(Kimwonhee)와 출처를 반드시 표시해 주세요.
 */

/*
 * 업데이트 정책
 *  - HTML: 네트워크 우선. 새 버전이 있으면 바로 반영, 오프라인이면 캐시 사용.
 *  - JS/CSS/이미지: 캐시를 먼저 보여주고 뒤에서 조용히 새 파일을 받아둠.
 *    (앱은 즉시 뜨고, 다음에 열면 최신 버전이 적용됨)
 *  - 폰트 CDN: 캐시 우선. 바뀔 일이 없으므로 한 번 받으면 계속 사용.
 *
 * 이 방식에서는 CACHE_NAME을 매번 올리지 않아도 업데이트가 퍼진다.
 * 캐시를 통째로 비우고 싶을 때만 숫자를 올리면 된다.
 */

const CACHE_NAME = 'todomemo-v14';
const FONT_CACHE = 'todomemo-fonts-v1';

// 오프라인 최초 실행에 필요한 최소한의 파일
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './favicon.png',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png',
  './src/styles.css',
  './src/app.js',
  './src/calendarService.js',
  './src/taskRepository.js',
  './src/driveSync.js',
  './privacy.html',
  './terms.html'
];

const FONT_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 파일 하나가 404여도 설치 전체가 실패하지 않도록 개별 처리
      Promise.all(
        ASSETS.map((url) =>
          cache.add(url).catch((e) => console.warn('캐시 실패:', url, e))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== FONT_CACHE) return caches.delete(key);
        })
      )
    )
  );
  self.clients.claim();
});

// HTML 인지 판별 (주소창 이동 또는 .html 요청)
function isHtmlRequest(request, url) {
  return request.mode === 'navigate'
    || request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // 1) 폰트/아이콘 CDN — 캐시 우선
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.open(FONT_CACHE).then((cache) =>
        cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // 2) HTML — 네트워크 우선 (새 버전을 바로 받기 위함)
  if (isHtmlRequest(request, url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          // 오프라인: 캐시에 있는 것으로 대체
          caches.match(request).then((cached) => cached || caches.match('./index.html'))
        )
    );
    return;
  }

  // 3) 그 외 자산 — 캐시를 먼저 주고, 뒤에서 새 파일을 받아 캐시를 갱신
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      // 캐시가 있으면 즉시 반환하고 갱신은 백그라운드에서 진행
      return cached || network;
    })
  );
});
