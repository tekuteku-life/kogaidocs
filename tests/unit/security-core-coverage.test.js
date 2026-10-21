const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');
setupDomEnvironment();
const utils = require('../../js/utils');
const crypt = require('../../js/crypto');
const state = require('../../js/state');
require('../../js/hata');
require('../../js/seat');
require('../../js/rep');
require('../../js/district');
require('../../js/neighbor');
require('../../js/transfer');
require('../../js/print');
const app = require('../../js/app');
const applicationStartup = window.listeners.DOMContentLoaded.at(-1);

const password = 'CoreSecurity1!';
const keys = ['district', 'rep', 'neighbor', 'transfer'].map(mode => `kogai_${mode}_v2`);
const authKey = crypt.STORAGE_AUTH_KEY;

function fresh() {
	setupDomEnvironment();
	window.listeners = {};
	crypt.clearStorageSecurity();
	app.resetAutoLockTimer();
	state.currentDistrict = createMockDistrict({ district: '保持地区' });
	state.repState = createMockRepState();
	state.neighborState = { district: '保持自治会', neighborhood: [{ role: '会長', lastName: '保持会長' }] };
	state.transferState = { children: [], memo: '入力途中' };
}

async function legacyStorage({ fallbackTransfer = false, biometric = false } = {}) {
	const values = [state.currentDistrict, state.repState, state.neighborState, state.transferState];
	if (fallbackTransfer) values[3] = { ...values[3], district: '旧転入地区' };
	const key = await crypt.generateMasterKey();
	const raw = await crypto.subtle.exportKey('raw', key);
	let passwordMeta, biometricMeta;
	try {
		passwordMeta = await crypt.wrapKeyWithPassword(raw, password, undefined, 100000);
		if (biometric) biometricMeta = await crypt.registerWebAuthnPrf(raw);
	} finally { new Uint8Array(raw).fill(0); }
	for (const [index, storageKey] of keys.entries()) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(values[index])));
		localStorage.setItem(storageKey, 'STORAGE_ENC:' + Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]).toString('base64'));
	}
	localStorage.setItem(authKey, JSON.stringify({ isEncrypted: true, version: 1, password: passwordMeta, webauthn: biometricMeta }));
	crypt.lockStorage();
}

test('security core: legacy password and biometric unlock migrate authenticated models through actual module code', async () => {
	for (const biometric of [false, true]) {
		fresh();
		await legacyStorage({ biometric });
		if (biometric) await crypt.unlockStorageWithWebAuthn();
		else await crypt.unlockStorageWithPassword(password);
		assert.equal(JSON.parse(localStorage.getItem(authKey)).storageFormat, 2);
		assert.ok(keys.every(key => localStorage.getItem(key).startsWith('STORAGE_ENC:2:')));
		assert.equal((await crypt.loadStorageDecrypted(keys[0])).district, '保持地区');
		assert.equal((await crypt.loadStorageDecrypted(keys[2])).neighborhood[0].lastName, '保持会長');
		assert.equal((await crypt.loadStorageDecrypted(keys[3])).memo, '入力途中');
	}
});

test('security core: untrusted password work factors are rejected by the regular module before derivation', async () => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	crypt.lockStorage();
	for (const iterations of [0, '600000']) {
		const meta = JSON.parse(localStorage.getItem(authKey));
		meta.password.iterations = iterations;
		localStorage.setItem(authKey, JSON.stringify(meta));
		await assert.rejects(crypt.unlockStorageWithPassword(password), /STORAGE_AUTH_INVALID/);
	}
});

test('security core: legacy migration rollback preserves every original value after a quota failure', async t => {
	fresh();
	await legacyStorage();
	const before = { ...localStorage.store };
	const setItem = localStorage.setItem.bind(localStorage);
	t.mock.method(localStorage, 'setItem', (key, value) => {
		if (key === keys[2] && value.startsWith('STORAGE_ENC:2:')) throw new Error('migration quota');
		setItem(key, value);
	});
	await assert.rejects(crypt.unlockStorageWithPassword(password), /migration quota/);
	assert.deepEqual(localStorage.store, before);
	assert.equal(crypt.isStorageUnlocked(), false);
});

test('security core: optional legacy validation fallback preserves supported model data', async t => {
	fresh();
	await legacyStorage({ fallbackTransfer: true });
	const validate = global.validateStoredData;
	global.validateStoredData = undefined;
	t.after(() => { global.validateStoredData = validate; });
	await crypt.unlockStorageWithPassword(password);
	assert.equal((await crypt.loadStorageDecrypted(keys[0])).district, '保持地区');
	assert.equal((await crypt.loadStorageDecrypted(keys[2])).district, '保持自治会');
	assert.equal((await crypt.loadStorageDecrypted(keys[3])).memo, '入力途中');
});

