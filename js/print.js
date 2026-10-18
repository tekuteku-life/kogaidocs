/* =========================================================================
   印刷HTMLの組み立て（各地区モード ＆ 代表モード）
========================================================================= */

function setRepPrintChecks(flag) {
	document.querySelectorAll('.rep-print-chk').forEach(el => el.checked = flag);
}

/* タブ1：自地区の選択印刷 */
function printSingleDistrictSelected() {
	saveDistrictLocal();
	const pStu = document.getElementById('d-print-students')?.checked;
	const pNei = document.getElementById('d-print-neighbors')?.checked;
	const pSch = document.getElementById('d-print-school')?.checked;
	const pPta = document.getElementById('d-print-pta')?.checked;
	if (!pStu && !pNei && !pSch && !pPta) { alert("印刷する帳票にチェックを入れてください。"); return; }

	const options = {
		includeOfficerTel: document.getElementById('d-opt-officer-tel')?.checked !== false,
		includeOfficerEmail: document.getElementById('d-opt-officer-email')?.checked !== false
	};

	const pages = [];
	const checkedNames = [];
	const distName = currentDistrict.district || "未設定";

	if (pStu) {
		pages.push(buildStudentPageHtml(currentDistrict, options, [currentDistrict]));
		checkedNames.push("児童名簿");
	}
	if (pNei) {
		pages.push(buildNeighborPageHtml(currentDistrict));
		checkedNames.push("自治会役員名簿");
	}
	if (pSch) {
		pages.push(buildSchoolOfficersRosterPageHtml([currentDistrict], [currentDistrict]));
		checkedNames.push("校外役員名簿_学校用");
	}
	if (pPta) {
		pages.push(buildPtaOfficersRosterPageHtml([currentDistrict]));
		checkedNames.push("校外役員名簿_PTA用");
	}

	const area = document.getElementById('print-area');
	if (area) area.innerHTML = pages.join('');

	const origTitle = document.title;
	const targetTitle = checkedNames.length === 1
		? `${checkedNames[0]}_${distName}`
		: `自地区帳票一括_${distName}`;

	try {
		document.title = targetTitle;
		window.print();
	} finally {
		document.title = origTitle;
	}
}

/* タブ1：自地区の個別PDF保存（選択した帳票ごとに順次印刷ダイアログを起動） */
function printSingleDistrictSeparately() {
	saveDistrictLocal();
	const pStu = document.getElementById('d-print-students')?.checked;
	const pNei = document.getElementById('d-print-neighbors')?.checked;
	const pSch = document.getElementById('d-print-school')?.checked;
	const pPta = document.getElementById('d-print-pta')?.checked;
	if (!pStu && !pNei && !pSch && !pPta) { alert("印刷する帳票にチェックを入れてください。"); return; }

	const options = {
		includeOfficerTel: document.getElementById('d-opt-officer-tel')?.checked !== false,
		includeOfficerEmail: document.getElementById('d-opt-officer-email')?.checked !== false
	};

	const distName = currentDistrict.district || "未設定";
	const area = document.getElementById('print-area');

	const printItems = [];
	if (pStu) {
		printItems.push({
			title: `児童名簿_${distName}`,
			html: buildStudentPageHtml(currentDistrict, options, [currentDistrict])
		});
	}
	if (pNei) {
		printItems.push({
			title: `自治会役員名簿_${distName}`,
			html: buildNeighborPageHtml(currentDistrict)
		});
	}
	if (pSch) {
		printItems.push({
			title: `校外役員名簿_学校用_${distName}`,
			html: buildSchoolOfficersRosterPageHtml([currentDistrict], [currentDistrict])
		});
	}
	if (pPta) {
		printItems.push({
			title: `校外役員名簿_PTA用_${distName}`,
			html: buildPtaOfficersRosterPageHtml([currentDistrict])
		});
	}

	const origTitle = document.title;
	for (const item of printItems) {
		if (area) area.innerHTML = item.html;
		try {
			document.title = item.title;
			window.print();
		} finally {
			document.title = origTitle;
		}
	}
}

