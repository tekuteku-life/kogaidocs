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

test('app: switchTab toggles district and rep view and button active classes', () => {
	setupDomEnvironment();
	const tabD = document.getElementById('tab-district');
	const tabR = document.getElementById('tab-rep');
	const btnContainer = document.createElement('div');
	btnContainer.innerHTML = `
		<button class="tab-btn active">地区</button>
		<button class="tab-btn">代表</button>
	`;
	document.body.appendChild(btnContainer);

	// Switch to rep
	app.switchTab('rep');
	assert.strictEqual(tabD.style.display, 'none');
	assert.strictEqual(tabR.style.display, 'block');
	const btns = document.querySelectorAll('.tab-btn');
	assert.strictEqual(btns[0].classList.contains('active'), false);
	assert.strictEqual(btns[1].classList.contains('active'), true);

	// Switch to district
	app.switchTab('district');
	assert.strictEqual(tabD.style.display, 'block');
	assert.strictEqual(tabR.style.display, 'none');
	assert.strictEqual(btns[0].classList.contains('active'), true);
	assert.strictEqual(btns[1].classList.contains('active'), false);
});

test('app: updateSecurityBadge reflects locked, unlocked with/without biometrics, and unencrypted', () => {
	setupDomEnvironment();
	const badge = document.getElementById('storage-security-badge');

	// 1. Locked
	app.updateSecurityBadge('locked');
	assert(badge.classList.contains('is-locked'));
	assert(badge.innerHTML.includes('データロック中'));

	// 2. Unlocked without biometrics
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true }));
	app.updateSecurityBadge('unlocked');
	assert(badge.classList.contains('is-encrypted'));
	assert(badge.innerHTML.includes('暗号化保護中'));
	assert(!badge.innerHTML.includes('生体認証連携'));

	// 3. Unlocked with biometrics
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true, webauthn: { credentialId: "cred1" } }));
	app.updateSecurityBadge('unlocked');
	assert(badge.innerHTML.includes('生体認証連携'));

	// 4. Unencrypted
	app.updateSecurityBadge('unencrypted');
	assert(badge.classList.contains('is-plain'));
	assert(badge.innerHTML.includes('ストレージ未暗号化'));
});

test('app: showStorageUnlockModal and hideStorageUnlockModal manage modal display and input focus', () => {
	setupDomEnvironment();
	const modal = document.getElementById('storage-lock-modal');
	const webauthnSec = document.getElementById('webauthn-unlock-section');
	const passInput = document.getElementById('modal-unlock-pass');
	const errEl = document.getElementById('modal-unlock-error');

	// Unregistered WebAuthn -> section hidden
	localStorage.removeItem('kogai_auth_meta');
	passInput.value = "old-pass";
	errEl.textContent = "old-error";
	app.showStorageUnlockModal();
	assert.strictEqual(modal.style.display, 'flex');
	assert.strictEqual(webauthnSec.style.display, 'none');
	assert.strictEqual(passInput.value, "");
	assert.strictEqual(errEl.textContent, "");

	// Registered WebAuthn -> section visible
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true, webauthn: { credentialId: "cred" } }));
	app.showStorageUnlockModal();
	assert.strictEqual(webauthnSec.style.display, 'block');

	// Hide
	app.hideStorageUnlockModal();
	assert.strictEqual(modal.style.display, 'none');
});

test('app: handlePasswordUnlock handles validation, unlock failure, and success', async () => {
	setupDomEnvironment();
	const passInput = document.getElementById('modal-unlock-pass');
	const errEl = document.getElementById('modal-unlock-error');

	// 1. Empty password
	passInput.value = "";
	await app.handlePasswordUnlock();
	assert.strictEqual(errEl.textContent, "パスワードを入力してください。");

	// 2. Encryption active, wrong password
	const pass = "CorrectPassword123!@#";
	await cryptoLib.setupStorageEncryption(pass, false);
	cryptoLib.lockStorage();
	app.updateSecurityBadge('locked');

	passInput.value = "WrongPassword123!@#";
	await app.handlePasswordUnlock();
	assert.strictEqual(errEl.textContent, "パスワードが正しくないか、復号に失敗しました。");

	// 3. Correct password
	passInput.value = pass;
	await app.handlePasswordUnlock();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);
	const badge = document.getElementById('storage-security-badge');
	assert(badge.classList.contains('is-encrypted'));
});

test('app: handleWebAuthnUnlock handles failure and success', async () => {
	setupDomEnvironment();
	const errEl = document.getElementById('modal-unlock-error');

	// 1. Success path
	await cryptoLib.setupStorageEncryption("Password12345!@#", true);
	cryptoLib.lockStorage();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);

	await app.handleWebAuthnUnlock(false);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	// 2. Failure path with silent=false
	cryptoLib.lockStorage();
	navigator.credentials.failGet = true;
	await app.handleWebAuthnUnlock(false);
	assert(errEl.textContent.length > 0);

	// 3. Failure path with silent=true
	errEl.textContent = "";
	await app.handleWebAuthnUnlock(true);
	assert.strictEqual(errEl.textContent, "");
	navigator.credentials.failGet = false;
});

