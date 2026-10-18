const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const hata = require('../../js/hata.js');

test('hata: updateHataPreview safely exits if elements missing', () => {
	document.elements['hata-format'] = null;
	hata.updateHataPreview(); // Should not throw
});

test('hata: updateHataPreview generates formatted list with all variables and full-width numbers', () => {
	setupDomEnvironment();
	state.currentDistrict = {
		district: "さくらが丘",
		han: "1班",
		students: [
			{
				lastName: "山田",
				firstName: "太郎",
				lastNameKana: "やまだ",
				firstNameKana: "たろう",
				grade: "6",
				address: "１丁目２番３号 １０１号室",
				han: "1班"
			},
			{
				lastName: "山田",
				firstName: "花子",
				lastNameKana: "やまだ",
				firstNameKana: "はなこ",
				grade: "4",
				address: "１丁目２番３号 １０１号室", // Same address & last name -> duplicate
				han: "1班"
			},
			{
				lastName: "佐藤",
				firstName: "次郎",
				lastNameKana: "さとう",
				firstNameKana: "じろう",
				grade: "5",
				address: "さくらが丘４－５－６",
				han: "2班"
			},
			{
				lastName: "鈴木",
				firstName: "三郎",
				lastNameKana: "すずき",
				firstNameKana: "さぶろう",
				grade: "1",
				address: "緑地公園", // Address with no numbers
				han: "" // fallback to district.han
			},
			{
				grade: "2" // Empty student without name/address -> skipped
			}
		]
	};

	const fmtEl = document.getElementById('hata-format');
	const dedupEl = document.getElementById('hata-dedup');
	const previewEl = document.getElementById('hata-preview');

	// 1. With dedup enabled
	fmtEl.value = "{住所数字} {苗字}（{学年} / {班} / {班名} / {地区} / {名前} / {氏名} / {ふりがな} / {苗字ふりがな} / {名前ふりがな} / {住所}）";
	dedupEl.checked = true;
	hata.updateHataPreview();

	const linesDedup = previewEl.value.split('\n');
	assert.strictEqual(linesDedup.length, 3, "Should have 3 lines with duplicate Yamada merged");
	assert(linesDedup[0].startsWith("1-2-3-101 山田"));
	assert(linesDedup[0].includes("6年 / 1班 / 1班 / さくらが丘 / 太郎 / 山田 太郎 / やまだ たろう / やまだ / たろう / １丁目２番３号 １０１号室"));
	assert(linesDedup[1].startsWith("4-5-6 佐藤"));
	assert(linesDedup[1].includes("2班"));
	assert(linesDedup[2].startsWith("緑地公園 鈴木"));
	assert(linesDedup[2].includes("1班"), "Fallback to district.han");

	// 2. With dedup disabled
	dedupEl.checked = false;
	hata.updateHataPreview();
	const linesNoDedup = previewEl.value.split('\n');
	assert.strictEqual(linesNoDedup.length, 4, "Should have 4 lines without dedup");
});

test('hata: copyHataList copies text to clipboard and alerts', async () => {
	setupDomEnvironment();
	const previewEl = document.getElementById('hata-preview');
	previewEl.value = "1-2-3 山田\n4-5-6 佐藤";

	let alertMsg = "";
	window.alert = (msg) => { alertMsg = msg; };

	await hata.copyHataList();

	assert.strictEqual(await navigator.clipboard.readText(), "1-2-3 山田\n4-5-6 佐藤");
	assert(alertMsg.includes("クリップボードにコピーしました"));

	// Fallback when clipboard rejects
	let selectCalled = false;
	previewEl.select = () => { selectCalled = true; };
	navigator.clipboard = {
		writeText: async () => { throw new Error("Permission denied"); }
	};
	await hata.copyHataList();
	assert.strictEqual(selectCalled, true);
	assert(alertMsg.includes("ハタフロット用リストを選択しました"));

	// Fallback when navigator.clipboard is undefined
	const origClipboard = navigator.clipboard;
	delete navigator.clipboard;
	selectCalled = false;
	await hata.copyHataList();
	assert.strictEqual(selectCalled, true);

	// When previewEl is null
	document.elements['hata-preview'] = null;
	await hata.copyHataList();

	// When previewEl.select is not a function
	document.elements['hata-preview'] = previewEl;
	previewEl.select = null;
	await hata.copyHataList();
	navigator.clipboard = origClipboard;

	// Missing elements branches
	document.elements['hata-dedup'] = null;
	hata.updateHataPreview();
	document.elements['hata-dedup'] = {};
	document.elements['hata-preview'] = null;
	hata.updateHataPreview();

	// Student with only name, empty district, empty han
	setupDomEnvironment();
	state.currentDistrict = {
		district: "",
		han: "",
		students: [
			{ name: "単一氏名", grade: "" }
		]
	};
	document.getElementById('hata-format').value = "{氏名}";
	document.getElementById('hata-dedup').checked = true;
	hata.updateHataPreview();
	assert.strictEqual(document.getElementById('hata-preview').value, "単一氏名");

	// Student producing empty line
	document.getElementById('hata-format').value = "";
	hata.updateHataPreview();
	assert.strictEqual(document.getElementById('hata-preview').value, "");
});

test('hata: extractHouseholdsFromStudents extracts normalized households and deduplicates siblings (A-1)', () => {
	const students = [
		{ lastName: '山田', firstName: '太郎', address: '１丁目２番３号 １０１号室', grade: '6' },
		{ lastName: '山田', firstName: '花子', address: '1-2-3-101', grade: '4' }, // Same address normalized & last name
		{ lastName: '佐藤', firstName: '次郎', address: 'さくらが丘４－５－６', grade: '5' },
		{ lastName: '鈴木', firstName: '三郎', address: '', grade: '1' }, // Missing address
		{ lastName: '', firstName: '', address: '9-9-9' } // Empty name
	];

	const households = hata.extractHouseholdsFromStudents(students);
	assert.strictEqual(households.length, 3, 'Should produce 3 distinct households');
	assert.strictEqual(households[0].displayName, '1-2-3-101 山田');
	assert.strictEqual(households[0].key, '1-2-3-101_山田');
	assert.strictEqual(households[0].children.length, 2, 'Should group 2 Yamada siblings');
	assert.strictEqual(households[1].displayName, '4-5-6 佐藤');
	assert.strictEqual(households[2].displayName, '鈴木');
});

