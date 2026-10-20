const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');
setupDomEnvironment();
require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
const seat = require('../../js/seat');
const rep = require('../../js/rep');
const district = require('../../js/district');
const neighbor = require('../../js/neighbor');
const app = require('../../js/app');

function fresh() {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();
	state.repState = createMockRepState();
	state.neighborState = { district: '自治会', neighborhood: [{ role: '会長', lastName: '山田' }] };
	state.transferState = { children: [{ firstName: '転入児童' }] };
	cryptoLib.lockStorage();
	document.getElementById('d-name').value = state.currentDistrict.district;
	document.getElementById('d-han-list').value = state.currentDistrict.han;
}

test('regression: all-mode migration, locked-write guard and full deletion', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption('UiPassword1!', false);
	for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
		const key = `kogai_${mode}_v2`;
		assert.ok(localStorage.getItem(key).startsWith('STORAGE_ENC:'));
		assert.ok(await cryptoLib.loadStorageDecrypted(key));
	}
	const before = localStorage.getItem('kogai_transfer_v2');
	cryptoLib.lockStorage();
	await cryptoLib.saveStorageData('kogai_transfer_v2', {});
	assert.equal(localStorage.getItem('kogai_transfer_v2'), before);
	cryptoLib.clearStorageSecurity();
	for (const mode of ['district', 'rep', 'neighbor', 'transfer']) assert.equal(localStorage.getItem(`kogai_${mode}_v2`), null);
});

test('regression: pending encrypted save cannot resurrect data after full deletion', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption('UiPassword1!', false);
	const original = crypto.subtle.encrypt.bind(crypto.subtle);
	let release;
	crypto.subtle.encrypt = async (...args) => {
		const result = await original(...args);
		await new Promise(resolve => { release = resolve; });
		return result;
	};
	try {
		const pending = cryptoLib.saveStorageData('kogai_transfer_v2', { private: 'old-data' });
		const deadline = Date.now() + 2000;
		while (!release && Date.now() < deadline) await new Promise(resolve => setImmediate(resolve));
		assert.equal(typeof release, 'function', 'Encrypted save reaches pending phase before deadline');
		cryptoLib.clearStorageSecurity();
		release();
		await pending;
		assert.equal(localStorage.getItem('kogai_transfer_v2'), null);
	} finally { crypto.subtle.encrypt = original; }
});

test('regression: quota failure rolls migration back and propagates failure', async () => {
	fresh();
	const before = JSON.stringify({ ...localStorage.store });
	const setItem = localStorage.setItem.bind(localStorage);
	localStorage.setItem = (key, value) => {
		if (key === 'kogai_neighbor_v2' && value.startsWith('STORAGE_ENC:')) throw new Error('quota');
		setItem(key, value);
	};
	try {
		await assert.rejects(cryptoLib.setupStorageEncryption('UiPassword1!', false), /quota/);
		assert.equal(cryptoLib.isStorageEncrypted(), false);
		assert.equal(JSON.stringify({ ...localStorage.store }), before);
	} finally { localStorage.setItem = setItem; }
});

test('regression: district paste delegates file validation, preserves data on cancel/error and clears on success only', async () => {
	fresh();
	const pass = 'UiPassword1!';
	document.getElementById('d-pass').value = pass;
	const incoming = createMockDistrict({ district: '復元地区' });
	const encrypted = await cryptoLib.encryptPayload(JSON.stringify(incoming), pass);
	const box = document.getElementById('d-paste-box');
	box.value = encrypted;
	global.confirm = () => false;
	await district.loadPastedTextToDistrict();
	assert.notEqual(state.currentDistrict.district, '復元地区');
	assert.equal(box.value, encrypted);
	global.confirm = () => true;
	await district.loadPastedTextToDistrict();
	assert.equal(state.currentDistrict.district, '復元地区');
	assert.equal(box.value, '');
	box.value = 'broken';
	await district.loadPastedTextToDistrict();
	assert.equal(box.value, 'broken');
	document.elements['d-paste-box'] = null;
	await district.loadPastedTextToDistrict();
});

