const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
require('../../js/hata'); require('../../js/seat');
const district = require('../../js/district');
const rep = require('../../js/rep');
const neighbor = require('../../js/neighbor');
const transfer = require('../../js/transfer');
const print = require('../../js/print');
const app = require('../../js/app');

function prepare() {
	setupDomEnvironment();
	state.currentDistrict = { district: '地区', han: '', hanList: [], officers: [], students: [], neighborhood: [] };
	state.repState = { districts: [structuredClone(state.currentDistrict)], szExternals: [], seatConfig: { cols: 2, rows: 2, cells: {} } };
	state.neighborState = { district: '自治会', neighborhood: [] };
	state.transferState = { address: '住所', tel: '09012345678', children: [{ id: 'child', lastName: '児童', firstName: '名前', grade: '1', className: '1' }] };
	for (const prefix of ['d', 'rep', 'neighbor', 'transfer-export']) {
		document.getElementById(prefix + '-pass').value = 'Submission123!';
		document.getElementById(prefix + '-pass-confirm').value = 'Submission123!';
	}
	document.getElementById('d-name').value = '地区';
	document.getElementById('neighbor-district-name').value = '自治会';
}
const exportsByName = {
	district: () => district.exportDistrictTxt(), districtShare: () => district.shareDistrictData('share'),
	rep: () => rep.exportRepMasterTxt(), split: () => rep.exportSingleDistrictFromRep(0, 'Submission123!'),
	neighbor: () => neighbor.exportNeighborTxt(), neighborCopy: () => neighbor.copyNeighborEncryptedText(),
	transfer: () => transfer.exportTransferTxt(), transferCopy: () => transfer.copyTransferEncryptedText()
};
for (const [name, output] of Object.entries(exportsByName)) {
	test(`security output: ${name} rejects a stale session before file or clipboard output`, async () => {
		prepare();
		const original = global.encryptPayload;
		let release;
		global.encryptPayload = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
		const emitted = [];
		global.downloadTextFile = (...args) => emitted.push(args);
		navigator.clipboard.writeText = async text => emitted.push(text);
		try {
			const task = output();
			assert.equal(typeof release, 'function', 'The exporter reached the encryption boundary');
			cryptoLib.lockStorage(); release(); await task;
			assert.deepEqual(emitted, []);
		} finally { global.encryptPayload = original; }
	});
}

test('security access: cancelled setup preserves legacy storage and cannot activate its key', async () => {
	prepare();
	localStorage.setItem('kogai_district_v2', JSON.stringify(state.currentDistrict));
	const before = localStorage.getItem('kogai_district_v2');
	document.getElementById('modal-set-pass').value = 'DeviceDatabase123!';
	document.getElementById('modal-set-pass-confirm').value = 'DeviceDatabase123!';
	const actual = crypto.subtle.encrypt.bind(crypto.subtle);
	let release;
	crypto.subtle.encrypt = async (...args) => { await new Promise(resolve => { release = resolve; }); return actual(...args); };
	try {
		const task = app.handleEnableEncryptionSubmit();
		while (!release) await new Promise(resolve => setImmediate(resolve));
		app.closeStorageSettingsModal();
		crypto.subtle.encrypt = actual; release(); await task;
		assert.equal(cryptoLib.isStorageEncrypted(), false);
		assert.equal(localStorage.getItem('kogai_district_v2'), before);
	} finally { crypto.subtle.encrypt = actual; }
});

test('security access: cancelled password and biometric unwraps never activate a key or reopen the old modal', async () => {
	for (const biometric of [false, true]) {
		prepare();
		await cryptoLib.setupStorageEncryption('DeviceDatabase123!', biometric);
		cryptoLib.lockStorage();
		document.getElementById('modal-unlock-pass').value = 'DeviceDatabase123!';
		const actual = crypto.subtle.decrypt.bind(crypto.subtle);
		let release;
		crypto.subtle.decrypt = async (...args) => { await new Promise(resolve => { release = resolve; }); return actual(...args); };
		try {
			const task = biometric ? app.handleWebAuthnUnlock() : app.handlePasswordUnlock();
			while (!release) await new Promise(resolve => setImmediate(resolve));
			app.closeStorageAccessModal();
			crypto.subtle.decrypt = actual; release(); await task;
			assert.equal(cryptoLib.isStorageUnlocked(), false);
			assert.equal(document.getElementById('storage-lock-modal').style.display, 'none');
		} finally { crypto.subtle.decrypt = actual; }
	}
});

