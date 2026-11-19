const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');
setupDomEnvironment();
require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
const INITIAL_SZ_EXTERNALS = JSON.parse(JSON.stringify(state.repState.szExternals));
const handoff = require('../../js/handoff');
const NativeURL = require('node:url').URL;
require('../../js/hata');
require('../../js/district');
require('../../js/rep');
require('../../js/neighbor');
require('../../js/transfer');
require('../../js/seat');
require('../../js/print');
const app = require('../../js/app');

const DEVICE_PASSWORD = 'DeviceOfficer123!';
const RESTORE_PASSWORD = 'RestoreGuest123!';

function fresh() {
	cryptoLib.clearStorageSecurity();
	setupDomEnvironment();
	global.URL = NativeURL;
	window.location = { href: 'https://example.test/index.html', origin: 'https://example.test', pathname: '/index.html', protocol: 'https:' };
	state.currentDistrict = createMockDistrict({ district: '保持地区' });
	state.repState = createMockRepState();
	state.neighborState = { district: '旧自治会', neighborhood: [{ role: '会長', lastName: '旧' }] };
	state.transferState = { children: [], memo: '' };
	renderDistrictForm(); renderRepAll(); renderNeighborForm(); renderTransferForm();
	const dialog = document.getElementById('browser-handoff-dialog');
	dialog.showModal = () => { dialog.open = true; };
	dialog.close = () => { dialog.open = false; };
	for (const [id, tag] of [['handoff-create-pass', 'input'], ['handoff-confirm-pass', 'input'], ['handoff-restore-pass', 'input'], ['handoff-file', 'input'], ['handoff-input', 'textarea'], ['handoff-output', 'textarea']]) {
		const el = document.getElementById(id); el.tagName = tag; el.type = id.includes('pass') ? 'password' : '';
		dialog.appendChild(el);
	}
	const button = document.createElement('button'); button.setAttribute('data-handoff-task', ''); dialog.appendChild(button);
	handoff.openBrowserHandoff();
	const dialogs = { alerts: [], confirms: [] };
	global.alert = message => dialogs.alerts.push(String(message));
	global.confirm = message => { dialogs.confirms.push(String(message)); return true; };
	return dialogs;
}

function guestPayload(drafts = {}) {
	return {
		type: 'kogaidocs-browser-handoff', version: 1, mode: 'neighbor',
		models: [
			{ district: '', han: '', hanList: [], officers: [], neighborhood: [], students: [] },
			{ districts: [], szExternals: JSON.parse(JSON.stringify(INITIAL_SZ_EXTERNALS)), seatConfig: { cols: 4, rows: 5, cells: {} } },
			{ district: '新自治会', neighborhood: [{ role: '会長', lastName: '新' }] },
			{ address: '東2-3', tel: '08099998888', children: [{ id: 'c2', lastName: '高橋', firstName: '翼', grade: '2', className: '1' }], memo: '引き継ぎ済' }
		],
		drafts, repDraft: null
	};
}

async function restore(payload) {
	document.getElementById('handoff-input').value = await cryptoLib.encryptPayload(JSON.stringify(payload), RESTORE_PASSWORD);
	document.getElementById('handoff-restore-pass').value = RESTORE_PASSWORD;
	return handoff.restoreBrowserHandoff();
}

async function storedModel(key) {
	return cryptoLib.loadStorageDecrypted(key);
}

test('QA-01: a guest handoff restored on an encrypted officer device keeps district and representative data', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(DEVICE_PASSWORD, false);
	const repBefore = JSON.stringify(state.repState.districts);
	assert.equal(await restore(guestPayload()), true);
	assert.equal(dialogs.confirms.length, 1);
	assert.match(dialogs.confirms[0], /地区・代表データは保持/);
	assert.equal(state.currentDistrict.district, '保持地区', 'Memory keeps the officer district');
	assert.equal(JSON.stringify(state.repState.districts), repBefore);
	assert.equal(state.neighborState.district, '新自治会');
	assert.equal(state.transferState.memo, '引き継ぎ済');
	assert.equal((await storedModel('kogai_district_v2')).district, '保持地区', 'Storage keeps the officer district');
	assert.equal(JSON.stringify((await storedModel('kogai_rep_v2')).districts), repBefore);
	assert.equal((await storedModel('kogai_neighbor_v2')).district, '新自治会');
	assert.ok(localStorage.getItem('kogai_neighbor_v2').startsWith('STORAGE_ENC:'), 'Guest models are encrypted on an encrypted device');
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithPassword(DEVICE_PASSWORD);
	await app.loadAppDataFromStorage();
	assert.equal(state.currentDistrict.district, '保持地区');
});

test('QA-01: on an unencrypted device that allows plaintext officer data, a guest handoff also keeps district and representative data', async () => {
	const dialogs = fresh();
	assert.equal(cryptoLib.officerPlaintextWriteDenied('kogai_district_v2'), false, 'Plaintext officer writes are allowed in this fixture');
	assert.equal(await saveDistrictLocal(), true);
	assert.equal(await restore(guestPayload()), true);
	assert.match(dialogs.confirms[0], /地区・代表データは保持/);
	assert.equal(state.currentDistrict.district, '保持地区');
	assert.equal(JSON.parse(localStorage.getItem('kogai_district_v2')).district, '保持地区');
	assert.equal(JSON.parse(localStorage.getItem('kogai_neighbor_v2')).district, '新自治会');
});

