const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function prepareAccess() {
	ui.secure = async () => {
		if (!ui.visible('#storage-settings-modal')) await ui.click('#storage-security-badge');
		ui.fill('#modal-set-pass', 'DeviceDatabase123!');
		ui.fill('#modal-set-pass-confirm', 'DeviceDatabase123!');
		await ui.click('#modal-btn-enable-enc');
		await ui.waitFor(() => isStorageEncrypted() && isStorageUnlocked() && !ui.visible('#storage-settings-modal'), 'Actual database encryption');
	};
}
function browserTest(name, run, options = {}) {
	test(name, async () => {
		const out = await runInHeadlessChrome(run, { autoSecure: false, prepare: prepareAccess, ...options });
		assert.equal(out.success, true, JSON.stringify(out.fatal || out.results.filter(row => !row.passed)));
		assert.deepEqual(out.errors, []);
		assert.ok(out.results.length > 0);
	});
}

browserTest('Access: initial encryption is mandatory, explicit about purpose, cancel keeps officers blocked and permits guest modes', async () => {
	assert.ok(ui.visible('#storage-settings-modal'), 'First officer access requires setup');
	assert.ok(ui.element('#settings-modal-body').textContent.includes('デバイス上のデータベース'), 'Device database purpose is explicit');
	assert.ok(ui.element('#settings-modal-body').textContent.includes('出力・提出用'), 'Submission password is distinguished');
	assert.ok(!ui.visible('#tab-district'), 'Officer form hidden before setup');
	ui.fill('#modal-set-pass', 'short'); ui.fill('#modal-set-pass-confirm', 'short');
	await ui.click('#modal-btn-enable-enc');
	assert.ok(!isStorageEncrypted() && !ui.visible('#tab-district'), 'Short password never grants access');
	ui.fill('#modal-set-pass', 'DeviceDatabase123!'); ui.fill('#modal-set-pass-confirm', 'Different123!');
	await ui.click('#modal-btn-enable-enc');
	assert.ok(!isStorageEncrypted() && !ui.visible('#tab-district'), 'Mismatch never grants access');
	await ui.click('#storage-settings-modal [data-click="closeStorageSettingsModal"]');
	assert.strictEqual(document.getElementById('modal-set-pass'), null, 'Closing destroys password fields');
	assert.strictEqual(await saveStorageData('kogai_district_v2', { district: '禁止' }), false, 'Storage layer rejects plaintext officer save');
	assert.strictEqual(localStorage.getItem('kogai_district_v2'), null, 'No plaintext is written');
	await ui.mode('transfer');
	assert.ok(ui.visible('#transfer-address'), 'Family form is usable without setup');
	await ui.mode('neighbor');
	assert.ok(ui.visible('#tab-neighbor'), 'Neighborhood mode is reachable');
	await ui.mode('rep');
	assert.ok(ui.visible('#storage-settings-modal') && !ui.visible('#tab-rep'), 'Representative also requires encryption');
	await ui.secure();
	assert.ok(ui.visible('#tab-rep'), 'Successful setup grants officer access');
	assert.ok(localStorage.getItem('kogai_rep_v2').startsWith('STORAGE_ENC:2:'), 'Real ciphertext persisted');
}, { viewport: [390, 844] });

browserTest('Access: locked restart permits family input and encrypted output without changing the saved database', async () => {
	await ui.secure();
	await ui.expand('district'); ui.fill('#d-name', '保存済み秘密地区'); await saveDistrictLocal();
}, { afterReload: async () => {
	assert.ok(ui.visible('#storage-lock-modal') && !ui.visible('#tab-district'), 'Restart starts locked');
	const snapshot = JSON.stringify(STORAGE_DATA_KEYS.map(key => localStorage.getItem(key)));
	ui.fill('#modal-unlock-pass', 'WrongPassword123!');
	await ui.click('[data-click="handlePasswordUnlock"]');
	await ui.waitFor(() => ui.element('#modal-unlock-error').textContent, 'Wrong password rejected');
	assert.ok(!ui.visible('#tab-district'), 'Wrong password grants no access');
	await ui.click('#storage-lock-modal [data-click="switchTab"][data-mode="transfer"]');
	assert.ok(ui.visible('#transfer-address'), 'Family form usable while database remains locked');
	assert.ok(ui.visible('#guest-storage-notice'), 'Temporary input is explained');
	ui.fill('#transfer-address', '新規住所'); ui.fill('#transfer-tel', '09012345678');
	ui.fill('.transfer-child-row [data-field="lastName"]', '新規');
	ui.fill('.transfer-child-row [data-field="firstName"]', '児童');
	ui.fill('#transfer-export-pass', 'Submission123!'); ui.fill('#transfer-export-pass-confirm', 'Submission123!');
	ui.captureDownloads(); await ui.click('#btn-export-transfer-txt');
	await ui.waitFor(() => __downloads.length === 1, 'Guest creates encrypted submission');
	assert.ok(__downloads[0].content.includes('ENC:2:'), 'Guest output is encrypted');
	assert.strictEqual(JSON.stringify(STORAGE_DATA_KEYS.map(key => localStorage.getItem(key))), snapshot, 'All saved ciphertext stays intact');
	await ui.mode('neighbor'); await ui.mode('district');
	ui.fill('#modal-unlock-pass', 'DeviceDatabase123!');
	await ui.click('[data-click="handlePasswordUnlock"]');
	await ui.waitFor(() => isStorageUnlocked() && !ui.visible('#storage-lock-modal'), 'Correct database password unlocks');
	assert.strictEqual(currentDistrict.district, '保存済み秘密地区', 'Original database recovered');
	assert.strictEqual(ui.element('#modal-unlock-pass').value, '', 'Unlock password cleared');
} });

