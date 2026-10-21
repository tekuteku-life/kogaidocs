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
require('../../js/rep');
const district = require('../../js/district');
require('../../js/neighbor');
require('../../js/transfer');
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

test('security: encrypted restore rejects a non-string saved password before committing any model', async () => {
	fresh();
	const password = 'SavedPasswordType1!';
	await cryptoLib.setupStorageEncryption(password, false);
	await cryptoLib.saveStorageData('kogai_district_v2', invalidSavedPasswordDistrict());
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
				await cryptoLib.saveStorageData('kogai_district_v2', invalidHataDistrict());
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
