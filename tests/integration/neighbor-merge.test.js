const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockDistrict } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const districtLib = require('../../js/district.js');
const rep = require('../../js/rep.js');
const seat = require('../../js/seat.js');
const neighbor = require('../../js/neighbor.js');
const print = require('../../js/print.js');

test('integration: Pattern A (Standard Order) - Neighbor Export -> District Merge -> District Export -> Rep Import', async () => {
	setupDomEnvironment();
	const pass = "IntegrationPatternA123!@#";

	// 1. Neighborhood Mode: create neighborhood roster
	state.neighborState = {
		district: "緑ヶ丘",
		neighborhood: [
			{ role: "自治会長", lastName: "田中", firstName: "一郎", lastNameKana: "たなか", firstNameKana: "いちろう", address: "緑ヶ丘1-1", tel: "090-1111-1111", email: "tanaka@test.com", note: "" },
			{ role: "防災部長", lastName: "佐藤", firstName: "次郎", lastNameKana: "さとう", firstNameKana: "じろう", address: "緑ヶ丘1-2", tel: "090-2222-2222", email: "", note: "" }
		]
	};
	document.getElementById('neighbor-district-name').value = "緑ヶ丘";
	document.getElementById('neighbor-pass').value = pass;
	document.getElementById('neighbor-pass-confirm').value = pass;

	let downloadedNeighborFile = null;
	global.downloadTextFile = (content, filename) => {
		downloadedNeighborFile = { content, filename };
	};
	await neighbor.exportNeighborTxt();
	assert(downloadedNeighborFile, "Neighborhood file should be exported");
	assert(downloadedNeighborFile.filename.includes("自治会役員データ_緑ヶ丘"));

	// 2. District Mode: officer has students and officers
	state.currentDistrict = createMockDistrict({
		district: "緑ヶ丘",
		han: "1班",
		hanList: ["1班", "2班"],
		officers: [
			{ role: "校外委員", lastName: "鈴木", firstName: "花子", han: "1班", tel: "090-3333-3333", childGrade: "5", childClass: "1", childLastName: "鈴木", childFirstName: "太郎" }
		],
		neighborhood: [],
		students: [
			{ grade: "6", class: "1", han: "1班", lastName: "井上", firstName: "翔", leader: "班長", isOutOfDistrict: false },
			{ grade: "4", class: "2", han: "1班", lastName: "高橋", firstName: "蓮", leader: "", isOutOfDistrict: false }
		]
	});
	document.getElementById('d-name').value = "緑ヶ丘";
	document.getElementById('d-pass').value = pass;

	// Merge neighborhood file into District Mode via loadNeighborFileIntoDistrict
	await districtLib.loadNeighborFileIntoDistrict({
		target: {
			files: [{ text: async () => downloadedNeighborFile.content }],
			value: downloadedNeighborFile.filename
		}
	});

	// Verify students and district officers are completely intact, and neighborhood is merged
	assert.strictEqual(state.currentDistrict.students.length, 2);
	assert.strictEqual(state.currentDistrict.students[0].lastName, "井上");
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.officers[0].lastName, "鈴木");
	assert.strictEqual(state.currentDistrict.neighborhood.length, 2);
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, "田中");
	assert.strictEqual(state.currentDistrict.neighborhood[1].lastName, "佐藤");

	// Test district name mismatch handling in District Mode
	const mismatchData = {
		isNeighborhoodData: true,
		district: "別の地区",
		neighborhood: [{ role: "会長", lastName: "異名", firstName: "太郎" }]
	};
	// Case 1: user cancels confirmation -> merge aborted
	global.confirm = () => false;
	districtLib.mergeNeighborDataIntoDistrict(mismatchData);
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, "田中");

	// Case 2: user accepts confirmation -> merge proceeds
	global.confirm = () => true;
	districtLib.mergeNeighborDataIntoDistrict(mismatchData);
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, "異名");

	// Restore original neighborhood data
	state.currentDistrict.neighborhood = [
		{ role: "自治会長", lastName: "田中", firstName: "一郎", lastNameKana: "たなか", firstNameKana: "いちろう", address: "緑ヶ丘1-1", tel: "090-1111-1111", email: "tanaka@test.com", note: "" },
		{ role: "防災部長", lastName: "佐藤", firstName: "次郎", lastNameKana: "さとう", firstNameKana: "じろう", address: "緑ヶ丘1-2", tel: "090-2222-2222", email: "", note: "" }
	];

	// 3. Export District File
	let downloadedDistrictFile = null;
	global.downloadTextFile = (content, filename) => {
		downloadedDistrictFile = { content, filename };
	};
	document.getElementById('d-name').value = "緑ヶ丘";
	document.getElementById('d-pass').value = pass;
	document.getElementById('d-pass-confirm').value = pass;
	await districtLib.exportDistrictTxt();
	assert(downloadedDistrictFile, "District file should be exported");

	// 4. Rep Mode: import the district file
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	document.getElementById('rep-pass').value = pass;
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => downloadedDistrictFile.content }],
			value: downloadedDistrictFile.filename
		}
	});

	assert.strictEqual(state.repState.districts.length, 1);
	const repDist = state.repState.districts[0];
	assert.strictEqual(repDist.district, "緑ヶ丘");
	assert.strictEqual(repDist.students.length, 2);
	assert.strictEqual(repDist.officers.length, 1);
	assert.strictEqual(repDist.neighborhood.length, 2);
	assert.strictEqual(repDist.neighborhood[0].lastName, "田中");
});