test('security access: closing after key activation but before model adoption purges the key and prevents late model restoration', async () => {
	prepare();
	await cryptoLib.setupStorageEncryption('DeviceDatabase123!'); cryptoLib.lockStorage();
	document.getElementById('modal-unlock-pass').value = 'DeviceDatabase123!';
	const original = global.loadStorageDecrypted;
	let release;
	const barrier = new Promise(resolve => { release = resolve; });
	let reading = false;
	global.loadStorageDecrypted = async key => { const value = await original(key); reading = true; await barrier; return value; };
	try {
		const task = app.handlePasswordUnlock();
		while (!reading) await new Promise(resolve => setImmediate(resolve));
		assert.equal(cryptoLib.isStorageUnlocked(), true, 'Key was activated before the read boundary');
		app.closeStorageAccessModal(); release(); await task;
		assert.equal(cryptoLib.isStorageUnlocked(), false);
		assert.equal(state.currentDistrict.district, '');
	} finally { global.loadStorageDecrypted = original; }
});

for (const channel of ['share', 'copy', 'line', 'email']) {
	test(`security output: district ${channel} never falls back or opens another app after a pending clipboard rejects on lock`, async () => {
		prepare();
		let reject;
		const originalEncrypt = global.encryptPayload;
		global.encryptPayload = async () => 'ENC:2:' + 'a'.repeat(3000);
		const emitted = [];
		global.downloadTextFile = (...args) => emitted.push(args);
		window.open = (...args) => emitted.push(args);
		navigator.clipboard.writeText = () => new Promise((_, fail) => { reject = fail; });
		try {
			const task = district.shareDistrictData(channel);
			while (!reject) await new Promise(resolve => setImmediate(resolve));
			cryptoLib.lockStorage(); reject(new Error('denied')); await task;
			assert.deepEqual(emitted, []);
		} finally { global.encryptPayload = originalEncrypt; }
	});
}

for (const share of [false, true]) {
	test(`security output: district ${share ? 'share' : 'file'} metadata matches its encrypted snapshot during concurrent edits`, async () => {
		prepare();
		const original = global.encryptPayload;
		let release;
		global.encryptPayload = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
		let captured;
		global.downloadTextFile = (content, filename) => { captured = { content, filename }; };
		navigator.clipboard.writeText = async content => { captured = { content }; };
		try {
			const task = share ? district.shareDistrictData('copy') : district.exportDistrictTxt();
			assert.equal(typeof release, 'function');
			state.currentDistrict.district = '別の地区'; state.currentDistrict.han = '別班';
			release(); await task;
			const cipher = captured.content.match(/BEGIN_DATA:\s*([\s\S]+?)\s*:END_DATA/)[1];
			const decoded = JSON.parse(await cryptoLib.decryptPayload(cipher, 'Submission123!'));
			assert.equal(decoded.district, '地区');
			assert.ok(captured.content.includes(`(${decoded.district} /`), 'Header identifies the encrypted snapshot');
			if (!share) assert.ok(captured.filename.startsWith('校外地区データ_地区_'));
		} finally { global.encryptPayload = original; }
	});
}

test('security output: representative split discards late encryption failures after lock without stale alerts', async () => {
	prepare();
	const original = global.encryptPayload;
	let reject;
	global.encryptPayload = () => new Promise((_, fail) => { reject = fail; });
	const alerts = [];
	global.alert = message => alerts.push(message);
	try {
		const task = rep.exportSingleDistrictFromRep(0, 'Submission123!', 'copy');
		assert.equal(typeof reject, 'function');
		cryptoLib.lockStorage(); reject(new Error('late encryption failure'));
		assert.equal(await task, false);
		assert.deepEqual(alerts, [], 'An old exporter does not notify in the locked context');
	} finally { global.encryptPayload = original; }
});

test('security output: representative clipboard rejection after lock cannot trigger a fallback or a stale notification', async () => {
	prepare();
	let reject;
	const alerts = [], downloads = [];
	global.alert = message => alerts.push(message);
	global.downloadTextFile = (...args) => downloads.push(args);
	navigator.clipboard.writeText = () => new Promise((_, fail) => { reject = fail; });
	const task = rep.exportSingleDistrictFromRep(0, 'Submission123!', 'copy');
	while (!reject) await new Promise(resolve => setImmediate(resolve));
	cryptoLib.lockStorage(); reject(new Error('late clipboard failure'));
	assert.equal(await task, false);
	assert.deepEqual(alerts, []);
	assert.deepEqual(downloads, []);
});

