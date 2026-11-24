const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

// R-26・E-15・I-15-06: 実Chromium（file 起動、E-14-01 の CSP と Trusted Types）で、描画の多層防御を確かめる。
// - アプリの通常の描画（全モード・モーダル・帳票・印刷・パスワードの確認の表示・狭い画面幅）で、CSP 違反と描画の補助の取り除きが0件であること。
// - 移し先のクラスが、従来の style 属性と同じ効果を持つこと（クラスを外して同じ宣言を CSSOM で要素のスタイルに設定したときと computed style が同じ）。
// - Trusted Types の強制、描画の補助の取り除き、印刷の向き、表示の切替。
const root = path.resolve(__dirname, '../..');
const fixtures = fs.readFileSync(path.join(root, 'tests/helpers/fixtures.js'), 'utf8');

/** css/style.css の移し先のクラスの宣言（名前 → [プロパティ, 値] の一覧）。 */
function migratedClasses() {
	const map = {};
	for (const line of fs.readFileSync(path.join(root, 'css/style.css'), 'utf8').split('\n')) {
		const found = line.match(/^\.(us?-[a-z0-9_-]+):not\(#_\):not\(#_\):not\(#_\) \{ ([^{}]+) \}$/);
		if (found) map[found[1]] = found[2].split(';').map(part => part.trim()).filter(Boolean).map(part => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1).trim()]);
	}
	return map;
}

/** ページの読込の前に、CSP 違反と描画の補助の取り除きの記録を集める。 */
function recordRendering() {
	window.__renderViolations = [];
	document.addEventListener('securitypolicyviolation', event => window.__renderViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
	window.__renderRemovals = [];
	const original = console.error;
	console.error = (...args) => {
		if (args[0] === 'renderHtml removed') window.__renderRemovals.push(args[1]);
		return original.apply(console, args);
	};
}

/**
 * 全モード・モーダル・帳票・印刷の状態を順に作り、状態ごとに check(label) を呼ぶ試験関数を作る。
 * check は、移し先のクラスの効果を確かめる（CLASSES を与えたとき）。
 */
function scenario({ classes }) {
	return new Function(`return async () => {
		${fixtures}
		const CLASSES = ${JSON.stringify(classes || null)};
		window.alert = () => {};
		window.confirm = () => true;
		const checked = [];
		const check = label => {
			checked.push(label);
			if (!CLASSES) return;
			const elements = [...document.querySelectorAll('[class]')].filter(el => [...el.classList].some(name => CLASSES[name]));
			for (const el of elements) {
				const names = [...el.classList].filter(name => CLASSES[name]);
				const snapshot = target => { const cs = getComputedStyle(target); const out = {}; for (let i = 0; i < cs.length; i++) out[cs[i]] = cs.getPropertyValue(cs[i]); return out; };
				const withClasses = snapshot(el);
				const own = new Set(Array.from({ length: el.style.length }, (_, i) => el.style[i]));
				const added = [];
				el.classList.remove(...names);
				// 従来の style 属性と同じ優先の順位（要素のスタイル）で、同じ宣言を設定する。スクリプトが設定済みのプロパティは設定しない。
				for (const name of names) for (const [property, value] of CLASSES[name]) {
					if (own.has(property)) continue;
					el.style.setProperty(property, value);
					added.push(property);
				}
				const withInline = snapshot(el);
				for (const property of added) el.style.removeProperty(property);
				el.classList.add(...names);
				const differences = Object.keys(withClasses).filter(property => withClasses[property] !== withInline[property]);
				assert.strictEqual(JSON.stringify(differences), '[]', label + ': ' + names.join(' ') + ' has the effect of its declarations on ' + el.tagName + (el.id ? '#' + el.id : ''));
			}
		};
		const typePass = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
		window.print = () => check('print ' + window.__printLabel);
		const printed = async (label, run) => { window.__printLabel = label; await ui.printMedia(true); try { run(); } finally { await ui.printMedia(false); } };

		check('district initial');
		currentDistrict = createMockDistrict();
		renderDistrictForm();
		setAllCardsCollapse(false, 'tab-district');
		check('district data');
		currentDistrict.hata = Object.assign(currentDistrict.hata || {}, { title: '旗振り', location: '正門', startDate: '2026-04-06', endDate: '2026-04-17', weekdays: [1, 2, 3, 4, 5], layoutColumns: 2, orientation: 'landscape' });
		renderDistrictForm();
		ui.fill('#hata-members', '山田花子\\n佐藤一郎\\n鈴木次郎');
		renderHataSchedulePreview();
		check('district hata');
		typePass('d-pass', 'short');
		check('district password short');
		typePass('d-pass', 'LongPassword123'); typePass('d-pass-confirm', 'LongPassword124');
		check('district password mismatch');
		typePass('d-pass-confirm', 'LongPassword123');
		check('district password match');
		for (const id of ['d-print-students', 'd-print-neighbors', 'd-print-school', 'd-print-pta']) ui.element('#' + id).checked = true;
		await printed('district reports', () => printSingleDistrictSelected());
		await printed('hata sheet', () => printHataSchedule());

		repState = createMockRepState();
		switchTab('rep');
		renderRepAll();
		setAllCardsCollapse(false, 'tab-rep');
		check('rep data');
		typePass('rep-pass', 'LongPassword123'); typePass('rep-pass-confirm', 'LongPassword124');
		check('rep password mismatch');
		openRepDistrictDetailModal(0);
		check('rep detail modal');
		closeRepDistrictDetailModalWithoutSaving();
		openAddDistrictModal();
		showAddDistrictNameTooLong();
		check('rep add modal');
		closeAddDistrictModal();
		for (const el of document.querySelectorAll('.rep-print-chk')) el.checked = true;
		await printed('rep reports', () => executeRepSelectedPrint());

		switchTab('neighbor');
		neighborState = { district: '1丁目自治会', neighborhood: createMockDistrict().neighborhood.map(item => Object.assign({ email: 'a@example.com', note: '備考' }, item)) };
		renderNeighborForm();
		setAllCardsCollapse(false, 'tab-neighbor');
		check('neighbor data');
		typePass('neighbor-pass', 'LongPassword123'); typePass('neighbor-pass-confirm', 'LongPassword124');
		check('neighbor password mismatch');
		await printed('neighbor roster', () => printNeighborRoster());
		await printed('neighbor tent cards', () => printNeighborTentCards());

		switchTab('transfer');
		addTransferChildRow();
		check('transfer data');
		openStorageSettingsModal();
		check('settings modal');
		closeStorageSettingsModal();
		switchTab('district');
		handleImmediateLock();
		check('locked');
		await ui.printMedia(true);
		check('locked print media');
		await ui.printMedia(false);
		assert.ok(checked.length >= 20, 'Every state is checked: ' + checked.join(', '));
		assert.strictEqual(JSON.stringify(window.__renderViolations), '[]', 'No state violates the CSP');
		assert.strictEqual(JSON.stringify(window.__renderRemovals), '[]', 'The render helper removes nothing from the application markup');
	};`)();
}

for (const viewport of [[1280, 900], [375, 800]]) {
	test(`UI R-26: every screen, modal, report and print renders with no CSP violation or removal at ${viewport[0]}px`, async () => {
		const out = await runInHeadlessChrome(scenario({}), { queryMode: 'district', viewport, beforeLoad: recordRendering });
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }, null, 2));
		assert.deepEqual(out.errors, []);
	});
}

