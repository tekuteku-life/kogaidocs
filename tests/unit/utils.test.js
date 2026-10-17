const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');

test('utils: esc() handles all types of input and escapes properly', () => {
	assert.strictEqual(utils.esc(null), "");
	assert.strictEqual(utils.esc(undefined), "");
	assert.strictEqual(utils.esc(123), "123");
	assert.strictEqual(utils.esc("hello"), "hello");
	assert.strictEqual(utils.esc("A & B < C > D \"E\" 'F'"), 'A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;');
});

test('utils: getFullName() and getFullNameKana() handle legacy and modern names', () => {
	assert.strictEqual(utils.getFullName(null), "");
	assert.strictEqual(utils.getFullName({ lastName: "山田", firstName: "太郎" }), "山田 太郎");
	assert.strictEqual(utils.getFullName({ lastName: "山田", firstName: "" }), "山田");
	assert.strictEqual(utils.getFullName({ lastName: "", firstName: "太郎" }), "太郎");
	assert.strictEqual(utils.getFullName({ name: "鈴木 次郎" }), "鈴木 次郎");
	assert.strictEqual(utils.getFullName({}), "");

	assert.strictEqual(utils.getFullNameKana(null), "");
	assert.strictEqual(utils.getFullNameKana({ lastNameKana: "やまだ", firstNameKana: "たろう" }), "やまだ たろう");
	assert.strictEqual(utils.getFullNameKana({ lastNameKana: "やまだ", firstNameKana: "" }), "やまだ");
	assert.strictEqual(utils.getFullNameKana({ lastNameKana: "", firstNameKana: "たろう" }), "たろう");
	assert.strictEqual(utils.getFullNameKana({ kana: "すずき じろう" }), "すずき じろう");
	assert.strictEqual(utils.getFullNameKana({}), "");
});

test('utils: getChildFullName() and getChildFullNameKana() handle officer children', () => {
	assert.strictEqual(utils.getChildFullName(null), "");
	assert.strictEqual(utils.getChildFullName({ childLastName: "佐藤", childFirstName: "花子" }), "佐藤 花子");
	assert.strictEqual(utils.getChildFullName({ childLastName: "佐藤", childFirstName: "" }), "佐藤");
	assert.strictEqual(utils.getChildFullName({ childLastName: "", childFirstName: "花子" }), "花子");
	assert.strictEqual(utils.getChildFullName({ childName: "高橋 健" }), "高橋 健");
	assert.strictEqual(utils.getChildFullName({}), "");

	assert.strictEqual(utils.getChildFullNameKana(null), "");
	assert.strictEqual(utils.getChildFullNameKana({ childLastNameKana: "さとう", childFirstNameKana: "はなこ" }), "さとう はなこ");
	assert.strictEqual(utils.getChildFullNameKana({ childLastNameKana: "さとう", childFirstNameKana: "" }), "さとう");
	assert.strictEqual(utils.getChildFullNameKana({ childLastNameKana: "", childFirstNameKana: "はなこ" }), "はなこ");
	assert.strictEqual(utils.getChildFullNameKana({ childKana: "たかはし けん" }), "たかはし けん");
	assert.strictEqual(utils.getChildFullNameKana({}), "");
});

test('utils: normalizeNameFields() correctly normalizes name, lastName, and firstName', () => {
	utils.normalizeNameFields(null); // No error

	const item1 = { name: "山田 太郎" };
	utils.normalizeNameFields(item1);
	assert.strictEqual(item1.lastName, "山田");
	assert.strictEqual(item1.firstName, "太郎");
	assert.strictEqual(item1.lastNameKana, "");
	assert.strictEqual(item1.firstNameKana, "");

	const item2 = { name: "単一名前" };
	utils.normalizeNameFields(item2);
	assert.strictEqual(item2.lastName, "単一名前");
	assert.strictEqual(item2.firstName, "");

	const item3 = {};
	utils.normalizeNameFields(item3);
	assert.strictEqual(item3.lastName, "");
	assert.strictEqual(item3.firstName, "");

	const item4 = { lastName: "田中", firstName: "一郎" };
	utils.normalizeNameFields(item4);
	assert.strictEqual(item4.lastName, "田中");
	assert.strictEqual(item4.firstName, "一郎");
});

