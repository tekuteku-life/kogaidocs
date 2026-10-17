/* =========================================================================
   グローバル状態データ & ローカル保存
========================================================================= */

let currentDistrict = {
	district: "",
	han: "",
	hanList: [],
	officers: [
		{
			lastName: "",
			firstName: "",
			lastNameKana: "",
			firstNameKana: "",
			role: "",
			han: "",
			tel: "",
			email: "",
			address: "",
			childGrade: "",
			childClass: "",
			childLastName: "",
			childFirstName: "",
			childLastNameKana: "",
			childFirstNameKana: ""
		}
	],
	neighborhood: [],
	students: []
};

let repState = {
	districts: [], // 各要素: { ...districtData, selectedForPrint: true, szNeighborChecks: { [index]: true } }
	szExternals: [
		{ attend: true, category: "学校関係者", org: "小学校", role: "校長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", contact: "" },
		{ attend: true, category: "学校関係者", org: "小学校", role: "副校長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", contact: "" },
		{ attend: true, category: "PTA本部", org: "PTA本部", role: "会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", contact: "" },
		{ attend: true, category: "役所・警察・関係機関", org: "区役所 地域振興課", role: "担当", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", contact: "" },
		{ attend: true, category: "役所・警察・関係機関", org: "土木事務所", role: "担当", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", contact: "" },
		{ attend: true, category: "役所・警察・関係機関", org: "警察署 交通課", role: "担当", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", contact: "" }
	],
	seatConfig: {
		cols: 4,
		rows: 5,
		leftSide: "窓側",
		rightSide: "廊下側",
		topLabel: "前方（演台・司会・スクリーン側）",
		bottomLabel: "後方（出入口側）",
		cells: {} // key: "r_c" -> { refKey: "", customText: "" }
	}
};

let neighborState = {
	district: "",
	neighborhood: []
};

let transferState = {
	children: [
		{
			id: 'c_' + Date.now(),
			lastName: "",
			firstName: "",
			lastNameKana: "",
			firstNameKana: "",
			grade: "1",
			className: "1",
			address: "",
			tel: ""
		}
	],
	memo: ""
};

function saveDistrictLocal() {
	const dNameEl = document.getElementById('d-name');
	if (!dNameEl) return;
	currentDistrict.district = dNameEl.value.trim();
	const dHanListEl = document.getElementById('d-han-list');
	if (dHanListEl) {
		const rawList = dHanListEl.value.split(/[,、，\s\n]+/).map(s => s.trim()).filter(Boolean);
		currentDistrict.hanList = Array.from(new Set(rawList));
		currentDistrict.han = currentDistrict.hanList[0] || "";
	} else {
		const dHanEl = document.getElementById('d-han');
		if (dHanEl) currentDistrict.han = dHanEl.value.trim();
	}

	const officerBoxes = document.querySelectorAll('.officer-item-box');
	if (officerBoxes.length > 0) {
		const newOfficers = [];
		officerBoxes.forEach((box, idx) => {
			const oLastName = box.querySelector(`[data-field="lastName"]`)?.value.trim() || "";
			const oFirstName = box.querySelector(`[data-field="firstName"]`)?.value.trim() || "";
			const oLastKana = box.querySelector(`[data-field="lastNameKana"]`)?.value.trim() || "";
			const oFirstKana = box.querySelector(`[data-field="firstNameKana"]`)?.value.trim() || "";
			const oRole = box.querySelector(`[data-field="role"]`)?.value || "";
			const oHan = box.querySelector(`[data-field="han"]`)?.value.trim() || "";
			const oTel = box.querySelector(`[data-field="tel"]`)?.value.trim() || "";
			const oEmail = box.querySelector(`[data-field="email"]`)?.value.trim() || "";
			const oAddress = box.querySelector(`[data-field="address"]`)?.value.trim() || "";
			const oChildGrade = box.querySelector(`[data-field="childGrade"]`)?.value || "";
			const oChildClass = box.querySelector(`[data-field="childClass"]`)?.value.trim() || "";
			const oChildLastName = box.querySelector(`[data-field="childLastName"]`)?.value.trim() || "";
			const oChildFirstName = box.querySelector(`[data-field="childFirstName"]`)?.value.trim() || "";
			const oChildLastKana = box.querySelector(`[data-field="childLastNameKana"]`)?.value.trim() || "";
			const oChildFirstKana = box.querySelector(`[data-field="childFirstNameKana"]`)?.value.trim() || "";

			const titleEl = box.querySelector('.officer-item-title');
			if (titleEl) {
				titleEl.textContent = `校外役員 ${idx + 1}${oHan ? `（担当: ${oHan}）` : ''}`;
			}

			const obj = {
				lastName: oLastName,
				firstName: oFirstName,
				lastNameKana: oLastKana,
				firstNameKana: oFirstKana,
				role: oRole,
				han: oHan,
				tel: oTel,
				email: oEmail,
				address: oAddress,
				childGrade: oChildGrade,
				childClass: oChildClass,
				childLastName: oChildLastName,
				childFirstName: oChildFirstName,
				childLastNameKana: oChildLastKana,
				childFirstNameKana: oChildFirstKana
			};
			newOfficers.push(obj);
		});
		currentDistrict.officers = newOfficers;
	}

	// パスワード安全記憶処理（多層防御・二重防壁）
	const isEnc = typeof isStorageEncrypted === 'function' ? isStorageEncrypted() : false;
	const optinEl = document.getElementById('d-save-password-optin');
	const passEl = document.getElementById('d-pass');

	if (!isEnc) {
		// [A-2] 端末暗号化が無効な場合は、UIチェック状態に関わらずパスワードを強制除外（平文保存を完全防止）
		delete currentDistrict.savedFilePassword;
	} else if (optinEl && optinEl.checked && passEl && passEl.value) {
		currentDistrict.savedFilePassword = passEl.value;
	} else if (optinEl && !optinEl.checked) {
		delete currentDistrict.savedFilePassword;
	}

	return saveStorageData('kogai_district_v2', currentDistrict);
}

function saveRepLocal() {
	const topLabelEl = document.getElementById('seat-top-label');
	const bottomLabelEl = document.getElementById('seat-bottom-label');
	if (topLabelEl && bottomLabelEl) {
		repState.seatConfig.topLabel = topLabelEl.value;
		repState.seatConfig.bottomLabel = bottomLabelEl.value;
		const topBarEl = document.getElementById('seat-top-bar-view');
		const bottomBarEl = document.getElementById('seat-bottom-bar-view');
		if (topBarEl) topBarEl.textContent = repState.seatConfig.topLabel;
		if (bottomBarEl) bottomBarEl.textContent = repState.seatConfig.bottomLabel;
	}
	return saveStorageData('kogai_rep_v2', repState);
}

function saveNeighborLocal() {
	const dNameEl = document.getElementById('neighbor-district-name');
	if (dNameEl) neighborState.district = dNameEl.value.trim();
	return saveStorageData('kogai_neighbor_v2', neighborState);
}

function saveTransferLocal() {
	return saveStorageData('kogai_transfer_v2', transferState);
}

if (typeof module !== 'undefined' && module.exports) {
	global.currentDistrict = currentDistrict;
	global.repState = repState;
	global.neighborState = neighborState;
	global.transferState = transferState;
	global.saveDistrictLocal = saveDistrictLocal;
	global.saveRepLocal = saveRepLocal;
	global.saveNeighborLocal = saveNeighborLocal;
	global.saveTransferLocal = saveTransferLocal;
	module.exports = {
		get currentDistrict() { return global.currentDistrict !== undefined ? global.currentDistrict : currentDistrict; },
		set currentDistrict(v) { currentDistrict = v; global.currentDistrict = v; },
		get repState() { return global.repState !== undefined ? global.repState : repState; },
		set repState(v) { repState = v; global.repState = v; },
		get neighborState() { return global.neighborState !== undefined ? global.neighborState : neighborState; },
		set neighborState(v) { neighborState = v; global.neighborState = v; },
		get transferState() { return global.transferState !== undefined ? global.transferState : transferState; },
		set transferState(v) { transferState = v; global.transferState = v; },
		get saveDistrictLocal() { return global.saveDistrictLocal !== undefined ? global.saveDistrictLocal : saveDistrictLocal; },
		set saveDistrictLocal(fn) { global.saveDistrictLocal = fn; },
		get saveRepLocal() { return global.saveRepLocal !== undefined ? global.saveRepLocal : saveRepLocal; },
		set saveRepLocal(fn) { global.saveRepLocal = fn; },
		get saveNeighborLocal() { return global.saveNeighborLocal !== undefined ? global.saveNeighborLocal : saveNeighborLocal; },
		set saveNeighborLocal(fn) { global.saveNeighborLocal = fn; },
		get saveTransferLocal() { return global.saveTransferLocal !== undefined ? global.saveTransferLocal : saveTransferLocal; },
		set saveTransferLocal(fn) { global.saveTransferLocal = fn; }
	};
	global.state = module.exports;
}
