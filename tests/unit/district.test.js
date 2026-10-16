const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockDistrict } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const districtLib = require('../../js/district.js');
const hata = require('../../js/hata.js');

test('district: renderDistrictForm and onHanListInput', () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();

	districtLib.renderDistrictForm();
	assert.strictEqual(document.getElementById('d-name').value, "1丁目");
	assert(document.getElementById('d-han-list').value.includes("1班"));

	// onHanListInput (update DOM input and call onHanListInput)
	const dHanListEl = document.getElementById('d-han-list');
	dHanListEl.value = "A班, B班, C班";
	districtLib.onHanListInput(dHanListEl.value);
	assert.deepStrictEqual(state.currentDistrict.hanList, ["A班", "B班", "C班"]);
	assert.strictEqual(state.currentDistrict.han, "A班");
});

test('district: officers management (render, add, remove)', () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();

	districtLib.renderOfficersList();
	const container = document.getElementById('officers-container');
	assert.strictEqual(container.children.length, 2);

	// Add officer
	districtLib.addOfficer();
	assert.strictEqual(state.currentDistrict.officers.length, 3);
	assert.strictEqual(container.children.length, 3);

	// Remove officer
	districtLib.removeOfficer(1);
	assert.strictEqual(state.currentDistrict.officers.length, 2);
	assert.strictEqual(container.children.length, 2);

	// Missing container branch
	document.elements['officers-container'] = null;
	districtLib.renderOfficersList();
});

test('district: neighborhood management (render, add, update, remove)', () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();

	districtLib.renderNeighborhoodTable();
	const tbody = document.getElementById('neighborhood-tbody');
	assert.strictEqual(tbody.children.length, 2);

	// Update field
	districtLib.updateN(0, 'tel', '03-9999-9999');
	assert.strictEqual(state.currentDistrict.neighborhood[0].tel, '03-9999-9999');

	// Add row
	districtLib.addNeighborhoodRow();
	assert.strictEqual(state.currentDistrict.neighborhood.length, 3);
	assert.strictEqual(tbody.children.length, 3);

	// Remove row
	districtLib.removeN(0);
	assert.strictEqual(state.currentDistrict.neighborhood.length, 2);
	assert.strictEqual(tbody.children.length, 2);

	// Missing tbody branch
	document.elements['neighborhood-tbody'] = null;
	districtLib.renderNeighborhoodTable();
});

test('district: students management (render, add, update, remove, sort, summary)', () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();

	districtLib.renderStudentsTable();
	const tbody = document.getElementById('students-tbody');
	assert.strictEqual(tbody.children.length, 4);

	// Update field
	districtLib.updateS(0, 'isOutOfDistrict', true);
	assert.strictEqual(state.currentDistrict.students[0].isOutOfDistrict, true);

	// Add student (should auto-inherit last student han)
	districtLib.addStudentRow();
	assert.strictEqual(state.currentDistrict.students.length, 5);
	assert.strictEqual(state.currentDistrict.students[4].han, "2班");

	// Add student when empty list
	state.currentDistrict.students = [];
	state.currentDistrict.han = "新班";
	districtLib.addStudentRow();
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.students[0].han, "新班");

	// Remove student
	districtLib.removeS(0);
	assert.strictEqual(state.currentDistrict.students.length, 0);

	// Sort students
	state.currentDistrict.students = [
		{ grade: "1", lastName: "B", han: "1班" },
		{ grade: "6", lastName: "A", han: "1班", leader: "班長" }
	];
	districtLib.sortStudentsDesc();
	assert.strictEqual(state.currentDistrict.students[0].lastName, "A", "Sorted leader and higher grade first");

	// Update summary text
	districtLib.updateStudentSummaryText();
	const summaryEl = document.getElementById('district-student-summary');
	assert(summaryEl.textContent.includes("6年：1名"));

	// Missing tbody and summary branches
	document.elements['students-tbody'] = null;
	document.elements['district-student-summary'] = null;
	districtLib.renderStudentsTable();
	districtLib.updateStudentSummaryText();
});

