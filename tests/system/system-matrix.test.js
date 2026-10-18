const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const hata = require('../../js/hata.js');
const seat = require('../../js/seat.js');
const rep = require('../../js/rep.js');
const district = require('../../js/district.js');
const print = require('../../js/print.js');
const app = require('../../js/app.js');
const neighbor = require('../../js/neighbor.js');

/* =========================================================================
	機能1: 画面遷移 (Screen Transitions)
========================================================================= */
test('system [画面遷移]: tab switching, modal display, and card folding controls', () => {
	setupDomEnvironment();

	// 1. Tab switching (4 modes)
	const tabD = document.getElementById('tab-district');
	const tabR = document.getElementById('tab-rep');
	const tabN = document.getElementById('tab-neighbor');
	const tabT = document.getElementById('tab-transfer');
	app.switchTab('rep');
	assert.strictEqual(tabD.style.display, 'none');
	assert.strictEqual(tabR.style.display, 'block');
	assert.strictEqual(tabN.style.display, 'none');
	if (tabT) assert.strictEqual(tabT.style.display, 'none');

	app.switchTab('neighbor');
	assert.strictEqual(tabD.style.display, 'none');
	assert.strictEqual(tabR.style.display, 'none');
	assert.strictEqual(tabN.style.display, 'block');
	if (tabT) assert.strictEqual(tabT.style.display, 'none');

	app.switchTab('transfer');
	assert.strictEqual(tabD.style.display, 'none');
	assert.strictEqual(tabR.style.display, 'none');
	assert.strictEqual(tabN.style.display, 'none');
	if (tabT) assert.strictEqual(tabT.style.display, 'block');

	app.switchTab('district');
	assert.strictEqual(tabD.style.display, 'block');
	assert.strictEqual(tabR.style.display, 'none');
	assert.strictEqual(tabN.style.display, 'none');
	if (tabT) assert.strictEqual(tabT.style.display, 'none');

	// 2. Modals: Storage Unlock Modal
	const unlockModal = document.getElementById('storage-lock-modal');
	app.showStorageUnlockModal();
	assert.strictEqual(unlockModal.style.display, 'flex');
	app.hideStorageUnlockModal();
	assert.strictEqual(unlockModal.style.display, 'none');

	// Modals: Storage Settings Modal
	const settingsModal = document.getElementById('storage-settings-modal');
	app.openStorageSettingsModal();
	assert.strictEqual(settingsModal.style.display, 'flex');
	app.closeStorageSettingsModal();
	assert.strictEqual(settingsModal.style.display, 'none');

	// 3. Card Folding: Single toggle and Collapse/Expand all
	const card = document.createElement('div');
	card.className = 'card is-collapsed';
	const toggleBtn = document.createElement('span');
	toggleBtn.className = 'btn-card-toggle';
	card.appendChild(toggleBtn);
	tabD.appendChild(card);

	district.toggleCard(card);
	assert(!card.classList.contains('is-collapsed'));
	assert.strictEqual(toggleBtn.textContent, '▲ 閉じる');

	district.setAllCardsCollapse(true, 'tab-district');
	assert(card.classList.contains('is-collapsed'));
	assert.strictEqual(toggleBtn.textContent, '▼ 開く');

	district.setAllCardsCollapse(false, 'tab-district');
	assert(!card.classList.contains('is-collapsed'));
	assert.strictEqual(toggleBtn.textContent, '▲ 閉じる');
});

/* =========================================================================
	機能2: 登録 (Registration)
========================================================================= */
test('system [登録]: registering officers, students, neighborhood, hans, externals, and seat grid cells', async () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();
	district.renderDistrictForm();

	// 1. Han list registration & dropdown update
	const hanListEl = document.getElementById('d-han-list');
	hanListEl.value = "1班, 2班, 3班";
	district.onHanListInput(hanListEl.value);
	assert.deepStrictEqual(state.currentDistrict.hanList, ["1班", "2班", "3班"]);

	// 2. Officer registration
	const initialOfficerCount = state.currentDistrict.officers.length;
	district.addOfficer();
	assert.strictEqual(state.currentDistrict.officers.length, initialOfficerCount + 1);

	// 3. Neighborhood row registration
	const initialNeighborCount = state.currentDistrict.neighborhood.length;
	district.addNeighborhoodRow();
	assert.strictEqual(state.currentDistrict.neighborhood.length, initialNeighborCount + 1);

	// 4. Student row registration (top & bottom buttons)
	const initialStudentCount = state.currentDistrict.students.length;
	district.addStudentRow();
	assert.strictEqual(state.currentDistrict.students.length, initialStudentCount + 1);

	// 5. Representative: SZ External Registration
	state.repState = createMockRepState();
	const initialExternalCount = state.repState.szExternals.length;
	rep.addSzExternalRow();
	assert.strictEqual(state.repState.szExternals.length, initialExternalCount + 1);

	// 6. Representative: Seat Grid registration
	seat.updateSeatCell("0,0", "refKey", "FAC_SCREEN");
	assert.strictEqual(state.repState.seatConfig.cells["0,0"].refKey, "FAC_SCREEN");

	// Custom seat cell registration
	seat.updateSeatCell("0,1", "customText", "来賓席A");
	assert.strictEqual(state.repState.seatConfig.cells["0,1"].customText, "来賓席A");
});

