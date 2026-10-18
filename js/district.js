/* =========================================================================
   タブ1：各地区役員モードのUI・処理・ファイル入出力
========================================================================= */

function renderDistrictForm() {
	const dNameEl = document.getElementById('d-name');
	if (dNameEl) dNameEl.value = currentDistrict.district || "";
	const dHanListEl = document.getElementById('d-han-list');
	if (dHanListEl) {
		if (!currentDistrict.hanList || !currentDistrict.hanList.length) {
			currentDistrict.hanList = getDistrictHanList(currentDistrict);
		}
		dHanListEl.value = currentDistrict.hanList.join(', ');
	}
	const dHanEl = document.getElementById('d-han');
	if (dHanEl) dHanEl.value = currentDistrict.han || (currentDistrict.hanList && currentDistrict.hanList[0]) || "";

	// パスワード安全記憶の復元
	if (currentDistrict.savedFilePassword) {
		const dPass = document.getElementById('d-pass');
		if (dPass) dPass.value = currentDistrict.savedFilePassword;
		const dPassConfirm = document.getElementById('d-pass-confirm');
		if (dPassConfirm) dPassConfirm.value = currentDistrict.savedFilePassword;
		const dPassOptin = document.getElementById('d-save-password-optin');
		if (dPassOptin) dPassOptin.checked = true;
	}

	renderOfficersList();
	renderNeighborhoodTable();
	renderStudentsTable();
	updateHataPreview();
}

function onHanListInput(val) {
	const rawList = val.split(/[,、，\s\n]+/).map(s => s.trim()).filter(Boolean);
	currentDistrict.hanList = Array.from(new Set(rawList));
	currentDistrict.han = currentDistrict.hanList[0] || "";
	const dHanEl = document.getElementById('d-han');
	if (dHanEl) dHanEl.value = currentDistrict.han;
	saveDistrictLocal();
	renderOfficersList();
	renderStudentsTable();
	updateHataPreview();
}

