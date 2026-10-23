const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures');
setupDomEnvironment();
const utils = require('../../js/utils');
const crypt = require('../../js/crypto');
const state = require('../../js/state');
const hata = require('../../js/hata');
require('../../js/seat');
const rep = require('../../js/rep');
const district = require('../../js/district');
const neighbor = require('../../js/neighbor');
require('../../js/transfer');
const print = require('../../js/print');
const app = require('../../js/app');

const password = 'ImportLifecycle1!';
const keys = ['district', 'rep', 'neighbor', 'transfer'].map(mode => `kogai_${mode}_v2`);
const snapshot = () => JSON.stringify([state.currentDistrict, state.repState, state.neighborState, state.transferState]);
const domSnapshot = () => JSON.stringify(['d-name', 'officers-container', 'students-tbody', 'print-area'].map(id => {
	const el = document.getElementById(id);
	return [el.value, el.innerHTML];
}));
const fileEvent = content => ({ target: { value: 'fixture.txt', files: [{ size: Buffer.byteLength(content), text: async () => content }] } });
async function fresh() {
	await crypt.clearStorageSecurity();
	setupDomEnvironment();
	state.currentDistrict = createMockDistrict({ district: '保持地区' });
	state.repState = createMockRepState();
	state.neighborState = { district: '保持自治会', neighborhood: [] };
	state.transferState = { children: [], memo: '保持下書き' };
	document.getElementById('d-name').value = '保持地区';
}

