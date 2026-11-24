// 初期化時に有効化し、旧平文の読込移行と役員データの新規平文保存を分離する。
const officerStorageEncryptionRequired = new WeakSet();
function requireOfficerStorageEncryption() { officerStorageEncryptionRequired.add(localStorage); }
function officerPlaintextWriteDenied(storageKey) {
	return officerStorageEncryptionRequired.has(localStorage) && ['kogai_district_v2', 'kogai_rep_v2'].includes(storageKey) && !isStorageEncrypted();
}

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

// 保存前検証で拒否中のキー、書込を停止したキー（未暗号化の起動・読み直しで読めないキー、未暗号化の読込の反映の失敗、未暗号化の起動の予期しない失敗。I-12-07・I-16-03）、
// 照合の基準とする既知値（データキーごとの、自タブが最後に読んだ・書いた保存値。暗号文と平文。SEC-30・SEC-34・R-27・I-16-01）。
const storageSaveRejectedKeys = new Set();
const suspendedStorageKeys = new Set();
const knownStorageValues = new Map();
let pendingStorageSaveReport = null;
// 解除時の修復結果。解除後の世代と結び付け、直後の読込が一度だけ引き継ぐ（I-12-05）。
let activationRepairs = { generation: -1, repairs: [] };

function takeActivationRepairs() {
	const held = activationRepairs;
	activationRepairs = { generation: -1, repairs: [] };
	return held.generation === storageSessionGeneration ? held.repairs : [];
}

function getStorageSaveRejectedKeys() { return [...storageSaveRejectedKeys]; }
function getSuspendedStorageKeys() { return [...suspendedStorageKeys]; }
function isStorageWriteSuspended(storageKey) { return suspendedStorageKeys.has(storageKey); }

function markStorageSaveState(storageKey, rejected) {
	if (rejected) {
		if (storageSaveRejectedKeys.has(storageKey)) return;
		storageSaveRejectedKeys.add(storageKey);
		pendingStorageSaveReport = { addedKey: storageKey };
	} else if (storageSaveRejectedKeys.delete(storageKey) && !pendingStorageSaveReport) {
		pendingStorageSaveReport = { addedKey: null };
	}
}

/** 拒否状態の変化を、排他区間を抜けた後に画面へ伝える。 */
function flushStorageSaveReport(force = false) {
	const pending = pendingStorageSaveReport;
	pendingStorageSaveReport = null;
	if ((pending || force) && typeof reportStorageSaveState === 'function') reportStorageSaveState(getStorageSaveRejectedKeys(), pending ? pending.addedKey : null);
}

/** メモリ上の不合格値を既定値へ消去したときだけ拒否状態を解除する。 */
function clearStorageSaveRejections() {
	storageSaveRejectedKeys.clear();
	pendingStorageSaveReport = null;
	flushStorageSaveReport(true);
}

function suspendStorageWrites(keys) {
	for (const key of keys) suspendedStorageKeys.add(key);
	flushStorageSaveReport(true);
}

function resumeStorageWrites(keys) {
	let changed = false;
	for (const key of keys) changed = suspendedStorageKeys.delete(key) || changed;
	if (changed && !pendingStorageSaveReport) pendingStorageSaveReport = { addedKey: null };
}

function rememberKnownStorageValue(storageKey, value) {
	if (STORAGE_DATA_KEYS.includes(storageKey)) knownStorageValues.set(storageKey, value);
}

/**
 * 排他区間内で、他タブが自タブの知らない値を書いていないかを確認する（暗号化中は SEC-34、未暗号化は R-27・I-16-02）。
 * 既知値のないキーは、暗号化中は照合せず、未暗号化では拒否する（起動時の読込の前に、保存済みのデータを上書きしない。I-16-01）。
 */
function assertNoForeignStorageUpdate(storageKey) {
	// 照合するのは4つのデータキーだけとする（既知値も4つのデータキーだけを記録する）。
	if (!STORAGE_DATA_KEYS.includes(storageKey)) return;
	if (knownStorageValues.has(storageKey) ? localStorage.getItem(storageKey) === knownStorageValues.get(storageKey) : isStorageEncrypted()) return;
	const error = new Error('STORAGE_FOREIGN_UPDATE');
	error.code = 'STORAGE_FOREIGN_UPDATE';
	throw error;
}

function notifyForeignStorageUpdate() {
	if (typeof handleForeignStorageUpdate === 'function') handleForeignStorageUpdate();
}

function storageError(code, message) {
	const error = new Error(`${message} (${code})`);
	error.code = code;
	return error;
}

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