test('utils: normalizeOfficerChildNames() normalizes childName, address, and han', () => {
	utils.normalizeOfficerChildNames(null);

	const off1 = { childName: "鈴木 次郎" };
	utils.normalizeOfficerChildNames(off1);
	assert.strictEqual(off1.childLastName, "鈴木");
	assert.strictEqual(off1.childFirstName, "次郎");
	assert.strictEqual(off1.address, "");
	assert.strictEqual(off1.han, "");
	assert.strictEqual(off1.childLastNameKana, "");
	assert.strictEqual(off1.childFirstNameKana, "");

	const off2 = {};
	utils.normalizeOfficerChildNames(off2);
	assert.strictEqual(off2.childLastName, "");
	assert.strictEqual(off2.childFirstName, "");

	const off3 = { childLastName: "佐藤", childFirstName: "健", address: "1-1", han: "1班" };
	utils.normalizeOfficerChildNames(off3);
	assert.strictEqual(off3.childLastName, "佐藤");
	assert.strictEqual(off3.childFirstName, "健");
	assert.strictEqual(off3.address, "1-1");
	assert.strictEqual(off3.han, "1班");
});

test('utils: getDistrictHanList() gathers and deduplicates han names', () => {
	const d1 = {
		hanList: ["1班", "2班", ""]
	};
	assert.deepStrictEqual(utils.getDistrictHanList(d1), ["1班", "2班"]);

	const d2 = {
		han: "A班",
		officers: [
			{ han: "A班" },
			{ han: "B班" },
			{ han: "全班" }
		],
		students: [
			{ han: "A班" },
			{ han: "B班" },
			{ han: "C班" }
		]
	};
	assert.deepStrictEqual(utils.getDistrictHanList(d2), ["A班", "B班", "C班"]);

	// Empty fallback
	global.currentDistrict = { hanList: ["X班"] };
	assert.deepStrictEqual(utils.getDistrictHanList(null), ["X班"]);
});

test('utils: getGradeCounts() and formatGradeCounts() calculate grades and out-of-district', () => {
	assert.deepStrictEqual(utils.getGradeCounts(null), { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, total: 0, outOfDistrict: 0 });

	const students = [
		{ grade: "6", lastName: "A", isOutOfDistrict: false },
		{ grade: "6", firstName: "B", isOutOfDistrict: true },
		{ grade: "5", name: "C", isOutOfDistrict: false },
		{ grade: "4", address: "D", isOutOfDistrict: false },
		{ grade: "3", lastName: "E", isOutOfDistrict: false },
		{ grade: "2", lastName: "F", isOutOfDistrict: true },
		{ grade: "1", lastName: "G", isOutOfDistrict: false },
		{ grade: "99", lastName: "Unknown" }, // Unknown grade
		{ grade: "6" } // Blank student should be skipped
	];

	const counts = utils.getGradeCounts(students);
	assert.strictEqual(counts[6], 2);
	assert.strictEqual(counts[5], 1);
	assert.strictEqual(counts[4], 1);
	assert.strictEqual(counts[3], 1);
	assert.strictEqual(counts[2], 1);
	assert.strictEqual(counts[1], 1);
	assert.strictEqual(counts.total, 7);
	assert.strictEqual(counts.outOfDistrict, 2);

	const formatted = utils.formatGradeCounts(counts);
	assert(formatted.includes("6年：2名"));
	assert(formatted.includes("【合計：7名（うち学区外: 2名）】"));

	const noOutCounts = { ...counts, outOfDistrict: 0 };
	const formattedNoOut = utils.formatGradeCounts(noOutCounts);
	assert(formattedNoOut.includes("【合計：7名】"));
	assert(!formattedNoOut.includes("うち学区外"));
});

test('utils: downloadTextFile() triggers download', () => {
	let clicked = false;
	const origCreateElement = document.createElement;
	document.createElement = (tag) => {
		const el = origCreateElement.call(document, tag);
		if (tag === 'a') {
			el.click = () => { clicked = true; };
		}
		return el;
	};

	utils.downloadTextFile("test content", "test.txt");
	assert.strictEqual(clicked, true);
	document.createElement = origCreateElement;
});

test('utils: validatePassword() enforces security rules', () => {
	assert.strictEqual(utils.validatePassword(null).valid, false);
	assert.strictEqual(utils.validatePassword("").valid, false);
	assert.strictEqual(utils.validatePassword("   ").valid, false);
	assert.strictEqual(utils.validatePassword("short123").valid, false);
	assert(utils.validatePassword("short123").message.includes("最低12文字"));

	// Non-ASCII or whitespace
	assert.strictEqual(utils.validatePassword("pass with space 123").valid, false);
	assert.strictEqual(utils.validatePassword("パスワード12345678").valid, false);

	// Valid password
	const valid = utils.validatePassword("Pass12345678#$");
	assert.strictEqual(valid.valid, true);
	assert.strictEqual(valid.message, "");
});

