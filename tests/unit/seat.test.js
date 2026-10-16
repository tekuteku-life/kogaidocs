const test = require('node:test');
const assert = require('node:assert');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');
const { createMockRepState } = require('../helpers/fixtures.js');

setupDomEnvironment();
const cryptoLib = require('../../js/crypto.js');
const state = require('../../js/state.js');
const utils = require('../../js/utils.js');
const seat = require('../../js/seat.js');

test('seat: getAllSzParticipantsForSeat lists facility, officers, neighborhood, and externals', () => {
	setupDomEnvironment();
	state.repState = createMockRepState();

	const participants = seat.getAllSzParticipantsForSeat();

	// Facilities
	assert(participants.some(p => p.key === "FAC_STAGE"));
	assert(participants.some(p => p.key === "FAC_DOOR"));
	assert(participants.some(p => p.key === "CUSTOM"));

	// Officers from selected districts
	assert(participants.some(p => p.key === "OFF_0_0"));
	assert(participants.some(p => p.key === "OFF_1_0"));
	// District 2 is selectedForPrint: false, so its officers should not be in list
	assert(!participants.some(p => p.key === "OFF_2_0"));

	// Neighborhood from selected districts
	assert(participants.some(p => p.key.startsWith("NEI_緑が丘_")));

	// Externals with attend: true
	assert(participants.some(p => p.key === "EXT_0")); // 校長
	// attend: false should not be present
	assert(!participants.some(p => p.key === "EXT_4")); // 交通課課長 (attend: false)
});

test('seat: swapSeatWindowCorridor swaps left and right bar labels', () => {
	setupDomEnvironment();
	state.repState = createMockRepState();

	assert.strictEqual(state.repState.seatConfig.leftSide, "窓側");
	assert.strictEqual(state.repState.seatConfig.rightSide, "廊下側");

	seat.swapSeatWindowCorridor();

	assert.strictEqual(state.repState.seatConfig.leftSide, "廊下側");
	assert.strictEqual(state.repState.seatConfig.rightSide, "窓側");
	assert.strictEqual(document.getElementById('seat-left-bar').textContent, "廊下側");
	assert.strictEqual(document.getElementById('seat-right-bar').textContent, "窓側");
});

test('seat: resizeSeatGrid clamps rows and cols to valid ranges', () => {
	setupDomEnvironment();
	state.repState = createMockRepState();

	// 1. Within range
	document.getElementById('seat-cols').value = "5";
	document.getElementById('seat-rows').value = "6";
	seat.resizeSeatGrid();
	assert.strictEqual(state.repState.seatConfig.cols, 5);
	assert.strictEqual(state.repState.seatConfig.rows, 6);

	// 2. Below minimum (cols min 2, rows min 2)
	document.getElementById('seat-cols').value = "1";
	document.getElementById('seat-rows').value = "1";
	seat.resizeSeatGrid();
	assert.strictEqual(state.repState.seatConfig.cols, 2);
	assert.strictEqual(state.repState.seatConfig.rows, 2);

	// 3. Above maximum (cols max 10, rows max 14)
	document.getElementById('seat-cols').value = "20";
	document.getElementById('seat-rows').value = "30";
	seat.resizeSeatGrid();
	assert.strictEqual(state.repState.seatConfig.cols, 10);
	assert.strictEqual(state.repState.seatConfig.rows, 14);
});

test('seat: renderSeatEditor and updateSeatCell', () => {
	setupDomEnvironment();
	state.repState = createMockRepState();
	state.repState.seatConfig.cols = 3;
	state.repState.seatConfig.rows = 2;

	seat.renderSeatEditor();
	const grid = document.getElementById('seat-grid-container');
	assert.strictEqual(grid.children.length, 6, "3 cols * 2 rows = 6 cells");

	// updateSeatCell
	seat.updateSeatCell("0_0", "refKey", "FAC_STAGE");
	seat.updateSeatCell("0_0", "customText", "司会者席");
	assert.strictEqual(state.repState.seatConfig.cells["0_0"].refKey, "FAC_STAGE");
	assert.strictEqual(state.repState.seatConfig.cells["0_0"].customText, "司会者席");

	// Update previously empty cell
	seat.updateSeatCell("1_2", "refKey", "CUSTOM");
	assert.strictEqual(state.repState.seatConfig.cells["1_2"].refKey, "CUSTOM");

	// Branch coverage: officer without han, officer with role only, officer with neither (skipped), external without name
	state.repState.districts = [
		{
			district: "北町",
			selectedForPrint: true,
			officers: [
				{ role: "書記", lastName: "", firstName: "", han: "" }, // role only, no name
				{ role: "", lastName: "", firstName: "" }, // neither -> skipped
				{ role: "", lastName: "坂本", firstName: "竜馬", han: "" } // name only, no role, no han
			]
		}
	];
	state.repState.szExternals = [
		{ attend: true, category: "その他", org: "自治連", role: "役員", lastName: "", firstName: "" }
	];
	state.repState.seatConfig.topLabel = "";
	state.repState.seatConfig.bottomLabel = "";
	state.repState.seatConfig.leftSide = "";
	state.repState.seatConfig.rightSide = "";

	const list2 = seat.getAllSzParticipantsForSeat();
	assert(list2.some(p => p.label.includes("（未定）")));
	assert(list2.some(p => p.label.includes("北町：書記")));
	assert(list2.some(p => p.label.includes("坂本 竜馬")));

	// Render editor with empty labels to test fallback branches
	seat.renderSeatEditor();
	assert.strictEqual(document.getElementById('seat-left-bar').textContent, "窓側");
	assert.strictEqual(document.getElementById('seat-right-bar').textContent, "廊下側");
});

