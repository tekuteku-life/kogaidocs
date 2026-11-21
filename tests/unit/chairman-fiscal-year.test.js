const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment, waitForStoredChange } = require('../helpers/dom-mock');
setupDomEnvironment();
const utils = require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
const district = require('../../js/district');
const seat = require('../../js/seat');
const rep = require('../../js/rep');
require('../../js/neighbor');
require('../../js/transfer');
const app = require('../../js/app');
const print = require('../../js/print');

const PASSWORD = 'ChairmanFiscal123!';
const NativeURL = require('node:url').URL;

function fresh() {
	cryptoLib.clearStorageSecurity();
	setupDomEnvironment();
	global.URL = NativeURL;
	state.currentDistrict = { district: '地区', han: '1班', hanList: ['1班'], officers: [], students: [], neighborhood: [] };
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
	state.neighborState = { district: '', neighborhood: [] };
	state.transferState = { children: [], memo: '' };
	const dialogs = { alerts: [], confirms: [], confirmAnswer: true };
	global.alert = message => dialogs.alerts.push(String(message));
	global.confirm = message => { dialogs.confirms.push(String(message)); return dialogs.confirmAnswer; };
	return dialogs;
}

function row(role, lastName, extra = {}) {
	return { role, lastName, firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', ...extra };
}

function neighborFile(districtName, rows) {
	return { isNeighborhoodData: true, district: districtName, neighborhood: rows.map(r => ({ ...r })) };
}

function districtFile(districtName, rows, han = '1班') {
	return { district: districtName, han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [{ grade: '1', class: '1', lastName: '児童', firstName: '一' }], neighborhood: rows.map(r => ({ ...r })) };
}

function checksOf(districtName, han) {
	return state.repState.districts.find(d => d.district === districtName && (han === undefined || d.han === han)).szNeighborChecks;
}

/** 出席者の名札（印刷）に載る自治会役員の氏名。印刷と同じく印刷対象のエントリから作る。 */
function printedNeighbors(districtName) {
	return print.buildSzTentCardsPagesHtml(state.repState.districts.filter(d => d.selectedForPrint))
		.filter(page => page.includes(`<div class="tent-sub">${districtName}</div>`))
		.map(page => page.match(/<span class="tent-name">([^<]*)<\/span>/)[1]);
}

function selectorChecks() {
	rep.renderSzNeighborhoodSelector();
	return [...document.getElementById('sz-neighborhood-selector').innerHTML.matchAll(/<input type="checkbox" (checked )?[^>]*>\s*([^<\n]+)/g)].map(m => `${m[1] ? '☑' : '☐'}${m[2].trim()}`);
}

function seatNeighbors() {
	return seat.getAllSzParticipantsForSeat().filter(person => person.key.startsWith('NEI_')).map(person => person.name);
}

/** 旧版の出席セレクタが行っていた行番号による同期を、旧版で保存されたデータとして再現する。 */
function legacyRowSync(dIdx, nIdx, flag) {
	const name = (state.repState.districts[dIdx].district || '').trim();
	state.repState.districts.forEach(d => {
		if ((d.district || '').trim() === name) d.szNeighborChecks = { ...(d.szNeighborChecks || {}), [nIdx]: flag };
	});
}

function withDate(t, isoLocal, run) {
	t.mock.timers.enable({ apis: ['Date'], now: new Date(isoLocal) });
	try { return run(); } finally { t.mock.timers.reset(); }
}

async function importFiles(models) {
	document.getElementById('rep-pass').value = PASSWORD;
	for (const model of models) {
		const text = await cryptoLib.encryptPayload(JSON.stringify(model), PASSWORD);
		const event = { target: { files: [{ name: 'import.txt', text: async () => text }], value: 'import.txt' } };
		await rep.loadMultipleDistrictFiles(event);
		assert.equal(event.target.value, '');
	}
}

// ---- SPEC-Q1: 会長の判定と新しい名簿の初期チェック ----

test('SPEC-Q1: only an exact chairman role (会長・自治会長・町内会長・町会長, after trimming) is the chairman', () => {
	assert.deepEqual(seat.NEIGHBOR_CHAIRMAN_ROLES, ['会長', '自治会長', '町内会長', '町会長']);
	for (const role of ['会長', '自治会長', '町内会長', '町会長', ' 会長 ', '　会長　', '\t自治会長\n']) {
		assert.equal(seat.isNeighborChairman({ role }), true, JSON.stringify(role));
	}
	for (const role of ['副会長', '会長代行', 'PTA会長', '副自治会長', '区長', '会長・副会長', '自治会長代理', '町内会副会長', '会', '', '   ']) {
		assert.equal(seat.isNeighborChairman({ role }), false, JSON.stringify(role));
	}
	for (const value of [null, undefined, '会長', 1, {}, { role: null }, { role: 1 }, { role: ['会長'] }]) {
		assert.equal(seat.isNeighborChairman(value), false, `abnormal ${JSON.stringify(value)}`);
	}
});

test('SPEC-Q1: default checks mark every named chairman, fall back to the first named row otherwise, and are fresh objects', () => {
	assert.deepEqual(seat.defaultNeighborChecks([row('書記', 'A'), row('会長', 'B'), row('副会長', 'C'), row('自治会長', 'D')]), { 1: true, 3: true });
	assert.deepEqual(seat.defaultNeighborChecks([row('書記', 'A'), row('副会長', 'B')]), { 0: true }, 'No chairman: the first row, not the partial match');
	assert.deepEqual(seat.defaultNeighborChecks([row('書記', 'A'), row('会長', ''), row('会長', '  ', { firstName: '' })]), { 0: true }, 'Name-empty chairmen are not checked; the first named row is the fallback');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', '')]), {}, 'A lone name-empty chairman is never checked');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', ''), row('副会長', '')]), {}, 'The year-update template roster checks nobody');
	assert.deepEqual(seat.defaultNeighborChecks([row('', ''), row('会長', ''), row('書記', 'B')]), { 2: true }, 'Blank and name-empty rows are skipped by the fallback');
	assert.deepEqual(seat.defaultNeighborChecks([row('書記', 'A'), { role: '会長', name: '旧形式' }]), { 1: true }, 'A legacy name field counts as a name');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', '', { firstName: '花子' })]), { 0: true }, 'A first name alone counts as a name');
	assert.deepEqual(seat.defaultNeighborChecks([]), {}, 'An empty roster checks nobody');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', '同'), row('会長', '同'), row('会長', '別')]), { 2: true }, 'Duplicated identical rows are never checked');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', '同', { tel: '1' }), row('会長', '同', { tel: '2' })]), { 0: true, 1: true }, 'Rows that differ only in the phone are different chairmen');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', '同', { address: '東1' }), row('会長', '同', { address: '東2' })]), { 0: true, 1: true }, 'Rows that differ only in the address are different chairmen');
	const previousIds = [row('会長', '同', { tel: '1' }), row('書記', '記', { address: '東1' })];
	const previous = seat.neighborCheckCandidate({ neighborhood: previousIds, szNeighborChecks: { 0: false, 1: true } });
	assert.deepEqual(seat.resolveImportedNeighborChecks([row('会長', '同', { tel: '2' }), row('書記', '記', { address: '東2' })], [previous]), { 0: true }, 'A row with another phone or address is not the same person: no carry, the chairman is checked, 書記 has no key');
	assert.deepEqual(seat.resolveImportedNeighborChecks(previousIds, [previous]), { 0: false, 1: true }, 'Control: the same phone and address carry the values');
	assert.deepEqual(seat.defaultNeighborChecks([row('書記', '同'), row('書記', '同'), row('会計', 'X')]), { 2: true }, 'The fallback takes the first unique named row');
	assert.deepEqual(seat.defaultNeighborChecks([row('書記', '同'), row('書記', '同')]), {}, 'Only duplicated rows: nobody');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', '同'), row('会長', '同'), row('副会長', 'X')]), {}, 'Only duplicated named chairmen: no fallback to 副会長');
	assert.deepEqual(seat.defaultNeighborChecks([row('会長', ''), row('会長', ''), row('副会長', 'X')]), { 2: true }, 'Duplicated name-empty chairmen do not block the fallback');
	for (const value of [undefined, null, '会長', { 0: row('会長', 'A') }]) assert.deepEqual(seat.defaultNeighborChecks(value), {}, `abnormal ${JSON.stringify(value)}`);
	assert.notEqual(seat.defaultNeighborChecks([row('会長', 'A')]), seat.defaultNeighborChecks([row('会長', 'A')]));
});

test('SPEC-Q1: a new district from a district file or a neighborhood file checks the chairman and never 副会長', () => {
	fresh();
	rep.upsertRepDistrict(districtFile('東地区', [row('書記', 'A'), row('副会長', 'B'), row('会長', 'C')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 2: true });
	rep.upsertRepDistrict(districtFile('西地区', [row('書記', 'A'), row('副会長', 'B')]), state.repState, false);
	assert.deepEqual(checksOf('西地区'), { 0: true }, 'The first row is the fallback; 副会長 is not checked by a partial match');
	rep.mergeNeighborDataIntoRep(neighborFile('南地区', [row('副会長', 'A'), row('自治会長', 'B')]), state.repState, false);
	assert.deepEqual(checksOf('南地区'), { 1: true });
	rep.mergeNeighborDataIntoRep(neighborFile('北地区', [row('会長代行', 'A'), row('PTA会長', 'B')]), state.repState, false);
	assert.deepEqual(checksOf('北地区'), { 0: true });
	rep.mergeNeighborDataIntoRep(neighborFile('空地区', []), state.repState, false);
	assert.deepEqual(checksOf('空地区'), {});
});

// ---- SPEC-Q2: 名簿差替え時の会長チェック ----

test('SPEC-Q2: a neighborhood file replacing the roster checks the new chairman and carries the same people', () => {
	fresh();
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '旧会長'), row('副会長', '継続'), row('会計', '退任')]), state.repState, false);
	rep.toggleSzNeighbor(0, 1, true);
	rep.toggleSzNeighbor(0, 2, true);
	assert.deepEqual(checksOf('東地区'), { 0: true, 1: true, 2: true });
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('書記', '新任'), row('副会長', '継続'), row('会長', '新会長')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 1: true, 2: true }, 'New chairman checked, the same 副会長 carried, others unchecked');
});

test('SPEC-Q2: a replaced roster through a district file also checks the new chairman', () => {
	fresh();
	rep.upsertRepDistrict(districtFile('東地区', [row('会長', '旧会長'), row('副会長', '継続')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 0: true });
	rep.upsertRepDistrict(districtFile('東地区', [row('副会長', '継続'), row('会長', '新会長')]), state.repState, false);
	assert.equal(state.repState.districts.length, 1, 'Same district and 班 replaces the entry');
	assert.deepEqual(checksOf('東地区'), { 1: true });
});

test('SPEC-Q2: carried people keep their state, including an unchecked chairman and a chairman without a key', () => {
	fresh();
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '継続会長'), row('副会長', 'B')]), state.repState, false);
	rep.toggleSzNeighbor(0, 0, false);
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('書記', '新任'), row('会長', '継続会長'), row('副会長', 'B')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 1: false }, 'The explicit unchecked state follows the same person');
	assert.equal(seat.defaultNeighborChecks(state.repState.districts[0].neighborhood)[1], true, 'He would be checked by the initial rule');

	fresh();
	state.repState.districts.push({ district: '西地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', '鍵なし')], szNeighborChecks: {} });
	rep.mergeNeighborDataIntoRep(neighborFile('西地区', [row('会長', '鍵なし'), row('書記', 'B')]), state.repState, false);
	assert.deepEqual(checksOf('西地区'), {}, 'A uniquely matched chairman without a key is carried as unchecked');
});

test('SPEC-Q2: no first-row fallback on replacement, name-empty chairmen stay unchecked, duplicated rows are never checked', () => {
	fresh();
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '旧会長')]), state.repState, false);
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('書記', 'X'), row('会計', 'Y')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), {}, 'No chairman and nobody carried: nobody is checked');
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', ''), row('書記', 'X')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), {}, 'A template chairman without a name is not checked');

	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '同名')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 0: true });
	rep.toggleSzNeighbor(0, 0, false);
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '同名'), row('会長', '同名'), row('副会長', 'Z')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), {}, 'Duplicated rows in the new roster are ambiguous and never checked');
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '同名'), row('副会長', 'Z')]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 0: true }, 'A chairman duplicated only in the previous roster has no source and is checked');
});

test('SPEC-Q2: only the imported district is affected; unrelated districts keep even duplicated, unchecked chairmen', () => {
	fresh();
	state.repState.districts.push({ district: '無関係地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', '重複'), row('会長', '重複')], szNeighborChecks: { 0: false } });
	state.repState.districts.push({ district: '空の無関係地区', han: '', hanList: [], officers: [], neighborhood: [row('会長', '未設定')], students: [], selectedForPrint: true });
	state.repState.districts.push({ district: '重複出席地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('副会長', '重'), row('副会長', '重')], szNeighborChecks: { 0: true, 1: true } });
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', 'A')]), state.repState, false);
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', 'B')]), state.repState, false);
	rep.upsertRepDistrict(districtFile('西地区', [row('会長', 'C')]), state.repState, false);
	assert.deepEqual(checksOf('無関係地区'), { 0: false }, 'Duplicated chairmen in another district are never re-checked');
	assert.equal(Object.hasOwn(state.repState.districts[1], 'szNeighborChecks'), false, 'An untouched district with a roster but no check object keeps none (the full reconcile would create {})');
	assert.deepEqual(checksOf('重複出席地区'), { 0: true, 1: true }, 'Checked duplicated rows of another district are not dropped');
	assert.deepEqual(checksOf('東地区'), { 0: true });
	assert.deepEqual(checksOf('西地区'), { 0: true });
});

test('SPEC-Q2: a district-file import replaces only its own 班 entry; a same-name 班 with a different roster keeps its unchecked chairman', () => {
	fresh();
	rep.upsertRepDistrict(districtFile('共通地区', [row('会長', '代表会長'), row('副会長', 'A'), row('会計', 'B')], '1班'), state.repState, false);
	state.repState.districts.push({ district: '共通地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '別名簿会長')], szNeighborChecks: { 0: false } });
	rep.upsertRepDistrict(districtFile('共通地区', [row('会長', '三班会長')], '3班'), state.repState, false);
	assert.deepEqual(checksOf('共通地区', '2班'), {}, 'The entry that was not replaced is rebuilt per person: its unmatched chairman stays unchecked');
	assert.deepEqual(checksOf('共通地区', '1班'), { 0: true });
	assert.deepEqual(checksOf('共通地区', '3班'), { 0: true });
});

test('SPEC-Q2: a previous roster made only of name-empty slots counts as no roster', () => {
	for (const apply of [
		rows => rep.upsertRepDistrict(districtFile('空枠地区', rows), state.repState, false),
		rows => rep.mergeNeighborDataIntoRep(neighborFile('空枠地区', rows), state.repState, false)
	]) {
		for (const previousRows of [[row('会長', ''), row('副会長', '')], [row('', '')], [row('会長', '', { tel: '090' })]]) {
			fresh();
			state.repState.districts.push({ district: '空枠地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: previousRows, szNeighborChecks: { 1: true } });
			apply([row('区長', '区'), row('書記', '書')]);
			assert.deepEqual(checksOf('空枠地区'), { 0: true }, `${JSON.stringify(previousRows)}: the first named row is checked as for a new roster and the stale key is dropped`);
		}
	}
});

test('SPEC-Q2: an incoming roster of role-only rows is a replacement and never keeps old checks on name-empty rows', () => {
	for (const apply of [
		rows => rep.upsertRepDistrict(districtFile('役職地区', rows), state.repState, false),
		rows => rep.mergeNeighborDataIntoRep(neighborFile('役職地区', rows), state.repState, false)
	]) {
		fresh();
		state.repState.districts.push({ district: '役職地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A'), row('副会長', '')], szNeighborChecks: { 0: true, 1: true } });
		apply([row('会長', ''), row('副会長', '')]);
		const entry = state.repState.districts[0];
		assert.deepEqual(entry.neighborhood.map(r => [r.role, r.lastName]), [['会長', ''], ['副会長', '']], 'The role-only roster replaces the named one (not protected as a copy)');
		assert.deepEqual(entry.szNeighborChecks, {}, 'Name-empty rows never keep the old true');
	}
});

test('SPEC-Q2: a district without a previous roster is rebuilt with the initial rule by both import functions', () => {
	for (const apply of [
		(name, han, rows) => rep.upsertRepDistrict(districtFile(name, rows, han), state.repState, false),
		(name, han, rows) => rep.mergeNeighborDataIntoRep(neighborFile(name, rows), state.repState, false)
	]) {
		fresh();
		rep.addNewRepDistrict('手動地区');
		const han = state.repState.districts[0].han;
		assert.deepEqual(state.repState.districts[0].szNeighborChecks, {});
		apply('手動地区', han, [row('副会長', 'A'), row('会長', 'B')]);
		assert.deepEqual(checksOf('手動地区'), { 1: true }, 'The empty {} of a manual district does not block the chairman default');

		fresh();
		state.repState.districts.push({ district: '空地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], neighborhood: [], students: [], selectedForPrint: true, szNeighborChecks: { 0: false, 7: true } });
		apply('空地区', '1班', [row('副会長', 'A'), row('会長', 'B'), row('自治会長', 'C')]);
		assert.deepEqual(checksOf('空地区'), { 1: true, 2: true }, 'Stale and out-of-range keys from the empty roster are discarded');

		fresh();
		state.repState.districts.push({ district: '空地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], neighborhood: [], students: [], selectedForPrint: true, szNeighborChecks: { 1: true } });
		apply('空地区', '1班', [row('書記', 'A'), row('会計', 'B')]);
		assert.deepEqual(checksOf('空地区'), { 0: true }, 'A new roster without a chairman gets the first-row fallback');
	}
});

test('SPEC-Q2: same-name districts of different 班 with diverging rosters follow the per-row rule', () => {
	fresh();
	rep.upsertRepDistrict(districtFile('共通地区', [row('会長', '班一会長'), row('副会長', '共通')], '1班'), state.repState, false);
	rep.upsertRepDistrict(districtFile('共通地区', [row('副会長', '共通'), row('会長', '班二会長')], '2班'), state.repState, false);
	assert.deepEqual(checksOf('共通地区', '1班'), { 0: true }, 'The first 班 keeps its own chairman');
	assert.deepEqual(checksOf('共通地区', '2班'), { 1: true }, 'The second 班 checks its own new chairman, not the carried 副会長');
	rep.upsertRepDistrict(districtFile('共通地区', [row('書記', '班三書記')], '3班'), state.repState, false);
	assert.deepEqual(checksOf('共通地区', '3班'), {}, 'A same-name new 班 is a replacement: no first-row fallback');
	assert.deepEqual(checksOf('共通地区', '1班'), { 0: true });
});

test('SPEC-Q2: an existing district whose name has surrounding spaces is the same group and follows the replacement rule', () => {
	fresh();
	state.repState.districts.push({ district: '東地区 ', han: '', hanList: [], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', '継続')], szNeighborChecks: { 0: false } });
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '継続'), row('副会長', 'B')]), state.repState, false);
	assert.equal(state.repState.districts.length, 1, 'The trimmed name matches the existing entry');
	assert.deepEqual(state.repState.districts[0].szNeighborChecks, { 0: false }, 'Not rebuilt as a new roster; the unchecked chairman is carried');
	state.repState.districts.push({ district: '東地区', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [] });
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '継続'), row('会長', '新任')]), state.repState, false);
	assert.deepEqual(state.repState.districts[0].szNeighborChecks, { 0: false, 1: true });
	assert.deepEqual(state.repState.districts[1].szNeighborChecks, { 0: false, 1: true }, 'The entry without spaces uses the same previous group');

	fresh();
	state.repState.districts.push(
		{ district: '東地区 ', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A')], szNeighborChecks: { 0: true } },
		{ district: '東地区 ', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A'), row('書記', 'B')], szNeighborChecks: { 0: false } }
	);
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', 'A'), row('会長', 'C')]), state.repState, false);
	assert.deepEqual(checksOf('東地区 ', '1班'), { 0: false, 1: true }, 'Neighborhood file: the trimmed representative (2班) decides, not the first named entry');
	assert.deepEqual(checksOf('東地区 ', '2班'), { 0: false, 1: true });

	fresh();
	state.repState.districts.push(
		{ district: '東地区 ', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '継続'), row('書記', 'S'), row('会計', 'U')], szNeighborChecks: { 0: false, 1: true } },
		{ district: '東地区 ', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '新任')], szNeighborChecks: { 0: false } }
	);
	rep.upsertRepDistrict(districtFile('東地区', [row('会長', '継続'), row('会長', '新任')], '3班'), state.repState, false);
	const added = state.repState.districts.find(d => d.district === '東地区');
	assert.deepEqual(added.szNeighborChecks, { 1: true, 0: false }, 'District file: the trimmed group carries the cleared chairman and checks the new one');
	assert.deepEqual(checksOf('東地区 ', '2班'), { 0: true }, 'A spaced non-replaced entry is aligned to the imported new chairman');
	assert.deepEqual(checksOf('東地区 ', '1班'), { 0: false, 1: true });

	fresh();
	state.repState.districts.push(
		{ district: '西地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '継続'), row('書記', 'S'), row('会計', 'U')], szNeighborChecks: { 0: false, 1: true } },
		{ district: '西地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '新任')], szNeighborChecks: { 0: false } }
	);
	rep.upsertRepDistrict(districtFile(' 西地区 ', [row('会長', '継続'), row('会長', '新任')], '3班'), state.repState, false);
	assert.deepEqual(checksOf(' 西地区 ', '3班'), { 0: false, 1: true }, 'An incoming spaced name uses the trimmed group: the cleared chairman is carried and the new one checked');
	assert.deepEqual(checksOf('西地区', '2班'), { 0: true }, 'The other 班 is aligned to the new chairman');
	assert.deepEqual(checksOf('西地区', '1班'), { 0: false, 1: true });
});

