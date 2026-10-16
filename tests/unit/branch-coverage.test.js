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

test('branch-booster: print.js comprehensive branch coverage', () => {
	setupDomEnvironment();

	// 1. buildStudentPageHtml without options (options = undefined) and empty hanName
	const dNoHan = createMockDistrict({
		district: "無班地区",
		han: "",
		students: [
			{
				grade: "", // empty grade tests '-' branch
				class: "", // empty class tests '-' branch
				han: "",
				lastName: "姓のみ",
				firstName: "",
				lastNameKana: "",
				firstNameKana: "",
				address: "無番地",
				tel: "",
				leader: "",
				isOutOfDistrict: false
			}
		],
		officers: [
			{
				role: "",
				han: "他班", // tests (o.han && o.han !== hanName) label
				lastName: "役員",
				firstName: "",
				tel: "090-0000-0000",
				email: "off@example.com"
			}
		]
	});
	const htmlNoOptions = print.buildStudentPageHtml(dNoHan);
	assert(htmlNoOptions.includes("無班地区"));
	assert(htmlNoOptions.includes("担当:他班"));
	assert(htmlNoOptions.includes("【無班地区 児童集計】"));

	// 2. buildPtaOfficersRosterPageHtml across core roles: 副代表, 会計, 書記
	const dCoreRoles = createMockDistrict({
		district: "役員地区",
		officers: [
			{ role: "副代表", lastName: "副", firstName: "代表", tel: "090-1111", email: "fuku@example.com", name: "副 代表" },
			{ role: "会計", lastName: "金", firstName: "勘定", tel: "090-2222", email: "kaikei@example.com", name: "金 勘定" },
			{ role: "書記", lastName: "筆", firstName: "記録", tel: "090-3333", email: "shoki@example.com", name: "筆 記録" },
			{ role: "一般役員", lastName: "平", firstName: "役員", tel: "090-4444", email: "taira@example.com", name: "平 役員" }
		]
	});
	const ptaHtml = print.buildPtaOfficersRosterPageHtml([dCoreRoles]);
	assert(ptaHtml.includes("fuku@example.com"));
	assert(ptaHtml.includes("kaikei@example.com"));
	assert(ptaHtml.includes("shoki@example.com"));

	// 3. buildTentCardPageHtml all knownRoles detection
	const knownRoles = ["副代表", "書記", "会計", "校外委員", "副会長", "校長", "副校長", "PTA会長", "担当"];
	knownRoles.forEach(kr => {
		const tent = print.buildTentCardPageHtml("地区", `${kr} テスト氏名`, "", "");
		assert(tent.includes(`<span class="tent-role">${kr}</span>`));
		assert(tent.includes('<span class="tent-name">テスト氏名</span>'));
	});

	// Space in name but not a known role
	const tentNoRole = print.buildTentCardPageHtml("地区", "未知役職 テスト氏名", "", "");
	assert(tentNoRole.includes('<span class="tent-name">未知役職 テスト氏名</span>'));

	// 4. buildEnvelopesPagesHtml with > 12 envelopes (multi-page pagination)
	const dManyOfficers = createMockDistrict({
		district: "大家族地区",
		officers: Array.from({ length: 15 }, (_, i) => ({
			role: "校外委員",
			lastName: `保護者${i}`,
			firstName: "様",
			childGrade: "3",
			childClass: "1",
			childLastName: `児童${i}`,
			childFirstName: "太郎",
			childName: `児童${i} 太郎`
		}))
	});
	const envelopePages = print.buildEnvelopesPagesHtml([dManyOfficers]);
	assert.strictEqual(envelopePages.length, 2); // 15 envelopes split into 2 pages (12 + 3)

	// Officer without child is skipped from envelopes
	const dNoChild = createMockDistrict({
		district: "子なし役員地区",
		officers: [{ lastName: "役員", childLastName: "", childFirstName: "", childName: "" }]
	});
	assert.strictEqual(print.buildEnvelopesPagesHtml([dNoChild]).length, 0);

	// 5. buildSzSeatChartPageHtml seat cell types (including unknown refKey falling to line 787-788)
	state.repState = createMockRepState();
	state.repState.seatConfig.cells = {
		"0_0": { refKey: "", customText: "" }, // empty
		"0_1": { refKey: "FAC_DOOR", customText: "" }, // facility door
		"0_2": { refKey: "FAC_STAGE", customText: "カスタム演台" }, // facility with custom text
		"0_3": { refKey: "CUSTOM", customText: "自由指定席" }, // custom
		"1_0": { refKey: "EXT_0", customText: "メモ付き" }, // participant with note
		"2_0": { refKey: "UNKNOWN_REF_KEY", customText: "フォールバック座席" } // line 787-788 uncovered branch!
	};
	const blankExtIdx = state.repState.szExternals.length;
	state.repState.szExternals.push({ category: "学校", org: "小学校", role: "教頭", lastName: "", firstName: "", attend: true });
	state.repState.seatConfig.cells["1_1"] = { refKey: `EXT_${blankExtIdx}`, customText: "" };
	const seatHtml = print.buildSzSeatChartPageHtml();
	assert(seatHtml.includes("is-empty"));
	assert(seatHtml.includes("is-facility"));
	assert(seatHtml.includes("カスタム演台"));
	assert(seatHtml.includes("自由指定席"));
	assert(seatHtml.includes("メモ付き"));
	assert(seatHtml.includes("フォールバック座席"));
	assert(seatHtml.includes("（ご出席者 様）"));

	// 6. Single officer across all print generators
	const dLegacy = {
		district: "単一旧役員地区",
		han: "西班",
		officers: [{
			role: "校外委員",
			lastName: "旧役員",
			firstName: "次郎",
			lastNameKana: "きゅう",
			firstNameKana: "じろう",
			tel: "090-8888-7777",
			email: "kyu@example.com",
			childGrade: "5",
			childClass: "3",
			childLastName: "旧子",
			childFirstName: "三郎",
			childLastNameKana: "きゅうこ",
			childFirstNameKana: "さぶろう"
		}],
		neighborhood: [
			{ role: "自治会長", lastName: "自治", firstName: "会長", lastNameKana: "じち", firstNameKana: "かい", address: "1-2-3", tel: "03-1111" }
		],
		students: [
			{
				grade: "6", class: "2", han: "西班",
				lastName: "学区外児童", firstName: "四郎",
				lastNameKana: "がっくがい", firstNameKana: "しろう",
				address: "遠方1-1", tel: "03-2222", leader: "班長",
				isOutOfDistrict: true
			}
		],
		szNeighborChecks: { 0: true }
	};
	const legStudentHtml = print.buildStudentPageHtml(dLegacy);
	assert(legStudentHtml.includes("学区外"));
	assert(legStudentHtml.includes("090-8888-7777"));
	const legNeighborHtml = print.buildNeighborPageHtml(dLegacy);
	assert(legNeighborHtml.includes("自治会長"));
	const legPtaHtml = print.buildPtaOfficersRosterPageHtml([dLegacy]);
	assert(legPtaHtml.includes("旧役員 次郎"));
	const legSchoolHtml = print.buildSchoolOfficersRosterPageHtml([dLegacy]);
	assert(legSchoolHtml.includes("単一旧役員地区"));
	const legEnvPages = print.buildEnvelopesPagesHtml([dLegacy]);
	assert(legEnvPages.length > 0);
	const legSzCards = print.buildSzTentCardsPagesHtml([dLegacy], []);
	assert(legSzCards.length > 0);
	const legSzAtt1 = print.buildSzAttendance1PageHtml([dLegacy], []);
	assert(legSzAtt1.includes("単一旧役員地区"));
	const legSzAtt2 = print.buildSzAttendance2PageHtml([dLegacy]);
	assert(legSzAtt2.includes("単一旧役員地区"));
	const legSzMaster = print.buildSzMasterRosterPageHtml([dLegacy], []);
	assert(legSzMaster.includes("単一旧役員地区"));

	// 7. Validation branches in print execution
	// printSingleDistrictSelected with 0 checkboxes
	document.querySelectorAll = (sel) => [];
	let alertMsg = "";
	global.alert = (m) => { alertMsg = m; };
	print.printSingleDistrictSelected();
	assert(alertMsg.includes("チェックを入れてください"));

	// executeRepSelectedPrint with 0 districts
	state.repState.districts = [];
	const chk = new (document.createElement('input').constructor)('input');
	chk.value = 'all_students';
	chk.checked = true;
	document.querySelectorAll = (sel) => sel.includes(':checked') ? [chk] : [];
	alertMsg = "";
	print.executeRepSelectedPrint();
	assert(alertMsg.includes("印刷対象のデータがありません"));
});