test('regression: official JSON rejects invalid schema and handles file/read errors without replacing config', async () => {
	fresh();
	for (const value of [null, [], { weekdays: 'Monday' }, { holidays: {} }, { manualOverrides: [] }, { orientation: 'diagonal' }]) {
		assert.throws(() => hata.importHataOfficialJson(JSON.stringify(value)));
	}
	const target = { files: [], value: '' };
	await hata.loadHataOfficialFile({ target });
	const old = JSON.stringify(state.currentDistrict.hata);
	for (const file of [{ text: async () => '{broken' }, { text: async () => { throw new Error('read failed'); } }]) {
		target.files = [file]; target.value = 'same.json';
		await hata.loadHataOfficialFile({ target });
		assert.equal(JSON.stringify(state.currentDistrict.hata), old);
		assert.equal(target.value, '');
	}
	target.files = [{ text: async () => JSON.stringify({ scheduleTitle: '読込表', holidays: '2026-10-20,休校' }) }];
	await hata.loadHataOfficialFile({ target });
	assert.equal(state.currentDistrict.hata.title, '読込表');
	assert.equal(document.getElementById('hata-holidays').value, '2026-10-20,休校');
});

test('regression: seat references survive deletion, draft cancel and draft officer/neighbor deletions', () => {
	fresh();
	state.repState.seatConfig.cells = {
		'0_0': { refKey: 'EXT_1', customText: '' },
		'0_1': { refKey: 'EXT_0', customText: '' },
		'0_2': { refKey: 'FAC_STAGE', customText: '演台' },
		'1_0': { refKey: 'OFF_1_0', customText: '' },
		'1_1': { refKey: 'OFF_0_0', customText: '' }
	};
	global.confirm = () => true;
	rep.deleteSzExternalRow(0);
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'EXT_0');
	assert.equal(state.repState.seatConfig.cells['0_1'].refKey, '');
	assert.equal(state.repState.seatConfig.cells['0_2'].refKey, 'FAC_STAGE');
	rep.deleteRepDistrict(0);
	assert.equal(state.repState.seatConfig.cells['1_0'].refKey, 'OFF_0_0');
	assert.equal(state.repState.seatConfig.cells['1_1'].refKey, '');
	rep.openRepDistrictDetailModal(0);
	rep.addModalOfficerRow();
	rep.updateModalOfficer(1, 'lastName', '残る役員');
	rep.saveAndCloseRepDistrictDetailModal();
	state.repState.seatConfig.cells['1_0'].refKey = 'OFF_0_1';
	rep.openRepDistrictDetailModal(0);
	rep.removeModalOfficerRow(0);
	rep.closeRepDistrictDetailModalWithoutSaving();
	assert.equal(state.repState.seatConfig.cells['1_0'].refKey, 'OFF_0_1', 'Cancel never remaps live seats');
	rep.openRepDistrictDetailModal(0);
	rep.removeModalOfficerRow(0);
	rep.saveAndCloseRepDistrictDetailModal();
	assert.equal(state.repState.seatConfig.cells['1_0'].refKey, 'OFF_0_0');
});

test('regression: neighborhood tent card passes semantic fields in the builder contract order', () => {
	fresh();
	const original = global.buildTentCardPageHtml;
	const calls = [];
	global.buildTentCardPageHtml = (...args) => { calls.push(args); return '<p>card</p>'; };
	window.print = () => {};
	try {
		neighbor.printNeighborTentCards();
		assert.deepEqual(calls[0], ['自治会', '山田', '', '会長']);
	} finally { global.buildTentCardPageHtml = original; }
});

test('regression: print selection refreshes seat options and safe ambiguity clears assignments', () => {
	fresh();
	state.repState.seatConfig.cells = { '0_0': { refKey: 'OFF_0_0', customText: '' }, '0_1': { refKey: 'UNKNOWN', customText: '' } };
	seat.setDistrictPrintSelection(0, false);
	assert.equal(state.repState.districts[0].selectedForPrint, false);
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '');
	assert.equal(state.repState.seatConfig.cells['0_1'].refKey, '');
	seat.setDistrictPrintSelection(0, true);
	assert.ok(seat.getAllSzParticipantsForSeat().some(person => person.key === 'OFF_0_0'));
	const previous = seat.captureSeatState();
	state.repState.szExternals = [state.repState.szExternals[0], { ...state.repState.szExternals[0] }];
	state.repState.seatConfig.cells['0_0'].refKey = 'EXT_0';
	seat.reconcileSeatState(previous);
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'Ambiguous same-name entries never inherit a seat');
});

test('regression: same-district representative switch cannot reassign a neighbor seat to another person', () => {
	fresh();
	state.repState.districts = [
		{ district: '共通地区', han: '1班', selectedForPrint: true, officers: [], students: [], neighborhood: [{ role: '会長', lastName: '別人A' }], szNeighborChecks: { 0: true } },
		{ district: '共通地区', han: '2班', selectedForPrint: true, officers: [], students: [], neighborhood: [{ role: '会長', lastName: '別人B' }], szNeighborChecks: { 0: true } }
	];
	const before = seat.getAllSzParticipantsForSeat().find(person => person.key.startsWith('NEI_'));
	state.repState.seatConfig.cells = { '0_0': { refKey: before.key, customText: '' } };
	rep.deleteRepDistrict(0);
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'Same index for different person is invalidated');
	assert.equal(state.repState.districts[0].szNeighborChecks[0], undefined, 'Unconfirmed attendance not copied to different person');
});

