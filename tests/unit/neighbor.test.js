const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

setupDomEnvironment();
const cryptoLib = require('../../js/crypto.js');
const utils = require('../../js/utils.js');
const state = require('../../js/state.js');
const print = require('../../js/print.js');
const neighbor = require('../../js/neighbor.js');

test('neighbor: renderNeighborForm and renderNeighborTable with empty and populated lists', () => {
	setupDomEnvironment();
	state.neighborState = { district: "", neighborhood: [] };

	// 1. Empty rendering
	neighbor.renderNeighborForm();
	const nameEl = document.getElementById('neighbor-district-name');
	assert.strictEqual(nameEl.value, "");
	const tbody = document.getElementById('neighbor-tbody');
	assert(tbody.innerHTML.includes("自治会役員がまだ登録されていません"));

	// 2. Populated rendering
	state.neighborState.district = "緑ヶ丘町内会";
	state.neighborState.neighborhood = [
		{
			role: "会長",
			lastName: "山田",
			firstName: "太郎",
			lastNameKana: "やまだ",
			firstNameKana: "たろう",
			address: "1-1-1",
			tel: "090-1111-2222",
			email: "yamada@test.com",
			note: "PTA顧問兼任"
		},
		{
			role: "副会長",
			lastName: "佐藤",
			firstName: "花子",
			lastNameKana: "さとう",
			firstNameKana: "はなこ",
			address: "1-2-3",
			tel: "090-3333-4444",
			email: "",
			note: ""
		}
	];
	neighbor.renderNeighborForm();
	assert.strictEqual(nameEl.value, "緑ヶ丘町内会");
	assert.strictEqual(tbody.children.length, 2);
	assert(tbody.innerHTML.includes("山田"));
	assert(tbody.innerHTML.includes("佐藤"));
	assert(tbody.innerHTML.includes("disabled")); // First row up button disabled
});

test('neighbor: row operations (add, remove, move, update)', () => {
	setupDomEnvironment();
	state.neighborState = { district: "操作テスト自治会", neighborhood: [] };

	// 1. addNeighborRow
	neighbor.addNeighborRow();
	assert.strictEqual(state.neighborState.neighborhood.length, 1);
	assert.strictEqual(state.neighborState.neighborhood[0].role, "");

	neighbor.addNeighborRow();
	assert.strictEqual(state.neighborState.neighborhood.length, 2);

	// 2. updateNeighborItem
	neighbor.updateNeighborItem(0, 'role', '防犯部長');
	neighbor.updateNeighborItem(0, 'lastName', '木村');
	neighbor.updateNeighborItem(1, 'role', '防災部長');
	neighbor.updateNeighborItem(1, 'lastName', '渡辺');
	assert.strictEqual(state.neighborState.neighborhood[0].role, "防犯部長");
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "木村");
	assert.strictEqual(state.neighborState.neighborhood[1].role, "防災部長");

	// update invalid index safety
	neighbor.updateNeighborItem(99, 'role', '無効');

	// 3. moveNeighborRow
	// Move first row down
	neighbor.moveNeighborRow(0, 1);
	assert.strictEqual(state.neighborState.neighborhood[0].role, "防災部長");
	assert.strictEqual(state.neighborState.neighborhood[1].role, "防犯部長");

	// Move out of bounds safety
	neighbor.moveNeighborRow(0, -1); // cannot move top row up
	assert.strictEqual(state.neighborState.neighborhood[0].role, "防災部長");
	neighbor.moveNeighborRow(1, 1); // cannot move bottom row down
	assert.strictEqual(state.neighborState.neighborhood[1].role, "防犯部長");

	// 4. removeNeighborRow
	let confirmCalled = false;
	global.confirm = () => { confirmCalled = true; return false; };
	neighbor.removeNeighborRow(0);
	assert.strictEqual(confirmCalled, true);
	assert.strictEqual(state.neighborState.neighborhood.length, 2); // cancelled

	global.confirm = () => true;
	neighbor.removeNeighborRow(0);
	assert.strictEqual(state.neighborState.neighborhood.length, 1);
	assert.strictEqual(state.neighborState.neighborhood[0].role, "防犯部長");

	// remove out of bounds safety
	neighbor.removeNeighborRow(-1);
	neighbor.removeNeighborRow(10);
	assert.strictEqual(state.neighborState.neighborhood.length, 1);
});

