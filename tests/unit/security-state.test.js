const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');
setupDomEnvironment();
const utils = require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
require('../../js/seat');
const rep = require('../../js/rep');
const district = require('../../js/district');
const neighbor = require('../../js/neighbor');
const transfer = require('../../js/transfer');
const print = require('../../js/print');
const app = require('../../js/app');

function fresh() {
	cryptoLib.clearStorageSecurity();
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict({ district: '保持地区' });
	state.repState = createMockRepState();
	state.neighborState = { district: '保持自治会', neighborhood: [] };
	state.transferState = { children: [], memo: '' };
	document.getElementById('d-name').value = '保持地区';
}

test('security: saved models are validated before any of the four modes is committed', async () => {
	fresh();
	localStorage.setItem('kogai_district_v2', JSON.stringify(createMockDistrict({ district: '未確定地区' })));
	localStorage.setItem('kogai_rep_v2', JSON.stringify({ districts: [], seatConfig: { cols: '2);"><img id="security-probe">', rows: 5 } }));
	const before = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
	await assert.rejects(app.loadAppDataFromStorage());
	assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), before);
	assert.equal(JSON.parse(localStorage.getItem('kogai_district_v2')).district, '未確定地区');
});

for (const [mode, invalid] of [
	['district', { district: '不正地区', officers: [null] }],
	['neighbor', { district: '不正自治会', neighborhood: {} }],
	['transfer', { children: 'not-a-list' }]
]) {
	test(`security: malformed saved ${mode} rejects without committing any other mode`, async () => {
		fresh();
		for (const [name, value] of Object.entries({ district: state.currentDistrict, rep: state.repState, neighbor: state.neighborState, transfer: state.transferState })) localStorage.setItem(`kogai_${name}_v2`, JSON.stringify(value));
		localStorage.setItem(`kogai_${mode}_v2`, JSON.stringify(invalid));
		const before = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
		const stored = JSON.stringify(localStorage.store);
		await assert.rejects(app.loadAppDataFromStorage());
		assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), before);
		assert.equal(JSON.stringify(localStorage.store), stored);
	});
}

test('security: an empty transfer draft is valid local data despite submission requirements', async () => {
	fresh();
	localStorage.setItem('kogai_transfer_v2', JSON.stringify({ children: [], memo: '下書き' }));
	await app.loadAppDataFromStorage();
	assert.deepEqual(state.transferState, { children: [], memo: '下書き' });
});

test('security: raw print builders treat hostile date/day and seat dimensions as data', () => {
	fresh();
	const value = '<img id="security-probe" onerror="void 0">';
	const html = hata.buildHataPrintHtml([{ date: '2026-' + value, day: value, person: value, note: value }], { layoutColumns: 1 });
	assert.ok(!html.includes('<img'), 'Date and weekday must not become markup');
	assert.ok(html.includes('&lt;img'), 'Literal hostile text is still represented');
	state.repState.seatConfig.cols = '2);"><img id="security-probe"><div style="';
	const chart = print.buildSzSeatChartPageHtml();
	assert.ok(!chart.includes('<img'), 'Dimensions never enter an HTML attribute as raw text');
});

test('security: participant dictionaries do not mutate shared prototypes or built-in functions', () => {
	fresh();
	const names = ['__proto__', 'constructor', 'toString'];
	const before = [Object.prototype, Object, Object.prototype.toString].map(value => Object.getOwnPropertyDescriptors(value));
	try {
		const stats = hata.calculateHataStats(names.map(person => ({ person, type: 'special' })), []);
		for (const name of names) {
			assert.equal(Object.hasOwn(stats, name), true);
			assert.equal(stats[name].special, 1);
		}
		assert.deepEqual([Object.prototype, Object, Object.prototype.toString].map(value => Object.getOwnPropertyDescriptors(value)), before);
	} finally {
		for (const [i, value] of [Object.prototype, Object, Object.prototype.toString].entries()) {
			for (const key of Reflect.ownKeys(value)) if (!Object.hasOwn(before[i], key)) delete value[key];
		}
	}
});

test('security: recursive import limits and reserved object properties reject without accepting prototypes', () => {
	fresh();
	for (const key of ['__proto__', 'constructor', 'prototype']) {
		const payload = JSON.parse(`{"district":"拒否地区","hata":{"manualOverrides":{"${key}":{}}}}`);
		assert.throws(() => utils.validateImportData(payload, 'district'));
	}
	let nested = {};
	for (let i = 0; i < 22; i++) nested = { nested };
	assert.throws(() => utils.validateImportData({ district: '深い地区', extra: nested }, 'district'));
	assert.throws(() => utils.validateImportData({ district: '大量地区', students: Array.from({ length: 10001 }, () => ({})) }, 'district'));
	assert.throws(() => utils.validateImportData({ district: '大容量地区', extra: 'a'.repeat(4 * 1024 * 1024) }, 'district'));
	const valid = utils.validateImportData(createMockDistrict(), 'district');
	assert.equal(valid.district, '1丁目');
});

