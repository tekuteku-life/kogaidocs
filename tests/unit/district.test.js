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

test('district: secure password persistence and auto-fill lifecycle', async () => {
	setupDomEnvironment();
	// 1. Storage is encrypted and opt-in checked -> savedFilePassword kept
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	const passInput = document.getElementById('d-pass');
	const confirmInput = document.getElementById('d-pass-confirm');
	const optinInput = document.getElementById('d-save-password-optin');
	passInput.value = 'MyPassword123!';
	confirmInput.value = 'MyPassword123!';
	optinInput.checked = true;

	// When saving district
	state.currentDistrict.district = 'テスト地区';
	state.saveDistrictLocal();
	assert.strictEqual(state.currentDistrict.savedFilePassword, 'MyPassword123!');

	// 2. Storage is unencrypted (Action Item A-2) -> savedFilePassword stripped
	localStorage.removeItem('kogai_auth_meta');
	state.currentDistrict.savedFilePassword = 'PlainSecret123!';
	optinInput.checked = true;
	state.saveDistrictLocal();
	assert.strictEqual(state.currentDistrict.savedFilePassword, undefined);

	// 3. Form rendering auto-populates savedFilePassword when present
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	state.currentDistrict.savedFilePassword = 'SavedPass456!';
	passInput.value = '';
	confirmInput.value = '';
	optinInput.checked = false;
	districtLib.renderDistrictForm();
	assert.strictEqual(passInput.value, 'SavedPass456!');
	assert.strictEqual(confirmInput.value, 'SavedPass456!');
	assert.strictEqual(optinInput.checked, true);

	// 4. Annual update clears saved password
	global.confirm = () => true;
	districtLib.runDistrictYearUpdate();
	assert.strictEqual(state.currentDistrict.savedFilePassword, undefined);
	assert.strictEqual(passInput.value, '');
	assert.strictEqual(confirmInput.value, '');
	assert.strictEqual(optinInput.checked, false);
});