test('SPEC-Q2: paste import and adding this device district apply the same replacement rule', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	await importFiles([neighborFile('東地区', [row('会長', '旧会長'), row('副会長', 'B')])]);
	document.getElementById('rep-paste-box').value = await cryptoLib.encryptPayload(JSON.stringify(neighborFile('東地区', [row('副会長', 'B'), row('会長', '貼付会長')])), PASSWORD);
	await rep.loadPastedTextToRep();
	assert.deepEqual(checksOf('東地区'), { 1: true }, 'Paste import checks the new chairman');

	const masterText = await cryptoLib.encryptPayload(JSON.stringify(neighborFile('東地区', [row('会長', 'マスター欄会長'), row('副会長', 'B')])), PASSWORD);
	const masterEvent = { target: { files: [{ name: 'neighbor.txt', text: async () => masterText }], value: 'neighbor.txt' } };
	await rep.loadRepMasterTxt(masterEvent);
	assert.deepEqual(checksOf('東地区'), { 0: true }, 'The master-file input also checks the new chairman');
	assert.equal(masterEvent.target.value, '');

	rep.toggleSzNeighbor(0, 1, false);
	assert.deepEqual(checksOf('東地区'), { 0: true, 1: false });
	state.currentDistrict = districtFile('東地区', [row('副会長', 'B'), row('書記', '新'), row('会長', '自地区会長')], '');
	renderDistrictForm();
	rep.addCurrentDistrictToRep();
	const own = state.repState.districts.find(d => d.district === '東地区' && d.officers.some(o => o.lastName === '委員'));
	assert.deepEqual(own.szNeighborChecks, { 0: false, 2: true }, 'Adding this device district carries the unchecked B and checks the new chairman at its new index');
	assert.ok(dialogs.alerts.every(message => !message.includes('失敗')), JSON.stringify(dialogs.alerts));

	// 合算の検証失敗は、スタブを使わず実データ（座席の描画量の上限）で起こす。
	const refusedDialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.seatConfig = { cols: 10, rows: 14, cells: {} };
	state.repState.districts.push(
		{ district: '東地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '旧会長'), row('副会長', 'B'), row('書記', 'S')], szNeighborChecks: { 0: true } },
		{ district: '東地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '別名簿会長'), row('副会長', 'B')], szNeighborChecks: { 0: true, 1: true } }
	);
	const external = () => ({ attend: true, category: '役所・警察・関係機関', org: '', role: '', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', name: '', contact: '' });
	for (;;) {
		const candidate = structuredClone(state.repState);
		candidate.szExternals.push(external());
		try { utils.validateStoredData(candidate, 'kogai_rep_v2'); } catch (_) { break; }
		state.repState.szExternals.push(external());
	}
	assert.equal(await saveRepLocal(), true);
	const storedBefore = localStorage.getItem('kogai_rep_v2');
	const before = JSON.stringify(state.repState);
	state.currentDistrict = districtFile('東地区', [row('会長', '拒否される会長'), row('副会長', 'B'), row('書記', 'S'), row('会計', '新会計'), row('監事', '新監事')], '1班');
	renderDistrictForm();
	rep.addCurrentDistrictToRep();
	await new Promise(resolve => setTimeout(resolve, 0));
	assert.equal(JSON.stringify(state.repState), before, 'A merge refused by validation changes nothing in memory, including the attendance of the other 班 that would be rebuilt');
	assert.equal(localStorage.getItem('kogai_rep_v2'), storedBefore, 'The stored representative data is unchanged');
	assert.equal(refusedDialogs.alerts.filter(message => /上限を超えるため、この変更を取り消しました/.test(message)).length, 1, 'The refusal is reported once');
});

test('SPEC-Q2: file and paste imports of a district file align the other 班 through the committed import model', async () => {
	for (const via of ['file', 'paste']) {
		const dialogs = fresh();
		await cryptoLib.setupStorageEncryption(PASSWORD, false);
		await importFiles([districtFile('A', [row('会長', 'Y'), row('書記', 'P'), row('会計', 'Q')], '1班'), districtFile('A', [row('会長', 'X'), row('書記', 'R')], '2班')]);
		const second = state.repState.districts.findIndex(d => d.han === '2班');
		rep.toggleSzNeighbor(second, 0, false);
		assert.deepEqual(checksOf('A', '2班'), { 0: false }, `${via}: X in 2班 is cleared (stale for the coming import)`);
		const incoming = districtFile('A', [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], '1班');
		if (via === 'file') await importFiles([incoming]);
		else {
			document.getElementById('rep-paste-box').value = await cryptoLib.encryptPayload(JSON.stringify(incoming), PASSWORD);
			await rep.loadPastedTextToRep();
		}
		assert.ok(dialogs.alerts.every(message => !message.includes('失敗')), JSON.stringify(dialogs.alerts));
		assert.deepEqual(checksOf('A', '1班'), { 0: true }, `${via}: the new chairman X is checked`);
		assert.deepEqual(checksOf('A', '2班'), { 0: true }, `${via}: 2班 is aligned through the committed model`);
		assert.deepEqual(selectorChecks(), ['☑会長：X', '☐書記：P', '☐会計：Q']);
		assert.deepEqual(seatNeighbors(), ['X']);
		assert.deepEqual(printedNeighbors('A'), ['X']);
		cryptoLib.lockStorage();
		await cryptoLib.unlockStorageWithPassword(PASSWORD);
		await app.loadAppDataFromStorage();
		assert.deepEqual(checksOf('A', '2班'), { 0: true }, `${via}: the aligned 2班 is stored`);
	}
});

test('SPEC-Q2: a rejected import leaves the attendance and the stored model unchanged', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	await importFiles([districtFile('東地区', [row('会長', '旧会長'), row('副会長', 'B')], '1班')]);
	await importFiles([districtFile('東地区', [row('会長', '新会長X'), row('書記', 'R')], '2班')]);
	assert.equal(state.repState.districts.length, 2, 'Two same-name entries exist');
	const second = state.repState.districts.findIndex(d => d.han === '2班');
	const imported = localStorage.getItem('kogai_rep_v2');
	rep.toggleSzNeighbor(second, 0, false);
	// トグル自身の保存（await されない）が、後の明示の保存より遅れて古い値で上書きしないよう、完了を待つ。
	await waitForStoredChange('kogai_rep_v2', imported);
	legacyRowSync(0, 1, true);
	assert.equal(await saveRepLocal(), true);
	assert.deepEqual(checksOf('東地区', '2班'), { 0: false, 1: true }, 'X is cleared in 2班 (R got an older row-number synced flag); a leaked alignment would set X to true');
	const stored = localStorage.getItem('kogai_rep_v2');
	const before = JSON.stringify(state.repState);
	const assertUnchanged = label => {
		assert.equal(JSON.stringify(state.repState), before, `${label}: memory unchanged`);
		assert.equal(localStorage.getItem('kogai_rep_v2'), stored, `${label}: storage unchanged`);
		assert.deepEqual(checksOf('東地区', '2班'), { 0: false, 1: true }, `${label}: no alignment leaks into 2班`);
	};
	const invalidDistrict = districtFile('東地区', [row('会長', '新会長X'), row('書記', '新'.repeat(4097))], '1班');
	const validDistrict = districtFile('東地区', [row('会長', '新会長X'), row('書記', 'R2')], '1班');
	await importFiles([invalidDistrict]);
	assertUnchanged('district file validation failure');
	await importFiles([neighborFile('東地区', [row('会長', '新'.repeat(4097))])]);
	assert.equal(JSON.stringify(state.repState), before, 'Memory unchanged');
	assert.equal(localStorage.getItem('kogai_rep_v2'), stored, 'Storage unchanged');
	assert.ok(dialogs.alerts.some(message => message.includes('失敗')), 'The rejection is reported');

	const originalSetItem = localStorage.setItem;
	localStorage.setItem = function (key, value) {
		if (key === 'kogai_rep_v2') throw new Error('QuotaExceededError');
		return originalSetItem.call(this, key, value);
	};
	const count = dialogs.alerts.length;
	try {
		await importFiles([neighborFile('東地区', [row('副会長', 'B'), row('会長', '保存失敗会長')])]);
		await importFiles([validDistrict]);
	} finally { localStorage.setItem = originalSetItem; }
	assertUnchanged('district file save failure');
	assert.equal(JSON.stringify(state.repState), before, 'A save failure keeps memory unchanged');
	assert.equal(localStorage.getItem('kogai_rep_v2'), stored, 'A save failure keeps storage unchanged');
	assert.ok(dialogs.alerts.slice(count).some(message => message.includes('失敗')), JSON.stringify(dialogs.alerts.slice(count)));

	const pasteBox = document.getElementById('rep-paste-box');
	const pasteCount = dialogs.alerts.length;
	pasteBox.value = await cryptoLib.encryptPayload(JSON.stringify(invalidDistrict), PASSWORD);
	await rep.loadPastedTextToRep();
	assertUnchanged('paste validation failure');
	assert.equal(dialogs.alerts.length, pasteCount + 1, 'The paste failure is reported');
	assert.doesNotMatch(dialogs.alerts.at(-1), /追加しました/);

	pasteBox.value = await cryptoLib.encryptPayload(JSON.stringify(validDistrict), PASSWORD);
	localStorage.setItem = function (key, value) {
		if (key === 'kogai_rep_v2') throw new Error('QuotaExceededError');
		return originalSetItem.call(this, key, value);
	};
	try {
		await rep.loadPastedTextToRep();
	} finally { localStorage.setItem = originalSetItem; }
	assertUnchanged('paste save failure');
	assert.equal(dialogs.alerts.length, pasteCount + 2, 'The paste save failure is reported');
	assert.doesNotMatch(dialogs.alerts.at(-1), /追加しました/);
});

test('SPEC-Q2: modal edits, print selection and other reconciliations never add chairman checks', () => {
	fresh();
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', 'A'), row('副会長', 'B')]), state.repState, false);
	rep.toggleSzNeighbor(0, 0, false);
	rep.openRepDistrictDetailModal(0);
	rep.updateModalNeighbor(1, 'role', '会長');
	rep.saveAndCloseRepDistrictDetailModal();
	assert.deepEqual(checksOf('東地区'), { 0: false }, 'Modal role edit to 会長 does not check the row');

	seat.setDistrictPrintSelection(0, false);
	seat.setDistrictPrintSelection(0, true);
	assert.deepEqual(checksOf('東地区'), { 0: false });

	const previous = seat.captureSeatState();
	state.repState.districts[0].neighborhood[1].lastName = '別人';
	seat.reconcileSeatState(previous);
	assert.deepEqual(checksOf('東地区'), { 0: false }, 'Without chairmanDistrict the changed chairman row stays unchecked');
	const snapshot = seat.captureSeatState();
	state.repState.districts[0].neighborhood[1].lastName = '別人2';
	seat.reconcileSeatState(snapshot, {}, state.repState, {});
	assert.deepEqual(checksOf('東地区'), { 0: false }, 'An empty option object keeps the default behaviour');
});

test('SPEC-Q2: after an import, later print toggles, deletions and modal saves keep the representative attendance and release unmatched non-representative rows', () => {
	fresh();
	rep.upsertRepDistrict(districtFile('共通地区', [row('会長', '代表会長'), row('副会長', 'A'), row('会計', 'B')], '1班'), state.repState, false);
	rep.upsertRepDistrict(districtFile('共通地区', [row('会長', '二班会長')], '2班'), state.repState, false);
	rep.upsertRepDistrict(districtFile('別地区', [row('会長', '別会長')]), state.repState, false);
	rep.mergeNeighborDataIntoRep(neighborFile('差替地区', [row('会長', '旧'), row('副会長', 'S')]), state.repState, false);
	rep.mergeNeighborDataIntoRep(neighborFile('差替地区', [row('副会長', 'S'), row('会長', '新')]), state.repState, false);
	assert.deepEqual(checksOf('共通地区', '2班'), { 0: true }, 'The non-representative entry gets its chairman at import');
	assert.deepEqual(checksOf('差替地区'), { 1: true });
	const otherIndex = state.repState.districts.findIndex(d => d.district === '別地区');
	seat.setDistrictPrintSelection(otherIndex, false);
	assert.deepEqual(checksOf('差替地区'), { 1: true }, 'The imported new chairman of a representative entry survives a print toggle');
	assert.deepEqual(checksOf('共通地区', '1班'), { 0: true });
	assert.deepEqual(checksOf('共通地区', '2班'), {}, 'An unmatched non-representative row is released as before');
	state.repState.districts.push({ district: '共通地区', han: '3班', hanList: ['3班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('副会長', 'A'), row('会長', '代表会長')], szNeighborChecks: { 0: true, 1: false } });
	seat.setDistrictPrintSelection(otherIndex, true);
	assert.deepEqual(checksOf('共通地区', '3班'), { 1: true }, 'Rows matching the representative take its values (A has no key, 代表会長 is true)');
	const reseed = () => {
		state.repState.districts.find(d => d.district === '共通地区' && d.han === '2班').szNeighborChecks = { 0: true };
		state.repState.districts.find(d => d.district === '共通地区' && d.han === '3班').szNeighborChecks = { 0: true, 1: false };
	};
	reseed();
	const countBefore = state.repState.districts.length;
	rep.deleteRepDistrict(otherIndex);
	assert.equal(state.repState.districts.length, countBefore - 1);
	assert.equal(state.repState.districts.some(d => d.district === '別地区'), false, 'The other district was actually deleted');
	assert.deepEqual(checksOf('差替地区'), { 1: true }, 'Deleting another district keeps it');
	assert.deepEqual(checksOf('共通地区', '2班'), {}, 'Delete: an unmatched non-representative row is released');
	assert.deepEqual(checksOf('共通地区', '3班'), { 1: true }, 'Delete: matching rows take the representative values');
	reseed();
	const index = state.repState.districts.findIndex(d => d.district === '差替地区');
	rep.openRepDistrictDetailModal(index);
	rep.saveAndCloseRepDistrictDetailModal();
	assert.deepEqual(checksOf('差替地区'), { 1: true }, 'An unchanged modal save keeps it');
	assert.deepEqual(checksOf('共通地区', '2班'), {}, 'Modal save: an unmatched non-representative row is released');
	assert.deepEqual(checksOf('共通地区', '3班'), { 1: true }, 'Modal save: matching rows take the representative values');
});

test('SPEC-Q2: when an import switches the representative entry, the per-person attendance the user set is kept', () => {
	fresh();
	state.repState.districts.push(
		{ district: '代地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('書記', 'P')], szNeighborChecks: { 0: true } },
		{ district: '代地区', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'P')], szNeighborChecks: { 0: true, 1: true } }
	);
	rep.toggleSzNeighbor(1, 0, false);
	assert.deepEqual(checksOf('代地区', '1班'), { 0: true }, 'The selector does not sync C to another person in the other entry');
	legacyRowSync(1, 0, false);
	assert.deepEqual(checksOf('代地区', '1班'), { 0: false }, 'Data saved by an older row-number sync has the flag on another person in the other entry');
	rep.mergeNeighborDataIntoRep(neighborFile('代地区', [row('会長', 'C'), row('書記', 'P')]), state.repState, false);
	assert.deepEqual(checksOf('代地区', '1班'), { 0: false, 1: true }, 'Computed once from the representative and applied to every entry');
	assert.deepEqual(checksOf('代地区', '2班'), { 0: false, 1: true });
	assert.deepEqual(selectorChecks(), ['☐会長：C', '☑書記：P'], 'The new representative (first entry) shows the user settings');
	assert.deepEqual(seatNeighbors(), ['P']);
	assert.deepEqual(printedNeighbors('代地区'), ['P'], 'Print shows the same person');

	fresh();
	state.repState.districts.push(
		{ district: '代地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'P')], szNeighborChecks: { 0: true } },
		{ district: '代地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('書記', 'P')], szNeighborChecks: {} }
	);
	rep.toggleSzNeighbor(0, 0, false);
	rep.upsertRepDistrict(districtFile('代地区', [row('会長', 'C'), row('書記', 'P'), row('会計', 'Q')], '2班'), state.repState, false);
	assert.deepEqual(checksOf('代地区', '2班'), { 0: false }, 'The replaced entry follows the previous representative per person');
	assert.deepEqual(selectorChecks(), ['☐会長：C', '☐書記：P', '☐会計：Q'], 'The replaced entry became the representative and keeps the cleared chairman');
	assert.deepEqual(seatNeighbors(), []);
	assert.deepEqual(printedNeighbors('代地区'), [], 'Print does not show the cleared chairman');
});

test('SPEC-Q2: when the representative roster has no names, the entry roster (district file) or the first named entry (neighborhood file) is the source', () => {
	const roleOnly = () => [row('会長', ''), row('副会長', ''), row('書記', '')];
	fresh();
	state.repState.districts.push(
		{ district: '役地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: roleOnly(), szNeighborChecks: {} },
		{ district: '役地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X')], szNeighborChecks: { 0: true } },
		{ district: '役地区', han: '3班', hanList: ['3班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X')], szNeighborChecks: { 0: false } }
	);
	rep.upsertRepDistrict(districtFile('役地区', [row('会長', 'X'), row('会長', 'Y')], '3班'), state.repState, false);
	assert.deepEqual(checksOf('役地区', '3班'), { 0: false, 1: true }, 'District file: the replaced entry roster is the source, not the first named entry (2班)');

	fresh();
	state.repState.districts.push(
		{ district: '役地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: roleOnly(), szNeighborChecks: {} },
		{ district: '役地区', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X')], szNeighborChecks: { 0: false } },
		{ district: '役地区', han: '3班', hanList: ['3班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'Z')], szNeighborChecks: { 0: true } }
	);
	rep.mergeNeighborDataIntoRep(neighborFile('役地区', [row('会長', 'X'), row('会長', 'Z')]), state.repState, false);
	for (const han of ['1班', '2班', '3班']) assert.deepEqual(checksOf('役地区', han), { 0: false, 1: true }, `Neighborhood file: the first named entry is the source for ${han}`);
});

test('SPEC-Q2: a roster-less district file copying a non-representative entry follows the representative per person', () => {
	fresh();
	state.repState.districts.push(
		{ district: '写地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C')], szNeighborChecks: { 0: true } },
		{ district: '写地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: false, 1: true } }
	);
	rep.upsertRepDistrict(districtFile('写地区', [], '3班'), state.repState, false);
	assert.equal(state.repState.districts[2].neighborhood[0].lastName, 'C', 'The first entry with a roster is copied');
	assert.deepEqual(checksOf('写地区', '3班'), { 0: false }, 'The representative (2班) decides, not the copy source (1班)');

	fresh();
	state.repState.districts.push(
		{ district: '写地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'P'), row('会計', 'R')], szNeighborChecks: { 0: false, 1: true, 2: false } },
		{ district: '写地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', ''), row('副会長', ''), row('書記', ''), row('会計', '')], szNeighborChecks: {} }
	);
	rep.upsertRepDistrict(districtFile('写地区', [], '3班'), state.repState, false);
	assert.deepEqual(checksOf('写地区', '3班'), { 0: false, 2: false }, 'A role-only representative falls back to the copy source: the unchecked C and R are carried, the check of the non-chairman P is not (it cannot be told from an older row-number sync), no automatic checks');

	fresh();
	state.repState.districts.push(
		{ district: '写地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'D')], szNeighborChecks: { 0: true } },
		{ district: '写地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: false, 1: true } }
	);
	rep.upsertRepDistrict(districtFile('写地区', [], '3班'), state.repState, false);
	assert.equal(state.repState.districts[2].neighborhood[0].lastName, 'D', 'The copy source holds a chairman absent from the representative');
	assert.deepEqual(checksOf('写地区', '3班'), {}, 'A copied chairman unknown to the representative is not checked automatically');
});

test('SPEC-Q2: a district file shrinking the representative entry never brings back a cleared chairman through another entry', () => {
	fresh();
	state.repState.districts.push(
		{ district: 'A', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('書記', 'Z'), row('会計', 'W'), row('会長', 'C')], szNeighborChecks: { 2: true } },
		{ district: 'A', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'Z'), row('副会長', 'V')], szNeighborChecks: { 0: true, 1: true, 2: false } }
	);
	rep.toggleSzNeighbor(0, 2, false);
	assert.deepEqual(checksOf('A', '2班'), { 0: false, 1: true, 2: false }, 'The selector syncs the cleared C to C in 2班');
	legacyRowSync(0, 2, false);
	state.repState.districts[1].szNeighborChecks[0] = true;
	assert.deepEqual(checksOf('A', '2班'), { 0: true, 1: true, 2: false }, 'Data saved by an older row-number sync left C (and a stale Z) checked in 2班');
	rep.upsertRepDistrict(districtFile('A', [row('会長', 'C')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: false });
	assert.deepEqual(checksOf('A', '2班'), { 0: false }, 'C aligned to the representative; the stale Z (no key there) and the unmatched V are not attending');
	assert.deepEqual(selectorChecks(), ['☐会長：C', '☐書記：Z', '☐副会長：V'], 'The new representative (2班) does not show the cleared chairman');
	assert.deepEqual(seatNeighbors(), []);
	assert.deepEqual(printedNeighbors('A'), [], 'Print does not bring back the cleared chairman');

	const id = (role, name) => seat.neighborIdentity(row(role, name));
	const untouched = { district: 'B', neighborhood: [row('会長', 'Q')] };
	seat.alignNeighborChecksToGroup(untouched, [{ identities: [id('会長', 'R')], checks: { 0: true } }]);
	assert.equal(Object.hasOwn(untouched, 'szNeighborChecks'), false, 'No change keeps the check object undefined');
	const dup = { district: 'B', neighborhood: [row('会長', 'Q'), row('会長', 'Q')], szNeighborChecks: { 0: true } };
	seat.alignNeighborChecksToGroup(dup, [{ identities: [id('会長', 'Q')], checks: {} }]);
	assert.deepEqual(dup.szNeighborChecks, {}, 'Duplicated rows are not attending');
	const noChecks = { district: 'B', neighborhood: [row('会長', 'Q')] };
	seat.alignNeighborChecksToGroup(noChecks, [{ identities: [id('会長', 'Q')] }]);
	assert.equal(Object.hasOwn(noChecks, 'szNeighborChecks'), false, 'A group without checks and no key changes nothing');
	const ordered = { district: 'B', neighborhood: [row('会長', 'Q'), row('書記', 'S')], szNeighborChecks: { 0: true, 1: true } };
	seat.alignNeighborChecksToGroup(ordered, [null, 'x', { identities: [id('', '')], checks: { 0: true } }, { identities: [id('会長', 'Q'), id('会長', 'Q')], checks: { 0: true } }, { identities: [id('会長', 'Q')], checks: { 0: false } }]);
	assert.deepEqual(ordered.szNeighborChecks, { 0: false }, 'Unusable and ambiguous sources are skipped; the first unique match decides; unmatched rows are not attending');
	const none = { district: 'B', neighborhood: [row('会長', 'Q')], szNeighborChecks: { 0: true } };
	seat.alignNeighborChecksToGroup(none, 'sources');
	seat.alignNeighborChecksToGroup(none, [{ identities: [id('会長', '')], checks: {} }]);
	assert.deepEqual(none.szNeighborChecks, {}, 'Without a usable source nobody is attending');
	const nameless = { district: 'B', neighborhood: [row('会長', ''), row('書記', 'S')], szNeighborChecks: { 0: true, 1: true } };
	seat.alignNeighborChecksToGroup(nameless, [{ identities: [id('会長', ''), id('書記', '')], checks: { 0: true } }], { clearDuplicatesOf: [id('書記', 'S'), id('書記', 'S')] });
	assert.deepEqual(nameless.szNeighborChecks, {}, 'Without a usable source the nameless row and the named row are not attending');
	const blanks = { district: 'B', neighborhood: [row('会長', ''), row('会長', ''), row('副会長', ''), row('書記', 'S'), row('会計', 'T')], szNeighborChecks: { 0: true, 1: true, 2: false, 3: true } };
	seat.alignNeighborChecksToGroup(blanks, [{ identities: [id('副会長', ''), id('会計', 'T'), id('書記', 'U')], checks: { 0: true, 1: true } }]);
	assert.deepEqual(blanks.szNeighborChecks, { 4: true }, 'Nameless rows (duplicated, unique, and matching a checked nameless source row) and the unmatched S are not attending; T is aligned');
	const noSourceChecks = { district: 'B', neighborhood: [row('会長', 'Q')], szNeighborChecks: { 0: true } };
	seat.alignNeighborChecksToGroup(noSourceChecks, [{ identities: [id('会長', 'Q')] }]);
	assert.deepEqual(noSourceChecks.szNeighborChecks, {}, 'A source without checks clears the matched row');
	for (const sources of ['sources', null, [null, 'x', 3], [{ identities: [id('会長', '')], checks: { 0: true } }]]) {
		const target = { district: 'B', neighborhood: [row('会長', ''), row('書記', 'S')], szNeighborChecks: { 0: true, 1: true } };
		seat.alignNeighborChecksToGroup(target, sources);
		assert.deepEqual(target.szNeighborChecks, {}, `${JSON.stringify(sources)}: nobody is attending without a usable source`);
	}
	const firstDecides = { district: 'B', neighborhood: [row('会長', 'Q')], szNeighborChecks: { 0: true } };
	seat.alignNeighborChecksToGroup(firstDecides, [{ identities: [id('会長', 'Q')], checks: {} }, { identities: [id('会長', 'Q')], checks: { 0: true } }]);
	assert.deepEqual(firstDecides.szNeighborChecks, {}, 'The first source with a unique match decides even without a key; later sources are not used');
	const inheritedSource = { district: 'B', neighborhood: [row('会長', 'Q')], szNeighborChecks: { 0: true } };
	seat.alignNeighborChecksToGroup(inheritedSource, [{ identities: [id('会長', 'Q')], checks: Object.create({ 0: true }) }]);
	assert.deepEqual(inheritedSource.szNeighborChecks, {}, 'An inherited key of the source is not used');
	const blankUndefined = { district: 'B', neighborhood: [row('会長', '')] };
	seat.alignNeighborChecksToGroup(blankUndefined, [{ identities: [id('会長', 'Q')], checks: {} }]);
	seat.alignNeighborChecksToGroup(blankUndefined, []);
	assert.equal(Object.hasOwn(blankUndefined, 'szNeighborChecks'), false, 'Nothing to clear keeps the check object undefined');
	const noRows = { district: 'B', szNeighborChecks: { 3: true } };
	seat.alignNeighborChecksToGroup(noRows, [{ identities: [id('会長', 'Q')], checks: {} }]);
	assert.deepEqual(noRows.szNeighborChecks, {}, 'An entry without a roster keeps no key');
	const cleared = { district: 'B', neighborhood: [row('会長', 'Q'), row('書記', 'S')], szNeighborChecks: { 0: true, 1: true } };
	seat.alignNeighborChecksToGroup(cleared, [{ identities: [id('会長', 'Q'), id('書記', 'S')], checks: { 0: true, 1: true } }], { clearDuplicatesOf: [id('会長', 'Q'), id('会長', 'Q'), id('書記', 'S')] });
	assert.deepEqual(cleared.szNeighborChecks, { 1: true }, 'A person duplicated in the imported roster is not attending; S, listed once, is aligned');
	seat.alignNeighborChecksToGroup(cleared, [{ identities: [id('会長', 'Q'), id('書記', 'S')], checks: { 0: true, 1: true } }], { clearDuplicatesOf: 'x' });
	assert.deepEqual(cleared.szNeighborChecks, { 0: true, 1: true }, 'A non-array option is ignored');
	assert.equal(seat.hasNamedNeighborIdentity('not json'), false);
});

test('SPEC-Q2: a nameless slot of a non-replaced same-name entry never becomes attending through a district file import, whichever entry is printed', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	for (const unselectFirst of [true, false]) {
		fresh();
		state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', '鈴木')], { 0: true }), entry('2班', [row('会長', '')], {}));
		if (unselectFirst) seat.setDistrictPrintSelection(0, false);
		rep.upsertRepDistrict(districtFile('A', [row('会長', ''), row('副会長', '鈴木')], '1班'), state.repState, false);
		assert.deepEqual(checksOf('A', '1班'), {}, `${unselectFirst}: the replaced entry keeps no check on the nameless slot`);
		assert.deepEqual(checksOf('A', '2班'), {}, `${unselectFirst}: the nameless slot of 2班 is not aligned to the old nameless check`);
		if (!unselectFirst) seat.setDistrictPrintSelection(state.repState.districts.findIndex(d => d.han === '1班'), false);
		assert.equal(state.repState.districts.find(d => d.han === '1班').selectedForPrint, false, 'Print and seats come from 2班 only');
		assert.deepEqual(checksOf('A', '2班'), {});
		assert.deepEqual(selectorChecks().filter(label => label.startsWith('☑')), [], 'The selector shows no attending neighbor');
		assert.deepEqual(seatNeighbors(), [], 'No nameless neighbor seat');
		assert.deepEqual(printedNeighbors('A'), [], 'No nameless name tag');
	}
});

test('SPEC-Q2: old checks on nameless slots of other same-name entries are cleared by a district file import, also with no usable roster to align to', async () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'K'), row('副会長', '鈴木'), row('書記', 'M')], { 0: true }), entry('2班', [row('会長', ''), row('会長', ''), row('書記', 'M')], { 0: true, 1: true, 2: true }));
	rep.upsertRepDistrict(districtFile('A', [row('会長', 'K'), row('副会長', '鈴木'), row('書記', 'M')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: true });
	assert.deepEqual(checksOf('A', '2班'), {}, 'Duplicated nameless slots are cleared; the named M is aligned to the representative (no key)');

	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.districts.push(entry('1班', [row('会長', '')], { 0: true }), entry('2班', [row('会長', ''), row('書記', '')], { 0: true, 1: false }));
	assert.equal(await saveRepLocal(), true);
	await importFiles([districtFile('A', [row('会長', ''), row('副会長', '')], '1班')]);
	assert.ok(dialogs.alerts.every(message => !message.includes('失敗')), JSON.stringify(dialogs.alerts));
	assert.deepEqual(checksOf('A', '1班'), {}, 'No named row anywhere: nobody is attending');
	assert.deepEqual(checksOf('A', '2班'), {}, 'Nameless slots of 2班 are cleared although there is no roster to align to');
	assert.deepEqual(seatNeighbors(), []);
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	await app.loadAppDataFromStorage();
	assert.deepEqual(checksOf('A', '2班'), {}, 'The cleared attendance is stored');
});

test('SPEC-Q2: a seat assigned to a nameless attending neighbor of a printed non-replaced entry is released after the alignment', () => {
	const entry = (han, rows, checks, selectedForPrint = true) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', '鈴木')], { 0: true }, false), entry('2班', [row('会長', '')], { 0: true }));
	const nameless = seat.getAllSzParticipantsForSeat().filter(person => person.key.startsWith('NEI_'));
	assert.equal(nameless.length, 1, 'Control: before the import the nameless slot of the printed 2班 is a seat option');
	state.repState.seatConfig.cells['0_0'] = { refKey: nameless[0].key, customText: '' };
	assert.match(print.buildSzSeatChartPageHtml(), /（ご出席者 様）/, 'Control: the seat chart shows the nameless attendee');
	rep.upsertRepDistrict(districtFile('A', [row('会長', ''), row('副会長', '鈴木')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '2班'), {});
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'The seat is released by the remap after the alignment');
	assert.doesNotMatch(print.buildSzSeatChartPageHtml(), /ご出席者/);
});

test('SPEC-Q2: roster-less district files keep old checks on nameless slots for an own copy and rebuild same-name entries for a copy from another entry', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', '鈴木')], { 0: true }), entry('2班', [row('会長', '')], { 0: true }));
	rep.upsertRepDistrict(districtFile('A', [], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: true }, 'Own copy: the attendance of the own entry is unchanged');
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, 'Own copy: other same-name entries are unchanged');
	rep.upsertRepDistrict(districtFile('A', [], '3班'), state.repState, false);
	assert.equal(state.repState.districts.find(d => d.han === '3班').neighborhood.length, 2, 'The roster of 1班 is copied');
	assert.deepEqual(checksOf('A', '3班'), {}, 'Copied from another entry: per-person carry, the nameless slot is not attending');
	assert.deepEqual(checksOf('A', '1班'), {}, 'Copy from another entry: the source entry is rebuilt per person and its old nameless true is cleared');
	assert.deepEqual(checksOf('A', '2班'), {}, 'Copy from another entry: other same-name entries are rebuilt per person');
});

