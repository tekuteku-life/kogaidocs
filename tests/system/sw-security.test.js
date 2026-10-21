const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const scope = 'https://example.test/kogai/';
const ownPrefix = `kogai-cache-${encodeURIComponent(scope)}-`;
const source = fs.readFileSync(path.resolve(__dirname, '../../sw.js'), 'utf8');

function basicResponse(body = 'public asset', options, exposeCookies = false) {
	const headers = new Headers(options?.headers);
	// ブラウザのbasic filtered responseはCookie設定ヘッダーをJSへ公開しない。
	if (!exposeCookies) {
		headers.delete('set-cookie');
		headers.delete('set-cookie2');
	}
	return markBasic(new Response(body, { ...options, headers }));
}

function markBasic(response) {
	Object.defineProperty(response, 'type', { value: 'basic' });
	const clone = response.clone.bind(response);
	response.clone = () => markBasic(clone());
	return response;
}

test('security SW fixture: repeated CacheStorage cloning preserves basic response type and body', async () => {
	let response = basicResponse('fixture public body');
	for (let index = 0; index < 4; index++) {
		response = response.clone();
		assert.equal(response.type, 'basic');
		assert.equal(await response.clone().text(), 'fixture public body');
	}
});

test('security SW fixture: basic filtering hides Cookie headers while preserving public cache policy', () => {
	const response = basicResponse('public asset', { headers: { 'Set-Cookie': 'session=private', 'Cache-Control': 'public, max-age=60' } });
	assert.equal(response.headers.get('set-cookie'), null);
	assert.equal(response.clone().headers.get('set-cookie'), null);
	assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
});

// Request/Responseは実標準オブジェクトであり、ネットワークとCacheStorageの境界だけを置換する。
function worker(responseOptions, { exposeCookies = false } = {}) {
	const listeners = new Map();
	const stores = new Map();
	const writes = [], deletes = [], additions = [], requests = [];
	let skipCount = 0, claimCount = 0;
	const requestKey = request => new URL(typeof request === 'string' ? request : request.url, scope).href;
	const getCache = name => {
		if (!stores.has(name)) stores.set(name, new Map());
		const values = stores.get(name);
		return {
			match: async request => values.get(requestKey(request))?.clone(),
			put: async (request, response) => { writes.push([name, requestKey(request)]); values.set(requestKey(request), response.clone()); },
			addAll: async urls => {
				for (const url of urls) {
					const absolute = requestKey(url);
					additions.push(absolute);
					const request = new Request(absolute);
					const response = await network(request);
					if (!response.ok) throw new Error('Cache.addAll fetch failed');
					// 実Cache.addAll同様、Cache-Control自体を保存拒否条件にはしない。
					writes.push([name, absolute]);
					values.set(absolute, response.clone());
				}
			},
			keys: async () => [...values.keys()].map(url => new Request(url)),
			delete: async request => values.delete(requestKey(request))
		};
	};
	const caches = {
		open: async name => getCache(name),
		keys: async () => [...stores.keys()],
		delete: async name => { deletes.push(name); return stores.delete(name); },
		match: async request => {
			for (const values of stores.values()) {
				const value = values.get(requestKey(request));
				if (value) return value.clone();
			}
		}
	};
	const network = async (request, options) => {
		const input = typeof request === 'string' || request instanceof URL ? new URL(request, scope).href : request;
		const effective = new Request(input, options);
		requests.push({ url: effective.url, options, credentials: effective.credentials, cache: effective.cache });
		return basicResponse('network result', responseOptions, exposeCookies);
	};
	const self = {
		registration: { scope }, location: new URL('sw.js', scope),
		addEventListener: (name, handler) => listeners.set(name, handler),
		skipWaiting: async () => { skipCount++; }, clients: { claim: async () => { claimCount++; } }
	};
	vm.runInNewContext(source, { self, location: self.location, caches, fetch: network, URL, Request, Response, Headers, console });
	return {
		stores, writes, deletes, additions, requests,
		networkFetch: network,
		get skipCount() { return skipCount; }, get claimCount() { return claimCount; },
		seed(name, url, body) { getCache(name); stores.get(name).set(new URL(url, scope).href, basicResponse(body)); },
		async lifecycle(name) {
			let complete;
			listeners.get(name)({ waitUntil: promise => { complete = promise; } });
			await complete;
		},
		async fetch(url, options) {
			const request = new Request(new URL(url, scope), options);
			let response;
			const background = [];
			listeners.get('fetch')({ request, respondWith: promise => { response = promise; }, waitUntil: promise => background.push(promise) });
			const result = await (response || network(request));
			await Promise.all(background);
			await new Promise(resolve => setImmediate(resolve));
			return result;
		}
	};
}