test('hata: generateJapaneseHolidays calculates Japanese national holidays accurately (GAP-TEST-3)', () => {
	const holidays2026 = hata.generateJapaneseHolidays(2026, 2026);
	assert.ok(Array.isArray(holidays2026));

	// 固定祝日チェック
	assert.ok(holidays2026.some(h => h.date === '2026-01-01' && h.name === '元日'));
	assert.ok(holidays2026.some(h => h.date === '2026-02-11' && h.name === '建国記念の日'));
	assert.ok(holidays2026.some(h => h.date === '2026-04-29' && h.name === '昭和の日'));
	assert.ok(holidays2026.some(h => h.date === '2026-05-03' && h.name === '憲法記念日'));
	assert.ok(holidays2026.some(h => h.date === '2026-05-06' && h.name.includes('休日')), 'May 6th substitute holiday check');
	assert.ok(holidays2026.some(h => h.date === '2026-11-03' && h.name === '文化の日'));
	assert.ok(holidays2026.some(h => h.date === '2026-11-23' && h.name === '勤労感謝の日'));

	// ハッピーマンデーチェック（成人の日: 1月第2月曜、海の日: 7月第3月曜、敬老の日: 9月第3月曜、スポーツの日: 10月第2月曜）
	assert.ok(holidays2026.some(h => h.date === '2026-01-12' && h.name === '成人の日'));
	assert.ok(holidays2026.some(h => h.date === '2026-07-20' && h.name === '海の日'));
	assert.ok(holidays2026.some(h => h.date === '2026-09-21' && h.name === '敬老の日'));
	assert.ok(holidays2026.some(h => h.date === '2026-10-12' && h.name === 'スポーツの日'));

	// 春分の日 (2026-03-20)・秋分の日 (2026-09-23)
	assert.ok(holidays2026.some(h => h.date === '2026-03-20' && h.name === '春分の日'));
	assert.ok(holidays2026.some(h => h.date === '2026-09-23' && h.name === '秋分の日'));

	// T-4: 閏年 (2028年: 天皇誕生日 2/23、春分の日 3/20、秋分の日 9/22) の祝日計算検証 (GAP-TG-4)
	const holidays2028 = hata.generateJapaneseHolidays(2028, 2028);
	assert.ok(holidays2028.some(h => h.date === '2028-02-23' && h.name === '天皇誕生日'));
	assert.ok(holidays2028.some(h => h.date === '2028-03-20' && h.name === '春分の日'));
	assert.ok(holidays2028.some(h => h.date === '2028-09-22' && h.name === '秋分の日'));
});

test('hata: extractHouseholdsFromStudents handles edge cases of addresses without numbers, different last names at same address, etc. (T-4 / GAP-TG-5)', () => {
	const students = [
		// 同一住所だが苗字が異なる場合（二世帯住宅や別家庭） -> 別世帯として抽出されること
		{ lastName: '木村', firstName: '健', address: '1-2-3', grade: '2' },
		{ lastName: '林', firstName: '光', address: '1-2-3', grade: '3' },
		// 番地数字が一切ない住所（「緑ヶ丘団地」など）で同一苗字 -> 同一世帯
		{ lastName: '加藤', firstName: '一郎', address: '緑ヶ丘団地', grade: '1' },
		{ lastName: '加藤', firstName: '二郎', address: '緑ヶ丘団地', grade: '5' },
		// 住所が完全に空で同一苗字
		{ lastName: '松本', firstName: '花', address: '', grade: '4' }
	];

	const households = hata.extractHouseholdsFromStudents(students);
	assert.strictEqual(households.length, 4, 'Should produce 4 households');
	assert.ok(households.some(h => h.key === '1-2-3_木村'));
	assert.ok(households.some(h => h.key === '1-2-3_林'));
	const kato = households.find(h => h.displayName.includes('加藤'));
	assert.ok(kato);
	assert.strictEqual(kato.children.length, 2, 'Should group 2 Kato children even without address numbers');
});

test('hata: getPeriodPresetDates calculates accurate period dates based on reference year', () => {
	const datesZenki = hata.getPeriodPresetDates('zenki', 2026);
	assert.strictEqual(datesZenki.startDate, '2026-04-06');
	assert.strictEqual(datesZenki.endDate, '2026-09-30');

	const datesKouki = hata.getPeriodPresetDates('kouki', 2026);
	assert.strictEqual(datesKouki.startDate, '2026-10-01');
	assert.strictEqual(datesKouki.endDate, '2027-03-24');

	const datesFull = hata.getPeriodPresetDates('full', 2026);
	assert.strictEqual(datesFull.startDate, '2026-04-06');
	assert.strictEqual(datesFull.endDate, '2027-03-24');
});

test('hata: generateHataSchedule allocates duties evenly and respects exclusions & overrides', () => {
	const members = ['1-1 田中', '1-2 佐藤', '1-3 鈴木'];
	const config = {
		startDate: '2026-05-01',
		endDate: '2026-05-15',
		weekdays: [1, 2, 3, 4, 5],
		holidays: '2026-05-04,みどりの日\n2026-05-05,こどもの日\n2026-05-06,振替休日',
		specials: '2026-05-01,校外役員,交通安全週間',
		exemptHouseholds: ['1-2_佐藤'],
		members: members.join('\n'),
		manualOverrides: {
			'2026-05-11': { person: '臨時交代_高橋', note: '手動交代', isSwapped: true, originalPerson: '1-1 田中' }
		}
	};

	const schedule = hata.generateHataSchedule(config);
	assert.ok(Array.isArray(schedule));
	assert.ok(schedule.length > 0);

	// 5/1: 特別枠が優先反映されていること
	const may1 = schedule.find(s => s.date === '2026-05-01');
	assert.ok(may1);
	assert.strictEqual(may1.person, '校外役員');
	assert.strictEqual(may1.isSpecial, true);

	// 5/4, 5/5, 5/6: 祝日・休校日行（type: 'holiday'）として保持され、当番は割り当てられない（person: '-'）
	const may4 = schedule.find(s => s.date === '2026-05-04');
	assert.ok(may4);
	assert.strictEqual(may4.type, 'holiday');
	assert.strictEqual(may4.person, '-');
	assert.strictEqual(may4.note, 'みどりの日');

	// 5/11: manualOverrides が反映されていること
	const may11 = schedule.find(s => s.date === '2026-05-11');
	assert.ok(may11);
	assert.strictEqual(may11.person, '臨時交代_高橋');
	assert.strictEqual(may11.isSwapped, true);

	// 免除世帯 '1-2 佐藤' は通常スロットに割り当てられていないこと
	const regularDuties = schedule.filter(s => !s.isSpecial && !s.isSwapped);
	const satoAllocated = regularDuties.some(s => s.person === '1-2 佐藤');
	assert.strictEqual(satoAllocated, false, 'Exempt household should not be allocated to duties');
});

