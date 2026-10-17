const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const seat = require('../../js/seat.js');
const rep = require('../../js/rep.js');

test('rep: renderRepAll executes sub-renders without throwing', () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	rep.renderRepAll();

	const countEl = document.getElementById('rep-count');
	assert.strictEqual(Number(countEl.textContent), 3);
	const tbody = document.getElementById('rep-districts-tbody');
	assert(tbody.innerHTML.includes("緑が丘"));
});

test('rep: upsertRepDistrict handles legacy officer, defaultChecks, and updates', () => {
	setupDomEnvironment();
	state.repState.districts = [];

	// 1. Single legacy officer (no officers array) and no "会長"
	const d1 = {
		district: "南地区",
		han: "1班",
		officer: { lastName: "田中", firstName: "一郎", role: "役員" },
		neighborhood: [
			{ role: "副会長", lastName: "佐藤", firstName: "健" }
		],
		students: [
			{ lastName: "高橋", firstName: "翔", grade: "3", class: "1" }
		]
	};

	rep.upsertRepDistrict(d1);
	assert.strictEqual(state.repState.districts.length, 1);
	const saved1 = state.repState.districts[0];
	assert.strictEqual(saved1.officers.length, 1);
	assert.strictEqual(saved1.officers[0].lastName, "田中");
	assert.strictEqual(saved1.szNeighborChecks[0], true); // Fallback to index 0
	assert.strictEqual(saved1.students[0].han, "1班");
	assert.strictEqual(saved1.students[0].isOutOfDistrict, false);

	// 2. District with "会長" role in neighborhood
	const d2 = {
		district: "北地区",
		han: "",
		officers: [{ lastName: "鈴木", firstName: "次郎" }],
		neighborhood: [
			{ role: "書記", lastName: "伊藤", firstName: "花子" },
			{ role: "自治会長", lastName: "渡辺", firstName: "五郎" }
		],
		students: []
	};

	rep.upsertRepDistrict(d2);
	assert.strictEqual(state.repState.districts.length, 2);
	const saved2 = state.repState.districts[1];
	assert.strictEqual(saved2.szNeighborChecks[0], undefined);
	assert.strictEqual(saved2.szNeighborChecks[1], true); // 会長 detected

	// 3. Update existing district (same district & han)
	saved2.selectedForPrint = false;
	saved2.szNeighborChecks = { 0: true };
	const d2Updated = {
		district: "北地区",
		han: "",
		officers: [{ lastName: "鈴木", firstName: "次郎" }, { lastName: "佐々木", firstName: "小次郎" }],
		neighborhood: [],
		students: []
	};
	rep.upsertRepDistrict(d2Updated);
	assert.strictEqual(state.repState.districts.length, 2);
	const updated = state.repState.districts[1];
	assert.strictEqual(updated.officers.length, 2);
	assert.strictEqual(updated.selectedForPrint, false);
	assert.strictEqual(updated.szNeighborChecks[0], true);
});

test('rep: loadMultipleDistrictFiles handles master files, district files, and errors', async () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	document.getElementById('rep-pass').value = "Password123!@#";

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// 1. Empty files list
	const dummyEvtEmpty = { target: { files: [] } };
	await rep.loadMultipleDistrictFiles(dummyEvtEmpty);
	assert.strictEqual(alertMsg, "");

	// 2. Master file and single district file
	const masterData = {
		districts: [createMockDistrict({ district: "東地区", han: "A班" })],
		szExternals: [{ lastName: "警察", firstName: "太郎", org: "南署", role: "巡査" }],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	const districtData = createMockDistrict({ district: "西地区", han: "B班" });

	const pass = "Password123!@#";
	const encMaster = await cryptoLib.encryptPayload(JSON.stringify(masterData), pass);
	const encDistrict = await cryptoLib.encryptPayload(JSON.stringify(districtData), pass);

	const mockFileMaster = {
		name: "master.txt",
		text: async () => `BEGIN_DATA:\n${encMaster}\n:END_DATA`
	};
	const mockFileDistrict = {
		name: "district.txt",
		text: async () => `BEGIN_DATA:\n${encDistrict}\n:END_DATA`
	};
	const mockFileError = {
		name: "bad.txt",
		text: async () => `BEGIN_DATA:\ninvalid_base64_or_bad_payload\n:END_DATA`
	};

	const evt = {
		target: {
			files: [mockFileMaster, mockFileDistrict, mockFileError],
			value: "fake_path"
		}
	};

	await rep.loadMultipleDistrictFiles(evt);
	assert(alertMsg.includes("2件のファイルを読み込みました。"));
	assert(alertMsg.includes("1件はパスワード不一致等で失敗"));
	assert.strictEqual(evt.target.value, "");
});

