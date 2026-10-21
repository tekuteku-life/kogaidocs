const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const hata = require('../../js/hata.js');
const seat = require('../../js/seat.js');
const rep = require('../../js/rep.js');
const district = require('../../js/district.js');
const app = require('../../js/app.js');

test('integration: full storage encryption lifecycle (plain -> encrypted -> locked -> password/biometric unlock -> reset)', async () => {
	setupDomEnvironment();
	await cryptoLib.clearStorageSecurity();

	// Step 1: Plain storage phase
	document.getElementById('d-name').value = "初台地区";
	state.currentDistrict = createMockDistrict({ district: "初台地区", han: "1班" });
	await state.saveDistrictLocal();

	const rawSavedPlain = localStorage.getItem('kogai_district_v2');
	assert(rawSavedPlain.includes("初台地区")); // Plain text in storage
	assert.strictEqual(cryptoLib.isStorageEncrypted(), false);

	// Step 2: Enable encryption with password and WebAuthn PRF
	const pass = "MasterSecret12345!@#$";
	const setupRes = await cryptoLib.setupStorageEncryption(pass, true);
	assert.strictEqual(setupRes.biometric, true);
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// Verify existing data is encrypted in localStorage
	const rawSavedEnc = localStorage.getItem('kogai_district_v2');
	assert(!rawSavedEnc.includes("初台地区")); // Ciphertext
	assert(rawSavedEnc.startsWith("STORAGE_ENC:"));

	// Step 3: Auto-save works while unlocked
	state.currentDistrict.district = "初台新地区";
	document.getElementById('d-name').value = "初台新地区";
	await state.saveDistrictLocal();

	const reloadedWhileUnlocked = await cryptoLib.loadStorageDecrypted('kogai_district_v2');
	assert.strictEqual(reloadedWhileUnlocked.district, "初台新地区");

	// Step 4: Immediate lock
	app.handleImmediateLock();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);

	// Attempting write while locked does not overwrite with garbage
	const beforeWrite = localStorage.getItem('kogai_district_v2');
	const writeRes = await cryptoLib.saveStorageData('kogai_district_v2', { district: "壊れたデータ" });
	assert.strictEqual(writeRes, false);
	assert.strictEqual(localStorage.getItem('kogai_district_v2'), beforeWrite);

	// Step 5: Password unlock
	const passInput = document.getElementById('modal-unlock-pass');
	passInput.value = "WrongPassword123!@#";
	await app.handlePasswordUnlock();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);

	passInput.value = pass;
	await app.handlePasswordUnlock();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// Step 6: Biometric unlock
	cryptoLib.lockStorage();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);

	await app.handleWebAuthnUnlock(false);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);
	const decryptedFinal = await cryptoLib.loadStorageDecrypted('kogai_district_v2');
	assert.strictEqual(decryptedFinal.district, "初台新地区");

	// Step 7: Reset storage
	let reloaded = false;
	window.location.reload = () => { reloaded = true; };
	global.confirm = () => true;
	await app.handleResetStorageConfirm();
	assert.strictEqual(reloaded, true);
	assert.strictEqual(localStorage.getItem('kogai_auth_meta'), null);
	assert.strictEqual(localStorage.getItem('kogai_district_v2'), null);
	assert.strictEqual(cryptoLib.isStorageEncrypted(), false);
});