test('security: UTF-8 JSON bytes, tree depth, array count and total node limits have exact accepted boundaries', () => {
	fresh();
	const limit = 4 * 1024 * 1024;
	const shellBytes = Buffer.byteLength(JSON.stringify({ district: '境界', extra: '' }));
	const remaining = limit - shellBytes;
	const payload = { district: '境界', extra: 'é'.repeat(Math.floor(remaining / 2)) + 'a'.repeat(remaining % 2) };
	assert.equal(Buffer.byteLength(JSON.stringify(payload)), limit);
	assert.equal(utils.validateImportData(payload, 'district').district, '境界');
	payload.extra += 'é';
	assert.throws(() => utils.validateImportData(payload, 'district'));
	let nested = {};
	for (let i = 0; i < 19; i++) nested = { nested };
	assert.equal(utils.validateImportData({ district: '深さ境界', extra: nested }, 'district').district, '深さ境界');
	assert.throws(() => utils.validateImportData({ district: '深さ超過', extra: { nested } }, 'district'));
	assert.equal(utils.validateImportData({ district: '件数境界', students: Array.from({ length: 10000 }, () => ({})) }, 'district').students.length, 10000);
	const tree = { district: 'ノード境界', extra: Array.from({ length: 10 }, (_, i) => Array(i < 9 ? 9999 : 9996).fill(null)) };
	assert.equal(utils.validateImportData(tree, 'district').district, 'ノード境界');
	tree.extra[9].push(null);
	assert.throws(() => utils.validateImportData(tree, 'district'));
});

test('security: schedule and range expansion reject oversized dates and retain valid boundary behavior', () => {
	fresh();
	const boundary = { startDate: '2000-01-01', endDate: '2010-01-07', members: '会員', weekdays: [0, 1, 2, 3, 4, 5, 6] };
	const over = { ...boundary, endDate: '2010-01-08' };
	assert.equal(hata.expandDateOrRange(`${boundary.startDate}〜${boundary.endDate}`).length, 3660);
	assert.throws(() => hata.expandDateOrRange(`${over.startDate}〜${over.endDate}`));
	assert.equal(hata.generateHataSchedule(boundary).length, 3660);
	assert.throws(() => hata.generateHataSchedule(over));
	assert.equal(utils.validateHataConfig(boundary).endDate, boundary.endDate);
	assert.throws(() => utils.validateHataConfig(over));
	assert.equal(hata.expandDateOrRange('2026-10-20〜2026-10-21').length, 2);
});

test('security: updating waits for every save before navigation', { timeout: 5000 }, async () => {
	fresh();
	const names = ['saveDistrictLocal', 'saveRepLocal', 'saveNeighborLocal', 'saveTransferLocal'];
	const originals = names.map(name => global[name]);
	const releases = [];
	let navigations = 0;
	window.location.replace = () => { navigations++; };
	global.caches = { keys: async () => [], delete: async () => true };
	navigator.serviceWorker.getRegistrations = async () => [];
	for (const name of names) global[name] = () => new Promise(resolve => releases.push(resolve));
	const pending = app.performAppUpdate();
	let completed = false;
	const tracked = pending.finally(() => { completed = true; });
	const released = new Set();
	const deadline = Date.now() + 3000;
	const waitForRelease = async index => {
		while (!releases[index] && !completed && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
		assert.equal(typeof releases[index], 'function', `Save ${index + 1} must participate`);
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.equal(navigations, 0, `No navigation before save ${index + 1} completes`);
		released.add(index);
		releases[index]();
	};
	try {
		for (let i = 0; i < names.length; i++) await waitForRelease(i);
		await tracked;
		assert.equal(navigations, 1);
	} finally {
		while (!completed && Date.now() < deadline) {
			for (let i = 0; i < releases.length; i++) {
				if (!released.has(i)) {
					released.add(i);
					releases[i]();
				}
			}
			await new Promise(resolve => setImmediate(resolve));
		}
		await Promise.race([tracked.catch(() => {}), new Promise(resolve => setTimeout(resolve, 50))]);
		names.forEach((name, i) => { global[name] = originals[i]; });
	}
});

test('security: rejected persistence prevents update and never reports a successful reload', async () => {
	fresh();
	const names = ['saveDistrictLocal', 'saveRepLocal', 'saveNeighborLocal', 'saveTransferLocal'];
	const originals = names.map(name => global[name]);
	let navigated = false;
	window.location.replace = () => { navigated = true; };
	global.caches = { keys: async () => [], delete: async () => true };
	navigator.serviceWorker.getRegistrations = async () => [];
	names.forEach(name => { global[name] = async () => {}; });
	global.saveRepLocal = async () => { throw new Error('quota'); };
	try {
		await app.performAppUpdate();
		assert.equal(navigated, false);
		assert.match(global.__lastAlert, /失敗|保存/);
	} finally { names.forEach((name, i) => { global[name] = originals[i]; }); }
});

test('security: update clears only this scope cache and service worker registration', async () => {
	fresh();
	const names = ['saveDistrictLocal', 'saveRepLocal', 'saveNeighborLocal', 'saveTransferLocal'];
	const originals = names.map(name => global[name]);
	names.forEach(name => { global[name] = async () => {}; });
	window.location.href = 'https://localhost/kogaidocs/index.html';
	window.location.pathname = '/kogaidocs/index.html';
	window.location.replace = () => {};
	const own = 'kogai-cache-' + encodeURIComponent('https://localhost/kogaidocs/') + '-v2.8.3';
	const other = 'kogai-cache-' + encodeURIComponent('https://localhost/other/') + '-v2.8.3';
	const deleted = [], unregistered = [];
	global.caches = { keys: async () => [own, other, 'other-app-cache'], delete: async key => { deleted.push(key); } };
	navigator.serviceWorker.getRegistrations = async () => [
		{ scope: 'https://localhost/kogaidocs/', active: { scriptURL: 'https://localhost/kogaidocs/sw.js' }, unregister: async () => { unregistered.push('own'); } },
		{ scope: 'https://localhost/other/', active: { scriptURL: 'https://localhost/other/sw.js' }, unregister: async () => { unregistered.push('other'); } }
	];
	try {
		await app.performAppUpdate();
		assert.deepEqual(deleted, [own]);
		assert.deepEqual(unregistered, ['own']);
	} finally { names.forEach((name, i) => { global[name] = originals[i]; }); }
});

test('security: oversized district and flag files are rejected before reading their bodies', async () => {
	fresh();
	let reads = 0;
	const oversized = { size: 8 * 1024 * 1024 + 1, text: async () => { reads++; return '{}'; } };
	await loadDistrictTxt({ target: { files: [oversized], value: 'too-large.txt' } });
	await hata.loadHataOfficialFile({ target: { files: [oversized], value: 'too-large.json' } });
	assert.equal(reads, 0);
	assert.equal(state.currentDistrict.district, '保持地区');
});

test('security: read completion enforces actual UTF-8 file size despite misleading File.size', async () => {
	fresh();
	const text = 'é'.repeat(4 * 1024 * 1024);
	assert.equal(await utils.readImportFile({ size: 1, text: async () => text }), text, '8MiB exact UTF-8 boundary is accepted');
	await assert.rejects(async () => utils.readImportFile({ size: 1, text: async () => text + 'é' }), /上限|サイズ/);
});

const invalidSavedPasswordDistrict = () => ({
	...createMockDistrict({ district: '拒否する地区' }),
	savedFilePassword: { toString: null }
});

test('security: every hata text field consumed by rendering rejects non-string objects', () => {
	for (const field of ['title', 'scheduleTitle', 'createdDate', 'scheduleCreatedDate', 'district', 'location', 'time', 'headerMsg', 'footerMsg', 'contactMsg']) {
		assert.throws(
			() => utils.validateHataConfig({ [field]: { toString: null } }),
			undefined,
			`hata.${field} must be validated before rendering`
		);
	}
});

for (const route of ['file', 'paste']) {
	test(`security: district ${route} rejects a non-string saved password before changing state or DOM`, async () => {
		fresh();
		const password = 'SavedPasswordType1!';
		document.getElementById('d-pass').value = password;
		const encrypted = await cryptoLib.encryptPayload(JSON.stringify(invalidSavedPasswordDistrict()), password);
		const beforeModel = JSON.stringify(state.currentDistrict);
		const beforeStorage = JSON.stringify(localStorage.store);
		if (route === 'file') {
			const target = { value: 'invalid.txt', files: [{ size: Buffer.byteLength(encrypted), text: async () => encrypted }] };
			await district.loadDistrictTxt({ target });
		} else {
			const box = document.getElementById('d-paste-box');
			box.value = encrypted;
			await district.loadPastedTextToDistrict();
			assert.equal(box.value, encrypted, 'Rejected paste remains available for correction');
		}
		assert.equal(JSON.stringify(state.currentDistrict), beforeModel);
		assert.equal(document.getElementById('d-name').value, '保持地区');
		assert.equal(JSON.stringify(localStorage.store), beforeStorage);
	});
}

test('security: plaintext restore rejects a non-string saved password before committing any model', async () => {
	fresh();
	localStorage.setItem('kogai_district_v2', JSON.stringify(invalidSavedPasswordDistrict()));
	const beforeModel = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
	const beforeStorage = JSON.stringify(localStorage.store);
	await assert.rejects(app.loadAppDataFromStorage());
	assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), beforeModel);
	assert.equal(document.getElementById('d-name').value, '保持地区');
	assert.equal(JSON.stringify(localStorage.store), beforeStorage);
});