test('rep: loadPastedTextToRep handles empty, valid, and corrupt text', async () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	const pasteBox = document.getElementById('rep-paste-box');
	document.getElementById('rep-pass').value = "Password123!@#";

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// 1. Empty paste
	pasteBox.value = "   ";
	await rep.loadPastedTextToRep();
	assert.strictEqual(alertMsg, "");

	// 2. Valid paste with han
	const dData = createMockDistrict({ district: "中央地区", han: "1班" });
	const enc = await cryptoLib.encryptPayload(JSON.stringify(dData), "Password123!@#");
	pasteBox.value = `BEGIN_DATA:\n${enc}\n:END_DATA`;

	await rep.loadPastedTextToRep();
	assert.strictEqual(pasteBox.value, "");
	assert(alertMsg.includes("中央地区"));
	assert(alertMsg.includes("1班"));

	// 3. Corrupt paste
	pasteBox.value = "BEGIN_DATA:\nbad_data\n:END_DATA";
	await rep.loadPastedTextToRep();
	assert(alertMsg.includes("復号に失敗しました"));
});

test('rep: addCurrentDistrictToRep checks tab 1 district name and adds', () => {
	setupDomEnvironment();
	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// Missing district
	document.getElementById('d-name').value = "";
	state.currentDistrict = createMockDistrict({ district: "" });
	rep.addCurrentDistrictToRep();
	assert(alertMsg.includes("タブ①の地区名が未入力です"));

	// Valid district
	document.getElementById('d-name').value = "青山地区";
	state.currentDistrict = createMockDistrict({ district: "青山地区", han: "A班" });
	state.repState = createMockRepState();
	rep.addCurrentDistrictToRep();
	const found = state.repState.districts.find(d => d.district === "青山地区");
	assert(found);
});

test('rep: validateRepPasswords validates rules, confirmation, and match', () => {
	setupDomEnvironment();
	const passEl = document.getElementById('rep-pass');
	const confirmEl = document.getElementById('rep-pass-confirm');
	const msgEl = document.getElementById('rep-pass-match-msg');

	// 1. Missing elements
	document.elements['rep-pass'] = null;
	rep.validateRepPasswords();

	document.elements['rep-pass'] = passEl;
	// 2. Both empty
	passEl.value = "";
	confirmEl.value = "";
	rep.validateRepPasswords();
	assert.strictEqual(msgEl.textContent, "");

	// 3. Invalid password (too short)
	passEl.value = "Short1!";
	confirmEl.value = "Short1!";
	rep.validateRepPasswords();
	assert(msgEl.textContent.includes("⚠"));
	assert(msgEl.className.includes("pass-msg-ng"));

	// 4. Missing confirmation
	passEl.value = "ValidPassword123!@#";
	confirmEl.value = "";
	rep.validateRepPasswords();
	assert.strictEqual(msgEl.textContent, "確認用パスワードを入力してください");

	// 5. Mismatch
	confirmEl.value = "DifferentPass123!@#";
	rep.validateRepPasswords();
	assert(msgEl.textContent.includes("⚠ パスワードが一致しません"));

	// 6. Match
	confirmEl.value = "ValidPassword123!@#";
	rep.validateRepPasswords();
	assert(msgEl.textContent.includes("✓ パスワードが一致しました"));
	assert(msgEl.className.includes("pass-msg-ok"));
});

