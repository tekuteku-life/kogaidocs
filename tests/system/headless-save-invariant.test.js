const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function assertBrowserResult(result) {
	assert.equal(result.success, true, JSON.stringify(result.fatal));
	assert.deepEqual(result.errors, []);
	assert.ok(result.results.length > 0, 'Browser assertions were executed');
	assert.ok(result.results.every(item => item.passed), JSON.stringify(result.results.filter(item => !item.passed)));
}

test('UI SEC-30: seat shrink confirmation, removal of out-of-range seats and an actual restart that still unlocks', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		ui.fill('#seat-rows', '6');
		await ui.waitFor(() => document.querySelectorAll('.seat-cell-edit').length === 24, 'Six-row grid rendered');
		ui.fill('[data-target="5_0"][data-field="customText"]', '来賓席');
		assert.strictEqual(repState.seatConfig.cells['5_0'].customText, '来賓席', 'Sixth-row seat assigned');
		window.__confirmAnswer = false;
		ui.fill('#seat-rows', '5');
		assert.ok(__dialogs.some(dialog => dialog.type === 'confirm' && dialog.message.includes('1席')), 'Shrink asks with the affected count');
		assert.strictEqual(repState.seatConfig.rows, 6, 'Cancelled shrink keeps six rows');
		assert.strictEqual(ui.element('#seat-rows').value, '6', 'Cancelled shrink restores the input');
		assert.strictEqual(document.querySelectorAll('.seat-cell-edit').length, 24, 'Cancelled shrink keeps the grid');
		window.__confirmAnswer = true;
		ui.fill('#seat-rows', '5');
		assert.strictEqual(repState.seatConfig.rows, 5, 'Accepted shrink applies');
		assert.ok(!Object.hasOwn(repState.seatConfig.cells, '5_0'), 'Out-of-range seat removed');
		assert.strictEqual(document.querySelectorAll('.seat-cell-edit').length, 20, 'Five-row grid rendered');
		await saveRepLocal();
	}, { queryMode: 'rep', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks with the correct password');
		assert.strictEqual(repState.seatConfig.rows, 5, 'Saved grid restored after restart');
		assert.ok(!document.getElementById('modal-unlock-error').textContent.includes('検証に失敗'), 'No validation failure after restart');
	} });
	assertBrowserResult(result);
});

test('UI SEC-30: a model rejected by validation is never written and the user is told once', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		const before = localStorage.getItem('kogai_rep_v2');
		repState.seatConfig.cells['40_40'] = { refKey: '', customText: '範囲外' };
		assert.strictEqual(await saveRepLocal(), false, 'Invalid model is refused');
		assert.strictEqual(await saveRepLocal(), false, 'Invalid model is still refused');
		assert.strictEqual(localStorage.getItem('kogai_rep_v2'), before, 'Ciphertext unchanged');
		assert.strictEqual(__dialogs.filter(dialog => dialog.type === 'alert' && dialog.message.includes('端末に保存できない内容があります')).length, 1, 'Single notification');
		const warning = ui.element('#storage-save-warning');
		assert.ok(ui.visible('#storage-save-warning'), 'Persistent warning is visible');
		assert.strictEqual(warning.getAttribute('role'), 'alert', 'Warning is announced');
		assert.ok(warning.textContent.includes('校外代表'), 'Warning names the mode');
		delete repState.seatConfig.cells['40_40'];
		assert.strictEqual(await saveRepLocal(), true, 'Valid model saves again');
		assert.ok(!ui.visible('#storage-save-warning'), 'Warning hidden after a successful save');
	}, { queryMode: 'rep', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart still unlocks');
		assert.ok(!Object.hasOwn(repState.seatConfig.cells, '40_40'), 'Rejected seat never persisted');
	} });
	assertBrowserResult(result);
});