/* タブ2：代表モードの選択一括印刷 */
function executeRepSelectedPrint() {
	saveRepLocal();
	const checkedTypes = Array.from(document.querySelectorAll('.rep-print-chk:checked')).map(el => el.value);
	if (checkedTypes.length === 0) {
		alert("印刷する帳票にチェックを入れてください。");
		return;
	}

	const options = {
		includeOfficerTel: document.getElementById('rep-opt-officer-tel')?.checked !== false,
		includeOfficerEmail: document.getElementById('rep-opt-officer-email')?.checked !== false
	};

	const targetDistricts = repState.districts.filter(d => d.selectedForPrint);
	const pages = [];

	const repTypeNames = {
		officers_pta: 'PTA総会・校外役員名簿',
		officers_school: '学校提出用・校外役員名簿',
		reg_tent: '定例会用四つ折り名札',
		envelopes: '子供経由封筒宛名',
		all_students: '地区別児童名簿',
		all_neighbors: '地区別自治会役員名簿',
		sz_tent: 'スクゾ四つ折り名札',
		sz_att_1: 'スクゾ出席簿1_学校PTA',
		sz_att_2: 'スクゾ出席簿2_役所自治会',
		sz_att_3: 'スクゾ出席簿3_当日用',
		sz_seats: 'スクゾ座席表',
		sz_master: '代表控え用スクゾ関係者名簿'
	};

	checkedTypes.forEach(type => {
		if (type === 'officers_pta') {
			pages.push(buildPtaOfficersRosterPageHtml(targetDistricts));
		} else if (type === 'officers_school') {
			pages.push(buildSchoolOfficersRosterPageHtml(targetDistricts, repState.districts));
		} else if (type === 'reg_tent') {
			targetDistricts.forEach(d => {
				const offList = d.officers || [];
				offList.forEach(off => {
					const hStr = (off.han || d.han || "").trim();
					const sub = hStr ? `${d.district} ${hStr}` : d.district;
					const officerName = getFullName(off);
					const officerKana = getFullNameKana(off);
					const role = off.role || "";
					pages.push(buildTentCardPageHtml(sub, officerName, officerKana, role));
				});
			});
		} else if (type === 'envelopes') {
			pages.push(...buildEnvelopesPagesHtml(targetDistricts));
		} else if (type === 'all_students') {
			targetDistricts.forEach(d => pages.push(buildStudentPageHtml(d, options, repState.districts)));
		} else if (type === 'all_neighbors') {
			// 自治会役員名簿は班名には無関係に地区名とだけ結びつく（同一地区名の重複出力を防ぐ）
			getUniqueNeighborhoodDistricts(targetDistricts, false).forEach(({ d }) => {
				pages.push(buildNeighborPageHtml(d));
			});
		} else if (type === 'sz_tent') {
			pages.push(...buildSzTentCardsPagesHtml(targetDistricts));
		} else if (type === 'sz_att_1') {
			pages.push(buildSzAttendance1PageHtml(targetDistricts));
		} else if (type === 'sz_att_2') {
			pages.push(buildSzAttendance2PageHtml(targetDistricts));
		} else if (type === 'sz_att_3') {
			pages.push(buildSzAttendance3BlankPageHtml());
		} else if (type === 'sz_seats') {
			pages.push(buildSzSeatChartPageHtml());
		} else if (type === 'sz_master') {
			pages.push(buildSzMasterRosterPageHtml(targetDistricts));
		}
	});

	if (pages.length === 0) {
		alert("印刷対象のデータがありません（「印刷対象」チェック等を確認してください）。");
		return;
	}

	const area = document.getElementById('print-area');
	if (area) area.innerHTML = pages.join('');

	const origTitle = document.title;
	const targetTitle = checkedTypes.length === 1 && repTypeNames[checkedTypes[0]]
		? repTypeNames[checkedTypes[0]]
		: '校外代表印刷一括';

	try {
		document.title = targetTitle;
		window.print();
	} finally {
		document.title = origTitle;
	}
}

/* --- 個別帳票ビルダー群 --- */

