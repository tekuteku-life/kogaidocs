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
	d.officers.forEach(off => {
		normalizeOfficerChildNames(off);
		normalizeNameFields(off);
	});
	d.officer = d.officers[0];
	(d.neighborhood || []).forEach(normalizeNameFields);
	(d.students || []).forEach(s => {
		normalizeNameFields(s);
		if (s.ban === undefined) s.ban = d.ban || "";
		if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
	});

	d.ban = d.ban || "";
	const existingIdx = repState.districts.findIndex(x => x.district === d.district && (x.ban || "") === d.ban);
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

async function loadMultipleDistrictFiles(e) {
	const files = Array.from(e.target.files);
	if (!files.length) return;
	const pass = document.getElementById('rep-pass').value;
	let ok = 0, ng = 0;
	for (const f of files) {
		try {
			const data = await parseTxtContent(await f.text(), pass);
			if (data.districts && Array.isArray(data.districts)) {
				// 代表統合ファイルが混ざっていた場合
				(data.districts || []).forEach(d => {
					if (!d.officers || !Array.isArray(d.officers) || d.officers.length === 0) {
						d.officers = [d.officer || {}];
					}
					d.officers.forEach(off => {
						normalizeOfficerChildNames(off);
						normalizeNameFields(off);
					});
					d.officer = d.officers[0];
					(d.neighborhood || []).forEach(normalizeNameFields);
					(d.students || []).forEach(s => {
						normalizeNameFields(s);
						if (s.ban === undefined) s.ban = d.ban || "";
						if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
					});
				});
				(data.szExternals || []).forEach(normalizeNameFields);
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
	const raw = document.getElementById('rep-paste-box').value.trim();
	if (!raw) return;
	const pass = document.getElementById('rep-pass').value;
	try {
		const data = await parseTxtContent(raw, pass);
		upsertRepDistrict(data);
		document.getElementById('rep-paste-box').value = "";
		renderRepAll();
		const banMsg = data.ban ? `（${data.ban}）` : "";
		alert(`「${data.district}${banMsg}」を追加しました。`);
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
				if (d.ban === undefined) d.ban = "";
				if (!d.officers || !Array.isArray(d.officers) || d.officers.length === 0) {
					d.officers = [d.officer || {}];
				}
				d.officers.forEach(off => {
					normalizeOfficerChildNames(off);
					normalizeNameFields(off);
				});
				d.officer = d.officers[0];
				(d.neighborhood || []).forEach(normalizeNameFields);
				(d.students || []).forEach(s => {
					normalizeNameFields(s);
					if (s.ban === undefined) s.ban = d.ban || "";
					if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
				});
			});
			(data.szExternals || []).forEach(normalizeNameFields);
			repState = data;
			renderRepAll();
			saveRepLocal();
			alert("代表統合マスターデータを読み込みました。");
		} else {
			upsertRepDistrict(data);
			renderRepAll();
			const banMsg = data.ban ? `（${data.ban}）` : "";
			alert(`地区データ「${data.district}${banMsg}」として追加しました。`);
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
		const offList = (d.officers && d.officers.length > 0) ? d.officers : (d.officer ? [d.officer] : []);
		const officerHtml = offList.map(off => {
			const roleBadge = off.role ? `<strong>[${esc(off.role)}]</strong> ` : "";
			const offName = getFullName(off) || "未入力";
			const offBan = off.ban ? `<span style="font-size:0.75rem; color:#64748b; margin-left:2px;">(${esc(off.ban)})</span>` : "";
			return `<div>${roleBadge}${esc(offName)}${offBan}</div>`;
		}).join('') || "未入力";

		const childInfo = offList.map(off => {
			const childFullName = getChildFullName(off);
			return childFullName ? `<div>${esc(off.childGrade || "")}年${esc(off.childClass || "")}組 ${esc(childFullName)}</div>` : `<div>（未入力）</div>`;
		}).join('') || "（未入力）";

		const banBadge = d.ban ? `<span style="font-size:0.8rem; color:#475569; margin-left:4px;">(${esc(d.ban)})</span>` : "";
		return `
			<tr>
				<td style="text-align:center;">
					<input type="checkbox" ${d.selectedForPrint ? 'checked' : ''} onchange="repState.districts[${i}].selectedForPrint=this.checked;saveRepLocal();">
				</td>
				<td><strong>${esc(d.district)}</strong>${banBadge}</td>
				<td>${officerHtml}</td>
				<td>${childInfo}</td>
				<td>${c.total} 名</td>
				<td>${validN} 名</td>
				<td style="text-align:center;"><button class="btn btn-danger btn-sm" onclick="repState.districts.splice(${i},1);saveRepLocal();renderRepAll();">×</button></td>
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

/* スクゾ自治会出席者セレクタ */
function renderSzNeighborhoodSelector() {
	const box = document.getElementById('sz-neighborhood-selector');
	if (repState.districts.length === 0) {
		box.innerHTML = `<span class="help-text">地区データを読み込むと、ここに各地区の自治会役員が表示されます。</span>`;
		return;
	}
	box.innerHTML = repState.districts.map((d, dIdx) => {
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
	if (!repState.districts[dIdx].szNeighborChecks) repState.districts[dIdx].szNeighborChecks = {};
	repState.districts[dIdx].szNeighborChecks[nIdx] = flag;
	saveRepLocal();
	renderSeatEditor();
}

/* スクゾ外部関係者テーブル */
function renderSzExternalTable() {
	const tbody = document.getElementById('sz-external-tbody');
	tbody.innerHTML = "";
	const cats = ["学校関係者", "PTA本部", "役所・警察・関係機関", "その他"];
	repState.szExternals.forEach((ex, i) => {
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