test('utils: togglePasswordVisibility() toggles password input type and button text', () => {
	const input = document.getElementById('test-pass-toggle');
	input.type = 'password';
	const btn = document.createElement('button');

	utils.togglePasswordVisibility('test-pass-toggle', btn);
	assert.strictEqual(input.type, 'text');
	assert.strictEqual(btn.textContent, '🙈');

	utils.togglePasswordVisibility('test-pass-toggle', btn);
	assert.strictEqual(input.type, 'password');
	assert.strictEqual(btn.textContent, '👁️');

	// Missing input
	utils.togglePasswordVisibility('nonexistent', btn);
});

test('utils: compareStudents() correctly implements multi-tier sorting', () => {
	const s1 = { han: "1班", leader: "班長", grade: "6", address: "1-1", class: "1", lastNameKana: "あ" };
	const s2 = { han: "2班", leader: "班長", grade: "6", address: "1-1", class: "1", lastNameKana: "あ" };
	assert(utils.compareStudents(s1, s2) < 0, "1班 should precede 2班");

	// Leader rank: 班長(1) vs 副班長(2) vs その他(3)
	const sLeader = { han: "1班", leader: "班長", grade: "5" };
	const sSubLeader = { han: "1班", leader: "副班長", grade: "6" };
	const sMember = { han: "1班", leader: "", grade: "6" };
	assert(utils.compareStudents(sLeader, sSubLeader) < 0, "班長 precedes 副班長 even with lower grade");
	assert(utils.compareStudents(sSubLeader, sMember) < 0, "副班長 precedes normal member");

	// Grade (descending: 6 -> 1)
	const sG6 = { han: "1班", grade: "6", address: "1-1" };
	const sG5 = { han: "1班", grade: "5", address: "1-1" };
	assert(utils.compareStudents(sG6, sG5) < 0, "Grade 6 precedes Grade 5");

	// Address (ascending natural sort)
	const sAddr1 = { han: "1班", grade: "6", address: "1-2" };
	const sAddr2 = { han: "1班", grade: "6", address: "1-10" };
	const sAddrNo = { han: "1班", grade: "6", address: "" };
	assert(utils.compareStudents(sAddr1, sAddr2) < 0, "Address 1-2 precedes 1-10 numerically");
	assert(utils.compareStudents(sAddr1, sAddrNo) < 0, "Has address precedes missing address");
	assert(utils.compareStudents(sAddrNo, sAddr1) > 0, "Missing address follows has address");

	// Class
	const sClass1 = { han: "1班", grade: "6", address: "1-1", class: "1" };
	const sClass2 = { han: "1班", grade: "6", address: "1-1", class: "2" };
	const sClassNo = { han: "1班", grade: "6", address: "1-1", class: "" };
	assert(utils.compareStudents(sClass1, sClass2) < 0, "Class 1 precedes Class 2");
	assert(utils.compareStudents(sClass1, sClassNo) < 0, "Has class precedes missing class");
	assert(utils.compareStudents(sClassNo, sClass1) > 0, "Missing class follows has class");

	// Kana
	const sKana1 = { han: "1班", grade: "6", address: "1-1", class: "1", lastNameKana: "あいだ" };
	const sKana2 = { han: "1班", grade: "6", address: "1-1", class: "1", lastNameKana: "うえだ" };
	assert(utils.compareStudents(sKana1, sKana2) < 0, "あいだ precedes うえだ");
});

test('utils: getUniqueNeighborhoodDistricts() deduplicates multiple files for same district', () => {
	const districts = [
		{
			district: "XX団地",
			selectedForPrint: true,
			neighborhood: [{ role: "会長", lastName: "田中" }]
		},
		{
			district: "XX団地",
			selectedForPrint: true,
			neighborhood: [{ role: "会長", lastName: "田中" }, { role: "副会長", lastName: "佐藤" }]
		},
		{
			district: "YY台",
			selectedForPrint: false,
			neighborhood: [{ role: "会長", lastName: "鈴木" }]
		}
	];

	const uniqueAll = utils.getUniqueNeighborhoodDistricts(districts, false);
	assert.strictEqual(uniqueAll.length, 2);
	assert.strictEqual(uniqueAll[0].d.neighborhood.length, 2, "Should pick the richer neighborhood entry for XX団地");

	const uniqueSelected = utils.getUniqueNeighborhoodDistricts(districts, true);
	assert.strictEqual(uniqueSelected.length, 1);
	assert.strictEqual(uniqueSelected[0].d.district, "XX団地");
});

