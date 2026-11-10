const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
const utils = require('../../js/utils');
require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');

const maxText = 4096;
const maxOutput = 1024 * 1024;
const valid = () => ({ startDate: '2026-11-09', endDate: '2026-11-13', members: '担当', holidays: '', specials: '', weekdays: [1, 2, 3, 4, 5] });

test('SEC-20: imported values containing tokens are literal data during one-pass roster formatting', () => {
	state.currentDistrict = { district: '{班}', han: '{苗字}' };
	const students = [{ lastName: '{氏名}', firstName: '{学年}', name: 'legacy', address: '{地区}', grade: '6', lastNameKana: '{名前}' }];
	assert.equal(hata.buildHataMembersText(students, '{住所}|{地区}|{班}|{苗字}|{ふりがな}', false), '{地区}|{班}|{苗字}|{氏名}|{名前}');
});

test('SEC-20: flag roster strings and arrays share the same count and per-name limits', () => {
	const names = Array.from({ length: 10001 }, (_, index) => `担当${index}`);
	assert.throws(() => utils.validateHataConfig({ members: names.join('\n') }));
	assert.throws(() => utils.validateHataConfig({ members: ['a'.repeat(maxText + 1)] }));
	assert.throws(() => utils.validateHataConfig({ members: 'a'.repeat(maxText + 1) }));
	assert.doesNotThrow(() => utils.validateHataConfig({ members: names.slice(1).join('\n') }));
	assert.doesNotThrow(() => utils.validateHataConfig({ members: 'a'.repeat(maxText) }));
	assert.throws(() => utils.validateHataConfig({ members: '\n'.repeat(10000) }), 'Blank lines also have a bounded splitting cost');
});

test('SEC-20: source format and date-expression lines have explicit length limits', () => {
	assert.throws(() => utils.validateHataConfig({ format: 'a'.repeat(maxText + 1) }));
	for (const field of ['holidays', 'specials']) {
		assert.throws(() => utils.validateHataConfig({ [field]: '2026-11-09,' + 'a'.repeat(maxText) }));
		assert.doesNotThrow(() => utils.validateHataConfig({ [field]: '2026-11-09,' + 'a'.repeat(maxText - 11) }));
	}
});

test('SEC-20: formatting rejects aggregate UTF-8 expansion before replacing a manually edited roster', () => {
	state.currentDistrict = { students: Array.from({ length: 300 }, () => ({ lastName: '名' })), hata: { ...valid(), format: 'あ'.repeat(2000), dedup: false, members: '保持する名簿' } };
	assert.throws(() => hata.buildHataMembersText(state.currentDistrict.students, state.currentDistrict.hata.format, false));
	assert.throws(() => hata.buildHataMembersText([{ lastName: 'x'.repeat(8192) }], '{苗字}'.repeat(300), false), 'Reject each replacement before allocating a multiplied result');
	assert.equal(hata.buildHataMembersText([{ lastName: '名' }], 'a'.repeat(maxText), false).length, maxText);
	const messages = [];
	global.alert = value => messages.push(value);
	hata.syncHataMembersFromStudents();
	assert.equal(state.currentDistrict.hata.members, '保持する名簿');
	assert.ok(messages.at(-1).includes('上限'));
});

test('SEC-20: repeated schedule names and notes are bounded before UI state or markup is replaced', () => {
	const config = { startDate: '2026-01-01', endDate: '2035-01-01', members: 'あ'.repeat(300), weekdays: [0, 1, 2, 3, 4, 5, 6], holidays: '' };
	assert.throws(() => utils.validateHataConfig(config));
	assert.throws(() => hata.generateHataSchedule(config));
	for (const field of ['holidays', 'specials']) {
		const value = field === 'holidays' ? '2026-01-01〜2035-01-01,' : '2026-01-01〜2035-01-01,担当,';
		assert.throws(() => utils.validateHataConfig({ ...config, members: '短い名', [field]: value + 'あ'.repeat(300) }));
	}
	const rows = Array.from({ length: 1000 }, () => ({ date: '2026-11-09', person: 'あ'.repeat(400) }));
	assert.throws(() => hata.buildHataScheduleHtml(rows));
	assert.throws(() => hata.buildHataPrintHtml(rows, {}));
	assert.throws(() => hata.buildHataLineText(rows, {}));
	const exact = [...Array(255).fill({ lastName: 'a'.repeat(4096) }), { lastName: 'a'.repeat(3841) }];
	assert.equal(hata.buildHataMembersText(exact, '{苗字}', false).length, maxOutput, 'Exact 1MiB including separators is accepted');
	exact.at(-1).lastName += 'a';
	assert.throws(() => hata.buildHataMembersText(exact, '{苗字}', false), '1MiB plus one byte is rejected');
});

test('SEC-20: inherited district text and select option cross-products are bounded before normalization and rendering', () => {
	assert.throws(() => utils.validateImportData({ district: '地区', han: 'x'.repeat(4097), students: [{}] }, 'district'), 'A single inherited han cannot multiply an oversized source value');
	const district = { district: '地区', hanList: Array.from({ length: 40 }, (_, i) => `${i}${'班'.repeat(100)}`), students: Array.from({ length: 500 }, () => ({ lastName: '児童' })) };
	assert.ok(Buffer.byteLength(JSON.stringify(district)) < 4 * maxOutput, 'Input fits the ordinary JSON size limit');
	assert.throws(() => utils.validateImportData(district, 'district'), 'Select choices cannot be multiplied by every student row without a budget');
	assert.throws(() => utils.validateStoredData(district, 'kogai_district_v2'), 'Stored models use the same admission check');
	const rep = { districts: [{ district: '地区', selectedForPrint: true, officers: Array.from({ length: 500 }, (_, i) => ({ lastName: `${i}${'役員'.repeat(100)}` })) }], seatConfig: { rows: 14, cols: 10, cells: {} } };
	assert.ok(Buffer.byteLength(JSON.stringify(rep)) < 4 * maxOutput);
	assert.throws(() => utils.validateImportData(rep, 'rep'), 'Participant choices cannot be multiplied across all 140 seats without a budget');
});