test('district: runDistrictYearUpdate handles cancellation and execution', () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();

	// Cancelled by user
	window.confirm = () => false;
	districtLib.runDistrictYearUpdate();
	assert.strictEqual(state.currentDistrict.officers.length, 2, "Officers should remain when cancelled");

	// Confirmed by user
	window.confirm = () => true;
	districtLib.runDistrictYearUpdate();
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood.length, 1); // Resets to 1 blank row for Chairman

	// 6th graders removed, 5th -> 6th, 4th -> 5th, 2nd -> 3rd
	const grades = state.currentDistrict.students.map(s => s.grade);
	assert(!grades.includes("7"), "No 7th graders");
	assert.deepStrictEqual(grades, ["6", "5", "3"], "Grades properly advanced");
});

test('district: validateDistrictPasswords shows matching and mismatch warnings', () => {
	setupDomEnvironment();
	const p1 = document.getElementById('d-pass');
	const p2 = document.getElementById('d-pass-confirm');
	const msg = document.getElementById('d-pass-match-msg');

	// Both empty
	p1.value = "";
	p2.value = "";
	districtLib.validateDistrictPasswords();
	assert.strictEqual(msg.textContent, "");

	// Invalid password
	p1.value = "short";
	districtLib.validateDistrictPasswords();
	assert(msg.textContent.includes("⚠"));

	// Valid password but missing confirm
	p1.value = "Pass12345678#$";
	p2.value = "";
	districtLib.validateDistrictPasswords();
	assert(msg.textContent.includes("確認用パスワードを入力してください"));

	// Mismatch
	p2.value = "DifferentPass123!";
	districtLib.validateDistrictPasswords();
	assert(msg.textContent.includes("パスワードが一致しません"));

	// Match
	p2.value = "Pass12345678#$";
	districtLib.validateDistrictPasswords();
	assert(msg.textContent.includes("パスワードが一致しました"));

	// Missing elements branch
	document.elements['d-pass'] = null;
	districtLib.validateDistrictPasswords();
});

test('district: exportDistrictTxt validates inputs and triggers file download', async () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();

	let alertMsg = "";
	window.alert = (msg) => { alertMsg = msg; };

	// 1. Missing district name
	state.currentDistrict.district = "";
	document.getElementById('d-name').value = "";
	await districtLib.exportDistrictTxt();
	assert(alertMsg.includes("地区名を入力してください"));

	// 2. Invalid password
	document.getElementById('d-name').value = "1丁目";
	state.currentDistrict.district = "1丁目";
	document.getElementById('d-pass').value = "short";
	await districtLib.exportDistrictTxt();
	assert(alertMsg.includes("保存パスワードエラー"));

	// 3. Password mismatch
	document.getElementById('d-pass').value = "Pass12345678#$";
	document.getElementById('d-pass-confirm').value = "Mismatch12345#";
	await districtLib.exportDistrictTxt();
	assert(alertMsg.includes("パスワード不一致エラー"));

	// 4. Success export
	document.getElementById('d-pass-confirm').value = "Pass12345678#$";
	let downloadedName = "";
	let downloadedContent = "";
	const origDownload = global.downloadTextFile;
	global.downloadTextFile = (content, filename) => {
		downloadedContent = content;
		downloadedName = filename;
	};

	await districtLib.exportDistrictTxt();
	assert(downloadedName.startsWith("校外地区データ_1丁目"));
	assert(downloadedContent.includes("BEGIN_DATA:"));
	assert(downloadedContent.includes(":END_DATA"));

	global.downloadTextFile = origDownload;
});