test('security core: unsupported authentication versions and malformed wrappers never authorize storage', async () => {
	fresh();
	for (const meta of [null, [], {}, { isEncrypted: false },
		{ isEncrypted: true, password: { salt: '', iv: 'a', wrappedKey: 'b' } },
		{ isEncrypted: true, password: { salt: 'a', iv: 'b', wrappedKey: 'c' }, storageFormat: 99 }]) {
		localStorage.setItem(authKey, JSON.stringify(meta));
		await assert.rejects(crypt.unlockStorageWithPassword(password), /STORAGE_AUTH_INVALID|STORAGE_FORMAT_UNSUPPORTED/);
		assert.equal(crypt.isStorageUnlocked(), false);
	}
	crypt.clearStorageSecurity();
	await assert.rejects(crypt.registerWebAuthnForActiveKey(), /設定されていません/);
	assert.equal(crypt.isStorageUnlocked(), false, 'Missing protection cannot supply a biometric wrapping key');
});

test('security core: a defensive authentication decoder failure invalidates even an unchanged live snapshot', async t => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	const raw = localStorage.getItem(authKey);
	const parse = JSON.parse;
	t.mock.method(JSON, 'parse', value => {
		if (value === raw) throw new Error('auth decoder failed');
		return parse(value);
	});
	assert.equal(crypt.isStorageUnlocked(), false);
	assert.equal(await crypt.saveStorageData(keys[0], { district: '書込禁止' }), false);
	assert.equal(localStorage.getItem(authKey), raw);
});

test('security core: truncated and format-confused ciphertext fails before restoring any data', async () => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	const original = localStorage.getItem(keys[0]);
	for (const bad of ['STORAGE_ENC:2:AAAA', original.replace('STORAGE_ENC:2:', 'STORAGE_ENC:')]) {
		localStorage.setItem(keys[0], bad);
		await assert.rejects(crypt.loadStorageDecrypted(keys[0]), /STORAGE_CIPHERTEXT_INVALID|STORAGE_FORMAT_DOWNGRADE/);
	}
	fresh();
	await legacyStorage();
	for (const bad of ['', '{"district":"unprotected"}', 'STORAGE_ENC:2:AAAA']) {
		const original = localStorage.getItem(keys[0]);
		localStorage.setItem(keys[0], bad);
		await assert.rejects(crypt.unlockStorageWithPassword(password), /STORAGE_DATA_MISSING|STORAGE_FORMAT_INVALID/);
		localStorage.setItem(keys[0], original);
	}
});

test('security core: submitted plaintext size and locked-session imports reject before decryption', async () => {
	fresh();
	await assert.rejects(crypt.parseTxtContent('a'.repeat(8 * 1024 * 1024 + 1), password), /サイズ/);
	await crypt.setupStorageEncryption(password, false);
	crypt.lockStorage();
	await assert.rejects(crypt.parseTxtContent('not ciphertext', password), /STORAGE_SESSION_CHANGED/);
});

test('security core: metadata deletion during encryption prevents a late write without a storage event', async t => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
	let release, reached;
	const started = new Promise(resolve => { reached = resolve; });
	const gate = new Promise(resolve => { release = resolve; });
	t.mock.method(crypto.subtle, 'encrypt', async (...args) => {
		const value = await encrypt(...args); reached(); await gate; return value;
	});
	const pending = crypt.saveStorageData(keys[0], { district: '遅延秘密' });
	await started;
	localStorage.removeItem(authKey);
	const before = { ...localStorage.store };
	release();
	assert.equal(await pending, false);
	assert.deepEqual(localStorage.store, before);
	assert.equal(crypt.isStorageUnlocked(), false);
});

test('security core: startup rejects malformed plaintext storage with a visible notice', async () => {
	fresh();
	navigator.onLine = false;
	localStorage.setItem(keys[1], JSON.stringify({ districts: 'bad-list' }));
	await applicationStartup();
	assert.match(global.__lastAlert, /保存データが不正/);
	assert.equal(state.currentDistrict.district, '保持地区');
	assert.equal(localStorage.getItem(keys[1]), '{"districts":"bad-list"}');
});

test('security core: browser globals restore atomically without the optional CommonJS state bridge', async t => {
	fresh();
	localStorage.setItem(keys[0], JSON.stringify(createMockDistrict({ district: 'ブラウザ復元地区' })));
	const bridge = global.state;
	delete global.state;
	t.after(() => { global.state = bridge; });
	await app.loadAppDataFromStorage();
	assert.equal(global.currentDistrict.district, 'ブラウザ復元地区');
	assert.equal(global.transferState.memo, '入力途中');
});

