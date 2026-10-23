const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function prepareLifecycle() {
	window.lifecycle = {
		password: 'LifecycleBrowser1!',
		rows: [
			{ role: '会長', name: 'OLD_PRIVATE_NAME_581', kana: 'OLD_PRIVATE_KANA_581', address: 'OLD_PRIVATE_ADDRESS_581', tel: 'OLD_PRIVATE_TEL_581', email: 'OLD_PRIVATE_EMAIL_581', contact: 'OLD_PRIVATE_CONTACT_581', note: 'OLD_PRIVATE_NOTE_581', extra: { value: 'OLD_PRIVATE_EXTRA_581' } },
			{ role: '副会長', lastName: 'OLD_PRIVATE_LAST_581', firstName: 'OLD_PRIVATE_FIRST_581', lastNameKana: 'OLD_PRIVATE_KANA_581' }
		],
		async flush(mode) {
			assert.strictEqual(await (mode === 'neighbor' ? saveNeighborLocal() : saveRepLocal()), true, 'Autosave settles before continuing');
		},
		async handoff(mode) {
			ui.fill(mode === 'neighbor' ? '#neighbor-pass' : '#rep-pass', this.password);
			ui.fill(mode === 'neighbor' ? '#neighbor-pass-confirm' : '#rep-pass-confirm', this.password);
			ui.captureDownloads();
			await ui.click(`[data-click="${mode === 'neighbor' ? 'exportNeighborTxt' : 'exportRepMasterTxt'}"]`);
			await ui.waitFor(() => __downloads.length === 1, 'Handoff produced by the ordinary download control');
			const data = await parseTxtContent(__downloads[0].content, this.password);
			assert.ok(!JSON.stringify(data).includes('OLD_PRIVATE_'), 'No private alias or surplus property enters the encrypted handoff');
			const rows = mode === 'neighbor' ? data.neighborhood : data.szExternals;
			assert.strictEqual(rows.map(row => row.role).join(','), '会長,副会長', 'Both organizational templates remain');
		}
	};
}
function lifecycleTest(name, fn, options = {}) {
	test(name, async () => {
		const out = await runInHeadlessChrome(fn, { ...options, prepare: prepareLifecycle });
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, errors: out.errors, failures: out.results.filter(row => !row.passed) }));
		assert.deepEqual(out.errors, [], 'No startup or asynchronous browser errors');
		assert.ok(out.results.length > 0 && out.results.every(row => row.passed));
	});
}

for (const mode of ['neighbor', 'rep']) {
	lifecycleTest(`Security lifecycle UI: ${mode} imported legacy secrets disappear after rollover, real restart, printing and handoff`, async () => {
		const mode = window.__lifecycleMode;
		await ui.mode(mode); await ui.expand(mode);
		const rows = lifecycle.rows;
		const data = mode === 'neighbor'
			? { isNeighborhoodData: true, district: '引継自治会', neighborhood: rows }
			: { districts: [], szExternals: rows.map(row => ({ ...row, category: '学校関係者', org: '引継組織', attend: true })), seatConfig: { cols: 2, rows: 2, cells: {} } };
		ui.fill(mode === 'neighbor' ? '#neighbor-import-pass' : '#rep-pass', lifecycle.password);
		const picker = mode === 'neighbor' ? '#neighbor-file-input' : 'input[data-change="loadRepMasterTxt"]';
		await ui.file(picker, await encryptPayload(JSON.stringify(data), lifecycle.password));
		await ui.waitFor(() => JSON.stringify(mode === 'neighbor' ? neighborState : repState).includes('OLD_PRIVATE_') && ui.element(picker).value === '', 'Authenticated old-format data really imported');
		await lifecycle.flush(mode);
		const before = JSON.stringify({ neighborState, repState });
		window.__confirmAnswer = false;
		await ui.click(`[data-click="${mode === 'neighbor' ? 'runNeighborYearUpdate' : 'runRepYearUpdate'}"]`);
		assert.strictEqual(JSON.stringify({ neighborState, repState }), before, 'Cancelled rollover preserves every original property');
		window.__confirmAnswer = true;
		await ui.click(`[data-click="${mode === 'neighbor' ? 'runNeighborYearUpdate' : 'runRepYearUpdate'}"]`);
		await lifecycle.flush(mode);
		assert.ok(!JSON.stringify({ neighborState, repState }).includes('OLD_PRIVATE_'), 'Confirmed rollover removes legacy and surplus private fields');
		ui.capturePrints();
		if (mode === 'neighbor') await ui.click('[data-click="printNeighborRoster"]');
		else {
			await ui.click('[data-click="setRepPrintChecks"][data-flag="false"]');
			await ui.click('.rep-print-chk[value="sz_master"]');
			await ui.click('[data-click="executeRepSelectedPrint"]');
		}
		assert.strictEqual(__prints.length, 1, 'Updated roster really reaches the print pipeline');
		assert.ok(!__prints[0].html.includes('OLD_PRIVATE_'), 'No printable old alias remains');
		await lifecycle.handoff(mode);
	}, { beforeLoad: new Function(`window.__lifecycleMode = ${JSON.stringify(mode)};`), afterReload: async () => {
		const mode = window.__lifecycleMode;
		await ui.expand(mode);
		assert.ok(!JSON.stringify({ neighborState, repState }).includes('OLD_PRIVATE_'), 'Actual restart cannot revive cleared private values');
		assert.ok(!localStorage.getItem(`kogai_${mode}_v2`).includes('OLD_PRIVATE_'), 'Saved handoff source is clear');
		await lifecycle.handoff(mode);
	} });
}