test('UI R-26: every migrated class has the effect of its declarations as an element style in every state', async () => {
	const classes = migratedClasses();
	assert.ok(Object.keys(classes).length > 100, 'The migrated classes are read from css/style.css');
	const out = await runInHeadlessChrome(scenario({ classes }), { queryMode: 'district', beforeLoad: recordRendering, timeoutMs: 120000 });
	assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed).slice(0, 10) }, null, 2));
	assert.deepEqual(out.errors, []);
	assert.ok(out.results.length > 500, 'Many migrated elements are compared: ' + out.results.length);
});

test('UI R-26: Trusted Types is enforced and only the kogai policy exists', async () => {
	const out = await runInHeadlessChrome(async () => {
		const errorName = fn => { try { fn(); return null; } catch (error) { return error.name; } };
		const host = document.createElement('div');
		document.body.appendChild(host);
		assert.strictEqual(errorName(() => { host.innerHTML = '<b>x</b>'; }), 'TypeError', 'A string innerHTML is rejected');
		assert.strictEqual(errorName(() => { host.innerHTML = ''; }), 'TypeError', 'Even an empty string innerHTML is rejected');
		assert.strictEqual(errorName(() => host.insertAdjacentHTML('beforeend', '<b>x</b>')), 'TypeError', 'insertAdjacentHTML is rejected');
		assert.strictEqual(errorName(() => new DOMParser().parseFromString('<b>x</b>', 'text/html')), 'TypeError', 'DOMParser is rejected');
		assert.strictEqual(errorName(() => document.createRange().createContextualFragment('<b>x</b>')), 'TypeError', 'createContextualFragment is rejected');
		assert.strictEqual(errorName(() => trustedTypes.createPolicy('kogai', { createHTML: value => value })), 'TypeError', 'A second kogai policy cannot be created');
		assert.strictEqual(errorName(() => trustedTypes.createPolicy('other', { createHTML: value => value })), 'TypeError', 'Another policy name cannot be created');
		assert.ok(trustedServiceWorkerUrl() instanceof TrustedScriptURL, 'The service worker URL is a TrustedScriptURL');
		assert.strictEqual(String(trustedServiceWorkerUrl()), './sw.js');
		assert.strictEqual(host.childNodes.length, 0, 'Nothing was inserted');
	}, { queryMode: 'transfer' });
	assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }, null, 2));
	assert.deepEqual(out.errors, []);
});

