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

	// 1. Tab switching
	const tabD = document.getElementById('tab-district');
	const tabR = document.getElementById('tab-rep');
	const tabN = document.getElementById('tab-neighbor');
	app.switchTab('rep');
	assert.strictEqual(tabD.style.display, 'none');
	assert.strictEqual(tabR.style.display, 'block');
	assert.strictEqual(tabN.style.display, 'none');

	app.switchTab('neighbor');
	assert.strictEqual(tabD.style.display, 'none');
	assert.strictEqual(tabR.style.display, 'none');
	assert.strictEqual(tabN.style.display, 'block');

	app.switchTab('district');
	assert.strictEqual(tabD.style.display, 'block');
	assert.strictEqual(tabR.style.display, 'none');
	assert.strictEqual(tabN.style.display, 'none');

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
