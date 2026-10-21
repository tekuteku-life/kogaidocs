/* =========================================================================
   暗号化・復号（AES-GCM + PBKDF2 + WebAuthn PRF + Base64）
========================================================================= */

let activeStorageKey = null;
let storageSessionGeneration = 0;
let activeStorageAuthSnapshot = null;
let storageSecurityInvalidated = false;
const STORAGE_AUTH_KEY = 'kogai_auth_meta';
const STORAGE_DATA_KEYS = ['kogai_district_v2', 'kogai_rep_v2', 'kogai_neighbor_v2', 'kogai_transfer_v2'];
const STORAGE_FORMAT = 2;
const STORAGE_PREFIX = 'STORAGE_ENC:2:';
const LEGACY_STORAGE_PREFIX = 'STORAGE_ENC:';
const STORAGE_AAD_PREFIX = 'kogaidocs:storage:2:';
const STORAGE_LOCK_NAME = 'kogaidocs:storage';
const LEGACY_PBKDF2_ITERATIONS = 100000;
const CURRENT_PBKDF2_ITERATIONS = 600000;
const PAYLOAD_PREFIX = 'ENC:2:';
const LEGACY_PAYLOAD_PREFIX = 'ENC:';
const WEBAUTHN_USER_ID = new Uint8Array([107, 111, 103, 97, 105, 100, 111, 99, 115]); // "kogaidocs"

function storageLocksAvailable() {
	return typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function';
}

async function withStorageLock(mode, callback, required = false) {
	if (storageLocksAvailable()) return navigator.locks.request(STORAGE_LOCK_NAME, { mode }, callback);
	if (required || isStorageEncrypted()) throw new Error('STORAGE_LOCKS_UNAVAILABLE');
	return callback();
}

/**
 * パスワードとソルトからAES-GCM用の暗号鍵を導出します（新規PBKDF2 60万回）
 */
async function deriveKey(password, salt, iterations = CURRENT_PBKDF2_ITERATIONS) {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

/**
 * 文字列データをAES-GCMで暗号化します（提出用.txtファイル用）
 */
async function encryptPayload(jsonStr, password) {
	const check = validatePassword(password);
	if (!check.valid) {
		throw new Error(check.message);
	}
	const enc = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await deriveKey(password, salt);
	const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(jsonStr));
	const cipherBytes = new Uint8Array(cipherBuf);
	const combined = new Uint8Array(salt.length + iv.length + cipherBytes.length);
	combined.set(salt, 0);
	combined.set(iv, 16);
	combined.set(cipherBytes, 28);
	return PAYLOAD_PREFIX + uint8ToBase64(combined);
}

/**
 * 暗号化された文字列データを復号します（提出用.txtファイル用）
 */
async function decryptPayload(payloadStr, password) {
	const dec = new TextDecoder();
	let iterations = LEGACY_PBKDF2_ITERATIONS;
	let b64 = payloadStr;
	if (payloadStr.startsWith(PAYLOAD_PREFIX)) {
		iterations = CURRENT_PBKDF2_ITERATIONS;
		b64 = payloadStr.slice(PAYLOAD_PREFIX.length);
	} else if (/^ENC:\d+:/.test(payloadStr)) {
		throw new Error('暗号化データのバージョンに対応していません。');
	} else if (payloadStr.startsWith(LEGACY_PAYLOAD_PREFIX)) {
		b64 = payloadStr.slice(LEGACY_PAYLOAD_PREFIX.length);
	}
	const combined = base64ToUint8(b64);
	if (combined.length < 44) {
		throw new Error("暗号化データの形式が不正です（データ長不足）。");
	}
	const salt = combined.slice(0, 16);
	const iv = combined.slice(16, 28);
	const cipherBytes = combined.slice(28);
	const key = await deriveKey(password, salt, iterations);
	const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
	return dec.decode(plainBuf);
}

/**
 * Uint8ArrayをBase64文字列に変換します
 */
