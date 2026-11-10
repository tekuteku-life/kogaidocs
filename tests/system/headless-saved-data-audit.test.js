const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function prepareSavedAudit() {
	window.savedAudit = {
		password: 'SavedAudit123!', pending: {},
		models: () => JSON.stringify([currentDistrict, repState, neighborState, transferState]),
		stored: () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))),
		async file(action, selector, content, name = 'saved.txt') {
			const previous = this.pending[action];
			await ui.file(selector, content, name);
			await ui.waitFor(() => this.pending[action] && this.pending[action] !== previous, 'Actual file action starts');
			return await this.pending[action];
		},
		async flush() { await Promise.all([saveDistrictLocal(), saveRepLocal(), saveNeighborLocal(), saveTransferLocal()]); },
		noAttack() {
			assert.strictEqual(document.querySelectorAll('[data-saved-attack]').length, 0, 'Imported values never construct attack nodes');
			assert.strictEqual(window.__savedExecuted, undefined, 'Imported event code never runs');
		},
		async positive() {
			const img = new Image(); img.src = 'icons/icon-192.png?saved-audit-positive=1';
			await img.decode(); assert.ok(img.naturalWidth > 0, 'Network positive control loads');
		},
		async encrypt() {
			await ui.click('#storage-security-badge');
			ui.fill('#modal-set-pass', this.password); ui.fill('#modal-set-pass-confirm', this.password);
			await ui.click('#modal-btn-enable-enc');
			await ui.waitFor(() => !ui.visible('#storage-settings-modal') && isStorageEncrypted() && isStorageUnlocked(), 'Real storage encryption completes');
		}
	};
	for (const name of ['loadDistrictTxt', 'loadHataOfficialFile', 'loadRepMasterTxt', 'loadNeighborTxt', 'loadMultipleDistrictFiles', 'loadNeighborFileIntoDistrict', 'loadTransferFileIntoDistrict', 'loadTransferFileIntoRep', 'saveStorageData', 'restoreBrowserHandoff', 'createBrowserHandoff', 'handlePasswordUnlock']) {
		const original = window[name];
		window[name] = (...args) => { const task = original(...args); savedAudit.pending[name] = task; if (name === 'saveStorageData') task.catch(() => {}); return task; };
	}
}
function savedTest(name, run, options = {}) {
	test(name, async () => {
		const out = await runInHeadlessChrome(run, { prepare: prepareSavedAudit, ...options });
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }));
		assert.deepEqual(out.errors, [], 'No uncaught errors or rejected save Promises');
		assert.ok(out.results.length > 0);
		if (options.observeNetwork) {
			assert.ok(out.requests.some(request => request.url.includes('saved-audit-positive=1')), 'CDP observes the positive control');
			assert.ok(!JSON.stringify(out.requests).includes('SAVED_PRIVATE_58019'), 'Private canary never enters URL, headers or body');
			assert.ok(!out.requests.some(request => request.url.includes('saved-audit.invalid')), 'No attack destination requests');
		}
	});
}

