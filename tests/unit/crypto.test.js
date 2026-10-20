const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

setupDomEnvironment();
const cryptoLib = require('../../js/crypto.js');
const utils = require('../../js/utils.js');

const validPass = "Pass12345678#$";

test('crypto: base64ToUint8 and uint8ToBase64 round-trip', () => {
	const original = new Uint8Array([0, 1, 10, 255, 128, 64, 32]);
	const b64 = cryptoLib.uint8ToBase64(original);
	assert.strictEqual(typeof b64, 'string');
	const restored = cryptoLib.base64ToUint8(b64);
	assert.deepStrictEqual(restored, original);
});

test('crypto: deriveKey derives an AES-GCM CryptoKey', async () => {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const key = await cryptoLib.deriveKey(validPass, salt);
	assert.strictEqual(key.algorithm.name, "AES-GCM");
	assert.strictEqual(key.type, "secret");
});

test('crypto: encryptPayload and decryptPayload with AES-GCM and PBKDF2', async () => {
	const plain = JSON.stringify({ hello: "world", district: "テスト町" });
	const enc = await cryptoLib.encryptPayload(plain, validPass);
	assert(enc.startsWith("ENC:"));

	const dec = await cryptoLib.decryptPayload(enc, validPass);
	assert.strictEqual(dec, plain);

	// Reject payload with insufficient length (< 44 bytes)
	const shortB64 = btoa("too short");
	await assert.rejects(async () => {
		await cryptoLib.decryptPayload(shortB64, validPass);
	}, /データ長不足/);

	// Raw base64 (without ENC: prefix)
	const rawB64 = enc.slice(4);
	const rawDec = await cryptoLib.decryptPayload(rawB64, validPass);
	assert.strictEqual(rawDec, plain);

	// Invalid password for encryption throws error
	await assert.rejects(async () => {
		await cryptoLib.encryptPayload("test", "short");
	}, /最低12文字/);

	// Wrong password for decryption throws
	await assert.rejects(async () => {
		await cryptoLib.decryptPayload(enc, "WrongPassword123!");
	});
});

test('crypto: parseTxtContent handles BEGIN_DATA and raw payloads', async () => {
	const payloadObj = { district: "南区", count: 42 };
	const enc = await cryptoLib.encryptPayload(JSON.stringify(payloadObj), validPass);

	const textWithHeaders = `
--- 出力ファイル ---
BEGIN_DATA:
${enc}
:END_DATA
`;
	const parsed = await cryptoLib.parseTxtContent(textWithHeaders, validPass);
	assert.deepStrictEqual(parsed, payloadObj);

	// Text without BEGIN_DATA tags
	const parsedRaw = await cryptoLib.parseTxtContent(enc, validPass);
	assert.deepStrictEqual(parsedRaw, payloadObj);
});

test('crypto: isWebAuthnAvailable detects secure context and protocols', () => {
	assert.strictEqual(cryptoLib.isWebAuthnAvailable(), true);

	window.isSecureContext = false;
	assert.strictEqual(cryptoLib.isWebAuthnAvailable(), false);
	window.isSecureContext = true;

	const origProto = window.location.protocol;
	window.location.protocol = 'file:';
	assert.strictEqual(cryptoLib.isWebAuthnAvailable(), false);
	window.location.protocol = origProto;
});

test('crypto: getStorageAuthMeta and isStorageEncrypted / isStorageUnlocked', () => {
	localStorage.clear();
	assert.strictEqual(cryptoLib.getStorageAuthMeta(), null);
	assert.strictEqual(cryptoLib.isStorageEncrypted(), false);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// Invalid JSON handling in getStorageAuthMeta
	localStorage.setItem(cryptoLib.STORAGE_AUTH_KEY, "invalid-json{");
	assert.strictEqual(cryptoLib.getStorageAuthMeta(), null);

	// Encrypted meta
	localStorage.setItem(cryptoLib.STORAGE_AUTH_KEY, JSON.stringify({ isEncrypted: true }));
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
	cryptoLib.lockStorage();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);

	localStorage.clear();
});

