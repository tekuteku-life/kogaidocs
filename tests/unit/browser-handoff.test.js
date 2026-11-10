const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');
setupDomEnvironment();
require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
const handoff = require('../../js/handoff');
const NativeURL = require('node:url').URL;
require('../../js/hata');
require('../../js/district');
const rep = require('../../js/rep');
require('../../js/neighbor');
require('../../js/transfer');
require('../../js/seat');
require('../../js/print');
require('../../js/app');

function fresh() {
	setupDomEnvironment();
	global.URL = NativeURL;
	window.location = { href: 'https://example.test/index.html?private=x#secret', origin: 'https://example.test', pathname: '/index.html', protocol: 'https:' };
	[state.currentDistrict, state.repState, state.neighborState, state.transferState] = bundle().models;
	renderDistrictForm(); renderRepAll(); renderNeighborForm(); renderTransferForm();
	localStorage.setItem('kogai_active_mode', 'transfer');
	const dialog = document.getElementById('browser-handoff-dialog');
	dialog.showModal = () => { dialog.open = true; };
	dialog.close = () => { dialog.open = false; };
	for (const [id, tag] of [['handoff-create-pass', 'input'], ['handoff-confirm-pass', 'input'], ['handoff-restore-pass', 'input'], ['handoff-file', 'input'], ['handoff-input', 'textarea'], ['handoff-output', 'textarea']]) {
		const el = document.getElementById(id); el.tagName = tag; el.type = id.includes('pass') ? 'password' : '';
		dialog.appendChild(el);
	}
	const button = document.createElement('button'); button.setAttribute('data-handoff-task', ''); dialog.appendChild(button);
	const link = document.createElement('a'); link.setAttribute('data-external-browser-link', ''); dialog.appendChild(link);
	handoff.openBrowserHandoff();
	return dialog;
}


function bundle() {
	return { type: 'kogaidocs-browser-handoff', version: 1, mode: 'transfer', models: [
		createMockDistrict({ hata: { members: '編集途中', weekdays: [], dedup: false }, savedFilePassword: 'DoNotTransfer123!' }),
		createMockRepState(), { district: '自治会', neighborhood: [] },
		{ children: [{ id: 'draft', lastName: '途中', firstName: '', address: '', tel: '' }], memo: '未完了' }
	], drafts: { 'd-paste-box': '貼付途中' }, repDraft: null };
}

test('handoff: LINE UA is detected and the external URL contains only app, mode and official routing flag', () => {
	global.URL = NativeURL;
	assert.equal(handoff.isLineInAppBrowser('Mozilla/5.0 Line/15.0.0'), true);
	assert.equal(handoff.isLineInAppBrowser('Mozilla/5.0 LINE/16.1.0'), true);
	assert.equal(handoff.isLineInAppBrowser('Mozilla/5.0 Safari/604.1'), false);
	assert.equal(handoff.isLineInAppBrowser('NotLine/15.0'), false);
	const url = handoff.buildExternalBrowserUrl({ href: 'https://example.test/kogaidocs/index.html?secret=name#password' }, 'transfer');
	assert.equal(url, 'https://example.test/kogaidocs/index.html?mode=transfer&openExternalBrowser=1');
	assert.equal(handoff.buildExternalBrowserUrl({ href: 'file:///tmp/index.html' }, 'district'), '');
});

test('handoff: incomplete transfer and flag settings are preserved, passwords and invalid drafts are excluded', () => {
	const clean = handoff.validateBrowserHandoff(bundle());
	assert.equal(clean.models[3].children[0].firstName, '');
	assert.equal(clean.models[0].hata.members, '編集途中');
	assert.equal(clean.models[0].savedFilePassword, undefined);
	assert.equal(clean.drafts['d-paste-box'], '貼付途中');
	for (const mutate of [data => { data.version = 99; }, data => { data.mode = 'unknown'; }, data => { data.models[2].neighborhood = 'bad'; }, data => { data.drafts['d-pass'] = 'secret'; }]) {
		const data = bundle(); mutate(data);
		assert.throws(() => handoff.validateBrowserHandoff(data));
	}
});