test('hata: swapScheduleDates and setDateOverride modifies schedule and updates manualOverrides', () => {
	const currentDistrict = {
		hata: {
			startDate: '2026-06-01',
			endDate: '2026-06-05',
			weekdays: [1, 2, 3, 4, 5],
			members: '1-1 A\n1-2 B\n1-3 C',
			manualOverrides: {}
		}
	};

	// 2日間のスワップ
	hata.swapScheduleDates(currentDistrict.hata, '2026-06-01', '1-1 A', '2026-06-02', '1-2 B');
	assert.strictEqual(currentDistrict.hata.manualOverrides['2026-06-01'].person, '1-2 B');
	assert.strictEqual(currentDistrict.hata.manualOverrides['2026-06-02'].person, '1-1 A');
	assert.strictEqual(currentDistrict.hata.manualOverrides['2026-06-01'].isSwapped, true);

	// 特定日付のオーバーライド設定
	hata.setDateOverride(currentDistrict.hata, '2026-06-03', { person: '休み', note: '行事中止' });
	assert.strictEqual(currentDistrict.hata.manualOverrides['2026-06-03'].person, '休み');

	// オーバーライド解除（初期化）
	hata.clearDateOverride(currentDistrict.hata, '2026-06-03');
	assert.strictEqual(currentDistrict.hata.manualOverrides['2026-06-03'], undefined);
});

test('hata: exportHataOfficialJson and importHataOfficialJson guarantee bilateral compatibility', () => {
	const config = {
		title: '登校見守り活動シフト表',
		createdDate: '2026-10-18',
		location: 'セブン前交差点',
		time: '7:45〜8:15',
		startDate: '2026-11-01',
		endDate: '2027-03-24',
		weekdays: [1, 2, 3, 4, 5],
		orientation: 'landscape',
		layoutColumns: '3',
		headerMsg: '※雨天時も実施します',
		footerMsg: '※各自で交代してください',
		contactMsg: '校外委員: 鈴木',
		members: '1-1 田中\n1-2 佐藤',
		holidays: '2026-11-03,文化の日',
		specials: '2026-11-10,校外役員,交通週間',
		format: '{住所数字} {苗字}',
		exemptHouseholds: ['1-2_佐藤'],
		manualOverrides: {}
	};

	// 公式JSON出力
	const jsonStr = hata.exportHataOfficialJson(config);
	assert.ok(typeof jsonStr === 'string');
	const parsed = JSON.parse(jsonStr);
	assert.strictEqual(parsed.scheduleTitle, '登校見守り活動シフト表');
	assert.strictEqual(parsed.metaLocation, 'セブン前交差点');

	// 公式JSON読込・インポート
	const importedConfig = hata.importHataOfficialJson(jsonStr);
	assert.strictEqual(importedConfig.title, '登校見守り活動シフト表');
	assert.strictEqual(importedConfig.location, 'セブン前交差点');
	assert.strictEqual(importedConfig.time, '7:45〜8:15');
	assert.strictEqual(importedConfig.startDate, '2026-11-01');
	assert.strictEqual(importedConfig.headerMsg, '※雨天時も実施します');
});

test('hata: buildHataScheduleHtml and buildHataPrintHtml generate expected responsive and print layouts', () => {
	const schedule = [
		{ date: '2026-06-01', dayOfWeek: '月', person: '1-1 田中', note: '', isSpecial: false },
		{ date: '2026-06-02', dayOfWeek: '火', person: '1-2 佐藤', note: '調整済', isSwapped: true }
	];
	const config = {
		title: '登校見守り活動シフト表',
		location: '交差点',
		time: '7:45〜8:15',
		layoutColumns: '2',
		orientation: 'landscape',
		headerMsg: '上部連絡事項',
		footerMsg: '下部免責'
	};

	// スマホ向けリストビューHTML
	const listHtml = hata.buildHataScheduleHtml(schedule, 'list');
	assert.ok(listHtml.includes('hata-card-list'));
	assert.ok(listHtml.includes('1-1 田中'));
	assert.ok(listHtml.includes('調整済'));

	// PC向けグリッドビューHTML
	const gridHtml = hata.buildHataScheduleHtml(schedule, 'grid');
	assert.ok(gridHtml.includes('hata-grid-table'));

	// A4印刷用HTML
	const printHtml = hata.buildHataPrintHtml(schedule, config);
	assert.ok(printHtml.includes('登校見守り活動シフト表'));
	assert.ok(printHtml.includes('交差点'));
	assert.ok(printHtml.includes('上部連絡事項'));
	assert.ok(printHtml.includes('下部免責'));
});

test('hata: renderHataCard, renderHataExemptList, toggleHataExempt lifecycle and edge cases', () => {
	setupDomEnvironment();
	state.currentDistrict = {
		district: '1丁目',
		students: [
			{ grade: '1', lastName: '山田', address: '1-1-1' }
		],
		hata: null
	};

	// 初回レンダリング（hataが未定義の場合のデフォルト生成）
	hata.renderHataCard();
	assert.ok(state.currentDistrict.hata);
	assert.strictEqual(state.currentDistrict.hata.title, '登校見守り活動シフト表');
	assert.strictEqual(state.currentDistrict.hata.time, '7:45〜8:15');

	// 免除チェックリストの描画確認
	const exemptContainer = document.getElementById('hata-exempt-list');
	assert.ok(exemptContainer);
	assert.ok(exemptContainer.innerHTML.includes('1-1-1 山田'));

	// 免除のトグル操作
	hata.toggleHataExempt('1-1-1_山田', true);
	assert.ok(state.currentDistrict.hata.exemptHouseholds.includes('1-1-1_山田'));
	hata.toggleHataExempt('1-1-1_山田', false);
	assert.strictEqual(state.currentDistrict.hata.exemptHouseholds.includes('1-1-1_山田'), false);

	// 児童名簿が空の場合の免除リスト
	state.currentDistrict.students = [];
	hata.renderHataExemptList();
	assert.ok(exemptContainer.innerHTML.includes('世帯情報がありません'));

	// ガード分岐: currentDistrict.hata が null
	state.currentDistrict.hata = null;
	hata.toggleHataExempt('1-1-1_山田', true);
});

test('hata: applyHataPeriodPreset and syncHataMembersFromStudents', () => {
	setupDomEnvironment();
	state.currentDistrict = {
		district: '1丁目',
		students: [
			{ grade: '3', lastName: '佐藤', firstName: '健', address: '1-2-3' }
		],
		hata: {}
	};

	// プリセット適用
	hata.applyHataPeriodPreset('zenki');
	assert.ok(state.currentDistrict.hata.startDate.includes('-04-06'));
	hata.applyHataPeriodPreset('kouki');
	assert.ok(state.currentDistrict.hata.startDate.includes('-10-01'));
	hata.applyHataPeriodPreset('full');
	assert.ok(state.currentDistrict.hata.startDate.includes('-04-06'));

	// メンバー同期
	const memText = hata.syncHataMembersFromStudents();
	assert.ok(memText.includes('1-2-3 佐藤'));
	assert.strictEqual(document.getElementById('hata-members').value, memText);
});

