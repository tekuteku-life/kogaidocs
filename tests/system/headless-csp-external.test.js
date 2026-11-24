const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

// R-25・E-14・I-14-03: 実Chromium（file 起動）で、外部オリジンへの各手段の送信が CSP で拒否されることを確かめる。
// 拒否の根拠は、手段ごとの違反イベント（effectiveDirective・blockedURI）と、CDP の Network.loadingFailed の blockedReason 'csp' である。
// 陽性の対照として、CSP を持たない対照ページで同じ手段の送信が観測できることを先に確かめる。
// R-26・I-15-06: アプリのページでは Trusted Types も強制されるため、ページのスクリプトから外部の script 要素・object・Worker を作れない（TypeError）。
// object の object-src の拒否は、Trusted Types を通らない CDP の DOM.setOuterHTML で入れて確かめる。script-src-elem は動的 import() で確かめる。
// インライン style・<style> 要素も拒否されるため、style の url() は CSSOM で、@font-face は構築したスタイルシートで、@import は一時のスタイルシート（file 起動では 'self' に一致する）で試す。

/**
 * 各手段の識別子・宛先のパス・期待するディレクティブ。サーバーの受信で確かめられる手段には received を付ける。
 * 入れ子の文書・プラグインの拒否はナビゲーションの拒否として報告され、blockedURI は宛先のオリジンだけになる（originOnly）。
 */
const CHANNELS = [
	{ id: 'fetch', directive: 'connect-src', received: true },
	{ id: 'xhr', directive: 'connect-src', received: true },
	{ id: 'websocket', directive: 'connect-src', webSocket: true },
	{ id: 'eventsource', directive: 'connect-src', received: true },
	{ id: 'beacon', directive: 'connect-src' },
	{ id: 'ping', directive: 'connect-src' },
	{ id: 'image', directive: 'img-src' },
	{ id: 'style-url', directive: 'img-src' },
	{ id: 'script', directive: 'script-src-elem', trustedTypes: true },
	{ id: 'import', directive: 'script-src-elem', received: true },
	{ id: 'stylesheet', directive: 'style-src-elem' },
	{ id: 'at-import', directive: 'style-src-elem' },
	{ id: 'font', directive: 'font-src', received: true },
	{ id: 'video', directive: 'media-src' },
	{ id: 'object', directive: 'object-src', originOnly: true, trustedTypes: true, cdp: true },
	{ id: 'iframe', directive: 'frame-src', originOnly: true },
	{ id: 'form', directive: 'form-action' },
	{ id: 'prefetch', directive: 'default-src' },
	{ id: 'icon', directive: 'img-src' },
	// マニフェストは、ブラウザ側の試験関数の後に CDP の Page.getAppManifest で取得させる（manifest）。
	{ id: 'manifest', directive: 'manifest-src', received: true, manifest: true }
];

function externalServer(hits) {
	const server = http.createServer((request, response) => {
		hits.push(`${request.method} ${request.url}`);
		response.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
		response.end('external');
	});
	server.on('upgrade', (request, socket) => { hits.push(`UPGRADE ${request.url}`); socket.destroy(); });
	return server;
}

async function listen(server) {
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	return server.address().port;
}

function close(server) {
	server.close();
	server.closeAllConnections();
}

/** 違反イベントを記録する（ページの読込前に登録する）。 */
function recordViolations() {
	window.__cspViolations = [];
	document.addEventListener('securitypolicyviolation', event => {
		window.__cspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
	});
}

/**
 * 受信で確かめる手段（received）は、別のポートの試験用サーバーへ送る。
 * 受信されない手段の要求は接続を張らないまま保留され、同じホスト・ポートへの同時接続の枠（6本）をふさぐため、
 * 同じサーバーに送ると後の要求（マニフェストなど）が十数秒待たされる。
 */
const originFor = (origins, channel) => channel.received ? origins.receiver : origins.external;

