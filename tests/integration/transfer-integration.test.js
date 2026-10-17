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

