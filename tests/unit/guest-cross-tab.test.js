/*
 * 未暗号化の保存データの他タブ更新（R-27・E-16・内部仕様書 I-16）。
 * 別のタブの書込みは、localStorage を直接書き換えて再現する（同じ保存領域を別のタブが書いたことに当たる）。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
require('../../js/hata.js');
require('../../js/seat.js');
require('../../js/rep.js');
require('../../js/district.js');
require('../../js/neighbor.js');
const transfer = require('../../js/transfer.js');
const app = require('../../js/app.js');

const NEIGHBOR = 'kogai_neighbor_v2';
const TRANSFER = 'kogai_transfer_v2';
const neighborModel = name => ({ district: name, neighborhood: [{ role: '会長', lastName: name, firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', email: '', note: '' }] });

/** 到着の順に1つずつ通す Web Locks（共有・排他を区別しない。順序を確かめるため）。hold() は解放の関数を返す。 */
function fifoLocks() {
	const queue = [];
	let busy = false;
	const pump = () => {
		if (busy || !queue.length) return;
		busy = true;
		const next = queue.shift();
		Promise.resolve().then(() => next.callback({})).then(next.resolve, next.reject).finally(() => { busy = false; pump(); });
	};
	return {
		request: (_name, options, callback) => new Promise((resolve, reject) => { queue.push({ callback: typeof options === 'function' ? options : callback, resolve, reject }); pump(); }),
		hold() {
			let release;
			const held = new Promise(resolve => { release = resolve; });
			this.request('hold', { mode: 'exclusive' }, () => held);
			return release;
		}
	};
}

/** 平文の新しい状態（保存データと処理の状態を消し、DOM を作り直す）。 */
async function fresh(stored = {}) {
	setupDomEnvironment();
	await cryptoLib.clearStorageSecurity();
	localStorage.clear();
	for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
	global.__foreign = 0;
	global.handleForeignStorageUpdate = () => { global.__foreign++; };
}

/** 未暗号化の読込で、4つのキーを読んでメモリへ反映したものとする（反映の関数は読んだ値を返すだけ）。 */
async function loadAll() {
	const seen = [];
	const loaded = await cryptoLib.loadUnencryptedStorage(cryptoLib.getStorageSessionGeneration(), raw => { seen.push(raw); });
	return { loaded, raw: seen[0] };
}

test('R-27 / I-16-01: before the first unencrypted load, a plaintext save is refused instead of overwriting the stored data', async () => {
	// この試験は、ファイルの中で最初に実行する（読込の前は、どのキーにも既知値がない）。setupDomEnvironment は全消去を呼ぶので使わない。
	localStorage.clear();
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('保存済み')));
	global.__foreign = 0;
	global.handleForeignStorageUpdate = () => { global.__foreign++; };
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('初期値')), false, 'The save is refused');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, '保存済み', 'The stored data is kept');
	assert.strictEqual(global.__foreign, 1, 'A reload is requested');
	// 最初の読込の反映が失敗したとき: 保存値のあるキーは停止し、保存値のないキーは保存できる（I-16-03 の手順5）。
	await assert.rejects(cryptoLib.loadUnencryptedStorage(cryptoLib.getStorageSessionGeneration(), () => { throw new Error('反映の失敗'); }), /反映の失敗/);
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [NEIGHBOR]);
	assert.strictEqual(await cryptoLib.saveStorageData(TRANSFER, { children: [], memo: '' }), true, 'A key without a stored value is savable after the failure');
	assert.strictEqual(await cryptoLib.saveStorageData('kogai_custom_setting', { a: 1 }), true, 'Keys other than the four data keys are not compared');
});

test('R-27 / I-16-01・I-16-02: known values are recorded when a load is reflected, and a save after another tab changed, removed or added a value is refused', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	const { loaded, raw } = await loadAll();
	assert.strictEqual(loaded, true);
	assert.deepStrictEqual(Object.keys(raw).sort(), ['kogai_district_v2', 'kogai_neighbor_v2', 'kogai_rep_v2', 'kogai_transfer_v2'].sort(), 'The four data keys are read');
	assert.strictEqual(raw[TRANSFER], null, 'An absent key is read as null');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('A2')), true, 'A save of this tab passes');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('A3')), true, 'The written value becomes the known value');
	for (const [label, change] of [
		['changed', () => localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')))],
		['removed', () => localStorage.removeItem(NEIGHBOR)]
	]) {
		const before = global.__foreign;
		change();
		const stored = localStorage.getItem(NEIGHBOR);
		assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('古い')), false, `A save after another tab ${label} the value is refused`);
		assert.strictEqual(localStorage.getItem(NEIGHBOR), stored, `The value written by the other tab is kept (${label})`);
		assert.strictEqual(global.__foreign, before + 1, `A reload is requested (${label})`);
		await loadAll();
	}
	// 初めにない値を別のタブが加えたとき。
	localStorage.setItem(TRANSFER, JSON.stringify({ children: [], memo: '別のタブ' }));
	assert.strictEqual(await state.saveTransferLocal(), false, 'A save after another tab added the value is refused');
	assert.strictEqual(JSON.parse(localStorage.getItem(TRANSFER)).memo, '別のタブ');
});