test('district: loadDistrictTxt handles file selection, decrypt failure, and success', async () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();

	let alertMsg = "";
	window.alert = (msg) => { alertMsg = msg; };

	// 1. No file selected
	await districtLib.loadDistrictTxt({ target: { files: [] } });

	// 2. Corrupted file / wrong password
	const badFile = {
		text: async () => "CORRUPTED CONTENT"
	};
	document.getElementById('d-pass').value = "Pass12345678#$";
	await districtLib.loadDistrictTxt({ target: { files: [badFile], value: "foo" } });
	assert(alertMsg.includes("読み込みに失敗しました"));

	// 3. Valid encrypted file
	const targetData = createMockDistrict({ district: "栄町", han: "南班", hanList: ["南班"] });
	const enc = await cryptoLib.encryptPayload(JSON.stringify(targetData), "Pass12345678#$");
	const goodFile = {
		text: async () => `BEGIN_DATA:\n${enc}\n:END_DATA`
	};
	const targetObj = { files: [goodFile], value: "bar" };
	await districtLib.loadDistrictTxt({ target: targetObj });
	assert.strictEqual(state.currentDistrict.district, "栄町");
	assert.strictEqual(state.currentDistrict.han, "南班");
	assert(alertMsg.includes("栄町"));
	assert.strictEqual(targetObj.value, "");
});

test('district: toggleCard and setAllCardsCollapse manage card collapsed state', () => {
	setupDomEnvironment();
	const card = document.createElement('div');
	card.className = 'card is-collapsed';
	const btn = document.createElement('span');
	btn.className = 'btn-card-toggle';
	card.appendChild(btn);

	// Toggle card open
	districtLib.toggleCard(card);
	assert(!card.classList.contains('is-collapsed'));
	assert.strictEqual(btn.textContent, '▲ 閉じる');

	// Toggle card close
	districtLib.toggleCard(card);
	assert(card.classList.contains('is-collapsed'));
	assert.strictEqual(btn.textContent, '▼ 開く');

	// toggleCard null safety
	districtLib.toggleCard(null);

	// setAllCardsCollapse
	const container = document.getElementById('tab-district');
	container.appendChild(card);
	districtLib.setAllCardsCollapse(false, 'tab-district');
	assert(!card.classList.contains('is-collapsed'));
	assert.strictEqual(btn.textContent, '▲ 閉じる');

	districtLib.setAllCardsCollapse(true, 'tab-district');
	assert(card.classList.contains('is-collapsed'));
	assert.strictEqual(btn.textContent, '▼ 開く');

	// Missing container safety
	districtLib.setAllCardsCollapse(true, 'nonexistent-container');
});

