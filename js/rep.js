/* =========================================================================
   タブ2：校外代表モード（集約・スクゾ関係者管理・代表データ管理）
========================================================================= */

function renderRepAll() {
	renderRepDistrictsTable();
	renderSzNeighborhoodSelector();
	renderSzExternalTable();
	renderSeatEditor();
}

function upsertRepDistrict(d) {
	if (!d.officers || !Array.isArray(d.officers) || d.officers.length === 0) {
		d.officers = [d.officer || {}];
	}
	delete d.officer;
	d.officers.forEach(off => {
		normalizeOfficerChildNames(off);
		normalizeNameFields(off);
	});
	(d.neighborhood || []).forEach(normalizeNameFields);
	(d.students || []).forEach(s => {
		normalizeNameFields(s);
		if (s.han === undefined) s.han = d.han || "";
		if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
	});

	if (d.hanList === undefined) d.hanList = getDistrictHanList(d);
	d.han = d.han || "";
	let existingIdx = repState.districts.findIndex(x => x.district === d.district && (x.han || "") === d.han);
	if (existingIdx < 0) {
		// 自治会先行インポートで作成された空のプレースホルダーがあれば置き換え対象とする
		const placeholderIdx = repState.districts.findIndex(x => 
			x.district === d.district && 
			(!x.students || x.students.length === 0) && 
			(!x.officers || x.officers.length === 0) && 
			(!x.han)
		);
		if (placeholderIdx >= 0) {
			existingIdx = placeholderIdx;
		}
	}

	// 自治会役員データの保護:
	// 代表側にすでに有効な自治会役員が存在し、提出データ側の neighborhood が空の場合は代表側の自治会役員を保護
	const incomingHasNeighbors = (d.neighborhood || []).some(n => n.lastName || n.firstName || n.role);
	if (!incomingHasNeighbors) {
		const existingWithNeighbors = repState.districts.find(x => 
			x.district === d.district && 
			(x.neighborhood || []).some(n => n.lastName || n.firstName || n.role)
		);
		if (existingWithNeighbors) {
			d.neighborhood = JSON.parse(JSON.stringify(existingWithNeighbors.neighborhood));
		}
	}

	// 自治会役員の初期チェック（役職に「会長」が含まれる人をデフォルトON、いなければ先頭をON）
	const defaultChecks = {};
	(d.neighborhood || []).forEach((n, idx) => {
		if (n.role && n.role.includes("会長")) defaultChecks[idx] = true;
	});
	if (Object.keys(defaultChecks).length === 0 && (d.neighborhood || []).length > 0) {
		defaultChecks[0] = true;
	}

	const wrapped = {
		...JSON.parse(JSON.stringify(d)),
		selectedForPrint: existingIdx >= 0 ? repState.districts[existingIdx].selectedForPrint : true,
		szNeighborChecks: existingIdx >= 0 ? (repState.districts[existingIdx].szNeighborChecks || defaultChecks) : defaultChecks
	};

	if (existingIdx >= 0) repState.districts[existingIdx] = wrapped;
	else repState.districts.push(wrapped);
	saveRepLocal();
}

function mergeNeighborDataIntoRep(data) {
	if (!data) return;
	const nList = data.neighborhood || (Array.isArray(data) ? data : []);
	const dName = (data.district || "").trim() || "未設定地区";
	nList.forEach(normalizeNameFields);

	const defaultChecks = {};
	nList.forEach((n, idx) => {
		if (n.role && n.role.includes("会長")) defaultChecks[idx] = true;
	});
	if (Object.keys(defaultChecks).length === 0 && nList.length > 0) {
		defaultChecks[0] = true;
	}

	const matching = repState.districts.filter(x => (x.district || "").trim() === dName);
	if (matching.length > 0) {
		matching.forEach(d => {
			d.neighborhood = JSON.parse(JSON.stringify(nList));
			d.szNeighborChecks = { ...defaultChecks, ...(d.szNeighborChecks || {}) };
		});
	} else {
		repState.districts.push({
			district: dName,
			han: "",
			hanList: [],
			officers: [],
			neighborhood: JSON.parse(JSON.stringify(nList)),
			students: [],
			selectedForPrint: true,
			szNeighborChecks: defaultChecks
		});
	}
	saveRepLocal();
}