test('security output: authentication deletion without a storage event cancels an already pending export', async () => {
	prepare(); await cryptoLib.setupStorageEncryption('DeviceDatabase123!');
	const original = global.encryptPayload;
	let release;
	global.encryptPayload = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
	const emitted = [];
	global.downloadTextFile = (...args) => emitted.push(args);
	try {
		const task = rep.exportSingleDistrictFromRep(0, 'Submission123!');
		assert.equal(typeof release, 'function');
		localStorage.removeItem('kogai_auth_meta');
		release(); await task;
		assert.deepEqual(emitted, [], 'Late output is rejected before cross-tab notification delivery');
	} finally { global.encryptPayload = original; }
});

test('security output: unavailable authentication state fails closed during capture and output validation', () => {
	prepare();
	const get = localStorage.getItem;
	const guard = cryptoLib.captureStorageOutputGuard();
	localStorage.getItem = () => { throw new Error('Access denied'); };
	try {
		assert.equal(guard(), false, 'Validation failure cannot authorize output');
		assert.equal(cryptoLib.captureStorageOutputGuard()(), false, 'Capture failure cannot authorize output');
	} finally { localStorage.getItem = get; }
});

test('security SEC-26: quickSetupEncryptionFromCard opens unlock modal when locked, avoids district pollution on neighbor/rep in both new and unlocked states, and handleAddOrUpdateBiometric respects abort without locking', async () => {
	const alerts = [];
	const prepareWithAlerts = () => {
		prepare();
		alerts.length = 0;
		global.alert = m => alerts.push(m);
		global.confirm = () => true;
	};

	// 1. Locked -> opens unlock modal
	prepareWithAlerts();
	await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
	cryptoLib.lockStorage();
	assert.equal(await app.quickSetupEncryptionFromCard('neighbor-pass'), false);
	assert.equal(document.getElementById('storage-lock-modal').style.display, 'flex');

	// 2. Unlocked -> neighbor-pass/rep-pass do NOT pollute currentDistrict; d-pass checks saveDistrictLocal return
	cryptoLib.clearStorageSecurity();
	prepareWithAlerts();
	await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
	for (const cardId of ['neighbor-pass', 'rep-pass']) {
		delete state.currentDistrict.savedFilePassword;
		document.getElementById('d-save-password-optin').checked = false;
		document.getElementById('d-pass').value = '';
		document.getElementById(cardId).value = 'CardPass123!';
		document.getElementById(`${cardId}-confirm`).value = 'CardPass123!';
		assert.equal(await app.quickSetupEncryptionFromCard(cardId), true);
		assert.equal(state.currentDistrict.savedFilePassword, undefined);
		assert.equal(document.getElementById('d-save-password-optin').checked, false);
		assert.equal(document.getElementById('d-pass').value, '');
	}

	const origSave = global.saveDistrictLocal;
	global.saveDistrictLocal = async () => false;
	try {
		alerts.length = 0;
		document.getElementById('d-pass').value = 'DistrictPass123!';
		document.getElementById('d-pass-confirm').value = 'DistrictPass123!';
		assert.equal(await app.quickSetupEncryptionFromCard('d-pass'), false);
		assert.equal(alerts.length, 0);
	} finally { global.saveDistrictLocal = origSave; }

	// 3. New setup (!isStorageEncrypted()) with rep-pass / neighbor-pass enables encryption without polluting district & resets storageAccessBusy
	for (const cardId of ['rep-pass', 'neighbor-pass']) {
		cryptoLib.clearStorageSecurity();
		prepareWithAlerts();
		delete state.currentDistrict.savedFilePassword;
		document.getElementById('d-save-password-optin').checked = false;
		document.getElementById('d-pass').value = '';
		document.getElementById(cardId).value = 'CardSetupPass123!';
		document.getElementById(`${cardId}-confirm`).value = 'CardSetupPass123!';
		assert.equal(await app.quickSetupEncryptionFromCard(cardId), true);
		assert.equal(cryptoLib.isStorageEncrypted(), true);
		assert.equal(cryptoLib.isStorageUnlocked(), true);
		assert.equal(state.currentDistrict.savedFilePassword, undefined);
		assert.equal(document.getElementById('d-save-password-optin').checked, false);
		assert.equal(document.getElementById('d-pass').value, '');
		app.closeStorageSettingsModal();
		assert.equal(cryptoLib.isStorageUnlocked(), true, `storageAccessBusy cleared after ${cardId} setup`);
	}

	// Empty / null #neighbor-pass / #rep-pass / #d-pass must NOT fall back to inputId string as password
	for (const cardId of ['neighbor-pass', 'rep-pass', 'd-pass']) {
		cryptoLib.clearStorageSecurity();
		prepareWithAlerts();
		const origEl = document.elements[cardId];
		document.getElementById(cardId).value = '';
		assert.equal(await app.quickSetupEncryptionFromCard(cardId), false);
		assert.equal(cryptoLib.isStorageEncrypted(), false, `${cardId} empty value must not encrypt with inputId`);
		document.elements[cardId] = null;
		try {
			assert.equal(await app.quickSetupEncryptionFromCard(cardId), false);
			assert.equal(cryptoLib.isStorageEncrypted(), false, `${cardId} null element must not encrypt with inputId`);
		} finally {
			document.elements[cardId] = origEl;
		}
	}
	assert.equal(await app.quickSetupEncryptionFromCard(null), false);

	// Aborted quickSetupEncryptionFromCard during setup OR during post-setup persistDistrictCardPassword suppresses badge, timer, and completion alert
	for (const failMode of ['saveFalse', 'closeModalDuringSave', 'lockDuringSave']) {
		cryptoLib.clearStorageSecurity();
		prepareWithAlerts();
		app.openStorageSettingsModal();
		document.getElementById('d-pass').value = 'DistrictPass123!';
		document.getElementById('d-pass-confirm').value = 'DistrictPass123!';
		const origSavePost = global.saveDistrictLocal;
		global.saveDistrictLocal = async () => {
			if (failMode === 'saveFalse') return false;
			if (failMode === 'closeModalDuringSave') { app.closeStorageSettingsModal(); return true; }
			cryptoLib.lockStorage();
			return true;
		};
		try {
			assert.equal(await app.quickSetupEncryptionFromCard('d-pass'), false, `Abort on ${failMode}`);
			assert.equal(alerts.some(m => m.includes('有効化しました')), false, `No completion alert on ${failMode}`);
			assert.equal(document.getElementById('storage-security-badge').classList.contains('is-encrypted'), false);
		} finally { global.saveDistrictLocal = origSavePost; }
	}

	cryptoLib.clearStorageSecurity();
	prepareWithAlerts();
	delete state.currentDistrict.savedFilePassword;
	document.getElementById('d-save-password-optin').checked = false;
	document.getElementById('d-pass').value = 'DistrictPass123!';
	document.getElementById('d-pass-confirm').value = 'DistrictPass123!';
	const origSetup = global.setupStorageEncryption;
	let releaseSetup;
	global.setupStorageEncryption = async (...args) => { await new Promise(r => { releaseSetup = r; }); return origSetup(...args); };
	try {
		const setupTask = app.quickSetupEncryptionFromCard('d-pass');
		while (!releaseSetup) await new Promise(r => setImmediate(r));
		app.closeStorageSettingsModal();
		releaseSetup();
		assert.equal(await setupTask, false);
		assert.equal(state.currentDistrict.savedFilePassword, undefined);
		assert.equal(document.getElementById('d-save-password-optin').checked, false);
		assert.equal(cryptoLib.isStorageEncrypted(), false);
		assert.equal(localStorage.getItem('kogai_auth_meta'), null);
		assert.equal(alerts.length, 0);
	} finally { global.setupStorageEncryption = origSetup; }

	// 4. handleAddOrUpdateBiometric aborted by closing settings modal, lockStorage, OR auth metadata removal suppresses storage write, modal reopen, & alert on both PRF resolve and NotAllowedError reject
	const origCreate = navigator.credentials.create.bind(navigator.credentials);
	try {
		for (const abortKind of ['closeModal', 'lock', 'authRemoved']) {
			for (const credOutcome of ['resolve', 'reject']) {
				cryptoLib.clearStorageSecurity();
				prepareWithAlerts();
				await cryptoLib.setupStorageEncryption('MasterBiometricPass123!', false);
				assert.equal(JSON.parse(localStorage.getItem('kogai_auth_meta')).webauthn, null);
				app.openStorageSettingsModal();
				assert.equal(document.getElementById('storage-settings-modal').style.display, 'flex');
				let settleBio;
				navigator.credentials.create = () => new Promise((resolve, reject) => {
					settleBio = () => credOutcome === 'resolve'
						? resolve({ rawId: new Uint8Array([9, 8, 7]), getClientExtensionResults: () => ({ prf: { results: { first: new Uint8Array(32).fill(5) } } }) })
						: reject(new Error('NotAllowedError'));
				});
				const bioTask = app.handleAddOrUpdateBiometric();
				while (!settleBio) await new Promise(r => setImmediate(r));
				if (abortKind === 'closeModal') app.closeStorageSettingsModal();
				else if (abortKind === 'lock') cryptoLib.lockStorage();
				else localStorage.removeItem('kogai_auth_meta');
				settleBio();
				assert.equal(await bioTask, false, `${abortKind}:${credOutcome} returns false`);
				assert.equal(cryptoLib.isStorageUnlocked(), abortKind === 'closeModal');
				if (abortKind === 'closeModal') {
					assert.notEqual(document.getElementById('storage-settings-modal').style.display, 'flex');
				}
				if (abortKind === 'authRemoved') assert.equal(localStorage.getItem('kogai_auth_meta'), null);
				else assert.equal(JSON.parse(localStorage.getItem('kogai_auth_meta')).webauthn, null);
				assert.equal(alerts.length, 0, `${abortKind}:${credOutcome} suppresses alerts`);
			}
		}
	} finally { navigator.credentials.create = origCreate; }
});

