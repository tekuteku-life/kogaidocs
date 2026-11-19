const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
const utils = require('../../js/utils');
const crypt = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
require('../../js/seat');
const district = require('../../js/district');
const rep = require('../../js/rep');
require('../../js/neighbor'); require('../../js/transfer');
const app = require('../../js/app');

const FILE_PASSWORD = 'Submission123!';
const DEVICE_PASSWORD = 'DatabasePassword1!';
const originalEncryptPayload = global.encryptPayload;
const originalDownload = global.downloadTextFile;

function fresh() {
	crypt.clearStorageSecurity();
	setupDomEnvironment();
	state.currentDistrict = { district: '地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '現', firstName: '役員' }], students: [], neighborhood: [], hata: { members: '', holidays: '', specials: '' } };
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	state.neighborState = { district: '', neighborhood: [] };
	state.transferState = { children: [], memo: '' };
	renderDistrictForm();
	document.getElementById('d-pass').value = FILE_PASSWORD;
	document.getElementById('d-pass-confirm').value = FILE_PASSWORD;
	const io = { alerts: [], confirms: [], opened: [], downloads: [], copied: [] };
	global.alert = message => io.alerts.push(String(message));
	global.confirm = message => { io.confirms.push(String(message)); return true; };
	window.open = global.open = url => io.opened.push(url);
	global.downloadTextFile = (content, filename) => io.downloads.push({ content, filename });
	Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: { writeText: async text => { io.copied.push(text); } } });
	return io;
}

async function fileEvent(data, pass = FILE_PASSWORD) {
	const text = `--- 見出し ---\nBEGIN_DATA:\n${await crypt.encryptPayload(JSON.stringify(data), pass)}\n:END_DATA\n`;
	return { target: { files: [{ name: '地区.txt', text: async () => text }], value: '地区.txt' } };
}

async function decryptOutput(content) {
	return JSON.parse(await crypt.decryptPayload(content.slice(content.indexOf('BEGIN_DATA:') + 11, content.indexOf(':END_DATA')).trim(), FILE_PASSWORD));
}

test('SEC-32: ciphertext extraction handles headers, missing markers and whitespace like the previous parser', async () => {
	const data = { district: '抽出', officers: [], students: [], neighborhood: [] };
	const cipher = await crypt.encryptPayload(JSON.stringify(data), FILE_PASSWORD);
	for (const text of [cipher, `  ${cipher}\n`, `見出し BEGIN_DATA:${cipher}:END_DATA`, `--- x ---\nBEGIN_DATA:\n\n${cipher}\n\n:END_DATA\n末尾`, `BEGIN_DATA:${cipher}:END_DATA\nBEGIN_DATA:ignored:END_DATA`]) {
		assert.equal((await crypt.parseTxtContent(text, FILE_PASSWORD, undefined, 'district')).district, '抽出');
	}
	assert.equal(crypt.extractEncryptedPayload(`BEGIN_DATA:  ${cipher}`), `BEGIN_DATA:  ${cipher}`.trim(), 'A missing end marker falls back to the whole text');
	assert.equal(crypt.extractEncryptedPayload(`${cipher}:END_DATA`), `${cipher}:END_DATA`, 'A missing start marker falls back to the whole text');
	assert.equal(crypt.extractEncryptedPayload('BEGIN_DATA::END_DATA'), '');
	await assert.rejects(crypt.parseTxtContent('BEGIN_DATA:   :END_DATA', FILE_PASSWORD));
});

test('SEC-32: pathological whitespace and repeated markers are rejected in linear time', async () => {
	for (const text of ['BEGIN_DATA:x' + ' '.repeat(200000), 'BEGIN_DATA:x'.repeat(40000)]) {
		const started = performance.now();
		await assert.rejects(crypt.parseTxtContent(text, FILE_PASSWORD));
		assert.ok(performance.now() - started < 2000, `Rejected within 2s: ${Math.round(performance.now() - started)}ms`);
	}
});