test('QA-01: replaceStoredAppData reports exactly the keys it replaced', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(DEVICE_PASSWORD, false);
	const guest = await cryptoLib.replaceStoredAppData(guestPayload().models);
	assert.deepEqual(guest.replacedKeys, ['kogai_neighbor_v2', 'kogai_transfer_v2']);
	const officerModels = guestPayload().models;
	officerModels[0] = createMockDistrict({ district: '引き継ぎ地区' });
	const officer = await cryptoLib.replaceStoredAppData(officerModels);
	assert.deepEqual(officer.replacedKeys, ['kogai_district_v2', 'kogai_rep_v2', 'kogai_neighbor_v2', 'kogai_transfer_v2']);
});

test('QA-01: an officer handoff on an encrypted device still replaces all four modes', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(DEVICE_PASSWORD, false);
	const payload = guestPayload();
	payload.mode = 'district';
	payload.models[0] = createMockDistrict({ district: '引き継ぎ地区' });
	assert.equal(await restore(payload), true);
	assert.doesNotMatch(dialogs.confirms[0], /保持/);
	assert.equal(state.currentDistrict.district, '引き継ぎ地区');
	assert.equal((await storedModel('kogai_district_v2')).district, '引き継ぎ地区');
	assert.deepEqual((await storedModel('kogai_rep_v2')).districts, [], 'Representative data is replaced with the handoff model');
});

test('QA-01: a district-mode handoff with officer drafts but empty officer models keeps district data and says so', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(DEVICE_PASSWORD, false);
	const payload = guestPayload({ 'd-paste-box': '役員の貼付途中' });
	payload.mode = 'district';
	assert.equal(await restore(payload), true);
	assert.match(dialogs.confirms[0], /地区・代表データは保持/, 'Confirmation matches the replaced keys');
	assert.equal(state.currentDistrict.district, '保持地区');
	assert.equal((await storedModel('kogai_district_v2')).district, '保持地区');
	assert.equal(document.getElementById('d-paste-box').value, '役員の貼付途中', 'Drafts are still restored');
});

test('QA-01: cancelling a guest restore changes nothing', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(DEVICE_PASSWORD, false);
	const before = JSON.stringify(localStorage.store);
	global.confirm = message => { dialogs.confirms.push(String(message)); return false; };
	await restore(guestPayload());
	assert.equal(JSON.stringify(localStorage.store), before);
	assert.equal(state.neighborState.district, '旧自治会');
});

test('SEC-35: browser handoff rejects an added-district draft longer than 4096 characters before confirmation', async () => {
	const dialogs = fresh();
	const before = JSON.stringify(localStorage.store);
	await restore(guestPayload({ 'rep-new-district-name': 'か'.repeat(4097) }));
	assert.equal(dialogs.confirms.length, 0);
	assert.equal(JSON.stringify(localStorage.store), before);
	assert.equal(state.neighborState.district, '旧自治会');
	assert.doesNotThrow(() => handoff.validateBrowserHandoff(guestPayload({ 'rep-new-district-name': 'か'.repeat(4096), 'neighbor-paste-box': 'x'.repeat(5000) })));
	assert.throws(() => handoff.validateBrowserHandoff(guestPayload({ 'rep-new-district-name': 'か'.repeat(4097) })), /フォーマット/);
});

test('QA-01 coverage: officer handoff detection handles missing payloads, missing drafts and officer drafts', () => {
	assert.equal(handoff.hasOfficerHandoffData(null), false);
	assert.equal(handoff.hasOfficerHandoffData('payload'), false);
	assert.equal(handoff.hasOfficerHandoffData({ mode: 'neighbor', models: guestPayload().models, repDraft: null }), false, 'Missing drafts are treated as empty');
	assert.equal(handoff.hasOfficerHandoffData({ mode: 'neighbor', models: guestPayload().models, repDraft: null, drafts: { 'rep-paste-box': '代表の貼付' } }), true);
});

test('QA-01 coverage: the handoff mode falls back to the stored mode when the in-memory mode is unavailable', async () => {
	fresh();
	const original = global.getActiveAppMode;
	global.getActiveAppMode = undefined;
	localStorage.setItem('kogai_active_mode', 'transfer');
	try {
		const collected = await handoff.collectBrowserHandoff();
		assert.equal(collected.mode, 'transfer');
		localStorage.setItem('kogai_active_mode', 'unknown');
		cryptoLib.requireOfficerStorageEncryption();
		await assert.rejects(handoff.collectBrowserHandoff(), /STORAGE_ENCRYPTION_REQUIRED/, 'An unknown stored mode falls back to the district mode');
	} finally { global.getActiveAppMode = original; }
});

test('QA-01 coverage: closing the dialog during a restore leaves the newer dialog state untouched', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(DEVICE_PASSWORD, false);
	global.confirm = message => { dialogs.confirms.push(String(message)); handoff.clearBrowserHandoff(); return true; };
	const beforeStorage = JSON.stringify(localStorage.store);
	const beforeTransfer = JSON.stringify(state.transferState);
	assert.equal(await restore(guestPayload()), false);
	assert.equal(JSON.stringify(localStorage.store), beforeStorage, 'Closing after confirmation writes nothing');
	assert.equal(JSON.stringify(state.transferState), beforeTransfer);
	assert.equal(document.getElementById('handoff-status').textContent, '', 'A closed dialog shows no failure');
	assert.equal(state.neighborState.district, '旧自治会', 'Nothing is restored after closing');
});