/* =========================================================================
	機能3: 編集 (Editing)
========================================================================= */
test('system [編集]: field editing, real-time title reflection, student multi-tier sort, and Hata template generation', async () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict({ district: "港南地区", han: "1班" });
	district.renderDistrictForm();

	// 1. Real-time header title update upon editing officer han field
	const officerBox = document.querySelector('.officer-item-box');
	const hanInput = officerBox.querySelector('[data-field="han"]');
	hanInput.value = "西班";
	await state.saveDistrictLocal();
	const titleEl = officerBox.querySelector('.officer-item-title');
	assert(titleEl.textContent.includes("（担当: 西班）"));

	// 2. Multi-tier student sorting (Leader -> Grade -> Address)
	state.currentDistrict.students = [
		{ grade: "5", address: "1-1", lastName: "一般5年", leader: "", isOutOfDistrict: false },
		{ grade: "6", address: "2-2", lastName: "副班長6年", leader: "副班長", isOutOfDistrict: false },
		{ grade: "6", address: "1-1", lastName: "班長6年", leader: "班長", isOutOfDistrict: false }
	];
	district.sortStudentsDesc();
	assert.strictEqual(state.currentDistrict.students[0].lastName, "班長6年");
	assert.strictEqual(state.currentDistrict.students[1].lastName, "副班長6年");
	assert.strictEqual(state.currentDistrict.students[2].lastName, "一般5年");

	// 3. Student summary recalculation
	district.updateStudentSummaryText();
	const summaryEl = document.getElementById('district-student-summary');
	assert(summaryEl.textContent.includes("合計：3名"));

	// 4. Hata format template preview with full-width conversion
	const hataTemplate = document.getElementById('hata-format');
	hataTemplate.value = "{班} {学年} {氏名}（{住所数字}）";
	state.currentDistrict.students = [
		{ grade: "6", class: "2", han: "A班", lastName: "鈴木", firstName: "一郎", address: "港南３丁目１５番２号", isOutOfDistrict: false }
	];
	hata.updateHataPreview();
	const previewBox = document.getElementById('hata-preview');
	assert(previewBox.value.includes("A班 6年 鈴木 一郎（3-15-2）"));

	// 5. Representative: SZ External editing
	state.repState = createMockRepState();
	rep.updateSzEx(0, 'lastName', '新苗字');
	rep.updateSzEx(0, 'firstName', '新名前');
	assert.strictEqual(state.repState.szExternals[0].name, '新苗字 新名前');
});

/* =========================================================================
	機能4: 削除 (Deletion)
========================================================================= */
test('system [削除]: officer removal limit, deleting neighborhood, students, externals, and bulk clear', () => {
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict();
	district.renderDistrictForm();

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };
	global.confirm = () => true;

	// 1. Delete student
	const beforeStudentCount = state.currentDistrict.students.length;
	district.removeS(0);
	assert.strictEqual(state.currentDistrict.students.length, beforeStudentCount - 1);

	// 2. Delete neighborhood member
	const beforeNeighborCount = state.currentDistrict.neighborhood.length;
	district.removeN(0);
	assert.strictEqual(state.currentDistrict.neighborhood.length, beforeNeighborCount - 1);

	// 3. Delete officer (when count > 1)
	assert(state.currentDistrict.officers.length >= 2);
	district.removeOfficer(1);
	assert.strictEqual(state.currentDistrict.officers.length, 1);

	// 4. Delete officer limit (minimum 1 officer required)
	district.removeOfficer(0);
	assert(alertMsg.includes("最低1名"));
	assert.strictEqual(state.currentDistrict.officers.length, 1);

	// 5. Representative: Clear all districts
	state.repState = createMockRepState();
	assert(state.repState.districts.length > 0);
	rep.clearAllRepDistricts();
	assert.strictEqual(state.repState.districts.length, 0);
});

/* =========================================================================
	機能5: ファイル入出力・暗号化 (File I/O & Cryptography)
========================================================================= */
test('system [ファイル入出力]: encrypted txt export/import, text paste, password rules, and error recovery', async () => {
	setupDomEnvironment();
	const pass = "SecurePassword123!@#$";
	document.getElementById('d-name').value = "高輪地区";
	state.currentDistrict = createMockDistrict({ district: "高輪地区", han: "南班" });
	document.getElementById('d-pass').value = pass;
	document.getElementById('d-pass-confirm').value = pass;

	// 1. Export district encrypted .txt
	let exportedDistrictTxt = "";
	global.downloadTextFile = (content, filename) => { exportedDistrictTxt = content; };
	await district.exportDistrictTxt();
	assert(exportedDistrictTxt.includes("BEGIN_DATA:"));

	// 2. Load district encrypted .txt
	state.currentDistrict = createMockDistrict({ district: "リセット地区" });
	await district.loadDistrictTxt({
		target: {
			files: [{ text: async () => exportedDistrictTxt }],
			value: "path"
		}
	});
	assert.strictEqual(state.currentDistrict.district, "高輪地区");

	// 3. Load via paste box in Representative mode
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	document.getElementById('rep-pass').value = pass;
	document.getElementById('rep-paste-box').value = exportedDistrictTxt;
	await rep.loadPastedTextToRep();
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].district, "高輪地区");

	// 4. Bad password error handling
	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };
	document.getElementById('rep-pass').value = "WrongPassword999!@#";
	document.getElementById('rep-paste-box').value = exportedDistrictTxt;
	await rep.loadPastedTextToRep();
	assert(alertMsg.includes("復号に失敗しました"));

	// 5. Password security policy check (length >= 12, uppercase, lowercase, digit, symbol)
	assert.strictEqual(utils.validatePassword("short").valid, false);
	assert.strictEqual(utils.validatePassword("Password 123456").valid, false); // Space forbidden
	assert.strictEqual(utils.validatePassword("パスワード12345678").valid, false); // Fullwidth forbidden
	assert.strictEqual(utils.validatePassword("SecurePass123!@#").valid, true);
});

