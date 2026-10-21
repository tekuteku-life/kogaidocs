const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

// データ準備にも実際のフォームとイベントを使う。暗号化・保存・描画は実装をそのまま通す。
function prepareWorkflows() {
	ui.field = (scope, field, value) => ui.fill(`${scope} [data-field="${field}"]`, value);
	ui.password = (prefix, value = 'UiPassword1!') => {
		ui.fill(`#${prefix}`, value);
		ui.fill(`#${prefix}-confirm`, value);
	};
	ui.district = async (name = '青空地区') => {
		await ui.mode('district');
		await ui.expand('district');
		if (!ui.element('#card-d-hata details').open) await ui.click('#card-d-hata summary');
		ui.fill('#d-name', name);
		ui.fill('#d-han-list', 'A班, B班');
		ui.field('#students-tbody tr:nth-child(1)', 'lastName', '山田');
		ui.field('#students-tbody tr:nth-child(1)', 'firstName', '太郎');
		ui.field('#students-tbody tr:nth-child(1)', 'grade', '1');
		ui.field('#students-tbody tr:nth-child(1)', 'han', 'A班');
		ui.field('#students-tbody tr:nth-child(1)', 'address', '青空町1-2-3');
		ui.field('#students-tbody tr:nth-child(1)', 'tel', '090-1111-2222');
		ui.password('d-pass');
		await saveDistrictLocal();
	};
	ui.transfer = async () => {
		await ui.mode('transfer');
		for (const [field, value] of Object.entries({ lastName: '転入', firstName: '未来', address: '中央町101', tel: '090-3333-4444', grade: '6', className: '2' })) {
			ui.field('.transfer-child-row:nth-child(1)', field, value);
		}
		ui.password('transfer-export-pass');
		await saveTransferLocal();
	};
	ui.encrypt = async () => {
		await ui.click('#storage-security-badge');
		ui.password('modal-set-pass');
		await ui.click('#modal-btn-enable-enc');
		await ui.waitFor(() => ui.element('#storage-settings-modal').style.display === 'none', 'Encryption setup completed');
		assert.ok(isStorageEncrypted() && isStorageUnlocked(), 'Real storage encryption enabled');
	};
}

function browserTest(name, fn, options = {}) {
	test(name, async () => {
		const out = await runInHeadlessChrome(fn, { prepare: prepareWorkflows, ...options });
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, errors: out.errors, failures: out.results.filter(r => !r.passed) }, null, 2));
		assert.deepEqual(out.errors, [], 'Unexpected browser errors: ' + JSON.stringify(out.errors));
		assert.ok(out.results.length > 0, 'The browser must execute assertions');
		assert.ok(out.results.every(result => result.passed), JSON.stringify(out.results));
	});
}

for (const queryMode of Object.keys({ district: 'district', rep: 'rep', neighbor: 'neighbor', transfer: 'transfer', 1: 'district', 2: 'rep', 3: 'neighbor', 4: 'transfer', invalid: 'neighbor' })) {
	// serialize時に外部変数へ依存しないよう、期待値は起動URLから独立に算出する。
	browserTest(`UI navigation: mode=${queryMode} restores with URL priority`, async () => {
		const aliases = { 1: 'district', 2: 'rep', 3: 'neighbor', 4: 'transfer' };
		const query = new URLSearchParams(location.search).get('mode');
		const expected = ['district', 'rep', 'neighbor', 'transfer'].includes(query) ? query : aliases[query] || 'neighbor';
		for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
			assert.strictEqual(ui.visible(`#tab-${mode}`), mode === expected, `Only ${expected} is visible`);
		}
		assert.strictEqual(localStorage.getItem('kogai_active_mode'), expected, 'Chosen mode persisted');
	}, { queryMode, beforeLoad: () => localStorage.setItem('kogai_active_mode', 'neighbor') });
}

browserTest('UI navigation: clicks, card CSS, input retention and actual reload', async () => {
	await ui.district();
	await ui.click('#tab-district button[data-click="setAllCardsCollapse"][data-flag="true"][data-target="tab-district"]');
	assert.ok(!ui.visible('#d-name'), 'Collapsed card hides its inputs through CSS');
	await ui.click('#card-d-officers .card-header-toggle');
	assert.ok(ui.visible('#d-name'), 'Header click expands the card');
	for (const mode of ['rep', 'neighbor', 'transfer', 'district']) await ui.mode(mode);
	assert.strictEqual(ui.element('#d-name').value, '青空地区', 'Tab switching retains input');
	await ui.mode('neighbor');
	await ui.expand('neighbor');
	ui.fill('#neighbor-district-name', '再開自治会');
}, { afterReload: async () => {
	assert.ok(ui.visible('#tab-neighbor'), 'Last mode restored after real reload');
	await ui.expand('neighbor');
	assert.strictEqual(ui.element('#neighbor-district-name').value, '再開自治会', 'Form restored from localStorage');
} });

browserTest('UI district: top/bottom CRUD, sort order, han options, cancellation and summary', async () => {
	await ui.district();
	ui.fill('#d-han-list', ' A班、 B班，A班 C班 ');
	assert.strictEqual(currentDistrict.hanList.join(','), 'A班,B班,C班', 'Han names normalized and deduplicated');
	assert.ok([...ui.element('#students-tbody select[data-field="han"]').options].some(o => o.value === 'C班'), 'Han dropdown updated');
	await ui.click('#btn-add-student-top');
	ui.field('#students-tbody tr:nth-child(2)', 'lastName', '班長');
	ui.field('#students-tbody tr:nth-child(2)', 'leader', '班長');
	await ui.click('#btn-add-student-bottom');
	assert.strictEqual(currentDistrict.students.length, 3, 'Both add buttons work');
	assert.strictEqual(currentDistrict.students[2].han, currentDistrict.students[1].han, 'New student inherits last han');
	await ui.click('#btn-sort-students-top');
	assert.strictEqual(ui.element('#students-tbody input[placeholder="姓"]').value, '班長', 'Sorted row rendered first');
	await ui.click('#students-tbody tr:first-child input[type="checkbox"]');
	assert.ok(currentDistrict.students[0].isOutOfDistrict, 'Checkbox change reaches state');
	assert.ok(ui.element('#district-student-summary').textContent.includes('学区外'), 'Out-of-district summary rendered');
	window.__confirmAnswer = false;
	await ui.click('#students-tbody tr:first-child button');
	assert.strictEqual(currentDistrict.students.length, 3, 'Cancel preserves student');
	window.__confirmAnswer = true;
	await ui.click('#students-tbody tr:first-child button');
	assert.strictEqual(currentDistrict.students.length, 2, 'Confirmed removal works');
	for (const id of ['#btn-add-neighbor-top', '#btn-add-neighbor-bottom']) await ui.click(id);
	assert.strictEqual(currentDistrict.neighborhood.length, 3, 'Both neighborhood add buttons work');
	window.__confirmAnswer = false;
	await ui.click('#neighborhood-tbody tr:first-child button');
	assert.strictEqual(currentDistrict.neighborhood.length, 3, 'Cancel preserves neighborhood officer');
	window.__confirmAnswer = true;
	await ui.click('#neighborhood-tbody tr:first-child button');
	assert.strictEqual(currentDistrict.neighborhood.length, 2, 'Confirmed neighborhood removal works');
	await ui.click('#card-d-officers button[data-click="addOfficer"]');
	ui.fill('#officers-container .officer-item-box:nth-child(2) [data-field="lastName"]', '追加役員');
	assert.strictEqual(currentDistrict.officers[1].lastName, '追加役員', 'Officer input persists');
	window.__confirmAnswer = false;
	await ui.click('#officers-container button');
	assert.strictEqual(currentDistrict.officers.length, 2, 'Cancel preserves officer');
	window.__confirmAnswer = true;
	await ui.click('#officers-container button');
	assert.strictEqual(currentDistrict.officers.length, 1, 'One officer retained');
});