test('UI SEC-34: a second real browsing context updating the database locks this tab and the newer value survives', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-name', 'タブAの旧値');
		await saveDistrictLocal();
		const frame = document.createElement('iframe');
		frame.src = 'index.html?mode=district';
		document.body.appendChild(frame);
		// 固定待機ではなく、別コンテキストが初期化を終えて解除画面を表示するまで待つ。
		await ui.waitFor(() => { try { return frame.contentWindow.document.readyState === 'complete' && frame.contentWindow.document.getElementById('storage-lock-modal')?.style.display === 'flex'; } catch (_) { return false; } }, 'Second context initialized and locked', 10000);
		assert.ok(isStorageUnlocked(), 'Opening another context alone does not lock this tab');
		// 別コンテキストのスクリプト変数は参照できないため、その画面の解除操作と入力イベントで更新する。
		const other = frame.contentWindow;
		const otherDoc = other.document;
		otherDoc.getElementById('modal-unlock-pass').value = sessionStorage.getItem('__uiDatabasePassword');
		await other.handlePasswordUnlock();
		assert.ok(other.isStorageUnlocked(), 'Second context unlocks the shared database');
		assert.ok(isStorageUnlocked(), 'Unlocking another context alone does not lock this tab');
		const otherName = otherDoc.getElementById('d-name');
		assert.strictEqual(otherName.value, 'タブAの旧値', 'Second context reads the shared database');
		otherName.value = 'タブBの新しい値';
		otherName.dispatchEvent(new other.Event('input', { bubbles: true }));
		assert.strictEqual(await other.saveDistrictLocal(), true, 'Second context saves');
		await ui.waitFor(() => !isStorageUnlocked(), 'Foreign update locks this tab');
		assert.ok(ui.visible('#storage-lock-modal'), 'Unlock dialog shown');
		assert.ok(ui.element('#modal-unlock-error').textContent.includes('別のタブで保存データが更新されました'), 'Reason shown');
		assert.strictEqual(ui.element('#d-name').value, '', 'Stale private DOM purged');
		assert.strictEqual(await saveDistrictLocal(), false, 'Stale tab cannot overwrite');
		frame.remove();
		ui.fill('#modal-unlock-pass', sessionStorage.getItem('__uiDatabasePassword'));
		await ui.click('[data-click="handlePasswordUnlock"]');
		await ui.waitFor(() => isStorageUnlocked() && !ui.visible('#storage-lock-modal'), 'Re-unlock');
		assert.strictEqual(currentDistrict.district, 'タブBの新しい値', 'Newest value is loaded instead of the stale memory');
	}, { queryMode: 'district', allowFileAccess: true, timeoutMs: 40000 });
	assertBrowserResult(result);
});

test('UI SEC-34: a save waiting for the exclusive lock while another context writes never restores the stale value', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-name', 'タブAの旧値');
		await saveDistrictLocal();
		const frame = document.createElement('iframe');
		frame.src = 'index.html?mode=district';
		document.body.appendChild(frame);
		await ui.waitFor(() => { try { return frame.contentWindow.document.getElementById('storage-lock-modal')?.style.display === 'flex'; } catch (_) { return false; } }, 'Second context ready', 10000);
		const other = frame.contentWindow;
		other.document.getElementById('modal-unlock-pass').value = sessionStorage.getItem('__uiDatabasePassword');
		await other.handlePasswordUnlock();
		assert.ok(other.isStorageUnlocked(), 'Second context unlocked');
		let pendingSave;
		await other.navigator.locks.request('kogaidocs:storage', { mode: 'exclusive' }, async () => {
			// 排他ロック保持中は共有ロックを要求しない Unlocked 版で読む。
			const model = await other.loadStorageDecryptedUnlocked('kogai_district_v2');
			model.district = 'タブBの新しい値';
			assert.strictEqual(await other.saveStorageDataUnlocked('kogai_district_v2', JSON.stringify(model)), true, 'Second context writes while holding the lock');
			// 同じタスク内で自タブの保存を要求し、storage 通知より先に排他待ちへ入れる。
			pendingSave = saveDistrictLocal();
		});
		assert.strictEqual(await pendingSave, false, 'The waiting stale save is refused');
		assert.ok(!isStorageUnlocked(), 'This tab locks');
		assert.ok(ui.element('#modal-unlock-error').textContent.includes('別のタブで保存データが更新されました'), 'Reason shown');
		frame.remove();
		ui.fill('#modal-unlock-pass', sessionStorage.getItem('__uiDatabasePassword'));
		await ui.click('[data-click="handlePasswordUnlock"]');
		await ui.waitFor(() => isStorageUnlocked(), 'Re-unlock');
		assert.strictEqual(currentDistrict.district, 'タブBの新しい値', 'The value written while waiting survives');
	}, { queryMode: 'district', allowFileAccess: true, timeoutMs: 40000 });
	assertBrowserResult(result);
});