test('SPEC-Q1: the attendance selector syncs only the same person to other same-name entries, never another person or a nameless slot by row number', () => {
	const entry = (han, rows, checks, selectedForPrint = true) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'Y'), row('副会長', 'B'), row('書記', 'P'), row('監事', 'Z'), row('顧問', 'W')], {}, false), entry('2班', [row('会長', ''), row('副会長', 'B'), row('会計', 'Q'), row('書記', 'P')], {}));
	const checked = () => selectorChecks().filter(label => label.startsWith('☑'));
	assert.deepEqual(selectorChecks(), ['☐会長：Y', '☐副会長：B', '☐書記：P', '☐監事：Z', '☐顧問：W'], 'Control: the selector shows 1班 (the representative, not printed)');
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual(checksOf('A', '1班'), { 0: true });
	assert.deepEqual(checksOf('A', '2班'), {}, 'The nameless slot at the same row number is not checked');
	assert.deepEqual(checked(), ['☑会長：Y']);
	assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [[], []], 'Seats and print from the printed 2班 have no nameless neighbor (Y is not in 2班)');
	rep.toggleSzNeighbor(0, 1, true);
	rep.toggleSzNeighbor(0, 2, true);
	assert.deepEqual(checksOf('A', '2班'), { 1: true, 3: true }, 'B and P are synced to their own rows; Q at the row number of P is not touched');
	assert.deepEqual(checked(), ['☑会長：Y', '☑副会長：B', '☑書記：P']);
	assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [['B', 'P'], ['B', 'P']], 'Seats and print show the people checked in the selector; Q and the nameless slot do not appear');
	rep.toggleSzNeighbor(0, 2, false);
	assert.deepEqual(checksOf('A', '2班'), { 1: true, 3: false });
	assert.deepEqual([checked(), seatNeighbors()], [['☑会長：Y', '☑副会長：B'], ['B']]);

	fresh();
	state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', 'B')], {}), entry('2班', [row('会長', '')], {}), entry('3班', [row('副会長', '')], {}));
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, 'The same nameless slot is synced, as the per-person reconcile does');
	assert.deepEqual(checksOf('A', '3班'), {}, 'A nameless slot with another role is not');

	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'Y'), row('会長', 'Y'), row('副会長', 'B')], {}), entry('2班', [row('会長', 'Y'), row('副会長', 'B'), row('副会長', 'B')], {}), { ...entry('3班', [], {}), neighborhood: undefined, szNeighborChecks: undefined });
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: true }, {}], 'A person duplicated in the operated entry is not synced');
	rep.toggleSzNeighbor(0, 2, true);
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: true, 2: true }, {}], 'A person duplicated in the target entry is not synced');
	rep.toggleSzNeighbor(0, 5, true);
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: true, 2: true, 5: true }, {}], 'An index without a row changes only the operated entry');
	assert.equal(checksOf('A', '3班'), undefined, 'An entry without a roster is not touched');
	delete state.repState.districts[0].neighborhood;
	rep.toggleSzNeighbor(0, 1, false);
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: true, 1: false, 2: true, 5: true }, {}], 'An operated entry without a roster syncs nothing');
	rep.toggleSzNeighbor(1, 0, false);
	assert.deepEqual(checksOf('A', '2班'), { 0: false });

	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'Y')], {}), entry('2班', [row('会長', 'Y'), row('副会長', 'B')], {}));
	rep.toggleSzNeighbor(0, 3, true);
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 3: true }, {}], 'An index without a row syncs nothing to a different roster, even when the operated entry has another unique row');

	fresh();
	state.repState.districts.push(entry('1班', [row('会長', ''), row('会長', ''), row('副会長', 'B')], {}, false), entry('2班', [row('会長', ''), row('会長', ''), row('副会長', 'B')], {}), entry('3班', [row('会長', 'Y')], {}), { ...entry('4班', [], {}), neighborhood: undefined, szNeighborChecks: undefined });
	rep.toggleSzNeighbor(0, 1, true);
	assert.deepEqual(checksOf('A', '2班'), { 1: true }, 'An identical roster is synced by row number, including a duplicated row (unchanged behavior)');
	assert.deepEqual(seat.getAllSzParticipantsForSeat().filter(person => person.key.startsWith('NEI_')).length, 1, 'The checked duplicated slot of the printed identical 2班 is a seat option');
	rep.toggleSzNeighbor(0, 7, true);
	assert.deepEqual([checksOf('A', '2班'), checksOf('A', '3班'), checksOf('A', '4班')], [{ 1: true, 7: true }, {}, undefined], 'An index without a row is synced to an identical roster only');
	delete state.repState.districts[0].neighborhood;
	state.repState.districts[1].neighborhood = [];
	rep.toggleSzNeighbor(0, 0, false);
	assert.deepEqual([checksOf('A', '2班'), checksOf('A', '4班')], [{ 0: false, 1: true, 7: true }, { 0: false }], 'Entries without a roster are identical rosters and are synced by row number (unchanged behavior)');

	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'C'), row('副会長', 'P')], {}), entry('2班', [row('副会長', 'P'), row('会長', 'C')], {}));
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual(checksOf('A', '2班'), { 1: true }, 'The same rows in another order are a different roster: C is synced to its own row, not by row number');
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'C', { address: 'x' }), row('副会長', 'P')], {}), entry('2班', [row('会長', 'C', { address: 'y' }), row('副会長', 'P')], {}));
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual(checksOf('A', '2班'), {}, 'C with another address is another person and another roster: nothing is synced by row number');
	rep.toggleSzNeighbor(0, 1, true);
	assert.deepEqual(checksOf('A', '2班'), { 1: true }, 'The same P is synced');
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', 'B')], {}), entry('2班', [row('副会長', ''), row('副会長', 'B')], {}));
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual(checksOf('A', '2班'), {}, 'Rows with the same names but another role are a different roster: the nameless 副会長 slot is not checked');
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'C'), row('副会長', 'P')], {}, false), { ...entry('2班', [row('会長', 'C')], {}), district: 'A ' });
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual(state.repState.districts[1].szNeighborChecks, { 0: true }, 'A district name with surrounding spaces is the same district');
	assert.deepEqual(seatNeighbors(), ['C'], 'Seats from the printed entry follow the selector');
	assert.ok(print.buildSzTentCardsPagesHtml(state.repState.districts.filter(d => d.selectedForPrint)).some(page => page.includes('<span class="tent-name">C</span>')), 'The name tag of C is printed');

	fresh();
	state.repState.districts.push({ ...entry('', [row('会長', 'Y')], {}), district: '' }, { ...entry('', [row('会長', 'Y')], {}), district: '  ' });
	rep.toggleSzNeighbor(0, 0, true);
	assert.deepEqual([state.repState.districts[0].szNeighborChecks, state.repState.districts[1].szNeighborChecks], [{ 0: true }, {}], 'Entries without a district name are not synced');
});

test('SPEC-Q2: pasted district data follows the district file rules for nameless slots and roster-less data', async () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', '鈴木')], { 0: true }), entry('2班', [row('会長', '')], { 0: true }));
	assert.equal(await saveRepLocal(), true);
	const paste = async model => {
		document.getElementById('rep-pass').value = PASSWORD;
		document.getElementById('rep-paste-box').value = await cryptoLib.encryptPayload(JSON.stringify(model), PASSWORD);
		await rep.loadPastedTextToRep();
	};
	await paste(districtFile('A', [], '1班'));
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: true }, { 0: true }], 'Roster-less pasted data changes no attendance');
	await paste(districtFile('A', [row('会長', ''), row('副会長', '鈴木')], '1班'));
	assert.ok(dialogs.alerts.every(message => !message.includes('失敗')), JSON.stringify(dialogs.alerts));
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{}, {}], 'Pasted roster: nameless slots are not attending in any same-name entry');
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	await app.loadAppDataFromStorage();
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{}, {}], 'Stored');
});

test('SPEC-Q2: duplicated named rows of a non-replaced same-name entry are not attending after a district file import', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	for (const [label, importedRows] of [
		['Q unique in the representative and imported rosters', [row('会長', 'Q'), row('書記', 'S')]],
		['Q duplicated in the imported roster', [row('会長', 'Q'), row('会長', 'Q'), row('書記', 'S')]]
	]) {
		fresh();
		state.repState.districts.push(entry('1班', [row('会長', 'Q'), row('書記', 'S'), row('会計', 'T')], { 0: true }), entry('2班', [row('会長', 'Q'), row('会長', 'Q'), row('書記', 'S')], { 0: true, 1: false, 2: true }));
		rep.upsertRepDistrict(districtFile('A', importedRows, '1班'), state.repState, false);
		assert.deepEqual(checksOf('A', '2班'), {}, `${label}: the duplicated Q rows (true and false) are not attending; the unique S is aligned to the representative (no key)`);
	}
});

test('SPEC-Q2: when the representative roster has no names, other same-name entries are aligned to the imported roster only', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', '')], {}), entry('2班', [row('会長', 'X'), row('書記', 'R')], { 0: false, 1: true }));
	rep.upsertRepDistrict(districtFile('A', [row('会長', 'X'), row('書記', 'R2')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: true }, 'No named row before the import: the chairman X is checked as a new roster');
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, 'X is aligned to the imported roster; R matches neither and is not attending');
	const id = (role, name) => seat.neighborIdentity(row(role, name));
	const partial = { district: 'A', neighborhood: [row('会長', 'X'), row('会長', '')], szNeighborChecks: { 1: true } };
	seat.alignNeighborChecksToGroup(partial, [{ identities: [id('会長', ''), id('副会長', '')], checks: { 0: false } }, { identities: [id('会長', 'X')], checks: { 0: true } }]);
	assert.deepEqual(partial.szNeighborChecks, { 0: true }, 'The nameless source is skipped and the remaining source aligns X');
});

test('SPEC-Q2: a value saved by an older row-number sync on another person is not attending after an import makes that entry the representative', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', '山田'), row('副会長', '佐藤'), row('会計', '鈴木')], { 0: true }), entry('2班', [row('会長', '田中'), row('副会長', '高橋')], {}));
	rep.toggleSzNeighbor(0, 1, true);
	assert.deepEqual(checksOf('A', '2班'), {}, 'The selector does not sync 佐藤 to 高橋');
	legacyRowSync(0, 1, true);
	assert.deepEqual(checksOf('A', '2班'), { 1: true }, 'Control: data saved by an older row-number sync has true on 高橋');
	rep.upsertRepDistrict(districtFile('A', [row('会長', '山田')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: true });
	assert.deepEqual(checksOf('A', '2班'), {}, 'Rebuilt per person: 田中 and 高橋 match neither roster');
	assert.deepEqual(selectorChecks(), ['☐会長：田中', '☐副会長：高橋'], '2班 is now the representative and shows nobody the user did not check');
	assert.deepEqual(seatNeighbors(), []);
	assert.deepEqual(printedNeighbors('A'), []);
});

test('SPEC-Q2: adding this device district without a roster keeps other entries for an own copy and rebuilds them for a copy from another entry', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'K'), row('副会長', '')], { 0: false, 1: true }), entry('2班', [row('会長', 'X'), row('会長', '')], { 0: true, 1: true }));
	state.currentDistrict = districtFile('A', [], '1班');
	renderDistrictForm();
	rep.addCurrentDistrictToRep();
	assert.equal(state.repState.districts.find(d => d.han === '1班').neighborhood.length, 2, 'The own roster is protected');
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: false, 1: true }, { 0: true, 1: true }], 'Own copy: attendance unchanged and no alignment of other entries');
	state.currentDistrict = districtFile('A', [], '3班');
	renderDistrictForm();
	rep.addCurrentDistrictToRep();
	assert.equal(state.repState.districts.find(d => d.han === '3班').neighborhood.length, 2, 'The roster of 1班 is copied');
	assert.deepEqual(checksOf('A', '3班'), { 0: false }, 'Copied from another entry: per-person carry of the representative, no automatic chairman check, the nameless slot is not attending');
	assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: false }, {}], 'Copy from another entry: other entries (including the source) are rebuilt per person');
});

test('SPEC-Q2: re-submitting the representative 班 without a roster never shows stale or nameless values when another entry becomes the representative', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	const checked = () => selectorChecks().filter(label => label.startsWith('☑'));
	for (const via of ['file', 'own district']) {
		const resubmit = han => {
			if (via === 'file') return rep.upsertRepDistrict(districtFile('A', [], han), state.repState, false);
			state.currentDistrict = districtFile('A', [], han);
			renderDistrictForm();
			return rep.addCurrentDistrictToRep();
		};
		fresh();
		state.repState.districts.push(entry('1班', [row('会長', 'P'), row('副会長', 'Q')], { 0: true }), entry('2班', [row('書記', 'Y'), row('会長', 'P'), row('副会長', 'Q')], { 1: true }));
		rep.toggleSzNeighbor(1, 1, false);
		rep.toggleSzNeighbor(1, 0, true);
		assert.deepEqual(checksOf('A', '1班'), { 0: false }, `${via}: the selector syncs P to P in 1班 only`);
		legacyRowSync(1, 1, false);
		legacyRowSync(1, 0, true);
		assert.deepEqual(checksOf('A', '1班'), { 0: true, 1: false }, `${via}: control: data saved by an older row-number sync has P checked in 1班`);
		resubmit('2班');
		assert.equal(state.repState.districts[1].neighborhood.length, 2, `${via}: the representative roster shrinks to the protected copy`);
		assert.deepEqual(selectorChecks(), ['☐会長：P', '☐副会長：Q'], `${via}: the source (same size, earlier) is the representative and the user-cleared P is not attending`);
		assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [[], []]);

		fresh();
		state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', 'P')], { 0: true }), entry('2班', [row('副会長', 'P'), row('会計', 'Q'), row('書記', 'Y')], { 0: true }));
		resubmit('2班');
		assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 1: true }, { 1: true }], `${via}: the old nameless true is cleared and the checked P stays attending`);
		assert.deepEqual(checked(), ['☑副会長：P']);
		assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [['P'], ['P']], `${via}: no nameless neighbor seat or name tag`);

		fresh();
		state.repState.districts.push(entry('1班', [row('会長', 'P')], {}), entry('3班', [row('副会長', 'Q'), row('会長', 'P'), row('会計', 'W')], {}), entry('2班', [row('会長', 'P'), row('副会長', 'Q'), row('書記', 'Y'), row('会計', 'Z')], {}));
		rep.toggleSzNeighbor(2, 0, true);
		rep.toggleSzNeighbor(2, 1, false);
		assert.deepEqual(checksOf('A', '3班'), { 0: false, 1: true }, `${via}: the selector syncs P and Q to their own rows in 3班`);
		legacyRowSync(2, 0, true);
		legacyRowSync(2, 1, false);
		assert.deepEqual(checksOf('A', '3班'), { 0: true, 1: false }, `${via}: control: data saved by an older row-number sync has Q true and P false in 3班`);
		resubmit('2班');
		assert.deepEqual(selectorChecks(), ['☐副会長：Q', '☑会長：P', '☐会計：W'], `${via}: a third entry becomes the representative with the user settings per person`);
		assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [['P'], ['P']]);
	}
});

test('SPEC-Q2: with a representative of nameless slots only, the selector never puts attendance on another person, through any later import', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	for (const [label, apply] of [
		['(a) a district file makes 2班 the representative', () => rep.upsertRepDistrict(districtFile('A', [row('書記', 'S'), row('会長', 'K'), row('会計', 'T'), row('副会長', 'U')], '2班'), state.repState, false)],
		['(b) the representative resubmitted without a roster shrinks to the copy of 2班 (the chairman K is carried from the fallback)', () => rep.upsertRepDistrict(districtFile('A', [], '1班'), state.repState, false)],
		['(c) a neighborhood file', () => rep.mergeNeighborDataIntoRep(neighborFile('A', [row('書記', 'S'), row('会長', 'K'), row('会計', 'T')]), state.repState, false)]
	]) {
		fresh();
		state.repState.districts.push(entry('2班', [row('書記', 'S'), row('会長', 'K')], { 1: true }), entry('1班', [row('会長', ''), row('副会長', ''), row('会計', '')], {}));
		rep.toggleSzNeighbor(1, 0, true);
		assert.deepEqual([checksOf('A', '1班'), checksOf('A', '2班')], [{ 0: true }, { 1: true }], `${label}: operating the nameless chairman slot does not sync to S at the same row number`);
		apply();
		assert.deepEqual(selectorChecks().filter(label => label.startsWith('☑')), ['☑会長：K'], `${label}: S is not attending`);
		assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [['K'], ['K']], label);
	}
});

