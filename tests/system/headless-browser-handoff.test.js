const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function scenario(name, run, options = {}) {
	test(name, async () => {
		const result = await runInHeadlessChrome(run, options);
		assert.equal(result.success, true, JSON.stringify({ fatal: result.fatal, failures: result.results.filter(item => !item.passed) }));
		assert.deepEqual(result.errors, []);
		assert.ok(result.results.length > 0);
	});
}

scenario('UI handoff: LINE warning, encrypted file, unfinished transfer and unsaved representative draft survive browser migration', async () => {
	assert.ok(ui.visible('#line-browser-notice'), 'LINE UA displays the warning');
	await ui.expand('district');
	ui.fill('#d-name', '引き継ぎ地区');
	ui.fill('#hata-members', 'HANDOFF_PRIVATE_CANARY_47918');
	await ui.mode('transfer');
	ui.fill('#transfer-children-container [data-field="lastName"]', '入力途中');
	assert.strictEqual(transferState.children[0].firstName, '', 'Required submission fields are still incomplete');
	await ui.mode('rep');
	await ui.expand('rep');
	repState.districts = [{ district: '集約地区', officers: [{ lastName: '原本' }], students: [], neighborhood: [] }];
	renderRepAll();
	await ui.click('[data-click="openRepDistrictDetailModal"][data-index="0"]');
	ui.fill('#rep-modal-officer-tbody [data-field="lastName"]', '未確定の編集');
	assert.strictEqual(repState.districts[0].officers[0].lastName, '原本', 'The representative editor remains a draft');
	await ui.click('#rep-district-detail-modal [data-click="openBrowserHandoff"]');
	ui.fill('#handoff-create-pass', 'HandoffTest123!');
	ui.fill('#handoff-confirm-pass', 'HandoffTest123!');
	ui.captureDownloads();
	ui.clipboard();
	await ui.click('[data-click="createBrowserHandoff"]');
	await ui.waitFor(() => !ui.element('#handoff-result').hidden, 'Encrypted migration is ready');
	const encrypted = ui.element('#handoff-output').value;
	assert.ok(encrypted.startsWith('ENC:2:') && !encrypted.includes('HANDOFF_PRIVATE_CANARY_47918'), 'Handoff contains no plaintext private name');
	const decoded = JSON.parse(await decryptPayload(encrypted, 'HandoffTest123!'));
	assert.strictEqual(decoded.repDraft.district.officers[0].lastName, '未確定の編集', 'Unsaved representative editor is captured separately');
	assert.strictEqual(decoded.models[1].districts[0].officers[0].lastName, '原本', 'The original representative record is captured without committing the draft');
	await ui.click('[data-click="copyBrowserHandoff"]');
	await ui.waitFor(() => window.__copiedText === encrypted, 'Encrypted clipboard copy');
	await ui.click('[data-click="saveBrowserHandoff"]');
	assert.strictEqual(__downloads[0].content, encrypted, 'Download contains the encrypted migration');
	await clearStorageSecurity();
	clearMemoryAndDomForLock();
	assert.strictEqual(localStorage.getItem('kogai_district_v2'), null, 'Destination starts with no shared source storage');
	await ui.click('header [data-click="openBrowserHandoff"]');
	await ui.file('#handoff-file', encrypted, 'handoff.txt');
	ui.fill('#handoff-restore-pass', 'HandoffTest123!');
	await ui.click('[data-click="restoreBrowserHandoff"]');
	await ui.waitFor(() => !ui.element('#browser-handoff-dialog').open, 'Encrypted file restored in destination');
	assert.strictEqual(currentDistrict.hata.members, 'HANDOFF_PRIVATE_CANARY_47918', 'All flag settings survive migration');
	assert.strictEqual(transferState.children[0].lastName, '入力途中', 'Incomplete transfer draft restored');
	assert.strictEqual(transferState.children[0].firstName, '', 'Incomplete fields remain incomplete');
	assert.strictEqual(getModalCurrentDistrict().officers[0].lastName, '未確定の編集', 'Unsaved representative modal is reopened with its draft');
	assert.strictEqual(repState.districts[0].officers[0].lastName, '原本', 'Migration does not implicitly save the representative draft');
	await ui.click('[data-click="closeRepDistrictDetailModalWithoutSaving"]');
	assert.strictEqual(repState.districts[0].officers[0].lastName, '原本', 'Discarding restored editor still preserves the original');
	assert.strictEqual(ui.element('#handoff-restore-pass').value, '', 'Migration password is cleared');
	assert.ok(document.documentElement.scrollWidth <= innerWidth + 1, 'Warning and migration UI fit a phone');
}, { viewport: [375, 812], beforeLoad: () => {
	Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Line/16.0.0' });
}, afterReload: async () => {
	assert.strictEqual(currentDistrict.hata.members, 'HANDOFF_PRIVATE_CANARY_47918', 'Flag settings remain after an actual destination restart');
	assert.strictEqual(transferState.children[0].lastName, '入力途中', 'Destination saves incomplete drafts durably');
	assert.strictEqual(repState.districts[0].officers[0].lastName, '原本', 'Discarded draft does not overwrite the saved original after restart');
} });

