const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
const utils = require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
const seat = require('../../js/seat');
const district = require('../../js/district');
const rep = require('../../js/rep');
require('../../js/neighbor');
require('../../js/transfer');
const handoff = require('../../js/handoff');
const app = require('../../js/app');

const PASSWORD = 'SaveInvariant123!';
const originalValidateStoredData = global.validateStoredData;
const DISTRICT_RENDER_ROWS = Math.floor(4 * 1024 * 1024 / (128 + 2 * 3 * 4096 + 256));

const NativeURL = require('node:url').URL;

function fresh() {
	cryptoLib.clearStorageSecurity();
	setupDomEnvironment();
	// dom-mock の MockURL は globalThis.URL を内部で使うため、実装の URL へ戻す。
	global.URL = NativeURL;
	state.currentDistrict = { district: '地区', han: '1班', hanList: ['1班'], officers: [], students: [], neighborhood: [], hata: { members: '', holidays: '', specials: '' } };
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	state.neighborState = { district: '', neighborhood: [] };
	state.transferState = { children: [], memo: '' };
	renderDistrictForm();
	seat.renderSeatEditor();
	const dialogs = { alerts: [], confirms: [] };
	global.alert = message => dialogs.alerts.push(String(message));
	global.confirm = message => { dialogs.confirms.push(String(message)); return dialogs.confirmAnswer ?? true; };
	return dialogs;
}

/** 保存値を実WebCryptoのロック→解除→全4モード読込で往復させる。 */
async function relock() {
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	await app.loadAppDataFromStorage();
}

/** 旧版（保存前検証なし）で書き込まれた値を再現する。 */
async function saveAsLegacy(save) {
	global.validateStoredData = value => value;
	try {
		assert.equal(await save(), true, 'Legacy value written without validation');
	} finally {
		global.validateStoredData = originalValidateStoredData;
	}
}

/** テスト側で保持できる排他ロックを作り、保存要求を排他待ちにする。 */
function holdStorageLock() {
	const original = navigator.locks.request;
	let release;
	const held = new Promise(resolve => { release = resolve; });
	let waiting = 0;
	navigator.locks.request = async (_name, options, callback) => {
		const run = typeof options === 'function' ? options : callback;
		waiting++;
		await held;
		return run({});
	};
	return { release: () => release(), restore: () => { navigator.locks.request = original; }, waiting: () => waiting };
}

/** 旧形式（形式1・PBKDF2 10万回・AADなし）の暗号化端末を作る。 */
async function writeLegacyFormatDatabase(models) {
	const subtle = globalThis.crypto.subtle;
	const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
	const master = await subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
	const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
	const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
	const wrapKey = await cryptoLib.deriveKey(PASSWORD, salt, 100000);
	const wrapped = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, raw));
	for (const [index, key] of cryptoLib.STORAGE_DATA_KEYS.entries()) {
		const dataIv = globalThis.crypto.getRandomValues(new Uint8Array(12));
		const cipher = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: dataIv }, master, new TextEncoder().encode(JSON.stringify(models[index]))));
		const combined = new Uint8Array(dataIv.length + cipher.length);
		combined.set(dataIv); combined.set(cipher, dataIv.length);
		localStorage.setItem(key, 'STORAGE_ENC:' + cryptoLib.uint8ToBase64(combined));
	}
	localStorage.setItem(cryptoLib.STORAGE_AUTH_KEY, JSON.stringify({ isEncrypted: true, version: 1, password: { salt: cryptoLib.uint8ToBase64(salt), iv: cryptoLib.uint8ToBase64(iv), wrappedKey: cryptoLib.uint8ToBase64(wrapped) }, webauthn: null }));
	raw.fill(0);
}

function enableWebAuthnEnvironment() {
	window.isSecureContext = true;
	window.location = { href: 'https://example.test/index.html', origin: 'https://example.test', pathname: '/index.html', protocol: 'https:' };
}

const emptyModels = () => [
	{ district: '', han: '', hanList: [], officers: [], neighborhood: [], students: [] },
	{ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } },
	{ district: '', neighborhood: [] },
	{ children: [], memo: '' }
];

function resize(cols, rows) {
	document.getElementById('seat-cols').value = String(cols);
	document.getElementById('seat-rows').value = String(rows);
	return seat.resizeSeatGrid();
}

const bigOfficers = (count = 6) => Array.from({ length: count }, () => ({ role: '校外委員', lastName: 'あ'.repeat(4096), firstName: '' }));
const pupil = index => ({ grade: '1', class: '1', han: 'あ'.repeat(4096), lastName: '児童', firstName: String(index) });

test('SEC-30: shrinking the seat grid asks before discarding assigned seats and the saved model always unlocks', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	await resize(4, 6);
	seat.updateSeatCell('5_0', 'customText', '来賓');
	await new Promise(resolve => setTimeout(resolve, 0));
	const saved = localStorage.getItem('kogai_rep_v2');

	dialogs.confirmAnswer = false;
	await resize(4, 5);
	assert.equal(dialogs.confirms.length, 1);
	assert.match(dialogs.confirms[0], /1席/);
	assert.equal(dialogs.alerts.length, 0, 'Cancelling is not reported');
	assert.equal(state.repState.seatConfig.rows, 6, 'Cancelled shrink keeps the previous grid');
	assert.equal(state.repState.seatConfig.cells['5_0'].customText, '来賓');
	assert.equal(document.getElementById('seat-rows').value, '6', 'Cancelled shrink restores the visible input');
	assert.equal(localStorage.getItem('kogai_rep_v2'), saved, 'Cancelled shrink never writes storage');

	dialogs.confirmAnswer = true;
	await resize(4, 5);
	assert.equal(state.repState.seatConfig.rows, 5);
	assert.equal(Object.hasOwn(state.repState.seatConfig.cells, '5_0'), false, 'Accepted shrink removes out-of-range seats');
	await relock();
	assert.equal(state.repState.seatConfig.rows, 5);
	assert.equal(state.repState.seatConfig.cols, 4);
});

test('SEC-30: empty out-of-range seats are dropped silently and min/max grid boundaries still unlock', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	await resize(10, 14);
	seat.updateSeatCell('13_9', 'refKey', '');
	seat.updateSeatCell('0_0', 'customText', '残す');
	await resize(2, 2);
	assert.equal(dialogs.confirms.length, 0, 'Blank seats need no confirmation');
	assert.deepEqual(Object.keys(state.repState.seatConfig.cells), ['0_0']);
	await relock();
	assert.equal(state.repState.seatConfig.cells['0_0'].customText, '残す');
	assert.equal(state.repState.seatConfig.cols, 2);
	assert.equal(state.repState.seatConfig.rows, 2);
	await resize(1, 99);
	assert.equal(state.repState.seatConfig.cols, 2, 'Columns are clamped to the minimum');
	assert.equal(state.repState.seatConfig.rows, 14, 'Rows are clamped to the maximum');
});

test('SEC-30: enlarging beyond the seat render budget is rejected and the previous grid is restored', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.districts = [{ district: 'X', han: '1班', officers: bigOfficers(), students: [], neighborhood: [], selectedForPrint: true }];
	assert.equal(await saveRepLocal(), true, 'The 5x4 grid is inside the budget');
	const saved = localStorage.getItem('kogai_rep_v2');
	await resize(10, 14);
	assert.equal(state.repState.seatConfig.cols, 4);
	assert.equal(state.repState.seatConfig.rows, 5);
	assert.equal(document.getElementById('seat-cols').value, '4');
	assert.equal(document.getElementById('seat-rows').value, '5');
	assert.equal(dialogs.alerts.length, 1);
	assert.match(dialogs.alerts[0], /上限を超える/);
	assert.equal(localStorage.getItem('kogai_rep_v2'), saved);
	await relock();
	assert.equal(state.repState.districts[0].officers.length, 6);
});