/** 見出し付きテキストから暗号文を線形時間で切り出す（SEC-32: 正規表現の二乗時間を避ける）。 */
function extractEncryptedPayload(text) {
	const start = text.indexOf('BEGIN_DATA:');
	if (start >= 0) {
		const bodyStart = start + 'BEGIN_DATA:'.length;
		const end = text.indexOf(':END_DATA', bodyStart);
		if (end >= 0) return text.slice(bodyStart, end).trim();
	}
	return text.trim();
}

/**
 * 読み込んだ.txtファイルの内容からJSONデータを抽出・復号します
 */
async function parseTxtContent(text, password, generation = getStorageSessionGeneration(), kind) {
	assertStorageSession(generation);
	if (new TextEncoder().encode(String(text)).byteLength > 8 * 1024 * 1024) throw new Error('ファイルサイズが上限を超えています。');
	const payload = extractEncryptedPayload(String(text));
	let jsonStr;
	try {
		jsonStr = await decryptPayload(payload, password);
	} catch (err) {
		assertStorageSession(generation);
		throw err;
	}
	assertStorageSession(generation);
	const data = JSON.parse(jsonStr);
	if (!kind) {
		validateImportStructure(data);
		return data;
	}
	if (kind === 'auto' || kind === 'districtOrNeighbor') {
		kind = kind === 'auto' && data?.isTransferData ? 'transfer'
			: kind === 'auto' && data?.districts !== undefined ? 'rep'
				: isNeighborhoodImportData(data) ? 'neighbor' : 'district';
	}
	const clean = validateImportData(data, kind);
	if (kind === 'district' || kind === 'rep') {
		// 端末ローカルの記憶パスワードはファイルから採用しない（SEC-33）。空の仮行を除き学年を検査する（QA-03）。
		delete clean.savedFilePassword;
		for (const district of kind === 'rep' ? clean.districts : [clean]) {
			delete district.savedFilePassword;
			normalizeImportedStudents(district);
		}
	}
	return clean;
}

function getStorageSessionGeneration() {
	return storageSessionGeneration;
}

function assertStorageSession(generation) {
	if (generation !== storageSessionGeneration || !isStorageUnlocked()) {
		throw new Error('STORAGE_SESSION_CHANGED');
	}
}

function captureStorageOutputGuard() {
	const generation = getStorageSessionGeneration();
	let authSnapshot;
	try { authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY); }
	catch (_) { return () => false; }
	return () => {
		try { return generation === getStorageSessionGeneration() && localStorage.getItem(STORAGE_AUTH_KEY) === authSnapshot; }
		catch (_) { return false; }
	};
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

function isValidWebAuthnMeta(value) {
	return !!value && typeof value === 'object' && !Array.isArray(value) &&
		['credentialId', 'prfSalt', 'iv', 'wrappedKey'].every(key => typeof value[key] === 'string' && value[key].length > 0);
}

function zeroBuffer(buffer) {
	if (!buffer) return;
	const view = ArrayBuffer.isView(buffer)
		? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
		: new Uint8Array(buffer);
	view.fill(0);
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
	if (!meta || meta.isEncrypted !== true || !isValidWrapMeta(meta.password) || (meta.webauthn != null && !isValidWebAuthnMeta(meta.webauthn))) throw new Error('STORAGE_AUTH_INVALID');
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
	try {
		const raw = localStorage.getItem(STORAGE_AUTH_KEY);
		return raw !== null || hasStorageCiphertext() || activeStorageAuthSnapshot !== null || storageSecurityInvalidated;
	} catch (_) {
		invalidateStorageSession();
		return true;
	}
}

/**
 * ストレージがロック解除状態（メモリ内にアクティブキーがある）か判定します
 */
