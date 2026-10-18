const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockDistrict, createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const seat = require('../../js/seat.js');
const rep = require('../../js/rep.js');
const print = require('../../js/print.js');

test('print: formatNameWithSama handles empty, plain names, and ruby kana', () => {
	const empty = print.formatNameWithSama("");
	assert(empty.includes('class="name-with-sama"'));
	assert(empty.includes('<span>様</span>'));

	const plain = print.formatNameWithSama("山田 太郎");
	assert(plain.includes("山田 太郎"));
	assert(plain.includes("<span>様</span>"));

	const ruby = print.formatNameWithSama("山田 太郎", "やまだ たろう");
	assert(ruby.includes("山田 太郎"));
	assert(ruby.includes("やまだ たろう"));
	assert(ruby.includes("<span>様</span>"));
});

test('print: buildTentCardPageHtml generates origami 4-panel layout with fold lines', () => {
	const html = print.buildTentCardPageHtml("1丁目 1班", "山田 花子", "やまだ はなこ", "校外役員");
	assert(html.includes("1丁目 1班"));
	assert(html.includes("山田 花子"));
	assert(html.includes("やまだ はなこ"));
	assert(html.includes("校外役員"));
	assert(html.includes("tent-center-fold"));
	assert(html.includes("折り線（山折り・名札の天）"));
});

test('print: buildStudentPageHtml handles privacy options, multi-han, and district-wide totals', () => {
	const d1 = createMockDistrict({
		district: "さくら地区",
		han: "A班",
		hanList: ["A班", "B班"],
		students: [
			{
				grade: "6",
				class: "1",
				han: "A班",
				lastName: "木村",
				firstName: "拓哉",
				lastNameKana: "きむら",
				firstNameKana: "たくや",
				address: "さくら1-1",
				tel: "090-1111-2222",
				leader: "班長",
				isOutOfDistrict: false
			}
		]
	});
	const d2 = createMockDistrict({
		district: "さくら地区",
		han: "B班",
		students: [
			{
				grade: "4",
				class: "2",
				han: "B班",
				lastName: "草彅",
				firstName: "剛",
				address: "さくら2-2",
				tel: "090-3333-4444",
				leader: "副班長",
				isOutOfDistrict: true
			}
		]
	});

	// With officer tel and email visible
	const optsFull = { includeOfficerTel: true, includeOfficerEmail: true };
	const htmlFull = print.buildStudentPageHtml(d1, optsFull, [d1, d2]);
	assert(htmlFull.includes("さくら地区"));
	assert(htmlFull.includes("木村 拓哉"));
	assert(htmlFull.includes("班長"));
	assert(htmlFull.includes("090-1111-2222"));
	assert(htmlFull.includes("yamada@example.com"));
	assert(htmlFull.includes("【さくら地区 A班 児童集計】"));

	// With officer tel and email hidden
	const optsHidden = { includeOfficerTel: false, includeOfficerEmail: false };
	const htmlHidden = print.buildStudentPageHtml(d1, optsHidden, [d1, d2]);
	assert(!htmlHidden.includes("yamada@example.com"));

	// Empty students fallback
	const dEmpty = createMockDistrict({ district: "空地区", han: "", students: [] });
	const htmlEmpty = print.buildStudentPageHtml(dEmpty, optsFull, [dEmpty]);
	assert(htmlEmpty.includes("該当児童なし"));
});

test('print: buildNeighborPageHtml handles empty and populated neighborhood roster', () => {
	const dPopulated = createMockDistrict({
		district: "星ヶ丘",
		neighborhood: [
			{ role: "自治会長", lastName: "星野", firstName: "源", lastNameKana: "ほしの", firstNameKana: "げん", address: "星ヶ丘1-1", tel: "03-1234-5678" }
		]
	});
	const htmlPop = print.buildNeighborPageHtml(dPopulated);
	assert(htmlPop.includes("星ヶ丘 自治会役員名簿"));
	assert(htmlPop.includes("自治会長"));
	assert(htmlPop.includes("星野 源"));
	assert(htmlPop.includes("ほしの げん"));
	assert(htmlPop.includes("03-1234-5678"));

	const dEmpty = createMockDistrict({ district: "空地区", neighborhood: [] });
	const htmlEmpty = print.buildNeighborPageHtml(dEmpty);
	assert(htmlEmpty.includes("該当なし"));
});