test('app: handleResetStorageConfirm prompts warning and resets storage', () => {
	setupDomEnvironment();
	localStorage.setItem('kogai_auth_meta', '{"test":1}');
	localStorage.setItem('kogai_district_v2', '{"test":2}');

	let reloaded = false;
	window.location.reload = () => { reloaded = true; };

	// Cancel
	global.confirm = () => false;
	app.handleResetStorageConfirm();
	assert.strictEqual(reloaded, false);
	assert(localStorage.getItem('kogai_auth_meta') !== null);

	// Confirm
	global.confirm = () => true;
	app.handleResetStorageConfirm();
	assert.strictEqual(reloaded, true);
	assert.strictEqual(localStorage.getItem('kogai_auth_meta'), null);
});

test('app: openStorageSettingsModal renders unencrypted vs encrypted settings', () => {
	setupDomEnvironment();
	const modal = document.getElementById('storage-settings-modal');
	const bodyEl = document.getElementById('settings-modal-body');

	// 1. Unencrypted state
	cryptoLib.clearStorageSecurity();
	app.openStorageSettingsModal();
	assert.strictEqual(modal.style.display, 'flex');
	assert(bodyEl.innerHTML.includes('暗号化パスワード'));
	assert(bodyEl.innerHTML.includes('確認用パスワード'));
	assert(bodyEl.innerHTML.includes('生体認証（Touch ID / Face ID / Windows Hello等）も有効にする'));

	// Close modal
	app.closeStorageSettingsModal();
	assert.strictEqual(modal.style.display, 'none');

	// 2. Encrypted state
	localStorage.setItem('kogai_auth_meta', JSON.stringify({ isEncrypted: true, salt: "s", iv: "i", authTag: "a", encryptedKey: "k" }));
	app.openStorageSettingsModal();
	assert(bodyEl.innerHTML.includes('端末内保存データは暗号化されています'));
	assert(bodyEl.innerHTML.includes('生体認証（Touch ID / Windows Hello等）を追加登録する'));
	assert(bodyEl.innerHTML.includes('今すぐストレージをロックする'));
});

test('app: validateModalPasswords validates rules, confirmation, and match states', () => {
	setupDomEnvironment();
	app.openStorageSettingsModal();
	const p1 = document.getElementById('modal-set-pass');
	const p2 = document.getElementById('modal-set-pass-confirm');
	const msgEl = document.getElementById('modal-set-pass-msg');

	// 1. Both empty
	p1.value = "";
	p2.value = "";
	app.validateModalPasswords();
	assert.strictEqual(msgEl.textContent, "");

	// 2. Invalid password
	p1.value = "short";
	p2.value = "short";
	app.validateModalPasswords();
	assert(msgEl.textContent.includes("⚠️"));
	assert(msgEl.className.includes("mismatch"));

	// 3. Valid password, confirmation empty
	p1.value = "ValidPassword123!@#";
	p2.value = "";
	app.validateModalPasswords();
	assert(msgEl.textContent.includes("確認のためもう一度"));

	// 4. Mismatch
	p2.value = "DifferentPassword123!@#";
	app.validateModalPasswords();
	assert(msgEl.textContent.includes("パスワードが一致していません"));

	// 5. Match
	p2.value = "ValidPassword123!@#";
	app.validateModalPasswords();
	assert(msgEl.textContent.includes("✅"));
	assert(msgEl.className.includes("match"));
});

test('app: handleEnableEncryptionSubmit validates inputs and sets up encryption', async () => {
	setupDomEnvironment();
	cryptoLib.clearStorageSecurity();
	app.openStorageSettingsModal();
	const p1 = document.getElementById('modal-set-pass');
	const p2 = document.getElementById('modal-set-pass-confirm');
	const enableBio = document.getElementById('modal-set-enable-bio');

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// 1. Invalid
	p1.value = "weak";
	p2.value = "weak";
	await app.handleEnableEncryptionSubmit();
	assert(alertMsg.includes("12文字以上"));

	// 2. Mismatch
	p1.value = "ValidPassword123!@#";
	p2.value = "MismatchPassword123!@#";
	await app.handleEnableEncryptionSubmit();
	assert(alertMsg.includes("確認用パスワードが一致していません"));

	// 3. Success
	p2.value = "ValidPassword123!@#";
	enableBio.checked = true;
	await app.handleEnableEncryptionSubmit();
	assert(alertMsg.includes("暗号化を有効化しました"));
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);
});