test('rep: exportRepMasterTxt enforces password validation and confirms', async () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	const passEl = document.getElementById('rep-pass');
	const confirmEl = document.getElementById('rep-pass-confirm');

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };
	let downloaded = null;
	global.downloadTextFile = (content, filename) => { downloaded = { content, filename }; };

	// 1. Invalid password
	passEl.value = "weak";
	confirmEl.value = "weak";
	await rep.exportRepMasterTxt();
	assert(alertMsg.includes("【保存パスワードエラー】"));
	assert.strictEqual(downloaded, null);

	// 2. Mismatch
	passEl.value = "StrongPass12345!@#";
	confirmEl.value = "DifferentPass12345!@#";
	await rep.exportRepMasterTxt();
	assert(alertMsg.includes("【パスワード不一致エラー】"));
	assert.strictEqual(downloaded, null);

	// 3. Success
	confirmEl.value = "StrongPass12345!@#";
	await rep.exportRepMasterTxt();
	assert(downloaded);
	assert(downloaded.content.includes("校外委員会 代表統合マスターデータ"));
	assert(downloaded.content.includes("BEGIN_DATA:"));
	assert(downloaded.filename.startsWith("校外代表統合データ_"));
});

test('rep: loadRepMasterTxt handles master data, single district, and corrupt file', async () => {
	setupDomEnvironment();
	document.getElementById('rep-pass').value = "StrongPass12345!@#";
	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// 1. No file
	await rep.loadRepMasterTxt({ target: { files: [] } });
	assert.strictEqual(alertMsg, "");

	// 2. Master data with legacy officer
	const pass = "StrongPass12345!@#";
	const master = {
		districts: [
			{
				district: "マスター地区",
				officer: { lastName: "小山", firstName: "太郎" },
				neighborhood: [{ lastName: "佐藤", role: "副会長" }],
				students: [{ lastName: "小山", firstName: "花", grade: "1" }]
			}
		],
		szExternals: [{ lastName: "外部", firstName: "三郎" }],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	const encMaster = await cryptoLib.encryptPayload(JSON.stringify(master), pass);
	const evtMaster = {
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encMaster}\n:END_DATA` }],
			value: "path"
		}
	};
	await rep.loadRepMasterTxt(evtMaster);
	assert(alertMsg.includes("代表統合マスターデータを読み込みました"));
	assert.strictEqual(state.repState.districts[0].officers[0].lastName, "小山");

	// 3. Single district data
	const single = createMockDistrict({ district: "個別地区", han: "北班" });
	const encSingle = await cryptoLib.encryptPayload(JSON.stringify(single), pass);
	const evtSingle = {
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encSingle}\n:END_DATA` }],
			value: "path"
		}
	};
	await rep.loadRepMasterTxt(evtSingle);
	assert(alertMsg.includes("個別地区（北班）"));

	// 4. Corrupt
	const evtBad = {
		target: {
			files: [{ text: async () => "bad_format" }],
			value: "path"
		}
	};
	await rep.loadRepMasterTxt(evtBad);
	assert(alertMsg.includes("読み込みに失敗しました"));
});

test('rep: runRepYearUpdate handles cancel and confirmation', () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	state.repState.szExternals = [
		{
			category: "学校関係者",
			org: "南小",
			role: "校長",
			lastName: "山田",
			firstName: "太郎",
			contact: "03-1111",
			attend: true
		}
	];
	state.repState.seatConfig.cells = { "0,0": "SCH_南小_山田太郎" };

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// Cancel
	global.confirm = () => false;
	rep.runRepYearUpdate();
	assert.strictEqual(state.repState.districts.length, 3);

	// Confirm
	global.confirm = () => true;
	rep.runRepYearUpdate();
	assert.strictEqual(state.repState.districts.length, 0);
	assert.strictEqual(state.repState.szExternals[0].org, "南小");
	assert.strictEqual(state.repState.szExternals[0].role, "校長");
	assert.strictEqual(state.repState.szExternals[0].lastName, "");
	assert.strictEqual(state.repState.szExternals[0].contact, "");
	assert.deepStrictEqual(state.repState.seatConfig.cells, {});
	assert(alertMsg.includes("代表データの年度更新が完了しました"));
});

