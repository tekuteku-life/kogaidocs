/* =========================================================================
   アプリケーション初期化・タブ切替
========================================================================= */

function switchTab(mode) {
	document.getElementById('tab-district').style.display = mode === 'district' ? 'block' : 'none';
	document.getElementById('tab-rep').style.display = mode === 'rep' ? 'block' : 'none';
	const btns = document.querySelectorAll('.tab-btn');
	if (btns.length >= 2) {
		btns[0].classList.toggle('active', mode === 'district');
		btns[1].classList.toggle('active', mode === 'rep');
	}
}

window.addEventListener('DOMContentLoaded', () => {
	const savedD = localStorage.getItem('kogai_district_v2');
	if (savedD) {
		try { currentDistrict = JSON.parse(savedD); } catch(e) {}
	}
	if (!currentDistrict.officers || !Array.isArray(currentDistrict.officers) || currentDistrict.officers.length === 0) {
		currentDistrict.officers = [currentDistrict.officer || {}];
	}
	currentDistrict.officers.forEach(off => {
		normalizeOfficerChildNames(off);
		normalizeNameFields(off);
	});
	currentDistrict.officer = currentDistrict.officers[0];

	if (currentDistrict.han === undefined) {
		currentDistrict.han = "";
	}
	if (!currentDistrict.hanList || !Array.isArray(currentDistrict.hanList)) {
		currentDistrict.hanList = getDistrictHanList(currentDistrict);
	}

	if (!currentDistrict.neighborhood || currentDistrict.neighborhood.length === 0) {
		currentDistrict.neighborhood = [{ role: "会長", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "" }];
	} else {
		currentDistrict.neighborhood.forEach(normalizeNameFields);
	}

	if (!currentDistrict.students || currentDistrict.students.length === 0) {
		currentDistrict.students = [{ grade: "6", class: "1", han: currentDistrict.han || "", lastName: "", firstName: "", lastNameKana: "", firstNameKana: "", address: "", tel: "", leader: "", isOutOfDistrict: false }];
	} else {
		currentDistrict.students.forEach(s => {
			normalizeNameFields(s);
			if (s.han === undefined) s.han = currentDistrict.han || "";
			if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
		});
	}

	const savedR = localStorage.getItem('kogai_rep_v2');
	if (savedR) {
		try { repState = JSON.parse(savedR); } catch(e) {}
	}
	if (repState.districts && Array.isArray(repState.districts)) {
		repState.districts.forEach(d => {
			if (d.han === undefined) d.han = "";
			if (d.hanList === undefined) d.hanList = getDistrictHanList(d);
			if (!d.officers || !Array.isArray(d.officers) || d.officers.length === 0) {
				d.officers = [d.officer || {}];
			}
			d.officers.forEach(off => {
				normalizeOfficerChildNames(off);
				normalizeNameFields(off);
			});
			d.officer = d.officers[0];
			(d.neighborhood || []).forEach(normalizeNameFields);
			(d.students || []).forEach(s => {
				normalizeNameFields(s);
				if (s.han === undefined) s.han = d.han || "";
				if (s.isOutOfDistrict === undefined) s.isOutOfDistrict = false;
			});
		});
	}
	if (repState.szExternals && Array.isArray(repState.szExternals)) {
		repState.szExternals.forEach(normalizeNameFields);
	}

	renderDistrictForm();
	renderRepAll();
	setAllCardsCollapse(true, 'tab-district');
	setAllCardsCollapse(true, 'tab-rep');
});