test('district: shareDistrictData handles Web Share, LINE, Email, and Clipboard with URL length fallback', async () => {
	setupDomEnvironment();
	document.getElementById('d-name').value = '緑ヶ丘';
	const passInput = document.getElementById('d-pass');
	const confirmInput = document.getElementById('d-pass-confirm');
	passInput.value = 'TestPass1234!';
	confirmInput.value = 'TestPass1234!';
	state.currentDistrict.district = '緑ヶ丘';
	state.currentDistrict.students = [{ grade: '1', name: '生徒A' }];

	let sharedData = null;
	navigator.share = async (d) => { sharedData = d; };
	let clipData = '';
	navigator.clipboard = {
		writeText: async (t) => { clipData = t; }
	};
	let alertMsg = '';
	global.alert = (m) => { alertMsg = m; };

	// Validation failure: weak password
	passInput.value = 'short';
	confirmInput.value = 'short';
	await districtLib.shareDistrictData('copy');
	assert(alertMsg.includes('保存パスワードエラー'));

	// Validation failure: mismatched password
	passInput.value = 'TestPass1234!';
	confirmInput.value = 'DifferentPass!';
	await districtLib.shareDistrictData('copy');
	assert(alertMsg.includes('パスワード不一致エラー'));
	assert.strictEqual(clipData, ''); // aborted

	// Fix password
	confirmInput.value = 'TestPass1234!';

	// 1. Channel 'share' with canShare files support
	global.File = class File {
		constructor(bits, name, opts) {
			this.bits = bits;
			this.name = name;
			this.opts = opts;
		}
	};
	navigator.canShare = (data) => Boolean(data && data.files);
	await districtLib.shareDistrictData('share');
	assert(sharedData !== null);
	assert(Array.isArray(sharedData.files));

	// 1b. Channel 'share' with AbortError (user cancelled)
	navigator.share = async () => {
		const err = new Error('Cancelled');
		err.name = 'AbortError';
		throw err;
	};
	await districtLib.shareDistrictData('share'); // should return silently

	// 1c. Channel 'share' error falls back to clipboard
	navigator.share = async () => {
		throw new Error('Share failed');
	};
	clipData = '';
	alertMsg = '';
	await districtLib.shareDistrictData('share');
	assert(clipData.includes('BEGIN_DATA:'));
	assert(alertMsg.includes('暗号化データをクリップボードにコピーしました'));

	// 1d. Channel 'share' when both share and clipboard fail -> downloadTextFile
	delete navigator.share;
	navigator.clipboard.writeText = async () => { throw new Error('Clipboard failed'); };
	let downloadedText = '';
	const oldCreateElement = document.createElement;
	document.createElement = function(tag) {
		const el = oldCreateElement.call(document, tag);
		if (tag === 'a') {
			el.click = () => { downloadedText = el.href; };
		}
		return el;
	};
	await districtLib.shareDistrictData('share');
	assert(downloadedText.startsWith('blob:'));
	document.createElement = oldCreateElement;

	// 2. Channel 'copy' success
	navigator.clipboard.writeText = async (t) => { clipData = t; };
	clipData = '';
	await districtLib.shareDistrictData('copy');
	assert(clipData.includes('BEGIN_DATA:'));

	// 2b. Channel 'copy' failure alert
	navigator.clipboard.writeText = async () => { throw new Error('Clipboard failed'); };
	alertMsg = '';
	await districtLib.shareDistrictData('copy');
	assert(alertMsg.includes('暗号化データのコピーに失敗しました'));

	// Restore working clipboard
	navigator.clipboard.writeText = async (t) => { clipData = t; };

	let openedUrl = '';
	window.open = (u) => { openedUrl = u; };

	// 3. Channel 'line' with small payload (<= 2000 chars)
	openedUrl = '';
	await districtLib.shareDistrictData('line');
	assert(openedUrl.startsWith('https://line.me/R/msg/text/?'));
	assert(openedUrl.includes('BEGIN_DATA%3A'));

	// 4. Channel 'email' with small payload (<= 2000 chars)
	openedUrl = '';
	await districtLib.shareDistrictData('email');
	assert(openedUrl.startsWith('mailto:'));
	assert(openedUrl.includes('BEGIN_DATA%3A'));

	// 5. Action Item A-1: Large payload (> 2000 chars) fallback for LINE and Email
	state.currentDistrict.students = Array.from({ length: 60 }, (_, i) => ({
		grade: String((i % 6) + 1),
		class: '1',
		name: `テスト児童${i}番`,
		lastName: 'テスト',
		firstName: `児童${i}`,
		address: `町内${i}番地`
	}));
	clipData = '';
	openedUrl = '';
	await districtLib.shareDistrictData('line');
	assert(clipData.includes('BEGIN_DATA:')); // copied to clipboard!
	assert(openedUrl.startsWith('https://line.me/R/msg/text/?'));
	// URL should NOT contain BEGIN_DATA, but should contain guidance text
	assert(!openedUrl.includes('BEGIN_DATA%3A'));
	assert(openedUrl.includes('%E3%82%AF%E3%83%AA%E3%83%83%E3%83%97%E3%83%9C%E3%83%BC%E3%83%89')); // "クリップボード"

	// Email large payload fallback
	clipData = '';
	openedUrl = '';
	await districtLib.shareDistrictData('email');
	assert(clipData.includes('BEGIN_DATA:')); // copied to clipboard!
	assert(openedUrl.startsWith('mailto:'));
	assert(!openedUrl.includes('BEGIN_DATA%3A'));
	assert(openedUrl.includes('%E3%82%AF%E3%83%AA%E3%83%83%E3%83%97%E3%83%9C%E3%83%BC%E3%83%89'));
});

