const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

// R-27・E-16・I-16-06: 実Chromium（file 起動、同一オリジンの2つのウィンドウ）で、未暗号化の保存データの他タブ更新を確かめる。
// 別のウィンドウは試験から開き（利用者操作として評価し、ポップアップを許可する）、そのウィンドウの関数を呼ぶ。
// let で宣言したモデル（neighborState など）はウィンドウのプロパティにならないため、別のウィンドウの状態は画面の入力欄で確かめる。
// 通知が届く前の競合は、このタブから保存領域を直接書き換えて再現する（同じタブの書込みは storage の通知を出さない）。

function assertBrowserResult(result) {
	assert.equal(result.success, true, JSON.stringify(result.fatal));
	assert.deepEqual(result.errors, []);
	assert.ok(result.results.length > 0, 'Browser assertions were executed');
	assert.ok(result.results.every(item => item.passed), JSON.stringify(result.results.filter(item => !item.passed)));
}

const options = mode => ({ queryMode: mode, autoSecure: false, allowFileAccess: true, userGesture: true });

test('UI R-27: another window saving the neighborhood data makes this tab reload, show the notice and keep the newer value', async () => {
	const result = await runInHeadlessChrome(async () => {
		assert.ok(!isStorageEncrypted(), 'The database is not encrypted');
		await ui.expand('neighbor');
		ui.fill('#neighbor-district-name', 'タブAの値');
		await ui.waitFor(() => JSON.parse(localStorage.getItem('kogai_neighbor_v2') || '{}').district === 'タブAの値', 'This tab saves');
		const other = window.open('index.html?mode=neighbor');
		assert.ok(other, 'The second window opens');
		await ui.waitFor(() => { try { return other.document.readyState === 'complete' && other.document.getElementById('neighbor-district-name')?.value === 'タブAの値'; } catch (_) { return false; } }, 'Second window ready', 10000);
		const notice = ui.element('#storage-foreign-update-notice');
		assert.ok(notice.hidden, 'No notice before another window saves');
		other.document.getElementById('neighbor-district-name').value = 'タブBの新しい値';
		other.document.getElementById('neighbor-district-name').dispatchEvent(new other.Event('input', { bubbles: true }));
		await ui.waitFor(() => neighborState.district === 'タブBの新しい値' && !notice.hidden, 'This tab reloads and shows the notice', 10000);
		assert.strictEqual(ui.element('#neighbor-district-name').value, 'タブBの新しい値', 'The screen shows the newer value');
		assert.ok(notice.textContent.includes('別のタブで保存データが更新されたため、最新の内容を読み込みました'), 'The notice explains the reload');
		assert.ok(!ui.visible('#storage-lock-modal'), 'This tab does not lock');
		await ui.click('#storage-foreign-update-notice [data-click="dismissForeignStorageNotice"]');
		assert.ok(notice.hidden, 'Closing hides the notice');
		ui.fill('#neighbor-district-name', 'タブAの次の値');
		await ui.waitFor(() => JSON.parse(localStorage.getItem('kogai_neighbor_v2')).district === 'タブAの次の値', 'This tab saves after the reload');
		other.close();
	}, options('neighbor'));
	assertBrowserResult(result);
});

