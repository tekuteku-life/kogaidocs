const test = require('node:test');
const assert = require('node:assert/strict');
const { MockElement, setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
const { dispatchUiEvent, bindUiEvents } = require('../../js/events');

// HTMLの属性文字列をコードとして解釈せず、実UIの操作契約だけを検証する。
const simpleButtons = [
	'triggerPwaInstall', 'openStorageSettingsModal', 'toggleModeSelector', 'addOfficer',
	'openNeighborImportPanel', 'loadPastedNeighborTextIntoDistrict', 'addNeighborhoodRow',
	'toggleTransferImportPanel', 'loadPastedTransferTextIntoDistrict', 'sortStudentsDesc',
	'addStudentRow', 'printSingleDistrictSelected', 'printSingleDistrictSeparately',
	'copyHataList', 'runAutoHataGeneration', 'printHataSchedule', 'toggleHataSummary',
	'exportDistrictTxt', 'loadPastedTextToDistrict', 'runDistrictYearUpdate', 'addNewRepDistrict',
	'clearAllRepDistricts', 'addSzExternalRow', 'swapSeatWindowCorridor', 'executeRepSelectedPrint',
	'loadPastedTextToRep', 'addCurrentDistrictToRep', 'loadPastedTransferTextIntoRep',
	'exportRepMasterTxt', 'runRepYearUpdate', 'addNeighborRow', 'printNeighborRoster',
	'printNeighborTentCards', 'exportNeighborTxt', 'copyNeighborEncryptedText',
	'loadPastedTextToNeighbor', 'runNeighborYearUpdate', 'addTransferChildRow',
	'exportTransferTxt', 'copyTransferEncryptedText', 'resetTransferForm', 'handlePasswordUnlock',
	'handleResetStorageConfirm', 'closeStorageSettingsModal', 'closeAddDistrictModal',
	'closeRepDistrictDetailModalWithoutSaving', 'addModalOfficerRow', 'addModalStudentRow',
	'addModalNeighborRow', 'saveAndCloseRepDistrictDetailModal', 'handleEnableEncryptionSubmit',
	'handleAddOrUpdateBiometric', 'handleImmediateLock'
];
let calls;
function spy(name) {
	global[name] = (...args) => { calls.push({ name, args }); };
}
function fresh() {
	setupDomEnvironment();
	calls = [];
	global.currentDistrict = { hata: {} };
	for (const name of simpleButtons) spy(name);
	for (const name of ['saveDistrictLocal', 'saveRepLocal', 'saveNeighborLocal', 'resizeSeatGrid',
		'switchTab', 'setAllCardsCollapse', 'toggleCard', 'shareAppUrl', 'shareDistrictData',
		'quickSetupEncryptionFromCard', 'togglePasswordVisibility', 'sanitizePasswordInput',
		'validateDistrictPasswords', 'validateRepPasswords', 'validateNeighborPasswords',
		'validateModalPasswords', 'updateHataPreview', 'renderHataSchedulePreview', 'applyHataPeriodPreset',
		'handleWebAuthnUnlock', 'checkAppVersion', 'onHanListInput', 'confirmAddRepDistrict',
		'updateN', 'updateS', 'updateNeighborItem', 'updateTransferChild', 'updateModalOfficer',
		'updateModalStudent', 'updateModalNeighbor', 'updateSzEx', 'renderSeatEditor', 'updateSeatCell',
		'toggleHataExempt', 'setDistrictPrintSelection', 'toggleSzNeighbor', 'moveNeighborRow',
		'toggleAllDistrictChecks', 'setRepPrintChecks', 'removeN', 'removeS', 'removeOfficer',
		'removeNeighborRow', 'removeTransferChildRow', 'removeModalOfficerRow', 'removeModalStudentRow',
		'removeModalNeighborRow', 'openRepDistrictDetailModal', 'exportSingleDistrictFromRep',
		'deleteRepDistrict', 'deleteSzExternalRow', 'loadNeighborFileIntoDistrict',
		'loadTransferFileIntoDistrict', 'loadHataOfficialFile', 'loadDistrictTxt', 'loadMultipleDistrictFiles',
		'loadTransferFileIntoRep', 'loadRepMasterTxt', 'loadNeighborTxt', 'downloadTextFile']) spy(name);
}
function element(type, action, params = {}, parent = null) {
	const el = new MockElement(type === 'submit' ? 'form' : type === 'click' ? 'button' : 'input');
	el.setAttribute(`data-${type}`, action);
	for (const [key, value] of Object.entries(params)) el.setAttribute(`data-${key}`, value);
	if (parent) parent.appendChild(el);
	return el;
}
function eventFor(type, target, extras = {}) {
	return {
		type, target, defaultPrevented: false, cancelBubble: false,
		preventDefault() { this.defaultPrevented = true; },
		stopPropagation() { this.cancelBubble = true; }, ...extras
	};
}
function fire(type, action, params = {}, value = '入力値', checked = false) {
	const el = element(type, action, params);
	el.value = value;
	el.checked = checked;
	const event = eventFor(type, el);
	dispatchUiEvent(event);
	return { el, event };
}

test('events: all plain UI buttons call only their explicitly assigned operation', () => {
	fresh();
	for (const action of simpleButtons) {
		calls.length = 0;
		fire('click', action);
		assert.deepEqual(calls, [{ name: action, args: [] }], action);
	}
	for (const action of ['saveDistrictLocal', 'saveRepLocal', 'saveNeighborLocal']) {
		calls.length = 0;
		fire('input', action);
		assert.deepEqual(calls, [{ name: action, args: [] }], action);
	}
	fire('change', 'resizeSeatGrid');
	fire('change', 'updateHataPreview');
	assert.deepEqual(calls.slice(-2), [{ name: 'resizeSeatGrid', args: [] }, { name: 'updateHataPreview', args: [] }]);
});

test('events: tab, card, print, sharing and password actions preserve typed arguments', () => {
	fresh();
	for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
		fire('click', 'switchTab', { mode });
		assert.deepEqual(calls.at(-1), { name: 'switchTab', args: [mode] });
		for (const flag of ['true', 'false']) fire('click', 'setAllCardsCollapse', { target: `tab-${mode}`, flag });
	}
	assert.deepEqual(calls.slice(0, 3), [
		{ name: 'switchTab', args: ['district'] },
		{ name: 'setAllCardsCollapse', args: [true, 'tab-district'] },
		{ name: 'setAllCardsCollapse', args: [false, 'tab-district'] }
	]);
	for (const mode of ['line', 'email', 'share', 'copy']) {
		fire('click', 'shareDistrictData', { mode });
		assert.deepEqual(calls.at(-1), { name: 'shareDistrictData', args: [mode] });
	}
	for (const action of ['toggleAllDistrictChecks', 'setRepPrintChecks']) {
		for (const flag of ['true', 'false']) fire('click', action, { flag });
		assert.deepEqual(calls.slice(-2), [{ name: action, args: [true] }, { name: action, args: [false] }]);
	}
	fire('click', 'shareAppUrl');
	assert.deepEqual(calls.at(-1), { name: 'shareAppUrl', args: [] });
	fire('click', 'shareAppUrl', { mode: 'transfer' });
	assert.deepEqual(calls.at(-1), { name: 'shareAppUrl', args: ['transfer'] });
	for (const mode of ['zenki', 'kouki', 'full']) {
		fire('click', 'applyHataPeriodPreset', { mode });
		assert.deepEqual(calls.at(-1), { name: 'applyHataPeriodPreset', args: [mode] });
	}
	fire('click', 'checkAppVersion');
	fire('click', 'handleWebAuthnUnlock');
	assert.deepEqual(calls.slice(-2), [{ name: 'checkAppVersion', args: [true] }, { name: 'handleWebAuthnUnlock', args: [false] }]);
	for (const target of ['d-pass', 'd-pass-confirm', 'rep-pass', 'rep-pass-confirm', 'neighbor-pass',
		'neighbor-pass-confirm', 'neighbor-import-pass', 'transfer-export-pass', 'transfer-export-pass-confirm',
		'modal-unlock-pass', 'modal-set-pass', 'modal-set-pass-confirm']) {
		const { el } = fire('click', 'togglePasswordVisibility', { 'password-target': target });
		assert.deepEqual(calls.at(-1), { name: 'togglePasswordVisibility', args: [target, el] });
	}
	for (const target of ['d-pass', 'rep-pass', 'neighbor-pass']) {
		fire('click', 'quickSetupEncryptionFromCard', { 'password-target': target });
		assert.deepEqual(calls.at(-1), { name: 'quickSetupEncryptionFromCard', args: [target] });
	}
	const card = new MockElement('div'); card.className = 'card';
	const title = element('click', 'toggleCard', {}, card);
	dispatchUiEvent(eventFor('click', title));
	assert.deepEqual(calls.at(-1), { name: 'toggleCard', args: [card] });
});