// 児童名簿ページ（自治会役員名簿とは別ページ・班ごとに1枚出力・班長/副班長/学年/住所順・末尾に班と地区の集計併記）
function buildStudentPageHtml(d, options, allDistricts) {
	options = options || {};
	const showTel = options.includeOfficerTel !== false;
	const showEmail = options.includeOfficerEmail !== false;

	const allValidStudents = (d.students || []).filter(s => s.lastName || s.firstName || s.name || s.address);
	const defaultHan = (d.han || "").trim();

	// 班ごとに生徒をグルーピング（班名なしの場合は空文字のまま保持）
	const hanMap = new Map();
	allValidStudents.forEach(s => {
		const h = (s.han && s.han.trim()) ? s.han.trim() : defaultHan;
		if (!hanMap.has(h)) hanMap.set(h, []);
		hanMap.get(h).push(s);
	});

	if (hanMap.size === 0) {
		hanMap.set(defaultHan, []);
	}

	const officersList = d.officers || [];

	// 同一地区名の複数データ（別ファイル提出時）も含めた地区全体の児童集計
	const districtWideStudents = getDistrictWideValidStudents(d, allDistricts);
	const districtCounts = getGradeCounts(districtWideStudents);
	const districtTotal = districtWideStudents.length;
	const districtOutCount = districtWideStudents.filter(s => s.isOutOfDistrict).length;

	const pages = [];

	hanMap.forEach((hanStudents, hanName) => {
		const sorted = [...hanStudents].sort(compareStudents);
		const counts = getGradeCounts(sorted);
		const hanOutCount = sorted.filter(s => s.isOutOfDistrict).length;

		// 当該班の担当役員を特定（担当班が一致する役員、または全班・未指定役員）
		let assignedOfficers = hanName ? officersList.filter(o => o.han && o.han.trim() === hanName) : [];
		if (assignedOfficers.length === 0) {
			assignedOfficers = officersList;
		}

		const officerBannerHtml = assignedOfficers.length > 0 ? assignedOfficers.map(o => {
			const oName = getFullName(o) || "未設定";
			const oKana = getFullNameKana(o);
			const oRole = o.role ? ` [${esc(o.role)}]` : "";
			const oHanLabel = (o.han && o.han !== hanName) ? `（担当:${esc(o.han)}）` : "";
			return `
				<div class="print-officer-banner">
					<div><strong>担当校外委員：</strong>${esc(oName)}${oKana ? `（${esc(oKana)}）` : ""}${oRole}${oHanLabel}</div>
					${(showTel && o.tel) ? `<div><strong>TEL：</strong>${esc(o.tel)}</div>` : ""}
					${(showEmail && o.email) ? `<div><strong>E-mail：</strong>${esc(o.email)}</div>` : ""}
				</div>
			`;
		}).join('') : `
			<div class="print-officer-banner">
				<div><strong>担当校外委員：</strong>未設定</div>
			</div>
		`;

		const summaryTitle = hanName
			? `【${esc(d.district)} ${esc(hanName)} 児童集計】`
			: `【${esc(d.district)} 児童集計】`;

		const pageHtml = `
			<div class="print-page">
				<div class="print-title">児童名簿</div>
				<div class="print-header-meta">
					<div class="print-header-tags">
						<span><strong>地区名：</strong>${esc(d.district || "未設定")}</span>
						${hanName ? `<span><strong>班名：</strong>${esc(hanName)}</span>` : ""}
					</div>
					<div class="print-date">作成日：${new Date().toLocaleDateString('ja-JP')}</div>
				</div>
				${officerBannerHtml}
				<table class="print-table">
					<thead>
						<tr>
							<th style="width:6%">No.</th>
							<th style="width:12%">学年－組</th>
							<th style="width:24%">児童名</th>
							<th style="width:32%">住所</th>
							<th style="width:14%">電話番号</th>
							<th style="width:12%">班長・副班長</th>
						</tr>
					</thead>
					<tbody>
						${sorted.length ? sorted.map((s, idx) => {
							const fullName = getFullName(s);
							const fullKana = getFullNameKana(s);
							const outBadge = s.isOutOfDistrict ? `<span class="badge-out-print">学区外</span>` : "";
							const nameHtml = fullKana
								? `<div class="print-ruby-name"><span class="p-kana">${esc(fullKana)}</span><span class="p-kanji">${esc(fullName)}${outBadge}</span></div>`
								: `<span>${esc(fullName)}${outBadge}</span>`;
							const gradeClass = s.grade ? `${esc(s.grade)}${s.class ? '-' + esc(s.class) : ''}` : '-';
							return `
								<tr>
									<td style="text-align:center;">${idx + 1}</td>
									<td style="text-align:center;">${gradeClass}</td>
									<td>${nameHtml}</td>
									<td>${esc(s.address)}</td>
									<td>${esc(s.tel)}</td>
									<td style="text-align:center; font-weight:bold;">${esc(s.leader)}</td>
								</tr>
							`;
						}).join('') : `<tr><td colspan="6" style="text-align:center;">該当児童なし</td></tr>`}
					</tbody>
				</table>
				<div class="summary-box">
					<div class="summary-title">${summaryTitle}</div>
					<div class="summary-stats">
						<span><strong>班の児童数：</strong>${sorted.length}名${hanOutCount ? `（うち学区外: ${hanOutCount}名）` : ''}</span>
						<span style="margin-left: 20px;"><strong>地区全体の児童数：</strong>${districtTotal}名${districtOutCount ? `（うち学区外: ${districtOutCount}名）` : ''}</span>
					</div>
					<div class="summary-grades" style="margin-top: 4px;">
						<div><strong>[班の学年別内訳]</strong> ${formatGradeCounts(counts)}</div>
						<div><strong>[地区全体の学年別内訳]</strong> ${formatGradeCounts(districtCounts)}</div>
					</div>
				</div>
			</div>
		`;
		pages.push(pageHtml);
	});

	return pages.join('');
}

// 自治会役員名簿ページ（児童名簿とは別ページ・班名には無関係に地区名と結びつく）
function buildNeighborPageHtml(d) {
	const validNeighbors = (d.neighborhood || []).filter(n => n.lastName || n.firstName || n.name || n.role || n.address);
	const offList = d.officers || [];
	const offNames = offList.map(o => getFullName(o)).filter(Boolean).join('、') || "未設定";

	return `
		<div class="print-page">
			<div class="print-title">${esc(d.district)} 自治会役員名簿</div>
			<div class="print-meta">
				<span>担当校外委員：${esc(offNames)}</span>
				<span>作成日：${new Date().toLocaleDateString('ja-JP')}</span>
			</div>
			<table class="print-table">
				<thead>
					<tr>
						<th style="width:20%">役職</th>
						<th style="width:24%">氏名</th>
						<th style="width:36%">住所</th>
						<th style="width:20%">電話番号</th>
					</tr>
				</thead>
				<tbody>
					${validNeighbors.length ? validNeighbors.map(n => {
						const fullName = getFullName(n);
						const fullKana = getFullNameKana(n);
						const nameHtml = fullKana
							? `<div class="print-ruby-name"><span class="p-kana">${esc(fullKana)}</span><span class="p-kanji">${esc(fullName)}</span></div>`
							: esc(fullName);
						return `
							<tr>
								<td>${esc(n.role)}</td>
								<td>${nameHtml}</td>
								<td>${esc(n.address)}</td>
								<td>${esc(n.tel)}</td>
							</tr>
						`;
					}).join('') : `<tr><td colspan="4" style="text-align:center;">該当なし</td></tr>`}
				</tbody>
			</table>
		</div>
	`;
}