test('UI R-26: the render helper removes injected markup so nothing loads, runs, styles or navigates', async () => {
	const out = await runInHeadlessChrome(async () => {
		const host = document.createElement('div');
		host.id = 'render-probe';
		document.body.appendChild(host);
		const before = location.href;
		const attack = [
			'<span class="keep" style="color: rgb(255, 0, 0)" onclick="window.__attackClick = 1" data-a_b="x" spellcheck="true">文</span>',
			'<img src="http://127.0.0.1:9/attack.png" onerror="window.__attackRun = 1">',
			'<a href="https://example.com/">リンク</a>',
			'<svg><script>window.__attackRun = 2</script><a href="https://example.com/">s</a></svg>',
			'<template><img src="http://127.0.0.1:9/t.png"></template>',
			'<form action="https://example.com/"><input type="submit"></form>',
			'<meta http-equiv="refresh" content="0;url=https://example.com/">',
			'<link rel="stylesheet" href="http://127.0.0.1:9/attack.css">',
			'<iframe srcdoc="<p>x</p>"></iframe>',
			'<style>.keep { color: rgb(0, 0, 255) !important; }</style>',
			'<script>window.__attackRun = 3</script>',
			'<input type="file"><input type="image" src="http://127.0.0.1:9/i.png">',
			'<!-- comment --><math><mi>x</mi></math>'
		].join('');
		const report = renderHtml(host, attack);
		const keep = host.querySelector('.keep');
		assert.ok(keep, 'The allowed element remains');
		assert.strictEqual(keep.getAttribute('style'), null, 'style is removed');
		assert.strictEqual(keep.getAttribute('onclick'), null, 'onclick is removed');
		assert.strictEqual(keep.getAttribute('data-a_b'), null, 'An invalid data- name is removed');
		assert.strictEqual(keep.getAttribute('spellcheck'), null, 'spellcheck="true" is removed');
		assert.strictEqual(getComputedStyle(keep).color === 'rgb(255, 0, 0)' || getComputedStyle(keep).color === 'rgb(0, 0, 255)', false, 'No injected style applies');
		const copy = keep.cloneNode(true);
		host.appendChild(copy);
		assert.ok(getComputedStyle(copy).color !== 'rgb(255, 0, 0)', 'A clone of the rendered element has no injected style');
		assert.strictEqual(JSON.stringify([...host.querySelectorAll('*')].map(el => el.tagName.toLowerCase())), JSON.stringify(['span', 'input', 'input', 'span']), 'Only allowed elements remain: ' + host.innerHTML);
		assert.strictEqual(JSON.stringify([...host.querySelectorAll('input')].map(el => el.getAttribute('type'))), '[null,null]', 'type="file" and type="image" are removed');
		assert.ok(!host.innerHTML.includes('src=') && !host.innerHTML.includes('href='), 'No URL attribute remains');
		for (const name of ['img', 'a', 'svg', 'template', 'form', 'meta', 'link', 'iframe', 'style', 'script', 'math', '#comment']) assert.ok(report.elements.includes(name), 'Reported ' + name);
		for (const name of ['style', 'onclick', 'data-a_b', 'spellcheck', 'type', 'src']) assert.ok(report.attributes.includes(name), 'Reported attribute ' + name);
		ui.element('#render-probe .keep').click();
		await new Promise(resolve => setTimeout(resolve, 200));
		assert.strictEqual(window.__attackRun, undefined, 'No injected script runs');
		assert.strictEqual(window.__attackClick, undefined, 'No injected handler runs');
		assert.strictEqual(location.href, before, 'The page does not navigate');
		// 解析の時点の style 属性の拒否（template の中の style 属性は style-src-attr として報告される）のほかに、違反はない。
		assert.strictEqual(JSON.stringify(window.__renderViolations.filter(event => !(event.directive === 'style-src-attr' && event.blocked === 'inline'))), '[]', 'Nothing is requested or run: ' + JSON.stringify(window.__renderViolations));
		assert.strictEqual(window.__renderViolations.filter(event => event.directive === 'style-src-attr').length, 1, 'One style attribute is reported when parsed');
	}, { queryMode: 'transfer', beforeLoad: recordRendering, observeNetwork: true, settle: async observed => {
		const external = observed.requests.filter(request => request.url.startsWith('http') || request.url.includes('attack'));
		assert.deepEqual(external.map(request => request.url), [], 'No request is made for the injected resources');
	} });
	assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }, null, 2));
	assert.deepEqual(out.errors, []);
});