test('handoff: storage replacement rolls back every written model on failure and does not change current memory', async () => {
	setupDomEnvironment();
	const keys = ['kogai_district_v2', 'kogai_rep_v2', 'kogai_neighbor_v2', 'kogai_transfer_v2'];
	keys.forEach((key, index) => localStorage.setItem(key, 'original-' + index));
	const original = keys.map(key => localStorage.getItem(key));
	const before = JSON.stringify(state.currentDistrict);
	const setItem = localStorage.setItem.bind(localStorage);
	let count = 0;
	localStorage.setItem = (key, value) => { if (++count === 3) throw new Error('quota'); setItem(key, value); };
	await assert.rejects(cryptoLib.replaceStoredAppData(handoff.validateBrowserHandoff(bundle()).models), /quota/);
	assert.deepEqual(keys.map(key => localStorage.getItem(key)), original);
	assert.equal(JSON.stringify(state.currentDistrict), before);
});

test('handoff: native dialog preparation updates the warning and Escape clears passwords and output', () => {
	const dialog = fresh();
	assert.equal(handoff.isLineInAppBrowser(), false);
	Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Line/16.0' });
	handoff.initializeBrowserHandoff();
	assert.equal(document.getElementById('line-browser-notice').hidden, false);
	assert.match(dialog.querySelector('a').href, /mode=transfer&openExternalBrowser=1$/);
	document.getElementById('handoff-create-pass').value = 'HandoffTest123!';
	document.getElementById('handoff-output').value = 'ENC:2:secret';
	let prevented = false;
	dialog.dispatchEvent({ type: 'cancel', preventDefault() { prevented = true; } });
	assert.equal(prevented, true);
	assert.equal(dialog.open, false);
	assert.equal(document.getElementById('handoff-create-pass').value, '');
	assert.equal(document.getElementById('handoff-output').value, '');
	window.location = { href: 'file:///tmp/index.html' };
	document.elements['line-browser-notice'] = null;
	handoff.updateLineBrowserNotice();
	assert.equal(dialog.querySelector('a').hidden, true);
	assert.equal(handoff.isLineInAppBrowser(), true);
});

test('handoff: creation encrypts incomplete inputs, excludes passwords and supports download/copy fallback', async () => {
	fresh();
	document.getElementById('d-paste-box').value = '貼付途中';
	document.getElementById('handoff-create-pass').value = 'short';
	assert.equal(await handoff.createBrowserHandoff(), false);
	assert.match(document.getElementById('handoff-status').textContent, /12文字/);
	document.getElementById('handoff-create-pass').value = 'HandoffTest123!';
	document.getElementById('handoff-confirm-pass').value = 'different';
	assert.equal(await handoff.createBrowserHandoff(), false);
	assert.match(document.getElementById('handoff-status').textContent, /一致/);
	document.getElementById('handoff-confirm-pass').value = 'HandoffTest123!';
	assert.equal(await handoff.createBrowserHandoff(), true);
	const text = document.getElementById('handoff-output').value;
	const decoded = JSON.parse(await cryptoLib.decryptPayload(text, 'HandoffTest123!'));
	assert.equal(decoded.drafts['d-paste-box'], '貼付途中');
	assert.equal(decoded.models[3].children[0].firstName, '');
	assert.equal(decoded.models[0].savedFilePassword, undefined);
	let downloaded;
	global.downloadTextFile = (content, filename) => { downloaded = { content, filename }; };
	handoff.saveBrowserHandoff();
	assert.equal(downloaded.content, text);
	assert.match(downloaded.filename, /引き継ぎ\.txt$/);
	let copied;
	navigator.clipboard.writeText = async value => { copied = value; };
	await handoff.copyBrowserHandoff();
	assert.equal(copied, text);
	navigator.clipboard.writeText = async () => { throw new Error('denied'); };
	let selected = false;
	document.getElementById('handoff-output').select = () => { selected = true; };
	await handoff.copyBrowserHandoff();
	assert.equal(selected, true);
	handoff.clearBrowserHandoff();
	await handoff.copyBrowserHandoff();
	handoff.saveBrowserHandoff();
	assert.equal(downloaded.content, text, 'Cleared output cannot generate another download');
});