test('print: buildPtaOfficersRosterPageHtml formats PTA roster with contact info for core roles', () => {
	const d = createMockDistrict({
		district: "ひまわり地区",
		officers: [
			{ role: "代表", lastName: "日向", firstName: "葵", tel: "090-1234-5678", email: "aoi@example.com", childGrade: "5", name: "日向 葵" },
			{ role: "校外役員", lastName: "月島", firstName: "蛍", tel: "090-8765-4321", email: "kei@example.com", childGrade: "3", name: "月島 蛍" }
		]
	});
	const html = print.buildPtaOfficersRosterPageHtml([d]);
	assert(html.includes("PTA校外委員会 役員名簿（PTA本部・会員用）"));
	assert(html.includes("日向 葵"));
	assert(html.includes("090-1234-5678")); // 代表 has tel shown
	assert(html.includes("月島 蛍"));
});

test('print: buildSchoolOfficersRosterPageHtml formats school submission roster with district counts', () => {
	const d1 = createMockDistrict({
		district: "あけぼの地区",
		han: "1班",
		officers: [
			{
				role: "校外委員",
				lastName: "曙",
				firstName: "太郎",
				name: "曙 太郎",
				childLastName: "曙",
				childFirstName: "次郎",
				childName: "曙 次郎",
				childGrade: "6",
				childClass: "1",
				tel: "090-5555-5555",
				address: "あけぼの1-2-3"
			}
		],
		students: [
			{ lastName: "曙", firstName: "次郎", isOutOfDistrict: false }
		]
	});
	const html = print.buildSchoolOfficersRosterPageHtml([d1], [d1]);
	assert(html.includes("PTA校外委員会 役員名簿（学校提出用）"));
	assert(html.includes("あけぼの地区"));
	assert(html.includes("曙 太郎"));
	assert(html.includes("曙 次郎"));
	assert(html.includes("6-1"));
	assert(html.includes("090-5555-5555"));
	assert(html.includes("あけぼの1-2-3"));
});

test('print: buildEnvelopesPagesHtml formats 3x4 grid with child delivery note', () => {
	const d = createMockDistrict({
		district: "若葉地区",
		officers: [
			{
				role: "校外役員",
				lastName: "若林",
				firstName: "源三",
				name: "若林 源三",
				childGrade: "5",
				childClass: "2",
				childLastName: "若林",
				childFirstName: "翼",
				childName: "若林 翼"
			}
		]
	});
	const pages = print.buildEnvelopesPagesHtml([d]);
	assert.strictEqual(pages.length, 1);
	assert(pages[0].includes("address-grid"));
	assert(pages[0].includes("若林 源三"));
	assert(pages[0].includes("（おうちの人に、かならず、わたしてね）"));
	assert(pages[0].includes("若葉地区"));
});

test('print: buildSzTentCardsPagesHtml generates cards for all attendee groups', () => {
	const repData = createMockRepState();
	repData.districts[0].szNeighborChecks = { 0: true };
	const pages = print.buildSzTentCardsPagesHtml(repData.districts);
	assert(pages.length >= 1);
	assert(pages[0].includes("tent-card-page"));
});

