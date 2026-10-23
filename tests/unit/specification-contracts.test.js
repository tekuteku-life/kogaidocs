const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupDomEnvironment } = require('../helpers/dom-mock');

setupDomEnvironment();
require('../../js/utils');
const crypt = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
require('../../js/seat');
const rep = require('../../js/rep');
const print = require('../../js/print');

function parse(html) {
	const element = document.createElement('div');
	element.innerHTML = html;
	return element;
}

// モックのtextContentは子要素へ伝播しないため、子孫のテキストも集める。
function text(element) {
	return [element.textContent, ...element.children.map(text)].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function cssDeclarations(selector) {
	const css = fs.readFileSync(path.resolve(__dirname, '../../css/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
	const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) => selectors.trim() === selector);
	assert.ok(rule, `${selector} has a CSS rule`);
	return Object.fromEntries(rule[2].split(';').map(part => part.split(':').map(value => value.trim())).filter(parts => parts.length === 2));
}

test('specification PTA privacy: general officer contacts, addresses and child identities are excluded while core contacts remain', () => {
	setupDomEnvironment();
	const officers = [
		{ role: '校外委員', lastName: '一般役員', firstName: '一郎', childGrade: '4', tel: 'GENERAL_TEL_CANARY', email: 'GENERAL_EMAIL_CANARY', address: 'GENERAL_ADDRESS_CANARY', childLastName: 'GENERAL_CHILD_SURNAME_CANARY', childFirstName: 'GENERAL_CHILD_FIRST_CANARY', childClass: 'GENERAL_CLASS_CANARY' },
		{ role: '代表', lastName: '代表役員', firstName: '二郎', childGrade: '6', tel: 'CORE_TEL_CANARY', email: 'CORE_EMAIL_CANARY', address: 'CORE_ADDRESS_CANARY', childLastName: 'CORE_CHILD_SURNAME_CANARY', childFirstName: 'CORE_CHILD_FIRST_CANARY', childClass: 'CORE_CLASS_CANARY' }
	];
	const page = parse(print.buildPtaOfficersRosterPageHtml([{ district: '検証地区', officers }]));
	const bodyText = text(page);
	assert.ok(bodyText.includes('一般役員 一郎'));
	assert.ok(bodyText.includes('代表役員 二郎'));
	assert.ok(bodyText.includes('4年') && bodyText.includes('6年'), 'Child grades remain available for PTA use');
	assert.ok(bodyText.includes('CORE_TEL_CANARY') && bodyText.includes('CORE_EMAIL_CANARY'), 'Authorized core contacts remain available');
	const withheld = [
		'GENERAL_TEL_CANARY', 'GENERAL_EMAIL_CANARY', 'GENERAL_ADDRESS_CANARY',
		'GENERAL_CHILD_SURNAME_CANARY', 'GENERAL_CHILD_FIRST_CANARY', 'GENERAL_CLASS_CANARY',
		'CORE_ADDRESS_CANARY', 'CORE_CHILD_SURNAME_CANARY', 'CORE_CHILD_FIRST_CANARY', 'CORE_CLASS_CANARY'
	];
	for (const value of withheld) assert.ok(!bodyText.includes(value), `PTA output excludes ${value}`);
	const coreBlock = page.querySelector('.pta-sanyaku-block');
	assert.ok(!text(coreBlock).includes('一般役員'), 'General officers never enter the contact block');
	assert.ok(text(coreBlock).includes('代表役員 二郎'));
});

// 期待日をUTCの暦から求め、生成関数やその休日展開関数を期待値計算に使わない。
function weekdaysBetween(start, end) {
	const dates = [];
	for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86400000) {
		const date = new Date(time);
		if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) dates.push(date.toISOString().slice(0, 10));
	}
	return dates;
}

for (const [name, members, exemptions, period] of [
	['no households', [], [], ['2026-10-19', '2026-10-23']],
	['single household', ['101 山田'], [], ['2026-10-19', '2026-10-23']],
	['exact multiple', ['101 山田', '202 佐藤', '303 鈴木'], [], ['2026-10-19', '2026-10-26']],
	['remainder', ['101 山田', '202 佐藤', '303 鈴木'], [], ['2026-10-19', '2026-10-23']],
	['key and display-name exemptions', ['101 山田', '202 佐藤', '303 鈴木', '404 高橋', '505 田中'], ['202_佐藤', '404 高橋'], ['2026-10-19', '2026-10-30']],
	['all households exempt', ['101 山田', '202 佐藤'], ['101_山田', '202 佐藤'], ['2026-10-19', '2026-10-23']]
]) {
	test(`specification flag fairness: ${name} allocates each regular date exactly once with a count difference at most one`, () => {
		const active = members.filter(member => !exemptions.includes(member) && !exemptions.includes(member.replace(/\s+/g, '_')));
		const schedule = hata.generateHataSchedule({ startDate: period[0], endDate: period[1], weekdays: [1, 2, 3, 4, 5], members: members.join('\n'), exemptHouseholds: exemptions });
		assert.deepEqual(schedule.map(row => row.date), weekdaysBetween(...period), 'Every permitted date appears exactly once in chronological order');
		assert.ok(schedule.every(row => row.type === 'regular'));
		assert.deepEqual(schedule.map(row => row.person), schedule.map((_, index) => active.length ? active[index % active.length] : ''), 'The eligible household order is preserved across rounds');
		const counts = active.map(member => schedule.filter(row => row.person === member).length);
		if (counts.length) assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'Regular assignment counts differ by at most one');
		else assert.ok(schedule.every(row => row.person === ''), 'No household is invented when none is eligible');
	});
}