test('R-27 / I-16-03: when the reflection throws, keys changed by another tab are suspended, the read values become known and the generation does not advance', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')), [TRANSFER]: JSON.stringify({ children: [], memo: '変わらない' }) });
	await loadAll();
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
	const generation = cryptoLib.getStorageSessionGeneration();
	const fail = () => cryptoLib.loadUnencryptedStorage(cryptoLib.getStorageSessionGeneration(), () => { throw new Error('反映の失敗'); });
	await assert.rejects(fail(), /反映の失敗/);
	assert.strictEqual(cryptoLib.getStorageSessionGeneration(), generation, 'The generation does not advance');
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [NEIGHBOR], 'Only the key changed by another tab is suspended');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('古い')), false, 'The stale memory cannot overwrite the stored value');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, 'B');
	assert.strictEqual(await cryptoLib.saveStorageData(TRANSFER, { children: [], memo: '' }), true, 'A stored key that no other tab changed stays savable');
	assert.strictEqual(await cryptoLib.saveStorageData('kogai_rep_v2', state.defaultStateModels().rep), true, 'A key without a stored value stays savable');
	// 読んだ値が既知値になるので、停止中のキーは置換の取込で解ける（比較元と同じ）。
	await cryptoLib.commitImportedModel(NEIGHBOR, neighborModel('取込'), cryptoLib.getStorageSessionGeneration(), { replace: true });
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'A replacing import resumes the key');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, '取込');
	// 失敗の後に別のタブが書いたときは、置換の取込と復元を照合で拒否する。
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('C')));
	await assert.rejects(fail(), /反映の失敗/);
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('D')));
	await assert.rejects(cryptoLib.commitImportedModel(NEIGHBOR, neighborModel('取込2'), cryptoLib.getStorageSessionGeneration(), { replace: true }), /STORAGE_SESSION_CHANGED/, 'A replacing import after another write is refused');
	const models = () => [state.currentDistrict, state.repState, neighborModel('復元'), { children: [], memo: '' }].map(model => JSON.parse(JSON.stringify(model)));
	await assert.rejects(cryptoLib.replaceStoredAppData(models()), /STORAGE_SESSION_CHANGED/, 'A restore after another write is refused');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, 'D', 'The other tab value survives');
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [NEIGHBOR]);
	// 別のタブの書込みがなければ、復元も停止を解く。
	await assert.rejects(fail(), /反映の失敗/);
	await cryptoLib.replaceStoredAppData(models());
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'A restore resumes the key');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, '復元');
});

test('R-27 / I-16-03: when the reflection throws, a key another tab removed or added is suspended so the old memory never replaces it', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('消される値')) });
	await loadAll();
	// 別のタブが、既知値のあるキーを消し、既知値が null のキーに値を加えた。
	localStorage.removeItem(NEIGHBOR);
	const added = JSON.stringify({ children: [], memo: '別のタブが加えた値' });
	localStorage.setItem(TRANSFER, added);
	await assert.rejects(cryptoLib.loadUnencryptedStorage(cryptoLib.getStorageSessionGeneration(), () => { throw new Error('反映の失敗'); }), /反映の失敗/);
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys().sort(), [NEIGHBOR, TRANSFER].sort(), 'The removed and the added keys are suspended');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('消される値')), false, 'The old memory of the removed key is not saved');
	assert.strictEqual(localStorage.getItem(NEIGHBOR), null, 'The removal by the other tab is kept');
	assert.strictEqual(await cryptoLib.saveStorageData(TRANSFER, { children: [], memo: '' }), false, 'The default memory of the added key is not saved');
	assert.strictEqual(localStorage.getItem(TRANSFER), added, 'The value added by the other tab is kept');
});

test('R-27 / I-16-03: the unencrypted load reads nothing when encrypted at entry and throws when the generation changed while waiting', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	let calls = 0;
	const before = cryptoLib.getStorageSessionGeneration();
	cryptoLib.advanceStorageSessionGeneration();
	assert.strictEqual(cryptoLib.getStorageSessionGeneration(), before + 1, 'advanceStorageSessionGeneration advances by one');
	await assert.rejects(cryptoLib.loadUnencryptedStorage(before, () => { calls++; }), /STORAGE_SESSION_CHANGED/);
	assert.strictEqual(calls, 0, 'Nothing is reflected after the generation changed');
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	assert.strictEqual(await cryptoLib.loadUnencryptedStorage(cryptoLib.getStorageSessionGeneration(), () => { calls++; }), false, 'Encrypted at entry: not read');
	assert.strictEqual(calls, 0);
	const generation = cryptoLib.getStorageSessionGeneration();
	localStorage.removeItem('kogai_auth_meta');
	assert.strictEqual(await cryptoLib.loadUnencryptedStorage(generation, () => { calls++; }), true);
	assert.strictEqual(cryptoLib.getStorageSessionGeneration(), generation + 1, 'A reflected load advances the generation');
	assert.strictEqual(calls, 1);
});

test('R-27 / I-16-03: a save that enters the exclusive section before the load is refused, and one that waits behind it is not written', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await loadAll();
	const locks = fifoLocks();
	const original = navigator.locks;
	navigator.locks = locks;
	try {
		localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
		let release = locks.hold();
		const earlier = cryptoLib.saveStorageData(NEIGHBOR, neighborModel('先の古い保存'));
		const reload = cryptoLib.loadUnencryptedStorage(cryptoLib.getStorageSessionGeneration(), () => {});
		release();
		assert.strictEqual(await earlier, false, 'The save that enters first is refused by the comparison');
		assert.strictEqual(await reload, true);
		assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, 'B');

		localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('C')));
		release = locks.hold();
		const load = cryptoLib.loadUnencryptedStorage(cryptoLib.getStorageSessionGeneration(), () => {});
		const later = cryptoLib.saveStorageData(NEIGHBOR, neighborModel('後の古い保存'));
		const laterImport = cryptoLib.commitImportedModel(NEIGHBOR, neighborModel('後の古い取込'), cryptoLib.getStorageSessionGeneration());
		release();
		assert.strictEqual(await load, true);
		assert.strictEqual(await later, false, 'The save requested before the load but granted after it is not written');
		await assert.rejects(laterImport, /STORAGE_SESSION_CHANGED/, 'The import requested before the load is cancelled');
		assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, 'C', 'The other tab value survives');
		assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('読込の後の保存')), true, 'A save started after the load passes');
	} finally {
		navigator.locks = original;
	}
});

