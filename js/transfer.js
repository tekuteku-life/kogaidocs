// =========================================================================
// タブ4：転入者モード（家庭側: 児童情報入力・暗号化提出・APPI消去）
// =========================================================================

// 転入者フォームを描画します
function renderTransferForm() {
	const container = document.getElementById('transfer-children-container');
	if (!container) return;

	if (!transferState.children || transferState.children.length === 0) {
		transferState.children = [
			{
				id: 'c_' + Date.now(),
				lastName: "",
				firstName: "",
				lastNameKana: "",
				firstNameKana: "",
				grade: "1",
				className: "1",
				address: "",
				tel: ""
			}
		];
	}

	container.innerHTML = transferState.children.map((child, index) => {
		const canRemove = transferState.children.length > 1;
		return `
			<div class="transfer-child-row card" style="margin-bottom: 1rem; padding: 1rem; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff;">
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.5rem;">
					<strong style="color: #1e293b; font-size: 1rem;">児童 ${index + 1}</strong>
					${canRemove ? `<button type="button" class="btn btn-outline-danger btn-sm" onclick="removeTransferChildRow(${index})" style="font-size: 0.8rem; padding: 2px 8px;">この児童を削除</button>` : ''}
				</div>
				<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem;">
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">学年 <span style="color: #ef4444;">*</span></label>
						<select class="form-control" onchange="updateTransferChild(${index}, 'grade', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
							${[1, 2, 3, 4, 5, 6].map(g => `<option value="${g}" ${String(child.grade) === String(g) ? 'selected' : ''}>${g}年生</option>`).join('')}
						</select>
					</div>
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">組 <span style="color: #ef4444;">*</span></label>
						<input type="text" class="form-control" value="${esc(child.className || child.class || '')}" placeholder="例: 1組" oninput="updateTransferChild(${index}, 'className', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
				</div>
				<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 0.75rem; margin-bottom: 0.75rem;">
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">氏名（姓） <span style="color: #ef4444;">*</span></label>
						<input type="text" class="form-control" value="${esc(child.lastName || '')}" placeholder="例: 山田" oninput="updateTransferChild(${index}, 'lastName', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">氏名（名） <span style="color: #ef4444;">*</span></label>
						<input type="text" class="form-control" value="${esc(child.firstName || '')}" placeholder="例: 太郎" oninput="updateTransferChild(${index}, 'firstName', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">ふりがな（せい）</label>
						<input type="text" class="form-control" value="${esc(child.lastNameKana || '')}" placeholder="例: やまだ" oninput="updateTransferChild(${index}, 'lastNameKana', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">ふりがな（めい）</label>
						<input type="text" class="form-control" value="${esc(child.firstNameKana || '')}" placeholder="例: たろう" oninput="updateTransferChild(${index}, 'firstNameKana', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
				</div>
				<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem;">
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">住所</label>
						<input type="text" class="form-control" value="${esc(child.address || '')}" placeholder="例: ○○町1-2-3 ○○マンション101" oninput="updateTransferChild(${index}, 'address', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
					<div>
						<label style="display: block; font-size: 0.8rem; color: #475569; margin-bottom: 2px;">電話番号</label>
						<input type="tel" class="form-control" value="${esc(child.tel || '')}" placeholder="例: 090-1234-5678" oninput="updateTransferChild(${index}, 'tel', this.value)" style="width: 100%; padding: 6px; border: 1px solid #cbd5e1; border-radius: 4px;">
					</div>
				</div>
			</div>
		`;
	}).join('');
}

// 児童行を追加します（兄弟姉妹）
function addTransferChildRow() {
	const lastChild = transferState.children[transferState.children.length - 1];
	transferState.children.push({
		id: 'c_' + Date.now() + Math.random().toString(36).slice(2, 6),
		lastName: lastChild ? lastChild.lastName : "",
		firstName: "",
		lastNameKana: lastChild ? lastChild.lastNameKana : "",
		firstNameKana: "",
		grade: "1",
		className: "1",
		address: lastChild ? lastChild.address : "",
		tel: lastChild ? lastChild.tel : ""
	});
	renderTransferForm();
	saveTransferLocal();
}

// 児童行を削除します
function removeTransferChildRow(index) {
	if (transferState.children.length <= 1) {
		transferState.children[0] = {
			id: 'c_' + Date.now(),
			lastName: "",
			firstName: "",
			lastNameKana: "",
			firstNameKana: "",
			grade: "1",
			className: "1",
			address: "",
			tel: ""
		};
	} else {
		transferState.children.splice(index, 1);
	}
	renderTransferForm();
	saveTransferLocal();
}