test('UI R-27: a save waiting for the exclusive lock while another window writes never overwrites the newer value', async () => {
	const result = await runInHeadlessChrome(async () => {
		await ui.expand('neighbor');
		ui.fill('#neighbor-district-name', 'タブAの旧値');
		await ui.waitFor(() => JSON.parse(localStorage.getItem('kogai_neighbor_v2') || '{}').district === 'タブAの旧値', 'This tab saves');
		const other = window.open('index.html?mode=neighbor');
		await ui.waitFor(() => { try { return other.document.readyState === 'complete' && other.document.getElementById('neighbor-district-name')?.value === 'タブAの旧値'; } catch (_) { return false; } }, 'Second window ready', 10000);
		let pendingSave;
		await other.navigator.locks.request('kogaidocs:storage', { mode: 'exclusive' }, async () => {
			const model = JSON.parse(localStorage.getItem('kogai_neighbor_v2'));
			model.district = 'タブBの新しい値';
			assert.strictEqual(await other.saveStorageDataUnlocked('kogai_neighbor_v2', JSON.stringify(model)), true, 'Second window writes while holding the lock');
			// 同じタスク内でこのタブの保存を要求し、storage の通知より先に排他待ちへ入れる。
			neighborState.district = 'タブAの古い保存';
			pendingSave = saveNeighborLocal();
		});
		assert.strictEqual(await pendingSave, false, 'The waiting stale save is refused');
		assert.strictEqual(JSON.parse(localStorage.getItem('kogai_neighbor_v2')).district, 'タブBの新しい値', 'The newer value survives');
		await ui.waitFor(() => neighborState.district === 'タブBの新しい値' && !ui.element('#storage-foreign-update-notice').hidden, 'This tab reloads the newer value', 10000);
		assert.ok(!ui.visible('#storage-lock-modal'), 'This tab does not lock');
		other.close();
	}, options('neighbor'));
	assertBrowserResult(result);
});

test('UI R-27: clearing all data in another window empties this tab and its print area, and old values never come back', async () => {
	const result = await runInHeadlessChrome(async () => {
		ui.capturePrints();
		await ui.expand('neighbor');
		ui.fill('#neighbor-district-name', '消される自治会');
		neighborState.neighborhood = [{ role: '会長', lastName: '消される会長', firstName: '', lastNameKana: '', firstNameKana: '', address: '', tel: '', email: '', note: '' }];
		assert.strictEqual(await saveNeighborLocal(), true);
		renderNeighborForm();
		printNeighborRoster();
		assert.ok(ui.element('#print-area').textContent.includes('消される会長'), 'The roster is in the print area');
		const other = window.open('index.html?mode=neighbor');
		await ui.waitFor(() => { try { return other.document.readyState === 'complete' && other.document.getElementById('neighbor-district-name')?.value === '消される自治会'; } catch (_) { return false; } }, 'Second window ready', 10000);
		await other.clearStorageSecurity();
		await ui.waitFor(() => neighborState.district === '' && !ui.element('#storage-foreign-update-notice').hidden, 'This tab reloads the cleared state', 10000);
		assert.strictEqual(ui.element('#print-area').childNodes.length, 0, 'The old roster is removed from the print area');
		assert.ok(!JSON.stringify(neighborState).includes('消される会長'), 'The old members are gone from memory');
		ui.fill('#neighbor-district-name', '新しい自治会');
		await ui.waitFor(() => localStorage.getItem('kogai_neighbor_v2') !== null, 'This tab saves its new input');
		const stored = localStorage.getItem('kogai_neighbor_v2');
		assert.ok(stored.includes('新しい自治会') && !stored.includes('消される'), 'Only the new input is stored');
		other.close();
	}, options('neighbor'));
	assertBrowserResult(result);
});