test('SEC-30: long derived values (seat keys, full names, household keys) can be saved and unlocked at their boundaries', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const name = 'え'.repeat(4096);
	state.repState.districts = [{ district: name, han: '', officers: [{ role: '校外委員', lastName: '役員', firstName: '' }], students: [], neighborhood: [{ role: '会長', lastName: '会長', firstName: '' }], szNeighborChecks: { 0: true }, selectedForPrint: true }];
	const participant = seat.getAllSzParticipantsForSeat().find(item => item.key.startsWith('NEI_'));
	assert.equal(participant.key.length, 4102);
	seat.updateSeatCell('0_0', 'refKey', participant.key);
	assert.equal(await saveRepLocal(), true);

	state.currentDistrict.students = [{ grade: '1', class: '1', han: '1班', lastName: 'い'.repeat(4096), firstName: 'は'.repeat(4096), address: 'う'.repeat(4096) }];
	state.currentDistrict.students[0].name = utils.getFullName(state.currentDistrict.students[0]);
	assert.equal(state.currentDistrict.students[0].name.length, 8193);
	const [household] = hata.extractHouseholdsFromStudents(state.currentDistrict.students);
	assert.equal(household.key.length, 8193);
	hata.toggleHataExempt(household.key, true, household.displayName);
	assert.equal(await saveDistrictLocal(), true);
	await relock();
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, participant.key);
	assert.equal(state.currentDistrict.students[0].name.length, 8193);
	assert.deepEqual(state.currentDistrict.hata.exemptHouseholds, [household.key]);

	const seatWith = refKey => ({ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: { '0_0': { refKey, customText: '' } } } });
	assert.doesNotThrow(() => utils.validateImportData(seatWith('x'.repeat(4160)), 'rep'));
	assert.throws(() => utils.validateImportData(seatWith('x'.repeat(4161)), 'rep'), /フォーマット/);
	const row = derived => ({ district: 'd', officers: [], neighborhood: [], students: [{ grade: '1', ...derived }] });
	for (const [field, parts] of [['kana', {}], ['childKana', {}], ['name', { lastName: 'x' }], ['childName', { childLastName: 'x' }]]) {
		assert.doesNotThrow(() => utils.validateImportData(row({ ...parts, [field]: 'x'.repeat(8193) }), 'district'), field);
		assert.throws(() => utils.validateImportData(row({ ...parts, [field]: 'x'.repeat(8194) }), 'district'), /フォーマット/, `${field} at MAX_DERIVED_TEXT_LENGTH + 1`);
	}
	assert.throws(() => utils.validateImportData(row({ lastName: 'x'.repeat(4097) }), 'district'), /フォーマット/, 'Ordinary short text stays at 4096');
	assert.doesNotThrow(() => utils.validateHataConfig({ exemptHouseholds: ['x'.repeat(8193)] }));
	assert.throws(() => utils.validateHataConfig({ exemptHouseholds: ['x'.repeat(8194)] }), /フォーマット/);
});

test('SEC-30: row additions and the han list are validated as candidates and rolled back when over budget', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.currentDistrict.hanList = ['あ'.repeat(4096)];
	state.currentDistrict.han = state.currentDistrict.hanList[0];
	state.currentDistrict.students = Array.from({ length: DISTRICT_RENDER_ROWS - 1 }, (_, index) => pupil(index));
	renderDistrictForm(); // 通常保存は画面の入力欄から集め直すため、状態を画面へ反映する。
	assert.equal(await saveDistrictLocal(), true);
	// 描画予算は児童行と役員行の合計で見積もるため、画面の既定役員行を含めて境界の1行手前にそろえる。
	const rows = () => state.currentDistrict.students.length + state.currentDistrict.officers.length;
	// 保存は排他ロックで直列化されるため、通常保存を1回待つと先行する保存の完了も確定する。
	const settle = () => saveDistrictLocal();
	state.currentDistrict.students.length = DISTRICT_RENDER_ROWS - 1 - state.currentDistrict.officers.length;
	renderDistrictForm();
	assert.equal(await saveDistrictLocal(), true);
	assert.equal(rows(), DISTRICT_RENDER_ROWS - 1);
	district.addStudentRow();
	assert.equal(rows(), DISTRICT_RENDER_ROWS, 'The last row inside the budget is accepted');
	assert.equal(dialogs.alerts.length, 0);
	await settle();
	// 行追加前の通常保存で暗号文の IV は変わり得るため、保存内容を復号して比較する。
	const storedContent = async () => { await settle(); return JSON.stringify(await cryptoLib.loadStorageDecrypted('kogai_district_v2')); };
	const saved = await storedContent();
	for (const add of [district.addStudentRow, district.addOfficer]) {
		const before = JSON.stringify(state.currentDistrict);
		add();
		assert.equal(JSON.stringify(state.currentDistrict), before, `${add.name} is rolled back`);
		await settle();
		assert.equal(await storedContent(), saved, `${add.name} never stores the rejected row`);
	}
	assert.equal(dialogs.alerts.length, 2);
	assert.ok(dialogs.alerts.every(message => /上限を超えるため、この変更を取り消しました/.test(message)));
	district.addNeighborhoodRow();
	assert.equal(state.currentDistrict.neighborhood.length, 1, 'Neighborhood rows are outside the district render budget');
	await settle();
	const savedWithNeighbor = await storedContent();
	const originalNeighborhood = state.currentDistrict.neighborhood;
	state.currentDistrict.neighborhood = Array.from({ length: 10000 }, () => ({ role: '会員', lastName: '' }));
	const beforeNeighbors = JSON.stringify(state.currentDistrict);
	district.addNeighborhoodRow();
	assert.equal(JSON.stringify(state.currentDistrict), beforeNeighbors, 'The 10001st neighborhood row exceeds the array limit and is rolled back');
	assert.equal(dialogs.alerts.length, 3);
	state.currentDistrict.neighborhood = originalNeighborhood;

	const hanInput = document.getElementById('d-han-list');
	hanInput.value = 'い'.repeat(4096) + ',う';
	district.onHanListInput(hanInput.value);
	assert.deepEqual(state.currentDistrict.hanList, ['あ'.repeat(4096)], 'Han list rolled back');
	assert.equal(hanInput.value, 'あ'.repeat(4096), 'Han input restored');
	await settle();
	assert.equal(await storedContent(), savedWithNeighbor, 'Rolled-back han list never stores the rejected list');
	assert.equal(dialogs.alerts.length, 4);
	await relock();
	assert.equal(rows(), DISTRICT_RENDER_ROWS);
	assert.equal(state.currentDistrict.neighborhood.length, 1);
});