// R-04/03/15, E-06-04, I-04, SEC-18: 正当な旧形式と未知の個人項目も対象とする。
for (const mode of ['neighbor', 'rep']) {
	test(`security lifecycle: ${mode} rollover removes imported aliases and surplus private fields from storage, print and encrypted handoff`, async () => {
		await fresh();
		const rows = [
			{ role: '会長', name: '旧会長秘密氏名', kana: '旧秘密かな', address: '旧秘密住所', tel: '旧秘密電話', email: '旧秘密メール', note: '旧秘密備考', contact: '旧秘密連絡', extra: { private: '旧秘密余剰' } },
			{ role: '副会長', lastName: '旧秘密姓', firstName: '旧秘密名', lastNameKana: '旧秘密せい', firstNameKana: '旧秘密めい', extra: '旧秘密追加' }
		];
		const data = mode === 'neighbor'
			? { isNeighborhoodData: true, district: '引継自治会', neighborhood: rows }
			: { districts: [], szExternals: rows.map(row => ({ ...row, category: '学校関係者', org: '組織枠', attend: false })), seatConfig: { cols: 2, rows: 2, cells: {} } };
		document.getElementById(mode === 'neighbor' ? 'neighbor-import-pass' : 'rep-pass').value = password;
		const content = await crypt.encryptPayload(JSON.stringify(data), password);
		if (mode === 'neighbor') await neighbor.loadNeighborTxt(fileEvent(content));
		else await rep.loadRepMasterTxt(fileEvent(content));
		const save = mode === 'neighbor' ? state.saveNeighborLocal : state.saveRepLocal;
		await save();
		assert.ok(snapshot().includes('旧秘密'), 'The private input really reached the accepted model');
		const before = snapshot();
		const storedBefore = { ...localStorage.store };
		global.confirm = () => false;
		(mode === 'neighbor' ? neighbor.runNeighborYearUpdate : rep.runRepYearUpdate)();
		assert.equal(snapshot(), before, 'Cancel retains every alias and extra property');
		assert.deepEqual(localStorage.store, storedBefore, 'Cancel never writes');
		global.confirm = () => true;
		(mode === 'neighbor' ? neighbor.runNeighborYearUpdate : rep.runRepYearUpdate)();
		await save();
		assert.ok(!snapshot().includes('旧'), 'No old private field survives confirmed rollover');
		const updated = mode === 'neighbor' ? state.neighborState.neighborhood : state.repState.szExternals;
		assert.deepEqual(updated.map(row => row.role), ['会長', '副会長'], 'Role templates and order survive');
		const allowed = mode === 'neighbor'
			? ['role', 'lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'address', 'tel', 'email', 'note']
			: ['category', 'org', 'role', 'attend', 'lastName', 'firstName', 'lastNameKana', 'firstNameKana', 'contact'];
		for (const row of updated) assert.deepEqual(Object.keys(row).sort(), [...allowed].sort(), 'Only the documented handoff fields remain');
		if (mode === 'rep') {
			assert.ok(updated.every(row => row.category === '学校関係者' && row.org === '組織枠' && row.attend === true));
		}
		await app.loadAppDataFromStorage();
		assert.ok(!snapshot().includes('旧'), 'Restoring the saved models cannot revive private aliases');
		const html = mode === 'neighbor'
			? print.buildNeighborPageHtml(state.neighborState)
			: print.buildSzMasterRosterPageHtml([]);
		assert.ok(!html.includes('旧'), 'Printable output never falls back to an old alias');
		document.getElementById(mode === 'neighbor' ? 'neighbor-pass' : 'rep-pass').value = password;
		document.getElementById(mode === 'neighbor' ? 'neighbor-pass-confirm' : 'rep-pass-confirm').value = password;
		let handoff;
		global.downloadTextFile = content => { handoff = content; };
		if (mode === 'neighbor') await neighbor.exportNeighborTxt();
		else await rep.exportRepMasterTxt();
		assert.ok(handoff, 'The ordinary handoff export really runs');
		const decrypted = await crypt.parseTxtContent(handoff, password);
		assert.ok(!JSON.stringify(decrypted).includes('旧'), 'Even inside the authenticated handoff no old private field remains');
	});
}

const invalidDates = ['bad', '2026-02-30', '2026-1-01', '10000-01-01'];
for (const endpoint of ['startDate', 'endDate']) {
	for (const value of invalidDates) {
		const config = { [endpoint]: value };
		test(`security lifecycle: isolated ${endpoint}=${value} rejects at every model and official JSON boundary`, async () => {
			await fresh();
			const invalid = createMockDistrict({ hata: config });
			for (const validate of [
				() => utils.validateHataConfig(config),
				() => utils.validateImportData(invalid, 'district'),
				() => utils.validateImportData({ districts: [invalid] }, 'rep'),
				() => utils.validateStoredData(invalid, keys[0]),
				() => hata.importHataOfficialJson(JSON.stringify(config))
			]) assert.throws(validate, { code: 'INVALID_IMPORT_DATA' });
		});
		for (const route of ['file', 'paste', 'plaintext', 'encrypted']) {
			test(`security lifecycle: ${route} refuses isolated ${endpoint}=${value} before model, DOM or storage replacement`, async () => {
				await fresh();
				const invalid = createMockDistrict({ district: '拒否する地区', hata: config });
				if (route === 'encrypted') await crypt.setupStorageEncryption(password, false);
				if (route === 'plaintext' || route === 'encrypted') await crypt.saveStorageData(keys[0], invalid);
				document.getElementById('d-pass').value = password;
				const content = (route === 'file' || route === 'paste') ? await crypt.encryptPayload(JSON.stringify(invalid), password) : null;
				const before = snapshot(), beforeDOM = domSnapshot(), beforeStorage = { ...localStorage.store };
				if (route === 'file') {
					const event = fileEvent(content);
					await district.loadDistrictTxt(event);
					assert.equal(event.target.value, '');
				} else if (route === 'paste') {
					document.getElementById('d-paste-box').value = content;
					await district.loadPastedTextToDistrict();
					assert.equal(document.getElementById('d-paste-box').value, content);
				} else await assert.rejects(app.loadAppDataFromStorage(), { code: 'INVALID_IMPORT_DATA' });
				assert.equal(snapshot(), before, 'All four authoritative models remain unchanged');
				assert.equal(domSnapshot(), beforeDOM, 'Existing DOM is not partially redrawn');
				assert.deepEqual(localStorage.store, beforeStorage, 'Source storage is never overwritten on rejection');
				if (content) assert.match(global.__lastAlert, /失敗|フォーマット/);
				if (route === 'encrypted') {
					crypt.lockStorage();
					await assert.rejects(crypt.unlockStorageWithPassword(password), { code: 'INVALID_IMPORT_DATA' });
					assert.equal(crypt.isStorageUnlocked(), false, 'Invalid authenticated contents cannot activate a key');
					assert.deepEqual(localStorage.store, beforeStorage);
				}
			});
		}
	}
}

for (const config of [{}, { startDate: '', endDate: '' }, { startDate: '2024-02-29' }, { endDate: '2024-02-29' }]) {
	test(`security lifecycle: valid incomplete date draft ${JSON.stringify(config)} stays accepted and renderable`, async () => {
		await fresh();
		const clean = utils.validateImportData(createMockDistrict({ hata: config }), 'district');
		state.currentDistrict = clean;
		assert.doesNotThrow(() => district.renderDistrictForm());
		assert.equal(state.currentDistrict.hata.startDate || '', config.startDate || '');
		assert.equal(state.currentDistrict.hata.endDate || '', config.endDate || '');
	});
}
// 低年のDate.UTC特殊扱いと遠未来の春秋分近似を自動補完へ持ち込まない。
for (const year of [0, 1, 99, 100, 1999, 2000, 2099, 2100, 9998, 9999]) {
	test(`security lifecycle: year ${year} has a renderable bounded automatic holiday draft`, async () => {
		await fresh();
		const y = String(year).padStart(4, '0');
		const config = { startDate: `${y}-01-01`, endDate: `${y}-01-02`, weekdays: [0, 1, 2, 3, 4, 5, 6] };
		const incoming = createMockDistrict({ district: '年境界地区', hata: config });
		document.getElementById('d-pass').value = password;
		await district.loadDistrictTxt(fileEvent(await crypt.encryptPayload(JSON.stringify(incoming), password)));
		assert.equal(state.currentDistrict.district, '年境界地区');
		assert.match(global.__lastAlert, /読み込みました/);
		assert.equal(document.getElementById('hata-start-date').value, config.startDate);
		const holidays = state.currentDistrict.hata.holidays;
		assert.equal(typeof holidays, 'string');
		if (year >= 2000 && year <= 2099) {
			assert.ok(holidays.includes(`${y}-01-01`), 'Automatic holiday generation actually completes');
			assert.ok(!holidays.includes('2100-'), 'Automatic dates stay in the documented technical range');
		} else assert.equal(holidays, '', 'Unsupported automatic calendar years remain valid empty holiday drafts');
	});
}
for (const holidays of ['', '9999-01-01,明示休日']) {
	test(`security lifecycle: explicit holidays ${JSON.stringify(holidays)} survive an out-of-range calendar year`, async () => {
		await fresh();
		state.currentDistrict = utils.validateImportData(createMockDistrict({ hata: { startDate: '9999-01-01', endDate: '', holidays } }), 'district');
		district.renderDistrictForm();
		assert.equal(state.currentDistrict.hata.holidays, holidays);
		assert.equal(document.getElementById('hata-holidays').value, holidays);
	});
}