test('neighbor: validateNeighborPasswords feedback and confirmation', () => {
	setupDomEnvironment();
	const passEl = document.getElementById('neighbor-pass');
	const confirmEl = document.getElementById('neighbor-pass-confirm');
	const msgEl = document.getElementById('neighbor-pass-match-msg');

	// 1. Missing elements
	document.elements['neighbor-pass'] = null;
	neighbor.validateNeighborPasswords();
	document.elements['neighbor-pass'] = passEl;

	// 2. Both empty
	passEl.value = "";
	confirmEl.value = "";
	neighbor.validateNeighborPasswords();
	assert.strictEqual(msgEl.textContent, "");

	// 3. Too short password
	passEl.value = "Short123!";
	confirmEl.value = "Short123!";
	neighbor.validateNeighborPasswords();
	assert(msgEl.textContent.includes("⚠"));
	assert(msgEl.className.includes("pass-msg-ng"));

	// 4. Missing confirm password
	passEl.value = "ValidPassword123!@#";
	confirmEl.value = "";
	neighbor.validateNeighborPasswords();
	assert.strictEqual(msgEl.textContent, "確認用パスワードを入力してください");

	// 5. Password mismatch
	confirmEl.value = "DifferentPassword123!@#";
	neighbor.validateNeighborPasswords();
	assert(msgEl.textContent.includes("⚠ パスワードが一致しません"));

	// 6. Match
	confirmEl.value = "ValidPassword123!@#";
	neighbor.validateNeighborPasswords();
	assert(msgEl.textContent.includes("✓ パスワードが一致しました"));
	assert(msgEl.className.includes("pass-msg-ok"));
});

test('neighbor: exportNeighborTxt and copyNeighborEncryptedText', async () => {
	setupDomEnvironment();
	state.neighborState = {
		district: "暗号化テスト町会",
		neighborhood: [
			{ role: "会長", lastName: "鈴木", firstName: "一郎", address: "1-1", tel: "03-0000" }
		]
	};

	let alertMsg = "";
	global.alert = (m) => { alertMsg = m; };
	let downloaded = null;
	global.downloadTextFile = (content, filename) => { downloaded = { content, filename }; };

	// 1. exportNeighborTxt - empty district
	state.neighborState.district = "";
	document.getElementById('neighbor-district-name').value = "";
	await neighbor.exportNeighborTxt();
	assert(alertMsg.includes("自治会名・地区名を入力してください"));
	assert.strictEqual(downloaded, null);

	// 2. exportNeighborTxt - invalid password
	state.neighborState.district = "暗号化テスト町会";
	document.getElementById('neighbor-district-name').value = "暗号化テスト町会";
	document.getElementById('neighbor-pass').value = "short";
	document.getElementById('neighbor-pass-confirm').value = "short";
	await neighbor.exportNeighborTxt();
	assert(alertMsg.includes("【保存パスワードエラー】"));

	// 3. exportNeighborTxt - mismatch password
	document.getElementById('neighbor-pass').value = "Password12345!@#";
	document.getElementById('neighbor-pass-confirm').value = "DifferentPass123!@#";
	await neighbor.exportNeighborTxt();
	assert(alertMsg.includes("【パスワード不一致エラー】"));

	// 4. exportNeighborTxt - success
	document.getElementById('neighbor-pass-confirm').value = "Password12345!@#";
	await neighbor.exportNeighborTxt();
	assert(downloaded);
	assert(downloaded.filename.startsWith("自治会役員データ_暗号化テスト町会_"));
	assert(downloaded.content.includes("BEGIN_DATA:"));

	// 5. copyNeighborEncryptedText - empty district
	state.neighborState.district = "";
	document.getElementById('neighbor-district-name').value = "";
	await neighbor.copyNeighborEncryptedText();
	assert(alertMsg.includes("自治会名・地区名を入力してください"));

	// 6. copyNeighborEncryptedText - invalid password
	state.neighborState.district = "暗号化テスト町会";
	document.getElementById('neighbor-district-name').value = "暗号化テスト町会";
	document.getElementById('neighbor-pass').value = "weak";
	await neighbor.copyNeighborEncryptedText();
	assert(alertMsg.includes("【パスワードエラー】"));

	// 7. copyNeighborEncryptedText - success via clipboard
	document.getElementById('neighbor-pass').value = "Password12345!@#";
	let clipWritten = "";
	navigator.clipboard.writeText = async (txt) => { clipWritten = txt; };
	await neighbor.copyNeighborEncryptedText();
	assert(clipWritten.includes("BEGIN_DATA:"));
	assert(alertMsg.includes("クリップボードにコピーしました"));

	// 8. copyNeighborEncryptedText - fallback to paste box when clipboard throws
	navigator.clipboard.writeText = async () => { throw new Error("Clipboard blocked"); };
	await neighbor.copyNeighborEncryptedText();
	const pasteBox = document.getElementById('neighbor-paste-box');
	assert(pasteBox.value.includes("BEGIN_DATA:"));
	assert(alertMsg.includes("暗号化テキストを表示しました"));
});