test('utils: getDistrictWideValidStudents() aggregates students across district files', () => {
	const d1 = {
		district: "XX団地",
		han: "A班",
		students: [
			{ lastName: "伊藤", han: "A班" },
			{ lastName: "渡辺" } // No han -> fallback to defHan
		]
	};
	const d2 = {
		district: "XX団地",
		han: "B班",
		students: [
			{ lastName: "加藤", han: "B班" },
			{ grade: "1" } // Empty name and address -> invalid
		]
	};

	const aggregated = utils.getDistrictWideValidStudents(d1, [d1, d2]);
	assert.strictEqual(aggregated.length, 3);
	assert.strictEqual(aggregated[0]._effectiveHan, "A班");
	assert.strictEqual(aggregated[1]._effectiveHan, "A班");
	assert.strictEqual(aggregated[2]._effectiveHan, "B班");
});

test('utils: additional branch coverage tests for utils.js', () => {
	// Name space branches
	assert.strictEqual(utils.getFullName({ lastName: "山田", firstName: "" }), "山田");
	assert.strictEqual(utils.getFullName({ lastName: "", firstName: "花子" }), "花子");
	assert.strictEqual(utils.getFullNameKana({ lastNameKana: "やまだ", firstNameKana: "" }), "やまだ");
	assert.strictEqual(utils.getFullNameKana({ lastNameKana: "", firstNameKana: "はなこ" }), "はなこ");
	assert.strictEqual(utils.getChildFullName({ childLastName: "佐藤", childFirstName: "" }), "佐藤");
	assert.strictEqual(utils.getChildFullName({ childLastName: "", childFirstName: "次郎" }), "次郎");
	assert.strictEqual(utils.getChildFullNameKana({ childLastNameKana: "さとう", childFirstNameKana: "" }), "さとう");
	assert.strictEqual(utils.getChildFullNameKana({ childLastNameKana: "", childFirstNameKana: "じろう" }), "じろう");

	// getDistrictHanList branches
	const dHanWhitespace = { han: "   ", officers: [{ han: "" }, { han: "全班" }], students: [{ han: "" }] };
	assert.deepStrictEqual(utils.getDistrictHanList(dHanWhitespace), []);

	// getGradeCounts branches (individual property existence)
	const sLastOnly = [{ grade: "1", lastName: "A" }];
	const sFirstOnly = [{ grade: "2", firstName: "B" }];
	const sNameOnly = [{ grade: "3", name: "C" }];
	const sAddrOnly = [{ grade: "4", address: "D" }];
	assert.strictEqual(utils.getGradeCounts(sLastOnly)[1], 1);
	assert.strictEqual(utils.getGradeCounts(sFirstOnly)[2], 1);
	assert.strictEqual(utils.getGradeCounts(sNameOnly)[3], 1);
	assert.strictEqual(utils.getGradeCounts(sAddrOnly)[4], 1);

	// compareStudents branches (リーダー and サブリーダー aliases)
	const sLeaderAlias = { han: "1班", leader: "リーダー" };
	const sSubLeaderAlias = { han: "1班", leader: "サブリーダー" };
	assert(utils.compareStudents(sLeaderAlias, sSubLeaderAlias) < 0);
	assert(utils.compareStudents(sSubLeaderAlias, sLeaderAlias) > 0);

	// compareStudents fallback to getFullName when kana is empty
	const sNoKana1 = { han: "1班", grade: "6", address: "1-1", class: "1", lastName: "青山" };
	const sNoKana2 = { han: "1班", grade: "6", address: "1-1", class: "1", lastName: "本田" };
	assert(utils.compareStudents(sNoKana1, sNoKana2) < 0);

	// getUniqueNeighborhoodDistricts where existingN >= newN
	const dists = [
		{ district: "A町", neighborhood: [{ role: "会長", lastName: "X" }, { role: "役員", lastName: "Y" }] },
		{ district: "A町", neighborhood: [{ role: "会長", lastName: "X" }] }
	];
	const uniq = utils.getUniqueNeighborhoodDistricts(dists);
	assert.strictEqual(uniq.length, 1);
	assert.strictEqual(uniq[0].d.neighborhood.length, 2);

	// Edge branches for 100% branch coverage:
	// normalizeNameFields with empty string name
	const itemEmptyName = { name: "" };
	utils.normalizeNameFields(itemEmptyName);
	assert.strictEqual(itemEmptyName.lastName, "");
	assert.strictEqual(itemEmptyName.firstName, "");

	// normalizeOfficerChildNames with empty string childName
	const offEmptyChild = { childName: "" };
	utils.normalizeOfficerChildNames(offEmptyChild);
	assert.strictEqual(offEmptyChild.childLastName, "");
	assert.strictEqual(offEmptyChild.childFirstName, "");

	// getDistrictHanList with undefined officers/students
	assert.deepStrictEqual(utils.getDistrictHanList({}), []);

	// togglePasswordVisibility with null input
	utils.togglePasswordVisibility('missing-id', null);

	// compareStudents with non-numeric grades, undefined hans
	const sNoHanA = { grade: "abc" };
	const sNoHanB = { grade: undefined };
	assert.strictEqual(utils.compareStudents(sNoHanA, sNoHanB), 0);

	// getUniqueNeighborhoodDistricts with undefined districts, undefined district property, and various neighborhood fields
	assert.deepStrictEqual(utils.getUniqueNeighborhoodDistricts(null), []);
	const distsSpecial = [
		{ neighborhood: [{ firstName: "花子" }, { name: "太郎" }, { role: "書記" }] },
		{ neighborhood: [{ firstName: "花子" }] }
	];
	assert.strictEqual(utils.getUniqueNeighborhoodDistricts(distsSpecial).length, 1);

	// getDistrictWideValidStudents with undefined targetDistrict.district, null allDistricts, and empty targetList
	const specialTarget = { students: [{ name: "テスト" }] };
	assert.strictEqual(utils.getDistrictWideValidStudents(specialTarget, null).length, 1);
	const targetWithoutMatch = { district: "存在しない町" };
	const matchedList = [{ district: "別の町" }];
	assert.strictEqual(utils.getDistrictWideValidStudents(targetWithoutMatch, matchedList).length, 0);
	assert.strictEqual(utils.getDistrictWideValidStudents({}, [{}]).length, 0);
});