test('security SW fixture: URL strings and Request overrides expose effective fetch credentials and cache mode', async () => {
	const sw = worker();
	await sw.networkFetch(new URL('js/crypto.js', scope).href, { credentials: 'omit', cache: 'no-store' });
	await sw.networkFetch(new Request(new URL('index.html', scope), { credentials: 'include' }), { credentials: 'omit', cache: 'no-store' });
	assert.equal(sw.requests.length, 2);
	assert.ok(sw.requests.every(request => request.credentials === 'omit' && request.cache === 'no-store'));
});

test('security SW: install precaches only public assets in its scope and activates successfully', async () => {
	const sw = worker();
	await sw.lifecycle('install');
	assert.equal(sw.skipCount, 1);
	for (const asset of ['index.html', 'css/style.css', 'js/crypto.js', 'js/events.js', 'icons/icon-192.png']) {
		const url = new URL(asset, scope).href;
		assert.ok(sw.requests.some(request => request.url === url));
		assert.ok([...sw.stores.values()].some(values => values.has(url)), 'Validated asset enters CacheStorage');
	}
	assert.ok(sw.requests.every(request => request.url.startsWith(scope) && !new URL(request.url).search && !request.url.endsWith('/version.json')));
	assert.ok(sw.requests.every(request => request.credentials === 'omit' && request.cache === 'no-store'), 'Installation fetches are anonymous and avoid the HTTP cache');
	assert.ok([...sw.stores.keys()].every(name => name.startsWith(ownPrefix)), 'Cache namespace includes the registration scope');
});

for (const [name, headers] of [
	['private', { 'Cache-Control': 'private' }],
	['no-store', { 'Cache-Control': 'no-store' }],
	['exposed Set-Cookie', { 'Set-Cookie': 'session=private; Secure' }]
]) {
	test(`security SW: install rejects ${name} responses before persisting any asset`, async () => {
		const sw = worker({ headers }, { exposeCookies: name === 'exposed Set-Cookie' });
		await assert.rejects(sw.lifecycle('install'));
		assert.equal(sw.skipCount, 0, 'An incomplete or private installation is not activated');
		assert.deepEqual(sw.writes, [], 'No private installation response is persisted');
	});
}

test('security SW: allowlisted static assets still support a cold fetch and a cached fetch', async () => {
	const sw = worker();
	const first = await sw.fetch('js/crypto.js');
	assert.equal(await first.text(), 'network result');
	assert.ok(sw.writes.some(([, url]) => url === new URL('js/crypto.js', scope).href));
	const currentCache = sw.writes[0][0];
	sw.seed(currentCache, 'js/crypto.js', 'own cached public asset');
	const second = await sw.fetch('js/crypto.js');
	assert.equal(await second.text(), 'own cached public asset', 'The cached response itself reaches the client');
});

for (const cached of [false, true]) {
	test(`security SW: runtime ${cached ? 'background refresh' : 'cold fetch'} is anonymous and bypasses the HTTP cache`, async () => {
		const sw = worker();
		if (cached) {
			await sw.lifecycle('install');
			const currentCache = [...sw.stores.keys()][0];
			sw.seed(currentCache, 'js/crypto.js', 'cached public asset');
			sw.requests.length = 0;
		}
		const response = await sw.fetch('js/crypto.js', { credentials: 'same-origin', cache: 'force-cache' });
		assert.equal(await response.text(), cached ? 'cached public asset' : 'network result');
		assert.equal(sw.requests.length, 1, 'The runtime path performs exactly one observed network refresh');
		assert.equal(sw.requests[0].credentials, 'omit', 'Runtime fetch overrides incoming credential mode');
		assert.equal(sw.requests[0].cache, 'no-store', 'Runtime fetch overrides incoming HTTP cache mode');
	});
}

test('security SW: filtered Cookie headers are not required to classify anonymous public assets', async () => {
	const headers = { 'Set-Cookie': 'hidden=session; Secure', 'Cache-Control': 'public, max-age=60' };
	const installed = worker({ headers });
	await installed.lifecycle('install');
	assert.ok(installed.requests.every(request => request.credentials === 'omit' && request.cache === 'no-store'));
	assert.ok(installed.writes.length > 0, 'Public assets may be cached without seeing the forbidden response header');
	const runtime = worker({ headers });
	const response = await runtime.fetch('js/crypto.js');
	assert.equal(response.headers.get('set-cookie'), null, 'The worker cannot observe the network Set-Cookie header');
	assert.equal(runtime.requests[0].credentials, 'omit', 'Fetch options, rather than the original request, determine effective anonymity');
	assert.ok(runtime.writes.every(([name, url]) => name.startsWith(ownPrefix) && url === new URL('js/crypto.js', scope).href));
	assert.equal(runtime.writes.length, 1);
});

