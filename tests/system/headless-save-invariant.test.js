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
		// 鍵の解除後に保存値を読み込み終えると解除画面が閉じる。読込の完了を待ってから検査する。
		await ui.waitFor(() => isStorageUnlocked() && !ui.visible('#storage-lock-modal'), 'Re-unlock');
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

test('UI SPEC-Q1: adding this device district checks only the named chairman and offers no blank neighbor seat', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-name', '合算地区');
		currentDistrict.neighborhood = [
			{ role: '副会長', lastName: '副', firstName: '花子', lastNameKana: '', firstNameKana: '', address: '', tel: '' },
			{ role: '会長', lastName: '会', firstName: '太郎', lastNameKana: '', firstNameKana: '', address: '', tel: '' },
			{ role: '会長', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '' }
		];
		renderDistrictForm();
		assert.strictEqual(await saveDistrictLocal(), true);
		await ui.mode('rep'); await ui.expand('rep');
		await ui.click('[data-click="addCurrentDistrictToRep"]');
		await ui.waitFor(() => repState.districts.some(d => d.district === '合算地区'), 'District added to the representative data');
		const labels = [...document.querySelectorAll('#sz-neighborhood-selector input[type="checkbox"]')].filter(box => box.checked).map(box => box.parentElement.textContent.trim());
		assert.strictEqual(JSON.stringify(labels), JSON.stringify(['会長：会 太郎']), 'Only the named chairman is checked; 副会長 and the blank slot are not');
		const neighbors = getAllSzParticipantsForSeat().filter(person => person.key.startsWith('NEI_'));
		assert.strictEqual(JSON.stringify(neighbors.map(person => person.name)), JSON.stringify(['会 太郎']), 'No blank neighbor seat option');
		assert.strictEqual(await saveRepLocal(), true);
	}, { queryMode: 'district', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		assert.strictEqual(JSON.stringify(repState.districts.find(d => d.district === '合算地区').szNeighborChecks), JSON.stringify({ 1: true }), 'Attendance persisted');
	} });
	assertBrowserResult(result);
});

