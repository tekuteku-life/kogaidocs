/* =========================================================================
   ハタフロット（旗振り当番シフト管理）ネイティブ統合エンジン
========================================================================= */

/**
 * 児童データと設定フォーマットに基づいてハタフロット変換プレビューを更新します（後方互換）
 */
function updateHataPreview() {
	const fmtEl = document.getElementById('hata-format');
	const dedupEl = document.getElementById('hata-dedup');
	const previewEl = document.getElementById('hata-preview');
	if (!fmtEl || !dedupEl || !previewEl) return;

	const fmt = fmtEl.value;
	const dedup = dedupEl.checked;
	const seen = new Set();
	const lines = [];

	(currentDistrict.students || []).forEach(s => {
		if (!s.lastName && !s.firstName && !s.name && !s.address) return;
		normalizeNameFields(s);

		const lastName = (s.lastName || "").trim();
		const firstName = (s.firstName || "").trim();
		const fullName = getFullName(s);
		const lastKana = (s.lastNameKana || "").trim();
		const firstKana = (s.firstNameKana || "").trim();
		const fullKana = getFullNameKana(s);

		const rawAddr = (s.address || "").trim();
		// 全角数字（０-９）を半角数字（0-9）に正規化
		const normalizedAddr = rawAddr.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
		const numMatches = normalizedAddr.match(/\d+/g);
		const numAddr = numMatches ? numMatches.join('-') : rawAddr;

		const defaultHan = (currentDistrict.han || "").trim();
		const sHan = (s.han || "").trim();
		const han = sHan || defaultHan;
		const district = (currentDistrict.district || "").trim();

		const line = fmt
			.replace(/\{住所\}/g, () => rawAddr)
			.replace(/\{住所数字\}/g, () => numAddr)
			.replace(/\{地区\}/g, () => district)
			.replace(/\{班\}/g, () => han)
			.replace(/\{班名\}/g, () => han)
			.replace(/\{苗字\}/g, () => lastName)
			.replace(/\{名前\}/g, () => firstName)
			.replace(/\{氏名\}/g, () => fullName)
			.replace(/\{ふりがな\}/g, () => fullKana)
			.replace(/\{苗字ふりがな\}/g, () => lastKana)
			.replace(/\{名前ふりがな\}/g, () => firstKana)
			.replace(/\{学年\}/g, () => (s.grade || "") + "年")
			.trim();

		if (dedup) {
			const key = `${numAddr}_${lastName || fullName}`;
			if (seen.has(key)) return;
			seen.add(key);
		}
		if (line) lines.push(line);
	});

	previewEl.value = lines.join('\n');
}

/**
 * プレビューに表示されたハタフロット用リストをクリップボードにコピーします（後方互換）
 */
async function copyHataList() {
	const previewEl = document.getElementById('hata-preview');
	const text = previewEl ? previewEl.value : "";
	if (navigator.clipboard && navigator.clipboard.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			alert("ハタフロット用リストをクリップボードにコピーしました。");
			return;
		} catch (e) {}
	}
	if (previewEl) {
		if (typeof previewEl.select === 'function') previewEl.select();
		alert("ハタフロット用リストを選択しました。コピー（Ctrl+C）してご活用ください。");
	}
}

/**
 * 児童名簿配列から住所数字＋苗字で世帯を集約し、兄弟姉妹を重複排除します
 */
function extractHouseholdsFromStudents(students) {
	if (!Array.isArray(students)) return [];
	const householdMap = new Map();

	students.forEach(s => {
		if (!s) return;
		const lastName = (s.lastName || '').trim();
		const firstName = (s.firstName || '').trim();
		const fullName = ((lastName || '') + ' ' + (firstName || '')).trim() || (s.name || '').trim();
		if (!lastName && !fullName) return; // 氏名完全空行はスキップ

		const rawAddr = (s.address || '').trim();
		const normalizedAddr = rawAddr.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
		const numMatches = normalizedAddr.match(/\d+/g);
		const numAddr = numMatches ? numMatches.join('-') : '';

		let key = '';
		let displayName = '';
		const targetName = lastName || fullName;

		if (numAddr) {
			key = `${numAddr}_${targetName}`;
			displayName = `${numAddr} ${targetName}`;
		} else if (rawAddr) {
			key = `${rawAddr}_${targetName}`;
			displayName = `${rawAddr} ${targetName}`;
		} else {
			key = targetName;
			displayName = targetName;
		}

		if (!householdMap.has(key)) {
			householdMap.set(key, {
				key,
				displayName,
				lastName: targetName,
				address: rawAddr,
				numAddr,
				children: []
			});
		}
		householdMap.get(key).children.push(s);
	});

	return Array.from(householdMap.values());
}