test('app: handleAddOrUpdateBiometric and handleImmediateLock', async () => {
	setupDomEnvironment();
	await cryptoLib.setupStorageEncryption("Password123!@#", false);

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// 1. Add biometric
	await app.handleAddOrUpdateBiometric();
	assert(alertMsg.includes("生体認証（WebAuthn PRF）の登録が完了しました"));
	const meta = cryptoLib.getStorageAuthMeta();
	assert(meta.webauthn);

	// 2. Immediate lock
	app.handleImmediateLock();
	assert.strictEqual(cryptoLib.isStorageUnlocked(), false);
	const lockModal = document.getElementById('storage-lock-modal');
	assert.strictEqual(lockModal.style.display, 'flex');
});

test('app: quickSetupEncryptionFromCard validates input and sets up encryption', async () => {
	setupDomEnvironment();
	cryptoLib.clearStorageSecurity();
	const inputEl = document.getElementById('d-pass');

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };
	global.confirm = () => false;

	// 1. Invalid
	inputEl.value = "short";
	await app.quickSetupEncryptionFromCard('d-pass');
	assert(alertMsg.includes("12文字以上"));

	// 2. Success with confirm bio = false
	inputEl.value = "QuickPassword123!@#";
	await app.quickSetupEncryptionFromCard('d-pass');
	assert(alertMsg.includes("このパスワードで端末内保存（LocalStorage）の暗号化を有効化しました"));
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
});

test('app: loadAppDataFromStorage handles plain and encrypted data and normalizes defaults', async () => {
	setupDomEnvironment();
	cryptoLib.clearStorageSecurity();

	// 1. Unsaved empty storage sets fallback defaults
	state.currentDistrict = {};
	state.repState = {};
	await app.loadAppDataFromStorage();

	assert.strictEqual(state.currentDistrict.officers.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood.length, 1);
	assert.strictEqual(state.currentDistrict.neighborhood[0].role, "会長");
	assert.strictEqual(state.currentDistrict.students.length, 1);
	assert.strictEqual(state.currentDistrict.students[0].grade, "6");

	// 2. Pre-existing saved data in storage
	const savedDistrict = createMockDistrict({ district: "本町", han: "1班" });
	const savedRep = createMockRepState();
	localStorage.setItem('kogai_district_v2', JSON.stringify(savedDistrict));
	localStorage.setItem('kogai_rep_v2', JSON.stringify(savedRep));

	await app.loadAppDataFromStorage();
	assert.strictEqual(state.currentDistrict.district, "本町");
	assert.strictEqual(state.repState.districts.length, 3);
});

test('app: additional branch coverage tests for non-secure context and error alerts', async () => {
	setupDomEnvironment();
	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };

	// 1. openStorageSettingsModal when isWebAuthnAvailable is false
	window.isSecureContext = false;
	cryptoLib.clearStorageSecurity();
	app.openStorageSettingsModal();
	const bodyEl = document.getElementById('settings-modal-body');
	assert(bodyEl.innerHTML.includes("HTTPS環境またはlocalhost"));
	window.isSecureContext = true;

	// 2. handleEnableEncryptionSubmit catch error alert
	const origSetup = global.setupStorageEncryption;
	global.setupStorageEncryption = async () => { throw new Error("Setup failed simulation"); };
	document.getElementById('modal-set-pass').value = "Password12345!@#";
	document.getElementById('modal-set-pass-confirm').value = "Password12345!@#";
	await app.handleEnableEncryptionSubmit();
	assert(alertMsg.includes("暗号化の有効化に失敗しました"));
	global.setupStorageEncryption = origSetup;

	// 3. handleAddOrUpdateBiometric catch error alert
	const origReg = global.registerWebAuthnForActiveKey;
	global.registerWebAuthnForActiveKey = async () => { throw new Error("Bio reg fail"); };
	await app.handleAddOrUpdateBiometric();
	assert(alertMsg.includes("生体認証の登録に失敗しました"));
	global.registerWebAuthnForActiveKey = origReg;

	// 4. quickSetupEncryptionFromCard catch error alert
	global.setupStorageEncryption = async () => { throw new Error("Card setup fail"); };
	document.getElementById('d-pass').value = "Password12345!@#";
	await app.quickSetupEncryptionFromCard('d-pass');
	assert(alertMsg.includes("暗号化設定に失敗しました"));
	global.setupStorageEncryption = origSetup;
});