test('hata: runAutoHataGeneration, renderHataSchedulePreview, and printHataSchedule', () => {
	setupDomEnvironment();
	state.currentDistrict = {
		district: '1丁目',
		students: [
			{ grade: '2', lastName: '田中', address: '1-1-1' }
		],
		hata: {
			title: 'テストシフト表',
			location: '東交差点',
			time: '8:00〜8:30',
			startDate: '2026-06-01',
			endDate: '2026-06-05',
			weekdays: [1, 2, 3, 4, 5],
			orientation: 'landscape',
			layoutColumns: '3',
			members: '1-1-1 田中',
			exemptHouseholds: [],
			manualOverrides: {}
		}
	};

	// シフト自動生成実行
	hata.runAutoHataGeneration();
	const previewEl = document.getElementById('hata-schedule-preview');
	assert.ok(previewEl.innerHTML.includes('田中'));

	// 空配列でのプレビュー表示
	hata.renderHataSchedulePreview([]);
	assert.ok(previewEl.innerHTML.includes('シフトがまだ生成されていません'));

	// buildHataScheduleHtml の空入力
	assert.ok(hata.buildHataScheduleHtml(null).includes('まだ生成されていません'));
	assert.ok(hata.buildHataScheduleHtml([]).includes('まだ生成されていません'));

	// 印刷処理の実行
	let printTriggered = false;
	global.print = () => { printTriggered = true; };
	hata.printHataSchedule();
	assert.strictEqual(printTriggered, true, 'window.print should be triggered');
});

test('hata: branch coverage boosters for generateHataSchedule and edge cases', async () => {
	// 1. null または 日程なしの config
	assert.deepStrictEqual(hata.generateHataSchedule(null), []);
	assert.deepStrictEqual(hata.generateHataSchedule({ startDate: '' }), []);

	// 2. weekdays が配列でない場合、holidays が配列の場合、specials が2列の場合
	const config = {
		startDate: '2026-07-01',
		endDate: '2026-07-03',
		weekdays: null, // デフォルト [1,2,3,4,5] にフォールバック
		holidays: [{ date: '2026-07-01', name: '行事除外' }],
		specials: '2026-07-02,特別当番枠', // 担当者なし
		members: ['1-1 山田'],
		exemptHouseholds: ['1-1_山田'], // 全員免除
		manualOverrides: {}
	};
	const schedule = hata.generateHataSchedule(config);
	assert.ok(Array.isArray(schedule));
	// 7/1 は祝日行、7/2 は特別枠、7/3 はメンバー全員免除で person=''
	assert.strictEqual(schedule.length, 3);
	assert.strictEqual(schedule[0].date, '2026-07-01');
	assert.strictEqual(schedule[0].type, 'holiday');
	assert.strictEqual(schedule[0].note, '行事除外');
	assert.strictEqual(schedule[1].date, '2026-07-02');
	assert.strictEqual(schedule[1].isSpecial, true);
	assert.strictEqual(schedule[1].person, '特別当番枠');
	assert.strictEqual(schedule[2].date, '2026-07-03');
	assert.strictEqual(schedule[2].person, '');

	// 3. copyHataList で clipboard 例外スロー時の textarea.select フォールバック
	setupDomEnvironment();
	const origClip = navigator.clipboard;
	navigator.clipboard = {
		writeText: async () => { throw new Error('Clipboard rejected'); }
	};
	let selectCalled = false;
	const previewBox = document.getElementById('hata-preview');
	previewBox.select = () => { selectCalled = true; };
	await hata.copyHataList();
	assert.strictEqual(selectCalled, true);
	navigator.clipboard = origClip;
});

test('hata: exhaustive branch booster for all conditional paths', () => {
	setupDomEnvironment();

	// 1. extractHouseholdsFromStudents: 非配列, null要素, 苗字なし, 住所空, 番地数字なし
	assert.deepStrictEqual(hata.extractHouseholdsFromStudents(null), []);
	const mixedStudents = [
		null,
		{ lastName: '', firstName: '', address: '1-1-1' }, // 氏名完全空
		{ name: '山田太郎', address: '緑ヶ丘団地' }, // lastNameなし、nameのみ、数字なし住所
		{ lastName: '佐藤', firstName: '', address: '' } // 住所完全空
	];
	const mixedHh = hata.extractHouseholdsFromStudents(mixedStudents);
	assert.strictEqual(mixedHh.length, 2);
	assert.strictEqual(mixedHh[0].displayName, '緑ヶ丘団地 山田太郎');
	assert.strictEqual(mixedHh[1].displayName, '佐藤');

	// 2. getPeriodPresetDates: baseYear省略、その他プリセットキー
	const pDefault = hata.getPeriodPresetDates('unknown');
	assert.ok(pDefault.startDate.includes('-04-06'));

	// 3. generateJapaneseHolidays: 2018年（天皇誕生日なし）
	const holis2018 = hata.generateJapaneseHolidays(2018, 2018);
	assert.strictEqual(holis2018.some(h => h.name === '天皇誕生日'), false);

	// 4. swapScheduleDates, setDateOverride, clearDateOverride ガード分岐
	hata.swapScheduleDates(null, '2026-06-01', 'A', '2026-06-02', 'B');
	const emptyConfig = {};
	hata.swapScheduleDates(emptyConfig, '2026-06-01', 'A', '2026-06-02', 'B');
	assert.ok(emptyConfig.manualOverrides['2026-06-01']);

	hata.setDateOverride(null, '2026-06-01', {});
	hata.setDateOverride(emptyConfig, '2026-06-01', { person: 'C' });
	assert.strictEqual(emptyConfig.manualOverrides['2026-06-01'].person, 'C');

	hata.clearDateOverride(null, '2026-06-01');
	hata.clearDateOverride({}, '2026-06-01');
	hata.clearDateOverride(emptyConfig, '2026-06-01');
	assert.strictEqual(emptyConfig.manualOverrides['2026-06-01'], undefined);

	// 5. exportHataOfficialJson / importHataOfficialJson 空オブジェクト
	assert.ok(hata.exportHataOfficialJson(null).includes('登校見守り活動シフト表'));
	assert.deepStrictEqual(hata.importHataOfficialJson(null), {});
	const importedObj = hata.importHataOfficialJson({ title: '任意タイトル' });
	assert.strictEqual(importedObj.title, '任意タイトル');

	// 6. buildHataScheduleHtml & buildHataPrintHtml 分岐
	const gridCustom = hata.buildHataScheduleHtml([
		{ date: '2026-06-01', dayOfWeek: '月', person: 'A', isSpecial: true, isSwapped: false, note: '特別枠' },
		{ date: '2026-06-02', dayOfWeek: '火', person: 'B', isSpecial: false, isSwapped: true, note: '' },
		{ date: '2026-06-03', dayOfWeek: '水', person: 'C', isSpecial: false, isSwapped: false, note: '' }
	], 'grid');
	assert.ok(gridCustom.includes('特別'));
	assert.ok(gridCustom.includes('交代'));

	const emptyPrint = hata.buildHataPrintHtml([], {});
	assert.ok(emptyPrint.includes('登校見守り活動シフト表'));

	// 7. renderHataCard ガード分岐
	state.currentDistrict = {
		hata: {
			title: '既存タイトル',
			holidays: '2026-05-04,みどりの日',
			exemptHouseholds: ['1-1_山田']
		},
		students: []
	};
	document.elements['hata-title'] = null;
	document.elements['hata-location'] = null;
	document.elements['hata-time'] = null;
	document.elements['hata-start-date'] = null;
	document.elements['hata-end-date'] = null;
	document.elements['hata-exempt-list'] = null;
	document.elements['hata-schedule-preview'] = null;
	hata.renderHataCard();

	// 8. renderHataSchedulePreview の else 分岐（startDateなし）および PCグリッドモード
	setupDomEnvironment();
	state.currentDistrict = {
		hata: { startDate: '', endDate: '' },
		students: []
	};
	window.innerWidth = 1024; // PC モード
	hata.renderHataSchedulePreview(); // 694-695行目通過！

	// 9. toggleHataExempt & applyHataPeriodPreset ガード
	state.currentDistrict = {};
	hata.applyHataPeriodPreset('zenki');
	hata.syncHataMembersFromStudents();
	hata.runAutoHataGeneration();

	// 10. printHataSchedule の printEl.parentElement なし分岐
	const origPrint = global.print;
	global.print = () => {};
	hata.printHataSchedule();
	global.print = origPrint;
});

