const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const password = 'SecurityKdfMaster1!';
const authKey = 'kogai_auth_meta';
const keys = ['district', 'rep', 'neighbor', 'transfer'].map(mode => `kogai_${mode}_v2`);
const sources = ['utils', 'crypto', 'state'].map(name => fs.readFileSync(path.resolve(__dirname, `../../js/${name}.js`), 'utf8'));
const encode = value => new TextEncoder().encode(value);
const base64 = value => Buffer.from(value).toString('base64');
const prf = new Uint8Array(32).fill(17);

// 暗号APIは実処理へ委譲し、各テスト専用コンテキストの呼出しだけを観測する。
function createTab() {
	const values = new Map();
	const localStorage = {
		getItem: key => values.has(key) ? values.get(key) : null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: key => values.delete(key),
		snapshot: () => Object.fromEntries(values)
	};
	const subtle = {};
	for (const name of ['generateKey', 'exportKey', 'importKey', 'deriveKey', 'encrypt', 'decrypt']) subtle[name] = webcrypto.subtle[name].bind(webcrypto.subtle);
	const calls = [];
	const deriveKey = subtle.deriveKey;
	subtle.deriveKey = (...args) => { calls.push(args[0].iterations); return deriveKey(...args); };
	const sandbox = {
		localStorage, crypto: { subtle, getRandomValues: value => webcrypto.getRandomValues(value) },
		TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, btoa, atob, setTimeout, clearTimeout,
		console: { warn() {}, error() {}, log() {} },
		isSecureContext: true, PublicKeyCredential: class {}, location: { protocol: 'https:', hostname: 'localhost' },
		navigator: {
			locks: { request: async (_name, _options, callback) => callback({}) },
			credentials: { get: async () => ({ getClientExtensionResults: () => ({ prf: { results: { first: prf } } }) }) }
		},
		addEventListener() {}, document: { addEventListener() {}, getElementById: () => null, querySelectorAll: () => [] }
	};
	sandbox.window = sandbox;
	const context = vm.createContext(sandbox);
	for (const source of sources) vm.runInContext(source, context);
	vm.runInContext("currentDistrict.district = '旧保存地区'; neighborState.district = '旧保存自治会';", context);
	return {
		context, localStorage, subtle, calls,
		run: code => vm.runInContext(code, context),
		models: () => JSON.parse(vm.runInContext('JSON.stringify([currentDistrict, repState, neighborState, transferState])', context))
	};
}

// 旧形式の生成に本番deriveKey/wrapKeyWithPasswordを使わず、100k互換を独立に検査する。
async function nativePasswordKey(salt, iterations) {
	const material = await webcrypto.subtle.importKey('raw', encode(password), 'PBKDF2', false, ['deriveKey']);
	return webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function payloadFixture(iterations, prefix, plaintext = '{"district":"互換地区"}') {
	const salt = webcrypto.getRandomValues(new Uint8Array(16));
	const iv = webcrypto.getRandomValues(new Uint8Array(12));
	const key = await nativePasswordKey(salt, iterations);
	const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encode(plaintext));
	return prefix + base64(Buffer.concat([Buffer.from(salt), Buffer.from(iv), Buffer.from(cipher)]));
}

async function storageFixture({ format = 2, iterations, malformed = false } = {}) {
	const tab = createTab();
	const models = tab.models();
	if (malformed) models[3].children = [null];
	const raw = webcrypto.getRandomValues(new Uint8Array(32));
	const master = await webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
	const salt = webcrypto.getRandomValues(new Uint8Array(16));
	const iv = webcrypto.getRandomValues(new Uint8Array(12));
	const wrapKey = await nativePasswordKey(salt, iterations === 600000 ? 600000 : 100000);
	const wrapped = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, raw);
	const passwordMeta = { salt: base64(salt), iv: base64(iv), wrappedKey: base64(wrapped) };
	if (iterations !== undefined) passwordMeta.iterations = iterations;
	const bioIv = webcrypto.getRandomValues(new Uint8Array(12));
	const bioKey = await webcrypto.subtle.importKey('raw', prf, 'AES-GCM', false, ['encrypt']);
	const bioCipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: bioIv }, bioKey, raw);
	const webauthn = { credentialId: base64(new Uint8Array([1, 2, 3, 4])), prfSalt: base64(new Uint8Array(32).fill(9)), iv: base64(bioIv), wrappedKey: base64(bioCipher) };
	for (const [i, key] of keys.entries()) {
		const dataIv = webcrypto.getRandomValues(new Uint8Array(12));
		const algorithm = { name: 'AES-GCM', iv: dataIv };
		if (format === 2) algorithm.additionalData = encode('kogaidocs:storage:2:' + key);
		const cipher = await webcrypto.subtle.encrypt(algorithm, master, encode(JSON.stringify(models[i])));
		tab.localStorage.setItem(key, (format === 2 ? 'STORAGE_ENC:2:' : 'STORAGE_ENC:') + base64(Buffer.concat([Buffer.from(dataIv), Buffer.from(cipher)])));
	}
	raw.fill(0);
	tab.localStorage.setItem(authKey, JSON.stringify({ isEncrypted: true, version: format, ...(format === 2 ? { storageFormat: 2 } : {}), password: passwordMeta, webauthn }));
	return { tab, models, passwordMeta };
}