// ① 校外役員名簿（PTA用：氏名・児童学年・代表三役連絡先）
function buildPtaOfficersRosterPageHtml(districts) {
	const allOfficers = [];
	districts.forEach(d => {
		const list = d.officers || [];
		list.forEach(o => {
			if (o.lastName || o.firstName || o.role || o.tel) {
				allOfficers.push({ district: d.district, han: d.han, officer: o });
			}
		});
	});

	const sanyakuRoles = ["代表", "副代表", "委員長", "副委員長", "書記", "会計", "三役"];
	const sanyakuList = allOfficers.filter(item => {
		const r = item.officer.role || "";
		return sanyakuRoles.some(s => r.includes(s));
	});

	return `
		<div class="print-page">
			<div class="print-title">PTA校外委員会 役員名簿（PTA本部・会員用）</div>
			<div class="print-meta">
				<span>※個人情報保護のため、一般役員の連絡先・住所は非掲載です。</span>
				<span>作成日：${new Date().toLocaleDateString('ja-JP')}</span>
			</div>
			<table class="print-table">
				<thead>
					<tr>
						<th style="width:25%">地区名</th>
						<th style="width:35%">役員氏名</th>
						<th style="width:20%">役職</th>
						<th style="width:20%">お子様の学年</th>
					</tr>
				</thead>
				<tbody>
					${allOfficers.length ? allOfficers.map(item => {
						const o = item.officer;
						const name = getFullName(o);
						const kana = getFullNameKana(o);
						const nameHtml = kana
							? `<div class="print-ruby-name"><span class="p-kana">${esc(kana)}</span><span class="p-kanji">${esc(name)}</span></div>`
							: esc(name);
						const gradeStr = o.childGrade ? `${esc(o.childGrade)}年` : "-";
						const hStr = (o.han || item.han || "").trim();
						return `
							<tr>
								<td>${esc(item.district)}${hStr ? ` (${esc(hStr)})` : ''}</td>
								<td>${nameHtml}</td>
								<td style="text-align:center;">${esc(o.role || '校外委員')}</td>
								<td style="text-align:center;">${gradeStr}</td>
							</tr>
						`;
					}).join('') : `<tr><td colspan="4" style="text-align:center;">該当役員なし</td></tr>`}
				</tbody>
			</table>

			<div class="pta-sanyaku-block">
				<div class="pta-sanyaku-title">【PTA校外委員会 代表三役 連絡先】</div>
				<table class="print-table">
					<thead>
						<tr>
							<th style="width:16%">役職</th>
							<th style="width:20%">地区名</th>
							<th style="width:24%">氏名</th>
							<th style="width:20%">電話番号</th>
							<th style="width:20%">メールアドレス</th>
						</tr>
					</thead>
					<tbody>
						${sanyakuList.length ? sanyakuList.map(item => {
							const o = item.officer;
							const name = getFullName(o);
							const kana = getFullNameKana(o);
							const nameHtml = kana
								? `<div class="print-ruby-name"><span class="p-kana">${esc(kana)}</span><span class="p-kanji">${esc(name)}</span></div>`
								: esc(name);
							return `
								<tr>
									<td style="text-align:center; font-weight:bold;">${esc(o.role)}</td>
									<td>${esc(item.district)}</td>
									<td>${nameHtml}</td>
									<td>${esc(o.tel || '-')}</td>
									<td>${esc(o.email || '-')}</td>
								</tr>
							`;
						}).join('') : `<tr><td colspan="5" style="text-align:center; color:#666;">（代表三役が未登録です。「役職」欄に代表・書記・会計等をご指定ください）</td></tr>`}
					</tbody>
				</table>
			</div>
		</div>
	`;
}