test('district: additional branch coverage tests for officers and legacy import', async () => {
	setupDomEnvironment();
	let alertMsg = "";
	window.alert = (msg) => { alertMsg = msg; };

	// 1. removeOfficer when length <= 1
	state.currentDistrict = createMockDistrict();
	state.currentDistrict.officers = [state.currentDistrict.officers[0]];
	districtLib.removeOfficer(0);
	assert(alertMsg.includes("校外役員は最低1名の登録が必要です"));

	// 2. renderOfficersList with missing officers array
	state.currentDistrict.officers = null;
	delete state.currentDistrict.officer;
	districtLib.renderOfficersList();
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.officers[0].lastName, "");

	// 3. loadDistrictTxt with legacy data without officers array
	const legacyDistrict = {
		district: "旧地区",
		han: "東班",
		officer: { lastName: "古川", firstName: "一郎" },
		neighborhood: [],
		students: []
	};
	const enc = await cryptoLib.encryptPayload(JSON.stringify(legacyDistrict), "Pass12345678#$");
	document.getElementById('d-pass').value = "Pass12345678#$";
	await districtLib.loadDistrictTxt({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${enc}\n:END_DATA` }],
			value: "test"
		}
	});
	assert.strictEqual(state.currentDistrict.district, "旧地区");
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.officers[0].lastName, "古川");
});

test('district: exhaustive branch coverage for roles, leaders, han variants and child grades', () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict({
		district: "ブランチ網羅地区",
		hanList: ["1班", "2班"],
		han: "1班"
	});

	// 1. renderOfficersList with han variants and role '校外委員'
	state.currentDistrict.officers = [
		{
			role: "校外委員",
			han: "全班",
			lastName: "委員",
			firstName: "A",
			childGrade: "1"
		},
		{
			role: "",
			han: "リスト外班",
			lastName: "委員",
			firstName: "B",
			childGrade: "6"
		}
	];
	districtLib.renderOfficersList();
	const container = document.getElementById('officers-container');
	assert(container.innerHTML.includes("全班"));
	assert(container.innerHTML.includes("リスト外班"));

	// 2. removeOfficer cancelled with confirm returning false
	global.confirm = () => false;
	districtLib.removeOfficer(1);
	assert.strictEqual(state.currentDistrict.officers.length, 2);

	// 3. renderStudentsTable with leader 'リーダー' and 'サブリーダー', grade variations, and out-of-list han
	state.currentDistrict.students = [
		{
			grade: "6",
			class: "1",
			han: "リスト外児童班",
			lastName: "田中",
			firstName: "勇",
			leader: "リーダー",
			isOutOfDistrict: true
		},
		{
			grade: "2",
			class: "2",
			han: "",
			lastName: "佐藤",
			firstName: "愛",
			leader: "サブリーダー",
			isOutOfDistrict: false
		}
	];
	districtLib.renderStudentsTable();
	const sTbody = document.getElementById('students-tbody');
	assert(sTbody.innerHTML.includes("リスト外児童班"));
	assert(sTbody.innerHTML.includes("班長"));
	assert(sTbody.innerHTML.includes("副班長"));

	// 4. addStudentRow when last student has empty han string
	districtLib.addStudentRow();
	assert.strictEqual(state.currentDistrict.students.length, 3);
	assert.strictEqual(state.currentDistrict.students[2].han, "1班");

	// addStudentRow when students is empty and hanList is empty
	state.currentDistrict.students = [];
	state.currentDistrict.officers = [{ han: "" }];
	state.currentDistrict.hanList = [];
	state.currentDistrict.han = "";
	districtLib.addStudentRow();
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.students[0].han, "");
});

test('district: loadPastedNeighborTextIntoDistrict handles empty, password prompt, and success', async () => {
	setupDomEnvironment();
	const pass = "ValidPass123!@#";
	state.currentDistrict.district = "町内会A";
	state.currentDistrict.neighborhood = [];

	// 1. Missing box or empty content
	document.elements['d-neighbor-paste-box'] = null;
	await districtLib.loadPastedNeighborTextIntoDistrict();

	setupDomEnvironment();
	document.getElementById('d-neighbor-paste-box').value = "   ";
	await districtLib.loadPastedNeighborTextIntoDistrict();

	// 2. Valid encrypted text with password in d-pass
	const encNeighbor = await cryptoLib.encryptPayload(JSON.stringify({
		district: "町内会A",
		neighborhood: [{ role: "会長", lastName: "山", firstName: "田" }]
	}), pass);
	document.getElementById('d-pass').value = pass;
	document.getElementById('d-neighbor-paste-box').value = `BEGIN_DATA:\n${encNeighbor}\n:END_DATA`;
	await districtLib.loadPastedNeighborTextIntoDistrict();
	assert.strictEqual(state.currentDistrict.neighborhood.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, "山");

	// 3. Password mismatch prompts user: user cancels
	document.getElementById('d-pass').value = "WrongPassword123!";
	document.getElementById('d-neighbor-paste-box').value = `BEGIN_DATA:\n${encNeighbor}\n:END_DATA`;
	global.prompt = () => null;
	await districtLib.loadPastedNeighborTextIntoDistrict();

	// 4. Password mismatch prompts user: user enters valid password
	global.prompt = () => pass;
	document.getElementById('d-neighbor-paste-box').value = `BEGIN_DATA:\n${encNeighbor}\n:END_DATA`;
	await districtLib.loadPastedNeighborTextIntoDistrict();
	assert.strictEqual(state.currentDistrict.neighborhood.length, 1);

	// 5. Corrupt text triggers catch alert
	document.getElementById('d-neighbor-paste-box').value = "CORRUPT_ENCRYPTED_TEXT";
	await districtLib.loadPastedNeighborTextIntoDistrict();
});