browserTest('UI rep add modal: whitespace, duplicate, error clearing, Enter, Escape and backdrop', async () => {
	await ui.mode('rep');
	await ui.expand('rep');
	const open = '#card-rep-districts button[data-click="addNewRepDistrict"]';
	await ui.click(open);
	assert.strictEqual(document.activeElement.id, 'rep-new-district-name', 'Modal autofocus');
	await ui.click('#btn-confirm-add-district');
	assert.strictEqual(repState.districts.length, 0, 'Native required validation blocks empty submit');
	ui.fill('#rep-new-district-name', '   ');
	await ui.click('#btn-confirm-add-district');
	assert.ok(ui.visible('#rep-new-district-error'), 'Whitespace produces inline error');
	ui.fill('#rep-new-district-name', '桜地区');
	assert.ok(!ui.visible('#rep-new-district-error'), 'Editing clears error');
	await ui.key('Enter');
	assert.strictEqual(repState.districts.length, 1, 'Real Enter submits form');
	assert.ok(!ui.visible('#rep-add-district-modal'), 'Successful submit closes modal');
	await ui.click(open);
	ui.fill('#rep-new-district-name', ' 桜地区 ');
	await ui.click('#btn-confirm-add-district');
	assert.ok(ui.element('#rep-new-district-error').textContent.includes('既に存在'), 'Trimmed duplicate rejected');
	await ui.key('Escape');
	assert.ok(!ui.visible('#rep-add-district-modal'), 'Escape closes modal');
	await ui.click(open);
	// 背景のみをクリックする契約をdispatchし、子要素クリックとの区別を確認する。
	ui.element('#rep-add-district-modal .modal-card').click();
	assert.ok(ui.visible('#rep-add-district-modal'), 'Content click keeps dialog open');
	ui.element('#rep-add-district-modal').click();
	assert.ok(!ui.visible('#rep-add-district-modal'), 'Backdrop closes modal');
	await ui.waitFor(() => {
		const saved = localStorage.getItem('kogai_rep_v2');
		return saved && JSON.parse(saved).districts?.length === 1;
	}, 'Accepted district persisted');
	assert.strictEqual(JSON.parse(localStorage.getItem('kogai_rep_v2')).districts.length, 1, 'Only accepted district persisted');
});

browserTest('UI rep detail: all row types, draft discard/save and confirmed deletion', async () => {
	await ui.district();
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	await ui.click('#rep-districts-tbody button[data-click="openRepDistrictDetailModal"][data-index="0"]');
	ui.field('#rep-modal-officer-tbody tr:first-child', 'lastName', '破棄役員');
	await ui.click('#rep-district-detail-modal button[data-click="closeRepDistrictDetailModalWithoutSaving"]');
	assert.strictEqual(repState.districts[0].officers[0].lastName, '', 'Cancel discards draft');
	await ui.click('#rep-districts-tbody button[data-click="openRepDistrictDetailModal"][data-index="0"]');
	for (const [add, body, name] of [['addModalOfficerRow', '#rep-modal-officer-tbody', '編集役員'], ['addModalStudentRow', '#rep-modal-students-tbody', '編集児童'], ['addModalNeighborRow', '#rep-modal-neighbor-tbody', '編集会長']]) {
		await ui.click(`#rep-district-detail-modal button[data-click="${add}"]`);
		ui.field(`${body} tr:last-child`, 'lastName', name);
		window.__confirmAnswer = false;
		await ui.click(`${body} tr:last-child button`);
		assert.strictEqual(ui.element(`${body} tr:last-child input[placeholder="姓"]`).value, name, 'Cancel preserves draft row');
	}
	await ui.click('button[data-click="saveAndCloseRepDistrictDetailModal"]');
	assert.strictEqual(repState.districts[0].students.at(-1).lastName, '編集児童', 'Draft saved to representative state');
	assert.ok(ui.element('#rep-districts-tbody').textContent.includes('編集役員'), 'Summary redrawn');
	assert.strictEqual(getModalCurrentDistrict(), null, 'Draft released after save');
	window.__confirmAnswer = false;
	await ui.click('#rep-districts-tbody button[data-click="deleteRepDistrict"][data-index="0"]');
	assert.strictEqual(repState.districts.length, 1, 'District removal cancel');
	window.__confirmAnswer = true;
	await ui.click('#rep-districts-tbody button[data-click="deleteRepDistrict"][data-index="0"]');
	assert.strictEqual(repState.districts.length, 0, 'District removal confirmed');
});

browserTest('UI neighbor: add, reorder boundaries, delete cancellation, zero-row state', async () => {
	await ui.mode('neighbor');
	await ui.expand('neighbor');
	ui.fill('#neighbor-district-name', '中央自治会');
	ui.field('#neighbor-tbody tr:first-child', 'lastName', '先頭');
	await ui.click('#btn-add-neighbor-mode-top');
	await ui.click('#btn-add-neighbor-mode-bottom');
	assert.strictEqual(neighborState.neighborhood.length, 4, 'Top and bottom add controls');
	ui.field('#neighbor-tbody tr:nth-child(2)', 'lastName', '次席');
	assert.ok(ui.element('#neighbor-tbody tr:first-child button[title="上へ移動"]').disabled, 'Upper boundary disabled');
	assert.ok(ui.element('#neighbor-tbody tr:last-child button[title="下へ移動"]').disabled, 'Lower boundary disabled');
	await ui.click('#neighbor-tbody tr:nth-child(2) button[title="上へ移動"]');
	assert.strictEqual(ui.element('#neighbor-tbody tr:first-child input[placeholder="姓"]').value, '次席', 'Up reorder rendered');
	window.__confirmAnswer = false;
	await ui.click('#neighbor-tbody tr:first-child button.btn-danger');
	assert.strictEqual(neighborState.neighborhood.length, 4, 'Delete cancellation');
	window.__confirmAnswer = true;
	while (neighborState.neighborhood.length) await ui.click('#neighbor-tbody tr:first-child button.btn-danger');
	assert.ok(ui.element('#neighbor-tbody').textContent.includes('まだ登録されていません'), 'Zero rows render empty guidance');
});

for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
	browserTest(`UI passwords: ${mode} full-width sanitation, 11/12 chars, mismatch, visibility`, async () => {
		const mode = new URLSearchParams(location.search).get('mode');
		if (mode !== 'transfer') await ui.expand(mode);
		const prefix = { district: 'd-pass', rep: 'rep-pass', neighbor: 'neighbor-pass', transfer: 'transfer-export-pass' }[mode];
		ui.password(prefix, 'Ａｂｃ１２３！ｘｙｚ Ｑ日本語　');
		assert.strictEqual(ui.element(`#${prefix}`).value, 'Abc123!xyzQ', 'Sanitization removes spaces and Japanese, converts full-width ASCII');
		await ui.click(`button[data-click="togglePasswordVisibility"][data-password-target="${prefix}"]`);
		assert.strictEqual(ui.element(`#${prefix}`).type, 'text', 'Show password');
		ui.password(prefix, 'Abcdef1234!');
		if (mode === 'transfer') {
			assert.ok(!validateTransferPasswords(), 'Eleven characters rejected');
		} else {
			const feedback = ui.element(`#${prefix}-match-msg`);
			assert.ok(feedback.textContent.includes('12文字'), 'Eleven characters rejected on input');
		}
		ui.password(prefix, 'Abcdef12345!');
		if (mode !== 'transfer') assert.ok(ui.element(`#${prefix}-match-msg`).classList.contains('pass-msg-ok'), 'Exactly twelve characters accepted');
		ui.fill(`#${prefix}-confirm`, 'Different123!');
		if (mode !== 'transfer') assert.ok(ui.element(`#${prefix}-match-msg`).textContent.includes('一致しません'), 'Mismatch shown on input');
		else assert.ok(!validateTransferPasswords(), 'Mismatch rejected');
		await ui.click(`button[data-click="togglePasswordVisibility"][data-password-target="${prefix}"]`);
		assert.strictEqual(ui.element(`#${prefix}`).type, 'password', 'Hide password');
	}, { queryMode: mode });
}

for (const field of ['lastName', 'firstName', 'address', 'tel']) {
	browserTest(`UI transfer validation: blank ${field} blocks both file and clipboard`, async () => {
		await ui.transfer();
		const field = window.__requiredField;
		ui.field('.transfer-child-row:first-child', field, '   ');
		ui.captureDownloads();
		ui.clipboard();
		await ui.click('#btn-export-transfer-txt');
		await ui.click('#btn-copy-transfer-text');
		assert.strictEqual(__downloads.length, 0, 'No invalid file downloaded');
		assert.strictEqual(window.__copiedText, undefined, 'No invalid clipboard text');
		assert.ok(__dialogs.filter(d => d.type === 'alert').length >= 2, 'Both paths explain missing fields');
	}, { beforeLoad: new Function(`window.__requiredField = ${JSON.stringify(field)};`) });
}