test('neighbor: loadNeighborTxt and loadPastedTextToNeighbor', async () => {
	setupDomEnvironment();
	state.neighborState = { district: "", neighborhood: [] };
	const pass = "Password12345!@#";
	document.getElementById('neighbor-import-pass').value = pass;

	let alertMsg = "";
	global.alert = (m) => { alertMsg = m; };

	// 1. loadNeighborTxt - empty files
	await neighbor.loadNeighborTxt({ target: { files: [] } });
	assert.strictEqual(alertMsg, "");

	// 2. loadNeighborTxt - success
	const rawData = {
		isNeighborhoodData: true,
		district: "インポート町会",
		neighborhood: [
			{ role: "会長", lastName: "高橋", firstName: "健" }
		]
	};
	const enc = await cryptoLib.encryptPayload(JSON.stringify(rawData), pass);
	const mockFile = { text: async () => `BEGIN_DATA:\n${enc}\n:END_DATA` };
	await neighbor.loadNeighborTxt({ target: { files: [mockFile], value: 'test.txt' } });
	assert.strictEqual(state.neighborState.district, "インポート町会");
	assert.strictEqual(state.neighborState.neighborhood.length, 1);
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "高橋");
	assert(alertMsg.includes("読み込みました"));

	// 3. loadNeighborTxt - prompt fallback
	document.getElementById('neighbor-import-pass').value = "wrong_password!";
	global.prompt = () => pass;
	await neighbor.loadNeighborTxt({ target: { files: [mockFile], value: 'test.txt' } });
	assert.strictEqual(state.neighborState.district, "インポート町会");

	// prompt cancelled
	global.prompt = () => null;
	await neighbor.loadNeighborTxt({ target: { files: [mockFile], value: 'test.txt' } });

	// 4. loadNeighborTxt - invalid format
	const badFormatEnc = await cryptoLib.encryptPayload(JSON.stringify({ district: "壊れたデータ" }), pass);
	const badFormatFile = { text: async () => `BEGIN_DATA:\n${badFormatEnc}\n:END_DATA` };
	document.getElementById('neighbor-import-pass').value = pass;
	await neighbor.loadNeighborTxt({ target: { files: [badFormatFile], value: 'test.txt' } });
	assert(alertMsg.includes("フォーマットが一致しません"));

	// 5. loadPastedTextToNeighbor - empty
	const pasteBox = document.getElementById('neighbor-paste-box');
	pasteBox.value = "  ";
	await neighbor.loadPastedTextToNeighbor();

	// 6. loadPastedTextToNeighbor - success
	pasteBox.value = `BEGIN_DATA:\n${enc}\n:END_DATA`;
	await neighbor.loadPastedTextToNeighbor();
	assert.strictEqual(pasteBox.value, "");
	assert(alertMsg.includes("読み込みました"));

	// 7. loadPastedTextToNeighbor - prompt fallback and corrupt text
	pasteBox.value = `BEGIN_DATA:\n${enc}\n:END_DATA`;
	document.getElementById('neighbor-import-pass').value = "wrong_pass!";
	global.prompt = () => pass;
	await neighbor.loadPastedTextToNeighbor();
	assert.strictEqual(state.neighborState.district, "インポート町会");

	// corrupt text
	pasteBox.value = `BEGIN_DATA:\ninvalid_base64\n:END_DATA`;
	await neighbor.loadPastedTextToNeighbor();
	assert(alertMsg.includes("復号に失敗しました"));
});