test('UI R-26: inline style and style elements inserted outside Trusted Types are refused by the CSP', async () => {
	const out = await runInHeadlessChrome(async () => {
		const probe = document.createElement('div');
		probe.id = 'csp-style-probe';
		probe.textContent = 'probe';
		document.body.appendChild(probe);
	}, { queryMode: 'transfer', beforeLoad: recordRendering, settle: async ({ send, evaluate }) => {
		const { root: documentNode } = await send('DOM.getDocument', { depth: 0 });
		const { nodeId } = await send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#csp-style-probe' });
		await send('DOM.setOuterHTML', { nodeId, outerHTML: '<div id="csp-style-probe" style="color: rgb(255, 0, 0)">probe</div><style>#csp-style-probe { background-color: rgb(0, 0, 255); }</style>' });
		await evaluate(async () => {
			await ui.waitFor(() => ['style-src-attr', 'style-src-elem'].every(directive => window.__renderViolations.some(event => event.directive === directive && event.blocked === 'inline')), 'Both inline style forms are refused');
			const style = getComputedStyle(ui.element('#csp-style-probe'));
			assert.ok(style.color !== 'rgb(255, 0, 0)' && style.backgroundColor !== 'rgb(0, 0, 255)', 'Neither inline style applies');
		});
	} });
	assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }, null, 2));
});

test('UI R-26: the landscape page sheet applies only while a landscape hata sheet prints', async () => {
	const out = await runInHeadlessChrome(async () => {
		await ui.expand('district');
		ui.fill('#hata-start-date', '2026-10-19');
		ui.fill('#hata-end-date', '2026-10-23');
		ui.fill('#hata-members', '山田花子\n佐藤一郎');
		const sheet = ui.element('#hata-print-landscape');
		assert.strictEqual(sheet.media, 'not all', 'The landscape sheet is inactive before printing');
		const pageRules = [...sheet.sheet.cssRules].filter(rule => rule instanceof CSSPageRule);
		assert.strictEqual(pageRules.length, 1, 'The sheet has one page rule');
		assert.strictEqual(pageRules[0].style.getPropertyValue('size').toLowerCase(), 'a4 landscape', 'The page is A4 landscape');
		const seen = [];
		window.print = () => seen.push(sheet.media);
		for (const orientation of ['landscape', 'portrait']) {
			ui.fill('#hata-orientation', orientation);
			await ui.printMedia(true);
			printHataSchedule();
			await ui.printMedia(false);
			assert.strictEqual(sheet.media, 'not all', 'The sheet is turned off after printing ' + orientation);
		}
		assert.strictEqual(JSON.stringify(seen), JSON.stringify(['print', 'not all']), 'The sheet applies only to the landscape print');
		assert.strictEqual(document.querySelectorAll('style').length, 0, 'No style element is added');
	}, { queryMode: 'district', allowFileAccess: true });
	assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }, null, 2));
	assert.deepEqual(out.errors, []);
});

test('UI R-26: elements hidden by a class open on the first toggle, and Escape leaves a closed add-district dialog untouched', async () => {
	const out = await runInHeadlessChrome(async () => {
		await ui.expand('district');
		const panel = ui.element('#d-paste-panel');
		assert.strictEqual(getComputedStyle(panel).display, 'none', 'The paste panel starts hidden');
		await ui.click('#btn-load-district-paste');
		assert.strictEqual(getComputedStyle(panel).display, 'block', 'The first click shows the paste panel');
		await ui.click('#btn-load-district-paste');
		assert.strictEqual(getComputedStyle(panel).display, 'none', 'The second click hides it');
		await ui.mode('rep');
		const name = ui.element('#rep-new-district-name');
		name.value = '入力中の地区名';
		await ui.key('Escape');
		assert.strictEqual(name.value, '入力中の地区名', 'Escape does not close a dialog that is not open');
		openAddDistrictModal();
		ui.element('#rep-new-district-name').value = '入力中の地区名';
		await ui.key('Escape');
		assert.strictEqual(getComputedStyle(ui.element('#rep-add-district-modal')).display, 'none', 'Escape closes the open dialog');
		assert.strictEqual(ui.element('#rep-new-district-name').value, '', 'Closing clears the name');
	}, { queryMode: 'district' });
	assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, failures: out.results.filter(result => !result.passed) }, null, 2));
	assert.deepEqual(out.errors, []);
});