/** 旧版（保存前検証なし）で保存済みの値を再現する。現行版では saveStorageData が拒否する（I-12-02）。 */
async function saveLegacyStorageValue(key, value) {
	assert.equal(await cryptoLib.saveStorageData(key, value), false, 'Current versions refuse to store the invalid value');
	const strict = global.validateStoredData;
	global.validateStoredData = model => model;
	try {
		assert.equal(await cryptoLib.saveStorageData(key, value), true);
	} finally { global.validateStoredData = strict; }
}

test('security: encrypted restore rejects a non-string saved password before committing any model', async () => {
	fresh();
	const password = 'SavedPasswordType1!';
	await cryptoLib.setupStorageEncryption(password, false);
	await saveLegacyStorageValue('kogai_district_v2', invalidSavedPasswordDistrict());
	const beforeModel = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
	const beforeStorage = JSON.stringify(localStorage.store);
	await assert.rejects(app.loadAppDataFromStorage());
	assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), beforeModel);
	assert.equal(document.getElementById('d-name').value, '保持地区');
	assert.equal(JSON.stringify(localStorage.store), beforeStorage);
});

for (const field of ['scheduleCreatedDate', 'district']) {
	const invalidHataDistrict = () => ({
		...createMockDistrict({ district: '拒否する地区' }),
		hata: { [field]: { toString: null } }
	});
	for (const route of ['file', 'paste']) {
		test(`security: district ${route} rejects non-string hata.${field} before changing state or DOM`, async () => {
			fresh();
			const password = 'HataAliasType1!';
			document.getElementById('d-pass').value = password;
			const encrypted = await cryptoLib.encryptPayload(JSON.stringify(invalidHataDistrict()), password);
			const beforeModel = JSON.stringify(state.currentDistrict);
			const beforeStorage = JSON.stringify(localStorage.store);
			if (route === 'file') {
				const target = { value: 'invalid.txt', files: [{ size: Buffer.byteLength(encrypted), text: async () => encrypted }] };
				await district.loadDistrictTxt({ target });
			} else {
				const box = document.getElementById('d-paste-box');
				box.value = encrypted;
				await district.loadPastedTextToDistrict();
				assert.equal(box.value, encrypted, 'Rejected paste remains available for correction');
			}
			assert.equal(JSON.stringify(state.currentDistrict), beforeModel);
			assert.equal(document.getElementById('d-name').value, '保持地区');
			assert.equal(JSON.stringify(localStorage.store), beforeStorage);
		});
	}
	for (const encrypted of [false, true]) {
		test(`security: ${encrypted ? 'encrypted' : 'plaintext'} restore rejects non-string hata.${field} atomically`, async () => {
			fresh();
			const password = 'HataAliasType1!';
			if (encrypted) {
				await cryptoLib.setupStorageEncryption(password, false);
				await saveLegacyStorageValue('kogai_district_v2', invalidHataDistrict());
			} else localStorage.setItem('kogai_district_v2', JSON.stringify(invalidHataDistrict()));
			const beforeModel = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
			const beforeStorage = JSON.stringify(localStorage.store);
			await assert.rejects(app.loadAppDataFromStorage());
			assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), beforeModel);
			assert.equal(document.getElementById('d-name').value, '保持地区');
			assert.equal(JSON.stringify(localStorage.store), beforeStorage);
		});
	}
}