test('SEC-32: an input close to the 8MiB limit is rejected without blocking the main thread', async () => {
	const text = 'BEGIN_DATA:x' + ' '.repeat(8 * 1024 * 1024 - 64);
	const started = performance.now();
	await assert.rejects(crypt.parseTxtContent(text, FILE_PASSWORD));
	assert.ok(performance.now() - started < 3000, `Rejected within 3s: ${Math.round(performance.now() - started)}ms`);
	await assert.rejects(crypt.parseTxtContent(text + ' '.repeat(128), FILE_PASSWORD), /上限/);
});

test('SEC-33: a remembered password inside an imported district file is never adopted', async () => {
	for (const pasted of [false, true]) {
		const io = fresh();
		await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
		const payload = { district: '地区', officers: [{ role: '校外委員', lastName: '新' }], students: [], neighborhood: [], savedFilePassword: 'AttackerPass99!' };
		if (pasted) {
			document.getElementById('d-paste-box').value = await (await fileEvent(payload)).target.files[0].text();
			await district.loadPastedTextToDistrict();
		} else {
			assert.equal(await district.loadDistrictTxt(await fileEvent(payload)), true);
		}
		assert.equal(state.currentDistrict.officers[0].lastName, '新');
		assert.equal(state.currentDistrict.savedFilePassword, undefined);
		assert.equal(document.getElementById('d-pass').value, FILE_PASSWORD, 'The typed file password is kept');
		assert.notEqual(document.getElementById('d-save-password-optin').checked, true);
		assert.equal((await crypt.loadStorageDecrypted('kogai_district_v2')).savedFilePassword, undefined);
		assert.ok(io.alerts.some(message => /読み込みました/.test(message)));
	}
});

test('SEC-33: representative files never carry remembered passwords into the representative model', async () => {
	const io = fresh();
	await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
	document.getElementById('rep-pass').value = FILE_PASSWORD;
	const district = { district: '代表取込', officers: [{ role: '校外委員', lastName: '代' }], students: [], neighborhood: [], savedFilePassword: 'AttackerPass99!' };
	const master = { districts: [district], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} }, savedFilePassword: 'AttackerPass99!' };
	const parsed = await crypt.parseTxtContent(await (await fileEvent(master)).target.files[0].text(), FILE_PASSWORD, undefined, 'rep');
	assert.equal(Object.hasOwn(parsed, 'savedFilePassword'), false);
	assert.equal(Object.hasOwn(parsed.districts[0], 'savedFilePassword'), false);
	document.getElementById('rep-paste-box').value = await (await fileEvent(master)).target.files[0].text();
	await rep.loadPastedTextToRep();
	assert.ok(state.repState.districts.some(row => row.district === '代表取込'), JSON.stringify(io.alerts));
	assert.ok(!JSON.stringify(state.repState).includes('AttackerPass99!'));
	assert.ok(!JSON.stringify(await crypt.loadStorageDecrypted('kogai_rep_v2')).includes('AttackerPass99!'));
	await rep.loadMultipleDistrictFiles({ target: { files: [{ name: 'd.txt', text: async () => (await fileEvent(district)).target.files[0].text() }], value: 'd.txt' } });
	assert.ok(!JSON.stringify(await crypt.loadStorageDecrypted('kogai_rep_v2')).includes('AttackerPass99!'));
});

test('SEC-33: an existing consented remembered password survives an import and is excluded from every output', async () => {
	const io = fresh();
	await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
	document.getElementById('d-save-password-optin').checked = true;
	assert.equal(await saveDistrictLocal(), true);
	assert.equal(state.currentDistrict.savedFilePassword, FILE_PASSWORD, 'Explicit consent while unlocked remembers the password');
	await district.loadDistrictTxt(await fileEvent({ district: '地区', officers: [{ role: '校外委員', lastName: '次' }], students: [], neighborhood: [], savedFilePassword: 'AttackerPass99!' }));
	assert.equal(state.currentDistrict.savedFilePassword, FILE_PASSWORD);
	assert.equal((await crypt.loadStorageDecrypted('kogai_district_v2')).savedFilePassword, FILE_PASSWORD);
	await district.exportDistrictTxt();
	assert.equal(io.downloads.length, 1);
	const exported = await decryptOutput(io.downloads[0].content);
	assert.equal(Object.hasOwn(exported, 'savedFilePassword'), false);
	assert.equal(exported.officers[0].lastName, '次');
	await district.shareDistrictData('copy');
	assert.equal(Object.hasOwn(await decryptOutput(io.copied.at(-1)), 'savedFilePassword'), false);
	assert.equal(state.currentDistrict.savedFilePassword, FILE_PASSWORD, 'Output never mutates the remembered password');
});

