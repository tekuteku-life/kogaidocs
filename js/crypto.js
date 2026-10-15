/* =========================================================================
   暗号化・復号（AES-GCM + PBKDF2 + Base64）
========================================================================= */

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

async function decryptPayload(payloadStr, password) {
	const dec = new TextDecoder();
	if (payloadStr.startsWith("PLAIN:")) {
		return dec.decode(base64ToUint8(payloadStr.slice(6)));
	}
	const b64 = payloadStr.startsWith("ENC:") ? payloadStr.slice(4) : payloadStr;
	const combined = base64ToUint8(b64);
	const salt = combined.slice(0, 16);
	const iv = combined.slice(16, 28);
	const cipherBytes = combined.slice(28);
	const key = await deriveKey(password, salt);
	const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
	return dec.decode(plainBuf);
}

function uint8ToBase64(bytes) {
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

function base64ToUint8(b64) {
	const binary = atob(b64.trim());
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

async function parseTxtContent(text, password) {
	const match = text.match(/BEGIN_DATA:\s*([\s\S]+?)\s*:END_DATA/);
	const payload = match ? match[1].trim() : text.trim();
	const jsonStr = await decryptPayload(payload, password);
	return JSON.parse(jsonStr);
}