test('events: password sanitation precedes validation, and file inputs forward their actual event', () => {
	fresh();
	for (const prefix of ['district', 'rep', 'neighbor', 'modal']) {
		calls.length = 0;
		const { el } = fire('input', `${prefix}PasswordInput`);
		const validator = `validate${prefix[0].toUpperCase()}${prefix.slice(1)}Passwords`;
		assert.deepEqual(calls, [{ name: 'sanitizePasswordInput', args: [el] }, { name: validator, args: [] }]);
	}
	const sanitized = fire('input', 'sanitizePasswordInput');
	assert.deepEqual(calls.at(-1), { name: 'sanitizePasswordInput', args: [sanitized.el] });
	for (const action of ['loadNeighborFileIntoDistrict', 'loadTransferFileIntoDistrict', 'loadHataOfficialFile',
		'loadDistrictTxt', 'loadMultipleDistrictFiles', 'loadTransferFileIntoRep', 'loadRepMasterTxt', 'loadNeighborTxt']) {
		const { event } = fire('change', action);
		assert.deepEqual(calls.at(-1), { name: action, args: [event] }, action);
	}
	fire('input', 'onHanListInput', {}, 'A班, B班');
	assert.deepEqual(calls.at(-1), { name: 'onHanListInput', args: ['A班, B班'] });
});