test('rep: renderRepDistrictsTable renders empty and populated rows with badges', () => {
	setupDomEnvironment();
	const tbody = document.getElementById('rep-districts-tbody');

	// 1. Empty
	state.repState.districts = [];
	rep.renderRepDistrictsTable();
	assert(tbody.innerHTML.includes("まだ地区データが読み込まれていません"));

	// 2. Populated with officers, han badge, and child info
	const d1 = createMockDistrict({ district: "旭町", han: "東班" });
	d1.officers = [
		{
			lastName: "小西",
			firstName: "真奈",
			role: "代表",
			han: "東班",
			childGrade: "5",
			childClass: "2",
			childLastName: "小西",
			childFirstName: "拓也"
		},
		{
			lastName: "中島",
			firstName: "悟",
			role: "",
			han: "",
			childGrade: "",
			childClass: "",
			childLastName: "",
			childFirstName: ""
		}
	];
	state.repState.districts = [d1];
	rep.renderRepDistrictsTable();
	assert(tbody.innerHTML.includes("旭町"));
	assert(tbody.innerHTML.includes("(東班)"));
	assert(tbody.innerHTML.includes("<strong>[代表]</strong>"));
	assert(tbody.innerHTML.includes("5年2組 小西 拓也"));
	assert(tbody.innerHTML.includes("（未入力）"));
});

test('rep: toggleAllDistrictChecks and clearAllRepDistricts', () => {
	setupDomEnvironment();
	state.repState.districts = [
		createMockDistrict({ district: "A地区" }),
		createMockDistrict({ district: "B地区" })
	];

	rep.toggleAllDistrictChecks(false);
	assert.strictEqual(state.repState.districts[0].selectedForPrint, false);
	assert.strictEqual(state.repState.districts[1].selectedForPrint, false);

	rep.toggleAllDistrictChecks(true);
	assert.strictEqual(state.repState.districts[0].selectedForPrint, true);
	assert.strictEqual(state.repState.districts[1].selectedForPrint, true);

	// clearAllRepDistricts cancelled
	global.confirm = () => false;
	rep.clearAllRepDistricts();
	assert.strictEqual(state.repState.districts.length, 2);

	// clearAllRepDistricts confirmed
	global.confirm = () => true;
	rep.clearAllRepDistricts();
	assert.strictEqual(state.repState.districts.length, 0);
});

test('rep: renderSzNeighborhoodSelector and toggleSzNeighbor synchronization', () => {
	setupDomEnvironment();
	const box = document.getElementById('sz-neighborhood-selector');

	// 1. Empty districts
	state.repState.districts = [];
	rep.renderSzNeighborhoodSelector();
	assert(box.innerHTML.includes("地区データを読み込むと"));

	// 2. Districts without neighborhood
	state.repState.districts = [
		{ district: "空地区", han: "1班", neighborhood: [] }
	];
	rep.renderSzNeighborhoodSelector();
	assert(box.innerHTML.includes("自治会役員が登録されていません"));

	// 3. Populated districts sharing the same district name
	state.repState.districts = [
		{
			district: "緑ヶ丘",
			han: "1班",
			neighborhood: [
				{ role: "会長", lastName: "緑川", firstName: "正" },
				{ role: "防犯", lastName: "", firstName: "", name: "" } // empty name with role
			],
			szNeighborChecks: { 0: true }
		},
		{
			district: "緑ヶ丘",
			han: "2班",
			neighborhood: [
				{ role: "会長", lastName: "緑川", firstName: "正" }
			],
			szNeighborChecks: { 0: true }
		}
	];
	rep.renderSzNeighborhoodSelector();
	assert(box.innerHTML.includes("緑ヶ丘"));
	assert(box.innerHTML.includes("緑川 正"));
	assert(box.innerHTML.includes("（氏名未定）"));

	// toggleSzNeighbor syncs across all entries with the same district name
	rep.toggleSzNeighbor(0, 0, false);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], false);
	assert.strictEqual(state.repState.districts[1].szNeighborChecks[0], false);

	// toggleSzNeighbor with invalid index exits safely
	rep.toggleSzNeighbor(99, 0, true);
});

