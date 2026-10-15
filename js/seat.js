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

	// 校外役員
	repState.districts.filter(d => d.selectedForPrint).forEach((d, idx) => {
		const r = d.officer?.role ? `${d.officer.role} ` : "";
		const officerName = getFullName(d.officer);
		list.push({
			key: `OFF_${d.district}`,
			label: `[校外] ${d.district}：${r}${officerName}`,
			org: `校外委員（${d.district}）`,
			name: `${r}${officerName}`
		});
	});

	// 自治会出席者
	repState.districts.filter(d => d.selectedForPrint).forEach(d => {
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
	repState.szExternals.forEach((ex, exIdx) => {
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
	const cfg = repState.seatConfig;
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
				<select onchange="updateSeatCell('${cellKey}','refKey',this.value)">${optsHtml}</select>
				<input type="text" value="${esc(cellData.customText)}" placeholder="自由記述・補足メモ" oninput="updateSeatCell('${cellKey}','customText',this.value)">
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

