const test = require('node:test');
const assert = require('node:assert/strict');
const { runInHeadlessChrome } = require('./helpers/headless-runner');

// CSP違反は起動前から収集し、正常操作と意図的な拒否試験を区別する。
function securityPreload() {
	window.__securityViolations = [];
	document.addEventListener('securitypolicyviolation', event => {
		window.__securityViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
	});
}

function prepareSecurity() {
	window.security = {
		attack: `O'Neil "<img data-security-attack src=x onerror="window.__securityExecuted=1"> & <form data-security-attack id="storage-lock-modal"></form><style data-security-attack>body{display:none}</style>`,
		password: 'SecurityPass1!',
		passwordFields(id) {
			ui.fill(`#${id}`, this.password);
			ui.fill(`#${id}-confirm`, this.password);
		},
		noAttackDOM() {
			assert.strictEqual(document.querySelectorAll('[data-security-attack]').length, 0, 'Untrusted text never creates attack elements');
			assert.strictEqual(window.__securityExecuted, undefined, 'Untrusted text never executes');
			assert.strictEqual(document.querySelectorAll('#storage-lock-modal').length, 1, 'Untrusted text never clobbers the lock modal');
		},
		noPolicyViolations() {
			assert.strictEqual(__securityViolations.length, 0, 'Normal application operations satisfy CSP');
		},
		district() {
			return {
				district: '安全地区', han: '1班', hanList: ['1班'], selectedForPrint: true,
				officers: [{ role: '校外委員', han: '1班', lastName: this.attack, firstName: '通常役員' }],
				students: [{ grade: '3', class: '1', han: '1班', lastName: this.attack, firstName: '通常児童', address: '101', tel: '090-1234-5678' }],
				neighborhood: [{ role: '会長', lastName: this.attack, firstName: '通常会長', tel: '090-1234-5678' }],
				szNeighborChecks: { 0: true }
			};
		},
		async encrypt() {
			await ui.click('#storage-security-badge');
			this.passwordFields('modal-set-pass');
			await ui.click('#modal-btn-enable-enc');
			await ui.waitFor(() => !ui.visible('#storage-settings-modal'), 'Storage encryption finishes');
			assert.ok(isStorageEncrypted() && isStorageUnlocked(), 'Real storage encryption active');
		},
		async districtPrint() {
			ui.capturePrints();
			await ui.click('[data-click="printSingleDistrictSelected"]');
			assert.strictEqual(__prints.length, 1, 'District print pipeline invoked');
			assert.ok(ui.element('#print-area').textContent.includes(this.attack), 'Printed names preserve the original text');
			this.noAttackDOM();
			this.noPolicyViolations();
		}
	};
}

function securityTest(name, fn, options = {}) {
	test(name, async () => {
		const beforeLoad = new Function(`(${securityPreload.toString()})();${options.beforeLoad ? `(${options.beforeLoad.toString()})();` : ''}`);
		const out = await runInHeadlessChrome(fn, { ...options, beforeLoad, prepare: prepareSecurity });
		assert.equal(out.success, true, JSON.stringify({ fatal: out.fatal, errors: out.errors, failures: out.results.filter(result => !result.passed) }, null, 2));
		assert.deepEqual(out.errors, [], 'No uncaught browser errors');
		assert.ok(out.results.length > 0 && out.results.every(result => result.passed), 'Browser assertions execute and pass');
	});
}

securityTest('Security stored XSS: plaintext seat dimensions cannot become print markup on startup', async () => {
	assert.ok(Number.isInteger(repState.seatConfig.cols) && repState.seatConfig.cols >= 2 && repState.seatConfig.cols <= 10, 'Invalid saved dimensions never enter application state');
	await ui.mode('rep');
	await ui.expand('rep');
	ui.capturePrints();
	await ui.click('[data-click="setRepPrintChecks"][data-flag="false"]');
	await ui.click('.rep-print-chk[value="sz_seats"]');
	await ui.click('[data-click="executeRepSelectedPrint"]');
	security.noAttackDOM();
	assert.ok(!ui.element('#print-area').querySelector('img, form, iframe, script'), 'Saved dimensions cannot inject printable nodes');
}, { beforeLoad: () => {
	localStorage.setItem('kogai_rep_v2', JSON.stringify({ districts: [], szExternals: [], seatConfig: {
		cols: '2, 1fr);"><img data-security-attack src=x onerror="window.__securityExecuted=1"><div style="x:', rows: 2, cells: {}
	} }));
} });