test('SPEC-Q2: a roster-less new 班 copies another roster without changing the representative and rebuilds the other entries', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'Z'), row('書記', 'M'), row('副会長', '')], { 0: true, 2: true }), entry('2班', [row('会長', 'K'), row('書記', 'M'), row('会計', 'X'), row('副会長', 'Y')], { 0: false, 1: true }));
	rep.upsertRepDistrict(districtFile('A', [], '5班'), state.repState, false);
	assert.equal(state.repState.districts.find(d => d.han === '5班').neighborhood.length, 3, 'The roster of the first entry with a roster is copied');
	assert.deepEqual(checksOf('A', '5班'), { 1: true }, 'The new entry carries M per person and does not auto-check the chairman Z');
	assert.deepEqual(checksOf('A', '1班'), { 1: true }, 'The source is rebuilt: the stale Z and the old nameless true are cleared');
	assert.deepEqual(checksOf('A', '2班'), { 0: false, 1: true }, 'The representative keeps the user settings');
	assert.deepEqual(selectorChecks().filter(label => label.startsWith('☑')), ['☑書記：M'], 'The representative (2班) does not change');

	fresh();
	state.repState.districts.push(entry('2班', [row('会長', 'P'), row('会長', 'P')], {}), entry('3班', [row('会長', 'P'), row('副会長', 'B'), row('書記', 'W')], { 0: true }));
	rep.upsertRepDistrict(districtFile('A', [], '4班'), state.repState, false);
	assert.deepEqual(checksOf('A', '4班'), {}, 'The duplicated P of the copied roster has no key in the new entry');
	assert.deepEqual(checksOf('A', '3班'), { 0: true }, 'P stays attending in the representative: duplicates of the copied roster are not imported duplicates');
	assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [['P'], ['P']]);
});

test('SPEC-Q2: a fallback comparison source carries false and chairman values but not the true of other people', () => {
	const rows = [row('会長', 'K'), row('書記', 'S'), row('会計', 'R')];
	const candidate = seat.neighborCheckCandidate({ neighborhood: rows, szNeighborChecks: { 0: true, 1: true, 2: false } });
	const nameless = seat.neighborCheckCandidate({ neighborhood: [row('会長', '')], szNeighborChecks: { 0: true } });
	assert.deepEqual(seat.resolveImportedNeighborChecks(rows, [candidate]), { 0: true, 1: true, 2: false }, 'The representative group (first candidate) carries every value');
	for (const first of [null, 'x', nameless]) {
		for (const options of [{}, { chairmanDefaults: false }]) {
			assert.deepEqual(seat.resolveImportedNeighborChecks(rows, [first, candidate], options), { 0: true, 2: false }, `${JSON.stringify(first)} ${JSON.stringify(options)}: a later candidate is a fallback`);
		}
	}
});

test('SPEC-Q2: with a representative of nameless slots only, an old row-number synced true of a non-chairman in the fallback source never attends after any import', () => {
	const entry = (han, rows, checks, selectedForPrint = true) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint, neighborhood: rows, szNeighborChecks: checks });
	const roster = [row('会長', 'K'), row('書記', 'S'), row('会計', 'R')];
	for (const [label, apply] of [
		['district file (B becomes the representative)', () => rep.upsertRepDistrict(districtFile('A', [...roster, row('副会長', 'T')], '2班'), state.repState, false)],
		['neighborhood file', () => rep.mergeNeighborDataIntoRep(neighborFile('A', roster), state.repState, false)],
		['roster-less file copying B', () => rep.upsertRepDistrict(districtFile('A', [], '1班'), state.repState, false)]
	]) {
		fresh();
		state.repState.districts.push(entry('2班', roster.map(r => ({ ...r })), { 0: true, 1: true, 2: false }), entry('1班', [row('会長', ''), row('副会長', ''), row('書記', ''), row('会計', '')], {}, false));
		assert.deepEqual(selectorChecks(), ['☐会長：（氏名未定）', '☐副会長：（氏名未定）', '☐書記：（氏名未定）', '☐会計：（氏名未定）'], `${label}: control: the nameless 1班 is the representative`);
		apply();
		assert.deepEqual(selectorChecks().filter(item => item.startsWith('☑')), ['☑会長：K'], `${label}: the old true of S is not carried; the chairman K is`);
		assert.deepEqual([seatNeighbors(), printedNeighbors('A')], [['K'], ['K']], `${label}: print and seats from the printed 2班`);
		assert.equal(checksOf('A', '2班')[2], false, `${label}: the false of R stays unchecked`);
	}
});

test('SPEC-Q2: a district file adding a new 班 while the representative has no named row follows the rules for a new roster', () => {
	const entry = (han, rows, checks) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows, szNeighborChecks: checks });
	const setup = () => {
		fresh();
		state.repState.districts.push(entry('1班', [row('会長', ''), row('副会長', ''), row('書記', '')], {}), entry('2班', [row('会長', 'X')], { 0: false }));
	};
	setup();
	rep.upsertRepDistrict(districtFile('A', [row('書記', 'S'), row('会計', 'T')], '3班'), state.repState, false);
	assert.deepEqual(checksOf('A', '3班'), { 0: true }, 'No replaced entry and no named representative row: the first named row is checked (not compared with 2班)');
	setup();
	rep.upsertRepDistrict(districtFile('A', [row('会長', 'X'), row('書記', 'S')], '3班'), state.repState, false);
	assert.deepEqual(checksOf('A', '3班'), { 0: true }, 'The chairman X of the new roster is checked; the false of X in 2班 is not a comparison source');
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, '2班 is rebuilt to the imported attendance of X');
});

test('SPEC-Q2: a new chairman also listed in a non-replaced same-name entry is attending in the selector, print and seats', () => {
	const setup = () => {
		fresh();
		state.repState.districts.push(
			{ district: 'A', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'Y'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true } },
			{ district: 'A', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X'), row('書記', 'R')], szNeighborChecks: { 0: true } }
		);
		rep.toggleSzNeighbor(0, 0, false);
		assert.deepEqual(checksOf('A', '2班'), { 0: true }, 'The selector does not sync Y to X');
		legacyRowSync(0, 0, false);
		assert.deepEqual(checksOf('A', '2班'), { 0: false }, 'X in 2班 has the stale value saved by an older row-number sync');
	};
	setup();
	seat.setDistrictPrintSelection(0, false);
	rep.upsertRepDistrict(districtFile('A', [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: true }, 'The new chairman X is checked');
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, '(a) 2班 is aligned to the imported attendance of X');
	assert.deepEqual(selectorChecks(), ['☑会長：X', '☐書記：P', '☐会計：Q']);
	assert.deepEqual(seatNeighbors(), ['X'], '(a) Seat candidates from the print-selected 2班 include X');
	assert.deepEqual(printedNeighbors('A'), ['X'], '(a) Print from 2班 includes X');

	setup();
	rep.upsertRepDistrict(districtFile('A', [row('会長', 'X')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, '(b) 2班 becomes the representative and shows X attending');
	assert.deepEqual(selectorChecks(), ['☑会長：X', '☐書記：R']);
	assert.deepEqual(seatNeighbors(), ['X']);
	assert.deepEqual(printedNeighbors('A'), ['X'], '(b) Print includes X');
});

test('SPEC-Q2: a person duplicated in the imported roster is not attending in other same-name entries, and roster-less own copies align nothing', () => {
	fresh();
	state.repState.districts.push(
		{ district: 'A', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true, 1: true } },
		{ district: 'A', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('書記', 'P')], szNeighborChecks: { 0: true } }
	);
	seat.setDistrictPrintSelection(0, false);
	rep.upsertRepDistrict(districtFile('A', [row('会長', 'C'), row('書記', 'P'), row('書記', 'P'), row('会計', 'Q')], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: true }, 'The duplicated P has no key in the replaced entry');
	assert.deepEqual(checksOf('A', '2班'), {}, 'P is cleared in the other entry instead of aligned to the old true');
	assert.deepEqual(seatNeighbors(), [], 'Seat candidates from 2班 do not list P');
	assert.deepEqual(selectorChecks(), ['☑会長：C', '☐書記：P', '☐書記：P', '☐会計：Q'], 'The selector shows P unchecked');
	assert.deepEqual(printedNeighbors('A'), [], 'Print from 2班 does not list P');

	fresh();
	state.repState.districts.push(
		{ district: 'A', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'C'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true } },
		{ district: 'A', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会計', 'Q'), row('書記', 'R')], szNeighborChecks: { 0: true } }
	);
	rep.upsertRepDistrict(districtFile('A', [], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, 'Own copy: the stale value of another entry is not touched');
	rep.upsertRepDistrict(districtFile('A', [], '3班'), state.repState, false);
	assert.deepEqual(checksOf('A', '2班'), {}, 'Copy from another entry: other entries are rebuilt per person and the stale Q is cleared');
	assert.deepEqual(checksOf('A', '3班'), { 0: true }, 'The new copy follows the representative per person');
});

test('SPEC-Q2: print and seat candidates use the same per-person attendance when the largest entry is not selected for print', () => {
	fresh();
	rep.upsertRepDistrict(districtFile('印地区', [row('会長', 'C'), row('書記', 'P'), row('会計', 'Q')], '1班'), state.repState, false);
	rep.toggleSzNeighbor(0, 0, false);
	rep.toggleSzNeighbor(0, 1, true);
	rep.upsertRepDistrict(districtFile('印地区', [row('書記', 'P'), row('会長', 'C')], '2班'), state.repState, false);
	assert.deepEqual(checksOf('印地区', '1班'), { 0: false, 1: true });
	assert.deepEqual(checksOf('印地区', '2班'), { 0: true, 1: false }, 'The user settings are carried per person (not the initial rule)');
	state.repState.districts[0].selectedForPrint = false;
	assert.deepEqual(seatNeighbors(), ['P'], 'Seat candidates from the selected entry follow the user settings');
	assert.deepEqual(printedNeighbors('印地区'), ['P'], 'Print from the selected entry follows the user settings');
});

test('SPEC-Q2: imports still remap seat references to the same person and release removed people', () => {
	for (const apply of [
		rows => rep.upsertRepDistrict(districtFile('東地区', rows), state.repState, false),
		rows => rep.mergeNeighborDataIntoRep(neighborFile('東地区', rows), state.repState, false)
	]) {
		fresh();
		state.repState.districts.push({ district: '東地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A'), row('書記', 'B'), row('会計', 'C')], szNeighborChecks: { 0: true, 2: true } });
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' }, '0_1': { refKey: 'NEI_東地区_2', customText: '' } };
		apply([row('書記', 'B'), row('会長', 'A')]);
		assert.deepEqual(checksOf('東地区'), { 1: true }, 'Attendance follows I-13-02');
		assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'NEI_東地区_1', 'The seat follows A to the new row');
		assert.equal(state.repState.seatConfig.cells['0_1'].refKey, '', 'The seat of the removed C is released');
	}
});

test('SPEC-Q2: after an import, a seat follows only the same person (name, role, phone and address) and is released for another or duplicated chairman', async () => {
	const imports = [
		['district file', async rows => rep.upsertRepDistrict(districtFile('東地区', rows), state.repState, false)],
		['neighborhood file', async rows => rep.mergeNeighborDataIntoRep(neighborFile('東地区', rows), state.repState, false)],
		['file import', async rows => { await cryptoLib.setupStorageEncryption(PASSWORD, false); await importFiles([districtFile('東地区', rows)]); }],
		['paste import', async rows => {
			await cryptoLib.setupStorageEncryption(PASSWORD, false);
			document.getElementById('rep-pass').value = PASSWORD;
			document.getElementById('rep-paste-box').value = await cryptoLib.encryptPayload(JSON.stringify(neighborFile('東地区', rows)), PASSWORD);
			await rep.loadPastedTextToRep();
		}],
		['this device district', async rows => { state.currentDistrict = districtFile('東地区', rows); renderDistrictForm(); rep.addCurrentDistrictToRep(); }]
	];
	const A = { tel: '111', address: '1-1' };
	const setup = (neighborhood, checks) => {
		const dialogs = fresh();
		state.repState.districts.push({ district: '東地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood, szNeighborChecks: checks });
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' } };
		return dialogs;
	};
	const seatOf = (cell = '0_0') => state.repState.seatConfig.cells[cell].refKey;
	for (const [via, apply] of imports) {
		for (const [variant, changed] of [['phone', { tel: '222' }], ['address', { address: '2-2' }]]) {
			const dialogs = setup([row('会長', 'A', A), row('書記', 'B')], { 0: true });
			await apply([row('副会長', 'S'), row('会長', 'A', { ...A, ...changed })]);
			assert.ok(dialogs.alerts.every(message => !message.includes('失敗')), `${via}, ${variant}: ${JSON.stringify(dialogs.alerts)}`);
			assert.equal(checksOf('東地区')[1], true, `${via}, ${variant}: the other chairman A is checked as a new chairman`);
			assert.deepEqual(seatNeighbors(), ['A'], `${via}, ${variant}: the new chairman is a seat candidate`);
			assert.equal(seatOf(), '', `${via}, ${variant}: the seat of the old chairman is released, not handed over`);
		}
		setup([row('会長', 'A', A), row('書記', 'B')], { 0: true });
		await apply([row('副会長', 'S'), row('会長', 'A', A)]);
		assert.equal(seatOf(), 'NEI_東地区_1', `${via}: the seat follows the same person to the new row`);
		setup([row('会長', 'A', A), row('書記', 'B')], { 0: true });
		await apply([row('会長', 'A', { ...A, tel: '222' }), row('会長', 'A', A)]);
		assert.deepEqual(seatNeighbors(), ['A', 'A'], `${via}: both chairmen named A attend`);
		assert.equal(seatOf(), 'NEI_東地区_1', `${via}: the seat stays with the old chairman, who is still there`);
		setup([row('会長', 'X', A), row('会長', 'X', A)], { 0: true });
		await apply([row('会長', 'X', A)]);
		assert.deepEqual(seatNeighbors(), ['X'], `${via}: the chairman X of the new roster attends`);
		assert.equal(seatOf(), '', `${via}: a seat of a duplicated row (no identifiable person) is released`);
	}
	// 地区名の前後の空白だけが異なるエントリが取込で座席候補になると、所属の文字列が変わるため、同じ本人でも座席は解除する（旧版と同じ）。
	fresh();
	const 山田1 = row('会長', '山田', A);
	state.repState.districts.push({ district: 'A', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [山田1, row('書記', '佐藤'), row('会計', '鈴木')], szNeighborChecks: { 0: true } });
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
	rep.upsertRepDistrict(districtFile('A ', [山田1, row('書記', '佐藤'), row('会計', '鈴木'), row('理事', '田中')], '2班'), state.repState, false);
	assert.deepEqual(seatNeighbors(), ['山田'], 'The same 山田 of the spaced entry attends');
	assert.equal(state.repState.districts.find(d => d.district === 'A ').szNeighborChecks[0], true, 'The spaced entry is now the seat source');
	assert.equal(seatOf(), '', 'The seat is released when the seat source changes to a spaced district name');
	// 名簿のない取込で自エントリの名簿を写す場合、出席は変わらないが、重複行は本人を特定できないため座席は引き継がない。
	setup([row('会長', 'X', A), row('会長', 'X', A)], { 0: true });
	rep.upsertRepDistrict(districtFile('東地区', []), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 0: true }, 'Own copy: attendance is unchanged');
	assert.deepEqual(seatNeighbors(), ['X'], 'The duplicated row still attends');
	assert.equal(seatOf(), '', 'Own copy: the seat of the duplicated row is released');
	// 氏名・役職が同じで電話の異なる2人の座席は、それぞれの本人に付いたまま移る。
	setup([row('会長', 'A', A), row('会長', 'A', { tel: '222' }), row('書記', 'B')], { 0: true, 1: true });
	state.repState.seatConfig.cells['0_1'] = { refKey: 'NEI_東地区_1', customText: '' };
	rep.upsertRepDistrict(districtFile('東地区', [row('書記', 'B'), row('会長', 'A', { tel: '222' }), row('会長', 'A', A)]), state.repState, false);
	assert.deepEqual(checksOf('東地区'), { 1: true, 2: true }, 'Both chairmen keep their attendance');
	assert.deepEqual([seatOf('0_0'), seatOf('0_1')], ['NEI_東地区_2', 'NEI_東地区_1'], 'Each seat follows its own chairman');
});

test('SPEC-Q2: after an import, the seat matching uses the seat source rosters, also when the representative is not printed', () => {
	const entry = (district, han, neighborhood, checks, selectedForPrint) => ({ district, han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint, neighborhood, szNeighborChecks: checks });
	const 甲 = row('会長', '甲'), 乙 = row('副会長', '乙'), 丁 = row('会計', '丁');
	// (a) 代表名簿（印刷対象外の1班）で重複していても、座席候補のエントリ（2班）で一意な同じ本人が出席していれば引き継ぐ。
	for (const apply of [
		() => rep.upsertRepDistrict(districtFile('X', [甲, 乙], '2班'), state.repState, false),
		() => rep.mergeNeighborDataIntoRep(neighborFile('X', [甲, 乙]), state.repState, false)
	]) {
		fresh();
		state.repState.districts.push(entry('X', '1班', [甲, 甲, 乙], {}, false), entry('X', '2班', [甲, 乙], { 0: true }, true));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_X_0', customText: '' } };
		apply();
		assert.equal(checksOf('X', '2班')[0], true, '甲 is checked as a new chairman (duplicated in the representative)');
		assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'NEI_X_0', 'The same person, unique in the seat source, keeps the seat');
	}
	// (b) 差替え前の座席候補のエントリで重複していた行の座席は、代表名簿と一意に一致して出席になっても解除する。
	fresh();
	state.repState.districts.push(entry('X', '1班', [甲, 乙, 丁], { 0: true }, false), entry('X', '2班', [甲, 甲], { 0: true }, true));
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_X_0', customText: '' } };
	rep.upsertRepDistrict(districtFile('X', [甲, 乙], '2班'), state.repState, false);
	assert.deepEqual(checksOf('X', '2班'), { 0: true }, '甲 is carried from the representative');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'A seat of a row duplicated in the old seat source is released');
	// (c) 取込後の座席候補のエントリで重複したままの行の座席は解除する（出席は残る）。
	fresh();
	state.repState.districts.push(entry('X', '1班', [甲, 乙, 丁], { 0: true }, false), entry('X', '2班', [甲, 甲], { 0: true }, true));
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_X_0', customText: '' } };
	rep.upsertRepDistrict(districtFile('X', [], '1班'), state.repState, false);
	assert.deepEqual(checksOf('X', '2班'), { 0: true }, 'An own-copy import of 1班 changes no attendance');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'The seat of a row still duplicated in the seat source is released');
	// (d) 取込で出席でなくなった本人の座席は解除する（取込後の名簿で重複する本人は別班でも出席なし）。
	fresh();
	state.repState.districts.push(entry('X', '1班', [甲, 乙, 丁], { 0: true }, true));
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_X_0', customText: '' } };
	rep.upsertRepDistrict(districtFile('X', [甲, 甲], '2班'), state.repState, false);
	assert.deepEqual(checksOf('X', '1班'), {}, '甲 duplicated in the imported roster is cleared in 1班');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'The seat of a person who no longer attends is released');
	// (e) 地区名が完全に一致する別班で、作り直しにより出席になった電話の異なる同名の会長へは座席を移さない。
	const 山田1 = row('会長', '山田', { tel: '111' }), 山田2 = row('会長', '山田', { tel: '222' });
	fresh();
	state.repState.districts.push(
		entry('A', '1班', [山田2, row('書記', '佐藤'), row('会計', '鈴木'), row('理事', '田中')], { 0: true }, false),
		entry('A', '2班', [山田2, row('副会長', '中村')], {}, true),
		entry('A', '3班', [山田1, row('理事', '伊藤'), row('理事', '渡辺')], { 0: true }, true)
	);
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
	assert.deepEqual(seatNeighbors(), ['山田'], 'Before: 山田 (111) of 3班 attends');
	rep.upsertRepDistrict(districtFile('A', [row('会計', '佐藤')], '3班'), state.repState, false);
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, '2班 is rebuilt: 山田 (222) matches the representative');
	assert.deepEqual(seatNeighbors(), ['山田'], 'After: 山田 (222) of 2班 attends');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'The seat does not move to another 山田');
	// (f) 地区名の前後の空白だけが異なるエントリでも、電話の異なる同名の会長へは座席を移さない。
	fresh();
	state.repState.districts.push(
		entry('A', '1班', [row('会長', '佐藤'), row('副会長', '鈴木'), row('会計', '田中')], {}, false),
		entry('A ', '2班', [山田1, row('副会長', '中村')], { 0: true }, true)
	);
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A _0', customText: '' } };
	rep.upsertRepDistrict(districtFile('A ', [row('副会長', '中村'), 山田2], '2班'), state.repState, false);
	assert.deepEqual(seatNeighbors(), ['山田'], 'The other 山田 attends as a new chairman');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'The seat does not move to another 山田 in the spaced entry');
});