// ② 校外役員名簿（学校提出用：連絡先・住所・児童数・学区外児童数入）
function buildSchoolOfficersRosterPageHtml(districts, allDistricts) {
	const rows = [];

	districts.forEach(d => {
		const list = d.officers || [];
		// 同一地区名の別班ファイルも含めて地区全体の児童を集計
		const districtWideStudents = getDistrictWideValidStudents(d, allDistricts || districts);
		const distTotal = districtWideStudents.length;
		const distOutCount = districtWideStudents.filter(s => s.isOutOfDistrict).length;

		list.forEach(o => {
			if (o.lastName || o.firstName || o.role || o.tel) {
				const hName = (o.han && o.han.trim()) ? o.han.trim() : ((d.han && d.han.trim()) ? d.han.trim() : "");
				let hanStudentCount = null;
				if (hName) {
					hanStudentCount = districtWideStudents.filter(s => s._effectiveHan === hName).length;
				}

				rows.push({
					district: d.district,
					officer: o,
					hanName: hName,
					distTotal: distTotal,
					hanStudentCount: hanStudentCount,
					distOutCount: distOutCount
				});
			}
		});
	});

	return `
		<div class="print-page">
			<div class="print-title">PTA校外委員会 役員名簿（学校提出用）</div>
			<div class="print-meta">
				<span>※取扱注意（学校提出用）</span>
				<span>作成日：${new Date().toLocaleDateString('ja-JP')}</span>
			</div>
			<table class="print-table" style="font-size:9pt;">
				<thead>
					<tr>
						<th style="width:11%">地区</th>
						<th style="width:13%">役員氏名</th>
						<th style="width:13%">児童氏名</th>
						<th style="width:10%">児童学年－組</th>
						<th style="width:13%">電話番号</th>
						<th style="width:20%">住所</th>
						<th style="width:11%">地区＋班児童数</th>
						<th style="width:9%">学区外児童数</th>
					</tr>
				</thead>
				<tbody>
					${rows.length ? rows.map(r => {
						const o = r.officer;
						const oName = getFullName(o);
						const oKana = getFullNameKana(o);
						const oNameHtml = oKana
							? `<div class="print-ruby-name"><span class="p-kana">${esc(oKana)}</span><span class="p-kanji">${esc(oName)}</span></div>`
							: esc(oName);

						const cName = getChildFullName(o);
						const cKana = getChildFullNameKana(o);
						const cNameHtml = cKana
							? `<div class="print-ruby-name"><span class="p-kana">${esc(cKana)}</span><span class="p-kanji">${esc(cName)}</span></div>`
							: esc(cName || '-');

						const gradeClass = o.childGrade ? `${esc(o.childGrade)}-${esc(o.childClass || '')}` : '-';

						let studentCountText = `地区: ${r.distTotal}名`;
						if (r.hanStudentCount !== null && r.hanName) {
							studentCountText += `<br><span style="font-size:8pt; color:#444;">(${esc(r.hanName)}: ${r.hanStudentCount}名)</span>`;
						}

						return `
							<tr>
								<td>${esc(r.district)}${r.hanName ? `<br><span style="font-size:8pt; color:#444;">(${esc(r.hanName)})</span>` : ''}</td>
								<td>${oNameHtml}</td>
								<td>${cNameHtml}</td>
								<td style="text-align:center;">${gradeClass}</td>
								<td>${esc(o.tel || '-')}</td>
								<td>${esc(o.address || '-')}</td>
								<td style="text-align:center;">${studentCountText}</td>
								<td style="text-align:center;">${r.distOutCount}名</td>
							</tr>
						`;
					}).join('') : `<tr><td colspan="8" style="text-align:center;">該当データなし</td></tr>`}
				</tbody>
			</table>
		</div>
	`;
}

// 四つ折り名札（A4・1人1枚）共通ビルダー（真ん中のオリセン、役職名のサイズ3割減・スペース調整）
function buildTentCardPageHtml(subTitle, mainName, mainKana, role) {
	if (!role && mainName && mainName.includes(" ")) {
		const knownRoles = ["代表", "副代表", "書記", "会計", "校外委員", "会長", "副会長", "校長", "副校長", "PTA会長", "担当"];
		for (const kr of knownRoles) {
			if (mainName.startsWith(kr + " ")) {
				role = kr;
				mainName = mainName.slice(kr.length + 1).trim();
				break;
			}
		}
	}
	const kanaHtml = mainKana ? `<div class="tent-kana">${esc(mainKana)}</div>` : '';
	const roleHtml = role ? `<span class="tent-role">${esc(role)}</span>` : '';
	return `
		<div class="print-page tent-card-page">
			<div class="tent-panel"><span class="tent-guide">（山折り・底面のりしろ）</span></div>
			<div class="tent-panel tent-upside-down">
				<div class="tent-sub">${esc(subTitle)}</div>
				<div class="tent-main">
					${kanaHtml}
					<div class="tent-name-row">
						${roleHtml}
						<span class="tent-name">${esc(mainName)}</span>
					</div>
				</div>
			</div>
			<div class="tent-center-fold">
				<span class="tent-fold-tag">◀ 折り線（山折り）</span>
				<span class="tent-fold-line-text">― ― ― ― ― 折り線（山折り・名札の天） ― ― ― ― ―</span>
				<span class="tent-fold-tag">折り線（山折り） ▶</span>
			</div>
			<div class="tent-panel">
				<div class="tent-sub">${esc(subTitle)}</div>
				<div class="tent-main">
					${kanaHtml}
					<div class="tent-name-row">
						${roleHtml}
						<span class="tent-name">${esc(mainName)}</span>
					</div>
				</div>
			</div>
			<div class="tent-panel"><span class="tent-guide">（山折り・内側差し込み面）</span></div>
		</div>
	`;
}