test('UI R-27: another window saving the household data makes this tab reload, and a conflicting post-submission clear keeps the newer data', async () => {
	const result = await runInHeadlessChrome(async () => {
		ui.fill('#transfer-address', 'タブAの住所');
		await ui.waitFor(() => JSON.parse(localStorage.getItem('kogai_transfer_v2') || '{}').address === 'タブAの住所', 'This tab saves');
		const other = window.open('index.html?mode=transfer');
		await ui.waitFor(() => { try { return other.document.readyState === 'complete' && other.document.getElementById('transfer-address')?.value === 'タブAの住所'; } catch (_) { return false; } }, 'Second window ready', 10000);
		other.document.getElementById('transfer-address').value = 'タブBの住所';
		other.document.getElementById('transfer-address').dispatchEvent(new other.Event('input', { bubbles: true }));
		await ui.waitFor(() => transferState.address === 'タブBの住所' && !ui.element('#storage-foreign-update-notice').hidden, 'This tab reloads the household data', 10000);
		assert.strictEqual(ui.element('#transfer-address').value, 'タブBの住所');
		other.close();
		// 提出後の消去の直前に、別のタブが書き込んだ（通知が届く前）。
		const alerts = [];
		window.alert = message => alerts.push(String(message));
		window.confirm = () => true;
		const newer = JSON.stringify({ ...JSON.parse(localStorage.getItem('kogai_transfer_v2')), address: '消してはいけない住所' });
		localStorage.setItem('kogai_transfer_v2', newer);
		ui.element('#storage-foreign-update-notice').hidden = true;
		assert.strictEqual(await resetTransferForm(), false, 'The clear is not reported as done');
		assert.ok(alerts.includes('家庭・児童の情報を端末から消去できませんでした。最新の内容を確かめて、もう一度消去してください。'), 'The failure is shown');
		assert.strictEqual(localStorage.getItem('kogai_transfer_v2'), newer, 'The newer household data is not erased');
		await ui.waitFor(() => transferState.address === '消してはいけない住所' && !ui.element('#storage-foreign-update-notice').hidden, 'This tab reloads the newer data', 10000);
	}, options('transfer'));
	assertBrowserResult(result);
});

test('UI R-27: an import, a handoff restore and encryption setup after a foreign write are refused, reload and show no failure', async () => {
	const result = await runInHeadlessChrome(async () => {
		const alerts = [];
		window.alert = message => alerts.push(String(message));
		await ui.expand('neighbor');
		ui.fill('#neighbor-district-name', 'タブAの値');
		await ui.waitFor(() => JSON.parse(localStorage.getItem('kogai_neighbor_v2') || '{}').district === 'タブAの値', 'This tab saves');
		const notice = ui.element('#storage-foreign-update-notice');
		const foreign = label => {
			const value = JSON.stringify({ district: label, neighborhood: [] });
			localStorage.setItem('kogai_neighbor_v2', value);
			notice.hidden = true;
			return value;
		};
		let stored = foreign('別のタブの値1');
		let refused = null;
		try { await commitImportedModel('kogai_neighbor_v2', { district: '取込', neighborhood: [] }, getStorageSessionGeneration(), { replace: true }); } catch (error) { refused = error.message; }
		assert.strictEqual(refused, 'STORAGE_SESSION_CHANGED', 'The import is refused');
		await ui.waitFor(() => neighborState.district === '別のタブの値1' && !notice.hidden, 'The import conflict reloads', 10000);
		assert.strictEqual(localStorage.getItem('kogai_neighbor_v2'), stored);

		stored = foreign('別のタブの値2');
		refused = null;
		try { await replaceStoredAppData([currentDistrict, repState, { district: '復元', neighborhood: [] }, transferState]); } catch (error) { refused = error.message; }
		assert.strictEqual(refused, 'STORAGE_SESSION_CHANGED', 'The restore is refused');
		await ui.waitFor(() => neighborState.district === '別のタブの値2' && !notice.hidden, 'The restore conflict reloads', 10000);
		assert.strictEqual(localStorage.getItem('kogai_neighbor_v2'), stored);

		await ui.click('#storage-security-badge');
		ui.fill('#modal-set-pass', 'UiPassword1!');
		ui.fill('#modal-set-pass-confirm', 'UiPassword1!');
		stored = foreign('別のタブの値3');
		await ui.click('#modal-btn-enable-enc');
		await ui.waitFor(() => neighborState.district === '別のタブの値3' && !notice.hidden, 'The setup conflict reloads', 10000);
		assert.ok(!isStorageEncrypted(), 'No encryption is set up');
		assert.ok(!ui.visible('#storage-settings-modal'), 'The settings dialog is closed so the notice is visible');
		assert.strictEqual(localStorage.getItem('kogai_neighbor_v2'), stored);
		assert.strictEqual(JSON.stringify(alerts.filter(message => message.includes('失敗'))), '[]', 'No failure is reported for the conflicts');
	}, options('neighbor'));
	assertBrowserResult(result);
});