test('regression: general file and paste imports route transfer files with atomic assignment cancellation', async () => {
	fresh();
	const data = { isTransferData: true, children: [{ lastName: '転入', firstName: '未来', grade: '1', address: '101', tel: '090-1234-5678' }] };
	const text = await cryptoLib.encryptPayload(JSON.stringify(data), 'UiPassword1!');
	document.getElementById('rep-pass').value = 'UiPassword1!';
	global.prompt = message => message.includes('地区名') ? '新規地区' : '1班';
	await rep.loadMultipleDistrictFiles({ target: { files: [{ text: async () => text }], value: 'transfer.txt' } });
	assert.ok(state.repState.districts.some(d => d.district === '新規地区' && d.students[0].firstName === '未来'));
	document.getElementById('rep-paste-box').value = text;
	global.prompt = () => null;
	await rep.loadPastedTextToRep();
	assert.equal(document.getElementById('rep-paste-box').value, text, 'Cancelled paste remains available for retry');
	global.prompt = message => message.includes('地区名') ? '別地区' : '2班';
	await rep.loadPastedTextToRep();
	assert.equal(document.getElementById('rep-paste-box').value, '');
	assert.ok(state.repState.districts.some(d => d.district === '別地区' && d.students[0].han === '2班'));
});

test('regression: lock clears dynamically inserted visible password and pasted plaintext fields', () => {
	fresh();
	const group = document.createElement('div'); group.className = 'pass-input-group';
	const password = document.createElement('input'); password.type = 'text'; password.value = 'VisibleSecret1!'; group.appendChild(password);
	const plain = document.createElement('input'); plain.value = 'non-sensitive';
	const paste = document.createElement('textarea'); paste.value = '秘密の貼付';
	document.body.appendChild(group); document.body.appendChild(plain); document.body.appendChild(paste);
	app.clearMemoryAndDomForLock();
	assert.equal(password.value, '');
	assert.equal(paste.value, '');
});

test('regression: neighbor clipboard rejects confirmation mismatch without exporting data', async () => {
	fresh();
	document.getElementById('neighbor-district-name').value = '自治会';
	document.getElementById('neighbor-pass').value = 'UiPassword1!';
	document.getElementById('neighbor-pass-confirm').value = 'Different123!';
	let copied = false;
	navigator.clipboard.writeText = async () => { copied = true; };
	await neighbor.copyNeighborEncryptedText();
	assert.equal(copied, false);
});

test('regression: cancelled transfer in multi-file import is not counted as a successful district', async () => {
	fresh();
	document.getElementById('rep-pass').value = 'UiPassword1!';
	const text = await cryptoLib.encryptPayload(JSON.stringify({ isTransferData: true, children: [{ lastName: '転入', firstName: '未来', address: '101', tel: '090-1234-5678' }] }), 'UiPassword1!');
	const before = JSON.stringify(state.repState.districts);
	global.prompt = () => null;
	let message;
	global.alert = value => { message = value; };
	await rep.loadMultipleDistrictFiles({ target: { files: [{ text: async () => text }], value: 'transfer.txt' } });
	assert.equal(JSON.stringify(state.repState.districts), before);
	assert.match(message, /^0件/);
});

test('regression: imported nested flag/seat settings must be validated before assignment', () => {
	fresh();
	for (const hataConfig of [{ exemptHouseholds: {} }, { manualOverrides: { '2026-10-21': null } }, { members: [{}] }, { holidays: [null] }, { manualOverrides: { '2026-10-21': { person: {} } } }]) {
		assert.throws(() => validateImportData({ district: '地区', hata: hataConfig }, 'district'));
	}
	for (const seatConfig of [{ cols: 'garbage', cells: {} }, { rows: 99, cells: {} }, { topLabel: {}, cells: {} }]) {
		assert.throws(() => validateImportData({ districts: [], seatConfig }, 'rep'));
	}
});