test('district: additional branch booster for loadNeighborFileIntoDistrict, mergeNeighborData, and shareDistrictData edge cases', async () => {
	setupDomEnvironment();
	const pass = "BoosterPass1234!";
	let alertMsg = "";
	window.alert = (m) => { alertMsg = m; };

	// 1. shareDistrictData without district name
	state.currentDistrict.district = "";
	await districtLib.shareDistrictData('copy');
	assert(alertMsg.includes("地区名を入力してください"));

	// 2. shareDistrictData without confirmEl and with han
	document.getElementById('d-name').value = "青葉台";
	document.getElementById('d-han-list').value = "1班, 2班";
	document.getElementById('d-pass').value = pass;
	const origGetById = document.getElementById;
	document.getElementById = (id) => (id === 'd-pass-confirm' ? null : origGetById.call(document, id));
	let clipData = "";
	navigator.clipboard = { writeText: async (t) => { clipData = t; } };
	await districtLib.shareDistrictData('copy');
	document.getElementById = origGetById;
	assert(clipData.includes("青葉台 1班"));
	assert(clipData.includes("BEGIN_DATA:"));

	// 3. mergeNeighborDataIntoDistrict with mismatched district name
	state.currentDistrict.district = "青葉台";
	state.currentDistrict.neighborhood = [];
	let confirmCalled = false;
	global.confirm = () => { confirmCalled = true; return false; }; // cancel
	districtLib.mergeNeighborDataIntoDistrict({
		district: "白石町",
		neighborhood: [{ role: "会長", lastName: "石田", firstName: "健" }]
	});
	assert(confirmCalled);
	assert.strictEqual(state.currentDistrict.neighborhood.length, 0); // cancelled

	// confirm = true
	global.confirm = () => true;
	districtLib.mergeNeighborDataIntoDistrict({
		district: "白石町",
		neighborhood: [{ role: "会長", lastName: "石田", firstName: "健" }]
	});
	assert.strictEqual(state.currentDistrict.neighborhood.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, "石田");

	// 4. loadDistrictTxt with isNeighborhoodData
	const neighborData = {
		isNeighborhoodData: true,
		district: "青葉台",
		neighborhood: [{ role: "会計", lastName: "高橋", firstName: "正" }]
	};
	const encNeighbor = await cryptoLib.encryptPayload(JSON.stringify(neighborData), pass);
	document.getElementById('d-pass').value = pass;
	const dummyTarget = {
		files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }],
		value: "file.txt"
	};
	await districtLib.loadDistrictTxt({ target: dummyTarget });
	assert.strictEqual(dummyTarget.value, "");
	assert(state.currentDistrict.neighborhood.some(n => n.lastName === "高橋"));

	// 5. loadNeighborFileIntoDistrict edge cases
	// 5a. empty files
	const emptyTarget = { files: [], value: "empty" };
	await districtLib.loadNeighborFileIntoDistrict({ target: emptyTarget });

	// 5b. success on first pass
	const fileTarget = {
		files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }],
		value: "file.txt"
	};
	await districtLib.loadNeighborFileIntoDistrict({ target: fileTarget });
	assert.strictEqual(fileTarget.value, "");

	// 5c. first decrypt fails, promptPass cancelled
	document.getElementById('d-pass').value = "WrongPass123!";
	global.prompt = () => null;
	const promptCancelTarget = {
		files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }],
		value: "file.txt"
	};
	await districtLib.loadNeighborFileIntoDistrict({ target: promptCancelTarget });
	assert.strictEqual(promptCancelTarget.value, "");

	// 5d. first decrypt fails, promptPass entered and succeeds
	global.prompt = () => pass;
	const promptSuccessTarget = {
		files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }],
		value: "file.txt"
	};
	await districtLib.loadNeighborFileIntoDistrict({ target: promptSuccessTarget });
	assert.strictEqual(promptSuccessTarget.value, "");

	// 5e. read error throws in outer try
	const errorTarget = {
		files: [{ text: async () => { throw new Error("Read failed"); } }],
		value: "file.txt"
	};
	alertMsg = "";
	await districtLib.loadNeighborFileIntoDistrict({ target: errorTarget });
	assert(alertMsg.includes("失敗しました"));
	assert.strictEqual(errorTarget.value, "");
});

test('district: openNeighborImportPanel toggles panel and expands collapsed card (Action Item A-2)', () => {
	setupDomEnvironment();
	const card = document.getElementById('card-d-neighbor');
	const panel = document.getElementById('d-neighbor-import-panel');
	if (!card || !panel) return;

	// 初期状態で折りたたまれている
	card.classList.add('is-collapsed');
	panel.style.display = 'none';

	districtLib.openNeighborImportPanel();

	// カードの折りたたみが解除され、パネルが表示されること
	assert.strictEqual(card.classList.contains('is-collapsed'), false);
	assert.strictEqual(panel.style.display, 'block');
});