test('security: another tab changing authentication metadata purges live secrets immediately', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption('UiPassword1!', false);
	app.initAutoLockListeners();
	const oldValue = localStorage.getItem('kogai_auth_meta');
	localStorage.removeItem('kogai_auth_meta');
	window.dispatchEvent({ type: 'storage', key: 'kogai_auth_meta', oldValue, newValue: null, storageArea: localStorage });
	assert.equal(state.currentDistrict.district, '');
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.equal(document.getElementById('d-name').value, '');
	assert.ok(localStorage.getItem('kogai_district_v2').startsWith('STORAGE_ENC:'), 'Foreign metadata deletion never downgrades or overwrites ciphertext');
});

test('security: another tab clearing all LocalStorage purges every live model and private DOM', async () => {
	fresh();
	state.currentDistrict = createMockDistrict({ district: 'clear秘密地区' });
	state.repState.districts = [createMockDistrict({ district: 'clear秘密集約' })];
	state.neighborState = { district: 'clear秘密自治会', neighborhood: [{ role: '会長', lastName: 'clear秘密会長' }] };
	state.transferState = { children: [{ lastName: 'clear秘密児童', firstName: '太郎', grade: '1', className: '1' }], memo: 'clear秘密備考' };
	document.getElementById('d-name').value = 'clear秘密地区';
	document.getElementById('neighbor-district-name').value = 'clear秘密自治会';
	document.getElementById('d-pass').value = 'ClearSecretPassword1!';
	document.getElementById('print-area').innerHTML = '<p>clear秘密印刷</p>';
	await cryptoLib.setupStorageEncryption('ClearSecretPassword1!', false);
	app.initAutoLockListeners();
	assert.equal(cryptoLib.isStorageUnlocked(), true, 'Fixture starts with a real unlocked encrypted session');
	localStorage.clear();
	// localStorage.clear()の標準通知ではkey/oldValue/newValueがすべてnullとなる。
	window.dispatchEvent({ type: 'storage', key: null, oldValue: null, newValue: null, storageArea: localStorage });
	assert.ok(!JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]).includes('clear秘密'), 'Notification itself purges all private models');
	assert.equal(document.getElementById('d-name').value, '');
	assert.equal(document.getElementById('neighbor-district-name').value, '');
	assert.equal(document.getElementById('d-pass').value, '');
	assert.equal(document.getElementById('print-area').innerHTML, '');
	assert.equal(document.getElementById('storage-lock-modal').style.display, 'flex');
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.deepEqual(localStorage.store, {}, 'Foreign clear is not undone by the purge');
});

test('security: a tab protected before foreign LocalStorage.clear cannot resume plaintext writes', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption('ClearSecretPassword1!', false);
	app.initAutoLockListeners();
	localStorage.clear();
	window.dispatchEvent({ type: 'storage', key: null, oldValue: null, newValue: null, storageArea: localStorage });
	// 先にisStorageUnlocked()を呼ぶと、その照合による無効化がイベント側の欠陥を隠す。
	const result = await cryptoLib.saveStorageData('kogai_district_v2', { district: '復活させない旧秘密' }).then(value => ({ value }), error => ({ error }));
	assert.ok(result.error || result.value === false, 'Stale writes are refused even though both metadata and ciphertext are gone');
	assert.deepEqual(localStorage.store, {}, 'No plaintext or encrypted record is resurrected after foreign clear');
	assert.equal(cryptoLib.isStorageUnlocked(), false);
});