function isStorageUnlocked() {
	if (!isStorageEncrypted()) return true;
	try { return activeStorageSessionIsCurrent(); }
	catch (_) { invalidateStorageSession(); return false; }
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

	try {
		const prfWrapKey = await crypto.subtle.importKey("raw", prfResult, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, prfWrapKey, rawMasterKey);

		return {
			credentialId: uint8ToBase64(new Uint8Array(credential.rawId)),
			prfSalt: uint8ToBase64(prfSalt),
			iv: uint8ToBase64(iv),
			wrappedKey: uint8ToBase64(new Uint8Array(cipherBuf))
		};
	} finally {
		zeroBuffer(prfResult);
	}
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

	let rawMasterBuf;
	try {
		const prfWrapKey = await crypto.subtle.importKey("raw", prfResult, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
		rawMasterBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, prfWrapKey, wrappedBytes);
		return await crypto.subtle.importKey("raw", rawMasterBuf, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
	} finally {
		zeroBuffer(prfResult);
		zeroBuffer(rawMasterBuf);
	}
}

function assertStorageContext(generation, authSnapshot) {
	if (generation !== storageSessionGeneration) throw new Error('STORAGE_SESSION_CHANGED');
	if (localStorage.getItem(STORAGE_AUTH_KEY) !== authSnapshot) {
		invalidateStorageSession();
		throw new Error('STORAGE_SESSION_CHANGED');
	}
}

function validateStorageModel(value, storageKey, options = {}) {
	if (typeof validateStoredData === 'function') return validateStoredData(value, storageKey, options);
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
	for (const [key, value] of entries) rememberKnownStorageValue(key, value);
}

async function activateStorageKey(masterKey, meta, authSnapshot, generation, password, guard = () => {}) {
	guard();
	assertStorageContext(generation, authSnapshot);
	const values = [];
	const raws = [];
	const repairs = [];
	for (const key of STORAGE_DATA_KEYS) {
		const raw = localStorage.getItem(key);
		if (!raw || !raw.startsWith(LEGACY_STORAGE_PREFIX)) throw new Error('STORAGE_DATA_MISSING');
		const value = await decryptStorageValue(raw, masterKey, key, meta.storageFormat);
		// 旧版の保存値は複製上で修復して受け入れる（I-12-05）。形式移行時は修復済み値を書く。
		values.push(validateStorageModel(value, key, { repair: true, repairs }));
		raws.push(raw);
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
	guard();
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
	STORAGE_DATA_KEYS.forEach((key, index) => rememberKnownStorageValue(key, encoded.length ? encoded[index] : raws[index]));
	activationRepairs = { generation: storageSessionGeneration, repairs: [...new Set(repairs)] };
	return values;
}

/**
 * ストレージ暗号化を初期化・設定します（パスワード必須、生体認証は任意）
 */
async function setupStorageEncryptionUnlocked(password, enableBiometric = false, guard = () => {}) {
	guard();
	const generation = getStorageSessionGeneration();
	const authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY);
	if (isStorageEncrypted() && !activeStorageSessionIsCurrent()) throw new Error('STORAGE_LOCKED');
	const check = validatePassword(password);
	if (!check.valid) throw new Error(check.message);
	if (suspendedStorageKeys.size) throw storageError('STORAGE_WRITES_SUSPENDED', '保存を停止しているモードがあるため、端末暗号化を設定できません。全消去してから再試行してください。');
	// メモリの内容を暗号化して書くため、他タブの書込みの後では設定しない（暗号化中の再設定を含む。I-16-02）。
	STORAGE_DATA_KEYS.forEach(assertNoForeignStorageUpdate);
	// 鍵生成・認証器登録より前に一度だけ直列化し、その内容を検証・暗号化の双方に使う（I-12-02）。
	const serialized = [
		typeof currentDistrict === 'undefined' ? { district: '', officers: [], neighborhood: [], students: [] } : currentDistrict,
		typeof repState === 'undefined' ? { districts: [], szExternals: [] } : repState,
		typeof neighborState === 'undefined' ? { district: '', neighborhood: [] } : neighborState,
		typeof transferState === 'undefined' ? { children: [], memo: '' } : transferState
	].map(model => JSON.stringify(model));
	try {
		serialized.forEach((text, index) => validateStorageModel(JSON.parse(text), STORAGE_DATA_KEYS[index]));
	} catch (_) {
		throw storageError('STORAGE_SAVE_REJECTED', '端末に保存できない内容があります。直前の変更を元に戻してから再試行してください。');
	}

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
	const encoded = [];
	for (let i = 0; i < serialized.length; i++) encoded.push(await encryptStorageValue(serialized[i], masterKey, STORAGE_DATA_KEYS[i]));
	assertStorageContext(generation, authSnapshot);
	guard();
	STORAGE_DATA_KEYS.forEach(assertNoForeignStorageUpdate);
	const metaRaw = JSON.stringify(meta);
	writeStorageTransaction([...STORAGE_DATA_KEYS.map((key, index) => [key, encoded[index]]), [STORAGE_AUTH_KEY, metaRaw]]);
	STORAGE_DATA_KEYS.forEach(key => markStorageSaveState(key, false));
	storageSessionGeneration++;
	activeStorageKey = masterKey;
	activeStorageAuthSnapshot = metaRaw;
	storageSecurityInvalidated = false;
	return { success: true, biometric: biometricSuccess };
}

async function setupStorageEncryption(password, enableBiometric = false, guard) {
	try {
		return await withStorageLock('exclusive', () => setupStorageEncryptionUnlocked(password, enableBiometric, guard), true);
	} catch (error) {
		if (error && error.code === 'STORAGE_FOREIGN_UPDATE') {
			flushStorageSaveReport();
			notifyForeignStorageUpdate();
			throw new Error('STORAGE_SESSION_CHANGED');
		}
		throw error;
	} finally {
		flushStorageSaveReport();
	}
}

/**
 * 現在の暗号化設定に生体認証（WebAuthn PRF）を追加・更新登録します
 */
async function registerWebAuthnForActiveKeyUnlocked(guard = () => {}) {
	guard();
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
		zeroBuffer(rawMasterKey);
	}
	guard();
	assertStorageContext(generation, authSnapshot);
	meta.webauthn = webauthnMeta;
	const nextAuth = JSON.stringify(meta);
	localStorage.setItem(STORAGE_AUTH_KEY, nextAuth);
	activeStorageAuthSnapshot = nextAuth;
	return true;
}