for (const encrypted of [false, true]) {
	securityTest(`Security storage schema: ${encrypted ? 'encrypted' : 'plaintext'} malformed columns preserve live state and DOM`, async () => {
		await ui.mode('district');
		await ui.expand('district');
		ui.fill('#d-name', '保持する地区');
		await ui.mode('rep');
		await ui.expand('rep');
		ui.fill('#seat-top-label', '保持する会場');
		if (window.__encryptedCase) await security.encrypt();
		const before = JSON.stringify({ currentDistrict, repState, neighborState, transferState });
		const bad = { districts: [], szExternals: [], seatConfig: { cols: '2"><img data-security-attack src=x onerror="window.__securityExecuted=1">', rows: 2, cells: {} } };
		await saveStorageData('kogai_rep_v2', bad);
		const stored = localStorage.getItem('kogai_rep_v2');
		if (window.__encryptedCase) assert.ok(stored.startsWith('STORAGE_ENC:'), 'Authenticated malformed storage uses real encryption');
		try { await loadAppDataFromStorage(); } catch (_) {}
		assert.strictEqual(JSON.stringify({ currentDistrict, repState, neighborState, transferState }), before, 'Rejected restoration never partially updates live models');
		assert.strictEqual(ui.element('#d-name').value, '保持する地区', 'District DOM preserved');
		assert.strictEqual(ui.element('#seat-top-label').value, '保持する会場', 'Seat DOM preserved');
		assert.strictEqual(localStorage.getItem('kogai_rep_v2'), stored, 'Rejected restoration never overwrites the source');
		security.noAttackDOM();
	}, { beforeLoad: new Function(`window.__encryptedCase = ${encrypted};`) });
}

for (const encrypted of [false, true]) {
	securityTest(`Security storage schema: ${encrypted ? 'encrypted' : 'plaintext'} non-string saved password preserves live state and DOM`, async () => {
		await ui.mode('district');
		await ui.expand('district');
		ui.fill('#d-name', '保持する地区');
		if (window.__encryptedCase) await security.encrypt();
		const before = JSON.stringify({ currentDistrict, repState, neighborState, transferState });
		const bad = { district: '拒否する地区', officers: [], students: [], neighborhood: [], savedFilePassword: { toString: null } };
		await saveStorageData('kogai_district_v2', bad);
		const stored = localStorage.getItem('kogai_district_v2');
		if (window.__encryptedCase) assert.ok(stored.startsWith('STORAGE_ENC:'), 'Authenticated malformed storage uses real encryption');
		try { await loadAppDataFromStorage(); } catch (_) {}
		assert.strictEqual(JSON.stringify({ currentDistrict, repState, neighborState, transferState }), before, 'Rejected restoration never partially updates live models');
		assert.strictEqual(ui.element('#d-name').value, '保持する地区', 'District DOM preserved');
		assert.strictEqual(localStorage.getItem('kogai_district_v2'), stored, 'Rejected restoration never overwrites the source');
		security.noAttackDOM();
	}, { beforeLoad: new Function(`window.__encryptedCase = ${encrypted};`) });
}

securityTest('Security district: encrypted hostile names survive import, save, reload and printing as text', async () => {
	await ui.mode('district'); await ui.expand('district');
	security.passwordFields('d-pass');
	const text = await encryptPayload(JSON.stringify(security.district()), security.password);
	await ui.file('#d-file-in', text);
	await ui.waitFor(() => currentDistrict.district === '安全地区' && ui.element('#d-file-in').value === '', 'Encrypted district imported');
	assert.strictEqual(ui.element('#officers-container [data-field="lastName"]').value, security.attack, 'Officer text survives actual rendering');
	assert.strictEqual(ui.element('#students-tbody [data-field="lastName"]').value, security.attack, 'Student text survives actual rendering');
	assert.ok(localStorage.getItem('kogai_district_v2').includes('通常児童'), 'Accepted data saved');
	await security.districtPrint();
}, { afterReload: async () => {
	await ui.expand('district');
	assert.strictEqual(ui.element('#students-tbody [data-field="lastName"]').value, security.attack, 'Hostile text survives actual reload without interpretation');
	await security.districtPrint();
} });