test('print: buildSzAttendance sheets and seat chart generators', () => {
	const repData = createMockRepState();

	// Sheet 1: General Attendance
	const htmlAtt1 = print.buildSzAttendance1PageHtml(repData.districts);
	assert(htmlAtt1.includes("スクールゾーン協議会 出席簿（学校・PTA本部・校外委員会）"));
	assert(htmlAtt1.includes("PTA校外委員会"));

	// Sheet 2: District attendance
	const htmlAtt2 = print.buildSzAttendance2PageHtml(repData.districts);
	assert(htmlAtt2.includes("スクールゾーン協議会 出席簿（関係行政機関・自治会代表）"));
	assert(htmlAtt2.includes("自治会代表"));

	// Sheet 3: Blank Walk-in Attendance
	const htmlAtt3 = print.buildSzAttendance3BlankPageHtml();
	assert(htmlAtt3.includes("スクールゾーン協議会 出席簿（追加ご記入用）"));

	// Sheet 4: Seat Chart
	state.repState = repData;
	state.repState.seatConfig.cells["0,0"] = "OFF_緑が丘_0";
	const htmlSeats = print.buildSzSeatChartPageHtml();
	assert(htmlSeats.includes("スクールゾーン協議会 座席表"));
	assert(htmlSeats.includes("前方（演台・司会・スクリーン側）"));

	// Sheet 5: Master Roster
	const htmlMaster = print.buildSzMasterRosterPageHtml(repData.districts);
	assert(htmlMaster.includes("【校外代表控え】スクールゾーン協議会 関係者一覧"));
});

test('print: printSingleDistrictSelected validates selection and prints', () => {
	setupDomEnvironment();
	document.getElementById('d-name').value = "栄町";
	state.currentDistrict = createMockDistrict({ district: "栄町" });

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };
	let printed = false;
	global.window.print = () => { printed = true; };

	// 1. None checked
	document.getElementById('d-print-students').checked = false;
	document.getElementById('d-print-neighbors').checked = false;
	document.getElementById('d-print-school').checked = false;
	document.getElementById('d-print-pta').checked = false;
	print.printSingleDistrictSelected();
	assert(alertMsg.includes("印刷する帳票にチェックを入れてください"));
	assert.strictEqual(printed, false);

	// 2. All checked
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = true;
	document.getElementById('d-print-school').checked = true;
	document.getElementById('d-print-pta').checked = true;
	print.printSingleDistrictSelected();
	assert.strictEqual(printed, true);
	const printArea = document.getElementById('print-area');
	assert(printArea.innerHTML.includes("栄町"));
});

test('print: executeRepSelectedPrint validates checks and generates selected pages', () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	state.repState.districts.forEach(d => d.selectedForPrint = true);

	let alertMsg = "";
	global.alert = (msg) => { alertMsg = msg; };
	let printed = false;
	global.window.print = () => { printed = true; };

	// 1. None checked
	print.setRepPrintChecks(false);
	print.executeRepSelectedPrint();
	assert(alertMsg.includes("印刷する帳票にチェックを入れてください"));

	// 2. Check all possible types
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
	const container = document.createElement('div');
	chkTypes.forEach(t => {
		const el = document.createElement('input');
		el.type = 'checkbox';
		el.className = 'rep-print-chk';
		el.value = t;
		el.checked = true;
		container.appendChild(el);
	});
	document.body.appendChild(container);

	print.executeRepSelectedPrint();
	assert.strictEqual(printed, true);
	const printArea = document.getElementById('print-area');
	assert(printArea.innerHTML.length > 500);

	// 3. No target districts selected
	state.repState.districts.forEach(d => d.selectedForPrint = false);
	container.innerHTML = `
		<input type="checkbox" class="rep-print-chk" value="all_students" checked>
	`;
	printed = false;
	alertMsg = "";
	print.executeRepSelectedPrint();
	assert(alertMsg.includes("印刷対象のデータがありません"));
	assert.strictEqual(printed, false);
});

test('print: additional branch coverage tests for tent card, alias, empty officers, and seat customText', () => {
	setupDomEnvironment();

	// 1. buildPtaOfficersRosterPageHtml
	const d = createMockDistrict({ district: "エイリアス地区" });
	const aliasHtml = print.buildPtaOfficersRosterPageHtml([d]);
	assert(aliasHtml.includes("PTA校外委員会 役員名簿（PTA本部・会員用）"));

	// 2. buildTentCardPageHtml with role prefix in mainName
	const tentWithPrefix = print.buildTentCardPageHtml("1丁目", "会長 山田太郎", "やまだ たろう", "");
	assert(tentWithPrefix.includes('<span class="tent-role">会長</span>'));
	assert(tentWithPrefix.includes('<span class="tent-name">山田太郎</span>'));

	// 3. buildStudentPageHtml without officers
	const dNoOff = createMockDistrict({ district: "無役員地区", officers: [], officer: null });
	const htmlNoOff = print.buildStudentPageHtml(dNoOff, { includeOfficerTel: true, includeOfficerEmail: true }, [dNoOff]);
	assert(htmlNoOff.includes("<strong>担当校外委員：</strong>未設定"));

	// 4. buildSzSeatChartPageHtml with customText cell
	state.repState = createMockRepState();
	state.repState.seatConfig.cells["0_0"] = { refKey: "", customText: "来賓特設席" };
	const htmlCustomSeat = print.buildSzSeatChartPageHtml();
	assert(htmlCustomSeat.includes("来賓特設席"));
});

