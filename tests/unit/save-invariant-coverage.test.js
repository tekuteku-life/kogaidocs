const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
const utils = require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
require('../../js/hata');
const seat = require('../../js/seat');
require('../../js/district');
const rep = require('../../js/rep');
require('../../js/neighbor');
require('../../js/transfer');
const app = require('../../js/app');

const PASSWORD = 'SaveCoverage123!';
const NativeURL = require('node:url').URL;

function fresh() {
	cryptoLib.clearStorageSecurity();
	setupDomEnvironment();
	global.URL = NativeURL;
	state.currentDistrict = { district: '地区', han: '1班', hanList: ['1班'], officers: [], students: [], neighborhood: [] };
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	state.neighborState = { district: '', neighborhood: [] };
	state.transferState = { children: [], memo: '' };
	const alerts = [];
	global.alert = message => alerts.push(String(message));
	global.confirm = () => true;
	return alerts;
}

/** 起動時の未暗号化の読込の反映で、1回だけ予期しない失敗を起こす（キーごとの検証の失敗は読めないキーとして扱うため、正規化の側で起こす）。 */
async function startWithUnexpectedFailure() {
	const original = global.normalizeNameFields;
	let thrown = false;
	global.normalizeNameFields = (...args) => { if (!thrown) { thrown = true; throw new Error('unexpected storage failure'); } return original(...args); };
	try {
		await app.startUnencryptedSession();
	} finally { global.normalizeNameFields = original; }
}

/** 起動時の未暗号化の読込を、反映の外（排他区間の要求）で1回だけ失敗させる。 */
async function startWithLockFailure() {
	const original = navigator.locks;
	let rejected = false;
	navigator.locks = { request: (...args) => { if (!rejected) { rejected = true; return Promise.reject(new Error('unexpected lock failure')); } return original.request(...args); } };
	try {
		await app.startUnencryptedSession();
	} finally { navigator.locks = original; }
	assert.ok(rejected, 'The lock request failed once');
}

/** 起動の前のタブと同じく、既知値のない状態にする（全消去は既知値を記録するので、その後に暗号化中のロックで空にする。I-16-01）。 */
async function forgetKnownStorageValues() {
	await cryptoLib.clearStorageSecurity();
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	cryptoLib.lockStorage();
	localStorage.removeItem('kogai_auth_meta');
}

for (const [label, start] of [['inside the reflection', startWithUnexpectedFailure], ['outside the reflection', startWithLockFailure]]) {
	test(`SEC-30 coverage: an unexpected startup load failure ${label} still opens a safe default state`, async () => {
		const alerts = fresh();
		await forgetKnownStorageValues();
		await start();
		assert.ok(alerts.some(message => /安全な初期状態で起動しました/.test(message)));
		assert.equal(cryptoLib.getSuspendedStorageKeys().length, 0, 'Nothing was stored, so nothing is suspended');
		assert.equal(await saveNeighborLocal(), true, 'A mode without stored data is still saved after the failure (R-27・I-16-03)');
	});

	test(`I-12-07 (Gate 2): an unexpected load failure ${label} with stored originals suspends those keys instead of overwriting them`, async () => {
		const alerts = fresh();
		await forgetKnownStorageValues();
		localStorage.setItem('kogai_neighbor_v2', JSON.stringify({ district: '有効な原本', neighborhood: [] }));
		localStorage.setItem('kogai_transfer_v2', JSON.stringify({ children: [], memo: '有効な原本' }));
		const before = JSON.stringify(localStorage.store);
		await start();
		assert.ok(alerts.some(message => /安全な初期状態で起動しました/.test(message)));
		assert.deepEqual(cryptoLib.getSuspendedStorageKeys().sort(), ['kogai_neighbor_v2', 'kogai_transfer_v2']);
		state.neighborState.district = '既定値での上書き';
		assert.equal(await saveNeighborLocal(), false);
		assert.equal(await saveTransferLocal(), false);
		assert.equal(JSON.stringify(localStorage.store), before, 'The stored originals are never overwritten');
		assert.equal(document.getElementById('storage-save-warning').hidden, false);
		assert.equal(await saveRepLocal(), true, 'A mode without stored data is still saved');
	});
}

test('SEC-30 coverage: storage failures other than foreign updates still propagate from saveStorageData', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const setItem = localStorage.setItem.bind(localStorage);
	localStorage.setItem = () => { throw new Error('quota exceeded'); };
	try {
		await assert.rejects(saveRepLocal(), /quota exceeded/);
	} finally { localStorage.setItem = setItem; }
	assert.equal(cryptoLib.isStorageUnlocked(), true, 'A quota failure is not treated as a foreign update');
	assert.equal(await saveRepLocal(), true);
});