function uint8ToBase64(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/**
 * Base64文字列をUint8Arrayに変換します
 */
function base64ToUint8(b64) {
	const binary = atob(b64.trim());
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

/**
 * 読み込んだ.txtファイルの内容からJSONデータを抽出・復号します
 */
async function parseTxtContent(text, password, generation = getStorageSessionGeneration(), kind) {
	assertStorageSession(generation);
	if (new TextEncoder().encode(String(text)).byteLength > 8 * 1024 * 1024) throw new Error('ファイルサイズが上限を超えています。');
	const match = text.match(/BEGIN_DATA:\s*([\s\S]+?)\s*:END_DATA/);
	const payload = match ? match[1].trim() : text.trim();
	const jsonStr = await decryptPayload(payload, password);
	assertStorageSession(generation);
	const data = JSON.parse(jsonStr);
	if (!kind) {
		validateImportStructure(data);
		return data;
	}
	if (kind === 'auto' || kind === 'districtOrNeighbor') {
		kind = kind === 'auto' && data?.isTransferData ? 'transfer'
			: kind === 'auto' && data?.districts !== undefined ? 'rep'
				: data?.isNeighborhoodData || (!data?.students && Array.isArray(data?.neighborhood)) ? 'neighbor' : 'district';
	}
	return validateImportData(data, kind);
}

function getStorageSessionGeneration() {
	return storageSessionGeneration;
}

function assertStorageSession(generation) {
	if (generation !== storageSessionGeneration || !isStorageUnlocked()) {
		throw new Error('STORAGE_SESSION_CHANGED');
	}
}

function storageAdditionalData(storageKey) {
	return new TextEncoder().encode(STORAGE_AAD_PREFIX + storageKey);
}

async function encryptStorageValue(data, key, storageKey) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipher = new Uint8Array(await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: storageAdditionalData(storageKey) },
		key,
		new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data))
	));
	const combined = new Uint8Array(iv.length + cipher.length);
	combined.set(iv);
	combined.set(cipher, iv.length);
	return STORAGE_PREFIX + uint8ToBase64(combined);
}

/* =========================================================================
   ローカルストレージ暗号化（WebAuthn PRF + PBKDF2 + AES-256-GCM ハイブリッド）
========================================================================= */

/**
 * WebAuthn（生体認証）が利用可能かチェックします（安全なコンテキストかつHTTPS/localhost）
 */
function isWebAuthnAvailable() {
	return typeof window !== 'undefined' &&
		window.isSecureContext === true &&
		typeof window.PublicKeyCredential !== 'undefined' &&
		typeof navigator !== 'undefined' &&
		typeof navigator.credentials !== 'undefined' &&
		window.location.protocol !== 'file:';
}

/**
 * ストレージ暗号化のメタデータを取得します
 */
function getStorageAuthMeta() {
	try {
		const metaStr = localStorage.getItem(STORAGE_AUTH_KEY);
		return metaStr ? JSON.parse(metaStr) : null;
	} catch (e) {
		return null;
	}
}

function hasStorageCiphertext() {
	return STORAGE_DATA_KEYS.some(key => {
		const value = localStorage.getItem(key);
		return typeof value === 'string' && value.startsWith(LEGACY_STORAGE_PREFIX);
	});
}

function isValidWrapMeta(value) {
	return !!value && typeof value === 'object' &&
		['salt', 'iv', 'wrappedKey'].every(key => typeof value[key] === 'string' && value[key].length > 0);
}

function passwordWrapIterations(passwordMeta) {
	const iterations = passwordMeta.iterations === undefined ? LEGACY_PBKDF2_ITERATIONS : passwordMeta.iterations;
	if (!Number.isInteger(iterations) || ![LEGACY_PBKDF2_ITERATIONS, CURRENT_PBKDF2_ITERATIONS].includes(iterations)) {
		throw new Error('STORAGE_AUTH_INVALID');
	}
	return iterations;
}

function requireStorageAuthMeta(raw) {
	let meta;
	try { meta = JSON.parse(raw); } catch (_) { throw new Error('STORAGE_AUTH_INVALID'); }
	if (!meta || meta.isEncrypted !== true || !isValidWrapMeta(meta.password)) throw new Error('STORAGE_AUTH_INVALID');
	passwordWrapIterations(meta.password);
	if (meta.storageFormat !== undefined && meta.storageFormat !== STORAGE_FORMAT) throw new Error('STORAGE_FORMAT_UNSUPPORTED');
	return meta;
}

function invalidateStorageSession() {
	if (activeStorageKey !== null || activeStorageAuthSnapshot !== null || !storageSecurityInvalidated) storageSessionGeneration++;
	activeStorageKey = null;
	activeStorageAuthSnapshot = null;
	storageSecurityInvalidated = true;
}