test('UI SEC-34: a guest tab shows the reason in the guest notice after another context updates the database', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district');
		await ui.mode('neighbor');
		assert.ok(isStorageUnlocked(), 'Guest tab starts unlocked');
		const frame = document.createElement('iframe');
		frame.src = 'index.html?mode=district';
		document.body.appendChild(frame);
		await ui.waitFor(() => { try { return frame.contentWindow.document.getElementById('storage-lock-modal')?.style.display === 'flex'; } catch (_) { return false; } }, 'Second context ready', 10000);
		const other = frame.contentWindow;
		other.document.getElementById('modal-unlock-pass').value = sessionStorage.getItem('__uiDatabasePassword');
		await other.handlePasswordUnlock();
		assert.strictEqual(await other.saveNeighborLocal(), true, 'Second context saves the neighborhood data');
		await ui.waitFor(() => !isStorageUnlocked(), 'Guest tab locks');
		assert.ok(ui.visible('#guest-storage-notice'), 'Guest notice shown');
		assert.ok(ui.element('#guest-storage-notice-reason').textContent.includes('別のタブで保存データが更新されました'), 'Reason in the guest notice');
		frame.remove();
	}, { queryMode: 'neighbor', allowFileAccess: true, timeoutMs: 40000 });
	assertBrowserResult(result);
});

test('UI SEC-30: long derived values (4102-character seat key, 8193-character full name and household key) survive an actual restart', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		const name = 'え'.repeat(4096);
		repState.districts = [{ district: name, han: '', hanList: [], officers: [{ role: '校外委員', lastName: '役員', firstName: '' }], students: [], neighborhood: [{ role: '会長', lastName: '会長', firstName: '' }], szNeighborChecks: { 0: true }, selectedForPrint: true }];
		renderRepAll();
		const key = `NEI_${name}_0`;
		ui.fill('#seat-grid-container [data-target="0_0"][data-field="refKey"]', key);
		assert.strictEqual(repState.seatConfig.cells['0_0'].refKey.length, 4102, 'Seat key assigned through the UI');
		assert.strictEqual(await saveRepLocal(), true);
		await ui.mode('district');
		currentDistrict.students = [{ grade: '1', class: '1', han: '', lastName: 'い'.repeat(4096), firstName: 'は'.repeat(4096), address: 'う'.repeat(4096), isOutOfDistrict: false }];
		currentDistrict.students[0].name = getFullName(currentDistrict.students[0]);
		const [household] = extractHouseholdsFromStudents(currentDistrict.students);
		toggleHataExempt(household.key, true, household.displayName);
		assert.strictEqual(await saveDistrictLocal(), true);
	}, { queryMode: 'rep', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		assert.strictEqual(repState.seatConfig.cells['0_0'].refKey.length, 4102);
		assert.strictEqual(currentDistrict.students[0].name.length, 8193);
		assert.strictEqual(currentDistrict.hata.exemptHouseholds[0].length, 8193);
	}, timeoutMs: 40000 });
	assertBrowserResult(result);
});

