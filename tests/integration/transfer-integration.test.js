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
const transfer = require('../../js/transfer.js');

test('integration: Pattern B - Transfer Export -> District Integration -> District Export -> Rep Import', async () => {
	setupDomEnvironment();
	const pass = 'PatternBPass123!#';

	// 1. Transfer Mode: 入力と暗号化ファイル出力
	transfer.transferState = {
		children: [
			{
				id: 't_c1',
				lastName: '星野',
				firstName: '光',
				lastNameKana: 'ホシノ',
				firstNameKana: 'ヒカル',
				grade: '5',
				className: '1',
				address: '桜ヶ丘3-10-5',
				tel: '090-7777-8888'
			},
			{
				id: 't_c2',
				lastName: '星野',
				firstName: '空',
				lastNameKana: 'ホシノ',
				firstNameKana: 'ソラ',
				grade: '2',
				className: '2',
				address: '桜ヶ丘3-10-5',
				tel: '090-7777-8888'
			}
		]
	};
	document.getElementById('transfer-export-pass').value = pass;
	document.getElementById('transfer-export-pass-confirm').value = pass;

	let exportedTransferFile = null;
	utils.downloadTextFile = (content, filename) => {
		exportedTransferFile = { content, filename };
	};
	global.downloadTextFile = utils.downloadTextFile;

	await transfer.exportTransferTxt();
	assert.ok(exportedTransferFile, 'Transfer file must be exported');
	assert.ok(exportedTransferFile.filename.includes('転入児童データ_星野'));

	// 2. District Mode: 既存地区データへ統合
	state.currentDistrict = createMockDistrict({
		district: '桜ヶ丘',
		han: '1班',
		hanList: ['1班', '2班'],
		officers: [
			{ role: '校外委員', lastName: '佐藤', firstName: '明', han: '1班', tel: '090-1111-2222' }
		],
		students: [
			{ grade: '6', class: '1', han: '1班', lastName: '既存', firstName: '太郎', leader: '班長', isOutOfDistrict: false }
		]
	});
	document.getElementById('d-name').value = '桜ヶ丘';
	document.getElementById('d-pass').value = pass;

	global.prompt = (msg, def) => '1班';
	global.confirm = () => true;

	await districtLib.loadTransferFileIntoDistrict({
		target: {
			files: [{ text: async () => exportedTransferFile.content }],
			value: exportedTransferFile.filename
		}
	});

	// 児童名簿に2名追加され、計3名になっていること
	assert.strictEqual(state.currentDistrict.students.length, 3);
	const hoshino1 = state.currentDistrict.students.find(s => s.firstName === '光');
	const hoshino2 = state.currentDistrict.students.find(s => s.firstName === '空');
	assert.ok(hoshino1);
	assert.ok(hoshino2);
	assert.strictEqual(hoshino1.han, '1班');
	assert.strictEqual(hoshino2.han, '1班');
	// 既存校外委員が保持されていること
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.officers[0].lastName, '佐藤');

	// 3. District Mode: 地区ファイルを暗号化出力
	let exportedDistrictFile = null;
	utils.downloadTextFile = (content, filename) => {
		exportedDistrictFile = { content, filename };
	};
	global.downloadTextFile = utils.downloadTextFile;
	document.getElementById('d-pass-confirm').value = pass;
	await districtLib.exportDistrictTxt();
	assert.ok(exportedDistrictFile);

	// 4. Rep Mode: 校外代表モードへインポート
	state.repState = {
		districts: [],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	document.getElementById('rep-pass').value = pass;
	await rep.loadMultipleDistrictFiles({
		target: {
			files: [{ text: async () => exportedDistrictFile.content, name: exportedDistrictFile.filename }],
			value: 'districts.txt'
		}
	});

	assert.strictEqual(state.repState.districts.length, 1);
	const importedDistrict = state.repState.districts[0];
	assert.strictEqual(importedDistrict.district, '桜ヶ丘');
	assert.strictEqual(importedDistrict.students.length, 3);
	assert.ok(importedDistrict.students.some(s => s.firstName === '光'));
	assert.ok(importedDistrict.students.some(s => s.firstName === '空'));
});