function invalidateStorageSecurity() {
	invalidateStorageSession();
}

function activeStorageSessionIsCurrent() {
	if (!activeStorageKey || activeStorageAuthSnapshot === null) return false;
	const raw = localStorage.getItem(STORAGE_AUTH_KEY);
	if (raw !== activeStorageAuthSnapshot) {
		invalidateStorageSession();
		return false;
	}
	try { requireStorageAuthMeta(raw); } catch (_) {
		invalidateStorageSession();
		return false;
	}
	return true;
}

/**
 * ストレージが暗号化設定されているか判定します
 */
function isStorageEncrypted() {
	const raw = localStorage.getItem(STORAGE_AUTH_KEY);
	return raw !== null || hasStorageCiphertext() || activeStorageAuthSnapshot !== null || storageSecurityInvalidated;
}

/**
 * ストレージがロック解除状態（メモリ内にアクティブキーがある）か判定します
 */
function isStorageUnlocked() {
	if (!isStorageEncrypted()) return true;
	return activeStorageSessionIsCurrent();
}

/**
 * ランダムな256ビットのマスターキーを生成します
 */
async function generateMasterKey() {
	return await crypto.subtle.generateKey(
		{ name: "AES-GCM", length: 256 },
		true,
		["encrypt", "decrypt"]
	);
}

/**
 * マスターキーをPBKDF2導出鍵で暗号化（ラップ）します
 */
async function wrapKeyWithPassword(rawMasterKey, password, saltBytes, iterations = CURRENT_PBKDF2_ITERATIONS) {
	const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(password),
		"PBKDF2",
		false,
		["deriveKey"]
	);
	const wrapKey = await crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
	const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, rawMasterKey);
	return {
		salt: uint8ToBase64(salt),
		iv: uint8ToBase64(iv),
		wrappedKey: uint8ToBase64(new Uint8Array(cipherBuf)),
		iterations
	};
}

/**
 * パスワードからマスターキーを復号（アンラップ）します
 */
async function unwrapKeyWithPassword(passwordWrapMeta, password) {
	const iterations = passwordWrapIterations(passwordWrapMeta);
	const salt = base64ToUint8(passwordWrapMeta.salt);
	const iv = base64ToUint8(passwordWrapMeta.iv);
	const wrappedBytes = base64ToUint8(passwordWrapMeta.wrappedKey);
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey(
		"raw",
		enc.encode(password),
		"PBKDF2",
		false,
		["deriveKey"]
	);
	const wrapKey = await crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
	const rawMasterBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, wrappedBytes);
	try {
		return await crypto.subtle.importKey("raw", rawMasterBuf, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
	} finally {
		new Uint8Array(rawMasterBuf).fill(0);
	}
}

/**
 * WebAuthn PRF（生体認証）クレデンシャルを作成し、マスターキーをラップします
 */
async function registerWebAuthnPrf(rawMasterKey) {
	if (!isWebAuthnAvailable()) {
		throw new Error("生体認証（WebAuthn）はHTTPS環境またはlocalhostでのみ利用可能です。");
	}
	const prfSalt = crypto.getRandomValues(new Uint8Array(32));
	const challenge = crypto.getRandomValues(new Uint8Array(32));

	const createOptions = {
		publicKey: {
			challenge,
			rp: { name: "kogaidocs - 校外委員名簿管理システム" },
			user: {
				id: WEBAUTHN_USER_ID,
				name: "kogaidocs-user",
				displayName: "PTA校外委員会 名簿管理"
			},
			pubKeyCredParams: [
				{ type: "public-key", alg: -7 },  // ES256
				{ type: "public-key", alg: -257 } // RS256
			],
			authenticatorSelection: {
				authenticatorAttachment: "platform",
				userVerification: "required",
				residentKey: "preferred"
			},
			timeout: 60000,
			extensions: {
				prf: {
					eval: {
						first: prfSalt
					}
				}
			}
		}
	};

	const credential = await navigator.credentials.create(createOptions);
	if (!credential) {
		throw new Error("生体認証の登録がキャンセルされました。");
	}

	let prfResult = credential.getClientExtensionResults?.()?.prf?.results?.first;
	if (!prfResult) {
		// create時にeval結果が直接返らない環境向けに直後のgetでPRFを取得
		const getOptions = {
			publicKey: {
				challenge: crypto.getRandomValues(new Uint8Array(32)),
				allowCredentials: [{
					id: credential.rawId,
					type: "public-key"
				}],
				userVerification: "required",
				timeout: 60000,
				extensions: {
					prf: {
						eval: {
							first: prfSalt
						}
					}
				}
			}
		};
		const assertion = await navigator.credentials.get(getOptions);
		prfResult = assertion?.getClientExtensionResults?.()?.prf?.results?.first;
	}

	if (!prfResult) {
		throw new Error("お使いの生体認証デバイス・ブラウザはPRF鍵導出拡張に対応していません。パスワード暗号化をご利用ください。");
	}

	const prfWrapKey = await crypto.subtle.importKey("raw", prfResult, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, prfWrapKey, rawMasterKey);

	return {
		credentialId: uint8ToBase64(new Uint8Array(credential.rawId)),
		prfSalt: uint8ToBase64(prfSalt),
		iv: uint8ToBase64(iv),
		wrappedKey: uint8ToBase64(new Uint8Array(cipherBuf))
	};
}