test('SPEC-Q2: an import matches neighbor seats of every district by person; officers and externals keep the previous matching', () => {
	for (const apply of [
		() => rep.upsertRepDistrict(districtFile('東地区', [row('会長', 'A')]), state.repState, false),
		() => rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', 'A')]), state.repState, false)
	]) {
		fresh();
		state.repState.districts.push(
			{ district: 'Y', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'Z'), row('会長', 'Z')], szNeighborChecks: { 0: true } },
			{ district: 'W', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'V', { tel: '1' }), row('会長', 'V', { tel: '2' })], szNeighborChecks: { 0: true, 1: true } },
			{ district: '東地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A')], szNeighborChecks: { 0: true } }
		);
		state.repState.szExternals = [{ attend: true, category: '関係機関', org: '東地区', role: '会長', lastName: 'A', firstName: '', name: 'A' }];
		state.repState.seatConfig.cells = {
			'0_0': { refKey: 'NEI_Y_0', customText: '' }, '0_1': { refKey: 'NEI_W_0', customText: '' }, '0_2': { refKey: 'OFF_2_0', customText: '' },
			'0_3': { refKey: 'NEI_東地区_0', customText: '' }, '1_0': { refKey: 'EXT_0', customText: '' }
		};
		apply();
		const refs = Object.fromEntries(Object.entries(state.repState.seatConfig.cells).map(([cell, value]) => [cell, value.refKey]));
		assert.deepEqual(checksOf('Y'), { 0: true }, 'The duplicated row of another district keeps its attendance');
		assert.equal(refs['0_0'], '', 'A seat of a duplicated row of another district is released (no identifiable person)');
		assert.equal(refs['0_1'], 'NEI_W_0', 'Two attendees with the same organisation and name but another phone: each keeps the seat');
		assert.equal(refs['0_2'], 'OFF_2_0', 'An officer seat is matched as before');
		assert.equal(refs['0_3'], 'NEI_東地区_0', 'The chairman keeps the seat although an external has the same organisation and name');
		assert.equal(refs['1_0'], 'EXT_0', 'The external with the same organisation and name keeps the seat too (no collision with the neighbor identity)');
	}
	// 印刷対象の切替でも、所属と表示名が同じ自治会役員と外部関係者の座席はどちらも残る。
	fresh();
	state.repState.districts.push(
		{ district: '東地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A')], szNeighborChecks: { 0: true } },
		{ district: '西地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [], szNeighborChecks: {} }
	);
	state.repState.szExternals = [{ attend: true, category: '関係機関', org: '東地区', role: '会長', lastName: 'A', firstName: '', name: 'A' }];
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' }, '0_1': { refKey: 'EXT_0', customText: '' } };
	seat.setDistrictPrintSelection(1, false);
	assert.deepEqual([state.repState.seatConfig.cells['0_0'].refKey, state.repState.seatConfig.cells['0_1'].refKey], ['NEI_東地区_0', 'EXT_0'], 'Print selection: the chairman and the external with the same organisation and name both keep their seats');
	// 変更前に同じ識別子の候補が2人いた座席は、変更後に1人になっても、どちらの座席か決められないため解除する。
	fresh();
	state.repState.districts.push({ district: '東地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }, { role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [], szNeighborChecks: {} });
	state.repState.seatConfig.cells = { '0_0': { refKey: 'OFF_0_1', customText: '' } };
	rep.upsertRepDistrict(districtFile('東地区', [row('会長', 'A')]), state.repState, false);
	assert.deepEqual(seat.getAllSzParticipantsForSeat().filter(person => person.key.startsWith('OFF_')).map(person => person.key), ['OFF_0_0'], 'One officer remains');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'Two previous candidates with the same identifier: the seat is released');
	// 所属の文字列（地区名と役職をつないだもの）と氏名が同じでも、地区名・役職の異なる自治会役員は区別する。
	fresh();
	state.repState.districts.push(
		{ district: '東 1', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', '山田')], szNeighborChecks: { 0: true } },
		{ district: '東', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('1 会長', '山田')], szNeighborChecks: { 0: true } },
		{ district: '西地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [], szNeighborChecks: {} }
	);
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東 1_0', customText: '' }, '0_1': { refKey: 'NEI_東_0', customText: '' } };
	seat.setDistrictPrintSelection(2, false);
	assert.deepEqual([state.repState.seatConfig.cells['0_0'].refKey, state.repState.seatConfig.cells['0_1'].refKey], ['NEI_東 1_0', 'NEI_東_0'], 'The same organisation string and name but another district and role: both seats stay');
	// 地区名の前後の空白だけが異なるエントリが座席候補のエントリになると、所属が変わるため座席は解除する。
	fresh();
	state.repState.districts.push({ district: '東地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A')], szNeighborChecks: { 0: true } });
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' } };
	rep.upsertRepDistrict(districtFile('東地区 ', [row('会長', 'A'), row('書記', 'B')], '2班'), state.repState, false);
	assert.deepEqual(seatNeighbors(), ['A'], 'The spaced entry with more rows is now the seat source');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'Another spelling of the district name releases the seat as before');
	// 座席候補のエントリが変わらなければ、代表名簿にいない本人の座席も残る。
	fresh();
	state.repState.districts.push(
		{ district: 'D', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: false, neighborhood: [row('会長', 'A'), row('副会長', 'B'), row('会計', 'C')], szNeighborChecks: { 0: true } },
		{ district: 'D ', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('書記', 'E'), row('会計', 'C')], szNeighborChecks: { 0: true } }
	);
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_D _0', customText: '' } };
	rep.upsertRepDistrict(districtFile('D', [], '1班'), state.repState, false);
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'NEI_D _0', 'E is still the same attendee: the seat stays');
});

test('SPEC-Q2: seat candidates of neighbors carry the identity (null for duplicated rows); officers and externals do not', () => {
	fresh();
	state.repState.districts.push({ district: '東地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A', { tel: '1' }), row('会長', 'A', { tel: '1' }), row('書記', 'B')], szNeighborChecks: { 0: true, 2: true } });
	state.repState.szExternals = [{ attend: true, category: '学校関係者', org: '本校', role: '校長', lastName: '校', firstName: '長', name: '校 長' }];
	const all = seat.getAllSzParticipantsForSeat();
	assert.deepEqual(all.filter(person => person.key.startsWith('NEI_')).map(person => person.identity), [null, seat.neighborIdentity(row('書記', 'B'))]);
	for (const person of all.filter(person => !person.key.startsWith('NEI_'))) assert.equal(Object.hasOwn(person, 'identity'), false, `${person.key} has no neighbor identity`);
	// 外部関係者の表示名が自治会役員の識別子の文字列と同じでも、取込の座席の照合で互いに一致しない。
	fresh();
	state.repState.districts.push({ district: '東地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A')], szNeighborChecks: { 0: true } });
	const crafted = seat.neighborIdentity(row('会長', 'A'));
	state.repState.szExternals = [{ attend: true, category: '関係機関', org: '東地区', role: '会長', lastName: crafted, firstName: '', name: crafted }];
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' }, '0_1': { refKey: 'EXT_0', customText: '' } };
	rep.upsertRepDistrict(districtFile('東地区', [row('会長', 'A')]), state.repState, false);
	assert.deepEqual([state.repState.seatConfig.cells['0_0'].refKey, state.repState.seatConfig.cells['0_1'].refKey], ['NEI_東地区_0', 'EXT_0'], 'A crafted external name does not collide with the neighbor identity');
});

test('SPEC-Q2: print selection, district deletion and external deletion keep or move the seat of the same person', () => {
	const entry = (han, neighborhood, checks, selectedForPrint) => ({ district: 'A', han, hanList: [han], officers: [], students: [], selectedForPrint, neighborhood, szNeighborChecks: checks });
	const 山田1 = row('会長', '山田', { tel: '111' });
	const seatOf = (cell = '0_0') => state.repState.seatConfig.cells[cell].refKey;
	const others = n => Array.from({ length: n }, (_, i) => row('理事', '他' + i, { tel: String(500 + i) }));
	// 印刷対象の切替: 座席候補が替わらなければ同じ本人の座席が残り、替われば新しい座席候補の同じ本人の行へ移る。
	fresh();
	state.repState.districts.push(entry('1班', [row('書記', '佐藤'), 山田1, row('会計', '鈴木')], { 1: true }, true), entry('2班', [山田1, ...others(3)], { 0: true }, false), entry('B', [row('会長', 'Z')], { 0: true }, true));
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_1', customText: '' } };
	seat.setDistrictPrintSelection(2, false);
	assert.equal(seatOf(), 'NEI_A_1', 'Print selection of another district: the seat of 山田 stays');
	seat.setDistrictPrintSelection(1, true);
	assert.deepEqual(checksOf('A', '1班'), { 1: true }, '山田 of 1班 keeps the attendance');
	assert.equal(seatOf(), 'NEI_A_0', 'Print selection changes the seat source to 2班: the seat moves to 山田 at row 0');
	// 地区の削除: 他の地区の削除では座席が残り、座席候補のエントリを削除すれば別班の同じ本人へ移る。
	fresh();
	state.repState.districts.push(entry('1班', [row('書記', '佐藤'), 山田1, row('会計', '鈴木'), row('理事', '田中')], { 1: true }, true), entry('2班', [山田1, row('副会長', '中村')], { 0: true }, true), entry('B', [row('会長', 'Z')], { 0: true }, true));
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_1', customText: '' } };
	rep.deleteRepDistrict(2);
	assert.equal(seatOf(), 'NEI_A_1', 'Deleting another district: the seat of 山田 stays');
	rep.deleteRepDistrict(0);
	assert.deepEqual(checksOf('A', '2班'), { 0: true }, '山田 of 2班 attends');
	assert.equal(seatOf(), 'NEI_A_0', 'Deleting the seat-source entry: the seat moves to 山田 of 2班');
	// 外部関係者の行の削除では、自治会役員の座席は変わらない。
	fresh();
	state.repState.districts.push(entry('1班', [row('書記', '佐藤'), 山田1], { 1: true }, true));
	state.repState.szExternals = [{ attend: true, category: '関係機関', org: '市役所', role: '課長', lastName: '課', firstName: '長', name: '課 長' }];
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_1', customText: '' }, '0_1': { refKey: 'EXT_0', customText: '' } };
	rep.deleteSzExternalRow(0);
	assert.equal(seatOf('0_0'), 'NEI_A_1', 'Deleting an external row keeps the seat of 山田');
	assert.equal(seatOf('0_1'), '', 'The seat of the deleted external is released');
});

test('SPEC-Q2: a roster-less district file never copies a roster of kana, phone and address only rows', () => {
	// 写し元は「役職または氏名のある行」を持つ最初の同名エントリとする（E-13-02）。
	fresh();
	state.repState.districts.push(
		{ district: 'K', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('', '', { lastNameKana: 'さとう', tel: '000', address: '東1' })], szNeighborChecks: {} },
		{ district: 'K', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', '本物')], szNeighborChecks: { 0: true } }
	);
	rep.upsertRepDistrict(districtFile('K', [], '3班'), state.repState, false);
	const copied = state.repState.districts.find(d => d.han === '3班');
	assert.deepEqual(copied.neighborhood.map(n => getFullName(n)), ['本物'], 'The roster of 2班 is copied, not the kana-only rows of 1班');
	assert.deepEqual(copied.szNeighborChecks, { 0: true }, 'The chairman of 2班 is carried as a person');
});