browserTest('UI transfer: sibling inheritance, encryption download/copy, cancel/delete and reset', async () => {
	await ui.transfer();
	await ui.click('#btn-add-transfer-child');
	assert.strictEqual(ui.element('.transfer-child-row:nth-child(2) input[placeholder="例: 山田"]').value, '転入', 'Sibling inherits surname');
	assert.strictEqual(transferState.children[1].address, '中央町101', 'Sibling inherits address');
	ui.field('.transfer-child-row:nth-child(2)', 'firstName', '希望');
	ui.captureDownloads();
	ui.clipboard();
	await ui.click('#btn-export-transfer-txt');
	await ui.waitFor(() => __downloads.length === 1, 'Encrypted file download');
	const decoded = await parseTxtContent(__downloads[0].content, 'UiPassword1!');
	assert.strictEqual(decoded.children.length, 2, 'Real WebCrypto file decrypts with both children');
	assert.ok(!__downloads[0].content.includes('中央町101'), 'File has no plaintext address');
	await ui.click('#btn-copy-transfer-text');
	await ui.waitFor(() => window.__copiedText, 'Encrypted copy');
	assert.strictEqual((await parseTxtContent(__copiedText, 'UiPassword1!')).children[1].firstName, '希望', 'Clipboard round trip');
	window.__confirmAnswer = false;
	await ui.click('.transfer-child-row:nth-child(2) button');
	assert.strictEqual(transferState.children.length, 2, 'Cancel child removal');
	await ui.click('#btn-reset-transfer');
	assert.strictEqual(transferState.children[0].firstName, '未来', 'Cancel reset');
	window.__confirmAnswer = true;
	await ui.click('.transfer-child-row:nth-child(2) button');
	assert.strictEqual(transferState.children.length, 1, 'Confirmed sibling removal');
	await ui.click('#btn-reset-transfer');
	assert.strictEqual(transferState.children[0].lastName, '', 'Reset state');
	assert.strictEqual(ui.element('#transfer-export-pass').value, '', 'Reset password');
	await ui.waitFor(() => !localStorage.getItem('kogai_transfer_v2')?.includes('中央町101'), 'Reset storage save');
	assert.ok(!localStorage.getItem('kogai_transfer_v2').includes('中央町101'), 'Reset removes saved personal data');
});

browserTest('UI pipeline: transfer file to district, cancelled duplicate, representative split and hata preservation', async () => {
	await ui.transfer();
	ui.captureDownloads();
	await ui.click('#btn-export-transfer-txt');
	await ui.waitFor(() => __downloads.length === 1, 'Transfer file');
	const transferText = __downloads[0].content;
	await ui.district();
	ui.fill('#hata-location', '保護する交差点');
	await ui.click('#btn-toggle-transfer-import');
	assert.strictEqual(ui.element('#btn-toggle-transfer-import').getAttribute('aria-expanded'), 'true', 'Import panel opened');
	window.__promptAnswers = ['B班'];
	await ui.file('#d-transfer-import-panel input[type="file"]', transferText);
	await ui.waitFor(() => currentDistrict.students.length === 2, 'Transfer file integration');
	assert.strictEqual(currentDistrict.students.find(s => s.firstName === '未来').han, 'B班', 'Assigned han preserved');
	assert.strictEqual(ui.element('#d-transfer-import-panel input[type="file"]').value, '', 'File input cleared for retry');
	await ui.click('#d-transfer-import-panel button[data-click="togglePastePanel"][data-target="d-transfer-paste-panel"]');
	ui.fill('#d-transfer-paste-box', transferText);
	window.__promptAnswers = ['B班'];
	window.__confirmAnswer = false;
	const alertCount = __dialogs.length;
	await ui.click('button[data-click="loadPastedTransferTextIntoDistrict"]');
	await ui.waitFor(() => __dialogs.length > alertCount + 1, 'Duplicate prompt');
	assert.strictEqual(currentDistrict.students.length, 2, 'Duplicate cancellation is atomic');
	window.__confirmAnswer = true;
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	assert.ok(!('hata' in repState.districts[0]), 'Representative excludes local flag data');
	ui.password('rep-pass');
	await ui.click('#rep-districts-tbody button[data-click="exportSingleDistrictFromRep"][data-index="0"]');
	await ui.waitFor(() => __downloads.length === 2, 'Split district file');
	const split = __downloads[1].content;
	assert.ok(!('hata' in await parseTxtContent(split, 'UiPassword1!')), 'Split payload excludes flag data');
	await ui.mode('district');
	await ui.file('#d-file-in', split);
	await ui.waitFor(() => __dialogs.some(d => d.type === 'alert' && d.message.includes('を読み込みました')), 'Split import finished');
	assert.strictEqual(currentDistrict.hata.location, '保護する交差点', 'Local hata preserved');
	assert.strictEqual(currentDistrict.students.length, 2, 'Roster preserved through split round trip');
});

browserTest('UI neighborhood pipeline: encrypted file/paste and mismatch cancellation preserve other rosters', async () => {
	await ui.mode('neighbor');
	await ui.expand('neighbor');
	ui.fill('#neighbor-district-name', '別自治会');
	ui.field('#neighbor-tbody tr:first-child', 'lastName', '会長姓');
	ui.password('neighbor-pass');
	ui.captureDownloads();
	await ui.click('button[data-click="exportNeighborTxt"]');
	await ui.waitFor(() => __downloads.length === 1, 'Neighbor export');
	const text = __downloads[0].content;
	await ui.district();
	await ui.click('#btn-toggle-neighbor-import');
	window.__confirmAnswer = false;
	await ui.file('#d-neighbor-file-input', text);
	await ui.waitFor(() => __dialogs.some(d => d.type === 'confirm' && d.message.includes('異なります')), 'Mismatched name confirmation');
	assert.strictEqual(currentDistrict.neighborhood[0].lastName, '', 'Cancelled name mismatch leaves data');
	window.__confirmAnswer = true;
	ui.fill('#d-neighbor-paste-box', text);
	await ui.click('button[data-click="loadPastedNeighborTextIntoDistrict"]');
	await ui.waitFor(() => currentDistrict.neighborhood[0].lastName === '会長姓', 'Neighbor paste accepted');
	assert.strictEqual(currentDistrict.students[0].lastName, '山田', 'Students preserved');
	assert.strictEqual(currentDistrict.district, '青空地区', 'District name preserved');
	await ui.mode('rep');
	await ui.expand('rep');
	ui.password('rep-pass');
	await ui.file('#rep-files', [{ name: 'neighbor.txt', content: text }, { name: 'corrupt.txt', content: 'ENC:broken' }]);
	await ui.waitFor(() => __dialogs.some(d => d.message.includes('1件のファイル')), 'Mixed-validity multi-file summary');
	assert.strictEqual(repState.districts[0].neighborhood[0].lastName, '会長姓', 'Valid file accepted despite bad file');
	assert.ok(__dialogs.at(-1).message.includes('1件は'), 'Rejected file count visible');
});

browserTest('UI invalid district file and wrong password leave state and storage intact', async () => {
	await ui.district();
	const snapshot = localStorage.getItem('kogai_district_v2');
	for (const text of ['ENC:broken', await encryptPayload(JSON.stringify({ district: '変更禁止', students: [] }), 'Different123!')]) {
		const count = __dialogs.length;
		await ui.file('#d-file-in', text);
		await ui.waitFor(() => __dialogs.length > count, 'Import error notification');
		assert.strictEqual(currentDistrict.district, '青空地区', 'In-memory district unchanged');
		assert.strictEqual(localStorage.getItem('kogai_district_v2'), snapshot, 'Persisted district unchanged');
		assert.strictEqual(ui.element('#d-file-in').value, '', 'Rejected file can be selected again');
	}
});

browserTest('UI encryption migration: all four modes encrypted, reload locks, wrong/correct unlock restores', async () => {
	await ui.transfer();
	await ui.district();
	await ui.mode('neighbor');
	await ui.expand('neighbor');
	ui.fill('#neighbor-district-name', '暗号化自治会');
	await ui.mode('rep');
	await ui.expand('rep');
	ui.field('#sz-external-tbody tr:first-child', 'lastName', '暗号化校長');
	await ui.encrypt();
	for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
		const raw = localStorage.getItem(`kogai_${mode}_v2`);
		assert.ok(raw?.startsWith('STORAGE_ENC:'), `${mode} migrated to ciphertext`);
		assert.ok(!raw.includes('未来') && !raw.includes('山田'), `${mode} has no plaintext names`);
	}
}, { afterReload: async () => {
	assert.ok(ui.visible('#storage-lock-modal'), 'Actual reload starts locked');
	assert.ok(!isStorageUnlocked(), 'Key not persisted');
	ui.fill('#modal-unlock-pass', 'WrongPassword!');
	await ui.click('#storage-lock-modal button[data-click="handlePasswordUnlock"]');
	await ui.waitFor(() => ui.element('#modal-unlock-error').textContent, 'Wrong password rejected');
	assert.ok(ui.visible('#storage-lock-modal'), 'Wrong password keeps lock');
	ui.fill('#modal-unlock-pass', 'UiPassword1!');
	await ui.key('Enter');
	await ui.waitFor(() => !ui.visible('#storage-lock-modal') && currentDistrict.students[0]?.lastName === '山田' && repState.szExternals[0]?.lastName === '暗号化校長' && neighborState.district === '暗号化自治会' && transferState.children[0]?.firstName === '未来', 'Correct password unlock restores all four modes');
	assert.strictEqual(currentDistrict.students[0].lastName, '山田', 'District restored');
	assert.strictEqual(repState.szExternals[0].lastName, '暗号化校長', 'Representative restored');
	assert.strictEqual(neighborState.district, '暗号化自治会', 'Neighborhood restored');
	assert.strictEqual(transferState.children[0].firstName, '未来', 'Transfer restored');
	assert.strictEqual(ui.element('#modal-unlock-pass').value, '', 'Successful unlock removes password from DOM');
} });