test('SEC-30: representative additions are validated as candidates against the seat render budget', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.seatConfig = { cols: 10, rows: 14, cells: {} };
	const external = () => ({ attend: true, category: '役所・警察・関係機関', org: '', role: '', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', name: '', contact: '' });
	for (;;) {
		const candidate = structuredClone(state.repState);
		candidate.szExternals.push(external());
		try { utils.validateStoredData(candidate, 'kogai_rep_v2'); } catch (_) { break; }
		state.repState.szExternals.push(external());
	}
	assert.equal(await saveRepLocal(), true);
	const before = JSON.stringify(state.repState);
	rep.addSzExternalRow();
	assert.equal(JSON.stringify(state.repState), before, 'External row rolled back');
	state.currentDistrict = { district: '追加地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '追加', firstName: '役員' }], students: [], neighborhood: [] };
	renderDistrictForm();
	rep.addCurrentDistrictToRep();
	assert.equal(JSON.stringify(state.repState), before, 'District addition rolled back');
	rep.addNewRepDistrict('新地区');
	assert.equal(JSON.stringify(state.repState), before, 'Manual district addition rolled back');
	assert.equal(dialogs.alerts.filter(message => /上限を超えるため、この変更を取り消しました/.test(message)).length, 3);
	await new Promise(resolve => setTimeout(resolve, 0));
	await relock();
	assert.equal(state.repState.districts.length, 0);
});

test('SEC-30: saveStorageData refuses values that unlock-time validation rejects and keeps a persistent warning', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const warning = document.getElementById('storage-save-warning');
	const saved = localStorage.getItem('kogai_rep_v2');
	state.repState.seatConfig.cells['99_99'] = { refKey: '', customText: '範囲外' };
	assert.equal(await saveRepLocal(), false);
	assert.equal(await saveRepLocal(), false);
	assert.equal(localStorage.getItem('kogai_rep_v2'), saved, 'Rejected values never replace stored ciphertext');
	assert.equal(dialogs.alerts.length, 1, 'The same storage key is reported only once');
	assert.match(dialogs.alerts[0], /端末に保存できない内容があります/);
	assert.equal(warning.hidden, false, 'The warning stays visible');
	assert.match(warning.textContent, /校外代表/);
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), ['kogai_rep_v2']);
	const leave = { preventDefault() { this.prevented = true; }, returnValue: undefined };
	window.dispatchEvent({ type: 'beforeunload', ...leave, preventDefault: leave.preventDefault.bind(leave) });
	assert.equal(leave.prevented, true, 'Leaving asks for confirmation while rejected');

	state.currentDistrict.officers = [{ role: '校外委員', lastName: 'x'.repeat(4097) }];
	renderDistrictForm();
	assert.equal(await saveDistrictLocal(), false);
	assert.equal(dialogs.alerts.length, 2, 'A different storage key is reported separately');
	assert.match(warning.textContent, /地区役員/);

	assert.equal(await app.performAppUpdate('9.9.9'), false);
	assert.match(dialogs.alerts.at(-1), /端末に保存できない内容があります/);
	assert.doesNotMatch(dialogs.alerts.at(-1), /空き容量/);
	await assert.rejects(handoff.collectBrowserHandoff(), /端末に保存できない内容があります/);

	delete state.repState.seatConfig.cells['99_99'];
	state.currentDistrict.officers = [];
	renderDistrictForm();
	assert.equal(await saveRepLocal(), true);
	assert.equal(warning.hidden, false, 'Another key is still rejected');
	assert.equal(await saveDistrictLocal(), true);
	assert.equal(warning.hidden, true, 'All saves succeeded');
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), []);
	state.repState.seatConfig.cells['99_99'] = { refKey: '', customText: '再発' };
	assert.equal(await saveRepLocal(), false);
	assert.equal(dialogs.alerts.filter(message => /端末に保存できない/.test(message)).length, 4, 'A successful save resets the notification state');
	cryptoLib.lockStorage();
	assert.equal(warning.hidden, false, 'Locking alone keeps the warning while the rejected memory remains');
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	app.handleImmediateLock();
	assert.equal(warning.hidden, true, 'Purging memory on lock clears the rejection state');
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), []);
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	await app.loadAppDataFromStorage();
	assert.equal(Object.hasOwn(state.repState.seatConfig.cells, '99_99'), false);
});

test('SEC-30 / SEC-34: the warning and reason elements exist in the static page with the documented roles', () => {
	const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../index.html'), 'utf8');
	const tag = html.match(/<[a-z]+\b[^>]*\bid="storage-save-warning"[^>]*>/)?.[0];
	assert.ok(tag, 'The persistent save warning exists');
	assert.match(tag, /\brole="alert"/, 'It is announced as an alert');
	assert.match(tag, /\shidden(?=[\s>=])/, 'It is hidden by default');
	const notice = html.slice(html.indexOf('id="guest-storage-notice"'), html.indexOf('</div>', html.indexOf('id="guest-storage-notice"')) + 6);
	assert.match(notice, /id="guest-storage-notice-reason"/, 'The guest notice has a reason slot');
});

test('SEC-30: saves that are not written anyway (locked, plaintext officer) never register a rejection', async () => {
	const dialogs = fresh();
	cryptoLib.requireOfficerStorageEncryption();
	state.currentDistrict.officers = [{ role: '校外委員', lastName: 'x'.repeat(4097) }];
	assert.equal(await saveDistrictLocal(), false, 'Plaintext officer writes are denied before validation');
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), []);
	state.currentDistrict.officers = [];
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	cryptoLib.lockStorage();
	state.repState.seatConfig.cells['99_99'] = { refKey: '', customText: '範囲外' };
	assert.equal(await saveRepLocal(), false);
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), []);
	assert.equal(dialogs.alerts.length, 0);
});

test('SEC-30: unencrypted guest saves are validated as well and invalid values keep the previous plaintext', async () => {
	const dialogs = fresh();
	state.neighborState = { district: '自治会', neighborhood: [{ role: '会長', lastName: '有効' }] };
	assert.equal(await saveNeighborLocal(), true);
	const saved = localStorage.getItem('kogai_neighbor_v2');
	state.neighborState.neighborhood[0].lastName = 'x'.repeat(4097);
	assert.equal(await saveNeighborLocal(), false);
	assert.equal(localStorage.getItem('kogai_neighbor_v2'), saved);
	assert.equal(dialogs.alerts.length, 1);
	state.transferState = { children: [], memo: 'x'.repeat(4097) };
	assert.equal(await saveTransferLocal(), false);
	assert.equal(localStorage.getItem('kogai_transfer_v2'), null);
});

test('SEC-30: unreadable plaintext data at startup suspends only that key instead of overwriting the original', async () => {
	const dialogs = fresh();
	localStorage.setItem('kogai_neighbor_v2', JSON.stringify({ district: '破損', neighborhood: {} }));
	localStorage.setItem('kogai_transfer_v2', JSON.stringify({ children: [], memo: '保持' }));
	const brokenNeighbor = localStorage.getItem('kogai_neighbor_v2');
	await app.startUnencryptedSession();
	assert.equal(state.transferState.memo, '保持', 'Valid keys are still loaded');
	assert.equal(dialogs.alerts.filter(message => /保存を停止/.test(message)).length, 1);
	const warning = document.getElementById('storage-save-warning');
	assert.equal(warning.hidden, false);
	assert.match(warning.textContent, /自治会/);
	state.transferState.memo = '更新できる';
	assert.equal(await saveTransferLocal(), true, 'Other keys keep saving');
	assert.equal(warning.hidden, false, 'A successful save of another key keeps the suspension notice');
	assert.match(warning.textContent, /保存を停止/);
	state.neighborState.district = '上書き禁止';
	assert.equal(await saveNeighborLocal(), false);
	assert.equal(warning.hidden, false);
	assert.match(warning.textContent, /自治会/);
	const leave = { prevented: false };
	window.dispatchEvent({ type: 'beforeunload', preventDefault: () => { leave.prevented = true; }, set returnValue(_) {} });
	assert.equal(leave.prevented, true, 'Leaving asks for confirmation while a mode is suspended');
	assert.equal(localStorage.getItem('kogai_neighbor_v2'), brokenNeighbor, 'The unreadable original is preserved');
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), [], 'Suspension is not a validation rejection');
	await assert.rejects(cryptoLib.setupStorageEncryption(PASSWORD, false), /STORAGE_WRITES_SUSPENDED/);
	assert.equal(localStorage.getItem('kogai_neighbor_v2'), brokenNeighbor, 'Encryption setup cannot overwrite the original');
	assert.equal(cryptoLib.isStorageEncrypted(), false);
	await assert.rejects(handoff.collectBrowserHandoff(), /保存を停止しているモードがあるため、引き継ぎを作成できません/, 'A handoff would overwrite valid data at the destination');
	await assert.rejects(cryptoLib.commitImportedModel('kogai_neighbor_v2', { district: '部分合成', neighborhood: [] }), error => error.code === 'IMPORT_SAVE_FAILED' && /保存を停止/.test(error.message));
	assert.equal(localStorage.getItem('kogai_neighbor_v2'), brokenNeighbor, 'Partial merges never write a suspended key');
	const navigations = [];
	window.location = { href: 'https://example.test/index.html', origin: 'https://example.test', pathname: '/index.html', protocol: 'https:', replace: url => navigations.push(url) };
	const alertsBeforeUpdate = dialogs.alerts.length;
	await app.performAppUpdate('9.9.9');
	assert.equal(navigations.length, 1, 'Updating is not blocked by a suspended key');
	assert.equal(dialogs.alerts.length, alertsBeforeUpdate, 'No save-failure notice for the suspended key');
	const file = { name: 'n.txt', text: async () => `BEGIN_DATA:${await cryptoLib.encryptPayload(JSON.stringify({ isNeighborhoodData: true, district: '取込で復旧', neighborhood: [] }), 'NeighborPass123!')}:END_DATA` };
	document.getElementById('neighbor-import-pass').value = 'NeighborPass123!';
	await loadNeighborTxt({ target: { files: [file], value: 'n.txt' } });
	assert.equal(JSON.parse(localStorage.getItem('kogai_neighbor_v2')).district, '取込で復旧', 'The full-replacement neighborhood import writes the suspended key');
	state.neighborState = { district: '復旧後', neighborhood: [] };
	assert.equal(await saveNeighborLocal(), true, 'Writing the key through an import resumes saving');
	assert.equal(warning.hidden, true);
});

