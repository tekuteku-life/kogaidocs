// =========================================================================
// タブ4：家庭情報入力モード（新入生・転入生）
// =========================================================================

function createTransferChild(lastName = '') {
	return { id: 'c_' + Date.now() + Math.random().toString(36).slice(2, 6), lastName, firstName: '', grade: '1', className: '1' };
}

// 旧下書きの連絡先を家庭欄へ移す。空欄へ戻した値は旧児童値で補完しない。
function normalizeTransferHousehold() {
	for (const field of ['address', 'tel']) {
		if (transferState[field] === undefined) transferState[field] = transferState.children?.[0]?.[field] || '';
	}
}

function updateTransferHousehold(field, value) {
	if (!['address', 'tel'].includes(field)) return;
	transferState[field] = value;
	saveTransferLocal();
}

// 家庭情報と児童情報を描画します
function renderTransferForm() {
	const container = document.getElementById('transfer-children-container');
	if (!container) return;

	normalizeTransferHousehold();
	for (const [field, id] of [['address', 'transfer-address'], ['tel', 'transfer-tel']]) {
		const input = document.getElementById(id);
		if (input) input.value = transferState[field];
	}
	if (!transferState.children || transferState.children.length === 0) transferState.children = [createTransferChild()];

	container.innerHTML = transferState.children.map((child, index) => {
		if (child.className === undefined || (child.className === '' && child.class)) child.className = child.class || '1';
		const canRemove = transferState.children.length > 1;
		return `
			<div class="transfer-child-row card" style="margin-bottom: 1rem; padding: 1rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff;">
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem;">
					<strong style="color: #1e293b; font-size: 1rem;">児童 ${index + 1}</strong>
					${canRemove ? `<button type="button" class="btn btn-outline-danger btn-sm" data-click="removeTransferChildRow" data-index="${index}" style="font-size: 0.8rem; padding: 2px 8px;">この児童を削除</button>` : ''}
				</div>
				<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem;">
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">学年 <span style="color: #ef4444;">*</span></label>
						<select class="form-control" data-change="updateTransferChild" data-index="${index}" data-field="grade" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
							<option value="" ${!/^[1-6]$/.test(child.grade) ? 'selected' : ''}>学年を選択</option>
							${[1, 2, 3, 4, 5, 6].map(g => `<option value="${g}" ${String(child.grade) === String(g) ? 'selected' : ''}>${g}年生</option>`).join('')}
						</select>
					</div>
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">組 <span style="color: #ef4444;">*</span></label>
						<input type="text" maxlength="4096" class="form-control" value="${esc(child.className || child.class || '')}" placeholder="例: 1組" data-input="updateTransferChild" data-index="${index}" data-field="className" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
				</div>
				<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem;">
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">氏名（姓） <span style="color: #ef4444;">*</span></label>
						<input type="text" maxlength="4096" class="form-control" value="${esc(child.lastName || '')}" placeholder="例: 山田" data-input="updateTransferChild" data-index="${index}" data-field="lastName" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">氏名（名） <span style="color: #ef4444;">*</span></label>
						<input type="text" maxlength="4096" class="form-control" value="${esc(child.firstName || '')}" placeholder="例: 太郎" data-input="updateTransferChild" data-index="${index}" data-field="firstName" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
				</div>
			</div>
		`;
	}).join('');
}

// 児童行を追加します（兄弟姉妹）
function addTransferChildRow() {
	const lastChild = transferState.children[transferState.children.length - 1];
	transferState.children.push(createTransferChild(lastChild ? lastChild.lastName : ''));
	renderTransferForm();
	saveTransferLocal();
}

// 児童行を削除します
function removeTransferChildRow(index) {
	if (!transferState.children || !transferState.children[index]) return;
	const child = transferState.children[index];
	const name = ((child.lastName || '') + ' ' + (child.firstName || '')).trim();
	if (name) {
		if (!confirm('児童「' + name + '」の入力情報を削除しますか？')) {
			return;
		}
	}
	if (transferState.children.length <= 1) {
		transferState.children[0] = createTransferChild();
	} else {
		transferState.children.splice(index, 1);
	}
	renderTransferForm();
	saveTransferLocal();
}

// 児童の各項目を更新します
function updateTransferChild(index, field, value) {
	if (!transferState.children[index] || !['grade', 'className', 'lastName', 'firstName'].includes(field)) return;
	transferState.children[index][field] = value;
	if (field === 'className') {
		transferState.children[index].class = value;
	}
	saveTransferLocal();
}

// 出力用パスワードを検証します
function validateTransferPasswords() {
	const p1 = document.getElementById('transfer-export-pass')?.value || '';
	const p2 = document.getElementById('transfer-export-pass-confirm')?.value || '';

	if (!p1) {
		return false;
	}
	const check = validatePassword(p1);
	if (!check.valid) {
		return false;
	}
	if (p1 !== p2) {
		return false;
	}
	return true;
}

// ファイルとコピーに同一の必須検証・出力契約を適用する。
function buildTransferPayload() {
	normalizeTransferHousehold();
	if (!transferState.children?.length) {
		alert('児童情報が入力されていません。');
		return null;
	}
	const requiredText = value => typeof value === 'string' && value.trim() !== '' && value.length <= 4096;
	if (!['address', 'tel'].every(field => requiredText(transferState[field])) ||
		transferState.children.some(child => !['lastName', 'firstName', 'className'].every(field => requiredText(child[field])) || !/^[1-6]$/.test(child.grade))) {
		alert('住所、電話番号と、すべての児童の氏名（姓・名）、学年、組を入力してください。組が未定の場合は「未定」と入力してください。');
		return null;
	}
	const { address, tel } = transferState;
	const children = transferState.children.map(child => ({
		id: child.id, lastName: child.lastName, firstName: child.firstName,
		grade: child.grade, className: child.className, class: child.className,
		address, tel
	}));
	return { isTransferData: true, version: 2, exportedAt: new Date().toISOString(), address, tel, children, students: children };
}