test('security SEC-25: performAppUpdate succeeds on unencrypted guest device while guarding generation changes and guest save failures', async () => {
	fresh();
	cryptoLib.requireOfficerStorageEncryption(true);
	let replacedUrls = [];
	let clearedCaches = 0;
	const appScope = 'https://app.example/kogaidocs/';
	global.location = { origin: 'https://app.example', pathname: '/kogaidocs/index.html', replace: url => { replacedUrls.push(url); } };
	if (typeof window !== 'undefined') window.location = global.location;
	global.caches = {
		keys: async () => [`kogai-cache-${encodeURIComponent(appScope)}-v2.11.0`, 'other-origin-cache'],
		delete: async () => { clearedCaches++; return true; }
	};
	global.navigator.serviceWorker = { getRegistrations: async () => [] };
	global.alert = () => {};

	sessionStorage.removeItem('kogai_update_attempted_version');
	assert.equal(await app.performAppUpdate('2.11.1'), true);
	assert.equal(clearedCaches, 1);
	assert.equal(replacedUrls.length, 1);

	const origSaveDist = global.saveDistrictLocal;
	const origSaveRep = global.saveRepLocal;
	const origSaveNeighbor = global.saveNeighborLocal;
	const origSaveTransfer = global.saveTransferLocal;
	try {
		// Partial saveFn undefined still maps saveNeighborLocal correctly to kogai_neighbor_v2
		global.saveDistrictLocal = undefined;
		global.saveNeighborLocal = async () => false;
		clearedCaches = 0; replacedUrls = [];
		sessionStorage.removeItem('kogai_update_attempted_version');
		assert.equal(await app.performAppUpdate('2.11.1'), false);
		assert.equal(clearedCaches, 0);
		assert.equal(replacedUrls.length, 0, 'Guest save failure aborts update even when saveDistrictLocal is missing');
		assert.equal(sessionStorage.getItem('kogai_update_attempted_version'), null);

		// Encryption change mid-save (ALL 4 return true so only pre/post encryption change triggers abort)
		global.saveDistrictLocal = async () => true;
		global.saveRepLocal = async () => true;
		global.saveNeighborLocal = async () => true;
		global.saveTransferLocal = async () => {
			await cryptoLib.setupStorageEncryption('MidUpdateLock123!', false);
			return true;
		};
		clearedCaches = 0; replacedUrls = [];
		sessionStorage.removeItem('kogai_update_attempted_version');
		assert.equal(await app.performAppUpdate('2.11.1'), false);
		assert.equal(clearedCaches, 0);
		assert.equal(replacedUrls.length, 0, 'Encryption state change during update aborts reload');
		assert.equal(sessionStorage.getItem('kogai_update_attempted_version'), null);

		// Session generation change (lock) while staying encrypted & ALL 4 return true aborts reload
		fresh();
		global.location = { origin: 'https://app.example', pathname: '/kogaidocs/index.html', replace: url => { replacedUrls.push(url); } };
		if (typeof window !== 'undefined') window.location = global.location;
		await cryptoLib.setupStorageEncryption('MidUpdateLock123!', false);
		global.saveDistrictLocal = async () => { cryptoLib.lockStorage(); return true; };
		global.saveRepLocal = async () => true;
		global.saveNeighborLocal = async () => true;
		global.saveTransferLocal = async () => true;
		clearedCaches = 0; replacedUrls = [];
		sessionStorage.removeItem('kogai_update_attempted_version');
		assert.equal(await app.performAppUpdate('2.11.1'), false);
		assert.equal(clearedCaches, 0);
		assert.equal(replacedUrls.length, 0, 'Session generation change during update aborts reload');
		assert.equal(sessionStorage.getItem('kogai_update_attempted_version'), null);
	} finally {
		global.saveDistrictLocal = origSaveDist;
		global.saveRepLocal = origSaveRep;
		global.saveNeighborLocal = origSaveNeighbor;
		global.saveTransferLocal = origSaveTransfer;
	}
});