/**
 * 日本の祝日・振替休日をオフライン高精度計算します
 */
function generateJapaneseHolidays(startYear, endYear) {
	const holidays = [];

	for (let year = startYear; year <= endYear; year++) {
		const yearHolidays = [];

		// 固定祝日
		yearHolidays.push({ date: `${year}-01-01`, name: '元日' });
		yearHolidays.push({ date: `${year}-02-11`, name: '建国記念の日' });
		if (year >= 2020) {
			yearHolidays.push({ date: `${year}-02-23`, name: '天皇誕生日' });
		}
		yearHolidays.push({ date: `${year}-04-29`, name: '昭和の日' });
		yearHolidays.push({ date: `${year}-05-03`, name: '憲法記念日' });
		yearHolidays.push({ date: `${year}-05-04`, name: 'みどりの日' });
		yearHolidays.push({ date: `${year}-05-05`, name: 'こどもの日' });
		yearHolidays.push({ date: `${year}-08-11`, name: '山の日' });
		yearHolidays.push({ date: `${year}-11-03`, name: '文化の日' });
		yearHolidays.push({ date: `${year}-11-23`, name: '勤労感謝の日' });

		// ハッピーマンデー（月曜日）
		const getNthMonday = (month, n) => {
			const firstDay = new Date(Date.UTC(year, month - 1, 1));
			const firstDayOfWeek = firstDay.getUTCDay(); // 0=日, 1=月
			const offset = (1 - firstDayOfWeek + 7) % 7;
			const day = 1 + offset + (n - 1) * 7;
			return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		};

		yearHolidays.push({ date: getNthMonday(1, 2), name: '成人の日' });
		yearHolidays.push({ date: getNthMonday(7, 3), name: '海の日' });
		yearHolidays.push({ date: getNthMonday(9, 3), name: '敬老の日' });
		yearHolidays.push({ date: getNthMonday(10, 2), name: 'スポーツの日' });

		// 春分の日・秋分の日の天文学的計算
		const shunbunDay = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
		yearHolidays.push({ date: `${year}-03-${String(shunbunDay).padStart(2, '0')}`, name: '春分の日' });

		const shubunDay = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
		yearHolidays.push({ date: `${year}-09-${String(shubunDay).padStart(2, '0')}`, name: '秋分の日' });

		// 日付順ソート
		yearHolidays.sort((a, b) => a.date.localeCompare(b.date));

		// 振替休日計算（祝日が日曜日の場合、その日後で最も近い祝日でない日）
		const holidayDateSet = new Set(yearHolidays.map(h => h.date));
		const substituteHolidays = [];

		yearHolidays.forEach(h => {
			const parts = h.date.split('-');
			const d = new Date(Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10)));
			if (d.getUTCDay() === 0) { // 日曜日
				let cur = new Date(d);
				while (true) {
					cur.setUTCDate(cur.getUTCDate() + 1);
					const dateStr = cur.toISOString().slice(0, 10);
					if (!holidayDateSet.has(dateStr)) {
						substituteHolidays.push({ date: dateStr, name: '振替休日' });
						holidayDateSet.add(dateStr);
						break;
					}
				}
			}
		});

		// 国民の休日（2つの祝日に挟まれた平日）
		const citizenHolidays = [];
		for (let i = 0; i < yearHolidays.length - 1; i++) {
			const h1 = yearHolidays[i];
			const h2 = yearHolidays[i + 1];
			const p1 = h1.date.split('-');
			const d1 = new Date(Date.UTC(parseInt(p1[0], 10), parseInt(p1[1], 10) - 1, parseInt(p1[2], 10)));
			const p2 = h2.date.split('-');
			const d2 = new Date(Date.UTC(parseInt(p2[0], 10), parseInt(p2[1], 10) - 1, parseInt(p2[2], 10)));
			const diffDays = Math.round((d2 - d1) / (24 * 3600 * 1000));
			if (diffDays === 2) {
				const mid = new Date(d1);
				mid.setUTCDate(mid.getUTCDate() + 1);
				const midStr = mid.toISOString().slice(0, 10);
				if (!holidayDateSet.has(midStr) && mid.getUTCDay() !== 0) {
					citizenHolidays.push({ date: midStr, name: '国民の休日' });
					holidayDateSet.add(midStr);
				}
			}
		}

		holidays.push(...yearHolidays, ...substituteHolidays, ...citizenHolidays);
	}

	holidays.sort((a, b) => a.date.localeCompare(b.date));
	return holidays;
}