/** @import の手段を入れる一時のスタイルシートを作り、その file: URL を返す（構築したスタイルシートの @import は無視される）。 */
function probeStylesheet(dir, origins) {
	const url = id => `${originFor(origins, CHANNELS.find(channel => channel.id === id))}/probe-${id}`;
	const file = path.join(dir, 'csp-probe.css');
	fs.writeFileSync(file, `@import url("${url('at-import')}");\n`);
	return `file://${file}`;
}

/** 外部オリジンを埋め込んだブラウザ側の試験関数を作る（試験関数はブラウザへ文字列として渡される）。 */
function browserProbe(origins, { expectBlocked, stylesheet }) {
	return new Function(`return async () => {
		const EXT = ${JSON.stringify(origins.external)};
		const RECEIVER = ${JSON.stringify(origins.receiver)};
		const CHANNELS = ${JSON.stringify(CHANNELS)};
		const STYLESHEET = ${JSON.stringify(stylesheet)};
		// Trusted Types で拒否された手段（アプリのページだけ。TypeError）。
		window.__trustedTypesRejected = [];
		const rejectedByTrustedTypes = (id, run) => { try { return run(); } catch (error) { window.__trustedTypesRejected.push(id + ':' + error.name); return null; } };
		assert.strictEqual(JSON.stringify(window.__cspViolations), '[]', 'Start-up satisfies the CSP');
		const settle = run => Promise.resolve().then(run).catch(() => {});
		const url = id => (CHANNELS.find(channel => channel.id === id).received ? RECEIVER : EXT) + '/probe-' + id;
		const add = (tag, attributes, text, parent = document.body) => {
			const element = document.createElement(tag);
			for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
			element.setAttribute('data-csp-probe', '');
			if (text) element.textContent = text;
			parent.appendChild(element);
			return element;
		};
		await settle(() => fetch(url('fetch'), { mode: 'no-cors' }));
		await settle(() => { const xhr = new XMLHttpRequest(); xhr.open('GET', url('xhr')); xhr.send(); });
		await settle(() => new WebSocket(url('websocket').replace('http:', 'ws:')));
		await settle(() => new EventSource(url('eventsource')));
		await settle(() => navigator.sendBeacon(url('beacon'), 'payload'));
		add('a', { href: '#csp-ping', ping: url('ping') }, 'ping').click();
		add('img', { src: url('image') });
		// インライン style は拒否されるため、style の url() は CSSOM（要素のスタイルのプロパティ）で設定する。
		const styled = add('div', {});
		styled.style.width = '10px'; styled.style.height = '10px';
		styled.style.backgroundImage = 'url("' + url('style-url') + '")';
		rejectedByTrustedTypes('script', () => add('script', { src: url('script') }, '', document.head));
		settle(() => import(url('import')));
		add('link', { rel: 'stylesheet', href: url('stylesheet') }, '', document.head);
		// @import は一時のスタイルシート（自オリジンの file: URL）の中に、@font-face は構築したスタイルシートに置く。
		add('link', { rel: 'stylesheet', href: STYLESHEET }, '', document.head);
		const fontSheet = new CSSStyleSheet();
		fontSheet.replaceSync('@font-face { font-family: cspProbe; src: url("' + url('font') + '"); } .csp-probe-font { font-family: cspProbe; }');
		document.adoptedStyleSheets = [...document.adoptedStyleSheets, fontSheet];
		add('div', { class: 'csp-probe-font' }, 'CSP probe');
		add('video', { src: url('video') });
		rejectedByTrustedTypes('object', () => add('object', { data: url('object') }));
		add('iframe', { src: url('iframe') });
		const target = add('iframe', { name: 'csp-probe-form-target', sandbox: '' });
		const form = add('form', { action: url('form'), method: 'post', target: target.name });
		await settle(() => form.submit());
		add('link', { rel: 'prefetch', href: url('prefetch') }, '', document.head);
		add('link', { rel: 'icon', href: url('icon') }, '', document.head);
		const manifest = document.querySelector('link[rel="manifest"]') || add('link', { rel: 'manifest' }, '', document.head);
		manifest.setAttribute('href', url('manifest'));
		// worker-src: 外部オリジンの Worker は file 起動では CSP の判定より前に例外となるため、blob:・data: の Worker で確かめる。
		window.__workerMessages = [];
		for (const [index, source] of [URL.createObjectURL(new Blob(['postMessage("blob")'], { type: 'text/javascript' })), 'data:text/javascript,postMessage("data")'].entries()) {
			await settle(() => rejectedByTrustedTypes(['worker-blob', 'worker-data'][index], () => { new Worker(source).onmessage = event => window.__workerMessages.push(event.data); }));
		}
		if (${expectBlocked}) {
			const blockedUri = channel => channel.originOnly ? EXT : channel.webSocket ? url(channel.id).replace('http:', 'ws:') : url(channel.id);
			const blockedBy = channel => window.__cspViolations.some(event => event.directive === channel.directive && event.blocked === blockedUri(channel));
			const pageChannels = CHANNELS.filter(channel => !channel.manifest && !channel.trustedTypes);
			await ui.waitFor(() => pageChannels.every(blockedBy), 'Every channel is refused by its directive', 10000).catch(() => {});
			for (const channel of pageChannels) assert.ok(blockedBy(channel), channel.id + ' is refused by ' + channel.directive + ': ' + JSON.stringify(window.__cspViolations));
			// Trusted Types のもとでは、外部の script 要素・object・文字列の URL の Worker を作れない（worker-src の拒否はこのため観測できず、CSP の文字列の固定で確かめる）。
			assert.strictEqual(JSON.stringify(window.__trustedTypesRejected.sort()), JSON.stringify(['object:TypeError', 'script:TypeError', 'worker-blob:TypeError', 'worker-data:TypeError']), 'Trusted Types rejects script, object and worker URLs: ' + JSON.stringify(window.__trustedTypesRejected));
			assert.strictEqual(JSON.stringify(window.__workerMessages), '[]', 'No worker runs');
			assert.ok(window.__cspViolations.every(event => [EXT, EXT.replace('http:', 'ws:'), RECEIVER].some(origin => event.blocked.startsWith(origin)) || event.directive === 'require-trusted-types-for'), 'Only the probes violate the policy: ' + JSON.stringify(window.__cspViolations));
		} else {
			assert.strictEqual(JSON.stringify(window.__trustedTypesRejected), '[]', 'Control: nothing is rejected by Trusted Types');
			await ui.waitFor(() => window.__workerMessages.length === 2, 'Control: both workers run', 10000);
			assert.strictEqual(JSON.stringify(window.__workerMessages.sort()), JSON.stringify(['blob', 'data']), 'Control: blob: and data: workers run');
			assert.strictEqual(JSON.stringify(window.__cspViolations), '[]', 'The control page has no policy to violate');
		}
		assert.strictEqual(location.hash, '#csp-ping', 'The page stays on this document; only the ping anchor moved the fragment');
	};`)();
}

