const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
const utils = require('../../js/utils');
const crypt = require('../../js/crypto');
const state = require('../../js/state');
require('../../js/hata'); require('../../js/seat'); require('../../js/district');
const rep = require('../../js/rep');
require('../../js/neighbor'); require('../../js/transfer');
const app = require('../../js/app');

const fields = { title: 'hata-title', createdDate: 'hata-created-date', district: 'hata-district', location: 'hata-location', time: 'hata-time', headerMsg: 'hata-header-msg', footerMsg: 'hata-footer-msg', contactMsg: 'hata-contact-msg' };
function fresh() {
	setupDomEnvironment();
	state.currentDistrict = { district: '地区', han: '1班', hanList: ['1班'], officers: [], students: [], neighborhood: [], hata: { members: '', holidays: '', specials: '' } };
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	state.neighborState = { district: '', neighborhood: [] };
	state.transferState = { children: [], memo: '' };
	renderDistrictForm();
}

test('hata text: 4096 characters commit, 4097 remain complete drafts while valid settings survive', () => {
	for (const field of Object.keys(fields)) {
		const config = { [field]: '有効値' };
		assert.equal(utils.collectHataScheduleInputs(config, { [field]: 'あ'.repeat(4097) }), false, field);
		assert.equal(config[field], '有効値');
		assert.equal(config.inputDrafts[field].length, 4097);
		assert.doesNotThrow(() => utils.validateHataConfig(config));
		assert.equal(utils.collectHataScheduleInputs(config, { [field]: 'あ'.repeat(4096) }), true);
		assert.equal(config[field].length, 4096);
		assert.equal(config.inputDrafts, undefined);
	}
});

test('hata text: legacy display text migrates only on a copy and keeps explicit newer drafts', () => {
	for (const field of Object.keys(fields)) {
		const source = { district: '地区', hata: { [field]: '旧'.repeat(4097) } };
		const clean = utils.validateStoredData(source, 'kogai_district_v2');
		assert.equal(source.hata[field].length, 4097);
		assert.equal(clean.hata[field], '');
		assert.equal(clean.hata.inputDrafts[field].length, 4097);
		source.hata.inputDrafts = { [field]: '新しい下書き' };
		assert.equal(utils.validateStoredData(source, 'kogai_district_v2').hata.inputDrafts[field], '新しい下書き');
		assert.throws(() => utils.validateImportData(source, 'district'), 'File import stays strict');
		source.hata.inputDrafts = '不正';
		assert.throws(() => utils.validateStoredData(source, 'kogai_district_v2'));
	}
});

test('hata text: saved oversized live input unlocks and can be repaired without losing the roster', async () => {
	fresh();
	state.currentDistrict.students = [{ lastName: '保持', firstName: '児童', grade: '2' }];
	await crypt.setupStorageEncryption('DatabasePassword1!');
	document.getElementById('hata-header-msg').value = 'あ'.repeat(4097);
	assert.equal(await saveDistrictLocal(), true);
	const saved = await crypt.loadStorageDecrypted('kogai_district_v2');
	assert.equal(saved.hata.inputDrafts.headerMsg.length, 4097);
	crypt.lockStorage();
	await crypt.unlockStorageWithPassword('DatabasePassword1!');
	await app.loadAppDataFromStorage(); renderDistrictForm();
	assert.equal(document.getElementById('hata-header-msg').value.length, 4097);
	assert.equal(ensureHataInputsReady(), false);
	document.getElementById('hata-header-msg').value = '修正済み';
	await saveDistrictLocal();
	crypt.lockStorage();
	await crypt.unlockStorageWithPassword('DatabasePassword1!');
	await app.loadAppDataFromStorage();
	assert.equal(state.currentDistrict.hata.headerMsg, '修正済み');
	assert.equal(state.currentDistrict.hata.inputDrafts, undefined);
	assert.equal(state.currentDistrict.students[0].lastName, '保持');
});

test('hata text: already encrypted legacy long text unlocks without changing the ciphertext during read', async () => {
	fresh();
	state.currentDistrict.hata.footerMsg = '旧'.repeat(4097);
	await crypt.setupStorageEncryption('DatabasePassword1!');
	const before = localStorage.getItem('kogai_district_v2');
	crypt.lockStorage();
	assert.equal(await crypt.unlockStorageWithPassword('DatabasePassword1!'), true);
	await app.loadAppDataFromStorage();
	assert.equal(state.currentDistrict.hata.inputDrafts.footerMsg.length, 4097);
	assert.equal(localStorage.getItem('kogai_district_v2'), before);
	renderDistrictForm();
	assert.equal(document.getElementById('hata-footer-msg').value.length, 4097);
});

test('representative long sharing: denied and unavailable clipboard never start LINE or mail and allow retry', async () => {
	for (const mode of ['line', 'mail']) for (const unavailable of [false, true]) {
		fresh();
		state.repState.districts = [structuredClone(state.currentDistrict)];
		const original = global.encryptPayload;
		global.encryptPayload = async () => 'ENC:2:' + 'a'.repeat(3000);
		const opened = [], alerts = [];
		global.open = url => opened.push(url);
		window.location = global.location = { href: '' };
		global.alert = text => alerts.push(text);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: unavailable ? undefined : { writeText: async () => { throw new Error('denied'); } } });
		try {
			assert.equal(await rep.exportSingleDistrictFromRep(0, 'Submission123!', mode), false);
			assert.deepEqual(opened, []);
			assert.equal(window.location.href, '');
			assert.equal(alerts.length, 1);
			navigator.clipboard = { writeText: async () => {} };
			assert.equal(await rep.exportSingleDistrictFromRep(0, 'Submission123!', mode), true);
			assert.ok(mode === 'line' ? opened.length === 1 : window.location.href.startsWith('mailto:'));
		} finally { global.encryptPayload = original; }
	}
});