test('R-27 / I-16-02: imports, handoff restores and encryption setup are refused after a foreign plaintext write', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await loadAll();
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
	await assert.rejects(cryptoLib.commitImportedModel(NEIGHBOR, neighborModel('取込'), cryptoLib.getStorageSessionGeneration(), { replace: true }), /STORAGE_SESSION_CHANGED/);
	assert.strictEqual(global.__foreign, 1);
	const models = [state.currentDistrict, state.repState, neighborModel('復元'), { children: [], memo: '' }].map(model => JSON.parse(JSON.stringify(model)));
	await assert.rejects(cryptoLib.replaceStoredAppData(models), /STORAGE_SESSION_CHANGED/, 'A plaintext restore is refused');
	assert.strictEqual(global.__foreign, 2);
	const generateKey = crypto.subtle.generateKey;
	const create = navigator.credentials.create;
	let keys = 0, registrations = 0;
	crypto.subtle.generateKey = async (...args) => { keys++; return generateKey.apply(crypto.subtle, args); };
	navigator.credentials.create = async (...args) => { registrations++; return create.apply(navigator.credentials, args); };
	try {
		await assert.rejects(cryptoLib.setupStorageEncryption('SetupPassword12', true), /STORAGE_SESSION_CHANGED/, 'Encryption setup is refused before serialization');
	} finally {
		crypto.subtle.generateKey = generateKey;
		navigator.credentials.create = create;
	}
	assert.strictEqual(keys + registrations, 0, 'No key is generated and no authenticator is asked before the refusal');
	assert.strictEqual(global.__foreign, 3);
	assert.strictEqual(localStorage.getItem('kogai_auth_meta'), null, 'No encryption is set up');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, 'B', 'The other tab value survives every attempt');
});

test('R-27 / I-16-02: encryption setup re-checks just before its transaction', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await loadAll();
	const exportKey = crypto.subtle.exportKey;
	crypto.subtle.exportKey = async (...args) => {
		// 直列化の後、取引の前に別のタブが書き込む。
		localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('設定中の別のタブ')));
		return exportKey.apply(crypto.subtle, args);
	};
	try {
		await assert.rejects(cryptoLib.setupStorageEncryption('SetupPassword12', false), /STORAGE_SESSION_CHANGED/);
	} finally {
		crypto.subtle.exportKey = exportKey;
	}
	assert.strictEqual(localStorage.getItem('kogai_auth_meta'), null);
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, '設定中の別のタブ');
	// 暗号化中の再設定も、別のタブの暗号文を上書きしない（SEC-34 の扱い）。
	await loadAll();
	await cryptoLib.setupStorageEncryption('SetupPassword12', false);
	assert.ok(localStorage.getItem(NEIGHBOR).startsWith('STORAGE_ENC:2:'));
	localStorage.setItem(NEIGHBOR, 'STORAGE_ENC:2:' + 'A'.repeat(60));
	await assert.rejects(cryptoLib.setupStorageEncryption('SetupPassword12', false), /STORAGE_SESSION_CHANGED/, 'Re-setup while encrypted is refused');
	assert.strictEqual(localStorage.getItem(NEIGHBOR), 'STORAGE_ENC:2:' + 'A'.repeat(60));
});

test('R-27 / I-16-02: without Web Locks the comparison runs right before the write in the same task', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	const original = navigator.locks;
	navigator.locks = undefined;
	try {
		assert.strictEqual((await loadAll()).loaded, true, 'The unencrypted load works without Web Locks');
		assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('A2')), true);
		localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
		assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('古い')), false);
		const models = [state.currentDistrict, state.repState, neighborModel('復元'), { children: [], memo: '' }].map(model => JSON.parse(JSON.stringify(model)));
		await assert.rejects(cryptoLib.replaceStoredAppData(models), /STORAGE_SESSION_CHANGED/);
		assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, 'B');
	} finally {
		navigator.locks = original;
	}
});

test('R-27 / I-16-01: a plaintext lock keeps the known values, and clearing all data records an empty value for every key', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await loadAll();
	cryptoLib.lockStorage();
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('ロックの後')), true, 'A plaintext lock keeps saving possible');
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('古い')), false, 'A plaintext lock does not drop the comparison');
	await loadAll();
	await cryptoLib.clearStorageSecurity();
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('全消去の後')), true, 'After clearing, the empty value is known');
	await cryptoLib.clearStorageSecurity();
	localStorage.setItem(TRANSFER, JSON.stringify({ children: [], memo: '別のタブ' }));
	assert.strictEqual(await cryptoLib.saveStorageData(TRANSFER, { children: [], memo: '' }), false, 'After clearing, a value added by another tab is detected');
});

test('R-27 / I-16-01: cancelling a busy storage access in plaintext keeps the comparison', async () => {
	await fresh({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await loadAll();
	const access = app.beginStorageAccess();
	assert.strictEqual(typeof access.guard, 'function');
	app.closeStorageSettingsModal();
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('古い')), false);
});