test('integration: Pattern B (Neighborhood Direct to Rep First) -> District File Follows with Neighborhood Protection', async () => {
	setupDomEnvironment();
	const pass = "IntegrationPatternB123!@#";
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };

	// 1. Neighborhood President exports neighborhood file for "青葉台"
	const neighborData = {
		isNeighborhoodData: true,
		district: "青葉台",
		neighborhood: [
			{ role: "自治会長", lastName: "木下", firstName: "藤吉郎", address: "青葉台2-1", tel: "03-3333-3333" }
		]
	};
	const encNeighbor = await cryptoLib.encryptPayload(JSON.stringify(neighborData), pass);
	const neighborFile = { text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` };

	// 2. Rep imports neighborhood file directly into Rep Mode
	document.getElementById('rep-pass').value = pass;
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [neighborFile],
			value: "自治会役員データ_青葉台.txt"
		}
	});

	// Verify placeholder district created
	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].district, "青葉台");
	assert.strictEqual(state.repState.districts[0].students.length, 0);
	assert.strictEqual(state.repState.districts[0].officers.length, 0);
	assert.strictEqual(state.repState.districts[0].neighborhood.length, 1);
	assert.strictEqual(state.repState.districts[0].neighborhood[0].lastName, "木下");

	// 3. Later, district officer submits district file for "青葉台" with EMPTY neighborhood
	const districtData = createMockDistrict({
		district: "青葉台",
		han: "1班",
		hanList: ["1班"],
		officers: [
			{ role: "校外委員", lastName: "柴田", firstName: "勝家", han: "1班", tel: "090-4444-4444", childGrade: "6", childClass: "1", childName: "柴田 権六" }
		],
		neighborhood: [], // empty!
		students: [
			{ grade: "6", class: "1", han: "1班", lastName: "丹羽", firstName: "長秀", leader: "班長", isOutOfDistrict: false },
			{ grade: "3", class: "2", han: "1班", lastName: "前田", firstName: "利家", leader: "", isOutOfDistrict: false }
		]
	});
	const encDistrict = await cryptoLib.encryptPayload(JSON.stringify(districtData), pass);
	const districtFile = { text: async () => `BEGIN_DATA:\n${encDistrict}\n:END_DATA` };

	await rep.loadMultipleDistrictFiles({
		target: {
			files: [districtFile],
			value: "青葉台_1班.txt"
		}
	});

	// Verify: existing neighborhood data was PRESERVED, while students and officers were populated!
	assert.strictEqual(state.repState.districts.length, 1);
	const mergedDist = state.repState.districts[0];
	assert.strictEqual(mergedDist.district, "青葉台");
	assert.strictEqual(mergedDist.students.length, 2);
	assert.strictEqual(mergedDist.officers.length, 1);
	assert.strictEqual(mergedDist.officers[0].lastName, "柴田");
	assert.strictEqual(mergedDist.neighborhood.length, 1);
	assert.strictEqual(mergedDist.neighborhood[0].lastName, "木下");
});

test('integration: Pattern C (District First, Neighborhood Second in Rep Mode)', async () => {
	setupDomEnvironment();
	const pass = "IntegrationPatternC123!@#";
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };

	// 1. District file imported first with empty neighborhood
	const districtData = createMockDistrict({
		district: "白金",
		han: "本町班",
		hanList: ["本町班"],
		officers: [
			{ role: "代表", lastName: "徳川", firstName: "家康", han: "本町班", tel: "090-5555-5555", childGrade: "5", childClass: "1", childName: "徳川 秀忠" }
		],
		neighborhood: [],
		students: [
			{ grade: "5", class: "1", han: "本町班", lastName: "本多", firstName: "忠勝", leader: "班長", isOutOfDistrict: false }
		]
	});
	const encDistrict = await cryptoLib.encryptPayload(JSON.stringify(districtData), pass);
	document.getElementById('rep-pass').value = pass;
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encDistrict}\n:END_DATA` }],
			value: "白金_本町班.txt"
		}
	});

	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].neighborhood.length, 0);

	// 2. Later, neighborhood president imports neighborhood file into Rep Mode
	const neighborData = {
		isNeighborhoodData: true,
		district: "白金",
		neighborhood: [
			{ role: "自治会長", lastName: "酒井", firstName: "忠次", address: "白金1-3", tel: "03-5555-5555" },
			{ role: "副会長", lastName: "榊原", firstName: "康政", address: "白金1-4", tel: "03-6666-6666" }
		]
	};
	const encNeighbor = await cryptoLib.encryptPayload(JSON.stringify(neighborData), pass);
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }],
			value: "自治会役員データ_白金.txt"
		}
	});

	// Verify: existing district entry was updated with neighborhood roster, retaining students and officers
	assert.strictEqual(state.repState.districts.length, 1);
	const dist = state.repState.districts[0];
	assert.strictEqual(dist.district, "白金");
	assert.strictEqual(dist.students.length, 1);
	assert.strictEqual(dist.students[0].lastName, "本多");
	assert.strictEqual(dist.officers.length, 1);
	assert.strictEqual(dist.officers[0].lastName, "徳川");
	assert.strictEqual(dist.neighborhood.length, 2);
	assert.strictEqual(dist.neighborhood[0].lastName, "酒井");
	assert.strictEqual(dist.neighborhood[1].lastName, "榊原");
});