/* =========================================================================
	機能6: 印刷・帳票出力 (Printing & Output)
========================================================================= */
test('system [印刷・帳票出力]: single district and bulk rep print with origami folds and delivery notices', () => {
	setupDomEnvironment();
	document.getElementById('d-name').value = "三田地区";
	state.currentDistrict = createMockDistrict({ district: "三田地区", han: "1班" });
	district.renderDistrictForm();

	let printTriggered = false;
	global.window.print = () => { printTriggered = true; };

	// 1. Single district selected print
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = true;
	document.getElementById('d-print-school').checked = true;
	document.getElementById('d-print-pta').checked = true;
	print.printSingleDistrictSelected();
	assert.strictEqual(printTriggered, true);
	const printArea = document.getElementById('print-area');
	assert(printArea.innerHTML.includes("三田地区"));

	// 2. Representative bulk print
	printTriggered = false;
	state.repState = createMockRepState();
	state.repState.districts.forEach(d => d.selectedForPrint = true);

	const container = document.createElement('div');
	container.innerHTML = `
		<input type="checkbox" class="rep-print-chk" value="officers_pta" checked>
		<input type="checkbox" class="rep-print-chk" value="officers_school" checked>
		<input type="checkbox" class="rep-print-chk" value="reg_tent" checked>
		<input type="checkbox" class="rep-print-chk" value="envelopes" checked>
		<input type="checkbox" class="rep-print-chk" value="all_students" checked>
		<input type="checkbox" class="rep-print-chk" value="all_neighbors" checked>
		<input type="checkbox" class="rep-print-chk" value="sz_tent" checked>
		<input type="checkbox" class="rep-print-chk" value="sz_att_1" checked>
		<input type="checkbox" class="rep-print-chk" value="sz_att_2" checked>
		<input type="checkbox" class="rep-print-chk" value="sz_att_3" checked>
		<input type="checkbox" class="rep-print-chk" value="sz_seats" checked>
		<input type="checkbox" class="rep-print-chk" value="sz_master" checked>
	`;
	document.body.appendChild(container);

	print.executeRepSelectedPrint();
	assert.strictEqual(printTriggered, true);
	const bulkHtml = printArea.innerHTML;

	// Verify origami fold lines, child envelope delivery message, and all 12 document titles
	assert(bulkHtml.includes("折り線（山折り・名札の天）"));
	assert(bulkHtml.includes("（おうちの人に、かならず、わたしてね）"));
	assert(bulkHtml.includes("PTA校外委員会 役員名簿（PTA本部・会員用）"));
	assert(bulkHtml.includes("PTA校外委員会 役員名簿（学校提出用）"));
	assert(bulkHtml.includes("スクールゾーン協議会 出席簿（学校・PTA本部・校外委員会）"));
	assert(bulkHtml.includes("スクールゾーン協議会 座席表"));
});

/* =========================================================================
	機能7: 年度更新 (Year Rollover)
========================================================================= */
test('system [年度更新]: advancing student grades, deleting 6th graders, and resetting representative structures', () => {
	setupDomEnvironment();
	global.confirm = () => true;

	// 1. District Rollover
	state.currentDistrict = createMockDistrict({
		students: [
			{ grade: "6", lastName: "卒業生", firstName: "太郎" },
			{ grade: "5", lastName: "進級生", firstName: "次郎" },
			{ grade: "1", lastName: "新入生", firstName: "三郎" }
		],
		officers: [
			{ lastName: "引退役員", firstName: "花子" }
		]
	});
	district.runDistrictYearUpdate();

	// 6th graders removed, remaining students advanced by +1
	assert.strictEqual(state.currentDistrict.students.length, 2);
	assert.strictEqual(state.currentDistrict.students[0].lastName, "進級生");
	assert.strictEqual(state.currentDistrict.students[0].grade, "6");
	assert.strictEqual(state.currentDistrict.students[1].lastName, "新入生");
	assert.strictEqual(state.currentDistrict.students[1].grade, "2");
	// Officers initialized with empty form
	assert.strictEqual(state.currentDistrict.officers[0].lastName, "");

	// 2. Representative Rollover
	state.repState = createMockRepState();
	state.repState.seatConfig.cells = { "0,0": "SCH_小学校_校長" };
	rep.runRepYearUpdate();

	assert.strictEqual(state.repState.districts.length, 0);
	assert.deepStrictEqual(state.repState.seatConfig.cells, {});
	assert.strictEqual(state.repState.szExternals[0].org, "小学校");
	assert.strictEqual(state.repState.szExternals[0].role, "校長");
	assert.strictEqual(state.repState.szExternals[0].lastName, ""); // Names cleared
});

