/* =========================================================================
	宣言的なUIイベント。属性は固定アクション名とデータであり、コードではない。
========================================================================= */

const UI_EVENT_TYPES = ['click', 'input', 'change', 'submit', 'keydown'];
const UI_MODES = ['district', 'rep', 'neighbor', 'transfer'];
const UI_PASSWORD_TARGETS = ['d-pass', 'd-pass-confirm', 'rep-pass', 'rep-pass-confirm',
	'neighbor-pass', 'neighbor-pass-confirm', 'neighbor-import-pass', 'transfer-export-pass',
	'transfer-export-pass-confirm', 'modal-unlock-pass', 'modal-set-pass', 'modal-set-pass-confirm'];
const UI_HATA_FIELDS = ['title', 'location', 'time', 'startDate', 'endDate', 'orientation',
	'holidays', 'specials', 'headerMsg', 'footerMsg', 'contactMsg'];
const UI_PASTE_TARGETS = ['d-paste-panel', 'd-transfer-paste-panel', 'rep-transfer-paste-panel'];
const uiBoundRoots = new WeakSet();

function uiRowIndex(element, key = 'index') {
	const value = element.dataset[key];
	if (!/^(0|[1-9]\d*)$/.test(value)) return null;
	const index = Number(value);
	return Number.isSafeInteger(index) && index < 10000 ? index : null;
}

function uiBooleanFlag(element) {
	return element.dataset.flag === 'true' ? true : element.dataset.flag === 'false' ? false : null;
}