test('app: clearMemoryAndDomForLock, resetAutoLockTimer, and initAutoLockListeners', async () => {
	setupDomEnvironment();
	state.currentDistrict.district = "機密地区";
	state.repState.districts = [{ district: "集約地区" }];
	state.neighborState.district = "自治会X";
	const printArea = document.getElementById('print-area');
	if (printArea) printArea.innerHTML = "<div>印刷機密データ</div>";

	app.clearMemoryAndDomForLock();
	assert.strictEqual(state.currentDistrict.district, "");
	assert.strictEqual(state.repState.districts.length, 0);
	assert.strictEqual(state.neighborState.district, "");
	if (printArea) assert.strictEqual(printArea.innerHTML, "");

	// resetAutoLockTimer & initAutoLockListeners in unencrypted state
	app.initAutoLockListeners();
	app.resetAutoLockTimer();

	// resetAutoLockTimer in encrypted & unlocked state
	await cryptoLib.setupStorageEncryption("AutoLockPass123!@#", false);
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	const origSetTimeout = global.setTimeout;
	let timerCb = null;
	global.setTimeout = (cb, ms) => {
		timerCb = cb;
		return { unref: () => {} };
	};

	app.resetAutoLockTimer();
	assert(typeof timerCb === 'function');
	// Execute auto-lock timer callback
	timerCb();
	global.setTimeout = origSetTimeout;

	// Unlock again and test visibilitychange
	await cryptoLib.unlockStorageWithPassword("AutoLockPass123!@#");
	document.hidden = true;
	document.dispatchEvent({ type: 'visibilitychange' });
	document.hidden = false;

	cryptoLib.clearStorageSecurity();
});

test('app: toggleModeSelector and switchTab manage mode selector collapse UX', () => {
	setupDomEnvironment();
	const btnContainer = document.getElementById('mode-tab-buttons') || document.createElement('div');
	btnContainer.id = 'mode-tab-buttons';
	btnContainer.style.display = 'flex';
	document.body.appendChild(btnContainer);

	const badge = document.getElementById('mode-active-badge') || document.createElement('div');
	badge.id = 'mode-active-badge';
	badge.style.display = 'none';
	document.body.appendChild(badge);

	const badgeText = document.getElementById('mode-active-badge-text') || document.createElement('span');
	badgeText.id = 'mode-active-badge-text';
	badge.appendChild(badgeText);

	// 1. Initial state: buttons shown, badge hidden
	assert.strictEqual(btnContainer.style.display, 'flex');

	// 2. switchTab('rep'): auto-collapses buttons, shows badge with rep label
	app.switchTab('rep');
	assert.strictEqual(btnContainer.style.display, 'none');
	assert.strictEqual(badge.style.display, 'inline-flex');
	assert(badgeText.textContent.includes('校外代表'));

	// 3. toggleModeSelector(): expands buttons, hides badge
	app.toggleModeSelector();
	assert.strictEqual(btnContainer.style.display, 'flex');
	assert.strictEqual(badge.style.display, 'none');

	// 4. switchTab('neighbor'): collapses buttons, shows badge with neighbor label
	app.switchTab('neighbor');
	assert.strictEqual(btnContainer.style.display, 'none');
	assert.strictEqual(badge.style.display, 'inline-flex');
	assert(badgeText.textContent.includes('自治会'));

	// 5. switchTab('district'): collapses buttons, shows badge with district label
	app.switchTab('district');
	assert.strictEqual(btnContainer.style.display, 'none');
	assert.strictEqual(badge.style.display, 'inline-flex');
	assert(badgeText.textContent.includes('地区役員'));

	// 6. toggleModeSelector when buttons are open collapses back to badge
	btnContainer.style.display = 'flex';
	badge.style.display = 'none';
	app.toggleModeSelector();
	assert.strictEqual(btnContainer.style.display, 'none');
	assert.strictEqual(badge.style.display, 'inline-flex');
});

test('app: shareAppUrl handles Web Share API, clipboard fallback, prompt, and error cases', async () => {
	setupDomEnvironment();
	let shareCalledWith = null;
	let alertMsg = '';
	global.alert = (msg) => { alertMsg = msg; };

	// Case 1: navigator.share supported and succeeds
	navigator.share = async (data) => {
		shareCalledWith = data;
		return Promise.resolve();
	};
	await app.shareAppUrl();
	assert.notStrictEqual(shareCalledWith, null);
	assert(shareCalledWith.title.includes('校外委員会'));
	assert.strictEqual(shareCalledWith.url, window.location.href);

	// Case 2: navigator.share throws AbortError (user cancelled) -> silent catch
	navigator.share = async () => {
		const err = new Error('User cancelled');
		err.name = 'AbortError';
		throw err;
	};
	await app.shareAppUrl(); // should not throw and not alert error

	// Case 3: navigator.share throws other Error -> falls back to clipboard
	let clipText = '';
	navigator.clipboard = {
		writeText: async (t) => { clipText = t; }
	};
	navigator.share = async () => {
		throw new Error('Share failed');
	};
	await app.shareAppUrl();
	assert.strictEqual(clipText, window.location.href);
	assert(alertMsg.includes('URLをクリップボードにコピーしました'));

	// Case 4: navigator.share not supported -> direct clipboard copy
	delete navigator.share;
	clipText = '';
	alertMsg = '';
	await app.shareAppUrl();
	assert.strictEqual(clipText, window.location.href);
	assert(alertMsg.includes('URLをクリップボードにコピーしました'));

	// Case 5: navigator.clipboard fails -> prompt fallback
	navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); };
	let promptDefault = '';
	global.prompt = (msg, def) => { promptDefault = def; return def; };
	await app.shareAppUrl();
	assert.strictEqual(promptDefault, window.location.href);
});

