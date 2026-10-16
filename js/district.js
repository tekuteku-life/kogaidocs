/* =========================================================================
   タブ1：各地区役員モードのUI・処理・ファイル入出力
========================================================================= */

function renderDistrictForm() {
	const dNameEl = document.getElementById('d-name');
	if (dNameEl) dNameEl.value = currentDistrict.district || "";
	const dHanEl = document.getElementById('d-han');
	if (dHanEl) dHanEl.value = currentDistrict.han || "";

	renderOfficersList();
	renderNeighborhoodTable();
	renderStudentsTable();
	updateHataPreview();
}

function renderOfficersList() {
	const container = document.getElementById('officers-container');
	if (!container) return;
	container.innerHTML = "";

	if (!currentDistrict.officers || currentDistrict.officers.length === 0) {
		currentDistrict.officers = [currentDistrict.officer || {}];
	}

	currentDistrict.officers.forEach((off, idx) => {
		normalizeNameFields(off);
		normalizeOfficerChildNames(off);

		const box = document.createElement('div');
		box.className = 'officer-item-box';
		box.innerHTML = `
			<div class="officer-item-header">
				<span class="officer-item-title">校外役員 ${idx + 1}${off.han ? `（担当: ${esc(off.han)}）` : ''}</span>
				${currentDistrict.officers.length > 1 ? `<button type="button" class="btn btn-danger btn-xs" onclick="removeOfficer(${idx})">この役員を削除</button>` : ''}
			</div>
			<div class="grid-form">
				<div>
					<label>役職</label>
					<select data-field="role" onchange="saveDistrictLocal()">
						<option value="" ${!off.role ? 'selected' : ''}>（なし）</option>
						<option value="代表" ${off.role === '代表' ? 'selected' : ''}>代表</option>
						<option value="副代表" ${off.role === '副代表' ? 'selected' : ''}>副代表</option>
						<option value="書記" ${off.role === '書記' ? 'selected' : ''}>書記</option>
						<option value="会計" ${off.role === '会計' ? 'selected' : ''}>会計</option>
						<option value="校外委員" ${off.role === '校外委員' ? 'selected' : ''}>校外委員</option>
					</select>
				</div>
				<div>
					<label>担当班（班ごと・全体等の指定）</label>
					<input type="text" data-field="han" value="${esc(off.han || '')}" placeholder="例：1班 / 全班" oninput="saveDistrictLocal()">
				</div>
				<div>
					<label>役員 氏名（姓 / 名）</label>
					<div class="name-pair-grid">
						<input type="text" data-field="lastName" value="${esc(off.lastName || '')}" placeholder="姓（山田）" oninput="saveDistrictLocal()">
						<input type="text" data-field="firstName" value="${esc(off.firstName || '')}" placeholder="名（花子）" oninput="saveDistrictLocal()">
					</div>
				</div>
				<div>
					<label>役員 ふりがな（せい / めい）</label>
					<div class="name-pair-grid">
						<input type="text" data-field="lastNameKana" class="input-kana" value="${esc(off.lastNameKana || '')}" placeholder="せい（やまだ）" oninput="saveDistrictLocal()">
						<input type="text" data-field="firstNameKana" class="input-kana" value="${esc(off.firstNameKana || '')}" placeholder="めい（はなこ）" oninput="saveDistrictLocal()">
					</div>
				</div>
				<div>
					<label>電話番号</label>
					<input type="tel" data-field="tel" value="${esc(off.tel || '')}" placeholder="090-0000-0000" oninput="saveDistrictLocal()">
				</div>
				<div>
					<label>メールアドレス</label>
					<input type="email" data-field="email" value="${esc(off.email || '')}" placeholder="example@mail.com" oninput="saveDistrictLocal()">
				</div>
				<div style="grid-column: 1 / -1;">
					<label>役員のご住所（※学校提出用名簿に記載）</label>
					<input type="text" data-field="address" value="${esc(off.address || '')}" placeholder="例：〇〇町1-2-3 〇〇マンション101" oninput="saveDistrictLocal()">
				</div>
			</div>
			<hr style="margin: 10px 0; border: none; border-top: 1px dashed var(--border);">
			<div class="grid-form">
				<div>
					<label>【封筒宛名・学校用】お子様の学年</label>
					<select data-field="childGrade" onchange="saveDistrictLocal()">
						<option value="">選択</option>
						${[1,2,3,4,5,6].map(g => `<option value="${g}" ${String(off.childGrade) === String(g) ? 'selected' : ''}>${g}年</option>`).join('')}
					</select>
				</div>
				<div>
					<label>【封筒宛名・学校用】お子様のクラス</label>
					<input type="text" data-field="childClass" value="${esc(off.childClass || '')}" placeholder="例：1" oninput="saveDistrictLocal()">
				</div>
				<div>
					<label>【封筒宛名・学校用】お子様の氏名（姓 / 名）</label>
					<div class="name-pair-grid">
						<input type="text" data-field="childLastName" value="${esc(off.childLastName || '')}" placeholder="姓（山田）" oninput="saveDistrictLocal()">
						<input type="text" data-field="childFirstName" value="${esc(off.childFirstName || '')}" placeholder="名（太郎）" oninput="saveDistrictLocal()">
					</div>
				</div>
				<div>
					<label>【封筒宛名・学校用】お子様のふりがな（せい / めい）</label>
					<div class="name-pair-grid">
						<input type="text" data-field="childLastNameKana" class="input-kana" value="${esc(off.childLastNameKana || '')}" placeholder="せい（やまだ）" oninput="saveDistrictLocal()">
						<input type="text" data-field="childFirstNameKana" class="input-kana" value="${esc(off.childFirstNameKana || '')}" placeholder="めい（たろう）" oninput="saveDistrictLocal()">
					</div>
				</div>
			</div>
		`;
		container.appendChild(box);
	});
}