test('handoff: pasted restore is atomic, confirms replacement, restores mode/drafts and strips remembered passwords', async () => {
	fresh();
	const data = bundle();
	data.drafts['rep-new-district-name'] = '新しい地区の入力途中';
	const encrypted = await cryptoLib.encryptPayload(JSON.stringify(data), 'HandoffTest123!');
	document.getElementById('handoff-input').value = encrypted;
	document.getElementById('handoff-restore-pass').value = 'HandoffTest123!';
	global.confirm = () => false;
	const original = JSON.stringify(localStorage.store);
	assert.equal(await handoff.restoreBrowserHandoff(), true);
	assert.equal(JSON.stringify(localStorage.store), original);
	assert.match(document.getElementById('handoff-status').textContent, /取り消し/);
	global.confirm = () => true;
	assert.equal(await handoff.restoreBrowserHandoff(), true);
	assert.equal(state.currentDistrict.savedFilePassword, undefined);
	assert.equal(state.transferState.children[0].firstName, '');
	assert.equal(document.getElementById('d-paste-box').value, '貼付途中');
	assert.equal(document.getElementById('rep-new-district-name').value, '新しい地区の入力途中');
	assert.equal(document.getElementById('rep-add-district-modal').style.display, 'flex');
	assert.equal(document.getElementById('browser-handoff-dialog').open, false);
	assert.equal(document.getElementById('handoff-restore-pass').value, '');
	assert.equal(localStorage.getItem('kogai_active_mode'), 'transfer');
});

test('handoff: file restore rejects an invalid model and a wrong key before memory or storage changes', async () => {
	fresh();
	const invalid = bundle(); invalid.models[1].districts = 'invalid';
	const text = await cryptoLib.encryptPayload(JSON.stringify(invalid), 'HandoffTest123!');
	document.getElementById('handoff-file').files = [{ size: text.length, text: async () => text }];
	document.getElementById('handoff-restore-pass').value = 'HandoffTest123!';
	const before = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
	const stored = JSON.stringify(localStorage.store);
	assert.equal(await handoff.restoreBrowserHandoff(), false);
	assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), before);
	assert.equal(JSON.stringify(localStorage.store), stored);
	document.getElementById('handoff-restore-pass').value = 'WrongPassword123!';
	assert.equal(await handoff.restoreBrowserHandoff(), false);
	assert.equal(JSON.stringify(localStorage.store), stored);
});

test('handoff: encrypted destination keeps its security metadata and rejects a locked or stale replacement', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption('DestinationTest123!');
	const metadata = localStorage.getItem('kogai_auth_meta');
	const models = handoff.validateBrowserHandoff(bundle()).models;
	const generation = cryptoLib.getStorageSessionGeneration();
	const result = await cryptoLib.replaceStoredAppData(models);
	assert.ok(result.generation > generation, 'Commit invalidates earlier asynchronous intake and autosave requests');
	assert.equal(localStorage.getItem('kogai_auth_meta'), metadata);
	for (const [index, key] of ['kogai_district_v2', 'kogai_rep_v2', 'kogai_neighbor_v2', 'kogai_transfer_v2'].entries()) {
		assert.ok(localStorage.getItem(key).startsWith('STORAGE_ENC:2:'));
		assert.deepEqual(await cryptoLib.loadStorageDecrypted(key), models[index]);
	}
	const stored = JSON.stringify(localStorage.store);
	await assert.rejects(cryptoLib.replaceStoredAppData(models, () => { throw new Error('closed'); }), /closed/);
	assert.equal(JSON.stringify(localStorage.store), stored);
	let guards = 0;
	await assert.rejects(cryptoLib.replaceStoredAppData(models, () => { if (++guards === 2) throw new Error('closed after encryption'); }), /closed after encryption/);
	assert.equal(JSON.stringify(localStorage.store), stored, 'Closing after every value is encrypted still prevents all writes');
	cryptoLib.lockStorage();
	await assert.rejects(cryptoLib.replaceStoredAppData(models), /SESSION_CHANGED/);
	assert.equal(JSON.stringify(localStorage.store), stored);
});

