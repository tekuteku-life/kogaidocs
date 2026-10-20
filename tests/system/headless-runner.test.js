const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

test('UI runner: startup errors and rejected event handlers fail the browser audit', async () => {
	for (const beforeLoad of [
		() => { throw new Error('startup-sentinel'); },
		() => { window.addEventListener('DOMContentLoaded', () => Promise.reject(new Error('async-sentinel'))); }
	]) {
		const out = await runInHeadlessChrome(() => assert.ok(true), { beforeLoad });
		assert.ok(out.errors.some(error => /sentinel/.test(error.message)), 'Startup/async exceptions must reach the host');
	}
});

test('UI runner: real async WebCrypto completion, special characters and assertion failures survive transport', async () => {
	const out = await runInHeadlessChrome(async () => {
		const encrypted = await encryptPayload('special < > & " \'', 'UiPassword1!');
		assert.strictEqual(await decryptPayload(encrypted, 'UiPassword1!'), 'special < > & " \'', 'Crypto completion < > & " \'');
		assert.ok(false, 'failed < > & " \'');
	});
	assert.equal(out.success, false);
	assert.match(out.fatal.message, /failed < > &/);
	assert.equal(out.results[0].passed, true);
	assert.equal(out.results[1].passed, false);
});

test('UI runner: timeout terminates an unfinished scenario and cleans browser resources', async () => {
	await assert.rejects(runInHeadlessChrome(() => new Promise(() => {}), { timeoutMs: 1500 }), /UI test timed out/);
});