test('rep: renderSzExternalTable, updateSzEx, and addSzExternalRow', () => {
	setupDomEnvironment();
	state.repState.szExternals = [
		{
			attend: true,
			category: "学校関係者",
			org: "本校",
			role: "教頭",
			lastName: "木村",
			firstName: "拓哉",
			lastNameKana: "きむら",
			firstNameKana: "たくや",
			name: "木村 拓哉",
			contact: "090-0000-0000"
		}
	];

	rep.renderSzExternalTable();
	const tbody = document.getElementById('sz-external-tbody');
	assert.strictEqual(tbody.children.length, 1);
	assert(tbody.innerHTML.includes("木村"));

	// updateSzEx
	rep.updateSzEx(0, 'lastName', '松本');
	assert.strictEqual(state.repState.szExternals[0].lastName, '松本');
	assert.strictEqual(state.repState.szExternals[0].name, '松本 拓哉');

	// addSzExternalRow
	rep.addSzExternalRow();
	assert.strictEqual(state.repState.szExternals.length, 2);
	assert.strictEqual(state.repState.szExternals[1].category, "役所・警察・関係機関");
	assert.strictEqual(tbody.children.length, 2);
});

test('rep: additional branch coverage tests for defaultChecks fallback and master without officers', async () => {
	setupDomEnvironment();

	// 1. Neighborhood without "会長" falls back to index 0
	state.repState.districts = [];
	const dNoPres = {
		district: "無会長地区",
		han: "",
		officers: [{ lastName: "役員A" }],
		neighborhood: [
			{ role: "書記", lastName: "書記A" }
		],
		students: []
	};
	rep.upsertRepDistrict(dNoPres);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], true);

	// 2. Master file import with a district lacking officers array
	const masterWithoutOff = {
		districts: [
			{
				district: "旧式マスター地区",
				officer: { lastName: "旧役員" },
				neighborhood: [],
				students: []
			}
		],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	const pass = "Password123!@#";
	const enc = await cryptoLib.encryptPayload(JSON.stringify(masterWithoutOff), pass);
	document.getElementById('rep-pass').value = pass;
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${enc}\n:END_DATA` }],
			value: "test"
		}
	});
	assert.strictEqual(state.repState.districts[0].district, "旧式マスター地区");
	assert.strictEqual(state.repState.districts[0].officers.length, 1);
});

test('rep: exhaustive branch coverage for all edge cases and permutations', async () => {
	setupDomEnvironment();
	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// 1. upsertRepDistrict: officers not array, officer undefined, neighborhood/students undefined
	state.repState.districts = [];
	const dEdge1 = {
		district: "極限地区1",
		han: undefined,
		hanList: ["A班"],
		officers: "invalid_not_array",
		officer: null,
		neighborhood: null,
		students: null
	};
	rep.upsertRepDistrict(dEdge1);
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].han, "");
	assert.deepStrictEqual(state.repState.districts[0].hanList, ["A班"]);

	// upsertRepDistrict: update existing when existing szNeighborChecks is undefined
	state.repState.districts[0].szNeighborChecks = null;
	const dEdge1Update = {
		district: "極限地区1",
		han: "",
		officers: [
			{
				role: "校外役員",
				lastName: "木村",
				firstName: "拓",
				han: "A班",
				childGrade: "",
				childClass: "",
				childLastName: "木村",
				childFirstName: "子"
			}
		],
		neighborhood: [
			{ role: null, lastName: "役員無役職" },
			{ role: "書記", lastName: "書記員" }
		],
		students: [
			{
				han: "A班",
				isOutOfDistrict: true,
				lastName: "児童A",
				firstName: "一"
			}
		]
	};
	rep.upsertRepDistrict(dEdge1Update);
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].students[0].isOutOfDistrict, true);
	assert.strictEqual(state.repState.districts[0].students[0].han, "A班");

	// 2. loadMultipleDistrictFiles with zero errors (ng === 0)
	const pass = "Password123!@#";
	document.getElementById('rep-pass').value = pass;
	const singleGood = createMockDistrict({ district: "成功地区", han: "1班" });
	const encGood = await cryptoLib.encryptPayload(JSON.stringify(singleGood), pass);
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encGood}\n:END_DATA` }],
			value: "test"
		}
	});
	assert(alertMsg.includes("1件のファイルを読み込みました。"));
	assert(!alertMsg.includes("失敗"));

	// loadMultipleDistrictFiles with master file having null officers, null neighborhood, null students, and valid szExternals
	const masterNulls = {
		districts: [
			{
				district: "ヌルマスター地区",
				han: "",
				officers: null,
				officer: null,
				neighborhood: null,
				students: [
					{ lastName: "生徒X", han: "特定班", isOutOfDistrict: false }
				]
			}
		],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	const encMasterNulls = await cryptoLib.encryptPayload(JSON.stringify(masterNulls), pass);
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encMasterNulls}\n:END_DATA` }],
			value: "test"
		}
	});
	assert.strictEqual(state.repState.districts[0].district, "ヌルマスター地区");

	// 3. loadPastedTextToRep with data having no han
	const noHanDist = createMockDistrict({ district: "班無しペースト地区", han: "" });
	const encNoHan = await cryptoLib.encryptPayload(JSON.stringify(noHanDist), pass);
	document.getElementById('rep-paste-box').value = `BEGIN_DATA:\n${encNoHan}\n:END_DATA`;
	await rep.loadPastedTextToRep();
	assert(alertMsg.includes("「班無しペースト地区」を追加しました。"));
	assert(!alertMsg.includes("（）"));

	// 4. validateRepPasswords missing msgEl or confirmEl
	const savedMsgEl = document.elements['rep-pass-match-msg'];
	document.elements['rep-pass-match-msg'] = null;
	rep.validateRepPasswords();
	document.elements['rep-pass-match-msg'] = savedMsgEl;

	const savedConfirmEl = document.elements['rep-pass-confirm'];
	document.elements['rep-pass-confirm'] = null;
	document.getElementById('rep-pass').value = "Short!";
	rep.validateRepPasswords();
	document.elements['rep-pass-confirm'] = savedConfirmEl;

	// 5. exportRepMasterTxt when confirmEl is null
	document.elements['rep-pass-confirm'] = null;
	document.getElementById('rep-pass').value = "Password123!@#";
	let downloadedFname = "";
	global.downloadTextFile = (c, fname) => { downloadedFname = fname; };
	await rep.exportRepMasterTxt();
	assert(downloadedFname.startsWith("校外代表統合データ_"));
	document.elements['rep-pass-confirm'] = savedConfirmEl;

	// 6. loadRepMasterTxt single district without han, and master with nulls
	const singleNoHan = createMockDistrict({ district: "単独班無地区", han: "" });
	const encSingleNoHan = await cryptoLib.encryptPayload(JSON.stringify(singleNoHan), pass);
	await rep.loadRepMasterTxt({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encSingleNoHan}\n:END_DATA` }],
			value: "test"
		}
	});
	assert(alertMsg.includes("「単独班無地区」として追加しました。"));

	const masterEdgeNulls = {
		districts: [
			{
				district: "マスターヌル2",
				han: undefined,
				officers: null,
				officer: null,
				neighborhood: null,
				students: null
			}
		],
		szExternals: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	const encMasterEdge = await cryptoLib.encryptPayload(JSON.stringify(masterEdgeNulls), pass);
	await rep.loadRepMasterTxt({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encMasterEdge}\n:END_DATA` }],
			value: "test"
		}
	});
	assert(alertMsg.includes("代表統合マスターデータを読み込みました。"));

	// 7. renderRepDistrictsTable with empty officers, nameless officer, child without grade/class
	state.repState.districts = [
		{
			district: "空役員地区",
			han: "",
			selectedForPrint: false,
			officers: [],
			officer: null,
			neighborhood: null,
			students: []
		},
		{
			district: "無名役員地区",
			han: "西班",
			selectedForPrint: true,
			officers: [
				{
					role: "",
					lastName: "",
					firstName: "",
					name: "",
					han: "",
					childLastName: "名無子",
					childFirstName: "",
					childGrade: "",
					childClass: ""
				}
			],
			neighborhood: [{ role: "役員", lastName: "役員A" }],
			students: []
		}
	];
	rep.renderRepDistrictsTable();
	const tbody = document.getElementById('rep-districts-tbody');
	assert(tbody.innerHTML.includes("空役員地区"));
	assert(tbody.innerHTML.includes("未入力"));
	assert(tbody.innerHTML.includes("無名役員地区"));
	assert(tbody.innerHTML.includes("(西班)"));

	// 8. renderSzNeighborhoodSelector with empty role/names, no checked object, and unassigned names
	state.repState.districts = [
		{
			district: "セレクタ地区A",
			han: "1班",
			neighborhood: [
				{ role: "", lastName: "", firstName: "", name: "" }, // filtered out
				{ role: "会計", lastName: "", firstName: "", name: "" } // empty name -> （氏名未定）
			],
			szNeighborChecks: null
		},
		{
			district: "セレクタ地区B",
			han: "2班",
			neighborhood: [] // neighbors.length === 0 -> returns ""
		}
	];
	rep.renderSzNeighborhoodSelector();
	const selBox = document.getElementById('sz-neighborhood-selector');
	assert(selBox.innerHTML.includes("セレクタ地区A"));
	assert(selBox.innerHTML.includes("（氏名未定）"));

	// 9. toggleSzNeighbor sync across same district name vs different name
	state.repState.districts = [
		{ district: "共有地区", szNeighborChecks: { 0: true } },
		{ district: "共有地区", szNeighborChecks: { 0: true } },
		{ district: "別名地区", szNeighborChecks: { 0: true } },
		{ district: "", szNeighborChecks: { 0: true } }
	];
	rep.toggleSzNeighbor(0, 0, false);
	assert.strictEqual(state.repState.districts[0].szNeighborChecks[0], false);
	assert.strictEqual(state.repState.districts[1].szNeighborChecks[0], false);
	assert.strictEqual(state.repState.districts[2].szNeighborChecks[0], true);

	// toggleSzNeighbor with empty district name
	rep.toggleSzNeighbor(3, 0, false);
	assert.strictEqual(state.repState.districts[3].szNeighborChecks[0], false);

	// 10. renderSzExternalTable with attend=false and different categories
	state.repState.szExternals = [
		{
			attend: false,
			category: "その他",
			org: "その他団体",
			role: "相談役",
			lastName: "佐藤",
			firstName: "二郎",
			lastNameKana: "さとう",
			firstNameKana: "じろう",
			contact: "090-1111-2222"
		}
	];
	rep.renderSzExternalTable();
	const exTbody = document.getElementById('sz-external-tbody');
	assert(exTbody.innerHTML.includes("その他団体"));
	assert(exTbody.innerHTML.includes('<input type="checkbox" '));
	assert(!exTbody.innerHTML.includes('<input type="checkbox" checked'));
});

test('rep: integrateTransferDataIntoRep integrates children into selected district with duplicate guard (Action Item A-1)', async () => {
	setupDomEnvironment();
	state.repState = {
		districts: [
			{
				district: '1丁目',
				han: '1班',
				selectedForPrint: true,
				officers: [],
				students: [
					{
						id: 's1',
						lastName: '山田',
						firstName: '太郎',
						grade: '2',
						className: '1',
						han: '1班'
					}
				]
			}
		],
		seatConfig: { cols: 4, rows: 5, cells: {} },
		szExternals: []
	};

	const transferPayload = {
		isTransferData: true,
		version: 1,
		children: [
			{
				id: 't_rep_1',
				lastName: '転入',
				firstName: '次郎',
				lastNameKana: 'テンニュウ',
				firstNameKana: 'ジロウ',
				grade: '5',
				className: '2',
				address: '1丁目5番地',
				tel: '03-5555-6666'
			}
		]
	};

	// 地区選択プロンプトで「1丁目」、班割当で「2班」
	let promptCount = 0;
	global.prompt = (msg, def) => {
		promptCount++;
		if (promptCount === 1) return '1丁目';
		return '2班';
	};
	global.confirm = () => true;

	const result = await rep.integrateTransferDataIntoRep(transferPayload, 'pass123');
	assert.strictEqual(result, true);

	const targetDistrict = state.repState.districts.find(d => d.district === '1丁目');
	assert.ok(targetDistrict);
	assert.strictEqual(targetDistrict.students.length, 2);

	const added = targetDistrict.students.find(s => s.lastName === '転入');
	assert.ok(added);
	assert.strictEqual(added.firstName, '次郎');
	assert.strictEqual(added.han, '2班');
	assert.strictEqual(added.grade, '5');

	// 重複検知テスト
	promptCount = 0;
	let confirmWarnCalled = false;
	global.confirm = (msg) => {
		confirmWarnCalled = true;
		assert.ok(msg.includes('重複') || msg.includes('既に存在'));
		return false; // キャンセル
	};
	const cancelResult = await rep.integrateTransferDataIntoRep(transferPayload, 'pass123');
	assert.strictEqual(cancelResult, false);
	assert.strictEqual(confirmWarnCalled, true);
	assert.strictEqual(targetDistrict.students.length, 2); // 人数不変
});

test('rep: loadTransferFileIntoRep and loadPastedTransferTextIntoRep', async () => {
	setupDomEnvironment();
	state.repState = {
		districts: [
			{
				district: '中央地区',
				han: '1班',
				selectedForPrint: true,
				officers: [],
				students: []
			}
		],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};

	const pass = 'RepTransfer123!';
	const transferPayload = {
		isTransferData: true,
		version: 1,
		children: [
			{
				id: 't_c_rep_file',
				lastName: '鈴木',
				firstName: '一郎',
				grade: '3',
				className: '1',
				address: '中央1-2',
				tel: '090-4444-5555'
			}
		]
	};

	const encText = await cryptoLib.encryptPayload(JSON.stringify(transferPayload), pass);
	document.getElementById('rep-pass').value = pass;

	let promptIndex = 0;
	global.prompt = () => {
		promptIndex++;
		if (promptIndex % 2 === 1) return '中央地区';
		return '1班';
	};
	global.confirm = () => true;

	// ファイル読込
	const fileTarget = {
		files: [{ text: async () => `BEGIN_DATA:\n${encText}\n:END_DATA` }],
		value: 'transfer_rep.txt'
	};
	await rep.loadTransferFileIntoRep({ target: fileTarget });
	const dist = state.repState.districts.find(d => d.district === '中央地区');
	assert.strictEqual(dist.students.length, 1);

	// クリップボード読込
	transferPayload.children[0].lastName = '高橋';
	const encText2 = await cryptoLib.encryptPayload(JSON.stringify(transferPayload), pass);
	await rep.loadPastedTransferTextIntoRep(encText2);
	assert.strictEqual(dist.students.length, 2);
});