test('UI SPEC-Q2: re-importing a district file offers no blank neighbor seat or name tag from another 班 of the same district, also after a restart', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		ui.fill('#rep-pass', 'RepImport123!');
		const person = (role, lastName) => ({ role, lastName, firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '' });
		const entry = (han, rows, checks) => ({ district: '空枠地区', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
		repState.districts.push(entry('1班', [person('会長', ''), person('副会長', '鈴木')], { 0: true }), entry('2班', [person('会長', '')], {}));
		renderRepAll();
		const first = () => repState.districts.find(d => d.district === '空枠地区' && d.han === '1班');
		await ui.click(`[data-change="setDistrictPrintSelection"][data-index="${repState.districts.indexOf(first())}"]`);
		await ui.waitFor(() => first().selectedForPrint === false, '1班 is not selected for print');
		const file = await encryptPayload(JSON.stringify({ district: '空枠地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [{ grade: '2', class: '1', lastName: '児童', firstName: '一' }], neighborhood: [person('会長', ''), person('副会長', '鈴木')] }), 'RepImport123!');
		await ui.file('#rep-files', file);
		await ui.waitFor(() => first()?.students.length === 1, 'District file re-imported');
		assert.ok(__dialogs.every(dialog => !dialog.message.includes('失敗')), JSON.stringify(__dialogs));
		const second = repState.districts.find(d => d.district === '空枠地区' && d.han === '2班');
		assert.strictEqual(JSON.stringify(second.szNeighborChecks), '{}', 'The nameless slot of 2班 is not attending');
		assert.strictEqual(first().selectedForPrint, false, 'Only 2班 is printed');
		const neighbors = getAllSzParticipantsForSeat().filter(person => person.key.startsWith('NEI_'));
		assert.strictEqual(JSON.stringify(neighbors.map(person => person.name)), '[]', 'No blank neighbor seat option');
		const checked = [...document.querySelectorAll('#sz-neighborhood-selector input[type="checkbox"]')].filter(box => box.checked);
		assert.strictEqual(checked.length, 0, 'The selector shows no attending neighbor');
		const tags = buildSzTentCardsPagesHtml(repState.districts.filter(d => d.selectedForPrint)).filter(page => page.includes('<div class="tent-sub">空枠地区</div>'));
		assert.strictEqual(tags.length, 0, 'No nameless name tag');
		assert.strictEqual(await saveRepLocal(), true);
	}, { queryMode: 'rep', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		const stored = repState.districts.filter(d => d.district === '空枠地区').map(d => [d.han, d.selectedForPrint, d.szNeighborChecks]);
		assert.strictEqual(JSON.stringify(stored), JSON.stringify([['1班', false, {}], ['2班', true, {}]]), 'Attendance and print selection persisted');
		assert.strictEqual(getAllSzParticipantsForSeat().filter(person => person.key.startsWith('NEI_')).length, 0, 'No blank neighbor seat option after the restart');
	} });
	assertBrowserResult(result);
});

test('UI SPEC-Q2: replacing a roster by neighborhood and district files checks the new chairman and survives an actual restart', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		ui.fill('#rep-pass', 'RepImport123!');
		const encrypt = model => encryptPayload(JSON.stringify(model), 'RepImport123!');
		const person = (role, lastName) => ({ role, lastName, firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '' });
		const neighborFile = rows => encrypt({ isNeighborhoodData: true, district: '差替地区', neighborhood: rows });
		const districtFile = rows => encrypt({ district: '班地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [{ grade: '2', class: '1', lastName: '児童', firstName: '一' }], neighborhood: rows });
		const checkedLabels = name => [...document.querySelectorAll('#sz-neighborhood-selector div')].filter(group => group.textContent.includes(`【${name}】`))
			.flatMap(group => [...group.querySelectorAll('input[type="checkbox"]')].filter(box => box.checked).map(box => box.parentElement.textContent.trim()));
		const find = name => repState.districts.find(d => d.district === name);
		await ui.file('#rep-files', await neighborFile([person('会長', '旧'), person('副会長', '副')]));
		await ui.waitFor(() => !!find('差替地区'), 'First neighborhood import');
		assert.strictEqual(JSON.stringify(checkedLabels('差替地区')), JSON.stringify(['会長：旧']));
		await ui.file('#rep-files', await neighborFile([person('副会長', '副'), person('会長', '新')]));
		await ui.waitFor(() => find('差替地区').neighborhood[1]?.lastName === '新', 'Neighborhood replacement');
		assert.strictEqual(JSON.stringify(checkedLabels('差替地区')), JSON.stringify(['会長：新']), 'The new chairman is checked after the replacement');
		await ui.file('#rep-files', await districtFile([person('会長', '班旧')]));
		await ui.waitFor(() => !!find('班地区'), 'First district import');
		await ui.file('#rep-files', await districtFile([person('書記', '書'), person('会長', '班新')]));
		await ui.waitFor(() => find('班地区').neighborhood[1]?.lastName === '班新', 'District replacement');
		assert.strictEqual(JSON.stringify(checkedLabels('班地区')), JSON.stringify(['会長：班新']));
		assert.ok(__dialogs.every(dialog => !dialog.message.includes('失敗')), JSON.stringify(__dialogs));
	}, { queryMode: 'rep', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		const checksOf = name => JSON.stringify(repState.districts.find(d => d.district === name).szNeighborChecks);
		assert.strictEqual(checksOf('差替地区'), JSON.stringify({ 1: true }));
		assert.strictEqual(checksOf('班地区'), JSON.stringify({ 1: true }));
		await ui.expand('rep');
		const group = name => [...document.querySelectorAll('#sz-neighborhood-selector div')].find(element => element.textContent.includes(`【${name}】`));
		const checkedLabels = name => [...group(name).querySelectorAll('input[type="checkbox"]')].filter(box => box.checked).map(box => box.parentElement.textContent.trim());
		assert.strictEqual(JSON.stringify(checkedLabels('差替地区')), JSON.stringify(['会長：新']), 'After the restart the selector shows the new chairman of the neighborhood file');
		assert.strictEqual(JSON.stringify(checkedLabels('班地区')), JSON.stringify(['会長：班新']), 'After the restart the selector shows the new chairman of the district file');
		const storedBefore = localStorage.getItem('kogai_rep_v2');
		const box = [...group('班地区').querySelectorAll('input[data-change="toggleSzNeighbor"]')].find(input => input.checked);
		await ui.click(`#sz-neighborhood-selector input[data-change="toggleSzNeighbor"][data-index="${box.dataset.index}"][data-index2="${box.dataset.index2}"]`);
		await ui.waitFor(() => checksOf('班地区') === JSON.stringify({ 1: false }), 'Clearing the chairman in the selector updates the attendance');
		assert.strictEqual(JSON.stringify(checkedLabels('班地区')), '[]', 'The selector shows the cleared chairman');
		await ui.waitFor(() => localStorage.getItem('kogai_rep_v2') !== storedBefore, 'The cleared attendance is saved');
		lockStorage();
		assert.ok(await unlockStorageWithPassword(sessionStorage.getItem('__uiDatabasePassword')), 'Unlock again');
		await loadAppDataFromStorage();
		assert.strictEqual(checksOf('班地区'), JSON.stringify({ 1: false }), 'The cleared chairman stays cleared after lock and unlock');
		assert.strictEqual(checksOf('差替地区'), JSON.stringify({ 1: true }), 'Other districts are unchanged');
		renderRepAll();
		assert.strictEqual(JSON.stringify(checkedLabels('班地区')), '[]', 'The selector still shows no check');
	} });
	assertBrowserResult(result);
});