test('SPEC-Q2: print selection, district deletion and the detail modal also match neighbor seats by person', () => {
	// 保存が検証で拒否されると座席が変わらないまま合格するため、保存の失敗がないことも確かめる。
	const saveModal = () => {
		const alerts = [];
		const original = global.alert;
		global.alert = message => { alerts.push(String(message)); original(message); };
		try { rep.saveAndCloseRepDistrictDetailModal(); } finally { global.alert = original; }
		assert.deepEqual(alerts.filter(message => message.includes('失敗')), [], 'The detail modal is saved');
	};
	const entry = (han, neighborhood, checks, selectedForPrint) => ({ district: 'A', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' + han }], students: [], selectedForPrint, neighborhood, szNeighborChecks: checks });
	const 山田1 = row('会長', '山田', { tel: '111' }), 山田2 = row('会長', '山田', { tel: '222' });
	const seatOf = (cell = '0_0') => state.repState.seatConfig.cells[cell].refKey;
	// 取込で新たに出席になった電話の異なる同名の会長の座席は、その後の印刷対象の切替で別の山田へ移らない。
	fresh();
	state.repState.districts.push(entry('2班', [山田2, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, false));
	rep.upsertRepDistrict(districtFile('A', [山田1], '1班'), state.repState, false);
	assert.deepEqual(checksOf('A', '1班'), { 0: true }, '山田 (111) is checked as a new chairman');
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
	seat.setDistrictPrintSelection(0, true);
	assert.deepEqual(seatNeighbors(), ['山田'], '山田 (222) of 2班 now attends');
	assert.equal(seatOf(), '', 'Print selection: the seat does not move to another 山田');
	// 地区の削除でも同じ。
	fresh();
	state.repState.districts.push(
		entry('2班', [山田2, row('書記', '佐藤'), row('会計', '鈴木'), row('理事', '田中')], { 0: true }, false),
		entry('1班', [山田1, row('書記', '伊藤'), row('会計', '渡辺')], { 0: true }, true),
		entry('3班', [山田2, row('副会長', '中村')], { 0: true }, true)
	);
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
	assert.deepEqual(seatNeighbors(), ['山田'], 'Before: 山田 (111) of 1班 attends');
	rep.deleteRepDistrict(1);
	assert.equal(state.repState.districts.length, 2, '1班 is deleted');
	assert.equal(seat.getAllSzParticipantsForSeat().find(person => person.key === 'NEI_A_0').identity, seat.neighborIdentity(山田2), 'The seat candidate is 山田 (222) of 3班');
	assert.deepEqual(seatNeighbors(), ['山田'], 'After the deletion: 山田 (222) of 3班 attends');
	assert.equal(seatOf(), '', 'District deletion: the seat does not move to another 山田');
	// 氏名・役職が同じで電話の異なる2人の座席は、印刷対象の切替でもそれぞれ残る。校外役員の座席は従来どおり。
	fresh();
	state.repState.districts.push(
		{ district: '東地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A', { tel: '111' }), row('会長', 'A', { tel: '222' })], szNeighborChecks: { 0: true, 1: true } },
		{ district: '西地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [], szNeighborChecks: {} }
	);
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' }, '0_1': { refKey: 'OFF_1_0', customText: '' } };
	seat.setDistrictPrintSelection(1, false);
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, 'NEI_東地区_0', 'Two attendees with the same organisation and name but another phone: the seat stays');
	assert.equal(state.repState.seatConfig.cells['0_1'].refKey, '', 'The officer of the deselected district loses the seat as before');
	// 地区詳細モーダル: 座席候補のエントリが替わらない編集は、連絡先を直しても対応表で座席を写す。
	fresh();
	state.repState.districts.push(entry('1班', [山田1, row('書記', '佐藤')], { 0: true }, true));
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
	rep.openRepDistrictDetailModal(0);
	rep.updateModalNeighbor(0, 'tel', '999');
	saveModal();
	assert.equal(seatOf(), 'NEI_A_0', 'Modal, same seat source: the explicit mapping keeps the seat');
	// 座席候補のエントリが替わる編集では、編集後の本人で照合し、別のエントリにいる同じ本人へ引き継ぐ。
	for (const [label, other, edit, expected] of [
		['phone fixed', 山田2, () => { rep.updateModalNeighbor(0, 'tel', '222'); rep.removeModalNeighborRow(2); rep.removeModalNeighborRow(1); }, 'NEI_A_0'],
		['role and phone fixed', row('自治会長', '山田', { tel: '222' }), () => { rep.updateModalNeighbor(0, 'role', '自治会長'); rep.updateModalNeighbor(0, 'tel', '222'); rep.removeModalNeighborRow(2); rep.removeModalNeighborRow(1); }, 'NEI_A_0'],
		['phone fixed into a duplicate', 山田2, () => { rep.updateModalNeighbor(0, 'tel', '222'); rep.updateModalNeighbor(1, 'role', '会長'); rep.updateModalNeighbor(1, 'lastName', '山田'); rep.updateModalNeighbor(1, 'tel', '222'); rep.removeModalNeighborRow(2); }, ''],
		['row removed', 山田2, () => { rep.removeModalNeighborRow(0); rep.removeModalNeighborRow(1); }, '']
	]) {
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(entry('1班', [山田1, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, true), entry('2班', [other, row('副会長', '中村'), row('理事', '小林')], {}, true));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		edit();
		saveModal();
		assert.equal(seatOf(), expected, `Modal, seat source changes (${label})`);
	}
	// 削除した行・重複させた行は編集前の本人で照合する。出席の代表（印刷対象外の4班）と照合されて新しい座席候補（2班）に出席している同じ本人へ引き継ぐ。
	for (const [label, edit] of [
		['row removed', () => { rep.removeModalNeighborRow(2); rep.removeModalNeighborRow(0); }],
		['row made a duplicate', () => { rep.updateModalNeighbor(1, 'role', '会長'); rep.updateModalNeighbor(1, 'lastName', '山田'); rep.updateModalNeighbor(1, 'tel', '111'); rep.removeModalNeighborRow(2); }],
		['seated row edited into a duplicate of another row', () => { rep.updateModalNeighbor(0, 'role', '書記'); rep.updateModalNeighbor(0, 'lastName', '佐藤'); rep.updateModalNeighbor(0, 'tel', ''); rep.removeModalNeighborRow(2); }]
	]) {
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('4班', [山田1, row('書記', 'a'), row('会計', 'b'), row('理事', 'c')], { 0: true }, false),
			entry('1班', [山田1, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, true),
			entry('2班', [山田1, row('副会長', '中村'), row('理事', '小林')], { 0: true }, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		assert.deepEqual(seatNeighbors(), ['山田'], `${label}: before, 山田 of 1班 attends`);
		rep.openRepDistrictDetailModal(1);
		edit();
		saveModal();
		assert.deepEqual(seatNeighbors(), ['山田'], `${label}: after, 山田 of 2班 attends`);
		assert.equal(seatOf(), 'NEI_A_0', `${label}: the seat stays with the same person`);
	}
	// 出席の代表（印刷対象外の1班）がいる場合、座席候補が替わるモーダル編集では、編集前と編集後の本人のうち新しい座席候補（3班）に出席している方へ引き継ぎ、両方なら解除する。
	const X1 = row('会長', 'X', { tel: '1' }), X2 = row('会長', 'X', { tel: '2' }), Y9 = row('会長', 'Y', { tel: '9' });
	for (const [label, third, edit, expected] of [
		['name changed, both attend', [X1, Y9, row('書記', 'P')], () => { rep.updateModalNeighbor(0, 'lastName', 'Y'); rep.updateModalNeighbor(0, 'tel', '9'); }, ''],
		['name changed, only the new person attends', [Y9, row('書記', 'P'), row('会計', 'Q')], () => { rep.updateModalNeighbor(0, 'lastName', 'Y'); rep.updateModalNeighbor(0, 'tel', '9'); }, 'NEI_A_0'],
		['phone changed, only the old person attends', [X1, row('書記', 'P'), row('会計', 'Q')], () => { rep.updateModalNeighbor(0, 'tel', '2'); }, 'NEI_A_0'],
		['phone changed, both attend', [X1, X2, row('書記', 'P')], () => { rep.updateModalNeighbor(0, 'tel', '2'); }, ''],
		['phone changed, only another X attends', [X2, row('書記', 'P'), row('会計', 'Q')], () => { rep.updateModalNeighbor(0, 'tel', '3'); }, '']
	]) {
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [X1, Y9, X2, row('書記', 'P'), row('会計', 'Q'), row('理事', 'R')], { 0: true, 1: true, 2: true }, false),
			entry('2班', [X1, row('書記', 'P'), row('会計', 'Q'), row('理事', 'R')], { 0: true }, true),
			entry('3班', third, {}, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		assert.deepEqual(seatNeighbors(), ['X'], `${label}: before, X of 2班 attends`);
		rep.openRepDistrictDetailModal(1);
		edit();
		rep.removeModalNeighborRow(3);
		rep.removeModalNeighborRow(2);
		saveModal();
		if (label === 'phone changed, only another X attends') {
			assert.equal(seat.getAllSzParticipantsForSeat().find(person => person.key === 'NEI_A_0').identity, seat.neighborIdentity(X2), 'Only X (2), with the same organisation and name, attends');
		}
		assert.equal(seatOf(), expected, `Modal with a non-printed representative (${label})`);
	}
	// 編集後の本人と削除した行の本人が同じになると、別々の座席が1人に当たるため、どちらも解除する（変更後に出席していても）。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [row('会長', 'X', { tel: '1' }), row('副会長', 'Y', { tel: '9' }), row('書記', 'P')], { 0: true, 1: true }, true),
			entry('2班', [row('副会長', 'Y', { tel: '9' }), row('会計', '中村')], { 0: true }, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' }, '0_1': { refKey: 'NEI_A_1', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.updateModalNeighbor(0, 'role', '副会長');
		rep.updateModalNeighbor(0, 'lastName', 'Y');
		rep.updateModalNeighbor(0, 'tel', '9');
		rep.removeModalNeighborRow(2);
		rep.removeModalNeighborRow(1);
		saveModal();
		assert.deepEqual(seatNeighbors(), ['Y'], 'Y of 2班 attends as the only person');
		assert.deepEqual([seatOf('0_0'), seatOf('0_1')], ['', ''], 'Two seats of different persons are not merged onto Y');
	}
	// 同じ出席者を複数の座席に割り当てた場合は、一対一の規則で解除せず、そろって新しい行へ移す。
	const bothSeats = key => ({ '0_0': { refKey: key, customText: '' }, '0_1': { refKey: key, customText: '' } });
	const seatsOf = () => [state.repState.seatConfig.cells['0_0'].refKey, state.repState.seatConfig.cells['0_1'].refKey];
	fresh();
	state.repState.districts.push(entry('1班', [山田1, row('書記', '佐藤')], { 0: true }, true));
	state.repState.seatConfig.cells = bothSeats('NEI_A_0');
	rep.upsertRepDistrict(districtFile('A', [row('書記', '佐藤'), 山田1], '1班'), state.repState, false);
	assert.deepEqual(seatsOf(), ['NEI_A_1', 'NEI_A_1'], 'Import: both seats of the same person move together');
	fresh();
	state.repState.districts.push(entry('1班', [山田1, row('書記', '佐藤')], { 0: true }, true), entry('2班', [row('書記', '佐藤'), 山田1, row('会計', '鈴木')], { 1: true }, false));
	state.repState.seatConfig.cells = bothSeats('NEI_A_0');
	seat.setDistrictPrintSelection(1, true);
	assert.deepEqual(seatsOf(), ['NEI_A_1', 'NEI_A_1'], 'Print selection: both seats of the same person move together');
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(entry('1班', [row('書記', '鈴木'), 山田1, row('書記', '佐藤')], { 1: true }, true));
		state.repState.seatConfig.cells = bothSeats('NEI_A_1');
		rep.openRepDistrictDetailModal(0);
		rep.removeModalNeighborRow(0);
		saveModal();
		assert.deepEqual(seatsOf(), ['NEI_A_0', 'NEI_A_0'], 'Modal: both seats of the same person move together');
	}
	// 同じ出席者の複数の座席も、その本人を確かめられなければそろって解除する。
	fresh();
	state.repState.districts.push(entry('1班', [山田1, row('書記', '佐藤')], { 0: true }, true));
	state.repState.seatConfig.cells = bothSeats('NEI_A_0');
	rep.upsertRepDistrict(districtFile('A', [row('書記', '佐藤'), 山田2], '1班'), state.repState, false);
	assert.deepEqual(seatNeighbors(), ['山田'], 'Import: 山田 (222) attends as a new chairman');
	assert.deepEqual(seatsOf(), ['', ''], 'Import: both seats of the old 山田 are released, not handed to another 山田');
	fresh();
	state.repState.districts.push(entry('1班', [山田1, row('書記', '佐藤')], { 0: true }, true), entry('2班', [row('書記', '佐藤'), 山田2, row('会計', '鈴木')], { 1: true }, false));
	state.repState.seatConfig.cells = bothSeats('NEI_A_0');
	seat.setDistrictPrintSelection(1, true);
	assert.deepEqual(seatsOf(), ['', ''], 'Print selection: both seats are released when only another 山田 attends');
	// 同じ出席者の2席と別の出席者の1席が、変更後に同じ出席者に当たる場合は、3席とも解除する。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [row('会長', '山田', { tel: '1' }), row('会長', '鈴木', { tel: '2' }), row('書記', '佐藤')], { 0: true, 1: true }, true),
			entry('2班', [row('会長', '鈴木', { tel: '2' }), row('副会長', '中村'), row('理事', '小林')], {}, true)
		);
		state.repState.seatConfig.cells = { ...bothSeats('NEI_A_0'), '0_2': { refKey: 'NEI_A_1', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.removeModalNeighborRow(1);
		rep.updateModalNeighbor(0, 'lastName', '鈴木');
		rep.updateModalNeighbor(0, 'tel', '2');
		rep.removeModalNeighborRow(1);
		saveModal();
		assert.deepEqual(seatNeighbors(), ['鈴木'], '鈴木 of 2班 attends');
		assert.deepEqual([...seatsOf(), state.repState.seatConfig.cells['0_2'].refKey], ['', '', ''], 'All three seats are released');
	}
	// 対応表の写し先と照合の引継ぎ先が同じ候補になる場合も、両方とも解除する。
	{
		fresh();
		state.repState.districts.push(entry('1班', [row('会長', 'Q'), 山田1], { 0: true, 1: true }, true));
		const previous = seat.captureSeatState();
		state.repState.districts[0].neighborhood = [山田1];
		state.repState.districts[0].szNeighborChecks = { 0: true };
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' }, '0_1': { refKey: 'NEI_A_1', customText: '' } };
		seat.reconcileSeatState(previous, { NEI_A_0: 'NEI_A_0' });
		assert.deepEqual([state.repState.seatConfig.cells['0_0'].refKey, state.repState.seatConfig.cells['0_1'].refKey], ['', ''], 'An explicit mapping and an identity match onto the same candidate are both released');
	}
	// 別々の本人の座席が同じ出席者に当たる編集では、どちらの座席か決められないため両方を解除する。
	for (const [label, edit] of [
		['the other seated row removed', () => { rep.removeModalNeighborRow(1); rep.updateModalNeighbor(0, 'lastName', '鈴木'); rep.updateModalNeighbor(0, 'tel', '2'); rep.removeModalNeighborRow(1); }],
		['the other seated row changed', () => { rep.updateModalNeighbor(1, 'lastName', '田中'); rep.updateModalNeighbor(1, 'tel', '3'); rep.updateModalNeighbor(0, 'lastName', '鈴木'); rep.updateModalNeighbor(0, 'tel', '2'); rep.removeModalNeighborRow(2); }]
	]) {
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [row('会長', '山田', { tel: '1' }), row('会長', '鈴木', { tel: '2' }), row('書記', '佐藤')], { 0: true, 1: true }, true),
			entry('2班', [row('会長', '鈴木', { tel: '2' }), row('副会長', '中村'), row('理事', '小林')], {}, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' }, '0_1': { refKey: 'NEI_A_1', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		edit();
		saveModal();
		assert.deepEqual(seatNeighbors(), ['鈴木'], `${label}: 鈴木 of 2班 attends`);
		assert.deepEqual([state.repState.seatConfig.cells['0_0'].refKey, state.repState.seatConfig.cells['0_1'].refKey], ['', ''], `${label}: two seats are not merged onto one person`);
	}
	// 変更前の座席候補のエントリで重複していた行の座席: 座席候補が替わる編集では解除し、替わらない編集では写し先が一意なら写す。
	for (const [label, other, expected] of [
		['seat source changes', [row('会長', '山田', { tel: '1' }), row('副会長', '中村'), row('理事', '小林')], ''],
		['seat source stays', [row('副会長', '中村')], 'NEI_A_0']
	]) {
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [row('会長', '山田', { tel: '1' }), row('会長', '山田', { tel: '1' }), row('書記', '佐藤')], { 0: true }, true),
			entry('2班', other, { 0: true }, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.removeModalNeighborRow(2);
		rep.removeModalNeighborRow(1);
		saveModal();
		assert.equal(state.repState.seatConfig.cells['0_0'].refKey, expected, `A seat of a row duplicated before the edit (${label})`);
	}
	// 編集後の名簿で重複する行には編集後の本人を加えない（編集前の本人だけで照合する）。編集後の本人（山田 222）が新しい座席候補に出席していても引き継がない。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('4班', [山田2, row('書記', 'a'), row('会計', 'b'), row('理事', 'c')], { 0: true }, false),
			entry('1班', [山田1, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, true),
			entry('2班', [山田2, row('副会長', '中村'), row('理事', '小林')], { 0: true }, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(1);
		rep.updateModalNeighbor(0, 'tel', '222');
		rep.updateModalNeighbor(1, 'role', '会長');
		rep.updateModalNeighbor(1, 'lastName', '山田');
		rep.updateModalNeighbor(1, 'tel', '222');
		rep.removeModalNeighborRow(2);
		saveModal();
		const candidate = seat.getAllSzParticipantsForSeat().find(person => person.key === 'NEI_A_0');
		assert.equal(candidate.identity, seat.neighborIdentity(山田2), '山田 (222) of 2班 is the seat candidate');
		assert.equal(seatOf(), '', 'A row edited into a duplicate is matched by the person before the edit only');
	}
	// 座席のある行を重複する内容に書き換えた場合も、編集前の本人だけで照合する（編集後の本人も出席していれば、両方で照合すると解除になる）。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('4班', [山田1, row('書記', '佐藤'), row('会計', 'b'), row('理事', 'c')], { 0: true, 1: true }, false),
			entry('1班', [山田1, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, true),
			entry('2班', [山田1, row('書記', '佐藤'), row('理事', '小林')], { 0: true, 1: true }, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(1);
		rep.updateModalNeighbor(0, 'role', '書記');
		rep.updateModalNeighbor(0, 'lastName', '佐藤');
		rep.updateModalNeighbor(0, 'tel', '');
		rep.removeModalNeighborRow(2);
		saveModal();
		assert.deepEqual(seatNeighbors(), ['山田', '佐藤'], 'Both the person before and after the edit attend in 2班');
		assert.equal(seatOf(), 'NEI_A_0', 'The seat stays with the person before the edit');
	}
	// 座席のある行を変えずに他の行を削除し、座席候補が替わっても、同じ本人へ引き継ぐ（編集前と編集後の本人は1人とみなす）。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(entry('1班', [山田1, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, true), entry('2班', [山田1, row('副会長', '中村')], { 0: true }, true));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.removeModalNeighborRow(2);
		rep.removeModalNeighborRow(1);
		saveModal();
		assert.equal(seatOf(), 'NEI_A_0', 'An unchanged seated row keeps the seat');
	}
	// 座席のある行の添字が編集で移る場合は、編集前後の行の対応で本人を求める。
	for (const [label, second, neighbors, expected] of [
		['the person is not in the new seat source', [row('副会長', '鈴木'), row('書記', '中村'), row('会計', '小林'), row('理事', '加藤')], ['鈴木'], ''],
		['the person is in the new seat source', [山田1, row('副会長', '鈴木'), row('書記', '中村'), row('会計', '小林')], ['山田', '鈴木'], 'NEI_A_0']
	]) {
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [row('書記', '佐藤'), 山田1, row('副会長', '鈴木'), row('理事', '田中'), row('会計', '伊藤')], { 1: true, 2: true }, true),
			entry('2班', second, {}, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_1', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.removeModalNeighborRow(0);
		rep.removeModalNeighborRow(2);
		saveModal();
		assert.deepEqual(seatNeighbors(), neighbors, `${label}: attendees`);
		assert.equal(seatOf(), expected, `Moved seated row (${label})`);
	}
	// 編集したエントリが、編集によって座席候補のエントリになる場合は、編集前後の対応を使わない（他のエントリの座席に編集した行の本人を当てない）。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(entry('1班', [row('会長', 'X'), row('副会長', 'Z'), row('会計', 'Q')], { 0: true, 1: true }, true), entry('2班', [row('副会長', 'Z'), row('書記', 'R')], {}, true));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(1);
		rep.addModalNeighborRow();
		rep.updateModalNeighbor(2, 'role', '理事');
		rep.updateModalNeighbor(2, 'lastName', 'S');
		rep.addModalNeighborRow();
		rep.updateModalNeighbor(3, 'role', '理事');
		rep.updateModalNeighbor(3, 'lastName', 'T');
		saveModal();
		assert.deepEqual(seatNeighbors(), ['Z'], '2班 is now the seat source and Z attends');
		assert.equal(seatOf(), '', 'The seat of X does not move to Z');
	}
	// 変更の前後とも座席候補ではないエントリを編集した場合は、編集前後の対応を使わない（本人単位の照合だけ）。
	{
		// 印刷対象外の代表名簿（1班）で X の電話を直すと X は出席でなくなり、座席は同じ添字の Y へ移らず解除される。
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [row('会長', 'X', { tel: '1' }), row('副会長', 'Y'), row('書記', 'Z'), row('会計', 'W')], { 0: true, 1: true }, false),
			entry('2班', [row('副会長', 'Y'), row('会長', 'X', { tel: '1' })], { 0: true, 1: true }, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_1', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.updateModalNeighbor(0, 'tel', '2');
		saveModal();
		assert.deepEqual(seatNeighbors(), ['Y'], 'X no longer attends');
		assert.equal(seatOf(), '', 'Editing the non-printed representative does not move the seat to Y');
	}
	{
		// 座席候補でない印刷対象の2班の行を Y と同じ内容に直しても、座席候補（1班）の X の座席はそのまま残る。
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(entry('1班', [row('会長', 'X'), row('副会長', 'Y'), row('書記', 'P')], { 0: true, 1: true }, true), entry('2班', [row('理事', 'Q')], {}, true));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(1);
		rep.updateModalNeighbor(0, 'role', '副会長');
		rep.updateModalNeighbor(0, 'lastName', 'Y');
		saveModal();
		assert.equal(seatOf(), 'NEI_A_0', 'Editing another printed entry keeps the seat of X');
	}
	// 座席のある行を削除して座席候補が替わる場合は、削除した本人だけで照合する（削除後に同じ添字へ来る別の本人へ座席を移さない）。
	for (const [label, second, neighbors, expected] of [
		['only the next person attends', [row('書記', '佐藤'), row('副会長', '中村'), row('理事', '小林')], ['佐藤'], ''],
		['both the deleted and the next person attend', [山田1, row('書記', '佐藤'), row('副会長', '中村')], ['山田', '佐藤'], 'NEI_A_0']
	]) {
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('4班', [山田1, row('書記', '佐藤'), row('会計', 'x'), row('理事', 'y')], { 0: true, 1: true }, false),
			entry('1班', [山田1, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, true),
			entry('2班', second, {}, true)
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(1);
		rep.removeModalNeighborRow(0);
		saveModal();
		assert.deepEqual(seatNeighbors(), neighbors, `Deleted seated row (${label}): attendees`);
		assert.equal(seatOf(), expected, `Deleted seated row (${label})`);
	}
	// 座席候補が替わらない編集で座席のある行を削除すると、座席を解除する（削除後に同じ添字へ来る別の本人へ写さない）。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(entry('1班', [row('会長', '山田'), row('副会長', '佐藤')], { 0: true, 1: true }, true));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.removeModalNeighborRow(0);
		saveModal();
		assert.deepEqual(seatNeighbors(), ['佐藤']);
		assert.equal(seatOf(), '', 'The seat of the deleted row is released, not moved to 佐藤');
	}
	// 座席候補が替わるモーダル編集でも、編集したエントリ以外の候補（外部関係者・別班の校外役員・他地区の自治会役員）の座席は変わらない。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			entry('1班', [山田1, row('書記', '佐藤'), row('会計', '鈴木')], { 0: true }, true),
			entry('2班', [山田2, row('副会長', '中村'), row('理事', '小林')], {}, true),
			{ district: 'B', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'B会長')], szNeighborChecks: { 0: true } },
			{ district: 'A_0', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A_0会長')], szNeighborChecks: { 0: true } }
		);
		state.repState.szExternals = [{ attend: true, category: '関係機関', org: '市役所', role: '課長', lastName: '課', firstName: '長', name: '課 長' }];
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_0', customText: '' }, '0_1': { refKey: 'EXT_0', customText: '' }, '0_2': { refKey: 'OFF_1_0', customText: '' }, '0_3': { refKey: 'NEI_B_0', customText: '' }, '1_0': { refKey: 'NEI_A_0_0', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.updateModalNeighbor(0, 'tel', '222');
		rep.removeModalNeighborRow(2);
		rep.removeModalNeighborRow(1);
		saveModal();
		const refs = ['0_0', '0_1', '0_2', '0_3', '1_0'].map(cell => state.repState.seatConfig.cells[cell].refKey);
		assert.deepEqual(refs, ['NEI_A_0', 'EXT_0', 'OFF_1_0', 'NEI_B_0', 'NEI_A_0_0'], 'Only the edited entry candidates are matched with the edit; the other seats stay (including the district A_0)');
	}
	// 地区名に前後の空白がある同名エントリの間で座席候補が替わる場合も、編集後の本人へ引き継ぐ。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			{ district: 'B ', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X', { tel: '1' }), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true } },
			{ district: 'B ', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X', { tel: '2' }), row('副会長', 'R')], szNeighborChecks: {} }
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_B _0', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.updateModalNeighbor(0, 'tel', '2');
		rep.removeModalNeighborRow(2);
		rep.removeModalNeighborRow(1);
		saveModal();
		assert.deepEqual(seatNeighbors(), ['X'], 'X (2) of 2班 attends');
		assert.equal(seatOf(), 'NEI_B _0', 'The seat follows the edited person in a spaced district name');
	}
	// 座席候補が替わらない編集で、座席のある行を重複する内容に直すと、写し先は出席でなくなり（候補にない）座席を解除する。後で行を直して出席にしても座席は戻らない。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(entry('1班', [row('会長', 'X'), row('副会長', 'Y')], { 0: true, 1: true }, true));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_A_1', customText: '' } };
		rep.openRepDistrictDetailModal(0);
		rep.updateModalNeighbor(1, 'role', '会長');
		rep.updateModalNeighbor(1, 'lastName', 'X');
		saveModal();
		assert.deepEqual(seatNeighbors(), [], 'Both duplicated rows lose the attendance');
		assert.equal(seatOf(), '', 'A seat mapped to a row that is no longer a candidate is released');
		rep.openRepDistrictDetailModal(0);
		rep.updateModalNeighbor(1, 'role', '書記');
		rep.updateModalNeighbor(1, 'lastName', 'Z');
		saveModal();
		rep.toggleSzNeighbor(0, 1, true);
		assert.deepEqual(seatNeighbors(), ['Z']);
		assert.equal(seatOf(), '', 'The released seat does not come back for another person');
	}
	// 一括の印刷対象の切替も、自治会役員の座席を本人単位で照合する。
	for (const [label, entries, key] of [
		['the seat source changes to an entry whose district name differs only by spaces', [
			{ district: 'B', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: false, neighborhood: [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true } },
			{ district: 'B ', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X'), row('副会長', 'Y')], szNeighborChecks: { 0: true } }
		], 'NEI_B _0'],
		['another 山田 in the non-printed representative', [entry('1班', [山田1, row('書記', '佐藤')], { 0: true }, true), entry('2班', [山田2, row('書記', 'a'), row('会計', 'b')], { 0: true }, false)], 'NEI_A_0'],
		['a duplicated row in the seat source (the same district name)', [
			{ district: 'B', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: false, neighborhood: [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true } },
			{ district: 'B', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X'), row('会長', 'X')], szNeighborChecks: { 0: true } }
		], 'NEI_B_0']
	]) {
		fresh();
		state.repState.districts.push(...entries);
		state.repState.seatConfig.cells = { '0_0': { refKey: key, customText: '' } };
		rep.toggleAllDistrictChecks(true);
		assert.ok(state.repState.districts.every(d => d.selectedForPrint));
		assert.equal(seatOf(), '', `Bulk print selection (${label}): the seat does not move to another person`);
	}
	// 座席候補のエントリが替わらない編集でも、写し先の行が名簿内で重複すれば座席を解除する（地区名が代表名簿と前後の空白だけ異なる場合）。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			{ district: 'B', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: false, neighborhood: [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true } },
			{ district: 'B ', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X'), row('副会長', 'Y')], szNeighborChecks: { 0: true } }
		);
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_B _0', customText: '' } };
		rep.openRepDistrictDetailModal(1);
		rep.updateModalNeighbor(1, 'role', '会長');
		rep.updateModalNeighbor(1, 'lastName', 'X');
		saveModal();
		assert.deepEqual(checksOf('B ', '2班'), { 0: true }, 'The spaced entry is not re-matched: the duplicated row still attends');
		assert.equal(seatOf(), '', 'The explicit mapping does not keep a seat on a duplicated row');
	}
	// 外部関係者の行の削除でも、座席候補のエントリで重複する行の座席は解除する。
	{
		const dialogs = fresh();
		dialogs.confirmAnswer = true;
		state.repState.districts.push(
			{ district: 'B', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: false, neighborhood: [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], szNeighborChecks: { 0: true } },
			{ district: 'B ', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'X'), row('会長', 'X')], szNeighborChecks: { 0: true } }
		);
		state.repState.szExternals = [{ attend: true, category: '関係機関', org: '市役所', role: '課長', lastName: '課', firstName: '長', name: '課 長' }];
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_B _0', customText: '' } };
		rep.deleteSzExternalRow(0);
		assert.deepEqual(checksOf('B ', '2班'), { 0: true });
		assert.equal(seatOf(), '', 'Deleting an external row also releases a seat of a duplicated neighbor row');
	}
});