test('security SEC-28: resetPasswordInputs resets visible inputs, toggles, 5 password feedback IDs, #hata-line-text, and #print-area without stripping #rep-new-district-error', async () => {
	fresh();
	const passIds = [
		'd-pass', 'd-pass-confirm', 'rep-pass', 'rep-pass-confirm',
		'neighbor-pass', 'neighbor-pass-confirm', 'neighbor-import-pass',
		'transfer-export-pass', 'transfer-export-pass-confirm',
		'modal-unlock-pass', 'modal-set-pass', 'modal-set-pass-confirm'
	];
	const toggleButtons = passIds.map(id => {
		const btn = document.createElement('button');
		btn.className = 'btn-toggle-pass';
		btn.setAttribute('data-password-target', id);
		document.body.appendChild(btn);
		return [id, btn];
	});
	const resetFixtures = () => {
		for (const id of passIds) {
			const el = document.getElementById(id);
			el.type = 'text';
			el.value = 'PlainVisible123!';
		}
		for (const [, btn] of toggleButtons) btn.textContent = '🙈';
		for (const msgId of ['d-pass-match-msg', 'rep-pass-match-msg', 'neighbor-pass-match-msg', 'modal-set-pass-msg', 'modal-unlock-error']) {
			const m = document.getElementById(msgId);
			m.textContent = '判定残存';
			m.className = 'pass-feedback-msg pass-msg-ok';
		}
		const repErr = document.getElementById('rep-new-district-error');
		repErr.className = 'pass-feedback-msg pass-msg-ng';
		repErr.textContent = '既存地区エラー維持';
		const hataLine = document.getElementById('hata-line-text');
		hataLine.value = '機密旗振りテキスト';
		hataLine.hidden = false;
		document.getElementById('print-area').innerHTML = '<div>機密印刷DOM</div>';
	};

	resetFixtures();
	app.hideStorageUnlockModal();
	assert.equal(document.getElementById('modal-unlock-pass').type, 'password');
	assert.equal(document.getElementById('modal-unlock-pass').value, '');
	assert.equal(toggleButtons.find(([id]) => id === 'modal-unlock-pass')[1].textContent, '👁️');
	assert.equal(document.getElementById('modal-unlock-error').textContent, '');
	assert.equal(document.getElementById('rep-new-district-error').textContent, '既存地区エラー維持');
	assert.equal(document.getElementById('rep-new-district-error').className, 'pass-feedback-msg pass-msg-ng');

	// Direct resetPasswordInputs(document) and scoped #storage-settings-modal both preserve #rep-new-district-error
	resetFixtures();
	utils.resetPasswordInputs(document);
	for (const id of passIds) {
		assert.equal(document.getElementById(id).type, 'password');
		assert.equal(document.getElementById(id).value, '');
	}
	for (const [, btn] of toggleButtons) assert.equal(btn.textContent, '👁️');
	for (const msgId of ['d-pass-match-msg', 'rep-pass-match-msg', 'neighbor-pass-match-msg', 'modal-set-pass-msg', 'modal-unlock-error']) {
		assert.equal(document.getElementById(msgId).textContent, '');
	}
	assert.equal(document.getElementById('rep-new-district-error').textContent, '既存地区エラー維持');
	assert.equal(document.getElementById('rep-new-district-error').className, 'pass-feedback-msg pass-msg-ng');

	resetFixtures();
	utils.resetPasswordInputs(null);
	assert.equal(document.getElementById('d-pass').type, 'text');
	assert.equal(document.getElementById('d-pass').value, 'PlainVisible123!');
	assert.equal(document.getElementById('d-pass-match-msg').textContent, '判定残存');
	const origLockModal = document.elements['storage-lock-modal'];
	document.elements['storage-lock-modal'] = null;
	try {
		app.hideStorageUnlockModal();
		assert.equal(document.getElementById('d-pass').value, 'PlainVisible123!');
	} finally {
		document.elements['storage-lock-modal'] = origLockModal;
	}

	resetFixtures();
	utils.resetPasswordInputs(document.getElementById('storage-settings-modal'));
	assert.equal(document.getElementById('modal-set-pass').type, 'password');
	assert.equal(document.getElementById('modal-set-pass').value, '');
	assert.equal(document.getElementById('modal-set-pass-confirm').type, 'password');
	assert.equal(document.getElementById('modal-set-pass-confirm').value, '');
	assert.equal(document.getElementById('modal-set-pass-msg').textContent, '');
	assert.equal(toggleButtons.find(([id]) => id === 'modal-set-pass')[1].textContent, '👁️');
	assert.equal(toggleButtons.find(([id]) => id === 'modal-set-pass-confirm')[1].textContent, '👁️');
	// Out-of-scope inputs, toggles, and feedback messages stay untouched
	assert.equal(document.getElementById('d-pass').type, 'text');
	assert.equal(document.getElementById('d-pass').value, 'PlainVisible123!');
	assert.equal(toggleButtons.find(([id]) => id === 'd-pass')[1].textContent, '🙈');
	assert.equal(document.getElementById('d-pass-match-msg').textContent, '判定残存');
	assert.equal(document.getElementById('modal-unlock-error').textContent, '判定残存');
	assert.equal(document.getElementById('rep-new-district-error').textContent, '既存地区エラー維持');
	assert.equal(document.getElementById('rep-new-district-error').className, 'pass-feedback-msg pass-msg-ng');

	// clearMemoryAndDomForLock resets all password inputs/toggles, 5 password feedback IDs, #hata-line-text, #print-area without stripping #rep-new-district-error pass-msg-ng class
	resetFixtures();
	app.clearMemoryAndDomForLock();
	assert.equal(document.getElementById('print-area').innerHTML, '');
	assert.equal(document.getElementById('hata-line-text').value, '');
	assert.equal(document.getElementById('hata-line-text').hidden, true);
	for (const id of passIds) {
		assert.equal(document.getElementById(id).type, 'password');
		assert.equal(document.getElementById(id).value, '');
		assert.equal(toggleButtons.find(([bId]) => bId === id)[1].textContent, '👁️');
	}
	for (const msgId of ['d-pass-match-msg', 'rep-pass-match-msg', 'neighbor-pass-match-msg', 'modal-set-pass-msg', 'modal-unlock-error']) {
		assert.equal(document.getElementById(msgId).textContent, '');
	}
	assert.equal(document.getElementById('rep-new-district-error').className, 'pass-feedback-msg pass-msg-ng');

	global.confirm = () => true;
	global.alert = () => {};
	const cases = [
		{ name: 'runDistrictYearUpdate', fn: () => district.runDistrictYearUpdate(), ids: ['d-pass', 'd-pass-confirm'], msgs: ['d-pass-match-msg'], clearHataLine: true },
		{ name: 'runRepYearUpdate', fn: () => rep.runRepYearUpdate(), ids: ['rep-pass', 'rep-pass-confirm'], msgs: ['rep-pass-match-msg'] },
		{ name: 'runNeighborYearUpdate', fn: () => neighbor.runNeighborYearUpdate(), ids: ['neighbor-pass', 'neighbor-pass-confirm', 'neighbor-import-pass'], msgs: ['neighbor-pass-match-msg'] },
		{ name: 'resetTransferForm', fn: () => transfer.resetTransferForm(), ids: ['transfer-export-pass', 'transfer-export-pass-confirm'], msgs: [] },
		{ name: 'clearTransferForm', fn: () => transfer.clearTransferForm(), ids: ['transfer-export-pass', 'transfer-export-pass-confirm'], msgs: [] }
	];
	for (const tc of cases) {
		resetFixtures();
		await tc.fn();
		assert.equal(document.getElementById('print-area').innerHTML, '', tc.name);
		assert.equal(document.getElementById('rep-new-district-error').textContent, '既存地区エラー維持', tc.name);
		assert.equal(document.getElementById('rep-new-district-error').className, 'pass-feedback-msg pass-msg-ng', tc.name);
		for (const id of tc.ids) {
			assert.equal(document.getElementById(id).type, 'password', `${tc.name}:${id}`);
			assert.equal(document.getElementById(id).value, '', `${tc.name}:${id}`);
			assert.equal(toggleButtons.find(([bId]) => bId === id)[1].textContent, '👁️', `${tc.name}:toggle:${id}`);
		}
		for (const msgId of tc.msgs) assert.equal(document.getElementById(msgId).textContent, '', `${tc.name}:${msgId}`);
		if (tc.clearHataLine) {
			assert.equal(document.getElementById('hata-line-text').value, '', tc.name);
			assert.equal(document.getElementById('hata-line-text').hidden, true, tc.name);
		}
	}

	// clearAllRepDistricts clears #print-area and loadDistrictTxt clears & hides #hata-line-text
	resetFixtures();
	rep.clearAllRepDistricts();
	assert.equal(document.getElementById('print-area').innerHTML, '');

	resetFixtures();
	const sampleCipher = await cryptoLib.encryptPayload(JSON.stringify({ district: '読込地区', officers: [], students: [], neighborhood: [] }), 'LoadPass123!');
	document.getElementById('d-pass').value = 'LoadPass123!';
	await district.loadDistrictTxt({ target: { files: [{ name: 'd.txt', text: async () => sampleCipher }], value: 'd.txt' } });
	assert.equal(document.getElementById('hata-line-text').value, '');
	assert.equal(document.getElementById('hata-line-text').hidden, true);

	// Null-element tolerance for restored DOM null guards (#hata-line-text, #print-area, #rep-pass-confirm)
	resetFixtures();
	state.repState.districts = [createMockDistrict({ district: 'NULL検証地区' })];
	const origHataLine = document.elements['hata-line-text'];
	const origPrintArea = document.elements['print-area'];
	const origRepConfirm = document.elements['rep-pass-confirm'];
	const origDownload = global.downloadTextFile;
	document.elements['hata-line-text'] = null;
	document.elements['print-area'] = null;
	document.elements['rep-pass-confirm'] = null;
	global.downloadTextFile = () => {};
	try {
		app.clearMemoryAndDomForLock();
		district.runDistrictYearUpdate();
		document.getElementById('d-pass').value = 'LoadPass123!';
		await district.loadDistrictTxt({ target: { files: [{ name: 'd.txt', text: async () => sampleCipher }], value: 'd.txt' } });
		rep.runRepYearUpdate();
		rep.clearAllRepDistricts();
		state.repState.districts = [createMockDistrict({ district: 'NULL検証地区' })];
		document.getElementById('rep-pass').value = 'LoadPass123!';
		assert.equal(await rep.exportSingleDistrictFromRep(0, '', 'download'), true);
	} finally {
		document.elements['hata-line-text'] = origHataLine;
		document.elements['print-area'] = origPrintArea;
		document.elements['rep-pass-confirm'] = origRepConfirm;
		global.downloadTextFile = origDownload;
	}
});