browserTest('UI lock purge: all state, draft modal, print, plaintext/paste and revealed password fields', async () => {
	await ui.transfer();
	await ui.district();
	ui.fill('#hata-contact-msg', '秘密の旗振り連絡先');
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	ui.field('#sz-external-tbody tr:first-child', 'lastName', '秘密の校長');
	ui.fill('#seat-grid-container .seat-cell-edit:first-child input', '秘密の座席メモ');
	ui.password('rep-pass', 'PrivatePass1!');
	await ui.encrypt();
	await ui.click('#rep-districts-tbody button[data-click="openRepDistrictDetailModal"][data-index="0"]');
	ui.field('#rep-modal-students-tbody tr:first-child', 'firstName', '秘密の下書き');
	ui.element('#print-area').innerHTML = '<p>秘密の印刷名簿</p>';
	for (const el of document.querySelectorAll('textarea, input[id$="-pass"], input[id$="-pass-confirm"]')) el.value = '秘密の入力';
	// 詳細モーダル表示中にも起きる自動ロックと同一の実装入口で検証する。
	handleImmediateLock();
	assert.ok(ui.visible('#storage-lock-modal'), 'Lock overlay displayed');
	assert.strictEqual(getModalCurrentDistrict(), null, 'Draft personal data released');
	assert.ok(!ui.visible('#rep-district-detail-modal'), 'Detail modal closed');
	assert.ok(!JSON.stringify({ currentDistrict, repState, neighborState, transferState }).includes('秘密'), 'No secret in application state');
	assert.strictEqual(ui.element('#print-area').innerHTML, '', 'Print data purged');
	for (const el of document.querySelectorAll('input, textarea, select')) {
		assert.ok(!el.value.includes('秘密') && !el.value.includes('PrivatePass'), `No secret in DOM field ${el.id || el.getAttribute('data-input')}`);
	}
	assert.strictEqual(ui.element('#rep-modal-students-tbody').textContent, '', 'Closed draft DOM also purged');
});

browserTest('UI encryption setup: initial auto-lock starts and interactions reset its deadline', async () => {
	await ui.district();
	await ui.encrypt();
	assert.ok(window.__autoLockTasks.length >= 1, 'Encryption starts fifteen-minute timer without subsequent interaction');
	const first = window.__autoLockTasks.at(-1);
	window.dispatchEvent(new Event('pointerdown'));
	assert.ok(window.__clearedTimers.includes(first.id), 'Interaction cancels old deadline');
	assert.ok(window.__autoLockTasks.at(-1).id !== first.id, 'Interaction schedules new deadline');
	const actualNow = Date.now;
	const deadline = actualNow() + 15 * 60 * 1000 + 1;
	Date.now = () => deadline;
	try { window.__autoLockTasks.at(-1).callback(); } finally { Date.now = actualNow; }
	assert.ok(!isStorageUnlocked(), 'Expiration locks key');
	assert.ok(ui.visible('#storage-lock-modal'), 'Expiration opens lock UI');
}, { beforeLoad: () => {
	const original = window.setTimeout.bind(window);
	const clear = window.clearTimeout.bind(window);
	window.__autoLockTasks = [];
	window.__clearedTimers = [];
	window.setTimeout = (callback, delay, ...args) => {
		const id = original(callback, delay, ...args);
		if (delay === 15 * 60 * 1000) __autoLockTasks.push({ id, callback });
		return id;
	};
	window.clearTimeout = id => { __clearedTimers.push(id); clear(id); };
} });

browserTest('UI full reset: cancel preserves storage; confirmed wipe survives actual reload in every mode', async () => {
	await ui.transfer();
	await ui.district();
	await ui.encrypt();
	await ui.click('#storage-security-badge');
	window.__confirmAnswer = false;
	await ui.click('#storage-settings-modal button[data-click="handleResetStorageConfirm"]');
	assert.ok(isStorageEncrypted(), 'Reset cancellation preserves auth metadata');
	assert.ok(localStorage.getItem('kogai_transfer_v2'), 'Reset cancellation preserves transfer data');
	window.__confirmAnswer = true;
}, { reloadSelector: '#storage-settings-modal button[data-click="handleResetStorageConfirm"]', afterReload: async () => {
	assert.ok(!isStorageEncrypted(), 'Auth metadata wiped');
	assert.ok(!ui.visible('#storage-lock-modal'), 'Fresh startup is unlocked');
	assert.strictEqual(transferState.children[0].lastName, '', 'Transfer not restored after full wipe');
	assert.strictEqual(currentDistrict.district, '', 'District not restored after full wipe');
	for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
		const raw = localStorage.getItem(`kogai_${mode}_v2`) || '';
		assert.ok(!raw.includes('転入') && !raw.includes('青空'), `${mode} has no old personal data`);
	}
} });

browserTest('UI district year: cancel, grade 1/5/6 boundaries, officer/password purge and hata reset', async () => {
	await ui.district();
	for (const grade of ['5', '6']) {
		await ui.click('#btn-add-student-bottom');
		const idx = currentDistrict.students.length;
		ui.field(`#students-tbody tr:nth-child(${idx})`, 'grade', grade);
		ui.field(`#students-tbody tr:nth-child(${idx})`, 'lastName', grade === '6' ? '卒業' : '進級');
	}
	ui.fill('#hata-location', '交差点');
	ui.fill('#hata-start-date', '2026-10-01');
	ui.fill('#hata-end-date', '2026-10-30');
	window.__confirmAnswer = false;
	await ui.click('#btn-district-year-update');
	assert.strictEqual(currentDistrict.students.length, 3, 'Year update cancel retains all grades');
	window.__confirmAnswer = true;
	await ui.click('#btn-district-year-update');
	assert.strictEqual(currentDistrict.students.map(s => s.grade).sort().join(','), '2,6', 'Grade 1/5 advance; grade 6 graduates');
	assert.ok(currentDistrict.students.every(s => s.class === '' && s.leader === ''), 'Classes/roles reset');
	assert.strictEqual(ui.element('#d-pass').value, '', 'Password cleared');
	assert.strictEqual(currentDistrict.hata.location, '交差点', 'Hata base location retained');
	assert.strictEqual(currentDistrict.hata.startDate, '', 'Old period cleared');
	assert.strictEqual(ui.element('#hata-start-date').value, '', 'Old period not revived from DOM');
});

browserTest('UI neighbor and representative year update: cancel and retain organizational templates only', async () => {
	await ui.mode('neighbor');
	await ui.expand('neighbor');
	ui.field('#neighbor-tbody tr:first-child', 'lastName', '旧会長');
	window.__confirmAnswer = false;
	await ui.click('button[data-click="runNeighborYearUpdate"]');
	assert.strictEqual(neighborState.neighborhood[0].lastName, '旧会長', 'Neighbor year cancellation');
	window.__confirmAnswer = true;
	await ui.click('button[data-click="runNeighborYearUpdate"]');
	assert.strictEqual(neighborState.neighborhood[0].role, '会長', 'Role template retained');
	assert.strictEqual(neighborState.neighborhood[0].lastName, '', 'Prior officer personal data cleared');
	await ui.district();
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	ui.field('#sz-external-tbody tr:first-child', 'lastName', '旧校長');
	ui.fill('#seat-grid-container .seat-cell-edit:first-child input', '旧座席');
	window.__confirmAnswer = false;
	await ui.click('button[data-click="runRepYearUpdate"]');
	assert.strictEqual(repState.districts.length, 1, 'Rep year cancellation');
	window.__confirmAnswer = true;
	await ui.click('button[data-click="runRepYearUpdate"]');
	assert.strictEqual(repState.districts.length, 0, 'Rep year clears collected districts');
	assert.strictEqual(repState.szExternals[0].role, '校長', 'External organization template retained');
	assert.strictEqual(repState.szExternals[0].lastName, '', 'External name cleared');
	assert.strictEqual(Object.keys(repState.seatConfig.cells).length, 0, 'Seat assignments cleared');
});