/**
 * WebAuthn PRF（生体認証）でマスターキーをアンラップします
 */
async function unwrapKeyWithWebAuthn(webauthnMeta) {
	if (!isWebAuthnAvailable()) {
		throw new Error("生体認証（WebAuthn）はHTTPS環境またはlocalhostでのみ利用可能です。");
	}
	const credId = base64ToUint8(webauthnMeta.credentialId);
	const prfSalt = base64ToUint8(webauthnMeta.prfSalt);
	const iv = base64ToUint8(webauthnMeta.iv);
	const wrappedBytes = base64ToUint8(webauthnMeta.wrappedKey);

	const getOptions = {
		publicKey: {
			challenge: crypto.getRandomValues(new Uint8Array(32)),
			allowCredentials: [{
				id: credId,
				type: "public-key"
			}],
			userVerification: "required",
			timeout: 60000,
			extensions: {
				prf: {
					eval: {
						first: prfSalt
					}
				}
			}
		}
	};

	const assertion = await navigator.credentials.get(getOptions);
	if (!assertion) {
		throw new Error("生体認証がキャンセルされました。");
	}

	const prfResult = assertion.getClientExtensionResults?.()?.prf?.results?.first;
	if (!prfResult) {
		throw new Error("生体認証デバイスからPRF鍵を取得できませんでした。パスワードで解除してください。");
	}

	const prfWrapKey = await crypto.subtle.importKey("raw", prfResult, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
	const rawMasterBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, prfWrapKey, wrappedBytes);
	try {
		return await crypto.subtle.importKey("raw", rawMasterBuf, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
	} finally {
		new Uint8Array(rawMasterBuf).fill(0);
	}
}

function assertStorageContext(generation, authSnapshot) {
	if (generation !== storageSessionGeneration) throw new Error('STORAGE_SESSION_CHANGED');
	if (localStorage.getItem(STORAGE_AUTH_KEY) !== authSnapshot) {
		invalidateStorageSession();
		throw new Error('STORAGE_SESSION_CHANGED');
	}
}

function validateStorageModel(value, storageKey) {
	if (typeof validateStoredData === 'function') return validateStoredData(value, storageKey);
	const kind = storageKey.includes('_rep_') ? 'rep' : storageKey.includes('_neighbor_') ? 'neighbor' : 'district';
	return validateImportData(value, kind);
}

async function decryptStorageValue(raw, key, storageKey, storageFormat) {
	const isCurrent = raw.startsWith(STORAGE_PREFIX);
	if (storageFormat === STORAGE_FORMAT && !isCurrent) throw new Error('STORAGE_FORMAT_DOWNGRADE');
	if (storageFormat !== STORAGE_FORMAT && (isCurrent || !raw.startsWith(LEGACY_STORAGE_PREFIX))) throw new Error('STORAGE_FORMAT_INVALID');
	const prefix = isCurrent ? STORAGE_PREFIX : LEGACY_STORAGE_PREFIX;
	const combined = base64ToUint8(raw.slice(prefix.length));
	if (combined.length < 28) throw new Error('STORAGE_CIPHERTEXT_INVALID');
	const iv = combined.slice(0, 12);
	const cipherBytes = combined.slice(12);
	const algorithm = { name: 'AES-GCM', iv };
	if (isCurrent) algorithm.additionalData = storageAdditionalData(storageKey);
	const plainBuf = await crypto.subtle.decrypt(algorithm, key, cipherBytes);
	return JSON.parse(new TextDecoder().decode(plainBuf));
}

function writeStorageTransaction(entries) {
	const previous = entries.map(([key]) => localStorage.getItem(key));
	const written = [];
	try {
		entries.forEach(([key, value], index) => {
			localStorage.setItem(key, value);
			written.push(index);
		});
	} catch (error) {
		for (const index of written.reverse()) {
			const key = entries[index][0];
			if (previous[index] === null) localStorage.removeItem(key);
			else localStorage.setItem(key, previous[index]);
		}
		throw error;
	}
}

async function activateStorageKey(masterKey, meta, authSnapshot, generation, password) {
	assertStorageContext(generation, authSnapshot);
	const values = [];
	for (const key of STORAGE_DATA_KEYS) {
		const raw = localStorage.getItem(key);
		if (!raw || !raw.startsWith(LEGACY_STORAGE_PREFIX)) throw new Error('STORAGE_DATA_MISSING');
		const value = await decryptStorageValue(raw, masterKey, key, meta.storageFormat);
		values.push(validateStorageModel(value, key));
		assertStorageContext(generation, authSnapshot);
	}
	const encoded = [];
	if (meta.storageFormat !== STORAGE_FORMAT) {
		for (let i = 0; i < STORAGE_DATA_KEYS.length; i++) {
			encoded.push(await encryptStorageValue(JSON.stringify(values[i]), masterKey, STORAGE_DATA_KEYS[i]));
			assertStorageContext(generation, authSnapshot);
		}
	}
	let upgradedPassword = null;
	if (password !== undefined && passwordWrapIterations(meta.password) !== CURRENT_PBKDF2_ITERATIONS) {
		let rawMasterKey;
		try {
			rawMasterKey = await crypto.subtle.exportKey('raw', masterKey);
			upgradedPassword = await wrapKeyWithPassword(rawMasterKey, password);
		} finally {
			if (rawMasterKey) new Uint8Array(rawMasterKey).fill(0);
		}
		assertStorageContext(generation, authSnapshot);
	}
	let committedAuth = authSnapshot;
	if (encoded.length || upgradedPassword) {
		const migratedMeta = {
			...meta,
			version: STORAGE_FORMAT,
			storageFormat: STORAGE_FORMAT,
			...(upgradedPassword ? { password: upgradedPassword } : {})
		};
		committedAuth = JSON.stringify(migratedMeta);
		assertStorageContext(generation, authSnapshot);
		writeStorageTransaction([
			...encoded.map((value, index) => [STORAGE_DATA_KEYS[index], value]),
			[STORAGE_AUTH_KEY, committedAuth]
		]);
	}
	assertStorageContext(generation, committedAuth);
	storageSessionGeneration++;
	activeStorageKey = masterKey;
	activeStorageAuthSnapshot = committedAuth;
	storageSecurityInvalidated = false;
	return values;
}

/**
 * ストレージ暗号化を初期化・設定します（パスワード必須、生体認証は任意）
 */
async function setupStorageEncryptionUnlocked(password, enableBiometric = false) {
	const generation = getStorageSessionGeneration();
	const authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY);
	if (isStorageEncrypted() && !activeStorageSessionIsCurrent()) throw new Error('STORAGE_LOCKED');
	const check = validatePassword(password);
	if (!check.valid) throw new Error(check.message);

	const masterKey = await generateMasterKey();
	let rawMasterKey;
	let passwordMeta;
	let webauthnMeta = null;
	let biometricSuccess = false;
	try {
		rawMasterKey = await crypto.subtle.exportKey("raw", masterKey);
		passwordMeta = await wrapKeyWithPassword(rawMasterKey, password);
		if (enableBiometric && isWebAuthnAvailable()) {
			try {
				webauthnMeta = await registerWebAuthnPrf(rawMasterKey);
				biometricSuccess = true;
			} catch (e) {
				console.warn("生体認証の登録に失敗しました（パスワード暗号化で継続します）:", e);
			}
		}
	} finally {
		if (rawMasterKey) new Uint8Array(rawMasterKey).fill(0);
	}

	const meta = {
		isEncrypted: true,
		version: STORAGE_FORMAT,
		storageFormat: STORAGE_FORMAT,
		createdAt: new Date().toISOString(),
		password: passwordMeta,
		webauthn: webauthnMeta
	};
	const data = [
		typeof currentDistrict === 'undefined' ? { district: '', officers: [], neighborhood: [], students: [] } : currentDistrict,
		typeof repState === 'undefined' ? { districts: [], szExternals: [] } : repState,
		typeof neighborState === 'undefined' ? { district: '', neighborhood: [] } : neighborState,
		typeof transferState === 'undefined' ? { children: [], memo: '' } : transferState
	];
	const encoded = [];
	for (let i = 0; i < data.length; i++) encoded.push(await encryptStorageValue(JSON.stringify(data[i]), masterKey, STORAGE_DATA_KEYS[i]));
	assertStorageContext(generation, authSnapshot);
	const metaRaw = JSON.stringify(meta);
	writeStorageTransaction([...STORAGE_DATA_KEYS.map((key, index) => [key, encoded[index]]), [STORAGE_AUTH_KEY, metaRaw]]);
	storageSessionGeneration++;
	activeStorageKey = masterKey;
	activeStorageAuthSnapshot = metaRaw;
	storageSecurityInvalidated = false;
	return { success: true, biometric: biometricSuccess };
}