test('UI QA-04 / E-12-15: district long LINE sharing with a denied clipboard opens nothing and reports the failure', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-name', '長文地区');
		currentDistrict.students = Array.from({ length: 80 }, (_, index) => ({ grade: String(index % 6 + 1), class: '1', han: '', lastName: '長文', firstName: `児童${index}`, address: `町${index}番地` }));
		ui.fill('#d-pass', 'Submission123!'); ui.fill('#d-pass-confirm', 'Submission123!');
		const opened = [];
		window.open = url => { opened.push(url); return null; };
		ui.clipboard(true);
		assert.strictEqual(await shareDistrictData('line'), false, 'Denied copy aborts');
		assert.strictEqual(opened.length, 0, 'LINE never opened');
		assert.ok(__dialogs.some(dialog => dialog.type === 'alert' && dialog.message.includes('クリップボード')), 'Failure reported');
		ui.clipboard(false);
		await shareDistrictData('line');
		assert.strictEqual(opened.length, 1, 'Retry after successful copy opens LINE once');
		assert.ok(!opened[0].includes('BEGIN_DATA'), 'URL carries guidance only');
		assert.ok(__copiedText.includes('BEGIN_DATA:'), 'Ciphertext copied');
	}, { queryMode: 'district' });
	assertBrowserResult(result);
});

test('UI SEC-33: a remembered password inside an imported file is not adopted through import, actual restart and export', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-pass', 'Submission123!'); ui.fill('#d-pass-confirm', 'Submission123!');
		const payload = { district: '取込地区', officers: [{ role: '校外委員', lastName: '取込', firstName: '役員' }], students: [], neighborhood: [], savedFilePassword: 'AttackerPass99!' };
		const original = window.loadDistrictTxt;
		window.loadDistrictTxt = (...args) => { window.__importTask = Promise.resolve(original(...args)); return window.__importTask; };
		await ui.file('#d-file-in', `BEGIN_DATA:\n${await encryptPayload(JSON.stringify(payload), 'Submission123!')}\n:END_DATA`);
		await ui.waitFor(() => !!window.__importTask, 'Import started');
		await window.__importTask;
		assert.strictEqual(currentDistrict.district, '取込地区', 'Imported');
		assert.strictEqual(currentDistrict.savedFilePassword, undefined, 'Remembered password not adopted');
		assert.strictEqual(ui.element('#d-pass').value, 'Submission123!', 'Typed password kept');
		assert.ok(!ui.element('#d-save-password-optin').checked, 'Consent not implied');
		ui.captureDownloads();
		await exportDistrictTxt();
		const content = __downloads[0].content;
		const decrypted = JSON.parse(await decryptPayload(content.slice(content.indexOf('BEGIN_DATA:') + 11, content.indexOf(':END_DATA')).trim(), 'Submission123!'));
		assert.ok(!Object.hasOwn(decrypted, 'savedFilePassword'), 'Exported file carries no remembered password');
	}, { queryMode: 'district', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		assert.strictEqual(currentDistrict.district, '取込地区', 'Import persisted');
		assert.strictEqual(currentDistrict.savedFilePassword, undefined, 'Nothing remembered after restart');
		assert.strictEqual(ui.element('#d-pass').value, '', 'Password field is not prefilled');
	} });
	assertBrowserResult(result);
});

test('UI SEC-35: an over-long district name is refused in the add-district dialog and the database still unlocks', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		openAddDistrictModal();
		await ui.waitFor(() => ui.visible('#rep-new-district-name'), 'Add district dialog');
		ui.fill('#rep-new-district-name', 'か'.repeat(4097));
		await ui.click('#btn-confirm-add-district');
		assert.ok(ui.visible('#rep-new-district-error'), 'Error shown');
		assert.ok(ui.element('#rep-new-district-error').textContent.includes('4096'), 'Limit explained');
		assert.ok(ui.visible('#rep-add-district-modal'), 'Dialog stays open');
		assert.strictEqual(repState.districts.length, 0, 'Not added');
		ui.fill('#rep-new-district-name', 'か'.repeat(4096));
		await ui.click('#btn-confirm-add-district');
		assert.strictEqual(repState.districts.length, 1, 'Boundary length added');
		await saveRepLocal();
	}, { queryMode: 'rep', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		assert.strictEqual(repState.districts[0].district.length, 4096, 'Boundary name persisted');
	} });
	assertBrowserResult(result);
});

