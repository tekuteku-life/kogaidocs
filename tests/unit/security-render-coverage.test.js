const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');

setupDomEnvironment();
require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
require('../../js/hata');
require('../../js/seat');
const rep = require('../../js/rep');
const district = require('../../js/district');
const print = require('../../js/print');

const password = 'RenderSecurity1!';
function fresh() {
	setupDomEnvironment();
	cryptoLib.clearStorageSecurity();
	state.currentDistrict = createMockDistrict({ district: '保持地区' });
	state.repState = createMockRepState();
	state.neighborState = { district: '保持自治会', neighborhood: [] };
	state.transferState = { children: [], memo: '' };
	document.getElementById('d-name').value = state.currentDistrict.district;
	document.getElementById('d-han-list').value = state.currentDistrict.han;
	document.getElementById('d-pass').value = password;
}

for (const kind of ['transfer', 'neighbor']) {
	test(`security district: authenticated invalid ${kind} paste preserves the roster and never requests another password`, async () => {
		fresh();
		const payload = kind === 'transfer'
			? { isTransferData: true, children: [null] }
			: { isNeighborhoodData: true, district: '拒否自治会', neighborhood: [null] };
		const encrypted = await cryptoLib.encryptPayload(JSON.stringify(payload), password);
		const input = document.getElementById(kind === 'transfer' ? 'd-transfer-paste-box' : 'd-neighbor-paste-box');
		input.value = encrypted;
		let prompts = 0;
		global.prompt = () => { prompts++; return null; };
		const before = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
		const saved = JSON.stringify(localStorage.store);
		if (kind === 'transfer') await district.loadPastedTransferTextIntoDistrict();
		else await district.loadPastedNeighborTextIntoDistrict();
		assert.equal(prompts, 0, 'Authentication succeeded; malformed data must not be treated as a password failure');
		assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), before);
		assert.equal(JSON.stringify(localStorage.store), saved);
		assert.equal(document.getElementById('d-name').value, '保持地区');
		assert.equal(input.value, encrypted, 'Rejected paste remains available for correction');
	});
}

for (const route of ['district-transfer', 'district-neighbor', 'rep-transfer']) {
	test(`security import: locking during ${route} file reading rejects the result without a password retry`, async () => {
		fresh();
		document.getElementById('rep-pass').value = password;
		const payload = route === 'district-neighbor'
			? { isNeighborhoodData: true, district: '保持地区', neighborhood: [{ role: '会長', lastName: '遅延役員' }] }
			: { isTransferData: true, children: [{ lastName: '遅延児童', firstName: '花子', address: '101', tel: '090-1234-5678', grade: '1' }] };
		const encrypted = await cryptoLib.encryptPayload(JSON.stringify(payload), password);
		await cryptoLib.setupStorageEncryption(password, false);
		const before = JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
		const saved = JSON.stringify(localStorage.store);
		let release, reading;
		const readStarted = new Promise(resolve => { reading = resolve; });
		const content = new Promise(resolve => { release = resolve; });
		const target = { value: 'pending.txt', files: [{ size: Buffer.byteLength(encrypted), text: () => { reading(); return content; } }] };
		let prompts = 0;
		global.prompt = () => { prompts++; return null; };
		const load = route === 'rep-transfer' ? rep.loadTransferFileIntoRep
			: route === 'district-neighbor' ? district.loadNeighborFileIntoDistrict : district.loadTransferFileIntoDistrict;
		const pending = load({ target });
		await readStarted;
		cryptoLib.lockStorage();
		release(encrypted);
		await pending;
		assert.equal(prompts, 0, 'An expired storage session is not a recoverable password mismatch');
		assert.equal(cryptoLib.isStorageUnlocked(), false);
		assert.equal(JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]), before);
		assert.equal(JSON.stringify(localStorage.store), saved, 'A late file result cannot overwrite any ciphertext');
		assert.equal(target.value, '', 'The file control can select the same file after a valid unlock');
	});
}