/**
 * 期間プリセットの日程を算出します（前期・後期・通年）
 */
function getPeriodPresetDates(presetKey, baseYear) {
	const yr = typeof baseYear === 'number' ? baseYear : new Date().getFullYear();
	if (presetKey === 'zenki') {
		return {
			startDate: `${yr}-04-06`,
			endDate: `${yr}-09-30`
		};
	}
	if (presetKey === 'kouki') {
		return {
			startDate: `${yr}-10-01`,
			endDate: `${yr + 1}-03-24`
		};
	}
	// full / 通年
	return {
		startDate: `${yr}-04-06`,
		endDate: `${yr + 1}-03-24`
	};
}

/**
 * 旗振り当番シフトを均等ラウンドロビン自動生成します
 */
function generateHataSchedule(config) {
	if (!config || !config.startDate || !config.endDate) return [];
	const weekdays = Array.isArray(config.weekdays) ? config.weekdays : [1, 2, 3, 4, 5];
	const weekdaysSet = new Set(weekdays);

	// 祝日マップ生成
	const holidayMap = new Map();
	if (typeof config.holidays === 'string') {
		config.holidays.split('\n').forEach(line => {
			const parts = line.split(',');
			if (parts[0] && parts[0].trim()) {
				holidayMap.set(parts[0].trim(), (parts[1] || '祝日').trim());
			}
		});
	} else if (Array.isArray(config.holidays)) {
		config.holidays.forEach(h => {
			if (h && h.date) holidayMap.set(h.date, h.name || '祝日');
		});
	}

	// 特別枠マップ生成
	const specialMap = new Map();
	if (typeof config.specials === 'string') {
		config.specials.split('\n').forEach(line => {
			const parts = line.split(',');
			if (parts[0] && parts[0].trim()) {
				const d = parts[0].trim();
				const noteOrPerson = (parts[1] || '特別枠').trim();
				const personOrNote = (parts[2] || '').trim();
				specialMap.set(d, {
					note: personOrNote ? noteOrPerson : '特別枠',
					person: personOrNote || noteOrPerson
				});
			}
		});
	}

	// メンバーリスト作成（免除世帯を除外）
	const rawMembers = typeof config.members === 'string'
		? config.members.split('\n').map(m => m.trim()).filter(Boolean)
		: (Array.isArray(config.members) ? config.members : []);

	const exemptSet = new Set(config.exemptHouseholds || []);
	const activeMembers = rawMembers.filter(m => {
		if (exemptSet.has(m)) return false;
		// キー形式（numAddr_苗字）での免除チェック
		const normKey = m.replace(/\s+/g, '_');
		if (exemptSet.has(normKey)) return false;
		return true;
	});

	const manualOverrides = config.manualOverrides || {};
	const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
	const schedule = [];

	let cur = new Date(config.startDate + 'T00:00:00Z');
	const end = new Date(config.endDate + 'T00:00:00Z');
	let memberIdx = 0;

	while (cur <= end) {
		const dateStr = cur.toISOString().slice(0, 10);
		const dayOfWeekNum = cur.getUTCDay();
		const dayOfWeekStr = dayNames[dayOfWeekNum];

		if (weekdaysSet.has(dayOfWeekNum) && !holidayMap.has(dateStr)) {
			let person = '';
			let note = '';
			let isSpecial = false;
			let isSwapped = false;
			let originalPerson = '';

			if (specialMap.has(dateStr)) {
				const sp = specialMap.get(dateStr);
				person = sp.person;
				note = sp.note;
				isSpecial = true;
			} else {
				if (activeMembers.length > 0) {
					person = activeMembers[memberIdx % activeMembers.length];
					memberIdx++;
				}
			}

			// 手動オーバーライドの適用
			if (manualOverrides[dateStr]) {
				const ovr = manualOverrides[dateStr];
				if (ovr.person !== undefined) person = ovr.person;
				if (ovr.note !== undefined) note = ovr.note;
				if (ovr.isSwapped !== undefined) isSwapped = ovr.isSwapped;
				if (ovr.originalPerson !== undefined) originalPerson = ovr.originalPerson;
			}

			schedule.push({
				date: dateStr,
				dayOfWeek: dayOfWeekStr,
				person,
				note,
				isSpecial,
				isSwapped,
				originalPerson
			});
		}

		cur.setUTCDate(cur.getUTCDate() + 1);
	}

	return schedule;
}