async function registerWebAuthnForActiveKey(guard = () => {}) {
	return withStorageLock('exclusive', () => registerWebAuthnForActiveKeyUnlocked(guard), true);
}

/**
 * パスワードを入力してストレージの暗号化を解除します
 */
async function unlockStorageWithPasswordUnlocked(password, guard = () => {}) {
	guard();
	const generation = getStorageSessionGeneration();
	const authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY);
	if (authSnapshot === null && !hasStorageCiphertext() && !storageSecurityInvalidated) return true;
	const meta = requireStorageAuthMeta(authSnapshot);
	const masterKey = await unwrapKeyWithPassword(meta.password, password);
	await activateStorageKey(masterKey, meta, authSnapshot, generation, password, guard);
	return true;
}

async function unlockStorageWithPassword(password, guard) {
	return withStorageLock('exclusive', () => unlockStorageWithPasswordUnlocked(password, guard), true);
}

/**
 * 生体認証（WebAuthn）でストレージの暗号化を解除します
 */
async function unlockStorageWithWebAuthnUnlocked(guard = () => {}) {
	guard();
	const generation = getStorageSessionGeneration();
	const authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY);
	if (authSnapshot === null && !hasStorageCiphertext() && !storageSecurityInvalidated) return true;
	const meta = requireStorageAuthMeta(authSnapshot);
	if (!meta.webauthn) {
		throw new Error("生体認証は登録されていません。パスワードで解除してください。");
	}
	const masterKey = await unwrapKeyWithWebAuthn(meta.webauthn);
	await activateStorageKey(masterKey, meta, authSnapshot, generation, undefined, guard);
	return true;
}

async function unlockStorageWithWebAuthn(guard) {
	return withStorageLock('exclusive', () => unlockStorageWithWebAuthnUnlocked(guard), true);
}

/**
 * ストレージを再ロックします（メモリ内のアクティブ鍵をクリア）
 */
function lockStorage() {
	// 既知値を空にするのは暗号化中だけとする（未暗号化のときに空にすると、次の読み直しまでの保存が照合なしで通る。I-16-01）。
	const encrypted = isStorageEncrypted();
	storageSessionGeneration++;
	activeStorageKey = null;
	activeStorageAuthSnapshot = null;
	if (encrypted) knownStorageValues.clear();
	activationRepairs = { generation: -1, repairs: [] };
}

/**
 * ストレージの暗号化設定および保存データを全消去・初期化します
 */
function clearStorageSecurityUnlocked() {
	lockStorage();
	localStorage.removeItem(STORAGE_AUTH_KEY);
	STORAGE_DATA_KEYS.forEach(key => localStorage.removeItem(key));
	// 全消去の後は、保存値がないことを既知値とする（I-16-01）。
	STORAGE_DATA_KEYS.forEach(key => knownStorageValues.set(key, null));
	storageSecurityInvalidated = false;
	suspendedStorageKeys.clear();
	storageSaveRejectedKeys.clear();
	pendingStorageSaveReport = { addedKey: null };
}

async function clearStorageSecurity() {
	try {
		return await withStorageLock('exclusive', clearStorageSecurityUnlocked);
	} finally {
		flushStorageSaveReport();
	}
}

/**
 * データをローカルストレージへ保存します（暗号化設定時は自動的にAES-GCMで暗号化）
 */
async function saveStorageDataUnlocked(storageKey, serialized, options = {}) {
	// 旧シグネチャの真偽値で保存前検証を黙って飛ばさない（I-12-02）。
	if (options === null || typeof options !== 'object') throw new TypeError('saveStorageDataUnlocked options must be an object');
	if (!isStorageEncrypted()) {
		if (officerPlaintextWriteDenied(storageKey)) return false;
		if (suspendedStorageKeys.has(storageKey) && !options.allowSuspended) return false;
		// 照合から書込みまでに await を置かない（Web Locks がないときも、ほかのタスクを間に入れない。I-16-02）。
		assertNoForeignStorageUpdate(storageKey);
		if (options.validate && !acceptStorageSerialized(storageKey, serialized)) return false;
		localStorage.setItem(storageKey, serialized);
		rememberKnownStorageValue(storageKey, serialized);
		markStorageSaveState(storageKey, false);
		return true;
	}
	if (!activeStorageSessionIsCurrent()) {
		console.warn("Storage is encrypted but currently locked. Cannot write to:", storageKey);
		return false;
	}
	if (suspendedStorageKeys.has(storageKey) && !options.allowSuspended) return false;
	assertNoForeignStorageUpdate(storageKey);
	if (options.validate && !acceptStorageSerialized(storageKey, serialized)) return false;
	const generation = getStorageSessionGeneration();
	const authSnapshot = activeStorageAuthSnapshot;
	const key = activeStorageKey;
	try {
		const encoded = await encryptStorageValue(serialized, key, storageKey);
		assertStorageContext(generation, authSnapshot);
		localStorage.setItem(storageKey, encoded);
		rememberKnownStorageValue(storageKey, encoded);
		markStorageSaveState(storageKey, false);
		return true;
	} catch (err) {
		console.error("saveStorageData failed:", err);
		if (err && err.message === 'STORAGE_SESSION_CHANGED') return false;
		throw err;
	}
}

