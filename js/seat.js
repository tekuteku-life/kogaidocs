/* =========================================================================
   スクールゾーン協議会 座席表エディタ（窓側⇔廊下側入れ替え対応）
========================================================================= */

function getAllSzParticipantsForSeat(target = repState) {
	const list = [
		{ key: "", label: "（空席・通路）" },
		{ key: "FAC_STAGE", label: "【設備】演台・司会席" },
		{ key: "FAC_DESK", label: "【設備】長机・テーブル" },
		{ key: "FAC_DOOR", label: "【設備】出入口" },
		{ key: "CUSTOM", label: "【自由入力】テキスト指定" }
	];

	// 校外役員（複数役員・同一地区別班データのキー重複防止）
	target.districts.forEach((d, dIdx) => {
		if (!d.selectedForPrint) return;
		const offList = d.officers || [];
		offList.forEach((off, oIdx) => {
			const r = off?.role ? `${off.role} ` : "";
			const officerName = getFullName(off);
			if (!officerName && !off?.role) return;
			const hanStr = (off?.han || d.han || "").trim();
			const distLabel = hanStr ? `${d.district}（${hanStr}）` : d.district;
			list.push({
				key: `OFF_${dIdx}_${oIdx}`,
				label: `[校外] ${distLabel}：${r}${officerName}`,
				org: `校外委員（${d.district}${hanStr ? ' ' + hanStr : ''}）`,
				name: `${r}${officerName}`
			});
		});
	});

	// 自治会出席者（同一地区名の重複排除）
	const uniqueNeighborDistricts = getUniqueNeighborhoodDistricts(target.districts, true);
	uniqueNeighborDistricts.forEach(({ d }) => {
		const { identities, unique } = neighborIdentityFlags(d.neighborhood || []);
		(d.neighborhood || []).forEach((n, nIdx) => {
			if (d.szNeighborChecks && d.szNeighborChecks[nIdx]) {
				const nName = getFullName(n);
				list.push({
					key: `NEI_${d.district}_${nIdx}`,
					label: `[自治会] ${d.district} ${n.role}：${nName}`,
					org: `${d.district} ${n.role}`,
					name: nName,
					// 取込後の座席の照合に使う本人の識別子。名簿内で一意でなければ本人を特定できない（E-13-02・I-13-02）。
					identity: unique[nIdx] ? identities[nIdx] : null
				});
			}
		});
	});

	// 外部関係者
	(target.szExternals || []).forEach((ex, exIdx) => {
		if (ex.attend) {
			const exName = getFullName(ex);
			list.push({
				key: `EXT_${exIdx}`,
				label: `[${ex.category}] ${ex.org} ${ex.role}：${exName || '（未定）'}`,
				org: `${ex.org} ${ex.role}`.trim(),
				name: exName
			});
		}
	});

	return list;
}

function swapSeatWindowCorridor() {
	const tmp = repState.seatConfig.leftSide;
	repState.seatConfig.leftSide = repState.seatConfig.rightSide;
	repState.seatConfig.rightSide = tmp;
	saveRepLocal();
	renderSeatEditor();
}

function resizeSeatGrid() {
	const cols = Math.max(2, Math.min(10, parseInt(document.getElementById('seat-cols').value, 10) || 4));
	const rows = Math.max(2, Math.min(14, parseInt(document.getElementById('seat-rows').value, 10) || 5));
	// 取消・巻戻し後の設定を参照し直して入力欄を戻す（巻戻しは設定を別オブジェクトへ置き換える）。
	const restoreInputs = () => {
		document.getElementById('seat-cols').value = repState.seatConfig.cols;
		document.getElementById('seat-rows').value = repState.seatConfig.rows;
	};
	const outside = cellKey => {
		const [row, col] = cellKey.split('_').map(Number);
		return !(row < rows && col < cols);
	};
	const cells = repState.seatConfig.cells || {};
	const assigned = Object.keys(cells).filter(cellKey => outside(cellKey) && (cells[cellKey]?.refKey || cells[cellKey]?.customText)).length;
	// 範囲外の割当てがある縮小は件数を示して確認し、取消時は元の段・列へ戻す（SEC-30）。
	if (assigned && !confirm(`座席を縮小すると、範囲外の${assigned}席の割当て・自由記述が削除されます。よろしいですか？`)) {
		restoreInputs();
		return false;
	}
	const accepted = applyStorableChange('kogai_rep_v2', repState, model => {
		model.seatConfig.cols = cols;
		model.seatConfig.rows = rows;
		for (const cellKey of Object.keys(model.seatConfig.cells || {})) if (outside(cellKey)) delete model.seatConfig.cells[cellKey];
	});
	if (!accepted) {
		restoreInputs();
		return false;
	}
	const saved = saveRepLocal();
	renderSeatEditor();
	return saved;
}