for (const policy of ['private', 'no-store']) {
	test(`security SW: ${policy} remains non-cacheable when a browser hides Set-Cookie`, async () => {
		const headers = { 'Set-Cookie': 'hidden=session', 'Cache-Control': policy };
		const installation = worker({ headers });
		await assert.rejects(installation.lifecycle('install'));
		assert.deepEqual(installation.writes, []);
		const runtime = worker({ headers });
		const response = await runtime.fetch('js/crypto.js');
		assert.equal(response.headers.get('set-cookie'), null);
		assert.equal(response.headers.get('cache-control'), policy);
		assert.equal(runtime.requests[0].credentials, 'omit');
		assert.deepEqual(runtime.writes, [], 'The visible Cache-Control policy enforces the privacy boundary');
	});
}

test('security SW: an asset response in an unrelated cache cannot substitute for the current app cache', async () => {
	const sw = worker();
	sw.seed('other-app-cache', 'js/crypto.js', 'foreign cached script');
	const response = await sw.fetch('js/crypto.js');
	assert.equal(await response.text(), 'network result');
	assert.ok(sw.writes.every(([name]) => name.startsWith(ownPrefix)));
});

for (const [name, url, options] of [
	['version', 'version.json'],
	['version with query', 'version.json?_t=123'],
	['unknown public URL', 'unknown.txt'],
	['private response', 'private/roster.json'],
	['query-bearing asset', 'js/crypto.js?account=secret'],
	['cross-origin URL', 'https://other.test/kogai/js/crypto.js'],
	['outside scope', 'https://example.test/other/js/crypto.js'],
	['Authorization header', 'js/crypto.js', { headers: { Authorization: 'Bearer private-session' } }],
	['Cookie header', 'js/crypto.js', { headers: { Cookie: 'session=private-session' } }],
	['explicit credentials', 'js/crypto.js', { credentials: 'include' }],
	['non-GET request', 'js/crypto.js', { method: 'POST', body: 'private' }]
]) {
	test(`security SW: ${name} is never persisted`, async () => {
		const sw = worker();
		const response = await sw.fetch(url, options);
		assert.equal(await response.text(), 'network result');
		assert.deepEqual(sw.writes, [], `${name} must not enter CacheStorage`);
		if (name.startsWith('version')) assert.equal(sw.requests[0].cache, 'no-store');
	});
}

for (const [policy, headers] of [
	['private', { 'Cache-Control': 'private' }],
	['no-store', { 'Cache-Control': 'no-store' }],
	['exposed Set-Cookie', { 'Set-Cookie': 'session=private; Secure' }]
]) {
	test(`security SW: a ${policy} response cannot be persisted even at an asset URL`, async () => {
		const sw = worker({ headers }, { exposeCookies: policy === 'exposed Set-Cookie' });
		const response = await sw.fetch('js/crypto.js');
		assert.equal(await response.text(), 'network result');
		assert.deepEqual(sw.writes, []);
	});
}

test('security SW: a legacy cached private response is not served for an unknown URL', async () => {
	const sw = worker();
	sw.seed('kogai-cache-v2.8.2', 'private/roster.json', 'old private roster');
	const response = await sw.fetch('private/roster.json');
	assert.equal(await response.text(), 'network result');
	assert.deepEqual(sw.writes, []);
});

test('security SW: activate deletes only stale caches belonging to the exact registration scope', async () => {
	const sw = worker();
	await sw.lifecycle('install');
	const ownOld = `${ownPrefix}old`;
	const otherScope = `kogai-cache-${encodeURIComponent('https://example.test/other/')}-old`;
	const unrelated = ['other-app-cache', otherScope, 'kogai-cache-v2.8.1'];
	for (const name of [ownOld, ...unrelated]) sw.seed(name, 'index.html', name);
	await sw.lifecycle('activate');
	assert.equal(sw.claimCount, 1);
	assert.equal(sw.stores.has(ownOld), false);
	for (const name of unrelated) assert.equal(sw.stores.has(name), true, `Preserve cache not attributable to this scope: ${name}`);
});
