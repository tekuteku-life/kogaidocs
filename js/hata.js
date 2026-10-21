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
	renderHataExemptList();
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
	if (endYear < startYear) return [];
	validateDateExpansion(`${String(startYear).padStart(4, '0')}-01-01`, `${String(endYear).padStart(4, '0')}-12-31`);
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
 * 日付文字列を YYYY-MM-DD 形式に正規化します
 */
function normalizeDateStr(dStr) {
	if (!dStr) return null;
	const m = String(dStr).trim().match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
	if (!m) return null;
	const y = m[1];
	const mon = m[2].padStart(2, '0');
	const d = m[3].padStart(2, '0');
	return `${y}-${mon}-${d}`;
}

/**
 * 日付または期間範囲指定（YYYY/MM/DD〜YYYY/MM/DD）を日付配列へ展開します
 */
function assertHataExpansionSize(count) {
	if (count > 3660) throw new Error('旗振りの日付展開は3,660日以下にしてください。');
}

function expandDateOrRange(datePart) {
	if (!datePart) return [];
	const parts = String(datePart).split(/[\~〜]/);
	if (parts.length === 2) {
		const startStr = normalizeDateStr(parts[0]);
		const endStr = normalizeDateStr(parts[1]);
		if (startStr && endStr) {
			const dates = [];
			let curr = new Date(startStr + "T00:00:00Z");
			const endD = new Date(endStr + "T00:00:00Z");
			if (curr > endD) return [];
			validateDateExpansion(startStr, endStr);
			while (curr <= endD) {
				dates.push(curr.toISOString().slice(0, 10));
				curr.setUTCDate(curr.getUTCDate() + 1);
			}
			return dates;
		}
	}
	const single = normalizeDateStr(datePart);
	return single ? [single] : [];
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
 * 旗振り当番シフトを均等ラウンドロビン自動生成します（祝日行保持・波線範囲展開対応）
 */
function generateHataSchedule(config) {
	validateHataExpansionBudget(config || {});
	if (!config || !config.startDate || !config.endDate) return [];
	const weekdays = Array.isArray(config.weekdays) ? config.weekdays : [1, 2, 3, 4, 5];
	const weekdaysSet = new Set(weekdays);

	const startStr = normalizeDateStr(config.startDate);
	const endStr = normalizeDateStr(config.endDate);
	if (!startStr || !endStr) return [];
	if (startStr > endStr) return [];
	validateDateExpansion(startStr, endStr);

	// 祝日マップ生成（波線範囲指定対応）
	const holidayMap = new Map();
	let expandedHolidays = 0;
	if (typeof config.holidays === 'string') {
		config.holidays.split('\n').forEach(line => {
			const parts = line.split(',');
			if (parts[0] && parts[0].trim()) {
				const reason = (parts[1] || '祝日').trim();
				const dates = expandDateOrRange(parts[0].trim());
				expandedHolidays += dates.length;
				assertHataExpansionSize(expandedHolidays);
				dates.forEach(dKey => holidayMap.set(dKey, reason));
			}
		});
	} else if (Array.isArray(config.holidays)) {
		assertHataExpansionSize(config.holidays.length);
		config.holidays.forEach(h => {
			if (h && h.date) holidayMap.set(h.date, h.name || '祝日');
		});
	}

	// 特別枠マップ生成（波線範囲指定対応）
	const specialMap = new Map();
	let expandedSpecials = 0;
	if (typeof config.specials === 'string') {
		config.specials.split('\n').forEach(line => {
			const parts = line.split(',').map(s => s.trim());
			if (parts.length >= 1 && parts[0]) {
				const dates = expandDateOrRange(parts[0]);
				expandedSpecials += dates.length;
				assertHataExpansionSize(expandedSpecials);
				const fixedPerson = parts[1] || '';
				const label = parts[2] || '特別枠';
				dates.forEach(dKey => {
					specialMap.set(dKey, {
						fixedPerson,
						label
					});
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

	let cur = new Date(startStr + 'T00:00:00Z');
	const end = new Date(endStr + 'T00:00:00Z');
	const allDateSet = new Set();

	while (cur <= end) {
		const dNum = cur.getUTCDay();
		if (weekdaysSet.has(dNum)) {
			allDateSet.add(cur.toISOString().slice(0, 10));
		}
		cur.setUTCDate(cur.getUTCDate() + 1);
	}

	specialMap.forEach((_, dateKey) => {
		if (dateKey >= startStr && dateKey <= endStr) {
			allDateSet.add(dateKey);
		}
	});

	const sortedDates = Array.from(allDateSet).sort();
	let memberIdx = 0;
	const schedule = [];

	sortedDates.forEach(dateStr => {
		const d = new Date(dateStr + 'T00:00:00Z');
		const dayOfWeekNum = d.getUTCDay();
		const dayOfWeekStr = dayNames[dayOfWeekNum];

		if (holidayMap.has(dateStr)) {
			schedule.push({
				date: dateStr,
				day: dayOfWeekStr,
				dayOfWeek: dayOfWeekStr,
				type: 'holiday',
				tag: '休み',
				person: '-',
				note: holidayMap.get(dateStr),
				isSpecial: false,
				isSwapped: false,
				originalPerson: ''
			});
		} else if (specialMap.has(dateStr)) {
			const sp = specialMap.get(dateStr);
			let assigned = sp.fixedPerson;
			if (!assigned) {
				if (activeMembers.length > 0) {
					assigned = activeMembers[memberIdx % activeMembers.length];
					memberIdx++;
				}
			}
			schedule.push({
				date: dateStr,
				day: dayOfWeekStr,
				dayOfWeek: dayOfWeekStr,
				type: 'special',
				tag: sp.label,
				person: assigned,
				note: sp.label,
				isSpecial: true,
				isSwapped: false,
				originalPerson: ''
			});
		} else {
			let person = '';
			if (activeMembers.length > 0) {
				person = activeMembers[memberIdx % activeMembers.length];
				memberIdx++;
			}
			schedule.push({
				date: dateStr,
				day: dayOfWeekStr,
				dayOfWeek: dayOfWeekStr,
				type: 'regular',
				tag: '通常',
				person,
				note: '',
				isSpecial: false,
				isSwapped: false,
				originalPerson: ''
			});
		}
	});

	// 手動オーバーライドの適用
	schedule.forEach(s => {
		if (Object.hasOwn(manualOverrides, s.date) && manualOverrides[s.date]) {
			const ovr = manualOverrides[s.date];
			if (ovr.person !== undefined) s.person = ovr.person;
			if (ovr.note !== undefined) s.note = ovr.note;
			if (ovr.type !== undefined) s.type = ovr.type;
			if (ovr.isSwapped !== undefined) s.isSwapped = ovr.isSwapped;
			if (ovr.originalPerson !== undefined) s.originalPerson = ovr.originalPerson;
		}
	});

	return schedule;
}

/**
 * 2日間の当番担当者をスワップ（交換）して manualOverrides に記録します
 */
function swapScheduleDates(config, d1, p1, d2, p2) {
	if (!config) return;
	config.manualOverrides = Object.assign(Object.create(null), config.manualOverrides || {});
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
	config.manualOverrides = Object.assign(Object.create(null), config.manualOverrides || {});
	const previous = Object.hasOwn(config.manualOverrides, date) ? config.manualOverrides[date] : {};
	config.manualOverrides[date] = { ...previous, ...overrideObj };
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
	const parsed = validateHataConfig(typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr);
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

async function loadHataOfficialFile(event) {
	const input = event.target;
	const file = input.files[0];
	if (!file) return;
	const generation = getStorageSessionGeneration();
	try {
		const text = await readImportFile(file);
		if (!text.trim()) throw new Error('旗振り設定ファイルが空です。');
		const config = importHataOfficialJson(text);
		// 展開上限も確定前に検査し、失敗時に現在の設定を置換しない。
		generateHataSchedule(config);
		assertStorageSession(generation);
		currentDistrict.hata = config;
		renderHataCard();
		await saveDistrictLocal();
	} catch (error) {
		alert('旗振り設定の読み込みに失敗しました: ' + error.message);
	} finally {
		input.value = '';
	}
}

/**
 * 各メンバーの当番回数（通常枠・特別枠）を集計します
 */
function calculateHataStats(schedule, members) {
	const stats = Object.create(null);
	const memList = Array.isArray(members)
		? members
		: (typeof members === 'string' ? members.split('\n').map(m => m.trim()).filter(Boolean) : []);

	memList.forEach(m => {
		stats[m] = { regular: 0, special: 0 };
	});

	(schedule || []).forEach(item => {
		if (!item || !item.person || item.person === '-') return;
		if (!Object.hasOwn(stats, item.person)) {
			stats[item.person] = { regular: 0, special: 0 };
		}
		if (item.type === 'special' || item.isSpecial) {
			stats[item.person].special += 1;
		} else if (item.type === 'regular' || (!item.type && !item.isSpecial)) {
			stats[item.person].regular += 1;
		}
	});

	return stats;
}

/**
 * 当番回数集計アコーディオンを描画します
 */
function renderHataSummary(stats, containerEl) {
	const el = containerEl || document.getElementById('hata-summary-container') || document.getElementById('summaryContainer');
	if (!el) return;
	el.innerHTML = '';

	const entries = Object.entries(stats || {});
	if (entries.length === 0) {
		el.innerHTML = '<div class="help-text" style="grid-column: 1 / -1; text-align: center; padding: 0.5rem;">メンバーが登録されていません</div>';
		return;
	}

	entries.forEach(([name, count]) => {
		const div = document.createElement('div');
		div.className = 'summary-item';
		div.innerHTML = `<strong>${esc(name)}</strong><br>通常: ${esc(count.regular)}回<br><span style="color:#d97706; font-size:0.75rem;">特別: ${esc(count.special)}回</span>`;
		el.appendChild(div);
	});
}

/**
 * 当番回数アコーディオンの開閉をトグルします
 */
function toggleHataSummary() {
	const content = document.getElementById('hata-summary-accordion') || document.getElementById('summaryAccordion');
	const arrow = document.getElementById('hata-accordion-arrow') || document.getElementById('accordionArrow');
	if (!content) return;
	if (content.classList.contains('open')) {
		content.classList.remove('open');
		if (arrow) arrow.innerText = '▼';
	} else {
		content.classList.add('open');
		if (arrow) arrow.innerText = '▲';
	}
}

/**
 * 生成されたシフト配列からレスポンシブHTML（スマホリスト / PCグリッド / 本家シート）を構築します
 */
function buildHataScheduleHtml(schedule, viewMode = 'sheet', config = null) {
	if (Array.isArray(schedule)) assertHataExpansionSize(schedule.length);
	if (!Array.isArray(schedule) || schedule.length === 0) {
		return `<div class="help-text" style="text-align:center; padding:1.5rem;">シフトがまだ生成されていません。「自動生成」ボタンを押してください。</div>`;
	}

	if (viewMode === 'list') {
		const cardsHtml = schedule.map((s, idx) => {
			const badge = s.isSpecial ? '<span class="badge badge-warning" style="font-size:0.75rem;">特別</span>' : (s.isSwapped ? '<span class="badge badge-info" style="font-size:0.75rem;">交代</span>' : '');
			const noteHtml = s.note ? `<div style="font-size:0.8rem; color:#64748b; margin-top:2px;">${esc(s.note)}</div>` : '';
			return `
				<div class="hata-card-item" style="display:flex; justify-content:space-between; align-items:center; padding:0.6rem 0.8rem; border-bottom:1px solid #e2e8f0;">
					<div>
						<span style="font-weight:600; color:#334155;">${esc(s.date)} (${esc(s.dayOfWeek || s.day || '')})</span>
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

	if (viewMode === 'grid') {
		const rowsHtml = schedule.map((s, idx) => {
			const badge = s.isSpecial ? '<span class="badge badge-warning" style="margin-left:4px;">特別</span>' : (s.isSwapped ? '<span class="badge badge-info" style="margin-left:4px;">交代</span>' : '');
			return `
				<tr>
					<td>${esc(s.date)} (${esc(s.dayOfWeek || s.day || '')})</td>
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

	// 'sheet' またはデフォルト: 本家ハタフロット多段組A4シートを生成
	return buildHataPrintHtml(schedule, config || (typeof currentDistrict !== 'undefined' ? currentDistrict.hata : null));
}

/**
 * A4用紙印刷用・画面表示用の多段組HTML（本家ハタフロット完全準拠）を構築します
 */
function buildHataPrintHtml(schedule, config) {
	const c = config || {};
	const title = c.title || c.scheduleTitle || '登校見守り活動シフト表';
	const yr = new Date().getFullYear();
	const mo = new Date().getMonth() + 1;
	const da = new Date().getDate();
	const defaultCreatedDate = `作成日：${yr}年${mo}月${da}日`;
	const createdDate = c.createdDate || c.scheduleCreatedDate || defaultCreatedDate;
	const district = c.district || (typeof currentDistrict !== 'undefined' ? currentDistrict.district : '') || '第1地区';
	const location = c.location || '〇〇交差点・小学校正門前';
	const time = c.time || '7:55 〜 8:25';

	const selectedDays = Array.isArray(c.weekdays) ? c.weekdays : [1, 2, 3, 4, 5];
	const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
	const dayStrList = selectedDays.map(d => dayNames[d] + '曜').join('・');
	const weekdaysStr = dayStrList ? `${dayStrList}（祝日・学校休校日を除く）` : '指定なし';

	const headerMsg = (c.headerMsg || '').trim();
	const footerMsg = (c.footerMsg || '').trim();
	const contactMsg = (c.contactMsg || '').trim();

	const headerMsgHtml = headerMsg ? `<div class="sheet-msg-box">${esc(headerMsg)}</div>` : '';
	const footerMsgHtml = footerMsg ? `<div class="sheet-msg-box sheet-footer-box">${esc(footerMsg)}</div>` : '';
	const contactMsgHtml = contactMsg ? `<div class="sheet-contact-box">${esc(contactMsg)}</div>` : '';

	const requestedColumns = Number(c.layoutColumns || 3);
	const numCols = Number.isFinite(requestedColumns) ? Math.max(1, Math.min(6, Math.trunc(requestedColumns))) : 3;
	const schedList = Array.isArray(schedule) ? schedule : [];
	assertHataExpansionSize(schedList.length);
	const total = schedList.length;

	let columnsHtml = '';
	if (total > 0) {
		const itemsPerCol = Math.ceil(total / numCols);
		for (let colIdx = 0; colIdx < numCols; colIdx++) {
			const colItems = schedList.slice(colIdx * itemsPerCol, (colIdx + 1) * itemsPerCol);
			if (colItems.length === 0 && colIdx > 0) continue;

			let rowsHtml = '';
			for (let i = 0; i < itemsPerCol; i++) {
				if (i < colItems.length) {
					const item = colItems[i];
					const md = String(item.date || '').slice(5).replace('-', '/');
					const dayStr = item.day || item.dayOfWeek || '';
					const dateWithDay = esc(`${md}(${dayStr})`);

					if (item.type === 'holiday') {
						rowsHtml += `<tr class="row-holiday"><td>${dateWithDay}</td><td><strong>${esc(item.note || '祝日')}</strong></td></tr>`;
					} else if (item.type === 'special' || item.isSpecial) {
						const noteText = item.note || item.tag || '特別枠';
						rowsHtml += `<tr class="row-special"><td>${dateWithDay}</td><td><span class="badge-special">★${esc(noteText)}:</span><strong>${esc(item.person)}</strong></td></tr>`;
					} else {
						const badge = item.isSwapped ? '<span class="badge badge-info" style="margin-left:4px;">交代</span>' : '';
						rowsHtml += `<tr><td>${dateWithDay}</td><td>${esc(item.person)}${badge}</td></tr>`;
					}
				} else {
					rowsHtml += `<tr><td>&nbsp;</td><td></td></tr>`;
				}
			}

			columnsHtml += `
				<div class="column-table-wrapper">
					<table class="schedule-table">
						<thead>
							<tr>
								<th style="width: 42%;">月日(曜)</th>
								<th style="width: 58%;">担当 / 事由</th>
							</tr>
						</thead>
						<tbody>
							${rowsHtml}
						</tbody>
					</table>
				</div>
			`;
		}
	} else {
		columnsHtml = `<div class="help-text" style="text-align:center; padding:1.5rem; width:100%;">シフトがまだ生成されていません。「自動生成」ボタンを押してください。</div>`;
	}

	return `
		<div class="hata-print-sheet hata-sheet">
			<div class="sheet-top-date">${esc(createdDate)}</div>
			<div class="sheet-header">
				<div class="sheet-title">${esc(title)}</div>
				<table class="sheet-meta-table">
					<tr>
						<td class="sheet-meta-label" style="width: 8%;">地区</td>
						<td style="width: 14%;">${esc(district)}</td>
						<td class="sheet-meta-label" style="width: 8%;">場所</td>
						<td style="width: 32%;">${esc(location)}</td>
						<td class="sheet-meta-label" style="width: 8%;">時間</td>
						<td style="width: 30%; white-space: pre-wrap; line-height: 1.25;">${esc(time)}</td>
					</tr>
					<tr>
						<td class="sheet-meta-label">実施曜日</td>
						<td colspan="5">${esc(weekdaysStr)}</td>
					</tr>
				</table>
			</div>
			${headerMsgHtml}
			<div class="columns-container">
				${columnsHtml}
			</div>
			${footerMsgHtml}
			${contactMsgHtml}
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
			orientation: 'portrait',
			layoutColumns: '2',
			headerMsg: '※雨天時も原則実施します。ご協力をお願いいたします。',
			footerMsg: '※都合がつかない場合は、各自で他の担当者と交代してください。',
			contactMsg: '',
			exemptHouseholds: [],
			manualOverrides: {},
			members: '',
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
	const orientEl = document.getElementById('hata-orientation');
	if (orientEl) orientEl.value = h.orientation || 'portrait';
	const colEl = document.getElementById('hata-columns');
	if (colEl) colEl.value = h.layoutColumns || '2';
	const headEl = document.getElementById('hata-header-msg');
	if (headEl) headEl.value = h.headerMsg || '';
	const footEl = document.getElementById('hata-footer-msg');
	if (footEl) footEl.value = h.footerMsg || '';
	const contactEl = document.getElementById('hata-contact-msg');
	if (contactEl) contactEl.value = h.contactMsg || '';
	const specEl = document.getElementById('hata-specials');
	if (specEl) specEl.value = h.specials || '';

	// 名簿からの世帯抽出と免除チェックリストの描画
	renderHataExemptList();
	// 祝日自動計算と祝日欄反映
	if (h.holidays === undefined) {
		const yr = h.startDate ? parseInt(h.startDate.slice(0, 4), 10) : new Date().getFullYear();
		const holis = generateJapaneseHolidays(yr, yr + 1);
		h.holidays = holis.map(x => `${x.date},${x.name}`).join('\n');
	}
	const holiEl = document.getElementById('hata-holidays');
	if (holiEl) holiEl.value = h.holidays;

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
				<input type="checkbox" ${checked} data-household-key="${esc(hh.key)}" data-change="toggleHataExempt">
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
	const members = extractHouseholdsFromStudents(currentDistrict.students || []).map(household => household.displayName).join('\n');
	const schedule = generateHataSchedule({ ...currentDistrict.hata, members });
	syncHataMembersFromStudents();
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
		assertHataExpansionSize(explicitSchedule.length);
		hataCurrentSchedule = explicitSchedule;
	} else if (currentDistrict.hata && currentDistrict.hata.startDate && currentDistrict.hata.endDate) {
		const members = extractHouseholdsFromStudents(currentDistrict.students || []).map(household => household.displayName).join('\n');
		const schedule = generateHataSchedule({ ...currentDistrict.hata, members });
		syncHataMembersFromStudents();
		hataCurrentSchedule = schedule;
	} else {
		hataCurrentSchedule = [];
	}

	const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
	const viewMode = isMobile ? 'list' : 'sheet';
	previewContainer.innerHTML = buildHataScheduleHtml(hataCurrentSchedule, viewMode);

	// 当番回数アコーディオンの更新
	const summaryContainer = document.getElementById('hata-summary-container') || document.getElementById('summaryContainer');
	if (summaryContainer && currentDistrict.hata) {
		const rawMembers = typeof currentDistrict.hata.members === 'string'
			? currentDistrict.hata.members.split('\n').map(m => m.trim()).filter(Boolean)
			: (Array.isArray(currentDistrict.hata.members) ? currentDistrict.hata.members : []);
		const stats = calculateHataStats(hataCurrentSchedule, rawMembers);
		renderHataSummary(stats, summaryContainer);
	}
}

/**
 * ハタフロット印刷を実行します
 */
function printHataSchedule() {
	if (!hataCurrentSchedule || hataCurrentSchedule.length === 0) {
		runAutoHataGeneration();
	}
	const printContent = buildHataPrintHtml(hataCurrentSchedule, currentDistrict.hata);

	// 印刷ウィンドウまたはインライン印刷
	const printEl = document.createElement('div');
	printEl.id = 'hata-print-active-sheet';
	printEl.innerHTML = printContent;
	document.body.appendChild(printEl);
	document.body.classList.add('printing-hata');

	const origTitle = document.title;
	const hata = currentDistrict.hata;
	const targetTitle = (hata && hata.title) ? hata.title : '旗振りシフト表';
	const pageStyle = document.createElement('style');
	pageStyle.textContent = `@media print { @page { size: A4 ${hata?.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 10mm; } }`;
	document.head.appendChild(pageStyle);

	try {
		document.title = targetTitle;
		if (typeof window !== 'undefined' && typeof window.print === 'function') {
			window.print();
		}
	} finally {
		document.title = origTitle;
		pageStyle.remove();
		document.body.classList.remove('printing-hata');
		if (printEl.parentElement) {
			printEl.parentElement.removeChild(printEl);
		}
	}
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		updateHataPreview,
		copyHataList,
		extractHouseholdsFromStudents,
		generateJapaneseHolidays,
		normalizeDateStr,
		expandDateOrRange,
		getPeriodPresetDates,
		generateHataSchedule,
		swapScheduleDates,
		setDateOverride,
		clearDateOverride,
		exportHataOfficialJson,
		importHataOfficialJson,
		loadHataOfficialFile,
		calculateHataStats,
		renderHataSummary,
		toggleHataSummary,
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
