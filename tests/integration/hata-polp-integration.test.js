const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const districtLib = require('../../js/district.js');
require('../../js/seat.js');
const rep = require('../../js/rep.js');
const hata = require('../../js/hata.js');

test('integration: Pattern F - Hatafurotto PoLP boundary defense & round-trip district protection', async () => {
	setupDomEnvironment();
	const pwd = 'TestPassword123!';

	// 1. 地区側で児童入力および旗振り設定を作成
	state.currentDistrict = {
		district: '1丁目',
		han: 'A班',
		hanList: ['A班', 'B班'],
		officers: [{ role: '地区長', lastName: '山田', firstName: '太郎', tel: '090-0000-0000' }],
		neighborhood: [{ role: '自治会長', lastName: '佐藤', firstName: '一郎' }],
		students: [
			{ grade: '3', class: '1組', han: 'A班', lastName: '鈴木', firstName: '健太', address: '1-1-1', tel: '03-1111-1111' },
			{ grade: '1', class: '2組', han: 'B班', lastName: '高橋', firstName: '美咲', address: '1-2-2', tel: '03-2222-2222' }
		],
		hata: {
			title: '1丁目登校見守り活動シフト表',
			location: '1丁目交差点',
			time: '7:45〜8:15',
			startDate: '2026-05-01',
			endDate: '2026-09-30',
			weekdays: [1, 2, 3, 4, 5],
			orientation: 'landscape',
			layoutColumns: '3',
			exemptHouseholds: ['1-1-1_鈴木'],
			manualOverrides: {
				'2026-05-08': { person: '高橋', note: '交代', isSwapped: true, originalPerson: '鈴木' }
			}
		}
	};

	// 2. 地区データを暗号化ファイル出力（hataを含む）
	const encryptedDistrictPayload = await cryptoLib.encryptPayload(JSON.stringify(state.currentDistrict), pwd);
	assert.ok(encryptedDistrictPayload);

	// 3. 校外代表モード（タブ②）で取り込み（upsertRepDistrict）
	state.repState.districts = [];
	const decryptedIncoming = JSON.parse(await cryptoLib.decryptPayload(encryptedDistrictPayload, pwd));
	assert.ok(decryptedIncoming.hata, 'Incoming district payload must contain original hata');

	// 取り込み実行
	rep.upsertRepDistrict(decryptedIncoming);

	// 【PoLP検証】代表State内の集約データには hata が一切存在しないこと
	assert.strictEqual(state.repState.districts.length, 1);
	const storedRepDistrict = state.repState.districts[0];
	assert.strictEqual(storedRepDistrict.district, '1丁目');
	assert.strictEqual(storedRepDistrict.hata, undefined, 'PoLP: stored rep district must NOT contain hata');
	assert.strictEqual(storedRepDistrict.hatafurotto, undefined, 'PoLP: stored rep district must NOT contain hatafurotto');

	// 代表マスター暗号化保存をシミュレート
	const repMasterPayload = await cryptoLib.encryptPayload(JSON.stringify(state.repState), pwd);
	const decryptedMaster = JSON.parse(await cryptoLib.decryptPayload(repMasterPayload, pwd));
	assert.strictEqual(decryptedMaster.districts[0].hata, undefined, 'PoLP: rep master ciphertext must NOT contain hata');

	// 4. 代表モードから各地区へ切り出し出力（Split-Export）
	document.getElementById('rep-pass').value = pwd;
	let exportedCiphertext = '';
	global.downloadTextFile = (content, filename) => {
		const match = content.match(/BEGIN_DATA:\n([\s\S]+?)\n:END_DATA/);
		if (match) exportedCiphertext = match[1].trim();
	};

	await rep.exportSingleDistrictFromRep(0, pwd, 'download');
	assert.ok(exportedCiphertext, 'Should produce single district exported ciphertext');

	// 切り出されたデータを復号して検証
	const decryptedSplit = JSON.parse(await cryptoLib.decryptPayload(exportedCiphertext, pwd));
	assert.strictEqual(decryptedSplit.district, '1丁目');
	assert.strictEqual(decryptedSplit.hata, undefined, 'PoLP: split-exported single district must NOT contain hata');

	// 5. 地区役員モード（タブ①）で戻されたファイルを読み込み
	// （地区ローカルには既存の hata が保持されている状態）
	const preservedLocalHata = JSON.parse(JSON.stringify(state.currentDistrict.hata));
	state.currentDistrict.officers[0].lastName = '代表で更新された役員名';

	const file = { name: '地区データ_1丁目.txt' };
	global.FileReader = class {
		readAsText() {
			this.onload({ target: { result: `BEGIN_DATA:\n${exportedCiphertext}\n:END_DATA` } });
		}
	};
	document.getElementById('d-file-pass').value = pwd;

	await districtLib.loadDistrictTxt(file);

	// 【保護マージ検証】読み込みファイルに hata がなくても、既存の自地区 hata が復元・保護されていること！
	assert.strictEqual(state.currentDistrict.district, '1丁目');
	assert.ok(state.currentDistrict.hata, 'District local hata must be preserved after loading split-export file');
	assert.strictEqual(state.currentDistrict.hata.title, '1丁目登校見守り活動シフト表');
	assert.strictEqual(state.currentDistrict.hata.location, '1丁目交差点');
	assert.deepStrictEqual(state.currentDistrict.hata.exemptHouseholds, preservedLocalHata.exemptHouseholds);
	assert.deepStrictEqual(state.currentDistrict.hata.manualOverrides, preservedLocalHata.manualOverrides);
});