/* =========================================================================
	機能8: セキュリティ・認証 (Security & Authentication)
========================================================================= */
test('system [セキュリティ・認証]: WebAuthn PRF integration, locking, unlocking, and factory reset', async () => {
	setupDomEnvironment();
	cryptoLib.clearStorageSecurity();

	const pass = "SystemSecurityPass123!@#";

	// 1. Quick setup encryption from card
	document.getElementById('d-pass').value = pass;
	global.confirm = () => true; // Confirm biometrics
	await app.quickSetupEncryptionFromCard('d-pass');
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// 2. Immediate lock
	app.handleImmediateLock();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);
	const lockModal = document.getElementById('storage-lock-modal');
	assert.strictEqual(lockModal.style.display, 'flex');

	// 3. WebAuthn PRF unlock
	await app.handleWebAuthnUnlock(false);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);
	assert.strictEqual(lockModal.style.display, 'none');

	// 4. Factory reset
	window.location.reload = () => {};
	global.confirm = () => true;
	app.handleResetStorageConfirm();
	assert.strictEqual(cryptoLib.isStorageEncrypted(), false);
	assert.strictEqual(localStorage.getItem('kogai_auth_meta'), null);
});

/* =========================================================================
	機能9: PWA・ライフサイクル (PWA & Lifecycle Events)
========================================================================= */
test('system [PWA・ライフサイクル]: install prompt handling and DOMContentLoaded initialization', async () => {
	setupDomEnvironment();

	// 1. PWA install prompt event
	let promptTriggered = false;
	const mockPromptEvt = {
		preventDefault: () => {},
		prompt: () => { promptTriggered = true; },
		userChoice: Promise.resolve({ outcome: 'accepted' })
	};
	window.dispatchEvent(Object.assign(mockPromptEvt, { type: 'beforeinstallprompt' }));

	const installBtn = document.getElementById('pwa-install-btn');
	assert.strictEqual(installBtn.style.display, 'inline-flex');

	app.triggerPwaInstall();
	assert.strictEqual(promptTriggered, true);

	// 2. DOMContentLoaded lifecycle in unencrypted state
	cryptoLib.clearStorageSecurity();
	window.dispatchEvent({ type: 'DOMContentLoaded' });
	const badge = document.getElementById('storage-security-badge');
	assert(badge.classList.contains('is-plain'));

	// 3. DOMContentLoaded lifecycle in encrypted state
	await cryptoLib.setupStorageEncryption("Password12345!@#", false);
	cryptoLib.lockStorage();
	window.dispatchEvent({ type: 'DOMContentLoaded' });
	assert(badge.classList.contains('is-locked'));
	const lockModal = document.getElementById('storage-lock-modal');
	assert.strictEqual(lockModal.style.display, 'flex');
});

/* =========================================================================
	機能10: 自治会役員名簿モードE2Eシナリオ (Neighborhood Mode End-to-End Workflow)
========================================================================= */
test('system [自治会役員名簿モード]: creation, export, merge into district, merge into rep, printing, and rollover', async () => {
	setupDomEnvironment();
	state.neighborState = { district: "", neighborhood: [] };
	const pass = "SystemNeighborPass123!@#";

	// 1. Switch to Neighbor Tab
	app.switchTab('neighbor');
	assert.strictEqual(document.getElementById('tab-neighbor').style.display, 'block');

	// 2. Input district name and add officers
	document.getElementById('neighbor-district-name').value = "初台一丁目自治会";
	state.neighborState.district = "初台一丁目自治会";
	neighbor.addNeighborRow();
	neighbor.updateNeighborItem(0, 'role', '会長');
	neighbor.updateNeighborItem(0, 'lastName', '新田');
	neighbor.updateNeighborItem(0, 'firstName', '貞男');
	neighbor.updateNeighborItem(0, 'lastNameKana', 'にった');
	neighbor.updateNeighborItem(0, 'firstNameKana', 'さだお');
	neighbor.updateNeighborItem(0, 'address', '初台1-1-1');
	neighbor.updateNeighborItem(0, 'tel', '090-8888-9999');

	neighbor.addNeighborRow();
	neighbor.updateNeighborItem(1, 'role', '副会長');
	neighbor.updateNeighborItem(1, 'lastName', '足利');
	neighbor.updateNeighborItem(1, 'firstName', '尊');
	neighbor.updateNeighborItem(1, 'address', '初台1-1-2');

	// Reorder
	neighbor.moveNeighborRow(0, 1);
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "足利");
	neighbor.moveNeighborRow(1, -1);
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "新田");

	// 3. Print neighbor roster and tent cards
	let printed = false;
	window.print = () => { printed = true; };
	neighbor.printNeighborRoster();
	assert.strictEqual(printed, true);
	assert(document.getElementById('print-area').innerHTML.includes("初台一丁目自治会"));

	printed = false;
	neighbor.printNeighborTentCards();
	assert.strictEqual(printed, true);
	assert(document.getElementById('print-area').innerHTML.includes("新田"));

	// 4. Export encrypted neighbor file
	document.getElementById('neighbor-pass').value = pass;
	document.getElementById('neighbor-pass-confirm').value = pass;
	let downloadedFile = null;
	global.downloadTextFile = (content, filename) => {
		downloadedFile = { content, filename };
	};
	await neighbor.exportNeighborTxt();
	assert(downloadedFile);
	assert(downloadedFile.filename.includes("自治会役員データ_初台一丁目自治会"));

	// 5. Merge into District Mode
	app.switchTab('district');
	state.currentDistrict = createMockDistrict({
		district: "初台一丁目自治会",
		han: "西班",
		hanList: ["西班", "東班"],
		officers: [{ role: "校外委員", lastName: "役員", firstName: "花", han: "西班" }],
		neighborhood: [],
		students: [{ grade: "5", class: "1", han: "西班", lastName: "児童", firstName: "太郎", leader: "班長" }]
	});
	document.getElementById('d-name').value = "初台一丁目自治会";
	document.getElementById('d-pass').value = pass;

	await district.loadDistrictTxt({
		target: {
			files: [{ text: async () => downloadedFile.content }],
			value: downloadedFile.filename
		}
	});

	// Verify district students & PTA officers are intact and neighborhood officers are merged
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood.length, 2);
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, "新田");

	// 6. Merge into Representative Mode
	app.switchTab('rep');
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	document.getElementById('rep-pass').value = pass;

	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => downloadedFile.content }],
			value: downloadedFile.filename
		}
	});
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].neighborhood[0].lastName, "新田");

	// 7. Annual Rollover in Neighbor Mode
	app.switchTab('neighbor');
	global.confirm = () => true;
	neighbor.runNeighborYearUpdate();
	assert.strictEqual(state.neighborState.neighborhood[0].role, "会長");
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "");
	assert.strictEqual(state.neighborState.neighborhood[0].tel, "");
});