/** 解除時と同じ厳格検証に合格した値だけを保存させる（SEC-30）。 */
function acceptStorageSerialized(storageKey, serialized) {
	// 解除時に一括検証されるのは4つのデータキーだけである。
	if (!STORAGE_DATA_KEYS.includes(storageKey)) return true;
	try {
		validateStorageModel(JSON.parse(serialized), storageKey);
		return true;
	} catch (error) {
		console.error('Refused to store a value that unlock-time validation rejects:', storageKey, error);
		markStorageSaveState(storageKey, true);
		return false;
	}
}

async function saveStorageData(storageKey, dataObj) {
	const requestGeneration = getStorageSessionGeneration();
	const serialized = JSON.stringify(dataObj);
	try {
		return await withStorageLock('exclusive', () => {
			if (requestGeneration !== getStorageSessionGeneration()) return false;
			return saveStorageDataUnlocked(storageKey, serialized, { validate: true });
		});
	} catch (error) {
		if (error && error.code === 'STORAGE_FOREIGN_UPDATE') {
			flushStorageSaveReport();
			notifyForeignStorageUpdate();
			return false;
		}
		throw error;
	} finally {
		flushStorageSaveReport();
	}
}

/** 取込候補を検証・保存してから呼出元へ返す。本状態とDOMは保存完了前に変更しない。 */
async function commitImportedModel(storageKey, model, generation = getStorageSessionGeneration(), options = {}) {
	assertStorageSession(generation);
	const clean = validateStorageModel(model, storageKey);
	try {
		return await withStorageLock('exclusive', async () => {
			assertStorageSession(generation);
			if (!isStorageEncrypted()) delete clean.savedFilePassword;
			if (suspendedStorageKeys.has(storageKey) && !options.replace) {
				const suspended = new Error('保存を停止しているため読み込みを中止しました。全消去するか、正しいデータを復元してください。');
				suspended.code = 'IMPORT_SAVE_FAILED';
				throw suspended;
			}
			let saved;
			try { saved = await saveStorageDataUnlocked(storageKey, JSON.stringify(clean), { allowSuspended: !!options.replace }); }
			catch (error) {
				if (error && error.code === 'STORAGE_FOREIGN_UPDATE') throw error;
				const failure = new Error('端末への保存に失敗したため、読み込みを中止しました。空き容量を確認して再試行してください。');
				failure.code = 'IMPORT_SAVE_FAILED';
				throw failure;
			}
			if (saved === false) throw new Error('STORAGE_SESSION_CHANGED');
			assertStorageSession(generation);
			if (options.replace) resumeStorageWrites([storageKey]);
			// 復号/保存待ちの古い取込・自動保存に今回の確定結果を上書きさせない。
			storageSessionGeneration++;
			return { model: clean, generation: getStorageSessionGeneration() };
		});
	} catch (error) {
		if (error && error.code === 'STORAGE_FOREIGN_UPDATE') {
			flushStorageSaveReport();
			notifyForeignStorageUpdate();
			throw new Error('STORAGE_SESSION_CHANGED');
		}
		throw error;
	} finally {
		flushStorageSaveReport();
	}
}

function adoptImportedModel(result) {
	assertStorageSession(result.generation);
	return result.model;
}

