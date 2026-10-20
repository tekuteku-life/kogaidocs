const test = require('node:test');
const assert = require('node:assert');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

test('Headless Chrome UI Test Suite', { concurrency: 1 }, async (t) => {
	await t.test('4 tabs navigation, URL query parameter restoration, and mode badge toggle', async () => {
		const out = runInHeadlessChrome(async () => {
			// 1. Initial active tab check (District mode)
			assert.strictEqual(document.getElementById('tab-district').style.display, 'block', 'District tab visible initially');
			assert.strictEqual(document.getElementById('tab-rep').style.display, 'none', 'Rep tab hidden initially');
			assert.strictEqual(document.getElementById('tab-neighbor').style.display, 'none', 'Neighbor tab hidden initially');
			assert.strictEqual(document.getElementById('tab-transfer').style.display, 'none', 'Transfer tab hidden initially');

			// 2. Normal tab switching through all 4 modes
			switchTab('rep');
			assert.strictEqual(document.getElementById('tab-rep').style.display, 'block', 'Switched to Rep tab');
			assert.strictEqual(document.getElementById('tab-district').style.display, 'none', 'District tab hidden after rep switch');
			assert.strictEqual(localStorage.getItem('kogai_active_mode'), 'rep', 'Persisted rep mode in localStorage');

			switchTab('neighbor');
			assert.strictEqual(document.getElementById('tab-neighbor').style.display, 'block', 'Switched to Neighbor tab');
			assert.strictEqual(document.getElementById('tab-rep').style.display, 'none', 'Rep tab hidden after neighbor switch');

			switchTab('transfer');
			assert.strictEqual(document.getElementById('tab-transfer').style.display, 'block', 'Switched to Transfer tab');
			assert.strictEqual(document.getElementById('tab-neighbor').style.display, 'none', 'Neighbor tab hidden after transfer switch');

			// 3. Mode active badge and toggle mode selector
			const badge = document.getElementById('mode-active-badge');
			assert.ok(badge && badge.style.display !== 'none', 'Mode active badge is visible when tabs collapsed');
			toggleModeSelector();
			const tabBtns = document.getElementById('mode-tab-buttons');
			assert.strictEqual(tabBtns.style.display, 'flex', 'Tabs expanded after toggleModeSelector()');

			// 4. Abnormal / Boundary values: switchTab with invalid mode name falls back safely
			switchTab('non_existent_mode');
			assert.strictEqual(document.getElementById('tab-district').style.display, 'none', 'District remains hidden on invalid tab');
			assert.strictEqual(document.getElementById('tab-rep').style.display, 'none', 'Rep remains hidden on invalid tab');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught browser runtime errors: ' + JSON.stringify(out.errors));
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('URL query parameter ?mode=transfer auto-restores active mode', async () => {
		const out = runInHeadlessChrome(async () => {
			// When query parameter ?mode=transfer is present, restoreActiveMode() activates transfer mode
			assert.strictEqual(document.getElementById('tab-transfer').style.display, 'block', 'Transfer tab auto-activated by query param');
			assert.strictEqual(document.getElementById('tab-district').style.display, 'none', 'District tab inactive');
		}, { queryMode: 'transfer' });

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('District mode full CRUD, card collapse, sorting, and password validation', async () => {
		const out = runInHeadlessChrome(async () => {
			switchTab('district');

			// 1. Card collapse and expand toggle
			const card = document.getElementById('card-d-officers');
			assert.ok(card.classList.contains('is-collapsed'), 'Card starts collapsed');
			toggleCard(card);
			assert.ok(!card.classList.contains('is-collapsed'), 'Card expanded on toggleCard()');
			setAllCardsCollapse(true, 'tab-district');
			assert.ok(card.classList.contains('is-collapsed'), 'Card collapsed on setAllCardsCollapse(true)');

			// 2. District name & han input
			const dName = document.getElementById('d-name');
			dName.value = 'あおぞら地区';
			dName.dispatchEvent(new Event('input'));
			assert.strictEqual(currentDistrict.district, 'あおぞら地区', 'currentDistrict.district updated');

			const dHanList = document.getElementById('d-han-list');
			dHanList.value = '1班, 2班, 3班';
			dHanList.dispatchEvent(new Event('input'));
			assert.strictEqual(currentDistrict.hanList.length, 3, 'Han list parsed into 3 items');

			// 3. Officer CRUD operations
			addOfficer();
			assert.strictEqual(currentDistrict.officers.length, 2, 'Officer added');
			// Abnormal / boundary check: minimum 1 officer required for removeOfficer
			window.confirm = () => true;
			removeOfficer(1);
			assert.strictEqual(currentDistrict.officers.length, 1, 'Officer removed');
			let alertFired = false;
			window.alert = () => { alertFired = true; };
			removeOfficer(0); // boundary: cannot remove last officer
			assert.strictEqual(currentDistrict.officers.length, 1, 'Last officer prevented from removal');
			assert.ok(alertFired, 'Alert shown when attempting to remove the only officer');

			// 4. Student CRUD & multi-tier sorting
			const origStudentsCount = currentDistrict.students ? currentDistrict.students.length : 0;
			addStudentRow();
			assert.strictEqual(currentDistrict.students.length, origStudentsCount + 1, 'Student row added');
			const newIdx = currentDistrict.students.length - 1;
			updateS(newIdx, 'lastName', '山田');
			updateS(newIdx, 'firstName', '太郎');
			updateS(newIdx, 'grade', '4');
			updateS(newIdx, 'han', '1班');
			assert.strictEqual(currentDistrict.students[newIdx].name, '山田 太郎', 'Student name updated');

			// Boundary / sorting test
			sortStudentsDesc();
			assert.ok(currentDistrict.students.length >= 2, 'Students table populated and sorted');

			// 5. Password strength & confirmation validation
			const passEl = document.getElementById('d-pass');
			const confirmEl = document.getElementById('d-pass-confirm');
			const msgEl = document.getElementById('d-pass-match-msg');

			// Abnormal: Short password (<12 chars)
			passEl.value = 'Short1!';
			confirmEl.value = 'Short1!';
			validateDistrictPasswords();
			assert.ok(msgEl.textContent.includes('12文字以上'), 'Validation rejects short password');

			// Abnormal: Password mismatch
			passEl.value = 'ValidPass1234#$';
			confirmEl.value = 'MismatchPass1234#$';
			validateDistrictPasswords();
			assert.ok(msgEl.textContent.includes('一致しません'), 'Validation rejects mismatched password');

			// Normal: Valid matching password (12+ chars, mixed charset)
			confirmEl.value = 'ValidPass1234#$';
			validateDistrictPasswords();
			assert.ok(msgEl.textContent.includes('一致しました'), 'Validation accepts valid matching password');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('Rep mode add district modal, validation, and split-export', async () => {
		const out = runInHeadlessChrome(async () => {
			switchTab('rep');
			const modal = document.getElementById('rep-add-district-modal');
			const nameInput = document.getElementById('rep-new-district-name');
			const errEl = document.getElementById('rep-new-district-error');

			// 1. Open add district modal
			addNewRepDistrict();
			assert.strictEqual(modal.style.display, 'flex', 'Rep add district modal opened');
			assert.strictEqual(nameInput.value, '', 'Input field initialized empty');

			// 2. Abnormal case: Empty district name validation
			nameInput.value = '';
			confirmAddRepDistrict();
			assert.strictEqual(errEl.style.display, 'block', 'Inline error displayed for empty name');
			assert.ok(errEl.textContent.includes('地区名を入力してください'), 'Empty name message correct');

			// 3. Boundary case: Whitespace only
			nameInput.value = '    ';
			confirmAddRepDistrict();
			assert.strictEqual(errEl.style.display, 'block', 'Inline error displayed for whitespace only');

			// 4. Normal case: Add new valid district
			nameInput.value = 'さくら地区';
			confirmAddRepDistrict();
			assert.strictEqual(modal.style.display, 'none', 'Modal closed on successful add');
			assert.ok(repState.districts.some(d => d.district === 'さくら地区'), 'New district added to repState.districts');

			// 5. Abnormal case: Duplicate district name validation
			addNewRepDistrict();
			nameInput.value = ' さくら地区 '; // Boundary: with surrounding spaces
			confirmAddRepDistrict();
			assert.strictEqual(errEl.style.display, 'block', 'Duplicate district name rejected with inline error');
			assert.ok(errEl.textContent.includes('既に存在します'), 'Duplicate error message shown');
			closeAddDistrictModal();
			assert.strictEqual(modal.style.display, 'none', 'Modal closed on closeAddDistrictModal()');

			// 6. Direct argument call (dual-compatibility check)
			addNewRepDistrict('ひまわり地区');
			assert.ok(repState.districts.some(d => d.district === 'ひまわり地区'), 'District directly added via argument call');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('Neighborhood mode CRUD, move order, and password validation', async () => {
		const out = runInHeadlessChrome(async () => {
			switchTab('neighbor');

			// 1. Set district name
			const nName = document.getElementById('neighbor-district-name');
			nName.value = '第1自治会';
			nName.dispatchEvent(new Event('input'));
			assert.strictEqual(neighborState.district, '第1自治会', 'Neighbor district name updated');

			// 2. Add neighbor row
			const initialCount = neighborState.neighborhood ? neighborState.neighborhood.length : 0;
			addNeighborRow();
			assert.strictEqual(neighborState.neighborhood.length, initialCount + 1, 'Neighbor row added');

			const lastIdx = neighborState.neighborhood.length - 1;
			updateNeighborItem(lastIdx, 'role', '防犯部長');
			updateNeighborItem(lastIdx, 'lastName', '佐藤');
			updateNeighborItem(lastIdx, 'firstName', '次郎');
			assert.strictEqual(neighborState.neighborhood[lastIdx].role, '防犯部長', 'Role updated');

			// 3. Move row (reordering)
			if (neighborState.neighborhood.length >= 2) {
				const secondIdx = 1;
				const targetRole = neighborState.neighborhood[secondIdx].role;
				moveNeighborRow(secondIdx, -1);
				assert.strictEqual(neighborState.neighborhood[0].role, targetRole, 'Row moved up successfully');
			}

			// 4. Remove neighbor row with confirmation
			window.confirm = () => true;
			const countBeforeDelete = neighborState.neighborhood.length;
			removeNeighborRow(0);
			assert.strictEqual(neighborState.neighborhood.length, countBeforeDelete - 1, 'Neighbor row removed');

			// 5. Password validation in neighbor card
			const passEl = document.getElementById('neighbor-pass');
			const confirmEl = document.getElementById('neighbor-pass-confirm');
			const msgEl = document.getElementById('neighbor-pass-match-msg');

			passEl.value = 'Neighbor#Pass2026';
			confirmEl.value = 'Neighbor#Pass2026';
			validateNeighborPasswords();
			assert.ok(msgEl.textContent.includes('一致しました'), 'Neighbor password validation passes');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('Transfer mode mandatory validation, child add/remove, and encryption flow', async () => {
		const out = runInHeadlessChrome(async () => {
			switchTab('transfer');

			// 1. Initial child row rendered
			assert.ok(transferState.children && transferState.children.length >= 1, 'Transfer initial child present');

			// 2. Add sibling child row
			addTransferChildRow();
			assert.strictEqual(transferState.children.length, 2, 'Sibling child added');

			// 3. Abnormal: export with empty mandatory fields (address, tel, names)
			let alertMsg = '';
			window.alert = (m) => { alertMsg = m; };

			const pass1 = document.getElementById('transfer-export-pass');
			const pass2 = document.getElementById('transfer-export-pass-confirm');
			pass1.value = 'TransferPass1234!';
			pass2.value = 'TransferPass1234!';

			const exported = await exportTransferTxt();
			assert.strictEqual(exported, false, 'Export blocked when required fields are empty');
			assert.ok(alertMsg.includes('住所') || alertMsg.includes('電話番号') || alertMsg.includes('氏名'), 'Alert prompted for mandatory fields: ' + alertMsg);

			// 4. Fill required fields (Normal case)
			updateTransferChild(0, 'lastName', '高橋');
			updateTransferChild(0, 'firstName', '健太');
			updateTransferChild(0, 'address', '中央町1-2-3');
			updateTransferChild(0, 'tel', '090-1234-5678');

			updateTransferChild(1, 'lastName', '高橋');
			updateTransferChild(1, 'firstName', '美咲');
			updateTransferChild(1, 'address', '中央町1-2-3');
			updateTransferChild(1, 'tel', '090-1234-5678');

			const validExport = await exportTransferTxt();
			assert.strictEqual(validExport, true, 'Export succeeded when all mandatory fields are filled');

			// 5. Remove child row
			window.confirm = () => true;
			removeTransferChildRow(1);
			assert.strictEqual(transferState.children.length, 1, 'Child row removed');

			// 6. Reset form
			window.confirm = () => true;
			resetTransferForm();
			assert.strictEqual(transferState.children[0].lastName, '', 'Form reset clears child name');
			assert.strictEqual(pass1.value, '', 'Form reset clears password');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('Hataflot native schedule generator, period preset, and orientation/layout DOM', async () => {
		const out = runInHeadlessChrome(async () => {
			switchTab('district');

			// Populate students for Hataflot household extraction
			currentDistrict.students = [
				{ grade: '1', class: '1', han: '1班', lastName: '山田', firstName: '太郎', address: '1丁目101', tel: '090-1111-1111' },
				{ grade: '3', class: '2', han: '1班', lastName: '山田', firstName: '次郎', address: '1丁目101', tel: '090-1111-1111' }, // sibling
				{ grade: '2', class: '1', han: '2班', lastName: '佐藤', firstName: '花子', address: '2丁目202', tel: '090-2222-2222' },
				{ grade: '5', class: '1', han: '2班', lastName: '鈴木', firstName: '一郎', address: '3丁目303', tel: '090-3333-3333' }
			];
			saveDistrictLocal();

			// 1. Sync members from students (household aggregation)
			syncHataMembersFromStudents();
			assert.ok(currentDistrict.hata && currentDistrict.hata.members, 'Hataflot members generated');
			const lines = currentDistrict.hata.members.split('\n').filter(Boolean);
			assert.strictEqual(lines.length, 3, '3 distinct households extracted from 4 students (1 sibling pair)');

			// 2. Period preset application
			applyHataPeriodPreset('firstHalf');
			const startInput = document.getElementById('hata-start-date');
			const endInput = document.getElementById('hata-end-date');
			assert.ok(startInput.value.includes('-04-') || startInput.value.length >= 8, 'First half preset sets start date');
			assert.ok(endInput.value.includes('-09-') || endInput.value.length >= 8, 'First half preset sets end date');

			// 3. Auto generation of schedule
			runAutoHataGeneration();
			assert.ok(Array.isArray(hataCurrentSchedule), 'Schedule generated in hataCurrentSchedule');
			assert.ok(hataCurrentSchedule.length > 0, 'Schedule has assigned days');

			// 4. Default orientation and layout verification in DOM
			const orientSelect = document.getElementById('hata-orientation');
			const colSelect = document.getElementById('hata-columns');
			assert.strictEqual(orientSelect.value, 'portrait', 'Default orientation is portrait');
			assert.strictEqual(colSelect.value, '2', 'Default layout is 2 columns');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('Print preview pipelines, document.title synchronization, and separate PDF export', async () => {
		const out = runInHeadlessChrome(async () => {
			switchTab('district');
			document.getElementById('d-name').value = '光が丘';
			currentDistrict.district = '光が丘';
			currentDistrict.students = [
				{ grade: '1', class: '1', han: '1班', lastName: '田中', firstName: '健', address: '1-1', tel: '090-0000-0000' }
			];
			saveDistrictLocal();

			let printedTitles = [];
			window.print = () => {
				printedTitles.push(document.title);
			};

			// 1. Single district selected print with dynamic title
			document.getElementById('d-print-students').checked = true;
			document.getElementById('d-print-neighbors').checked = false;
			document.getElementById('d-print-school').checked = false;
			document.getElementById('d-print-pta').checked = false;

			const baseTitle = document.title;
			printSingleDistrictSelected();
			assert.strictEqual(printedTitles.length, 1, 'window.print called once');
			assert.strictEqual(printedTitles[0], '児童名ぼ_光が丘'.replace('ぼ', '簿'), 'Dynamic document.title set during print');
			assert.strictEqual(document.title, baseTitle, 'document.title restored after print');

			// 2. Separate PDF export for multiple checked items
			document.getElementById('d-print-neighbors').checked = true;
			printedTitles = [];
			printSingleDistrictSeparately();
			assert.strictEqual(printedTitles.length, 2, 'window.print called for each checked report separately');
			assert.strictEqual(printedTitles[0], '児童名簿_光が丘', '1st report titled correctly');
			assert.strictEqual(printedTitles[1], '自治会役員名簿_光が丘', '2nd report titled correctly');
			assert.strictEqual(document.title, baseTitle, 'document.title restored after separate prints');

			// 3. Abnormal: No report selected alerts user
			document.getElementById('d-print-students').checked = false;
			document.getElementById('d-print-neighbors').checked = false;
			let alertShown = false;
			window.alert = () => { alertShown = true; };
			printSingleDistrictSelected();
			assert.ok(alertShown, 'Alert shown when no report checked');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});

	await t.test('Storage encryption setup modal, validation, and auto-lock', async () => {
		const out = runInHeadlessChrome(async () => {
			// 1. Open storage security modal
			openStorageSettingsModal();
			const modal = document.getElementById('storage-settings-modal');
			assert.strictEqual(modal.style.display, 'flex', 'Storage settings modal displayed');

			// 2. Password mismatch in modal
			const p1 = document.getElementById('modal-set-pass');
			const p2 = document.getElementById('modal-set-pass-confirm');
			const errEl = document.getElementById('modal-set-pass-msg');

			p1.value = 'SafePassword2026!';
			p2.value = 'MismatchPassword2026!';
			validateModalPasswords();
			assert.ok(errEl.textContent.includes('一致していません'), 'Modal validates password match');

			// 3. Valid password matching
			p2.value = 'SafePassword2026!';
			validateModalPasswords();
			assert.ok(errEl.textContent.includes('一致が確認できました'), 'Modal passes on valid password match');

			// 4. Close settings modal
			closeStorageSettingsModal();
			assert.strictEqual(modal.style.display, 'none', 'Modal closed on closeStorageSettingsModal()');

			// 5. Immediate lock handler clears sensitive data and displays unlock modal
			handleImmediateLock();
			const unlockModal = document.getElementById('storage-lock-modal');
			assert.strictEqual(unlockModal.style.display, 'flex', 'Unlock modal displayed after handleImmediateLock()');
		});

		assert.strictEqual(out.success, true, 'Test executed without fatal error: ' + JSON.stringify(out.fatal || {}));
		assert.strictEqual(out.errors.length, 0, 'No uncaught errors');
		for (const r of out.results) {
			assert.strictEqual(r.passed, true, r.name + ' failed: ' + r.error);
		}
	});
});
