const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
require('../../js/utils');
const crypt = require('../../js/crypto');
const state = require('../../js/state');
require('../../js/hata'); require('../../js/seat');
const district = require('../../js/district');
const password = 'Submission123!';
function fresh() {
	setupDomEnvironment();
	state.currentDistrict = { district: '地区', han: '1班', hanList: ['1班'], officers: [{ lastName: '次年度', firstName: '役員' }], neighborhood: [{ lastName: '維持', role: '会長' }], students: [], hata: { title: '維持するシフト', members: '', holidays: '' }, savedFilePassword: password };
	renderDistrictForm();
	document.getElementById('d-pass').value = password;
	global.confirm = () => true;
}
async function eventFor(data, pass = password) {
	const cipher = await crypt.encryptPayload(JSON.stringify(data), pass);
	return { target: { files: [{ name: '名簿.txt', text: async () => cipher }], value: '名簿.txt' } };
}
const roster = () => ({ district: '地区', officers: [{ lastName: '前年度', firstName: '役員' }], neighborhood: [{ lastName: '前年度自治会' }], students: [{ lastName: '佐藤', firstName: '花', grade: '6', class: '2', han: '2班', leader: '班長', isOutOfDistrict: true }], hata: { title: '取り込まないシフト' } });

test('next year: officers-only district file without students is loaded as a district', async () => {
	fresh();
	await district.loadDistrictTxt(await eventFor({ district: '地区', officers: [{ lastName: '新しい', firstName: '役員' }], neighborhood: [] }));
	assert.equal(state.currentDistrict.officers[0].lastName, '新しい');
	assert.equal(state.currentDistrict.students.length, 0);
});

test('next year: student-only addition preserves every other section and does not advance grades or discard year-six pupils', async () => {
	fresh();
	await crypt.setupStorageEncryption('DatabasePassword1!');
	state.currentDistrict.students.push({ lastName: '既存', firstName: '児童', lastNameKana: 'きぞん', firstNameKana: 'じどう', grade: '1' });
	const before = structuredClone(state.currentDistrict);
	const ev = await eventFor(roster());
	assert.equal(await district.loadDistrictStudentsTxt(ev), true);
	assert.equal(ev.target.value, '');
	const { students, ...rest } = state.currentDistrict;
	const { students: oldStudents, ...oldRest } = before;
	assert.deepEqual(rest, oldRest);
	assert.deepEqual(students[0], oldStudents[0]);
	assert.equal(students[1].grade, '6');
	assert.equal(students[1].leader, '班長');
	assert.equal(students[1].isOutOfDistrict, true);
	assert.equal((await crypt.loadStorageDecrypted('kogai_district_v2')).students.length, 2);
});

test('next year: cancellation and malformed or empty rosters leave the model, DOM and storage intact', async () => {
	for (const [index, data] of [roster(), { district: '地区', students: [] }, { district: '地区', students: [null] }, { districts: [] }, { district: '地区', districts: [], students: roster().students }, { district: '地区', isNeighborhoodData: true, students: roster().students }, { district: '地区', isTransferData: true, students: roster().students }].entries()) {
		fresh();
		await saveDistrictLocal();
		const before = JSON.stringify(state.currentDistrict), raw = localStorage.getItem('kogai_district_v2');
		let confirms = 0;
		global.confirm = () => { confirms++; return false; };
		const ev = await eventFor(data);
		assert.equal(await district.loadDistrictStudentsTxt(ev), false);
		assert.equal(JSON.stringify(state.currentDistrict), before);
		assert.equal(localStorage.getItem('kogai_district_v2'), raw);
		assert.equal(confirms, index === 0 ? 1 : 0, 'Invalid input is rejected before asking to commit');
		assert.equal(document.getElementById('d-name').value, '地区');
		assert.equal(ev.target.value, '');
	}
});

test('next year: district mismatch and possible duplicates are disclosed before the entire addition', async () => {
	fresh();
	state.currentDistrict.students = structuredClone(roster().students);
	const data = roster(); data.district = '別地区';
	const confirms = [];
	global.confirm = text => { confirms.push(text); return true; };
	assert.equal(await district.loadDistrictStudentsTxt(await eventFor(data)), true);
	assert.equal(confirms.length, 1);
	assert.match(confirms[0], /別地区/);
	assert.match(confirms[0], /重複/);
	assert.equal(state.currentDistrict.district, '地区');
	assert.equal(state.currentDistrict.students.length, 2);
});