browserTest('UI hata: imported holidays survive DOM/state/storage/schedule and actual reload', async () => {
	await ui.district();
	const config = { scheduleTitle: '読込シフト', startDate: '2026-10-19', endDate: '2026-10-23', holidays: '2026-10-20,独自休校日', metaLocation: '読込交差点', members: '外部担当' };
	await ui.file('#card-d-hata input[type="file"]', JSON.stringify(config), 'hata.json');
	await ui.waitFor(() => ui.element('#hata-title').value === '読込シフト', 'Official JSON loaded');
	assert.strictEqual(ui.element('#hata-holidays').value, config.holidays, 'Imported holidays restored to DOM');
	assert.strictEqual(currentDistrict.hata.holidays, config.holidays, 'State holidays preserved');
	await ui.click('button[data-click="runAutoHataGeneration"]');
	assert.ok(ui.element('#hata-schedule-preview').textContent.includes('独自休校日'), 'Imported holiday used in generated schedule');
	assert.strictEqual(JSON.parse(localStorage.getItem('kogai_district_v2')).hata.holidays, config.holidays, 'Imported holiday persisted');
}, { afterReload: async () => {
	await ui.expand('district');
	assert.strictEqual(ui.element('#hata-holidays').value, '2026-10-20,独自休校日', 'Holiday restored after reload');
	assert.strictEqual(currentDistrict.hata.holidays, '2026-10-20,独自休校日', 'Reload does not overwrite state');
} });

browserTest('UI hata: malformed JSON is reported, state preserved and same file retry enabled', async () => {
	await ui.district();
	const before = JSON.stringify(currentDistrict.hata);
	const input = '#card-d-hata input[type="file"]';
	for (const content of ['', '{broken', 'null', '[]', '{"weekdays":"Monday"}']) {
		const count = __dialogs.length;
		await ui.file(input, content, 'same.json');
		await ui.waitFor(() => __dialogs.length > count, 'Invalid JSON notification');
		assert.strictEqual(JSON.stringify(currentDistrict.hata), before, 'Bad JSON keeps previous config');
		assert.strictEqual(ui.element(input).value, '', 'File cleared for same-file retry');
	}
});

for (const lastName of ["O'Neil", "');window.__injected=1;//", '<img src=x onerror=window.__injected=1>']) {
	browserTest(`UI hata exemption: quotes/HTML remain data (${lastName.slice(0, 14)})`, async () => {
		await ui.district();
		const surname = window.__surname;
		ui.field('#students-tbody tr:first-child', 'lastName', surname);
		await ui.waitFor(() => document.querySelector('#hata-exempt-list label')?.textContent.includes(surname), 'Exemption choices follow student editing');
		const expectedKey = extractHouseholdsFromStudents(currentDistrict.students)[0].key;
		await ui.click('#hata-exempt-list label:first-child');
		assert.strictEqual(window.__injected, undefined, 'Input never executes JavaScript');
		assert.ok(currentDistrict.hata.exemptHouseholds.includes(expectedKey), 'Quoted surname exemption persists');
		await ui.click('#hata-exempt-list label:first-child');
		assert.strictEqual(currentDistrict.hata.exemptHouseholds.length, 0, 'Unchecking removes exemption');
	}, { beforeLoad: new Function(`window.__surname = ${JSON.stringify(lastName)};`) });
}

browserTest('UI hata: generation, exemption, stats, JSON export, print title and cleanup', async () => {
	await ui.district();
	await ui.click('#btn-add-student-bottom');
	ui.field('#students-tbody tr:nth-child(2)', 'lastName', '佐藤');
	ui.field('#students-tbody tr:nth-child(2)', 'firstName', '花子');
	ui.field('#students-tbody tr:nth-child(2)', 'address', '202');
	ui.fill('#hata-start-date', '2026-10-19');
	ui.fill('#hata-end-date', '2026-10-23');
	ui.fill('#hata-holidays', '2026-10-20,休校');
	ui.fill('#hata-specials', '2026-10-21,固定担当,行事');
	assert.ok(ui.element('#hata-exempt-list').textContent.includes('佐藤'), 'Exemption choices follow student additions');
	await ui.click('#hata-exempt-list label:first-child');
	await ui.click('button[data-click="runAutoHataGeneration"]');
	assert.ok(ui.element('#hata-schedule-preview').textContent.includes('固定担当'), 'Special day rendered');
	assert.ok(ui.element('#hata-schedule-preview').textContent.includes('休校'), 'Holiday rendered');
	await ui.click('button[data-click="toggleHataSummary"]');
	assert.ok(ui.element('#hata-summary-container').textContent.includes('佐藤'), 'Stats rendered');
	ui.captureDownloads();
	await ui.click('#card-d-hata button[data-click="exportHataSettings"]');
	assert.strictEqual(JSON.parse(__downloads[0].content).specials, '2026-10-21,固定担当,行事', 'Official JSON carries schedule settings');
	const title = document.title;
	let printCount = 0;
	window.print = () => {
		printCount++;
		assert.strictEqual(document.title, currentDistrict.hata.title, 'Hata PDF title');
		assert.ok(document.body.classList.contains('printing-hata'), 'Hata print mode set');
		assert.ok(ui.element('#hata-print-active-sheet').textContent.includes('固定担当'), 'Print contains shift');
	};
	await ui.click('button[data-click="printHataSchedule"]');
	assert.strictEqual(printCount, 1, 'One print invocation');
	assert.strictEqual(document.title, title, 'Title restored');
	assert.ok(!document.getElementById('hata-print-active-sheet'), 'Temporary print sheet removed');
});

browserTest('UI seat editor: min/max resize, facility/custom text, side labels, attendance selection', async () => {
	await ui.mode('rep');
	await ui.expand('rep');
	ui.fill('#seat-cols', '1');
	ui.fill('#seat-rows', '99');
	assert.strictEqual(repState.seatConfig.cols, 2, 'Column minimum enforced');
	assert.strictEqual(repState.seatConfig.rows, 14, 'Row maximum enforced');
	assert.strictEqual(document.querySelectorAll('.seat-cell-edit').length, 28, 'Grid shape matches clamped dimensions');
	ui.fill('#seat-cols', '99');
	ui.fill('#seat-rows', '1');
	assert.strictEqual(repState.seatConfig.cols, 10, 'Column maximum enforced');
	assert.strictEqual(repState.seatConfig.rows, 2, 'Row minimum enforced');
	ui.fill('#seat-grid-container .seat-cell-edit:first-child select', 'FAC_STAGE');
	ui.fill('#seat-grid-container .seat-cell-edit:first-child input', '司会席');
	assert.strictEqual(repState.seatConfig.cells['0_0'].refKey, 'FAC_STAGE', 'Facility choice persists');
	ui.fill('#seat-top-label', '前方の舞台');
	assert.strictEqual(ui.element('#seat-top-bar-view').textContent, '前方の舞台', 'Label input updates view');
	const left = ui.element('#seat-left-bar').textContent;
	await ui.click('button[data-click="swapSeatWindowCorridor"]');
	assert.strictEqual(ui.element('#seat-right-bar').textContent, left, 'Left/right swapped');
	await ui.click('#sz-external-tbody tr:first-child input[type="checkbox"]');
	assert.ok(![...ui.element('#seat-grid-container select').options].some(o => o.value === 'EXT_0'), 'Absent attendee removed from choices');
});

browserTest('UI seat deletion: removing another external attendee preserves assigned person', async () => {
	await ui.mode('rep');
	await ui.expand('rep');
	for (const [idx, name] of [[1, '出席者A'], [2, '出席者B'], [3, '出席者C']]) ui.field(`#sz-external-tbody tr:nth-child(${idx})`, 'lastName', name);
	ui.fill('#seat-grid-container .seat-cell-edit:first-child select', 'EXT_1');
	window.__confirmAnswer = false;
	await ui.click('#sz-external-tbody tr:first-child button.btn-danger');
	assert.strictEqual(repState.szExternals[1].lastName, '出席者B', 'Deletion cancel preserves attendees');
	window.__confirmAnswer = true;
	await ui.click('#sz-external-tbody tr:first-child button.btn-danger');
	const select = ui.element('#seat-grid-container .seat-cell-edit:first-child select');
	assert.ok(select.selectedOptions[0].textContent.includes('出席者B'), 'Seat remains assigned to B after deleting A');
	await ui.click('#sz-external-tbody tr:first-child button.btn-danger');
	assert.strictEqual(ui.element('#seat-grid-container .seat-cell-edit:first-child select').value, '', 'Deleting B clears its seat');
});

