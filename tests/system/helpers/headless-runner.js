const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const rootDir = path.resolve(__dirname, '../../../');

// アプリのスクリプトより先に実行し、初期化中の例外も検知する。
function installBrowserHarness() {
	window.__uiTestResults = [];
	window.__uiErrors = [];
	window.__dialogs = [];
	window.__downloads = [];
	window.__prints = [];
	window.alert = message => window.__dialogs.push({ type: 'alert', message: String(message) });
	window.confirm = message => {
		window.__dialogs.push({ type: 'confirm', message: String(message) });
		return window.__confirmAnswer ?? true;
	};
	window.prompt = message => {
		window.__dialogs.push({ type: 'prompt', message: String(message) });
		return window.__promptAnswers?.length ? window.__promptAnswers.shift() : '';
	};
	window.addEventListener('error', event => {
		window.__uiErrors.push({ message: event.message, filename: event.filename, lineno: event.lineno });
	});
	window.addEventListener('unhandledrejection', event => {
		window.__uiErrors.push({ message: String(event.reason?.stack || event.reason) });
	});
	window.assert = (condition, message = 'Assertion failed') => {
		window.__uiTestResults.push({ name: message, passed: !!condition });
		if (!condition) throw new Error(message);
	};
	window.assert.strictEqual = (actual, expected, message = 'strictEqual') => {
		window.assert(actual === expected, `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	};
	window.assert.notStrictEqual = (actual, expected, message = 'notStrictEqual') => {
		window.assert(actual !== expected, `${message}: expected not ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	};
	window.assert.ok = (value, message = 'ok') => window.assert(!!value, message);

	let commandId = 0;
	const pending = new Map();
	window.__uiCommandResult = (id, error) => {
		const task = pending.get(id);
		pending.delete(id);
		if (error) task.reject(new Error(error));
		else task.resolve();
	};
	const command = (method, params) => new Promise((resolve, reject) => {
		const id = ++commandId;
		pending.set(id, { resolve, reject });
		window.__uiCommand(JSON.stringify({ id, method, params }));
	});
	const element = selector => {
		const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
		if (!el) throw new Error(`Element missing: ${selector}`);
		return el;
	};
	const visible = el => {
		const details = el.closest('details:not([open])');
		return (!details || details.querySelector('summary')?.contains(el)) && !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
	};
	window.ui = {
		element,
		visible: selector => visible(element(selector)),
		async waitFor(predicate, message = 'UI condition', timeout = 5000) {
			const start = performance.now();
			while (!await predicate()) {
				if (performance.now() - start > timeout) throw new Error(`Timed out: ${message}`);
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		},
		async click(selector) {
			const el = element(selector);
			if (!visible(el) || el.disabled) throw new Error(`Control is hidden or disabled: ${selector}`);
			el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
			const rect = el.getBoundingClientRect();
			const x = rect.x + rect.width / 2;
			const y = rect.y + rect.height / 2;
			if (!el.contains(document.elementFromPoint(x, y))) throw new Error(`Control is covered: ${selector}`);
			await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
			await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
		},
		fill(selector, value) {
			const el = element(selector);
			if (!visible(el) || el.disabled) throw new Error(`Input is hidden or disabled: ${selector}`);
			el.focus();
			el.value = String(value);
			el.dispatchEvent(new Event(el.tagName === 'SELECT' || el.type === 'date' || el.type === 'number' ? 'change' : 'input', { bubbles: true }));
		},
		async key(key) {
			const code = { Enter: 13, Escape: 27, Tab: 9 }[key];
			await command('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, ...(key === 'Enter' ? { text: '\r' } : {}) });
			await command('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
		},
		async printMedia(enabled) {
			await command('Emulation.setEmulatedMedia', { media: enabled ? 'print' : 'screen' });
		},
		async mode(mode) {
			await this.click('#mode-active-badge');
			await this.click(`.tab-btn[data-click="switchTab"][data-mode="${mode}"]`);
		},
		async expand(mode) {
			await this.click(`#tab-${mode} button[data-click="setAllCardsCollapse"][data-flag="false"][data-target="tab-${mode}"]`);
		},
		async file(selector, content, name = 'fixture.txt') {
			const input = element(selector);
			const data = new DataTransfer();
			for (const file of (Array.isArray(content) ? content : [{ content, name }])) {
				data.items.add(new File([file.content], file.name, { type: 'text/plain' }));
			}
			input.files = data.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		},
		captureDownloads() {
			window.downloadTextFile = (content, filename) => window.__downloads.push({ content, filename });
		},
		capturePrints() {
			window.print = () => window.__prints.push({ title: document.title, html: document.getElementById('print-area').innerHTML });
		},
		clipboard(reject = false) {
			Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
				writeText: async value => {
					if (reject) throw new Error('Clipboard denied');
					window.__copiedText = value;
				}
			} });
		}
	};
}

/** 実ファイル起動とChrome DevTools Protocolで非同期UI・再読み込みを検証する。 */
async function runInHeadlessChrome(testFn, options = {}) {
	const profileDir = await mkdtemp(path.join(os.tmpdir(), 'kogai-ui-'));

	let browser;
	let timer;
	let stderr = '';
	const pending = new Map();
	const results = [];
	const errors = [];
	try {

		browser = spawn(process.env.CHROMIUM_PATH || (existsSync('/usr/lib/chromium/chromium') ? '/usr/lib/chromium/chromium' : 'chromium'), [
			'--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
			'--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--no-proxy-server',
			`--user-data-dir=${profileDir}`, '--remote-debugging-pipe', 'about:blank'
		], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
		browser.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
		let nextId = 0;
		let buffer = '';
		let sessionId;
		const events = new Map();
		const waitEvent = method => new Promise(resolve => events.set(method, resolve));
		const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
			const id = ++nextId;
			pending.set(id, { resolve, reject });
			browser.stdio[3].write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
		});
		const failPending = error => {
			for (const task of pending.values()) task.reject(error);
			pending.clear();
		};
		browser.once('error', failPending);
		browser.once('exit', (code, signal) => failPending(new Error(`Chromium exited (${code ?? signal}): ${stderr}`)));
		browser.stdio[3].on('error', failPending);
		browser.stdio[4].on('data', chunk => {
			buffer += chunk;
			let end;
			while ((end = buffer.indexOf('\0')) >= 0) {
				const message = JSON.parse(buffer.slice(0, end));
				buffer = buffer.slice(end + 1);
				if (message.id) {
					const task = pending.get(message.id);
					pending.delete(message.id);
					if (!task) continue;
					if (message.error) task.reject(new Error(JSON.stringify(message.error)));
					else task.resolve(message.result);
				} else if (message.method === 'Runtime.bindingCalled') {
					const { id, method, params } = JSON.parse(message.params.payload);
					const allowed = ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Emulation.setEmulatedMedia'];
					(async () => {
						let error = null;
						try {
							if (!allowed.includes(method)) throw new Error(`Unsupported UI command: ${method}`);
							await send(method, params);
						} catch (err) { error = err.message; }
						await send('Runtime.evaluate', { allowUnsafeEvalBlockedByCSP: false, expression: `window.__uiCommandResult(${id}, ${JSON.stringify(error)})` });
					})().catch(failPending);
				} else if (message.sessionId === sessionId && events.has(message.method)) {
					const resolve = events.get(message.method);
					events.delete(message.method);
					resolve(message.params);
				}
			}
		});
		const run = async () => {
			const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
			sessionId = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
			await send('Page.enable');
			await send('Runtime.enable');
			await send('Runtime.addBinding', { name: '__uiCommand' });
			const [width, height] = options.viewport || [1280, 900];
			await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
			await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installBrowserHarness.toString()})();` });
			if (options.beforeLoad) {
				await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${options.beforeLoad.toString()})();` });
			}
			const evaluate = async fn => {
				const response = await send('Runtime.evaluate', { allowUnsafeEvalBlockedByCSP: false, expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true });
				if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
				return response.result.value;
			};
			const ready = async () => {
				await evaluate(async () => {
					await ui.waitFor(() => document.readyState === 'complete' && document.getElementById('mode-active-badge')?.style.display === 'inline-flex', 'Application initialization');
					await new Promise(resolve => setTimeout(resolve, 0));
				});
			};
			const loaded = waitEvent('Page.loadEventFired');
			await send('Page.navigate', { url: `file://${rootDir}/index.html${options.queryMode ? '?mode=' + encodeURIComponent(options.queryMode) : ''}` });
			await loaded;
			await ready();
			for (const [index, fn] of [testFn, options.afterReload].filter(Boolean).entries()) {
				if (index) {
					const reloaded = waitEvent('Page.loadEventFired');
					if (options.reloadSelector) await send('Runtime.evaluate', { allowUnsafeEvalBlockedByCSP: false, expression: `document.querySelector(${JSON.stringify(options.reloadSelector)}).click()` });
					else await send('Page.reload', { ignoreCache: true });
					await reloaded;
					await ready();
				}
				if (options.prepare) await evaluate(options.prepare);
				await evaluate(fn);
				const output = await evaluate(async () => {
					await new Promise(resolve => setTimeout(resolve, 20));
					return { results: __uiTestResults, errors: __uiErrors };
				});
				results.push(...output.results);
				errors.push(...output.errors);
			}
			return { success: true, results, errors };
		};
		return await Promise.race([
			run().catch(async err => {
				// 途中失敗でもブラウザ内のアサーション・例外を失わない。
				try {
					const snapshot = await send('Runtime.evaluate', { allowUnsafeEvalBlockedByCSP: false, expression: '({results: window.__uiTestResults || [], errors: window.__uiErrors || []})', returnByValue: true });
					results.push(...snapshot.result.value.results);
					errors.push(...snapshot.result.value.errors);
				} catch (_) {}
				return { success: false, results, errors, fatal: { message: err.message } };
			}),
			new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`UI test timed out: ${stderr}`)), options.timeoutMs || 20000); })
		]);
	} finally {
		clearTimeout(timer);
		if (browser && browser.exitCode === null && browser.signalCode === null) {
			const exited = new Promise(resolve => browser.once('exit', resolve));
			browser.kill('SIGKILL');
			await exited;
		}
		await rm(profileDir, { recursive: true, force: true, maxRetries: 3 });
	}
}

module.exports = { runInHeadlessChrome };