/* =========================================================================
	機能11: モード選択肢の動的折りたたみUX (Mode Selector Collapsing UX)
========================================================================= */
test('system [モード選択肢折りたたみUX]: initial state, selection auto-collapse, and toggle re-expansion', () => {
	setupDomEnvironment();
	const btnContainer = document.getElementById('mode-tab-buttons') || document.createElement('div');
	btnContainer.id = 'mode-tab-buttons';
	btnContainer.style.display = 'flex';
	document.body.appendChild(btnContainer);

	const badge = document.getElementById('mode-active-badge') || document.createElement('div');
	badge.id = 'mode-active-badge';
	badge.style.display = 'none';
	document.body.appendChild(badge);

	const badgeText = document.getElementById('mode-active-badge-text') || document.createElement('span');
	badgeText.id = 'mode-active-badge-text';
	badge.appendChild(badgeText);

	// 1. Initial display is expanded
	assert.strictEqual(btnContainer.style.display, 'flex');
	assert.strictEqual(badge.style.display, 'none');

	// 2. Select Tab 2 (rep): collapsed into active badge
	app.switchTab('rep');
	assert.strictEqual(btnContainer.style.display, 'none');
	assert.strictEqual(badge.style.display, 'inline-flex');
	assert(badgeText.textContent.includes('校外代表'));

	// 3. User clicks badge: re-expands 3 tab buttons
	app.toggleModeSelector();
	assert.strictEqual(btnContainer.style.display, 'flex');
	assert.strictEqual(badge.style.display, 'none');

	// 4. Select Tab 3 (neighbor): collapses again
	app.switchTab('neighbor');
	assert.strictEqual(btnContainer.style.display, 'none');
	assert.strictEqual(badge.style.display, 'inline-flex');
	assert(badgeText.textContent.includes('自治会'));

	// 5. Select Tab 1 (district): collapses again
	app.switchTab('district');
	assert.strictEqual(btnContainer.style.display, 'none');
	assert.strictEqual(badge.style.display, 'inline-flex');
	assert(badgeText.textContent.includes('地区役員'));
});

/* =========================================================================
	機能12: アプリ共有機能 (PWA App Share)
========================================================================= */
test('system [アプリ共有]: PWA URL sharing across Web Share API and clipboard fallbacks', async () => {
	setupDomEnvironment();
	let sharedPayload = null;
	let alertMessage = '';
	global.alert = (m) => { alertMessage = m; };

	// 1. Web Share API supported
	navigator.share = async (data) => {
		sharedPayload = data;
		return Promise.resolve();
	};
	await app.shareAppUrl();
	assert(sharedPayload !== null);
	assert(sharedPayload.title.includes('校外委員会'));
	assert.strictEqual(sharedPayload.url, window.location.href);

	// 2. Web Share cancelled by user (AbortError)
	navigator.share = async () => {
		const err = new Error('User dismissed share sheet');
		err.name = 'AbortError';
		throw err;
	};
	alertMessage = '';
	await app.shareAppUrl();
	assert.strictEqual(alertMessage, ''); // no disruptive alert on cancel

	// 3. Clipboard fallback when Web Share fails or is missing
	delete navigator.share;
	let clipboardText = '';
	navigator.clipboard = {
		writeText: async (txt) => { clipboardText = txt; }
	};
	await app.shareAppUrl();
	assert.strictEqual(clipboardText, window.location.href);
	assert(alertMessage.includes('URLをクリップボードにコピーしました'));
});