async function loadMultipleDistrictFiles(e) {
	const files = Array.from(e.target.files);
	if (!files.length) return;
	const pass = document.getElementById('rep-pass').value;
	let ok = 0, ng = 0;
	for (const f of files) {
		try {
			const data = await parseTxtContent(await f.text(), pass);
			if (data.isNeighborhoodData || (!data.students && !data.districts && Array.isArray(data.neighborhood))) {
				mergeNeighborDataIntoRep(data);
			} else if (data.districts && Array.isArray(data.districts)) {
				// 代表統合ファイルが混ざっていた場合
				(data.districts || []).forEach(d => {
					if (!d.officers || !Array.isArray(d.officers) || d.officers.length === 0) {
						d.officers = [d.officer || {}];
					}
					delete d.officer;
					d.officers.forEach(off => {
						normalizeOfficerChildNames(off);
						normalizeNameFields(off);
					});
					(d.neighborhood || []).forEach(normalizeNameFields);
					(d.students || []).forEach(s => {
						normalizeNameFields(s);
						if (s.han === undefined) s.han = d.han || "";
						if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
					});
				});
				(data.szExternals || []).forEach(normalizeNameFields);
				if (!data.seatConfig) data.seatConfig = { cols: 4, rows: 5, cells: {} };
				if (!data.szExternals) data.szExternals = [];
				repState = data;
			} else {
				upsertRepDistrict(data);
			}
			ok++;
		} catch (err) { ng++; }
	}
	renderRepAll();
	alert(`${ok}件のファイルを読み込みました。` + (ng ? `\n（${ng}件はパスワード不一致等で失敗）` : ""));
	e.target.value = "";
}

async function loadPastedTextToRep() {
	const box = document.getElementById('rep-paste-box');
	if (!box) return;
	const raw = box.value.trim();
	if (!raw) return;
	const pass = document.getElementById('rep-pass')?.value || "";
	try {
		const data = await parseTxtContent(raw, pass);
		if (data.isNeighborhoodData || (!data.students && !data.districts && Array.isArray(data.neighborhood))) {
			mergeNeighborDataIntoRep(data);
			box.value = "";
			renderRepAll();
			alert(`自治会役員データ「${data.district || '自治会'}」を集約データに反映しました。`);
			return;
		}
		upsertRepDistrict(data);
		box.value = "";
		renderRepAll();
		const hanMsg = data.han ? `（${data.han}）` : "";
		alert(`「${data.district}${hanMsg}」を追加しました。`);
	} catch (err) {
		alert("復号に失敗しました。パスワードを確認してください。");
	}
}

function addCurrentDistrictToRep() {
	saveDistrictLocal();
	if (!currentDistrict.district) { alert("タブ①の地区名が未入力です。"); return; }
	upsertRepDistrict(currentDistrict);
	renderRepAll();
}

