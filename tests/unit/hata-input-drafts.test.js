const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
const utils = require('../../js/utils');
require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');

test('flag drafts: invalid range and unfinished lists preserve canonical fields until all corrections are valid', () => {
	const config = { startDate: '2026-11-09', endDate: '2026-11-15', holidays: '', specials: '' };
	const original = { ...config };
	for (const inputs of [{ endDate: '2026-11-01' }, { endDate: '2050-01-01' }, { holidays: '2026-' }, { specials: '2026-11-' }]) {
		assert.equal(utils.collectHataScheduleInputs(config, inputs), false);
		for (const key of Object.keys(original)) assert.equal(config[key], original[key]);
		assert.doesNotThrow(() => utils.validateHataConfig(config), 'Stored canonical fields remain valid');
	}
	assert.equal(utils.collectHataScheduleInputs(config, { endDate: '2026-11-15', holidays: '2026-11-10,休校', specials: '2026-11-14,当番,行事' }), true);
	assert.equal(config.inputDrafts, undefined);
	assert.equal(config.holidays, '2026-11-10,休校');
	assert.equal(config.specials, '2026-11-14,当番,行事');
	assert.equal(utils.collectHataScheduleInputs(config, { holidays: '', specials: '', startDate: '', endDate: '' }), true);
	assert.equal(config.startDate, '');
	assert.equal(utils.collectHataScheduleInputs({}, {}), true, 'Absent optional controls do not erase configuration');
});

test('flag drafts: nested shape is validated before import, storage or handoff acceptance', () => {
	for (const inputDrafts of [null, [], 'text', { title: 'forbidden' }, { holidays: 42 }, { specials: false }]) assert.throws(() => utils.validateHataConfig({ inputDrafts }));
	const inputDrafts = { startDate: '2026-', endDate: '2050-11-15', holidays: '<img src=x>', specials: '2026-' };
	assert.deepEqual(utils.validateHataConfig({ inputDrafts }).inputDrafts, inputDrafts);
	assert.deepEqual(hata.importHataOfficialJson({ inputDrafts }).inputDrafts, inputDrafts);
	assert.throws(() => utils.validateHataConfig({ startDate: '2026-', inputDrafts }), 'Draft storage never weakens canonical validation');
});

test('flag drafts: renderer shows raw fields, blocks generation, copy and print, and clears stale preview and stats', async () => {
	setupDomEnvironment();
	state.currentDistrict = { students: [], hata: { startDate: '2026-11-09', endDate: '2026-11-15', holidays: '', specials: '', members: '担当', inputDrafts: { startDate: '', endDate: '2050-01-01', holidays: '2026-', specials: '2026-11-' } } };
	hata.renderHataCard();
	for (const [field, id] of [['startDate', 'hata-start-date'], ['endDate', 'hata-end-date'], ['holidays', 'hata-holidays'], ['specials', 'hata-specials']]) assert.equal(document.getElementById(id).value, state.currentDistrict.hata.inputDrafts[field]);
	const notifications = [];
	global.alert = msg => notifications.push(msg);
	hata.runAutoHataGeneration(); await hata.copyHataForLine(); hata.printHataSchedule();
	assert.equal(notifications.length, 3);
	assert.ok(document.getElementById('hata-input-status').textContent.includes('未完成'));
	assert.equal(document.getElementById('hata-summary-container').textContent, '');
	document.elements['hata-input-status'] = null;
	document.elements['hata-summary-container'] = null;
	assert.equal(hata.renderHataInputStatus(), false);
	hata.renderHataSchedulePreview();
	delete state.currentDistrict.hata.inputDrafts;
	assert.equal(hata.ensureHataInputsReady(), true);
});


test('flag exemptions: actual member names and legacy household keys can both be selected and cleared', () => {
	setupDomEnvironment();
	state.currentDistrict = { students: [{ lastName: '山田', address: '1-2' }], hata: { members: '1-2 山田\n外部担当\n外部担当', holidays: '', exemptHouseholds: ['1-2_山田', '1-2 山田'] } };
	hata.renderHataCard();
	const html = document.getElementById('hata-exempt-list').innerHTML;
	assert.ok(html.includes('data-household-key="1-2_山田"'));
	assert.ok(html.includes('data-household-key="外部担当"'));
	assert.equal((html.match(/data-household-key=/g) || []).length, 2, 'Duplicate names share one exemption checkbox');
	hata.toggleHataExempt('1-2_山田', false, '1-2 山田');
	assert.deepEqual(state.currentDistrict.hata.exemptHouseholds, []);
	hata.toggleHataExempt('外部担当', true);
	assert.deepEqual(state.currentDistrict.hata.exemptHouseholds, ['外部担当']);
	const config = { startDate: '2026-11-09', endDate: '2026-11-09', weekdays: [1], members: '1-2 山田\n外部担当', exemptHouseholds: state.currentDistrict.hata.exemptHouseholds };
	assert.equal(hata.generateHataSchedule(config)[0].person, '1-2 山田');
	state.currentDistrict.students = [];
	state.currentDistrict.hata = { members: '1-2 山田', exemptHouseholds: ['1-2_山田'] };
	hata.renderHataExemptList();
	assert.ok(document.getElementById('hata-exempt-list').innerHTML.includes('checked'), 'Normalized legacy keys remain checked without source students');
	state.currentDistrict.students = [{ lastName: '山田', address: '1-2' }];
	state.currentDistrict.hata = { exemptHouseholds: ['1-2_山田'] };
	hata.renderHataExemptList();
	assert.ok(document.getElementById('hata-exempt-list').innerHTML.includes('checked'), 'Legacy missing members uses the household fallback');
});
