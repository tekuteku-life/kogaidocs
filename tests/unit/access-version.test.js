const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
require('../../js/utils');
require('../../js/crypto');
require('../../js/state');
const app = require('../../js/app');

for (const stage of ['fetch', 'body']) {
	test(`Version availability: ${stage} timeout aborts, restores manual control and ignores late response`, async t => {
		setupDomEnvironment();
		navigator.onLine = true;
		t.mock.timers.enable({ apis: ['setTimeout'] });
		let release, signal, confirmations = 0;
		global.confirm = () => { confirmations++; return false; };
		const pending = new Promise(resolve => { release = resolve; });
		const originalFetch = global.fetch;
		global.fetch = async (_url, options) => {
			signal = options.signal;
			return stage === 'fetch' ? pending : { ok: true, json: () => pending };
		};
		try {
			const button = document.getElementById('btn-manual-check-update'); button.textContent = '更新';
			const task = app.checkAppVersion(true);
			assert.equal(button.disabled, true);
			t.mock.timers.tick(5000);
			await task;
			assert.equal(signal.aborted, true);
			assert.equal(button.disabled, false);
			assert.equal(button.textContent, '更新');
			assert.match(document.getElementById('version-check-status').textContent, /失敗/);
			release(stage === 'fetch' ? { ok: true, json: async () => ({ version: '999.0.0' }) } : { version: '999.0.0' });
			await Promise.resolve(); await Promise.resolve();
			assert.equal(confirmations, 0, 'Late response never prompts for an update');
		} finally { global.fetch = originalFetch; }
	});
}