test('security representative: the master-restoration picker routes transfer data and cancels without changing existing records', async () => {
	fresh();
	document.getElementById('rep-pass').value = password;
	const payload = { isTransferData: true, children: [{ lastName: '転入', firstName: '受入児童', address: '101', tel: '090-1234-5678', grade: '1', className: '1' }] };
	const encrypted = await cryptoLib.encryptPayload(JSON.stringify(payload), password);
	const target = { value: 'transfer.txt', files: [{ size: Buffer.byteLength(encrypted), text: async () => encrypted }] };
	const messages = [];
	global.alert = message => messages.push(message);
	global.prompt = message => message.includes('地区名') ? '明示受入地区' : '受入班';
	await rep.loadRepMasterTxt({ target });
	const imported = state.repState.districts.find(item => item.district === '明示受入地区');
	assert.equal(imported.students[0].firstName, '受入児童');
	assert.equal(imported.students[0].han, '受入班');
	assert.equal(messages.length, 1, 'Transfer integration must not also emit a misleading district/master restoration success');
	assert.ok(messages[0].includes('転入児童データ'));
	assert.equal(target.value, '');
	const before = JSON.stringify(state.repState);
	const saved = JSON.stringify(localStorage.store);
	global.prompt = () => null;
	target.value = 'transfer.txt';
	await rep.loadRepMasterTxt({ target });
	assert.equal(JSON.stringify(state.repState), before);
	assert.equal(JSON.stringify(localStorage.store), saved);
	assert.equal(messages.length, 1, 'Cancelled assignment never reports a successful import');
	assert.equal(target.value, '');
});

test('representative editing: a role-only officer requires confirmation while empty draft rows can be removed directly', () => {
	fresh();
	state.repState.districts = [createMockDistrict({
		district: '編集中地区',
		officers: [{ role: '未定の校外委員' }],
		students: [{}],
		neighborhood: [{}]
	})];
	const prompts = [];
	global.confirm = message => { prompts.push(message); return false; };
	rep.openRepDistrictDetailModal(0);
	rep.removeModalOfficerRow(0);
	assert.equal(prompts.length, 1);
	assert.ok(prompts[0].includes('未定の校外委員'), 'The role identifies an officer whose personal name has not been collected');
	assert.equal(rep.getModalCurrentDistrict().officers.length, 1, 'Cancelling preserves the officer draft');
	global.confirm = message => { prompts.push(message); return true; };
	rep.removeModalOfficerRow(0);
	rep.removeModalStudentRow(0);
	rep.removeModalNeighborRow(0);
	assert.equal(prompts.length, 2, 'Empty child and neighbor drafts contain no person to confirm');
	assert.equal(state.repState.districts[0].officers.length, 1, 'Draft removal remains isolated until the modal is saved');
	rep.saveAndCloseRepDistrictDetailModal();
	assert.deepEqual(state.repState.districts[0].officers, []);
	assert.deepEqual(state.repState.districts[0].students, []);
	assert.deepEqual(state.repState.districts[0].neighborhood, []);
});

test('security printing: raw seat dimensions are bounded even without a previously validated configuration', () => {
	fresh();
	for (const [config, cols, rows] of [
		[undefined, 4, 5],
		[{ cols: '2);"><img id="render-attack">', rows: Infinity }, 4, 5],
		[{ cols: -10, rows: -2 }, 2, 2],
		[{ cols: 1000, rows: 1000 }, 10, 14],
		[{ cols: 3.9, rows: 4.9 }, 3, 4]
	]) {
		state.repState.seatConfig = config;
		const html = print.buildSzSeatChartPageHtml();
		assert.ok(html.includes(`grid-template-columns: repeat(${cols}, 1fr);`));
		assert.equal((html.match(/class="print-seat-cell/g) || []).length, cols * rows);
		assert.ok(!html.includes('<img'), 'Dimensions never become printable markup');
	}
});

test('printing: incomplete district rosters remain printable without inventing people or leaking markup', () => {
	fresh();
	const pending = { district: '名簿未収集地区' };
	for (const build of [
		() => print.buildStudentPageHtml(pending),
		() => print.buildNeighborPageHtml(pending),
		() => print.buildPtaOfficersRosterPageHtml([pending]),
		() => print.buildSchoolOfficersRosterPageHtml([pending]),
		() => print.buildSzAttendance1PageHtml([pending]),
		() => print.buildSzAttendance2PageHtml([pending]),
		() => print.buildSzMasterRosterPageHtml([pending])
	]) {
		const html = build();
		assert.equal(typeof html, 'string');
		assert.ok(html.includes('print-page'));
		assert.ok(!html.includes('undefined') && !html.includes('[object Object]'));
	}
	assert.deepEqual(print.buildEnvelopesPagesHtml([pending]), [], 'No child roster means no envelope recipients');
	const cards = print.buildSzTentCardsPagesHtml([pending]);
	assert.ok(cards.every(html => !html.includes('名簿未収集地区')), 'No missing officer is fabricated as a tent-card recipient');
	const ruby = print.formatNameWithSama('', '<img id="render-attack">');
	assert.ok(ruby.includes('&lt;img') && !ruby.includes('<img'));
});
