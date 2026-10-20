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

test('integration: district -> rep multi-file sync, student aggregation, neighborhood dedup, seat allocation, master export/import', async () => {
	setupDomEnvironment();
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };

	const pass = "IntegrationPass123!@#";

	// District 1: 桜ヶ丘 1班
	const d1 = createMockDistrict({
		district: "桜ヶ丘",
		han: "1班",
		hanList: ["1班", "2班"],
		officers: [
			{ role: "代表", lastName: "桜井", firstName: "一", name: "桜井 一", han: "1班", tel: "090-1111-1111", childGrade: "6", childClass: "1", childName: "桜井 健" },
			{ role: "校外委員", lastName: "桜井", firstName: "二", name: "桜井 二", han: "1班", tel: "090-2222-2222", childGrade: "4", childClass: "2", childName: "桜井 康" }
		],
		neighborhood: [
			{ role: "自治会長", lastName: "桜木", firstName: "花道", name: "桜木 花道", address: "桜ヶ丘1-1", tel: "03-1111-1111" },
			{ role: "防犯部長", lastName: "流川", firstName: "楓", name: "流川 楓", address: "桜ヶ丘1-2", tel: "03-2222-2222" }
		],
		students: [
			{ grade: "6", class: "1", han: "1班", lastName: "赤木", firstName: "剛憲", name: "赤木 剛憲", leader: "班長", isOutOfDistrict: false },
			{ grade: "5", class: "2", han: "1班", lastName: "宮城", firstName: "リョータ", name: "宮城 リョータ", leader: "副班長", isOutOfDistrict: false },
			{ grade: "3", class: "1", han: "1班", lastName: "三井", firstName: "寿", name: "三井 寿", leader: "", isOutOfDistrict: true }
		]
	});

	// District 2: 桜ヶ丘 2班 (separate file by another officer)
	const d2 = createMockDistrict({
		district: "桜ヶ丘",
		han: "2班",
		hanList: ["1班", "2班"],
		officers: [
			{ role: "校外委員", lastName: "木暮", firstName: "公延", name: "木暮 公延", han: "2班", tel: "090-3333-3333", childGrade: "5", childClass: "1", childName: "木暮 翔" }
		],
		neighborhood: [
			{ role: "自治会長", lastName: "桜木", firstName: "花道", name: "桜木 花道", address: "桜ヶ丘1-1", tel: "03-1111-1111" } // same neighborhood president
		],
		students: [
			{ grade: "4", class: "1", han: "2班", lastName: "安西", firstName: "光義", name: "安西 光義", leader: "班長", isOutOfDistrict: false },
			{ grade: "2", class: "2", han: "2班", lastName: "彩子", firstName: "マネ", name: "彩子 マネ", leader: "", isOutOfDistrict: false }
		]
	});

	// District 3: 松原 A班
	const d3 = createMockDistrict({
		district: "松原",
		han: "A班",
		hanList: ["A班"],
		officers: [
			{ role: "代表", lastName: "仙道", firstName: "彰", name: "仙道 彰", han: "A班", tel: "090-4444-4444", childGrade: "6", childClass: "2", childName: "仙道 翼" }
		],
		neighborhood: [
			{ role: "自治会長", lastName: "田岡", firstName: "茂一", name: "田岡 茂一", address: "松原1-5", tel: "03-4444-4444" }
		],
		students: [
			{ grade: "6", class: "2", han: "A班", lastName: "福田", firstName: "吉兆", name: "福田 吉兆", leader: "班長", isOutOfDistrict: false },
			{ grade: "1", class: "1", han: "A班", lastName: "越野", firstName: "宏明", name: "越野 宏明", leader: "", isOutOfDistrict: false }
		]
	});

	// 1. Export as encrypted .txt files
	const enc1 = await cryptoLib.encryptPayload(JSON.stringify(d1), pass);
	const enc2 = await cryptoLib.encryptPayload(JSON.stringify(d2), pass);
	const enc3 = await cryptoLib.encryptPayload(JSON.stringify(d3), pass);

	const mockFiles = [
		{ text: async () => `BEGIN_DATA:\n${enc1}\n:END_DATA` },
		{ text: async () => `BEGIN_DATA:\n${enc2}\n:END_DATA` },
		{ text: async () => `BEGIN_DATA:\n${enc3}\n:END_DATA` }
	];

	// 2. Representative imports multiple district files
	document.getElementById('rep-pass').value = pass;
	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };
	await rep.loadMultipleDistrictFiles({ target: { files: mockFiles, value: "foo" } });

	assert.strictEqual(state.repState.districts.length, 3);
	assert(alertMsg.includes("3件のファイルを読み込みました"));

	// 3. Verify Neighborhood Deduplication across entries with same district name
	const uniqueNeighborhoodDistricts = utils.getUniqueNeighborhoodDistricts(state.repState.districts, false);
	assert.strictEqual(uniqueNeighborhoodDistricts.length, 2); // 桜ヶ丘 and 松原
	const distNames = uniqueNeighborhoodDistricts.map(x => x.d.district);
	assert.deepStrictEqual(distNames, ["桜ヶ丘", "松原"]);

	// 4. Verify District-Wide Student Aggregation across files for "桜ヶ丘"
	const sakuragaokaStudents = utils.getDistrictWideValidStudents({ district: "桜ヶ丘" }, state.repState.districts);
	assert.strictEqual(sakuragaokaStudents.length, 5); // 3 from d1 + 2 from d2
	const counts = utils.getGradeCounts(sakuragaokaStudents);
	assert.strictEqual(counts.total, 5);
	assert.strictEqual(counts.outOfDistrict, 1);
	assert.strictEqual(counts[6], 1);
	assert.strictEqual(counts[5], 1);
	assert.strictEqual(counts[4], 1);
	assert.strictEqual(counts[3], 1);
	assert.strictEqual(counts[2], 1);

	// 5. Verify Seat Chart Participant allocation does not duplicate or drop officers
	state.repState.szExternals = [
		{ attend: true, category: "学校関係者", org: "本校", role: "校長", lastName: "堂本", firstName: "五郎", name: "堂本 五郎" }
	];
	const seatParticipants = seat.getAllSzParticipantsForSeat();
	const officerParticipants = seatParticipants.filter(p => p.key.startsWith('OFF_'));
	assert.strictEqual(officerParticipants.length, 4); // 2 in d1 + 1 in d2 + 1 in d3
	const officerKeys = new Set(officerParticipants.map(p => p.key));
	assert.strictEqual(officerKeys.size, 4); // All keys are unique

	// Assign seats
	state.repState.seatConfig.cells["0_0"] = { refKey: officerParticipants[0].key, customText: "" };
	state.repState.seatConfig.cells["0_1"] = { refKey: officerParticipants[1].key, customText: "" };
	state.repState.seatConfig.cells["1_0"] = { refKey: "FAC_STAGE", customText: "" };

	// 6. Export Representative Master file
	document.getElementById('rep-pass-confirm').value = pass;
	let exportedMaster = "";
	global.downloadTextFile = (content, filename) => {
		exportedMaster = content;
	};
	await rep.exportRepMasterTxt();
	assert(exportedMaster.includes("校外委員会 代表統合マスターデータ"));

	// 7. Clear rep state and re-import the master file
	state.repState.districts = [];
	state.repState.szExternals = [];
	state.repState.seatConfig.cells = {};

	await rep.loadRepMasterTxt({
		target: {
			files: [{ text: async () => exportedMaster }],
			value: "path"
		}
	});

	assert.strictEqual(state.repState.districts.length, 3);
	assert.strictEqual(state.repState.szExternals.length, 1);
	assert.strictEqual(state.repState.seatConfig.cells["0_0"].refKey, officerParticipants[0].key);
	assert.strictEqual(state.repState.seatConfig.cells["1_0"].refKey, "FAC_STAGE");
});