test('security core: cached flag schedules require plain records, text fields and actual boolean flags', () => {
	fresh();
	const schedule = [{ date: '2026-10-21', day: '水', dayOfWeek: '水', type: 'special', tag: '特別',
		person: '__proto__', note: '注記', originalPerson: '元担当', isSpecial: true, isSwapped: false }, {}];
	assert.deepEqual(utils.validateHataConfig({ schedule }).schedule, schedule);
	for (const value of [null, [], { person: {} }, { isSpecial: 'false' }, { isSwapped: 1 }]) {
		assert.throws(() => utils.validateHataConfig({ schedule: [value] }), /フォーマット/);
	}
	assert.throws(() => utils.validateHataConfig({ schedule: {} }), /フォーマット/);
	const draft = { children: [{ id: 'c1', lastName: '', firstName: '', grade: '1', className: '1' }] };
	assert.equal(utils.validateStoredData(draft, keys[3]).memo, '');
	for (const bad of [{ children: [null] }, { children: [{ grade: 1 }] }, { children: [], memo: false }]) {
		assert.throws(() => utils.validateStoredData(bad, keys[3]), /フォーマット/);
	}
});

test('security core: an early timer callback reschedules, while the absolute deadline purges before UI activity', async t => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	let now = 10000;
	const timers = [];
	t.mock.method(Date, 'now', () => now);
	t.mock.method(global, 'setTimeout', (callback, delay) => {
		const timer = { callback, delay, unref() {} }; timers.push(timer); return timer;
	});
	t.mock.method(global, 'clearTimeout', () => {});
	app.initAutoLockListeners();
	window.dispatchEvent({ type: 'keydown' });
	app.resetAutoLockTimer();
	assert.equal(timers.at(-1).delay, 15 * 60 * 1000);
	now += 500;
	timers.at(-1).callback();
	assert.equal(timers.at(-1).delay, 15 * 60 * 1000 - 500);
	assert.equal(crypt.isStorageUnlocked(), true);
	let prevented = 0, stopped = 0;
	now += 16 * 60 * 1000;
	window.dispatchEvent({ type: 'pointerdown', preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; } });
	assert.equal(prevented, 1); assert.equal(stopped, 1);
	assert.equal(crypt.isStorageUnlocked(), false);
	assert.equal(state.currentDistrict.district, '');
	assert.equal(document.getElementById('storage-lock-modal').style.display, 'flex');
});

test('security core: visibility return and timer expiry enforce the same deadline; irrelevant storage events do not lock', async t => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	let now = 1000;
	const timers = [];
	t.mock.method(Date, 'now', () => now);
	t.mock.method(global, 'setTimeout', (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; });
	t.mock.method(global, 'clearTimeout', () => {});
	app.initAutoLockListeners();
	app.resetAutoLockTimer();
	window.dispatchEvent({ type: 'storage', key: 'unrelated', oldValue: 'old', newValue: 'new', storageArea: localStorage });
	window.dispatchEvent({ type: 'storage', key: authKey, oldValue: 'same', newValue: 'same', storageArea: localStorage });
	window.dispatchEvent({ type: 'storage', key: authKey, oldValue: 'old', newValue: null, storageArea: {} });
	assert.equal(crypt.isStorageUnlocked(), true);
	document.hidden = true;
	window.dispatchEvent({ type: 'visibilitychange' });
	assert.equal(crypt.isStorageUnlocked(), true);
	now += 16 * 60 * 1000;
	document.hidden = false;
	window.dispatchEvent({ type: 'visibilitychange' });
	assert.equal(crypt.isStorageUnlocked(), false);
	crypt.clearStorageSecurity();
	await crypt.setupStorageEncryption(password, false);
	app.resetAutoLockTimer();
	now += 16 * 60 * 1000;
	timers.at(-1).callback();
	assert.equal(crypt.isStorageUnlocked(), false);
});

test('security core: activity before expiry renews the deadline and malformed event methods cannot bypass expiry', async t => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	let now = 100;
	t.mock.method(Date, 'now', () => now);
	t.mock.method(global, 'setTimeout', () => ({ unref() {} }));
	t.mock.method(global, 'clearTimeout', () => {});
	app.initAutoLockListeners();
	app.resetAutoLockTimer();
	now += 10 * 60 * 1000;
	window.dispatchEvent({ type: 'touchstart' });
	now += 10 * 60 * 1000;
	window.dispatchEvent({ type: 'pointerdown' });
	assert.equal(crypt.isStorageUnlocked(), true, 'Each legitimate interaction extends only an unexpired session');
	now += 16 * 60 * 1000;
	window.dispatchEvent({ type: 'keydown' });
	assert.equal(crypt.isStorageUnlocked(), false, 'Missing event methods never suppress the deadline check');
});

test('security core: authentication change notifications without a storageArea still purge the old session', async () => {
	fresh();
	await crypt.setupStorageEncryption(password, false);
	app.initAutoLockListeners();
	const oldValue = localStorage.getItem(authKey);
	localStorage.removeItem(authKey);
	window.dispatchEvent({ type: 'storage', key: authKey, oldValue, newValue: null });
	assert.equal(crypt.isStorageUnlocked(), false);
	assert.equal(state.currentDistrict.district, '');
	assert.ok(localStorage.getItem(keys[0]).startsWith('STORAGE_ENC:2:'));
});