function renderOfficersList() {
	const container = document.getElementById('officers-container');
	if (!container) return;
	container.innerHTML = "";

	if (!currentDistrict.officers || currentDistrict.officers.length === 0) {
		currentDistrict.officers = [{}];
	}

	const hanList = getDistrictHanList(currentDistrict);

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
					<label>担当班</label>
					<select data-field="han" onchange="saveDistrictLocal()">
						<option value="" ${!off.han ? 'selected' : ''}>全班・指定なし</option>
						<option value="全班" ${off.han === '全班' ? 'selected' : ''}>全班</option>
						${hanList.map(h => `<option value="${esc(h)}" ${off.han === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
						${(off.han && off.han !== '全班' && !hanList.includes(off.han)) ? `<option value="${esc(off.han)}" selected>${esc(off.han)}</option>` : ''}
					</select>
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
	const hanList = getDistrictHanList(currentDistrict);
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
			<td>
				<select onchange="updateS(${i},'han',this.value)">
					<option value="" ${!row.han ? 'selected' : ''}>（未指定）</option>
					${hanList.map(h => `<option value="${esc(h)}" ${row.han === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
					${(row.han && !hanList.includes(row.han)) ? `<option value="${esc(row.han)}" selected>${esc(row.han)}</option>` : ''}
				</select>
			</td>
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
	let defaultHan = "";
	if (currentDistrict.students && currentDistrict.students.length > 0) {
		const lastStudent = currentDistrict.students[currentDistrict.students.length - 1];
		if (lastStudent && lastStudent.han) {
			defaultHan = lastStudent.han;
		}
	}
	if (!defaultHan) {
		const hanList = getDistrictHanList(currentDistrict);
		defaultHan = hanList[0] || currentDistrict.han || "";
	}

	currentDistrict.students.push({
		grade: "1",
		class: "",
		han: defaultHan,
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

	delete currentDistrict.savedFilePassword;
	const dPass = document.getElementById('d-pass');
	if (dPass) dPass.value = "";
	const dPassConfirm = document.getElementById('d-pass-confirm');
	if (dPassConfirm) dPassConfirm.value = "";
	const dPassOptin = document.getElementById('d-save-password-optin');
	if (dPassOptin) dPassOptin.checked = false;

	currentDistrict.officers = [
		{
			lastName: "", firstName: "", lastNameKana: "", firstNameKana: "",
			role: "校外委員", han: "", tel: "", email: "", address: "",
			childGrade: "", childClass: "", childLastName: "", childFirstName: "",
			childLastNameKana: "", childFirstNameKana: ""
		}
	];
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

/**
 * 地区データを各種チャネル（アプリ共有、LINE、メール、クリップボード）で安全に共有します
 * @param {'share' | 'line' | 'email' | 'copy'} channel
 */
async function shareDistrictData(channel) {
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
	const dateStr = new Date().toISOString().slice(0, 10);
	const hanPart = currentDistrict.han ? `_${currentDistrict.han}` : "";
	const fileName = `校外地区データ_${currentDistrict.district}${hanPart}_${dateStr}.txt`;
	const content = [
		`--- 校外委員会 地区データ (${currentDistrict.district}${currentDistrict.han ? ' ' + currentDistrict.han : ''} / 出力日:${dateStr}) ---`,
		`BEGIN_DATA:`,
		encoded,
		`:END_DATA\n`
	].join('\n');

	if (channel === 'share') {
		if (navigator.share) {
			const shareObj = {
				title: `校外地区データ_${currentDistrict.district}`,
				text: content
			};
			try {
				if (typeof File !== 'undefined' && navigator.canShare) {
					const file = new File([content], fileName, { type: 'text/plain' });
					if (navigator.canShare({ files: [file] })) {
						shareObj.files = [file];
					}
				}
			} catch (e) {}
			try {
				await navigator.share(shareObj);
				return;
			} catch (err) {
				if (err && err.name === 'AbortError') return;
			}
		}
		// フォールバック: クリップボード
		if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
			try {
				await navigator.clipboard.writeText(content);
				alert("暗号化データをクリップボードにコピーしました。\nメールやLINEに貼り付けて提出してください。");
				return;
			} catch (e) {}
		}
		downloadTextFile(content, fileName);
		return;
	}

	if (channel === 'copy') {
		if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
			try {
				await navigator.clipboard.writeText(content);
				alert("暗号化データをクリップボードにコピーしました。\nメールやLINEに貼り付けて提出してください。");
				return;
			} catch (e) {}
		}
		alert("暗号化データのコピーに失敗しました。ファイル保存をご利用ください。");
		return;
	}

	if (channel === 'line') {
		// [A-1] 暗号文長が 2,000文字 を超える場合はクリップボードに退避し、定型文のみで起動
		if (content.length > 2000) {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
				try { await navigator.clipboard.writeText(content); } catch (e) {}
			}
			const lineGuidance = "校外委員会地区データを送信します。クリップボードにコピーされた暗号化テキストをここに貼り付けてください";
			window.open('https://line.me/R/msg/text/?' + encodeURIComponent(lineGuidance));
		} else {
			window.open('https://line.me/R/msg/text/?' + encodeURIComponent(content));
		}
		return;
	}

	if (channel === 'email') {
		const subject = `【校外委員会】地区データ提出_${currentDistrict.district}${hanPart}`;
		// [A-1] 暗号文長が 2,000文字 を超える場合はクリップボードに退避し、定型文のみで起動
		if (content.length > 2000) {
			if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
				try { await navigator.clipboard.writeText(content); } catch (e) {}
			}
			const emailGuidance = "校外委員会地区データを送信します。クリップボードにコピーされた暗号化テキストをここに貼り付けてください";
			window.open('mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(emailGuidance));
		} else {
			window.open('mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(content));
		}
		return;
	}
}

async function loadDistrictTxt(e) {
	const file = e.target.files[0];
	if (!file) return;
	const pass = document.getElementById('d-pass').value;
	try {
		const data = await parseTxtContent(await file.text(), pass);
		if (data.isNeighborhoodData || (!data.students && Array.isArray(data.neighborhood))) {
			mergeNeighborDataIntoDistrict(data);
			e.target.value = "";
			return;
		}

		const hasExistingData = (currentDistrict.students && currentDistrict.students.length > 0) ||
			(currentDistrict.officers && currentDistrict.officers.some(o => (o.lastName || "").trim() !== "" || (o.firstName || "").trim() !== "")) ||
			Boolean((currentDistrict.district || "").trim());
		if (hasExistingData) {
			if (!confirm("現在の入力内容が提出ファイルの内容で上書きされますが、よろしいですか？")) {
				e.target.value = "";
				return;
			}
		}

		if (!data.officers || !data.officers.length) {
			data.officers = [data.officer || {}];
		}
		delete data.officer;
		data.officers.forEach(off => {
			normalizeOfficerChildNames(off);
			normalizeNameFields(off);
		});
		(data.neighborhood || []).forEach(normalizeNameFields);
		(data.students || []).forEach(s => {
			normalizeNameFields(s);
			if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
			if (s.han === undefined) s.han = data.han || "";
		});
		currentDistrict = data;
		currentDistrict.hanList = data.hanList || getDistrictHanList(data);
		currentDistrict.han = data.han || (currentDistrict.hanList && currentDistrict.hanList[0]) || "";
		renderDistrictForm();
		saveDistrictLocal();
		const hanMsg = currentDistrict.han ? `（${currentDistrict.han}）` : "";
		alert(`「${data.district}${hanMsg}」のデータを読み込みました。`);
	} catch (err) {
		alert("読み込みに失敗しました。パスワードが正しいか確認してください。");
	}
	e.target.value = "";
}

function mergeNeighborDataIntoDistrict(data) {
	if (!data) return;
	const nList = data.neighborhood || (Array.isArray(data) ? data : []);
	const dName = (data.district || "").trim();
	const curName = (currentDistrict.district || "").trim();

	if (dName && curName && dName !== curName) {
		const ok = confirm(`自治会名「${dName}」が現在の地区名「${curName}」と異なりますが、この地区の自治会役員名簿として統合しますか？\n（キャンセルした場合は統合されません）`);
		if (!ok) return;
	} else if (dName && !curName) {
		currentDistrict.district = dName;
		const dNameEl = document.getElementById('d-name');
		if (dNameEl) dNameEl.value = dName;
	}

	currentDistrict.neighborhood = JSON.parse(JSON.stringify(nList));
	currentDistrict.neighborhood.forEach(normalizeNameFields);
	saveDistrictLocal();
	renderNeighborhoodTable();
	alert(`自治会役員データ「${dName || curName}」（${currentDistrict.neighborhood.length}名）を統合しました。`);
}

function openNeighborImportPanel() {
	const card = document.getElementById('card-d-neighbor');
	const panel = document.getElementById('d-neighbor-import-panel');
	const btn = document.getElementById('btn-toggle-neighbor-import');
	if (card) {
		card.classList.remove('is-collapsed');
		const toggleBtn = card.querySelector('.btn-card-toggle');
		if (toggleBtn) toggleBtn.textContent = '▲ 閉じる';
	}
	if (!panel) return;
	const isHidden = !panel.style.display || panel.style.display === 'none' || panel.style.display === '';
	if (isHidden) {
		panel.style.display = 'block';
		if (btn) {
			btn.textContent = '📥 自治会データを統合 ▲ 閉じる';
			btn.setAttribute('aria-expanded', 'true');
		}
		if (panel.scrollIntoView) {
			panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	} else {
		panel.style.display = 'none';
		if (btn) {
			btn.textContent = '📥 自治会データを統合 ▼';
			btn.setAttribute('aria-expanded', 'false');
		}
	}
}

function toggleTransferImportPanel() {
	const card = document.getElementById('card-d-students');
	const panel = document.getElementById('d-transfer-import-panel');
	const btn = document.getElementById('btn-toggle-transfer-import');
	if (card) {
		card.classList.remove('is-collapsed');
		const toggleBtn = card.querySelector('.btn-card-toggle');
		if (toggleBtn) toggleBtn.textContent = '▲ 閉じる';
	}
	if (!panel) return;
	const isHidden = !panel.style.display || panel.style.display === 'none' || panel.style.display === '';
	if (isHidden) {
		panel.style.display = 'block';
		if (btn) {
			btn.textContent = '📥 転入児童データを統合 ▲ 閉じる';
			btn.setAttribute('aria-expanded', 'true');
		}
		if (panel.scrollIntoView) {
			panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
	} else {
		panel.style.display = 'none';
		if (btn) {
			btn.textContent = '📥 転入児童データを統合 ▼';
			btn.setAttribute('aria-expanded', 'false');
		}
	}
}

async function integrateTransferDataIntoDistrict(payload, password) {
	if (!payload || !payload.isTransferData) {
		alert("転入児童データではありません。");
		return false;
	}
	const rawList = payload.children || payload.students || [];
	if (!Array.isArray(rawList) || rawList.length === 0) {
		alert("転入児童データに児童が含まれていません。");
		return false;
	}

	const backupStudents = JSON.parse(JSON.stringify(currentDistrict.students || []));
	const tempStudents = JSON.parse(JSON.stringify(currentDistrict.students || []));
	const defaultHan = currentDistrict.han || (currentDistrict.hanList && currentDistrict.hanList[0]) || "1班";

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
			currentDistrict.students = backupStudents;
			return false;
		}
		normChild.han = (assignedHan || defaultHan).trim();

		const duplicate = tempStudents.find(s =>
			s.lastName === normChild.lastName &&
			s.firstName === normChild.firstName &&
			String(s.grade) === String(normChild.grade)
		);
		if (duplicate) {
			const confirmMsg = `児童「${normChild.lastName} ${normChild.firstName}」（${normChild.grade}年生）は既に「${duplicate.han}」に存在します。重複して統合しますか？`;
			if (!confirm(confirmMsg)) {
				currentDistrict.students = backupStudents;
				return false;
			}
		}

		tempStudents.push(normChild);
	}

	currentDistrict.students = tempStudents;
	currentDistrict.students.sort(compareStudents);
	renderStudentsTable();
	updateStudentSummaryText();
	if (typeof saveDistrictLocal === 'function') {
		saveDistrictLocal();
	}

	alert(`${rawList.length}名の転入児童データを統合しました。`);
	return true;
}

async function loadTransferFileIntoDistrict(e) {
	const file = e.target?.files?.[0];
	if (!file) return;
	const pass = document.getElementById('d-pass')?.value || "";
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
		await integrateTransferDataIntoDistrict(data, pass);
	} catch (err) {
		alert("転入児童データの読み込みに失敗しました。パスワードをご確認ください。");
	}
	if (e.target) e.target.value = "";
}

async function loadPastedTransferTextIntoDistrict(text) {
	const raw = (typeof text === 'string' ? text : (document.getElementById('d-transfer-paste-box')?.value || "")).trim();
	if (!raw) return;
	let pass = document.getElementById('d-pass')?.value || "";
	try {
		let data;
		try {
			data = await parseTxtContent(raw, pass);
		} catch (err) {
			const promptPass = safePrompt("転入児童データの復号パスワードを入力してください：");
			if (!promptPass) return;
			data = await parseTxtContent(raw, promptPass);
		}
		await integrateTransferDataIntoDistrict(data, pass);
		const box = document.getElementById('d-transfer-paste-box');
		if (box) box.value = "";
	} catch (err) {
		alert("転入児童データの復号に失敗しました。パスワードをご確認ください。");
	}
}

async function loadNeighborFileIntoDistrict(e) {
	const file = e.target.files[0];
	if (!file) return;
	const pass = document.getElementById('d-pass')?.value || "";
	try {
		const text = await file.text();
		let data;
		try {
			data = await parseTxtContent(text, pass);
		} catch (err) {
			const promptPass = safePrompt("自治会ファイルの復号パスワードを入力してください：");
			if (!promptPass) { e.target.value = ""; return; }
			data = await parseTxtContent(text, promptPass);
		}
		mergeNeighborDataIntoDistrict(data);
	} catch (err) {
		alert("自治会データの読み込みに失敗しました。パスワードをご確認ください。");
	}
	e.target.value = "";
}

async function loadPastedNeighborTextIntoDistrict() {
	const box = document.getElementById('d-neighbor-paste-box');
	if (!box) return;
	const raw = box.value.trim();
	if (!raw) return;
	let pass = document.getElementById('d-pass')?.value || "";
	try {
		let data;
		try {
			data = await parseTxtContent(raw, pass);
		} catch (err) {
			const promptPass = safePrompt("自治会データの復号パスワードを入力してください：");
			if (!promptPass) return;
			data = await parseTxtContent(raw, promptPass);
		}
		mergeNeighborDataIntoDistrict(data);
		box.value = "";
	} catch (err) {
		alert("自治会データの復号に失敗しました。パスワードをご確認ください。");
	}
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

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		renderDistrictForm,
		onHanListInput,
		renderOfficersList,
		addOfficer,
		removeOfficer,
		renderNeighborhoodTable,
		renderStudentsTable,
		updateN,
		removeN,
		addNeighborhoodRow,
		updateS,
		removeS,
		addStudentRow,
		sortStudentsDesc,
		updateStudentSummaryText,
		runDistrictYearUpdate,
		validateDistrictPasswords,
		exportDistrictTxt,
		shareDistrictData,
		loadDistrictTxt,
		mergeNeighborDataIntoDistrict,
		integrateNeighborDataIntoDistrict: mergeNeighborDataIntoDistrict,
		openNeighborImportPanel,
		toggleTransferImportPanel,
		integrateTransferDataIntoDistrict,
		loadTransferFileIntoDistrict,
		loadPastedTransferTextIntoDistrict,
		loadNeighborFileIntoDistrict,
		loadPastedNeighborTextIntoDistrict,
		toggleCard,
		setAllCardsCollapse
	};
	Object.assign(global, module.exports);
}