test('neighbor: runNeighborYearUpdate resets personal info and keeps roles', () => {
	setupDomEnvironment();
	state.neighborState = {
		district: "新年度町会",
		neighborhood: [
			{ role: "自治会長", lastName: "田中", firstName: "太郎", address: "1-1", tel: "090-1111", email: "a@b.com", note: "特記" },
			{ role: "副会長", lastName: "小林", firstName: "次郎", address: "1-2", tel: "090-2222", email: "", note: "" }
		]
	};

	let alertMsg = "";
	global.alert = (m) => { alertMsg = m; };

	// Cancel
	global.confirm = () => false;
	neighbor.runNeighborYearUpdate();
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "田中");

	// Confirm
	global.confirm = () => true;
	neighbor.runNeighborYearUpdate();
	assert.strictEqual(state.neighborState.neighborhood[0].role, "自治会長");
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "");
	assert.strictEqual(state.neighborState.neighborhood[0].tel, "");
	assert.strictEqual(state.neighborState.neighborhood[1].role, "副会長");
	assert.strictEqual(state.neighborState.neighborhood[1].lastName, "");
	assert(alertMsg.includes("年度更新が完了しました"));
});

test('neighbor: printNeighborRoster and printNeighborTentCards', () => {
	setupDomEnvironment();
	let alertMsg = "";
	global.alert = (m) => { alertMsg = m; };
	let printCalled = false;
	window.print = () => { printCalled = true; };

	// 1. printNeighborRoster - empty
	state.neighborState = { district: "印刷町会", neighborhood: [] };
	neighbor.printNeighborRoster();
	assert(alertMsg.includes("自治会役員が登録されていません"));
	assert.strictEqual(printCalled, false);

	// 2. printNeighborRoster - populated
	state.neighborState.neighborhood = [
		{ role: "会長", lastName: "阿部", firstName: "寛", address: "1-1" }
	];
	neighbor.printNeighborRoster();
	assert.strictEqual(printCalled, true);
	const printArea = document.getElementById('print-area');
	assert(printArea.innerHTML.includes("自治会役員名簿"));
	assert(printArea.innerHTML.includes("阿部 寛"));

	// 3. printNeighborTentCards - empty names
	printCalled = false;
	state.neighborState.neighborhood = [{ role: "会長", lastName: "", firstName: "" }];
	neighbor.printNeighborTentCards();
	assert(alertMsg.includes("氏名が入力されていません"));
	assert.strictEqual(printCalled, false);

	// 4. printNeighborTentCards - valid names
	state.neighborState.neighborhood = [
		{ role: "会長", lastName: "加藤", firstName: "剛", lastNameKana: "かとう", firstNameKana: "ごう" }
	];
	neighbor.printNeighborTentCards();
	assert.strictEqual(printCalled, true);
	assert(printArea.innerHTML.includes("加藤 剛"));
	assert(printArea.innerHTML.includes("tent-card"));
});

