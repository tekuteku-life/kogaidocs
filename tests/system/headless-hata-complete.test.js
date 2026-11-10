const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

function browserTest(name, scenario, options = {}) {
	test(name, async () => {
		const out = await runInHeadlessChrome(scenario, options);
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }));
		assert.deepEqual(out.errors, []);
		assert.ok(out.results.length > 0);
	});
}

for (const width of [375, 1280]) {
	browserTest(`UI hata complete: ${width}px edited roster, duplicate text, weekdays, latest printing and encrypted export round trip`, async () => {
		await ui.expand('district');
		await ui.click('#card-d-hata summary');
		ui.fill('#d-name', '地区データ');
		ui.fill('#hata-title', '全設定シフト');
		ui.fill('#hata-created-date', '作成日：2026年11月10日');
		ui.fill('#hata-district', '印刷専用地区');
		ui.fill('#hata-time', '朝 7:55\n夕 14:30');
		ui.fill('#hata-location', '');
		ui.fill('#hata-start-date', '2026-11-09');
		ui.fill('#hata-end-date', '2026-11-15');
		ui.fill('#hata-holidays', '');
		ui.fill('#hata-specials', '2026-11-14,固定担当,土曜行事');
		ui.fill('#hata-header-msg', '上部連絡');
		ui.fill('#hata-footer-msg', '');
		ui.fill('#hata-contact-msg', '連絡先');
		ui.fill('#hata-members', '外部担当\n<img src=x onerror=window.__injected=1>\n外部担当');
		assert.ok(ui.visible('#hata-duplicate-alert'), 'Duplicate names produce a visible warning');
		assert.strictEqual(window.__injected, undefined, 'Roster is not interpreted as markup');
		ui.fill('#hata-members', '外部担当\n編集担当');
		assert.ok(!ui.visible('#hata-duplicate-alert'), 'Warning clears after editing');
		window.__confirmAnswer = false;
		await ui.click('[data-click="syncHataMembersFromStudents"]');
		assert.strictEqual(currentDistrict.hata.members, '外部担当\n編集担当', 'Cancelling student sync preserves edits');
		window.__confirmAnswer = true;
		for (const box of document.querySelectorAll('[name="hata-weekday"]')) {
			if (box.checked !== ['1', '3'].includes(box.value)) await ui.click(box);
		}
		ui.fill('#hata-columns', '6');
		ui.fill('#hata-orientation', 'landscape');
		ui.fill('#hata-format', '{氏名}');
		await ui.click('#hata-dedup');
		await ui.click('[data-click="runAutoHataGeneration"]');
		assert.strictEqual(hataCurrentSchedule.map(row => row.date).join(','), '2026-11-09,2026-11-11,2026-11-14', 'Only selected weekdays and the extra special day are generated');
		assert.strictEqual(currentDistrict.hata.members, '外部担当\n編集担当', 'Regeneration retains the edited roster');
		ui.clipboard();
		await ui.click('[data-click="copyHataForLine"]');
		await ui.waitFor(() => window.__copiedText, 'Shift text copied');
		assert.ok(__copiedText.includes('★固定担当（土曜行事）') && __copiedText.includes('印刷専用地区'), 'LINE copy contains the full schedule and metadata');
		ui.clipboard(true);
		await ui.click('[data-click="copyHataForLine"]');
		await ui.waitFor(() => __dialogs.some(item => item.message.includes('表示したシフト本文')), 'Clipboard fallback');
		assert.ok(ui.visible('#hata-line-text'), 'Manual copy text remains reachable');
		ui.fill('#hata-title', '印刷直前の変更');
		window.print = () => {
			const sheet = ui.element('#hata-print-active-sheet');
			assert.ok(sheet.textContent.includes('印刷直前の変更') && sheet.textContent.includes('印刷専用地区'), 'Print rebuilds from the latest fields');
			assert.ok(sheet.textContent.includes('朝 7:55\n夕 14:30'), 'Multiline time reaches print');
		};
		await ui.click('[data-click="printHataSchedule"]');
		assert.strictEqual(document.querySelectorAll('#hata-print-active-sheet').length, 0, 'Printing cleans up its temporary DOM');
		assert.ok(document.documentElement.scrollWidth <= innerWidth + 1, 'The page fits the viewport');
		const expected = JSON.stringify(currentDistrict.hata);
		ui.captureDownloads();
		ui.fill('#d-pass', 'CompleteTest123!');
		ui.fill('#d-pass-confirm', 'CompleteTest123!');
		await exportDistrictTxt();
		assert.strictEqual(__downloads.length, 1, 'Actual encrypted district exporter runs');
		const cipher = __downloads[0].content.match(/BEGIN_DATA:\n([\s\S]+?)\n:END_DATA/)[1];
		const decoded = JSON.parse(await decryptPayload(cipher, 'CompleteTest123!'));
		assert.strictEqual(JSON.stringify(decoded.hata), expected, 'All flag settings survive encrypted export');
		ui.fill('#hata-members', '変更後');
		await ui.file('#d-file-in', __downloads[0].content, 'restore.txt');
		await ui.waitFor(() => currentDistrict.hata.members === '外部担当\n編集担当', 'Encrypted file restored');
		assert.strictEqual(JSON.stringify(currentDistrict.hata), expected, 'Actual import restores every flag setting');
		assert.ok(ui.element('#hata-save-status').textContent.includes('未保存'), 'Import does not erase an existing unsaved-change warning');
		markHataSaved();
	}, { viewport: [width, 900], afterReload: async () => {
		await ui.expand('district');
		assert.strictEqual(ui.element('#hata-members').value, '外部担当\n編集担当', 'Edited roster survives a real restart');
		assert.strictEqual(ui.element('#hata-district').value, '印刷専用地区', 'Print district survives a real restart');
		assert.strictEqual(ui.element('#hata-columns').value, '6', 'Six columns survive a real restart');
		assert.strictEqual(currentDistrict.hata.weekdays.join(','), '1,3', 'Weekday selection survives a real restart');
		assert.strictEqual(currentDistrict.hata.location, '', 'Cleared setting survives a real restart');
		assert.strictEqual(currentDistrict.hata.dedup, false, 'Unchecked format option survives a real restart');
	} });
}