test('SEC-30 coverage: keys other than the four data keys are stored without unlock-time validation', async () => {
	fresh();
	assert.equal(await cryptoLib.saveStorageData('custom_coverage_key', { anything: true }), true);
	assert.deepEqual(JSON.parse(localStorage.getItem('custom_coverage_key')), { anything: true });
});

test('SEC-35 coverage: the add-district dialog keeps an over-long name open with an explanation', () => {
	fresh();
	const modal = document.getElementById('rep-add-district-modal');
	modal.style.display = 'flex';
	const input = document.getElementById('rep-new-district-name');
	input.value = 'か'.repeat(4097);
	rep.confirmAddRepDistrict();
	assert.equal(modal.style.display, 'flex', 'The dialog stays open');
	assert.equal(state.repState.districts.length, 0);
	const error = document.getElementById('rep-new-district-error');
	assert.match(error.textContent, /4096文字以内/);
	assert.equal(error.style.display, 'block');
	assert.equal(rep.addNewRepDistrict('か'.repeat(4097)), false);
});

test('SEC-30 coverage: resizing a seat grid without stored cells works and keeps the grid storable', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	delete state.repState.seatConfig.cells;
	document.getElementById('seat-cols').value = '3';
	document.getElementById('seat-rows').value = '3';
	await seat.resizeSeatGrid();
	assert.equal(state.repState.seatConfig.cols, 3);
	assert.equal(state.repState.seatConfig.rows, 3);
	assert.deepEqual(state.repState.seatConfig.cells, {});
});

test('QA-01 coverage: officer-data detection treats missing or non-object models as empty', () => {
	assert.equal(cryptoLib.hasNonEmptyOfficerModels(null), false);
	assert.equal(cryptoLib.hasNonEmptyOfficerModels('models'), false);
	assert.equal(cryptoLib.hasOfficerData('kogai_rep_v2', null), false);
	assert.equal(cryptoLib.hasOfficerData('kogai_neighbor_v2', { district: '自治会' }), false, 'Guest keys never count as officer data');
	assert.equal(cryptoLib.hasOfficerData('kogai_rep_v2', { districts: [], szExternals: [{ category: '任意', org: '', role: '', attend: true }] }), true, 'An edited external row is officer data');
});

test('QA-03 coverage: blank-row and grade helpers treat whitespace, out-of-district flags and missing grades consistently', () => {
	assert.equal(utils.isBlankStudentRow(null), false);
	assert.equal(utils.isBlankStudentRow({ lastName: '  ', tel: '\t' }), true);
	assert.equal(utils.isBlankStudentRow({ isOutOfDistrict: true }), false);
	assert.equal(utils.isBlankStudentRow({ leader: '班長' }), false);
	const district = { students: [{ grade: '', lastName: '' }, { grade: '3', lastName: '実在' }] };
	assert.deepEqual(utils.normalizeImportedStudents(district).students.map(row => row.lastName), ['実在']);
	assert.deepEqual(utils.normalizeImportedStudents({ district: '児童なし' }), { district: '児童なし' });
	assert.throws(() => utils.normalizeImportedStudents({ students: [{ name: '旧形式 名前' }] }), error => error.code === 'INVALID_IMPORT_GRADE' && /旧形式 名前/.test(error.message));
	assert.throws(() => utils.normalizeImportedStudents({ students: [{ address: '住所だけ' }] }), error => /氏名未入力/.test(error.message));
	assert.equal(utils.importFailureMessage(null, '既定'), '既定');
	assert.equal(utils.importFailureMessage(Object.assign(new Error('保存失敗'), { code: 'IMPORT_SAVE_FAILED' }), '既定'), '保存失敗');
	assert.equal(utils.importFailureMessage(Object.assign(new Error('x'), { code: 'INVALID_IMPORT_DATA' }), '既定'), '既定');
});