test('specification flag fairness: holidays and fixed specials consume no regular turn; a manual override changes only its date', () => {
	const config = { startDate: '2026-10-19', endDate: '2026-10-30', weekdays: [1, 2, 3, 4, 5], members: '101 山田\n202 佐藤\n303 鈴木', holidays: '2026-10-20,休校', specials: '2026-10-21,固定担当,行事' };
	const schedule = hata.generateHataSchedule(config);
	assert.deepEqual(schedule.map(row => row.date), weekdaysBetween(config.startDate, config.endDate));
	assert.equal(schedule.find(row => row.date === '2026-10-20').person, '-');
	assert.equal(schedule.find(row => row.date === '2026-10-20').type, 'holiday');
	assert.equal(schedule.find(row => row.date === '2026-10-21').person, '固定担当');
	assert.equal(schedule.find(row => row.date === '2026-10-21').type, 'special');
	const regular = schedule.filter(row => row.type === 'regular');
	const eligible = ['101 山田', '202 佐藤', '303 鈴木'];
	assert.deepEqual(regular.map(row => row.date), weekdaysBetween(config.startDate, config.endDate).filter(date => !['2026-10-20', '2026-10-21'].includes(date)));
	assert.deepEqual(regular.map(row => row.person), regular.map((_, index) => eligible[index % eligible.length]));
	const counts = eligible.map(person => regular.filter(row => row.person === person).length);
	assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
	const changed = hata.generateHataSchedule({ ...config, manualOverrides: { '2026-10-22': { person: '臨時担当', note: '手動調整', isSwapped: true } } });
	assert.equal(changed.find(row => row.date === '2026-10-22').person, '臨時担当');
	assert.deepEqual(changed.filter(row => row.date !== '2026-10-22'), schedule.filter(row => row.date !== '2026-10-22'), 'A manual override must not shift later turns');
});

test('specification tent card: four panels carry two matching names around one central fold with one upside-down face', () => {
	setupDomEnvironment();
	const page = parse(print.buildTentCardPageHtml('中央地区', '検証 花子', 'けんしょう はなこ', '校外委員')).querySelector('.tent-card-page');
	const panels = page.querySelectorAll('.tent-panel');
	assert.equal(panels.length, 4, 'One sheet has four fold panels');
	const namePanels = panels.filter(panel => panel.querySelector('.tent-name'));
	assert.equal(namePanels.length, 2, 'Only the two display faces carry names');
	for (const panel of namePanels) {
		assert.equal(text(panel.querySelector('.tent-name')), '検証 花子');
		assert.equal(text(panel.querySelector('.tent-kana')), 'けんしょう はなこ');
		assert.equal(text(panel.querySelector('.tent-role')), '校外委員');
	}
	assert.equal(page.querySelectorAll('.tent-upside-down').length, 1);
	assert.equal(namePanels[0].classList.contains('tent-upside-down'), true);
	assert.equal(namePanels[1].classList.contains('tent-upside-down'), false);
	const fold = page.querySelector('.tent-center-fold');
	assert.equal(page.querySelectorAll('.tent-center-fold').length, 1);
	assert.ok(page.children.indexOf(namePanels[0]) < page.children.indexOf(fold));
	assert.ok(page.children.indexOf(fold) < page.children.indexOf(namePanels[1]));
	assert.match(cssDeclarations('.tent-upside-down').transform, /^rotate\(180deg\)$/);
});