browserTest('UI hata complete: official JSON blank roster and no weekdays remain empty, student sync requires explicit action', async () => {
	await ui.expand('district');
	const config = { title: '上流設定', createdDate: '', district: '', time: '', startDate: '2026-11-09', endDate: '2026-11-15', members: '', weekdays: [], holidays: '', specials: '' };
	await ui.file('#card-d-hata input[type="file"]', JSON.stringify(config), 'official.json');
	await ui.waitFor(() => ui.element('#hata-title').value === '上流設定', 'Official keys imported');
	await ui.click('[data-click="runAutoHataGeneration"]');
	assert.strictEqual(hataCurrentSchedule.length, 0, 'No weekday does not become Monday to Friday');
	assert.strictEqual(currentDistrict.hata.members, '', 'Explicit empty roster stays empty');
	await ui.click('[data-click="addStudentRow"]');
	ui.fill('#students-tbody tr:last-child [data-field="lastName"]', '反映対象');
	ui.fill('#students-tbody tr:last-child [data-field="address"]', '1-2');
	await ui.click('[data-click="syncHataMembersFromStudents"]');
	assert.ok(ui.element('#hata-members').value.includes('1-2 反映対象'), 'Explicit action imports student households');
	assert.strictEqual(document.querySelector('[data-click="exportHataSettings"]'), null, 'Official JSON save action is removed');
	assert.strictEqual(currentDistrict.hata.weekdays.length, 0, 'Import retains empty weekday selection');
});

for (const device of ['iPhone', 'iPad', 'standalone', 'desktop']) {
	test(`UI PWA installation: ${device} visibility, Safari instructions and Apple metadata`, async () => {
		const out = await runInHeadlessChrome(async () => {
			const visible = getComputedStyle(ui.element('#pwa-install-btn')).display !== 'none';
			assert.strictEqual(visible, false, 'Local file launch does not advertise installation');
			assert.strictEqual(isIosDevice(), window.__device !== 'desktop', 'iPhone and Mac-UA iPad are recognized');
			assert.strictEqual(ui.element('meta[name="apple-mobile-web-app-capable"]').content, 'yes', 'Apple standalone tag is present');
			assert.ok(ui.element('meta[name="apple-mobile-web-app-title"]').content, 'Apple launch title is present');
			assert.ok(ui.element('link[rel="apple-touch-icon"]').href.endsWith('/icons/icon-192.png'), 'Existing Apple icon is linked');
			if (['iPhone', 'iPad'].includes(window.__device)) {
				triggerPwaInstall();
				assert.ok(ui.element('#pwa-ios-help').open, 'Install button opens a native accessible dialog');
				assert.ok(ui.element('#pwa-ios-help').textContent.includes('Safari') && ui.element('#pwa-ios-help').textContent.includes('ホーム画面に追加'), 'Safari installation steps are provided');
				await ui.click('[data-click="closePwaInstallHelp"]');
				assert.ok(!ui.element('#pwa-ios-help').open, 'Close action works');
				triggerPwaInstall();
				await ui.key('Escape');
				assert.ok(!ui.element('#pwa-ios-help').open, 'Escape closes the native dialog');
			}
		}, { viewport: [375, 812], beforeLoad: new Function(`window.__device = ${JSON.stringify(device)}; Object.defineProperty(navigator, 'userAgent', {value: ${JSON.stringify(device === 'iPhone' || device === 'standalone' ? 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1' : 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Safari/605.1.15')}}); Object.defineProperty(navigator, 'platform', {value: 'MacIntel'}); Object.defineProperty(navigator, 'maxTouchPoints', {value: ${device === 'iPad' ? 5 : 0}}); Object.defineProperty(navigator, 'standalone', {value: ${device === 'standalone'}});`) });
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }));
		assert.deepEqual(out.errors, []);
	});
}
