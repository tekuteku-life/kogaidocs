const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

for (const width of [390, 1280]) {
	test(`UI household: household-first layout, minimal children and encrypted submission at ${width}px`, async () => {
		const out = await runInHeadlessChrome(async () => {
			await ui.mode('transfer');
			assert.ok(document.querySelector('#mode-active-badge-text').textContent.includes('家庭情報入力'), 'Mode renamed');
			assert.strictEqual(document.querySelector('#btn-share-transfer-url'), null, 'Duplicate share button removed');
			const contact = ui.element('#card-t-household').getBoundingClientRect();
			const children = ui.element('#card-t-children').getBoundingClientRect();
			assert.ok(contact.bottom <= children.top, 'Household fields precede children visually');
			assert.ok(document.documentElement.scrollWidth <= innerWidth, 'No horizontal overflow');
			const householdFields = Array.from(document.querySelectorAll('#card-t-household [data-field]')).map(el => el.dataset.field).sort();
			assert.strictEqual(JSON.stringify(householdFields), JSON.stringify(['address', 'tel']), 'Household contains address and phone only');
			const fields = Array.from(document.querySelectorAll('.transfer-child-row [data-field]')).map(el => el.dataset.field).sort();
			assert.strictEqual(JSON.stringify(fields), JSON.stringify(['className', 'firstName', 'grade', 'lastName']), 'Only child name, grade and class');
			ui.fill('#transfer-address', '<img src=x onerror=alert(1)> 中央町100');
			ui.fill('#transfer-tel', '090-1111-2222');
			ui.fill('.transfer-child-row [data-field="lastName"]', '山田');
			ui.fill('.transfer-child-row [data-field="firstName"]', '太郎');
			ui.fill('.transfer-child-row [data-field="className"]', '未定');
			await ui.click('#btn-add-transfer-child');
			ui.fill('.transfer-child-row:nth-child(2) [data-field="firstName"]', '花子');
			assert.strictEqual(ui.element('#transfer-address').value, '<img src=x onerror=alert(1)> 中央町100', 'Adding children preserves shared address');
			assert.strictEqual(document.querySelector('#card-t-household img'), null, 'Household text cannot create HTML');
			ui.fill('#transfer-export-pass', 'Household123!');
			ui.fill('#transfer-export-pass-confirm', 'Household123!');
			ui.captureDownloads(); ui.clipboard();
			await ui.click('#btn-export-transfer-txt');
			await ui.waitFor(() => __downloads.length === 1, 'Download completed');
			assert.strictEqual(__downloads[0].filename, '家庭情報データ.txt', 'Filename excludes personal names');
			const payload = await parseTxtContent(__downloads[0].content, 'Household123!');
			assert.strictEqual(payload.children[1].address, '<img src=x onerror=alert(1)> 中央町100', 'Shared address applies to sibling');
			assert.strictEqual(payload.children[0].className, '未定', 'Unknown class accepted');
			await ui.click('#btn-copy-transfer-text');
			await ui.waitFor(() => window.__copiedText, 'Encrypted copy completed');
			assert.strictEqual((await parseTxtContent(__copiedText, 'Household123!')).children.length, 2, 'Copy retains both children');
			const help = ui.element('#card-t-export .help-text').textContent;
			assert.ok(help.includes('指定されている場合') && help.includes('指定がない場合') && help.includes('別途'), 'Both password instructions provided');
			let shared;
			Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { shared = data; } });
			await ui.click('#btn-share-app');
			await ui.waitFor(() => shared, 'Header share completed');
			assert.ok(shared.url.endsWith('?mode=transfer'), 'Header shares current mode');
			assert.ok(shared.text.includes('新入生') && shared.text.includes('転入生'), 'Share description includes both audiences');
			await saveTransferLocal();
		}, { viewport: [width, 900], afterReload: async () => {
			await ui.mode('transfer');
			assert.strictEqual(ui.element('#transfer-tel').value, '090-1111-2222', 'Phone survives actual reload');
			window.__confirmAnswer = false;
			await ui.click('#btn-reset-transfer');
			assert.ok(transferState.address.includes('中央町100'), 'Cancellation preserves household');
			window.__confirmAnswer = true;
			await ui.click('#btn-reset-transfer');
			assert.strictEqual(transferState.address, '', 'Reset clears household state');
			await ui.waitFor(() => !localStorage.getItem('kogai_transfer_v2')?.includes('中央町100'), 'Reset clears persisted contact');
		} });
		assert.equal(out.success, true, JSON.stringify(out));
		assert.deepEqual(out.errors, []);
		assert.ok(out.results.length > 0);
		assert.ok(out.results.every(result => result.passed), JSON.stringify(out.results));
	});
}


test('UI household: legacy draft class alias submits and incomplete grade/class stay visibly incomplete', async () => {
	const out = await runInHeadlessChrome(async () => {
		assert.strictEqual(ui.element('#transfer-address').value, '旧住所', 'Legacy contact migrates to household');
		assert.strictEqual(ui.element('.transfer-child-row [data-field="className"]').value, '3', 'Legacy class alias is visible');
		assert.strictEqual(ui.element('.transfer-child-row [data-field="grade"]').value, '', 'Missing grade has no misleading default');
		ui.fill('#transfer-export-pass', 'Household123!');
		ui.fill('#transfer-export-pass-confirm', 'Household123!');
		ui.captureDownloads();
		await ui.click('#btn-export-transfer-txt');
		assert.strictEqual(__downloads.length, 0, 'Incomplete grade blocks output');
		ui.fill('.transfer-child-row [data-field="grade"]', '1');
		await ui.click('#btn-export-transfer-txt');
		await ui.waitFor(() => __downloads.length === 1, 'Legacy draft encrypted submission');
		const payload = await parseTxtContent(__downloads[0].content, 'Household123!');
		assert.strictEqual(payload.children[0].className, '3', 'Visible legacy class is also submitted');
		ui.fill('.transfer-child-row [data-field="className"]', '');
		await ui.mode('district'); await ui.mode('transfer');
		assert.strictEqual(ui.element('.transfer-child-row [data-field="className"]').value, '', 'Cleared class stays visibly empty after redraw');
		await ui.click('#btn-export-transfer-txt');
		assert.strictEqual(__downloads.length, 1, 'Cleared class does not fall back to legacy value');
	}, { queryMode: 'transfer', beforeLoad: () => {
		localStorage.setItem('kogai_transfer_v2', JSON.stringify({ children: [{
			lastName: '旧姓', firstName: '児童', grade: '', className: '', class: '3', address: '旧住所', tel: '090-1111-2222'
		}] }));
	} });
	assert.equal(out.success, true, JSON.stringify(out));
	assert.deepEqual(out.errors, []);
	assert.ok(out.results.every(result => result.passed));
});