async function setupStorageEncryption(password, enableBiometric = false) {
	return withStorageLock('exclusive', () => setupStorageEncryptionUnlocked(password, enableBiometric), true);
}

/**
 * 現在の暗号化設定に生体認証（WebAuthn PRF）を追加・更新登録します
 */
async function registerWebAuthnForActiveKeyUnlocked() {
	const generation = getStorageSessionGeneration();
	if (localStorage.getItem(STORAGE_AUTH_KEY) === null && !hasStorageCiphertext()) {
		invalidateStorageSession();
		throw new Error("ストレージの暗号化が設定されていません。");
	}
	if (!activeStorageSessionIsCurrent()) {
		throw new Error("ストレージがロックされているか未初期化です。");
	}
	const authSnapshot = activeStorageAuthSnapshot;
	const meta = requireStorageAuthMeta(authSnapshot);
	let rawMasterKey;
	let webauthnMeta;
	try {
		rawMasterKey = await crypto.subtle.exportKey("raw", activeStorageKey);
		webauthnMeta = await registerWebAuthnPrf(rawMasterKey);
	} finally {
		if (rawMasterKey) new Uint8Array(rawMasterKey).fill(0);
	}
	assertStorageContext(generation, authSnapshot);
	meta.webauthn = webauthnMeta;
	const nextAuth = JSON.stringify(meta);
	localStorage.setItem(STORAGE_AUTH_KEY, nextAuth);
	activeStorageAuthSnapshot = nextAuth;
	return true;
}

