const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.resolve(__dirname, '../../../');

/**
 * Runs a test function inside a Headless Chromium browser instance with real DOM,
 * Web Cryptography API, localStorage, and full kogaidocs script suite.
 * 
 * @param {Function} testFn - Async function executed in the browser context.
 * @param {Object} [options]
 * @param {string} [options.queryMode] - Optional URL query parameter e.g. 'transfer'
 * @param {number} [options.timeoutMs=15000] - Headless browser execution timeout
 * @returns {Promise<{ success: boolean, results: Array<{name: string, passed: boolean, error?: string}>, errors: Array<any>, fatal?: any }>}
 */
function runInHeadlessChrome(testFn, options = {}) {
	const htmlPath = path.join(rootDir, 'index.html');
	const runnerHtml = path.join(rootDir, `.headless-runner-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.html`);

	const fnString = testFn.toString();
	const scriptBody = `(${fnString})()`;

	let html = fs.readFileSync(htmlPath, 'utf8');
	const injection = `
	<script>
	window.alert = function(msg) { /* stub for headless */ };
	window.confirm = function(msg) { return true; };
	window.prompt = function(msg) { return ''; };
	window.downloadTextFile = function(content, filename) { window.__lastDownloaded = { content, filename }; };
	window.__uiTestResults = [];
	window.__uiErrors = [];
	window.addEventListener('error', (e) => {
		window.__uiErrors.push({ message: e.message, filename: e.filename, lineno: e.lineno });
	});

	window.assert = function(cond, msg) {
		if (!cond) {
			const err = new Error(msg || 'Assertion failed');
			window.__uiTestResults.push({ name: msg || 'Assertion', passed: false, error: err.message, stack: err.stack });
			throw err;
		} else {
			window.__uiTestResults.push({ name: msg || 'Assertion', passed: true });
		}
	};
	window.assert.strictEqual = function(a, b, msg) {
		window.assert(a === b, (msg || 'strictEqual') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
	};
	window.assert.notStrictEqual = function(a, b, msg) {
		window.assert(a !== b, (msg || 'notStrictEqual') + ': expected not ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
	};
	window.assert.ok = function(a, msg) {
		window.assert(!!a, msg || 'ok');
	};

	window.addEventListener('load', async () => {
		// Wait for DOMContentLoaded async initialization to complete
		await new Promise(r => setTimeout(r, 200));
		try {
			await ${scriptBody};
			window.__uiDone = { success: true, results: window.__uiTestResults, errors: window.__uiErrors };
		} catch (err) {
			window.__uiDone = { success: false, results: window.__uiTestResults, errors: window.__uiErrors, fatal: { message: err.message, stack: err.stack } };
		} finally {
			const el = document.createElement('div');
			el.id = '__UI_TEST_OUTPUT__';
			el.textContent = JSON.stringify(window.__uiDone);
			document.body.appendChild(el);
		}
	});
	</script>
	`;

	html = html.replace('</body>', () => `${injection}</body>`);
	fs.writeFileSync(runnerHtml, html);

	const url = 'file://' + runnerHtml + (options.queryMode ? `?mode=${options.queryMode}` : '');
	const profileDir = `/tmp/chr-ui-prof-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

	try {
		const res = spawnSync('chromium', [
			'--headless=new',
			'--no-sandbox',
			'--disable-gpu',
			'--disable-crash-reporter',
			`--user-data-dir=${profileDir}`,
			'--virtual-time-budget=25000',
			'--run-all-compositor-stages-before-draw',
			'--dump-dom',
			url
		], { encoding: 'utf8', maxBuffer: 15 * 1024 * 1024, timeout: options.timeoutMs || 25000 });

		const match = res.stdout && res.stdout.match(/<div id="__UI_TEST_OUTPUT__">([\s\S]*?)<\/div>/);
		if (!match) {
			throw new Error('Headless execution failed to return test output.\nStderr: ' + (res.stderr || '') + '\nStdout tail: ' + (res.stdout ? res.stdout.slice(-1500) : ''));
		}
		return JSON.parse(match[1]);
	} finally {
		if (fs.existsSync(runnerHtml)) {
			try { fs.unlinkSync(runnerHtml); } catch (_) {}
		}
		if (fs.existsSync(profileDir)) {
			try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {}
		}
	}
}

module.exports = {
	runInHeadlessChrome
};
