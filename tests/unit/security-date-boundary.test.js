const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');

setupDomEnvironment();
const utils = require('../../js/utils');
const crypt = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
require('../../js/seat');
require('../../js/rep');
const district = require('../../js/district');
require('../../js/neighbor');
require('../../js/transfer');
require('../../js/print');
const app = require('../../js/app');

const password = 'DateBoundaryMaster1!';
const keys = ['district', 'rep', 'neighbor', 'transfer'].map(mode => `kogai_${mode}_v2`);
const authKey = 'kogai_auth_meta';
const base = { startDate: '2026-10-21', endDate: '2026-10-21', members: '担当者', weekdays: [0, 1, 2, 3, 4, 5, 6] };
const range = count => `2000-01-01〜${new Date(Date.UTC(2000, 0, count)).toISOString().slice(0, 10)}`;
const repeated = (count, text) => Array(count).fill(text).join('\n');

// 各対の差は展開後の1件だけである。重複日の上書きで計算量を過小評価しない。
const boundaries = [
	['holiday range', count => ({ ...base, holidays: `${range(count)},休校` })],
	['special range', count => ({ ...base, specials: `${range(count)},担当者,特別` })],
	['combined ranges', count => ({ ...base, holidays: `${range(1830)},休校`, specials: `${range(count - 1830)},担当者,特別` })],
	['duplicate rows', count => ({ ...base, holidays: repeated(1830, '2026-10-21,休校'), specials: repeated(count - 1830, '2026-10-21,担当者,特別') })],
	['holiday array and special rows', count => ({ ...base, holidays: Array.from({ length: 1830 }, () => ({ date: '2026-10-21', name: '休校' })), specials: repeated(count - 1830, '2026-10-21,担当者,特別') })]
];

async function fresh() {
	await crypt.clearStorageSecurity();
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict({ district: '保持地区' });
	state.repState = createMockRepState();
	state.neighborState = { district: '保持自治会', neighborhood: [{ role: '会長', lastName: '保持会長' }] };
	state.transferState = { children: [], memo: '保持下書き' };
	document.getElementById('d-name').value = '保持地区';
	document.getElementById('officers-container').innerHTML = '<p>保持役員DOM</p>';
	document.getElementById('students-tbody').innerHTML = '<tr><td>保持児童DOM</td></tr>';
	document.getElementById('neighbor-district-name').value = '保持自治会';
	document.getElementById('print-area').innerHTML = '<p>保持印刷DOM</p>';
}

function modelSnapshot() {
	return JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
}

function domSnapshot() {
	return JSON.stringify(['d-name', 'officers-container', 'students-tbody', 'neighbor-district-name', 'print-area'].map(id => {
		const element = document.getElementById(id);
		return [id, element.value, element.innerHTML, element.textContent];
	}));
}

function storedModels(config) {
	return [
		createMockDistrict({ district: '未確定の受入地区', hata: config }),
		createMockRepState({ districts: [createMockDistrict({ district: '未確定の受入集約地区' })] }),
		{ district: '未確定の受入自治会', neighborhood: [{ role: '会長', lastName: '受入会長' }] },
		{ children: [{ lastName: '受入児童', firstName: '太郎', grade: '1', className: '1' }], memo: '未確定の受入下書き' }
	];
}

// 不正内容でも正しい認証タグを持つ保存値を独立に生成する。
// 通常保存APIや受入validatorをスタブで迂回して成功扱いにはしない。
async function encryptedFixture(models, format) {
	const master = await crypt.generateMasterKey();
	const raw = await crypto.subtle.exportKey('raw', master);
	let passwordMeta, webauthn;
	try {
		passwordMeta = await crypt.wrapKeyWithPassword(raw, password, undefined, 100000);
		webauthn = await crypt.registerWebAuthnPrf(raw);
	} finally { new Uint8Array(raw).fill(0); }
	for (const [index, key] of keys.entries()) {
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const algorithm = { name: 'AES-GCM', iv };
		if (format === 2) algorithm.additionalData = new TextEncoder().encode('kogaidocs:storage:2:' + key);
		const cipher = await crypto.subtle.encrypt(algorithm, master, new TextEncoder().encode(JSON.stringify(models[index])));
		localStorage.setItem(key, (format === 2 ? 'STORAGE_ENC:2:' : 'STORAGE_ENC:') + Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]).toString('base64'));
	}
	localStorage.setItem(authKey, JSON.stringify({ isEncrypted: true, version: format, ...(format === 2 ? { storageFormat: 2 } : {}), password: passwordMeta, webauthn }));
}

