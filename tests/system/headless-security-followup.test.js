const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function prepareFollowup() {
	ui.delayCrypto = method => {
		const original = crypto.subtle[method].bind(crypto.subtle);
		let release;
		const barrier = new Promise(resolve => { release = resolve; });
		window.__cryptoStarted = false;
		crypto.subtle[method] = async (...args) => { window.__cryptoStarted = true; await barrier; return original(...args); };
		window.__releaseCrypto = () => { crypto.subtle[method] = original; release(); };
	};
	ui.track = name => {
		const original = window[name];
		window[name] = (...args) => { window.__securityTask = Promise.resolve(original(...args)); return window.__securityTask; };
	};
}
function securityTest(name, run, options = {}) {
	test(name, async () => {
		const result = await runInHeadlessChrome(run, { prepare: prepareFollowup, ...options });
		assert.equal(result.success, true, JSON.stringify(result.fatal || result.results.filter(item => !item.passed)));
		assert.deepEqual(result.errors, []);
		assert.ok(result.results.length > 0);
	});
}

securityTest('SEC-22: leaving setup while real encryption is pending never commits keys or replaces new guest input', async () => {
	const before = JSON.stringify(STORAGE_DATA_KEYS.map(key => localStorage.getItem(key)));
	ui.fill('#modal-set-pass', 'DeviceDatabase123!'); ui.fill('#modal-set-pass-confirm', 'DeviceDatabase123!');
	ui.delayCrypto('encrypt'); ui.track('handleEnableEncryptionSubmit');
	await ui.click('#modal-btn-enable-enc');
	await ui.waitFor(() => window.__cryptoStarted, 'Real encryption starts');
	await ui.click('#storage-settings-modal [data-click="switchTab"][data-mode="transfer"]');
	ui.fill('#transfer-address', '移動後の入力');
	__releaseCrypto(); await __securityTask;
	assert.ok(!isStorageEncrypted(), 'Abandoned setup never enables encryption');
	assert.strictEqual(localStorage.getItem(STORAGE_AUTH_KEY), null, 'No abandoned authentication metadata');
	// Guest autosave is allowed; officer storage must remain unchanged.
	assert.strictEqual(localStorage.getItem('kogai_district_v2'), JSON.parse(before)[0], 'Officer storage stays unchanged');
	assert.strictEqual(ui.element('#transfer-address').value, '移動後の入力', 'New guest input preserved');
	assert.ok(!ui.visible('#storage-settings-modal'), 'No stale setup dialog');
}, { autoSecure: false });

securityTest('SEC-22: leaving unlock while real decryption is pending keeps keys locked, ciphertext intact and guest input unchanged', async () => {
	await ui.expand('district'); ui.fill('#d-name', 'PRIVATE_BEFORE_LOCK'); await saveDistrictLocal();
	handleImmediateLock();
	const before = JSON.stringify(STORAGE_DATA_KEYS.map(key => localStorage.getItem(key)));
	ui.fill('#modal-unlock-pass', 'UiPassword1!'); ui.delayCrypto('decrypt'); ui.track('handlePasswordUnlock');
	await ui.click('[data-click="handlePasswordUnlock"]');
	await ui.waitFor(() => window.__cryptoStarted, 'Real unwrap starts');
	await ui.click('#storage-lock-modal [data-click="switchTab"][data-mode="transfer"]');
	ui.fill('#transfer-address', '新しい家庭入力');
	__releaseCrypto(); await __securityTask;
	assert.ok(!isStorageUnlocked(), 'Abandoned unlock never releases keys');
	assert.strictEqual(JSON.stringify(STORAGE_DATA_KEYS.map(key => localStorage.getItem(key))), before, 'Ciphertext untouched');
	assert.strictEqual(ui.element('#transfer-address').value, '新しい家庭入力', 'Late unlock never replaces guest input');
	assert.ok(!ui.visible('#storage-lock-modal'), 'Old unlock never reopens a modal over guest mode');
});