function renderSeatEditor() {
	if (!repState.seatConfig) repState.seatConfig = { cols: 4, rows: 5, cells: {} };
	const cfg = repState.seatConfig;
	if (!cfg.cells) cfg.cells = {};
	document.getElementById('seat-cols').value = cfg.cols;
	document.getElementById('seat-rows').value = cfg.rows;
	document.getElementById('seat-top-label').value = cfg.topLabel || "前方（演台・司会・スクリーン側）";
	document.getElementById('seat-bottom-label').value = cfg.bottomLabel || "後方（出入口側）";
	document.getElementById('seat-left-bar').textContent = cfg.leftSide || "窓側";
	document.getElementById('seat-right-bar').textContent = cfg.rightSide || "廊下側";
	document.getElementById('seat-top-bar-view').textContent = cfg.topLabel;
	document.getElementById('seat-bottom-bar-view').textContent = cfg.bottomLabel;

	const grid = document.getElementById('seat-grid-container');
	grid.style.gridTemplateColumns = `repeat(${cfg.cols}, 1fr)`;
	grid.innerHTML = "";

	const options = getAllSzParticipantsForSeat();

	for (let r = 0; r < cfg.rows; r++) {
		for (let c = 0; c < cfg.cols; c++) {
			const cellKey = `${r}_${c}`;
			const cellData = cfg.cells[cellKey] || { refKey: "", customText: "" };
			const div = document.createElement('div');
			div.className = 'seat-cell-edit';

			const optsHtml = options.map(o => `<option value="${esc(o.key)}" ${cellData.refKey===o.key?'selected':''}>${esc(o.label)}</option>`).join('');
			div.innerHTML = `
				<div style="font-size:0.7rem; color:#64748b;">${r+1}段-${c+1}列</div>
				<select data-change="updateSeatCell" data-target="${cellKey}" data-field="refKey">${optsHtml}</select>
				<input type="text" maxlength="4096" value="${esc(cellData.customText)}" placeholder="自由記述・補足メモ" data-input="updateSeatCell" data-target="${cellKey}" data-field="customText">
			`;
			grid.appendChild(div);
		}
	}
}

function updateSeatCell(cellKey, field, val) {
	if (!repState.seatConfig.cells[cellKey]) repState.seatConfig.cells[cellKey] = { refKey: "", customText: "" };
	repState.seatConfig.cells[cellKey][field] = val;
	saveRepLocal();
}

function participantIdentity(participant) {
	return JSON.stringify([participant.org, participant.name]);
}

function neighborIdentity(row) {
	return JSON.stringify([getFullName(row), row.role || '', row.tel || '', row.address || '']);
}

// 会長として出席を初期チェックする役職（前後の空白を除いた完全一致、SPEC-Q1・I-13-01）。
const NEIGHBOR_CHAIRMAN_ROLES = ['会長', '自治会長', '町内会長', '町会長'];

function isNeighborChairman(row) {
	return !!row && typeof row === 'object' && typeof row.role === 'string' && NEIGHBOR_CHAIRMAN_ROLES.includes(row.role.trim());
}

/** 識別子ごとの添字の一覧（照合を行数に比例する手間で行うため）。 */
function neighborIdentityIndex(identities) {
	const index = new Map();
	identities.forEach((identity, i) => {
		if (!index.has(identity)) index.set(identity, []);
		index.get(identity).push(i);
	});
	return index;
}

/** 各行の本人識別子と、名簿内で一意かどうかを返す。 */
function neighborIdentityFlags(rows) {
	const identities = rows.map(neighborIdentity);
	const counts = new Map();
	identities.forEach(identity => counts.set(identity, (counts.get(identity) || 0) + 1));
	return { identities, unique: identities.map(identity => counts.get(identity) === 1) };
}

/** 新しい名簿の初期チェック（E-13-01）: 氏名のある一意な会長、いなければ氏名のある一意な最初の行。 */
function defaultNeighborChecks(rows) {
	if (!Array.isArray(rows)) return {};
	const { unique } = neighborIdentityFlags(rows);
	const checks = {};
	rows.forEach((row, index) => {
		if (unique[index] && isNeighborChairman(row) && getFullName(row) !== '') checks[index] = true;
	});
	// 氏名のある会長がいる名簿（重複行だけの場合を含む）では、会長以外へ代替チェックしない。
	if (Object.keys(checks).length === 0 && !rows.some(row => isNeighborChairman(row) && getFullName(row) !== '')) {
		const index = rows.findIndex((row, i) => unique[i] && getFullName(row) !== '');
		if (index >= 0) checks[index] = true;
	}
	return checks;
}