browserTest('UI seat deletion: removing preceding district/officer keeps other assignments', async () => {
	await ui.district('最初地区');
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	await ui.click('button[data-click="addNewRepDistrict"]');
	ui.fill('#rep-new-district-name', '次地区');
	await ui.click('#btn-confirm-add-district');
	await ui.click('#rep-districts-tbody button[data-click="openRepDistrictDetailModal"][data-index="1"]');
	ui.field('#rep-modal-officer-tbody tr:first-child', 'lastName', '役員A');
	await ui.click('#rep-district-detail-modal button[data-click="addModalOfficerRow"]');
	ui.field('#rep-modal-officer-tbody tr:nth-child(2)', 'lastName', '役員B');
	await ui.click('button[data-click="saveAndCloseRepDistrictDetailModal"]');
	assert.ok([...ui.element('#seat-grid-container select').options].some(o => o.value === 'OFF_1_1'), 'Modal save refreshes participant options');
	ui.fill('#seat-grid-container .seat-cell-edit:first-child select', 'OFF_1_1');
	await ui.click('#rep-districts-tbody button[data-click="deleteRepDistrict"][data-index="0"]');
	assert.ok(ui.element('#seat-grid-container select').selectedOptions[0].textContent.includes('役員B'), 'District deletion keeps other district officer');
	await ui.click('#rep-districts-tbody button[data-click="openRepDistrictDetailModal"][data-index="0"]');
	await ui.click('#rep-modal-officer-tbody tr:first-child button');
	await ui.click('button[data-click="saveAndCloseRepDistrictDetailModal"]');
	assert.ok(ui.element('#seat-grid-container select').selectedOptions[0].textContent.includes('役員B'), 'Officer deletion keeps later officer');
});

browserTest('UI print: selected district documents, opt-out contacts, separate titles, empty selection', async () => {
	await ui.district();
	ui.fill('#officers-container [data-field="tel"]', '090-9999-8888');
	ui.fill('#officers-container [data-field="email"]', 'secret@example.test');
	ui.capturePrints();
	await ui.click('#d-opt-officer-tel');
	await ui.click('#d-opt-officer-email');
	await ui.click('#d-print-neighbors');
	const title = document.title;
	await ui.click('button[data-click="printSingleDistrictSelected"]');
	assert.strictEqual(__prints[0].title, '児童名簿_青空地区', 'Single document PDF title');
	assert.ok(!__prints[0].html.includes('090-9999-8888') && !__prints[0].html.includes('secret@example.test'), 'Officer contacts omitted');
	assert.ok(__prints[0].html.includes('山田'), 'Student name printed');
	await ui.click('#d-print-neighbors');
	await ui.click('#btn-print-separate-pdf');
	assert.strictEqual(__prints.slice(1).map(p => p.title).join(','), '児童名簿_青空地区,自治会役員名簿_青空地区', 'Separate print produces one title per report');
	assert.strictEqual(document.title, title, 'App title restored after separate PDF');
	await ui.click('#d-print-students');
	await ui.click('#d-print-neighbors');
	await ui.click('button[data-click="printSingleDistrictSelected"]');
	assert.strictEqual(__prints.length, 3, 'No print for empty selection');
	assert.ok(__dialogs.at(-1).message.includes('チェック'), 'Empty selection guidance');
});

browserTest('UI neighbor tent cards: semantic name/kana/role and no-rows guard', async () => {
	await ui.mode('neighbor');
	await ui.expand('neighbor');
	ui.fill('#neighbor-district-name', '中央自治会');
	for (const [field, value] of Object.entries({ lastName: '山田', firstName: '太郎', lastNameKana: 'やまだ', firstNameKana: 'たろう' })) ui.field('#neighbor-tbody tr:first-child', field, value);
	ui.capturePrints();
	await ui.click('button[data-click="printNeighborTentCards"]');
	assert.strictEqual(ui.element('#print-area .tent-name').textContent.trim(), '山田 太郎', 'Name is printed in name field');
	assert.strictEqual(ui.element('#print-area .tent-kana').textContent.trim(), 'やまだ たろう', 'Kana is printed in kana field');
	assert.strictEqual(ui.element('#print-area .tent-role').textContent.trim(), '会長', 'Role is printed in role field');
	assert.strictEqual(__prints[0].title, '自治会役員席札_中央自治会', 'Neighbor PDF title');
});

browserTest('UI representative print: all twelve report choices render, selection controls and empty guard', async () => {
	await ui.district();
	ui.fill('#officers-container [data-field="lastName"]', '役員姓');
	ui.fill('#officers-container [data-field="childLastName"]', '児童姓');
	ui.fill('#officers-container [data-field="childFirstName"]', '児童名');
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	ui.capturePrints();
	await ui.click('button[data-click="setRepPrintChecks"][data-flag="false"]');
	await ui.click('button[data-click="executeRepSelectedPrint"]');
	assert.strictEqual(__prints.length, 0, 'No reports when selection empty');
	const choices = [...document.querySelectorAll('.rep-print-chk')].map(el => el.value);
	assert.strictEqual(choices.length, 12, 'Twelve report types');
	for (const choice of choices) {
		await ui.click(`.rep-print-chk[value="${choice}"]`);
		const before = __prints.length;
		await ui.click('button[data-click="executeRepSelectedPrint"]');
		assert.strictEqual(__prints.length, before + 1, `${choice} prints`);
		assert.ok(__prints.at(-1).html.includes('print-page'), `${choice} renders print markup`);
		await ui.click(`.rep-print-chk[value="${choice}"]`);
	}
	await ui.click('button[data-click="setRepPrintChecks"][data-flag="true"]');
	assert.strictEqual(document.querySelectorAll('.rep-print-chk:checked').length, 12, 'Select all reports');
	await ui.click('button[data-click="toggleAllDistrictChecks"][data-flag="false"]');
	assert.ok(!repState.districts[0].selectedForPrint, 'District deselection reaches state');
	await ui.click('button[data-click="toggleAllDistrictChecks"][data-flag="true"]');
	assert.ok(repState.districts[0].selectedForPrint, 'District selection reaches state');
});

browserTest('UI app share: native share, cancellation, clipboard and prompt fallbacks', async () => {
	let shared;
	Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { shared = data; } });
	await ui.mode('transfer');
	await ui.click('#btn-share-transfer-url');
	await ui.waitFor(() => shared, 'Share API call');
	assert.ok(shared.url.includes('mode=transfer'), 'Shared link targets transfer mode');
	ui.clipboard();
	Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
	await ui.click('#btn-share-transfer-url');
	await new Promise(resolve => setTimeout(resolve, 20));
	assert.strictEqual(window.__copiedText, undefined, 'User cancellation has no clipboard side effect');
	Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
	await ui.click('#btn-share-transfer-url');
	await ui.waitFor(() => window.__copiedText, 'Clipboard fallback');
	assert.ok(__copiedText.includes('mode=transfer'), 'Clipboard link preserves target');
	ui.clipboard(true);
	await ui.click('#btn-share-transfer-url');
	await ui.waitFor(() => __dialogs.some(d => d.type === 'prompt'), 'Prompt fallback when clipboard denied');
	assert.ok(__dialogs.some(d => d.message.includes('URL')), 'Manual copy guidance');
});

browserTest('UI version settings: pending button, failure recovery, current/latest and cancellation', async () => {
	await ui.click('#storage-security-badge');
	let resolveResponse;
	window.fetch = () => new Promise(resolve => { resolveResponse = resolve; });
	await ui.click('#btn-manual-check-update');
	assert.ok(ui.element('#btn-manual-check-update').disabled, 'Pending check prevents double click');
	resolveResponse({ ok: false, status: 503 });
	await ui.waitFor(() => !ui.element('#btn-manual-check-update').disabled, 'Button restored after failed request');
	assert.ok(ui.element('#version-check-status').textContent.includes('失敗'), 'Network failure feedback');
	window.fetch = async () => ({ ok: true, json: async () => ({ version: CURRENT_APP_VERSION }) });
	await ui.click('#btn-manual-check-update');
	await ui.waitFor(() => ui.element('#version-check-status').textContent.includes('最新バージョンです'), 'Current version feedback');
	window.fetch = async () => ({ ok: true, json: async () => ({ version: '99.0.0' }) });
	window.__confirmAnswer = false;
	await ui.click('#btn-manual-check-update');
	await ui.waitFor(() => ui.element('#version-check-status').textContent.includes('キャンセル'), 'Update cancel feedback');
	assert.ok(!ui.element('#btn-manual-check-update').disabled, 'Cancelled check restores button');
});

for (const width of [375, 768, 1280]) {
	browserTest(`UI responsive: ${width}px controls and hata layout remain reachable`, async () => {
		await ui.district();
		assert.ok(ui.element('#btn-add-student-top').getBoundingClientRect().width > 40, 'Student add button has usable width');
		assert.ok(ui.element('#students-tbody').closest('.table-scroll, .table-responsive, .table-wrap, .table-container, .table-wrapper') || getComputedStyle(ui.element('#students-tbody').parentElement.parentElement).overflowX === 'auto', 'Wide student table has scroll containment');
		ui.fill('#hata-start-date', '2026-10-19');
		ui.fill('#hata-end-date', '2026-10-23');
		await ui.click('button[data-click="runAutoHataGeneration"]');
		assert.ok(ui.element('#hata-schedule-preview').children.length > 0, 'Schedule rendered at current viewport');
		const expected = innerWidth < 768 ? '.hata-card-list' : '.hata-sheet';
		assert.ok(document.querySelector(`#hata-schedule-preview ${expected}`), 'Viewport selects expected schedule layout');
		assert.ok(document.documentElement.scrollWidth <= innerWidth + 1, 'No page-wide horizontal overflow');
	}, { viewport: [width, 900] });
}