test('events: editing actions target the intended row and allow only the fields used by that editor', () => {
	fresh();
	const fieldsByEditor = {
		updateN: ['role', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'address', 'tel'],
		updateS: ['grade', 'class', 'han', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'address', 'tel', 'leader'],
		updateNeighborItem: ['role', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'address', 'tel', 'email', 'note'],
		updateTransferChild: ['grade', 'className', 'lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'address', 'tel'],
		updateModalOfficer: ['role', 'lastName', 'firstName', 'han', 'tel', 'email', 'childGrade', 'childClass', 'childLastName', 'childFirstName'],
		updateModalStudent: ['grade', 'class', 'han', 'lastName', 'firstName', 'address', 'tel'],
		updateModalNeighbor: ['role', 'lastName', 'firstName', 'tel'],
		updateSzEx: ['category', 'org', 'role', 'lastNameKana', 'firstNameKana', 'lastName', 'firstName', 'contact']
	};
	for (const [action, fields] of Object.entries(fieldsByEditor)) {
		for (const field of fields) {
			calls.length = 0;
			fire(field === 'grade' || field === 'category' ? 'change' : 'input', action, { index: '2', field }, '編集した値');
			assert.deepEqual(calls[0], { name: action, args: [2, field, '編集した値'] }, `${action}.${field}`);
			assert.equal(calls.length, action === 'updateSzEx' && field !== 'contact' ? 2 : 1);
			if (calls.length === 2) assert.deepEqual(calls[1], { name: 'renderSeatEditor', args: [] });
		}
		for (const field of ['__proto__', 'constructor', 'prototype', 'savedFilePassword', 'hata', 'notAField']) {
			calls.length = 0;
			fire('input', action, { index: '0', field });
			assert.deepEqual(calls, [], `${action} rejects ${field}`);
		}
	}
	fire('change', 'updateS', { index: '0', field: 'isOutOfDistrict' }, 'not-a-boolean', true);
	assert.deepEqual(calls.at(-1), { name: 'updateS', args: [0, 'isOutOfDistrict', true] });
	fire('change', 'updateSzEx', { index: '1', field: 'attend' }, 'not-a-boolean', false);
	assert.deepEqual(calls.slice(-2), [{ name: 'updateSzEx', args: [1, 'attend', false] }, { name: 'renderSeatEditor', args: [] }]);
});

test('events: row removal, selection, reordering, exemptions and seats preserve identities', () => {
	fresh();
	for (const action of ['removeN', 'removeS', 'removeOfficer', 'removeNeighborRow', 'removeTransferChildRow',
		'removeModalOfficerRow', 'removeModalStudentRow', 'removeModalNeighborRow', 'openRepDistrictDetailModal',
		'exportSingleDistrictFromRep', 'deleteRepDistrict', 'deleteSzExternalRow']) {
		fire('click', action, { index: '3' });
		assert.deepEqual(calls.at(-1), { name: action, args: [3] }, action);
	}
	for (const direction of ['-1', '1']) {
		fire('click', 'moveNeighborRow', { index: '1', direction });
		assert.deepEqual(calls.at(-1), { name: 'moveNeighborRow', args: [1, Number(direction)] });
	}
	fire('change', 'setDistrictPrintSelection', { index: '2' }, '', true);
	assert.deepEqual(calls.at(-1), { name: 'setDistrictPrintSelection', args: [2, true] });
	fire('change', 'toggleSzNeighbor', { index: '2', index2: '4' }, '', false);
	assert.deepEqual(calls.at(-1), { name: 'toggleSzNeighbor', args: [2, 4, false] });
	for (const field of ['refKey', 'customText']) {
		fire(field === 'refKey' ? 'change' : 'input', 'updateSeatCell', { target: '1_2', field }, '席の値');
		assert.deepEqual(calls.at(-1), { name: 'updateSeatCell', args: ['1_2', field, '席の値'] });
	}
	fire('change', 'toggleHataExempt', { 'household-key': "1-2_氏名'\"<>&" }, '', true);
	assert.deepEqual(calls.at(-1), { name: 'toggleHataExempt', args: ["1-2_氏名'\"<>&", true] });
});

test('events: fixed settings operations preserve updates and do not interpret values as code', () => {
	fresh();
	const payload = '<img src=x onerror=alert(1)>';
	for (const field of ['title', 'location', 'time', 'startDate', 'endDate', 'orientation', 'holidays',
		'specials', 'headerMsg', 'footerMsg', 'contactMsg']) {
		const value = { startDate: '2026-04-01', endDate: '2026-09-30', orientation: 'portrait' }[field] || payload;
		fire('input', 'updateHataConfig', { field }, value);
		assert.equal(currentDistrict.hata[field], value, field);
		assert.equal(calls.at(-1).name, 'saveDistrictLocal');
	}
	fire('change', 'updateHataColumns', {}, '3');
	assert.equal(String(currentDistrict.hata.layoutColumns), '3');
	assert.deepEqual(calls.slice(-2), [{ name: 'saveDistrictLocal', args: [] }, { name: 'renderHataSchedulePreview', args: [] }]);
	delete currentDistrict.hata;
	fire('input', 'updateHataConfig', { field: 'title' });
	fire('change', 'updateHataColumns', {}, '2');
	assert.equal(currentDistrict.hata, undefined, 'Missing configuration is not fabricated');
	for (const target of ['d-paste-panel', 'd-transfer-paste-panel', 'rep-transfer-paste-panel']) {
		const panel = document.getElementById(target); panel.style.display = 'none';
		fire('click', 'togglePastePanel', { target }); assert.equal(panel.style.display, 'block');
		fire('click', 'togglePastePanel', { target }); assert.equal(panel.style.display, 'none');
	}
	const error = document.getElementById('rep-new-district-error'); error.textContent = '地区名が必要です';
	fire('input', 'clearAddDistrictError');
	assert.equal(error.textContent, ''); assert.equal(error.style.display, 'none');
	global.currentDistrict = { district: '地区名', hata: { title: '設定' } };
	global.exportHataOfficialJson = config => { assert.equal(config, currentDistrict.hata); return 'json-content'; };
	fire('click', 'exportHataSettings');
	assert.equal(calls.at(-1).name, 'downloadTextFile');
	assert.equal(calls.at(-1).args[0], 'json-content');
	assert.match(calls.at(-1).args[1], /^HataFuRotto設定_地区名_\d{8}\.json$/);
	currentDistrict.district = '';
	fire('click', 'exportHataSettings');
	assert.match(calls.at(-1).args[1], /^HataFuRotto設定_PTA_\d{8}\.json$/);
});

test('events: unknown names and invalid parameters cannot resolve global functions or object properties', t => {
	fresh();
	const monitored = ['alert', 'eval', 'constructor', '__proto__', 'toString', 'unknown'];
	const originals = new Map(monitored.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]));
	t.after(() => {
		for (const [name, descriptor] of originals) {
			if (descriptor) Object.defineProperty(global, name, descriptor);
			else delete global[name];
		}
	});
	for (const name of monitored) {
		Object.defineProperty(global, name, {
			configurable: true, writable: true,
			value: (...args) => calls.push({ name: `forbidden global ${name}`, args })
		});
	}
	for (const type of ['click', 'input', 'change', 'submit', 'keydown']) {
		for (const action of ['constructor', '__proto__', 'toString', 'alert', 'eval', 'saveDistrictLocal();alert(1)', 'unknown']) fire(type, action);
	}
	for (const index of ['', '-1', '1.5', '1e2', 'Infinity', 'NaN', '9007199254740992', '0;alert(1)', '__proto__']) {
		fire('click', 'deleteRepDistrict', { index });
		fire('input', 'updateS', { index, field: 'lastName' });
		fire('change', 'toggleSzNeighbor', { index: '0', index2: index });
	}
	fire('click', 'deleteRepDistrict');
	for (const mode of ['', '__proto__', 'javascript:alert(1)', 'invalid']) {
		fire('click', 'switchTab', { mode });
		fire('click', 'shareAppUrl', { mode });
		fire('click', 'shareDistrictData', { mode });
		fire('click', 'applyHataPeriodPreset', { mode });
	}
	for (const target of ['', '__proto__', 'body', 'storage-lock-modal', 'tab-unknown']) {
		fire('click', 'setAllCardsCollapse', { target, flag: 'false' });
		fire('click', 'togglePastePanel', { target });
		fire('click', 'togglePasswordVisibility', { 'password-target': target });
		fire('click', 'quickSetupEncryptionFromCard', { 'password-target': target });
	}
	for (const flag of ['', '0', 'yes']) fire('click', 'setRepPrintChecks', { flag });
	fire('click', 'moveNeighborRow', { index: '0', direction: '0' });
	fire('input', 'updateSeatCell', { target: '1_0\" onclick=alert(1)', field: 'customText' });
	fire('input', 'updateSeatCell', { target: '1_0', field: '__proto__' });
	fire('input', 'updateHataConfig', { field: '__proto__' });
	assert.deepEqual(calls, []);
	assert.equal(Object.getPrototypeOf(currentDistrict.hata), Object.prototype);
	dispatchUiEvent(eventFor('not-an-event', new MockElement('div')));
	dispatchUiEvent(eventFor('click', null));
	assert.deepEqual(calls, []);
});