const DEFAULT_SZ_EXTERNAL_ROWS = [
	{ category: "学校関係者", org: "小学校", role: "校長" },
	{ category: "学校関係者", org: "小学校", role: "副校長" },
	{ category: "PTA本部", org: "PTA本部", role: "会長" },
	{ category: "役所・警察・関係機関", org: "区役所 地域振興課", role: "担当" },
	{ category: "役所・警察・関係機関", org: "土木事務所", role: "担当" },
	{ category: "役所・警察・関係機関", org: "警察署 交通課", role: "担当" }
];
const HATA_DEFAULT_TEXTS = {
	title: ['', '登校見守り活動シフト表'],
	scheduleTitle: ['', '登校見守り活動シフト表'],
	time: ['', '7:55 〜 8:25', '7:45〜8:15'],
	metaTime: ['', '7:55 〜 8:25', '7:45〜8:15'],
	headerMsg: ['', '※雨天時も原則実施します。ご協力をお願いいたします。'],
	metaHeaderMsg: ['', '※雨天時も原則実施します。ご協力をお願いいたします。'],
	footerMsg: ['', '※都合がつかない場合は、各自で他の担当者と交代してください。'],
	metaFooterMsg: ['', '※都合がつかない場合は、各自で他の担当者と交代してください。'],
	format: ['', '{住所数字} {苗字}']
};

function isDefaultHolidayValue(h) {
	if (!h.holidays || (Array.isArray(h.holidays) && h.holidays.length === 0)) return true;
	const serialized = Array.isArray(h.holidays)
		? h.holidays.map(x => x && x.date ? `${x.date},${x.name || ''}` : '').join('\n')
		: String(h.holidays);
	const nowYr = new Date().getFullYear();
	const years = h.startDate && /^\d{4}/.test(String(h.startDate))
		? [parseInt(String(h.startDate).slice(0, 4), 10), nowYr]
		: [nowYr, nowYr - 1, nowYr + 1];
	return years.some(yr => yr >= 2000 && yr <= 2099 && serialized === generateJapaneseHolidays(yr, Math.min(yr + 1, 2099)).map(x => `${x.date},${x.name}`).join('\n'));
}

function isDefaultStartEndDates(h) {
	const start = h.startDate || '';
	const end = h.endDate || '';
	if (!start && !end) return true;
	const nowYr = new Date().getFullYear();
	return [nowYr - 1, nowYr, nowYr + 1].some(yr => {
		const preset = getPeriodPresetDates('zenki', yr);
		return start === preset.startDate && end === preset.endDate;
	});
}

function isNonEmptyHata(h) {
	if (!h || typeof h !== 'object') return false;
	const mem = h.members;
	if (Array.isArray(mem) ? mem.some(m => String(m || '').trim() !== '') : String(mem || '').trim() !== '') return true;
	if (['district', 'location', 'contactMsg', 'specials', 'metaLocation', 'metaContactMsg', 'metaCreatedDate', 'scheduleCreatedDate'].some(k => String(h[k] || '').trim() !== '')) return true;
	if (['exemptHouseholds', 'schedule'].some(k => Array.isArray(h[k]) && h[k].length > 0)) return true;
	if (h.manualOverrides && Object.keys(h.manualOverrides).length > 0) return true;
	if (h.inputDrafts && Object.values(h.inputDrafts).some(v => String(v || '') !== '')) return true;
	if (['orientation', 'metaOrientation'].some(k => h[k] && h[k] !== 'portrait')) return true;
	if (['layoutColumns', 'metaLayoutColumns'].some(k => h[k] && String(h[k]) !== '2')) return true;
	if (h.weekdays && (!Array.isArray(h.weekdays) || h.weekdays.length !== 5 || [1, 2, 3, 4, 5].some((d, i) => h.weekdays[i] !== d))) return true;
	if (h.dedup === false) return true;
	if (Object.entries(HATA_DEFAULT_TEXTS).some(([k, allowed]) => h[k] !== undefined && !allowed.includes(String(h[k])))) return true;
	if (h.createdDate && !/^作成日：\d{4}年\d{1,2}月\d{1,2}日$/.test(String(h.createdDate))) return true;
	return !isDefaultStartEndDates(h) || !isDefaultHolidayValue(h);
}

function isNonEmptyDistrictSingleRow(row, defaultRole) {
	if (row.role && row.role !== defaultRole) return true;
	return Object.entries(row).some(([k, v]) => k !== 'role' && (typeof v === 'boolean' ? v : String(v || '').trim() !== ''));
}

function isNonEmptyStudentSingleRow(row) {
	if (row.isOutOfDistrict) return true;
	const g = row.grade || '';
	const c = row.class || '';
	if (!((g === '6' && c === '1') || (g === '1' && c === '') || (!g && !c))) return true;
	return Object.entries(row).some(([k, v]) => k !== 'grade' && k !== 'class' && k !== 'isOutOfDistrict' && String(v || '').trim() !== '');
}

const SEAT_DEFAULT_LABELS = {
	leftSide: ['', '窓側'],
	rightSide: ['', '廊下側'],
	topLabel: ['', '前方（演台・司会・スクリーン側）', '前方'],
	bottomLabel: ['', '後方（出入口側）', '後方']
};