test('SEC-30: pasted neighborhood imports and handoff restores also resume a suspended key', async () => {
	fresh();
	localStorage.setItem('kogai_neighbor_v2', JSON.stringify({ district: '破損', neighborhood: {} }));
	localStorage.setItem('kogai_transfer_v2', JSON.stringify({ children: 'x', memo: '' }));
	await app.startUnencryptedSession();
	document.getElementById('neighbor-paste-box').value = `BEGIN_DATA:${await cryptoLib.encryptPayload(JSON.stringify({ isNeighborhoodData: true, district: '貼付で復旧', neighborhood: [] }), 'NeighborPass123!')}:END_DATA`;
	document.getElementById('neighbor-import-pass').value = 'NeighborPass123!';
	await loadPastedTextToNeighbor();
	assert.equal(JSON.parse(localStorage.getItem('kogai_neighbor_v2')).district, '貼付で復旧');
	assert.equal(await saveTransferLocal(), false, 'The other key is still suspended');
	const models = emptyModels();
	models[3].memo = '引き継ぎで復旧';
	await cryptoLib.replaceStoredAppData(models);
	assert.equal(JSON.parse(localStorage.getItem('kogai_transfer_v2')).memo, '引き継ぎで復旧');
	state.transferState = { children: [], memo: '再開' };
	assert.equal(await saveTransferLocal(), true, 'Handoff restore resumes the key');
	assert.equal(document.getElementById('storage-save-warning').hidden, true);
});

test('SEC-30: clearing all data resumes suspended keys', async () => {
	fresh();
	localStorage.setItem('kogai_transfer_v2', JSON.stringify({ children: 'x', memo: '' }));
	await app.startUnencryptedSession();
	assert.equal(await saveTransferLocal(), false);
	await cryptoLib.clearStorageSecurity();
	assert.equal(await saveTransferLocal(), true);
	assert.equal(document.getElementById('storage-save-warning').hidden, true);
});

test('SEC-30: stored values written by older versions are repaired on unlock without rewriting the original', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.seatConfig = { cols: 10, rows: 14, cells: { '0_0': { refKey: '', customText: '残す' }, '13_9': { refKey: '', customText: '範囲内' } } };
	state.repState.districts = [{ district: 'X', han: '1班', officers: bigOfficers(), students: [], neighborhood: [], selectedForPrint: true }];
	await saveAsLegacy(() => saveStorageData('kogai_rep_v2', state.repState));
	state.currentDistrict.hata = { startDate: '2026-04-06', endDate: '2027-03-24', holidays: '2026-05-04,' + 'あ'.repeat(1200), members: 'A\nB', specials: '', metaHeaderMsg: 'へ'.repeat(4097) };
	await saveAsLegacy(() => saveStorageData('kogai_district_v2', state.currentDistrict));
	const originals = [localStorage.getItem('kogai_rep_v2'), localStorage.getItem('kogai_district_v2')];
	await relock();
	assert.equal(state.repState.seatConfig.cols, 4, 'Over-budget legacy grid is reset to 4x5');
	assert.equal(state.repState.seatConfig.rows, 5);
	assert.deepEqual(Object.keys(state.repState.seatConfig.cells), ['0_0'], 'Out-of-range legacy seats are removed');
	assert.equal(state.repState.districts[0].officers.length, 6, 'Personal data is preserved');
	assert.equal(state.currentDistrict.hata.endDate, '', 'Over-budget legacy period is no longer effective');
	assert.equal(state.currentDistrict.hata.inputDrafts.endDate, '2027-03-24', 'Legacy period is kept as a draft');
	assert.equal(state.currentDistrict.hata.inputDrafts.holidays.length, 11 + 1200);
	assert.equal(state.currentDistrict.hata.inputDrafts.headerMsg.length, 4097);
	assert.deepEqual([localStorage.getItem('kogai_rep_v2'), localStorage.getItem('kogai_district_v2')], originals, 'Reading never rewrites the originals');
	assert.equal(hata.ensureHataInputsReady(), false, 'Recovered drafts must be fixed before output');

	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.seatConfig = { cols: 4, rows: 5, cells: { '7_0': { refKey: '', customText: '範囲外' } } };
	await saveAsLegacy(() => saveStorageData('kogai_rep_v2', state.repState));
	await relock();
	assert.deepEqual(state.repState.seatConfig.cells, {});
	assert.throws(() => utils.validateImportData({ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: { '7_0': {} } } }, 'rep'), /フォーマット/, 'Imports stay strict');
	assert.throws(() => utils.validateStoredData({ districts: [], szExternals: [], seatConfig: { cols: 99, rows: 5, cells: {} } }, 'kogai_rep_v2', { repair: true }), /フォーマット/, 'Invalid dimensions are not repaired');
	const hugeOfficers = { districts: [{ district: 'X', han: '1班', officers: bigOfficers(60), students: [], neighborhood: [], selectedForPrint: true }], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	assert.throws(() => utils.validateStoredData(hugeOfficers, 'kogai_rep_v2', { repair: true }), /フォーマット/, 'A roster that exceeds the budget even at 4x5 is still rejected');
	const badHata = { district: 'd', officers: [], students: [], neighborhood: [], hata: { startDate: '2026-04-06', endDate: '2027-03-24', holidays: '2026-05-04,' + 'あ'.repeat(1200), members: 'A', specials: '', weekdays: [9] } };
	assert.throws(() => utils.validateStoredData(badHata, 'kogai_district_v2', { repair: true }), error => error.code === 'INVALID_IMPORT_DATA', 'A hata that is still invalid after moving drafts throws the original error');
	const hans = Array.from({ length: 20 }, (_, index) => 'あ'.repeat(200) + index);
	const overRenderDistrict = { district: 'd', hanList: hans, officers: [], neighborhood: [], students: Array.from({ length: 200 }, () => ({ grade: '1', lastName: 'x' })) };
	assert.throws(() => utils.validateStoredData(overRenderDistrict, 'kogai_district_v2', { repair: true }), /フォーマット/, 'District render overflow is not repaired (R-SEC-D)');
	const repairs = [];
	utils.validateStoredData({ districts: [{ district: 'X', han: '1班', officers: bigOfficers(), students: [], neighborhood: [], selectedForPrint: true }], szExternals: [], seatConfig: { cols: 10, rows: 14, cells: {} } }, 'kogai_rep_v2', { repair: true, repairs });
	assert.ok(repairs.includes('seat-grid'));
	const legacyRepairs = [];
	utils.validateStoredData({ district: 'd', officers: [], students: [], neighborhood: [], hata: { metaHeaderMsg: 'へ'.repeat(4097) } }, 'kogai_district_v2', { repair: true, repairs: legacyRepairs });
	assert.deepEqual(legacyRepairs, ['hata-legacy-text']);
});