test('print: exhaustive branch coverage for print options, rosters, and cards', () => {
	setupDomEnvironment();

	// 1. setRepPrintChecks(false)
	const container = document.getElementById('rep-print-items');
	container.innerHTML = `
		<input type="checkbox" class="rep-print-chk" value="officers_pta" checked>
		<input type="checkbox" class="rep-print-chk" value="reg_tent" checked>
	`;
	print.setRepPrintChecks(false);
	assert.strictEqual(container.querySelectorAll('.rep-print-chk:checked').length, 0);
	print.setRepPrintChecks(true);
	assert.strictEqual(container.querySelectorAll('.rep-print-chk:checked').length, 2);

	// 2. printSingleDistrictSelected with options tel=false, email=false, and missing checkboxes
	state.currentDistrict = createMockDistrict({ district: "オプション地区" });
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = false;
	document.getElementById('d-print-school').checked = false;
	document.getElementById('d-print-pta').checked = false;
	document.getElementById('d-opt-officer-tel').checked = false;
	document.getElementById('d-opt-officer-email').checked = false;

	let printed = false;
	window.print = () => { printed = true; };
	print.printSingleDistrictSelected();
	assert.strictEqual(printed, true);

	// 3. buildSchoolOfficersRosterPageHtml edge cases: zero officers, missing child info, no kana
	const dZeroOff = createMockDistrict({ district: "無役員地区", officers: [] });
	const schoolHtmlZero = print.buildSchoolOfficersRosterPageHtml([dZeroOff]);
	assert(schoolHtmlZero.includes("該当データなし"));

	const dOffEdge = createMockDistrict({
		district: "エッジ地区",
		han: "",
		officers: [
			{
				role: "校外委員",
				lastName: "木村",
				firstName: "拓也",
				childLastName: "木村",
				childFirstName: "拓海",
				childLastNameKana: "", // no child kana
				childFirstNameKana: "",
				childGrade: "4",
				childClass: "", // empty class -> childGrade but no class
				tel: "", // empty tel -> '-'
				address: "", // empty address -> '-'
				han: "" // empty han -> hanName is empty
			},
			{
				role: "校外委員",
				lastName: "中居",
				firstName: "正広",
				childLastName: "", // no child at all
				childFirstName: "",
				childName: "",
				childGrade: "", // no grade -> '-'
				tel: "090-9999-9999",
				address: "エッジ1-1",
				han: "北班"
			}
		],
		students: [
			{ lastName: "木村", firstName: "拓海", grade: "4", han: "北班", address: "エッジ1-1" }
		]
	});
	const schoolHtmlEdge = print.buildSchoolOfficersRosterPageHtml([dOffEdge]);
	assert(schoolHtmlEdge.includes("木村 拓海"));
	assert(schoolHtmlEdge.includes("4-"));
	assert(schoolHtmlEdge.includes("エッジ地区"));

	// 4. buildPtaOfficersRosterPageHtml edge cases: zero officers, officers without role, sanyaku without tel/email, no sanyaku
	const ptaZero = print.buildPtaOfficersRosterPageHtml([dZeroOff]);
	assert(ptaZero.includes("該当役員なし"));

	const dNoSanyaku = createMockDistrict({
		district: "一般役員のみ地区",
		han: "",
		officers: [
			{
				role: "", // empty role -> defaults to '校外委員'
				lastName: "一般",
				firstName: "太郎",
				childGrade: "", // empty childGrade -> '-'
				tel: "090-0000",
				han: "" // empty han
			}
		]
	});
	const ptaNoSanyaku = print.buildPtaOfficersRosterPageHtml([dNoSanyaku]);
	assert(ptaNoSanyaku.includes("校外委員"));
	assert(ptaNoSanyaku.includes("代表三役が未登録です"));

	const dSanyakuNoContact = createMockDistrict({
		district: "連絡先未設定三役地区",
		officers: [
			{
				role: "代表",
				lastName: "三役",
				firstName: "無連絡",
				tel: "", // empty -> '-'
				email: "" // empty -> '-'
			}
		]
	});
	const ptaSanyakuNoContact = print.buildPtaOfficersRosterPageHtml([dSanyakuNoContact]);
	assert(ptaSanyakuNoContact.includes("三役 無連絡"));

	// 5. buildSzTentCardsPagesHtml edge cases: officer without han, external without org or role
	state.repState = createMockRepState();
	state.repState.szExternals = [
		{ attend: true, category: "外部", org: "", role: "", lastName: "無役職", firstName: "外部" }
	];
	const dTentEdge = createMockDistrict({
		district: "名札エッジ地区",
		han: "",
		officers: [
			{ lastName: "名札", firstName: "役員", role: "", han: "" } // empty role, empty han
		],
		neighborhood: [
			{ role: "", lastName: "自治", firstName: "無役職" }
		],
		szNeighborChecks: { 0: true }
	});
	const szTentHtmls = print.buildSzTentCardsPagesHtml([dTentEdge]);
	assert.strictEqual(szTentHtmls.length, 3);
	assert(szTentHtmls[0].includes("校外委員（名札エッジ地区）"));

	// 6. buildSzMasterRosterPageHtml external without kana
	state.repState.szExternals.push({
		attend: false,
		category: "自治体",
		org: "区役所",
		role: "係長",
		lastName: "区役所",
		firstName: "担当",
		lastNameKana: "", // no kana
		firstNameKana: "",
		contact: "03-0000-0000"
	});
	const masterHtml = print.buildSzMasterRosterPageHtml([dTentEdge]);
	assert(masterHtml.includes("区役所 担当"));
	assert(masterHtml.includes("欠席・対象外"));

	// 7. executeRepSelectedPrint with options tel=false, email=false, and reg_tent without role/han
	state.repState.districts = [dTentEdge];
	dTentEdge.selectedForPrint = true;
	container.innerHTML = `
		<input type="checkbox" class="rep-print-chk" value="reg_tent" checked>
	`;
	document.getElementById('rep-opt-officer-tel').checked = false;
	document.getElementById('rep-opt-officer-email').checked = false;
	printed = false;
	print.executeRepSelectedPrint();
	assert.strictEqual(printed, true);

	// 8. buildStudentPageHtml edge cases: unnamed district, unnamed officer, grade without class
	const dStudentEdge = {
		district: "", // unnamed
		han: "",
		officers: [
			{ role: "", lastName: "", firstName: "", tel: "", email: "" } // unnamed officer, empty role, empty tel/email
		],
		students: [
			{ lastName: "学年のみ", firstName: "太郎", grade: "3", class: "", han: "", isOutOfDistrict: false }
		]
	};
	const studentHtmlEdge = print.buildStudentPageHtml(dStudentEdge, { includeOfficerTel: true, includeOfficerEmail: true }, [dStudentEdge]);
	assert(studentHtmlEdge.includes("地区名：</strong>未設定"));
	assert(studentHtmlEdge.includes("担当校外委員：</strong>未設定"));
	assert(studentHtmlEdge.includes(">3</td>"));

	// 9. buildNeighborPageHtml without officers
	const dNeighborNoOff = { district: "役員不在地区", neighborhood: [], officers: [] };
	const neighborNoOffHtml = print.buildNeighborPageHtml(dNeighborNoOff);
	assert(neighborNoOffHtml.includes("担当校外委員：未設定"));

	// 10. buildSzSeatChartPageHtml edge cases: empty ref.name, FAC_ with unknown refKey, missing cell in map
	state.repState = createMockRepState();
	state.repState.seatConfig.rows = 2;
	state.repState.seatConfig.cols = 2;
	state.repState.seatConfig.cells = {
		"0_0": { refKey: "FAC_UNKNOWN", customText: "" }, // FAC_ with undefined ref and empty customText
		"0_1": { refKey: "EXT_0", customText: "" } // ref exists but no custom note
	};
	// Empty cell at 1_0 and 1_1
	state.repState.szExternals = [
		{ attend: true, category: "来賓", org: "来賓会", role: "来賓", lastName: "", firstName: "", name: "" }
	];
	const seatHtmlEdge = print.buildSzSeatChartPageHtml();
	assert(seatHtmlEdge.includes("（ご出席者 様）"));
	assert(seatHtmlEdge.includes("is-facility"));
});