// ③ 封筒宛名（A4・3列×4段＝12面）
function buildEnvelopesPagesHtml(districts) {
	const allItems = [];
	districts.forEach(d => {
		const list = d.officers || [];
		list.forEach(off => {
			if (off.childLastName || off.childFirstName || off.childName) {
				allItems.push({ district: d.district, han: d.han, officer: off });
			}
		});
	});

	const pages = [];
	for (let i = 0; i < allItems.length; i += 12) {
		const chunk = allItems.slice(i, i + 12);
		while (chunk.length < 12) chunk.push(null);
		pages.push(`
			<div class="print-page">
				<div class="address-grid">
					${chunk.map(item => {
						if (!item) return `<div class="address-cell"></div>`;
						const d = item.district;
						const off = item.officer;
						const hStr = (off.han || item.han || "").trim();
						const officerFullName = getFullName(off);
						const childFullName = getChildFullName(off);
						const childKana = getChildFullNameKana(off);
						return `
							<div class="address-cell">
								<div class="addr-district">地区：${esc(d)}${hStr ? ` (${esc(hStr)})` : ''}（校外委員：${esc(officerFullName)} 様宛）</div>
								<div class="addr-child">
									<span class="addr-grade">${esc(off.childGrade)}年 ${esc(off.childClass)}組</span>
									${childKana ? `<span class="addr-child-kana">${esc(childKana)}</span>` : ''}
									${esc(childFullName)} さん
								</div>
								<div class="addr-note">PTA校外委員会 書類在中<br>（おうちの人に、かならず、わたしてね）</div>
							</div>
						`;
					}).join('')}
				</div>
			</div>
		`);
	}
	return pages;
}

// ⑥ スクゾ用 四つ折り名札一式
function buildSzTentCardsPagesHtml(targetDistricts) {
	const pages = [];

	// 1. 校外役員：上段「校外委員（地区名）」／下段「役職＋氏名」
	targetDistricts.forEach(d => {
		const list = d.officers || [];
		list.forEach(off => {
			const hStr = (off.han || d.han || "").trim();
			const sub = `校外委員（${d.district}${hStr ? ' ' + hStr : ''}）`;
			const officerName = getFullName(off);
			const officerKana = getFullNameKana(off);
			const role = off.role || "";
			pages.push(buildTentCardPageHtml(sub, officerName, officerKana, role));
		});
	});

	// 2. 自治会出席者：上段「地区名」／下段「役職＋氏名」（同一地区名の重複排除）
	getUniqueNeighborhoodDistricts(targetDistricts, false).forEach(({ d }) => {
		(d.neighborhood || []).forEach((n, idx) => {
			if (d.szNeighborChecks && d.szNeighborChecks[idx]) {
				const sub = d.district;
				const role = n.role || "";
				const main = getFullName(n);
				const kana = getFullNameKana(n);
				pages.push(buildTentCardPageHtml(sub, main, kana, role));
			}
		});
	});

	// 3. 外部関係者（学校・PTA・役所等）：上段「所属」／下段「役職＋氏名（空欄時は手書き余白）」
	repState.szExternals.filter(ex => ex.attend).forEach(ex => {
		const sub = ex.org || "";
		const role = ex.role || "";
		const main = getFullName(ex);
		const kana = getFullNameKana(ex);
		pages.push(buildTentCardPageHtml(sub, main, kana, role));
	});

	return pages;
}

// 氏名＋「様」セルのフォーマット（空欄でも右端に様を配置・ふりがな対応）
function formatNameWithSama(nameStr, kanaStr) {
	const rubyHtml = kanaStr
		? `<div class="print-ruby-name"><span class="p-kana">${esc(kanaStr)}</span><span class="p-kanji">${esc(nameStr || '')}</span></div>`
		: `<span>${esc(nameStr || '')}</span>`;
	return `<div class="name-with-sama">${rubyHtml}<span>様</span></div>`;
}