test('app: checkAppVersion handles offline, same version, new version, user cancel, user confirm, and network error', async () => {
	setupDomEnvironment();
	let alertMsg = '';
	global.alert = (m) => { alertMsg = m; };
	let confirmMsg = '';
	let confirmResult = true;
	global.confirm = (m) => { confirmMsg = m; return confirmResult; };

	// Setup mock elements for button and status (A-4)
	const updateBtn = document.getElementById('btn-manual-check-update');
	updateBtn.disabled = false;
	updateBtn.textContent = '🔄 最新バージョンを確認・更新';
	const statusEl = document.getElementById('version-check-status');

	// 1. Offline cases
	navigator.onLine = false;

	// 1a. Automatic check while offline: exits silently without fetching
	let fetchCalled = false;
	global.fetch = async () => { fetchCalled = true; return { ok: true, json: async () => ({ version: '9.9.9' }) }; };
	await app.checkAppVersion(false);
	assert.strictEqual(fetchCalled, false);
	assert.strictEqual(alertMsg, '');

	// 1b. Manual check while offline: alerts offline notice without fetching
	alertMsg = '';
	await app.checkAppVersion(true);
	assert.strictEqual(fetchCalled, false);
	assert(alertMsg.includes('オフラインのためバージョンチェックを行えません'));

	// 2. Online cases
	navigator.onLine = true;

	// 2a. Fetch error handling
	global.fetch = async () => { throw new Error('Network failure'); };
	// Automatic check on network failure: exits silently
	alertMsg = '';
	await app.checkAppVersion(false);
	assert.strictEqual(alertMsg, '');
	// Manual check on network failure: alerts error
	alertMsg = '';
	await app.checkAppVersion(true);
	assert(alertMsg.includes('バージョン情報の取得に失敗しました'));
	assert.strictEqual(updateBtn.disabled, false); // A-4 restored

	// 2b. Same version (already up to date)
	global.fetch = async (url) => {
		assert(url.includes('version.json'));
		return {
			ok: true,
			json: async () => ({ version: app.CURRENT_APP_VERSION, updatedAt: '2026-10-17' })
		};
	};
	// Automatic check: exits silently
	alertMsg = '';
	await app.checkAppVersion(false);
	assert.strictEqual(alertMsg, '');
	// Manual check: alerts up to date feedback
	alertMsg = '';
	await app.checkAppVersion(true);
	assert(alertMsg.includes('最新バージョン'));
	assert.strictEqual(updateBtn.disabled, false); // A-4 restored

	// 2c. Newer version available, user cancels confirm
	global.fetch = async () => ({
		ok: true,
		json: async () => ({ version: '9.9.9', updatedAt: '2026-10-18' })
	});
	confirmResult = false; // User clicks cancel
	let updatePerformed = false;
	const origPerformUpdate = app.performAppUpdate;
	// Mock performAppUpdate
	app.performAppUpdate = async () => { updatePerformed = true; };
	await app.checkAppVersion(false);
	assert(confirmMsg.includes('v9.9.9'));
	assert.strictEqual(updatePerformed, false); // Not updated

	// 2d. Newer version available, user confirms
	confirmResult = true; // User clicks OK
	updatePerformed = false;
	await app.checkAppVersion(true);
	assert(confirmMsg.includes('v9.9.9'));
	assert.strictEqual(updatePerformed, true); // Updated!
	assert.strictEqual(updateBtn.disabled, false);

	// Restore performAppUpdate
	app.performAppUpdate = origPerformUpdate;
});

test('app: performAppUpdate saves all states, clears caches, unregisters SW, and reloads with cache-busting URL (Action Items A-2 & A-3)', async () => {
	setupDomEnvironment();

	// 1. Verify safe local state persistence across all modes with try-catch isolation (A-3)
	let districtSaved = false;
	let neighborSaved = false;
	state.saveDistrictLocal = () => { districtSaved = true; };
	state.saveRepLocal = () => { throw new Error('Rep save temporary fault'); }; // A-3 test exception handling
	state.saveNeighborLocal = () => { neighborSaved = true; };

	// 2. Mock caches (A-2)
	const deletedCaches = [];
	global.caches = {
		keys: async () => ['kogai-cache-v1', 'kogai-cache-v2'],
		delete: async (k) => { deletedCaches.push(k); return true; }
	};

	// 3. Mock serviceWorker registrations (A-2)
	let unregisterCalled = false;
	navigator.serviceWorker.getRegistrations = async () => [
		{ unregister: async () => { unregisterCalled = true; return true; } }
	];

	// 4. Mock location replacement (A-2)
	let replacedLocation = '';
	window.location.replace = (url) => { replacedLocation = url; };

	await app.performAppUpdate();

	assert.strictEqual(districtSaved, true);
	assert.strictEqual(neighborSaved, true); // Even though rep threw, neighbor saved!
	assert.deepStrictEqual(deletedCaches, ['kogai-cache-v1', 'kogai-cache-v2']);
	assert.strictEqual(unregisterCalled, true);
	assert(replacedLocation.includes('?_update='));
});