async function registerWebAuthnForActiveKey() {
	return withStorageLock('exclusive', registerWebAuthnForActiveKeyUnlocked, true);
}

/**
 * パスワードを入力してストレージの暗号化を解除します
 */
async function unlockStorageWithPasswordUnlocked(password) {
	const generation = getStorageSessionGeneration();
	const authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY);
	if (authSnapshot === null && !hasStorageCiphertext() && !storageSecurityInvalidated) return true;
	const meta = requireStorageAuthMeta(authSnapshot);
	const masterKey = await unwrapKeyWithPassword(meta.password, password);
	await activateStorageKey(masterKey, meta, authSnapshot, generation, password);
	return true;
}

async function unlockStorageWithPassword(password) {
	return withStorageLock('exclusive', () => unlockStorageWithPasswordUnlocked(password), true);
}

/**
 * 生体認証（WebAuthn）でストレージの暗号化を解除します
 */
async function unlockStorageWithWebAuthnUnlocked() {
	const generation = getStorageSessionGeneration();
	const authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY);
	if (authSnapshot === null && !hasStorageCiphertext() && !storageSecurityInvalidated) return true;
	const meta = requireStorageAuthMeta(authSnapshot);
	if (!meta.webauthn) {
		throw new Error("生体認証は登録されていません。パスワードで解除してください。");
	}
	const masterKey = await unwrapKeyWithWebAuthn(meta.webauthn);
	await activateStorageKey(masterKey, meta, authSnapshot, generation);
	return true;
}