for (const [name, configFor] of boundaries) {
	test(`security date boundary: ${name} accepts exactly 3660 expansions at every model validator`, async () => {
		await fresh();
		const accepted = configFor(3660);
		const clean = utils.validateHataConfig(accepted);
		assert.equal(clean.startDate, accepted.startDate);
		assert.equal(hata.generateHataSchedule(clean).length, 1, 'The valid boundary still generates the ordinary one-day schedule');
		const incoming = createMockDistrict({ district: '境界地区', hata: accepted });
		assert.equal(utils.validateImportData(incoming, 'district').district, '境界地区');
		assert.equal(utils.validateStoredData(incoming, keys[0]).district, '境界地区');
	});

	test(`security date boundary: ${name} rejects 3661 expansions at every model validator`, async () => {
		await fresh();
		const rejected = configFor(3661);
		assert.throws(() => utils.validateHataConfig(rejected), { code: 'INVALID_IMPORT_DATA' }, 'Config validator rejects the expanded count, not merely source row count');
		const invalid = createMockDistrict({ district: '拒否地区', hata: rejected });
		assert.throws(() => utils.validateImportData(invalid, 'district'), { code: 'INVALID_IMPORT_DATA' });
		assert.throws(() => utils.validateStoredData(invalid, keys[0]), { code: 'INVALID_IMPORT_DATA' });
		assert.throws(() => utils.validateImportData({ districts: [invalid] }, 'rep'), { code: 'INVALID_IMPORT_DATA' }, 'Nested district validation precedes representative local-data stripping');
		assert.throws(() => hata.generateHataSchedule(rejected), 'Direct generation applies the same combined expansion budget');
	});

	for (const method of ['file', 'paste']) {
		test(`security date boundary: ${method} rejects over-budget ${name} before changing state, DOM or storage`, async () => {
			await fresh();
			const incoming = createMockDistrict({ district: '拒否すべき受入地区', hata: configFor(3661) });
			document.getElementById('d-pass').value = password;
			const content = await crypt.encryptPayload(JSON.stringify(incoming), password);
			for (const [index, key] of keys.entries()) localStorage.setItem(key, JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState][index]));
			const beforeModels = modelSnapshot();
			const beforeDom = domSnapshot();
			const beforeStorage = { ...localStorage.store };
			const target = { files: [{ size: Buffer.byteLength(content), text: async () => content }], value: 'over-budget.txt' };
			if (method === 'file') await district.loadDistrictTxt({ target });
			else {
				document.getElementById('d-paste-box').value = content;
				await district.loadPastedTextToDistrict();
				assert.equal(document.getElementById('d-paste-box').value, content, 'Rejected paste remains available for correction');
			}
			assert.equal(modelSnapshot(), beforeModels, 'No partial state replacement or normalization on rejection');
			assert.equal(domSnapshot(), beforeDom);
			assert.deepEqual(localStorage.store, beforeStorage);
			assert.match(global.__lastAlert, /失敗|フォーマット|上限|展開|3660|3,660/, 'Invalid input is visibly rejected');
			if (method === 'file') assert.equal(target.value, '', 'The file picker remains reusable');
		});
	}

	test(`security date boundary: plaintext restore rejects over-budget ${name} atomically across all four modes`, async () => {
		await fresh();
		const models = storedModels(configFor(3661));
		for (const [index, key] of keys.entries()) localStorage.setItem(key, JSON.stringify(models[index]));
		const beforeModels = modelSnapshot();
		const beforeDom = domSnapshot();
		const beforeStorage = { ...localStorage.store };
		await assert.rejects(app.loadAppDataFromStorage(), { code: 'INVALID_IMPORT_DATA' });
		assert.equal(modelSnapshot(), beforeModels);
		assert.equal(domSnapshot(), beforeDom);
		assert.deepEqual(localStorage.store, beforeStorage);
	});

	for (const format of [1, 2]) {
		for (const unlock of ['password', 'webauthn']) {
			test(`security date boundary: format ${format} ${unlock} unlock refuses over-budget ${name} without migration or partial restore`, async () => {
				await fresh();
				await encryptedFixture(storedModels(configFor(3661)), format);
				const beforeModels = modelSnapshot();
				const beforeDom = domSnapshot();
				const beforeStorage = { ...localStorage.store };
				await assert.rejects(async () => {
					if (unlock === 'password') await crypt.unlockStorageWithPassword(password);
					else await crypt.unlockStorageWithWebAuthn();
					await app.loadAppDataFromStorage();
				}, { code: 'INVALID_IMPORT_DATA' });
				assert.equal(modelSnapshot(), beforeModels, 'No mode commits despite otherwise valid authenticated companion models');
				assert.equal(domSnapshot(), beforeDom);
				assert.deepEqual(localStorage.store, beforeStorage, 'Neither format migration nor password rewrap may commit');
				assert.equal(crypt.isStorageUnlocked(), false);
			});
		}
	}
}

for (const period of ['omitted', 'empty']) {
	const undated = count => {
		const config = boundaries[2][1](count);
		if (period === 'empty') {
			config.startDate = '';
			config.endDate = '';
		} else {
			delete config.startDate;
			delete config.endDate;
		}
		return config;
	};
	for (const [name, validate] of [
		['validateHataConfig', config => utils.validateHataConfig(config)],
		['validateImportData', config => utils.validateImportData(createMockDistrict({ hata: config }), 'district')],
		['validateStoredData', config => utils.validateStoredData(createMockDistrict({ hata: config }), keys[0])]
	]) {
		test(`security date boundary: ${name} enforces combined expansions even when base period is ${period}`, async () => {
			await fresh();
			// 生成関数を呼ばず、基本期間がない編集途中データの受入境界を直接検査する。
			assert.doesNotThrow(() => validate(undated(3660)), 'An undated draft at the exact expansion boundary is valid');
			assert.throws(() => validate(undated(3661)), { code: 'INVALID_IMPORT_DATA' }, 'Missing dates must not bypass holiday/special expansion accounting');
		});
	}

	test(`security date boundary: plaintext restore retains all original models, DOM and storage when excessive draft period is ${period}`, async () => {
		await fresh();
		const models = storedModels(undated(3661));
		for (const [index, key] of keys.entries()) localStorage.setItem(key, JSON.stringify(models[index]));
		const beforeModels = modelSnapshot();
		const beforeDom = domSnapshot();
		const beforeStorage = { ...localStorage.store };
		await assert.rejects(app.loadAppDataFromStorage(), { code: 'INVALID_IMPORT_DATA' });
		assert.equal(modelSnapshot(), beforeModels);
		assert.equal(domSnapshot(), beforeDom);
		assert.deepEqual(localStorage.store, beforeStorage);
	});
}