test('app: checkAppVersion infinite update loop prevention safety guard with sessionStorage', async () => {
	setupDomEnvironment();
	sessionStorage.clear();
	navigator.onLine = true;

	let confirmCount = 0;
	let confirmMsg = '';
	global.confirm = (m) => {
		confirmCount++;
		confirmMsg = m;
		return false; // Cancel
	};

	let consoleWarnMsg = '';
	const origWarn = console.warn;
	console.warn = (...args) => {
		consoleWarnMsg = args.join(' ');
		origWarn(...args);
	};

	// 1. Remote has newer version 9.9.9
	global.fetch = async () => ({
		ok: true,
		json: async () => ({ version: '9.9.9', updatedAt: '2026-10-18' })
	});

	// Case A: No previous update attempt recorded -> normal auto check triggers confirm
	confirmCount = 0;
	sessionStorage.clear();
	await app.checkAppVersion(false);
	assert.strictEqual(confirmCount, 1, 'First time new version is found, auto check prompts confirm');

	// Case B: sessionStorage records update was already attempted for 9.9.9 within 1 hour
	// -> Auto check (isManual=false) MUST suppress confirm dialog to prevent infinite reload loop!
	confirmCount = 0;
	consoleWarnMsg = '';
	sessionStorage.setItem('kogai_update_attempted_version', '9.9.9');
	sessionStorage.setItem('kogai_update_attempted_time', String(Date.now()));

	await app.checkAppVersion(false);
	assert.strictEqual(confirmCount, 0, 'Auto check suppresses confirm dialog if update was already attempted');
	assert(consoleWarnMsg.includes('Skipping auto update prompt') || consoleWarnMsg.includes('prevent infinite loop'), 'Warning is logged when skipping auto prompt');

	// Case C: Manual check (isManual=true) bypasses suppression so user can explicitly retry
	confirmCount = 0;
	await app.checkAppVersion(true);
	assert.strictEqual(confirmCount, 1, 'Manual check bypasses loop guard and shows confirm dialog');

	// Case D: Update attempt is older than 1 hour (timeout) -> Auto check triggers confirm again
	confirmCount = 0;
	const twoHoursAgo = Date.now() - (2 * 60 * 60 * 1000);
	sessionStorage.setItem('kogai_update_attempted_time', String(twoHoursAgo));

	await app.checkAppVersion(false);
	assert.strictEqual(confirmCount, 1, 'Expired attempt (> 1h) allows auto check to prompt confirm');

	// Case E: Attempt was for 9.9.9, but an even newer version 10.0.0 is published -> Prompts confirm
	confirmCount = 0;
	sessionStorage.setItem('kogai_update_attempted_version', '9.9.9');
	sessionStorage.setItem('kogai_update_attempted_time', String(Date.now()));
	global.fetch = async () => ({
		ok: true,
		json: async () => ({ version: '10.0.0', updatedAt: '2026-10-18' })
	});

	await app.checkAppVersion(false);
	assert.strictEqual(confirmCount, 1, 'Newer remote version than attempted version prompts confirm');

	// Case F: App is up to date -> cleans up sessionStorage attempt records
	sessionStorage.setItem('kogai_update_attempted_version', '9.9.9');
	sessionStorage.setItem('kogai_update_attempted_time', String(Date.now()));
	global.fetch = async () => ({
		ok: true,
		json: async () => ({ version: app.CURRENT_APP_VERSION, updatedAt: '2026-10-18' })
	});

	await app.checkAppVersion(false);
	assert.strictEqual(sessionStorage.getItem('kogai_update_attempted_version'), null, 'Cleaned up attempted_version on up-to-date');
	assert.strictEqual(sessionStorage.getItem('kogai_update_attempted_time'), null, 'Cleaned up attempted_time on up-to-date');

	// Case G: Invalid timestamp in sessionStorage (NaN / corrupted) -> safe fallback (not suppressed)
	global.fetch = async () => ({
		ok: true,
		json: async () => ({ version: '9.9.9', updatedAt: '2026-10-18' })
	});
	confirmCount = 0;
	sessionStorage.setItem('kogai_update_attempted_version', '9.9.9');
	sessionStorage.setItem('kogai_update_attempted_time', 'invalid_nan');

	await app.checkAppVersion(false);
	assert.strictEqual(confirmCount, 1, 'Corrupted timestamp safely falls back to prompt');

	// Case H: sessionStorage throws exception (e.g. SecurityError / QuotaExceededError in private browsing)
	const origGetItem = sessionStorage.getItem;
	sessionStorage.getItem = () => { throw new Error('SecurityError: Access denied'); };
	confirmCount = 0;
	// Should not throw, should safely prompt confirm
	await app.checkAppVersion(false);
	assert.strictEqual(confirmCount, 1, 'sessionStorage exception is safely caught');
	sessionStorage.getItem = origGetItem;

	console.warn = origWarn;
});