test('integration: Pattern D (Multi-Han District Sync & Deduplication)', async () => {
	setupDomEnvironment();
	const pass = "IntegrationPatternD123!@#";
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };

	// 1. Two separate ban files for "花園"
	const dHanA = createMockDistrict({
		district: "花園",
		han: "1班",
		hanList: ["1班", "2班"],
		officers: [{ role: "校外委員", lastName: "花村", firstName: "太郎", han: "1班", tel: "090-7777-7777" }],
		neighborhood: [],
		students: [{ grade: "4", class: "1", han: "1班", lastName: "生徒", firstName: "A", leader: "班長" }]
	});
	const dHanB = createMockDistrict({
		district: "花園",
		han: "2班",
		hanList: ["1班", "2班"],
		officers: [{ role: "校外委員", lastName: "園田", firstName: "次郎", han: "2班", tel: "090-8888-8888" }],
		neighborhood: [],
		students: [{ grade: "2", class: "2", han: "2班", lastName: "生徒", firstName: "B", leader: "班長" }]
	});

	const encA = await cryptoLib.encryptPayload(JSON.stringify(dHanA), pass);
	const encB = await cryptoLib.encryptPayload(JSON.stringify(dHanB), pass);
	document.getElementById('rep-pass').value = pass;

	await rep.loadMultipleDistrictFiles({
		target: {
			files: [
				{ text: async () => `BEGIN_DATA:\n${encA}\n:END_DATA` },
				{ text: async () => `BEGIN_DATA:\n${encB}\n:END_DATA` }
			],
			value: "花園_files"
		}
	});
	assert.strictEqual(state.repState.districts.length, 2);

	// 2. Merge neighborhood file for "花園" into Rep Mode
	const neighborData = {
		isNeighborhoodData: true,
		district: "花園",
		neighborhood: [
			{ role: "自治会長", lastName: "花園", firstName: "会長", address: "花園1-1", tel: "03-7777-7777" }
		]
	};
	const encNeighbor = await cryptoLib.encryptPayload(JSON.stringify(neighborData), pass);
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => `BEGIN_DATA:\n${encNeighbor}\n:END_DATA` }],
			value: "自治会役員データ_花園.txt"
		}
	});

	// Both bans in的花園 should have the synchronized neighborhood list
	assert.strictEqual(state.repState.districts[0].neighborhood.length, 1);
	assert.strictEqual(state.repState.districts[0].neighborhood[0].lastName, "花園");
	assert.strictEqual(state.repState.districts[1].neighborhood.length, 1);
	assert.strictEqual(state.repState.districts[1].neighborhood[0].lastName, "花園");

	// Deduplication test: getUniqueNeighborhoodDistricts should yield exactly 1 entry for "花園"
	const uniqueNeighbors = utils.getUniqueNeighborhoodDistricts(state.repState.districts);
	assert.strictEqual(uniqueNeighbors.length, 1);
	assert.strictEqual(uniqueNeighbors[0].d.district, "花園");
	assert.strictEqual(uniqueNeighbors[0].d.neighborhood.length, 1);
});