async function assertModels(tab, models) {
	for (const [i, key] of keys.entries()) assert.deepEqual(JSON.parse(JSON.stringify(await tab.run(`loadStorageDecrypted('${key}')`))), models[i]);
}

test('SEC-12: new submission payload uses ENC:2: and 600,000 PBKDF2 iterations', async () => {
	const tab = createTab();
	const payload = await tab.run(`encryptPayload('{"district":"新規地区"}', '${password}')`);
	assert.deepEqual(tab.calls, [600000]);
	assert.ok(payload.startsWith('ENC:2:'));
	const bytes = Buffer.from(payload.slice('ENC:2:'.length), 'base64');
	const key = await nativePasswordKey(bytes.subarray(0, 16), 600000);
	const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(16, 28) }, key, bytes.subarray(28));
	assert.equal(new TextDecoder().decode(plain), '{"district":"新規地区"}');
});

for (const [prefix, iterations] of [['ENC:2:', 600000], ['ENC:', 100000], ['', 100000]]) {
	test(`SEC-12: independently generated ${prefix || 'bare Base64'} submission decrypts using ${iterations} iterations`, async () => {
		const tab = createTab();
		tab.context.payload = await payloadFixture(iterations, prefix);
		assert.equal(await tab.run(`decryptPayload(payload, '${password}')`), '{"district":"互換地区"}');
		assert.deepEqual(tab.calls, [iterations]);
	});
}

test('SEC-12: unknown submission version is rejected before PBKDF2', async () => {
	const tab = createTab();
	// Base64本体は完全な正当旧暗号文であり、壊れた本体による拒否を根拠にしない。
	tab.context.payload = await payloadFixture(100000, 'ENC:3:');
	await assert.rejects(tab.run(`decryptPayload(payload, '${password}')`));
	assert.deepEqual(tab.calls, []);
});

test('SEC-12: a new-format authentication failure never retries the legacy KDF', async () => {
	const tab = createTab();
	const payload = await payloadFixture(600000, 'ENC:2:');
	const bytes = Buffer.from(payload.slice('ENC:2:'.length), 'base64');
	bytes[bytes.length - 1] ^= 1;
	tab.context.payload = 'ENC:2:' + base64(bytes);
	await assert.rejects(tab.run(`decryptPayload(payload, '${password}')`));
	assert.deepEqual(tab.calls, [600000], 'Authentication is attempted once under the declared format');
});

test('SEC-12: new local encryption records 600,000 iterations and survives password unlock', async () => {
	const tab = createTab();
	await tab.run(`setupStorageEncryption('${password}', false)`);
	const meta = JSON.parse(tab.localStorage.getItem(authKey));
	assert.equal(meta.password.iterations, 600000);
	assert.deepEqual(tab.calls, [600000]);
	const models = tab.models();
	tab.run('lockStorage()'); tab.calls.length = 0;
	await tab.run(`unlockStorageWithPassword('${password}')`);
	assert.deepEqual(tab.calls, [600000]);
	await assertModels(tab, models);
});

for (const format of [1, 2]) {
	for (const iterations of [undefined, 100000]) {
		test(`SEC-12: format ${format} and ${iterations === undefined ? 'missing' : 'explicit'} old work factor migrate together on password unlock`, async () => {
			const { tab, models } = await storageFixture({ format, iterations });
			await tab.run(`unlockStorageWithPassword('${password}')`);
			const meta = JSON.parse(tab.localStorage.getItem(authKey));
			assert.equal(meta.password.iterations, 600000);
			assert.equal(meta.storageFormat, 2);
			assert.deepEqual(tab.calls, [100000, 600000]);
			assert.ok(keys.every(key => tab.localStorage.getItem(key).startsWith('STORAGE_ENC:2:')));
			await assertModels(tab, models);
			// 新メタデータが本当に600kでラップされており、次回も実復号できることを確認する。
			tab.run('lockStorage()'); tab.calls.length = 0;
			await tab.run(`unlockStorageWithPassword('${password}')`);
			assert.deepEqual(tab.calls, [600000]);
			await assertModels(tab, models);
		});
	}
}

for (const iterations of [0, -1, 99999, 100001, 599999, 600001, 2147483647, '600000', null]) {
	test(`SEC-12: untrusted saved iterations ${JSON.stringify(iterations)} are rejected before PBKDF2`, async () => {
		const { tab } = await storageFixture();
		const meta = JSON.parse(tab.localStorage.getItem(authKey));
		meta.password.iterations = iterations;
		tab.localStorage.setItem(authKey, JSON.stringify(meta));
		const before = tab.localStorage.snapshot();
		await assert.rejects(tab.run(`unlockStorageWithPassword('${password}')`));
		assert.deepEqual(tab.calls, []);
		assert.deepEqual(tab.localStorage.snapshot(), before);
		assert.equal(tab.run('isStorageUnlocked()'), false);
	});
}