savedTest('Saved-data UI: oversized roster strings, format and repetitive rows are rejected through actual file, paste and JSON controls', async () => {
	await ui.expand('district'); await ui.click('#card-d-hata summary');
	ui.fill('#d-name', '保持する地区'); ui.fill('#hata-members', '保持する担当');
	ui.fill('#d-pass', savedAudit.password); ui.fill('#d-pass-confirm', savedAudit.password);
	await savedAudit.flush();
	const original = savedAudit.models(), stored = savedAudit.stored();
	const configs = [
		{ members: Array.from({ length: 10001 }, (_, index) => `担当${index}`).join('\n') },
		{ format: 'x'.repeat(4097) },
		{ members: 'あ'.repeat(300), startDate: '2026-01-01', endDate: '2035-01-01', holidays: '', weekdays: [0, 1, 2, 3, 4, 5, 6] }
	];
	for (const config of configs) {
		const count = __dialogs.length;
		await savedAudit.file('loadHataOfficialFile', '#card-d-hata input[type="file"]', JSON.stringify(config), 'bad.json');
		assert.strictEqual(savedAudit.models(), original, 'Rejected JSON preserves all four models');
		assert.strictEqual(savedAudit.stored(), stored, 'Rejected JSON preserves every stored value');
		assert.ok(__dialogs.length > count, 'Invalid JSON produces notification');
		const data = { district: '拒否する地区', students: [], officers: [], neighborhood: [], hata: config };
		const encrypted = await encryptPayload(JSON.stringify(data), savedAudit.password);
		await savedAudit.file('loadDistrictTxt', '#d-file-in', encrypted);
		assert.strictEqual(savedAudit.models(), original, 'Authenticated bad district file preserves all models');
		assert.strictEqual(savedAudit.stored(), stored, 'Authenticated bad district file preserves storage');
		assert.strictEqual(ui.element('#d-file-in').value, '', 'File selection clears for retry');
		if (!ui.visible('#d-paste-box')) await ui.click('#btn-load-district-paste');
		ui.fill('#d-paste-box', encrypted);
		await ui.click('[data-click="loadPastedTextToDistrict"]');
		await savedAudit.pending.loadDistrictTxt;
		assert.strictEqual(ui.element('#d-paste-box').value, encrypted, 'Failed paste remains editable');
		assert.strictEqual(savedAudit.models(), original, 'Authenticated bad paste preserves models');
	}
	await savedAudit.file('loadHataOfficialFile', '#card-d-hata input[type="file"]', JSON.stringify({ title: '正常な再試行', members: '担当', holidays: '' }), 'bad.json');
	assert.strictEqual(currentDistrict.hata.title, '正常な再試行', 'The same filename can be retried successfully');
});

for (const encrypted of [false, true]) {
	savedTest(`Saved-data UI: ${encrypted ? 'encrypted' : 'plain'} over-limit stored data is rejected before replacing live models`, async () => {
		await ui.expand('district'); ui.fill('#d-name', '保持する地区');
		await savedAudit.flush();
		if (window.__savedEncrypted) await savedAudit.encrypt();
		const models = savedAudit.models(), dom = ui.element('#d-name').value;
		const bad = JSON.parse(JSON.stringify(currentDistrict)); bad.hata.members = Array.from({ length: 10001 }, (_, i) => `担当${i}`).join('\n');
		if (isStorageEncrypted()) {
			const meta = getStorageAuthMeta();
			const key = await unwrapKeyWithPassword(meta.password, savedAudit.password);
			localStorage.setItem('kogai_district_v2', await encryptStorageValue(bad, key, 'kogai_district_v2'));
		} else localStorage.setItem('kogai_district_v2', JSON.stringify(bad));
		const stored = savedAudit.stored();
		let rejected = false;
		try { await loadAppDataFromStorage(); } catch (_) { rejected = true; }
		assert.ok(rejected, 'Stored malformed model is rejected even with authentic encryption');
		assert.strictEqual(savedAudit.models(), models, 'Failed restore preserves live models');
		assert.strictEqual(ui.element('#d-name').value, dom, 'Failed restore preserves live DOM');
		assert.strictEqual(savedAudit.stored(), stored, 'Rejected saved originals remain intact');
	}, { beforeLoad: new Function(`window.__savedEncrypted = ${encrypted};`) });
}