securityTest('Security representative: encrypted names and seat notes remain text after master restore and reload', async () => {
	await ui.mode('rep'); await ui.expand('rep');
	security.passwordFields('rep-pass');
	const data = { districts: [security.district()], szExternals: [{ attend: true, category: '学校関係者', org: security.attack, role: '校長', lastName: '通常校長' }], seatConfig: {
		cols: 2, rows: 2, topLabel: '通常会場', bottomLabel: '入口', leftSide: security.attack, rightSide: '廊下',
		cells: { '0_0': { refKey: 'OFF_0_0', customText: security.attack }, '0_1': { refKey: 'EXT_0', customText: '' } }
	} };
	await ui.file('input[data-change="loadRepMasterTxt"]', await encryptPayload(JSON.stringify(data), security.password));
	await ui.waitFor(() => repState.districts[0]?.district === '安全地区' && ui.element('input[data-change="loadRepMasterTxt"]').value === '', 'Encrypted master restored');
	assert.strictEqual(ui.element('#sz-external-tbody [data-field="org"]').value, security.attack, 'Organization remains original text');
	security.noAttackDOM();
	security.noPolicyViolations();
}, { afterReload: async () => {
	await ui.expand('rep');
	assert.strictEqual(ui.element('#sz-external-tbody [data-field="org"]').value, security.attack, 'Organization restored as text');
	assert.strictEqual(ui.element('#seat-grid-container [data-field="customText"]').value, security.attack, 'Seat note restored as text');
	ui.capturePrints();
	await ui.click('[data-click="setRepPrintChecks"][data-flag="false"]');
	for (const type of ['all_students', 'sz_seats']) await ui.click(`.rep-print-chk[value="${type}"]`);
	await ui.click('[data-click="executeRepSelectedPrint"]');
	assert.strictEqual(__prints.length, 1, 'Selected representative reports printed');
	assert.ok(ui.element('#print-area').textContent.includes(security.attack) && ui.element('#print-area').textContent.includes('通常校長'), 'Names and notes reach real print DOM');
	security.noAttackDOM(); security.noPolicyViolations();
} });

securityTest('Security neighbor: encrypted hostile names survive file import, reload, roster and tent printing', async () => {
	await ui.mode('neighbor'); await ui.expand('neighbor');
	ui.fill('#neighbor-import-pass', security.password);
	const data = { isNeighborhoodData: true, district: '安全自治会', neighborhood: [{ role: '会長', lastName: security.attack, firstName: '通常役員' }] };
	await ui.file('#neighbor-file-input', await encryptPayload(JSON.stringify(data), security.password));
	await ui.waitFor(() => neighborState.district === '安全自治会' && ui.element('#neighbor-file-input').value === '', 'Encrypted neighbor imported');
	assert.strictEqual(ui.element('#neighbor-tbody [data-field="lastName"]').value, security.attack, 'Neighbor name remains original text');
	security.noAttackDOM(); security.noPolicyViolations();
}, { afterReload: async () => {
	await ui.expand('neighbor');
	assert.strictEqual(ui.element('#neighbor-tbody [data-field="lastName"]').value, security.attack, 'Neighbor restored as text');
	ui.capturePrints();
	for (const action of ['printNeighborRoster', 'printNeighborTentCards']) {
		await ui.click(`[data-click="${action}"]`);
		assert.ok(ui.element('#print-area').textContent.includes(security.attack), 'Neighbor printable text retains attack characters');
		security.noAttackDOM();
	}
	assert.strictEqual(__prints.length, 2, 'Roster and tent card both printed');
	security.noPolicyViolations();
} });

securityTest('Security transfer: native form to real encrypted submission, district import, reload and print', async () => {
	await ui.mode('transfer');
	for (const [field, value] of Object.entries({ lastName: security.attack, firstName: '通常転入児童', address: security.attack, tel: '090-1234-5678' })) {
		ui.fill(`.transfer-child-row [data-field="${field}"]`, value);
	}
	security.passwordFields('transfer-export-pass');
	ui.captureDownloads();
	await ui.click('#btn-export-transfer-txt');
	await ui.waitFor(() => __downloads.length === 1, 'Transfer encrypted file created');
	assert.ok(!__downloads[0].content.includes('通常転入児童'), 'Submission never contains plaintext names');
	assert.strictEqual((await parseTxtContent(__downloads[0].content, security.password)).children[0].lastName, security.attack, 'Encryption preserves exact hostile text');
	await ui.mode('district'); await ui.expand('district');
	ui.fill('#d-name', '安全地区'); security.passwordFields('d-pass');
	await ui.click('#btn-toggle-transfer-import');
	window.__promptAnswers = ['1班'];
	await ui.file('#d-transfer-import-panel input[data-change="loadTransferFileIntoDistrict"]', __downloads[0].content);
	await ui.waitFor(() => currentDistrict.students.some(row => row.firstName === '通常転入児童') && ui.element('#d-transfer-import-panel input[type="file"]').value === '', 'Transfer accepted by district');
	security.noAttackDOM(); security.noPolicyViolations();
}, { afterReload: async () => {
	await ui.mode('transfer');
	assert.strictEqual(ui.element('.transfer-child-row [data-field="lastName"]').value, security.attack, 'Transfer form restores original text');
	await ui.mode('district'); await ui.expand('district');
	assert.ok(currentDistrict.students.some(row => row.firstName === '通常転入児童' && row.lastName === security.attack), 'Receiving roster survives reload');
	await security.districtPrint();
} });