browserTest('UI district paste restore: actual button restores file content and local flag settings', async () => {
	await ui.district();
	ui.captureDownloads();
	await ui.click('#btn-save-district-file');
	await ui.waitFor(() => __downloads.length === 1, 'District encrypted export');
	ui.fill('#d-name', '変更後');
	await ui.click('#btn-load-district-paste');
	ui.fill('#d-paste-box', __downloads[0].content);
	await ui.click('button[data-click="loadPastedTextToDistrict"]');
	await ui.waitFor(() => currentDistrict.district === '青空地区' && ui.element('#d-paste-box').value === '', 'Paste restore completes');
	assert.strictEqual(ui.element('#d-name').value, '青空地区', 'Restored name rendered');
	assert.strictEqual(ui.element('#d-paste-box').value, '', 'Successful restore clears paste data');
});

browserTest('UI rep transfer direct: file picker assigns district and han; cancellation is atomic', async () => {
	await ui.transfer();
	ui.captureDownloads();
	await ui.click('#btn-export-transfer-txt');
	await ui.waitFor(() => __downloads.length === 1, 'Transfer file');
	const text = __downloads[0].content;
	await ui.mode('rep');
	await ui.expand('rep');
	ui.password('rep-pass');
	window.__promptAnswers = [null];
	await ui.file('input[data-change="loadTransferFileIntoRep"]', text);
	await ui.waitFor(() => __dialogs.some(d => d.type === 'prompt'), 'District assignment prompt');
	assert.strictEqual(repState.districts.length, 0, 'Cancelled assignment leaves no partial district');
	window.__promptAnswers = ['直接地区', '2班'];
	await ui.file('#rep-files', text);
	await ui.waitFor(() => repState.districts.length === 1, 'General file picker also routes transfer data');
	assert.strictEqual(repState.districts[0].district, '直接地区', 'Chosen district used');
	assert.strictEqual(repState.districts[0].students[0].han, '2班', 'Assigned han persisted');
	assert.strictEqual(repState.districts[0].students[0].firstName, '未来', 'Child reaches roster');
});

browserTest('UI neighbor copy: mismatched password confirmation prevents encrypted output', async () => {
	await ui.mode('neighbor');
	await ui.expand('neighbor');
	ui.fill('#neighbor-district-name', '確認自治会');
	ui.password('neighbor-pass');
	ui.fill('#neighbor-pass-confirm', 'Different123!');
	ui.clipboard();
	await ui.click('button[data-click="copyNeighborEncryptedText"]');
	await ui.waitFor(() => __dialogs.length > 0, 'Copy validation completes');
	assert.strictEqual(window.__copiedText, undefined, 'Mismatch must not produce encrypted clipboard data');
	assert.ok(__dialogs.at(-1).message.includes('一致'), 'Mismatch explained');
});

browserTest('UI rep neighbor deletion: selected attendance and seat follow surviving officer', async () => {
	await ui.district();
	ui.field('#neighborhood-tbody tr:first-child', 'lastName', '自治会A');
	await ui.click('#btn-add-neighbor-bottom');
	ui.field('#neighborhood-tbody tr:nth-child(2)', 'lastName', '自治会B');
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	await ui.click('#sz-neighborhood-selector input[data-change="toggleSzNeighbor"][data-index="0"][data-index2="1"]');
	const selector = ui.element('#seat-grid-container select');
	const selected = [...selector.options].find(o => o.textContent.includes('自治会B'));
	ui.fill(selector, selected.value);
	await ui.click('#rep-districts-tbody button[data-click="openRepDistrictDetailModal"][data-index="0"]');
	ui.field('#rep-modal-neighbor-tbody tr:nth-child(2)', 'role', '副会長');
	await ui.click('button[data-click="saveAndCloseRepDistrictDetailModal"]');
	assert.ok(ui.element('#seat-grid-container select').selectedOptions[0].textContent.includes('自治会B'), 'Editing role preserves same attendee and seat');
	await ui.click('#rep-districts-tbody button[data-click="openRepDistrictDetailModal"][data-index="0"]');
	await ui.click('#rep-modal-neighbor-tbody tr:first-child button');
	await ui.click('button[data-click="saveAndCloseRepDistrictDetailModal"]');
	assert.ok(ui.element('#sz-neighborhood-selector').textContent.includes('自治会B'), 'Attendance list refreshed');
	assert.ok(!ui.element('#sz-neighborhood-selector').textContent.includes('自治会A'), 'Removed neighbor no longer selectable');
	assert.ok(ui.element('#seat-grid-container select').selectedOptions[0].textContent.includes('自治会B'), 'Surviving neighbor keeps seat');
});


browserTest('UI lock button: ciphertext unchanged, lock rejects writes and unlock restores data', async () => {
	await ui.district();
	await ui.encrypt();
	const ciphertext = localStorage.getItem('kogai_district_v2');
	await ui.click('#storage-security-badge');
	await ui.click('button[data-click="handleImmediateLock"]');
	assert.ok(ui.visible('#storage-lock-modal'), 'Lock button displays unlock modal');
	await saveStorageData('kogai_district_v2', { district: '上書き禁止' });
	assert.strictEqual(localStorage.getItem('kogai_district_v2'), ciphertext, 'Locked write leaves ciphertext intact');
	ui.fill('#modal-unlock-pass', 'UiPassword1!');
	await ui.click('#storage-lock-modal button[data-click="handlePasswordUnlock"]');
	await ui.waitFor(() => !ui.visible('#storage-lock-modal') && currentDistrict.district === '青空地区', 'Unlock restores roster');
	assert.strictEqual(ui.element('#modal-unlock-pass').value, '', 'Unlock password wiped');
});

browserTest('UI printing CSS: old ordinary reports do not leak into hata print, landscape applies', async () => {
	await ui.district();
	ui.capturePrints();
	await ui.click('button[data-click="printSingleDistrictSelected"]');
	assert.ok(ui.element('#print-area').innerHTML.length > 0, 'Ordinary print leaves prior report DOM');
	ui.fill('#hata-start-date', '2026-10-19');
	ui.fill('#hata-end-date', '2026-10-23');
	ui.fill('#hata-orientation', 'landscape');
	let printCount = 0;
	// 印刷メディア適用中の同期print呼出内で実際のCSSOMを確認する。
	window.print = () => {
		printCount++;
		assert.strictEqual(getComputedStyle(ui.element('#print-area')).display, 'none', 'Old ordinary reports hidden during hata print');
		assert.strictEqual(getComputedStyle(ui.element('.container')).display, 'none', 'Editing UI hidden for print');
		assert.strictEqual(getComputedStyle(ui.element('header')).display, 'none', 'Header hidden for print');
		assert.ok(ui.visible('#hata-print-active-sheet'), 'Only active shift sheet visible');
		const rules = [...document.querySelectorAll('style')].flatMap(style => [...style.sheet.cssRules]);
		const pageRules = rules.flatMap(rule => rule.cssRules ? [...rule.cssRules] : [rule]).filter(rule => rule.selectorText === '@page' || rule.constructor.name === 'CSSPageRule');
		assert.ok(pageRules.some(rule => rule.style.getPropertyValue('size').includes('landscape')), 'Selected orientation reaches print page rules');
	};
	await ui.printMedia(true);
	// 印刷メディアは画面ボタンを非表示にするため、押下直後に印刷が呼ばれる実入口を使う。
	printHataSchedule();
	assert.strictEqual(printCount, 1, 'Print CSS inspected inside actual pipeline');
	await ui.printMedia(false);
	assert.ok(ui.visible('#mode-active-badge'), 'Screen UI restored');
});