test('QA-03: imported pupils with a grade outside 1-6 are rejected by name while blank placeholder rows are dropped', async () => {
	for (const grade of ['', '0', '7', '６', '1年', ' 1']) {
		const io = fresh();
		await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
		const before = JSON.stringify(state.currentDistrict);
		const data = { district: '地区', officers: [{ role: '校外委員', lastName: '別' }], students: [{ grade, class: '1', lastName: '児童', firstName: '一' }], neighborhood: [] };
		await district.loadDistrictTxt(await fileEvent(data));
		assert.equal(JSON.stringify(state.currentDistrict), before, `District import rejects grade ${JSON.stringify(grade)}`);
		assert.match(io.alerts.at(-1), /児童「児童 一」の学年「.*」は1〜6年ではありません/);
		assert.equal(await district.loadDistrictStudentsTxt(await fileEvent(data)), false, `Pupil addition rejects grade ${JSON.stringify(grade)}`);
		assert.match(io.alerts.at(-1), /1〜6年ではありません/);
		await assert.rejects(crypt.parseTxtContent(await (await fileEvent({ districts: [data] })).target.files[0].text(), FILE_PASSWORD, undefined, 'auto'), error => error.code === 'INVALID_IMPORT_GRADE');
	}
	{
		const io = fresh();
		await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
		const data = { district: '地区', officers: [{ role: '校外委員', lastName: '別' }], students: [{ grade: '7', class: '1', lastName: '児童', firstName: '一' }], neighborhood: [] };
		const text = await (await fileEvent(data)).target.files[0].text();
		const before = JSON.stringify(state.currentDistrict);
		const storedBefore = localStorage.getItem('kogai_district_v2');
		document.getElementById('d-paste-box').value = text;
		await district.loadPastedTextToDistrict();
		assert.equal(JSON.stringify(state.currentDistrict), before, 'Pasted district import keeps the state');
		assert.equal(localStorage.getItem('kogai_district_v2'), storedBefore);
		assert.match(io.alerts.at(-1), /児童「児童 一」の学年「7」は1〜6年ではありません/);
		document.getElementById('rep-pass').value = FILE_PASSWORD;
		const repBefore = JSON.stringify(state.repState);
		const repStored = localStorage.getItem('kogai_rep_v2');
		await rep.loadMultipleDistrictFiles({ target: { files: [{ name: '地区.txt', text: async () => text }], value: '地区.txt' } });
		assert.match(io.alerts.at(-1), /1〜6年ではありません/, 'Representative district import names the pupil');
		document.getElementById('rep-paste-box').value = await (await fileEvent({ districts: [data], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } })).target.files[0].text();
		await rep.loadPastedTextToRep();
		assert.match(io.alerts.at(-1), /1〜6年ではありません/, 'Representative master paste names the pupil');
		const master = await (await fileEvent({ districts: [data], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } })).target.files[0].text();
		await rep.loadRepMasterTxt({ target: { files: [{ name: 'master.txt', text: async () => master }], value: 'master.txt' } });
		assert.match(io.alerts.at(-1), /1〜6年ではありません/, 'Representative master file names the pupil');
		assert.equal(JSON.stringify(state.repState), repBefore, 'Representative state unchanged');
		assert.equal(localStorage.getItem('kogai_rep_v2'), repStored, 'Representative storage unchanged');
	}
	for (const grade of ['1', '6']) {
		fresh();
		const data = { district: '地区', officers: [], students: [{ grade, class: '1', lastName: '児童', firstName: '一' }], neighborhood: [] };
		assert.equal((await crypt.parseTxtContent(await (await fileEvent(data)).target.files[0].text(), FILE_PASSWORD, undefined, 'district')).students[0].grade, grade);
	}
	assert.doesNotThrow(() => utils.validateStoredData({ district: '旧', officers: [], students: [{ grade: '', lastName: '旧' }], neighborhood: [] }, 'kogai_district_v2'));
	assert.doesNotThrow(() => utils.validateImportData({ district: '旧', officers: [], students: [{ grade: '7' }], neighborhood: [] }, 'district'), 'Schema validation itself stays compatible');
});