/** 起動・読み直しの試験の準備。handleForeignStorageUpdate を app.js の本物に戻す。 */
async function freshApp(stored = {}) {
	await fresh(stored);
	global.handleForeignStorageUpdate = app.handleForeignStorageUpdate;
	global.__alerts = [];
	global.alert = message => global.__alerts.push(String(message));
	window.alert = global.alert;
	state.neighborState = { district: '', neighborhood: [] };
}

/** 起動の前のタブと同じく、既知値のない状態にする（暗号化中のロックは既知値を空にする。I-16-01）。 */
function forgetKnownValues() {
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	cryptoLib.lockStorage();
	localStorage.removeItem('kogai_auth_meta');
}

test('R-27 / I-16-03: startup without stored values builds the same models as the original startup', async () => {
	await freshApp();
	const defaults = state.defaultStateModels();
	assert.strictEqual(defaults.rep.szExternals.length, 6, 'The defaults are the initial state of js/state.js');
	state.repState.szExternals = [];
	state.repState.seatConfig.topLabel = '前方';
	await app.startUnencryptedSession();
	assert.strictEqual(state.repState.szExternals.length, 6, 'The six default external participants are kept');
	assert.strictEqual(state.repState.seatConfig.topLabel, '前方（演台・司会・スクリーン側）');
	assert.strictEqual(state.currentDistrict.students[0].grade, '6', 'The startup normalization is applied');
	assert.deepStrictEqual(global.__alerts, []);
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.notStrictEqual(document.getElementById('storage-foreign-update-notice').hidden, false, 'Startup itself shows no reload notice');
	const first = state.defaultStateModels();
	first.rep.szExternals.length = 0;
	assert.strictEqual(state.defaultStateModels().rep.szExternals.length, 6, 'Each call returns a fresh copy of the initial models');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('起動の後')), true, 'Known values exist for every key after startup');
});

test('R-27 / I-16-03: startup retries after a generation change and does not treat encryption at entry as invalid data', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('保存済み')) });
	const locks = fifoLocks();
	const original = navigator.locks;
	navigator.locks = locks;
	try {
		let release = locks.hold();
		const startup = app.startUnencryptedSession();
		await new Promise(resolve => setTimeout(resolve, 0));
		cryptoLib.advanceStorageSessionGeneration();
		release();
		await startup;
		assert.strictEqual(state.neighborState.district, '保存済み', 'The retried load reflects the stored data');
		assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'Nothing is suspended');
		assert.deepStrictEqual(global.__alerts, [], 'No invalid-data alert');

		release = locks.hold();
		const encrypted = app.startUnencryptedSession();
		await new Promise(resolve => setTimeout(resolve, 0));
		localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
		release();
		await encrypted;
		assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'Encryption at entry suspends nothing');
		assert.deepStrictEqual(global.__alerts, [], 'Encryption at entry is not reported as invalid data');
	} finally {
		navigator.locks = original;
		localStorage.removeItem('kogai_auth_meta');
	}
});

test('R-27 / I-16-03: an unexpected startup failure suspends every stored key as before', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('保存済み')) });
	forgetKnownValues();
	document.getElementById('neighbor-district-name').value = '描画の前の値';
	// キーごとの検証の失敗は読めないキーとして扱うため、モデルの正規化の側で予期しない失敗を起こす。
	const normalize = global.normalizeNameFields;
	let thrown = false;
	global.normalizeNameFields = (...args) => { if (!thrown) { thrown = true; throw new TypeError('予期しない失敗'); } return normalize(...args); };
	try {
		await app.startUnencryptedSession();
	} finally {
		global.normalizeNameFields = normalize;
	}
	assert.ok(cryptoLib.getSuspendedStorageKeys().includes(NEIGHBOR), 'The stored key is suspended');
	assert.ok(global.__alerts.some(message => message.includes('安全な初期状態で起動しました')));
	assert.strictEqual(document.getElementById('neighbor-district-name').value, '', 'The screens are rendered with the safe default state');
	assert.strictEqual(await state.saveTransferLocal(), true, 'A mode without a stored value is savable as before');
	// 停止中のキーは、別のタブの書込みがなければ置換の取込で解ける（比較元と同じ）。
	await cryptoLib.commitImportedModel(NEIGHBOR, neighborModel('取込'), cryptoLib.getStorageSessionGeneration(), { replace: true });
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'A replacing import resumes the key');
});

test('R-27 / I-16-03: a startup failure after a repair was found reports only the safe default state, as before', async () => {
	// 比較元でも同じ結果になることを確かめるため、試験の補助の代表のデータを使う（defaultStateModels は今回の変更で加えた）。
	const rep = createMockRepState();
	rep.seatConfig.cells = { '0_0': { refKey: '', customText: '残す' }, '9_0': { refKey: '', customText: '範囲外' } };
	await freshApp({ kogai_rep_v2: JSON.stringify(rep), [NEIGHBOR]: JSON.stringify(neighborModel('保存済み')) });
	forgetKnownValues();
	const normalize = global.normalizeNameFields;
	let thrown = false;
	// 保存値の検証と修復の後、モデルの正規化の段で予期しない失敗を起こす。
	global.normalizeNameFields = (...args) => { if (!thrown) { thrown = true; throw new TypeError('予期しない失敗'); } return normalize(...args); };
	try {
		await app.startUnencryptedSession();
	} finally {
		global.normalizeNameFields = normalize;
	}
	assert.ok(thrown, 'The startup failed in the reflection');
	assert.ok(global.__alerts.some(message => message.includes('安全な初期状態で起動しました')));
	assert.ok(!global.__alerts.some(message => message.includes('保存データの一部を修復して開きました')), 'No repair is reported for values that were not opened');
	assert.strictEqual(global.__alerts.length, 1, 'Only the safe default state is reported');
});