test('handoff: a representative draft retains row identity and rejects invalid row mappings', () => {
	const data = bundle();
	data.models[1].districts = [{ district: '集約', selectedForPrint: true, officers: [{ lastName: 'A' }, { lastName: 'B' }], students: [], neighborhood: [{ lastName: 'C' }] }];
	data.repDraft = { index: 0, district: { district: '集約', selectedForPrint: true, officers: [{ lastName: 'Bの編集' }, { lastName: '新規' }], students: [], neighborhood: [] }, officerIndexes: [1, null], neighborIndexes: [] };
	const clean = handoff.validateBrowserHandoff(data);
	assert.deepEqual(clean.repDraft.officerIndexes, [1, null]);
	for (const mutate of [value => { value.index = -1; }, value => { value.district.district = '別地区'; }, value => { value.officerIndexes = [1]; }, value => { value.officerIndexes = [1, 1]; }, value => { value.officerIndexes = [0, 99]; }]) {
		const copy = structuredClone(data); mutate(copy.repDraft);
		assert.throws(() => handoff.validateBrowserHandoff(copy));
	}
	fresh();
	state.repState = clean.models[1];
	state.repState.seatConfig = { rows: 2, cols: 2, cells: { '0_0': { refKey: 'OFF_0_1' }, '0_1': { refKey: 'OFF_0_0' } } };
	rep.restoreRepDetailDraft(clean.repDraft);
	assert.deepEqual(rep.captureRepDetailDraft().officerIndexes, [1, null]);
	rep.saveAndCloseRepDistrictDetailModal();
	assert.equal(state.repState.districts[0].officers[0].lastName, 'Bの編集');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'OFF_0_0', 'Retained officer keeps their seat after migrated draft is saved');
	assert.equal(state.repState.seatConfig.cells['0_1'].refKey, '', 'Removed officer does not lend their seat to the new row');
	rep.closeRepDistrictDetailModalWithoutSaving();
	assert.equal(rep.captureRepDetailDraft(), null);
});

test('handoff: closing an in-flight creation invalidates it and prevents duplicate creation', async () => {
	fresh();
	document.getElementById('handoff-create-pass').value = 'HandoffTest123!';
	document.getElementById('handoff-confirm-pass').value = 'HandoffTest123!';
	const encrypt = global.encryptPayload;
	let resolve;
	global.encryptPayload = () => new Promise(complete => { resolve = complete; });
	try {
		const first = handoff.createBrowserHandoff();
		while (!resolve) await new Promise(complete => setImmediate(complete));
		assert.equal(await handoff.createBrowserHandoff(), false);
		handoff.clearBrowserHandoff();
		resolve('ENC:2:late');
		assert.equal(await first, false);
		assert.equal(document.getElementById('handoff-output').value, '');
		assert.equal(document.getElementById('handoff-status').textContent, '');
	} finally { global.encryptPayload = encrypt; }
});

test('handoff: missing mode defaults to district and a failed source save prevents creation', async () => {
	fresh();
	localStorage.removeItem('kogai_active_mode');
	handoff.updateLineBrowserNotice();
	assert.match(document.querySelector('[data-external-browser-link]').href, /mode=district/);
	assert.match(handoff.buildExternalBrowserUrl(), /mode=district/);
	assert.equal(handoff.buildExternalBrowserUrl({ href: 'https://user:secret@example.test/app?secret=x#payload' }, 'invalid'), 'https://example.test/app?mode=district&openExternalBrowser=1');
	assert.equal((await handoff.collectBrowserHandoff()).mode, 'district');
	const save = global.saveNeighborLocal;
	global.saveNeighborLocal = async () => false;
	try { await assert.rejects(handoff.collectBrowserHandoff(), /入力の保存に失敗/); }
	finally { global.saveNeighborLocal = save; }
});

test('handoff: a native close prevents late output and a closed clipboard task cannot update the UI', async () => {
	const dialog = fresh();
	document.getElementById('handoff-create-pass').value = 'HandoffTest123!';
	document.getElementById('handoff-confirm-pass').value = 'HandoffTest123!';
	const encrypt = global.encryptPayload;
	let resolve;
	global.encryptPayload = () => new Promise(complete => { resolve = complete; });
	try {
		const task = handoff.createBrowserHandoff();
		while (!resolve) await new Promise(complete => setImmediate(complete));
		dialog.close();
		resolve('ENC:2:late');
		assert.equal(await task, false);
		assert.equal(document.getElementById('handoff-output').value, '');
	} finally { global.encryptPayload = encrypt; }
	handoff.openBrowserHandoff();
	document.getElementById('handoff-output').value = 'ENC:2:copied';
	let reject;
	navigator.clipboard.writeText = () => new Promise((_resolve, fail) => { reject = fail; });
	const task = handoff.copyBrowserHandoff();
	handoff.clearBrowserHandoff();
	reject(new Error('denied after close'));
	await task;
	assert.equal(document.getElementById('handoff-status').textContent, '');
});