test('hata: ultimate branch coverage booster', () => {
	setupDomEnvironment();

	// 1. updateHataPreview: currentDistrict.students が undefined/null, lastName なし
	state.currentDistrict = {
		students: null
	};
	hata.updateHataPreview();

	state.currentDistrict = {
		district: 'テスト地区',
		han: '1班',
		students: [
			{ name: '山田', grade: '', address: '1-1' } // lastName なし、grade なし
		]
	};
	document.getElementById('hata-format').value = '{苗字} {名前} {学年} {班}';
	document.getElementById('hata-dedup').checked = true;
	hata.updateHataPreview();
	assert.ok(document.getElementById('hata-preview').value.includes('1班'));

	// 2. generateHataSchedule: 祝日・特別枠の parts[1] 空、members が数値
	const edgeConfig = {
		startDate: '2026-08-01',
		endDate: '2026-08-04',
		weekdays: [1, 2, 3, 4, 5],
		holidays: '2026-08-03,\n', // parts[1] なし
		specials: '2026-08-04,\n', // parts[1] なし
		members: 12345, // 配列でも文字列でもない
		exemptHouseholds: ['田中'] // 直接マッチ
	};
	const sched1 = hata.generateHataSchedule(edgeConfig);
	assert.strictEqual(sched1.length, 2);

	const edgeConfig2 = {
		startDate: '2026-08-03',
		endDate: '2026-08-05',
		weekdays: [1, 2, 3, 4, 5],
		holidays: [{ date: '2026-08-03', name: '' }], // name が空
		specials: '2026-08-04,特別,田中太郎', // 3要素 (personOrNote あり)
		members: '田中\n佐藤',
		exemptHouseholds: ['田中'],
		manualOverrides: {
			'2026-08-04': { person: '鈴木', note: '調整', isSwapped: true, originalPerson: '田中太郎' }
		}
	};
	const sched2 = hata.generateHataSchedule(edgeConfig2);
	assert.strictEqual(sched2.length, 3);
	assert.strictEqual(sched2[0].date, '2026-08-03');
	assert.strictEqual(sched2[0].type, 'holiday');
	assert.strictEqual(sched2[1].date, '2026-08-04');
	assert.strictEqual(sched2[1].person, '鈴木');
	assert.strictEqual(sched2[2].date, '2026-08-05');
	assert.strictEqual(sched2[2].person, '佐藤');

	// 3. setDateOverride with existing manualOverrides
	const cfgWithOvr = { manualOverrides: { '2026-08-01': { note: '既存' } } };
	hata.setDateOverride(cfgWithOvr, '2026-08-01', { person: '加藤' });
	assert.strictEqual(cfgWithOvr.manualOverrides['2026-08-01'].person, '加藤');

	// 4. importHataOfficialJson with scheduleTitle & full fields
	const fullJson = JSON.stringify({
		scheduleTitle: '公式タイトル',
		metaCreatedDate: '2026-01-01',
		metaLocation: '正門前',
		metaTime: '7:30〜8:00',
		metaOrientation: 'portrait',
		metaLayoutColumns: '2',
		metaHeaderMsg: 'ヘッダー注記',
		metaFooterMsg: 'フッター注記',
		metaContactMsg: '連絡先: 担当者',
		startDate: '2026-04-01',
		endDate: '2026-09-30',
		weekdays: [1, 3, 5],
		holidays: '2026-05-03,祝日',
		specials: '2026-05-01,特別',
		exemptHouseholds: ['1-1 山田'],
		manualOverrides: { '2026-05-01': { person: '交代者' } },
		members: '山田\n佐藤'
	});
	const parsedOfficial = hata.importHataOfficialJson(fullJson);
	assert.strictEqual(parsedOfficial.title, '公式タイトル');
	assert.strictEqual(parsedOfficial.location, '正門前');
	assert.strictEqual(parsedOfficial.contactMsg, '連絡先: 担当者');

	// 5. buildHataScheduleHtml list mode with isSwapped
	const swappedListHtml = hata.buildHataScheduleHtml([
		{ date: '2026-09-01', dayOfWeek: '火', person: '山田', isSpecial: false, isSwapped: true, note: '交代' }
	], 'list');
	assert.ok(swappedListHtml.includes('交代'));

	// 6. buildHataPrintHtml with contactMsg, header, footer, location, time
	const printFullHtml = hata.buildHataPrintHtml([], parsedOfficial);
	assert.ok(printFullHtml.includes('連絡先: 担当者'));
	assert.ok(printFullHtml.includes('正門前'));

	// 7. renderHataCard when fields are empty in h
	state.currentDistrict = {
		hata: {
			title: '',
			location: '',
			time: '',
			startDate: '',
			endDate: '',
			holidays: ''
		},
		students: null
	};
	hata.renderHataCard();
	assert.ok(document.getElementById('hata-title'));

	// 8. renderHataExemptList with displayName in exemptHouseholds and toggleHataExempt false
	state.currentDistrict = {
		hata: {
			exemptHouseholds: ['1-1 山田']
		},
		students: [
			{ lastName: '山田', firstName: '太郎', address: '1-1' }
		]
	};
	hata.renderHataExemptList();
	hata.toggleHataExempt('1-1 山田', false);
	assert.strictEqual(state.currentDistrict.hata.exemptHouseholds.length, 0);

	// 9. renderHataSchedulePreview with mobile screen width (<768)
	window.innerWidth = 400;
	hata.renderHataSchedulePreview();

	// 10. printHataSchedule with hata-print-area present
	const printArea = document.createElement('div');
	printArea.id = 'hata-print-area';
	document.body.appendChild(printArea);
	hata.printHataSchedule();
});