function neighborCheckCandidate(entry) {
	return {
		identities: (Array.isArray(entry?.neighborhood) ? entry.neighborhood : []).map(neighborIdentity),
		checks: { ...((entry && entry.szNeighborChecks) || {}) }
	};
}

function findNeighborGroup(previous, districtName) {
	const name = (districtName || '').trim();
	return (previous?.neighbors || []).find(group => (group.district || '').trim() === name) || null;
}

function hasNamedNeighborIdentity(identity) {
	try { return JSON.parse(identity)[0] !== ''; } catch { return false; }
}

/** 取込で置き換える名簿の出席を、差替え前の名簿の候補と本人単位で照合して決める（E-13-02・I-13-02）。 */
function resolveImportedNeighborChecks(rows, candidates, options = {}) {
	if (!Array.isArray(rows)) return {};
	const chairmanDefaults = options.chairmanDefaults !== false;
	const base = (Array.isArray(candidates) ? candidates : []).find(candidate =>
		!!candidate && typeof candidate === 'object' && Array.isArray(candidate.identities) && candidate.identities.some(hasNamedNeighborIdentity));
	if (!base) return chairmanDefaults ? defaultNeighborChecks(rows) : {};
	const oldChecks = base.checks && typeof base.checks === 'object' ? base.checks : {};
	// 差替え前の代表組（候補の先頭）でない代替の比較元からは、チェックなし（外したチェック）と会長の行のチェックだけを引き継ぐ。
	// 会長以外の本人のチェックは、旧版の行番号同期で別の本人に付いた値と区別できないため持ち込まない。
	const fallback = base !== candidates[0];
	const { identities, unique } = neighborIdentityFlags(rows);
	const baseIndex = neighborIdentityIndex(base.identities);
	const checks = {};
	rows.forEach((row, index) => {
		// 氏名のない行と、名簿内で本人を特定できない重複行は出席にしない。
		if (!unique[index] || getFullName(row) === '') return;
		const matches = baseIndex.get(identities[index]) || [];
		const carried = matches.length === 1 && Object.hasOwn(oldChecks, matches[0]) ? oldChecks[matches[0]] : undefined;
		if (matches.length === 1 && !(fallback && carried !== undefined && carried !== false && !isNeighborChairman(row))) {
			if (carried !== undefined) checks[index] = carried;
		} else if (chairmanDefaults && isNeighborChairman(row)) {
			checks[index] = true;
		}
	});
	return checks;
}

/**
 * 置き換えない同名エントリの出席を、従来の照合と同じく本人単位で作り直す（I-13-02）。
 * 揃える元（差替え前の代表組、取込後の名簿の順）と本人が一意に一致する行だけがその出席を持ち、それ以外の行は出席なしとする。
 */
function alignNeighborChecksToGroup(entry, sources, options = {}) {
	const usable = (Array.isArray(sources) ? sources : []).filter(source =>
		!!source && typeof source === 'object' && Array.isArray(source.identities) && source.identities.some(hasNamedNeighborIdentity));
	const rows = Array.isArray(entry?.neighborhood) ? entry.neighborhood : [];
	const before = entry.szNeighborChecks;
	const checks = {};
	const { identities, unique } = neighborIdentityFlags(rows);
	const ambiguous = neighborIdentityIndex(Array.isArray(options.clearDuplicatesOf) ? options.clearDuplicatesOf : []);
	const sourceIndexes = usable.map(source => neighborIdentityIndex(source.identities));
	rows.forEach((row, index) => {
		// 氏名のない行、名簿内で重複する行、取込後の名簿で重複して本人を特定できない行は出席なしにする。
		if (!unique[index] || getFullName(row) === '' || (ambiguous.get(identities[index]) || []).length > 1) return;
		for (const [k, source] of usable.entries()) {
			const matches = sourceIndexes[k].get(identities[index]) || [];
			if (matches.length !== 1) continue;
			const sourceChecks = source.checks || {};
			if (Object.hasOwn(sourceChecks, matches[0])) checks[index] = sourceChecks[matches[0]];
			return;
		}
	});
	if (JSON.stringify(checks) !== JSON.stringify({ ...(before || {}) })) entry.szNeighborChecks = checks;
}

