const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { runInHeadlessChrome } = require('../system/helpers/headless-runner');

test('Offline PWA: cached mode navigation starts with server stopped and network disabled', async () => {
	const root = path.resolve(__dirname, '../..');
	const server = http.createServer(async (request, response) => {
		try {
			const pathname = new URL(request.url, 'http://localhost').pathname;
			const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
			if (!target.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
			const body = await fs.readFile(target);
			const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(target)] || 'text/plain';
			response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=0' }); response.end(body);
		} catch (_) { response.writeHead(404).end(); }
	});
	await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const result = await runInHeadlessChrome(async () => {
			await ui.waitFor(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated', 'Real worker activates');
			await ui.waitFor(() => navigator.serviceWorker.controller, 'Worker controls the real page');
			ui.fill('#transfer-address', 'オフライン再起動前'); await saveTransferLocal();
			assert.ok(ui.visible('#transfer-address'), 'Initial mode document is usable');
		}, {
			observeNetwork: true, baseUrl: `http://127.0.0.1:${server.address().port}/index.html`, queryMode: 'transfer', autoSecure: false,
			offlineReload: true,
			beforeReload: () => { server.close(); server.closeAllConnections(); },
			afterReload: async () => {
				assert.strictEqual(navigator.onLine, false, 'Browser network is offline');
				assert.strictEqual(ui.element('#transfer-address').value, 'オフライン再起動前', 'Saved draft restored without a server');
				ui.fill('#transfer-address', '通信なしで入力継続');
				await ui.mode('neighbor'); await ui.mode('transfer');
				assert.strictEqual(ui.element('#transfer-address').value, '通信なしで入力継続', 'Navigation and input work offline');
			}, timeoutMs: 20000
		});
		assert.equal(result.success, true, JSON.stringify(result.fatal || result.results));
		assert.deepEqual(result.errors, []);
	} finally { server.close(); server.closeAllConnections(); }
});