savedTest('Saved-data UI: hostile format, exemption attributes and unfinished inputs survive encrypted import, storage restart, repair and print as literal text', async () => {
	await ui.expand('district'); await ui.click('#card-d-hata summary');
	await savedAudit.positive();
	const attack = `SAVED_PRIVATE_58019 \"'><img data-saved-attack src="https://saved-audit.invalid/collect" onerror="window.__savedExecuted=1"> {氏名}`;
	const config = { title: '攻撃文字列の保持', members: attack, format: '{氏名} / {住所}', holidays: '', specials: '', startDate: '2026-11-09', endDate: '2026-11-13', weekdays: [1, 2, 3, 4, 5], inputDrafts: { holidays: attack, format: attack } };
	const data = { district: '攻撃検査地区', students: [{ lastName: '{地区}', firstName: attack, address: '1-2' }], officers: [], neighborhood: [], hata: config };
	ui.fill('#d-pass', savedAudit.password); ui.fill('#d-pass-confirm', savedAudit.password);
	await savedAudit.file('loadDistrictTxt', '#d-file-in', await encryptPayload(JSON.stringify(data), savedAudit.password));
	assert.strictEqual(ui.element('#hata-format').value, attack, 'Unfinished format remains literal in its input');
	assert.strictEqual(ui.element('#hata-exempt-list input').dataset.memberName, attack, 'New exemption attribute decodes into the exact original text');
	await ui.click('#hata-exempt-list input');
	assert.ok(currentDistrict.hata.exemptHouseholds.includes(attack), 'Clicking hostile member data applies only the fixed exemption action');
	savedAudit.noAttack();
	await ui.click('header [data-click="openBrowserHandoff"]');
	ui.fill('#handoff-create-pass', savedAudit.password); ui.fill('#handoff-confirm-pass', savedAudit.password);
	await ui.click('[data-click="createBrowserHandoff"]'); await savedAudit.pending.createBrowserHandoff;
	const handoff = ui.element('#handoff-output').value;
	ui.fill('#handoff-input', handoff); ui.fill('#handoff-restore-pass', savedAudit.password);
	await ui.click('[data-click="restoreBrowserHandoff"]'); await savedAudit.pending.restoreBrowserHandoff;
	assert.strictEqual(ui.element('#hata-exempt-list input').dataset.memberName, attack, 'Handoff also preserves new attributes as inert data');
	savedAudit.noAttack();
	await savedAudit.encrypt();
	await savedAudit.flush();
}, { observeNetwork: true, allowFileAccess: true, afterReload: async () => {
	await ui.waitFor(() => ui.visible('#storage-lock-modal'), 'Encrypted restart is locked');
	ui.fill('#modal-unlock-pass', savedAudit.password);
	await ui.click('[data-click="handlePasswordUnlock"]'); await savedAudit.pending.handlePasswordUnlock;
	await ui.expand('district'); await ui.click('#card-d-hata summary');
	await savedAudit.positive();
	assert.ok(ui.element('#hata-holidays').value.includes('SAVED_PRIVATE_58019'), 'Raw malicious draft survives encrypted restart');
	savedAudit.noAttack();
	ui.fill('#hata-holidays', ''); ui.fill('#hata-format', '{氏名} / {住所}');
	await ui.click('#hata-exempt-list input');
	await ui.click('[data-click="syncHataMembersFromStudents"]');
	const expected = `{地区} ${currentDistrict.students[0].firstName} / 1-2`;
	assert.strictEqual(currentDistrict.hata.members, expected, 'Input data tokens are not expanded again');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.ok(ui.element('#hata-schedule-preview').textContent.includes(expected), 'Preview contains the complete literal value');
	let prints = 0;
	window.print = () => { prints++; assert.ok(ui.element('#hata-print-active-sheet').textContent.includes(expected), 'Print contains literal imported text'); savedAudit.noAttack(); };
	await ui.click('[data-click="printHataSchedule"]');
	assert.strictEqual(prints, 1, 'Actual print pipeline ran');
	savedAudit.noAttack();
} });

savedTest('Saved-data UI: over-limit live roster and format stay drafts and repair without corrupting restart', async () => {
	await ui.expand('district'); ui.fill('#d-name', '下書き保全地区');
	ui.fill('#hata-start-date', '2026-11-09'); ui.fill('#hata-end-date', '2026-11-13');
	ui.fill('#hata-members', '正常名簿');
	ui.fill('#hata-members', Array.from({ length: 10001 }, (_, i) => `担当${i}`).join('\n'));
	ui.fill('#hata-format', 'x'.repeat(4097));
	assert.strictEqual(currentDistrict.hata.members, '正常名簿', 'Oversized live roster does not replace canonical members');
	assert.ok(currentDistrict.hata.inputDrafts.members.includes('担当10000'), 'Raw oversized text is retained separately');
	assert.ok(ui.element('#hata-input-status').textContent.includes('上限'), 'Visible size guidance');
	await savedAudit.flush();
}, { allowFileAccess: true, afterReload: async () => {
	await ui.expand('district');
	assert.strictEqual(ui.element('#d-name').value, '下書き保全地区', 'Other state survives restore validation');
	assert.ok(ui.element('#hata-members').value.includes('担当10000'), 'Oversized draft survives restart');
	assert.strictEqual(ui.element('#hata-format').value.length, 4097, 'Oversized format draft survives restart');
	ui.fill('#hata-members', '修正担当'); ui.fill('#hata-format', '{氏名}');
	assert.strictEqual(currentDistrict.hata.inputDrafts, undefined, 'Repair commits the complete candidate');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.ok(hataCurrentSchedule.some(row => row.person === '修正担当'), 'Repaired roster generates normally');
} });