test('UI SEC-35: a browser handoff with an over-long added-district draft is refused before confirmation', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		const before = JSON.stringify(repState);
		const payload = { type: 'kogaidocs-browser-handoff', version: 1, mode: 'rep', models: [
			{ district: '', han: '', hanList: [], officers: [], neighborhood: [], students: [] },
			{ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } },
			{ district: '', neighborhood: [] }, { children: [], memo: '' }
		], drafts: { 'rep-new-district-name': 'か'.repeat(4097) }, repDraft: null };
		const original = window.restoreBrowserHandoff;
		window.restoreBrowserHandoff = (...args) => { window.__restoreTask = Promise.resolve(original(...args)); return window.__restoreTask; };
		openBrowserHandoff();
		await ui.waitFor(() => ui.visible('#handoff-input'), 'Handoff dialog');
		ui.fill('#handoff-input', await encryptPayload(JSON.stringify(payload), 'HandoffPass123!'));
		ui.fill('#handoff-restore-pass', 'HandoffPass123!');
		await ui.click('[data-click="restoreBrowserHandoff"]');
		await ui.waitFor(() => !!window.__restoreTask, 'Restore started');
		assert.strictEqual(await window.__restoreTask, false, 'Restore refused');
		assert.ok(!__dialogs.some(dialog => dialog.type === 'confirm'), 'Refused before confirmation');
		assert.ok(ui.element('#handoff-status').textContent.includes('引き継ぎに失敗しました'), 'Failure shown');
		assert.strictEqual(JSON.stringify(repState), before, 'Representative data unchanged');
		assert.ok(!ui.visible('#rep-add-district-modal'), 'No add-district dialog was opened');
	}, { queryMode: 'rep' });
	assertBrowserResult(result);
});

test('UI QA-01: a guest browser handoff restored on an encrypted officer device keeps the officer data through an actual restart', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-name', '端末の地区');
		await saveDistrictLocal();
		const payload = { type: 'kogaidocs-browser-handoff', version: 1, mode: 'neighbor', models: [
			{ district: '', han: '', hanList: [], officers: [], neighborhood: [], students: [] },
			{ districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } },
			{ district: '引き継ぎ自治会', neighborhood: [{ role: '会長', lastName: '新' }] },
			{ children: [], memo: '引き継ぎメモ' }
		], drafts: {}, repDraft: null };
		const original = window.restoreBrowserHandoff;
		window.restoreBrowserHandoff = (...args) => { window.__restoreTask = Promise.resolve(original(...args)); return window.__restoreTask; };
		openBrowserHandoff();
		await ui.waitFor(() => ui.visible('#handoff-input'), 'Handoff dialog');
		ui.fill('#handoff-input', await encryptPayload(JSON.stringify(payload), 'HandoffPass123!'));
		ui.fill('#handoff-restore-pass', 'HandoffPass123!');
		await ui.click('[data-click="restoreBrowserHandoff"]');
		await ui.waitFor(() => !!window.__restoreTask, 'Restore started');
		await window.__restoreTask;
		assert.ok(__dialogs.some(dialog => dialog.type === 'confirm' && dialog.message.includes('地区・代表データは保持')), 'Confirmation explains what is kept');
		assert.strictEqual(neighborState.district, '引き継ぎ自治会', 'Guest data restored');
	}, { queryMode: 'district', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		assert.strictEqual(currentDistrict.district, '端末の地区', 'Officer district kept after restart');
		assert.strictEqual(neighborState.district, '引き継ぎ自治会', 'Guest data persisted');
	} });
	assertBrowserResult(result);
});