test('events: delegated nested clicks stop at card controls; forms, Enter and backdrop remain native', () => {
	fresh();
	const card = new MockElement('div'); card.className = 'card';
	const heading = element('click', 'toggleCard', {}, card);
	const controls = element('click', 'stopPropagation', {}, heading);
	const button = element('click', 'addOfficer', {}, controls);
	const icon = new MockElement('span'); button.appendChild(icon);
	const event = eventFor('click', icon);
	dispatchUiEvent(event);
	assert.deepEqual(calls, [{ name: 'addOfficer', args: [] }]);
	assert.equal(event.cancelBubble, true);
	calls.length = 0;
	dispatchUiEvent(eventFor('click', heading));
	assert.deepEqual(calls, [{ name: 'toggleCard', args: [card] }]);
	for (const action of ['preventSubmit', 'confirmAddRepDistrict']) {
		const { event } = fire('submit', action);
		assert.equal(event.defaultPrevented, true);
	}
	assert.equal(calls.at(-1).name, 'confirmAddRepDistrict');
	calls.length = 0;
	for (const key of ['Escape', 'a']) dispatchUiEvent(eventFor('keydown', element('keydown', 'unlockOnEnter'), { key }));
	assert.deepEqual(calls, []);
	dispatchUiEvent(eventFor('keydown', element('keydown', 'unlockOnEnter'), { key: 'Enter' }));
	assert.deepEqual(calls, [{ name: 'handlePasswordUnlock', args: [] }]);
	calls.length = 0;
	const backdrop = element('click', 'closeAddDistrictBackdrop');
	const modalBody = new MockElement('div'); backdrop.appendChild(modalBody);
	dispatchUiEvent(eventFor('click', modalBody)); assert.deepEqual(calls, []);
	dispatchUiEvent(eventFor('click', backdrop));
	assert.deepEqual(calls, [{ name: 'closeAddDistrictModal', args: [] }]);
});

test('events: one listener set handles elements added after binding and repeated binding does not duplicate work', () => {
	fresh();
	const root = new MockElement('div');
	bindUiEvents(root); bindUiEvents(root);
	for (const type of ['click', 'input', 'change', 'submit', 'keydown']) assert.equal(root.listeners[type].length, 1, type);
	const oldRow = element('input', 'updateS', { index: '0', field: 'lastName' }, root);
	oldRow.value = '旧行'; root.dispatchEvent(eventFor('input', oldRow));
	root.removeChild(oldRow);
	const newRow = element('input', 'updateS', { index: '1', field: 'lastName' }, root);
	newRow.value = '再描画後'; root.dispatchEvent(eventFor('input', newRow));
	assert.deepEqual(calls, [{ name: 'updateS', args: [0, 'lastName', '旧行'] }, { name: 'updateS', args: [1, 'lastName', '再描画後'] }]);
	bindUiEvents();
});