test('hata: expandDateOrRange correctly expands tilde ranges and single dates (A-3, T-4)', () => {
	// 全角波線、半角チルダ、スラッシュ、ハイフン
	const r1 = hata.expandDateOrRange('2026-12-25〜2026-12-27');
	assert.deepStrictEqual(r1, ['2026-12-25', '2026-12-26', '2026-12-27']);

	const r2 = hata.expandDateOrRange('2026/08/01~2026/08/03');
	assert.deepStrictEqual(r2, ['2026-08-01', '2026-08-02', '2026-08-03']);

	const r3 = hata.expandDateOrRange('2026-05-03');
	assert.deepStrictEqual(r3, ['2026-05-03']);

	// T-4 境界値: 年またぎ (12/28〜1/5: 9日間)
	const rYear = hata.expandDateOrRange('2026-12-28〜2027-01-05');
	assert.strictEqual(rYear.length, 9);
	assert.strictEqual(rYear[0], '2026-12-28');
	assert.strictEqual(rYear[8], '2027-01-05');

	// T-4 境界値: 1桁月日のゼロ埋め正規化
	const rSingleDigit = hata.expandDateOrRange('2026/8/1~2026/8/3');
	assert.deepStrictEqual(rSingleDigit, ['2026-08-01', '2026-08-02', '2026-08-03']);

	// T-4 境界値: 逆転期間で安全に空配列
	const rReverse = hata.expandDateOrRange('2026-12-27〜2026-12-25');
	assert.deepStrictEqual(rReverse, []);

	// T-4 境界値: 片側不正値・空・null
	assert.deepStrictEqual(hata.expandDateOrRange('2026-12-25〜invalid'), []);
	assert.deepStrictEqual(hata.expandDateOrRange(''), []);
	assert.deepStrictEqual(hata.expandDateOrRange(null), []);
	assert.deepStrictEqual(hata.expandDateOrRange('invalid-date'), []);
});

test('hata: genuine Hatafurotto A4 multi-column print layout and empty padding rows (A-1, A-2, A-4, A-5, T-1, T-2)', () => {
	const config = {
		title: '見守り活動・挨拶運動シフト表 令和8年度 前期分',
		createdDate: '作成日：2026年4月1日',
		district: '第1地区',
		location: '小学校正門前',
		time: '7:55 〜 8:25',
		weekdays: [1, 3], // 月・水
		layoutColumns: 3,
		headerMsg: '・旗振り終了後、〇をつけてください\n・次の方へ回してください',
		footerMsg: '●当番日に活動できない場合\n・保護者間で調整する',
		contactMsg: '校外委員連絡先：鈴木（TEL: 090-XXXX-XXXX）'
	};

	const schedule = [
		{ date: '2026-04-06', dayOfWeek: '月', type: 'regular', person: '山田', note: '' },
		{ date: '2026-04-08', dayOfWeek: '水', type: 'regular', person: '佐藤', note: '' },
		{ date: '2026-04-13', dayOfWeek: '月', type: 'holiday', person: '-', note: '創立記念日' },
		{ date: '2026-04-15', dayOfWeek: '水', type: 'special', person: '役員A', note: '重点見守り日' },
		{ date: '2026-04-20', dayOfWeek: '月', type: 'regular', person: '鈴木', note: '' }
	];

	const html = hata.buildHataPrintHtml(schedule, config);

	// T-2: CSSカプセル化 (.hata-sheet)
	assert.ok(html.includes('class="hata-print-sheet hata-sheet"'), 'Root should contain hata-sheet class');

	// 1. 最上部作成日 (sheet-top-date)
	assert.ok(html.includes('class="sheet-top-date"'), 'Should contain sheet-top-date');
	assert.ok(html.includes('作成日：2026年4月1日'));

	// 2. 表題および2行メタ情報テーブル (sheet-header, sheet-title, sheet-meta-table)
	assert.ok(html.includes('class="sheet-header"'), 'Should contain sheet-header');
	assert.ok(html.includes('class="sheet-title"'), 'Should contain sheet-title');
	assert.ok(html.includes('見守り活動・挨拶運動シフト表 令和8年度 前期分'));
	assert.ok(html.includes('class="sheet-meta-table"'), 'Should contain sheet-meta-table');
	assert.ok(html.includes('第1地区'));
	assert.ok(html.includes('小学校正門前'));
	assert.ok(html.includes('7:55 〜 8:25'));
	assert.ok(html.includes('月曜・水曜（祝日・学校休校日を除く）') || html.includes('月・水'));

	// 3. ヘッダー連絡事項 (sheet-msg-box)
	assert.ok(html.includes('class="sheet-msg-box"'), 'Should contain sheet-msg-box');
	assert.ok(html.includes('・旗振り終了後、〇をつけてください'));

	// 4. 多段組みシフト表 (columns-container, column-table-wrapper, table.schedule-table)
	assert.ok(html.includes('class="columns-container"'), 'Should contain columns-container');
	assert.ok(html.includes('class="column-table-wrapper"'), 'Should contain column-table-wrapper');
	assert.ok(html.includes('class="schedule-table"'), 'Should contain schedule-table');
	assert.ok(html.includes('月日(曜)'), 'Header should have 月日(曜)');
	assert.ok(html.includes('担当 / 事由'), 'Header should have 担当 / 事由');

	// 5. 状態別行スタイル (row-holiday, row-special, 通常)
	assert.ok(html.includes('class="row-holiday"'), 'Should format holiday row with row-holiday class');
	assert.ok(html.includes('創立記念日'));
	assert.ok(html.includes('class="row-special"'), 'Should format special row with row-special class');
	assert.ok(html.includes('badge-special') || html.includes('重点見守り日'));

	// 6. T-1: 空行パディングの厳密性検証 (total=5, numCols=3 -> itemsPerCol = Math.ceil(5/3) = 2)
	// 列1: 2件, 列2: 2件, 列3: 1件 + 1件空行パディング (<tr><td>&nbsp;</td><td></td></tr>)
	const paddingCount = (html.match(/<td>&nbsp;<\/td><td><\/td>/g) || []).length;
	assert.strictEqual(paddingCount, 1, 'Padding row should appear exactly once for 5 items in 3 columns');

	// 余り0件のテストケース (6件、3段組 -> 各2件、パディング0件)
	const sched6 = [
		...schedule,
		{ date: '2026-04-22', dayOfWeek: '水', type: 'regular', person: '加藤', note: '' }
	];
	const html6 = hata.buildHataPrintHtml(sched6, config);
	const paddingCount6 = (html6.match(/<td>&nbsp;<\/td><td><\/td>/g) || []).length;
	assert.strictEqual(paddingCount6, 0, 'No padding row when items divide evenly into columns');

	// 7. フッター連絡事項 (sheet-footer-box) & 校外委員連絡先 (sheet-contact-box)
	assert.ok(html.includes('sheet-footer-box'), 'Should contain sheet-footer-box');
	assert.ok(html.includes('●当番日に活動できない場合'));
	assert.ok(html.includes('class="sheet-contact-box"'), 'Should contain sheet-contact-box');
	assert.ok(html.includes('校外委員連絡先：鈴木'));
});

