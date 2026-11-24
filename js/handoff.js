/* ブラウザ間の保存領域を共有せず、暗号化データで途中入力を引き継ぐ。 */
const HANDOFF_KEYS = ['kogai_district_v2', 'kogai_rep_v2', 'kogai_neighbor_v2', 'kogai_transfer_v2'];
const HANDOFF_OFFICER_DRAFT_IDS = ['d-paste-box', 'd-neighbor-paste-box', 'd-transfer-paste-box',
	'rep-paste-box', 'rep-transfer-paste-box', 'rep-new-district-name'];
const HANDOFF_DRAFT_IDS = [...HANDOFF_OFFICER_DRAFT_IDS.slice(0, 5), 'neighbor-paste-box', 'rep-new-district-name'];
let handoffEpoch = 0;
let handoffBusy = false;

function resolveCurrentHandoffMode() {
	const memMode = typeof getActiveAppMode === 'function' ? getActiveAppMode() : null;
	if (['district', 'rep', 'neighbor', 'transfer'].includes(memMode)) return memMode;
	const stored = localStorage.getItem('kogai_active_mode');
	return ['district', 'rep', 'neighbor', 'transfer'].includes(stored) ? stored : 'district';
}

function hasOfficerHandoffData(payload) {
	if (!payload || typeof payload !== 'object') return false;
	if (['district', 'rep'].includes(payload.mode)) return true;
	if (hasNonEmptyOfficerModels(payload.models) || payload.repDraft != null) return true;
	const drafts = payload.drafts || {};
	return HANDOFF_OFFICER_DRAFT_IDS.some(id => String(drafts[id] || '') !== '');
}