test('app: performAppUpdate persists update attempt in sessionStorage', async () => {
	setupDomEnvironment();
	sessionStorage.clear();

	// Mock environment
	global.caches = { keys: async () => [], delete: async () => true };
	navigator.serviceWorker.getRegistrations = async () => [];
	window.location.replace = () => {};

	// Case 1: with targetVersion
	await app.performAppUpdate('9.9.9');
	assert.strictEqual(sessionStorage.getItem('kogai_update_attempted_version'), '9.9.9');
	assert.ok(sessionStorage.getItem('kogai_update_attempted_time'), 'Timestamp is recorded');

	// Case 2: without targetVersion (null default)
	sessionStorage.clear();
	await app.performAppUpdate();
	assert.strictEqual(sessionStorage.getItem('kogai_update_attempted_version'), null);
});

test('app: update attempt helper functions branch coverage and exception safety', () => {
	setupDomEnvironment();

	// 1. recordUpdateAttemptInfo with falsy / empty version
	sessionStorage.clear();
	app.recordUpdateAttemptInfo('');
	app.recordUpdateAttemptInfo(null);
	assert.strictEqual(sessionStorage.getItem('kogai_update_attempted_version'), null);

	// 2. recordUpdateAttemptInfo with sessionStorage exception
	const origSetItem = sessionStorage.setItem;
	sessionStorage.setItem = () => { throw new Error('QuotaExceededError'); };
	assert.doesNotThrow(() => {
		app.recordUpdateAttemptInfo('1.0.0');
	});
	sessionStorage.setItem = origSetItem;

	// 3. getUpdateAttemptInfo when sessionStorage throws
	const origGetItem = sessionStorage.getItem;
	sessionStorage.getItem = () => { throw new Error('SecurityError'); };
	const res = app.getUpdateAttemptInfo();
	assert.strictEqual(res.version, null);
	assert.strictEqual(res.time, null);
	sessionStorage.getItem = origGetItem;

	// 4. clearUpdateAttemptInfo when sessionStorage throws
	const origRemoveItem = sessionStorage.removeItem;
	sessionStorage.removeItem = () => { throw new Error('SecurityError'); };
	assert.doesNotThrow(() => {
		app.clearUpdateAttemptInfo();
	});
	sessionStorage.removeItem = origRemoveItem;

	// 5. getUpdateAttemptInfo when sessionStorage is undefined
	const origSessionStorage = global.sessionStorage;
	delete global.sessionStorage;
	const resUndef = app.getUpdateAttemptInfo();
	assert.strictEqual(resUndef.version, null);
	assert.strictEqual(resUndef.time, null);
	assert.doesNotThrow(() => {
		app.clearUpdateAttemptInfo();
		app.recordUpdateAttemptInfo('1.0.0');
	});
	global.sessionStorage = origSessionStorage;

	// 6. getUpdateAttemptInfo when time is negative or zero
	sessionStorage.setItem('kogai_update_attempted_version', '9.9.9');
	sessionStorage.setItem('kogai_update_attempted_time', '0');
	const resZero = app.getUpdateAttemptInfo();
	assert.strictEqual(resZero.time, 0);
});

test('app: 4-tab switching, persistence in kogai_active_mode, and badge label sync (Action Item A-3)', () => {
	setupDomEnvironment();
	localStorage.clear();

	const badge = document.getElementById('mode-active-badge-text');

	// 1. Switch to transfer mode
	app.switchTab('transfer');
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'transfer');
	if (badge) assert(badge.textContent.includes('転入者'));

	// 2. Switch to neighbor mode
	app.switchTab('neighbor');
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'neighbor');
	if (badge) assert(badge.textContent.includes('自治会'));

	// 3. Switch to rep mode
	app.switchTab('rep');
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'rep');
	if (badge) assert(badge.textContent.includes('校外代表'));

	// 4. Switch to district mode
	app.switchTab('district');
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'district');
	if (badge) assert(badge.textContent.includes('地区役員'));

	// 5. Restore active mode on init with whitelist validation (A-3)
	window.location.search = '';
	// 5a. Valid stored mode 'transfer'
	localStorage.setItem('kogai_active_mode', 'transfer');
	app.restoreActiveMode();
	const tabTransfer = document.getElementById('tab-transfer');
	if (tabTransfer) assert.strictEqual(tabTransfer.style.display, 'block');

	// 5b. Invalid/unknown mode falls back to 'district'
	window.location.search = '';
	localStorage.setItem('kogai_active_mode', 'malicious_tab<script>');
	app.restoreActiveMode();
	const tabDistrict = document.getElementById('tab-district');
	assert.strictEqual(tabDistrict.style.display, 'block');
});