// 児童の各項目を更新します
function updateTransferChild(index, field, value) {
	if (!transferState.children[index]) return;
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

// 転入児童データを暗号化してファイル保存します
async function exportTransferTxt() {
	if (!validateTransferPasswords()) {
		alert("暗号化パスワードは12文字以上（英大文字・小文字・数字・記号）で、確認用と一致させて入力してください。");
		return false;
	}
	if (!transferState.children || transferState.children.length === 0) {
		alert("児童情報が入力されていません。");
		return false;
	}

	const hasEmptyName = transferState.children.some(c => !c.lastName || !c.firstName);
	if (hasEmptyName) {
		alert("すべての児童の氏名（姓・名）を入力してください。");
		return false;
	}

	const password = document.getElementById('transfer-export-pass').value;
	const firstLastName = transferState.children[0].lastName;

	const payload = {
		isTransferData: true,
		version: 1,
		exportedAt: new Date().toISOString(),
		children: transferState.children,
		students: transferState.children.map(c => ({
			...c,
			class: c.className || c.class || '1'
		}))
	};

	try {
		const encrypted = await encryptPayload(JSON.stringify(payload), password);
		const outputContent = `BEGIN_DATA:\n${encrypted}\n:END_DATA`;
		const filename = `転入児童データ_${firstLastName}.txt`;
		downloadTextFile(outputContent, filename);
		alert(`転入児童データを暗号化してファイル出力しました（${filename}）。\nこのファイルを校外委員会の地区役員または代表役員へお渡しください。`);
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
	if (!transferState.children || transferState.children.length === 0) {
		alert("児童情報が入力されていません。");
		return false;
	}

	const hasEmptyName = transferState.children.some(c => !c.lastName || !c.firstName);
	if (hasEmptyName) {
		alert("すべての児童の氏名（姓・名）を入力してください。");
		return false;
	}

	const password = document.getElementById('transfer-export-pass').value;
	const payload = {
		isTransferData: true,
		version: 1,
		exportedAt: new Date().toISOString(),
		children: transferState.children,
		students: transferState.children.map(c => ({
			...c,
			class: c.className || c.class || '1'
		}))
	};

	try {
		const encrypted = await encryptPayload(JSON.stringify(payload), password);
		const fullText = `BEGIN_DATA:\n${encrypted}\n:END_DATA`;
		await navigator.clipboard.writeText(fullText);
		alert("暗号化された転入児童データをクリップボードにコピーしました。\nLINEやメール等で役員へ送信してください。");
		return true;
	} catch (e) {
		alert("クリップボードへのコピーに失敗しました: " + e.message);
		return false;
	}
}

// 提出後のワンタップリセット（個人情報保護・APPI第22条対応）
function resetTransferForm() {
	if (!confirm("入力された転入児童情報をすべて消去しますか？\n（提出完了後のプライバシー保護のため、端末からの消去を推奨します）")) {
		return;
	}
	transferState.children = [
		{
			id: 'c_' + Date.now(),
			lastName: "",
			firstName: "",
			lastNameKana: "",
			firstNameKana: "",
			grade: "1",
			className: "1",
			address: "",
			tel: ""
		}
	];
	transferState.memo = "";

	const p1 = document.getElementById('transfer-export-pass');
	const p2 = document.getElementById('transfer-export-pass-confirm');
	if (p1) p1.value = "";
	if (p2) p2.value = "";

	renderTransferForm();
	saveTransferLocal();
}

// 画面ロック時のメモリ・DOM完全消去
function clearTransferForm() {
	transferState.children = [
		{
			id: 'c_' + Date.now(),
			lastName: "",
			firstName: "",
			lastNameKana: "",
			firstNameKana: "",
			grade: "1",
			className: "1",
			address: "",
			tel: ""
		}
	];
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
	try {
		const data = await loadStorageDecrypted('kogai_transfer_v2');
		if (data && Array.isArray(data.children) && data.children.length > 0) {
			transferState.children = data.children;
			transferState.memo = data.memo || "";
		}
	} catch (e) {
		console.warn("Failed to load transfer local state", e);
	}
	renderTransferForm();
}

// 転入者画面用URLを共有します
async function shareTransferAppUrl() {
	if (typeof shareAppUrl === 'function') {
		return shareAppUrl('transfer');
	}
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
	global.shareTransferAppUrl = shareTransferAppUrl;

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
		shareTransferAppUrl
	};
}