test('utils: sanitizePasswordInput normalizes full-width characters and preserves caret position', () => {
	// 1. Full-width ASCII conversion (A-Z, a-z, 0-9, symbols)
	const el1 = new (require('../helpers/dom-mock.js').MockElement)('input');
	el1.value = 'Ｐａｓｓｗｏｒｄ１２３！＠＃';
	el1.selectionStart = 5;
	el1.selectionEnd = 5;
	utils.sanitizePasswordInput(el1);
	assert.strictEqual(el1.value, 'Password123!@#');
	assert.strictEqual(el1.selectionStart, 5);

	// 2. Full-width space and non-ASCII character removal with caret shift
	const el2 = new (require('../helpers/dom-mock.js').MockElement)('input');
	el2.value = 'Pass　wordあいう123';
	// Caret is right after 'あいう' at index 12 ('Pass　wordあいう' is 4+1+4+3 = 12)
	el2.selectionStart = 12;
	el2.selectionEnd = 12;
	utils.sanitizePasswordInput(el2);
	// Stripping full-width space (1 char) and 'あいう' (3 chars) before index 12: total 4 removed before caret
	assert.strictEqual(el2.value, 'Password123');
	assert.strictEqual(el2.selectionStart, 8); // 12 - 4 = 8 ('Password')

	// 3. Normal half-width string remains untouched
	const el3 = new (require('../helpers/dom-mock.js').MockElement)('input');
	el3.value = 'Secure#Pass1234!';
	el3.selectionStart = 6;
	el3.selectionEnd = 6;
	utils.sanitizePasswordInput(el3);
	assert.strictEqual(el3.value, 'Secure#Pass1234!');
	assert.strictEqual(el3.selectionStart, 6);

	// 4. Null / empty / missing selectionStart edge cases
	utils.sanitizePasswordInput(null);
	const elEmpty = new (require('../helpers/dom-mock.js').MockElement)('input');
	elEmpty.value = '';
	utils.sanitizePasswordInput(elEmpty);
	assert.strictEqual(elEmpty.value, '');

	const elNoSel = { value: '全角Ａ' };
	utils.sanitizePasswordInput(elNoSel);
	assert.strictEqual(elNoSel.value, 'A');
});


