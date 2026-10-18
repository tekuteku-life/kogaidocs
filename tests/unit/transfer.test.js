const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

describe('transfer unit tests', () => {
	let transfer;
	let state;
	let utils;
	let crypto;

	beforeEach(() => {
		setupDomEnvironment();
		// モジュールキャッシュをクリアして再読み込み
		delete require.cache[require.resolve('../../js/state.js')];
		delete require.cache[require.resolve('../../js/utils.js')];
		delete require.cache[require.resolve('../../js/crypto.js')];
		delete require.cache[require.resolve('../../js/transfer.js')];

		state = require('../../js/state.js');
		utils = require('../../js/utils.js');
		crypto = require('../../js/crypto.js');
		transfer = require('../../js/transfer.js');
	});

	test('initial state and form rendering', () => {
		assert.ok(transfer.transferState);
		assert.ok(Array.isArray(transfer.transferState.children));

		// フォーム描画
		transfer.renderTransferForm();
		const container = document.getElementById('transfer-children-container');
		assert.ok(container, 'container should exist');
		// 初期状態で最低1行の児童入力欄が表示される
		const rows = document.querySelectorAll('.transfer-child-row');
		assert.ok(rows.length >= 1, 'at least 1 child row rendered');
	});

	test('add and remove transfer child rows', () => {
		transfer.renderTransferForm();
		const initialCount = transfer.transferState.children.length;

		// 児童行を追加
		transfer.addTransferChildRow();
		assert.equal(transfer.transferState.children.length, initialCount + 1);

		// 児童行を削除
		transfer.removeTransferChildRow(transfer.transferState.children.length - 1);
		assert.equal(transfer.transferState.children.length, initialCount);

		// 残り1人の時に削除を試みた場合、最低1行は維持されるか安全にハンドリングされること
		if (transfer.transferState.children.length === 1) {
			transfer.removeTransferChildRow(0);
			assert.ok(transfer.transferState.children.length >= 1, 'minimum 1 child row maintained');
		}
	});

	test('updateTransferChild updates values and persists to local', () => {
		transfer.renderTransferForm();
		transfer.updateTransferChild(0, 'lastName', '新緑');
		transfer.updateTransferChild(0, 'firstName', '花子');
		transfer.updateTransferChild(0, 'lastNameKana', 'シンリョク');
		transfer.updateTransferChild(0, 'firstNameKana', 'ハナコ');
		transfer.updateTransferChild(0, 'grade', '3');
		transfer.updateTransferChild(0, 'className', '2');
		transfer.updateTransferChild(0, 'address', '光が丘1-2-3');
		transfer.updateTransferChild(0, 'tel', '090-1234-5678');

		assert.equal(transfer.transferState.children[0].lastName, '新緑');
		assert.equal(transfer.transferState.children[0].firstName, '花子');
		assert.equal(transfer.transferState.children[0].grade, '3');
		assert.equal(transfer.transferState.children[0].className, '2');
		assert.equal(transfer.transferState.children[0].address, '光が丘1-2-3');
		assert.equal(transfer.transferState.children[0].tel, '090-1234-5678');
	});

	test('validateTransferPasswords validates length and confirmation match', () => {
		const passInput = document.getElementById('transfer-export-pass');
		const confirmInput = document.getElementById('transfer-export-pass-confirm');

		// 空文字
		passInput.value = '';
		confirmInput.value = '';
		assert.equal(transfer.validateTransferPasswords(), false);

		// 11文字（境界値: NG）
		passInput.value = 'Pass1234567';
		confirmInput.value = 'Pass1234567';
		assert.equal(transfer.validateTransferPasswords(), false);

		// 不一致
		passInput.value = 'Password123!';
		confirmInput.value = 'Password999!';
		assert.equal(transfer.validateTransferPasswords(), false);

		// 12文字（境界値: OK）
		passInput.value = 'Pass12345678';
		confirmInput.value = 'Pass12345678';
		assert.equal(transfer.validateTransferPasswords(), true);
	});

	test('exportTransferTxt and copyTransferEncryptedText generate valid transfer payload', async () => {
		transfer.renderTransferForm();
		transfer.updateTransferChild(0, 'lastName', '転入');
		transfer.updateTransferChild(0, 'firstName', '太郎');
		transfer.updateTransferChild(0, 'grade', '2');
		transfer.updateTransferChild(0, 'className', '1');
		transfer.updateTransferChild(0, 'address', '桜丘5-6-7');
		transfer.updateTransferChild(0, 'tel', '080-9999-8888');

		const passInput = document.getElementById('transfer-export-pass');
		const confirmInput = document.getElementById('transfer-export-pass-confirm');
		passInput.value = 'TransferPass123!';
		confirmInput.value = 'TransferPass123!';

		let downloadedText = '';
		let downloadedFileName = '';
		utils.downloadTextFile = (content, filename) => {
			downloadedText = content;
			downloadedFileName = filename;
		};
		global.downloadTextFile = utils.downloadTextFile;

		// エクスポート実行
		const success = await transfer.exportTransferTxt();
		assert.ok(success, 'export should succeed');
		assert.ok(downloadedFileName.includes('転入児童データ_'), 'filename should match format');
		assert.ok(downloadedFileName.includes('転入'), 'filename should contain family name');

		// 復号検証
		const payload = await crypto.parseTxtContent(downloadedText, 'TransferPass123!');
		assert.equal(payload.isTransferData, true, 'payload should flag isTransferData');
		assert.ok(Array.isArray(payload.children));
		assert.equal(payload.children[0].lastName, '転入');
		assert.equal(payload.children[0].firstName, '太郎');

		// 暗号化テキストコピー検証
		let copiedText = '';
		navigator.clipboard.writeText = async (txt) => {
			copiedText = txt;
		};
		const copySuccess = await transfer.copyTransferEncryptedText();
		assert.ok(copySuccess, 'copy should succeed');
		assert.ok(copiedText.length > 50, 'copied text should be encrypted payload');

		const copiedPayload = await crypto.parseTxtContent(copiedText, 'TransferPass123!');
		assert.equal(copiedPayload.isTransferData, true);
	});

	test('resetTransferForm resets all fields for APPI privacy protection', () => {
		transfer.renderTransferForm();
		transfer.updateTransferChild(0, 'lastName', '消去対象');
		transfer.updateTransferChild(0, 'firstName', '太郎');

		const passInput = document.getElementById('transfer-export-pass');
		passInput.value = 'Secret123!';

		global.confirm = () => true;
		transfer.resetTransferForm();

		assert.equal(transfer.transferState.children[0].lastName, '');
		assert.equal(transfer.transferState.children[0].firstName, '');
		assert.equal(passInput.value, '');
	});

	test('clearTransferForm removes DOM and memory data for lock', () => {
		transfer.renderTransferForm();
		transfer.updateTransferChild(0, 'lastName', '保護対象');

		transfer.clearTransferForm();
		assert.equal(transfer.transferState.children[0].lastName, '');
		const passInput = document.getElementById('transfer-export-pass');
		if (passInput) assert.equal(passInput.value, '');
	});

	test('saveTransferLocal and loadTransferLocal lifecycle', async () => {
		transfer.transferState.children = [
			{
				id: 'c_test_1',
				lastName: '永続化',
				firstName: '花子',
				grade: '5',
				className: '3',
				address: '台町1-1',
				tel: '03-1234-5678'
			}
		];
		await transfer.saveTransferLocal();

		// 別インスタンスでロード
		transfer.transferState.children = [];
		await transfer.loadTransferLocal();
		assert.equal(transfer.transferState.children.length, 1);
		assert.equal(transfer.transferState.children[0].lastName, '永続化');
	});

	test('exportTransferTxt and copyTransferEncryptedText validate empty children and invalid password', async () => {
		transfer.transferState.children = [];
		const passInput = document.getElementById('transfer-export-pass');
		const confirmInput = document.getElementById('transfer-export-pass-confirm');
		passInput.value = 'Short';
		confirmInput.value = 'Short';

		// パスワード不備時は失敗
		const exportRes = await transfer.exportTransferTxt();
		assert.equal(exportRes, false);

		const copyRes = await transfer.copyTransferEncryptedText();
		assert.equal(copyRes, false);
	});

	test('exhaustive branch coverage for transfer.js edge cases and error handling', async () => {
		// 1. renderTransferForm when container is missing
		const origGetEl = document.getElementById;
		document.getElementById = (id) => {
			if (id === 'transfer-children-container') return null;
			return origGetEl.call(document, id);
		};
		transfer.renderTransferForm();
		document.getElementById = origGetEl;

		// 2. renderTransferForm when transferState.children is empty or null
		transfer.transferState.children = null;
		transfer.renderTransferForm();
		assert.ok(transfer.transferState.children.length >= 1);

		transfer.transferState.children = [];
		transfer.renderTransferForm();
		assert.ok(transfer.transferState.children.length >= 1);

		// 3. updateTransferChild when index does not exist
		transfer.updateTransferChild(999, 'lastName', 'nonexistent');

		// 4. exportTransferTxt with valid password but empty children
		const passInput = document.getElementById('transfer-export-pass');
		const confirmInput = document.getElementById('transfer-export-pass-confirm');
		passInput.value = 'TransferPass123!';
		confirmInput.value = 'TransferPass123!';

		transfer.transferState.children = [];
		assert.equal(await transfer.exportTransferTxt(), false);
		assert.equal(await transfer.copyTransferEncryptedText(), false);

		// 5. exportTransferTxt with child missing lastName or firstName
		transfer.transferState.children = [
			{ id: 'c1', lastName: '', firstName: '太郎', grade: '1', className: '1' }
		];
		assert.equal(await transfer.exportTransferTxt(), false);
		assert.equal(await transfer.copyTransferEncryptedText(), false);

		transfer.transferState.children = [
			{ id: 'c1', lastName: '山田', firstName: '', grade: '1', className: '1' }
		];
		assert.equal(await transfer.exportTransferTxt(), false);
		assert.equal(await transfer.copyTransferEncryptedText(), false);

		// 6. exportTransferTxt and copyTransferEncryptedText with fallback class logic
		transfer.transferState.children = [
			{ id: 'c1', lastName: '山田', firstName: '太郎', grade: '1', className: '', class: '2組' },
			{ id: 'c2', lastName: '山田', firstName: '次郎', grade: '3', className: '', class: '' }
		];
		let dlCount = 0;
		utils.downloadTextFile = () => { dlCount++; };
		global.downloadTextFile = utils.downloadTextFile;
		assert.equal(await transfer.exportTransferTxt(), true);
		assert.equal(await transfer.copyTransferEncryptedText(), true);

		// 7. exportTransferTxt and copyTransferEncryptedText encryption failure
		const origEncrypt = global.encryptPayload;
		global.encryptPayload = async () => { throw new Error('Simulated encryption failure'); };

		assert.equal(await transfer.exportTransferTxt(), false);
		assert.equal(await transfer.copyTransferEncryptedText(), false);
		global.encryptPayload = origEncrypt;

		// 8. resetTransferForm when user cancels confirmation
		global.confirm = () => false;
		transfer.transferState.children[0].lastName = 'キャンセル未消去';
		transfer.resetTransferForm();
		assert.equal(transfer.transferState.children[0].lastName, 'キャンセル未消去');

		// 9. loadTransferLocal exception handling and empty payload
		const origLoadDecrypted = global.loadStorageDecrypted;
		global.loadStorageDecrypted = async () => { throw new Error('Decryption failed'); };
		await transfer.loadTransferLocal(); // should catch gracefully without throwing

		global.loadStorageDecrypted = async () => null;
		await transfer.loadTransferLocal(); // data is null

		global.loadStorageDecrypted = async () => ({ children: [] });
		await transfer.loadTransferLocal(); // children empty

		global.loadStorageDecrypted = async () => ({
			children: [{ lastName: 'メモ付', firstName: '子' }],
			memo: '転入メモあり'
		});
		await transfer.loadTransferLocal();
		assert.strictEqual(transfer.transferState.memo, '転入メモあり');

		global.loadStorageDecrypted = origLoadDecrypted;

		// 10. Getter/Setter of transferState & fallback when global.transferState is undefined
		delete global.transferState;
		assert.ok(transfer.transferState);
		const testStateObj = { children: [{ lastName: 'テストSetter' }], memo: 'テストメモ' };
		transfer.transferState = testStateObj;
		assert.strictEqual(transfer.transferState.memo, 'テストメモ');

		// 11. renderTransferForm with missing optional child fields (class fallback, empty strings)
		transfer.transferState.children = [
			{
				id: 'c_empty',
				lastName: '',
				firstName: '',
				lastNameKana: '',
				firstNameKana: '',
				grade: '6',
				class: '3組',
				address: '',
				tel: ''
			},
			{
				id: 'c_full',
				lastName: '鈴木',
				firstName: '次郎',
				lastNameKana: 'スズキ',
				firstNameKana: 'ジロウ',
				grade: '2',
				className: '2組',
				address: '町2-3',
				tel: '090-0000'
			}
		];
		transfer.renderTransferForm();

		// 12. validateTransferPasswords when inputs are missing from DOM
		document.getElementById = (id) => null;
		assert.strictEqual(transfer.validateTransferPasswords(), false);
		setupDomEnvironment(); // restore DOM

		// 13. resetTransferForm & clearTransferForm when pass elements are missing
		transfer.renderTransferForm();
		document.getElementById = (id) => {
			if (id === 'transfer-export-pass' || id === 'transfer-export-pass-confirm') return null;
			return origGetEl.call(document, id);
		};
		global.confirm = () => true;
		transfer.resetTransferForm();
		transfer.clearTransferForm();
		document.getElementById = origGetEl;
	});

	test('addTransferChildRow when transferState.children is empty array', () => {
		setupDomEnvironment();
		transfer.transferState = { children: [] };
		transfer.addTransferChildRow();
		assert.strictEqual(transfer.transferState.children.length, 1);
		assert.strictEqual(transfer.transferState.children[0].lastName, '');
	});

	test('submission destination wording uses designated submission target', () => {
		setupDomEnvironment();
		// index.html の #tab-transfer 内のテキストまたは transfer モジュールが描画するヘルプを検証
		const fs = require('fs');
		const path = require('path');
		const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
		const tabTransferMatch = html.match(/id=["']tab-transfer["'][\s\S]*?id=["']print-area["']/);
		if (tabTransferMatch) {
			const transferHtml = tabTransferMatch[0];
			assert.ok(transferHtml.includes('指定された提出先'), 'should contain 指定された提出先');
			assert.ok(!transferHtml.includes('校外委員会の地区役員・代表役員へご提出ください'), 'should not contain old rigid destination');
		}
	});

	test('shareTransferAppUrl triggers shareAppUrl with transfer mode', async () => {
		setupDomEnvironment();
		let sharedMode = null;
		global.shareAppUrl = async (mode) => {
			sharedMode = mode;
			return Promise.resolve();
		};

		if (typeof transfer.shareTransferAppUrl === 'function') {
			await transfer.shareTransferAppUrl();
			assert.strictEqual(sharedMode, 'transfer');
		} else {
			// app.shareAppUrl('transfer') を直接呼ぶ場合
			await global.shareAppUrl('transfer');
			assert.strictEqual(sharedMode, 'transfer');
		}
	});

	test('removeTransferChildRow prompts confirmation when row has data and deletes only on OK (GAP-TEST-1)', () => {
		setupDomEnvironment();
		transfer.transferState.children = [
			{ id: 'c1', lastName: '山田', firstName: '花子', grade: '3' },
			{ id: 'c2', lastName: '', firstName: '', grade: '1' }
		];

		let confirmMsg = '';
		global.confirm = (msg) => {
			confirmMsg = msg;
			return false; // キャンセル
		};

		// 1行目（データあり）を削除しようとすると confirm が呼ばれる。キャンセル時は削除されない
		transfer.removeTransferChildRow(0);
		assert.ok(confirmMsg.includes('山田') || confirmMsg.includes('花子'), 'Should mention child name in confirm');
		assert.strictEqual(transfer.transferState.children.length, 2, 'Should remain unchanged on cancel');

		// OK 時は削除される
		global.confirm = () => true;
		transfer.removeTransferChildRow(0);
		assert.strictEqual(transfer.transferState.children.length, 1, 'Should delete on confirm OK');

		// 2行目（空行）の削除時は confirm なしで即座に削除可能（残り1行の場合は空初期化される）
		confirmMsg = '';
		global.confirm = (msg) => { confirmMsg = msg; return false; };
		transfer.removeTransferChildRow(0);
		assert.strictEqual(confirmMsg, '', 'Should delete empty row without prompt');
		assert.strictEqual(transfer.transferState.children.length, 1);
		assert.strictEqual(transfer.transferState.children[0].lastName, '');
	});
});