function hasOfficerData(modelKey, value) {
	if (!value || typeof value !== 'object') return false;
	if (modelKey === 'kogai_district_v2') {
		if (String(value.district || '').trim() !== '' || String(value.han || '').trim() !== '' || String(value.savedFilePassword || '') !== '') return true;
		if (Array.isArray(value.hanList) && value.hanList.some(h => String(h || '').trim() !== '')) return true;
		if (value.officer != null || value.hatafurotto != null || value.szNeighborChecks != null || value.selectedForPrint === false) return true;
		if (Array.isArray(value.officers) && (value.officers.length > 1 || (value.officers[0] && isNonEmptyDistrictSingleRow(value.officers[0], '校外委員')))) return true;
		if (Array.isArray(value.neighborhood) && (value.neighborhood.length > 1 || (value.neighborhood[0] && isNonEmptyDistrictSingleRow(value.neighborhood[0], '会長')))) return true;
		if (Array.isArray(value.students) && (value.students.length > 1 || (value.students[0] && isNonEmptyStudentSingleRow(value.students[0])))) return true;
		return isNonEmptyHata(value.hata);
	}
	if (modelKey !== 'kogai_rep_v2') return false;
	if (Array.isArray(value.districts) && value.districts.length > 0) return true;
	if (Array.isArray(value.szExternals) && value.szExternals.length > 0) {
		if (value.szExternals.length !== DEFAULT_SZ_EXTERNAL_ROWS.length) return true;
		const changed = value.szExternals.some((row, i) => {
			const tpl = DEFAULT_SZ_EXTERNAL_ROWS[i];
			if (!row || row.attend !== true || (row.category || '') !== tpl.category || (row.org || '') !== tpl.org || (row.role || '') !== tpl.role) return true;
			return Object.entries(row).some(([k, v]) => !['attend', 'category', 'org', 'role'].includes(k) && (typeof v === 'boolean' ? v : String(v || '').trim() !== ''));
		});
		if (changed) return true;
	}
	if (value.seatConfig != null) {
		const cfg = value.seatConfig;
		if ((cfg.cols != null && Number(cfg.cols) !== 4) || (cfg.rows != null && Number(cfg.rows) !== 5)) return true;
		if (Object.entries(SEAT_DEFAULT_LABELS).some(([k, allowed]) => cfg[k] !== undefined && !allowed.includes(cfg[k]))) return true;
		if (cfg.cells && Object.keys(cfg.cells).length > 0) return true;
	}
	return false;
}

function hasNonEmptyOfficerModels(models) {
	if (!Array.isArray(models)) return false;
	return hasOfficerData('kogai_district_v2', models[0]) || hasOfficerData('kogai_rep_v2', models[1]);
}

/** 全モードのブラウザ引き継ぎを、保存方式を維持して一括確定する。 */
async function replaceStoredAppData(models, guard = () => {}) {
	const generation = getStorageSessionGeneration();
	const values = STORAGE_DATA_KEYS.map((key, index) => validateStorageModel(models[index], key));
	try {
		return await withStorageLock('exclusive', async () => {
			assertStorageSession(generation);
			guard();
			const authSnapshot = localStorage.getItem(STORAGE_AUTH_KEY);
			const encrypted = isStorageEncrypted();
			const plaintextOfficerDenied = officerPlaintextWriteDenied('kogai_district_v2');
			const officerModels = hasNonEmptyOfficerModels(models) || hasNonEmptyOfficerModels(values);
			if (plaintextOfficerDenied && officerModels) {
				throw new Error('STORAGE_ENCRYPTION_REQUIRED');
			}
			// 役員の名簿データを含まない引き継ぎは、復元先の地区・代表を保持する（QA-01）。
			const targetIndices = officerModels ? [0, 1, 2, 3] : [2, 3];
			const replacedKeys = targetIndices.map(index => STORAGE_DATA_KEYS[index]);
			// 暗号化の有無によらず照合する（I-16-02）。
			replacedKeys.forEach(assertNoForeignStorageUpdate);
			const key = activeStorageKey;
			const entries = [];
			for (const index of targetIndices) {
				const serialized = JSON.stringify(values[index]);
				const encoded = encrypted ? await encryptStorageValue(serialized, key, STORAGE_DATA_KEYS[index]) : serialized;
				assertStorageContext(generation, authSnapshot);
				entries.push([STORAGE_DATA_KEYS[index], encoded]);
			}
			guard();
			replacedKeys.forEach(assertNoForeignStorageUpdate);
			writeStorageTransaction(entries);
			replacedKeys.forEach(storageKey => markStorageSaveState(storageKey, false));
			resumeStorageWrites(replacedKeys);
			storageSessionGeneration++;
			return { models: values, generation: getStorageSessionGeneration(), replacedKeys };
		});
	} catch (error) {
		if (error && error.code === 'STORAGE_FOREIGN_UPDATE') {
			flushStorageSaveReport();
			notifyForeignStorageUpdate();
			throw new Error('STORAGE_SESSION_CHANGED');
		}
		throw error;
	} finally {
		flushStorageSaveReport();
	}
}