test('branch-booster: rep.js, district.js, and seat.js edge cases and branches', async () => {
	setupDomEnvironment();

	// 1. seat.js: resizeSeatGrid NaN branches
	document.getElementById('seat-cols').value = "";
	document.getElementById('seat-rows').value = "NaN";
	seat.resizeSeatGrid();
	assert.strictEqual(state.repState.seatConfig.cols, 4);
	assert.strictEqual(state.repState.seatConfig.rows, 5);

	// seat.js: getAllSzParticipantsForSeat with officer
	state.repState.districts = [{
		district: "旧席地区",
		han: "南班",
		selectedForPrint: true,
		officers: [{ lastName: "旧席", firstName: "役員", role: "校外役員" }],
		neighborhood: []
	}];
	const seatList = seat.getAllSzParticipantsForSeat();
	assert(seatList.some(p => p.name && p.name.includes("旧席 役員")));

	// 2. district.js: renderOfficersList with roles 副代表, 書記, 会計, 校外役員
	state.currentDistrict = createMockDistrict();
	state.currentDistrict.officers = [
		{ role: "副代表", lastName: "副", firstName: "代" },
		{ role: "書記", lastName: "書", firstName: "記" },
		{ role: "会計", lastName: "会", firstName: "計" },
		{ role: "校外役員", lastName: "校", firstName: "外" }
	];
	district.renderOfficersList();
	const offBoxHtml = document.getElementById('officers-container').innerHTML;
	assert(offBoxHtml.includes("副代表"));
	assert(offBoxHtml.includes("書記"));
	assert(offBoxHtml.includes("会計"));
	assert(offBoxHtml.includes("校外役員"));

	// district.js: setAllCardsCollapse & toggleCard invalid element safety
	district.setAllCardsCollapse(true, 'non-existent-tab');
	district.toggleCard(null);

	// district.js: removeOfficer & removeStudent cannot remove last item
	state.currentDistrict.officers = [{ lastName: "最後の一人" }];
	let alertCalled = false;
	global.alert = () => { alertCalled = true; };
	district.removeOfficer(0);
	assert.strictEqual(alertCalled, true);

	// district.js: exportDistrictTxt password confirmation mismatch
	document.getElementById('d-name').value = "不一致テスト地区";
	document.getElementById('d-pass').value = "Password12345!@#";
	document.getElementById('d-pass-confirm').value = "MismatchPass999!@#";
	alertCalled = false;
	await district.exportDistrictTxt();
	assert.strictEqual(alertCalled, true);

	// district.js: exportDistrictTxt with han naming in file
	state.currentDistrict = createMockDistrict({ district: "班付き地区", han: "中班" });
	document.getElementById('d-name').value = "班付き地区";
	document.getElementById('d-han-list').value = "中班";
	document.getElementById('d-pass').value = "Password12345!@#";
	document.getElementById('d-pass-confirm').value = "Password12345!@#";
	let downloadedName = "";
	global.downloadTextFile = (content, fname) => { downloadedName = fname; };
	await district.exportDistrictTxt();
	assert(downloadedName.includes("_中班"));

	// district.js: loadDistrictTxt with empty students/officers fallback
	const rawIncomplete = {
		district: "不完全インポート地区",
		han: "南班",
		students: [{ grade: "2" }]
	};
	const encIncomplete = await cryptoLib.encryptPayload(JSON.stringify(rawIncomplete), "Password12345!@#");
	const incompleteFile = { name: "incomplete.txt", text: async () => `BEGIN_DATA:\n${encIncomplete}\n:END_DATA` };
	document.getElementById('d-pass').value = "Password12345!@#";
	await district.loadDistrictTxt({ target: { files: [incompleteFile], value: 'fake.txt' } });
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.students[0].han, "南班");

	// district.js: addStudentRow when student list is initially empty
	state.currentDistrict.students = [];
	state.currentDistrict.hanList = ["第1班", "第2班"];
	district.addStudentRow();
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.students[0].han, "第1班");

	// 3. rep.js: exportRepMasterTxt password mismatch
	document.getElementById('rep-pass').value = "MasterPass12345!@#";
	document.getElementById('rep-pass-confirm').value = "DifferentPass123!@#";
	alertCalled = false;
	await rep.exportRepMasterTxt();
	assert.strictEqual(alertCalled, true);

	// rep.js: loadRepMasterTxt with legacy district structure
	const legacyMasterObj = {
		isMaster: true,
		districts: [
			{
				district: "旧代表地区",
				officer: { lastName: "旧代表役員" },
				students: [{ lastName: "旧代表生徒" }]
			}
		],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	const encMasterStr = await cryptoLib.encryptPayload(JSON.stringify(legacyMasterObj), "MasterPass12345!@#");
	const masterFile = { name: "master.txt", text: async () => `BEGIN_DATA:\n${encMasterStr}\n:END_DATA` };
	global.prompt = () => "MasterPass12345!@#";
	await rep.loadRepMasterTxt({ target: { files: [masterFile], value: 'fake.txt' } });
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].officers.length, 1);

	// rep.js: loadMultipleDistrictFiles with han
	const singleHanObj = {
		district: "個別複数ファイル地区",
		han: "新班",
		students: []
	};
	const encSingleHan = await cryptoLib.encryptPayload(JSON.stringify(singleHanObj), "Password12345!@#");
	const multiFile = { name: "single_han.txt", text: async () => `BEGIN_DATA:\n${encSingleHan}\n:END_DATA` };
	document.getElementById('rep-pass').value = "Password12345!@#";
	await rep.loadMultipleDistrictFiles({ target: { files: [multiFile], value: 'fake.txt' } });
	assert(state.repState.districts.some(d => d.district === "個別複数ファイル地区"));

	// rep.js: toggleSzNeighbor with undefined szNeighborChecks
	state.repState.districts = [{
		district: "未初期化地区",
		neighborhood: [{ role: "町内会長", lastName: "町" }]
	}];
	rep.toggleSzNeighbor(0, 0, true);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true);

	// rep.js: renderRepDistrictsTable with empty district name
	state.repState.districts = [{
		district: "",
		officers: []
	}];
	rep.renderRepDistrictsTable();
	const tbody = document.getElementById('rep-districts-tbody');
	assert(tbody.innerHTML.includes("未入力"));
});

test('branch-booster: app.js lifecycle, authentication modals, and storage normalization', async () => {
	setupDomEnvironment();

	// 1. switchTab with buttons present
	const btn1 = new (document.createElement('button').constructor)('button');
	btn1.className = 'tab-btn active';
	const btn2 = new (document.createElement('button').constructor)('button');
	btn2.className = 'tab-btn';
	document.querySelectorAll = (sel) => sel === '.tab-btn' ? [btn1, btn2] : [];
	app.switchTab('rep');
	assert.strictEqual(btn1.classList.contains('active'), false);
	assert.strictEqual(btn2.classList.contains('active'), true);
	app.switchTab('district');
	assert.strictEqual(btn1.classList.contains('active'), true);

	// 2. triggerPwaInstall with prompt
	let promptInvoked = false;
	let userChoiceResolve;
	const userChoicePromise = new Promise(resolve => { userChoiceResolve = resolve; });
	window.dispatchEvent({
		type: 'beforeinstallprompt',
		preventDefault: () => {},
		prompt: () => { promptInvoked = true; },
		userChoice: userChoicePromise
	});
	app.triggerPwaInstall();
	assert.strictEqual(promptInvoked, true);
	userChoiceResolve({ outcome: 'accepted' });
	await new Promise(r => setTimeout(r, 10));

	// 3. updateSecurityBadge status variations
	app.updateSecurityBadge('unencrypted');
	assert(document.getElementById('storage-security-badge').className.includes('is-plain'));
	app.updateSecurityBadge('locked');
	assert(document.getElementById('storage-security-badge').className.includes('is-locked'));
	app.updateSecurityBadge('unlocked');
	assert(document.getElementById('storage-security-badge').className.includes('is-encrypted'));

	// 4. showStorageUnlockModal with webauthn=false
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true, webauthn: false }));
	app.showStorageUnlockModal();
	assert.strictEqual(document.getElementById('webauthn-unlock-section').style.display, 'none');
	app.hideStorageUnlockModal();
	assert.strictEqual(document.getElementById('storage-lock-modal').style.display, 'none');

	// 5. handlePasswordUnlock with empty password
	document.getElementById('modal-unlock-pass').value = "";
	await app.handlePasswordUnlock();
	assert(document.getElementById('modal-unlock-error').textContent.includes("パスワードを入力してください"));

	// 6. openStorageSettingsModal and validateModalPasswords
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: false }));
	app.openStorageSettingsModal();
	assert(document.getElementById('settings-modal-body').innerHTML.includes("AES-256-GCM暗号化"));

	document.getElementById('modal-set-pass').value = "short";
	document.getElementById('modal-set-pass-confirm').value = "short";
	app.validateModalPasswords();
	assert(document.getElementById('modal-set-pass-msg').textContent.includes("12文字以上"));

	document.getElementById('modal-set-pass').value = "StrongPassword12345!@#";
	document.getElementById('modal-set-pass-confirm').value = "MismatchPassword999!@#";
	app.validateModalPasswords();
	assert(document.getElementById('modal-set-pass-msg').textContent.includes("一致していません"));

	document.getElementById('modal-set-pass-confirm').value = "StrongPassword12345!@#";
	app.validateModalPasswords();
	assert(document.getElementById('modal-set-pass-msg').textContent.includes("一致が確認できました"));

	// handleEnableEncryptionSubmit
	document.getElementById('modal-set-enable-bio').checked = false;
	await app.handleEnableEncryptionSubmit();
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);

	app.closeStorageSettingsModal();
	assert.strictEqual(document.getElementById('storage-settings-modal').style.display, 'none');

	// 7. quickSetupEncryptionFromCard
	cryptoLib.lockStorage();
	localStorage.removeItem('kogai_auth_meta');
	document.getElementById('d-pass').value = "weak";
	let alertMsg = "";
	global.alert = (m) => { alertMsg = m; };
	await app.quickSetupEncryptionFromCard('d-pass');
	assert(alertMsg.includes("12文字以上"));

	document.getElementById('d-pass').value = "ValidQuickPass12345!@#";
	await app.quickSetupEncryptionFromCard('d-pass');
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);

	// 8. loadAppDataFromStorage missing structures normalization
	cryptoLib.lockStorage();
	localStorage.removeItem('kogai_auth_meta');
	const mockD = {
		district: "正規化テスト地区",
		officer: { lastName: "旧役員" }
	};
	const mockR = {
		districts: [{
			district: "代表正規化地区",
			officer: { lastName: "旧代表" },
			students: [{ lastName: "旧生徒" }]
		}],
		szExternals: [{ lastName: "外部" }],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	localStorage.setItem('kogai_district_v2', JSON.stringify(mockD));
	localStorage.setItem('kogai_rep_v2', JSON.stringify(mockR));
	await app.loadAppDataFromStorage();
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.han, "");
	assert.strictEqual(state.currentDistrict.neighborhood.length, 1);
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.repState.districts[0].officers.length, 1);
	assert.strictEqual(state.repState.districts[0].han, "");

	// 9. Window event listeners
	// beforeinstallprompt event
	const mockEvt = { preventDefault: () => {} };
	window.dispatchEvent({ type: 'beforeinstallprompt', preventDefault: () => {} });
	assert.strictEqual(document.getElementById('pwa-install-btn').style.display, 'inline-flex');

	// DOMContentLoaded event when unencrypted
	cryptoLib.lockStorage();
	localStorage.removeItem('kogai_auth_meta');
	window.dispatchEvent({ type: 'DOMContentLoaded' });
	await new Promise(r => setTimeout(r, 50));
	assert(document.getElementById('storage-security-badge').className.includes('is-plain'));
});

test('branch-booster: print.js zero-officers and full print pipeline', () => {
	setupDomEnvironment();

	// 1. Single district with NO officers at all (both officers and officer are empty/undefined)
	const dZeroOff = {
		district: "役員皆無地区",
		han: "",
		officers: [],
		officer: null,
		neighborhood: [
			{ role: "", lastName: "", firstName: "", address: "", tel: "" }
		],
		students: [
			{ grade: "3", class: "", han: "", lastName: "児童", firstName: "次郎", address: "" }
		]
	};

	assert(print.buildStudentPageHtml(dZeroOff).includes("役員皆無地区"));
	assert(print.buildNeighborPageHtml(dZeroOff).includes("役員皆無地区"));
	assert(print.buildPtaOfficersRosterPageHtml([dZeroOff]).includes("PTA校外委員会"));
	assert(print.buildSchoolOfficersRosterPageHtml([dZeroOff], [dZeroOff]).includes("該当データなし"));
	assert.strictEqual(print.buildEnvelopesPagesHtml([dZeroOff]).length, 0);
	assert.strictEqual(print.buildSzTentCardsPagesHtml([dZeroOff], []).length, 0);
	assert.strictEqual(print.buildSzAttendance1PageHtml([dZeroOff], []).includes("PTA校外委員会（役員皆無地区）"), false);
	assert.strictEqual(print.buildSzAttendance2PageHtml([dZeroOff]).includes("役員皆無地区"), false);
	assert.strictEqual(print.buildSzMasterRosterPageHtml([dZeroOff], []).includes("PTA校外委員会（役員皆無地区）"), false);

	// 2. printSingleDistrictSelected with checked item
	state.currentDistrict = createMockDistrict();
	document.getElementById('d-print-students').checked = true;
	print.printSingleDistrictSelected();
	assert(document.getElementById('print-area').innerHTML.length > 0);

	// 3. executeRepSelectedPrint with valid targetDistricts and checked types
	state.repState = createMockRepState();
	state.repState.districts = [createMockDistrict({ selectedForPrint: true })];
	const chkR1 = new (document.createElement('input').constructor)('input');
	chkR1.value = 'all_students';
	chkR1.checked = true;
	const chkR2 = new (document.createElement('input').constructor)('input');
	chkR2.value = 'sz_att_3';
	chkR2.checked = true;
	document.querySelectorAll = (sel) => sel.includes(':checked') ? [chkR1, chkR2] : [];
	print.executeRepSelectedPrint();
	assert(document.getElementById('print-area').innerHTML.length > 0);
});