test('SEC-30: the next normal save and a legacy-format migration both persist the repaired values', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.seatConfig = { cols: 4, rows: 5, cells: { '0_0': { refKey: '', customText: '残す' }, '9_0': { refKey: '', customText: '範囲外' } } };
	await saveAsLegacy(() => saveStorageData('kogai_rep_v2', state.repState));
	await relock();
	assert.equal(await saveRepLocal(), true);
	assert.deepEqual(Object.keys((await cryptoLib.loadStorageDecrypted('kogai_rep_v2')).seatConfig.cells), ['0_0'], 'The next save writes the repaired model');

	fresh();
	const models = emptyModels();
	models[1].seatConfig.cells = { '0_0': { refKey: '', customText: '残す' }, '9_0': { refKey: '', customText: '範囲外' } };
	await writeLegacyFormatDatabase(models);
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	assert.ok(localStorage.getItem('kogai_rep_v2').startsWith('STORAGE_ENC:2:'));
	assert.deepEqual(Object.keys((await cryptoLib.loadStorageDecrypted('kogai_rep_v2')).seatConfig.cells), ['0_0'], 'Format migration re-encrypts the repaired value');
	assert.deepEqual((await app.loadAppDataFromStorage()).repairs, ['seat-cells'], 'Repairs found during activation are handed to the next load');
	assert.deepEqual((await app.loadAppDataFromStorage()).repairs, [], 'They are handed over only once');

	fresh();
	await writeLegacyFormatDatabase(models);
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	assert.deepEqual((await app.loadAppDataFromStorage()).repairs, [], 'Locking discards repairs from an earlier session');
});

test('SEC-30: unlocking a legacy-format device through the dialog announces the repair once', async () => {
	const dialogs = fresh();
	const models = emptyModels();
	models[1].seatConfig.cells = { '9_0': { refKey: '', customText: '範囲外' } };
	await writeLegacyFormatDatabase(models);
	document.getElementById('modal-unlock-pass').value = PASSWORD;
	await app.handlePasswordUnlock();
	assert.equal(cryptoLib.isStorageUnlocked(), true);
	const notices = dialogs.alerts.filter(message => /保存データの一部を修復して開きました/.test(message));
	assert.equal(notices.length, 1);
	assert.match(notices[0], /範囲外の座席/);
});

test('SEC-30: unlocking stored data that fails validation is reported separately for password and biometric unlock', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.districts = [{ district: '不正', officers: [null] }];
	await saveAsLegacy(() => saveStorageData('kogai_rep_v2', state.repState));
	cryptoLib.lockStorage();
	const errEl = document.getElementById('modal-unlock-error');
	document.getElementById('modal-unlock-pass').value = 'WrongPassword123!';
	await app.handlePasswordUnlock();
	assert.match(errEl.textContent, /パスワードが正しくない/);
	document.getElementById('modal-unlock-pass').value = PASSWORD;
	await app.handlePasswordUnlock();
	assert.match(errEl.textContent, /保存データの検証に失敗しました/);
	assert.doesNotMatch(errEl.textContent, /パスワードが正しくない/);
	assert.equal(cryptoLib.isStorageUnlocked(), false);

	const invalid = Object.assign(new Error('データのフォーマットが一致しません。'), { code: 'INVALID_IMPORT_DATA' });
	const originalWebAuthn = global.unlockStorageWithWebAuthn;
	global.unlockStorageWithWebAuthn = async () => { throw invalid; };
	try {
		await app.handleWebAuthnUnlock();
		assert.match(errEl.textContent, /保存データの検証に失敗しました/);
		global.unlockStorageWithWebAuthn = async () => { throw new Error('認証がキャンセルされました'); };
		await app.handleWebAuthnUnlock();
		assert.equal(errEl.textContent, '認証がキャンセルされました');
	} finally {
		global.unlockStorageWithWebAuthn = originalWebAuthn;
	}
	assert.match(app.describeUnlockFailure(invalid, 'fallback'), /保存データの検証に失敗しました/);
	assert.match(app.describeUnlockFailure(new Error('STORAGE_LOCKS_UNAVAILABLE'), 'fallback'), /Web Locks/);
	assert.equal(app.describeUnlockFailure(new Error('x'), 'fallback'), 'fallback');
});

test('SEC-30: biometric unlock through the real authenticator path reports a stored-data validation failure', async () => {
	fresh();
	enableWebAuthnEnvironment();
	assert.equal((await cryptoLib.setupStorageEncryption(PASSWORD, true)).biometric, true);
	state.repState.districts = [{ district: '不正', officers: [null] }];
	await saveAsLegacy(() => saveStorageData('kogai_rep_v2', state.repState));
	cryptoLib.lockStorage();
	await app.handleWebAuthnUnlock();
	assert.match(document.getElementById('modal-unlock-error').textContent, /保存データの検証に失敗しました/);
	assert.equal(cryptoLib.isStorageUnlocked(), false);
});

test('SEC-31: a period preset that exceeds the expansion budget stays a draft and the stored model still unlocks', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	document.getElementById('hata-holidays').value = '2026-05-04,' + 'あ'.repeat(1200);
	document.getElementById('hata-start-date').value = '2026-04-06';
	document.getElementById('hata-end-date').value = '2026-09-30';
	assert.equal(await saveDistrictLocal(), true);
	assert.equal(state.currentDistrict.hata.inputDrafts, undefined, 'The first half-year is inside the budget');
	const committed = { startDate: state.currentDistrict.hata.startDate, endDate: state.currentDistrict.hata.endDate };
	hata.applyHataPeriodPreset('full');
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(state.currentDistrict.hata.startDate, committed.startDate);
	assert.equal(state.currentDistrict.hata.endDate, committed.endDate, 'Over-budget presets never replace the effective period');
	assert.match(state.currentDistrict.hata.inputDrafts.endDate, /-03-24$/);
	assert.match(document.getElementById('hata-end-date').value, /-03-24$/, 'The visible input keeps the requested draft');
	assert.equal(await saveDistrictLocal(), true);
	await relock();
	assert.equal(state.currentDistrict.hata.endDate, committed.endDate);
	assert.match(state.currentDistrict.hata.inputDrafts.endDate, /-03-24$/);
});

test('SEC-31: an in-budget preset is committed directly and clears the period draft', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.currentDistrict.hata.inputDrafts = { endDate: '2026-1' };
	hata.applyHataPeriodPreset('kouki');
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(state.currentDistrict.hata.inputDrafts, undefined);
	assert.match(state.currentDistrict.hata.startDate, /-10-01$/);
	assert.match(state.currentDistrict.hata.endDate, /-03-24$/);
	await relock();
	assert.match(state.currentDistrict.hata.endDate, /-03-24$/);
});

test('SEC-31 / SPEC-Q4: presets use the calendar year of the operation at year and fiscal-year boundaries', t => {
	const cases = [
		['2026-01-01T00:00:00', 2026], ['2026-03-31T23:59:00', 2026], ['2026-04-01T00:00:00', 2026], ['2026-12-31T23:59:00', 2026], ['2027-01-01T00:00:00', 2027]
	];
	for (const [now, year] of cases) {
		fresh();
		t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
		try {
			for (const [preset, start, end] of [['zenki', `${year}-04-06`, `${year}-09-30`], ['kouki', `${year}-10-01`, `${year + 1}-03-24`], ['full', `${year}-04-06`, `${year + 1}-03-24`]]) {
				hata.applyHataPeriodPreset(preset);
				assert.deepEqual([state.currentDistrict.hata.startDate, state.currentDistrict.hata.endDate], [start, end], `${now} ${preset}`);
			}
		} finally { t.mock.timers.reset(); }
	}
});

