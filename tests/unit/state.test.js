const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

setupDomEnvironment();
const utils = require('../../js/utils.js');
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');

test('state: initial defaults for currentDistrict and repState', () => {
	assert.strictEqual(state.currentDistrict.district, "");
	assert(Array.isArray(state.currentDistrict.officers));
	assert(Array.isArray(state.currentDistrict.neighborhood));
	assert(Array.isArray(state.currentDistrict.students));

	assert(Array.isArray(state.repState.districts));
	assert(Array.isArray(state.repState.szExternals));
	assert.strictEqual(state.repState.seatConfig.cols, 4);
	assert.strictEqual(state.repState.seatConfig.rows, 5);
});

test('state: saveDistrictLocal handles missing dName element', async () => {
	document.elements['d-name'] = null;
	const res = await state.saveDistrictLocal();
	assert.strictEqual(res, undefined);
});

test('state: saveDistrictLocal with officerBoxes and d-han-list', async () => {
	setupDomEnvironment();
	document.getElementById('d-name').value = "2丁目";
	document.getElementById('d-han-list').value = "A班, B班, A班";

	const container = document.getElementById('officers-container');
	container.innerHTML = `
		<div class="officer-item-box">
			<span class="officer-item-title">校外役員 1</span>
			<input type="text" data-field="lastName" value="小林">
			<input type="text" data-field="firstName" value="幸子">
			<input type="text" data-field="lastNameKana" value="こばやし">
			<input type="text" data-field="firstNameKana" value="さちこ">
			<select data-field="role"><option value="代表" selected>代表</option></select>
			<select data-field="han"><option value="A班" selected>A班</option></select>
			<input type="tel" data-field="tel" value="090-1234-5678">
			<input type="email" data-field="email" value="koba@example.com">
			<input type="text" data-field="address" value="2丁目3-4">
			<select data-field="childGrade"><option value="5" selected>5</option></select>
			<input type="text" data-field="childClass" value="2組">
			<input type="text" data-field="childLastName" value="小林">
			<input type="text" data-field="childFirstName" value="健太">
			<input type="text" data-field="childLastNameKana" value="こばやし">
			<input type="text" data-field="childFirstNameKana" value="けんた">
		</div>
	`;

	await state.saveDistrictLocal();

	assert.strictEqual(state.currentDistrict.district, "2丁目");
	assert.deepStrictEqual(state.currentDistrict.hanList, ["A班", "B班"]);
	assert.strictEqual(state.currentDistrict.han, "A班");
	assert.strictEqual(state.currentDistrict.officers.length, 1);
	const off = state.currentDistrict.officers[0];
	assert.strictEqual(off.lastName, "小林");
	assert.strictEqual(off.firstName, "幸子");
	assert.strictEqual(utils.getFullName(off), "小林 幸子");
	assert.strictEqual(utils.getChildFullName(off), "小林 健太");
	assert.strictEqual(off.childGrade, "5");
	assert.strictEqual(off.role, "代表");
	assert.strictEqual(off.han, "A班");

	// Header update
	const titleEl = container.querySelector('.officer-item-title');
	assert.strictEqual(titleEl.textContent, "校外役員 1（担当: A班）");
});

test('state: saveDistrictLocal fallback to d-han, empty officer fields, and saveNeighborLocal', async () => {
	setupDomEnvironment();
	document.getElementById('d-name').value = "3丁目";
	document.elements['d-han-list'] = null; // simulate absent d-han-list element
	document.getElementById('d-han').value = "北班";

	// Officer box with missing/empty fields and missing titleEl
	document.getElementById('officers-container').innerHTML = `
		<div class="officer-item-box">
			<input type="text" data-field="lastName" value="">
		</div>
	`;
	await state.saveDistrictLocal();
	assert.strictEqual(state.currentDistrict.district, "3丁目");
	assert.strictEqual(state.currentDistrict.han, "北班");
	assert.strictEqual(state.currentDistrict.officers[0].lastName, "");
	assert.strictEqual(state.currentDistrict.officers[0].han, "");

	// saveNeighborLocal test
	document.getElementById('neighbor-district-name').value = "南が丘町内会";
	state.neighborState = { district: "", neighborhood: [{ role: "会長", lastName: "田中" }] };
	await state.saveNeighborLocal();
	assert.strictEqual(state.neighborState.district, "南が丘町内会");
	assert.strictEqual(state.neighborState.neighborhood.length, 1);
});


test('state: saveRepLocal saves seatConfig labels and state to storage', async () => {
	setupDomEnvironment();
	document.getElementById('seat-top-label').value = "ステージ（演台）";
	document.getElementById('seat-bottom-label').value = "入口側";
	const topBar = document.getElementById('seat-top-bar-view');
	const bottomBar = document.getElementById('seat-bottom-bar-view');

	await state.saveRepLocal();

	assert.strictEqual(state.repState.seatConfig.topLabel, "ステージ（演台）");
	assert.strictEqual(state.repState.seatConfig.bottomLabel, "入口側");
	assert.strictEqual(topBar.textContent, "ステージ（演台）");
	assert.strictEqual(bottomBar.textContent, "入口側");
});

test('state: saveDistrictLocal enforces hard guard removing savedFilePassword when storage is not encrypted (Action Item A-2)', async () => {
	setupDomEnvironment();
	// Storage unencrypted
	localStorage.removeItem('kogai_auth_meta');
	state.currentDistrict.district = "ガードテスト地区";
	state.currentDistrict.savedFilePassword = "PlainSecret123!";
	document.getElementById('d-name').value = "ガードテスト地区";

	await state.saveDistrictLocal();

	assert.strictEqual(state.currentDistrict.savedFilePassword, undefined);
	const rawStored = JSON.parse(localStorage.getItem('kogai_district_v2') || '{}');
	assert.strictEqual(rawStored.savedFilePassword, undefined);
});