test('print: dynamic title synchronization and separate PDF print pipeline', () => {
	setupDomEnvironment();
	const origTitle = 'テストアプリ初期タイトル';
	document.title = origTitle;
	let titleHistory = [];
	let printCount = 0;

	global.print = () => {
		printCount++;
		titleHistory.push(document.title);
	};
	global.window.print = global.print;

	state.currentDistrict = createMockDistrict({
		district: '青葉台地区',
		students: [{ lastName: 'テスト', firstName: '太郎' }],
		neighborhood: [{ role: '会長', lastName: '自治', firstName: '一郎' }],
		officers: [{ role: '委員長', lastName: '校外', firstName: '花子' }]
	});
	document.getElementById('d-name').value = '青葉台地区';

	// 1. printSingleDistrictSelected with single check (students only)
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = false;
	document.getElementById('d-print-school').checked = false;
	document.getElementById('d-print-pta').checked = false;

	print.printSingleDistrictSelected();
	assert.strictEqual(printCount, 1);
	assert.strictEqual(titleHistory[0], '児童名簿_青葉台地区');
	assert.strictEqual(document.title, origTitle, 'document.title should be restored');

	// 2. printSingleDistrictSelected with multiple checks
	titleHistory = [];
	printCount = 0;
	document.getElementById('d-print-neighbors').checked = true;

	print.printSingleDistrictSelected();
	assert.strictEqual(printCount, 1);
	assert.strictEqual(titleHistory[0], '自地区帳票一括_青葉台地区');
	assert.strictEqual(document.title, origTitle);

	// 3. printSingleDistrictSeparately with no checks
	let alertMsg = '';
	global.alert = (msg) => { alertMsg = msg; };
	document.getElementById('d-print-students').checked = false;
	document.getElementById('d-print-neighbors').checked = false;

	print.printSingleDistrictSeparately();
	assert(alertMsg.includes('チェックを入れてください'));

	// 4. printSingleDistrictSeparately with all 4 checks (students, neighbors, school, pta)
	titleHistory = [];
	printCount = 0;
	document.getElementById('d-print-students').checked = true;
	document.getElementById('d-print-neighbors').checked = true;
	document.getElementById('d-print-school').checked = true;
	document.getElementById('d-print-pta').checked = true;

	print.printSingleDistrictSeparately();
	assert.strictEqual(printCount, 4);
	assert.strictEqual(titleHistory[0], '児童名簿_青葉台地区');
	assert.strictEqual(titleHistory[1], '自治会役員名簿_青葉台地区');
	assert.strictEqual(titleHistory[2], '校外役員名簿_学校用_青葉台地区');
	assert.strictEqual(titleHistory[3], '校外役員名簿_PTA用_青葉台地区');
	assert.strictEqual(document.title, origTitle);

	// 5. executeRepSelectedPrint with single check
	titleHistory = [];
	printCount = 0;
	state.repState = createMockRepState();
	state.repState.districts[0].selectedForPrint = true;
	const container = document.getElementById('rep-print-checkboxes');
	container.innerHTML = '<input type="checkbox" class="rep-print-chk" value="officers_pta" checked>';

	print.executeRepSelectedPrint();
	assert.strictEqual(printCount, 1);
	assert.strictEqual(titleHistory[0], 'PTA総会・校外役員名簿');
	assert.strictEqual(document.title, origTitle);
});
