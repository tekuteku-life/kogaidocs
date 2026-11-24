/*
 * 未暗号化の起動の経路の総当たり（R-27・I-16-03・I-12-07）。
 * 失敗なし・反映の中の失敗・反映の外の失敗（排他区間の要求の失敗）と、自治会・家庭情報入力・校外代表の保存値の組合せごとに、
 * 起動時の通知・保存の停止・保存の可否と保存値が、比較元の起動（読込の前に各キーを個別に検証し、読込の失敗で保存値のあるキーを停止する）と同じになることを確かめる。
 * この試験ファイルは、比較元のコードでも合格する（今回の変更で加えた関数を使わない）。
 */
const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
require('../../js/state.js');
require('../../js/hata.js');
require('../../js/seat.js');
require('../../js/rep.js');
require('../../js/district.js');
require('../../js/neighbor.js');
require('../../js/transfer.js');
const app = require('../../js/app.js');

const NEIGHBOR = 'kogai_neighbor_v2';
const TRANSFER = 'kogai_transfer_v2';
const REP = 'kogai_rep_v2';
const MODE_NAMES = { [REP]: '校外代表', [NEIGHBOR]: '自治会', [TRANSFER]: '家庭情報入力' };
const KEY_ORDER = ['kogai_district_v2', REP, NEIGHBOR, TRANSFER];
const SAFE = '端末内の保存データが不正なため、安全な初期状態で起動しました。';
const unreadableNotice = keys => `保存データを読み込めないため、${keys.map(key => MODE_NAMES[key]).join('・')}の保存を停止しました。上書きを防ぐため、全消去するか、正しいデータを復元してください。`;
const REPAIR_PREFIX = '保存データの一部を修復して開きました。';

const repairableRep = () => {
	const rep = createMockRepState();
	rep.seatConfig.cells = { '0_0': { refKey: '', customText: '残す' }, '9_0': { refKey: '', customText: '範囲外' } };
	return JSON.stringify(rep);
};
// 保存値の種類: null は保存値なし。readable は読める（修復が要るものを含む）かどうか、repair は修復が要るかどうか。
const VALUES = {
	[NEIGHBOR]: [
		{ label: 'none', raw: null },
		{ label: 'valid', raw: JSON.stringify({ district: '有効な自治会', neighborhood: [] }), readable: true },
		{ label: 'broken JSON', raw: '{読めない', readable: false }
	],
	[TRANSFER]: [
		{ label: 'none', raw: null },
		{ label: 'valid', raw: JSON.stringify({ children: [], memo: '有効な家庭情報' }), readable: true },
		{ label: 'invalid shape', raw: JSON.stringify({ children: '子どもではない' }), readable: false }
	],
	[REP]: [
		{ label: 'none', raw: null },
		{ label: 'repairable', raw: repairableRep(), readable: true, repair: true }
	]
};

/** 起動の前のタブと同じく、保存データだけを置き、既知値のない状態にする（暗号化中のロックは既知値を空にする。比較元では何もしない）。 */
async function prepare(stored) {
	setupDomEnvironment();
	await cryptoLib.clearStorageSecurity();
	localStorage.clear();
	for (const [key, value] of Object.entries(stored)) if (value !== null) localStorage.setItem(key, value);
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	cryptoLib.lockStorage();
	localStorage.removeItem('kogai_auth_meta');
	const alerts = [];
	global.alert = message => alerts.push(String(message));
	window.alert = global.alert;
	return alerts;
}

/** 起動する。inside: 反映（モデルの正規化）の中で1回失敗させる。outside: 排他区間の要求を1回拒否する。 */
async function start(failure) {
	let thrown = false;
	const normalize = global.normalizeNameFields;
	const locks = navigator.locks;
	if (failure === 'inside') global.normalizeNameFields = (...args) => { if (!thrown) { thrown = true; throw new TypeError('予期しない失敗'); } return normalize(...args); };
	if (failure === 'outside') navigator.locks = { request: (...args) => { if (!thrown) { thrown = true; return Promise.reject(new Error('排他区間の要求の失敗')); } return locks.request(...args); } };
	try {
		await app.startUnencryptedSession();
	} finally {
		global.normalizeNameFields = normalize;
		navigator.locks = locks;
	}
	return thrown;
}

const scenarios = [];
for (const failure of ['none', 'inside', 'outside'])
	for (const neighbor of VALUES[NEIGHBOR])
		for (const transfer of VALUES[TRANSFER])
			for (const rep of VALUES[REP]) scenarios.push({ failure, values: { [NEIGHBOR]: neighbor, [TRANSFER]: transfer, [REP]: rep } });

test(`R-27 / I-16-03・I-12-07: every startup path (${scenarios.length} cases) notifies, suspends and saves as the original startup`, async () => {
	for (const { failure, values } of scenarios) {
		const name = `${failure}: ${Object.entries(values).map(([key, value]) => `${MODE_NAMES[key]}=${value.label}`).join(', ')}`;
		const alerts = await prepare(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.raw])));
		const before = Object.fromEntries(KEY_ORDER.map(key => [key, localStorage.getItem(key)]));
		const thrown = await start(failure);
		assert.strictEqual(thrown, failure !== 'none', `${name}: the startup failed as arranged`);
		const stored = KEY_ORDER.filter(key => values[key] && values[key].raw !== null);
		const unreadable = KEY_ORDER.filter(key => values[key] && values[key].raw !== null && !values[key].readable);
		const repaired = values[REP].repair;
		const expectedAlerts = failure === 'none'
			? [...(unreadable.length ? [unreadableNotice(unreadable)] : [])]
			: [SAFE, ...(unreadable.length ? [unreadableNotice(unreadable)] : [])];
		assert.deepStrictEqual(alerts.filter(message => !message.startsWith(REPAIR_PREFIX)), expectedAlerts, `${name}: the notices`);
		assert.strictEqual(alerts.filter(message => message.startsWith(REPAIR_PREFIX)).length, failure === 'none' && repaired ? 1 : 0, `${name}: the repair notice`);
		if (failure === 'none' && repaired) assert.strictEqual(alerts[alerts.length - 1].startsWith(REPAIR_PREFIX), true, `${name}: the repair notice comes last`);
		const suspended = failure === 'none' ? unreadable : stored;
		assert.deepStrictEqual(cryptoLib.getSuspendedStorageKeys().sort(), [...suspended].sort(), `${name}: the suspended keys`);
		assert.strictEqual(document.getElementById('storage-save-warning').hidden, suspended.length === 0, `${name}: the save warning`);
		for (const [key, model] of [[NEIGHBOR, { district: '起動の後の自治会', neighborhood: [] }], [TRANSFER, { children: [], memo: '起動の後の家庭情報' }]]) {
			const saved = await cryptoLib.saveStorageData(key, model);
			assert.strictEqual(saved, !suspended.includes(key), `${name}: saving ${MODE_NAMES[key]}`);
			if (!saved) assert.strictEqual(localStorage.getItem(key), before[key], `${name}: the stored ${MODE_NAMES[key]} value is kept`);
		}
		assert.strictEqual(localStorage.getItem(REP), before[REP], `${name}: the stored representative value is not rewritten`);
	}
});