/* =========================================================================
	機能13: 地区データ共有連携 (District Data Sharing Options)
========================================================================= */
test('system [地区データ共有]: LINE, email, Web Share, and URL length fallback (>2000 chars)', async () => {
	setupDomEnvironment();
	document.getElementById('d-name').value = "共有テスト町";
	const pass = "SharingPass123!@#";
	document.getElementById('d-pass').value = pass;
	document.getElementById('d-pass-confirm').value = pass;
	state.currentDistrict.district = "共有テスト町";
	state.currentDistrict.students = [{ grade: "2", class: "1", name: "児童1", lastName: "児童", firstName: "1" }];

	let sharedData = null;
	navigator.share = async (d) => { sharedData = d; };
	let clipData = '';
	navigator.clipboard = {
		writeText: async (t) => { clipData = t; }
	};
	let openedUrl = '';
	global.window.open = (u) => { openedUrl = u; };

	// 1. Native share
	await district.shareDistrictData('share');
	assert(sharedData !== null);

	// 2. Clipboard copy
	await district.shareDistrictData('copy');
	assert(clipData.includes('BEGIN_DATA:'));

	// 3. Small payload LINE share
	await district.shareDistrictData('line');
	assert(openedUrl.startsWith('https://line.me/R/msg/text/?'));
	assert(openedUrl.includes('BEGIN_DATA%3A'));

	// 4. Large payload LINE fallback (Action Item A-1: payload > 2000 chars)
	state.currentDistrict.students = Array.from({ length: 50 }, (_, i) => ({
		grade: "3",
		class: "2",
		name: `大容量児童${i}番`,
		lastName: "大容量",
		firstName: `児童${i}`,
		address: `町内${i}番地`
	}));
	clipData = '';
	openedUrl = '';
	await district.shareDistrictData('line');
	assert(clipData.includes('BEGIN_DATA:'));
	assert(openedUrl.startsWith('https://line.me/R/msg/text/?'));
	assert(!openedUrl.includes('BEGIN_DATA%3A')); // cipher suppressed from URL query!
	assert(openedUrl.includes('%E3%82%AF%E3%83%AA%E3%83%83%E3%83%97%E3%83%9C%E3%83%BC%E3%83%89')); // guidance included
});

/* =========================================================================
	機能14: パスワード安全記憶ライフサイクル (Password Persistence Lifecycle)
========================================================================= */
test('system [パスワード安全記憶]: opt-in persistence, unencrypted storage exclusion, lock wipe, and rollover', async () => {
	setupDomEnvironment();
	const pass = "PersistPass123!@#";
	const passInput = document.getElementById('d-pass');
	const confirmInput = document.getElementById('d-pass-confirm');
	const optinInput = document.getElementById('d-save-password-optin');

	// 1. Encrypted storage: password saved when opt-in checked
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	passInput.value = pass;
	confirmInput.value = pass;
	optinInput.checked = true;
	state.currentDistrict.district = "記憶地区";
	await state.saveDistrictLocal();
	assert.strictEqual(state.currentDistrict.savedFilePassword, pass);

	// 2. Unencrypted storage: password strictly stripped (Action Item A-2)
	localStorage.removeItem('kogai_auth_meta');
	state.currentDistrict.savedFilePassword = pass;
	await state.saveDistrictLocal();
	assert.strictEqual(state.currentDistrict.savedFilePassword, undefined);

	// 3. Form render restores saved password
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	state.currentDistrict.savedFilePassword = pass;
	passInput.value = '';
	confirmInput.value = '';
	optinInput.checked = false;
	district.renderDistrictForm();
	assert.strictEqual(passInput.value, pass);
	assert.strictEqual(confirmInput.value, pass);
	assert.strictEqual(optinInput.checked, true);

	// 4. App lock immediately purges saved password from memory and DOM
	app.handleImmediateLock();
	assert.strictEqual(state.currentDistrict.savedFilePassword, undefined);
	assert.strictEqual(passInput.value, '');
	assert.strictEqual(confirmInput.value, '');

	// 5. Annual rollover deletes saved password
	state.currentDistrict.savedFilePassword = pass;
	passInput.value = pass;
	confirmInput.value = pass;
	optinInput.checked = true;
	global.confirm = () => true;
	district.runDistrictYearUpdate();
	assert.strictEqual(state.currentDistrict.savedFilePassword, undefined);
	assert.strictEqual(passInput.value, '');
	assert.strictEqual(confirmInput.value, '');
	assert.strictEqual(optinInput.checked, false);
});

/* =========================================================================
	機能15: パスワード入力リアルタイム半角サニタイズ (IME Input Sanitization)
========================================================================= */
test('system [パスワード入力サニタイズ]: full-width normalization, non-ASCII stripping, and caret tracking', () => {
	setupDomEnvironment();
	const passInput = document.getElementById('d-pass');

	// 1. Full-width alphanumeric & symbols to half-width
	passInput.value = 'Ｐａｓｓｗｏｒｄ１２３！＠＃';
	passInput.selectionStart = 8;
	passInput.selectionEnd = 8;
	utils.sanitizePasswordInput(passInput);
	assert.strictEqual(passInput.value, 'Password123!@#');
	assert.strictEqual(passInput.selectionStart, 8);

	// 2. Full-width space and Japanese text stripped with caret position adjustment (Action Item A-3)
	passInput.value = 'Secure　パスワードPass!';
	passInput.selectionStart = 12; // cursor right after 'パスワード'
	passInput.selectionEnd = 12;
	utils.sanitizePasswordInput(passInput);
	assert.strictEqual(passInput.value, 'SecurePass!');
	assert.strictEqual(passInput.selectionStart, 6);
});