for (const action of ['exportDistrictTxt', 'shareDistrictData', 'exportRepMasterTxt', 'exportSingleDistrictFromRep', 'exportNeighborTxt', 'copyNeighborEncryptedText', 'exportTransferTxt', 'copyTransferEncryptedText']) {
	securityTest(`SEC-23: ${action} cancels output when locked during real encryption`, async () => {
		const action = window.__outputAction;
		if (action.includes('Transfer')) {
			await ui.mode('transfer');
			ui.fill('#transfer-address', 'PRIVATE_ADDRESS'); ui.fill('#transfer-tel', '09012345678');
			ui.fill('.transfer-child-row [data-field="lastName"]', '提出'); ui.fill('.transfer-child-row [data-field="firstName"]', '児童');
			ui.fill('#transfer-export-pass', 'Submission123!'); ui.fill('#transfer-export-pass-confirm', 'Submission123!');
		} else if (action.includes('Neighbor')) {
			await ui.mode('neighbor'); await ui.expand('neighbor');
			ui.fill('#neighbor-district-name', 'PRIVATE_NEIGHBOR');
			ui.fill('#neighbor-pass', 'Submission123!'); ui.fill('#neighbor-pass-confirm', 'Submission123!');
		} else if (action.includes('Rep')) {
			await ui.mode('rep'); await ui.expand('rep');
			repState.districts = [{ district: 'PRIVATE_REP', officers: [], students: [], neighborhood: [] }]; renderRepAll();
			ui.fill('#rep-pass', 'Submission123!'); ui.fill('#rep-pass-confirm', 'Submission123!');
		} else {
			await ui.expand('district'); ui.fill('#d-name', 'PRIVATE_DISTRICT');
			ui.fill('#d-pass', 'Submission123!'); ui.fill('#d-pass-confirm', 'Submission123!');
		}
		ui.captureDownloads(); ui.clipboard(); ui.delayCrypto('encrypt'); ui.track(action);
		if (action === 'shareDistrictData') await ui.click('[data-click="shareDistrictData"][data-mode="copy"]');
		else if (action === 'exportSingleDistrictFromRep') await ui.click('[data-click="exportSingleDistrictFromRep"][data-index="0"]');
		else await ui.click(`[data-click="${action}"]`);
		await ui.waitFor(() => window.__cryptoStarted, 'Actual file encryption is pending');
		await ui.click('#storage-security-badge'); await ui.click('[data-click="handleImmediateLock"]');
		__releaseCrypto(); await __securityTask;
		assert.strictEqual(__downloads.length, 0, 'No download after lock');
		assert.strictEqual(window.__copiedText, undefined, 'No clipboard output after lock');
		assert.ok(!document.querySelector('#neighbor-paste-box')?.value, 'No fallback output after lock');
		assert.ok(!isStorageUnlocked(), 'Output completion never reopens storage');
	}, { beforeLoad: new Function(`window.__outputAction = ${JSON.stringify(action)};`) });
}

for (const kind of ['neighbor', 'district']) {
	securityTest(`SEC-23: ${kind} denied clipboard cannot restore a fallback after lock`, async () => {
		const kind = window.__fallbackKind;
		if (kind === 'neighbor') {
			await ui.mode('neighbor'); await ui.expand('neighbor'); ui.fill('#neighbor-district-name', 'PRIVATE_NEIGHBOR');
			ui.fill('#neighbor-pass', 'Submission123!'); ui.fill('#neighbor-pass-confirm', 'Submission123!');
		} else {
			await ui.expand('district'); ui.fill('#d-name', 'PRIVATE_DISTRICT');
			ui.fill('#d-pass', 'Submission123!'); ui.fill('#d-pass-confirm', 'Submission123!');
			Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
		}
		let reject;
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => {
			window.__clipboardStarted = true; return new Promise((_, fail) => { reject = fail; });
		} } });
		const action = kind === 'neighbor' ? 'copyNeighborEncryptedText' : 'shareDistrictData';
		ui.track(action); ui.captureDownloads();
		await ui.click(kind === 'neighbor' ? '[data-click="copyNeighborEncryptedText"]' : '[data-click="shareDistrictData"][data-mode="share"]');
		await ui.waitFor(() => window.__clipboardStarted, 'OS clipboard request is pending');
		await ui.click('#storage-security-badge'); await ui.click('[data-click="handleImmediateLock"]');
		reject(new Error('Clipboard denied')); await __securityTask;
		assert.strictEqual(__downloads.length, 0, 'No fallback download after lock');
		assert.strictEqual(ui.element('#neighbor-paste-box').value, '', 'No fallback text after lock');
	}, { beforeLoad: new Function(`window.__fallbackKind = ${JSON.stringify(kind)};`) });
}