test('integration: Clipboard Paste Workflows for Neighborhood Data in District and Rep Modes', async () => {
	setupDomEnvironment();
	const pass = "IntegrationPaste123!@#";

	const neighborData = {
		isNeighborhoodData: true,
		district: "富士見",
		neighborhood: [
			{ role: "自治会長", lastName: "富士", firstName: "太郎", address: "富士見1-1", tel: "03-8888-8888" }
		]
	};
	const enc = await cryptoLib.encryptPayload(JSON.stringify(neighborData), pass);
	const clipboardText = `BEGIN_DATA:\n${enc}\n:END_DATA`;

	// 1. Paste into District Mode via #d-paste-box and loadDistrictTxt routing
	state.currentDistrict = createMockDistrict({
		district: "富士見",
		han: "南班",
		students: [{ grade: "3", class: "1", han: "南班", lastName: "見山", firstName: "健", leader: "班長" }],
		neighborhood: []
	});
	document.getElementById('d-pass').value = pass;
	const dPasteBox = document.getElementById('d-paste-box');
	if (dPasteBox) dPasteBox.value = clipboardText;

	// In district.js, loadDistrictTxt routing also applies when reading from loadDistrictTxt or mergeNeighborDataIntoDistrict
	const parsedData = await cryptoLib.parseTxtContent(clipboardText, pass);
	districtLib.mergeNeighborDataIntoDistrict(parsedData);

	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, "富士");

	// 2. Paste into Rep Mode via #rep-paste-box and rep.loadPastedTextToRep
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	document.getElementById('rep-pass').value = pass;
	const repPasteBox = document.getElementById('rep-paste-box');
	repPasteBox.value = clipboardText;

	await rep.loadPastedTextToRep();

	assert.strictEqual(state.repState.districts.length, 1);
	assert.strictEqual(state.repState.districts[0].district, "富士見");
	assert.strictEqual(state.repState.districts[0].neighborhood.length, 1);
	assert.strictEqual(state.repState.districts[0].neighborhood[0].lastName, "富士");
});