test('QA-03: files produced by this app with blank placeholder rows (including an empty grade) can be re-imported', async () => {
	const io = fresh();
	await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
	const placeholder = { grade: '', class: '', han: '', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', leader: '', isOutOfDistrict: false };
	const data = { district: '地区', officers: [{ role: '校外委員', lastName: '再' }], neighborhood: [], students: [placeholder, { ...placeholder, grade: '6', class: '1' }, { grade: '2', class: '1', lastName: '実在', firstName: '児童' }] };
	assert.equal(await district.loadDistrictTxt(await fileEvent(data)), true);
	assert.deepEqual(state.currentDistrict.students.map(row => row.lastName), ['実在'], 'Blank placeholders are dropped on import');
	const master = { districts: [{ ...data, district: '代表地区' }], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	const parsed = await crypt.parseTxtContent(await (await fileEvent(master)).target.files[0].text(), FILE_PASSWORD, undefined, 'auto');
	assert.deepEqual(parsed.districts[0].students.map(row => row.lastName), ['実在']);
	const outOfDistrict = { ...placeholder, isOutOfDistrict: true };
	await assert.rejects(crypt.parseTxtContent(await (await fileEvent({ ...data, students: [outOfDistrict] })).target.files[0].text(), FILE_PASSWORD, undefined, 'district'), error => error.code === 'INVALID_IMPORT_GRADE', 'An out-of-district row is real data and needs a valid grade');
	assert.ok(io.alerts.some(message => /読み込みました/.test(message)));
});

test('QA-03: household transfer grades are limited to 1-6 for every version and version 1 blanks default to grade 1', async () => {
	const child = grade => ({ lastName: '転入', firstName: '児', address: '東1', tel: '0900000000', grade, className: '1' });
	for (const version of [undefined, 2]) {
		const base = { isTransferData: true, ...(version ? { version, address: '東1', tel: '0900000000' } : {}) };
		for (const grade of ['7', '0', '６']) {
			assert.throws(() => utils.validateImportData({ ...base, children: [child(grade)] }, 'transfer'), error => error.code === 'INVALID_IMPORT_GRADE' && error.message === `家庭情報の児童「転入 児」の学年「${grade}」は1〜6年ではありません。`, `v${version} rejects ${grade}`);
		}
		assert.doesNotThrow(() => utils.validateImportData({ ...base, children: [child('3')] }, 'transfer'));
	}
	const io = fresh();
	state.currentDistrict.students = [];
	const text = await (await fileEvent({ isTransferData: true, children: [child('')] })).target.files[0].text();
	await district.loadTransferFileIntoDistrict({ target: { files: [{ name: 't.txt', text: async () => text }], value: 't.txt' } });
	const added = state.currentDistrict.students.find(row => row.lastName === '転入');
	assert.ok(added, `Version 1 transfer integrated: ${JSON.stringify(io.alerts)}`);
	assert.equal(added.grade, '1', 'A version 1 blank grade becomes grade 1');
});

test('QA-03: household transfer grade violations are reported by child without asking for the password again', async () => {
	const transfer = { isTransferData: true, version: 2, address: '東1', tel: '0900000000', children: [{ lastName: '転入', firstName: '七年', address: '東1', tel: '0900000000', grade: '7', className: '1' }] };
	const text = await (await fileEvent(transfer)).target.files[0].text();
	const loaders = [
		['district file', () => district.loadTransferFileIntoDistrict({ target: { files: [{ name: 't.txt', text: async () => text }], value: 't.txt' } })],
		['district paste', () => { document.getElementById('d-transfer-paste-box').value = text; return district.loadPastedTransferTextIntoDistrict(); }],
		['rep file', () => rep.loadTransferFileIntoRep({ target: { files: [{ name: 't.txt', text: async () => text }], value: 't.txt' } })],
		['rep paste', () => { document.getElementById('rep-transfer-paste-box').value = text; return rep.loadPastedTransferTextIntoRep(); }]
	];
	for (const [label, load] of loaders) {
		const io = fresh();
		document.getElementById('rep-pass').value = FILE_PASSWORD;
		let prompts = 0;
		const originalPrompt = global.safePrompt;
		global.safePrompt = () => { prompts++; return FILE_PASSWORD; };
		try {
			await load();
		} finally { global.safePrompt = originalPrompt; }
		assert.equal(prompts, 0, `${label}: no password prompt`);
		assert.equal(io.alerts.length, 1, label);
		assert.match(io.alerts[0], /家庭情報の児童「転入 七年」の学年「7」は1〜6年ではありません/, label);
		assert.doesNotMatch(io.alerts[0], /パスワード/, label);
	}
});

test('QA-02: pupil addition drops blank placeholder rows, keeps filled rows and reports the counts', async () => {
	const io = fresh();
	await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
	state.currentDistrict.students = [
		{ grade: '6', class: '1', han: '1班', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', leader: '', isOutOfDistrict: false },
		{ grade: '2', class: '1', han: '1班', lastName: ' ', firstName: '', isOutOfDistrict: true },
		{ grade: '3', class: '1', han: '1班', lastName: '既存', firstName: '児童' }
	];
	const added = { district: '地区', officers: [], neighborhood: [], students: [{ grade: '1', class: '2', lastName: '新', firstName: '一年' }, { grade: '4', class: '1', lastName: '新', firstName: '四年' }] };
	assert.equal(await district.loadDistrictStudentsTxt(await fileEvent(added)), true);
	assert.deepEqual(state.currentDistrict.students.map(row => `${row.grade}:${row.lastName}${row.firstName}`), ['2: ', '3:既存児童', '1:新一年', '4:新四年']);
	assert.match(io.confirms.at(-1), /児童2名を既存の児童名簿へ追加します/);
	assert.match(io.alerts.at(-1), /児童2名を追加しました/);
	crypt.lockStorage();
	await crypt.unlockStorageWithPassword(DEVICE_PASSWORD);
	await app.loadAppDataFromStorage();
	assert.equal(state.currentDistrict.students.length, 4);
});

test('QA-02: pupil addition failure notifications use the documented wording', async () => {
	const io = fresh();
	await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
	const data = { district: '地区', officers: [], neighborhood: [], students: [{ grade: '1', class: '1', lastName: '誤', firstName: '鍵' }] };
	assert.equal(await district.loadDistrictStudentsTxt(await fileEvent(data, 'OtherPassword123!')), false);
	assert.equal(io.alerts.length, 1);
	assert.match(io.alerts[0], /児童名簿の追加に失敗しました/);
	assert.equal(await district.loadDistrictStudentsTxt(await fileEvent({ ...data, students: [] })), false);
	assert.equal(io.alerts.length, 2);
});

test('QA-04: long district LINE/mail sharing never opens an external app when the clipboard copy fails', async () => {
	for (const channel of ['line', 'email']) for (const unavailable of [false, true]) {
		const io = fresh();
		global.encryptPayload = async () => 'ENC:2:' + 'a'.repeat(3000);
		Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: unavailable ? undefined : { writeText: async () => { throw new Error('denied'); } } });
		try {
			assert.equal(await district.shareDistrictData(channel), false);
			assert.deepEqual(io.opened, []);
			assert.equal(io.alerts.length, 1);
			assert.match(io.alerts[0], /クリップボード/);
			navigator.clipboard = { writeText: async text => { io.copied.push(text); } };
			await district.shareDistrictData(channel);
			assert.equal(io.opened.length, 1, 'Retry after a successful copy opens the app once');
			assert.doesNotMatch(io.opened[0], /BEGIN_DATA/);
			assert.ok(io.copied[0].includes('BEGIN_DATA:'));
		} finally { global.encryptPayload = originalEncryptPayload; }
	}
});

test('QA-04: a lock during the long-share copy suppresses both the app launch and the failure notice', async () => {
	const io = fresh();
	await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
	global.encryptPayload = async () => 'ENC:2:' + 'a'.repeat(3000);
	Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: { writeText: async () => { crypt.lockStorage(); throw new Error('denied'); } } });
	try {
		assert.equal(await district.shareDistrictData('line'), false);
		assert.deepEqual(io.opened, []);
		assert.deepEqual(io.alerts, []);
	} finally { global.encryptPayload = originalEncryptPayload; }
});