// ⑦ スクゾ 出席簿1（学校関係者・PTA本部・校外委員）
function buildSzAttendance1PageHtml(targetDistricts) {
	const rows = [];

	// 学校関係者 & PTA本部
	repState.szExternals.filter(ex => ex.attend && (ex.category === "学校関係者" || ex.category === "PTA本部")).forEach(ex => {
		rows.push({ org: ex.org, role: ex.role, name: getFullName(ex), kana: getFullNameKana(ex) });
	});

	// 校外委員
	targetDistricts.forEach(d => {
		const list = d.officers || [];
		list.forEach(off => {
			const hStr = (off.han || d.han || "").trim();
			rows.push({
				org: `PTA校外委員会（${d.district}${hStr ? ' ' + hStr : ''}）`,
				role: off.role || "校外委員",
				name: getFullName(off),
				kana: getFullNameKana(off)
			});
		});
	});

	// 予備空白行を3行追加
	for (let i = 0; i < 3; i++) rows.push({ org: "", role: "", name: "", kana: "" });

	return `
		<div class="print-page">
			<div class="print-title">スクールゾーン協議会 出席簿（学校・PTA本部・校外委員会）</div>
			<div class="print-meta">
				<span>※受付にてご出欠欄にチェック（〇印）をお願いいたします。</span>
				<span>開催日：   年  月  日</span>
			</div>
			<table class="print-table">
				<thead>
					<tr>
						<th style="width:30%">ご所属（地区・団体名）</th>
						<th style="width:18%">お役職</th>
						<th style="width:26%">ご芳名</th>
						<th style="width:12%">ご出欠</th>
						<th style="width:14%">備考</th>
					</tr>
				</thead>
				<tbody>
					${rows.map(r => `
						<tr>
							<td>${esc(r.org)}</td>
							<td>${esc(r.role)}</td>
							<td>${formatNameWithSama(r.name, r.kana)}</td>
							<td style="text-align:center;"></td>
							<td></td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		</div>
	`;
}

// ⑧ スクゾ 出席簿2（役所職員・自治会代表）
function buildSzAttendance2PageHtml(targetDistricts) {
	const rows = [];

	// 役所・警察・関係機関 & その他
	repState.szExternals.filter(ex => ex.attend && ex.category !== "学校関係者" && ex.category !== "PTA本部").forEach(ex => {
		rows.push({ org: ex.org, role: ex.role, name: getFullName(ex), kana: getFullNameKana(ex) });
	});

	// 自治会代表（同一地区名の重複排除）
	getUniqueNeighborhoodDistricts(targetDistricts, false).forEach(({ d }) => {
		(d.neighborhood || []).forEach((n, idx) => {
			if (d.szNeighborChecks && d.szNeighborChecks[idx]) {
				rows.push({ org: d.district, role: n.role, name: getFullName(n), kana: getFullNameKana(n) });
			}
		});
	});

	// 予備空白行を4行追加
	for (let i = 0; i < 4; i++) rows.push({ org: "", role: "", name: "", kana: "" });

	return `
		<div class="print-page">
			<div class="print-title">スクールゾーン協議会 出席簿（関係行政機関・自治会代表）</div>
			<div class="print-meta">
				<span>※受付にてご出欠欄にチェック（〇印）をお願いいたします。（ご芳名空欄の場合はご記入ください）</span>
				<span>開催日：   年  月  日</span>
			</div>
			<table class="print-table">
				<thead>
					<tr>
						<th style="width:30%">ご所属（機関名・自治会名）</th>
						<th style="width:18%">お役職</th>
						<th style="width:26%">ご芳名</th>
						<th style="width:12%">ご出欠</th>
						<th style="width:14%">備考</th>
					</tr>
				</thead>
				<tbody>
					${rows.map(r => `
						<tr>
							<td>${esc(r.org)}</td>
							<td>${esc(r.role)}</td>
							<td>${formatNameWithSama(r.name, r.kana)}</td>
							<td style="text-align:center;"></td>
							<td></td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		</div>
	`;
}

// ⑨ スクゾ 出席簿3（当日追加記入用・空白フォーム）
function buildSzAttendance3BlankPageHtml() {
	const blankRows = Array.from({ length: 18 });
	return `
		<div class="print-page">
			<div class="print-title">スクールゾーン協議会 出席簿（追加ご記入用）</div>
			<div class="print-meta">
				<span>※ご所属・お役職・ご芳名をご記入の上、ご出欠欄に〇印をお願いいたします。</span>
				<span>開催日：   年  月  日</span>
			</div>
			<table class="print-table">
				<thead>
					<tr>
						<th style="width:30%">ご所属（団体・機関・地区名）</th>
						<th style="width:18%">お役職</th>
						<th style="width:26%">ご芳名</th>
						<th style="width:12%">ご出欠</th>
						<th style="width:14%">備考</th>
					</tr>
				</thead>
				<tbody>
					${blankRows.map(() => `
						<tr>
							<td style="height:26pt;"></td>
							<td></td>
							<td>${formatNameWithSama("", "")}</td>
							<td></td>
							<td></td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		</div>
	`;
}

// ⑩ スクゾ 座席表
function buildSzSeatChartPageHtml() {
	const cfg = repState.seatConfig;
	const optionsMap = {};
	getAllSzParticipantsForSeat().forEach(o => { optionsMap[o.key] = o; });

	const cellsHtml = [];
	for (let r = 0; r < cfg.rows; r++) {
		for (let c = 0; c < cfg.cols; c++) {
			const cellData = cfg.cells[`${r}_${c}`] || { refKey: "", customText: "" };
			const ref = optionsMap[cellData.refKey];

			if (!cellData.refKey && !cellData.customText) {
				cellsHtml.push(`<div class="print-seat-cell is-empty"></div>`);
			} else if (cellData.refKey && cellData.refKey.startsWith("FAC_")) {
				const label = cellData.customText || (ref ? ref.label.replace("【設備】","") : "");
				cellsHtml.push(`<div class="print-seat-cell is-facility">${esc(label)}</div>`);
			} else if (cellData.refKey === "CUSTOM") {
				cellsHtml.push(`<div class="print-seat-cell"><div class="seat-p-name">${esc(cellData.customText)}</div></div>`);
			} else if (ref) {
				const dispName = ref.name ? `${ref.name} 様` : "（ご出席者 様）";
				const note = cellData.customText ? `<div style="font-size:7.5pt; margin-top:2px;">${esc(cellData.customText)}</div>` : "";
				cellsHtml.push(`
					<div class="print-seat-cell">
						<div class="seat-p-org">${esc(ref.org)}</div>
						<div class="seat-p-name">${esc(dispName)}</div>
						${note}
					</div>
				`);
			} else {
				cellsHtml.push(`<div class="print-seat-cell">${esc(cellData.customText)}</div>`);
			}
		}
	}

	return `
		<div class="print-page">
			<div class="print-title">スクールゾーン協議会 座席表</div>
			<div class="print-meta">
				<span></span>
				<span>開催日：   年  月  日</span>
			</div>
			<div class="print-seat-wrapper">
				<div class="print-seat-side">${esc(cfg.leftSide)}</div>
				<div class="print-seat-center">
					<div class="print-seat-topbottom">${esc(cfg.topLabel)}</div>
					<div class="print-seat-grid" style="grid-template-columns: repeat(${cfg.cols}, 1fr);">
						${cellsHtml.join('')}
					</div>
					<div class="print-seat-topbottom">${esc(cfg.bottomLabel)}</div>
				</div>
				<div class="print-seat-side">${esc(cfg.rightSide)}</div>
			</div>
		</div>
	`;
}

// ⑪ 代表控え用 スクゾ関係者名簿（連絡先入り）
function buildSzMasterRosterPageHtml(targetDistricts) {
	const rows = [];

	repState.szExternals.forEach(ex => {
		rows.push({
			cat: ex.category,
			org: ex.org,
			role: ex.role,
			name: getFullName(ex),
			kana: getFullNameKana(ex),
			contact: ex.contact,
			attend: ex.attend ? "出席" : "欠席・対象外"
		});
	});

	// 自治会役員（同一地区名の重複排除）
	getUniqueNeighborhoodDistricts(targetDistricts, false).forEach(({ d }) => {
		(d.neighborhood || []).forEach((n, idx) => {
			if (n.lastName || n.firstName || n.name || n.role) {
				const isAtt = d.szNeighborChecks && d.szNeighborChecks[idx];
				rows.push({
					cat: "自治会役員",
					org: d.district,
					role: n.role,
					name: getFullName(n),
					kana: getFullNameKana(n),
					contact: `${n.address || ''} ${n.tel || ''}`.trim(),
					attend: isAtt ? "スクゾ出席" : "-"
				});
			}
		});
	});

	return `
		<div class="print-page">
			<div class="print-title">【校外代表控え】スクールゾーン協議会 関係者一覧</div>
			<div class="print-meta">
				<span>※個人情報・連絡先を含むため取扱注意</span>
				<span>出力日：${new Date().toLocaleDateString('ja-JP')}</span>
			</div>
			<table class="print-table">
				<thead>
					<tr>
						<th style="width:14%">区分</th>
						<th style="width:22%">所属・地区名</th>
						<th style="width:14%">役職</th>
						<th style="width:18%">氏名</th>
						<th style="width:22%">連絡先・住所・備考</th>
						<th style="width:10%">スクゾ出欠</th>
					</tr>
				</thead>
				<tbody>
					${rows.map(r => {
						const nameHtml = r.kana
							? `<div class="print-ruby-name"><span class="p-kana">${esc(r.kana)}</span><span class="p-kanji">${esc(r.name)}</span></div>`
							: esc(r.name);
						return `
							<tr>
								<td>${esc(r.cat)}</td>
								<td>${esc(r.org)}</td>
								<td>${esc(r.role)}</td>
								<td>${nameHtml}</td>
								<td>${esc(r.contact)}</td>
								<td style="text-align:center;">${esc(r.attend)}</td>
							</tr>
						`;
					}).join('')}
				</tbody>
			</table>
		</div>
	`;
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		setRepPrintChecks,
		printSingleDistrictSelected,
		printSingleDistrictSeparately,
		executeRepSelectedPrint,
		buildStudentPageHtml,
		buildNeighborPageHtml,
		buildPtaOfficersRosterPageHtml,
		buildSchoolOfficersRosterPageHtml,
		buildTentCardPageHtml,
		buildEnvelopesPagesHtml,
		buildSzTentCardsPagesHtml,
		formatNameWithSama,
		buildSzAttendance1PageHtml,
		buildSzAttendance2PageHtml,
		buildSzAttendance3BlankPageHtml,
		buildSzSeatChartPageHtml,
		buildSzMasterRosterPageHtml
	};
	Object.assign(global, module.exports);
}
