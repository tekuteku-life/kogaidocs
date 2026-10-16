const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const hata = require('../../js/hata.js');
const seat = require('../../js/seat.js');
const rep = require('../../js/rep.js');
const district = require('../../js/district.js');
const print = require('../../js/print.js');

test('integration: end-to-end print pipeline (single district & representative bulk 12 document types)', () => {
	setupDomEnvironment();

	// 1. Single District Selected Print Pipeline
	document.getElementById('d-name').value = "代々木地区";
	state.currentDistrict = createMockDistrict({
		district: "代々木地区",
		han: "東班",
		hanList: ["東班", "西班"],
		officers: [
			{
				role: "代表",
				lastName: "野村",
				firstName: "萬斎",
				lastNameKana: "のむら",
				firstNameKana: "まんさい",
				tel: "090-9999-9999",
				email: "nomura@example.com",
				childGrade: "6",
				childClass: "1",
				childLastName: "野村",
				childFirstName: "裕基",
				childLastNameKana: "のむら",
				childFirstNameKana: "ゆうき"
			}
		],
		students: [
			{
				grade: "6",
				class: "1",
				han: "東班",
				lastName: "野村",
				firstName: "裕基",
				address: "代々木1-1-1",
				tel: "090-9999-9999",
				leader: "班長",
				isOutOfDistrict: false
			},
			{
				grade: "4",
				class: "2",
				han: "東班",
				lastName: "狂言",
				firstName: "太郎",
				address: "代々木1-2-3",
				tel: "03-3333-3333",
				leader: "副班長",
				isOutOfDistrict: true
			}
		],
		neighborhood: [
			{ role: "自治会長", lastName: "能楽", firstName: "堂主", address: "代々木1-5", tel: "03-8888-8888" }
		]
	});
	district.renderDistrictForm();

	// Configure print checkboxes and options
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = true;
	document.getElementById('d-print-school').checked = true;
	document.getElementById('d-print-pta').checked = true;
	document.getElementById('d-opt-officer-tel').checked = true;
	document.getElementById('d-opt-officer-email').checked = false; // Hide email

	let printCalled = false;
	global.window.print = () => { printCalled = true; };

	print.printSingleDistrictSelected();

	assert.strictEqual(printCalled, true);
	const printArea = document.getElementById('print-area');
	const singleHtml = printArea.innerHTML;

	// Verify Student Roster HTML
	assert(singleHtml.includes("児童名簿"));
	assert(singleHtml.includes("代々木地区"));
	assert(singleHtml.includes("東班"));
	assert(singleHtml.includes("090-9999-9999")); // Tel shown
	const studentHtmlOnly = print.buildStudentPageHtml(state.currentDistrict, { includeOfficerTel: true, includeOfficerEmail: false }, [state.currentDistrict]);
	assert(!studentHtmlOnly.includes("nomura@example.com")); // Email hidden in student page
	assert(singleHtml.includes("nomura@example.com")); // But shown in PTA roster for 代表
	assert(singleHtml.includes("野村 裕基"));
	assert(singleHtml.includes("学区外"));
	assert(singleHtml.includes("【代々木地区 東班 児童集計】"));

	// Verify Neighbor Roster HTML
	assert(singleHtml.includes("代々木地区 自治会役員名簿"));
	assert(singleHtml.includes("能楽 堂主"));

	// Verify School Officer Roster HTML
	assert(singleHtml.includes("PTA校外委員会 役員名簿（学校提出用）"));
	assert(singleHtml.includes("野村 萬斎"));
	assert(singleHtml.includes("野村 裕基"));
	assert(singleHtml.includes("6-1"));

	// Verify PTA Officer Roster HTML
	assert(singleHtml.includes("PTA校外委員会 役員名簿（PTA本部・会員用）"));

	// 2. Representative Bulk Print Pipeline
	printCalled = false;
	state.repState = createMockRepState();
	state.repState.districts.forEach(d => d.selectedForPrint = true);

	// Create checkboxes for all 12 document types
	const chkTypes = [
		'officers_pta',
		'officers_school',
		'reg_tent',
		'envelopes',
		'all_students',
		'all_neighbors',
		'sz_tent',
		'sz_att_1',
		'sz_att_2',
		'sz_att_3',
		'sz_seats',
		'sz_master'
	];
	const chkContainer = document.createElement('div');
	chkTypes.forEach(t => {
		const el = document.createElement('input');
		el.type = 'checkbox';
		el.className = 'rep-print-chk';
		el.value = t;
		el.checked = true;
		chkContainer.appendChild(el);
	});
	document.body.appendChild(chkContainer);

	print.executeRepSelectedPrint();

	assert.strictEqual(printCalled, true);
	const bulkHtml = printArea.innerHTML;

	// Verify all document outputs
	assert(bulkHtml.includes("PTA校外委員会 役員名簿（PTA本部・会員用）"));
	assert(bulkHtml.includes("PTA校外委員会 役員名簿（学校提出用）"));
	assert(bulkHtml.includes("tent-card-page"));
	assert(bulkHtml.includes("折り線（山折り・名札の天）")); // Origami fold line
	assert(bulkHtml.includes("address-grid")); // 3x4 envelopes
	assert(bulkHtml.includes("（おうちの人に、かならず、わたしてね）"));
	assert(bulkHtml.includes("児童名簿"));
	assert(bulkHtml.includes("自治会役員名簿"));
	assert(bulkHtml.includes("スクールゾーン協議会 出席簿（学校・PTA本部・校外委員会）"));
	assert(bulkHtml.includes("スクールゾーン協議会 出席簿（関係行政機関・自治会代表）"));
	assert(bulkHtml.includes("スクールゾーン協議会 出席簿（追加ご記入用）"));
	assert(bulkHtml.includes("スクールゾーン協議会 座席表"));
	assert(bulkHtml.includes("【校外代表控え】スクールゾーン協議会 関係者一覧"));
});
