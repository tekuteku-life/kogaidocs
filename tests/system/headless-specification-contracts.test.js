const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

test('UI specification print geometry: tent display face rotates 180 degrees and thirteen envelope recipients form two 3-by-4 grids', async () => {
	const out = await runInHeadlessChrome(async () => {
		const area = ui.element('#print-area');
		area.innerHTML = buildTentCardPageHtml('検証地区', '検証 花子', 'けんしょう はなこ', '校外委員');
		await ui.printMedia(true);
		const panels = [...area.querySelectorAll('.tent-panel')];
		assert.strictEqual(panels.length, 4, 'Four physical fold panels are rendered');
		const faces = panels.filter(panel => panel.querySelector('.tent-name'));
		assert.strictEqual(faces.length, 2, 'Two opposite readable faces are rendered');
		const upside = new DOMMatrix(getComputedStyle(faces[0]).transform);
		assert.ok(Math.abs(upside.a + 1) < 1e-6 && Math.abs(upside.d + 1) < 1e-6 && Math.abs(upside.b) < 1e-6 && Math.abs(upside.c) < 1e-6, 'The upper display face has an actual 180 degree transform');
		assert.strictEqual(getComputedStyle(faces[1]).transform, 'none', 'The lower display face remains upright');
		assert.ok(faces.every(face => face.textContent.includes('検証 花子')), 'Both faces carry the intended person');

		const officers = Array.from({ length: 13 }, (_, index) => ({ lastName: `役員${index}`, firstName: '花子', childLastName: `児童${index}`, childFirstName: '太郎', childGrade: '3', childClass: '2' }));
		area.innerHTML = buildEnvelopesPagesHtml([{ district: '配付地区', officers }]).join('');
		const grids = [...area.querySelectorAll('.address-grid')];
		assert.strictEqual(grids.length, 2, 'Thirteen recipients create two print pages');
		for (const [pageIndex, grid] of grids.entries()) {
			const cells = [...grid.querySelectorAll('.address-cell')];
			assert.strictEqual(cells.length, 12, 'Each actual grid has twelve physical cells');
			const style = getComputedStyle(grid);
			assert.strictEqual(style.display, 'grid', 'The print grid is active');
			assert.strictEqual(style.gridTemplateColumns.split(/\s+/).length, 3, 'Computed layout has three columns');
			assert.strictEqual(style.gridTemplateRows.split(/\s+/).length, 4, 'Computed layout has four rows');
			const rectangles = cells.map(cell => cell.getBoundingClientRect());
			assert.ok(rectangles.every(rect => rect.width > 0 && rect.height > 0), 'All padding and recipient cells occupy print layout space');
			const tolerance = 1;
			for (let index = 0; index < cells.length; index++) {
				const referenceColumn = rectangles[index % 3];
				const referenceRow = rectangles[Math.floor(index / 3) * 3];
				assert.ok(Math.abs(rectangles[index].left - referenceColumn.left) < tolerance, 'Envelope cell aligns to its expected column');
				assert.ok(Math.abs(rectangles[index].top - referenceRow.top) < tolerance, 'Envelope cell aligns to its expected row');
			}
			assert.strictEqual(cells.filter(cell => cell.querySelector('.addr-child')).length, pageIndex === 0 ? 12 : 1, 'The second grid carries the remaining single recipient');
		}
		assert.ok(grids[1].querySelector('.addr-child').textContent.includes('児童12 太郎'), 'The thirteenth recipient appears on the second page');
		await ui.printMedia(false);
	});
	assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }));
	assert.deepEqual(out.errors, [], 'No browser exceptions or asynchronous rejections');
	assert.ok(out.results.length > 0 && out.results.every(result => result.passed), 'The browser executes every print geometry assertion');
});

function specificationTest(name, scenario, options = {}) {
	test(name, async () => {
		const out = await runInHeadlessChrome(scenario, options);
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }));
		assert.deepEqual(out.errors, [], 'No browser exceptions or asynchronous rejections');
		assert.ok(out.results.length > 0 && out.results.every(result => result.passed));
	});
}