/**
 * 2日間の当番担当者をスワップ（交換）して manualOverrides に記録します
 */
function swapScheduleDates(config, d1, p1, d2, p2) {
	if (!config) return;
	if (!config.manualOverrides) config.manualOverrides = {};
	config.manualOverrides[d1] = {
		person: p2,
		note: '交代',
		isSwapped: true,
		originalPerson: p1
	};
	config.manualOverrides[d2] = {
		person: p1,
		note: '交代',
		isSwapped: true,
		originalPerson: p2
	};
}

/**
 * 特定日付の担当者・調整オーバーライドを設定します
 */
function setDateOverride(config, date, overrideObj) {
	if (!config) return;
	if (!config.manualOverrides) config.manualOverrides = {};
	config.manualOverrides[date] = { ...(config.manualOverrides[date] || {}), ...overrideObj };
}

/**
 * 特定日付の調整オーバーライドを解除（初期化）します
 */
function clearDateOverride(config, date) {
	if (!config || !config.manualOverrides) return;
	delete config.manualOverrides[date];
}

/**
 * 公式ハタフロットJSON形式の文字列を出力します
 */
function exportHataOfficialJson(config) {
	const c = config || {};
	const payload = {
		scheduleTitle: c.title || '登校見守り活動シフト表',
		metaCreatedDate: c.createdDate || new Date().toISOString().slice(0, 10),
		metaLocation: c.location || '',
		metaTime: c.time || '7:45〜8:15',
		metaOrientation: c.orientation || 'landscape',
		metaLayoutColumns: c.layoutColumns || '3',
		metaHeaderMsg: c.headerMsg || '',
		metaFooterMsg: c.footerMsg || '',
		metaContactMsg: c.contactMsg || '',
		startDate: c.startDate || '',
		endDate: c.endDate || '',
		weekdays: c.weekdays || [1, 2, 3, 4, 5],
		holidays: c.holidays || '',
		specials: c.specials || '',
		exemptHouseholds: c.exemptHouseholds || [],
		manualOverrides: c.manualOverrides || {},
		members: c.members || ''
	};
	return JSON.stringify(payload, null, 2);
}

/**
 * 公式ハタフロットJSON文字列をパースしてkogaidocs内部設定構造にインポートします
 */