for (const width of [375, 390, 1280]) {
	browserTest(`Hata normal: ${width}px all 120 counts are reachable by scrolling and toggling preserves totals`, async () => {
		await ui.secure(); await ui.expand('district'); await ui.click('#card-d-hata summary');
		ui.fill('#hata-start-date', '2026-11-02'); ui.fill('#hata-end-date', '2026-11-06');
		ui.fill('#hata-holidays', ''); ui.fill('#hata-specials', '2026-11-07,特別担当,行事');
		ui.fill('#hata-members', Array.from({ length: 120 }, (_, i) => '担当' + String(i).padStart(3, '0')).join('\n'));
		await ui.click('[data-click="runAutoHataGeneration"]');
		await ui.click('[data-click="toggleHataSummary"]');
		await new Promise(resolve => setTimeout(resolve, 400));
		const panel = ui.element('#hata-summary-accordion');
		assert.ok(panel.scrollHeight > panel.clientHeight, 'Large roster overflows summary');
		assert.strictEqual(getComputedStyle(panel).overflowY, 'auto', 'Expanded summary allows scrolling');
		panel.scrollTop = panel.scrollHeight;
		assert.ok(panel.scrollTop > 0, 'Scroll reaches later rows');
		const last = ui.element('#hata-summary-container .summary-item:last-child').getBoundingClientRect();
		const bounds = panel.getBoundingClientRect();
		assert.ok(last.bottom <= bounds.bottom + 1 && last.top >= bounds.top, 'Final member is visible at the end');
		assert.strictEqual(document.querySelectorAll('#hata-summary-container .summary-item').length, 120, 'Every member has a count');
		const summary = ui.element('#hata-summary-container').textContent;
		await ui.click('[data-click="toggleHataSummary"]'); await ui.click('[data-click="toggleHataSummary"]');
		assert.strictEqual(ui.element('#hata-summary-container').textContent, summary, 'Toggling preserves counts');
		assert.ok(document.documentElement.scrollWidth <= innerWidth + 1, 'Page fits viewport');
		markHataSaved();
	}, { viewport: [width, 844] });
}

browserTest('Privacy: text outside forms cannot be selected or copied; form selection and explicit copies remain usable', async () => {
	await ui.click('#storage-settings-modal [data-click="switchTab"][data-mode="transfer"]');
	const outside = ui.element('header');
	assert.strictEqual(getComputedStyle(outside).userSelect, 'none', 'Outside selection disabled');
	const field = ui.element('#transfer-address'); ui.fill(field, 'コピーできる住所'); field.select();
	assert.strictEqual(field.selectionEnd - field.selectionStart, field.value.length, 'Form text can be selected');
	field.focus();
	const insideCopy = new Event('copy', { bubbles: true, cancelable: true }); field.dispatchEvent(insideCopy);
	assert.ok(!insideCopy.defaultPrevented, 'Form copy permitted');
	outside.focus(); field.blur();
	for (const type of ['selectstart', 'copy', 'cut']) {
		const event = new Event(type, { bubbles: true, cancelable: true }); outside.dispatchEvent(event);
		assert.ok(event.defaultPrevented, 'Outside ' + type + ' is blocked');
	}
	ui.clipboard(); await shareAppUrl();
	assert.ok(__copiedText.includes('mode=transfer'), 'Explicit URL copy still works');
});

browserTest('Startup: hanging version fetch does not delay initialization or guest input', async () => {
	ui.fill('#transfer-address', '無応答でも入力可能');
	await new Promise(resolve => setTimeout(resolve, 1200));
	assert.ok(window.__versionRequested, 'Background version request starts');
	assert.strictEqual(ui.element('#transfer-address').value, '無応答でも入力可能', 'Input survives pending request');
	await ui.mode('neighbor'); assert.ok(ui.visible('#tab-neighbor'), 'Navigation remains usable');
}, { queryMode: 'transfer', beforeLoad: () => { window.fetch = () => { window.__versionRequested = true; return new Promise(() => {}); }; } });