for (const format of [1, 2]) {
	test(`SEC-12: biometric unlock of format ${format} preserves the old password wrap until password unlock`, async () => {
		const { tab, models, passwordMeta } = await storageFixture({ format });
		await tab.run('unlockStorageWithWebAuthn()');
		assert.deepEqual(JSON.parse(tab.localStorage.getItem(authKey)).password, passwordMeta);
		assert.deepEqual(tab.calls, [], 'PRF unlock does not guess or obtain the password');
		assert.equal(tab.run('isStorageUnlocked()'), true);
		await assertModels(tab, models);
		tab.run('lockStorage()');
		await tab.run(`unlockStorageWithPassword('${password}')`);
		assert.equal(JSON.parse(tab.localStorage.getItem(authKey)).password.iterations, 600000);
		assert.deepEqual(tab.calls, [100000, 600000]);
		await assertModels(tab, models);
	});

	test(`SEC-12: format ${format} metadata commit failure restores every original saved value`, async () => {
		const { tab } = await storageFixture({ format });
		const before = tab.localStorage.snapshot();
		const setItem = tab.localStorage.setItem;
		let failed = false;
		tab.localStorage.setItem = (key, value) => {
			if (key === authKey && !failed) { failed = true; throw new Error('metadata quota'); }
			setItem(key, value);
		};
		await assert.rejects(tab.run(`unlockStorageWithPassword('${password}')`));
		assert.equal(failed, true, 'The metadata commit was reached');
		assert.deepEqual(tab.localStorage.snapshot(), before);
		assert.equal(tab.run('isStorageUnlocked()'), false);
	});
}

test('SEC-12: combined old-format migration rolls back after the third data write fails', async () => {
	const { tab } = await storageFixture({ format: 1 });
	const before = tab.localStorage.snapshot();
	const setItem = tab.localStorage.setItem;
	let failed = false;
	tab.localStorage.setItem = (key, value) => {
		if (key === keys[2] && !failed) { failed = true; throw new Error('data quota'); }
		setItem(key, value);
	};
	await assert.rejects(tab.run(`unlockStorageWithPassword('${password}')`));
	assert.equal(failed, true);
	assert.deepEqual(tab.localStorage.snapshot(), before);
	assert.equal(tab.run('isStorageUnlocked()'), false);
});

test('SEC-12: all models must validate before a stronger password wrap is generated', async () => {
	const { tab } = await storageFixture({ malformed: true });
	const before = tab.localStorage.snapshot();
	await assert.rejects(tab.run(`unlockStorageWithPassword('${password}')`));
	assert.deepEqual(tab.calls, [100000]);
	assert.deepEqual(tab.localStorage.snapshot(), before);
	assert.equal(tab.run('isStorageUnlocked()'), false);
});

test('SEC-12: rewrap encryption failure preserves ciphertext, metadata and the locked state', async () => {
	const { tab } = await storageFixture();
	const before = tab.localStorage.snapshot();
	const encrypt = tab.subtle.encrypt;
	let failed = false;
	tab.subtle.encrypt = (...args) => {
		if (tab.calls.includes(600000)) { failed = true; throw new Error('rewrap encryption failed'); }
		return encrypt(...args);
	};
	await assert.rejects(tab.run(`unlockStorageWithPassword('${password}')`));
	assert.equal(failed, true);
	assert.deepEqual(tab.localStorage.snapshot(), before);
	assert.equal(tab.run('isStorageUnlocked()'), false);
});

for (const action of ['lock', 'other-tab']) {
	test(`SEC-12: ${action} during 600k rewrap prevents committing a stale unlock`, async () => {
		const { tab } = await storageFixture();
		let expected = tab.localStorage.snapshot();
		const deriveKey = tab.subtle.deriveKey;
		let reached = false;
		tab.subtle.deriveKey = async (...args) => {
			const result = await deriveKey(...args);
			if (args[0].iterations === 600000) {
				reached = true;
				if (action === 'lock') tab.run('lockStorage()');
				else {
					const meta = JSON.parse(tab.localStorage.getItem(authKey));
					meta.createdAt = '他タブで置換した認証情報';
					tab.localStorage.setItem(authKey, JSON.stringify(meta));
					expected = tab.localStorage.snapshot();
				}
			}
			return result;
		};
		await assert.rejects(tab.run(`unlockStorageWithPassword('${password}')`));
		assert.equal(reached, true, 'The real 600k derivation completed before the security epoch changed');
		assert.deepEqual(tab.localStorage.snapshot(), expected, 'A stale migration must not restore over another tab\'s change');
		assert.equal(tab.run('isStorageUnlocked()'), false);
	});
}