test('QA-08: representative single-district copy reports a missing clipboard API', async () => {
	const io = fresh();
	state.repState.districts = [structuredClone(state.currentDistrict)];
	Object.defineProperty(navigator, 'clipboard', { configurable: true, writable: true, value: undefined });
	assert.equal(await rep.exportSingleDistrictFromRep(0, FILE_PASSWORD, 'copy'), false);
	assert.equal(io.alerts.length, 1);
	assert.match(io.alerts[0], /クリップボード/);
});

test('QA-05: output dates use the local calendar day even shortly after local midnight', async t => {
	const originalTz = process.env.TZ;
	process.env.TZ = 'Asia/Tokyo';
	try {
		assert.equal(utils.formatLocalDateStamp(new Date('2026-11-18T15:30:00Z')), '2026-11-19', '00:30 JST is the 19th locally');
		assert.equal(utils.formatLocalDateStamp(new Date('2026-01-04T23:59:00Z')), '2026-01-05');
		assert.equal(utils.formatLocalDateStamp(new Date('2026-12-31T14:59:59Z')), '2026-12-31');
		assert.equal(utils.formatLocalDateStamp(new Date('2026-12-31T15:00:00Z')), '2027-01-01', 'Year boundary in local time');
		const io = fresh();
		await crypt.setupStorageEncryption(DEVICE_PASSWORD, false);
		state.neighborState = { district: '日付自治会', neighborhood: [{ role: '会長', lastName: '日' }] };
		renderNeighborForm();
		state.repState.districts = [structuredClone(state.currentDistrict)];
		for (const id of ['neighbor-pass', 'neighbor-pass-confirm', 'rep-pass', 'rep-pass-confirm']) document.getElementById(id).value = FILE_PASSWORD;
		t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-18T15:30:00Z') });
		await district.exportDistrictTxt();
		await exportNeighborTxt();
		await rep.exportRepMasterTxt();
		await rep.exportSingleDistrictFromRep(0, FILE_PASSWORD, 'download');
		assert.equal(io.downloads.length, 4, JSON.stringify(io.alerts));
		for (const download of io.downloads) {
			assert.match(download.filename, /_2026-11-19\.txt$/, download.filename);
			assert.match(download.content, /出力日:2026-11-19/, download.filename);
		}
		assert.equal(hata.getHataFilenameDate({}), '20261119', 'Hata PDF names use the local date');
		assert.equal(hata.getHataFilenameDate({ createdDate: '作成日：2026年4月1日' }), '20260401');
	} finally {
		t.mock.timers.reset();
		if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
	}
});