test('integration: Pattern C - Transfer Copy Text -> Direct Rep Integration', async () => {
	setupDomEnvironment();
	const pass = 'PatternCPass789!#';

	// 1. Transfer Mode: 暗号化テキストコピー
	transfer.transferState = {
		children: [
			{
				id: 't_c3',
				lastName: '青木',
				firstName: '若葉',
				grade: '3',
				className: '2',
				address: '青葉台1-1',
				tel: '080-1234-5678'
			}
		]
	};
	document.getElementById('transfer-export-pass').value = pass;
	document.getElementById('transfer-export-pass-confirm').value = pass;

	let copiedText = '';
	navigator.clipboard.writeText = async (txt) => {
		copiedText = txt;
	};
	await transfer.copyTransferEncryptedText();
	assert.ok(copiedText.length > 50);

	// 2. Rep Mode: 既存地区「青葉地区」に直接貼り付け統合
	state.repState = {
		districts: [
			{
				district: '青葉地区',
				han: '1班',
				selectedForPrint: true,
				officers: [],
				students: []
			}
		],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	document.getElementById('rep-pass').value = pass;

	let promptCount = 0;
	global.prompt = (msg, def) => {
		promptCount++;
		if (promptCount === 1) return '青葉地区';
		return '2班';
	};
	global.confirm = () => true;

	await rep.loadPastedTransferTextIntoRep(copiedText);

	const dist = state.repState.districts.find(d => d.district === '青葉地区');
	assert.ok(dist);
	assert.strictEqual(dist.students.length, 1);
	assert.strictEqual(dist.students[0].lastName, '青木');
	assert.strictEqual(dist.students[0].firstName, '若葉');
	assert.strictEqual(dist.students[0].han, '2班');
});

test('integration: Pattern E - School Route: Transfer Export -> Rep Direct Import -> Rep Split-Export -> District Load', async () => {
	setupDomEnvironment();
	const pass = 'PatternEPass123!@#';

	// Step 1: 転入家庭が転入者モードで入力・暗号化出力
	transfer.transferState = {
		children: [
			{
				id: 't_c_e1',
				lastName: '転入生',
				firstName: '翔太',
				lastNameKana: 'テンニュウセイ',
				firstNameKana: 'ショウタ',
				grade: '4',
				className: '2',
				address: '東町5-1',
				tel: '090-5555-6666'
			}
		]
	};
	document.getElementById('transfer-export-pass').value = pass;
	document.getElementById('transfer-export-pass-confirm').value = pass;

	let exportedTransferFile = null;
	utils.downloadTextFile = (content, filename) => {
		exportedTransferFile = { content, filename };
	};
	global.downloadTextFile = utils.downloadTextFile;

	await transfer.exportTransferTxt();
	assert.ok(exportedTransferFile);

	// Step 2: 校外代表が代表モードで取り込み、東地区・1班に割り当て
	state.repState = {
		districts: [
			{
				district: '東地区',
				han: '1班',
				hanList: ['1班', '2班'],
				selectedForPrint: true,
				officers: [{ role: '校外委員', lastName: '山田', firstName: '太郎', han: '1班' }],
				neighborhood: [{ role: '会長', lastName: '佐藤', firstName: '一郎' }],
				students: [
					{ grade: '6', class: '1', han: '1班', lastName: '既存東', firstName: '健太', leader: '班長', isOutOfDistrict: false }
				]
			},
			{
				district: '西地区',
				han: '1班',
				hanList: ['1班'],
				selectedForPrint: true,
				officers: [],
				neighborhood: [],
				students: []
			}
		],
		seatConfig: { cols: 4, rows: 5, cells: {} }
	};
	document.getElementById('rep-pass').value = pass;

	let promptCount = 0;
	global.prompt = (msg, def) => {
		promptCount++;
		if (promptCount === 1) return '東地区';
		return '1班';
	};
	global.confirm = () => true;

	await rep.loadTransferFileIntoRep({
		target: {
			files: [{ text: async () => exportedTransferFile.content }],
			value: exportedTransferFile.filename
		}
	});

	// 東地区に転入生が追加され、計2名になっていること
	const higashiInRep = state.repState.districts.find(d => d.district === '東地区');
	assert.strictEqual(higashiInRep.students.length, 2);
	const addedShota = higashiInRep.students.find(s => s.firstName === '翔太');
	assert.ok(addedShota);
	assert.strictEqual(addedShota.han, '1班');

	// Step 3: 代表モードから「東地区」の地区データを切り出し出力（Split-Export）
	let exportedDistrictFile = null;
	utils.downloadTextFile = (content, filename) => {
		exportedDistrictFile = { content, filename };
	};
	global.downloadTextFile = utils.downloadTextFile;

	const splitSuccess = await rep.exportSingleDistrictFromRep(0, pass, 'download');
	assert.strictEqual(splitSuccess, true);
	assert.ok(exportedDistrictFile);
	assert.ok(exportedDistrictFile.filename.includes('地区データ_東地区'));

	// Step 4: 地区役員が「東地区」を地区役員モード（タブ①）で受入
	state.currentDistrict = {
		district: '東地区',
		han: '1班',
		hanList: ['1班', '2班'],
		officers: [{ role: '校外委員', lastName: '山田', firstName: '太郎', han: '1班' }],
		neighborhood: [{ role: '会長', lastName: '佐藤', firstName: '一郎' }],
		students: [
			{ grade: '6', class: '1', han: '1班', lastName: '既存東', firstName: '健太', leader: '班長', isOutOfDistrict: false }
		]
	};
	document.getElementById('d-pass').value = pass;
	global.confirm = () => true; // 上書き承認

	await districtLib.loadDistrictTxt({
		target: {
			files: [{ text: async () => exportedDistrictFile.content }],
			value: exportedDistrictFile.filename
		}
	});

	// Step 5: 地区役員モードの名簿に転入生が反映されていること
	assert.strictEqual(state.currentDistrict.district, '東地区');
	assert.strictEqual(state.currentDistrict.students.length, 2);
	const shotaInDistrict = state.currentDistrict.students.find(s => s.firstName === '翔太');
	assert.ok(shotaInDistrict);
	assert.strictEqual(shotaInDistrict.grade, '4');
	assert.strictEqual(shotaInDistrict.han, '1班');
	assert.strictEqual(shotaInDistrict.address, '東町5-1');
	// 既存役員・自治会も保持されていること
	assert.strictEqual(state.currentDistrict.officers[0].lastName, '山田');
	assert.strictEqual(state.currentDistrict.neighborhood[0].lastName, '佐藤');
});