function isLineInAppBrowser(userAgent = navigator.userAgent || '') {
	return /(?:^|[\s;(])Line\/\d+(?:\.\d+)*/i.test(userAgent);
}

function buildExternalBrowserUrl(location = window.location, mode = 'district') {
	const url = new URL(location.href);
	if (!['https:', 'http:'].includes(url.protocol)) return '';
	url.username = ''; url.password = ''; url.search = ''; url.hash = '';
	url.searchParams.set('mode', ['district', 'rep', 'neighbor', 'transfer'].includes(mode) ? mode : 'district');
	url.searchParams.set('openExternalBrowser', '1');
	return url.href;
}

function initializeBrowserHandoff() {
	updateLineBrowserNotice();
	document.getElementById('browser-handoff-dialog').addEventListener('cancel', event => { event.preventDefault(); clearBrowserHandoff(); });
}

function updateLineBrowserNotice() {
	const notice = document.getElementById('line-browser-notice');
	if (notice) notice.hidden = !isLineInAppBrowser();
	const mode = resolveCurrentHandoffMode();
	const url = buildExternalBrowserUrl(window.location, mode);
	for (const link of document.querySelectorAll('[data-external-browser-link]')) {
		link.href = url;
		link.hidden = !url;
	}
}

function validateBrowserHandoff(value) {
	validateImportStructure(value);
	requireImportShape(isImportObject(value) && value.type === 'kogaidocs-browser-handoff' && value.version === 1);
	requireImportShape(['district', 'rep', 'neighbor', 'transfer'].includes(value.mode));
	requireImportShape(Array.isArray(value.models) && value.models.length === 4 && isImportObject(value.drafts));
	// 引き継ぎ元の端末保存値と同じく、旧版の不合格値は修復して受け入れる（I-12-05）。
	const models = value.models.map((model, index) => validateStoredData(model, HANDOFF_KEYS[index], { repair: true }));
	models.forEach(model => { delete model.savedFilePassword; });
	const drafts = {};
	for (const [id, text] of Object.entries(value.drafts)) {
		requireImportShape(HANDOFF_DRAFT_IDS.includes(id) && typeof text === 'string');
		// 地区追加の地区名は maxlength を迂回させない（SEC-35）。
		if (id === 'rep-new-district-name') requireImportShape(text.length <= 4096);
		drafts[id] = text;
	}
	let repDraft = null;
	if (value.repDraft != null) {
		const draft = value.repDraft;
		requireImportShape(isImportObject(draft) && Number.isInteger(draft.index) && draft.index >= 0 && draft.index < models[1].districts.length);
		const original = models[1].districts[draft.index];
		const district = validateImportData({ districts: [draft.district] }, 'rep').districts[0];
		requireImportShape(district.district === original.district);
		for (const [field, rows] of [['officerIndexes', 'officers'], ['neighborIndexes', 'neighborhood']]) {
			const indexes = draft[field];
			requireImportShape(Array.isArray(indexes) && indexes.length === district[rows].length);
			requireImportShape(indexes.every(index => index === null || (Number.isInteger(index) && index >= 0 && index < original[rows].length)));
			const retained = indexes.filter(index => index !== null);
			requireImportShape(new Set(retained).size === retained.length);
		}
		repDraft = { index: draft.index, district, officerIndexes: draft.officerIndexes, neighborIndexes: draft.neighborIndexes };
	}
	return { type: value.type, version: 1, mode: value.mode, models, drafts, repDraft };
}

async function collectBrowserHandoff() {
	const generation = getStorageSessionGeneration();
	assertStorageSession(generation);
	const activeMode = resolveCurrentHandoffMode();
	const plaintextOfficerDenied = typeof officerPlaintextWriteDenied === 'function' && officerPlaintextWriteDenied('kogai_district_v2');
	if (plaintextOfficerDenied && ['district', 'rep'].includes(activeMode)) {
		throw new Error('端末暗号化が未設定のため、役員データの引き継ぎはできません。 (STORAGE_ENCRYPTION_REQUIRED)');
	}
	// 停止中キーの既定モデルで復元先の有効なデータを上書きしない（I-12-07）。
	if (typeof getSuspendedStorageKeys === 'function' && getSuspendedStorageKeys().length) {
		throw new Error('保存を停止しているモードがあるため、引き継ぎを作成できません。全消去するか、正しいデータを復元してください。');
	}
	const saved = await Promise.all([saveDistrictLocal(), saveRepLocal(), saveNeighborLocal(), saveTransferLocal()]);
	if (saved.some((result, index) => result === false && !(typeof officerPlaintextWriteDenied === 'function' && officerPlaintextWriteDenied(HANDOFF_KEYS[index])))) {
		if (typeof getStorageSaveRejectedKeys === 'function' && getStorageSaveRejectedKeys().length) {
			throw new Error('端末に保存できない内容があります。直前の変更を元に戻してから再試行してください。');
		}
		throw new Error('入力の保存に失敗しました。引き継ぎを中止します。');
	}
	assertStorageSession(generation);
	if (plaintextOfficerDenied) {
		const guestDraft = document.getElementById('neighbor-paste-box').value;
		const emptyDistrict = { district: '', han: '', hanList: [], officers: [], neighborhood: [], students: [] };
		const emptyRep = { districts: [], szExternals: [], seatConfig: { cols: 4, rows: 5, cells: {} } };
		return validateBrowserHandoff({
			type: 'kogaidocs-browser-handoff',
			version: 1,
			mode: activeMode,
			models: [emptyDistrict, emptyRep, neighborState, transferState],
			drafts: { 'neighbor-paste-box': guestDraft },
			repDraft: null
		});
	}
	const drafts = {};
	for (const id of HANDOFF_DRAFT_IDS) drafts[id] = document.getElementById(id).value;
	return validateBrowserHandoff({ type: 'kogaidocs-browser-handoff', version: 1,
		mode: activeMode,
		models: [currentDistrict, repState, neighborState, transferState], drafts, repDraft: captureRepDetailDraft() });
}

function clearBrowserHandoff() {
	handoffEpoch++;
	handoffBusy = false;
	const dialog = document.getElementById('browser-handoff-dialog');
	for (const input of [...dialog.querySelectorAll('input'), ...dialog.querySelectorAll('textarea')]) input.value = '';
	for (const button of dialog.querySelectorAll('[data-handoff-task]')) button.disabled = false;
	document.getElementById('handoff-result').hidden = true;
	document.getElementById('handoff-status').textContent = '';
	if (dialog.open) dialog.close();
}

function openBrowserHandoff() {
	clearBrowserHandoff();
	updateLineBrowserNotice();
	document.getElementById('browser-handoff-dialog').showModal();
}

async function runHandoffTask(task) {
	if (handoffBusy) return false;
	const epoch = handoffEpoch;
	const generation = getStorageSessionGeneration();
	const ensure = (expectedGeneration = generation) => {
		assertStorageSession(expectedGeneration);
		if (epoch !== handoffEpoch || !document.getElementById('browser-handoff-dialog').open) throw new Error('引き継ぎ画面が閉じられました。');
	};
	handoffBusy = true;
	for (const button of document.querySelectorAll('[data-handoff-task]')) button.disabled = true;
	try {
		ensure();
		document.getElementById('handoff-status').textContent = '処理中です。';
		await task(ensure);
		return true;
	} catch (error) {
		// 他タブ更新等によるロックでは失敗表示を出さず、ロック理由の表示に委ねる（I-12-06）。
		if (epoch === handoffEpoch) document.getElementById('handoff-status').textContent = error.message === 'STORAGE_SESSION_CHANGED' ? '' : '引き継ぎに失敗しました：' + error.message;
		return false;
	} finally {
		if (epoch === handoffEpoch) {
			handoffBusy = false;
			for (const button of document.querySelectorAll('[data-handoff-task]')) button.disabled = false;
		}
	}
}

async function createBrowserHandoff() {
	return runHandoffTask(async ensure => {
		document.getElementById('handoff-output').value = '';
		document.getElementById('handoff-result').hidden = true;
		const password = document.getElementById('handoff-create-pass').value;
		const check = validatePassword(password);
		if (!check.valid) throw new Error(check.message);
		if (password !== document.getElementById('handoff-confirm-pass').value) throw new Error('パスワードが一致しません。');
		const payload = await collectBrowserHandoff();
		ensure();
		const text = await encryptPayload(JSON.stringify(payload), password);
		ensure();
		document.getElementById('handoff-output').value = text;
		document.getElementById('handoff-result').hidden = false;
		document.getElementById('handoff-create-pass').value = '';
		document.getElementById('handoff-confirm-pass').value = '';
		document.getElementById('handoff-status').textContent = '移動前にファイル保存またはコピーを行い、移動先で復元してください。作成後の追加入力には再作成が必要です。';
	});
}

function saveBrowserHandoff() {
	const text = document.getElementById('handoff-output').value;
	if (text) downloadTextFile(text, 'kogaidocs_ブラウザ引き継ぎ.txt');
}

async function copyBrowserHandoff() {
	const output = document.getElementById('handoff-output');
	if (!output.value) return;
	const epoch = handoffEpoch;
	try {
		await navigator.clipboard.writeText(output.value);
		if (epoch === handoffEpoch) document.getElementById('handoff-status').textContent = '暗号化データをコピーしました。通常ブラウザで「ブラウザ間引き継ぎ」から復元してください。';
	} catch (_) {
		if (epoch !== handoffEpoch) return;
		output.focus(); output.select();
		document.getElementById('handoff-status').textContent = '暗号化データを選択しました。手動でコピーしてください。';
	}
}

async function restoreBrowserHandoff() {
	return runHandoffTask(async ensure => {
		const file = document.getElementById('handoff-file').files[0];
		const password = document.getElementById('handoff-restore-pass').value;
		const text = file ? await readImportFile(file) : document.getElementById('handoff-input').value;
		ensure();
			const payload = validateBrowserHandoff(await parseTxtContent(text, password));
			ensure();
			if (typeof officerPlaintextWriteDenied === 'function' && officerPlaintextWriteDenied('kogai_district_v2') && hasOfficerHandoffData(payload)) {
				throw new Error('端末暗号化が未設定のため、役員データの引き継ぎはできません。 (STORAGE_ENCRYPTION_REQUIRED)');
			}
			// 置換対象と同じ判定で確認文を決める（QA-01）。
			const replacesOfficers = hasNonEmptyOfficerModels(payload.models);
			const question = replacesOfficers
				? 'このブラウザの地区・代表・自治会・転入者データを引き継ぎデータで置き換えますか？'
				: 'このブラウザの自治会・転入者データを引き継ぎデータで置き換えますか？\n（役員の名簿データを含まない引き継ぎのため、地区・代表データは保持します）';
			if (!confirm(question)) {
				document.getElementById('handoff-status').textContent = '復元を取り消しました。';
				return;
			}
			const result = await replaceStoredAppData(payload.models, ensure);
			ensure(result.generation);
			const adopted = [currentDistrict, repState, neighborState, transferState]
				.map((current, index) => result.replacedKeys.includes(HANDOFF_KEYS[index]) ? result.models[index] : current);
			[currentDistrict, repState, neighborState, transferState] = adopted;
			if (typeof state !== 'undefined') [state.currentDistrict, state.repState, state.neighborState, state.transferState] = adopted;
			renderDistrictForm(); renderRepAll(); renderNeighborForm(); renderTransferForm();
			switchTab(payload.mode);
			setAllCardsCollapse(false, 'tab-' + payload.mode);
			if (typeof resetPasswordInputs === 'function') resetPasswordInputs(document);
			const hataLineEl = document.getElementById('hata-line-text');
			if (hataLineEl) { hataLineEl.value = ''; hataLineEl.hidden = true; }
			const printAreaEl = document.getElementById('print-area');
			if (printAreaEl) printAreaEl.replaceChildren();
			markHataSaved();
			clearBrowserHandoff();
			restoreRepDetailDraft(payload.repDraft);
			if (!payload.repDraft && payload.drafts['rep-new-district-name']) openAddDistrictModal();
			for (const id of HANDOFF_DRAFT_IDS) {
				const draftEl = document.getElementById(id);
				if (draftEl) draftEl.value = (payload.drafts && payload.drafts[id]) || '';
			}
			alert('途中入力を復元しました。パスワードや未読込ファイルは再入力してください。');
	});
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = { initializeBrowserHandoff, isLineInAppBrowser, buildExternalBrowserUrl, updateLineBrowserNotice, validateBrowserHandoff,
		hasOfficerHandoffData, collectBrowserHandoff, clearBrowserHandoff, openBrowserHandoff, createBrowserHandoff, saveBrowserHandoff,
		copyBrowserHandoff, restoreBrowserHandoff };
	Object.assign(global, module.exports);
}