test('SPEC-Q2: a roster of rows with only a name (legacy or current fields) is a roster for district files as for neighborhood files', () => {
	const legacy = name => ({ role: '', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', name });
	for (const [label, rows] of [['legacy name', [legacy('佐藤 一郎'), legacy('鈴木 次郎')]], ['current name fields', [row('', '佐藤'), row('', '鈴木')]], ['first names only', [row('', '', { firstName: '花子' }), row('', '', { firstName: '次郎' })]]]) {
		const names = rows.map(r => getFullName(r));
		fresh();
		rep.upsertRepDistrict(districtFile('旧形式地区', rows), state.repState, false);
		assert.deepEqual(checksOf('旧形式地区'), { 0: true }, `${label}: district file checks the first named row (E-13-01), as a roster`);
		fresh();
		rep.mergeNeighborDataIntoRep(neighborFile('旧形式地区', rows), state.repState, false);
		assert.deepEqual(checksOf('旧形式地区'), { 0: true }, `${label}: neighborhood file gives the same result`);
		// 同名の既存名簿があっても、名簿のない取込として扱わず、既存の名簿で上書きしない。
		fresh();
		state.repState.districts.push({ district: '旧形式地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '既存')], szNeighborChecks: { 0: true } });
		rep.upsertRepDistrict(districtFile('旧形式地区', rows), state.repState, false);
		const entry = state.repState.districts.find(d => d.district === '旧形式地区');
		assert.deepEqual(entry.neighborhood.map(n => getFullName(n)), names, `${label}: the imported roster replaces the existing one`);
		assert.deepEqual(entry.szNeighborChecks, {}, `${label}: compared with the old roster, nobody matches and there is no new chairman`);
		// 写し元の判定でも名簿として扱う。
		fresh();
		state.repState.districts.push({ district: '旧形式地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: rows.map(r => ({ ...r })), szNeighborChecks: { 0: true } });
		rep.upsertRepDistrict(districtFile('旧形式地区', [], '1班'), state.repState, false);
		assert.deepEqual(state.repState.districts.find(d => d.han === '1班').neighborhood.map(n => getFullName(n)), names, `${label}: a roster-less import copies this roster of another entry`);
	}
	// 役職だけの行（年度更新後の会長・副会長の空枠など）の名簿も、写し元の判定では名簿として扱う（旧版と同じ）。
	fresh();
	state.repState.districts.push({ district: '旧形式地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', ''), row('副会長', '')], szNeighborChecks: {} });
	rep.upsertRepDistrict(districtFile('旧形式地区', [], '1班'), state.repState, false);
	assert.deepEqual(state.repState.districts.find(d => d.han === '1班').neighborhood.map(n => n.role), ['会長', '副会長'], 'A roster of role-only rows is copied');
	assert.deepEqual(checksOf('旧形式地区', '1班'), {}, 'Nobody attends from the empty slots');
	assert.deepEqual(state.repState.districts.find(d => d.han === '2班').neighborhood.map(n => n.role), ['会長', '副会長'], '2班 is unchanged');
	assert.deepEqual(checksOf('旧形式地区', '2班'), {});
});

test('SPEC-Q2: rows whose name and role are only spaces are not a roster', () => {
	const blank = [
		{ role: '', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', name: '  ' },
		{ role: '', lastName: ' ', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '' },
		{ role: ' ', lastName: '', firstName: '　', lastNameKana: '', firstNameKana: '', address: '', tel: '' },
		{ lastName: '', firstName: '' },
		{ role: null, lastName: '', firstName: '' }
	];
	// 空白だけの行の名簿は名簿のない取込として扱い、同名の既存名簿を写す（上書きしない）。
	fresh();
	state.repState.districts.push({ district: '空白地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '既存')], szNeighborChecks: { 0: true } });
	rep.upsertRepDistrict(districtFile('空白地区', blank), state.repState, false);
	assert.deepEqual(state.repState.districts.find(d => d.district === '空白地区').neighborhood.map(n => n.lastName), ['既存'], 'The existing roster is kept');
	assert.deepEqual(checksOf('空白地区'), { 0: true }, 'An own-copy import changes no attendance');
	// 空白だけの行のエントリは写し元にしない（一覧の順で最初に名簿を持つエントリを写す）。
	fresh();
	state.repState.districts.push(
		{ district: '空白地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: blank.map(r => ({ ...r })), szNeighborChecks: {} },
		{ district: '空白地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '本物')], szNeighborChecks: { 0: true } }
	);
	rep.upsertRepDistrict(districtFile('空白地区', [], '3班'), state.repState, false);
	assert.deepEqual(state.repState.districts.find(d => d.han === '3班').neighborhood.map(n => n.lastName), ['本物'], 'The roster of 2班 is copied, not the spaces-only rows of 1班');
	// 空の行に役職か氏名のある行が1行でも混じれば名簿として扱う（取り込む名簿と写し元の両方）。
	fresh();
	rep.upsertRepDistrict(districtFile('混在地区', [row('', ''), row('会長', '佐藤')]), state.repState, false);
	assert.deepEqual(checksOf('混在地区'), { 1: true }, 'An empty row with one named chairman is a roster');
	fresh();
	state.repState.districts.push({ district: '混在地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('', ''), row('会長', '本物')], szNeighborChecks: { 1: true } });
	rep.upsertRepDistrict(districtFile('混在地区', [], '1班'), state.repState, false);
	assert.deepEqual(state.repState.districts.find(d => d.han === '1班').neighborhood.map(n => n.lastName), ['', '本物'], 'A mixed roster is a copy source');
	// 氏名・役職がなく、ふりがな・電話・住所だけを持つ行は名簿に数えない。
	fresh();
	state.repState.districts.push({ district: '属性地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '既存')], szNeighborChecks: { 0: true } });
	rep.upsertRepDistrict(districtFile('属性地区', [row('', '', { lastNameKana: 'さとう', tel: '000', address: '東1' })]), state.repState, false);
	assert.deepEqual(state.repState.districts.find(d => d.district === '属性地区').neighborhood.map(n => n.lastName), ['既存'], 'A row with only kana, phone and address is not a roster');
	// 写し元は地区名の完全一致で選ぶ。前後の空白だけが異なる地区名のエントリは写し元にしない。
	fresh();
	state.repState.districts.push({ district: 'S地区 ', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '空白付き')], szNeighborChecks: { 0: true } });
	rep.upsertRepDistrict(districtFile('S地区', [], '1班'), state.repState, false);
	const plain = state.repState.districts.find(d => d.district === 'S地区');
	assert.deepEqual(plain.neighborhood, [], 'Nothing is copied from the spaced district name');
	assert.deepEqual(plain.szNeighborChecks, {});
	assert.deepEqual(checksOf('S地区 '), { 0: true }, 'The spaced entry is unchanged');
});

test('SPEC-Q2: a neighborhood file replaces every same-name roster even with spaces-only or empty rows', () => {
	const blank = [
		{ role: '', lastName: '', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', name: '  ' },
		{ role: ' ', lastName: ' ', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '' }
	];
	for (const [label, rows] of [['spaces-only rows', blank], ['an empty roster', []]]) {
		fresh();
		for (const han of ['1班', '2班']) state.repState.districts.push({ district: '空白地区', han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', '既存')], szNeighborChecks: { 0: true } });
		rep.mergeNeighborDataIntoRep(neighborFile('空白地区', rows), state.repState, false);
		for (const d of state.repState.districts) {
			assert.equal(d.neighborhood.length, rows.length, `${label}: ${d.han} takes the imported rows`);
			assert.ok(d.neighborhood.every(n => n.lastName !== '既存'), `${label}: ${d.han} no longer has the old roster`);
			assert.deepEqual(d.szNeighborChecks, {}, `${label}: ${d.han} has no attendance`);
		}
	}
});

test('SPEC-Q2: outside imports attendance is re-matched only for a person unique in both the representative and the entry roster', () => {
	const entry = (han, neighborhood, checks, selectedForPrint = true) => ({ district: 'A', han, hanList: [han], officers: [], students: [], selectedForPrint, neighborhood, szNeighborChecks: checks });
	// 代表名簿で重複する本人には、出席を引き継がない（旧版と同じ）。
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'X'), row('会長', 'X'), row('書記', 'P')], { 0: true, 1: true }), entry('2班', [row('会長', 'X'), row('書記', 'Q')], { 0: true }), entry('3班', [row('会長', 'X')], { 0: true }, false));
	seat.setDistrictPrintSelection(0, false);
	assert.deepEqual(checksOf('A', '2班'), {}, 'A person duplicated in the representative loses the attendance');
	assert.deepEqual(checksOf('A', '1班'), {}, 'The representative, now not printed, is re-matched too: its duplicated rows lose the attendance');
	assert.deepEqual(checksOf('A', '3班'), {}, 'A non-printed entry that is not the representative is re-matched by the same rule');
	// そのエントリの名簿で重複する本人にも、出席を引き継がない（旧版と同じ）。
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], { 0: true }), entry('2班', [row('会長', 'X'), row('会長', 'X')], { 0: true, 1: true }));
	seat.setDistrictPrintSelection(0, false);
	assert.deepEqual(checksOf('A', '2班'), {}, 'Rows duplicated in the entry lose the attendance');
	// 対照: 両方で一意な本人は、代表名簿の出席を引き継ぐ。
	fresh();
	state.repState.districts.push(entry('1班', [row('会長', 'X'), row('書記', 'P'), row('会計', 'Q')], { 0: true, 1: false }), entry('2班', [row('書記', 'P'), row('会長', 'X')], {}));
	seat.setDistrictPrintSelection(0, false);
	assert.deepEqual(checksOf('A', '2班'), { 0: false, 1: true }, 'A unique person takes the attendance of the representative');
	assert.deepEqual(checksOf('A', '1班'), { 0: true, 1: false }, 'The representative keeps its own attendance');
});

test('SPEC-Q2: matching scales linearly up to the import limit of rows', () => {
	// shift で電話を変えた行は、比較元のどの本人とも一致しない。一致しない行は2乗の照合では名簿全体を走査するため、差が最も大きく出る。
	const rows = (n, shift = 0) => Array.from({ length: n }, (_, i) => row(i === 0 ? '会長' : '理事', '役員' + i, { tel: String(i + shift) }));
	const candidate = (neighborhood, checks = {}) => seat.neighborCheckCandidate({ neighborhood, szNeighborChecks: checks });
	// 他の処理と CPU を取り合う環境でも揺れないよう、壁時計ではなく処理の CPU 時間で測り、3回の最小値を使う。
	const cpuMs = () => { const usage = process.cpuUsage(); return (usage.user + usage.system) / 1000; };
	const best = (setup, run) => {
		let result = Infinity;
		for (let i = 0; i < 3; i++) {
			const context = setup();
			const started = cpuMs();
			run(context);
			result = Math.min(result, cpuMs() - started);
		}
		return result;
	};
	// 照合の本体を直接、受入上限の1万行とその16分の1の行数で測る。取込全体で測ると線形の処理に2乗の分が薄まるためである。
	// CPU 時間の比は、線形の照合で約10〜21、2乗の照合（全体を indexOf で走査する形、位置だけを探す形、clearDuplicatesOf を数える形）で約110〜260だった。
	for (const [label, setup, run] of [
		['resolveImportedNeighborChecks', n => ({ rows: rows(n, n), sources: [candidate(rows(n), { 0: true })] }), c => seat.resolveImportedNeighborChecks(c.rows, c.sources)],
		['alignNeighborChecksToGroup', n => ({ entry: { neighborhood: rows(n, 2 * n), szNeighborChecks: {} }, sources: [candidate(rows(n), { 0: true }), candidate(rows(n, n))], clear: rows(n, n).map(seat.neighborIdentity) }), c => seat.alignNeighborChecksToGroup(c.entry, c.sources, { clearDuplicatesOf: c.clear })],
		['reconcileSeatState', n => {
			fresh();
			state.repState.districts.push(
				{ district: 'P', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: rows(n), szNeighborChecks: { 0: true } },
				{ district: 'P', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: rows(n, n), szNeighborChecks: {} }
			);
			const previous = seat.captureSeatState();
			state.repState.districts[1].selectedForPrint = false;
			return previous;
		}, previous => seat.reconcileSeatState(previous)]
	]) {
		const small = best(() => setup(625), run);
		const large = best(() => setup(10000), run);
		const ratio = large / Math.max(small, 0.2);
		assert.ok(ratio < 48, `${label}: 16 times the rows takes ${ratio.toFixed(1)} times the CPU time (${small.toFixed(2)}ms → ${large.toFixed(1)}ms); quadratic matching takes about 110 to 260 times`);
	}
	assert.deepEqual(checksOf('P', '2班'), {}, 'Nobody of 2班 matches the representative');
	// 可用性の目安として、取込の経路全体も1万行で CPU 時間3秒以内に終わる。
	for (const [label, setup, run] of [
		['neighborhood file', () => { fresh(); state.repState.districts.push({ district: 'P', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: rows(10000), szNeighborChecks: { 0: true } }); }, () => rep.mergeNeighborDataIntoRep(neighborFile('P', rows(10000, 10000)), state.repState, false)],
		['district file with the other 班 rebuilt', () => {
			fresh();
			state.repState.districts.push(
				{ district: 'P', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: rows(10000), szNeighborChecks: { 0: true } },
				{ district: 'P', han: '2班', hanList: ['2班'], officers: [], students: [], selectedForPrint: true, neighborhood: rows(10000, 20000), szNeighborChecks: {} }
			);
		}, () => rep.upsertRepDistrict(districtFile('P', rows(10000, 10000), '1班'), state.repState, false)]
	]) {
		const elapsed = best(setup, run);
		assert.ok(elapsed < 3000, `${label}: 10000 rows within 3s of CPU time (${Math.round(elapsed)}ms)`);
	}
});

test('SPEC-Q2: free-text and facility seats are left as they are by every seat remap', () => {
	// 保存が検証で拒否されると座席が変わらないまま合格するため、保存の失敗がないことも確かめる。
	const saveModal = () => {
		const alerts = [];
		const original = global.alert;
		global.alert = message => { alerts.push(String(message)); original(message); };
		try { rep.saveAndCloseRepDistrictDetailModal(); } finally { global.alert = original; }
		assert.deepEqual(alerts.filter(message => message.includes('失敗')), [], 'The detail modal is saved');
	};
	const extra = () => ({ '2_0': { refKey: 'CUSTOM', customText: '来賓席' }, '2_1': { refKey: 'FAC_STAGE', customText: '' } });
	const check = label => {
		assert.deepEqual(state.repState.seatConfig.cells['2_0'], { refKey: 'CUSTOM', customText: '来賓席' }, `${label}: the free-text seat is unchanged`);
		assert.deepEqual(state.repState.seatConfig.cells['2_1'], { refKey: 'FAC_STAGE', customText: '' }, `${label}: the facility seat is unchanged`);
	};
	const entry = (district, han, neighborhood, checks, selectedForPrint = true) => ({ district, han, hanList: [han], officers: [{ role: '校外委員', lastName: '委員' + han }], students: [], selectedForPrint, neighborhood, szNeighborChecks: checks });
	for (const [label, apply] of [
		['district file', () => rep.upsertRepDistrict(districtFile('東地区', [row('会長', 'B')]), state.repState, false)],
		['neighborhood file', () => rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', 'B')]), state.repState, false)],
		['print selection', () => seat.setDistrictPrintSelection(1, false)],
		['bulk print selection', () => rep.toggleAllDistrictChecks(false)],
		['district deletion', () => rep.deleteRepDistrict(1)],
		['detail modal', () => { rep.openRepDistrictDetailModal(0); rep.updateModalNeighbor(0, 'tel', '9'); saveModal(); }],
		['detail modal changing the seat source', () => { rep.openRepDistrictDetailModal(0); rep.removeModalNeighborRow(1); saveModal(); }]
	]) {
		fresh();
		state.repState.districts.push(entry('東地区', '1班', [row('会長', 'A'), row('書記', 'C')], { 0: true }), entry('東地区', '2班', [row('会長', 'A'), row('副会長', 'D')], { 0: true }));
		state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' }, ...extra() };
		apply();
		check(label);
	}
});

test('SPEC-Q2: neighborChecksResolved skips attendance reconciliation but still remaps seats', () => {
	fresh();
	state.repState.districts = [{ district: '東地区', han: '1班', hanList: ['1班'], officers: [], students: [], selectedForPrint: true, neighborhood: [row('会長', 'A'), row('副会長', 'B'), row('副会長', 'B')], szNeighborChecks: { 0: true, 1: true, 2: true } }];
	state.repState.seatConfig.cells = { '0_0': { refKey: 'NEI_東地区_0', customText: '' } };
	const previous = seat.captureSeatState();
	state.repState.districts[0].neighborhood[0].lastName = '別人';
	seat.reconcileSeatState(previous, {}, state.repState, { neighborChecksResolved: true });
	assert.deepEqual(checksOf('東地区'), { 0: true, 1: true, 2: true }, 'Attendance is left as resolved by the caller');
	assert.equal(state.repState.seatConfig.cells['0_0'].refKey, '', 'A seat of a different person is still cleared');
	seat.reconcileSeatState(seat.captureSeatState(), {}, state.repState, { neighborChecksResolved: 'yes' });
	assert.deepEqual(checksOf('東地区'), { 0: true }, 'Only true skips the reconciliation; duplicated rows lose their checks as before');
});

test('SPEC-Q2: resolveImportedNeighborChecks picks the first candidate with a named row and returns fresh objects', () => {
	const rows = [row('会長', 'A'), row('副会長', 'B'), row('会長', 'C')];
	const ids = list => list.map(seat.neighborIdentity);
	assert.deepEqual(seat.resolveImportedNeighborChecks(rows, []), { 0: true, 2: true }, 'No candidate: the initial rule');
	assert.deepEqual(seat.resolveImportedNeighborChecks(rows, undefined), { 0: true, 2: true });
	assert.deepEqual(seat.resolveImportedNeighborChecks(rows, [null, { identities: ids([row('会長', '')]), checks: { 0: true } }]), { 0: true, 2: true }, 'Name-empty candidates are skipped');
	const candidate = { identities: ids([row('会長', 'A'), row('副会長', 'B')]), checks: { 0: false, 5: true } };
	const second = { identities: ids([row('会長', 'C')]), checks: { 0: false } };
	const result = seat.resolveImportedNeighborChecks(rows, [{ identities: [], checks: {} }, candidate, second]);
	assert.deepEqual(result, { 0: false, 2: true }, 'The first named candidate is used; B has no key; stale keys are dropped');
	assert.notEqual(result, candidate.checks);
	assert.deepEqual(seat.resolveImportedNeighborChecks([], [candidate]), {});
	assert.deepEqual(seat.resolveImportedNeighborChecks('rows', [candidate]), {}, 'Non-array rows');
	assert.deepEqual(seat.resolveImportedNeighborChecks(rows, 'candidate'), { 0: true, 2: true }, 'Non-array candidates are treated as none');
	assert.deepEqual(seat.resolveImportedNeighborChecks(rows, [], { chairmanDefaults: false }), {}, 'No defaults without a base when disabled');
	assert.deepEqual(seat.resolveImportedNeighborChecks(rows, [candidate], { chairmanDefaults: false }), { 0: false }, 'Disabled defaults only carry');
	const blank = [row('会長', 'A'), row('副会長', '')];
	assert.deepEqual(seat.resolveImportedNeighborChecks(blank, [seat.neighborCheckCandidate({ neighborhood: blank, szNeighborChecks: { 0: true, 1: true } })]), { 0: true }, 'A name-empty row never keeps an old true');
	assert.deepEqual(seat.neighborCheckCandidate({}), { identities: [], checks: {} });
	assert.deepEqual(seat.neighborCheckCandidate(null), { identities: [], checks: {} });
	assert.deepEqual(seat.neighborCheckCandidate({ neighborhood: [row('会長', 'A')], szNeighborChecks: null }), { identities: [seat.neighborIdentity(row('会長', 'A'))], checks: {} });
	const inherited = Object.create({ 0: true });
	assert.deepEqual(seat.resolveImportedNeighborChecks([row('会長', 'A')], [{ identities: ids([row('会長', 'A')]), checks: inherited }]), {}, 'Inherited keys are not carried');
});

test('SPEC-Q2: a placeholder created by a neighborhood file is replaced by a district file and keeps the user settings', () => {
	fresh();
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '会長A'), row('副会長', 'B'), row('会計', 'C')]), state.repState, false);
	rep.toggleSzNeighbor(0, 0, false);
	assert.deepEqual(checksOf('東地区'), { 0: false });
	rep.upsertRepDistrict(districtFile('東地区', [row('会長', '会長A'), row('副会長', 'B'), row('書記', '新書記')], '1班'), state.repState, false);
	assert.equal(state.repState.districts.length, 1, 'The placeholder is replaced');
	assert.equal(state.repState.districts[0].han, '1班');
	assert.deepEqual(checksOf('東地区'), { 0: false }, 'The cleared chairman and the key-less 副会長 are carried');

	fresh();
	rep.mergeNeighborDataIntoRep(neighborFile('東地区', [row('会長', '重'), row('会長', '重'), row('副会長', 'B'), row('書記', '')]), state.repState, false);
	state.repState.districts.push({ district: '東地区', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [{ grade: '1', class: '1', lastName: '児童', firstName: '二' }], selectedForPrint: true, neighborhood: [row('会長', 'X')], szNeighborChecks: { 0: true } });
	seat.setDistrictPrintSelection(0, false);
	rep.toggleSzNeighbor(0, 1, true);
	rep.toggleSzNeighbor(0, 3, true);
	assert.deepEqual(checksOf('東地区', ''), { 1: true, 3: true }, 'Control: a duplicated row and a nameless slot of the placeholder are checked in the selector');
	state.repState.districts[1].szNeighborChecks = { 0: true };
	rep.upsertRepDistrict(districtFile('東地区', [], '1班'), state.repState, false);
	const replaced = state.repState.districts.find(d => d.han === '1班');
	assert.equal(state.repState.districts.length, 2, 'The placeholder is replaced, not kept beside a new entry');
	assert.equal(replaced.neighborhood.length, 4, 'A roster-less district file copies the own roster of the placeholder');
	assert.deepEqual(replaced.szNeighborChecks, { 1: true, 3: true }, 'Replacing the placeholder is an own copy: the attendance, including the duplicated row and the nameless slot, is unchanged');
	assert.equal(replaced.selectedForPrint, false, 'The print selection of the placeholder is kept');
	assert.deepEqual(checksOf('東地区', '2班'), { 0: true }, 'An own copy does not rebuild the other entries');
});

test('SPEC-Q2: a district file without a roster is not a replacement', () => {
	fresh();
	rep.upsertRepDistrict(districtFile('東地区', [row('会長', '重'), row('会長', '重'), row('副会長', 'B')], '1班'), state.repState, false);
	rep.toggleSzNeighbor(0, 0, false);
	rep.toggleSzNeighbor(0, 1, false);
	assert.deepEqual(checksOf('東地区', '1班'), { 0: false, 1: false }, 'Duplicated named chairmen block the fallback to 副会長');
	rep.toggleSzNeighbor(0, 2, true);
	rep.upsertRepDistrict(districtFile('東地区', [], '1班'), state.repState, false);
	assert.equal(state.repState.districts[0].neighborhood.length, 3, 'The own roster is protected');
	assert.deepEqual(checksOf('東地区', '1班'), { 0: false, 1: false, 2: true }, 'Own copy: attendance unchanged');

	rep.toggleSzNeighbor(0, 2, false);
	rep.upsertRepDistrict(districtFile('東地区', [], '2班'), state.repState, false);
	assert.equal(state.repState.districts[1].neighborhood.length, 3, 'Another entry copies the protected roster');
	assert.deepEqual(checksOf('東地区', '2班'), { 2: false }, 'Copied from another entry: carried per person, duplicates without a key, no automatic chairman check');
	assert.deepEqual(checksOf('東地区', '1班'), { 2: false }, 'The source entry is rebuilt per person: the duplicated chairmen have no key and B keeps its false');

	fresh();
	rep.upsertRepDistrict(districtFile('北地区', [row('会長', 'N'), row('副会長', 'M')], '1班'), state.repState, false);
	rep.toggleSzNeighbor(0, 1, true);
	rep.upsertRepDistrict(districtFile('北地区', [], '2班'), state.repState, false);
	assert.deepEqual(checksOf('北地区', '2班'), { 0: true, 1: true }, 'Checks of the copied people follow them');

	fresh();
	state.repState.districts.push({ district: '未定義地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [row('会長', 'K')] });
	rep.upsertRepDistrict(districtFile('未定義地区', [], '1班'), state.repState, false);
	assert.equal(state.repState.districts[0].neighborhood[0].lastName, 'K');
	assert.equal(Object.hasOwn(state.repState.districts[0], 'szNeighborChecks'), false, 'Own copy without a check object keeps it undefined');

	fresh();
	rep.upsertRepDistrict(districtFile('南地区', []), state.repState, false);
	assert.deepEqual(checksOf('南地区'), {}, 'No roster anywhere: nobody is checked');

	fresh();
	state.repState.districts.push(
		{ district: 'A', han: '2班', hanList: ['2班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [], szNeighborChecks: { 3: true } },
		{ district: 'A', han: '3班', hanList: ['3班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true, neighborhood: [], szNeighborChecks: { 0: true } }
	);
	rep.upsertRepDistrict(districtFile('A', [], '2班'), state.repState, false);
	assert.deepEqual(checksOf('A', '2班'), {}, 'Nothing to copy: the replaced entry has no attendance');
	assert.deepEqual(checksOf('A', '3班'), { 0: true }, 'Nothing to copy: other same-name entries are not rebuilt');
});

test('SPEC-Q2: a replaced entry without szNeighborChecks or neighborhood is imported without errors', () => {
	fresh();
	state.repState.districts.push({ district: '旧形式地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true });
	assert.doesNotThrow(() => rep.upsertRepDistrict(districtFile('旧形式地区', [row('会長', 'A')]), state.repState, false));
	assert.deepEqual(checksOf('旧形式地区'), { 0: true });
	state.repState.districts[0].szNeighborChecks = null;
	assert.doesNotThrow(() => rep.mergeNeighborDataIntoRep(neighborFile('旧形式地区', [row('会長', 'A'), row('会長', 'B')]), state.repState, false));
	assert.deepEqual(checksOf('旧形式地区'), { 1: true }, 'A null check object carries nothing; the new chairman is checked');

	fresh();
	state.repState.districts.push({ district: '名簿なし地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '委員' }], students: [], selectedForPrint: true });
	assert.doesNotThrow(() => rep.mergeNeighborDataIntoRep(neighborFile('名簿なし地区', [row('副会長', 'A'), row('会長', 'B')]), state.repState, false));
	assert.deepEqual(checksOf('名簿なし地区'), { 1: true }, 'An entry without a neighborhood property gets the initial rule');
	assert.equal(state.repState.districts[0].neighborhood.length, 2);
});

test('SPEC-Q2: replaced rosters with the new chairman check are saved and survive an encrypted relock', async () => {
	const dialogs = fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	await importFiles([
		neighborFile('東地区', [row('会長', '旧会長'), row('副会長', 'B')]),
		neighborFile('東地区', [row('副会長', 'B'), row('会長', '新会長')]),
		districtFile('西地区', [row('会長', '西旧')]),
		districtFile('西地区', [row('書記', 'W'), row('会長', '西新')])
	]);
	assert.ok(dialogs.alerts.every(message => !message.includes('失敗')), JSON.stringify(dialogs.alerts));
	assert.deepEqual(checksOf('東地区'), { 1: true });
	assert.deepEqual(checksOf('西地区'), { 1: true });
	cryptoLib.lockStorage();
	await cryptoLib.unlockStorageWithPassword(PASSWORD);
	await app.loadAppDataFromStorage();
	assert.deepEqual(checksOf('東地区'), { 1: true });
	assert.deepEqual(checksOf('西地区'), { 1: true });
	rep.renderSzNeighborhoodSelector();
	const html = document.getElementById('sz-neighborhood-selector').innerHTML;
	assert.match(html, /<input type="checkbox" checked [^>]*data-index2="1">\s*会長：新会長/);
	assert.match(html, /<input type="checkbox"  [^>]*data-index2="0">\s*副会長：B/);
});

// ---- SPEC-Q4: 年度基準 ----

test('SPEC-Q4: the fiscal year switches on April 1 in local time and invalid dates fall back to today', t => {
	assert.equal(utils.getFiscalYear(new Date(2027, 0, 1, 0, 0, 0)), 2026);
	assert.equal(utils.getFiscalYear(new Date(2027, 2, 31, 23, 59, 59, 999)), 2026);
	assert.equal(utils.getFiscalYear(new Date(2027, 3, 1, 0, 0, 0)), 2027);
	assert.equal(utils.getFiscalYear(new Date(2027, 11, 31, 23, 59, 59)), 2027);
	assert.equal(utils.getFiscalYear(new Date(2000, 1, 29)), 1999);
	withDate(t, '2027-02-10T09:00:00', () => {
		assert.equal(utils.getFiscalYear(), 2026);
		for (const value of [new Date('invalid'), '2030-05-01', 1893456000000, null, {}]) assert.equal(utils.getFiscalYear(value), 2026, `abnormal ${String(value)}`);
	});
});

test('SPEC-Q4: getPeriodPresetDates defaults to the fiscal year and rejects non-integer base years', t => {
	withDate(t, '2027-02-10T09:00:00', () => {
		assert.deepEqual(hata.getPeriodPresetDates('kouki'), { startDate: '2026-10-01', endDate: '2027-03-24' });
		assert.deepEqual(hata.getPeriodPresetDates('zenki', 2030), { startDate: '2030-04-06', endDate: '2030-09-30' }, 'An explicit base year wins');
		for (const value of ['2030', NaN, 2030.5, Infinity, null]) {
			assert.deepEqual(hata.getPeriodPresetDates('zenki', value), { startDate: '2026-04-06', endDate: '2026-09-30' }, `abnormal ${String(value)}`);
		}
	});
});

test('SPEC-Q4: presets use the fiscal year at the year and fiscal-year boundaries', t => {
	const cases = [
		['2027-01-01T00:00:00', 2026], ['2027-03-31T23:59:00', 2026], ['2027-04-01T00:00:00', 2027], ['2027-12-31T23:59:00', 2027]
	];
	for (const [now, year] of cases) {
		fresh();
		state.currentDistrict.hata = { members: '', holidays: '', specials: '' };
		withDate(t, now, () => {
			for (const [preset, start, end] of [['zenki', `${year}-04-06`, `${year}-09-30`], ['kouki', `${year}-10-01`, `${year + 1}-03-24`], ['full', `${year}-04-06`, `${year + 1}-03-24`]]) {
				hata.applyHataPeriodPreset(preset);
				assert.deepEqual([state.currentDistrict.hata.startDate, state.currentDistrict.hata.endDate], [start, end], `${now} ${preset}`);
				assert.deepEqual([document.getElementById('hata-start-date').value, document.getElementById('hata-end-date').value], [start, end], `${now} ${preset} inputs`);
			}
		});
	}
});

function emptyDistrictModel() {
	return { district: '', han: '', hanList: [], officers: [], neighborhood: [], students: [] };
}

test('SPEC-Q4: the initial period and holidays of a new hata stay on the calendar year', t => {
	for (const now of ['2027-02-10T09:00:00', '2027-04-01T00:00:00', '2027-12-31T23:59:00']) {
		fresh();
		state.currentDistrict = emptyDistrictModel();
		withDate(t, now, () => {
			hata.renderHataCard();
			assert.equal(state.currentDistrict.hata.startDate, '2027-04-06', now);
			assert.equal(state.currentDistrict.hata.endDate, '2027-09-30', now);
			const expected = hata.generateJapaneseHolidays(2027, 2028).map(x => `${x.date},${x.name}`).join('\n');
			assert.equal(state.currentDistrict.hata.holidays, expected, 'Holidays are generated from the start year');
			assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', state.currentDistrict), false, `${now}: the generated hata is default data`);
		});
	}
});

test('SPEC-Q4: a previous fiscal-year 前期 set by a preset in January to March is still default data, an edited one is not', t => {
	fresh();
	state.currentDistrict = emptyDistrictModel();
	withDate(t, '2027-02-10T09:00:00', () => {
		hata.renderHataCard();
		hata.applyHataPeriodPreset('zenki');
		assert.deepEqual([state.currentDistrict.hata.startDate, state.currentDistrict.hata.endDate], ['2026-04-06', '2026-09-30']);
		const model = JSON.parse(JSON.stringify(state.currentDistrict));
		delete model.hata.holidays;
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), false, 'Inside the current/previous/next year window');
		model.hata.startDate = '2026-04-07';
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), true, 'An edited period is officer data');
		// 期間の既定判定は暦年（当年とその前後の年）のままである。年度（2026）を基準にしない。
		Object.assign(model.hata, { startDate: '2028-04-06', endDate: '2028-09-30' });
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), false, 'The 前期 of the next calendar year 2028 is default data');
		Object.assign(model.hata, { startDate: '2025-04-06', endDate: '2025-09-30' });
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), true, 'The 前期 of 2025 (two calendar years back) is officer data');
	});
});

test('SPEC-Q4: auto-generated holidays follow the preset fiscal year; empty, edited and drafted holidays are kept', t => {
	const generated = (from, to) => hata.generateJapaneseHolidays(from, to).map(x => `${x.date},${x.name}`).join('\n');
	fresh();
	state.currentDistrict = emptyDistrictModel();
	withDate(t, '2027-02-10T09:00:00', () => {
		hata.renderHataCard();
		assert.equal(state.currentDistrict.hata.holidays, generated(2027, 2028));
		hata.applyHataPeriodPreset('zenki');
		assert.equal(state.currentDistrict.hata.holidays, generated(2026, 2027), 'Regenerated for the fiscal year 2026');
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', state.currentDistrict), false, 'The previous fiscal-year 前期 with regenerated holidays is still default data');
		hata.applyHataPeriodPreset('kouki');
		assert.equal(state.currentDistrict.hata.holidays, generated(2026, 2027), 'Still the fiscal year 2026 list');
		assert.equal(document.getElementById('hata-holidays').value, generated(2026, 2027), 'The input shows the regenerated list');
		assert.match(state.currentDistrict.hata.holidays, /2026-11-03/, 'Autumn holidays of the period are included');
		for (const [label, setup] of [
			['empty', h => { h.holidays = ''; }],
			['empty array', h => { h.holidays = []; }],
			['edited', h => { h.holidays = '2026-11-03,文化の日\n2026-12-28,年末'; }],
			['array edited', h => { h.holidays = [{ date: '2026-12-28', name: '年末' }]; }],
			['drafted', h => { h.holidays = generated(2027, 2028); h.inputDrafts = { holidays: '2026-11-0' }; }]
		]) {
			const h = state.currentDistrict.hata;
			setup(h);
			hata.renderHataCard(); // 保存は入力欄から収集するため、実画面と同じく反映してから押す。
			const before = JSON.stringify(h.holidays);
			const inputBefore = document.getElementById('hata-holidays').value;
			hata.applyHataPeriodPreset('full');
			// 空配列は保存時に入力欄（空欄）から収集されて空文字になる（既存の正規化）。いずれも自動生成されないこと。
			const expected = label === 'empty array' ? '""' : before;
			assert.equal(JSON.stringify(state.currentDistrict.hata.holidays), expected, `${label} holidays are kept`);
			assert.equal(document.getElementById('hata-holidays').value, inputBefore, `${label} input is kept`);
			if (label === 'drafted') {
				assert.equal(state.currentDistrict.hata.inputDrafts?.holidays, '2026-11-0', 'The holiday draft is kept');
				assert.equal(inputBefore, '2026-11-0', 'The input shows the draft');
			}
			delete state.currentDistrict.hata.inputDrafts;
		}
	});
	fresh();
	state.currentDistrict = emptyDistrictModel();
	withDate(t, '2027-05-10T09:00:00', () => {
		hata.renderHataCard();
		hata.applyHataPeriodPreset('kouki');
		assert.equal(state.currentDistrict.hata.holidays, generated(2027, 2028), 'Same fiscal year: unchanged');
	});
	fresh();
	state.currentDistrict = emptyDistrictModel();
	state.currentDistrict.hata = { title: '登校見守り活動シフト表', startDate: '2026-04-06', endDate: '2026-09-30', holidays: generated(2026, 2027), members: '', specials: '' };
	withDate(t, '2027-05-10T09:00:00', () => {
		hata.renderHataCard();
		hata.applyHataPeriodPreset('zenki');
		assert.equal(state.currentDistrict.hata.holidays, generated(2027, 2028), 'A list carried over from the previous fiscal year is replaced in May');
		state.currentDistrict.hata.holidays = generated(2025, 2026);
		hata.renderHataCard();
		hata.applyHataPeriodPreset('kouki');
		assert.equal(state.currentDistrict.hata.holidays, generated(2025, 2026), 'A list of another year is not treated as auto-generated');
		const model = { ...emptyDistrictModel(), hata: { startDate: '2027-04-06', endDate: '2027-09-30', holidays: generated(2025, 2026) } };
		assert.equal(cryptoLib.isDefaultHolidayValue(model.hata), false, 'A list of neither the start year nor the current year is not default');
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), true);
		model.hata.holidays = generated(2027, 2028);
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), false, 'The same model with the start-year list is default data');
	});
});

test('SPEC-Q4: only a holiday draft blocks the replacement, and lists of the start year, the current year or (without a start date) the neighbouring years are replaced', t => {
	const generated = (from, to) => hata.generateJapaneseHolidays(from, to).map(x => `${x.date},${x.name}`).join('\n');
	const holidayInput = () => document.getElementById('hata-holidays').value;
	const at = (config, run, now = '2027-02-10T09:00:00') => {
		fresh();
		state.currentDistrict = { ...emptyDistrictModel(), hata: { title: '登校見守り活動シフト表', members: '', specials: '', ...config } };
		withDate(t, now, () => { hata.renderHataCard(); run(state.currentDistrict.hata); });
	};
	// 他の項目だけの下書きは置き換えを妨げない。プリセットの保存で、その下書きも採用される。
	for (const [label, drafts, check] of [
		['a title draft', { title: '下書きの題名' }, h => { assert.equal(h.title, '下書きの題名'); assert.equal(document.getElementById('hata-title').value, '下書きの題名'); }],
		['an unfinished end-date draft', { endDate: '2027-0' }, h => assert.equal(h.endDate, '2026-09-30', 'The preset end date replaces the unfinished draft')]
	]) {
		at({ startDate: '2027-04-06', endDate: '2027-09-30', holidays: generated(2027, 2028), inputDrafts: { ...drafts } }, h => {
			hata.applyHataPeriodPreset('zenki');
			assert.equal(h.holidays, generated(2026, 2027), `${label}: the holidays follow the fiscal year 2026`);
			assert.equal(holidayInput(), generated(2026, 2027), `${label}: the input shows the fiscal-year list`);
			assert.equal(h.inputDrafts, undefined, `${label}: the drafts are adopted`);
			check(h);
		});
	}
	// 開始日の下書きも置換えを妨げない。自動生成の判定には、下書きでなく有効な開始日（2028年）を使う。
	at({ startDate: '2028-04-06', endDate: '2028-09-30', holidays: generated(2028, 2029), inputDrafts: { startDate: '2029-0' } }, h => {
		assert.equal(document.getElementById('hata-start-date').value, '2029-0', 'The input shows the unfinished start-date draft');
		hata.applyHataPeriodPreset('zenki');
		assert.equal(h.holidays, generated(2026, 2027), 'The list of the effective start year is replaced');
		assert.equal(holidayInput(), generated(2026, 2027));
		assert.equal(h.inputDrafts, undefined, 'The start-date draft is replaced by the preset and adopted');
		assert.deepEqual([h.startDate, h.endDate], ['2026-04-06', '2026-09-30']);
	});
	// 配列で持つ自動生成の一覧も置き換え、文字列の一覧として保存する。
	at({ startDate: '2027-04-06', endDate: '2027-09-30', holidays: hata.generateJapaneseHolidays(2027, 2028) }, h => {
		assert.ok(Array.isArray(h.holidays) && h.holidays.length > 0);
		hata.applyHataPeriodPreset('zenki');
		assert.equal(h.holidays, generated(2026, 2027), 'An auto-generated array is replaced with the fiscal-year list');
		assert.equal(holidayInput(), generated(2026, 2027));
		assert.equal(h.inputDrafts, undefined);
	});
	// 空欄にした休日の下書きも下書きである。自動生成の一覧へ戻さず、空欄のまま採用する。
	at({ startDate: '2027-04-06', endDate: '2027-09-30', holidays: generated(2027, 2028), inputDrafts: { holidays: '' } }, h => {
		assert.equal(holidayInput(), '', 'The input shows the empty draft');
		hata.applyHataPeriodPreset('zenki');
		assert.equal(h.holidays, '', 'The cleared holidays are not replaced');
		assert.equal(holidayInput(), '', 'The input stays empty');
		assert.equal(h.inputDrafts, undefined);
		assert.deepEqual([h.startDate, h.endDate], ['2026-04-06', '2026-09-30']);
	});
	// 開始日の年でなく、現在の年の一覧と一致する場合も自動生成として扱う。
	at({ startDate: '2026-10-01', endDate: '2027-03-24', holidays: generated(2027, 2028) }, h => {
		assert.equal(cryptoLib.isDefaultHolidayValue(h), true, 'The list matches the current year 2027, not the start year 2026');
		hata.applyHataPeriodPreset('full');
		assert.equal(h.holidays, generated(2026, 2027), 'Replaced with the fiscal-year list');
		assert.equal(holidayInput(), generated(2026, 2027));
	});
	// 開始日があれば、開始日の年と当年の一覧だけを自動生成として扱う。当年の前年・翌年や開始日の翌年の一覧は保持する。
	for (const [now, startDate, endDate, from] of [
		['2027-02-10T09:00:00', '2026-10-01', '2027-03-24', 2028],
		['2027-05-10T09:00:00', '2027-04-06', '2027-09-30', 2028],
		['2027-05-10T09:00:00', '2027-04-06', '2027-09-30', 2026]
	]) {
		at({ startDate, endDate, holidays: generated(from, from + 1) }, h => {
			const label = `${now.slice(0, 10)}, start ${startDate}, ${from}-${from + 1} list`;
			assert.equal(cryptoLib.isDefaultHolidayValue(h), false, `${label}: neither the start year nor the current year`);
			hata.applyHataPeriodPreset('zenki');
			assert.equal(h.holidays, generated(from, from + 1), `${label}: kept`);
			assert.equal(holidayInput(), generated(from, from + 1), `${label}: the input is kept`);
			assert.equal(cryptoLib.isDefaultHolidayValue(h), false, `${label}: still not auto-generated after the preset`);
		}, now);
	}
	// 1〜3月に、開始日（2027年）と異なるプリセットの年度（2026）の一覧を持つ場合も、既定とは判定しない。
	at({ startDate: '2027-04-06', endDate: '2027-09-30', holidays: generated(2026, 2027) }, h => {
		assert.equal(cryptoLib.isDefaultHolidayValue(h), false, 'The fiscal-year list is neither the start year nor the current year');
		const model = { ...emptyDistrictModel(), hata: { startDate: h.startDate, endDate: h.endDate, holidays: h.holidays } };
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), true, 'It is officer data');
		model.hata.holidays = generated(2027, 2028);
		assert.equal(cryptoLib.hasOfficerData('kogai_district_v2', model), false, 'Control: the start-year list is default data');
	});
	// 開始日・終了日が空なら、現在の年とその前後の年の一覧を自動生成として扱う。それ以外の年は保持する。
	// 4〜12月は年度と前年が異なるため、前年の一覧が年度の一覧へ置き換わることを区別できる。
	for (const [now, fiscalYear, from, replaced] of [
		['2027-02-10T09:00:00', 2026, 2028, true], ['2027-02-10T09:00:00', 2026, 2027, true], ['2027-02-10T09:00:00', 2026, 2026, true],
		['2027-02-10T09:00:00', 2026, 2029, false], ['2027-02-10T09:00:00', 2026, 2025, false],
		['2027-05-10T09:00:00', 2027, 2026, true], ['2027-05-10T09:00:00', 2027, 2028, true],
		['2027-05-10T09:00:00', 2027, 2029, false], ['2027-05-10T09:00:00', 2027, 2025, false]
	]) {
		at({ startDate: '', endDate: '', holidays: generated(from, from + 1) }, h => {
			const label = `${now.slice(0, 10)}: a ${from}-${from + 1} list without a start date`;
			assert.equal(holidayInput(), generated(from, from + 1));
			assert.equal(cryptoLib.isDefaultHolidayValue(h), replaced, `${label} is ${replaced ? '' : 'not '}auto-generated`);
			hata.applyHataPeriodPreset('full');
			const expected = replaced ? generated(fiscalYear, fiscalYear + 1) : generated(from, from + 1);
			assert.equal(h.holidays, expected, `${label} is ${replaced ? 'replaced' : 'kept'}`);
			assert.equal(holidayInput(), expected);
			assert.deepEqual([h.startDate, h.endDate], [`${fiscalYear}-04-06`, `${fiscalYear + 1}-03-24`], 'The preset period applies');
		}, now);
	}
});

