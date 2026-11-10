const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
require('../../js/utils');
require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');

test('hata complete: upstream JSON import and legacy aliases preserve all fields including explicit empty strings', () => {
	const official = { title: '', createdDate: '作成日：2026年11月10日', district: '印刷専用地区', location: '', time: '朝\n夕', orientation: 'landscape', layoutColumns: '6', startDate: '2026-11-09', endDate: '2026-11-15', weekdays: [], members: '', holidays: '', specials: '', headerMsg: '', footerMsg: '', contactMsg: '', format: '{氏名}', dedup: false, exemptHouseholds: ['担当'], manualOverrides: {} };
	const imported = hata.importHataOfficialJson(JSON.stringify(official));
	for (const [key, value] of Object.entries(official)) assert.deepEqual(imported[key], value, key);
	assert.equal(hata.exportHataOfficialJson, undefined, 'Official JSON export API is removed');
	assert.equal(hata.importHataOfficialJson({ scheduleTitle: '旧形式', metaLocation: '旧場所' }).title, '旧形式');
	assert.throws(() => hata.importHataOfficialJson({ dedup: 'false' }));
});

test('hata complete: rendering and regeneration preserve a manually edited or empty roster', () => {
	setupDomEnvironment();
	state.currentDistrict = { students: [{ lastName: '児童側', address: '1-2' }], hata: { startDate: '2026-11-09', endDate: '2026-11-13', holidays: '', members: '外部担当\n編集担当', weekdays: [1, 3, 5] } };
	hata.renderHataCard();
	hata.runAutoHataGeneration();
	assert.equal(state.currentDistrict.hata.members, '外部担当\n編集担当');
	assert.ok(document.getElementById('hata-schedule-preview').innerHTML.includes('外部担当'));
	state.currentDistrict.hata.members = '';
	document.getElementById('hata-members').value = '';
	hata.runAutoHataGeneration();
	assert.equal(state.currentDistrict.hata.members, '');
	assert.ok(!document.getElementById('hata-schedule-preview').innerHTML.includes('児童側'));
});

test('hata complete: LINE text carries metadata, holidays, special slots and all notices', () => {
	const config = { title: '見守り', district: '印刷地区', location: '正門', time: '朝\n夕', headerMsg: '上部', footerMsg: '下部', contactMsg: '連絡先' };
	const schedule = [{ date: '2026-11-09', day: '月', type: 'regular', person: '担当A' }, { date: '2026-11-10', day: '火', type: 'holiday', person: '-', note: '休校' }, { date: '2026-11-11', day: '水', type: 'special', person: '担当B', note: '行事' }];
	const text = hata.buildHataLineText(schedule, config);
	for (const part of ['見守り', '印刷地区', '正門', '朝\n夕', '上部', '下部', '連絡先', '11/09(月): 担当A', '休み（休校）', '★担当B（行事）']) assert.ok(text.includes(part), part);
});

test('hata complete: weekday selection and duplicate warning treat hostile names as text', () => {
	setupDomEnvironment();
	state.currentDistrict = { hata: { members: '__proto__\n山田\n__proto__\n山田\n' } };
	assert.deepEqual(hata.checkHataMemberDuplicates(), ['__proto__', '山田']);
	assert.ok(document.getElementById('hata-duplicate-alert').textContent.includes('__proto__'));
	const schedule = hata.generateHataSchedule({ startDate: '2026-11-09', endDate: '2026-11-15', weekdays: [], members: 'A', specials: '2026-11-14,,特別' });
	assert.deepEqual(schedule.map(row => row.date), ['2026-11-14']);
});

test('hata complete: LINE copy uses the current roster, supports denied clipboard and refuses an empty schedule', async () => {
	setupDomEnvironment();
	state.currentDistrict = { district: '地区', hata: { title: 'コピー対象', members: '担当', startDate: '2026-11-09', endDate: '2026-11-09', weekdays: [1], holidays: '' } };
	const messages = [];
	global.alert = message => messages.push(message);
	let copied;
	navigator.clipboard.writeText = async text => { copied = text; };
	await hata.copyHataForLine();
	assert.ok(copied.includes('11/09(月): 担当'));
	assert.equal(document.getElementById('hata-line-text').value, copied);
	navigator.clipboard.writeText = async () => { throw new Error('denied'); };
	let selected = false;
	document.getElementById('hata-line-text').select = () => { selected = true; };
	await hata.copyHataForLine();
	assert.equal(selected, true);
	assert.ok(messages.at(-1).includes('選択してコピー'));
	state.currentDistrict.hata.weekdays = [];
	await hata.copyHataForLine();
	assert.ok(messages.at(-1).includes('期間と曜日'));
});