test('district: integrateTransferDataIntoDistrict imports children with han assignment and duplicate guard (Action Item A-1)', async () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();
	const initialStudentCount = state.currentDistrict.students.length;

	const transferPayload = {
		isTransferData: true,
		version: 1,
		children: [
			{
				id: 't_child_1',
				lastName: '転入',
				firstName: '春子',
				lastNameKana: 'テンニュウ',
				firstNameKana: 'ハルコ',
				grade: '4',
				className: '2',
				address: '緑町3-4-5',
				tel: '090-1111-2222'
			}
		]
	};

	// 班割当プロンプトで「2班」を指定
	global.prompt = (msg, def) => '2班';
	global.confirm = () => true;

	const result = await districtLib.integrateTransferDataIntoDistrict(transferPayload, 'password123');
	assert.strictEqual(result, true);
	assert.strictEqual(state.currentDistrict.students.length, initialStudentCount + 1);

	const added = state.currentDistrict.students.find(s => s.lastName === '転入');
	assert.ok(added);
	assert.strictEqual(added.firstName, '春子');
	assert.strictEqual(added.han, '2班');
	assert.strictEqual(added.grade, '4');
	assert.strictEqual(added.className, '2');

	// 重複検知テスト（同一児童を再統合）
	let confirmCalled = false;
	global.confirm = (msg) => {
		confirmCalled = true;
		assert.ok(msg.includes('重複') || msg.includes('既に存在'));
		return false; // キャンセル
	};
	const cancelResult = await districtLib.integrateTransferDataIntoDistrict(transferPayload, 'password123');
	assert.strictEqual(cancelResult, false);
	assert.strictEqual(confirmCalled, true);
	// 件数が増えていないこと（アトミックトランザクション保護）
	assert.strictEqual(state.currentDistrict.students.length, initialStudentCount + 1);

	// T-3: 複数児童統合時に2人目の班割当プロンプトでキャンセルした場合の全件ロールバック
	const multiTransferPayload = {
		isTransferData: true,
		version: 1,
		children: [
			{ id: 't_m1', lastName: '複数A', firstName: '一郎', grade: '1', className: '1' },
			{ id: 't_m2', lastName: '複数B', firstName: '二郎', grade: '3', className: '2' }
		]
	};
	let promptCallCount = 0;
	global.prompt = () => {
		promptCallCount++;
		if (promptCallCount === 1) return '1班';
		return null; // 2人目でキャンセル
	};
	global.confirm = () => true;

	const rollbackResult = await districtLib.integrateTransferDataIntoDistrict(multiTransferPayload, 'password123');
	assert.strictEqual(rollbackResult, false);
	// 1人目も追加されずに完全ロールバックされていること
	assert.strictEqual(state.currentDistrict.students.length, initialStudentCount + 1);
	assert.strictEqual(state.currentDistrict.students.some(s => s.lastName === '複数A'), false);

	// T-4: 非転入データ（isTransferData が false または欠損）の拒絶
	const nonTransferPayload = {
		isTransferData: false,
		district: 'テスト地区',
		students: []
	};
	const rejectResult = await districtLib.integrateTransferDataIntoDistrict(nonTransferPayload, 'password123');
	assert.strictEqual(rejectResult, false);
});

test('district: loadTransferFileIntoDistrict and loadPastedTransferTextIntoDistrict', async () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();
	const initialCount = state.currentDistrict.students.length;

	const pass = 'TransferSec123!';
	const transferPayload = {
		isTransferData: true,
		version: 1,
		children: [
			{
				id: 't_c_2',
				lastName: '秋山',
				firstName: '太郎',
				grade: '1',
				className: '1',
				address: '紅葉丘1-1',
				tel: '080-3333-4444'
			}
		]
	};

	const encText = await cryptoLib.encryptPayload(JSON.stringify(transferPayload), pass);
	document.getElementById('d-pass').value = pass;
	global.prompt = (msg, def) => '1班';
	global.confirm = () => true;

	// ファイル読み込み
	const fileTarget = {
		files: [{ text: async () => `BEGIN_DATA:\n${encText}\n:END_DATA` }],
		value: 'transfer.txt'
	};
	await districtLib.loadTransferFileIntoDistrict({ target: fileTarget });
	assert.strictEqual(state.currentDistrict.students.length, initialCount + 1);

	// クリップボード貼り付け読み込み
	transferPayload.children[0].lastName = '冬木';
	const encText2 = await cryptoLib.encryptPayload(JSON.stringify(transferPayload), pass);

	await districtLib.loadPastedTransferTextIntoDistrict(encText2);
	assert.strictEqual(state.currentDistrict.students.length, initialCount + 2);
	const fuyuki = state.currentDistrict.students.find(s => s.lastName === '冬木');
	assert.ok(fuyuki);
});