test('SPEC-Q4: outside the holiday generator range the preset period applies and the holidays are kept', t => {
	const generated = (from, to) => hata.generateJapaneseHolidays(from, to).map(x => `${x.date},${x.name}`).join('\n');
	for (const [now, start, list, expected] of [
		['2000-05-10T09:00:00', '2001-04-06', generated(2001, 2002), generated(2000, 2001)],
		['2100-02-10T09:00:00', '2098-04-06', generated(2098, 2099), generated(2099, 2099)]
	]) {
		fresh();
		state.currentDistrict = emptyDistrictModel();
		state.currentDistrict.hata = { title: '登校見守り活動シフト表', startDate: start, endDate: `${start.slice(0, 4)}-09-30`, holidays: list, members: '', specials: '' };
		withDate(t, now, () => {
			hata.renderHataCard();
			hata.applyHataPeriodPreset('zenki');
			assert.equal(state.currentDistrict.hata.holidays, expected, `${now}: the in-range boundary regenerates`);
		});
	}
	fresh();
	state.currentDistrict = emptyDistrictModel();
	withDate(t, '2000-02-10T09:00:00', () => {
		hata.renderHataCard();
		assert.equal(state.currentDistrict.hata.holidays, generated(2000, 2001));
		hata.applyHataPeriodPreset('zenki');
		assert.deepEqual([state.currentDistrict.hata.startDate, state.currentDistrict.hata.endDate], ['1999-04-06', '1999-09-30']);
		assert.equal(state.currentDistrict.hata.holidays, generated(2000, 2001), 'Fiscal year 1999 cannot be generated, so the list is kept');
	});
	fresh();
	state.currentDistrict = emptyDistrictModel();
	state.currentDistrict.hata = { title: '登校見守り活動シフト表', startDate: '2099-04-06', endDate: '2099-09-30', holidays: generated(2099, 2099), members: '', specials: '' };
	withDate(t, '2100-05-10T09:00:00', () => {
		hata.renderHataCard();
		hata.applyHataPeriodPreset('kouki');
		assert.deepEqual([state.currentDistrict.hata.startDate, state.currentDistrict.hata.endDate], ['2100-10-01', '2101-03-24']);
		assert.equal(state.currentDistrict.hata.holidays, generated(2099, 2099), 'Fiscal year 2100 is not generated and the list is not emptied');
	});
});

test('SPEC-Q4: when only the regenerated holidays exceed the expansion budget, period and holidays stay effective and both are kept as drafts', async t => {
	const generated = (from, to) => hata.generateJapaneseHolidays(from, to).map(x => `${x.date},${x.name}`).join('\n');
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.currentDistrict = emptyDistrictModel();
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-02-10T09:00:00') });
	try {
		hata.renderHataCard();
		const initialCount = hata.generateJapaneseHolidays(2027, 2028).length;
		const fiscalCount = hata.generateJapaneseHolidays(2026, 2027).length;
		assert.equal(state.currentDistrict.hata.holidays, generated(2027, 2028), 'Control: the initial holidays are the calendar-year list');
		assert.ok(fiscalCount > initialCount, 'Control: the fiscal-year list is longer than the initial list');
		const room = 3660 - initialCount;
		const end = new Date(Date.UTC(2000, 0, 1) + (room - 1) * 86400000).toISOString().slice(0, 10);
		state.currentDistrict.hata.specials = `2000-01-01〜${end},固定担当,特別`;
		hata.renderHataCard();
		assert.equal(utils.validateHataExpansionBudget(state.currentDistrict.hata), 3660, 'Control: holidays and specials fill the budget exactly');
		assert.equal(await saveDistrictLocal(), true);
		const h = state.currentDistrict.hata;
		const before = [h.startDate, h.endDate, h.holidays];
		assert.equal(utils.validateHataExpansionBudget({ ...h, startDate: '2026-04-06', endDate: '2026-09-30' }), 3660, 'Control: the new period alone stays within the budget');
		hata.applyHataPeriodPreset('zenki');
		assert.deepEqual([h.startDate, h.endDate, h.holidays], before, 'Neither the period nor the holidays become effective');
		assert.deepEqual([h.inputDrafts?.startDate, h.inputDrafts?.endDate, h.inputDrafts?.holidays], ['2026-04-06', '2026-09-30', generated(2026, 2027)], 'The period and the regenerated holidays are kept together as drafts');
		assert.equal(document.getElementById('hata-holidays').value, generated(2026, 2027), 'The regenerated list is shown');
		const status = document.getElementById('hata-input-status');
		assert.equal(status.hidden, false, 'The input status notice is shown');
		assert.match(status.textContent, /上限/, 'The notice explains the limit');
	} finally { t.mock.timers.reset(); }
});

test('SPEC-Q4: an over-budget preset with regenerated holidays keeps both effective values and leaves a draft that survives a relock', async t => {
	const generated = (from, to) => hata.generateJapaneseHolidays(from, to).map(x => `${x.date},${x.name}`).join('\n');
	const relock = async () => {
		cryptoLib.lockStorage();
		await cryptoLib.unlockStorageWithPassword(PASSWORD);
		await app.loadAppDataFromStorage();
		hata.renderHataCard();
	};
	fresh();
	await cryptoLib.setupStorageEncryption(PASSWORD, false);
	state.currentDistrict = emptyDistrictModel();
	t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-02-10T09:00:00') });
	try {
		hata.renderHataCard();
		state.currentDistrict.hata.members = 'あ'.repeat(1200);
		hata.renderHataCard();
		assert.equal(await saveDistrictLocal(), true);
		const committed = JSON.stringify([state.currentDistrict.hata.startDate, state.currentDistrict.hata.endDate, state.currentDistrict.hata.holidays]);
		hata.applyHataPeriodPreset('full');
		let h = state.currentDistrict.hata;
		assert.equal(JSON.stringify([h.startDate, h.endDate, h.holidays]), committed, 'Effective period and holidays are unchanged');
		assert.equal(h.inputDrafts.holidays, generated(2026, 2027), 'The regenerated list is kept as a draft');
		assert.equal(document.getElementById('hata-holidays').value, generated(2026, 2027));
		const status = document.getElementById('hata-input-status');
		assert.equal(status.hidden, false, 'The input status notice is shown');
		assert.match(status.textContent, /上限/, 'The notice explains the limit');
		assert.equal(await saveDistrictLocal(), true, 'The over-budget state with drafts is saved');
		await relock();
		h = state.currentDistrict.hata;
		assert.equal(cryptoLib.isStorageUnlocked(), true, 'The stored over-budget state unlocks');
		assert.equal(h.inputDrafts.holidays, generated(2026, 2027), 'The holiday draft survives the relock');
		assert.equal(JSON.stringify([h.startDate, h.endDate, h.holidays]), committed, 'Effective values survive unchanged');

		const editedDraft = `${generated(2026, 2027)}\n2026-12-28,年末`;
		h.inputDrafts.holidays = editedDraft;
		document.getElementById('hata-holidays').value = editedDraft;
		hata.applyHataPeriodPreset('zenki');
		// 上限内の次のプリセットでは、既存の下書きは期間と一括で採用される（collectHataScheduleInputs の既存動作）。自動生成では置き換えない。
		assert.equal(state.currentDistrict.hata.inputDrafts, undefined, 'The in-budget preset commits the pending drafts');
		assert.equal(state.currentDistrict.hata.holidays, editedDraft, 'The edited holiday draft is adopted, not replaced by a regenerated list');
		assert.equal(document.getElementById('hata-holidays').value, editedDraft);
		assert.equal(await saveDistrictLocal(), true);
		await relock();
		assert.equal(state.currentDistrict.hata.holidays, editedDraft, 'The adopted holidays survive a relock');
		assert.deepEqual([state.currentDistrict.hata.startDate, state.currentDistrict.hata.endDate], ['2026-04-06', '2026-09-30']);
	} finally { t.mock.timers.reset(); }
});

// ---- SPEC-Q3: 年度更新の旗振り下書き（現行仕様の維持） ----

test('SPEC-Q3: the district year update discards hata drafts and period while keeping the basic settings; cancel keeps everything', () => {
	const dialogs = fresh();
	state.currentDistrict.hata = { title: '見守り', location: '正門', time: '7:50', startDate: '2026-04-06', endDate: '2026-09-30', members: '1-2 佐藤', holidays: '2026-05-03,祝', specials: '2026-04-10,1,入学式', inputDrafts: { endDate: '2026-1', specials: '2026-04-1' } };
	// 保存は画面の入力欄から収集するため、実画面と同じく描画してから操作する。
	hata.renderHataCard();
	assert.equal(document.getElementById('hata-location').value, '正門');
	const before = JSON.stringify(state.currentDistrict);
	dialogs.confirmAnswer = false;
	district.runDistrictYearUpdate();
	assert.equal(JSON.stringify(state.currentDistrict), before, 'Cancelled update changes nothing, drafts included');
	dialogs.confirmAnswer = true;
	district.runDistrictYearUpdate();
	const h = state.currentDistrict.hata;
	assert.equal(h.inputDrafts, undefined, 'Drafts are discarded');
	assert.deepEqual([h.startDate, h.endDate, h.members, h.holidays, h.specials], ['', '', '', '', '']);
	assert.deepEqual([h.title, h.location, h.time], ['見守り', '正門', '7:50']);
});