test('R-27 / I-16-03: after a startup failure, a value another tab wrote during the failure is still found by the comparison', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('保存済み')) });
	forgetKnownValues();
	const normalize = global.normalizeNameFields;
	let thrown = false;
	// 排他区間で保存値を読んだ後、反映の中で失敗する間に、別のタブが書き込む。
	global.normalizeNameFields = (...args) => {
		if (!thrown) { thrown = true; localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('失敗の間の別のタブ'))); throw new TypeError('予期しない失敗'); }
		return normalize(...args);
	};
	try {
		await app.startUnencryptedSession();
	} finally {
		global.normalizeNameFields = normalize;
	}
	await assert.rejects(cryptoLib.commitImportedModel(NEIGHBOR, neighborModel('取込'), cryptoLib.getStorageSessionGeneration(), { replace: true }), /STORAGE_SESSION_CHANGED/, 'The replacing import is refused');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, '失敗の間の別のタブ', 'The other tab value survives');
});

test('R-27 / I-16-03: a startup failure outside the reflection suspends the stored keys and keeps the other modes savable', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('保存済み')) });
	forgetKnownValues();
	const original = navigator.locks;
	let rejected = false;
	navigator.locks = { request: (...args) => { if (!rejected) { rejected = true; return Promise.reject(new Error('排他区間の要求の失敗')); } return original.request(...args); } };
	try {
		await app.startUnencryptedSession();
	} finally {
		navigator.locks = original;
	}
	assert.ok(rejected, 'The startup load failed outside the reflection');
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [NEIGHBOR], 'The stored key is suspended');
	assert.ok(global.__alerts.some(message => message.includes('安全な初期状態で起動しました')));
	assert.strictEqual(await state.saveTransferLocal(), true, 'A mode without a stored value is savable as before');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('既定値での上書き')), false);
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, '保存済み', 'The stored original is kept');
	await cryptoLib.commitImportedModel(NEIGHBOR, neighborModel('取込'), cryptoLib.getStorageSessionGeneration(), { replace: true });
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'A replacing import resumes the key');
	// 記録のあるキーへの、その後の他タブの書込みは照合で拒否する。
	localStorage.setItem(TRANSFER, JSON.stringify({ children: [], memo: '別のタブ' }));
	assert.strictEqual(await state.saveTransferLocal(), false, 'A save after another tab wrote is refused');
	assert.strictEqual(JSON.parse(localStorage.getItem(TRANSFER)).memo, '別のタブ');
});

test('R-27 / I-16-02: a card encryption setup refused by a foreign write shows no failure even when the reload waits', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await app.startUnencryptedSession();
	const locks = fifoLocks();
	const original = navigator.locks;
	navigator.locks = locks;
	try {
		document.getElementById('neighbor-pass').value = 'CardPassword12';
		localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
		const release = locks.hold();
		const setup = app.quickSetupEncryptionFromCard('neighbor-pass');
		await new Promise(resolve => setTimeout(resolve, 0));
		// 設定より後に排他区間を待つ読み直しを始める。設定の拒否の通知は保留になり、設定の画面の取消は起きない。
		const reload = app.reloadUnencryptedSession();
		release();
		assert.strictEqual(await setup, false);
		await reload;
		await new Promise(resolve => setTimeout(resolve, 20));
	} finally {
		navigator.locks = original;
	}
	assert.ok(!global.__alerts.some(message => message.includes('暗号化設定に失敗しました')), 'The conflict is not reported as a failure');
	assert.strictEqual(cryptoLib.isStorageEncrypted(), false);
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, 'B');
	// ほかの失敗は従来どおり通知する。
	global.__alerts = [];
	const setupStorageEncryption = global.setupStorageEncryption;
	global.setupStorageEncryption = async () => { throw new Error('設定の失敗'); };
	try {
		assert.strictEqual(await app.quickSetupEncryptionFromCard('neighbor-pass'), false);
	} finally {
		global.setupStorageEncryption = setupStorageEncryption;
	}
	assert.ok(global.__alerts.includes('暗号化設定に失敗しました: 設定の失敗'));
});

test('R-27 / I-16-02: an encrypted handoff restore re-checks just before its transaction', async () => {
	await fresh();
	await loadAll();
	await cryptoLib.setupStorageEncryption('SetupPassword12', false);
	const encrypt = crypto.subtle.encrypt;
	let written = false;
	crypto.subtle.encrypt = async (...args) => {
		if (!written) { written = true; localStorage.setItem(NEIGHBOR, 'STORAGE_ENC:2:' + 'B'.repeat(60)); }
		return encrypt.apply(crypto.subtle, args);
	};
	const models = [state.currentDistrict, state.repState, neighborModel('復元'), { children: [], memo: '' }].map(model => JSON.parse(JSON.stringify(model)));
	try {
		await assert.rejects(cryptoLib.replaceStoredAppData(models), /STORAGE_SESSION_CHANGED/, 'A foreign write during the encryption of the restore is refused');
	} finally {
		crypto.subtle.encrypt = encrypt;
	}
	assert.strictEqual(localStorage.getItem(NEIGHBOR), 'STORAGE_ENC:2:' + 'B'.repeat(60), 'The value written by the other tab survives');
});