test('SEC-30 coverage: repair is skipped for models that are not objects or have nothing repairable', () => {
	assert.throws(() => utils.validateStoredData(null, 'kogai_rep_v2', { repair: true }), /フォーマット/);
	assert.throws(() => utils.validateStoredData({ district: 1 }, 'kogai_district_v2', { repair: true }), /フォーマット/, 'No hata to repair');
	assert.throws(() => utils.validateStoredData({ district: 'd', officers: [], students: [], neighborhood: [], hata: { inputDrafts: [], startDate: 'bad' } }, 'kogai_district_v2', { repair: true }), /フォーマット/, 'Non-object drafts are not repaired');
	assert.throws(() => utils.validateStoredData({ district: 'd', officers: [], students: [], neighborhood: [], hata: { startDate: 5 } }, 'kogai_district_v2', { repair: true }), /フォーマット/, 'Non-string inputs are not repaired');
	assert.throws(() => utils.validateStoredData({ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: { bad: {} } } }, 'kogai_rep_v2', { repair: true }), /フォーマット/, 'Malformed cell keys are not repaired');
	const repairs = [];
	assert.doesNotThrow(() => utils.validateStoredData({ districts: [], szExternals: [], seatConfig: { cells: { '9_9': {} } } }, 'kogai_rep_v2', { repair: true, repairs }));
	assert.deepEqual(repairs, ['seat-cells'], 'Default dimensions are used when they are omitted');
	assert.doesNotThrow(() => utils.validateStoredData({ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } }, 'kogai_rep_v2', { repair: true }), 'Repairs without a collector are allowed');
});

test('QA-05 coverage: the local date stamp defaults to now', () => {
	assert.match(utils.formatLocalDateStamp(), /^\d{4}-\d{2}-\d{2}$/);
});

test('SEC-30 (Gate 3): hata repair only applies to budget failures and never stringifies malformed arrays', () => {
	const district = hata => ({ district: 'd', officers: [], students: [], neighborhood: [], hata });
	const overBudget = { startDate: '2026-04-06', endDate: '2027-03-24', members: 'A', specials: '' };
	assert.throws(() => utils.validateStoredData(district({ ...overBudget, holidays: ['2026-05-04'] }), 'kogai_district_v2', { repair: true }), /フォーマット/, 'Non-object holiday entries are not repaired');
	assert.throws(() => utils.validateStoredData(district({ ...overBudget, holidays: [{ date: '5月4日', name: 'x' }] }), 'kogai_district_v2', { repair: true }), /フォーマット/, 'Malformed holiday dates are not repaired');
	assert.throws(() => utils.validateStoredData(district({ startDate: '2026-04-06', endDate: '2026-04-10', members: ['A', { name: 'B' }] }), 'kogai_district_v2', { repair: true }), /フォーマット/, 'Non-string members are not stringified');
	assert.throws(() => utils.validateStoredData(district({ startDate: '2026-04-06', endDate: '2026-04-10', holidays: 5 }), 'kogai_district_v2', { repair: true }), /フォーマット/, 'A structural error within budget is not repaired');
	const repaired = utils.validateStoredData(district({ ...overBudget, holidays: [{ date: '2026-05-04', name: 'あ'.repeat(1200) }, { date: '2026-05-05' }] }), 'kogai_district_v2', { repair: true });
	assert.equal(repaired.hata.inputDrafts.holidays, `2026-05-04,${'あ'.repeat(1200)}\n2026-05-05,祝日`);
});

test('I-12-07 (Gate 3): the suspended-key import refusal uses the documented wording without an internal code', async () => {
	fresh();
	localStorage.setItem('kogai_neighbor_v2', JSON.stringify({ district: '破損', neighborhood: {} }));
	await app.startUnencryptedSession();
	await assert.rejects(cryptoLib.commitImportedModel('kogai_neighbor_v2', { district: '部分', neighborhood: [] }), error => {
		assert.equal(error.code, 'IMPORT_SAVE_FAILED');
		assert.equal(error.message, '保存を停止しているため読み込みを中止しました。全消去するか、正しいデータを復元してください。');
		return true;
	});
});

test('I-12-02 (Gate 3): saveStorageDataUnlocked validates when given the documented options object', async () => {
	fresh();
	const invalid = JSON.stringify({ district: '自治会', neighborhood: {} });
	assert.equal(await cryptoLib.saveStorageDataUnlocked('kogai_neighbor_v2', invalid, { validate: true }), false);
	assert.equal(localStorage.getItem('kogai_neighbor_v2'), null);
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), ['kogai_neighbor_v2']);
	assert.equal(await cryptoLib.saveStorageDataUnlocked('kogai_neighbor_v2', JSON.stringify({ district: '自治会', neighborhood: [] }), { validate: true }), true);
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), []);
	const stored = localStorage.getItem('kogai_neighbor_v2');
	for (const legacy of [true, 'validate', null]) {
		await assert.rejects(cryptoLib.saveStorageDataUnlocked('kogai_neighbor_v2', invalid, legacy), TypeError, `A non-object option (${String(legacy)}) is refused`);
	}
	assert.equal(localStorage.getItem('kogai_neighbor_v2'), stored, 'Nothing is written with a legacy signature');
});