test('regression: legacy flag arrays and numeric seat dimensions normalize without losing semantics', () => {
	fresh();
	const config = validateHataConfig({ holidays: [{ date: '2026-10-21', name: '休校' }, { date: '2026-10-22' }], members: ['山田', '佐藤'], manualOverrides: { '2026-10-23': { person: '田中', note: '交代', originalPerson: '山田', isSwapped: true, type: 'regular' } } });
	assert.equal(config.holidays, '2026-10-21,休校\n2026-10-22,祝日');
	assert.equal(config.members, '山田\n佐藤');
	assert.equal(config.manualOverrides['2026-10-23'].originalPerson, '山田');
	const data = validateImportData({ districts: [], seatConfig: { cols: '10', rows: '14', cells: { '0_0': { refKey: 'FAC_STAGE', customText: '壇上' } } } }, 'rep');
	assert.equal(data.seatConfig.cols, 10);
	assert.equal(data.seatConfig.rows, 14);
	assert.equal(data.seatConfig.cells['0_0'].customText, '壇上');
});

test('regression: editing neighbor identity preserves attendance and remaps seats through row removal', () => {
	fresh();
	state.repState.districts = [{ district: '自治会地区', han: '1班', selectedForPrint: true, officers: [], students: [], neighborhood: [{ role: '会長', lastName: '山田' }, { role: '副会長', lastName: '佐藤' }], szNeighborChecks: { 0: false, 1: true } }];
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_自治会地区_1', customText: '' } };
	rep.openRepDistrictDetailModal(0);
	rep.updateModalNeighbor(1, 'role', '会長代理');
	rep.saveAndCloseRepDistrictDetailModal();
	assert.deepEqual(state.repState.districts[0].szNeighborChecks, { 0: false, 1: true });
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'NEI_自治会地区_1');
	rep.openRepDistrictDetailModal(0);
	rep.removeModalNeighborRow(0);
	rep.addModalNeighborRow();
	rep.saveAndCloseRepDistrictDetailModal();
	assert.deepEqual(state.repState.districts[0].szNeighborChecks, { 0: true });
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'NEI_自治会地区_0');
});

test('regression: master paste restores the complete representative model through the shared dispatcher', async () => {
	fresh();
	const master = createMockRepState();
	master.districts[0].district = 'マスター復元地区';
	master.seatConfig.cells = { '0_0': { refKey: 'OFF_0_0', customText: '' } };
	const text = await cryptoLib.encryptPayload(JSON.stringify(master), 'UiPassword1!');
	document.getElementById('rep-pass').value = 'UiPassword1!';
	document.getElementById('rep-paste-box').value = text;
	let message;
	global.alert = value => { message = value; };
	await rep.loadPastedTextToRep();
	assert.equal(state.repState.districts[0].district, 'マスター復元地区');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'OFF_0_0');
	assert.equal(document.getElementById('rep-paste-box').value, '');
	assert.match(message, /代表統合マスターデータ/);
});

test('regression: authenticated invalid transfer schema never triggers a password retry or state replacement', async () => {
	fresh();
	const text = await cryptoLib.encryptPayload(JSON.stringify({ isTransferData: true, children: [null] }), 'UiPassword1!');
	document.getElementById('rep-pass').value = 'UiPassword1!';
	const before = JSON.stringify(state.repState);
	let retried = false;
	global.prompt = () => { retried = true; return null; };
	const target = { files: [{ text: async () => text }], value: 'invalid.txt' };
	await rep.loadTransferFileIntoRep({ target });
	await rep.loadPastedTransferTextIntoRep(text);
	assert.equal(retried, false);
	assert.equal(JSON.stringify(state.repState), before);
	assert.equal(target.value, '');
});

test('regression: legacy single officer receives the same row validation as officers arrays', async () => {
	fresh();
	const before = JSON.stringify(state.currentDistrict);
	const stored = JSON.stringify({ ...localStorage.store });
	const dom = document.getElementById('d-name').value;
	document.getElementById('d-pass').value = 'UiPassword1!';
	for (const key of ['han', 'name', 'role', 'childName', 'kana', 'childKana', 'childLastNameKana', 'childFirstNameKana']) {
		const officer = { lastName: '山田', [key]: {} };
		const payload = { district: '取込地区', officer };
		assert.throws(() => validateImportData(payload, 'district'));
		assert.throws(() => validateImportData({ districts: [payload] }, 'rep'));
		assert.throws(() => validateImportData({ district: '取込地区', officers: [officer] }, 'district'));
		const text = await cryptoLib.encryptPayload(JSON.stringify(payload), 'UiPassword1!');
		await district.loadDistrictTxt({ target: { files: [{ text: async () => text }], value: 'legacy.txt' } });
		assert.equal(JSON.stringify(state.currentDistrict), before);
		assert.equal(JSON.stringify({ ...localStorage.store }), stored);
		assert.equal(document.getElementById('d-name').value, dom);
	}
});
