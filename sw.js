const CACHE_NAME = 'kogai-cache-v1';
const ASSETS = [
	'./',
	'./index.html',
	'./manifest.json',
	'./css/style.css',
	'./js/utils.js',
	'./js/crypto.js',
	'./js/state.js',
	'./js/hata.js',
	'./js/district.js',
	'./js/seat.js',
	'./js/rep.js',
	'./js/print.js',
	'./js/app.js',
	'./icons/icon-192.png',
	'./icons/icon-512.png',
	'./icons/icon.svg'
];

self.addEventListener('install', event => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(cache => {
			return cache.addAll(ASSETS);
		}).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys().then(keys => {
			return Promise.all(
				keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
			);
		}).then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', event => {
	// Only handle GET requests
	if (event.request.method !== 'GET') return;

	event.respondWith(
		caches.match(event.request).then(cached => {
			if (cached) {
				// Fetch updated version in background
				fetch(event.request).then(response => {
					if (response && response.status === 200) {
						caches.open(CACHE_NAME).then(cache => cache.put(event.request, response));
					}
				}).catch(() => {});
				return cached;
			}
			return fetch(event.request).then(response => {
				if (!response || response.status !== 200 || response.type !== 'basic') {
					return response;
				}
				const clone = response.clone();
				caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
				return response;
			});
		})
	);
});

