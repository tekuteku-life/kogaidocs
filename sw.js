const CACHE_VERSION = '2.8.3';
const CACHE_SCOPE = self.registration.scope;
const CACHE_PREFIX = `kogai-cache-${encodeURIComponent(CACHE_SCOPE)}-`;
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION;
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
	'./js/neighbor.js',
	'./js/transfer.js',
	'./js/print.js',
	'./js/app.js',
	'./js/events.js',
	'./icons/icon-192.png',
	'./icons/icon-512.png',
	'./icons/icon.svg'
];
const ASSET_URLS = new Set(ASSETS.map(asset => new URL(asset, CACHE_SCOPE).href));
const SCOPE_ORIGIN = new URL(CACHE_SCOPE).origin;
const VERSION_URL = new URL('./version.json', CACHE_SCOPE);

function isPublicAssetRequest(request) {
	const url = new URL(request.url);
	return request.method === 'GET' && url.origin === SCOPE_ORIGIN && !url.search &&
		ASSET_URLS.has(url.href) && request.credentials !== 'include' &&
		!request.headers.has('authorization') && !request.headers.has('cookie');
}

function isPublicAssetResponse(response) {
	if (!response || response.status !== 200 || response.type !== 'basic' || response.headers.has('set-cookie')) return false;
	const directives = (response.headers.get('cache-control') || '').split(',');
	return !directives.some(value => /^(private|no-store)\b/i.test(value.trim()));
}

async function fetchPublicAsset(request, cache) {
	// 静的資産の再取得には端末の認証Cookieを送信しない。
	const response = await fetch(request, { credentials: 'omit', cache: 'no-store' });
	try {
		if (isPublicAssetResponse(response)) await cache.put(request, response.clone());
		else await cache.delete(request);
	} catch (_) {
		// CacheStorageの容量不足でも、取得済みのネットワーク応答は利用できる。
	}
	return response;
}

self.addEventListener('install', event => {
	event.waitUntil(
		Promise.all([...ASSET_URLS].map(async url => {
			const request = new Request(url, { credentials: 'omit', cache: 'no-store' });
			const response = await fetch(request);
			if (!isPublicAssetResponse(response)) throw new Error('公開静的資産の取得を拒否しました。');
			return { request, response };
		})).then(async entries => {
			const cache = await caches.open(CACHE_NAME);
			await Promise.all(entries.map(({ request, response }) => cache.put(request, response)));
		}).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', event => {
	event.waitUntil(
		caches.keys().then(keys => {
			return Promise.all(
				keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k))
			);
		}).then(() => self.clients.claim())
	);
});

self.addEventListener('message', event => {
	if (event.data && event.data.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});

self.addEventListener('fetch', event => {
	if (event.request.method !== 'GET') return;

	// version.json は常にキャッシュを介さずネットワークから直接取得
	const url = new URL(event.request.url);
	if (url.origin === SCOPE_ORIGIN && url.pathname === VERSION_URL.pathname) {
		event.respondWith(fetch(event.request, { cache: 'no-store', credentials: 'omit' }));
		return;
	}
	if (!isPublicAssetRequest(event.request)) return;

	event.respondWith(
		caches.open(CACHE_NAME).then(async cache => {
			const cached = await cache.match(event.request);
			if (cached && isPublicAssetResponse(cached)) {
				event.waitUntil(fetchPublicAsset(event.request, cache).catch(() => {}));
				return cached;
			}
			return fetchPublicAsset(event.request, cache);
		})
	);
});