function addOfficer() {
	saveDistrictLocal();
	currentDistrict.officers.push({
		lastName: "", firstName: "", lastNameKana: "", firstNameKana: "",
		role: "校外委員", han: "", tel: "", email: "", address: "",
		childGrade: "", childClass: "", childLastName: "", childFirstName: "",
		childLastNameKana: "", childFirstNameKana: ""
	});
	renderOfficersList();
	saveDistrictLocal();
}

function removeOfficer(idx) {
	if (currentDistrict.officers.length <= 1) {
		alert("校外役員は最低1名の登録が必要です。");
		return;
	}
	if (!confirm(`校外役員 ${idx + 1} を削除しますか？`)) return;
	saveDistrictLocal();
	currentDistrict.officers.splice(idx, 1);
	renderOfficersList();
	saveDistrictLocal();
}

function renderNeighborhoodTable() {
	const tbody = document.getElementById('neighborhood-tbody');
	if (!tbody) return;
	tbody.innerHTML = "";
	currentDistrict.neighborhood.forEach((row, i) => {
		normalizeNameFields(row);
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td><input type="text" value="${esc(row.role)}" placeholder="会長・副会長等" oninput="updateN(${i},'role',this.value)"></td>
			<td>
				<div class="name-field-box">
					<div class="name-pair-grid">
						<input type="text" value="${esc(row.lastNameKana)}" placeholder="せい" class="input-kana" oninput="updateN(${i},'lastNameKana',this.value)">
						<input type="text" value="${esc(row.firstNameKana)}" placeholder="めい" class="input-kana" oninput="updateN(${i},'firstNameKana',this.value)">
					</div>
					<div class="name-pair-grid">
						<input type="text" value="${esc(row.lastName)}" placeholder="姓" oninput="updateN(${i},'lastName',this.value)">
						<input type="text" value="${esc(row.firstName)}" placeholder="名" oninput="updateN(${i},'firstName',this.value)">
					</div>
				</div>
			</td>
			<td><input type="text" value="${esc(row.address)}" placeholder="住所" oninput="updateN(${i},'address',this.value)"></td>
			<td><input type="tel" value="${esc(row.tel)}" placeholder="電話番号" oninput="updateN(${i},'tel',this.value)"></td>
			<td style="text-align:center;"><button class="btn btn-danger btn-sm" onclick="removeN(${i})">×</button></td>
		`;
		tbody.appendChild(tr);
	});
}

function renderStudentsTable() {
	const tbody = document.getElementById('students-tbody');
	if (!tbody) return;
	tbody.innerHTML = "";
	currentDistrict.students.forEach((row, i) => {
		normalizeNameFields(row);
		const isLeader = row.leader === '班長' || row.leader === 'リーダー';
		const isSubLeader = row.leader === '副班長' || row.leader === 'サブリーダー';
		const tr = document.createElement('tr');
		tr.innerHTML = `
			<td>
				<select onchange="updateS(${i},'grade',this.value)">
					${[6,5,4,3,2,1].map(g => `<option value="${g}" ${String(row.grade)===String(g)?'selected':''}>${g}年</option>`).join('')}
				</select>
			</td>
			<td><input type="text" value="${esc(row.class || '')}" placeholder="1" oninput="updateS(${i},'class',this.value)"></td>
			<td><input type="text" value="${esc(row.han || '')}" placeholder="${esc(currentDistrict.han || '1班')}" oninput="updateS(${i},'han',this.value)"></td>
			<td>
				<div class="name-field-box">
					<div class="name-pair-grid">
						<input type="text" value="${esc(row.lastNameKana || '')}" placeholder="せい" class="input-kana" oninput="updateS(${i},'lastNameKana',this.value)">
						<input type="text" value="${esc(row.firstNameKana || '')}" placeholder="めい" class="input-kana" oninput="updateS(${i},'firstNameKana',this.value)">
					</div>
					<div class="name-pair-grid">
						<input type="text" value="${esc(row.lastName || '')}" placeholder="姓" oninput="updateS(${i},'lastName',this.value)">
						<input type="text" value="${esc(row.firstName || '')}" placeholder="名" oninput="updateS(${i},'firstName',this.value)">
					</div>
				</div>
			</td>
			<td><input type="text" value="${esc(row.address || '')}" placeholder="1号棟203号室" oninput="updateS(${i},'address',this.value)"></td>
			<td><input type="tel" value="${esc(row.tel || '')}" placeholder="電話番号" oninput="updateS(${i},'tel',this.value)"></td>
			<td>
				<select onchange="updateS(${i},'leader',this.value)">
					<option value="" ${!isLeader && !isSubLeader ? 'selected' : ''}>-</option>
					<option value="班長" ${isLeader ? 'selected' : ''}>班長</option>
					<option value="副班長" ${isSubLeader ? 'selected' : ''}>副班長</option>
				</select>
			</td>
			<td style="text-align:center;">
				<input type="checkbox" ${row.isOutOfDistrict ? 'checked' : ''} onchange="updateS(${i},'isOutOfDistrict',this.checked)">
			</td>
			<td style="text-align:center;"><button class="btn btn-danger btn-sm" onclick="removeS(${i})">×</button></td>
		`;
		tbody.appendChild(tr);
	});
	updateStudentSummaryText();
}

function updateN(idx, key, val) {
	currentDistrict.neighborhood[idx][key] = val;
	currentDistrict.neighborhood[idx].name = getFullName(currentDistrict.neighborhood[idx]);
	saveDistrictLocal();
}

function removeN(idx) {
	currentDistrict.neighborhood.splice(idx, 1);
	renderNeighborhoodTable();
	saveDistrictLocal();
}

function addNeighborhoodRow() {
	currentDistrict.neighborhood.push({ role: "", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "" });
	renderNeighborhoodTable();
	saveDistrictLocal();
}

function updateS(idx, key, val) {
	currentDistrict.students[idx][key] = val;
	currentDistrict.students[idx].name = getFullName(currentDistrict.students[idx]);
	saveDistrictLocal();
	updateStudentSummaryText();
	updateHataPreview();
}

function removeS(idx) {
	currentDistrict.students.splice(idx, 1);
	renderStudentsTable();
	saveDistrictLocal();
	updateHataPreview();
}

function addStudentRow() {
	currentDistrict.students.push({
		grade: "1",
		class: "",
		han: currentDistrict.han || "",
		lastName: "",
		firstName: "",
		lastNameKana: "",
		firstNameKana: "",
		address: "",
		tel: "",
		leader: "",
		isOutOfDistrict: false
	});
	renderStudentsTable();
	saveDistrictLocal();
	updateHataPreview();
}

function sortStudentsDesc() {
	currentDistrict.students.sort(compareStudents);
	renderStudentsTable();
	saveDistrictLocal();
	updateHataPreview();
}

function updateStudentSummaryText() {
	const summaryEl = document.getElementById('district-student-summary');
	if (!summaryEl) return;
	const counts = getGradeCounts(currentDistrict.students);
	const hanLabel = currentDistrict.han ? ` ${currentDistrict.han}` : "";
	const label = `${currentDistrict.district || "（地区未入力）"}${hanLabel}`;
	summaryEl.textContent = `【${label} 学年別集計】： ${formatGradeCounts(counts)}`;
}

function runDistrictYearUpdate() {
	if (!confirm("【地区データの年度更新】\n・校外役員情報と自治会役員一覧をクリアします。\n・児童一覧から6年生を削除し、1〜5年生の学年を+1します。\n・クラスと班長・副班長をリセットします。\n※地区名・班名・学区外フラグは保持されます。\n\n実行してよろしいですか？")) return;

	currentDistrict.officers = [
		{
			lastName: "", firstName: "", lastNameKana: "", firstNameKana: "",
			role: "校外委員", han: "", tel: "", email: "", address: "",
			childGrade: "", childClass: "", childLastName: "", childFirstName: "",
			childLastNameKana: "", childFirstNameKana: ""
		}
	];
	currentDistrict.officer = currentDistrict.officers[0];
	currentDistrict.neighborhood = [{ role: "会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "" }];

	const nextStudents = [];
	currentDistrict.students.forEach(s => {
		const g = parseInt(s.grade, 10);
		if (g >= 1 && g <= 5) {
			nextStudents.push({
				grade: String(g + 1),
				class: "",
				han: s.han || "",
				lastName: s.lastName || "",
				firstName: s.firstName || "",
				lastNameKana: s.lastNameKana || "",
				firstNameKana: s.firstNameKana || "",
				address: s.address,
				tel: s.tel,
				leader: "",
				isOutOfDistrict: !!s.isOutOfDistrict
			});
		}
	});
	currentDistrict.students = nextStudents;
	sortStudentsDesc();
	renderDistrictForm();
	saveDistrictLocal();
	alert("年度更新が完了しました。新年度用の引き継ぎファイルとして「提出・保存用ファイル(.txt)出力」から保存してください。");
}

function validateDistrictPasswords() {
	const passEl = document.getElementById('d-pass');
	const confirmEl = document.getElementById('d-pass-confirm');
	const msgEl = document.getElementById('d-pass-match-msg');
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

async function exportDistrictTxt() {
	saveDistrictLocal();
	if (!currentDistrict.district) { alert("地区名を入力してください。"); return; }
	const pass = document.getElementById('d-pass').value;
	const confirmEl = document.getElementById('d-pass-confirm');
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

	const encoded = await encryptPayload(JSON.stringify(currentDistrict), pass);
	const dateStr = new Date().toISOString().slice(0,10);
	const hanPart = currentDistrict.han ? `_${currentDistrict.han}` : "";
	const content = [
		`--- 校外委員会 地区データ (${currentDistrict.district}${currentDistrict.han ? ' ' + currentDistrict.han : ''} / 出力日:${dateStr}) ---`,
		`BEGIN_DATA:`,
		encoded,
		`:END_DATA`
	].join('\n');
	downloadTextFile(content, `校外地区データ_${currentDistrict.district}${hanPart}_${dateStr}.txt`);
}

async function loadDistrictTxt(e) {
	const file = e.target.files[0];
	if (!file) return;
	const pass = document.getElementById('d-pass').value;
	try {
		const data = await parseTxtContent(await file.text(), pass);
		if (!data.officers || !data.officers.length) {
			data.officers = [data.officer || {}];
		}
		data.officers.forEach(off => {
			normalizeOfficerChildNames(off);
			normalizeNameFields(off);
		});
		normalizeOfficerChildNames(data.officer);
		normalizeNameFields(data.officer);
		(data.neighborhood || []).forEach(normalizeNameFields);
		(data.students || []).forEach(s => {
			normalizeNameFields(s);
			if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
			if (s.han === undefined) s.han = data.han || "";
		});
		currentDistrict = data;
		currentDistrict.han = data.han || "";
		renderDistrictForm();
		saveDistrictLocal();
		const hanMsg = currentDistrict.han ? `（${currentDistrict.han}）` : "";
		alert(`「${data.district}${hanMsg}」のデータを読み込みました。`);
	} catch (err) {
		alert("読み込みに失敗しました。パスワードが正しいか確認してください。");
	}
	e.target.value = "";
}

function toggleCard(cardEl) {
	if (!cardEl) return;
	cardEl.classList.toggle('is-collapsed');
	const btn = cardEl.querySelector('.btn-card-toggle');
	if (btn) {
		btn.textContent = cardEl.classList.contains('is-collapsed') ? '▼ 開く' : '▲ 閉じる';
	}
}

function setAllCardsCollapse(collapse, containerId) {
	const container = document.getElementById(containerId);
	if (!container) return;
	container.querySelectorAll('.card').forEach(card => {
		card.classList.toggle('is-collapsed', collapse);
		const btn = card.querySelector('.btn-card-toggle');
		if (btn) {
			btn.textContent = collapse ? '▼ 開く' : '▲ 閉じる';
		}
	});
}