async function unlockStorageWithWebAuthn() {
	return withStorageLock('exclusive', unlockStorageWithWebAuthnUnlocked, true);
}

/**
 * ストレージを再ロックします（メモリ内のアクティブ鍵をクリア）
 */
function lockStorage() {
	storageSessionGeneration++;
	activeStorageKey = null;
	activeStorageAuthSnapshot = null;
}

/**
 * ストレージの暗号化設定および保存データを全消去・初期化します
 */
function clearStorageSecurityUnlocked() {
	lockStorage();
	localStorage.removeItem(STORAGE_AUTH_KEY);
	STORAGE_DATA_KEYS.forEach(key => localStorage.removeItem(key));
	storageSecurityInvalidated = false;
}

async function clearStorageSecurity() {
	return withStorageLock('exclusive', clearStorageSecurityUnlocked);
}

/**
 * データをローカルストレージへ保存します（暗号化設定時は自動的にAES-GCMで暗号化）
 */
async function saveStorageDataUnlocked(storageKey, serialized) {
	if (!isStorageEncrypted()) {
		localStorage.setItem(storageKey, serialized);
		return true;
	}
	if (!activeStorageSessionIsCurrent()) {
		console.warn("Storage is encrypted but currently locked. Cannot write to:", storageKey);
		return false;
	}
	const generation = getStorageSessionGeneration();
	const authSnapshot = activeStorageAuthSnapshot;
	const key = activeStorageKey;
	try {
		const encoded = await encryptStorageValue(serialized, key, storageKey);
		assertStorageContext(generation, authSnapshot);
		localStorage.setItem(storageKey, encoded);
		return true;
	} catch (err) {
		console.error("saveStorageData failed:", err);
		if (err && err.message === 'STORAGE_SESSION_CHANGED') return false;
		throw err;
	}
}

async function saveStorageData(storageKey, dataObj) {
	const requestGeneration = getStorageSessionGeneration();
	const serialized = JSON.stringify(dataObj);
	return withStorageLock('exclusive', () => {
		if (requestGeneration !== getStorageSessionGeneration()) return false;
		return saveStorageDataUnlocked(storageKey, serialized);
	});
}

/**
 * ローカルストレージからデータを読み出し・復号します
 */
async function loadStorageDecryptedUnlocked(storageKey) {
	const raw = localStorage.getItem(storageKey);
	if (!raw) return null;
	if (!isStorageEncrypted()) {
		try {
			return JSON.parse(raw);
		} catch (e) {
			if (STORAGE_DATA_KEYS.includes(storageKey)) throw new Error('STORAGE_DATA_INVALID');
			return null;
		}
	}
	if (!activeStorageSessionIsCurrent()) throw new Error("STORAGE_LOCKED");
	const generation = getStorageSessionGeneration();
	const authSnapshot = activeStorageAuthSnapshot;
	const meta = requireStorageAuthMeta(authSnapshot);
	const value = await decryptStorageValue(raw, activeStorageKey, storageKey, meta.storageFormat);
	assertStorageContext(generation, authSnapshot);
	return value;
}

async function loadStorageDecrypted(storageKey) {
	return withStorageLock('shared', () => loadStorageDecryptedUnlocked(storageKey));
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		getStorageSessionGeneration,
		assertStorageSession,
		invalidateStorageSecurity,
		STORAGE_AUTH_KEY,
		WEBAUTHN_USER_ID,
		deriveKey,
		encryptPayload,
		decryptPayload,
		uint8ToBase64,
		base64ToUint8,
		parseTxtContent,
		isWebAuthnAvailable,
		getStorageAuthMeta,
		isStorageEncrypted,
		isStorageUnlocked,
		generateMasterKey,
		wrapKeyWithPassword,
		unwrapKeyWithPassword,
		registerWebAuthnPrf,
		unwrapKeyWithWebAuthn,
		setupStorageEncryption,
		registerWebAuthnForActiveKey,
		unlockStorageWithPassword,
		unlockStorageWithWebAuthn,
		lockStorage,
		clearStorageSecurity,
		saveStorageData,
		loadStorageDecrypted,
		get activeStorageKey() { return activeStorageKey; },
		set activeStorageKey(v) { activeStorageKey = v; }
	};
	Object.assign(global, module.exports);
}