test('hata: generateHataSchedule includes holidays as rows, supports tilde ranges, and calculates stats (A-2, A-3, T-3)', () => {
	const config = {
		startDate: '2026-12-23',
		endDate: '2026-12-28',
		weekdays: [1, 2, 3, 4, 5],
		holidays: '2026-12-25〜2026-12-28,冬季休業', // 波線範囲指定
		specials: '2026-12-24,山田,重点警戒日', // 山田が特別枠を担当
		members: '山田\n佐藤',
		exemptHouseholds: []
	};

	const schedule = hata.generateHataSchedule(config);
	assert.ok(Array.isArray(schedule));

	// 12/23: 通常 (山田)
	// 12/24: 特別枠 (山田 - 特別枠指定)
	// 12/25: 祝日/休校日 (冬季休業) - 当番消費せず
	// 12/28: 祝日/休校日 (冬季休業)
	assert.strictEqual(schedule.length, 4);
	assert.strictEqual(schedule[0].date, '2026-12-23');
	assert.strictEqual(schedule[0].type, 'regular');
	assert.strictEqual(schedule[0].person, '山田');

	assert.strictEqual(schedule[1].date, '2026-12-24');
	assert.strictEqual(schedule[1].type, 'special');
	assert.strictEqual(schedule[1].person, '山田');

	assert.strictEqual(schedule[2].date, '2026-12-25');
	assert.strictEqual(schedule[2].type, 'holiday');
	assert.strictEqual(schedule[2].note, '冬季休業');

	assert.strictEqual(schedule[3].date, '2026-12-28');
	assert.strictEqual(schedule[3].type, 'holiday');
	assert.strictEqual(schedule[3].note, '冬季休業');

	// T-3: stats集計で山田の regular:1, special:1 を検証
	const stats = hata.calculateHataStats(schedule, ['山田', '佐藤']);
	assert.strictEqual(stats['山田'].regular, 1);
	assert.strictEqual(stats['山田'].special, 1);
	assert.strictEqual(stats['佐藤'].regular, 0);
	assert.strictEqual(stats['佐藤'].special, 0);

	// T-3: renderHataSummary UIテスト
	setupDomEnvironment();
	const summaryContainer = document.createElement('div');
	summaryContainer.id = 'hata-summary-container';
	document.body.appendChild(summaryContainer);

	hata.renderHataSummary(stats, summaryContainer);
	assert.ok(summaryContainer.innerHTML.includes('山田'));
	assert.ok(summaryContainer.innerHTML.includes('通常: 1回'));
	assert.ok(summaryContainer.innerHTML.includes('特別: 1回'));
	assert.ok(summaryContainer.innerHTML.includes('佐藤'));
	assert.ok(summaryContainer.innerHTML.includes('通常: 0回'));

	// メンバーなしのフォールバック
	hata.renderHataSummary({}, summaryContainer);
	assert.ok(summaryContainer.innerHTML.includes('メンバーが登録されていません'));

	// toggleHataSummary テスト
	const accordion = document.getElementById('hata-summary-accordion');
	const arrow = document.getElementById('hata-accordion-arrow');
	arrow.innerText = '▼';

	hata.toggleHataSummary();
	assert.ok(accordion.classList.contains('open'));
	assert.strictEqual(arrow.innerText, '▲');

	hata.toggleHataSummary();
	assert.strictEqual(accordion.classList.contains('open'), false);
	assert.strictEqual(arrow.innerText, '▼');
});