test('QA-11: automatic generation failures are reported without changing the roster or drafts', () => {
	const dialogs = fresh();
	state.currentDistrict.hata = { startDate: '2026-04-06', endDate: '2026-04-10', holidays: '', specials: '' };
	state.currentDistrict.students = Array.from({ length: 10001 }, (_, index) => ({ grade: '1', lastName: `世帯${index}`, address: `${index}` }));
	assert.doesNotThrow(() => hata.runAutoHataGeneration());
	assert.equal(state.currentDistrict.hata.members, undefined, 'An over-limit derived roster is never committed');
	assert.equal(state.currentDistrict.hata.inputDrafts, undefined, 'The derived roster is not shown as a user draft');
	assert.equal(dialogs.alerts.length, 1);
	assert.match(dialogs.alerts[0], /^旗振りシフトを生成できませんでした：/);
	assert.ok(document.getElementById('hata-schedule-preview').innerHTML.length > 0, 'Preview is refreshed');

	state.currentDistrict.hata = { startDate: '2026-04-06', endDate: '2026-04-10', holidays: '', specials: '', members: '既存名簿', inputDrafts: { specials: '2026-04-0' } };
	hata.runAutoHataGeneration();
	assert.equal(state.currentDistrict.hata.members, '既存名簿', 'An unfinished draft stops generation before the roster changes');
	assert.deepEqual(state.currentDistrict.hata.inputDrafts, { specials: '2026-04-0' }, 'Existing drafts are kept');

	state.currentDistrict.hata = { startDate: '2026-04-06', endDate: '2026-04-10', holidays: '', specials: '' };
	state.currentDistrict.students = [{ grade: '1', lastName: '佐藤', address: '1-2' }];
	hata.runAutoHataGeneration();
	assert.equal(state.currentDistrict.hata.members, '1-2 佐藤');
	assert.ok(document.getElementById('hata-schedule-preview').innerHTML.includes('佐藤'));
});

test('SEC-34: a valid ciphertext written by another tab locks this unlocked tab and shows the reason on the unlock dialog', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	app.initAutoLockListeners();
	app.switchTab('district');
	state.currentDistrict.district = '旧タブの値';
	const foreign = localStorage.getItem('kogai_district_v2');
	window.dispatchEvent({ type: 'storage', key: 'kogai_district_v2', oldValue: 'STORAGE_ENC:2:older', newValue: foreign, storageArea: localStorage });
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.equal(cryptoLib.isStorageEncrypted(), true, 'A valid foreign update never resets security');
	assert.equal(state.currentDistrict.district, '', 'Stale memory is purged');
	app.showStorageUnlockModal();
	assert.match(document.getElementById('modal-unlock-error').textContent, /別のタブで保存データが更新されました/, 'Reason survives reopening the dialog');
	assert.equal(await saveDistrictLocal(), false, 'A locked tab cannot overwrite the newer value');
	assert.equal(localStorage.getItem('kogai_district_v2'), foreign);
	document.getElementById('modal-unlock-pass').value = PASSWORD;
	await app.handlePasswordUnlock();
	assert.equal(cryptoLib.isStorageUnlocked(), true);
	app.showStorageUnlockModal();
	assert.equal(document.getElementById('modal-unlock-error').textContent, '', 'A successful unlock clears the reason');
});

test('SEC-34: a foreign write while this tab waits for the storage lock is detected inside the exclusive section', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	app.switchTab('district');
	const lock = holdStorageLock();
	let pending;
	let foreign;
	try {
		state.currentDistrict.district = '古い全モデル';
		pending = saveDistrictLocal();
		await new Promise(resolve => setTimeout(resolve, 0));
		assert.ok(lock.waiting() >= 1, 'The save is waiting for the exclusive lock');
		const mine = localStorage.getItem('kogai_district_v2');
		foreign = mine.replace(/.$/, mine.at(-1) === 'A' ? 'B' : 'A');
		localStorage.setItem('kogai_district_v2', foreign);
	} finally {
		lock.release();
		lock.restore();
	}
	assert.equal(await pending, false);
	assert.equal(localStorage.getItem('kogai_district_v2'), foreign, 'The newer value is never overwritten');
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.match(document.getElementById('modal-unlock-error').textContent, /別のタブで保存データが更新されました/);
});

test('SEC-34: own writes through imports, handoff restore and format migration never look like foreign updates', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	await cryptoLib.commitImportedModel('kogai_district_v2', { district: '取込', officers: [], students: [], neighborhood: [] });
	state.currentDistrict.district = '取込後の編集';
	assert.equal(await saveDistrictLocal(), true, 'After commitImportedModel');
	const models = emptyModels();
	models[2].district = '引き継ぎ';
	await cryptoLib.replaceStoredAppData(models);
	state.neighborState.district = '引き継ぎ後の編集';
	assert.equal(await saveNeighborLocal(), true, 'After replaceStoredAppData');
	assert.equal(await saveRepLocal(), true);
	assert.equal(cryptoLib.isStorageUnlocked(), true);

	fresh();
	await writeLegacyFormatDatabase(emptyModels());
	await relock();
	assert.ok(localStorage.getItem('kogai_rep_v2').startsWith('STORAGE_ENC:2:'), 'Unlocking migrated the format');
	assert.equal(await saveRepLocal(), true, 'After format migration');
	assert.equal(await saveDistrictLocal(), true);
	assert.equal(cryptoLib.isStorageUnlocked(), true);
});

test('SEC-34: guests see the reason in the guest notice and concurrent updates during unlock keep the reason', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	app.initAutoLockListeners();
	app.switchTab('neighbor');
	const value = localStorage.getItem('kogai_neighbor_v2');
	window.dispatchEvent({ type: 'storage', key: 'kogai_neighbor_v2', oldValue: 'a', newValue: value, storageArea: localStorage });
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.match(document.getElementById('guest-storage-notice-reason').textContent, /別のタブで保存データが更新されました/);

	app.switchTab('district');
	let triggered = false;
	global.validateStoredData = (data, key) => {
		if (!triggered) { triggered = true; app.handleForeignStorageUpdate(); }
		return originalValidateStoredData(data, key);
	};
	try {
		document.getElementById('modal-unlock-pass').value = PASSWORD;
		await app.handlePasswordUnlock();
	} finally {
		global.validateStoredData = originalValidateStoredData;
	}
	assert.ok(triggered);
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.match(document.getElementById('modal-unlock-error').textContent, /別のタブで保存データが更新されました/, 'The reason is not replaced by the wrong-password text');
});

test('SEC-34: a foreign update during biometric unlock also keeps the reason', async () => {
	fresh();
	enableWebAuthnEnvironment();
	const setup = await cryptoLib.setupStorageEncryption(PASSWORD, true);
	assert.equal(setup.biometric, true, 'The mock authenticator is registered');
	cryptoLib.lockStorage();
	app.switchTab('district');
	let triggered = false;
	global.validateStoredData = (data, key, options) => {
		if (!triggered) { triggered = true; app.handleForeignStorageUpdate(); }
		return originalValidateStoredData(data, key, options);
	};
	try {
		await app.handleWebAuthnUnlock();
	} finally {
		global.validateStoredData = originalValidateStoredData;
	}
	assert.ok(triggered);
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.match(document.getElementById('modal-unlock-error').textContent, /別のタブで保存データが更新されました/);
});