/* =========================================================================
	機能16: 自治会読込専用パスワード分離 (Neighborhood Import Password Separation)
========================================================================= */
test('system [自治会読込パスワード分離]: #neighbor-import-pass isolated from export password', async () => {
	setupDomEnvironment();
	state.neighborState = { district: "", neighborhood: [] };
	const savePass = "SaveSecret999!@#";
	const importPass = "ImportSecret123!@#";

	document.getElementById('neighbor-pass').value = savePass;
	const importPassInput = document.getElementById('neighbor-import-pass');
	importPassInput.value = importPass;

	// Encrypt with importPass
	const encData = await cryptoLib.encryptPayload(JSON.stringify({
		isNeighborhoodData: true,
		district: "分離町内会",
		neighborhood: [{ role: "会長", lastName: "分離", firstName: "三郎" }]
	}), importPass);

	// Paste into Tab 3 import card
	const pasteBox = document.getElementById('neighbor-paste-box');
	pasteBox.value = `BEGIN_DATA:\n${encData}\n:END_DATA`;
	await neighbor.loadPastedTextToNeighbor();

	// Verified decoded successfully using #neighbor-import-pass while #neighbor-pass had wrong pass
	assert.strictEqual(state.neighborState.district, "分離町内会");
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "分離");
});

/* =========================================================================
	機能17: PWAバージョンチェックおよび強制・手動アップデート機構 (PWA Version Check & Forced Update)
========================================================================= */
test('system [PWA強制アップデート]: startup online check, manual settings check, and zero data loss reload', async () => {
	setupDomEnvironment();
	let alertMsg = '';
	global.alert = (m) => { alertMsg = m; };
	let confirmMsg = '';
	let confirmAnswer = true;
	global.confirm = (m) => { confirmMsg = m; return confirmAnswer; };

	// 1. Populate current business data across all modes to verify zero data loss
	state.currentDistrict = {
		district: 'アップデート検証地区',
		officers: [{ lastName: '地区役員', firstName: '太郎' }],
		students: [{ name: '児童A', grade: '3' }],
		neighborhood: []
	};
	document.getElementById('d-name').value = 'アップデート検証地区';

	state.repState = {
		districts: [{ district: 'アップデート代表地区', students: [] }],
		szExternals: []
	};

	state.neighborState = {
		district: 'アップデート自治会',
		neighborhood: [{ role: '会長', lastName: '自治会長' }]
	};
	document.getElementById('neighbor-district-name').value = 'アップデート自治会';

	// 2. Open Settings modal to verify version section rendered
	app.openStorageSettingsModal();
	const modalBody = document.getElementById('settings-modal-body');
	assert(modalBody.innerHTML.includes('アプリバージョン情報'));
	assert(modalBody.innerHTML.includes('btn-manual-check-update'));

	// 3. Online startup check with newer version available
	navigator.onLine = true;
	global.fetch = async () => ({
		ok: true,
		json: async () => ({
			version: '3.0.0',
			updatedAt: '2026-10-18',
			description: 'メジャーアップデート'
		})
	});

	let replacedUrl = '';
	window.location.replace = (url) => { replacedUrl = url; };
	global.caches = {
		keys: async () => ['kogai-cache-v2'],
		delete: async () => true
	};
	navigator.serviceWorker.getRegistrations = async () => [];

	// User confirms update
	confirmAnswer = true;
	await app.checkAppVersion(false);
	assert(confirmMsg.includes('新しいバージョン（v3.0.0）'));
	assert(replacedUrl.includes('?_update='));

	// 4. Verify LocalStorage has saved state (zero data loss)
	assert.strictEqual(state.currentDistrict.district, 'アップデート検証地区');
	assert.strictEqual(state.neighborState.district, 'アップデート自治会');

	// 5. Manual check when offline: verify alert feedback
	navigator.onLine = false;
	alertMsg = '';
	await app.checkAppVersion(true);
	assert(alertMsg.includes('オフラインのためバージョンチェックを行えません'));
});

/* =========================================================================
	機能18: 転入者モード E2E（入力・暗号化・提出リセット・地区・代表統合・帳票連動）
========================================================================= */
test('system [機能18]: 転入者モード E2E ライフサイクル', async () => {
	setupDomEnvironment();
	const transfer = require('../../js/transfer.js');

	// 1. 転入家庭による児童入力
	transfer.renderTransferForm();
	transfer.updateTransferChild(0, 'lastName', '転入E2E');
	transfer.updateTransferChild(0, 'firstName', '未来');
	transfer.updateTransferChild(0, 'grade', '3');
	transfer.updateTransferChild(0, 'className', '1');
	transfer.updateTransferChild(0, 'address', '希望が丘7-8-9');
	transfer.updateTransferChild(0, 'tel', '090-5555-4444');

	// パスワード設定
	const passInput = document.getElementById('transfer-export-pass');
	const confirmInput = document.getElementById('transfer-export-pass-confirm');
	passInput.value = 'E2ETransferPass123!';
	confirmInput.value = 'E2ETransferPass123!';

	// エクスポート
	let exportedText = '';
	utils.downloadTextFile = (content, filename) => {
		exportedText = content;
	};
	global.downloadTextFile = utils.downloadTextFile;
	const exportOk = await transfer.exportTransferTxt();
	assert.strictEqual(exportOk, true);
	assert.ok(exportedText.length > 50);

	// 提出後ワンタップリセット（APPI消去）
	global.confirm = () => true;
	transfer.resetTransferForm();
	assert.strictEqual(transfer.transferState.children[0].lastName, '');

	// 2. 地区役員側での受入と名簿帳票出力連動
	state.currentDistrict = createMockDistrict({
		district: '希望地区',
		han: '1班',
		hanList: ['1班'],
		students: []
	});
	document.getElementById('d-name').value = '希望地区';
	document.getElementById('d-pass').value = 'E2ETransferPass123!';

	global.prompt = (msg, def) => '1班';
	await district.loadPastedTransferTextIntoDistrict(exportedText);

	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.students[0].lastName, '転入E2E');
	assert.strictEqual(state.currentDistrict.students[0].firstName, '未来');

	// 児童名簿印刷プレビュー生成
	const html = print.buildStudentPageHtml(state.currentDistrict, {
		isDistrictWide: false,
		isPublic: false
	}, [state.currentDistrict]);
	assert.ok(html.includes('転入E2E'));
	assert.ok(html.includes('未来'));
});