test('R-27 / I-16-03: a reload closes the dialogs, reflects the stored data, clears the print area and rejections, and shows the notice', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await app.startUnencryptedSession();
	cryptoLib.suspendStorageWrites([TRANSFER]);
	const settings = document.getElementById('storage-settings-modal');
	settings.style.display = 'flex';
	let handoffCleared = 0;
	const clearHandoff = global.clearBrowserHandoff;
	global.clearBrowserHandoff = () => { handoffCleared++; };
	const printArea = document.getElementById('print-area');
	utils.renderHtml(printArea, '<p>古い名簿</p>');
	const notice = document.getElementById('storage-foreign-update-notice');
	notice.hidden = true;
	try {
		localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('B')));
		await app.reloadUnencryptedSession();
	} finally {
		global.clearBrowserHandoff = clearHandoff;
	}
	assert.strictEqual(settings.style.display, 'none', 'The settings dialog is closed');
	assert.strictEqual(handoffCleared, 1, 'The handoff dialog is closed');
	assert.strictEqual(state.neighborState.district, 'B', 'The stored data is reflected');
	assert.strictEqual(printArea.children.length, 0, 'The print area is cleared');
	assert.strictEqual(notice.hidden, false, 'The notice is shown');
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'A suspended key without a stored value resumes');
	assert.deepStrictEqual(cryptoLib.getStorageSaveRejectedKeys(), [], 'Save rejections are cleared');
	app.dismissForeignStorageNotice();
	assert.strictEqual(notice.hidden, true, 'Closing hides the notice');
	// 別のタブの全消去の後は、既定値の状態になる。
	localStorage.removeItem(NEIGHBOR);
	await app.reloadUnencryptedSession();
	assert.strictEqual(state.neighborState.district, '', 'Cleared data becomes the default');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, state.neighborState), true);
});

test('R-27 / I-16-03: a reload shows nothing when encrypted at entry, retries once after a generation change, and suspends the keys another tab changed on an unexpected failure', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await app.startUnencryptedSession();
	const notice = document.getElementById('storage-foreign-update-notice');
	const locks = fifoLocks();
	const original = navigator.locks;
	navigator.locks = locks;
	try {
		notice.hidden = true;
		let release = locks.hold();
		const skipped = app.reloadUnencryptedSession();
		await new Promise(resolve => setTimeout(resolve, 0));
		localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
		release();
		await skipped;
		assert.strictEqual(notice.hidden, true, 'No notice when the load was not read');
		localStorage.removeItem('kogai_auth_meta');

		release = locks.hold();
		const retried = app.reloadUnencryptedSession();
		await new Promise(resolve => setTimeout(resolve, 0));
		cryptoLib.advanceStorageSessionGeneration();
		localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('再読込')));
		release();
		await retried;
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.strictEqual(state.neighborState.district, '再読込', 'The reserved reload reads the data');
		assert.strictEqual(notice.hidden, false, 'The notice appears after the retried reload');
	} finally {
		navigator.locks = original;
	}
	notice.hidden = true;
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('別のタブの新しい値')));
	const normalize = global.normalizeNameFields;
	let thrown = false;
	global.normalizeNameFields = (...args) => { if (!thrown) { thrown = true; throw new TypeError('予期しない失敗'); } return normalize(...args); };
	try {
		await app.reloadUnencryptedSession();
	} finally {
		global.normalizeNameFields = normalize;
	}
	assert.strictEqual(notice.hidden, true, 'No notice on an unexpected failure');
	assert.strictEqual(state.neighborState.district, '再読込', 'The memory is unchanged');
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [NEIGHBOR], 'Only the key changed by another tab is suspended');
	assert.strictEqual(document.getElementById('storage-save-warning').hidden, false, 'The save warning is shown');
	assert.strictEqual(await state.saveTransferLocal(), true, 'A key no other tab changed stays savable');
	assert.strictEqual(JSON.parse(localStorage.getItem(NEIGHBOR)).district, '別のタブの新しい値', 'The other tab value is kept');
});

test('R-27 / I-16-03・I-16-04: storage notices reload one at a time, are held during startup, and ignore ciphertext and unchanged values', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	app.initAutoLockListeners();
	const locks = fifoLocks();
	const original = navigator.locks;
	navigator.locks = locks;
	const reads = [];
	const load = global.loadUnencryptedStorage;
	global.loadUnencryptedStorage = (...args) => { reads.push(Date.now()); return load(...args); };
	const event = (key, oldValue, newValue) => window.dispatchEvent({ type: 'storage', key, oldValue, newValue, storageArea: localStorage });
	try {
		const release = locks.hold();
		const startup = app.startUnencryptedSession();
		await new Promise(resolve => setTimeout(resolve, 0));
		event(NEIGHBOR, 'a', 'b');
		event(NEIGHBOR, 'b', 'c');
		assert.strictEqual(reads.length, 1, 'Notices during startup are held');
		release();
		await startup;
		for (let i = 0; i < 50 && reads.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 5));
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.strictEqual(reads.length, 2, 'The held notices cause one reload after startup');
		event(NEIGHBOR, 'x', 'STORAGE_ENC:2:abc');
		event(NEIGHBOR, 'same', 'same');
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.strictEqual(reads.length, 2, 'Ciphertext and unchanged values do not reload');
		const hold = locks.hold();
		event(TRANSFER, null, '{}');
		await new Promise(resolve => setTimeout(resolve, 0));
		event(TRANSFER, '{}', '{"a":1}');
		event(TRANSFER, '{"a":1}', '{"a":2}');
		hold();
		for (let i = 0; i < 50 && reads.length < 4; i++) await new Promise(resolve => setTimeout(resolve, 5));
		await new Promise(resolve => setTimeout(resolve, 20));
		assert.strictEqual(reads.length, 4, 'Notices during a reload cause exactly one more reload');
		// 保留した読み直しは、実行するときに暗号化していれば行わない。
		const holdAgain = locks.hold();
		event(TRANSFER, '{}', '{"b":1}');
		await new Promise(resolve => setTimeout(resolve, 0));
		event(TRANSFER, '{"b":1}', '{"b":2}');
		localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
		holdAgain();
		await new Promise(resolve => setTimeout(resolve, 50));
		assert.strictEqual(reads.length, 5, 'The reserved reload is dropped once encrypted');
	} finally {
		navigator.locks = original;
		global.loadUnencryptedStorage = load;
		localStorage.removeItem('kogai_auth_meta');
	}
});

