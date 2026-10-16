/* =========================================================================
   グローバル状態データ & ローカル保存
========================================================================= */

let currentDistrict = {
	district: "",
	han: "",
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
	officer: {}, // 旧バージョン互換用
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

function saveDistrictLocal() {
	const dNameEl = document.getElementById('d-name');
	if (!dNameEl) return;
	currentDistrict.district = dNameEl.value.trim();
	const dHanEl = document.getElementById('d-han');
	currentDistrict.han = dHanEl ? dHanEl.value.trim() : "";

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
			obj.name = getFullName(obj);
			obj.childName = getChildFullName(obj);
			newOfficers.push(obj);
		});
		currentDistrict.officers = newOfficers;
		currentDistrict.officer = newOfficers[0] || {};
	} else if (document.getElementById('o-last-name')) {
		const oLastName = document.getElementById('o-last-name').value.trim();
		const oFirstName = document.getElementById('o-first-name') ? document.getElementById('o-first-name').value.trim() : "";
		const oLastKana = document.getElementById('o-last-kana') ? document.getElementById('o-last-kana').value.trim() : "";
		const oFirstKana = document.getElementById('o-first-kana') ? document.getElementById('o-first-kana').value.trim() : "";
		const oAddress = document.getElementById('o-address') ? document.getElementById('o-address').value.trim() : "";

		const oChildLastName = document.getElementById('o-c-last-name') ? document.getElementById('o-c-last-name').value.trim() : "";
		const oChildFirstName = document.getElementById('o-c-first-name') ? document.getElementById('o-c-first-name').value.trim() : "";
		const oChildLastKana = document.getElementById('o-c-last-kana') ? document.getElementById('o-c-last-kana').value.trim() : "";
		const oChildFirstKana = document.getElementById('o-c-first-kana') ? document.getElementById('o-c-first-kana').value.trim() : "";

		const officerObj = {
			lastName: oLastName,
			firstName: oFirstName,
			lastNameKana: oLastKana,
			firstNameKana: oFirstKana,
			role: document.getElementById('o-role') ? document.getElementById('o-role').value : "",
			han: document.getElementById('o-han') ? document.getElementById('o-han').value.trim() : "",
			tel: document.getElementById('o-tel') ? document.getElementById('o-tel').value.trim() : "",
			email: document.getElementById('o-email') ? document.getElementById('o-email').value.trim() : "",
			address: oAddress,
			childGrade: document.getElementById('o-c-grade') ? document.getElementById('o-c-grade').value : "",
			childClass: document.getElementById('o-c-class') ? document.getElementById('o-c-class').value.trim() : "",
			childLastName: oChildLastName,
			childFirstName: oChildFirstName,
			childLastNameKana: oChildLastKana,
			childFirstNameKana: oChildFirstKana
		};
		officerObj.name = getFullName(officerObj);
		officerObj.childName = getChildFullName(officerObj);
		currentDistrict.officers = [officerObj];
		currentDistrict.officer = officerObj;
	}

	localStorage.setItem('kogai_district_v2', JSON.stringify(currentDistrict));
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
	localStorage.setItem('kogai_rep_v2', JSON.stringify(repState));
}