test('branch-booster: rep.js master export and dialog edge cases', async () => {
	setupDomEnvironment();

	// 1. exportRepMasterTxt success flow
	state.repState = createMockRepState();
	document.getElementById('rep-pass').value = "MasterPass12345!@#";
	document.getElementById('rep-pass-confirm').value = "MasterPass12345!@#";
	let exportedFile = "";
	global.downloadTextFile = (content, fname) => { exportedFile = fname; };
	await rep.exportRepMasterTxt();
	assert(exportedFile.includes("校外代表統合データ_"));

	// 2. runRepYearUpdate cancelled by confirm dialog
	global.confirm = () => false;
	const beforeYearCount = state.repState.districts.length;
	rep.runRepYearUpdate();
	assert.strictEqual(state.repState.districts.length, beforeYearCount);

	// 3. clearAllRepDistricts cancelled by confirm dialog
	rep.clearAllRepDistricts();
	assert.strictEqual(state.repState.districts.length, beforeYearCount);

	// 4. toggleSzNeighbor with invalid index
	rep.toggleSzNeighbor(999, 0, true);

	// 5. loadPastedTextToRep with han
	const singleHanObj = {
		district: "ペースト班地区",
		han: "南班",
		students: []
	};
	const encStr = await cryptoLib.encryptPayload(JSON.stringify(singleHanObj), "MasterPass12345!@#");
	document.getElementById('rep-paste-box').value = `BEGIN_DATA:\n${encStr}\n:END_DATA`;
	document.getElementById('rep-pass').value = "MasterPass12345!@#";
	let alertMsg = "";
	global.alert = (m) => { alertMsg = m; };
	await rep.loadPastedTextToRep();
	assert(alertMsg.includes("（南班）"));

	// 6. renderSzNeighborhoodSelector with empty districts and no-members district
	state.repState.districts = [];
	rep.renderSzNeighborhoodSelector();
	assert(document.getElementById('sz-neighborhood-selector').innerHTML.includes("地区データを読み込むと"));

	state.repState.districts = [{ district: "役員皆無地区", neighborhood: [] }];
	rep.renderSzNeighborhoodSelector();
	assert(document.getElementById('sz-neighborhood-selector').innerHTML.includes("自治会役員が登録されていません"));
});

test('branch-booster: district.js confirm cancellation and update branches', async () => {
	setupDomEnvironment();

	// 1. removeOfficer cancelled by confirm
	state.currentDistrict = createMockDistrict();
	state.currentDistrict.officers = [{ lastName: "一人目" }, { lastName: "二人目" }];
	global.confirm = () => false;
	district.removeOfficer(1);
	assert.strictEqual(state.currentDistrict.officers.length, 2);

	// 2. runDistrictYearUpdate cancelled by confirm
	district.runDistrictYearUpdate();
	assert.strictEqual(state.currentDistrict.officers.length, 2);

	// 3. runDistrictYearUpdate with student address and tel empty
	global.confirm = () => true;
	state.currentDistrict.students = [
		{ grade: "2", class: "1", lastName: "生徒", firstName: "太郎", address: "", tel: "" }
	];
	district.runDistrictYearUpdate();
	assert.strictEqual(state.currentDistrict.students[0].grade, "3");
});

test('branch-booster: app.js null checks and unlock success', async () => {
	setupDomEnvironment();

	// 1. updateSecurityBadge with null badge element
	document.elements['storage-security-badge'] = null;
	app.updateSecurityBadge('unencrypted');

	// 2. showStorageUnlockModal with null modal
	document.elements['storage-lock-modal'] = null;
	app.showStorageUnlockModal();

	// 3. openStorageSettingsModal with null modal
	document.elements['storage-settings-modal'] = null;
	app.openStorageSettingsModal();

	// 4. validateModalPasswords with null msgEl
	document.elements['modal-set-pass-msg'] = null;
	app.validateModalPasswords();

	// 5. handlePasswordUnlock success flow
	setupDomEnvironment();
	await cryptoLib.setupStorageEncryption("Password12345!@#", false);
	cryptoLib.lockStorage();
	document.getElementById('modal-unlock-pass').value = "Password12345!@#";
	await app.handlePasswordUnlock();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// 6. validateModalPasswords with p1 valid and p2 empty
	document.getElementById('modal-set-pass').value = "Password12345!@#";
	document.getElementById('modal-set-pass-confirm').value = "";
	app.validateModalPasswords();
	assert(document.getElementById('modal-set-pass-msg').textContent.includes("もう一度同じパスワードを入力してください"));
});

test('branch-booster: final sweep to exceed 95% branch coverage on all modules', async () => {
	setupDomEnvironment();

	// --- 1. print.js ---
	// setRepPrintChecks
	print.setRepPrintChecks(true);
	print.setRepPrintChecks(false);

	// printSingleDistrictSelected with all options checked
	state.currentDistrict = createMockDistrict();
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = true;
	document.getElementById('d-print-school').checked = true;
	document.getElementById('d-print-pta').checked = true;
	print.printSingleDistrictSelected();
	assert(document.getElementById('print-area').innerHTML.includes("PTA校外委員会"));

	// buildPtaOfficersRosterPageHtml with empty childGrade and childClass
	const dEmptyChildInfo = createMockDistrict({
		officers: [
			{ role: "副代表", lastName: "役", firstName: "員", tel: "", email: "", childGrade: "", childClass: "" }
		]
	});
	const ptaEmptyChild = print.buildPtaOfficersRosterPageHtml([dEmptyChildInfo]);
	assert(ptaEmptyChild.includes("-"));

	// buildSzMasterRosterPageHtml with neighbor empty address/tel
	const dEmptyNeighborContact = createMockDistrict({
		selectedForPrint: true,
		neighborhood: [
			{ role: "自治会長", lastName: "町", firstName: "内", address: "", tel: "" }
		],
		szNeighborChecks: { 0: true }
	});
	const masterEmptyContact = print.buildSzMasterRosterPageHtml([dEmptyNeighborContact], []);
	assert(masterEmptyContact.includes("自治会長"));

	// --- 2. district.js ---
	// officer with role "校外役員"
	state.currentDistrict = createMockDistrict({
		officers: [{ role: "校外役員", lastName: "役", firstName: "員" }]
	});
	district.renderOfficersList();
	assert(document.getElementById('officers-container').innerHTML.includes("校外役員"));

	// removeOfficer confirmed (returns true)
	state.currentDistrict.officers = [{ lastName: "一人目" }, { lastName: "二人目" }];
	global.confirm = () => true;
	district.removeOfficer(1);
	assert.strictEqual(state.currentDistrict.officers.length, 1);

	// exportDistrictTxt without confirmEl (passConfirm falls to pass)
	document.elements['d-pass-confirm'] = null;
	document.getElementById('d-name').value = "単一パス地区2";
	document.getElementById('d-pass').value = "Password12345!@#";
	state.currentDistrict = createMockDistrict({ district: "単一パス地区2", han: "" });
	document.getElementById('d-han-list').value = "";
	let exportedDistFile = "";
	global.downloadTextFile = (content, fname) => { exportedDistFile = fname; };
	await district.exportDistrictTxt();
	assert(exportedDistFile.includes("単一パス地区2"));

	// loadDistrictTxt with data having null neighborhood and null students
	const rawEmptyArrays = {
		district: "空配列地区",
		han: "",
		neighborhood: null,
		students: null
	};
	const encEmptyArr = await cryptoLib.encryptPayload(JSON.stringify(rawEmptyArrays), "Password12345!@#");
	const emptyArrFile = { name: "empty_arr.txt", text: async () => `BEGIN_DATA:\n${encEmptyArr}\n:END_DATA` };
	document.getElementById('d-pass').value = "Password12345!@#";
	await district.loadDistrictTxt({ target: { files: [emptyArrFile], value: 'fake.txt' } });
	assert(state.currentDistrict.district === "空配列地区");

	// --- 3. rep.js ---
	// runRepYearUpdate confirmed (returns true)
	state.repState = createMockRepState();
	global.confirm = () => true;
	rep.runRepYearUpdate();

	// clearAllRepDistricts confirmed (returns true)
	state.repState = createMockRepState();
	rep.clearAllRepDistricts();
	assert.strictEqual(state.repState.districts.length, 0);

	// exportRepMasterTxt without confirmEl (passConfirm falls to pass)
	document.elements['rep-pass-confirm'] = null;
	document.getElementById('rep-pass').value = "MasterPass12345!@#";
	await rep.exportRepMasterTxt();

	// loadMultipleDistrictFiles with master file having null fields
	const masterWithNulls = {
		isMaster: true,
		districts: [
			{
				district: "ヌル代表地区",
				han: "",
				officers: [],
				officer: null,
				neighborhood: null,
				students: null
			}
		],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	const encMasterNulls = await cryptoLib.encryptPayload(JSON.stringify(masterWithNulls), "MasterPass12345!@#");
	const masterNullFile = { name: "master_nulls.txt", text: async () => `BEGIN_DATA:\n${encMasterNulls}\n:END_DATA` };
	document.getElementById('rep-pass').value = "MasterPass12345!@#";
	await rep.loadMultipleDistrictFiles({ target: { files: [masterNullFile], value: 'fake.txt' } });
	assert(state.repState.districts.some(d => d.district === "ヌル代表地区"));

	// --- 4. app.js ---
	// handlePasswordUnlock failure catch block
	setupDomEnvironment();
	await cryptoLib.setupStorageEncryption("Password12345!@#", false);
	cryptoLib.lockStorage();
	document.getElementById('modal-unlock-pass').value = "WrongPassword999!@#";
	await app.handlePasswordUnlock();
	assert(document.getElementById('modal-unlock-error').textContent.includes("復号に失敗しました"));

	// DOMContentLoaded with localhost hostname and encrypted WebAuthn
	window.location.hostname = '127.0.0.1';
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true, webauthn: true }));
	window.dispatchEvent({ type: 'DOMContentLoaded' });
	await new Promise(r => setTimeout(r, 400));
});

test('branch-booster: operand coverage for student, officer, and neighbor filters', async () => {
	setupDomEnvironment();

	// 1. print.js: student filter operand branches (firstName, name, address)
	const dStudentsVariants = createMockDistrict({
		district: "条件網羅地区",
		students: [
			{ lastName: "姓のみ", firstName: "", name: "", address: "" },
			{ lastName: "", firstName: "名のみ", name: "", address: "" },
			{ lastName: "", firstName: "", name: "氏名のみ", address: "" },
			{ lastName: "", firstName: "", name: "", address: "住所のみ" }
		],
		officers: [
			{ lastName: "役員姓", firstName: "", role: "", tel: "" },
			{ lastName: "", firstName: "役員名", role: "", tel: "" },
			{ lastName: "", firstName: "", role: "役員職", tel: "" },
			{ lastName: "", firstName: "", role: "", tel: "090-1234-5678" }
		],
		neighborhood: [
			{ lastName: "自治姓", firstName: "", name: "", role: "", address: "" },
			{ lastName: "", firstName: "自治名", name: "", role: "", address: "" },
			{ lastName: "", firstName: "", name: "自治氏名", role: "", address: "" },
			{ lastName: "", firstName: "", name: "", role: "自治役職", address: "" },
			{ lastName: "", firstName: "", name: "", role: "", address: "自治住所" }
		]
	});

	print.buildStudentPageHtml(dStudentsVariants, null, [dStudentsVariants]);
	print.buildNeighborPageHtml(dStudentsVariants);
	print.buildSchoolOfficersRosterPageHtml([dStudentsVariants], [dStudentsVariants]);
	print.buildSzMasterRosterPageHtml([dStudentsVariants], []);
	print.buildPtaOfficersRosterPageHtml([dStudentsVariants]);

	// 2. rep.js: upsertRepDistrict null / missing properties
	rep.upsertRepDistrict({
		district: "欠落地区",
		officers: null,
		neighborhood: null,
		students: null,
		szNeighborChecks: null
	});
	rep.renderRepDistrictsTable();

	// rep.js: exportRepMasterTxt with confirmation mismatch
	document.getElementById('rep-pass').value = "MasterPass12345!@#";
	document.getElementById('rep-pass-confirm').value = "MismatchPass12345!@#";
	let repAlert = "";
	global.alert = (m) => { repAlert = m; };
	await rep.exportRepMasterTxt();
	assert(repAlert.includes("一致しません"));

	// 3. app.js: loadAppDataFromStorage catch blocks and ServiceWorker reject
	const origLoad = cryptoLib.loadStorageDecrypted;
	cryptoLib.loadStorageDecrypted = async (key) => {
		throw new Error("Simulated storage error for " + key);
	};
	await app.loadAppDataFromStorage();
	cryptoLib.loadStorageDecrypted = origLoad;

	// ServiceWorker registration error handler
	navigator.serviceWorker.register = async () => {
		throw new Error("Simulated SW error");
	};
	window.location.protocol = 'https:';
	window.dispatchEvent({ type: 'DOMContentLoaded' });
	await new Promise(r => setTimeout(r, 50));
});