for (const count of [0, 1, 12, 13, 24, 25]) {
	test(`specification envelopes: ${count} recipients occupy exactly twelve cells per page without loss or duplication`, () => {
		setupDomEnvironment();
		const officers = Array.from({ length: count }, (_, index) => ({ role: '校外委員', lastName: `役員${index}`, firstName: '花子', childLastName: `児童${index}`, childFirstName: '太郎', childGrade: '3', childClass: '2' }));
		// 配送先児童を持たない行は、別の宛名ページや空き面を増やさない。
		const pages = print.buildEnvelopesPagesHtml([{ district: '配付地区', officers: [...officers, { lastName: '児童なし役員', firstName: '次郎' }] }]);
		assert.equal(pages.length, Math.ceil(count / 12));
		const recipients = [];
		for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
			const grid = parse(pages[pageIndex]).querySelector('.address-grid');
			const cells = grid.querySelectorAll('.address-cell');
			assert.equal(cells.length, 12, 'Every printed grid has exactly twelve cells including padding');
			const nonEmpty = cells.filter(cell => cell.querySelector('.addr-child'));
			assert.equal(nonEmpty.length, Math.min(12, count - pageIndex * 12));
			assert.ok(cells.slice(nonEmpty.length).every(cell => text(cell) === ''), 'Padding follows the last recipient');
			for (const cell of nonEmpty) {
				const child = cell.querySelector('.addr-child').textContent.trim();
				assert.match(child, /^児童\d+ 太郎 さん$/);
				assert.equal(text(cell.querySelector('.addr-grade')), '3年 2組');
				recipients.push(child);
				assert.ok(text(cell.querySelector('.addr-district')).includes(`役員${recipients.length - 1} 花子`));
			}
		}
		assert.deepEqual(recipients, officers.map(officer => `${officer.childLastName} 太郎 さん`));
		assert.equal(new Set(recipients).size, count);
		const declarations = cssDeclarations('.address-grid');
		assert.equal(declarations.display, 'grid');
		assert.match(declarations['grid-template-columns'], /^repeat\(3,\s*1fr\)$/);
		assert.match(declarations['grid-template-rows'], /^repeat\(4,\s*68mm\)$/);
	});
}

test('specification aggregation privacy: an imported remembered district password never reaches representative storage or decrypted master and split handoffs', async () => {
	setupDomEnvironment();
	await crypt.clearStorageSecurity();
	state.repState = { districts: [], szExternals: [], seatConfig: { cols: 2, rows: 2, cells: {} } };
	const rememberedPassword = 'DistrictOnlySecretCanary5291!';
	const submissionPassword = 'DistrictSubmission5291!';
	const splitPassword = 'ExplicitSplitSecret5291!';
	const source = { district: '秘密非混入地区', han: '1班', hanList: ['1班'], officers: [{ role: '校外委員', lastName: '取込役員', firstName: '花子' }], students: [{ lastName: '取込児童', firstName: '太郎', grade: '3', han: '1班' }], neighborhood: [], savedFilePassword: rememberedPassword };
	state.currentDistrict = source;
	const original = JSON.stringify(source);
	document.getElementById('rep-pass').value = submissionPassword;
	document.getElementById('rep-pass-confirm').value = submissionPassword;
	const content = await crypt.encryptPayload(JSON.stringify(source), submissionPassword);
	const event = { target: { value: 'district.txt', files: [{ size: Buffer.byteLength(content), text: async () => content }] } };
	await rep.loadMultipleDistrictFiles(event);
	assert.equal(event.target.value, '', 'The actual general file intake completed');
	assert.equal(state.repState.districts.length, 1);
	assert.equal(state.repState.districts[0].students[0].lastName, '取込児童', 'The ordinary roster is accepted, rather than the entire input being rejected');
	assert.equal(Object.hasOwn(state.repState.districts[0], 'savedFilePassword'), false);
	assert.ok(!JSON.stringify(state.repState).includes(rememberedPassword));
	await state.saveRepLocal();
	const stored = localStorage.getItem('kogai_rep_v2');
	assert.ok(stored && stored.includes('取込児童'), 'Representative data really reaches local persistence');
	assert.ok(!stored.includes(rememberedPassword));
	const priorDownload = global.downloadTextFile;
	const downloads = [];
	global.downloadTextFile = (text, filename) => downloads.push({ text, filename });
	try {
		await rep.exportRepMasterTxt();
		assert.equal(downloads.length, 1);
		const master = await crypt.parseTxtContent(downloads[0].text, submissionPassword);
		assert.equal(master.districts[0].students[0].lastName, '取込児童');
		assert.ok(!JSON.stringify(master).includes(rememberedPassword), 'Even inside the authenticated master the remembered password is absent');
		assert.equal(Object.hasOwn(master.districts[0], 'savedFilePassword'), false);
		assert.equal(await rep.exportSingleDistrictFromRep(0, splitPassword, 'download'), true);
		assert.equal(downloads.length, 2);
		const split = await crypt.parseTxtContent(downloads[1].text, splitPassword);
		assert.equal(split.students[0].lastName, '取込児童');
		assert.equal(Object.hasOwn(split, 'savedFilePassword'), false);
		assert.ok(!JSON.stringify(split).includes(rememberedPassword), 'Even inside the authenticated split file the remembered password is absent');
		await assert.rejects(crypt.parseTxtContent(downloads[1].text, submissionPassword), 'Explicit split password takes precedence over the representative password field');
		assert.equal(JSON.stringify(source), original, 'Representative intake does not mutate the district source object');
		assert.equal(state.currentDistrict.savedFilePassword, rememberedPassword, 'The district retains its own remembered secret');
	} finally {
		global.downloadTextFile = priorDownload;
	}
});