for (const [route, encrypted] of ['district', 'rep', 'neighbor', 'official', 'districtNeighbor', 'repDistrict', 'repNeighbor', 'districtTransfer', 'repTransfer'].flatMap(route => [false, true].map(encrypted => [route, encrypted]))) {
	savedTest(`Saved-data UI: ${encrypted ? 'encrypted' : 'plain'} ${route} file save failure preserves original models and storage and allows retry`, async () => {
		const route = window.__quotaRoute;
		await ui.expand('district'); ui.fill('#d-name', '保持する地区');
		ui.fill('#hata-members', '保持する担当');
		const district = { district: '新しい地区', officers: [], students: [], neighborhood: [], hata: { members: '新しい担当', holidays: '' } };
		const routes = {
			district: { mode: 'district', action: 'loadDistrictTxt', selector: '#d-file-in', key: 'kogai_district_v2', data: district, password: '#d-pass' },
			rep: { mode: 'rep', action: 'loadRepMasterTxt', selector: '[data-change="loadRepMasterTxt"]', key: 'kogai_rep_v2', data: { districts: [district], szExternals: [] }, password: '#rep-pass' },
			neighbor: { mode: 'neighbor', action: 'loadNeighborTxt', selector: '#neighbor-file-input', key: 'kogai_neighbor_v2', data: { isNeighborhoodData: true, district: '新しい自治会', neighborhood: [{ lastName: '新任会長' }] }, password: '#neighbor-import-pass' },
			official: { mode: 'district', action: 'loadHataOfficialFile', selector: '#card-d-hata input[type="file"]', key: 'kogai_district_v2', data: district.hata },
			districtNeighbor: { mode: 'district', action: 'loadNeighborFileIntoDistrict', selector: '#d-neighbor-file-input', key: 'kogai_district_v2', data: { isNeighborhoodData: true, district: '保持する地区', neighborhood: [{ lastName: '新任会長' }] }, password: '#d-pass' },
			repDistrict: { mode: 'rep', action: 'loadMultipleDistrictFiles', selector: '#rep-files', key: 'kogai_rep_v2', data: district, password: '#rep-pass' },
			repNeighbor: { mode: 'rep', action: 'loadMultipleDistrictFiles', selector: '#rep-files', key: 'kogai_rep_v2', data: { isNeighborhoodData: true, district: '新しい自治会', neighborhood: [{ lastName: '新任会長' }] }, password: '#rep-pass' },
			districtTransfer: { mode: 'district', action: 'loadTransferFileIntoDistrict', selector: '[data-change="loadTransferFileIntoDistrict"]', key: 'kogai_district_v2', data: { isTransferData: true, children: [{ lastName: '転入', firstName: '児童', address: '101', tel: '09011112222' }] }, password: '#d-pass' },
			repTransfer: { mode: 'rep', action: 'loadTransferFileIntoRep', selector: '[data-change="loadTransferFileIntoRep"]', key: 'kogai_rep_v2', data: { isTransferData: true, children: [{ lastName: '転入', firstName: '児童', address: '101', tel: '09011112222' }] }, password: '#rep-pass' }
		};
		const r = routes[route];
		await ui.mode(r.mode); await ui.expand(r.mode);
		if (r.password) ui.fill(r.password, savedAudit.password);
		if (window.__quotaEncrypted) await savedAudit.encrypt();
		window.__promptAnswers = route === 'repTransfer' ? ['新しい地区', '1班'] : ['1班'];
		const content = route === 'official' ? JSON.stringify(r.data) : await encryptPayload(JSON.stringify(r.data), savedAudit.password);
		await savedAudit.flush();
		const models = savedAudit.models(), stored = savedAudit.stored();
		const notifications = __dialogs.length;
		const setItem = Storage.prototype.setItem;
		let failed = false;
		Storage.prototype.setItem = function(key, value) {
			if (key === r.key && !failed) { failed = true; throw new DOMException('test quota', 'QuotaExceededError'); }
			return setItem.call(this, key, value);
		};
		try {
			await savedAudit.file(r.action, r.selector, content, 'retry.txt');
			// 旧実装の非await保存も、実際のPromiseが完了してから判定する。
			await Promise.allSettled([savedAudit.pending.saveStorageData]);
		}
		finally { Storage.prototype.setItem = setItem; }
		assert.ok(failed, 'The actual persistence operation encountered quota failure');
		assert.ok(__dialogs.slice(notifications).some(dialog => dialog.message.includes('保存に失敗')), 'Storage failure is identified to the user');
		assert.strictEqual(savedAudit.models(), models, 'Failed saved-file restore keeps every original live model');
		assert.strictEqual(savedAudit.stored(), stored, 'Failed saved-file restore keeps every original stored value');
		assert.strictEqual(ui.element('#d-name').value, '保持する地区', 'Original district DOM is intact');
		window.__promptAnswers = route === 'repTransfer' ? ['新しい地区', '1班'] : ['1班'];
		await savedAudit.file(r.action, r.selector, content, 'retry.txt');
		assert.ok(savedAudit.models() !== models, 'Same file succeeds after storage is writable again');
	}, { beforeLoad: new Function(`window.__quotaRoute = ${JSON.stringify(route)}; window.__quotaEncrypted = ${encrypted};`) });
}