test('R-27 / I-16-03: a held reload still closes the settings and handoff dialogs at once', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await app.startUnencryptedSession();
	const locks = fifoLocks();
	const original = navigator.locks;
	navigator.locks = locks;
	let handoffCleared = 0;
	const clearHandoff = global.clearBrowserHandoff;
	global.clearBrowserHandoff = () => { handoffCleared++; };
	try {
		const release = locks.hold();
		const running = app.reloadUnencryptedSession();
		await new Promise(resolve => setTimeout(resolve, 0));
		const settings = document.getElementById('storage-settings-modal');
		settings.style.display = 'flex';
		const before = handoffCleared;
		app.reloadUnencryptedSession();
		assert.strictEqual(settings.style.display, 'none', 'The settings dialog is closed while the reload is held');
		assert.strictEqual(handoffCleared, before + 1, 'The handoff dialog is closed while the reload is held');
		release();
		await running;
		await new Promise(resolve => setTimeout(resolve, 20));
	} finally {
		navigator.locks = original;
		global.clearBrowserHandoff = clearHandoff;
	}
});

test('R-27 / I-16-03・E-16-05: a reload suspends an unreadable value with its alert and warning, resumes it once readable or removed, and reports repairs', async () => {
	await freshApp({ [NEIGHBOR]: '{読めない' });
	await app.startUnencryptedSession();
	const warning = document.getElementById('storage-save-warning');
	const notice = document.getElementById('storage-foreign-update-notice');
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [NEIGHBOR]);
	assert.strictEqual(warning.hidden, false, 'The save warning is shown at startup');
	// 読める値に変わった後の読み直しで、保存を再開し、停止の警告が消える。
	localStorage.setItem(NEIGHBOR, JSON.stringify(neighborModel('直した値')));
	global.__alerts = [];
	await app.reloadUnencryptedSession();
	assert.strictEqual(state.neighborState.district, '直した値');
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'The key resumes');
	assert.strictEqual(warning.hidden, true, 'The save warning disappears');
	assert.deepStrictEqual(global.__alerts, [], 'A readable value is not reported');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('再開の後')), true);
	// 別のタブが読めない値を書いた後の読み直しで、そのモードを停止し、通知と警告と案内を出す。
	localStorage.setItem(NEIGHBOR, '{読めない2');
	notice.hidden = true;
	await app.reloadUnencryptedSession();
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [NEIGHBOR], 'The unreadable key is suspended');
	assert.strictEqual(state.neighborState.district, '', 'The unreadable mode opens with the default');
	assert.ok(global.__alerts.some(message => message.startsWith('保存データを読み込めないため、') && message.includes('の保存を停止しました')), 'The suspension is reported');
	assert.strictEqual(warning.hidden, false, 'The save warning is shown');
	assert.strictEqual(notice.hidden, false, 'The reload notice is shown');
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, neighborModel('既定値での上書き')), false);
	assert.strictEqual(localStorage.getItem(NEIGHBOR), '{読めない2', 'The unreadable value is not overwritten');
	// 保存値がなくなった後の読み直しでも、保存を再開し、警告が消える。
	localStorage.removeItem(NEIGHBOR);
	await app.reloadUnencryptedSession();
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), []);
	assert.strictEqual(warning.hidden, true, 'The save warning disappears after the value is removed');
	// 修復が要る値は、読み直しでも修復して読み、通知する。
	const rep = JSON.parse(JSON.stringify(state.defaultStateModels().rep));
	rep.seatConfig.cells = { '0_0': { refKey: '', customText: '残す' }, '9_0': { refKey: '', customText: '範囲外' } };
	localStorage.setItem('kogai_rep_v2', JSON.stringify(rep));
	global.__alerts = [];
	await app.reloadUnencryptedSession();
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'The repairable value is readable');
	assert.deepStrictEqual(Object.keys(state.repState.seatConfig.cells), ['0_0'], 'The value is repaired in memory');
	assert.ok(global.__alerts.some(message => message.includes('保存データの一部を修復して開きました')), 'The repair is reported');
});

test('R-27 / I-16-03: startup repairs a repairable stored value instead of suspending it', async () => {
	const rep = JSON.parse(JSON.stringify(state.defaultStateModels().rep));
	rep.seatConfig.cells = { '0_0': { refKey: '', customText: '残す' }, '9_0': { refKey: '', customText: '範囲外' } };
	await freshApp({ kogai_rep_v2: JSON.stringify(rep) });
	await app.startUnencryptedSession();
	assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys(), [], 'The repairable value is readable');
	assert.deepStrictEqual(Object.keys(state.repState.seatConfig.cells), ['0_0'], 'The value is repaired in memory');
	assert.ok(global.__alerts.some(message => message.includes('保存データの一部を修復して開きました')), 'The repair is reported');
});