const uiEventHandlers = new Map([
	['triggerPwaInstall', () => triggerPwaInstall()],
	['openStorageSettingsModal', () => openStorageSettingsModal()],
	['toggleModeSelector', () => toggleModeSelector()],
	['addOfficer', () => addOfficer()],
	['openNeighborImportPanel', () => openNeighborImportPanel()],
	['loadPastedNeighborTextIntoDistrict', () => loadPastedNeighborTextIntoDistrict()],
	['addNeighborhoodRow', () => addNeighborhoodRow()],
	['toggleTransferImportPanel', () => toggleTransferImportPanel()],
	['loadPastedTransferTextIntoDistrict', () => loadPastedTransferTextIntoDistrict()],
	['sortStudentsDesc', () => sortStudentsDesc()],
	['addStudentRow', () => addStudentRow()],
	['printSingleDistrictSelected', () => printSingleDistrictSelected()],
	['printSingleDistrictSeparately', () => printSingleDistrictSeparately()],
	['copyHataList', () => copyHataList()],
	['runAutoHataGeneration', () => runAutoHataGeneration()],
	['printHataSchedule', () => printHataSchedule()],
	['toggleHataSummary', () => toggleHataSummary()],
	['exportDistrictTxt', () => exportDistrictTxt()],
	['loadPastedTextToDistrict', () => loadPastedTextToDistrict()],
	['runDistrictYearUpdate', () => runDistrictYearUpdate()],
	['addNewRepDistrict', () => addNewRepDistrict()],
	['clearAllRepDistricts', () => clearAllRepDistricts()],
	['addSzExternalRow', () => addSzExternalRow()],
	['swapSeatWindowCorridor', () => swapSeatWindowCorridor()],
	['executeRepSelectedPrint', () => executeRepSelectedPrint()],
	['loadPastedTextToRep', () => loadPastedTextToRep()],
	['addCurrentDistrictToRep', () => addCurrentDistrictToRep()],
	['loadPastedTransferTextIntoRep', () => loadPastedTransferTextIntoRep()],
	['exportRepMasterTxt', () => exportRepMasterTxt()],
	['runRepYearUpdate', () => runRepYearUpdate()],
	['addNeighborRow', () => addNeighborRow()],
	['printNeighborRoster', () => printNeighborRoster()],
	['printNeighborTentCards', () => printNeighborTentCards()],
	['exportNeighborTxt', () => exportNeighborTxt()],
	['copyNeighborEncryptedText', () => copyNeighborEncryptedText()],
	['loadPastedTextToNeighbor', () => loadPastedTextToNeighbor()],
	['runNeighborYearUpdate', () => runNeighborYearUpdate()],
	['addTransferChildRow', () => addTransferChildRow()],
	['exportTransferTxt', () => exportTransferTxt()],
	['copyTransferEncryptedText', () => copyTransferEncryptedText()],
	['resetTransferForm', () => resetTransferForm()],
	['handlePasswordUnlock', () => handlePasswordUnlock()],
	['handleResetStorageConfirm', () => handleResetStorageConfirm()],
	['closeStorageSettingsModal', () => closeStorageSettingsModal()],
	['closeAddDistrictModal', () => closeAddDistrictModal()],
	['closeRepDistrictDetailModalWithoutSaving', () => closeRepDistrictDetailModalWithoutSaving()],
	['addModalOfficerRow', () => addModalOfficerRow()],
	['addModalStudentRow', () => addModalStudentRow()],
	['addModalNeighborRow', () => addModalNeighborRow()],
	['saveAndCloseRepDistrictDetailModal', () => saveAndCloseRepDistrictDetailModal()],
	['handleEnableEncryptionSubmit', () => handleEnableEncryptionSubmit()],
	['handleAddOrUpdateBiometric', () => handleAddOrUpdateBiometric()],
	['handleImmediateLock', () => handleImmediateLock()],
	['saveDistrictLocal', () => saveDistrictLocal()],
	['saveRepLocal', () => saveRepLocal()],
	['saveNeighborLocal', () => saveNeighborLocal()],
	['resizeSeatGrid', () => resizeSeatGrid()],
	['updateHataPreview', () => updateHataPreview()],
	['sanitizePasswordInput', element => sanitizePasswordInput(element)],
	['onHanListInput', element => onHanListInput(element.value)],
	['checkAppVersion', () => checkAppVersion(true)],
	['handleWebAuthnUnlock', () => handleWebAuthnUnlock(false)],
	['stopPropagation', (_element, event) => event.stopPropagation()],
	['toggleCard', element => toggleCard(element.closest('.card'))],
	['preventSubmit', (_element, event) => event.preventDefault()],
	['confirmAddRepDistrict', (_element, event) => { event.preventDefault(); confirmAddRepDistrict(); }],
	['unlockOnEnter', (_element, event) => { if (event.key === 'Enter') handlePasswordUnlock(); }],
	['closeAddDistrictBackdrop', (element, event) => { if (event.target === element) closeAddDistrictModal(); }],
	['switchTab', element => { if (UI_MODES.includes(element.dataset.mode)) switchTab(element.dataset.mode); }],
	['shareAppUrl', element => {
		if (element.dataset.mode === undefined) shareAppUrl();
		else if (UI_MODES.includes(element.dataset.mode)) shareAppUrl(element.dataset.mode);
	}],
	['shareDistrictData', element => {
		if (['line', 'email', 'share', 'copy'].includes(element.dataset.mode)) shareDistrictData(element.dataset.mode);
	}],
	['applyHataPeriodPreset', element => {
		if (['zenki', 'kouki', 'full'].includes(element.dataset.mode)) applyHataPeriodPreset(element.dataset.mode);
	}],
	['setAllCardsCollapse', element => {
		const flag = uiBooleanFlag(element);
		if (flag !== null && UI_MODES.some(mode => element.dataset.target === `tab-${mode}`)) setAllCardsCollapse(flag, element.dataset.target);
	}],
	['togglePasswordVisibility', element => {
		if (UI_PASSWORD_TARGETS.includes(element.dataset.passwordTarget)) togglePasswordVisibility(element.dataset.passwordTarget, element);
	}],
	['quickSetupEncryptionFromCard', element => {
		if (['d-pass', 'rep-pass', 'neighbor-pass'].includes(element.dataset.passwordTarget)) quickSetupEncryptionFromCard(element.dataset.passwordTarget);
	}],
	['togglePastePanel', element => {
		if (!UI_PASTE_TARGETS.includes(element.dataset.target)) return;
		const panel = document.getElementById(element.dataset.target);
		if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
	}],
	['clearAddDistrictError', () => {
		const error = document.getElementById('rep-new-district-error');
		if (error) { error.textContent = ''; error.style.display = 'none'; }
	}],
	['updateHataConfig', element => {
		if (!UI_HATA_FIELDS.includes(element.dataset.field)) return;
		if (currentDistrict.hata) currentDistrict.hata[element.dataset.field] = element.value;
		saveDistrictLocal();
	}],
	['updateHataColumns', element => {
		if (currentDistrict.hata && /^[1-6]$/.test(element.value)) {
			currentDistrict.hata.layoutColumns = element.value;
			saveDistrictLocal();
			renderHataSchedulePreview();
		}
	}],
	['exportHataSettings', () => {
		const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
		downloadTextFile(exportHataOfficialJson(currentDistrict.hata), `HataFuRotto設定_${currentDistrict.district || 'PTA'}_${date}.json`);
	}],
	['setDistrictPrintSelection', element => {
		const index = uiRowIndex(element);
		if (index !== null) setDistrictPrintSelection(index, element.checked);
	}],
	['toggleSzNeighbor', element => {
		const index = uiRowIndex(element), neighbor = uiRowIndex(element, 'index2');
		if (index !== null && neighbor !== null) toggleSzNeighbor(index, neighbor, element.checked);
	}],
	['moveNeighborRow', element => {
		const index = uiRowIndex(element);
		if (index !== null && ['-1', '1'].includes(element.dataset.direction)) moveNeighborRow(index, Number(element.dataset.direction));
	}],
	['updateSeatCell', element => {
		if (/^(?:[0-9]|1[0-3])_[0-9]$/.test(element.dataset.target) && ['refKey', 'customText'].includes(element.dataset.field)) updateSeatCell(element.dataset.target, element.dataset.field, element.value);
	}],
	['toggleHataExempt', element => toggleHataExempt(element.dataset.householdKey, element.checked)]
]);