scenario('UI handoff: wrong password, cancelled replacement, pasted data and clipboard fallback preserve originals', async () => {
	assert.ok(!ui.visible('#line-browser-notice'), 'Ordinary browser does not display the LINE warning');
	await ui.click('header [data-click="openBrowserHandoff"]');
	ui.fill('#handoff-create-pass', 'short'); ui.fill('#handoff-confirm-pass', 'different');
	await ui.click('[data-click="createBrowserHandoff"]');
	await ui.waitFor(() => ui.element('#handoff-status').textContent.includes('失敗'), 'Invalid creation password reported');
	ui.fill('#handoff-create-pass', 'HandoffTest123!'); ui.fill('#handoff-confirm-pass', 'HandoffTest123!');
	await ui.click('[data-click="createBrowserHandoff"]');
	await ui.waitFor(() => !ui.element('#handoff-result').hidden, 'Migration created');
	const text = ui.element('#handoff-output').value;
	ui.clipboard(true);
	await ui.click('[data-click="copyBrowserHandoff"]');
	await ui.waitFor(() => ui.element('#handoff-status').textContent.includes('手動でコピー'), 'Clipboard denial has a selectable fallback');
	ui.fill('#handoff-input', text);
	ui.fill('#handoff-restore-pass', 'WrongPassword123!');
	const models = JSON.stringify([currentDistrict, repState, neighborState, transferState]);
	const stored = JSON.stringify({ ...localStorage });
	await ui.click('[data-click="restoreBrowserHandoff"]');
	await ui.waitFor(() => ui.element('#handoff-status').textContent.includes('失敗'), 'Wrong migration password rejected');
	assert.strictEqual(JSON.stringify([currentDistrict, repState, neighborState, transferState]), models, 'Wrong password keeps every live model');
	assert.strictEqual(JSON.stringify({ ...localStorage }), stored, 'Wrong password keeps every saved value');
	window.__confirmAnswer = false;
	ui.fill('#handoff-restore-pass', 'HandoffTest123!');
	await ui.click('[data-click="restoreBrowserHandoff"]');
	await ui.waitFor(() => ui.element('#handoff-status').textContent.includes('取り消し'), 'User cancels replacement');
	assert.strictEqual(JSON.stringify({ ...localStorage }), stored, 'Cancellation keeps every saved value');
	window.__confirmAnswer = true;
	await ui.click('[data-click="restoreBrowserHandoff"]');
	await ui.waitFor(() => !ui.element('#browser-handoff-dialog').open, 'Pasted ciphertext restored');
});

scenario('UI handoff: Escape and locking invalidate asynchronous encryption and clear migration fields', async () => {
	await ui.click('header [data-click="openBrowserHandoff"]');
	ui.fill('#handoff-create-pass', 'HandoffTest123!');
	await ui.key('Escape');
	assert.ok(!ui.element('#browser-handoff-dialog').open, 'Escape closes the native dialog');
	assert.strictEqual(ui.element('#handoff-create-pass').value, '', 'Escape clears the password');
	await ui.click('header [data-click="openBrowserHandoff"]');
	ui.fill('#handoff-create-pass', 'HandoffTest123!'); ui.fill('#handoff-confirm-pass', 'HandoffTest123!');
	let complete;
	window.encryptPayload = () => new Promise(resolve => { complete = resolve; });
	const task = createBrowserHandoff();
	await ui.waitFor(() => complete, 'Encryption is actually in flight');
	lockStorage(); clearMemoryAndDomForLock();
	complete('ENC:2:LATE_RESULT');
	await task;
	assert.ok(!ui.element('#browser-handoff-dialog').open, 'Lock closes migration dialog');
	assert.strictEqual(ui.element('#handoff-output').value, '', 'Old encryption cannot refill the cleared output');
	assert.strictEqual(ui.element('#handoff-status').textContent, '', 'Old encryption cannot update the locked UI');
});