for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
	browserTest(`UI authenticated bad schema: ${mode} rejected before state/DOM/storage mutation`, async () => {
		await ui.district();
		const mode = window.__schemaMode;
		if (mode === 'neighbor') {
			await ui.mode('neighbor'); await ui.expand('neighbor');
			ui.fill('#neighbor-district-name', '維持する自治会');
			ui.fill('#neighbor-import-pass', 'UiPassword1!');
			await saveNeighborLocal();
		} else if (mode === 'rep') {
			await ui.mode('rep'); await ui.expand('rep'); ui.password('rep-pass');
		}
		const snapshots = () => JSON.stringify({ currentDistrict, repState, neighborState, transferState });
		const before = snapshots();
		const stored = JSON.stringify({ ...localStorage });
		const payloads = {
			district: [{ district: '不正地区', students: {} }, { district: {}, students: [] }, { district: '不正地区', savedFilePassword: { toString: null } }, { district: '不正地区', hata: { scheduleCreatedDate: { toString: null } } }, { district: '不正地区', hata: { district: { toString: null } } }, { district: '不正地区', hata: { exemptHouseholds: {} } }, { district: '取込地区', officer: { lastName: '山田', han: {} } }, { district: '取込地区', officer: { childName: {} } }],
			rep: [{ districts: {}, szExternals: [] }, { districts: [{ district: '不正地区', students: {} }], szExternals: [] }, { districts: [], seatConfig: { cols: 'garbage', cells: {} } }, { districts: [{ district: '取込地区', officer: { lastName: '山田', han: {} } }] }],
			neighbor: [{ district: '不正自治会', neighborhood: [null] }, { district: {}, neighborhood: [] }],
			transfer: [{ isTransferData: true, children: [{}] }, { isTransferData: true, children: 'not-an-array' }]
		};
		const input = { district: '#d-file-in', rep: 'input[data-change="loadRepMasterTxt"]', neighbor: '#neighbor-file-input', transfer: '#d-transfer-import-panel input[type="file"]' }[mode];
		for (const payload of payloads[mode]) {
			const text = await encryptPayload(JSON.stringify(payload), 'UiPassword1!');
			const count = __dialogs.length;
			await ui.file(input, text);
			await ui.waitFor(() => __dialogs.length > count && ui.element(input).value === '', 'Malformed data handled');
			assert.strictEqual(snapshots(), before, 'Rejected authenticated payload leaves all state unchanged');
			assert.strictEqual(JSON.stringify({ ...localStorage }), stored, 'Rejected payload leaves storage unchanged');
			assert.strictEqual(ui.element('#d-name').value, '青空地区', 'Existing district DOM untouched');
		}
	}, { beforeLoad: new Function(`window.__schemaMode = ${JSON.stringify(mode)};`) });
}

browserTest('UI legacy officer: valid single-row data restores normalized name, child and han fields', async () => {
	await ui.district();
	const legacy = { district: '旧形式地区', officer: { name: '佐藤 花子', childName: '佐藤 太郎', han: '旧班', role: '地区長' } };
	const text = await encryptPayload(JSON.stringify(legacy), 'UiPassword1!');
	await ui.file('#d-file-in', text);
	await ui.waitFor(() => ui.element('#d-name').value === '旧形式地区' && ui.element('#d-file-in').value === '', 'Legacy district restored');
	assert.strictEqual(currentDistrict.officers[0].lastName, '佐藤', 'Legacy full name normalized');
	assert.strictEqual(currentDistrict.officers[0].firstName, '花子', 'Legacy first name retained');
	assert.strictEqual(currentDistrict.officers[0].childLastName, '佐藤', 'Legacy child normalized');
	assert.strictEqual(currentDistrict.officers[0].childFirstName, '太郎', 'Legacy child first name retained');
	assert.strictEqual(ui.element('#officers-container select[data-field="han"]').value, '旧班', 'Legacy han reaches actual row selector');
	assert.ok(!Object.hasOwn(currentDistrict, 'officer'), 'Single legacy property replaced by row array');
});

for (const failure of ['crypto', 'quota']) {
	browserTest(`UI encryption failure: ${failure} preserves plaintext consistently, retry then reload`, async () => {
		await ui.transfer();
		await ui.district();
		const keys = ['district', 'rep', 'neighbor', 'transfer'].map(mode => `kogai_${mode}_v2`);
		const before = keys.map(key => localStorage.getItem(key));
		const failure = window.__failureMode;
		const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
		const setItem = Storage.prototype.setItem;
		if (failure === 'crypto') crypto.subtle.encrypt = async () => { throw new Error('Injected crypto failure'); };
		else Storage.prototype.setItem = function(key, value) {
			if (key === 'kogai_neighbor_v2' && String(value).startsWith('STORAGE_ENC:')) throw new DOMException('Injected quota', 'QuotaExceededError');
			return setItem.call(this, key, value);
		};
		await ui.click('#storage-security-badge');
		ui.password('modal-set-pass');
		const count = __dialogs.length;
		await ui.click('#modal-btn-enable-enc');
		await ui.waitFor(() => __dialogs.length > count, 'Encryption failure notified');
		assert.ok(!isStorageEncrypted(), 'Failed migration never marked protected');
		assert.ok(__dialogs.at(-1).message.includes('失敗'), 'No false success notification');
		assert.strictEqual(JSON.stringify(keys.map(key => localStorage.getItem(key))), JSON.stringify(before), 'Rollback preserves every previous value');
		crypto.subtle.encrypt = encrypt;
		Storage.prototype.setItem = setItem;
		await ui.click('#modal-btn-enable-enc');
		await ui.waitFor(() => !ui.visible('#storage-settings-modal'), 'Retry succeeds');
		assert.ok(keys.every(key => localStorage.getItem(key)?.startsWith('STORAGE_ENC:')), 'Retry protects all modes');
	}, { beforeLoad: new Function(`window.__failureMode = ${JSON.stringify(failure)};`), afterReload: async () => {
		assert.ok(ui.visible('#storage-lock-modal'), 'Retry persists encrypted state on reload');
		ui.fill('#modal-unlock-pass', 'UiPassword1!');
		await ui.key('Enter');
		await ui.waitFor(() => currentDistrict.district === '青空地区' && transferState.children[0]?.firstName === '未来', 'Retry data can be restored after real reload');
		assert.strictEqual(currentDistrict.students[0].lastName, '山田', 'Existing data survives failed migration and retry');
	} });
}

browserTest('UI pending decrypt: lock prevents late import from restoring purged personal data', async () => {
	await ui.district();
	const incoming = { district: '遅延秘密地区', students: [], neighborhood: [], officers: [{}] };
	const text = await encryptPayload(JSON.stringify(incoming), 'UiPassword1!');
	await ui.encrypt();
	const decrypt = crypto.subtle.decrypt.bind(crypto.subtle);
	let release;
	crypto.subtle.decrypt = async (...args) => {
		const result = await decrypt(...args);
		await new Promise(resolve => { release = resolve; });
		return result;
	};
	await ui.file('#d-file-in', text);
	await ui.waitFor(() => release, 'Import decrypt waiting');
	handleImmediateLock();
	crypto.subtle.decrypt = decrypt;
	release();
	await ui.waitFor(() => ui.element('#d-file-in').value === '', 'Cancelled late import completed');
	assert.ok(!isStorageUnlocked(), 'Key remains locked');
	assert.strictEqual(currentDistrict.district, '', 'Late decrypt cannot repopulate state');
	assert.strictEqual(ui.element('#d-name').value, '', 'Late decrypt cannot repopulate DOM');
	assert.ok(ui.visible('#storage-lock-modal'), 'Lock modal remains active');
});

browserTest('UI representative master: exported master restores through the paste control', async () => {
	await ui.district();
	await ui.mode('rep');
	await ui.expand('rep');
	await ui.click('button[data-click="addCurrentDistrictToRep"]');
	ui.password('rep-pass');
	ui.captureDownloads();
	await ui.click('button[data-click="exportRepMasterTxt"]');
	await ui.waitFor(() => __downloads.length === 1, 'Master export');
	await ui.click('button[data-click="clearAllRepDistricts"]');
	assert.strictEqual(repState.districts.length, 0, 'Existing master cleared');
	ui.fill('#rep-paste-box', __downloads[0].content);
	await ui.click('button[data-click="loadPastedTextToRep"]');
	await ui.waitFor(() => ui.element('#rep-paste-box').value === '', 'Master paste completed');
	assert.strictEqual(repState.districts[0].district, '青空地区', 'Master pasted as master rather than an anonymous district');
	assert.strictEqual(repState.districts[0].students[0].lastName, '山田', 'Nested roster restored');
});


browserTest('UI hata holiday arrays: normalize, use, save and restore after reload', async () => {
	await ui.district();
	const config = { scheduleTitle: '配列休日シフト', startDate: '2026-10-19', endDate: '2026-10-23', holidays: [{ date: '2026-10-20', name: '配列の休校日' }] };
	await ui.file('#card-d-hata input[type="file"]', JSON.stringify(config), 'array.json');
	await ui.waitFor(() => ui.element('#hata-title').value === '配列休日シフト', 'Array-form settings loaded');
	assert.strictEqual(ui.element('#hata-holidays').value, '2026-10-20,配列の休校日', 'Holiday array normalized for text editor');
	assert.ok(ui.element('#hata-schedule-preview').textContent.includes('配列の休校日'), 'Array holiday used as holiday');
	assert.strictEqual(JSON.parse(localStorage.getItem('kogai_district_v2')).hata.holidays, '2026-10-20,配列の休校日', 'Normalized holiday saved');
}, { afterReload: async () => {
	await ui.expand('district');
	assert.strictEqual(ui.element('#hata-holidays').value, '2026-10-20,配列の休校日', 'Array holiday survives real reload');
	assert.ok(ui.element('#hata-schedule-preview').textContent.includes('配列の休校日'), 'Reload still observes school holiday');
} });
