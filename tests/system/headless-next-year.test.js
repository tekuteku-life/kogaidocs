const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

test('UI text recovery: oversize header is a complete draft, survives lock and repairs without losing the roster', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		await ui.click('#card-d-hata details summary');
		for (const id of ['hata-time', 'hata-header-msg', 'hata-footer-msg']) assert.strictEqual(document.getElementById(id).maxLength, 4096);
		ui.fill('#hata-header-msg', 'あ'.repeat(4097));
		assert.strictEqual(currentDistrict.hata.inputDrafts.headerMsg.length, 4097);
		assert.strictEqual(await saveDistrictLocal(), true);
		handleImmediateLock();
		await unlockStorageWithPassword('UiPassword1!'); await loadAppDataFromStorage();
		renderDistrictForm(); updateOfficerAccess();
		assert.strictEqual(document.getElementById('hata-header-msg').value.length, 4097);
		assert.strictEqual(ensureHataInputsReady(), false);
		ui.fill('#hata-header-msg', '修正済み');
		assert.strictEqual(currentDistrict.hata.inputDrafts, undefined);
		await saveDistrictLocal(); lockStorage();
		await unlockStorageWithPassword('UiPassword1!'); await loadAppDataFromStorage();
		assert.strictEqual(currentDistrict.hata.headerMsg, '修正済み');
	});
	assert.equal(result.success, true, JSON.stringify(result.fatal));
	assert.deepEqual(result.errors, []);
});

test('UI next year: officers file then student addition retains next officers through encrypted output and actual restart', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-pass', 'Submission123!'); ui.fill('#d-pass-confirm', 'Submission123!');
		const track = name => {
			const original = window[name];
			window[name] = (...args) => { window.__rosterTask = Promise.resolve(original(...args)); return window.__rosterTask; };
		};
		track('loadDistrictTxt');
		const officers = { district: '次年度地区', han: '1班', hanList: ['1班'], officers: [{ lastName: '次年度', firstName: '役員' }], neighborhood: [] };
		await ui.file('#d-file-in', await encryptPayload(JSON.stringify(officers), 'Submission123!'));
		await window.__rosterTask;
		assert.strictEqual(currentDistrict.officers[0].lastName, '次年度');
		assert.strictEqual(currentDistrict.students.length, 0);
		const roster = { district: '次年度地区', officers: [{ lastName: '前年度', firstName: '役員' }], students: [{ grade: '6', class: '2', han: '1班', lastName: '児童', firstName: '六年', leader: '班長', isOutOfDistrict: true }] };
		track('loadDistrictStudentsTxt');
		await ui.file('#d-students-file-in', await encryptPayload(JSON.stringify(roster), 'Submission123!'));
		await window.__rosterTask;
		assert.strictEqual(currentDistrict.officers[0].lastName, '次年度');
		assert.strictEqual(currentDistrict.students.length, 1);
		assert.strictEqual(currentDistrict.students[0].grade, '6');
		assert.strictEqual(currentDistrict.students[0].leader, '班長');
		assert.strictEqual(currentDistrict.students[0].isOutOfDistrict, true);
		const beforeCancel = JSON.stringify(currentDistrict);
		window.__confirmAnswer = false;
		await ui.file('#d-students-file-in', await encryptPayload(JSON.stringify(roster), 'Submission123!'));
		await window.__rosterTask;
		assert.strictEqual(JSON.stringify(currentDistrict), beforeCancel);
		assert.strictEqual(document.getElementById('d-students-file-in').value, '');
		window.__confirmAnswer = true;
		assert.ok(document.getElementById('students-tbody').textContent.includes('六年') || document.querySelector('#students-tbody [data-field="firstName"]').value === '六年');
		ui.captureDownloads();
		await exportDistrictTxt();
		const exported = await parseTxtContent(__downloads[0].content, 'Submission123!');
		assert.strictEqual(exported.officers[0].lastName, '次年度');
		assert.strictEqual(exported.students[0].grade, '6');
		await saveDistrictLocal();
	}, { afterReload: async () => {
		assert.strictEqual(currentDistrict.officers[0].lastName, '次年度');
		assert.strictEqual(currentDistrict.students.length, 1);
		assert.strictEqual(currentDistrict.students[0].grade, '6');
	} });
	assert.equal(result.success, true, JSON.stringify(result.fatal));
	assert.deepEqual(result.errors, []);
});

test('UI legacy text: previously saved long footer unlocks after actual restart with complete repairable draft', async () => {
	const result = await runInHeadlessChrome(async () => {
		currentDistrict.hata.footerMsg = '旧'.repeat(4097);
		await saveStorageData('kogai_district_v2', currentDistrict);
	}, { afterReload: async () => {
		await ui.mode('district'); await ui.expand('district');
		assert.strictEqual(isStorageUnlocked(), true);
		assert.strictEqual(currentDistrict.hata.inputDrafts.footerMsg.length, 4097);
		assert.strictEqual(document.getElementById('hata-footer-msg').value.length, 4097);
	} });
	assert.equal(result.success, true, JSON.stringify(result.fatal));
	assert.deepEqual(result.errors, []);
});