for (const name of ['__proto__', 'constructor', 'toString']) {
	securityTest(`Security prototype: official JSON assignee ${name} never mutates shared objects`, async () => {
		const snapshots = [Object.prototype, Object, Object.prototype.toString].map(value => JSON.stringify(Object.getOwnPropertyDescriptors(value)));
		const name = window.__reservedAssignee;
		const config = { scheduleTitle: '予約名検証', startDate: '2026-10-21', endDate: '2026-10-21', specials: `2026-10-21,${name},検証` };
		await ui.file('#card-d-hata input[type="file"]', JSON.stringify(config), 'reserved.json');
		await ui.waitFor(() => currentDistrict.hata.title === '予約名検証' && ui.element('#card-d-hata input[type="file"]').value === '', 'Official JSON generation finishes');
		assert.strictEqual(JSON.stringify([Object.prototype, Object, Object.prototype.toString].map(value => JSON.stringify(Object.getOwnPropertyDescriptors(value)))), JSON.stringify(snapshots), 'Prototype and built-in function descriptors unchanged');
		assert.strictEqual(hataCurrentSchedule[0].person, name, 'Reserved assignee is preserved as ordinary data');
		assert.ok(ui.element('#hata-summary-container').textContent.includes(name), 'Reserved assignee receives a visible count');
		security.noPolicyViolations();
	}, { beforeLoad: new Function(`window.__reservedAssignee = ${JSON.stringify(name)};`) });
}

securityTest('Security CSP: inline script, inline event, eval, base and form submissions are blocked', async () => {
	assert.strictEqual(__securityViolations.length, 0, 'Startup satisfies CSP');
	const baseURI = document.baseURI;
	const script = document.createElement('script'); script.textContent = 'window.__securityScript=1'; document.body.appendChild(script);
	const button = document.createElement('button'); button.textContent = 'CSP event probe'; button.id = 'security-event-probe'; button.setAttribute('onclick', 'window.__securityEvent=1'); document.body.appendChild(button);
	await ui.click('#security-event-probe');
	try { window.eval('window.__securityEval=1'); } catch (error) { assert.strictEqual(error.name, 'EvalError', 'CSP rejects eval'); }
	const base = document.createElement('base'); base.href = new URL('./icons/', location.href).href; document.head.appendChild(base);
	const frame = document.createElement('iframe'); frame.name = 'security-form-target'; frame.setAttribute('sandbox', ''); document.body.appendChild(frame);
	const form = document.createElement('form'); form.target = frame.name; form.action = location.href; document.body.appendChild(form); form.submit();
	await ui.waitFor(() => ['script-src-elem', 'script-src-attr', 'script-src', 'base-uri', 'form-action'].every(directive => __securityViolations.some(event => event.directive === directive)), 'Every prohibited capability produces a policy violation');
	assert.strictEqual(window.__securityScript, undefined, 'Inline script never runs');
	assert.strictEqual(window.__securityEvent, undefined, 'Inline event never runs');
	assert.strictEqual(window.__securityEval, undefined, 'Eval never runs');
	assert.strictEqual(document.baseURI, baseURI, 'Injected base never changes URL resolution');
});

function seedPrivateStorage() {
	if (localStorage.getItem('kogai_auth_meta') !== null) return;
	localStorage.setItem('kogai_district_v2', JSON.stringify({ district: '受入秘密地区', hanList: [], officers: [{}], students: [], neighborhood: [] }));
	localStorage.setItem('kogai_rep_v2', JSON.stringify({ districts: [], szExternals: [{ attend: true, category: '学校関係者', org: '学校', role: '校長', lastName: '受入秘密校長' }], seatConfig: { cols: 2, rows: 2, cells: {} } }));
	localStorage.setItem('kogai_neighbor_v2', JSON.stringify({ district: '受入秘密自治会', neighborhood: [{ role: '会長', lastName: '受入秘密会長' }] }));
	localStorage.setItem('kogai_transfer_v2', JSON.stringify({ children: [{ lastName: '受入秘密児童', firstName: '通常児童', address: '101', tel: '090-1234-5678', grade: '1', className: '1' }] }));
}

