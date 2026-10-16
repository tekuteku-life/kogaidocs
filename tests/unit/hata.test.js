const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

setupDomEnvironment();
const hata = require('../../js/hata.js');
const state = require('../../js/state.js');
const utils = require('../../js/utils.js');

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