test('crypto: wrapKeyWithPassword and unwrapKeyWithPassword', async () => {
	const masterKey = await cryptoLib.generateMasterKey();
	const rawMaster = new Uint8Array(await crypto.subtle.exportKey("raw", masterKey));

	const wrapMeta = await cryptoLib.wrapKeyWithPassword(rawMaster, validPass);
	assert(wrapMeta.salt);
	assert(wrapMeta.iv);
	assert(wrapMeta.wrappedKey);

	const unwrappedKey = await cryptoLib.unwrapKeyWithPassword(wrapMeta, validPass);
	assert.strictEqual(unwrappedKey.algorithm.name, "AES-GCM");

	// Wrong password fails
	await assert.rejects(async () => {
		await cryptoLib.unwrapKeyWithPassword(wrapMeta, "WrongPassword123!");
	});
});

test('crypto: WebAuthn PRF register and unwrap with mock credentials', async () => {
	const masterKey = await cryptoLib.generateMasterKey();
	const rawMaster = new Uint8Array(await crypto.subtle.exportKey("raw", masterKey));

	// 1. Success registration
	const webauthnMeta = await cryptoLib.registerWebAuthnPrf(rawMaster);
	assert(webauthnMeta.credentialId);
	assert(webauthnMeta.prfSalt);
	assert(webauthnMeta.wrappedKey);

	// 2. Success unwrap
	const unwrapped = await cryptoLib.unwrapKeyWithWebAuthn(webauthnMeta);
	assert.strictEqual(unwrapped.algorithm.name, "AES-GCM");

	// 3. User cancels registration (returns null)
	navigator.credentials.failCreate = true;
	await assert.rejects(async () => {
		await cryptoLib.registerWebAuthnPrf(rawMaster);
	}, /キャンセル/);
	navigator.credentials.failCreate = false;

	// 4. WebAuthn without PRF support
	navigator.credentials.noPrf = true;
	await assert.rejects(async () => {
		await cryptoLib.registerWebAuthnPrf(rawMaster);
	}, /PRF鍵導出拡張に対応していません/);
	navigator.credentials.noPrf = false;

	// 5. User cancels get (returns null)
	navigator.credentials.failGet = true;
	await assert.rejects(async () => {
		await cryptoLib.unwrapKeyWithWebAuthn(webauthnMeta);
	}, /キャンセル/);
	navigator.credentials.failGet = false;

	// 6. Assertion missing PRF
	navigator.credentials.noPrf = true;
	await assert.rejects(async () => {
		await cryptoLib.unwrapKeyWithWebAuthn(webauthnMeta);
	}, /PRF鍵を取得できませんでした/);
	navigator.credentials.noPrf = false;

	// 7. Not available in insecure context
	window.isSecureContext = false;
	await assert.rejects(async () => {
		await cryptoLib.registerWebAuthnPrf(rawMaster);
	}, /HTTPS環境またはlocalhost/);
	await assert.rejects(async () => {
		await cryptoLib.unwrapKeyWithWebAuthn(webauthnMeta);
	}, /HTTPS環境またはlocalhost/);
	window.isSecureContext = true;
});

test('crypto: setupStorageEncryption and unlock / lock lifecycle', async () => {
	localStorage.clear();
	global.currentDistrict = { district: "初期町" };
	global.repState = { districts: [] };

	// Invalid password
	await assert.rejects(async () => {
		await cryptoLib.setupStorageEncryption("short", false);
	}, /最低12文字/);

	// Setup with password only
	const resPassOnly = await cryptoLib.setupStorageEncryption(validPass, false);
	assert.strictEqual(resPassOnly.success, true);
	assert.strictEqual(resPassOnly.biometric, false);
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// Save and load data while unlocked
	const testData = { foo: "bar", num: 99 };
	await cryptoLib.saveStorageData('test_store_key', testData);
	const loaded = await cryptoLib.loadStorageDecrypted('test_store_key');
	assert.deepStrictEqual(loaded, testData);

	// Lock storage
	cryptoLib.lockStorage();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);

	// Attempt save when locked should safely skip
	await cryptoLib.saveStorageData('test_store_key', { overwrite: "no" });

	// Attempt load when locked throws STORAGE_LOCKED
	await assert.rejects(async () => {
		await cryptoLib.loadStorageDecrypted('test_store_key');
	}, /STORAGE_LOCKED/);

	// Unlock with password
	await cryptoLib.unlockStorageWithPassword(validPass);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);
	const reloaded = await cryptoLib.loadStorageDecrypted('test_store_key');
	assert.deepStrictEqual(reloaded, testData);

	// Setup with biometric enabled
	const resWithBio = await cryptoLib.setupStorageEncryption(validPass, true);
	assert.strictEqual(resWithBio.biometric, true);

	// Register biometric for existing active key
	const regRes = await cryptoLib.registerWebAuthnForActiveKey();
	assert.strictEqual(regRes, true);

	// Lock and unlock with biometric
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithWebAuthn();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// Unlock when unencrypted returns true immediately
	localStorage.removeItem(cryptoLib.STORAGE_AUTH_KEY);
	assert.strictEqual(await cryptoLib.unlockStorageWithPassword("any"), true);
	assert.strictEqual(await cryptoLib.unlockStorageWithWebAuthn(), true);

	// Register biometric error states
	cryptoLib.lockStorage();
	await assert.rejects(async () => {
		await cryptoLib.registerWebAuthnForActiveKey();
	}, /ロックされているか未初期化/);

	// Clear security
	cryptoLib.clearStorageSecurity();
	assert.strictEqual(cryptoLib.isStorageEncrypted(), false);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);
});

