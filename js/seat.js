/* =========================================================================
   スクールゾーン協議会 座席表エディタ（窓側⇔廊下側入れ替え対応）
========================================================================= */

function getAllSzParticipantsForSeat() {
	const list = [
		{ key: "", label: "（空席・通路）" },
		{ key: "FAC_STAGE", label: "【設備】演台・司会席" },
		{ key: "FAC_DESK", label: "【設備】長机・テーブル" },
		{ key: "FAC_DOOR", label: "【設備】出入口" },
		{ key: "CUSTOM", label: "【自由入力】テキスト指定" }
	];

	// 校外役員（複数役員・同一地区別班データのキー重複防止）
	repState.districts.forEach((d, dIdx) => {
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
	const uniqueNeighborDistricts = getUniqueNeighborhoodDistricts(repState.districts, true);
	uniqueNeighborDistricts.forEach(({ d }) => {
		(d.neighborhood || []).forEach((n, nIdx) => {
			if (d.szNeighborChecks && d.szNeighborChecks[nIdx]) {
				const nName = getFullName(n);
				list.push({
					key: `NEI_${d.district}_${nIdx}`,
					label: `[自治会] ${d.district} ${n.role}：${nName}`,
					org: `${d.district} ${n.role}`,
					name: nName
				});
			}
		});
	});

	// 外部関係者
	(repState.szExternals || []).forEach((ex, exIdx) => {
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
	repState.seatConfig.cols = Math.max(2, Math.min(10, parseInt(document.getElementById('seat-cols').value, 10) || 4));
	repState.seatConfig.rows = Math.max(2, Math.min(14, parseInt(document.getElementById('seat-rows').value, 10) || 5));
	saveRepLocal();
	renderSeatEditor();
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
				<input type="text" value="${esc(cellData.customText)}" placeholder="自由記述・補足メモ" data-input="updateSeatCell" data-target="${cellKey}" data-field="customText">
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

function captureSeatState() {
	return {
		participants: getAllSzParticipantsForSeat(),
		neighbors: getUniqueNeighborhoodDistricts(repState.districts, false).map(({ d, dIdx }) => ({
			district: d.district,
			sourceIndex: dIdx,
			identities: (d.neighborhood || []).map(neighborIdentity),
			checks: { ...d.szNeighborChecks }
		}))
	};
}

function reconcileSeatState(previous, explicitKeys = {}) {
	// 同名地区の代表名簿が変わっても、出席チェックを別人へ引き継がない。
	repState.districts.forEach(d => {
		const old = previous.neighbors.find(group => group.district === d.district);
		if (!old || old.identities.length === 0) return;
		const checks = {};
		const identities = (d.neighborhood || []).map(neighborIdentity);
		identities.forEach((identity, index) => {
			const matches = old.identities.map((value, i) => value === identity ? i : -1).filter(i => i >= 0);
			if (matches.length === 1 && identities.filter(value => value === identity).length === 1 && Object.hasOwn(old.checks, matches[0])) checks[index] = old.checks[matches[0]];
		});
		d.szNeighborChecks = checks;
	});
	const current = getAllSzParticipantsForSeat();
	Object.values(repState.seatConfig?.cells || {}).forEach(cell => {
		const key = cell.refKey || '';
		if (!key || key === 'CUSTOM' || key.startsWith('FAC_')) return;
		if (Object.hasOwn(explicitKeys, key)) {
			cell.refKey = current.some(person => person.key === explicitKeys[key]) ? explicitKeys[key] : '';
			return;
		}
		const old = previous.participants.find(person => person.key === key);
		const matches = old ? current.filter(person => participantIdentity(person) === participantIdentity(old)) : [];
		const oldMatches = old ? previous.participants.filter(person => participantIdentity(person) === participantIdentity(old)) : [];
		cell.refKey = matches.length === 1 && oldMatches.length === 1 ? matches[0].key : '';
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