test('QA-06: overlong legacy alias keys and formats are recovered as drafts instead of blocking unlock', () => {
	const base = { district: '旧', officers: [], students: [], neighborhood: [] };
	const original = { ...base, hata: { metaHeaderMsg: 'あ'.repeat(4097), scheduleTitle: 'い'.repeat(5000), metaCreatedDate: 'う'.repeat(4097), format: 'え'.repeat(4097), metaFooterMsg: '短い旧値' } };
	const snapshot = JSON.stringify(original);
	const clean = utils.validateStoredData(original, 'kogai_district_v2');
	assert.equal(JSON.stringify(original), snapshot, 'The stored original is not mutated');
	assert.equal(clean.hata.inputDrafts.headerMsg.length, 4097);
	assert.equal(clean.hata.inputDrafts.title.length, 5000);
	assert.equal(clean.hata.inputDrafts.createdDate.length, 4097);
	assert.equal(clean.hata.inputDrafts.format.length, 4097);
	assert.equal(clean.hata.format, '');
	for (const alias of ['metaHeaderMsg', 'scheduleTitle', 'metaCreatedDate']) assert.equal(Object.hasOwn(clean.hata, alias), false);
	assert.equal(clean.hata.metaFooterMsg, '短い旧値', 'Short legacy aliases are kept');
	const explicit = utils.validateStoredData({ ...base, hata: { metaHeaderMsg: 'あ'.repeat(4097), inputDrafts: { headerMsg: '明示下書き' } } }, 'kogai_district_v2');
	assert.equal(explicit.hata.inputDrafts.headerMsg, '明示下書き', 'Explicit drafts win over recovered legacy text');
	const canonical = utils.validateStoredData({ ...base, hata: { headerMsg: '正式', metaHeaderMsg: 'あ'.repeat(4097) } }, 'kogai_district_v2');
	assert.equal(canonical.hata.headerMsg, '正式', 'A defined canonical value stays effective');
	assert.equal(canonical.hata.inputDrafts, undefined, 'The ignored alias is not drafted');
	assert.equal(Object.hasOwn(canonical.hata, 'metaHeaderMsg'), false, 'The overlong alias is removed');
	const created = utils.validateStoredData({ ...base, hata: { metaCreatedDate: 'め'.repeat(4097), scheduleCreatedDate: 'す'.repeat(4098) } }, 'kogai_district_v2');
	assert.equal(created.hata.inputDrafts.createdDate, 'め'.repeat(4097), 'metaCreatedDate wins over scheduleCreatedDate');
	assert.equal(Object.hasOwn(created.hata, 'scheduleCreatedDate'), false);
	assert.throws(() => utils.validateStoredData({ ...base, hata: { metaHeaderMsg: 1 } }, 'kogai_district_v2'), /フォーマット/);
	assert.throws(() => utils.validateImportData({ ...base, hata: { metaHeaderMsg: 'あ'.repeat(4097) } }, 'district'), /フォーマット/, 'Imports stay strict');
});