test('UI SPEC-Q2: after a district file import a seat stays only with the same chairman, also in the seat chart and after an actual restart', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('rep'); await ui.expand('rep');
		ui.fill('#rep-pass', 'RepImport123!');
		const encrypt = model => encryptPayload(JSON.stringify(model), 'RepImport123!');
		const person = (role, lastName, tel) => ({ role, lastName, firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel });
		const districtFile = rows => encrypt({ district: '座席地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [{ grade: '2', class: '1', lastName: '児童', firstName: '一' }], neighborhood: rows });
		const entry = () => repState.districts.find(d => d.district === '座席地区');
		const cell = () => ui.element('#seat-grid-container select[data-target="0_0"]');
		await ui.file('#rep-files', await districtFile([person('会長', '山田', '111'), person('書記', '佐藤', '')]));
		await ui.waitFor(() => !!entry(), 'First import');
		const option = [...cell().options].find(o => o.textContent.includes('山田'));
		ui.fill(cell(), option.value);
		await ui.waitFor(() => repState.seatConfig.cells['0_0']?.refKey === 'NEI_座席地区_0', 'The chairman is seated');
		await ui.file('#rep-files', await districtFile([person('副会長', '中村', ''), person('会長', '山田', '111')]));
		await ui.waitFor(() => entry().neighborhood[0]?.lastName === '中村', 'The same chairman moves to the second row');
		assert.strictEqual(repState.seatConfig.cells['0_0'].refKey, 'NEI_座席地区_1', 'The seat follows the same chairman to the new row');
		assert.ok(cell().selectedOptions[0].textContent.includes('山田'), 'The seat editor shows the same chairman');
		await ui.file('#rep-files', await districtFile([person('副会長', '中村', ''), person('会長', '山田', '222')]));
		await ui.waitFor(() => entry().neighborhood[1]?.tel === '222', 'Replaced by another 山田 with another phone');
		assert.strictEqual(JSON.stringify(entry().szNeighborChecks), JSON.stringify({ 1: true }), 'The other 山田 is checked as a new chairman');
		assert.strictEqual(repState.seatConfig.cells['0_0'].refKey, '', 'The seat of the old chairman is released');
		assert.strictEqual(cell().value, '', 'The seat editor shows an empty cell');
		assert.ok([...cell().options].some(o => o.textContent.includes('山田')), 'The new chairman is offered but not selected');
		assert.ok(__dialogs.every(dialog => !dialog.message.includes('失敗')), JSON.stringify(__dialogs));
		// 取込が保存した状態をそのまま再起動で確かめるため、ここでは保存や印刷を行わない。
	}, { queryMode: 'rep', afterReload: async () => {
		assert.ok(isStorageUnlocked(), 'Restart unlocks');
		assert.strictEqual(repState.seatConfig.cells['0_0']?.refKey ?? '', '', 'The import saved the released seat');
		assert.strictEqual(JSON.stringify(repState.districts.find(d => d.district === '座席地区').szNeighborChecks), JSON.stringify({ 1: true }));
		await ui.expand('rep');
		assert.strictEqual(ui.element('#seat-grid-container select[data-target="0_0"]').value, '', 'The seat editor is still empty after the restart');
		ui.capturePrints();
		await ui.click('[data-click="setRepPrintChecks"][data-flag="false"]');
		await ui.click('.rep-print-chk[value="sz_seats"]');
		await ui.click('[data-click="executeRepSelectedPrint"]');
		assert.ok(ui.element('#print-area').querySelector('.print-seat-cell'), 'The seat chart is printed');
		assert.ok(!ui.element('#print-area').textContent.includes('山田'), 'The seat chart does not seat the other 山田');
	} });
	assertBrowserResult(result);
});

test('UI SPEC-Q4: in February the preset buttons show the current fiscal year while the initial period stays on the calendar year', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.mode('district'); await ui.expand('district');
		const RealDate = Date;
		const fixed = new RealDate(2027, 1, 10, 9, 0, 0).getTime();
		// 引数なしの new Date() だけを固定する。Date.now() は自動ロック期限の計算に使われるため実時刻のままにする。
		window.Date = class extends RealDate {
			constructor(...args) { super(...(args.length ? args : [fixed])); }
		};
		try {
			currentDistrict.hata = undefined;
			renderHataCard();
			assert.strictEqual(ui.element('#hata-start-date').value, '2027-04-06', 'Initial period unchanged (calendar year)');
			for (const [mode, start, end] of [['kouki', '2026-10-01', '2027-03-24'], ['zenki', '2026-04-06', '2026-09-30'], ['full', '2026-04-06', '2027-03-24']]) {
				await ui.click(`[data-click="applyHataPeriodPreset"][data-mode="${mode}"]`);
				assert.strictEqual(ui.element('#hata-start-date').value, start, `${mode} start`);
				assert.strictEqual(ui.element('#hata-end-date').value, end, `${mode} end`);
				assert.strictEqual(JSON.stringify([currentDistrict.hata.startDate, currentDistrict.hata.endDate]), JSON.stringify([start, end]), `${mode} model`);
				const holidays = generateJapaneseHolidays(2026, 2027).map(x => `${x.date},${x.name}`).join('\n');
				assert.strictEqual(ui.element('#hata-holidays').value, holidays, `${mode} shows the fiscal-year holidays`);
				assert.strictEqual(currentDistrict.hata.holidays, holidays, `${mode} holidays model`);
			}
		} finally { window.Date = RealDate; }
	}, { queryMode: 'district' });
	assertBrowserResult(result);
});