// 転入児童データを暗号化してファイル保存します
async function exportTransferTxt() {
	if (!validateTransferPasswords()) {
		alert("暗号化パスワードは12文字以上（英大文字・小文字・数字・記号）で、確認用と一致させて入力してください。");
		return false;
	}
	const payload = buildTransferPayload();
	if (!payload) return false;
	const password = document.getElementById('transfer-export-pass').value;

	try {
		const encrypted = await encryptPayload(JSON.stringify(payload), password);
		const outputContent = `BEGIN_DATA:\n${encrypted}\n:END_DATA`;
		const filename = '家庭情報データ.txt';
		downloadTextFile(outputContent, filename);
		alert(`家庭情報データを暗号化してファイル出力しました（${filename}）。\nこのファイルを指定された提出先へお渡しください。`);
		return true;
	} catch (e) {
		alert("暗号化ファイル出力に失敗しました: " + e.message);
		return false;
	}
}

// 転入児童データを暗号化してクリップボードにコピーします
async function copyTransferEncryptedText() {
	if (!validateTransferPasswords()) {
		alert("暗号化パスワードは12文字以上で確認用と一致させて入力してください。");
		return false;
	}
	const payload = buildTransferPayload();
	if (!payload) return false;
	const password = document.getElementById('transfer-export-pass').value;

	try {
		const encrypted = await encryptPayload(JSON.stringify(payload), password);
		const fullText = `BEGIN_DATA:\n${encrypted}\n:END_DATA`;
		await navigator.clipboard.writeText(fullText);
		alert("暗号化された家庭情報データをクリップボードにコピーしました。\nLINEやメール等で指定された提出先へ送信してください。");
		return true;
	} catch (e) {
		alert("クリップボードへのコピーに失敗しました: " + e.message);
		return false;
	}
}

// 提出後のワンタップリセット（個人情報保護・APPI第22条対応）
async function resetTransferForm() {
	if (!confirm("入力された家庭・児童情報をすべて消去しますか？\n（提出完了後のプライバシー保護のため、端末からの消去を推奨します）")) {
		return false;
	}
	transferState.children = [createTransferChild()];
	transferState.address = '';
	transferState.tel = '';
	transferState.memo = "";

	const p1 = document.getElementById('transfer-export-pass');
	const p2 = document.getElementById('transfer-export-pass-confirm');
	if (p1) p1.value = "";
	if (p2) p2.value = "";

	renderTransferForm();
	await saveTransferLocal();
	return true;
}

// 画面ロック時のメモリ・DOM完全消去
function clearTransferForm() {
	transferState.children = [createTransferChild()];
	transferState.address = '';
	transferState.tel = '';
	transferState.memo = "";
	const p1 = document.getElementById('transfer-export-pass');
	const p2 = document.getElementById('transfer-export-pass-confirm');
	if (p1) p1.value = "";
	if (p2) p2.value = "";
	renderTransferForm();
}

// ローカルストレージへの自動保存
function saveTransferLocal() {
	if (typeof state !== 'undefined') {
		state.transferState = transferState;
	}
	return saveStorageData('kogai_transfer_v2', transferState);
}

// ローカルストレージからの読み込み
async function loadTransferLocal() {
	const generation = getStorageSessionGeneration();
	try {
		const data = await loadStorageDecrypted('kogai_transfer_v2');
		if (data !== null) {
			const clean = validateStoredData(data, 'kogai_transfer_v2');
			assertStorageSession(generation);
			transferState.children = clean.children;
			transferState.memo = clean.memo;
			for (const field of ['address', 'tel']) transferState[field] = clean[field];
		}
	} catch (e) {
		console.warn("Failed to load transfer local state", e);
	}
	renderTransferForm();
}

if (typeof module !== 'undefined' && module.exports) {
	global.transferState = transferState;
	global.renderTransferForm = renderTransferForm;
	global.addTransferChildRow = addTransferChildRow;
	global.removeTransferChildRow = removeTransferChildRow;
	global.updateTransferChild = updateTransferChild;
	global.validateTransferPasswords = validateTransferPasswords;
	global.exportTransferTxt = exportTransferTxt;
	global.copyTransferEncryptedText = copyTransferEncryptedText;
	global.resetTransferForm = resetTransferForm;
	global.clearTransferForm = clearTransferForm;
	global.saveTransferLocal = saveTransferLocal;
	global.loadTransferLocal = loadTransferLocal;
	global.updateTransferHousehold = updateTransferHousehold;

	module.exports = {
		get transferState() { return (typeof transferState !== 'undefined' && transferState) ? transferState : (global.transferState || (typeof state !== 'undefined' ? state.transferState : null)); },
		set transferState(v) { if (typeof transferState !== 'undefined') transferState = v; global.transferState = v; },
		renderTransferForm,
		addTransferChildRow,
		removeTransferChildRow,
		updateTransferChild,
		validateTransferPasswords,
		exportTransferTxt,
		copyTransferEncryptedText,
		resetTransferForm,
		clearTransferForm,
		saveTransferLocal,
		loadTransferLocal,
		updateTransferHousehold
	};
}