savedTest('Saved-data UI: inherited text and district or seat option amplification are rejected before rendering', async () => {
	await ui.expand('district'); ui.fill('#d-name', '保全する地区');
	const badDistricts = [
		{ district: '侵入候補', han: 'x'.repeat(4097), students: [{}] },
		{ district: '侵入候補', hanList: Array.from({ length: 40 }, (_, i) => `${i}${'班'.repeat(100)}`), students: Array.from({ length: 500 }, () => ({ lastName: '児童' })) }
	];
	ui.fill('#d-pass', savedAudit.password);
	await savedAudit.flush();
	for (const data of badDistricts) {
		const models = savedAudit.models(), stored = savedAudit.stored();
		await savedAudit.file('loadDistrictTxt', '#d-file-in', await encryptPayload(JSON.stringify(data), savedAudit.password));
		assert.strictEqual(savedAudit.models(), models, 'District amplification rejected before state mutation');
		assert.strictEqual(savedAudit.stored(), stored, 'District amplification rejected before storage mutation');
		assert.strictEqual(ui.element('#d-name').value, '保全する地区', 'No candidate district rendered');
	}
	await ui.mode('rep'); await ui.expand('rep'); ui.fill('#rep-pass', savedAudit.password);
	await savedAudit.flush();
	const models = savedAudit.models(), stored = savedAudit.stored();
	const data = { districts: [{ district: '侵入候補', selectedForPrint: true, officers: Array.from({ length: 500 }, (_, i) => ({ lastName: `${i}${'役員'.repeat(100)}` })) }], seatConfig: { rows: 14, cols: 10, cells: {} } };
	await savedAudit.file('loadRepMasterTxt', '[data-change="loadRepMasterTxt"]', await encryptPayload(JSON.stringify(data), savedAudit.password));
	assert.strictEqual(savedAudit.models(), models, 'Seat amplification rejected before state mutation');
	assert.strictEqual(savedAudit.stored(), stored, 'Seat amplification rejected before storage mutation');
});

savedTest('Saved-data UI: lock after persistence but before import continuation cannot restore purged data', async () => {
	await ui.expand('district'); ui.fill('#d-name', '移動前の個人情報');
	ui.fill('#d-pass', savedAudit.password);
	await savedAudit.flush(); await savedAudit.encrypt();
	const text = await encryptPayload(JSON.stringify({ district: '遅延して戻る個人情報', students: [], officers: [], neighborhood: [] }), savedAudit.password);
	const original = window.commitImportedModel;
	let release, committed = false;
	const gate = new Promise(resolve => { release = resolve; });
	window.commitImportedModel = async (...args) => { const result = await original(...args); committed = true; await gate; return result; };
	await ui.file('#d-file-in', text, 'late.txt');
	await ui.waitFor(() => committed, 'Candidate has been persisted but not yet adopted by its caller');
	await ui.click('#storage-security-badge');
	await ui.click('[data-click="handleImmediateLock"]');
	assert.strictEqual(currentDistrict.district, '', 'Lock purges the old live model');
	release(); await savedAudit.pending.loadDistrictTxt;
	assert.strictEqual(currentDistrict.district, '', 'Late import cannot repopulate the locked model');
	assert.strictEqual(ui.element('#d-name').value, '', 'Late import cannot repopulate the locked DOM');
	assert.ok(ui.visible('#storage-lock-modal') && !isStorageUnlocked(), 'The app remains locked');
});