function importHataOfficialJson(jsonStr) {
	if (!jsonStr) return {};
	const parsed = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
	return {
		title: parsed.scheduleTitle || parsed.title || '登校見守り活動シフト表',
		createdDate: parsed.metaCreatedDate || parsed.createdDate || '',
		location: parsed.metaLocation || parsed.location || '',
		time: parsed.metaTime || parsed.time || '7:45〜8:15',
		orientation: parsed.metaOrientation || parsed.orientation || 'landscape',
		layoutColumns: parsed.metaLayoutColumns || parsed.layoutColumns || '3',
		headerMsg: parsed.metaHeaderMsg || parsed.headerMsg || '',
		footerMsg: parsed.metaFooterMsg || parsed.footerMsg || '',
		contactMsg: parsed.metaContactMsg || parsed.contactMsg || '',
		startDate: parsed.startDate || '',
		endDate: parsed.endDate || '',
		weekdays: parsed.weekdays || [1, 2, 3, 4, 5],
		holidays: parsed.holidays || '',
		specials: parsed.specials || '',
		exemptHouseholds: parsed.exemptHouseholds || [],
		manualOverrides: parsed.manualOverrides || {},
		members: parsed.members || ''
	};
}

/**
 * 生成されたシフト配列からレスポンシブHTML（スマホリスト / PCグリッド）を構築します
 */
function buildHataScheduleHtml(schedule, viewMode = 'list') {
	if (!Array.isArray(schedule) || schedule.length === 0) {
		return `<div class="help-text" style="text-align:center; padding:1.5rem;">シフトがまだ生成されていません。「自動生成」ボタンを押してください。</div>`;
	}

	if (viewMode === 'grid') {
		const rowsHtml = schedule.map((s, idx) => {
			const badge = s.isSpecial ? '<span class="badge badge-warning" style="margin-left:4px;">特別</span>' : (s.isSwapped ? '<span class="badge badge-info" style="margin-left:4px;">交代</span>' : '');
			return `
				<tr>
					<td>${esc(s.date)} (${esc(s.dayOfWeek)})</td>
					<td><strong>${esc(s.person)}</strong>${badge}</td>
					<td>${esc(s.note || '')}</td>
				</tr>
			`;
		}).join('');

		return `
			<table class="edit-table hata-grid-table" style="width:100%;">
				<thead>
					<tr>
						<th style="width:30%;">日付</th>
						<th style="width:40%;">当番担当者</th>
						<th style="width:30%;">備考</th>
					</tr>
				</thead>
				<tbody>
					${rowsHtml}
				</tbody>
			</table>
		`;
	}

	// 'list' スマホ向け縦型カードリスト
	const cardsHtml = schedule.map((s, idx) => {
		const badge = s.isSpecial ? '<span class="badge badge-warning" style="font-size:0.75rem;">特別</span>' : (s.isSwapped ? '<span class="badge badge-info" style="font-size:0.75rem;">交代</span>' : '');
		const noteHtml = s.note ? `<div style="font-size:0.8rem; color:#64748b; margin-top:2px;">${esc(s.note)}</div>` : '';
		return `
			<div class="hata-card-item" style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.8rem; border-bottom:1px solid #e2e8f0;">
				<div>
					<span style="font-weight:600; color:#334155;">${esc(s.date)} (${esc(s.dayOfWeek)})</span>
					${badge}
					${noteHtml}
				</div>
				<div style="font-weight:700; color:#1e293b; font-size:1rem;">
					${esc(s.person)}
				</div>
			</div>
		`;
	}).join('');

	return `<div class="hata-card-list" style="background:#fff; border-radius:6px; border:1px solid #e2e8f0;">${cardsHtml}</div>`;
}

/**
 * A4用紙印刷用の多段組HTMLを構築します
 */
function buildHataPrintHtml(schedule, config) {
	const c = config || {};
	const title = c.title || '登校見守り活動シフト表';
	const loc = c.location ? `【場所: ${esc(c.location)}】` : '';
	const time = c.time ? `【時間: ${esc(c.time)}】` : '';
	const header = c.headerMsg ? `<div class="hata-print-header-msg" style="margin-bottom:8px; font-size:0.9rem; color:#334155;">${esc(c.headerMsg)}</div>` : '';
	const footer = c.footerMsg ? `<div class="hata-print-footer-msg" style="margin-top:12px; font-size:0.85rem; color:#475569;">${esc(c.footerMsg)}</div>` : '';
	const contact = c.contactMsg ? `<div class="hata-print-contact" style="margin-top:6px; font-size:0.85rem; text-align:right; font-weight:600;">${esc(c.contactMsg)}</div>` : '';

	const tableHtml = buildHataScheduleHtml(schedule, 'grid');

	return `
		<div class="hata-print-sheet" style="padding:15px; background:#fff;">
			<div style="text-align:center; margin-bottom:12px;">
				<h2 style="margin:0 0 6px 0; font-size:1.4rem; color:#0f172a;">${esc(title)}</h2>
				<div style="font-size:0.95rem; font-weight:600; color:#334155;">${loc} ${time}</div>
			</div>
			${header}
			<div class="hata-print-columns">
				${tableHtml}
			</div>
			${footer}
			${contact}
		</div>
	`;
}