test('hata: precision branch booster to achieve 100% line and >95% branch coverage', () => {
	setupDomEnvironment();

	// 1. normalizeDateStr & expandDateOrRange 境界値
	assert.strictEqual(hata.normalizeDateStr(null), null);
	assert.strictEqual(hata.normalizeDateStr(''), null);
	assert.strictEqual(hata.normalizeDateStr('not-a-date'), null);
	assert.deepStrictEqual(hata.expandDateOrRange('invalid〜2026-05-01'), []);
	assert.deepStrictEqual(hata.expandDateOrRange('2026-05-01〜invalid'), []);

	// 2. generateHataSchedule: 不正日程、空行、配列祝日空要素、activeMembers空特別枠/通常枠
	assert.deepStrictEqual(hata.generateHataSchedule({ startDate: 'invalid', endDate: '2026-05-01' }), []);
	assert.deepStrictEqual(hata.generateHataSchedule({ startDate: '2026-05-01', endDate: 'invalid' }), []);
	assert.deepStrictEqual(hata.generateHataSchedule({ startDate: '2026-05-01' }), []); // endDate なし

	const edgeConfigAll = {
		startDate: '2026-05-01',
		endDate: '2026-05-03',
		weekdays: [1, 2, 3, 4, 5],
		holidays: '\n2026-05-01,\n  ,  \n', // 空行・空理由
		specials: '\n2026-05-02,\n2026-05-03,,\n', // 空行・担当者空（自動順送りだがメンバー0名）
		members: '', // メンバー0名
		exemptHouseholds: null,
		manualOverrides: {
			'2026-05-02': { person: '手動太郎', note: '調整', type: 'special', isSwapped: true, originalPerson: '元太郎' }
		}
	};
	const schedEdge = hata.generateHataSchedule(edgeConfigAll);
	assert.strictEqual(schedEdge.length, 3);
	assert.strictEqual(schedEdge[1].person, '手動太郎');
	assert.strictEqual(schedEdge[1].isSwapped, true);
	assert.strictEqual(schedEdge[1].originalPerson, '元太郎');
	assert.strictEqual(schedEdge[2].person, ''); // activeMembers なしで空

	// holidays が配列で null や name なし
	const schedHoliArr = hata.generateHataSchedule({
		startDate: '2026-05-01',
		endDate: '2026-05-01',
		weekdays: [5],
		holidays: [null, { date: '2026-05-01' }] // name なし
	});
	assert.strictEqual(schedHoliArr[0].note, '祝日');

	// 3. swapScheduleDates: config なし、manualOverrides 初期化
	hata.swapScheduleDates(null, '2026-05-01', 'A', '2026-05-02', 'B');
	const swapCfg = {};
	hata.swapScheduleDates(swapCfg, '2026-05-01', 'A', '2026-05-02', 'B');
	assert.strictEqual(swapCfg.manualOverrides['2026-05-01'].person, 'B');

	// 4. setDateOverride & clearDateOverride: config なし、manualOverrides 初期化
	hata.setDateOverride(null, '2026-05-01', {});
	const setCfg = {};
	hata.setDateOverride(setCfg, '2026-05-01', { person: 'C' });
	assert.strictEqual(setCfg.manualOverrides['2026-05-01'].person, 'C');

	hata.clearDateOverride(null, '2026-05-01');
	hata.clearDateOverride({}, '2026-05-01');
	hata.clearDateOverride(setCfg, '2026-05-01');
	assert.strictEqual(setCfg.manualOverrides['2026-05-01'], undefined);

	// 5. exportHataOfficialJson & importHataOfficialJson: null / 空 / オブジェクト直接
	const expNull = JSON.parse(hata.exportHataOfficialJson(null));
	assert.strictEqual(expNull.scheduleTitle, '登校見守り活動シフト表');
	assert.deepStrictEqual(hata.importHataOfficialJson(null), {});
	const impDirect = hata.importHataOfficialJson({ title: '直接オブジェクト', metaLocation: '地点A' });
	assert.strictEqual(impDirect.title, '直接オブジェクト');
	assert.strictEqual(impDirect.location, '地点A');

	// 6. calculateHataStats: 未登録メンバー（stats[item.person] 新規作成）、item.type なし/isSpecial なし、item.person === '-'
	const unlistedStats = hata.calculateHataStats([
		{ date: '2026-05-01', person: '外部役員', type: 'special' },
		{ date: '2026-05-02', person: '臨時保護者' }, // typeなし、isSpecialなし -> regular
		{ date: '2026-05-03', person: '-' }, // スキップ
		null
	], '登録メンバー'); // 文字列引数の members
	assert.strictEqual(unlistedStats['外部役員'].special, 1);
	assert.strictEqual(unlistedStats['臨時保護者'].regular, 1);
	assert.strictEqual(unlistedStats['登録メンバー'].regular, 0);

	assert.deepStrictEqual(hata.calculateHataStats(null, null), {});

	// 7. renderHataSummary: containerEl が渡されず、DOM にどちらの ID もない場合
	document.elements['hata-summary-container'] = null;
	document.elements['summaryContainer'] = null;
	hata.renderHataSummary({ テスト: { regular: 1, special: 0 } }); // 何も起きず正常終了

	// 8. toggleHataSummary: content なし、arrow なし
	document.elements['hata-summary-accordion'] = null;
	document.elements['summaryAccordion'] = null;
	hata.toggleHataSummary(); // 何も起きず正常終了

	const mockAcc = document.createElement('div');
	mockAcc.id = 'hata-summary-accordion';
	document.elements['hata-summary-accordion'] = mockAcc;
	document.elements['hata-accordion-arrow'] = null;
	document.elements['accordionArrow'] = null;
	hata.toggleHataSummary(); // arrow が null でも open トグル動作
	assert.ok(mockAcc.classList.contains('open'));

	// 9. buildHataPrintHtml: config が null, schedule が空, 全オプション網羅
	const emptySheet = hata.buildHataPrintHtml([], null);
	assert.ok(emptySheet.includes('シフトがまだ生成されていません'));

	// scheduleCreatedDate, scheduleTitle, contactMsg, weekdays が空配列 -> '指定なし'
	const customSheet = hata.buildHataPrintHtml([
		{ date: '2026-05-01', day: '金', person: '佐々木', type: 'regular', isSwapped: true },
		{ date: '2026-05-02', day: '土', person: '役員B', type: 'special', isSpecial: true, tag: '補導' },
		{ date: '2026-05-03', day: '日', person: '-', type: 'holiday', note: '憲法記念日' }
	], {
		scheduleTitle: 'カスタム見守り表',
		scheduleCreatedDate: '2026/05/01作成',
		district: '',
		location: '',
		time: '',
		weekdays: [], // 空配列 -> '指定なし'
		layoutColumns: 1,
		headerMsg: '',
		footerMsg: '',
		contactMsg: '連絡先: 担当役員'
	});
	assert.ok(customSheet.includes('カスタム見守り表'));
	assert.ok(customSheet.includes('指定なし'));
	assert.ok(customSheet.includes('連絡先: 担当役員'));
	assert.ok(customSheet.includes('badge-special'));
	assert.ok(customSheet.includes('交代'));

	// weekdays が null (非配列) の場合 -> デフォルト平日 [1,2,3,4,5]
	const nullWkSheet = hata.buildHataPrintHtml([
		{ date: '2026-05-01', day: '金', person: '佐々木', type: 'regular' }
	], { weekdays: null });
	assert.ok(nullWkSheet.includes('月曜・火曜・水曜・木曜・金曜'));

	// 10. renderHataSchedulePreview: previewContainer が null, explicitSchedule なしで district.hata なし
	document.elements['hata-schedule-preview'] = null;
	hata.renderHataSchedulePreview();

	const previewEl = document.createElement('div');
	previewEl.id = 'hata-schedule-preview';
	document.elements['hata-schedule-preview'] = previewEl;
	state.currentDistrict = {};
	hata.renderHataSchedulePreview();
	assert.ok(previewEl.innerHTML.includes('シフトがまだ生成されていません'));

	// 11. printHataSchedule: hataCurrentSchedule が空のときに runAutoHataGeneration を自動呼び出し
	state.currentDistrict = {
		hata: {
			startDate: '2026-06-01',
			endDate: '2026-06-05',
			weekdays: [1, 2, 3, 4, 5],
			members: '高橋'
		}
	};
	hata.printHataSchedule();

	// 12. renderHataCard & renderHataExemptList & toggleHataExempt & applyHataPeriodPreset
	state.currentDistrict = {};
	hata.renderHataCard();
	assert.ok(state.currentDistrict.hata.title);

	state.currentDistrict = { hata: null };
	hata.toggleHataExempt('key1', true);
	hata.toggleHataExempt('key1', false);

	state.currentDistrict = { hata: {} };
	hata.applyHataPeriodPreset('kouki');
	assert.strictEqual(state.currentDistrict.hata.startDate.slice(5), '10-01');
	hata.applyHataPeriodPreset('full');
	assert.strictEqual(state.currentDistrict.hata.startDate.slice(5), '04-06');
});

test('hata: default orientation must be portrait and layoutColumns must be 2', () => {
	setupDomEnvironment();
	state.currentDistrict = {};
	hata.renderHataCard();
	assert.strictEqual(state.currentDistrict.hata.orientation, 'portrait', 'Default orientation should be portrait');
	assert.strictEqual(state.currentDistrict.hata.layoutColumns, '2', 'Default layoutColumns should be 2');
});

test('hata: printHataSchedule dynamically sets document.title to shift table title and restores it', () => {
	setupDomEnvironment();
	const origTitle = 'テストアプリタイトル';
	document.title = origTitle;
	state.currentDistrict = {
		district: '1丁目',
		hata: {
			title: '1丁目 登校見守り活動シフト表',
			startDate: '2026-06-01',
			endDate: '2026-06-05',
			weekdays: [1, 2, 3, 4, 5],
			members: '高橋'
		}
	};

	let titleDuringPrint = '';
	global.window.print = () => {
		titleDuringPrint = document.title;
	};

	hata.printHataSchedule();
	assert.strictEqual(titleDuringPrint, '1丁目 登校見守り活動シフト表', 'Title during print should match hata.title');
	assert.strictEqual(document.title, origTitle, 'Title after print should be restored');
});