test('SEC-34: identical values, already locked tabs, unencrypted storage and other keys do not lock', async () => {
	fresh();
	app.initAutoLockListeners();
	window.dispatchEvent({ type: 'storage', key: 'kogai_neighbor_v2', oldValue: '{}', newValue: '{"district":"x"}', storageArea: localStorage });
	assert.equal(cryptoLib.isStorageEncrypted(), false);
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const value = localStorage.getItem('kogai_rep_v2');
	window.dispatchEvent({ type: 'storage', key: 'kogai_rep_v2', oldValue: value, newValue: value, storageArea: localStorage });
	window.dispatchEvent({ type: 'storage', key: 'kogai_active_mode', oldValue: 'district', newValue: 'rep', storageArea: localStorage });
	window.dispatchEvent({ type: 'storage', key: 'kogai_rep_v2', oldValue: 'a', newValue: value, storageArea: sessionStorage });
	assert.equal(cryptoLib.isStorageUnlocked(), true);
	assert.equal(await saveRepLocal(), true, 'Own writes keep the known ciphertext in sync');
	assert.equal(await saveRepLocal(), true);
	cryptoLib.lockStorage();
	document.getElementById('modal-unlock-error').textContent = '';
	window.dispatchEvent({ type: 'storage', key: 'kogai_rep_v2', oldValue: 'a', newValue: value, storageArea: localStorage });
	assert.equal(document.getElementById('modal-unlock-error').textContent, '', 'Locked tabs are not re-locked or re-notified');
	assert.equal(cryptoLib.isStorageEncrypted(), true);
});

test('SEC-35: added district names are limited to 4096 characters', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	rep.addNewRepDistrict('か'.repeat(4097));
	assert.equal(state.repState.districts.length, 0);
	assert.match(document.getElementById('rep-new-district-error').textContent, /4096/);
	rep.addNewRepDistrict('か'.repeat(4096));
	assert.equal(state.repState.districts.length, 1);
	await new Promise(resolve => setTimeout(resolve, 0));
	await relock();
	assert.equal(state.repState.districts[0].district.length, 4096);
});

test('SEC-30: candidate and save-time checks are strict even when unlock-time repair would accept the value', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const overGrid = { districts: [{ district: 'X', han: '1班', officers: bigOfficers(), students: [], neighborhood: [], selectedForPrint: true }], szExternals: [], seatConfig: { cols: 10, rows: 14, cells: {} } };
	assert.doesNotThrow(() => utils.validateStoredData(structuredClone(overGrid), 'kogai_rep_v2', { repair: true }), 'Repair would accept it');
	assert.throws(() => utils.validateStoredData(structuredClone(overGrid), 'kogai_rep_v2'), /フォーマット/, 'Strict validation is the default');
	assert.throws(() => cryptoLib.validateStorageModel(structuredClone(overGrid), 'kogai_rep_v2'), /フォーマット/);
	state.repState = overGrid;
	assert.equal(await saveRepLocal(), false, 'Saving uses strict validation');
	const outOfRange = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: { '9_0': { refKey: '', customText: '' } } } };
	assert.doesNotThrow(() => utils.validateStoredData(structuredClone(outOfRange), 'kogai_rep_v2', { repair: true }));
	state.repState = outOfRange;
	assert.equal(await saveRepLocal(), false);
	state.currentDistrict.hata = { startDate: '2026-04-06', endDate: '2027-03-24', holidays: '2026-05-04,' + 'あ'.repeat(1200), members: 'A\nB', specials: '' };
	assert.equal(await saveStorageData('kogai_district_v2', state.currentDistrict), false, 'Over-budget hata is not saved');
	assert.equal(await saveStorageData('kogai_district_v2', state.currentDistrict), false);
	assert.equal(dialogs.alerts.length, 2, 'Exactly one notice per key (representative, district) regardless of repeated rejections');
});

test('SEC-30: rejection notices are raised outside the exclusive storage lock', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	let heldDuringAlert = null;
	global.alert = message => {
		dialogs.alerts.push(String(message));
		heldDuringAlert = navigator.locks.__held ? navigator.locks.__held() : null;
	};
	let lockActive = false;
	const originalRequest = navigator.locks.request;
	navigator.locks.request = async (name, options, callback) => {
		const run = typeof options === 'function' ? options : callback;
		return originalRequest.call(navigator.locks, name, typeof options === 'function' ? {} : options, async lock => {
			lockActive = true;
			try { return await run(lock); } finally { lockActive = false; }
		});
	};
	navigator.locks.__held = () => lockActive;
	try {
		state.repState.seatConfig.cells['99_99'] = { refKey: '', customText: '範囲外' };
		assert.equal(await saveRepLocal(), false);
	} finally {
		navigator.locks.request = originalRequest;
		delete navigator.locks.__held;
	}
	assert.equal(dialogs.alerts.length, 1);
	assert.equal(heldDuringAlert, false, 'The alert is shown after the lock is released');
});

test('SEC-30: long full names are accepted only when they will not be split by normalization', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const row = extra => ({ district: 'd', officers: [], neighborhood: [], students: [{ grade: '1', ...extra }] });
	assert.throws(() => utils.validateImportData(row({ name: 'x'.repeat(4097) }), 'district'), /フォーマット/, 'A name without lastName must fit after splitting');
	assert.throws(() => utils.validateImportData(row({ lastName: '', firstName: '', name: 'x'.repeat(8193) }), 'district'), /フォーマット/, 'Empty name parts do not unlock the long limit');
	assert.doesNotThrow(() => utils.validateImportData(row({ lastName: '', firstName: 'y', name: 'x'.repeat(8193) }), 'district'), 'A string lastName with a non-empty first name is enough');
	assert.throws(() => utils.validateImportData(row({ firstName: 'y', name: 'x'.repeat(8193) }), 'district'), /フォーマット/, 'An undefined lastName would be split by normalization');
	assert.doesNotThrow(() => utils.validateImportData(row({ name: 'x'.repeat(4096) }), 'district'));
	assert.doesNotThrow(() => utils.validateImportData(row({ lastName: 'x', name: 'x'.repeat(8193) }), 'district'));
	const officer = extra => ({ district: 'd', neighborhood: [], students: [], officers: [{ role: '校外委員', ...extra }] });
	assert.throws(() => utils.validateImportData(officer({ childName: 'x'.repeat(4097) }), 'district'), /フォーマット/);
	assert.throws(() => utils.validateImportData(officer({ childLastName: '', childFirstName: '', childName: 'x'.repeat(8193) }), 'district'), /フォーマット/);
	assert.throws(() => utils.validateImportData(officer({ childFirstName: 'y', childName: 'x'.repeat(8193) }), 'district'), /フォーマット/);
	assert.doesNotThrow(() => utils.validateImportData(officer({ childLastName: 'x', childName: 'x'.repeat(8193) }), 'district'));
	assert.doesNotThrow(() => utils.validateImportData(officer({ childKana: 'x'.repeat(8193) }), 'district'), 'Kana is never split');

	state.currentDistrict.students = [{ grade: '1', class: '1', han: '1班', name: 'な'.repeat(4096) }];
	assert.equal(await saveStorageData('kogai_district_v2', state.currentDistrict), true);
	await relock();
	assert.equal(state.currentDistrict.students[0].lastName.length, 4096, 'Normalization splits within the limit');
	assert.equal(await saveDistrictLocal(), true, 'The normalized model saves again');
	const [household] = hata.extractHouseholdsFromStudents([{ name: 'な'.repeat(4096), address: 'う'.repeat(4096) }]);
	assert.ok(household.key.length <= 8193);
});