/**
 * 地区カード5（ハタフロット）UIの描画と初期化
 */
function renderHataCard() {
	if (!currentDistrict.hata) {
		const yr = new Date().getFullYear();
		const preset = getPeriodPresetDates('zenki', yr);
		currentDistrict.hata = {
			title: '登校見守り活動シフト表',
			location: '',
			time: '7:45〜8:15',
			startDate: preset.startDate,
			endDate: preset.endDate,
			weekdays: [1, 2, 3, 4, 5],
			orientation: 'landscape',
			layoutColumns: '3',
			headerMsg: '※雨天時も原則実施します。ご協力をお願いいたします。',
			footerMsg: '※都合がつかない場合は、各自で他の担当者と交代してください。',
			contactMsg: '',
			exemptHouseholds: [],
			manualOverrides: {},
			members: '',
			holidays: '',
			specials: ''
		};
	}

	const h = currentDistrict.hata;
	const titleEl = document.getElementById('hata-title');
	if (titleEl) titleEl.value = h.title || '';
	const locEl = document.getElementById('hata-location');
	if (locEl) locEl.value = h.location || '';
	const timeEl = document.getElementById('hata-time');
	if (timeEl) timeEl.value = h.time || '';
	const startEl = document.getElementById('hata-start-date');
	if (startEl) startEl.value = h.startDate || '';
	const endEl = document.getElementById('hata-end-date');
	if (endEl) endEl.value = h.endDate || '';

	// 名簿からの世帯抽出と免除チェックリストの描画
	renderHataExemptList();
	// 祝日自動計算と祝日欄反映
	if (!h.holidays) {
		const yr = h.startDate ? parseInt(h.startDate.slice(0, 4), 10) : new Date().getFullYear();
		const holis = generateJapaneseHolidays(yr, yr + 1);
		h.holidays = holis.map(x => `${x.date},${x.name}`).join('\n');
		const holiEl = document.getElementById('hata-holidays');
		if (holiEl) holiEl.value = h.holidays;
	}

	// シフトプレビュー描画
	renderHataSchedulePreview();
}

/**
 * 免除世帯チェックボックス一覧を描画します
 */
function renderHataExemptList() {
	const container = document.getElementById('hata-exempt-list');
	if (!container) return;
	const households = extractHouseholdsFromStudents(currentDistrict.students || []);
	const exemptSet = new Set(currentDistrict.hata?.exemptHouseholds || []);

	if (households.length === 0) {
		container.innerHTML = '<span class="help-text">児童名簿に世帯情報がありません。</span>';
		return;
	}

	container.innerHTML = households.map(hh => {
		const checked = exemptSet.has(hh.key) || exemptSet.has(hh.displayName) ? 'checked' : '';
		return `
			<label style="display:inline-flex; align-items:center; gap:4px; margin-right:12px; margin-bottom:6px; font-size:0.85rem; cursor:pointer;">
				<input type="checkbox" ${checked} onchange="toggleHataExempt('${esc(hh.key)}', this.checked)">
				<span>${esc(hh.displayName)} (${hh.children.length}名)</span>
			</label>
		`;
	}).join('');
}