/**
 * ローカルストレージからデータを読み出し・復号します
 */
async function loadStorageDecryptedUnlocked(storageKey) {
	const raw = localStorage.getItem(storageKey);
	if (!isStorageEncrypted()) {
		if (!raw) return null;
		try {
			return JSON.parse(raw);
		} catch (e) {
			if (STORAGE_DATA_KEYS.includes(storageKey)) throw new Error('STORAGE_DATA_INVALID');
			return null;
		}
	}
	if (!activeStorageSessionIsCurrent()) throw new Error("STORAGE_LOCKED");
	if (!raw) {
		if (STORAGE_DATA_KEYS.includes(storageKey)) throw new Error('STORAGE_DATA_MISSING');
		return null;
	}
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

/** 処理の世代だけを進める（既知値は変えない。他タブの書込みの後の読み直しの前に、古い保存・取込・出力を止める。I-16-03）。 */
function advanceStorageSessionGeneration() {
	storageSessionGeneration++;
	return storageSessionGeneration;
}

/**
 * 未暗号化の読込（起動時と読み直し。I-16-03）。1つの排他区間の中で、4つのデータキーを読み、反映の関数（apply）を同期で呼び、
 * 例外がなければ読んだ値を既知値として記録して世代を進める。暗号化中なら読まずに false、generation が今の世代と異なれば
 * STORAGE_SESSION_CHANGED を送出する。読んで反映したら true を返す。
 * 反映の関数の例外（予期しない失敗）では、メモリと世代を変えないまま、メモリの元の値（既知値。ないときは null。起動の前のメモリは
 * js/state.js の初期値で、保存値がないことに当たる）と読んだ値が異なるキーの保存を停止し、4つのキーの読んだ値を既知値として
 * 記録してから送出する（古いメモリで保存値を上書きせず、停止しないキーは保存でき、停止中のキーは置換の取込・復元で解ける。I-16-03）。
 */
async function loadUnencryptedStorage(generation, apply) {
	if (isStorageEncrypted()) return false;
	return withStorageLock('exclusive', () => {
		if (isStorageEncrypted()) return false;
		if (generation !== storageSessionGeneration) throw new Error('STORAGE_SESSION_CHANGED');
		const raw = Object.fromEntries(STORAGE_DATA_KEYS.map(key => [key, localStorage.getItem(key)]));
		try {
			apply(raw);
		} catch (error) {
			suspendStorageWrites(STORAGE_DATA_KEYS.filter(key => raw[key] !== (knownStorageValues.has(key) ? knownStorageValues.get(key) : null)));
			for (const key of STORAGE_DATA_KEYS) knownStorageValues.set(key, raw[key]);
			throw error;
		}
		for (const key of STORAGE_DATA_KEYS) knownStorageValues.set(key, raw[key]);
		storageSessionGeneration++;
		return true;
	});
}

/**
 * 起動時の未暗号化の読込が反映の関数の外で失敗したとき（排他区間の要求の失敗など。I-16-03）、既知値のないキーに今の保存値を
 * 記録する（保存値のないモードを保存でき、停止中のキーを置換の取込・復元で解けるようにする）。既知値のあるキーは変えない
 * （記録の後の他タブの書込みを、照合で見つけられるようにする）。暗号化中の既知値は、解除が4つのキーについて記録し直す。
 */
function rememberUnreflectedStorageValues() {
	for (const key of STORAGE_DATA_KEYS) if (!knownStorageValues.has(key)) knownStorageValues.set(key, localStorage.getItem(key));
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		captureStorageOutputGuard,
		getStorageSessionGeneration,
		commitImportedModel, adoptImportedModel,
		assertStorageSession,
		invalidateStorageSecurity,
		STORAGE_AUTH_KEY,
		STORAGE_DATA_KEYS,
		WEBAUTHN_USER_ID,
		deriveKey,
		requireOfficerStorageEncryption, officerPlaintextWriteDenied,
		hasOfficerData, hasNonEmptyOfficerModels, isDefaultHolidayValue,
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
		loadUnencryptedStorage, advanceStorageSessionGeneration, rememberUnreflectedStorageValues,
		replaceStoredAppData,
		validateStorageModel, extractEncryptedPayload,
		getStorageSaveRejectedKeys, getSuspendedStorageKeys, isStorageWriteSuspended,
		suspendStorageWrites, resumeStorageWrites, clearStorageSaveRejections, saveStorageDataUnlocked, takeActivationRepairs,
		get activeStorageKey() { return activeStorageKey; },
		set activeStorageKey(v) { activeStorageKey = v; }
	};
	Object.assign(global, module.exports);
}