// この表だけが編集先フィールドと呼出先を決める。data属性から関数名を解決しない。
for (const [action, fields, update] of [
	['updateN', ['role', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'address', 'tel'], (index, field, value) => updateN(index, field, value)],
	['updateS', ['grade', 'class', 'han', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'address', 'tel', 'leader', 'isOutOfDistrict'], (index, field, value) => updateS(index, field, value)],
	['updateNeighborItem', ['role', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'address', 'tel', 'email', 'note'], (index, field, value) => updateNeighborItem(index, field, value)],
	['updateTransferChild', ['grade', 'className', 'lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'address', 'tel'], (index, field, value) => updateTransferChild(index, field, value)],
	['updateModalOfficer', ['role', 'lastName', 'firstName', 'han', 'tel', 'email', 'childGrade', 'childClass', 'childLastName', 'childFirstName'], (index, field, value) => updateModalOfficer(index, field, value)],
	['updateModalStudent', ['grade', 'class', 'han', 'lastName', 'firstName', 'address', 'tel'], (index, field, value) => updateModalStudent(index, field, value)],
	['updateModalNeighbor', ['role', 'lastName', 'firstName', 'tel'], (index, field, value) => updateModalNeighbor(index, field, value)],
	['updateSzEx', ['attend', 'category', 'org', 'role', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'contact'], (index, field, value) => updateSzEx(index, field, value)]
]) {
	uiEventHandlers.set(action, element => {
		const index = uiRowIndex(element), field = element.dataset.field;
		if (index === null || !fields.includes(field)) return;
		update(index, field, field === 'isOutOfDistrict' || field === 'attend' ? element.checked : element.value);
		if (action === 'updateSzEx' && field !== 'contact') renderSeatEditor();
	});
}

for (const [action, remove] of [
	['removeN', index => removeN(index)], ['removeS', index => removeS(index)],
	['removeOfficer', index => removeOfficer(index)], ['removeNeighborRow', index => removeNeighborRow(index)],
	['removeTransferChildRow', index => removeTransferChildRow(index)],
	['removeModalOfficerRow', index => removeModalOfficerRow(index)], ['removeModalStudentRow', index => removeModalStudentRow(index)],
	['removeModalNeighborRow', index => removeModalNeighborRow(index)],
	['openRepDistrictDetailModal', index => openRepDistrictDetailModal(index)],
	['exportSingleDistrictFromRep', index => exportSingleDistrictFromRep(index)],
	['deleteRepDistrict', index => deleteRepDistrict(index)], ['deleteSzExternalRow', index => deleteSzExternalRow(index)]
]) {
	uiEventHandlers.set(action, element => { const index = uiRowIndex(element); if (index !== null) remove(index); });
}

for (const [action, select] of [
	['toggleAllDistrictChecks', flag => toggleAllDistrictChecks(flag)],
	['setRepPrintChecks', flag => setRepPrintChecks(flag)]
]) {
	uiEventHandlers.set(action, element => { const flag = uiBooleanFlag(element); if (flag !== null) select(flag); });
}

for (const [action, validate] of [
	['districtPasswordInput', () => validateDistrictPasswords()], ['repPasswordInput', () => validateRepPasswords()],
	['neighborPasswordInput', () => validateNeighborPasswords()], ['modalPasswordInput', () => validateModalPasswords()]
]) {
	uiEventHandlers.set(action, element => { sanitizePasswordInput(element); validate(); });
}

for (const [action, load] of [
	['loadNeighborFileIntoDistrict', event => loadNeighborFileIntoDistrict(event)],
	['loadTransferFileIntoDistrict', event => loadTransferFileIntoDistrict(event)],
	['loadHataOfficialFile', event => loadHataOfficialFile(event)], ['loadDistrictTxt', event => loadDistrictTxt(event)],
	['loadMultipleDistrictFiles', event => loadMultipleDistrictFiles(event)],
	['loadTransferFileIntoRep', event => loadTransferFileIntoRep(event)],
	['loadRepMasterTxt', event => loadRepMasterTxt(event)], ['loadNeighborTxt', event => loadNeighborTxt(event)]
]) {
	uiEventHandlers.set(action, (_element, event) => load(event));
}

function dispatchUiEvent(event) {
	if (!UI_EVENT_TYPES.includes(event.type)) return;
	let element = event.target;
	while (element) {
		if (typeof element.getAttribute === 'function') {
			const handler = uiEventHandlers.get(element.getAttribute(`data-${event.type}`));
			if (handler) handler(element, event);
			if (event.cancelBubble) break;
		}
		element = element.parentElement;
	}
}

function bindUiEvents(root = document) {
	if (uiBoundRoots.has(root)) return;
	uiBoundRoots.add(root);
	for (const type of UI_EVENT_TYPES) root.addEventListener(type, dispatchUiEvent);
}

if (typeof document !== 'undefined') bindUiEvents(document);
if (typeof module !== 'undefined' && module.exports) module.exports = { dispatchUiEvent, bindUiEvents };