for (const route of ['file', 'paste', 'official']) {
	lifecycleTest(`Security lifecycle UI: ${route} rejects invalid isolated dates and preserves models, DOM and saved originals`, async () => {
		await ui.mode('district'); await ui.expand('district');
		ui.fill('#d-name', '保全地区');
		ui.fill('#d-pass', lifecycle.password); ui.fill('#d-pass-confirm', lifecycle.password);
		await saveDistrictLocal();
		const route = window.__lifecycleRoute;
		for (const field of ['startDate', 'endDate']) {
			const config = { [field]: '2026-02-30' };
			const content = route === 'official' ? JSON.stringify(config) : await encryptPayload(JSON.stringify({ district: '拒否する地区', officers: [], students: [], neighborhood: [], hata: config }), lifecycle.password);
			const before = JSON.stringify({ currentDistrict, repState, neighborState, transferState });
			const stored = JSON.stringify({ ...localStorage });
			const oldTitle = ui.element('#hata-title').value;
			const notifications = __dialogs.length;
			if (route === 'file') await ui.file('#d-file-in', content);
			else if (route === 'official') await ui.file('#card-d-hata input[type="file"]', content, 'invalid-date.json');
			else {
				if (!ui.visible('#d-paste-box')) await ui.click('#btn-load-district-paste');
				ui.fill('#d-paste-box', content);
				await ui.click('[data-click="loadPastedTextToDistrict"]');
			}
			await ui.waitFor(() => __dialogs.length > notifications, 'Invalid date is visibly rejected');
			assert.strictEqual(JSON.stringify({ currentDistrict, repState, neighborState, transferState }), before, 'No partial authoritative model replacement');
			assert.strictEqual(ui.element('#d-name').value, '保全地区', 'Existing district DOM retained');
			assert.strictEqual(ui.element('#hata-title').value, oldTitle, 'Existing flag settings DOM retained');
			assert.strictEqual(JSON.stringify({ ...localStorage }), stored, 'Saved originals retained');
			assert.ok(__dialogs.slice(notifications).some(row => row.type === 'alert' && /失敗|フォーマット/.test(row.message)), 'Failure notification is not a success message');
			if (route === 'paste') assert.strictEqual(ui.element('#d-paste-box').value, content, 'Rejected paste retained');
		}
	}, { beforeLoad: new Function(`window.__lifecycleRoute = ${JSON.stringify(route)};`) });
}

lifecycleTest('Security lifecycle UI: valid upper-year import survives real restart without invalid automatic holidays', async () => {
	await ui.mode('district'); await ui.expand('district');
	ui.fill('#d-pass', lifecycle.password); ui.fill('#d-pass-confirm', lifecycle.password);
	const data = { district: '上限年地区', officers: [], students: [], neighborhood: [], hata: { startDate: '9999-01-01', endDate: '9999-01-02' } };
	await ui.file('#d-file-in', await encryptPayload(JSON.stringify(data), lifecycle.password));
	await ui.waitFor(() => __dialogs.some(row => /読み込みました/.test(row.message)), 'Valid upper-year import completes');
	assert.strictEqual(ui.element('#hata-start-date').value, '9999-01-01', 'Valid ISO upper year is kept');
	assert.strictEqual(currentDistrict.hata.holidays, '', 'Outside-range automatic calendar is empty');
}, { afterReload: async () => {
	await ui.expand('district');
	assert.strictEqual(currentDistrict.district, '上限年地区', 'Actual restart restores valid upper-year data');
	assert.strictEqual(ui.element('#hata-start-date').value, '9999-01-01', 'Date remains renderable after restart');
	assert.strictEqual(currentDistrict.hata.holidays, '', 'Empty automatic calendar remains stable');
} });