test('QA-07: holiday and special-slot notes keep commas after the first separator', () => {
	const schedule = hata.generateHataSchedule({
		startDate: '2026-05-01', endDate: '2026-05-05', weekdays: [0, 1, 2, 3, 4, 5, 6], members: 'A\nB',
		holidays: '2026-05-01,運動会,雨天延期\n2026-05-02', specials: '2026-05-04,C,地域行事,午前のみ\n2026-05-05,D'
	});
	const byDate = Object.fromEntries(schedule.map(row => [row.date, row]));
	assert.equal(byDate['2026-05-01'].note, '運動会,雨天延期');
	assert.equal(byDate['2026-05-02'].note, '祝日');
	assert.equal(byDate['2026-05-04'].person, 'C');
	assert.equal(byDate['2026-05-04'].note, '地域行事,午前のみ');
	assert.equal(byDate['2026-05-05'].note, '特別枠');
	// 300日 × (担当1 + 注記 + 32) の見積もり。最初のカンマまでの「短」だけなら上限内、再結合した注記なら1MiB超となる。
	const period = { startDate: '2026-05-01', endDate: '2027-02-24', weekdays: [0, 1, 2, 3, 4, 5, 6], members: 'A', specials: '' };
	const overNote = '短,' + '記'.repeat(1300);
	assert.ok(`2026-05-01,${overNote}`.length <= 4096, 'Each line stays within 4096 characters');
	assert.throws(() => utils.validateHataTextBudget({ ...period, holidays: `2026-05-01,${overNote}` }), /上限/, 'The budget estimate uses the rejoined holiday note');
	assert.throws(() => utils.validateHataTextBudget({ ...period, holidays: '', specials: `2026-05-01,担当,${overNote}` }), /上限/, 'The budget estimate uses the rejoined special note');
	const okNote = '短,' + '記'.repeat(1000);
	const config = { ...period, holidays: `2026-05-01,${okNote}` };
	assert.doesNotThrow(() => utils.validateHataTextBudget(config));
	assert.equal(hata.generateHataSchedule(config).find(row => row.date === '2026-05-01').note, okNote, 'Generation and budget agree on the rejoined note');
});

test('QA-09: the district file loader no longer reads the nonexistent #d-file-pass element', () => {
	assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../js/district.js'), 'utf8'), /d-file-pass/);
	assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'), /d-file-pass/);
});

test.after(() => {
	global.encryptPayload = originalEncryptPayload;
	global.downloadTextFile = originalDownload;
});