test('SEC-30: legacy array-form holidays and members are stringified when an over-budget hata is repaired, and the repair is announced once', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const legacy = { startDate: '2026-04-06', endDate: '2027-03-24', holidays: [{ date: '2026-05-04', name: 'あ'.repeat(1200) }, { date: '2026-05-05' }], members: ['A', 'B'], specials: '' };
	state.currentDistrict.hata = legacy;
	await saveAsLegacy(() => saveStorageData('kogai_district_v2', state.currentDistrict));
	dialogs.alerts.length = 0;
	await relock();
	assert.equal(dialogs.alerts.filter(message => /修復/.test(message)).length, 0, 'Loading alone does not notify before rendering');
	cryptoLib.lockStorage();
	document.getElementById('modal-unlock-pass').value = PASSWORD;
	await app.handlePasswordUnlock();
	assert.equal(cryptoLib.isStorageUnlocked(), true);
	assert.equal(state.currentDistrict.hata.inputDrafts.holidays, `2026-05-04,${'あ'.repeat(1200)}\n2026-05-05,祝日`);
	assert.equal(state.currentDistrict.hata.inputDrafts.members, 'A\nB');
	assert.equal(state.currentDistrict.hata.holidays, '');
	const notices = dialogs.alerts.filter(message => /保存データの一部を修復して開きました/.test(message));
	assert.equal(notices.length, 1);
	assert.match(notices[0], /旗振り/);
	assert.equal(await saveDistrictLocal(), true, 'The repaired model is storable');
	dialogs.alerts.length = 0;
	cryptoLib.lockStorage();
	document.getElementById('modal-unlock-pass').value = PASSWORD;
	await app.handlePasswordUnlock();
	assert.equal(cryptoLib.isStorageUnlocked(), true);
	assert.equal(dialogs.alerts.filter(message => /修復/.test(message)).length, 0, 'No notice when nothing was repaired');
	const repairs = [];
	utils.validateStoredData({ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: { '9_9': {} } } }, 'kogai_rep_v2', { repair: true, repairs });
	assert.deepEqual(repairs, ['seat-cells']);
});

test('SEC-34: an import saved after another tab changed the database locks with the reason instead of a storage-capacity error', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	app.switchTab('district');
	const original = localStorage.getItem('kogai_district_v2');
	const foreign = original.replace(/.$/, original.at(-1) === 'A' ? 'B' : 'A');
	localStorage.setItem('kogai_district_v2', foreign);
	await assert.rejects(cryptoLib.commitImportedModel('kogai_district_v2', { district: '取込', officers: [], students: [], neighborhood: [] }), /STORAGE_SESSION_CHANGED/);
	assert.equal(localStorage.getItem('kogai_district_v2'), foreign);
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.match(document.getElementById('modal-unlock-error').textContent, /別のタブで保存データが更新されました/);
	assert.equal(dialogs.alerts.filter(message => /空き容量/.test(message)).length, 0);
});

test('SEC-34: import callers stop silently and handoff restore shows no failure when another tab changed the database', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	app.switchTab('district');
	document.getElementById('d-pass').value = 'Submission123!';
	const cipher = await cryptoLib.encryptPayload(JSON.stringify({ district: '取込', officers: [{ role: '校外委員', lastName: '新' }], students: [], neighborhood: [] }), 'Submission123!');
	const original = localStorage.getItem('kogai_district_v2');
	const foreign = original.replace(/.$/, original.at(-1) === 'A' ? 'B' : 'A');
	const realParse = global.parseTxtContent;
	global.parseTxtContent = async (...args) => { const data = await realParse(...args); localStorage.setItem('kogai_district_v2', foreign); return data; };
	try {
		await district.loadDistrictTxt({ target: { files: [{ name: 'd.txt', text: async () => cipher }], value: 'd.txt' } });
	} finally { global.parseTxtContent = realParse; }
	assert.equal(localStorage.getItem('kogai_district_v2'), foreign);
	assert.deepEqual(dialogs.alerts, [], 'No import failure notice');
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.match(document.getElementById('modal-unlock-error').textContent, /別のタブで保存データが更新されました/);

	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	app.switchTab('neighbor');
	const dialog = document.getElementById('browser-handoff-dialog');
	dialog.showModal = () => { dialog.open = true; };
	dialog.close = () => { dialog.open = false; };
	handoff.openBrowserHandoff();
	const payload = { type: 'kogaidocs-browser-handoff', version: 1, mode: 'neighbor', models: emptyModels(), drafts: {}, repDraft: null };
	document.getElementById('handoff-input').value = await cryptoLib.encryptPayload(JSON.stringify(payload), 'HandoffPass123!');
	document.getElementById('handoff-restore-pass').value = 'HandoffPass123!';
	const neighborBefore = localStorage.getItem('kogai_neighbor_v2');
	const foreignNeighbor = neighborBefore.replace(/.$/, neighborBefore.at(-1) === 'A' ? 'B' : 'A');
	global.confirm = () => { localStorage.setItem('kogai_neighbor_v2', foreignNeighbor); return true; };
	assert.equal(await handoff.restoreBrowserHandoff(), false);
	assert.equal(localStorage.getItem('kogai_neighbor_v2'), foreignNeighbor, 'The other tab value is kept');
	assert.equal(document.getElementById('handoff-status').textContent, '', 'No 引き継ぎに失敗しました message');
	assert.equal(cryptoLib.isStorageUnlocked(), false);
	assert.match(document.getElementById('guest-storage-notice-reason').textContent, /別のタブで保存データが更新されました/);
});


test('SEC-30: enabling encryption with an unstorable in-memory model writes nothing', async () => {
	fresh();
	state.neighborState = { district: '保存済み', neighborhood: [] };
	renderNeighborForm();
	assert.equal(await saveNeighborLocal(), true);
	const before = JSON.stringify(localStorage.store);
	state.repState.seatConfig.cells['99_99'] = { refKey: '', customText: '範囲外' };
	enableWebAuthnEnvironment();
	let creations = 0, generated = 0;
	const originalCreate = navigator.credentials.create;
	const originalGenerate = crypto.subtle.generateKey;
	navigator.credentials.create = async (...args) => { creations++; return originalCreate.apply(navigator.credentials, args); };
	crypto.subtle.generateKey = async (...args) => { generated++; return originalGenerate.apply(crypto.subtle, args); };
	try {
		await assert.rejects(cryptoLib.setupStorageEncryption(PASSWORD, true), /STORAGE_SAVE_REJECTED/);
	} finally {
		navigator.credentials.create = originalCreate;
		crypto.subtle.generateKey = originalGenerate;
	}
	assert.equal(creations, 0, 'No authenticator credential is created for a rejected setup');
	assert.equal(generated, 0, 'No master key is generated for a rejected setup');
	assert.equal(JSON.stringify(localStorage.store), before, 'No key or metadata is written');
	assert.equal(cryptoLib.isStorageEncrypted(), false);
	delete state.repState.seatConfig.cells['99_99'];
	const originalDerive = crypto.subtle.deriveKey;
	crypto.subtle.deriveKey = async (...args) => {
		state.neighborState.district = '鍵導出中の変更';
		return originalDerive.apply(crypto.subtle, args);
	};
	try {
		await cryptoLib.setupStorageEncryption(PASSWORD, false);
	} finally { crypto.subtle.deriveKey = originalDerive; }
	assert.equal(state.neighborState.district, '鍵導出中の変更', 'Memory changed while the key was derived');
	assert.equal(cryptoLib.isStorageEncrypted(), true);
	state.neighborState.district = '';
	await relock();
	assert.equal(state.neighborState.district, '保存済み', 'The validated snapshot is what gets encrypted');
});

test('SEC-30: imports and handoff restores that replace a rejected key clear its warning', async () => {
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	const warning = document.getElementById('storage-save-warning');
	state.repState.seatConfig.cells['99_99'] = { refKey: '', customText: '範囲外' };
	state.currentDistrict.officers = [{ role: '校外委員', lastName: 'x'.repeat(4097) }];
	renderDistrictForm();
	assert.equal(await saveRepLocal(), false);
	assert.equal(await saveDistrictLocal(), false);
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys().sort(), ['kogai_district_v2', 'kogai_rep_v2']);
	await cryptoLib.commitImportedModel('kogai_district_v2', { district: '取込', officers: [], students: [], neighborhood: [] });
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), ['kogai_rep_v2'], 'The imported key is no longer rejected');
	assert.equal(warning.hidden, false);
	await cryptoLib.replaceStoredAppData(emptyModels().map((model, index) => index === 1 ? { districts: [{ district: '引継', officers: [{ role: '校外委員', lastName: '役員' }], students: [], neighborhood: [] }], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } } : model));
	assert.deepEqual(cryptoLib.getStorageSaveRejectedKeys(), []);
	assert.equal(warning.hidden, true, 'Replacing every rejected key hides the warning');
});

