const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
require('../../js/utils');
const crypt = require('../../js/crypto');
require('../../js/state');
const { createMockDistrict } = require('../helpers/fixtures');

for (const encrypted of [false, true]) {
	test(`SEC-21: ${encrypted ? 'encrypted' : 'plain'} imported commit invalidates a stale autosave queued during its write`, async () => {
		setupDomEnvironment(); await crypt.clearStorageSecurity();
		const originalRequest = navigator.locks.request;
		let lane = Promise.resolve();
		navigator.locks.request = async (_name, _options, fn) => {
			const previous = lane; let release;
			lane = new Promise(resolve => { release = resolve; });
			await previous;
			try { return await fn(); } finally { release(); }
		};
		const key = 'kogai_district_v2';
		const old = createMockDistrict({ district: '旧地区' });
		await crypt.saveStorageData(key, old);
		if (encrypted) await crypt.setupStorageEncryption('CommitAudit123!');
		const auth = localStorage.getItem('kogai_auth_meta');
		const next = createMockDistrict({ district: '確定地区', savedFilePassword: 'Remembered123!' });
		const source = JSON.stringify(next);
		const setItem = localStorage.setItem;
		let stale;
		localStorage.setItem = function(name, value) {
			if (name === key && !stale) stale = crypt.saveStorageData(key, old);
			return setItem.call(this, name, value);
		};
		try {
			const generation = crypt.getStorageSessionGeneration();
			const accepted = crypt.adoptImportedModel(await crypt.commitImportedModel(key, next));
			assert.equal(accepted.district, '確定地区');
			assert.equal(crypt.getStorageSessionGeneration(), generation + 1);
			assert.equal(await stale, false, 'Older autosave cannot overwrite a successful import');
			assert.equal((await crypt.loadStorageDecrypted(key)).district, '確定地区');
			assert.equal(localStorage.getItem('kogai_auth_meta'), auth, 'Destination protection metadata stays unchanged');
			assert.equal(accepted.savedFilePassword, encrypted ? 'Remembered123!' : undefined);
			assert.equal(JSON.stringify(next), source, 'Validation and privacy filtering never mutate the caller object');
		} finally {
			localStorage.setItem = setItem; navigator.locks.request = originalRequest;
			await crypt.clearStorageSecurity();
		}
	});
}

test('SEC-21: commit storage error preserves old bytes and generation and identifies the save failure', async () => {
	setupDomEnvironment(); await crypt.clearStorageSecurity();
	const key = 'kogai_district_v2';
	await crypt.saveStorageData(key, createMockDistrict({ district: '旧地区' }));
	const raw = localStorage.getItem(key), generation = crypt.getStorageSessionGeneration();
	const setItem = localStorage.setItem;
	localStorage.setItem = () => { throw new Error('quota'); };
	try {
		await assert.rejects(crypt.commitImportedModel(key, createMockDistrict({ district: '候補地区' })), error => error.code === 'IMPORT_SAVE_FAILED');
		assert.equal(localStorage.getItem(key), raw);
		assert.equal(crypt.getStorageSessionGeneration(), generation);
	} finally { localStorage.setItem = setItem; }
});

test('SEC-21: queued import from a previous session cannot write after lock or clear', async () => {
	setupDomEnvironment(); await crypt.clearStorageSecurity();
	const originalRequest = navigator.locks.request;
	navigator.locks.request = async (_name, _options, fn) => { crypt.lockStorage(); return fn(); };
	try {
		await assert.rejects(crypt.commitImportedModel('kogai_district_v2', createMockDistrict()), /STORAGE_SESSION_CHANGED/);
		assert.equal(localStorage.getItem('kogai_district_v2'), null);
	} finally { navigator.locks.request = originalRequest; }
});

test('SEC-21: lock during actual encrypted commit refuses the candidate before storage write', async () => {
	setupDomEnvironment(); await crypt.clearStorageSecurity();
	const key = 'kogai_district_v2';
	await crypt.saveStorageData(key, createMockDistrict({ district: '旧地区' }));
	await crypt.setupStorageEncryption('CommitAudit123!');
	const raw = localStorage.getItem(key), auth = localStorage.getItem('kogai_auth_meta');
	const encrypt = crypto.subtle.encrypt;
	crypto.subtle.encrypt = async function(...args) { const result = await encrypt.apply(this, args); crypt.lockStorage(); return result; };
	try {
		await assert.rejects(crypt.commitImportedModel(key, createMockDistrict({ district: '候補地区' })), /STORAGE_SESSION_CHANGED/);
		assert.equal(localStorage.getItem(key), raw);
		assert.equal(localStorage.getItem('kogai_auth_meta'), auth);
		assert.equal(crypt.isStorageUnlocked(), false);
	} finally { crypto.subtle.encrypt = encrypt; await crypt.clearStorageSecurity(); }
});


test('SEC-21: adoption refuses a persisted candidate after the initiating session is invalidated', async () => {
	setupDomEnvironment(); await crypt.clearStorageSecurity();
	const result = await crypt.commitImportedModel('kogai_district_v2', createMockDistrict());
	crypt.lockStorage();
	assert.throws(() => crypt.adoptImportedModel(result), /STORAGE_SESSION_CHANGED/);
});

test('SEC-21: delegated representative intake retains the session that initiated decryption', async () => {
	setupDomEnvironment(); await crypt.clearStorageSecurity();
	const state = require('../../js/state'); require('../../js/hata'); require('../../js/seat');
	const rep = require('../../js/rep');
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 2, rows: 2, cells: {} } };
	document.getElementById('rep-pass').value = 'CommitAudit123!';
	const text = await crypt.encryptPayload(JSON.stringify({ districts: [createMockDistrict({ district: '消去した後に復活してはいけない地区' })], szExternals: [] }), 'CommitAudit123!');
	const parse = global.parseTxtContent;
	global.parseTxtContent = async (...args) => { const data = await parse(...args); await crypt.clearStorageSecurity(); return data; };
	try {
		await rep.loadRepMasterTxt({ target: { files: [{ text: async () => text }], value: 'old.txt' } });
		assert.equal(state.repState.districts.length, 0, 'A delegated importer cannot adopt the newer cleared session');
		assert.equal(localStorage.getItem('kogai_rep_v2'), null, 'A cleared store cannot be repopulated by old plaintext');
	} finally { global.parseTxtContent = parse; }
});