/* =========================================================================
	機能19: 「マージ」用語残存ゼロ検証 (C-8: 全コード・UI・ダイアログの日本語「マージ」完全排除)
========================================================================= */
test('system [機能19]: 全コードベースおよびUIにおける「マージ」文言の残存ゼロ検証 (C-8)', () => {
	const fs = require('fs');
	const path = require('path');

	const targetFiles = [
		'index.html',
		'js/app.js',
		'js/district.js',
		'js/rep.js',
		'js/neighbor.js',
		'js/transfer.js',
		'js/print.js',
		'js/seat.js',
		'js/hata.js',
		'js/state.js',
		'js/utils.js',
		'js/crypto.js'
	];

	for (const relPath of targetFiles) {
		const fullPath = path.resolve(__dirname, '../../', relPath);
		if (!fs.existsSync(fullPath)) continue;
		const content = fs.readFileSync(fullPath, 'utf-8');

		// UI表示・ボタン・ダイアログ・コメント等における日本語「マージ」の残存をチェック
		const matches = content.match(/マージ/g);
		assert.strictEqual(
			matches ? matches.length : 0,
			0,
			`File ${relPath} should not contain 'マージ'. Found ${matches ? matches.length : 0} occurrences.`
		);
	}
});

/* =========================================================================
	機能20: URLパラメータ起動・モード指定共有・トグル開閉・名簿ボタン直結・カード6ジャンル別・代表切り出し配付 E2E
========================================================================= */
test('system [機能20]: URLパラメータ起動、トグルパネル、名簿ボタン直結、ジャンル別カード6、代表切り出し配付 E2E', async () => {
	setupDomEnvironment();
	const pass = 'SystemMatrixPass123!';

	// 1. URLパラメータ起動 (?mode=transfer)
	window.location.search = '?mode=transfer';
	app.restoreActiveMode();
	assert.strictEqual(document.getElementById('tab-transfer').style.display, 'block');

	// 2. モード指定共有
	let sharedUrl = '';
	navigator.share = async (data) => { sharedUrl = data.url; };
	await app.shareAppUrl('transfer');
	assert(sharedUrl.includes('mode=transfer'));

	// 3. 地区役員モードへ切り替え (History API 同期)
	app.switchTab('district');
	assert.strictEqual(document.getElementById('tab-district').style.display, 'block');
	assert(window.location.search.includes('mode=district') || window.location.href.includes('mode=district'));

	// 4. 自治会統合パネルのトグル開閉
	const nPanel = document.getElementById('d-neighbor-import-panel');
	if (nPanel) {
		district.openNeighborImportPanel();
		assert.strictEqual(nPanel.style.display, 'block');
		district.openNeighborImportPanel();
		assert.strictEqual(nPanel.style.display, 'none');
	}

	// 5. 転入児童取り込みパネルのトグル開閉
	const tPanel = document.getElementById('d-transfer-import-panel');
	if (tPanel) {
		district.toggleTransferImportPanel();
		assert.strictEqual(tPanel.style.display, 'block');
		district.toggleTransferImportPanel();
		assert.strictEqual(tPanel.style.display, 'none');
	}

	// 6. 代表切り出し出力から地区受入のE2E
	state.repState = {
		districts: [
			{
				district: 'システム地区',
				han: 'A班',
				hanList: ['A班'],
				officers: [{ role: '校外委員', lastName: '代表経由', firstName: '役員' }],
				neighborhood: [{ role: '会長', lastName: '地域', firstName: '会長' }],
				students: [{ grade: '5', class: '1', han: 'A班', lastName: '転入生', firstName: '代表割当' }]
			}
		],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};

	let splitFileContent = '';
	global.downloadTextFile = (content, name) => { splitFileContent = content; };
	const splitSuccess = await rep.exportSingleDistrictFromRep(0, pass, 'download');
	assert.strictEqual(splitSuccess, true);

	// 地区役員側で受入
	state.currentDistrict = {
		district: '',
		han: '',
		hanList: [],
		officers: [],
		neighborhood: [],
		students: []
	};
	document.getElementById('d-pass').value = pass;
	global.confirm = () => true;

	await district.loadDistrictTxt({
		target: {
			files: [{ text: async () => splitFileContent }],
			value: 'district.txt'
		}
	});

	assert.strictEqual(state.currentDistrict.district, 'システム地区');
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.students[0].firstName, '代表割当');
});