/** マニフェストを取得させたうえで、期待する観測が揃うまで待つ（固定の待機は使わない）。 */
function waitObserved(predicate, label, timeout = 10000) {
	return async observed => {
		await observed.send('Page.getAppManifest');
		const start = Date.now();
		while (!predicate(observed)) {
			if (Date.now() - start > timeout) throw new Error(`Timed out: ${label} ${JSON.stringify(observed.requests.map(request => request.url))}`);
			await new Promise(resolve => setTimeout(resolve, 20));
		}
	};
}

const probeUrl = (origin, id) => `${origin}/probe-${id}`;
async function violations(observed) {
	return observed.evaluate(() => window.__cspViolations);
}

const sentTo = (observed, origins, channel) => channel.webSocket
	? observed.webSockets.some(socket => socket.url === probeUrl(originFor(origins, channel), channel.id).replace('http:', 'ws:'))
	: observed.requests.some(request => request.url === probeUrl(originFor(origins, channel), channel.id));

/** 試験用の外部サーバーを2つ（受信で確かめる手段用と、それ以外用）起動する。受信は同じ一覧に記録する。 */
async function startExternalServers(hits) {
	const servers = [externalServer(hits), externalServer(hits)];
	const [external, receiver] = await Promise.all(servers.map(async server => `http://127.0.0.1:${await listen(server)}`));
	return { servers, origins: { external, receiver } };
}