test('R-27 / I-16-03: a reload clears save rejections, and its first generation step stops outputs even when nothing is reflected', async () => {
	await freshApp({ [NEIGHBOR]: JSON.stringify(neighborModel('A')) });
	await app.startUnencryptedSession();
	assert.strictEqual(await cryptoLib.saveStorageData(NEIGHBOR, { district: 'x'.repeat(5000), neighborhood: [] }), false);
	assert.deepStrictEqual(cryptoLib.getStorageSaveRejectedKeys(), [NEIGHBOR], 'An unstorable value is rejected');
	await app.reloadUnencryptedSession();
	assert.deepStrictEqual(cryptoLib.getStorageSaveRejectedKeys(), [], 'The reload replaces the memory and clears the rejection');
	const outputIsCurrent = cryptoLib.captureStorageOutputGuard();
	const normalize = global.normalizeNameFields;
	let thrown = false;
	global.normalizeNameFields = (...args) => { if (!thrown) { thrown = true; throw new TypeError('予期しない失敗'); } return normalize(...args); };
	try {
		await app.reloadUnencryptedSession();
	} finally {
		global.normalizeNameFields = normalize;
	}
	assert.strictEqual(outputIsCurrent(), false, 'An output started before the reload is stopped');
});

test('I-12-07: an encrypted unlock keeps reading no suspended key', async () => {
	await freshApp();
	await app.startUnencryptedSession();
	state.neighborState = neighborModel('暗号化する自治会');
	await cryptoLib.setupStorageEncryption('SetupPassword12', false);
	cryptoLib.suspendStorageWrites([NEIGHBOR]);
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithPassword('SetupPassword12');
	state.neighborState = neighborModel('メモリの値');
	await app.loadAppDataFromStorage();
	assert.strictEqual(state.neighborState.district, 'メモリの値', 'The suspended key is not read and the memory model is kept');
});

test('R-27 / E-16-03: a conflicting post-submission clear reports that nothing was cleared, also when the conflict locks an encrypted tab', async () => {
	await freshApp();
	const save = global.saveTransferLocal;
	global.saveTransferLocal = async () => false;
	try {
		assert.strictEqual(await transfer.resetTransferForm(), false, 'The clear is not reported as done');
	} finally {
		global.saveTransferLocal = save;
	}
	assert.ok(global.__alerts.includes('家庭・児童の情報を端末から消去できませんでした。最新の内容を確かめて、もう一度消去してください。'));
	global.saveTransferLocal = async () => true;
	try {
		assert.strictEqual(await transfer.resetTransferForm(), true);
	} finally {
		global.saveTransferLocal = save;
	}
	// 暗号化中で解除しているときの、ロックを伴わない拒否も、未暗号化と同じく通知する。
	global.__alerts = [];
	await cryptoLib.setupStorageEncryption('SetupPassword12', false);
	global.saveTransferLocal = async () => false;
	try {
		assert.strictEqual(await transfer.resetTransferForm(), false, 'An unlocked encrypted refusal without a lock is reported');
	} finally {
		global.saveTransferLocal = save;
	}
	assert.strictEqual(global.__alerts.length, 1);
	// 解除しているときに別のタブが暗号文を書いた後の消去は、保存の中でロックし（SEC-34）、消去できなかったことも示す。
	global.__alerts = [];
	const foreign = 'STORAGE_ENC:2:' + 'B'.repeat(60);
	localStorage.setItem(TRANSFER, foreign);
	assert.strictEqual(await transfer.resetTransferForm(), false, 'The conflicting clear is not reported as done');
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false, 'The tab locks (SEC-34)');
	assert.ok(global.__alerts.includes('家庭・児童の情報を端末から消去できませんでした。最新の内容を確かめて、もう一度消去してください。'), 'The failure is shown');
	assert.strictEqual(localStorage.getItem(TRANSFER), foreign, 'The value written by the other tab is kept');
	await cryptoLib.clearStorageSecurity();
	// 暗号化中のロック（メモリだけで入力する）と保存の停止では、従来どおり消去を完了とする。
	global.__alerts = [];
	global.saveTransferLocal = async () => false;
	try {
		cryptoLib.suspendStorageWrites([TRANSFER]);
		assert.strictEqual(await transfer.resetTransferForm(), true, 'A suspended save still completes the clear');
		cryptoLib.resumeStorageWrites([TRANSFER]);
		localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
		assert.strictEqual(await transfer.resetTransferForm(), true, 'A locked encrypted database still completes the in-memory clear');
	} finally {
		global.saveTransferLocal = save;
		localStorage.removeItem('kogai_auth_meta');
	}
	assert.deepStrictEqual(global.__alerts, [], 'No failure is reported in those cases');
});

test('R-27 / I-16-05 (BL-007): the household save is the one in js/state.js and js/transfer.js declares no save or load', () => {
	assert.strictEqual(transfer.saveTransferLocal, undefined, 'js/transfer.js exports no save');
	assert.strictEqual(transfer.loadTransferLocal, undefined, 'js/transfer.js exports no load');
	assert.strictEqual(global.saveTransferLocal, state.saveTransferLocal, 'The shared save is the one in js/state.js');
	assert.strictEqual(typeof global.loadTransferLocal, 'undefined');
});