for (const mode of ['district', 'rep', 'neighbor', 'transfer']) {
	securityTest(`Security authentication: tampered ${mode} tag cannot unlock or expose partial restored state`, async () => {
		await security.encrypt();
		const key = `kogai_${window.__tamperMode}_v2`;
		const raw = localStorage.getItem(key);
		assert.ok(raw.startsWith('STORAGE_ENC:'), 'Tamper target is genuinely encrypted');
		const prefix = raw.startsWith('STORAGE_ENC:2:') ? 'STORAGE_ENC:2:' : 'STORAGE_ENC:';
		const bytes = base64ToUint8(raw.slice(prefix.length));
		bytes[bytes.length - 1] ^= 1;
		const tampered = prefix + uint8ToBase64(bytes);
		localStorage.setItem(key, tampered);
		localStorage.setItem('__security_tampered_ciphertext', tampered);
	}, { beforeLoad: new Function(`window.__tamperMode = ${JSON.stringify(mode)}; (${seedPrivateStorage.toString()})();`), afterReload: async () => {
		assert.ok(ui.visible('#storage-lock-modal'), 'Encrypted restart begins locked');
		const key = `kogai_${window.__tamperMode}_v2`;
		const tampered = localStorage.getItem('__security_tampered_ciphertext');
		assert.strictEqual(localStorage.getItem(key), tampered, 'Actual reload preserves the injected authentication-tag corruption');
		ui.fill('#modal-unlock-pass', security.password);
		await ui.click('#storage-lock-modal [data-click="handlePasswordUnlock"]');
		await ui.waitFor(() => ui.element('#modal-unlock-error').textContent.length > 0, 'Authenticated storage failure reported');
		assert.ok(ui.visible('#storage-lock-modal') && !isStorageUnlocked(), 'Corrupt storage never becomes an unlocked session');
		assert.ok(!JSON.stringify({ currentDistrict, repState, neighborState, transferState }).includes('受入秘密'), 'No partial private model is committed');
		for (const el of document.querySelectorAll('input, textarea')) assert.ok(!el.value.includes('受入秘密'), 'No partial private DOM is rendered');
		assert.strictEqual(ui.element('#print-area').innerHTML, '', 'Failed unlock cannot retain printable private data');
		assert.strictEqual(localStorage.getItem(key), tampered, 'Failed authentication never overwrites the original ciphertext');
	} });
}

securityTest('Security deadline: first interaction locks after sixteen minutes even before delayed timer executes', async () => {
	await ui.mode('district'); await ui.expand('district');
	ui.fill('#d-name', '期限秘密地区');
	await security.encrypt();
	assert.strictEqual(window.__securityTimerExecuted, 0, 'Auto-lock callback has not run');
	window.__securityClockOffset = 16 * 60 * 1000;
	assert.ok(isStorageUnlocked(), 'Clock advance alone does not execute browser timers');
	await ui.click('#mode-active-badge');
	assert.ok(!isStorageUnlocked(), 'First interaction enforces expired inactivity deadline');
	assert.ok(ui.visible('#storage-lock-modal'), 'Expired interaction opens lock UI');
	assert.strictEqual(ui.element('#d-name').value, '', 'First interaction purges expired private form');
	assert.strictEqual(window.__securityTimerExecuted, 0, 'Deadline enforced independently of timer execution');
}, { beforeLoad: () => {
	const now = Date.now.bind(Date);
	window.__securityClockOffset = 0;
	Date.now = () => now() + window.__securityClockOffset;
	const timeout = window.setTimeout.bind(window);
	window.__securityTimerExecuted = 0;
	window.setTimeout = (callback, delay, ...args) => timeout(delay === 15 * 60 * 1000 ? () => { window.__securityTimerExecuted++; callback(...args); } : callback, delay, ...args);
} });

securityTest('Security storage generation: an autosave queued after clear cannot restore erased data as plaintext', async () => {
	await ui.mode('district');
	await ui.expand('district');
	ui.fill('#d-name', '復活させない消去前地区');
	await security.encrypt();
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const blocker = navigator.locks.request('kogaidocs:storage', { mode: 'exclusive' }, () => gate);
	await new Promise(resolve => setTimeout(resolve, 0));
	const clearing = clearStorageSecurity();
	const staleSave = saveDistrictLocal();
	release();
	await blocker;
	await clearing;
	assert.strictEqual(await staleSave, false, 'Queued save from the erased generation is rejected');
	assert.strictEqual(localStorage.getItem('kogai_auth_meta'), null, 'Authentication metadata remains erased');
	assert.strictEqual(localStorage.getItem('kogai_district_v2'), null, 'Erased district data is not restored as plaintext');
	assert.ok(!JSON.stringify({ ...localStorage }).includes('復活させない消去前地区'), 'No storage key contains the erased data');
});
