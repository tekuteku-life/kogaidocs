/* =========================================================================
   暗号化・復号（AES-GCM + PBKDF2 + WebAuthn PRF + Base64）
========================================================================= */

let activeStorageKey = null;
const STORAGE_AUTH_KEY = 'kogai_auth_meta';

/**
 * パスワードとソルトからAES-GCM用の暗号鍵を導出します（PBKDF2 10万回）
 */
async function deriveKey(password, salt) {
	const enc = new TextEncoder();
	const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey(
		{ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
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
	return "ENC:" + uint8ToBase64(combined);
}

/**
 * 暗号化された文字列データを復号します（提出用.txtファイル用）
 */
async function decryptPayload(payloadStr, password) {
	const dec = new TextDecoder();
	const b64 = payloadStr.startsWith("ENC:") ? payloadStr.slice(4) : payloadStr;
	const combined = base64ToUint8(b64);
	if (combined.length < 44) {
		throw new Error("暗号化データの形式が不正です（データ長不足）。");
	}
	const salt = combined.slice(0, 16);
	const iv = combined.slice(16, 28);
	const cipherBytes = combined.slice(28);
	const key = await deriveKey(password, salt);
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
async function parseTxtContent(text, password) {
	const match = text.match(/BEGIN_DATA:\s*([\s\S]+?)\s*:END_DATA/);
	const payload = match ? match[1].trim() : text.trim();
	const jsonStr = await decryptPayload(payload, password);
	return JSON.parse(jsonStr);
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

/**
 * ストレージが暗号化設定されているか判定します
 */
function isStorageEncrypted() {
	const meta = getStorageAuthMeta();
	return !!(meta && meta.isEncrypted);
}

/**
 * ストレージがロック解除状態（メモリ内にアクティブキーがある）か判定します
 */
function isStorageUnlocked() {
	if (!isStorageEncrypted()) return true;
	return activeStorageKey !== null;
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
async function wrapKeyWithPassword(rawMasterKey, password, saltBytes) {
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
		{ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
	const cipherBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrapKey, rawMasterKey);
	return {
		salt: uint8ToBase64(salt),
		iv: uint8ToBase64(iv),
		wrappedKey: uint8ToBase64(new Uint8Array(cipherBuf))
	};
}

/**
 * パスワードからマスターキーを復号（アンラップ）します
 */
async function unwrapKeyWithPassword(passwordWrapMeta, password) {
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
		{ name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
		keyMaterial,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
	const rawMasterBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, wrapKey, wrappedBytes);
	const importedKey = await crypto.subtle.importKey("raw", rawMasterBuf, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
	new Uint8Array(rawMasterBuf).fill(0);
	return importedKey;
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
	const userId = crypto.getRandomValues(new Uint8Array(16));

	const createOptions = {
		publicKey: {
			challenge,
			rp: { name: "kogaidocs - 校外委員名簿管理システム" },
			user: {
				id: userId,
				name: "kogaidocs",
				displayName: "校外委員会役員"
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
	const importedKey = await crypto.subtle.importKey("raw", rawMasterBuf, { name: "AES-GCM" }, true, ["encrypt", "decrypt"]);
	new Uint8Array(rawMasterBuf).fill(0);
	return importedKey;
}

/**
 * ストレージ暗号化を初期化・設定します（パスワード必須、生体認証は任意）
 */
async function setupStorageEncryption(password, enableBiometric = false) {
	const check = validatePassword(password);
	if (!check.valid) {
		throw new Error(check.message);
	}

	const masterKey = await generateMasterKey();
	const rawMasterKey = await crypto.subtle.exportKey("raw", masterKey);
	const passwordMeta = await wrapKeyWithPassword(rawMasterKey, password);

	let webauthnMeta = null;
	let biometricSuccess = false;
	if (enableBiometric && isWebAuthnAvailable()) {
		try {
			webauthnMeta = await registerWebAuthnPrf(rawMasterKey);
			biometricSuccess = true;
		} catch (e) {
			console.warn("生体認証の登録に失敗しました（パスワード暗号化で継続します）:", e);
		}
	}
	new Uint8Array(rawMasterKey).fill(0);

	const meta = {
		isEncrypted: true,
		version: 1,
		createdAt: new Date().toISOString(),
		password: passwordMeta,
		webauthn: webauthnMeta
	};

	localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(meta));
	activeStorageKey = masterKey;

	// 既存データを暗号化して保存
	if (typeof currentDistrict !== 'undefined') {
		await saveStorageData('kogai_district_v2', currentDistrict);
	}
	if (typeof repState !== 'undefined') {
		await saveStorageData('kogai_rep_v2', repState);
	}
	if (typeof neighborState !== 'undefined') {
		await saveStorageData('kogai_neighbor_v2', neighborState);
	}

	return { success: true, biometric: biometricSuccess };
}

/**
 * 現在の暗号化設定に生体認証（WebAuthn PRF）を追加・更新登録します
 */
async function registerWebAuthnForActiveKey() {
	if (!activeStorageKey) {
		throw new Error("ストレージがロックされているか未初期化です。");
	}
	const meta = getStorageAuthMeta();
	if (!meta || !meta.isEncrypted) {
		throw new Error("ストレージの暗号化が設定されていません。");
	}
	const rawMasterKey = await crypto.subtle.exportKey("raw", activeStorageKey);
	const webauthnMeta = await registerWebAuthnPrf(rawMasterKey);
	meta.webauthn = webauthnMeta;
	localStorage.setItem(STORAGE_AUTH_KEY, JSON.stringify(meta));
	return true;
}

/**
 * パスワードを入力してストレージの暗号化を解除します
 */
async function unlockStorageWithPassword(password) {
	const meta = getStorageAuthMeta();
	if (!meta || !meta.isEncrypted) {
		return true;
	}
	const masterKey = await unwrapKeyWithPassword(meta.password, password);
	activeStorageKey = masterKey;
	return true;
}

/**
 * 生体認証（WebAuthn）でストレージの暗号化を解除します
 */
async function unlockStorageWithWebAuthn() {
	const meta = getStorageAuthMeta();
	if (!meta || !meta.isEncrypted) {
		return true;
	}
	if (!meta.webauthn) {
		throw new Error("生体認証は登録されていません。パスワードで解除してください。");
	}
	const masterKey = await unwrapKeyWithWebAuthn(meta.webauthn);
	activeStorageKey = masterKey;
	return true;
}

/**
 * ストレージを再ロックします（メモリ内のアクティブ鍵をクリア）
 */
function lockStorage() {
	activeStorageKey = null;
}

/**
 * ストレージの暗号化設定および保存データを全消去・初期化します
 */
function clearStorageSecurity() {
	localStorage.removeItem(STORAGE_AUTH_KEY);
	localStorage.removeItem('kogai_district_v2');
	localStorage.removeItem('kogai_rep_v2');
	localStorage.removeItem('kogai_neighbor_v2');
	activeStorageKey = null;
}

/**
 * データをローカルストレージへ保存します（暗号化設定時は自動的にAES-GCMで暗号化）
 */
async function saveStorageData(storageKey, dataObj) {
	if (!isStorageEncrypted()) {
		localStorage.setItem(storageKey, JSON.stringify(dataObj));
		return;
	}
	if (!activeStorageKey) {
		console.warn("Storage is encrypted but currently locked. Cannot write to:", storageKey);
		return;
	}
	try {
		const jsonStr = JSON.stringify(dataObj);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const enc = new TextEncoder();
		const cipherBuf = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			activeStorageKey,
			enc.encode(jsonStr)
		);
		const cipherBytes = new Uint8Array(cipherBuf);
		const combined = new Uint8Array(iv.length + cipherBytes.length);
		combined.set(iv, 0);
		combined.set(cipherBytes, 12);
		localStorage.setItem(storageKey, "STORAGE_ENC:" + uint8ToBase64(combined));
	} catch (err) {
		console.error("saveStorageData failed:", err);
	}
}

/**
 * ローカルストレージからデータを読み出し・復号します
 */
async function loadStorageDecrypted(storageKey) {
	const raw = localStorage.getItem(storageKey);
	if (!raw) return null;
	if (!raw.startsWith("STORAGE_ENC:")) {
		try {
			return JSON.parse(raw);
		} catch (e) {
			return null;
		}
	}
	if (!activeStorageKey) {
		throw new Error("STORAGE_LOCKED");
	}
	const combined = base64ToUint8(raw.slice("STORAGE_ENC:".length));
	const iv = combined.slice(0, 12);
	const cipherBytes = combined.slice(12);
	const plainBuf = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv },
		activeStorageKey,
		cipherBytes
	);
	const dec = new TextDecoder();
	return JSON.parse(dec.decode(plainBuf));
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		STORAGE_AUTH_KEY,
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