test('branch-booster: final push for print.js, app.js, and rep.js to >= 95% branch coverage', async () => {
	setupDomEnvironment();

	// === app.js branches ===
	// 1. global.loadStorageDecrypted throw branches (lines 380-381, 421-422)
	const origGlobalLoad = global.loadStorageDecrypted;
	global.loadStorageDecrypted = async (key) => {
		throw new Error("Simulated storage load error for " + key);
	};
	await app.loadAppDataFromStorage();
	global.loadStorageDecrypted = origGlobalLoad;

	// 2. passInput is null in handlePasswordUnlock (line 129)
	document.elements['modal-unlock-pass'] = null;
	await app.handlePasswordUnlock();

	// 3. pEl is null in quickSetupEncryptionFromCard (line 348)
	let quickAlert = "";
	global.alert = (m) => { quickAlert = m; };
	await app.quickSetupEncryptionFromCard('null-input-id');

	// 4. isWebAuthnAvailable is false branches in openStorageSettingsModal (lines 204, 228)
	const origIsWebAuthn = global.isWebAuthnAvailable;
	global.isWebAuthnAvailable = () => false;
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: false }));
	app.openStorageSettingsModal();
	assert(document.getElementById('settings-modal-body').innerHTML.includes("※生体認証"));

	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true, webauthn: false }));
	app.openStorageSettingsModal();
	global.isWebAuthnAvailable = origIsWebAuthn;

	// 5. loadAppDataFromStorage district & student property normalization (lines 426-440)
	localStorage.removeItem('kogai_auth_meta');
	const rawUnsetDistrict = {
		district: "未定義地区",
		officers: [
			{ lastName: "未定役員" }
		],
		students: [
			{ lastName: "未定生徒" } // han undefined, isOutOfDistrict undefined
		]
	};
	localStorage.setItem('kogai_district_v2', JSON.stringify(rawUnsetDistrict));
	localStorage.setItem('kogai_rep_v2', JSON.stringify({
		districts: [rawUnsetDistrict],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	}));
	await app.loadAppDataFromStorage();
	assert.strictEqual(state.currentDistrict.han, "");
	assert.strictEqual(state.currentDistrict.students[0].isOutOfDistrict, false);
	assert.strictEqual(state.repState.districts[0].han, "");
	assert.strictEqual(state.repState.districts[0].students[0].isOutOfDistrict, false);

	// === rep.js branches ===
	// 1. addCurrentDistrictToRep and runRepYearUpdate with empty han (lines 120, 210)
	state.currentDistrict = createMockDistrict({ district: "無班代表地区", han: "" });
	rep.addCurrentDistrictToRep();

	state.repState.districts = [
		createMockDistrict({
			district: "無班役員地区",
			han: "",
			officers: [{ lastName: "", firstName: "", role: "" }], // line 30
			students: [{ grade: "", class: "", lastName: "" }] // line 257
		})
	];
	rep.renderRepDistrictsTable();
	global.confirm = () => true;
	rep.runRepYearUpdate();

	// 2. renderRepDistrictsTable with neighborhood members with only firstName, name, role (line 246)
	state.repState.districts = [
		createMockDistrict({
			district: "自治会詳細地区",
			neighborhood: [
				{ role: "", lastName: "", firstName: "名のみ" },
				{ role: "", lastName: "", name: "氏名のみ" },
				{ role: "役職のみ", lastName: "", firstName: "" }
			]
		})
	];
	rep.renderRepDistrictsTable();

	// === print.js branches ===
	// 1. reg_tent with empty han and empty role (lines 60, 61, 64)
	state.repState.districts = [
		createMockDistrict({
			district: "空役職地区",
			han: "",
			selectedForPrint: true,
			officers: [
				{ lastName: "無役", firstName: "太郎", role: "", han: "" }
			]
		})
	];
	const chkRegTent = new (document.createElement('input').constructor)('input');
	chkRegTent.value = 'reg_tent';
	chkRegTent.checked = true;
	document.querySelectorAll = (sel) => sel.includes(':checked') ? [chkRegTent] : [];
	print.executeRepSelectedPrint();

	// 2. buildSchoolOfficersRosterPageHtml empty address and tel (lines 434, 443)
	const dNoContact = createMockDistrict({
		district: "無連絡先地区",
		han: "",
		officers: [
			{ role: "校外委員", lastName: "無電", firstName: "話", address: "", tel: "", han: "" }
		]
	});
	const schoolHtml = print.buildSchoolOfficersRosterPageHtml([dNoContact], [dNoContact]);
	assert(schoolHtml.includes("無電 話"));

	// 3. buildEnvelopesPagesHtml with empty childKana and empty childClass (lines 535, 541)
	const dSimpleEnv = createMockDistrict({
		district: "簡易封筒地区",
		officers: [
			{
				role: "校外委員",
				lastName: "親",
				firstName: "太郎",
				childGrade: "4",
				childClass: "", // empty class
				childLastName: "子",
				childFirstName: "一郎",
				childLastNameKana: "", // empty kana
				childFirstNameKana: ""
			}
		]
	});
	const simpleEnvPages = print.buildEnvelopesPagesHtml([dSimpleEnv]);
	assert(simpleEnvPages.length > 0);

	// 4. buildSzTentCardsPagesHtml with empty han, empty role, empty mainKana (lines 566, 567, 570, 580, 590, 591, 603)
	const dSimpleSzTent = createMockDistrict({
		district: "簡素スクゾ地区",
		han: "",
		officers: [
			{
				role: "",
				han: "",
				lastName: "名札姓",
				firstName: "名札名",
				lastNameKana: "",
				firstNameKana: ""
			}
		]
	});
	const simpleSzCards = print.buildSzTentCardsPagesHtml([dSimpleSzTent], []);
	assert(simpleSzCards.length > 0);

	// 5. buildSzAttendance1PageHtml with empty han and empty role fallback to "校外委員" (lines 621, 623, 624)
	const dSimpleSzAtt1 = createMockDistrict({
		district: "簡素出席地区",
		han: "",
		officers: [
			{ role: "", han: "", lastName: "出席者", firstName: "太郎" }
		]
	});
	const att1Html = print.buildSzAttendance1PageHtml([dSimpleSzAtt1], []);
	assert(att1Html.includes("校外委員"));

	// 6. buildSzSeatChartPageHtml with facility without customText and ref missing (line 772)
	state.repState = createMockRepState();
	state.repState.seatConfig.cells = {
		"0_0": { refKey: "FAC_STAGE", customText: "" },
		"0_1": { refKey: "FAC_NONEXISTENT", customText: "" }
	};
	const seatChartHtml = print.buildSzSeatChartPageHtml();
	assert(seatChartHtml.includes("is-facility"));
});

