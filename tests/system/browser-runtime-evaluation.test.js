const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('browser runtime evaluation: all scripts in index.html load cleanly without SyntaxError or ReferenceError in shared global scope', () => {
	const htmlPath = path.resolve(__dirname, '../../index.html');
	const htmlContent = fs.readFileSync(htmlPath, 'utf8');

	// Extract all <script src="..."> from index.html in declaration order
	const scriptSrcMatches = Array.from(htmlContent.matchAll(/<script\s+src="([^"]+)"><\/script>/g));
	const scriptPaths = scriptSrcMatches.map(m => m[1]);

	assert(scriptPaths.length >= 10, `Expected at least 10 scripts in index.html, found ${scriptPaths.length}`);
	assert(scriptPaths.includes('js/state.js'));
	assert(scriptPaths.includes('js/transfer.js'));

	// Create a shared browser-like global sandbox context
	const domMock = {
		value: '',
		style: {},
		innerHTML: '',
		textContent: '',
		className: '',
		classList: {
			add: () => {},
			remove: () => {},
			toggle: () => false,
			contains: () => false
		},
		appendChild: () => {},
		querySelectorAll: () => [],
		querySelector: () => null,
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true,
		focus: () => {}
	};

	const sandbox = {
		window: null,
		document: {
			getElementById: () => domMock,
			querySelectorAll: () => [],
			querySelector: () => null,
			createElement: () => ({ ...domMock }),
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => true
		},
		navigator: {
			userAgent: 'MockBrowser/1.0',
			onLine: true,
			serviceWorker: {
				register: () => Promise.resolve(),
				getRegistrations: () => Promise.resolve([])
			},
			clipboard: {
				writeText: () => Promise.resolve()
			}
		},
		location: {
			href: 'https://localhost/',
			origin: 'https://localhost',
			pathname: '/',
			protocol: 'https:',
			hostname: 'localhost'
		},
		localStorage: {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
			clear: () => {}
		},
		sessionStorage: {
			getItem: () => null,
			setItem: () => {},
			removeItem: () => {},
			clear: () => {}
		},
		console: console,
		Date: Date,
		Math: Math,
		JSON: JSON,
		Uint8Array: Uint8Array,
		ArrayBuffer: ArrayBuffer,
		Promise: Promise,
		setTimeout: setTimeout,
		clearTimeout: clearTimeout,
		setInterval: setInterval,
		clearInterval: clearInterval,
		alert: () => {},
		confirm: () => true,
		prompt: () => '',
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => true
	};
	sandbox.window = sandbox;
	sandbox.globalThis = sandbox;

	const ctx = vm.createContext(sandbox);

	// Evaluate all scripts sequentially in the SAME context, exactly as a browser does
	for (const src of scriptPaths) {
		const fullPath = path.resolve(__dirname, '../../', src);
		assert(fs.existsSync(fullPath), `Script file does not exist: ${src}`);
		const code = fs.readFileSync(fullPath, 'utf8');

		try {
			vm.runInContext(code, ctx, { filename: src });
		} catch (err) {
			assert.fail(`Failed loading "${src}" in shared browser context: ${err.name} - ${err.message}`);
		}
	}

	// Verify required global functions across all modes are defined and callable
	assert.strictEqual(typeof ctx.renderDistrictForm, 'function', 'renderDistrictForm must be defined on window');
	assert.strictEqual(typeof ctx.renderRepAll, 'function', 'renderRepAll must be defined on window');
	assert.strictEqual(typeof ctx.renderNeighborForm, 'function', 'renderNeighborForm must be defined on window');
	assert.strictEqual(typeof ctx.renderTransferForm, 'function', 'renderTransferForm must be defined on window');
	assert.strictEqual(typeof ctx.addTransferChildRow, 'function', 'addTransferChildRow must be defined on window');
	assert.strictEqual(typeof ctx.removeTransferChildRow, 'function', 'removeTransferChildRow must be defined on window');
	assert.strictEqual(typeof ctx.resetTransferForm, 'function', 'resetTransferForm must be defined on window');
	assert.strictEqual(typeof ctx.exportTransferTxt, 'function', 'exportTransferTxt must be defined on window');
	assert.strictEqual(typeof ctx.copyTransferEncryptedText, 'function', 'copyTransferEncryptedText must be defined on window');
	assert.strictEqual(typeof ctx.clearTransferForm, 'function', 'clearTransferForm must be defined on window');
	assert.strictEqual(typeof ctx.saveTransferLocal, 'function', 'saveTransferLocal must be defined on window');
	assert.strictEqual(typeof ctx.loadTransferLocal, 'function', 'loadTransferLocal must be defined on window');

	// Verify state objects exist and have valid structure in lexical scope
	const evaluatedCurrentDistrict = vm.runInContext('currentDistrict', ctx);
	assert(evaluatedCurrentDistrict, 'currentDistrict must be defined in global scope');
	const evaluatedRepState = vm.runInContext('repState', ctx);
	assert(evaluatedRepState, 'repState must be defined in global scope');
	const evaluatedNeighborState = vm.runInContext('neighborState', ctx);
	assert(evaluatedNeighborState, 'neighborState must be defined in global scope');
	const evaluatedTransferState = vm.runInContext('transferState', ctx);
	assert(evaluatedTransferState, 'transferState must be defined in global scope');
	assert(Array.isArray(evaluatedTransferState.children), 'transferState.children must be an array');

	// Verify invocation in shared browser runtime executes without ReferenceError
	const initialChildrenCount = evaluatedTransferState.children.length;
	ctx.addTransferChildRow();
	assert.strictEqual(evaluatedTransferState.children.length, initialChildrenCount + 1, 'addTransferChildRow must add a child');
	ctx.resetTransferForm();
	assert.strictEqual(evaluatedTransferState.children.length, 1, 'resetTransferForm must reset children to 1');
});