test('app: performAppUpdate saves transfer state with error isolation (Action Item A-4)', async () => {
	setupDomEnvironment();
	let transferSaved = false;
	state.saveTransferLocal = () => { transferSaved = true; };

	global.caches = {
		keys: async () => [],
		delete: async () => true
	};
	navigator.serviceWorker.getRegistrations = async () => [];
	window.location.replace = () => {};

	await app.performAppUpdate();
	assert.strictEqual(transferSaved, true);
});

test('app: WebAuthn unification - quickSetupEncryptionFromCard suppresses credentials.create when storage encryption is already active', async () => {
	setupDomEnvironment();
	localStorage.clear();

	// ストレージ暗号化が有効な状態をセットアップ
	await cryptoLib.setupStorageEncryption('MasterPassword123!', false);
	assert.strictEqual(cryptoLib.isStorageEncrypted(), true);
	assert.strictEqual(cryptoLib.isStorageUnlocked(), true);

	let credentialsCreateCalled = false;
	const origCreate = navigator.credentials.create;
	navigator.credentials.create = async (options) => {
		credentialsCreateCalled = true;
		return origCreate.call(navigator.credentials, options);
	};

	try {
		// カード側からのパスワード記憶要求
		await app.quickSetupEncryptionFromCard('DistrictFilePass123!');
		// 既存暗号化ストレージがあるため、再度のWebAuthn登録プロンプトは呼ばれない
		assert.strictEqual(credentialsCreateCalled, false);
		// 暗号化ストレージに保存されていること
		assert.strictEqual(state.currentDistrict.savedFilePassword, 'DistrictFilePass123!');
	} finally {
		navigator.credentials.create = origCreate;
	}
});

test('app: URL parameter direct mode selection and numeric aliases in restoreActiveMode', () => {
	setupDomEnvironment();
	localStorage.clear();

	// 1. ?mode=transfer
	window.location.search = '?mode=transfer';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'transfer');
	assert.strictEqual(document.getElementById('tab-transfer').style.display, 'block');

	// 2. ?mode=rep
	window.location.search = '?mode=rep';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'rep');
	assert.strictEqual(document.getElementById('tab-rep').style.display, 'block');

	// 3. ?mode=neighbor
	window.location.search = '?mode=neighbor';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'neighbor');
	assert.strictEqual(document.getElementById('tab-neighbor').style.display, 'block');

	// 4. ?mode=district
	window.location.search = '?mode=district';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'district');
	assert.strictEqual(document.getElementById('tab-district').style.display, 'block');

	// 5. Numeric aliases: ?mode=4 -> transfer, ?mode=3 -> neighbor, ?mode=2 -> rep, ?mode=1 -> district
	window.location.search = '?mode=4';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'transfer');

	window.location.search = '?mode=3';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'neighbor');

	window.location.search = '?mode=2';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'rep');

	window.location.search = '?mode=1';
	app.restoreActiveMode();
	assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'district');

	// 6. Invalid mode query falls back to localStorage or default
	localStorage.setItem('kogai_active_mode', 'neighbor');
	window.location.search = '?mode=invalid_hack<script>';
	app.restoreActiveMode();
	assert.strictEqual(document.getElementById('tab-neighbor').style.display, 'block');

	// 7. No query parameter uses localStorage
	window.location.search = '';
	localStorage.setItem('kogai_active_mode', 'transfer');
	app.restoreActiveMode();
	assert.strictEqual(document.getElementById('tab-transfer').style.display, 'block');
});

test('app: switchTab synchronizes browser history state (Action Item A-2)', () => {
	setupDomEnvironment();
	let replacedState = null;
	let replacedUrl = null;

	window.history.replaceState = (state, title, url) => {
		replacedState = state;
		replacedUrl = url;
	};

	app.switchTab('rep');
	assert.strictEqual(replacedUrl.includes('mode=rep'), true);

	app.switchTab('transfer');
	assert.strictEqual(replacedUrl.includes('mode=transfer'), true);
});

test('app: shareAppUrl supports specificMode parameter for targeted mode URL sharing', async () => {
	setupDomEnvironment();
	let sharedData = null;
	navigator.share = async (data) => {
		sharedData = data;
		return Promise.resolve();
	};

	// 1. Share transfer mode specifically
	await app.shareAppUrl('transfer');
	assert(sharedData.url.includes('mode=transfer'));
	assert(sharedData.text.includes('転入') || sharedData.title.includes('名簿'));

	// 2. Share with clipboard fallback
	delete navigator.share;
	await app.shareAppUrl('neighbor');
	assert(navigator.clipboard.text.includes('mode=neighbor'));
});