test('neighbor: loadNeighborTxt and loadPastedTextToNeighbor prioritize #neighbor-import-pass and ignore #neighbor-pass', async () => {
	setupDomEnvironment();
	state.neighborState = { district: "", neighborhood: [] };
	const importPass = "ImportSecret123!";
	const savePass = "CompletelyWrongPass!";

	// Set save pass in card 3 and import pass in card 4
	document.getElementById('neighbor-pass').value = savePass;
	const importPassInput = document.getElementById('neighbor-import-pass');
	importPassInput.value = importPass;

	const rawData = {
		isNeighborhoodData: true,
		district: "分離テスト町会",
		neighborhood: [{ role: "会長", lastName: "分離", firstName: "太郎" }]
	};
	const enc = await cryptoLib.encryptPayload(JSON.stringify(rawData), importPass);

	// 1. loadPastedTextToNeighbor uses #neighbor-import-pass
	const pasteBox = document.getElementById('neighbor-paste-box');
	pasteBox.value = `BEGIN_DATA:\n${enc}\n:END_DATA`;
	await neighbor.loadPastedTextToNeighbor();
	assert.strictEqual(state.neighborState.district, "分離テスト町会");
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "分離");

	// 2. loadNeighborTxt uses #neighbor-import-pass
	state.neighborState = { district: "", neighborhood: [] };
	const mockFile = { text: async () => `BEGIN_DATA:\n${enc}\n:END_DATA` };
	await neighbor.loadNeighborTxt({ target: { files: [mockFile], value: 'test.txt' } });
	assert.strictEqual(state.neighborState.district, "分離テスト町会");

	// 3. When #neighbor-import-pass is empty, falls back to prompt, ignoring #neighbor-pass
	importPassInput.value = "";
	global.prompt = () => importPass;
	pasteBox.value = `BEGIN_DATA:\n${enc}\n:END_DATA`;
	await neighbor.loadPastedTextToNeighbor();
	assert.strictEqual(state.neighborState.district, "分離テスト町会");

	// 4. Toggle visibility of #neighbor-import-pass
	importPassInput.type = 'password';
	const toggleBtn = document.getElementById('neighbor-import-pass-toggle');
	utils.togglePasswordVisibility('neighbor-import-pass', toggleBtn);
	assert.strictEqual(importPassInput.type, 'text');
	utils.togglePasswordVisibility('neighbor-import-pass', toggleBtn);
	assert.strictEqual(importPassInput.type, 'password');
});

test('neighbor: toolbar add buttons (#btn-add-neighbor-mode-top and bottom) add rows', () => {
	setupDomEnvironment();
	state.neighborState = { district: "ボタンテスト町会", neighborhood: [] };
	neighbor.renderNeighborForm();

	const topBtn = document.getElementById('btn-add-neighbor-mode-top');
	const bottomBtn = document.getElementById('btn-add-neighbor-mode-bottom');

	assert(topBtn, '#btn-add-neighbor-mode-top should exist');
	assert(bottomBtn, '#btn-add-neighbor-mode-bottom should exist');

	// Click top button
	topBtn.click();
	assert.strictEqual(state.neighborState.neighborhood.length, 1);

	// Click bottom button
	bottomBtn.click();
	assert.strictEqual(state.neighborState.neighborhood.length, 2);
});

test('neighbor: integrated card (#card-n-file) 4 major sections exist', () => {
	setupDomEnvironment();
	const card = document.getElementById('card-n-file');
	assert(card, '#card-n-file should exist');

	const secPass = document.getElementById('sec-n-pass');
	const secSave = document.getElementById('sec-n-save-share');
	const secLoad = document.getElementById('sec-n-load');
	const secYear = document.getElementById('sec-n-year');

	assert(secPass, '#sec-n-pass should exist');
	assert(secSave, '#sec-n-save-share should exist');
	assert(secLoad, '#sec-n-load should exist');
	assert(secYear, '#sec-n-year should exist');
});