test('next year: file read lock and persistence failure cannot overwrite existing officers or students', async () => {
	for (const lock of [false, true]) {
		fresh();
		await crypt.setupStorageEncryption('DatabasePassword1!');
		const before = JSON.stringify(state.currentDistrict), raw = localStorage.getItem('kogai_district_v2');
		const ev = await eventFor(roster());
		const alerts = []; global.alert = text => alerts.push(text);
		if (lock) ev.target.files[0].text = async () => { crypt.lockStorage(); return ''; };
		else {
			const set = localStorage.setItem.bind(localStorage);
			localStorage.setItem = (key, value) => { if (key === 'kogai_district_v2') throw new Error('quota'); set(key, value); };
		}
		assert.equal(await district.loadDistrictStudentsTxt(ev), false);
		assert.equal(JSON.stringify(state.currentDistrict), before);
		assert.equal(localStorage.getItem('kogai_district_v2'), raw);
		assert.equal(alerts.length, lock ? 0 : 1);
	}
});

test('next year: no selection, wrong password and combined row overflow cannot change existing data', async () => {
	fresh();
	assert.equal(await district.loadDistrictStudentsTxt({ target: { files: [] } }), false);
	const source = await eventFor(roster(), 'DifferentPassword1!');
	const before = JSON.stringify(state.currentDistrict);
	assert.equal(await district.loadDistrictStudentsTxt(source), false);
	assert.equal(JSON.stringify(state.currentDistrict), before);
	assert.equal(source.target.value, '');
	state.currentDistrict.students = Array.from({ length: 10000 }, () => ({ lastName: '既存', firstName: '児童', grade: '1' }));
	const full = JSON.stringify(state.currentDistrict);
	assert.equal(await district.loadDistrictStudentsTxt(await eventFor(roster())), false);
	assert.equal(JSON.stringify(state.currentDistrict), full);
});

test('next year: a locked session rejects before reading the file or notifying', async () => {
	fresh();
	await crypt.setupStorageEncryption('DatabasePassword1!');
	crypt.lockStorage();
	let reads = 0;
	const alerts = []; global.alert = value => alerts.push(value);
	const input = { files: [{ text: async () => { reads++; return ''; } }], value: '名簿.txt' };
	assert.equal(await district.loadDistrictStudentsTxt({ target: input }), false);
	assert.equal(reads, 0);
	assert.deepEqual(alerts, []);
	assert.equal(input.value, '');
});

test('next year: legacy officer object is a district and same-name pupils within the incoming file are disclosed', async () => {
	fresh();
	const officers = { district: '地区', officer: { lastName: '次年度旧形式', firstName: '役員' }, neighborhood: [] };
	await district.loadDistrictTxt(await eventFor(officers));
	assert.equal(state.currentDistrict.officers[0].lastName, '次年度旧形式');
	const data = roster();
	data.students.push(structuredClone(data.students[0]));
	let message = '';
	global.confirm = text => { message = text; return false; };
	assert.equal(await district.loadDistrictStudentsTxt(await eventFor(data)), false);
	assert.match(message, /重複/);
});

test('next year: optional source han and empty district names preserve target metadata and normalize student defaults', async () => {
	for (const sourceHan of [undefined, '追加元の班']) for (const sourceDistrict of ['', '地区']) {
		fresh();
		state.currentDistrict.district = sourceDistrict ? '' : '保持する地区';
		delete state.currentDistrict.students;
		const ev = await eventFor({ district: sourceDistrict, han: sourceHan, students: [{ lastName: '追加', firstName: '児童', grade: '2', class: '未定' }] });
		const targetDistrict = state.currentDistrict.district;
		assert.equal(await district.loadDistrictStudentsTxt(ev), true);
		assert.equal(state.currentDistrict.district, targetDistrict);
		assert.equal(state.currentDistrict.students[0].han, sourceHan || '');
		assert.equal(state.currentDistrict.students[0].isOutOfDistrict, false);
		assert.equal(state.currentDistrict.students[0].class, '未定');
	}
});

test('next year: blank password and read failures after lock or authentication deletion cannot produce stale notifications', async () => {
	fresh();
	document.getElementById('d-pass').value = '';
	const before = JSON.stringify(state.currentDistrict);
	assert.equal(await district.loadDistrictStudentsTxt(await eventFor(roster())), false);
	assert.equal(JSON.stringify(state.currentDistrict), before);
	for (const removeAuth of [false, true]) {
		fresh();
		await crypt.setupStorageEncryption('DatabasePassword1!');
		const stored = localStorage.getItem('kogai_district_v2');
		const alerts = []; global.alert = text => alerts.push(text);
		const ev = { target: { files: [{ text: async () => {
			if (removeAuth) localStorage.removeItem('kogai_auth_meta');
			else crypt.lockStorage();
			throw new Error('late file read failure');
		} }], value: '名簿.txt' } };
		assert.equal(await district.loadDistrictStudentsTxt(ev), false);
		assert.deepEqual(alerts, []);
		assert.equal(localStorage.getItem('kogai_district_v2'), stored);
	}
});