test('security SEC-29: saveAndCloseRepDistrictDetailModal preserves modal & draft on validateImportData rejection, initAutoLockListeners catches all STORAGE_DATA_KEYS tampering when encrypted, checkAppVersion sets credentials:omit, and HTML/dynamic inputs enforce maxlength=4096', async () => {
	const fs = require('node:fs');
	const path = require('node:path');
	fresh();
	state.repState.districts = [createMockDistrict({ district: '正規集約地区' })];
	rep.openRepDistrictDetailModal(0);
	document.getElementById('rep-district-detail-modal').style.display = 'block';
	rep.getModalCurrentDistrict().students.push({ grade: '1', class: '1', lastName: '超'.repeat(4097) });
	const beforeStorage = JSON.stringify(localStorage.store);
	const alerts = [];
	global.alert = msg => alerts.push(msg);
	rep.saveAndCloseRepDistrictDetailModal();
	assert.equal(document.getElementById('rep-district-detail-modal').style.display, 'block');
	assert.equal(rep.getModalCurrentDistrict().students.at(-1).lastName.length, 4097);
	assert.equal(state.repState.districts[0].students.length, createMockDistrict().students.length);
	assert.equal(JSON.stringify(localStorage.store), beforeStorage);
	assert.ok(alerts.length > 0);

	// Verify STORAGE_DATA_KEYS export & initAutoLockListeners behavior across all 4 keys
	assert.deepEqual(cryptoLib.STORAGE_DATA_KEYS, ['kogai_district_v2', 'kogai_rep_v2', 'kogai_neighbor_v2', 'kogai_transfer_v2']);
	app.initAutoLockListeners();
	window.dispatchEvent({ type: 'storage', key: 'kogai_district_v2', oldValue: '{}', newValue: null, storageArea: localStorage });
	assert.equal(cryptoLib.isStorageEncrypted(), false);

	// SEC-34 (I-12-06): identical values are ignored, while a valid STORAGE_ENC:2: foreign write locks without resetting security
	fresh();
	await cryptoLib.setupStorageEncryption('WatchDataKeys123!', false);
	app.initAutoLockListeners();
	const validVal = localStorage.getItem('kogai_district_v2');
	window.dispatchEvent({ type: 'storage', key: 'kogai_district_v2', oldValue: validVal, newValue: validVal, storageArea: localStorage });
	assert.equal(cryptoLib.isStorageUnlocked(), true);
	window.dispatchEvent({ type: 'storage', key: 'kogai_district_v2', oldValue: validVal, newValue: 'STORAGE_ENC:2:updated-from-other-tab', storageArea: localStorage });
	assert.equal(cryptoLib.isStorageUnlocked(), false, 'A valid foreign write locks this tab');
	assert.equal(cryptoLib.isStorageEncrypted(), true, 'A valid foreign write never resets security');
	// Legacy (non-v2) metadata treats STORAGE_ENC: as a valid foreign write: lock, but keep security
	await cryptoLib.unlockStorageWithPassword('WatchDataKeys123!');
	const legacyMeta = JSON.parse(localStorage.getItem(cryptoLib.STORAGE_AUTH_KEY));
	delete legacyMeta.storageFormat;
	localStorage.setItem(cryptoLib.STORAGE_AUTH_KEY, JSON.stringify(legacyMeta));
	window.dispatchEvent({ type: 'storage', key: 'kogai_district_v2', oldValue: validVal, newValue: 'STORAGE_ENC:v1payload', storageArea: localStorage });
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.equal(cryptoLib.isStorageEncrypted(), true);
	// Null auth metadata alongside encrypted ciphertext also falls back to STORAGE_ENC: check before locking invalid values
	localStorage.removeItem(cryptoLib.STORAGE_AUTH_KEY);
	window.dispatchEvent({ type: 'storage', key: 'kogai_district_v2', oldValue: validVal, newValue: '{"plain":1}', storageArea: localStorage });
	assert.equal(cryptoLib.isStorageUnlocked(), false);

	// Direct cryptoLib coverage: missing encrypted key throws STORAGE_DATA_MISSING, unknown key returns null, localStorage throw in isStorageEncrypted fails closed, malformed webauthn meta rejects STORAGE_AUTH_INVALID
	fresh();
	await cryptoLib.setupStorageEncryption('WatchDataKeys123!', false);
	localStorage.removeItem('kogai_district_v2');
	await assert.rejects(cryptoLib.loadStorageDecrypted('kogai_district_v2'), /STORAGE_DATA_MISSING/);
	assert.equal(await cryptoLib.loadStorageDecrypted('custom_missing_key'), null);
	const origGetItem = localStorage.getItem.bind(localStorage);
	localStorage.getItem = () => { throw new Error('storage disabled'); };
	try {
		assert.equal(cryptoLib.isStorageEncrypted(), true);
	} finally {
		localStorage.getItem = origGetItem;
	}
	fresh();
	await cryptoLib.setupStorageEncryption('WatchDataKeys123!', false);
	const corruptedMeta = JSON.parse(localStorage.getItem(cryptoLib.STORAGE_AUTH_KEY));
	corruptedMeta.webauthn = { credentialId: '' };
	localStorage.setItem(cryptoLib.STORAGE_AUTH_KEY, JSON.stringify(corruptedMeta));
	cryptoLib.lockStorage();
	await assert.rejects(cryptoLib.unlockStorageWithPassword('WatchDataKeys123!'), /STORAGE_AUTH_INVALID/);

	// Tampered STORAGE_DATA_KEYS across all 4 keys and formats locks immediately when encrypted
	for (const key of cryptoLib.STORAGE_DATA_KEYS) {
		for (const tamperedValue of [null, '{"district":"plaintext"}', 'STORAGE_ENC:legacy', 'STORAGE_ENC:1:downgraded']) {
			fresh();
			await cryptoLib.setupStorageEncryption('WatchDataKeys123!', false);
			app.initAutoLockListeners();
			assert.equal(cryptoLib.isStorageUnlocked(), true);
			const oldVal = localStorage.getItem(key);
			if (tamperedValue === null) localStorage.removeItem(key);
			else localStorage.setItem(key, tamperedValue);
			window.dispatchEvent({ type: 'storage', key, oldValue: oldVal, newValue: tamperedValue, storageArea: localStorage });
			assert.equal(cryptoLib.isStorageUnlocked(), false, `Tamper on ${key} with ${String(tamperedValue)} locks immediately`);
		}
	}

	// checkAppVersion sets credentials: 'omit' on version.json fetch
	fresh();
	const prevOnLine = navigator.onLine;
	const origFetch = global.fetch;
	let capturedFetchOptions = null;
	navigator.onLine = true;
	global.fetch = async (_url, options) => {
		capturedFetchOptions = options;
		return { ok: true, json: async () => ({ version: '2.11.0' }) };
	};
	global.alert = () => {};
	try {
		await app.checkAppVersion(true);
		assert.equal(capturedFetchOptions?.credentials, 'omit');
	} finally {
		global.fetch = origFetch;
		navigator.onLine = prevOnLine;
	}

	// Verify HTML #rep-new-district-name has single maxlength="4096" (no maxlength="50"), single-line #hata-* inputs have maxlength="4096", and dynamic tel/email inputs in district.js / neighbor.js have maxlength="4096"
	const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
	const newDistrictLine = html.split('\n').find(line => line.includes('id="rep-new-district-name"'));
	assert.ok(newDistrictLine && newDistrictLine.includes('maxlength="4096"') && !newDistrictLine.includes('maxlength="50"'));
	for (const id of ['hata-title', 'hata-created-date', 'hata-district', 'hata-location', 'hata-format', 'hata-contact-msg']) {
		const line = html.split('\n').find(l => l.includes(`id="${id}"`));
		assert.ok(line && line.includes('maxlength="4096"'), `${id} has maxlength="4096"`);
	}
	for (const file of ['js/district.js', 'js/neighbor.js']) {
		const src = fs.readFileSync(path.resolve(__dirname, `../../${file}`), 'utf8');
		const dynamicInputs = src.split('\n').filter(l => l.includes('<input ') && !l.includes('checkbox'));
		assert.ok(dynamicInputs.length > 0 && dynamicInputs.every(l => l.includes('maxlength="4096"')), `${file} dynamic text/tel/email inputs include maxlength="4096"`);
	}
});