function captureSeatState(target = repState) {
	return {
		participants: getAllSzParticipantsForSeat(target),
		neighbors: getUniqueNeighborhoodDistricts(target.districts, false).map(({ d, dIdx }) => ({
			district: d.district,
			sourceIndex: dIdx,
			identities: (d.neighborhood || []).map(neighborIdentity),
			checks: { ...d.szNeighborChecks }
		}))
	};
}

function reconcileSeatState(previous, explicitKeys = {}, target = repState, options = {}) {
	// 同名地区の代表名簿が変わっても、出席チェックを別人へ引き継がない。
	// 取込では呼出し側が置き換えたエントリの出席を決めるため、出席の再照合は行わない（I-13-02）。
	if (options.neighborChecksResolved !== true) target.districts.forEach(d => {
		const old = previous.neighbors.find(group => group.district === d.district);
		if (!old || old.identities.length === 0) return;
		const checks = {};
		const { identities, unique } = neighborIdentityFlags(d.neighborhood || []);
		const oldIndex = neighborIdentityIndex(old.identities);
		identities.forEach((identity, index) => {
			const matches = oldIndex.get(identity) || [];
			if (matches.length === 1 && unique[index] && Object.hasOwn(old.checks, matches[0])) checks[index] = old.checks[matches[0]];
		});
		d.szNeighborChecks = checks;
	});
	const current = getAllSzParticipantsForSeat(target);
	// 自治会役員の座席は所属と本人（氏名・役職・電話・住所）で照合し、別の本人へ移さない（E-13-02・I-13-02）。
	const identityOf = person => (person.identity !== undefined
		? (person.identity === null ? null : JSON.stringify([person.org, person.identity, 'neighbor']))
		: participantIdentity(person));
	const resolve = key => {
		if (Object.hasOwn(explicitKeys, key)) {
			// 対応表で写す場合も、名簿内で重複する自治会役員の行（本人を特定できない）へは写さない。
			const mapped = current.find(person => person.key === explicitKeys[key]);
			return mapped && mapped.identity !== null ? explicitKeys[key] : '';
		}
		const old = previous.participants.find(person => person.key === key);
		const identity = old ? identityOf(old) : null;
		const oldMatches = identity === null ? [] : previous.participants.filter(person => identityOf(person) === identity);
		// 地区詳細モーダルで編集した行は、編集前と編集後の本人のうち変更後に出席している方へ引き継ぎ、両方なら解除する。
		const identities = [...new Set([identity, old?.edited ? identityOf({ ...old, ...old.edited }) : null].filter(value => value !== null))];
		const found = identities.map(value => current.filter(person => identityOf(person) === value)).filter(list => list.length > 0);
		return oldMatches.length === 1 && found.length === 1 && found[0].length === 1 ? found[0][0].key : '';
	};
	const cells = Object.values(target.seatConfig?.cells || {});
	const mapping = new Map();
	cells.forEach(cell => {
		const key = cell.refKey || '';
		if (key && key !== 'CUSTOM' && !key.startsWith('FAC_') && !mapping.has(key)) mapping.set(key, resolve(key));
	});
	// 別々の座席の本人が同じ出席者に当たる場合は、どちらの座席か決められないため、それらを解除する（R-09）。
	const claims = new Map();
	mapping.forEach(value => { if (value) claims.set(value, (claims.get(value) || 0) + 1); });
	cells.forEach(cell => {
		const key = cell.refKey || '';
		if (!mapping.has(key)) return;
		const value = mapping.get(key);
		cell.refKey = value && claims.get(value) === 1 ? value : '';
	});
}

function setDistrictPrintSelection(index, selected) {
	const previous = captureSeatState();
	repState.districts[index].selectedForPrint = selected;
	reconcileSeatState(previous);
	saveRepLocal();
	renderRepAll();
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		neighborIdentity,
		neighborIdentityFlags,
		NEIGHBOR_CHAIRMAN_ROLES,
		isNeighborChairman,
		defaultNeighborChecks,
		neighborCheckCandidate,
		findNeighborGroup,
		resolveImportedNeighborChecks,
		alignNeighborChecksToGroup,
		hasNamedNeighborIdentity,
		captureSeatState,
		reconcileSeatState,
		setDistrictPrintSelection,
		getAllSzParticipantsForSeat,
		swapSeatWindowCorridor,
		resizeSeatGrid,
		renderSeatEditor,
		updateSeatCell
	};
	Object.assign(global, module.exports);
}

