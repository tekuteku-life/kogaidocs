/* =========================================================================
   タブ3：自治会役員モード（自治会役員名簿の独立作成・提出・印刷）
========================================================================= */

function renderNeighborForm() {
	const dNameEl = document.getElementById('neighbor-district-name');
	if (dNameEl) dNameEl.value = neighborState.district || "";
	renderNeighborTable();
}

function renderNeighborTable() {
	const tbody = document.getElementById('neighbor-tbody');
	if (!tbody) return;
	tbody.innerHTML = "";

	if (!neighborState.neighborhood || neighborState.neighborhood.length === 0) {
		tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b; padding:16px;">自治会役員がまだ登録されていません。「＋ 行を追加」ボタンで追加してください。</td></tr>`;
		return;
	}

	neighborState.neighborhood.forEach((row, i) => {
		normalizeNameFields(row);
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td style="text-align:center;">
				<div style="display:flex; flex-direction:column; gap:2px;">
					<button type="button" class="btn btn-outline btn-xs" ${i === 0 ? 'disabled' : ''} data-click="moveNeighborRow" data-index="${i}" data-direction="-1" title="上へ移動">▲</button>
					<button type="button" class="btn btn-outline btn-xs" ${i === neighborState.neighborhood.length - 1 ? 'disabled' : ''} data-click="moveNeighborRow" data-index="${i}" data-direction="1" title="下へ移動">▼</button>
				</div>
			</td>
			<td>
				<input type="text" value="${esc(row.role || '')}" placeholder="会長・副会長等" data-input="updateNeighborItem" data-index="${i}" data-field="role">
			</td>
			<td>
				<div class="name-field-box">
					<div class="name-pair-grid">
						<input type="text" value="${esc(row.lastNameKana || '')}" placeholder="せい" class="input-kana" data-input="updateNeighborItem" data-index="${i}" data-field="lastNameKana">
						<input type="text" value="${esc(row.firstNameKana || '')}" placeholder="めい" class="input-kana" data-input="updateNeighborItem" data-index="${i}" data-field="firstNameKana">
					</div>
					<div class="name-pair-grid">
						<input type="text" value="${esc(row.lastName || '')}" placeholder="姓" data-input="updateNeighborItem" data-index="${i}" data-field="lastName">
						<input type="text" value="${esc(row.firstName || '')}" placeholder="名" data-input="updateNeighborItem" data-index="${i}" data-field="firstName">
					</div>
				</div>
			</td>
			<td><input type="text" value="${esc(row.address || '')}" placeholder="住所（〇〇1-2-3）" data-input="updateNeighborItem" data-index="${i}" data-field="address"></td>
			<td><input type="tel" value="${esc(row.tel || '')}" placeholder="090-0000-0000" data-input="updateNeighborItem" data-index="${i}" data-field="tel"></td>
			<td>
				<input type="email" value="${esc(row.email || '')}" placeholder="メールアドレス（任意）" data-input="updateNeighborItem" data-index="${i}" data-field="email" style="margin-bottom:4px;">
				<input type="text" value="${esc(row.note || '')}" placeholder="備考" data-input="updateNeighborItem" data-index="${i}" data-field="note">
			</td>
			<td style="text-align:center;">
				<button type="button" class="btn btn-danger btn-sm" data-click="removeNeighborRow" data-index="${i}">×</button>
			</td>
		`;
		tbody.appendChild(tr);
	});
}

function addNeighborRow() {
	if (!neighborState.neighborhood) neighborState.neighborhood = [];
	neighborState.neighborhood.push({
		role: "",
		lastName: "",
		firstName: "",
		lastNameKana: "",
		firstNameKana: "",
		address: "",
		tel: "",
		email: "",
		note: ""
	});
	renderNeighborTable();
	saveNeighborLocal();
}

function removeNeighborRow(idx) {
	if (!neighborState.neighborhood || idx < 0 || idx >= neighborState.neighborhood.length) return;
	const row = neighborState.neighborhood[idx];
	const name = (row.lastName || row.firstName) ? `${row.lastName} ${row.firstName}`.trim() : (row.role || `行 ${idx + 1}`);
	if (!confirm(`役員「${name}」を削除しますか？`)) return;
	neighborState.neighborhood.splice(idx, 1);
	renderNeighborTable();
	saveNeighborLocal();
}

function moveNeighborRow(idx, direction) {
	if (!neighborState.neighborhood || idx < 0 || idx >= neighborState.neighborhood.length) return;
	const targetIdx = idx + direction;
	if (targetIdx < 0 || targetIdx >= neighborState.neighborhood.length) return;
	const temp = neighborState.neighborhood[idx];
	neighborState.neighborhood[idx] = neighborState.neighborhood[targetIdx];
	neighborState.neighborhood[targetIdx] = temp;
	renderNeighborTable();
	saveNeighborLocal();
}

function updateNeighborItem(idx, key, val) {
	if (!neighborState.neighborhood || !neighborState.neighborhood[idx]) return;
	neighborState.neighborhood[idx][key] = val;
	saveNeighborLocal();
}

function validateNeighborPasswords() {
	const passEl = document.getElementById('neighbor-pass');
	const confirmEl = document.getElementById('neighbor-pass-confirm');
	const msgEl = document.getElementById('neighbor-pass-match-msg');
	if (!passEl || !msgEl) return;

	const pass = passEl.value;
	const confirm = confirmEl ? confirmEl.value : "";

	if (!pass && !confirm) {
		msgEl.textContent = "";
		msgEl.className = "pass-feedback-msg";
		return;
	}

	const chk = validatePassword(pass);
	if (!chk.valid) {
		msgEl.textContent = "⚠ " + chk.message.replace(/\n/g, " ");
		msgEl.className = "pass-feedback-msg pass-msg-ng";
		return;
	}

	if (!confirm) {
		msgEl.textContent = "確認用パスワードを入力してください";
		msgEl.className = "pass-feedback-msg";
		return;
	}

	if (pass !== confirm) {
		msgEl.textContent = "⚠ パスワードが一致しません";
		msgEl.className = "pass-feedback-msg pass-msg-ng";
	} else {
		msgEl.textContent = "✓ パスワードが一致しました（12文字以上OK）";
		msgEl.className = "pass-feedback-msg pass-msg-ok";
	}
}

async function exportNeighborTxt() {
	saveNeighborLocal();
	const distName = (neighborState.district || "").trim();
	if (!distName) {
		alert("自治会名・地区名を入力してください。");
		return;
	}
	const pass = document.getElementById('neighbor-pass')?.value || "";
	const confirmEl = document.getElementById('neighbor-pass-confirm');
	const passConfirm = confirmEl ? confirmEl.value : pass;

	const chk = validatePassword(pass);
	if (!chk.valid) {
		alert("【保存パスワードエラー】\n" + chk.message);
		return;
	}

	if (confirmEl && pass !== passConfirm) {
		alert("【パスワード不一致エラー】\n入力されたパスワードと確認用パスワードが一致しません。\n内容をご確認の上、再度入力してください。");
		return;
	}

	const payload = {
		isNeighborhoodData: true,
		district: distName,
		neighborhood: neighborState.neighborhood || []
	};

	const encoded = await encryptPayload(JSON.stringify(payload), pass);
	const dateStr = new Date().toISOString().slice(0, 10);
	const content = [
		`--- 校外委員会 自治会役員データ (${distName} / 出力日:${dateStr}) ---`,
		`BEGIN_DATA:`,
		encoded,
		`:END_DATA`
	].join('\n');

	downloadTextFile(content, `自治会役員データ_${distName}_${dateStr}.txt`);
}

async function copyNeighborEncryptedText() {
	saveNeighborLocal();
	const distName = (neighborState.district || "").trim();
	if (!distName) {
		alert("自治会名・地区名を入力してください。");
		return;
	}
	const pass = document.getElementById('neighbor-pass')?.value || "";
	const chk = validatePassword(pass);
	if (!chk.valid) {
		alert("【パスワードエラー】\n" + chk.message);
		return;
	}
	const confirmEl = document.getElementById('neighbor-pass-confirm');
	if (confirmEl && confirmEl.value !== pass) {
		alert('確認用パスワードが一致しません。');
		return;
	}
	const payload = {
		isNeighborhoodData: true,
		district: distName,
		neighborhood: neighborState.neighborhood || []
	};
	const encoded = await encryptPayload(JSON.stringify(payload), pass);
	const text = `BEGIN_DATA:\n${encoded}\n:END_DATA`;

	if (navigator.clipboard && navigator.clipboard.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			alert("暗号化テキストをクリップボードにコピーしました。メールやチャットに貼り付けて提出できます。");
			return;
		} catch (e) {}
	}
	// フォールバック
	const box = document.getElementById('neighbor-paste-box');
	if (box) {
		box.value = text;
		if (typeof box.select === 'function') box.select();
		alert("暗号化テキストを表示しました。枠内の文字列をコピーして提出してください。");
	}
}

async function loadNeighborTxt(e) {
	const generation = getStorageSessionGeneration();
	const importKind = 'neighbor';
	const file = e.target.files[0];
	if (!file) return;
	let pass = document.getElementById('neighbor-import-pass')?.value || "";
	try {
		const text = await readImportFile(file);
		let data;
		try {
			data = await parseTxtContent(text, pass, generation, importKind);
		} catch (err) {
			if (err.code === 'INVALID_IMPORT_DATA' || err.message === 'STORAGE_SESSION_CHANGED') throw err;
			const promptPass = safePrompt("自治会ファイルの復号パスワードを入力してください：");
			if (!promptPass) { e.target.value = ""; return; }
			data = await parseTxtContent(text, promptPass, generation, importKind);
			pass = promptPass;
			const passEl = document.getElementById('neighbor-import-pass');
			if (passEl) passEl.value = promptPass;
		}

		neighborState.district = data.district;
		neighborState.neighborhood = data.neighborhood;
		neighborState.neighborhood.forEach(normalizeNameFields);
		renderNeighborForm();
		saveNeighborLocal();
		alert(`自治会役員データ「${neighborState.district}」（${neighborState.neighborhood.length}名）を読み込みました。`);
	} catch (err) {
		alert(err.code === 'INVALID_IMPORT_DATA' ? err.message : "ファイルの読み込み・復号に失敗しました。パスワードをご確認ください。");
	}
	e.target.value = "";
}

async function loadPastedTextToNeighbor() {
	const generation = getStorageSessionGeneration();
	const importKind = 'neighbor';
	const box = document.getElementById('neighbor-paste-box');
	if (!box) return;
	const raw = box.value.trim();
	if (!raw) return;
	let pass = document.getElementById('neighbor-import-pass')?.value || "";
	try {
		let data;
		try {
			data = await parseTxtContent(raw, pass, generation, importKind);
		} catch (err) {
			if (err.code === 'INVALID_IMPORT_DATA' || err.message === 'STORAGE_SESSION_CHANGED') throw err;
			const promptPass = safePrompt("復号パスワードを入力してください：");
			if (!promptPass) return;
			data = await parseTxtContent(raw, promptPass, generation, importKind);
			pass = promptPass;
			const passEl = document.getElementById('neighbor-import-pass');
			if (passEl) passEl.value = promptPass;
		}

		neighborState.district = data.district;
		neighborState.neighborhood = data.neighborhood;
		neighborState.neighborhood.forEach(normalizeNameFields);
		renderNeighborForm();
		saveNeighborLocal();
		box.value = "";
		alert(`自治会役員データ「${neighborState.district}」（${neighborState.neighborhood.length}名）を読み込みました。`);
	} catch (err) {
		alert(err.code === 'INVALID_IMPORT_DATA' ? err.message : "復号に失敗しました。パスワードを確認してください。");
	}
}

function runNeighborYearUpdate() {
	if (!confirm("【自治会役員名簿の年度更新】\n・現在の役職（会長・副会長等）の枠組みを残し、氏名・ふりがな・住所・連絡先を安全にリセットします。\n\n実行してよろしいですか？")) return;
	// 旧氏名の別名や未知の個人項目を次年度へ持ち越さない。
	neighborState.neighborhood = (neighborState.neighborhood || []).map(row => ({
		role: row.role || "",
		lastName: "", firstName: "", lastNameKana: "", firstNameKana: "",
		address: "", tel: "", email: "", note: ""
	}));
	saveNeighborLocal();
	renderNeighborTable();
	alert("自治会役員名簿の年度更新が完了しました。新年度の役員情報を入力してください。");
}

function printNeighborRoster() {
	saveNeighborLocal();
	if (!neighborState.neighborhood || neighborState.neighborhood.length === 0) {
		alert("自治会役員が登録されていません。");
		return;
	}
	const printArea = document.getElementById('print-area');
	if (!printArea) return;
	printArea.innerHTML = buildNeighborPageHtml({
		district: neighborState.district || "自治会",
		neighborhood: neighborState.neighborhood
	});
	const origTitle = document.title;
	const distName = neighborState.district || "自治会";
	try {
		document.title = `自治会役員名簿_${distName}`;
		window.print();
	} finally {
		document.title = origTitle;
	}
}

function printNeighborTentCards() {
	saveNeighborLocal();
	const validNeighbors = (neighborState.neighborhood || []).filter(n => n.lastName || n.firstName);
	if (validNeighbors.length === 0) {
		alert("名札を印刷する役員の氏名が入力されていません。");
		return;
	}
	const printArea = document.getElementById('print-area');
	if (!printArea) return;
	printArea.innerHTML = validNeighbors.map(n => {
		const org = neighborState.district || "自治会";
		const role = n.role || "役員";
		const name = getFullName(n);
		const ruby = (n.lastNameKana || n.firstNameKana) ? `${n.lastNameKana || ''} ${n.firstNameKana || ''}`.trim() : "";
		return buildTentCardPageHtml(org, name, ruby, role);
	}).join('');
	const origTitle = document.title;
	const distName = neighborState.district || "自治会";
	try {
		document.title = `自治会役員席札_${distName}`;
		window.print();
	} finally {
		document.title = origTitle;
	}
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		renderNeighborForm,
		renderNeighborTable,
		addNeighborRow,
		removeNeighborRow,
		moveNeighborRow,
		updateNeighborItem,
		validateNeighborPasswords,
		exportNeighborTxt,
		copyNeighborEncryptedText,
		loadNeighborTxt,
		loadPastedTextToNeighbor,
		runNeighborYearUpdate,
		printNeighborRoster,
		printNeighborTentCards
	};
	Object.assign(global, module.exports);
}