test('crypto: loadStorageDecrypted handles plain and invalid entries', async () => {
	localStorage.clear();

	// null entry
	assert.strictEqual(await cryptoLib.loadStorageDecrypted('nonexistent'), null);

	// plain JSON entry
	localStorage.setItem('plain_entry', JSON.stringify({ a: 1 }));
	assert.deepStrictEqual(await cryptoLib.loadStorageDecrypted('plain_entry'), { a: 1 });

	// invalid plain JSON
	localStorage.setItem('bad_plain', 'not-valid-json{');
	assert.strictEqual(await cryptoLib.loadStorageDecrypted('bad_plain'), null);

	// unlockStorageWithWebAuthn when no biometric registered
	await cryptoLib.setupStorageEncryption(validPass, false);
	cryptoLib.lockStorage();
	await assert.rejects(async () => {
		await cryptoLib.unlockStorageWithWebAuthn();
	}, /生体認証は登録されていません/);

	// Reconfiguration requires an unlocked session; a failed biometric registration falls back to password.
	await cryptoLib.unlockStorageWithPassword(validPass);
	navigator.credentials.noPrf = true;
	const resBioFail = await cryptoLib.setupStorageEncryption(validPass, true);
	assert.strictEqual(resBioFail.biometric, false);
	navigator.credentials.noPrf = false;

	// registerWebAuthnForActiveKey with unencrypted storage (lines 388-389)
	localStorage.removeItem(cryptoLib.STORAGE_AUTH_KEY);
	await assert.rejects(async () => {
		await cryptoLib.registerWebAuthnForActiveKey();
	}, /ストレージの暗号化が設定されていません/);

	// saveStorageData in unencrypted mode (lines 448-450)
	await cryptoLib.saveStorageData('unenc_key', { unencrypted: true });
	assert.strictEqual(JSON.parse(localStorage.getItem('unenc_key')).unencrypted, true);

	// saveStorageData catch block on subtle.encrypt error (lines 470-471)
	localStorage.setItem(cryptoLib.STORAGE_AUTH_KEY, JSON.stringify({ isEncrypted: true }));
	cryptoLib.activeStorageKey = { algorithm: { name: 'INVALID' } }; // will cause encrypt to throw
	await cryptoLib.saveStorageData('err_key', { willFail: true });
});

test('crypto: deterministic WEBAUTHN_USER_ID prevents infinite duplicate passkey registrations in 1Password', async () => {
	assert.ok(cryptoLib.WEBAUTHN_USER_ID, 'WEBAUTHN_USER_ID must be defined');
	const expected = new Uint8Array([107, 111, 103, 97, 105, 100, 111, 99, 115]); // "kogaidocs"
	assert.deepStrictEqual(cryptoLib.WEBAUTHN_USER_ID, expected);

	let passedCreateOptions = null;
	const origCreate = navigator.credentials.create;
	navigator.credentials.create = async (options) => {
		passedCreateOptions = options;
		return origCreate.call(navigator.credentials, options);
	};

	try {
		const dummyKey = new Uint8Array(32);
		const prfRes = await cryptoLib.registerWebAuthnPrf(dummyKey);
		assert.ok(passedCreateOptions);
		assert.ok(passedCreateOptions.publicKey);
		assert.deepStrictEqual(passedCreateOptions.publicKey.user.id, expected);
		assert.strictEqual(passedCreateOptions.publicKey.user.name, 'kogaidocs-user');
	} finally {
		navigator.credentials.create = origCreate;
	}
});