test('branch-booster: neighbor.js, district.js, rep.js, app.js, state.js exhaustive branch coverage to exceed 95% on all modules', async () => {
	setupDomEnvironment();
	const pass = "BranchPass12345!@#";

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// ==========================================
	// 1. neighbor.js branch coverage
	// ==========================================

	// 1.1 renderNeighborForm with missing neighbor-district-name element
	document.elements['neighbor-district-name'] = null;
	neighbor.renderNeighborForm();

	// 1.2 renderNeighborTable with missing neighbor-tbody element
	document.elements['neighbor-tbody'] = null;
	neighbor.renderNeighborTable();

	// 1.3 renderNeighborTable with null neighborhood
	setupDomEnvironment();
	state.neighborState = { district: "", neighborhood: null };
	neighbor.renderNeighborTable();
	assert(document.getElementById('neighbor-tbody').innerHTML.includes("自治会役員がまだ登録されていません"));

	// 1.4 renderNeighborTable with 3 rows (testing top, middle, bottom button disabled states)
	state.neighborState.neighborhood = [
		{ role: "役員1", lastName: "一" },
		{ role: "役員2", lastName: "二" },
		{ role: "役員3", lastName: "三" }
	];
	neighbor.renderNeighborTable();
	const tbody = document.getElementById('neighbor-tbody');
	assert(tbody.innerHTML.includes("disabled"));

	// 1.5 addNeighborRow with null neighborhood (line 61)
	state.neighborState.neighborhood = null;
	neighbor.addNeighborRow();
	assert.strictEqual(state.neighborState.neighborhood.length, 1);

	// 1.6 removeNeighborRow edge cases (line 78, 80, 81)
	// null neighborhood
	state.neighborState.neighborhood = null;
	neighbor.removeNeighborRow(0);

	// out of bounds idx
	state.neighborState.neighborhood = [
		{ role: "", lastName: "姓のみ", firstName: "" },
		{ role: "", lastName: "", firstName: "名のみ" },
		{ role: "役職のみ", lastName: "", firstName: "" },
		{ role: "", lastName: "", firstName: "" }
	];
	neighbor.removeNeighborRow(-1);
	neighbor.removeNeighborRow(100);

	// name resolution: user cancels confirm
	global.confirm = () => false;
	neighbor.removeNeighborRow(0); // lastName only
	neighbor.removeNeighborRow(1); // firstName only
	neighbor.removeNeighborRow(2); // role only
	neighbor.removeNeighborRow(3); // fallback to '行 4'
	assert.strictEqual(state.neighborState.neighborhood.length, 4);

	// user accepts confirm
	global.confirm = () => true;
	neighbor.removeNeighborRow(3);
	assert.strictEqual(state.neighborState.neighborhood.length, 3);

	// 1.7 moveNeighborRow edge cases (lines 88, 90)
	state.neighborState.neighborhood = null;
	neighbor.moveNeighborRow(0, 1);

	state.neighborState.neighborhood = [{ role: "A" }, { role: "B" }];
	neighbor.moveNeighborRow(0, -1); // targetIdx < 0
	neighbor.moveNeighborRow(1, 1);  // targetIdx >= length

	// 1.8 updateNeighborItem edge cases (line 99)
	state.neighborState.neighborhood = null;
	neighbor.updateNeighborItem(0, 'role', 'test');
	state.neighborState.neighborhood = [{ role: "A" }];
	neighbor.updateNeighborItem(5, 'role', 'test');

	// 1.9 validateNeighborPasswords edge cases (lines 108, 111, 113, 126)
	// missing passEl or msgEl
	document.elements['neighbor-pass'] = null;
	neighbor.validateNeighborPasswords();

	setupDomEnvironment();
	document.elements['neighbor-pass-match-msg'] = null;
	neighbor.validateNeighborPasswords();

	setupDomEnvironment();
	// missing confirmEl
	document.elements['neighbor-pass-confirm'] = null;
	document.getElementById('neighbor-pass').value = "";
	neighbor.validateNeighborPasswords();

	setupDomEnvironment();
	// both empty
	document.getElementById('neighbor-pass').value = "";
	document.getElementById('neighbor-pass-confirm').value = "";
	neighbor.validateNeighborPasswords();

	// valid pass, empty confirm (line 126)
	document.getElementById('neighbor-pass').value = pass;
	document.getElementById('neighbor-pass-confirm').value = "";
	neighbor.validateNeighborPasswords();
	assert.strictEqual(document.getElementById('neighbor-pass-match-msg').textContent, "確認用パスワードを入力してください");

	// 1.10 exportNeighborTxt edge cases (lines 148, 150)
	// missing passEl
	document.elements['neighbor-pass'] = null;
	state.neighborState.district = "町会";
	await neighbor.exportNeighborTxt();

	// missing confirmEl (falls back to passConfirm = pass)
	setupDomEnvironment();
	document.getElementById('neighbor-district-name').value = "町会";
	state.neighborState.district = "町会";
	document.getElementById('neighbor-pass').value = pass;
	document.elements['neighbor-pass-confirm'] = null;
	let downloaded = null;
	global.downloadTextFile = (c, f) => { downloaded = { c, f }; };
	await neighbor.exportNeighborTxt();
	assert(downloaded);

	// 1.11 copyNeighborEncryptedText edge cases (lines 202-215)
	// navigator.clipboard is falsy
	navigator.clipboard = null;
	downloaded = null;
	await neighbor.copyNeighborEncryptedText();
	assert(document.getElementById('neighbor-paste-box').value.includes("BEGIN_DATA:"));

	// box is null
	document.elements['neighbor-paste-box'] = null;
	await neighbor.copyNeighborEncryptedText();

	// box has no select function
	setupDomEnvironment();
	document.getElementById('neighbor-district-name').value = "町会";
	state.neighborState.district = "町会";
	document.getElementById('neighbor-pass').value = pass;
	const pBox = document.getElementById('neighbor-paste-box');
	delete pBox.select;
	navigator.clipboard = null;
	await neighbor.copyNeighborEncryptedText();
	assert(pBox.value.includes("BEGIN_DATA:"));

	// 1.12 loadNeighborTxt edge cases (lines 221, 227-234, 244, 247)
	setupDomEnvironment();
	// missing passEl
	document.elements['neighbor-pass'] = null;
	await neighbor.loadNeighborTxt({ target: { files: [] } });

	// prompt cancel on decrypt failure (line 229)
	global.prompt = () => null;
	const dummyFile = { text: async () => "INVALID_CIPHER_TEXT" };
	const dummyTarget = { files: [dummyFile], value: "test.txt" };
	await neighbor.loadNeighborTxt({ target: dummyTarget });
	assert.strictEqual(dummyTarget.value, "");

	// prompt success on decrypt failure, with passEl missing
	setupDomEnvironment();
	document.elements['neighbor-pass'] = null;
	const validEnc = await cryptoLib.encryptPayload(JSON.stringify({ isNeighborhoodData: true, district: "復号町", neighborhood: [] }), pass);
	const validFile = { text: async () => `BEGIN_DATA:\n${validEnc}\n:END_DATA` };
	global.prompt = () => pass;
	await neighbor.loadNeighborTxt({ target: { files: [validFile], value: "test.txt" } });
	assert.strictEqual(state.neighborState.district, "復号町");

	// data format mismatch (line 244)
	setupDomEnvironment();
	const invalidFormatEnc = await cryptoLib.encryptPayload(JSON.stringify({ notNeighborhood: true }), pass);
	document.getElementById('neighbor-pass').value = pass;
	await neighbor.loadNeighborTxt({ target: { files: [{ text: async () => `BEGIN_DATA:\n${invalidFormatEnc}\n:END_DATA` }], value: "test.txt" } });
	assert((global.__lastAlert || alertMsg).includes("フォーマットが一致しません"));

	// outer catch error (line 247)
	const throwFile = { text: async () => { throw new Error("Disk read error"); } };
	await neighbor.loadNeighborTxt({ target: { files: [throwFile], value: "test.txt" } });
	assert((global.__lastAlert || alertMsg).includes("失敗しました"));

	// 1.13 loadPastedTextToNeighbor edge cases (lines 254, 256, 264, 268, 280, 283)
	// missing box
	document.elements['neighbor-paste-box'] = null;
	await neighbor.loadPastedTextToNeighbor();

	setupDomEnvironment();
	// empty raw text
	document.getElementById('neighbor-paste-box').value = "   ";
	await neighbor.loadPastedTextToNeighbor();

	// prompt cancel
	document.getElementById('neighbor-paste-box').value = "corrupt";
	document.getElementById('neighbor-pass').value = "wrong";
	global.prompt = () => null;
	await neighbor.loadPastedTextToNeighbor();

	// prompt success with missing passEl
	setupDomEnvironment();
	document.elements['neighbor-pass'] = null;
	document.getElementById('neighbor-paste-box').value = `BEGIN_DATA:\n${validEnc}\n:END_DATA`;
	global.prompt = () => pass;
	await neighbor.loadPastedTextToNeighbor();
	assert.strictEqual(state.neighborState.district, "復号町");

	// data format mismatch
	setupDomEnvironment();
	document.getElementById('neighbor-pass').value = pass;
	document.getElementById('neighbor-paste-box').value = `BEGIN_DATA:\n${invalidFormatEnc}\n:END_DATA`;
	await neighbor.loadPastedTextToNeighbor();
	assert((global.__lastAlert || alertMsg).includes("フォーマットが一致しません"));

	// outer catch error (line 283)
	document.getElementById('neighbor-paste-box').value = "THIS IS NOT CIPHER TEXT AT ALL";
	global.prompt = () => "somepass";
	await neighbor.loadPastedTextToNeighbor();
	assert((global.__lastAlert || alertMsg).includes("復号に失敗しました"));

	// 1.14 runNeighborYearUpdate cancel and null neighborhood (lines 288, 289)
	global.confirm = () => false;
	neighbor.runNeighborYearUpdate();
	global.confirm = () => true;
	state.neighborState.neighborhood = null;
	neighbor.runNeighborYearUpdate();

	// 1.15 printNeighborRoster edge cases (lines 306, 311)
	state.neighborState.neighborhood = null;
	neighbor.printNeighborRoster();
	assert((global.__lastAlert || alertMsg).includes("登録されていません"));

	state.neighborState.neighborhood = [{ role: "会長", lastName: "山" }];
	document.elements['print-area'] = null;
	neighbor.printNeighborRoster();

	// 1.16 printNeighborTentCards edge cases (lines 322, 327, 330, 332)
	setupDomEnvironment();
	// all empty names
	state.neighborState.neighborhood = [{ role: "会長", lastName: "", firstName: "" }];
	neighbor.printNeighborTentCards();
	assert((global.__lastAlert || alertMsg).includes("氏名が入力されていません"));

	// missing printArea
	state.neighborState.neighborhood = [{ role: "", lastName: "山", firstName: "" }];
	document.elements['print-area'] = null;
	neighbor.printNeighborTentCards();

	// kana combinations: lastNameKana only, firstNameKana only, empty role
	setupDomEnvironment();
	state.neighborState.district = ""; // fallback to '自治会'
	state.neighborState.neighborhood = [
		{ role: "", lastName: "山田", firstName: "太郎", lastNameKana: "やまだ", firstNameKana: "" },
		{ role: "副", lastName: "佐藤", firstName: "花子", lastNameKana: "", firstNameKana: "はなこ" },
		{ role: "", lastName: "鈴木", firstName: "一郎", lastNameKana: "", firstNameKana: "" }
	];
	let tentPrinted = false;
	window.print = () => { tentPrinted = true; };
	neighbor.printNeighborTentCards();
	assert.strictEqual(tentPrinted, true);
	assert(document.getElementById('print-area').innerHTML.includes("自治会"));

	// ==========================================
	// 2. district.js branch coverage
	// ==========================================
	// 2.1 loadDistrictTxt prompt fallback cancel (lines 441-444)
	setupDomEnvironment();
	document.getElementById('d-pass').value = "wrong_password";
	global.prompt = () => null; // cancel
	const distTarget = { files: [{ text: async () => "BEGIN_DATA:\nBAD_DATA\n:END_DATA" }], value: "test.txt" };
	await district.loadDistrictTxt({ target: distTarget });
	assert.strictEqual(distTarget.value, "");

	// 2.2 mergeNeighborDataIntoDistrict: data falsy and else if (dName && !curName) (lines 473, 481-485)
	district.mergeNeighborDataIntoDistrict(null);

	state.currentDistrict = createMockDistrict({ district: "" });
	document.getElementById('d-name').value = "";
	district.mergeNeighborDataIntoDistrict({
		isNeighborhoodData: true,
		district: "自動設定地区",
		neighborhood: [{ role: "会長", lastName: "新田" }]
	});
	assert.strictEqual(state.currentDistrict.district, "自動設定地区");
	assert.strictEqual(document.getElementById('d-name').value, "自動設定地区");

	// 2.3 loadNeighborFileIntoDistrict edge cases (lines 496, 497, 504-507, 510-511)
	await district.loadNeighborFileIntoDistrict({ target: { files: [] } });

	// missing d-pass
	document.elements['d-pass'] = null;
	global.prompt = () => null;
	const nTarget = { files: [{ text: async () => "BEGIN_DATA:\nBAD\n:END_DATA" }], value: "test.txt" };
	await district.loadNeighborFileIntoDistrict({ target: nTarget });
	assert.strictEqual(nTarget.value, "");

	// corrupt file throwing outer error
	const throwNF = { text: async () => { throw new Error("Read err"); } };
	await district.loadNeighborFileIntoDistrict({ target: { files: [throwNF], value: "test.txt" } });
	assert((global.__lastAlert || alertMsg).includes("読み込みに失敗しました"));

	// 2.4 toggleCard null and missing toggleBtn (lines 516, 519)
	district.toggleCard(null);
	const dummyCard = document.createElement('div');
	district.toggleCard(dummyCard);
	assert(dummyCard.classList.contains('is-collapsed'));

	// 2.5 setAllCardsCollapse container null (line 525)
	district.setAllCardsCollapse(true, 'nonexistent-container-id');

	// ==========================================
	// 3. rep.js branch coverage
	// ==========================================
	// 3.1 mergeNeighborDataIntoRep: falsy, empty nList, no 会長 (lines 64, 73-75, 84-93)
	rep.mergeNeighborDataIntoRep(null);

	// empty nList
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	rep.mergeNeighborDataIntoRep({ district: "空町会", neighborhood: [] });
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].district, "空町会");

	// nList with no role containing "会長" -> defaultChecks[0] = true
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	rep.mergeNeighborDataIntoRep({
		district: "役員町会",
		neighborhood: [
			{ role: "会計", lastName: "金" },
			{ role: "書記", lastName: "筆" }
		]
	});
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true);

	// 3.2 loadMultipleDistrictFiles prompt cancel (line 108)
	setupDomEnvironment();
	document.getElementById('rep-pass').value = "wrong_password";
	global.prompt = () => null;
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => "BEGIN_DATA:\nBAD_DATA\n:END_DATA" }],
			value: "test.txt"
		}
	});

	// 3.3 loadPastedTextToRep edge cases (lines 141, 143, 148, 161)
	document.elements['rep-paste-box'] = null;
	await rep.loadPastedTextToRep();

	setupDomEnvironment();
	document.getElementById('rep-paste-box').value = "";
	await rep.loadPastedTextToRep();

	document.getElementById('rep-paste-box').value = "CORRUPT_PASTE_DATA";
	document.getElementById('rep-pass').value = "wrong";
	global.prompt = () => null;
	await rep.loadPastedTextToRep();

	// outer catch error
	document.getElementById('rep-paste-box').value = "CORRUPT_PASTE_DATA";
	global.prompt = () => "anypass";
	await rep.loadPastedTextToRep();
	assert((global.__lastAlert || alertMsg).includes("復号に失敗しました"));

	// ==========================================
	// 4. app.js & state.js branch coverage
	// ==========================================
	// 4.1 loadAppDataFromStorage with savedNeighbor (app.js lines 461-462)
	setupDomEnvironment();
	await cryptoLib.setupStorageEncryption(pass, false);
	await cryptoLib.saveStorageData('kogai_neighbor_v2', {
		district: "保存町会",
		neighborhood: [{ role: "会長", lastName: "保存", firstName: "太郎" }]
	});
	await app.loadAppDataFromStorage();
	assert.strictEqual(state.neighborState.district, "保存町会");

	// 4.2 saveNeighborLocal when neighbor-district-name is null (state.js line 138)
	document.elements['neighbor-district-name'] = null;
	state.saveNeighborLocal();

	// 4.3 state.js: dHanListEl empty value, dHanListEl & dHanEl null, officerBoxes empty, missing labels/bars
	setupDomEnvironment();
	document.getElementById('d-name').value = "地区X";
	document.getElementById('d-han-list').value = ""; // dHanListEl.value empty -> han = ""
	await state.saveDistrictLocal();
	assert.strictEqual(state.currentDistrict.han, "");

	document.elements['d-han-list'] = null;
	document.elements['d-han'] = null;
	await state.saveDistrictLocal(); // dHanListEl null and dHanEl null

	// officerBoxes.length === 0
	document.getElementById('officers-container').innerHTML = "";
	const oldOfficers = state.currentDistrict.officers;
	await state.saveDistrictLocal();
	assert.strictEqual(state.currentDistrict.officers, oldOfficers);

	// saveRepLocal with missing elements
	document.elements['seat-top-label'] = null;
	await state.saveRepLocal();

	setupDomEnvironment();
	document.elements['seat-top-bar-view'] = null;
	document.elements['seat-bottom-bar-view'] = null;
	await state.saveRepLocal();

	// 1.17 neighbor.js: renderNeighborForm empty district, non-array neighborhood in load/paste
	setupDomEnvironment();
	state.neighborState.district = "";
	neighbor.renderNeighborForm();

	// loadNeighborTxt with non-array neighborhood
	const notArrayEnc = await cryptoLib.encryptPayload(JSON.stringify({ district: "町", neighborhood: "NOT_AN_ARRAY" }), pass);
	document.getElementById('neighbor-pass').value = pass;
	await neighbor.loadNeighborTxt({ target: { files: [{ text: async () => `BEGIN_DATA:\n${notArrayEnc}\n:END_DATA` }], value: "test.txt" } });

	// loadPastedTextToNeighbor with non-array neighborhood
	document.getElementById('neighbor-paste-box').value = `BEGIN_DATA:\n${notArrayEnc}\n:END_DATA`;
	await neighbor.loadPastedTextToNeighbor();

	// printNeighborRoster & printNeighborTentCards with empty district name fallback
	state.neighborState = {
		district: "",
		neighborhood: [
			{ role: "", lastName: "名無", firstName: "太郎", lastNameKana: "ななし", firstNameKana: "" }
		]
	};
	neighbor.printNeighborRoster();
	neighbor.printNeighborTentCards();

	// 3.4 rep.js remaining branches
	// upsertRepDistrict: d.hanList === undefined, s.han === undefined, s.isOutOfDistrict === undefined
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	rep.upsertRepDistrict({
		district: "未定義地区",
		officers: [{ lastName: "役員", firstName: "A" }],
		students: [{ lastName: "生徒", firstName: "A" }] // han and isOutOfDistrict undefined
	});
	assert.strictEqual(state.repState.districts[0].students[0].han, "");
	assert.strictEqual(state.repState.districts[0].students[0].isOutOfDistrict, false);

	// loadPastedTextToRep with empty district name and hanMsg empty
	const simpleNeighborEnc = await cryptoLib.encryptPayload(JSON.stringify({ isNeighborhoodData: true, district: "", neighborhood: [] }), pass);
	document.getElementById('rep-paste-box').value = `BEGIN_DATA:\n${simpleNeighborEnc}\n:END_DATA`;
	document.getElementById('rep-pass').value = pass;
	await rep.loadPastedTextToRep();

	// loadPastedTextToRep with district without han
	const noHanDistEnc = await cryptoLib.encryptPayload(JSON.stringify({ district: "班なし地区", students: [] }), pass);
	document.getElementById('rep-paste-box').value = `BEGIN_DATA:\n${noHanDistEnc}\n:END_DATA`;
	await rep.loadPastedTextToRep();

	// addCurrentDistrictToRep with empty district name
	state.currentDistrict.district = "";
	document.getElementById('d-name').value = "";
	rep.addCurrentDistrictToRep();

	// validateRepPasswords edge cases
	document.elements['rep-pass'] = null;
	rep.validateRepPasswords();

	setupDomEnvironment();
	document.elements['rep-pass-match-msg'] = null;
	rep.validateRepPasswords();

	setupDomEnvironment();
	document.elements['rep-pass-confirm'] = null;
	document.getElementById('rep-pass').value = "";
	rep.validateRepPasswords();

	document.getElementById('rep-pass').value = pass;
	document.elements['rep-pass-confirm'] = null;
	rep.validateRepPasswords();

	// exportRepMasterTxt with confirmEl missing
	setupDomEnvironment();
	document.getElementById('rep-pass').value = pass;
	document.elements['rep-pass-confirm'] = null;
	await rep.exportRepMasterTxt();

	// clearAllRepDistricts cancel
	global.confirm = () => false;
	rep.clearAllRepDistricts();

	// renderSzNeighborhoodSelector when districts have no valid neighbors
	state.repState.districts = [{ district: "無役員地区", neighborhood: [] }];
	rep.renderSzNeighborhoodSelector();

	// toggleSzNeighbor with invalid dIdx
	rep.toggleSzNeighbor(999, 0, true);

	// toggleSzNeighbor when d.szNeighborChecks is null
	state.repState.districts[0].szNeighborChecks = null;
	rep.toggleSzNeighbor(0, 0, true);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true);

	// 4.4 state.js module exports getters when globals are undefined
	const savedGD = global.currentDistrict;
	const savedGR = global.repState;
	const savedGN = global.neighborState;
	delete global.currentDistrict;
	delete global.repState;
	delete global.neighborState;
	assert(state.currentDistrict);
	assert(state.repState);
	assert(state.neighborState);
	global.currentDistrict = savedGD;
	global.repState = savedGR;
	global.neighborState = savedGN;

	// 1.18 neighbor.js row with undefined subfields for || '' branches
	state.neighborState.neighborhood = [{}];
	neighbor.renderNeighborTable();

	// 3.5 rep.js upsertRepDistrict existingIdx >= 0 with selectedForPrint false and szNeighborChecks null
	state.repState = {
		districts: [{
			district: "既存地区",
			han: "1班",
			officers: [],
			neighborhood: [{ role: "会長", lastName: "山" }],
			students: [],
			selectedForPrint: false,
			szNeighborChecks: null
		}],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	rep.upsertRepDistrict({
		district: "既存地区",
		han: "1班",
		officers: [],
		neighborhood: [{ role: "会長", lastName: "山" }],
		students: []
	});
	assert.strictEqual(state.repState.districts[0].selectedForPrint, false);

	// rep.js renderRepDistrictsTable with empty officer names and empty child info
	state.repState.districts = [{
		district: "未入力地区",
		han: "",
		officers: [{ role: "", lastName: "", firstName: "" }],
		neighborhood: [],
		students: [],
		selectedForPrint: true
	}];
	rep.renderRepDistrictsTable();

	// rep.js loadPastedTextToRep with data.han present
	const withHanEnc = await cryptoLib.encryptPayload(JSON.stringify({ district: "班あり地区", han: "東班", students: [] }), pass);
	document.getElementById('rep-paste-box').value = `BEGIN_DATA:\n${withHanEnc}\n:END_DATA`;
	document.getElementById('rep-pass').value = pass;
	await rep.loadPastedTextToRep();

	// rep.js loadRepMasterTxt with d.han undefined and d.officers empty
	const masterWithLegacyEnc = await cryptoLib.encryptPayload(JSON.stringify({
		districts: [{ district: "マスター地区", officer: { lastName: "代表" }, officers: [], students: [{ lastName: "生" }] }]
	}), pass);
	await rep.loadRepMasterTxt({ target: { files: [{ text: async () => `BEGIN_DATA:\n${masterWithLegacyEnc}\n:END_DATA` }] } });

	// neighbor.js: moveNeighborRow out of bounds idx
	neighbor.moveNeighborRow(-1, 1);
	neighbor.moveNeighborRow(999, -1);

	// neighbor.js: navigator.clipboard exists but writeText is undefined
	navigator.clipboard = {};
	await neighbor.copyNeighborEncryptedText();

	// neighbor.js: validateNeighborPasswords when confirmEl is null and pass is valid
	setupDomEnvironment();
	document.elements['neighbor-pass-confirm'] = null;
	document.getElementById('neighbor-pass').value = pass;
	neighbor.validateNeighborPasswords();
	assert.strictEqual(document.getElementById('neighbor-pass-match-msg').textContent, "確認用パスワードを入力してください");

	// neighbor.js: printNeighborTentCards with district name set and different ruby combinations
	setupDomEnvironment();
	state.neighborState.district = "特定町会";
	state.neighborState.neighborhood = [
		{ role: "役員A", lastName: "姓のみ", firstName: "", lastNameKana: "せー", firstNameKana: "" },
		{ role: "", lastName: "", firstName: "名のみ", lastNameKana: "", firstNameKana: "めー" },
		{ role: "役員C", lastName: "姓名", firstName: "両方", lastNameKana: "せい", firstNameKana: "めい" },
		{ role: "役員D", lastName: "カナなし", firstName: "太郎", lastNameKana: "", firstNameKana: "" }
	];
	neighbor.printNeighborTentCards();

	// rep.js: loadMultipleDistrictFiles with neighborhood file without isNeighborhoodData flag
	const plainNeighborDataEnc = await cryptoLib.encryptPayload(JSON.stringify({ neighborhood: [{ role: "会長", lastName: "旗" }] }), pass);
	// and a file with invalid districts type (not array)
	const invalidDistrictsEnc = await cryptoLib.encryptPayload(JSON.stringify({ districts: "NOT_AN_ARRAY" }), pass);
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [
				{ text: async () => `BEGIN_DATA:\n${plainNeighborDataEnc}\n:END_DATA` },
				{ text: async () => `BEGIN_DATA:\n${invalidDistrictsEnc}\n:END_DATA` },
				{ text: async () => "CORRUPT_TO_TRIGGER_NG_COUNT" }
			],
			value: "multi"
		}
	});

	// rep.js: upsertRepDistrict with existingIdx >= 0 and szNeighborChecks truthy
	state.repState = {
		districts: [{
			district: "チェックあり地区",
			han: "1班",
			officers: [{ role: "校外委員", lastName: "役員", firstName: "", childGrade: "", childClass: "", childLastName: "子", childFirstName: "太郎" }],
			neighborhood: [{ role: "会長", lastName: "山" }],
			students: [],
			selectedForPrint: true,
			szNeighborChecks: { 0: true }
		}],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	rep.upsertRepDistrict({
		district: "チェックあり地区",
		han: "1班",
		officers: [{ role: "校外委員", lastName: "役員", firstName: "", childGrade: "", childClass: "", childLastName: "子", childFirstName: "太郎" }],
		neighborhood: [{ role: "会長", lastName: "山" }],
		students: []
	});
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true);
	rep.renderRepDistrictsTable();
});