function validateRepPasswords() {
	const passEl = document.getElementById('rep-pass');
	const confirmEl = document.getElementById('rep-pass-confirm');
	const msgEl = document.getElementById('rep-pass-match-msg');
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

async function exportRepMasterTxt() {
	saveRepLocal();
	const pass = document.getElementById('rep-pass').value;
	const confirmEl = document.getElementById('rep-pass-confirm');
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

	const encoded = await encryptPayload(JSON.stringify(repState), pass);
	const dateStr = new Date().toISOString().slice(0,10);
	const content = [
		`--- 校外委員会 代表統合マスターデータ (出力日:${dateStr}) ---`,
		`BEGIN_DATA:`,
		encoded,
		`:END_DATA`
	].join('\n');
	downloadTextFile(content, `校外代表統合データ_${dateStr}.txt`);
}

async function loadRepMasterTxt(e) {
	const file = e.target.files[0];
	if (!file) return;
	const pass = document.getElementById('rep-pass').value;
	try {
		const data = await parseTxtContent(await file.text(), pass);
		if (data.districts) {
			(data.districts || []).forEach(d => {
				if (d.han === undefined) d.han = "";
				if (!d.officers || !Array.isArray(d.officers) || d.officers.length === 0) {
					d.officers = [d.officer || {}];
				}
				delete d.officer;
				d.officers.forEach(off => {
					normalizeOfficerChildNames(off);
					normalizeNameFields(off);
				});
				(d.neighborhood || []).forEach(normalizeNameFields);
				(d.students || []).forEach(s => {
					normalizeNameFields(s);
					if (s.han === undefined) s.han = d.han || "";
					if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
				});
			});
			(data.szExternals || []).forEach(normalizeNameFields);
			if (!data.seatConfig) data.seatConfig = { cols: 4, rows: 5, cells: {} };
			if (!data.szExternals) data.szExternals = [];
			repState = data;
			renderRepAll();
			saveRepLocal();
			alert("代表統合マスターデータを読み込みました。");
		} else {
			upsertRepDistrict(data);
			renderRepAll();
			const hanMsg = data.han ? `（${data.han}）` : "";
			alert(`地区データ「${data.district}${hanMsg}」として追加しました。`);
		}
	} catch (err) {
		alert("読み込みに失敗しました。パスワードを確認してください。");
	}
	e.target.value = "";
}

function runRepYearUpdate() {
	if (!confirm("【代表統合データの年度更新】\n・集約済みの地区データをクリアします。\n・スクゾ関係者リストの「区分・ご所属・お役職」の枠組みだけを残し、ご芳名・連絡先をクリアします。\n\n実行してよろしいですか？")) return;
	repState.districts = [];
	repState.szExternals.forEach(ex => {
		ex.lastName = "";
		ex.firstName = "";
		ex.lastNameKana = "";
		ex.firstNameKana = "";
		ex.name = "";
		ex.contact = "";
		ex.attend = true;
	});
	repState.seatConfig.cells = {};
	saveRepLocal();
	renderRepAll();
	alert("代表データの年度更新が完了しました。「代表統合ファイル(.txt)を保存」から次年度代表への引き継ぎファイルを出力できます。");
}

function renderRepDistrictsTable() {
	document.getElementById('rep-count').textContent = repState.districts.length;
	const tbody = document.getElementById('rep-districts-tbody');
	if (repState.districts.length === 0) {
		tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#64748b;">まだ地区データが読み込まれていません。</td></tr>`;
		return;
	}
	tbody.innerHTML = repState.districts.map((d, i) => {
		const c = getGradeCounts(d.students);
		const validN = (d.neighborhood || []).filter(n => n.lastName || n.firstName || n.name || n.role).length;
		const offList = (d.officers && d.officers.length > 0) ? d.officers : [];
		const officerHtml = offList.map(off => {
			const roleBadge = off.role ? `<strong>[${esc(off.role)}]</strong> ` : "";
			const offName = getFullName(off) || "未入力";
			const offHan = off.han ? `<span style="font-size:0.75rem; color:#64748b; margin-left:2px;">(${esc(off.han)})</span>` : "";
			return `<div>${roleBadge}${esc(offName)}${offHan}</div>`;
		}).join('') || "未入力";

		const childInfo = offList.map(off => {
			const childFullName = getChildFullName(off);
			return childFullName ? `<div>${esc(off.childGrade || "")}年${esc(off.childClass || "")}組 ${esc(childFullName)}</div>` : `<div>（未入力）</div>`;
		}).join('') || "（未入力）";

		const hanBadge = d.han ? `<span style="font-size:0.8rem; color:#475569; margin-left:4px;">(${esc(d.han)})</span>` : "";
		return `
			<tr>
				<td style="text-align:center;">
					<input type="checkbox" ${d.selectedForPrint ? 'checked' : ''} onchange="repState.districts[${i}].selectedForPrint=this.checked;saveRepLocal();">
				</td>
				<td><strong>${esc(d.district)}</strong>${hanBadge}</td>
				<td>${officerHtml}</td>
				<td>${childInfo}</td>
				<td>${c.total} 名</td>
				<td>${validN} 名</td>
				<td style="text-align:center; white-space:nowrap;">
					<button type="button" class="btn btn-outline btn-xs" onclick="exportSingleDistrictFromRep(${i})" title="この地区のデータを暗号化して切り出し出力します">📤 切り出し</button>
					<button type="button" class="btn btn-danger btn-xs" onclick="repState.districts.splice(${i},1);saveRepLocal();renderRepAll();">×</button>
				</td>
			</tr>
		`;
	}).join('');
}

function toggleAllDistrictChecks(flag) {
	repState.districts.forEach(d => d.selectedForPrint = flag);
	saveRepLocal();
	renderRepDistrictsTable();
}

function clearAllRepDistricts() {
	if (!confirm("集約済みの地区データをすべてクリアしますか？")) return;
	repState.districts = [];
	saveRepLocal();
	renderRepAll();
}

/* スクゾ自治会出席者セレクタ（同一地区名の重複表示を排除） */
function renderSzNeighborhoodSelector() {
	const box = document.getElementById('sz-neighborhood-selector');
	if (repState.districts.length === 0) {
		box.innerHTML = `<span class="help-text">地区データを読み込むと、ここに各地区の自治会役員が表示されます。</span>`;
		return;
	}
	const uniqueDistricts = getUniqueNeighborhoodDistricts(repState.districts, false);
	box.innerHTML = uniqueDistricts.map(({ d, dIdx }) => {
		const neighbors = (d.neighborhood || []).map((n, nIdx) => ({ ...n, nIdx })).filter(n => n.lastName || n.firstName || n.name || n.role);
		if (neighbors.length === 0) return "";
		const checksHtml = neighbors.map(n => {
			const checked = d.szNeighborChecks && d.szNeighborChecks[n.nIdx] ? 'checked' : '';
			const fullName = getFullName(n);
			return `
				<label class="check-item">
					<input type="checkbox" ${checked} onchange="toggleSzNeighbor(${dIdx}, ${n.nIdx}, this.checked)">
					${esc(n.role)}：${esc(fullName || '（氏名未定）')}
				</label>
			`;
		}).join('');
		return `<div style="margin-bottom:6px;"><strong>【${esc(d.district)}】</strong> ${checksHtml}</div>`;
	}).join('') || `<span class="help-text">自治会役員が登録されていません。</span>`;
}

function toggleSzNeighbor(dIdx, nIdx, flag) {
	const targetDist = repState.districts[dIdx];
	if (!targetDist) return;
	const distName = (targetDist.district || '').trim();
	// 同一地区名の全エントリに対してチェック状態を同期する
	repState.districts.forEach((d, idx) => {
		if (idx === dIdx || (distName && (d.district || '').trim() === distName)) {
			if (!d.szNeighborChecks) d.szNeighborChecks = {};
			d.szNeighborChecks[nIdx] = flag;
		}
	});
	saveRepLocal();
	renderSeatEditor();
}

/* スクゾ外部関係者テーブル */
function renderSzExternalTable() {
	const tbody = document.getElementById('sz-external-tbody');
	tbody.innerHTML = "";
	const cats = ["学校関係者", "PTA本部", "役所・警察・関係機関", "その他"];
	(repState.szExternals || []).forEach((ex, i) => {
		normalizeNameFields(ex);
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td style="text-align:center;"><input type="checkbox" ${ex.attend?'checked':''} onchange="updateSzEx(${i},'attend',this.checked);renderSeatEditor();"></td>
			<td>
				<select onchange="updateSzEx(${i},'category',this.value);renderSeatEditor();">
					${cats.map(c => `<option value="${c}" ${ex.category===c?'selected':''}>${c}</option>`).join('')}
				</select>
			</td>
			<td><input type="text" value="${esc(ex.org)}" placeholder="〇〇区役所 地域振興課" oninput="updateSzEx(${i},'org',this.value);renderSeatEditor();"></td>
			<td><input type="text" value="${esc(ex.role)}" placeholder="校長・会長・課長等" oninput="updateSzEx(${i},'role',this.value);renderSeatEditor();"></td>
			<td>
				<div class="name-field-box">
					<div class="name-pair-grid">
						<input type="text" value="${esc(ex.lastNameKana)}" placeholder="せい" class="input-kana" oninput="updateSzEx(${i},'lastNameKana',this.value);renderSeatEditor();">
						<input type="text" value="${esc(ex.firstNameKana)}" placeholder="めい" class="input-kana" oninput="updateSzEx(${i},'firstNameKana',this.value);renderSeatEditor();">
					</div>
					<div class="name-pair-grid">
						<input type="text" value="${esc(ex.lastName)}" placeholder="姓" oninput="updateSzEx(${i},'lastName',this.value);renderSeatEditor();">
						<input type="text" value="${esc(ex.firstName)}" placeholder="名" oninput="updateSzEx(${i},'firstName',this.value);renderSeatEditor();">
					</div>
				</div>
			</td>
			<td><input type="text" value="${esc(ex.contact)}" placeholder="電話番号・備考等" oninput="updateSzEx(${i},'contact',this.value);"></td>
			<td style="text-align:center;"><button class="btn btn-danger btn-sm" onclick="repState.szExternals.splice(${i},1);saveRepLocal();renderSzExternalTable();renderSeatEditor();">×</button></td>
		`;
		tbody.appendChild(tr);
	});
}

function updateSzEx(idx, key, val) {
	repState.szExternals[idx][key] = val;
	repState.szExternals[idx].name = getFullName(repState.szExternals[idx]);
	saveRepLocal();
}

function addSzExternalRow() {
	repState.szExternals.push({
		attend: true,
		category: "役所・警察・関係機関",
		org: "",
		role: "",
		lastName: "",
		firstName: "",
		lastNameKana: "",
		firstNameKana: "",
		name: "",
		contact: ""
	});
	saveRepLocal();
	renderSzExternalTable();
	renderSeatEditor();
}

async function integrateTransferDataIntoRep(payload, password) {
	if (!payload || !payload.isTransferData) {
		alert("転入児童データではありません。");
		return false;
	}
	const rawList = payload.children || payload.students || [];
	if (!Array.isArray(rawList) || rawList.length === 0) {
		alert("転入児童データに児童が含まれていません。");
		return false;
	}

	const existingDistricts = (repState.districts || []).map(d => d.district).filter(Boolean);
	const distPromptMsg = existingDistricts.length > 0
		? `転入児童を統合する地区名を入力してください（既存地区: ${existingDistricts.join(', ')}）：`
		: `転入児童を統合する地区名を入力してください：`;
	const defaultDist = existingDistricts[0] || "1丁目";
	const selectedDist = safePrompt(distPromptMsg, defaultDist);
	if (!selectedDist || !selectedDist.trim()) {
		return false;
	}
	const targetDistrictName = selectedDist.trim();

	let targetDistrict = repState.districts.find(d => d.district === targetDistrictName);
	const isNewDistrict = !targetDistrict;
	if (isNewDistrict) {
		targetDistrict = {
			district: targetDistrictName,
			han: "1班",
			hanList: ["1班"],
			selectedForPrint: true,
			officers: [],
			neighborhood: [],
			students: []
		};
	}

	const backupStudents = JSON.parse(JSON.stringify(targetDistrict.students || []));
	const tempStudents = JSON.parse(JSON.stringify(targetDistrict.students || []));
	const defaultHan = targetDistrict.han || (targetDistrict.hanList && targetDistrict.hanList[0]) || "1班";

	for (const child of rawList) {
		const normChild = {
			id: child.id || ('s_' + Date.now() + Math.random().toString(36).slice(2, 6)),
			lastName: (child.lastName || "").trim(),
			firstName: (child.firstName || "").trim(),
			lastNameKana: (child.lastNameKana || "").trim(),
			firstNameKana: (child.firstNameKana || "").trim(),
			grade: String(child.grade || "1"),
			class: String(child.className || child.class || "1"),
			className: String(child.className || child.class || "1"),
			address: (child.address || "").trim(),
			tel: (child.tel || "").trim(),
			leader: "",
			isOutOfDistrict: false
		};

		const promptMsg = `転入児童「${normChild.lastName} ${normChild.firstName}」（${normChild.grade}年${normChild.class}組）の所属班を入力してください：`;
		const assignedHan = safePrompt(promptMsg, defaultHan);
		if (assignedHan === null) {
			targetDistrict.students = backupStudents;
			return false;
		}
		normChild.han = (assignedHan || defaultHan).trim();

		const duplicate = tempStudents.find(s =>
			s.lastName === normChild.lastName &&
			s.firstName === normChild.firstName &&
			String(s.grade) === String(normChild.grade)
		);
		if (duplicate) {
			const confirmMsg = `児童「${normChild.lastName} ${normChild.firstName}」（${normChild.grade}年生）は地区「${targetDistrictName}」に既に存在します。重複して統合しますか？`;
			if (!confirm(confirmMsg)) {
				targetDistrict.students = backupStudents;
				return false;
			}
		}

		tempStudents.push(normChild);
	}

	targetDistrict.students = tempStudents;
	targetDistrict.students.sort(compareStudents);
	if (isNewDistrict) {
		repState.districts.push(targetDistrict);
	}
	renderRepAll();
	if (typeof saveRepLocal === 'function') {
		saveRepLocal();
	}

	alert(`${rawList.length}名の転入児童データを「${targetDistrictName}」へ統合しました。`);
	return true;
}

async function loadTransferFileIntoRep(e) {
	const file = e.target?.files?.[0];
	if (!file) return;
	const pass = document.getElementById('rep-pass')?.value || "";
	try {
		const text = await file.text();
		let data;
		try {
			data = await parseTxtContent(text, pass);
		} catch (err) {
			const promptPass = safePrompt("転入児童データの復号パスワードを入力してください：");
			if (!promptPass) { if (e.target) e.target.value = ""; return; }
			data = await parseTxtContent(text, promptPass);
		}
		await integrateTransferDataIntoRep(data, pass);
	} catch (err) {
		alert("転入児童データの読み込みに失敗しました。パスワードをご確認ください。");
	}
	if (e.target) e.target.value = "";
}

async function loadPastedTransferTextIntoRep(text) {
	const raw = (typeof text === 'string' ? text : (document.getElementById('rep-transfer-paste-box')?.value || "")).trim();
	if (!raw) return;
	let pass = document.getElementById('rep-pass')?.value || "";
	try {
		let data;
		try {
			data = await parseTxtContent(raw, pass);
		} catch (err) {
			const promptPass = safePrompt("転入児童データの復号パスワードを入力してください：");
			if (!promptPass) return;
			data = await parseTxtContent(raw, promptPass);
		}
		await integrateTransferDataIntoRep(data, pass);
		const box = document.getElementById('rep-transfer-paste-box');
		if (box) box.value = "";
	} catch (err) {
		alert("転入児童データの復号に失敗しました。パスワードをご確認ください。");
	}
}

async function exportSingleDistrictFromRep(index, explicitPass, explicitMode = 'download') {
	if (typeof index !== 'number' || index < 0 || !repState.districts || index >= repState.districts.length) {
		return false;
	}
	const src = repState.districts[index];
	if (!src) return false;

	let pass = explicitPass;
	if (!pass) {
		const passInput = document.getElementById('rep-pass');
		pass = passInput ? passInput.value : '';
	}
	if (!pass) {
		pass = safePrompt(`地区「${src.district || ''}」の切り出し出力用パスワードを入力してください：`);
	}
	if (!pass) {
		alert(`地区「${src.district || ''}」の切り出し出力にはパスワードが必要です。\n「5. 代表統合マスターデータ保存・読み込み」欄のパスワードを入力してください。`);
		const card = document.getElementById('card-rep-master');
		if (card && card.classList.contains('is-collapsed')) {
			if (typeof toggleCard === 'function') {
				toggleCard(card);
			} else {
				card.classList.remove('is-collapsed');
			}
		}
		const passInput = document.getElementById('rep-pass');
		if (passInput) passInput.focus();
		return false;
	}

	const chk = validatePassword(pass);
	if (!chk.valid) {
		alert("【保存パスワードエラー】\n" + chk.message);
		return false;
	}

	const singleDistrict = {
		district: src.district || "",
		han: src.han || "",
		hanList: src.hanList ? JSON.parse(JSON.stringify(src.hanList)) : (src.han ? [src.han] : []),
		officers: src.officers ? JSON.parse(JSON.stringify(src.officers)) : [],
		neighborhood: src.neighborhood ? JSON.parse(JSON.stringify(src.neighborhood)) : [],
		students: src.students ? JSON.parse(JSON.stringify(src.students)) : []
	};

	try {
		const encoded = await encryptPayload(JSON.stringify(singleDistrict), pass);
		const dateStr = new Date().toISOString().slice(0, 10);
		const hanPart = singleDistrict.han ? `_${singleDistrict.han}` : "";
		const fileName = `校外地区データ_${singleDistrict.district}${hanPart}_${dateStr}.txt`;
		const content = [
			`--- 校外委員会 地区データ (${singleDistrict.district}${singleDistrict.han ? ' ' + singleDistrict.han : ''} / 出力日:${dateStr}) ---`,
			`BEGIN_DATA:`,
			encoded,
			`:END_DATA\n`
		].join('\n');

		if (explicitMode === 'copy') {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
				await navigator.clipboard.writeText(content);
				alert(`「${singleDistrict.district}」の暗号化データをクリップボードにコピーしました。`);
				return true;
			}
			return false;
		}

		if (explicitMode === 'line') {
			const lineUrl = 'https://line.me/R/msg/text/?' + encodeURIComponent(content);
			if (typeof window !== 'undefined' && typeof window.open === 'function') {
				window.open(lineUrl);
			}
			return true;
		}

		if (explicitMode === 'mail') {
			const subject = `【校外委員会】地区データ_${singleDistrict.district}${hanPart}`;
			const mailUrl = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(content);
			if (typeof window !== 'undefined') {
				if (window.location) {
					window.location.href = mailUrl;
				} else if (typeof window.open === 'function') {
					window.open(mailUrl);
				}
			}
			return true;
		}

		// download
		downloadTextFile(content, fileName);
		return true;
	} catch (err) {
		alert("切り出し出力に失敗しました: " + (err ? err.message : ""));
		return false;
	}
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		renderRepAll,
		upsertRepDistrict,
		loadMultipleDistrictFiles,
		loadPastedTextToRep,
		addCurrentDistrictToRep,
		validateRepPasswords,
		exportRepMasterTxt,
		loadRepMasterTxt,
		runRepYearUpdate,
		renderRepDistrictsTable,
		toggleAllDistrictChecks,
		clearAllRepDistricts,
		renderSzNeighborhoodSelector,
		toggleSzNeighbor,
		renderSzExternalTable,
		updateSzEx,
		addSzExternalRow,
		mergeNeighborDataIntoRep,
		integrateNeighborDataIntoRep: mergeNeighborDataIntoRep,
		integrateTransferDataIntoRep,
		loadTransferFileIntoRep,
		loadPastedTransferTextIntoRep,
		exportSingleDistrictFromRep
	};
	Object.assign(global, module.exports);
}