function toggleHataExempt(householdKey, isExempt) {
	if (!currentDistrict.hata) return;
	if (!currentDistrict.hata.exemptHouseholds) currentDistrict.hata.exemptHouseholds = [];
	const set = new Set(currentDistrict.hata.exemptHouseholds);
	if (isExempt) {
		set.add(householdKey);
	} else {
		set.delete(householdKey);
	}
	currentDistrict.hata.exemptHouseholds = Array.from(set);
	saveDistrictLocal();
}

/**
 * 期間プリセット（前期・後期・通年）を適用します
 */
function applyHataPeriodPreset(presetKey) {
	const yr = new Date().getFullYear();
	const dates = getPeriodPresetDates(presetKey, yr);
	if (!currentDistrict.hata) currentDistrict.hata = {};
	currentDistrict.hata.startDate = dates.startDate;
	currentDistrict.hata.endDate = dates.endDate;
	const startEl = document.getElementById('hata-start-date');
	if (startEl) startEl.value = dates.startDate;
	const endEl = document.getElementById('hata-end-date');
	if (endEl) endEl.value = dates.endDate;
	saveDistrictLocal();
}

/**
 * 児童名簿から世帯メンバーリストを同期します
 */
function syncHataMembersFromStudents() {
	const households = extractHouseholdsFromStudents(currentDistrict.students || []);
	const membersText = households.map(h => h.displayName).join('\n');
	if (!currentDistrict.hata) currentDistrict.hata = {};
	currentDistrict.hata.members = membersText;
	const memEl = document.getElementById('hata-members');
	if (memEl) memEl.value = membersText;
	saveDistrictLocal();
	return membersText;
}

/**
 * シフトを自動生成しプレビューを更新します
 */
function runAutoHataGeneration() {
	if (!currentDistrict.hata) return;
	syncHataMembersFromStudents();
	const schedule = generateHataSchedule(currentDistrict.hata);
	renderHataSchedulePreview(schedule);
	saveDistrictLocal();
}

let hataCurrentSchedule = [];

/**
 * シフトプレビューエリアを描画します
 */
function renderHataSchedulePreview(explicitSchedule) {
	const previewContainer = document.getElementById('hata-schedule-preview');
	if (!previewContainer) return;

	if (explicitSchedule) {
		hataCurrentSchedule = explicitSchedule;
	} else if (currentDistrict.hata && currentDistrict.hata.startDate && currentDistrict.hata.endDate) {
		syncHataMembersFromStudents();
		hataCurrentSchedule = generateHataSchedule(currentDistrict.hata);
	} else {
		hataCurrentSchedule = [];
	}

	const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
	const viewMode = isMobile ? 'list' : 'grid';
	previewContainer.innerHTML = buildHataScheduleHtml(hataCurrentSchedule, viewMode);
}

/**
 * ハタフロット印刷を実行します
 */
function printHataSchedule() {
	if (!hataCurrentSchedule || hataCurrentSchedule.length === 0) {
		runAutoHataGeneration();
	}
	const printContent = buildHataPrintHtml(hataCurrentSchedule, currentDistrict.hata);
	const printArea = document.getElementById('hata-print-area') || document.body;
	const origHtml = printArea.innerHTML;

	// 印刷ウィンドウまたはインライン印刷
	const printEl = document.createElement('div');
	printEl.id = 'hata-print-active-sheet';
	printEl.innerHTML = printContent;
	document.body.appendChild(printEl);

	if (typeof window !== 'undefined' && typeof window.print === 'function') {
		window.print();
	}

	if (printEl.parentElement) {
		printEl.parentElement.removeChild(printEl);
	}
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		updateHataPreview,
		copyHataList,
		extractHouseholdsFromStudents,
		generateJapaneseHolidays,
		getPeriodPresetDates,
		generateHataSchedule,
		swapScheduleDates,
		setDateOverride,
		clearDateOverride,
		exportHataOfficialJson,
		importHataOfficialJson,
		buildHataScheduleHtml,
		buildHataPrintHtml,
		renderHataCard,
		renderHataExemptList,
		toggleHataExempt,
		applyHataPeriodPreset,
		syncHataMembersFromStudents,
		runAutoHataGeneration,
		renderHataSchedulePreview,
		printHataSchedule
	};
	Object.assign(global, module.exports);
}