test('security SEC-27: all 14 import handlers silently abort on STORAGE_SESSION_CHANGED without safePrompt or alert; exportSingleDistrictFromRep validates confirm and clipboard fallback; officer vs neighbor print lock guards', async () => {
	const alerts = [];
	let prompts = 0;
	const resetPerCheck = () => {
		prepare();
		alerts.length = 0;
		prompts = 0;
		global.safePrompt = () => { prompts++; return 'RetryPass123!'; };
		global.alert = m => alerts.push(m);
		document.getElementById('hata-line-text').value = '';
		document.getElementById('hata-line-text').hidden = true;
		document.getElementById('neighbor-paste-box').value = '';
	};
	resetPerCheck();
	const sampleCipher = await cryptoLib.encryptPayload(JSON.stringify({ district: '読込', officers: [], students: [], neighborhood: [] }), 'Submission123!');
	const origSubtleDecrypt = globalThis.crypto.subtle.decrypt;
	let releaseDecrypt;
	globalThis.crypto.subtle.decrypt = async (...args) => {
		await new Promise(resolve => { releaseDecrypt = resolve; });
		return origSubtleDecrypt.apply(globalThis.crypto.subtle, args);
	};
	try {
		const gen = cryptoLib.getStorageSessionGeneration();
		const p = cryptoLib.parseTxtContent(sampleCipher, 'WrongPass123!', gen);
		while (!releaseDecrypt) await new Promise(r => setImmediate(r));
		cryptoLib.lockStorage();
		releaseDecrypt();
		releaseDecrypt = null;
		await assert.rejects(p, err => err && (err.message === 'STORAGE_SESSION_CHANGED' || err.code === 'STORAGE_SESSION_CHANGED'));
	} finally { globalThis.crypto.subtle.decrypt = origSubtleDecrypt; }

	// All 14 import paths abort silently when session locks mid-parse (2nd file in loadMultipleDistrictFiles & renderRepAll DOM overwrite skipped)
	const origParse = global.parseTxtContent;
	let secondFileProcessed = false;
	const fileObj = name => ({ name, text: async () => { if (name === 'second.txt') secondFileProcessed = true; return sampleCipher; } });
	global.parseTxtContent = async (_text, _pass, generation) => {
		cryptoLib.lockStorage();
		cryptoLib.assertStorageSession(generation);
	};
	try {
		const importers = [
			() => district.loadDistrictTxt({ target: { files: [fileObj('a.txt')], value: 'a.txt' } }),
			() => district.loadPastedTextToDistrict(),
			() => district.loadTransferFileIntoDistrict({ target: { files: [fileObj('t.txt')], value: 't.txt' } }),
			() => district.loadPastedTransferTextIntoDistrict(),
			() => district.loadNeighborFileIntoDistrict({ target: { files: [fileObj('n.txt')], value: 'n.txt' } }),
			() => district.loadPastedNeighborTextIntoDistrict(),
			async () => {
				state.repState.districts = [{ district: '既存保持地区', officers: [], students: [], neighborhood: [] }];
				document.getElementById('rep-districts-tbody').innerHTML = 'SENTINEL_NO_REDRAW';
				await rep.loadMultipleDistrictFiles({ target: { files: [fileObj('first.txt'), fileObj('second.txt')], value: 'first.txt' } });
				assert.equal(document.getElementById('rep-districts-tbody').innerHTML, 'SENTINEL_NO_REDRAW', 'Aborted loadMultipleDistrictFiles never re-renders');
				assert.equal(state.repState.districts.length, 1);
			},
			() => rep.loadPastedTextToRep(),
			() => rep.loadRepMasterTxt({ target: { files: [fileObj('m.txt')], value: 'm.txt' } }),
			() => rep.loadTransferFileIntoRep({ target: { files: [fileObj('tr.txt')], value: 'tr.txt' } }),
			() => rep.loadPastedTransferTextIntoRep(),
			() => neighbor.loadNeighborTxt({ target: { files: [fileObj('nb.txt')], value: 'nb.txt' } }),
			() => neighbor.loadPastedTextToNeighbor()
		];
		for (const fn of importers) {
			resetPerCheck();
			document.getElementById('d-paste-box').value = sampleCipher;
			document.getElementById('d-transfer-paste-box').value = sampleCipher;
			document.getElementById('d-neighbor-paste-box').value = sampleCipher;
			document.getElementById('rep-paste-box').value = sampleCipher;
			document.getElementById('rep-transfer-paste-box').value = sampleCipher;
			document.getElementById('neighbor-paste-box').value = sampleCipher;
			await fn();
			assert.equal(prompts, 0);
			assert.equal(alerts.length, 0);
		}
		assert.equal(secondFileProcessed, false);

		// Two-stage flow on loadNeighborTxt: 1st decrypt wrong password -> safePrompt retry -> lock during 2nd parseTxtContent aborts without 3rd prompt/alert
		resetPerCheck();
		document.getElementById('neighbor-import-pass').value = 'WrongPass1!';
		let attempt = 0;
		global.parseTxtContent = async (_text, _pass, generation) => {
			attempt++;
			if (attempt === 1) throw new Error('復号失敗');
			cryptoLib.lockStorage();
			cryptoLib.assertStorageSession(generation);
		};
		await neighbor.loadNeighborTxt({ target: { files: [fileObj('retry.txt')], value: 'retry.txt' } });
		assert.equal(prompts, 1);
		assert.equal(alerts.length, 0);

		// loadHataOfficialFile entry lock check (no file.text read, value cleared, hata intact) AND mid-read lock check
		resetPerCheck();
		state.currentDistrict.hata = { title: '元の旗振り設定' };
		await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
		cryptoLib.lockStorage();
		let textCalls = 0;
		const lockedInput = { files: [{ name: 'h.json', text: async () => { textCalls++; return '{"title":"侵害"}'; } }], value: 'h.json' };
		await global.loadHataOfficialFile({ target: lockedInput });
		assert.equal(textCalls, 0);
		assert.equal(lockedInput.value, '');
		assert.equal(state.currentDistrict.hata.title, '元の旗振り設定');
		assert.equal(alerts.length, 0);

		for (const payloadText of ['{"title":"読込中ロック改変"}', '', '{invalid']) {
			resetPerCheck();
			state.currentDistrict.hata = { title: '元の旗振り設定' };
			await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
			let resolveRead;
			const midReadInput = { files: [{ name: 'h.json', text: () => new Promise(r => { resolveRead = () => r(payloadText); }) }], value: 'h.json' };
			const readTask = global.loadHataOfficialFile({ target: midReadInput });
			while (!resolveRead) await new Promise(r => setImmediate(r));
			cryptoLib.lockStorage();
			resolveRead();
			await readTask;
			assert.equal(state.currentDistrict.hata.title, '元の旗振り設定');
			assert.equal(alerts.length, 0, `No alert when locked mid-read for ${JSON.stringify(payloadText)}`);
		}
	} finally { global.parseTxtContent = origParse; }

	// exportSingleDistrictFromRep confirm check (for #rep-pass only, bypassed on explicitPass & safePrompt), >2000 char line & mail clipboard fallback, and writeText post-lock suppression
	resetPerCheck();
	document.getElementById('rep-pass').value = 'Submission123!';
	document.getElementById('rep-pass-confirm').value = 'Mismatch123!';
	assert.equal(await rep.exportSingleDistrictFromRep(0, '', 'download'), false);
	assert.ok(alerts.some(m => m.includes('一致')));

	// explicitPass & safePrompt ignore #rep-pass-confirm mismatch
	global.downloadTextFile = () => {};
	assert.equal(await rep.exportSingleDistrictFromRep(0, 'Submission123!', 'download'), true);
	resetPerCheck();
	document.getElementById('rep-pass').value = '';
	document.getElementById('rep-pass-confirm').value = 'MismatchOnlyWhenCardUsed!';
	global.safePrompt = () => 'Submission123!';
	global.downloadTextFile = () => {};
	assert.equal(await rep.exportSingleDistrictFromRep(0, '', 'download'), true);

	// >2000 char line & mail fallback (both normal notice URL without ciphertext and resolve/reject lock mid-clipboard-fallback)
	resetPerCheck();
	state.currentDistrict.students = Array.from({ length: 40 }, (_, i) => ({ lastName: `児童${i}`, firstName: '太郎', address: `1-${i}-1`, grade: '1', class: '1' }));
	state.repState.districts = [structuredClone(state.currentDistrict)];
	const origLoc = window.location;
	const origOpen = global.open;
	try {
		for (const mode of ['line', 'mail']) {
			let copied = '';
			const openedUrls = [];
			navigator.clipboard.writeText = async txt => { copied = txt; };
			global.open = url => { openedUrls.push(url); };
			window.location = global.location = { href: '' };
			global.confirm = () => true;
			assert.equal(await rep.exportSingleDistrictFromRep(0, 'Submission123!', mode), true);
			assert.ok(copied.length > 2000, `${mode} copies full content to clipboard when > 2000`);
			if (mode === 'line') {
				assert.equal(openedUrls.length, 1);
				assert.match(openedUrls[0], /^https:\/\/line\.me\/R\/msg\/text\/\?/);
				assert.equal(openedUrls[0].includes('BEGIN_DATA'), false);
			} else {
				assert.match(window.location.href, /^mailto:/);
				assert.equal(window.location.href.includes('BEGIN_DATA'), false);
			}

			// Lock mid-writeText (both resolve and reject) during >2000 fallback suppresses subsequent navigation/alerts
			for (const fallbackOutcome of ['resolve', 'reject']) {
				resetPerCheck();
				state.currentDistrict.students = Array.from({ length: 40 }, (_, i) => ({ lastName: `児童${i}`, firstName: '太郎', address: `1-${i}-1`, grade: '1', class: '1' }));
				state.repState.districts = [structuredClone(state.currentDistrict)];
				openedUrls.length = 0;
				global.open = url => { openedUrls.push(url); };
				window.location = global.location = { href: '' };
				let resClip, rejClip;
				navigator.clipboard.writeText = () => new Promise((res, rej) => { resClip = res; rejClip = rej; });
				const tFallback = rep.exportSingleDistrictFromRep(0, 'Submission123!', mode);
				while (!resClip) await new Promise(r => setImmediate(r));
				cryptoLib.lockStorage();
				if (fallbackOutcome === 'resolve') resClip();
				else rejClip(new Error('fallback clipboard denied'));
				assert.equal(await tFallback, false);
				assert.equal(openedUrls.length, 0);
				assert.equal(window.location.href, '');
				assert.equal(alerts.length, 0);
			}
		}
	} finally {
		window.location = global.location = origLoc;
		global.open = origOpen;
	}

	// exportSingleDistrictFromRep & neighbor/transfer/hata post-lock clipboard suppression & pre-DOM #hata-line-text guard
	for (const item of [
		{ name: 'rep', fn: () => rep.exportSingleDistrictFromRep(0, 'Submission123!', 'copy') },
		{ name: 'neighbor', fn: () => neighbor.copyNeighborEncryptedText(), assertPasteEmptyOnReject: true },
		{ name: 'transfer', fn: () => transfer.copyTransferEncryptedText() },
		{
			name: 'hata',
			isHata: true,
			fn: () => {
				state.currentDistrict.hata = { title: 'テスト', startDate: '2026-04-06', endDate: '2026-04-10', members: '田中', weekdays: [1, 2, 3, 4, 5], schedule: [{ date: '2026-04-06', day: '月', type: 'regular', person: '田中' }] };
				global.renderHataSchedulePreview();
				return global.copyHataForLine();
			}
		}
	]) {
		for (const outcome of ['resolve', 'reject']) {
			resetPerCheck();
			let resolveClip, rejectClip;
			navigator.clipboard.writeText = () => new Promise((res, rej) => { resolveClip = res; rejectClip = rej; });
			const t = item.fn();
			while (!resolveClip) await new Promise(r => setImmediate(r));
			cryptoLib.lockStorage();
			if (outcome === 'resolve') resolveClip();
			else rejectClip(new Error('clipboard rejected'));
			await t;
			assert.equal(alerts.length, 0, `${item.name}:${outcome} suppresses alerts`);
			if (item.assertPasteEmptyOnReject && outcome === 'reject') {
				assert.equal(document.getElementById('neighbor-paste-box').value, '', 'Rejected neighbor copy does not expose cipher in paste box after lock');
			}
			if (item.isHata) {
				assert.equal(document.getElementById('hata-line-text').value, '');
				assert.equal(document.getElementById('hata-line-text').hidden, true);
			}
		}
	}

	// copyHataForLine pre-DOM check when already locked even with generated schedule
	resetPerCheck();
	state.currentDistrict.hata = { title: 'テスト', startDate: '2026-04-06', endDate: '2026-04-10', members: '田中', weekdays: [1, 2, 3, 4, 5], schedule: [{ date: '2026-04-06', day: '月', type: 'regular', person: '田中' }] };
	global.renderHataSchedulePreview();
	await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
	cryptoLib.lockStorage();
	document.getElementById('hata-line-text').value = '';
	document.getElementById('hata-line-text').hidden = true;
	await global.copyHataForLine();
	assert.equal(document.getElementById('hata-line-text').value, '');
	assert.equal(document.getElementById('hata-line-text').hidden, true);

	// Print lock distinction: officer prints abort on pre-lock or mid-print lock & clear #print-area, while neighbor prints work when locked (E-10-01) and clear only on session change
	resetPerCheck();
	await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = true;
	let prints = 0;
	window.print = () => { prints++; if (prints === 1) cryptoLib.lockStorage(); };
	document.getElementById('print-area').innerHTML = '<p>old</p>';
	print.printSingleDistrictSeparately();
	assert.equal(prints, 1);
	assert.equal(document.getElementById('print-area').innerHTML, '');

	// Pre-locked printSingleDistrictSeparately, executeRepSelectedPrint, printSingleDistrictSelected, printHataSchedule all abort & clear #print-area
	const origQsaSaved = document.querySelectorAll;
	state.repState.districts = [{ ...structuredClone(state.currentDistrict), selectedForPrint: true }];
	prints = 0;
	try {
		document.querySelectorAll = sel => sel === '.rep-print-chk:checked'
			? [{ value: 'officers_pta', checked: true }]
			: origQsaSaved.call(document, sel);
		for (const fn of [() => print.printSingleDistrictSeparately(), () => print.executeRepSelectedPrint(), () => print.printSingleDistrictSelected(), () => global.printHataSchedule()]) {
			document.getElementById('print-area').innerHTML = '<p>stale</p>';
			fn();
			assert.equal(prints, 0);
			assert.equal(document.getElementById('print-area').innerHTML, '');
		}
	} finally { document.querySelectorAll = origQsaSaved; }

	// Officer prints locking mid-window.print() render first and then clear #print-area on exit
	for (const fn of [
		() => { document.getElementById('d-print-students').checked = true; print.printSingleDistrictSelected(); },
		() => {
			const origQsa = document.querySelectorAll;
			document.querySelectorAll = sel => sel === '.rep-print-chk:checked'
				? [{ value: 'officers_pta', checked: true }]
				: origQsa.call(document, sel);
			try { print.executeRepSelectedPrint(); } finally { document.querySelectorAll = origQsa; }
		},
		() => {
			document.getElementById('print-area').innerHTML = '<p>stale</p>';
			state.currentDistrict.hata = { title: '旗', startDate: '2026-04-06', endDate: '2026-04-10', members: '田中', weekdays: [1, 2, 3, 4, 5], schedule: [{ date: '2026-04-06', day: '月', type: 'regular', person: '田中' }] };
			global.printHataSchedule();
		}
	]) {
		resetPerCheck();
		await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
		state.repState.districts = [{ ...structuredClone(state.currentDistrict), selectedForPrint: true }];
		let lockedDuringPrint = false;
		window.print = () => {
			lockedDuringPrint = true;
			cryptoLib.lockStorage();
		};
		fn();
		assert.equal(lockedDuringPrint, true);
		assert.equal(document.getElementById('print-area').innerHTML, '');
		assert.equal(document.body.children.some(el => el.id === 'hata-print-active-sheet'), false);
	}

	// Neighbor prints succeed when storage is ALREADY locked (E-10-01) and clear #print-area if outputIsCurrent flips mid-print
	resetPerCheck();
	await cryptoLib.setupStorageEncryption('MasterLockPass123!', false);
	cryptoLib.lockStorage();
	state.neighborState = { district: '下町', neighborhood: [{ role: '会長', lastName: '田中', firstName: '一郎' }] };
	for (const neighborPrintFn of [() => neighbor.printNeighborRoster(), () => neighbor.printNeighborTentCards()]) {
		prints = 0;
		window.print = () => { prints++; };
		neighborPrintFn();
		assert.equal(prints, 1);

		// Session change mid-print clears #print-area
		prints = 0;
		document.getElementById('print-area').innerHTML = '';
		window.print = () => { prints++; cryptoLib.lockStorage(); };
		neighborPrintFn();
		assert.equal(document.getElementById('print-area').innerHTML, '');
	}
});