test('branch-booster: neighbor.js and rep.js 100% branch perfection', async () => {
	setupDomEnvironment();
	const pass = "ValidPass123!@#";

	// === NEIGHBOR.JS BRANCHES ===
	// 1. renderNeighborTable: multiple rows (i=0, i=1, i=2), empty vs non-empty fields
	state.neighborState.district = "テスト地区";
	state.neighborState.neighborhood = [
		{ role: "", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", email: "", note: "" },
		{ role: "副会長", lastName: "田中", firstName: "太郎", lastNameKana: "たなか", firstNameKana: "たろう", address: "1-1", tel: "090", email: "a@b.com", note: "備考" },
		{ role: "役員", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", email: "", note: "" }
	];
	neighbor.renderNeighborTable();

	// 2. removeNeighborRow edge cases
	// idx out of bounds or negative
	neighbor.removeNeighborRow(-1);
	neighbor.removeNeighborRow(99);
	const savedStateNeighborhood = state.neighborState.neighborhood;
	state.neighborState.neighborhood = null;
	neighbor.removeNeighborRow(0);
	state.neighborState.neighborhood = savedStateNeighborhood;

	// confirm = false
	global.confirm = () => false;
	neighbor.removeNeighborRow(1);
	assert.strictEqual(state.neighborState.neighborhood.length, 3);

	// confirm = true: row with role only
	global.confirm = () => true;
	neighbor.removeNeighborRow(2); // row with role "役員", no names -> uses role
	assert.strictEqual(state.neighborState.neighborhood.length, 2);

	// confirm = true: row with neither role nor names -> uses "行 1"
	neighbor.removeNeighborRow(0);
	assert.strictEqual(state.neighborState.neighborhood.length, 1);

	// 3. moveNeighborRow edge cases
	state.neighborState.neighborhood = [{ role: "A" }, { role: "B" }];
	// targetIdx < 0
	neighbor.moveNeighborRow(0, -1);
	// targetIdx >= length
	neighbor.moveNeighborRow(1, 1);
	// neighborState.neighborhood is null
	state.neighborState.neighborhood = null;
	neighbor.moveNeighborRow(0, 1);
	state.neighborState.neighborhood = [{ role: "A" }, { role: "B" }];

	// 4. updateNeighborItem edge cases
	neighbor.updateNeighborItem(0, 'role', '新会長');
	neighbor.updateNeighborItem(999, 'role', '無効');
	state.neighborState.neighborhood = null;
	neighbor.updateNeighborItem(0, 'role', '無効');
	state.neighborState.neighborhood = [];

	// 5. validateNeighborPasswords edge cases
	setupDomEnvironment();
	// passEl or msgEl missing
	document.elements['neighbor-pass'] = null;
	neighbor.validateNeighborPasswords();
	setupDomEnvironment();
	document.elements['neighbor-pass-match-msg'] = null;
	neighbor.validateNeighborPasswords();

	setupDomEnvironment();
	// empty pass & empty confirm
	document.getElementById('neighbor-pass').value = "";
	document.getElementById('neighbor-pass-confirm').value = "";
	neighbor.validateNeighborPasswords();
	assert.strictEqual(document.getElementById('neighbor-pass-match-msg').textContent, "");

	// invalid pass
	document.getElementById('neighbor-pass').value = "short";
	neighbor.validateNeighborPasswords();
	assert(document.getElementById('neighbor-pass-match-msg').textContent.includes("⚠"));

	// valid pass, empty confirm
	document.getElementById('neighbor-pass').value = pass;
	document.getElementById('neighbor-pass-confirm').value = "";
	neighbor.validateNeighborPasswords();
	assert.strictEqual(document.getElementById('neighbor-pass-match-msg').textContent, "確認用パスワードを入力してください");

	// valid pass, mismatched confirm
	document.getElementById('neighbor-pass-confirm').value = pass + "XYZ";
	neighbor.validateNeighborPasswords();
	assert.strictEqual(document.getElementById('neighbor-pass-match-msg').textContent, "⚠ パスワードが一致しません");

	// valid pass, matched confirm
	document.getElementById('neighbor-pass-confirm').value = pass;
	neighbor.validateNeighborPasswords();
	assert(document.getElementById('neighbor-pass-match-msg').textContent.includes("✓"));

	// 6. exportNeighborTxt edge cases
	// district empty
	document.getElementById('neighbor-district-name').value = "";
	state.neighborState.district = "";
	await neighbor.exportNeighborTxt();

	// pass invalid
	document.getElementById('neighbor-district-name').value = "町内会";
	state.neighborState.district = "町内会";
	document.getElementById('neighbor-pass').value = "bad";
	await neighbor.exportNeighborTxt();

	// confirmEl exists and mismatch
	document.getElementById('neighbor-pass').value = pass;
	document.getElementById('neighbor-pass-confirm').value = "DifferentPass123!";
	await neighbor.exportNeighborTxt();

	// confirmEl is null -> falls back to pass
	document.elements['neighbor-pass-confirm'] = null;
	state.neighborState.neighborhood = null; // triggers fallback to []
	await neighbor.exportNeighborTxt();

	// 7. copyNeighborEncryptedText edge cases
	setupDomEnvironment();
	document.getElementById('neighbor-district-name').value = "";
	state.neighborState.district = "";
	await neighbor.copyNeighborEncryptedText();

	document.getElementById('neighbor-district-name').value = "町内会";
	state.neighborState.district = "町内会";
	document.getElementById('neighbor-pass').value = "bad";
	await neighbor.copyNeighborEncryptedText();

	document.getElementById('neighbor-pass').value = pass;
	// clipboard writeText throws -> fallback to box with select
	let selectCalled = false;
	document.getElementById('neighbor-paste-box').select = () => { selectCalled = true; };
	navigator.clipboard = {
		writeText: async () => { throw new Error("Clipboard permission denied"); }
	};
	await neighbor.copyNeighborEncryptedText();
	assert.strictEqual(selectCalled, true);

	// box is missing or has no select function
	navigator.clipboard = null;
	document.getElementById('neighbor-paste-box').select = undefined;
	await neighbor.copyNeighborEncryptedText();

	document.elements['neighbor-paste-box'] = null;
	await neighbor.copyNeighborEncryptedText();

	// 8. loadNeighborTxt edge cases
	setupDomEnvironment();
	// !file
	await neighbor.loadNeighborTxt({ target: { files: [] } });

	// success on first try
	const encNeighbor = await cryptoLib.encryptPayload(JSON.stringify({
		district: "読込自治会",
		neighborhood: [{ role: "会長", lastName: "山田", firstName: "太郎" }]
	}), pass);
	document.getElementById('neighbor-pass').value = pass;
	await neighbor.loadNeighborTxt({
		target: { files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }], value: "file" }
	});
	assert.strictEqual(state.neighborState.district, "読込自治会");

	// first try fails, promptPass cancelled
	document.getElementById('neighbor-pass').value = "WrongPass1234!";
	global.prompt = () => null;
	await neighbor.loadNeighborTxt({
		target: { files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }], value: "file" }
	});

	// first try fails, promptPass provided, but format is invalid (no neighborhood array)
	const encInvalidFormat = await cryptoLib.encryptPayload(JSON.stringify({ notNeighborhood: true }), pass);
	global.prompt = () => pass;
	await neighbor.loadNeighborTxt({
		target: { files: [{ text: async () => `BEGIN_DATA:\n${encInvalidFormat}\n:END_DATA` }], value: "file" }
	});

	// outer catch error (e.g. text() throws)
	await neighbor.loadNeighborTxt({
		target: { files: [{ text: async () => { throw new Error("Read fail"); } }], value: "file" }
	});

	// 9. loadPastedTextToNeighbor edge cases
	setupDomEnvironment();
	document.elements['neighbor-paste-box'] = null;
	await neighbor.loadPastedTextToNeighbor();

	setupDomEnvironment();
	document.getElementById('neighbor-paste-box').value = "   ";
	await neighbor.loadPastedTextToNeighbor();

	// success on first try
	document.getElementById('neighbor-paste-box').value = `BEGIN_DATA:\n${encNeighbor}\n:END_DATA`;
	document.getElementById('neighbor-pass').value = pass;
	await neighbor.loadPastedTextToNeighbor();
	assert.strictEqual(state.neighborState.district, "読込自治会");

	// first try fails, promptPass cancelled
	document.getElementById('neighbor-paste-box').value = `BEGIN_DATA:\n${encNeighbor}\n:END_DATA`;
	document.getElementById('neighbor-pass').value = "WrongPass1234!";
	global.prompt = () => null;
	await neighbor.loadPastedTextToNeighbor();

	// promptPass provided, invalid format
	document.getElementById('neighbor-paste-box').value = `BEGIN_DATA:\n${encInvalidFormat}\n:END_DATA`;
	global.prompt = () => pass;
	await neighbor.loadPastedTextToNeighbor();

	// corrupt text throws outer catch
	document.getElementById('neighbor-paste-box').value = "CORRUPT_NOT_ENCRYPTED";
	global.prompt = () => pass;
	await neighbor.loadPastedTextToNeighbor();

	// 10. runNeighborYearUpdate edge cases
	global.confirm = () => false;
	neighbor.runNeighborYearUpdate();

	global.confirm = () => true;
	state.neighborState.neighborhood = [{ role: "役員", lastName: "姓", address: "1-1" }];
	neighbor.runNeighborYearUpdate();
	assert.strictEqual(state.neighborState.neighborhood[0].lastName, "");
	assert.strictEqual(state.neighborState.neighborhood[0].role, "役員");

	state.neighborState.neighborhood = null;
	neighbor.runNeighborYearUpdate();

	// 11. printNeighborRoster edge cases
	setupDomEnvironment();
	state.neighborState.neighborhood = [];
	neighbor.printNeighborRoster();

	state.neighborState.neighborhood = [{ role: "会長", lastName: "山" }];
	state.neighborState.district = ""; // defaults to "自治会"
	neighbor.printNeighborRoster();

	document.elements['print-area'] = null;
	neighbor.printNeighborRoster();

	// 12. printNeighborTentCards edge cases
	setupDomEnvironment();
	state.neighborState.neighborhood = [{ role: "会長", lastName: "", firstName: "" }];
	neighbor.printNeighborTentCards(); // validNeighbors length 0

	state.neighborState.neighborhood = [{ role: "", lastName: "山田", firstName: "太郎" }];
	state.neighborState.district = ""; // defaults to "自治会", role defaults to "役員"
	neighbor.printNeighborTentCards();

	document.elements['print-area'] = null;
	neighbor.printNeighborTentCards();


	// === REP.JS BRANCHES ===
	setupDomEnvironment();

	// 1. mergeNeighborDataIntoRep edge cases
	rep.mergeNeighborDataIntoRep(null);

	// data is an array of objects
	state.repState.districts = [];
	rep.mergeNeighborDataIntoRep([
		{ role: "書記", lastName: "書記氏" }
	]);
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].district, "未設定地区");
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true); // no 会長, defaults to 0

	// data with no neighborhood and not an array
	state.repState.districts = [];
	rep.mergeNeighborDataIntoRep({ district: "空地区" });
	assert.strictEqual(state.repState.districts[0].neighborhood.length, 0);

	// matching existing district with multiple entries
	state.repState.districts = [
		{ district: "重複地区", han: "1班", szNeighborChecks: { 1: true } },
		{ district: "重複地区", han: "2班", szNeighborChecks: {} }
	];
	rep.mergeNeighborDataIntoRep({
		district: "重複地区",
		neighborhood: [
			{ role: "自治会長", lastName: "長" },
			{ role: "副会長", lastName: "副" }
		]
	});
	assert.strictEqual(state.repState.districts[0].neighborhood.length, 2);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[1], true);

	// 2. upsertRepDistrict edge cases
	// placeholder replacement branches:
	// placeholder matches: (!students || length === 0) && (!officers || length === 0) && (!han)
	state.repState.districts = [
		{ district: "入替地区", han: "", students: [], officers: [] }
	];
	rep.upsertRepDistrict({
		district: "入替地区",
		han: "A班",
		students: [{ lastName: "生", han: "A班", isOutOfDistrict: true }],
		officers: [{ role: "校外委員", lastName: "役" }]
	});
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].han, "A班");

	// placeholder check non-matches:
	// a) has students
	state.repState.districts = [
		{ district: "生徒あり地区", han: "", students: [{ lastName: "生" }], officers: [] }
	];
	rep.upsertRepDistrict({ district: "生徒あり地区", han: "B班", officers: [{ lastName: "役" }] });
	assert.strictEqual(state.repState.districts.length, 2);

	// b) has officers
	state.repState.districts = [
		{ district: "役員あり地区", han: "", students: [], officers: [{ lastName: "役" }] }
	];
	rep.upsertRepDistrict({ district: "役員あり地区", han: "C班", officers: [{ lastName: "役2" }] });
	assert.strictEqual(state.repState.districts.length, 2);

	// c) has han
	state.repState.districts = [
		{ district: "班あり地区", han: "1班", students: [], officers: [] }
	];
	rep.upsertRepDistrict({ district: "班あり地区", han: "2班", officers: [{ lastName: "役" }] });
	assert.strictEqual(state.repState.districts.length, 2);

	// incomingHasNeighbors:
	// incoming has no neighbors, but existing has neighbors -> copies over!
	state.repState.districts = [
		{
			district: "保護地区",
			han: "1班",
			neighborhood: [{ role: "会長", lastName: "保護された会長" }],
			officers: [{ lastName: "役" }]
		}
	];
	rep.upsertRepDistrict({
		district: "保護地区",
		han: "2班",
		neighborhood: [],
		officers: [{ lastName: "別役員" }]
	});
	assert.strictEqual(state.repState.districts[1].neighborhood[0].lastName, "保護された会長");

	// incoming has no neighbors, and NO existing has neighbors
	state.repState.districts = [];
	rep.upsertRepDistrict({
		district: "完全新規地区",
		han: "",
		neighborhood: [],
		officers: [{ lastName: "役員" }]
	});
	assert.strictEqual(state.repState.districts[0].neighborhood.length, 0);

	// 3. loadMultipleDistrictFiles edge cases
	setupDomEnvironment();
	// files empty
	await rep.loadMultipleDistrictFiles({ target: { files: [] } });

	// master file where seatConfig and szExternals are undefined, and d.officers empty
	const masterMinimalEnc = await cryptoLib.encryptPayload(JSON.stringify({
		districts: [
			{
				district: "ミニマル地区",
				officer: { lastName: "旧役員" },
				officers: [],
				students: [{ lastName: "生", han: undefined, isOutOfDistrict: undefined }]
			}
		]
	}), pass);
	document.getElementById('rep-pass').value = pass;
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${masterMinimalEnc}\n:END_DATA` }],
			value: "test"
		}
	});
	assert(state.repState.seatConfig);
	assert(Array.isArray(state.repState.szExternals));

	// 4. loadPastedTextToRep edge cases
	setupDomEnvironment();
	document.elements['rep-paste-box'] = null;
	await rep.loadPastedTextToRep();

	setupDomEnvironment();
	document.getElementById('rep-paste-box').value = "   ";
	await rep.loadPastedTextToRep();

	// district data with and without han
	const distWithHanEnc = await cryptoLib.encryptPayload(JSON.stringify({
		district: "班あり",
		han: "1班",
		officers: [{ lastName: "役" }]
	}), pass);
	const distWithoutHanEnc = await cryptoLib.encryptPayload(JSON.stringify({
		district: "班なし",
		han: "",
		officers: [{ lastName: "役" }]
	}), pass);

	document.getElementById('rep-pass').value = pass;
	document.getElementById('rep-paste-box').value = `BEGIN_DATA:\n${distWithHanEnc}\n:END_DATA`;
	await rep.loadPastedTextToRep();

	document.getElementById('rep-paste-box').value = `BEGIN_DATA:\n${distWithoutHanEnc}\n:END_DATA`;
	await rep.loadPastedTextToRep();

	// corrupt
	document.getElementById('rep-paste-box').value = "INVALID_ENCRYPTION";
	await rep.loadPastedTextToRep();

	// 5. addCurrentDistrictToRep edge cases
	setupDomEnvironment();
	state.currentDistrict.district = "";
	rep.addCurrentDistrictToRep();

	state.currentDistrict.district = "カレント地区";
	state.currentDistrict.officers = [{ lastName: "カレント役員" }];
	rep.addCurrentDistrictToRep();
	assert(state.repState.districts.some(d => d.district === "カレント地区"));

	// 6. validateRepPasswords edge cases
	setupDomEnvironment();
	document.elements['rep-pass'] = null;
	rep.validateRepPasswords();

	setupDomEnvironment();
	document.elements['rep-pass-match-msg'] = null;
	rep.validateRepPasswords();

	setupDomEnvironment();
	// empty
	document.getElementById('rep-pass').value = "";
	document.getElementById('rep-pass-confirm').value = "";
	rep.validateRepPasswords();
	assert.strictEqual(document.getElementById('rep-pass-match-msg').textContent, "");

	// invalid
	document.getElementById('rep-pass').value = "short";
	rep.validateRepPasswords();
	assert(document.getElementById('rep-pass-match-msg').textContent.includes("⚠"));

	// empty confirm
	document.getElementById('rep-pass').value = pass;
	document.getElementById('rep-pass-confirm').value = "";
	rep.validateRepPasswords();
	assert.strictEqual(document.getElementById('rep-pass-match-msg').textContent, "確認用パスワードを入力してください");

	// mismatch
	document.getElementById('rep-pass-confirm').value = "WrongConfirm123!";
	rep.validateRepPasswords();
	assert.strictEqual(document.getElementById('rep-pass-match-msg').textContent, "⚠ パスワードが一致しません");

	// match
	document.getElementById('rep-pass-confirm').value = pass;
	rep.validateRepPasswords();
	assert(document.getElementById('rep-pass-match-msg').textContent.includes("✓"));

	// 7. exportRepMasterTxt edge cases
	setupDomEnvironment();
	document.getElementById('rep-pass').value = "bad";
	await rep.exportRepMasterTxt();

	document.getElementById('rep-pass').value = pass;
	document.getElementById('rep-pass-confirm').value = "Mismatch12345!";
	await rep.exportRepMasterTxt();

	document.elements['rep-pass-confirm'] = null;
	await rep.exportRepMasterTxt();

	// 8. loadRepMasterTxt edge cases
	setupDomEnvironment();
	await rep.loadRepMasterTxt({ target: { files: [] } });

	// data without districts (treated as single district) with and without han
	const singleWithoutHanEnc = await cryptoLib.encryptPayload(JSON.stringify({
		district: "単一班なし",
		officers: [{ lastName: "役" }]
	}), pass);
	document.getElementById('rep-pass').value = pass;
	await rep.loadRepMasterTxt({
		target: { files: [{ text: async () => `BEGIN_DATA:\n${singleWithoutHanEnc}\n:END_DATA` }], value: "test" }
	});

	const singleWithHanEnc = await cryptoLib.encryptPayload(JSON.stringify({
		district: "単一班あり",
		han: "東班",
		officers: [{ lastName: "役" }]
	}), pass);
	await rep.loadRepMasterTxt({
		target: { files: [{ text: async () => `BEGIN_DATA:\n${singleWithHanEnc}\n:END_DATA` }], value: "test" }
	});

	// throws
	await rep.loadRepMasterTxt({
		target: { files: [{ text: async () => { throw new Error("File error"); } }], value: "test" }
	});

	// 9. runRepYearUpdate cancel
	global.confirm = () => false;
	rep.runRepYearUpdate();

	// 10. renderRepDistrictsTable edge cases
	setupDomEnvironment();
	state.repState.districts = [
		{
			district: "表示テスト地区",
			han: "南班",
			selectedForPrint: true,
			students: [],
			neighborhood: [{ role: "役員", lastName: "", firstName: "" }],
			officers: [
				{ role: "", han: "", lastName: "", firstName: "", childLastName: "", childFirstName: "" },
				{ role: "書記", han: "南班", lastName: "鈴木", firstName: "一郎", childGrade: "5", childClass: "2", childLastName: "鈴木", childFirstName: "次郎" }
			]
		},
		{
			district: "空役員地区",
			han: "",
			selectedForPrint: false,
			students: [],
			neighborhood: [],
			officers: []
		}
	];
	rep.renderRepDistrictsTable();

	// 11. clearAllRepDistricts cancel
	global.confirm = () => false;
	rep.clearAllRepDistricts();

	// 12. renderSzNeighborhoodSelector edge cases
	setupDomEnvironment();
	state.repState.districts = [];
	rep.renderSzNeighborhoodSelector();

	// districts with no neighbors
	state.repState.districts = [{ district: "無役員地区", neighborhood: [] }];
	rep.renderSzNeighborhoodSelector();

	// districts with neighbor having no name
	state.repState.districts = [
		{
			district: "無名役員地区",
			szNeighborChecks: { 0: false },
			neighborhood: [{ role: "監事", lastName: "", firstName: "", name: "" }]
		}
	];
	rep.renderSzNeighborhoodSelector();

	// 13. toggleSzNeighbor edge cases
	rep.toggleSzNeighbor(999, 0, true); // out of bounds

	state.repState.districts = [
		{ district: "同期地区", szNeighborChecks: null },
		{ district: "同期地区", szNeighborChecks: {} }
	];
	rep.toggleSzNeighbor(0, 0, true);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true);
	assert.strictEqual(state.repState.districts[1].szNeighborChecks[0], true);

	// 14. renderSzExternalTable and updateSzEx edge cases
	state.repState.szExternals = [
		{ attend: false, category: "その他", org: "テスト", role: "顧問", lastName: "外", firstName: "部", contact: "090" }
	];
	rep.renderSzExternalTable();
	rep.updateSzEx(0, 'attend', true);
	assert.strictEqual(state.repState.szExternals[0].attend, true);
});