test('UI R-25 control: without a CSP every probe channel is observable in the same Chromium', async () => {
	const hits = [];
	const { servers, origins } = await startExternalServers(hits);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-csp-control-'));
	try {
		fs.writeFileSync(path.join(dir, 'control.html'), '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>control</title></head><body><p>control</p></body></html>');
		const received = CHANNELS.filter(channel => channel.received);
		const result = await runInHeadlessChrome(browserProbe(origins, { expectBlocked: false, stylesheet: probeStylesheet(dir, origins) }), {
			baseUrl: `file://${dir}/control.html`, appReady: false, observeNetwork: true, timeoutMs: 30000, beforeLoad: recordViolations,
			settle: waitObserved(observed => CHANNELS.every(channel => sentTo(observed, origins, channel))
				&& received.every(channel => hits.includes(`GET /probe-${channel.id}`)), 'Control observations')
		});
		assert.equal(result.success, true, JSON.stringify({ fatal: result.fatal, failures: result.results.filter(entry => !entry.passed) }));
		for (const channel of CHANNELS) assert.ok(sentTo(result, origins, channel), `Control: ${channel.id} is sent`);
		for (const channel of received) assert.ok(hits.includes(`GET /probe-${channel.id}`), `Control: the server receives ${channel.id}`);
		assert.equal(result.failures.filter(failure => failure.blockedReason === 'csp').length, 0, 'Control: nothing is blocked by a CSP');
	} finally {
		servers.forEach(close);
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('UI R-25: every channel to an external origin is refused by its CSP directive and no request leaves the page', async () => {
	const hits = [];
	const { servers, origins } = await startExternalServers(hits);
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-csp-probe-'));
	let manifestViolation;
	let objectViolation;
	let pageViolations = [];
	try {
		const prefixes = [origins.external, origins.external.replace('http:', 'ws:'), origins.receiver];
		const toExternal = request => prefixes.some(prefix => request.url.startsWith(prefix));
		const result = await runInHeadlessChrome(browserProbe(origins, { expectBlocked: true, stylesheet: probeStylesheet(dir, origins) }), {
			queryMode: 'district', autoSecure: false, observeNetwork: true, timeoutMs: 30000, beforeLoad: recordViolations,
			settle: async observed => {
				// object は Trusted Types を通らない CDP の DOM.setOuterHTML で入れ、object-src の拒否を確かめる。
				const { root } = await observed.send('DOM.getDocument', { depth: 0 });
				const { nodeId } = await observed.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.csp-probe-font' });
				await observed.send('DOM.setOuterHTML', { nodeId, outerHTML: `<div class="csp-probe-font">CSP probe</div><object data="${probeUrl(origins.external, 'object')}"></object>` });
				const objectStart = Date.now();
				while (!(objectViolation = (await violations(observed)).find(event => event.directive === 'object-src'))) {
					if (Date.now() - objectStart > 10000) throw new Error('Timed out: object-src violation');
					await new Promise(resolve => setTimeout(resolve, 20));
				}
				await waitObserved(current => current.requests.filter(toExternal).every(request => current.failures.some(failure => failure.requestId === request.requestId))
					&& current.requests.some(request => request.url === `${origins.receiver}/probe-manifest`), 'Blocked requests end')(observed);
				const start = Date.now();
				while (!(manifestViolation = (await violations(observed)).find(event => event.directive === 'manifest-src'))) {
					if (Date.now() - start > 10000) throw new Error('Timed out: manifest-src violation');
					await new Promise(resolve => setTimeout(resolve, 20));
				}
				pageViolations = await violations(observed);
			}
		});
		assert.equal(result.success, true, JSON.stringify({ fatal: result.fatal, failures: result.results.filter(entry => !entry.passed) }));
		assert.deepEqual(result.errors, []);
		const externalRequests = result.requests.filter(toExternal);
		for (const request of externalRequests) {
			const failure = result.failures.find(entry => entry.requestId === request.requestId);
			assert.equal(failure?.blockedReason, 'csp', `${request.url} is blocked by the CSP before it is sent`);
		}
		assert.ok(externalRequests.length > 0, 'Some blocked requests are visible to the network observer (XHR, images, scripts and others)');
		assert.deepEqual(manifestViolation, { directive: 'manifest-src', blocked: `${origins.receiver}/probe-manifest` }, 'The manifest is refused by manifest-src');
		assert.deepEqual(objectViolation, { directive: 'object-src', blocked: origins.external }, 'An object inserted outside Trusted Types is refused by object-src');
		assert.ok(pageViolations.every(event => prefixes.some(prefix => event.blocked.startsWith(prefix)) || event.directive === 'require-trusted-types-for'), 'Only the probes violate the policy');
		assert.deepEqual(result.webSockets.filter(toExternal), [], 'No WebSocket is created');
		assert.deepEqual(hits, [], 'The external servers receive no request, including the channels they received in the control');
	} finally {
		servers.forEach(close);
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('UI R-25 / E-14-04: a real file save completes under the CSP without any violation', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-csp-download-'));
	try {
		const result = await runInHeadlessChrome(async () => {
			assert.strictEqual(JSON.stringify(window.__cspViolations), '[]', 'Start-up satisfies the CSP');
			downloadTextFile('CSP保存確認\nline2', 'csp-download.txt');
			// 番兵の違反を起こし、それが届くまで待ってから、保存による違反がないことを確かめる。
			const sentinel = 'http://127.0.0.1:9/csp-download-sentinel';
			const image = document.createElement('img');
			image.src = sentinel;
			document.body.appendChild(image);
			await ui.waitFor(() => window.__cspViolations.some(event => event.blocked === sentinel), 'Sentinel violation');
			image.remove();
			assert.strictEqual(JSON.stringify(window.__cspViolations), JSON.stringify([{ directive: 'img-src', blocked: sentinel }]), 'Saving a file does not violate the CSP');
		}, { queryMode: 'district', autoSecure: false, downloadDir: dir, expectDownloads: 1, timeoutMs: 30000, beforeLoad: recordViolations });
		assert.equal(result.success, true, JSON.stringify({ fatal: result.fatal, failures: result.results.filter(entry => !entry.passed) }));
		assert.deepEqual(result.downloads, [{ filename: 'csp-download.txt', state: 'completed' }]);
		assert.equal(fs.readFileSync(path.join(dir, 'csp-download.txt'), 'utf8'), 'CSP保存確認\nline2');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('UI R-25 / E-14-03: spell checking and writing suggestions are off for existing and newly added input fields', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		const fields = () => [...document.querySelectorAll('input:not([type]), input[type="text"], input[type="tel"], input[type="email"], input[type="search"], textarea')];
		const before = fields().length;
		assert.ok(before > 50, 'The district form has many text fields: ' + before);
		await ui.click('#btn-add-neighbor-top');
		assert.ok(fields().length > before, 'A neighborhood row was added');
		assert.strictEqual(fields().filter(field => field.spellcheck).length, 0, 'No text field is spell checked');
		assert.strictEqual(fields().filter(field => field.writingSuggestions !== 'false').length, 0, 'No text field offers writing suggestions');
		assert.strictEqual(document.body.spellcheck, false, 'The page disables spell checking');
	}, { queryMode: 'district', timeoutMs: 30000 });
	assert.equal(result.success, true, JSON.stringify({ fatal: result.fatal, failures: result.results.filter(entry => !entry.passed) }));
	assert.deepEqual(result.errors, []);
});