test('hata complete: file save status keeps edits made during encryption and explicit student sync updates duplicate warnings', () => {
	setupDomEnvironment();
	state.currentDistrict = { students: [{ lastName: '山田', address: '1-2' }], hata: { members: '編集済み', holidays: '' } };
	hata.renderHataCard();
	const earlier = JSON.stringify(state.currentDistrict.hata);
	state.currentDistrict.hata.title = '暗号化中の変更';
	hata.markHataDirty();
	hata.markHataSaved(earlier);
	assert.ok(document.getElementById('hata-save-status').textContent.includes('未保存'));
	hata.markHataSaved(JSON.stringify(state.currentDistrict.hata));
	assert.ok(document.getElementById('hata-save-status').textContent.includes('保存・読込済み'));
	global.confirm = () => false;
	assert.equal(hata.syncHataMembersFromStudents(), '編集済み');
	global.confirm = () => true;
	assert.equal(hata.syncHataMembersFromStudents(), '1-2 山田');
	assert.equal(document.getElementById('hata-duplicate-alert').hidden, true);
	assert.equal(document.getElementById('hata-line-text').hidden, true);
	assert.equal(hata.getHataFilenameDate({ createdDate: '作成日：2026年1月2日' }), '20260102');
	assert.match(hata.getHataFilenameDate({ createdDate: '' }), /^\d{8}$/);
});

test('hata complete: legacy missing roster initializes once, and all weekday and cleared preferences are collected', () => {
	setupDomEnvironment();
	state.currentDistrict = { district: '地区', students: [{ lastName: '初期担当', address: '2-3' }], hata: { weekdays: [1, 6], holidays: '', dedup: false } };
	for (const day of [0, 1, 6]) {
		const box = document.createElement('input');
		box.setAttribute('name', 'hata-weekday');
		box.setAttribute('data-change', 'updateHataWeekdays');
		box.value = day;
		document.body.appendChild(box);
	}
	hata.renderHataCard();
	assert.equal(state.currentDistrict.hata.members, '2-3 初期担当');
	const days = document.querySelectorAll('[name="hata-weekday"]');
	assert.deepEqual(days.map(box => box.checked), [false, true, true]);
	state.saveDistrictLocal();
	assert.deepEqual(state.currentDistrict.hata.weekdays, [1, 6]);
	assert.equal(state.currentDistrict.hata.dedup, false);
	days.forEach(box => { box.checked = false; });
	document.getElementById('hata-members').value = '';
	document.getElementById('hata-title').value = '';
	state.saveDistrictLocal();
	assert.deepEqual(state.currentDistrict.hata.weekdays, []);
	assert.equal(state.currentDistrict.hata.members, '');
	assert.equal(state.currentDistrict.hata.title, '');
	state.currentDistrict.students.push({ lastName: '後から追加', address: '4-5' });
	hata.renderHataCard();
	assert.equal(state.currentDistrict.hata.members, '', 'An explicit empty roster is not repopulated after student changes');
});

test('hata complete: minimal LINE and JSON inputs use safe defaults and retain stored schedule extensions', () => {
	setupDomEnvironment();
	state.currentDistrict = { district: '地区' };
	assert.ok(hata.buildHataLineText(null).includes('地区: 地区'));
	const text = hata.buildHataLineText([
		{ date: '2026-11-09', dayOfWeek: '月', type: 'holiday' },
		{ date: '2026-11-10', dayOfWeek: '火', type: 'special', person: '担当' }
	]);
	assert.ok(text.includes('11/09(月): 休み（祝日）'));
	assert.ok(text.includes('11/10(火): ★担当（特別枠）'));
	const schedule = [{ date: '2026-11-09', person: '担当' }];
	assert.deepEqual(hata.importHataOfficialJson({ schedule }).schedule, schedule);
	assert.equal(hata.importHataOfficialJson({ title: '', scheduleTitle: '旧名' }).title, '', 'Explicit current key has priority over legacy alias');
});