for (const width of [375, 768, 1280]) {
	specificationTest(`UI specification flag settings: ${width}px copy controls and four metadata groups follow their responsive layout`, async () => {
		await ui.expand('district');
		await ui.click('#card-d-hata summary');
		const copyRow = ui.element('.hata-text-copy-row');
		const groups = [...ui.element('.hata-details-grid').children];
		assert.strictEqual(groups.length, 4, 'Four distinct flag metadata groups exist');
		const expected = ['hata-holidays', 'hata-specials', 'hata-header-msg', 'hata-footer-msg'];
		for (let index = 0; index < groups.length; index++) {
			assert.ok(groups[index].contains(ui.element(`#${expected[index]}`)), 'Each metadata group contains its intended input');
		}
		const tolerance = 1;
		if (innerWidth <= 600) {
			assert.strictEqual(getComputedStyle(copyRow).display, 'flex', 'Mobile copy row uses flex layout');
			assert.strictEqual(getComputedStyle(copyRow).flexDirection, 'column', 'Mobile copy controls stack vertically');
			const controls = [...copyRow.children];
			assert.strictEqual(controls.length, 3, 'Format, deduplication and copy controls remain available');
			assert.strictEqual(controls[0].id, 'hata-format', 'Format input is first');
			assert.ok(controls[1].contains(ui.element('#hata-dedup')), 'Deduplication is second');
			assert.strictEqual(controls[2].dataset.click, 'copyHataList', 'Copy action is last');
			const rectangles = controls.map(control => control.getBoundingClientRect());
			assert.ok(rectangles.every(rectangle => rectangle.width > 0 && rectangle.height > 0), 'All mobile copy controls have visible layout boxes');
			for (let index = 1; index < rectangles.length; index++) {
				assert.ok(rectangles[index].top >= rectangles[index - 1].bottom - tolerance, 'Mobile copy controls never overlap vertically');
				assert.ok(Math.abs(rectangles[index].left - rectangles[0].left) <= tolerance, 'Mobile controls share the same left edge');
			}
		} else {
			const grid = ui.element('.hata-details-grid');
			assert.strictEqual(getComputedStyle(grid).display, 'grid', 'Desktop metadata groups use a grid');
			assert.strictEqual(getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length, 2, 'Desktop metadata grid has two computed columns');
			const rectangles = groups.map(group => group.getBoundingClientRect());
			assert.ok(rectangles.every(rectangle => rectangle.width > 0 && rectangle.height > 0), 'Every metadata group has a visible layout box');
			assert.ok(Math.abs(rectangles[0].top - rectangles[1].top) <= tolerance, 'Holidays and specials share the first row');
			assert.ok(Math.abs(rectangles[2].top - rectangles[3].top) <= tolerance, 'Header and footer share the second row');
			assert.ok(Math.abs(rectangles[0].left - rectangles[2].left) <= tolerance, 'Holidays and header share the first column');
			assert.ok(Math.abs(rectangles[1].left - rectangles[3].left) <= tolerance, 'Specials and footer share the second column');
			assert.ok(rectangles[1].left >= rectangles[0].right - tolerance, 'Two columns do not overlap');
			assert.ok(rectangles[2].top >= Math.max(rectangles[0].bottom, rectangles[1].bottom) - tolerance, 'The lower row follows the complete upper row');
		}
	}, { viewport: [width, 900] });
}

specificationTest('UI specification saving cards: district, representative and neighbor have four ordered sections inside the final workflow card', async () => {
	for (const config of [
		{ mode: 'district', card: 'card-d-file', sections: ['sec-d-pass', 'sec-d-save-share', 'sec-d-load', 'sec-d-year'], controls: ['#d-pass', '[data-click="exportDistrictTxt"]', '#d-file-in', '[data-click="runDistrictYearUpdate"]'] },
		{ mode: 'rep', card: 'card-rep-file', sections: ['sec-rep-pass', 'sec-rep-import', 'sec-rep-export', 'sec-rep-year'], controls: ['#rep-pass', '#rep-files', '[data-click="exportRepMasterTxt"]', '[data-click="runRepYearUpdate"]'] },
		{ mode: 'neighbor', card: 'card-n-file', sections: ['sec-n-pass', 'sec-n-save-share', 'sec-n-load', 'sec-n-year'], controls: ['#neighbor-pass', '[data-click="exportNeighborTxt"]', '#neighbor-file-input', '[data-click="runNeighborYearUpdate"]'] }
	]) {
		await ui.mode(config.mode);
		await ui.expand(config.mode);
		const tab = ui.element(`#tab-${config.mode}`);
		const card = ui.element(`#${config.card}`);
		const cards = [...tab.querySelectorAll(':scope > .card')];
		assert.ok(cards.length > 1, 'Daily workflow cards precede each saving card');
		assert.strictEqual(cards.at(-1), card, 'Saving and handoff card is the last card in the active mode');
		const body = card.querySelector(':scope > .card-body');
		assert.ok(body, 'The saving card has a real card body');
		const sections = [...body.querySelectorAll(':scope > [id^="sec-"]')];
		assert.strictEqual(sections.map(section => section.id).join(','), config.sections.join(','), 'Four sections belong directly to this card body in the specified order');
		for (let index = 0; index < sections.length; index++) {
			assert.strictEqual(document.querySelectorAll(`#${config.sections[index]}`).length, 1, 'Section IDs are unique in the actual document');
			assert.ok(sections[index].querySelector(config.controls[index]), 'Each section contains its actual password, import, export or rollover control');
			const rectangle = sections[index].getBoundingClientRect();
			assert.ok(rectangle.width > 0 && rectangle.height > 0, 'Expanded workflow section has a visible box');
			if (index > 0) assert.ok(rectangle.top >= sections[index - 1].getBoundingClientRect().bottom - 1, 'Sections retain their visible vertical order without overlap');
		}
	}
});
