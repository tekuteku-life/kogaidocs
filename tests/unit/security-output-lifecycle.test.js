const test = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
require('../../js/utils');
const cryptoLib = require('../../js/crypto');
const state = require('../../js/state');
require('../../js/hata'); require('../../js/seat');
const district = require('../../js/district');
const rep = require('../../js/rep');
const neighbor = require('../../js/neighbor');
const transfer = require('../../js/transfer');
const app = require('../../js/app');

function prepare() {
	setupDomEnvironment();
	state.currentDistrict = { district: '地区', han: '', hanList: [], officers: [], students: [], neighborhood: [] };
	state.repState = { districts: [structuredClone(state.currentDistrict)], szExternals: [], seatConfig: { cols: 2, rows: 2, cells: {} } };
	state.neighborState = { district: '自治会', neighborhood: [] };
	state.transferState = { address: '住所', tel: '09012345678', children: [{ id: 'child', lastName: '児童', firstName: '名前', grade: '1', className: '1' }] };
	for (const prefix of ['d', 'rep', 'neighbor', 'transfer-export']) {
		document.getElementById(prefix + '-pass').value = 'Submission123!';
		document.getElementById(prefix + '-pass-confirm').value = 'Submission123!';
	}
	document.getElementById('d-name').value = '地区';
	document.getElementById('neighbor-district-name').value = '自治会';
}
const exportsByName = {
	district: () => district.exportDistrictTxt(), districtShare: () => district.shareDistrictData('share'),
	rep: () => rep.exportRepMasterTxt(), split: () => rep.exportSingleDistrictFromRep(0, 'Submission123!'),
	neighbor: () => neighbor.exportNeighborTxt(), neighborCopy: () => neighbor.copyNeighborEncryptedText(),
	transfer: () => transfer.exportTransferTxt(), transferCopy: () => transfer.copyTransferEncryptedText()
};
for (const [name, output] of Object.entries(exportsByName)) {
	test(`security output: ${name} rejects a stale session before file or clipboard output`, async () => {
		prepare();
		const original = global.encryptPayload;
		let release;
		global.encryptPayload = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
		const emitted = [];
		global.downloadTextFile = (...args) => emitted.push(args);
		navigator.clipboard.writeText = async text => emitted.push(text);
		try {
			const task = output();
			assert.equal(typeof release, 'function', 'The exporter reached the encryption boundary');
			cryptoLib.lockStorage(); release(); await task;
			assert.deepEqual(emitted, []);
		} finally { global.encryptPayload = original; }
	});
}

test('security access: cancelled setup preserves legacy storage and cannot activate its key', async () => {
	prepare();
	localStorage.setItem('kogai_district_v2', JSON.stringify(state.currentDistrict));
	const before = localStorage.getItem('kogai_district_v2');
	document.getElementById('modal-set-pass').value = 'DeviceDatabase123!';
	document.getElementById('modal-set-pass-confirm').value = 'DeviceDatabase123!';
	const actual = crypto.subtle.encrypt.bind(crypto.subtle);
	let release;
	crypto.subtle.encrypt = async (...args) => { await new Promise(resolve => { release = resolve; }); return actual(...args); };
	try {
		const task = app.handleEnableEncryptionSubmit();
		while (!release) await new Promise(resolve => setImmediate(resolve));
		app.closeStorageSettingsModal();
		crypto.subtle.encrypt = actual; release(); await task;
		assert.equal(cryptoLib.isStorageEncrypted(), false);
		assert.equal(localStorage.getItem('kogai_district_v2'), before);
	} finally { crypto.subtle.encrypt = actual; }
});

test('security access: cancelled password and biometric unwraps never activate a key or reopen the old modal', async () => {
	for (const biometric of [false, true]) {
		prepare();
		await cryptoLib.setupStorageEncryption('DeviceDatabase123!', biometric);
		cryptoLib.lockStorage();
		document.getElementById('modal-unlock-pass').value = 'DeviceDatabase123!';
		const actual = crypto.subtle.decrypt.bind(crypto.subtle);
		let release;
		crypto.subtle.decrypt = async (...args) => { await new Promise(resolve => { release = resolve; }); return actual(...args); };
		try {
			const task = biometric ? app.handleWebAuthnUnlock() : app.handlePasswordUnlock();
			while (!release) await new Promise(resolve => setImmediate(resolve));
			app.closeStorageAccessModal();
			crypto.subtle.decrypt = actual; release(); await task;
			assert.equal(cryptoLib.isStorageUnlocked(), false);
			assert.equal(document.getElementById('storage-lock-modal').style.display, 'none');
		} finally { crypto.subtle.decrypt = actual; }
	}
});

test('security access: closing after key activation but before model adoption purges the key and prevents late model restoration', async () => {
	prepare();
	await cryptoLib.setupStorageEncryption('DeviceDatabase123!'); cryptoLib.lockStorage();
	document.getElementById('modal-unlock-pass').value = 'DeviceDatabase123!';
	const original = global.loadStorageDecrypted;
	let release;
	const barrier = new Promise(resolve => { release = resolve; });
	let reading = false;
	global.loadStorageDecrypted = async key => { const value = await original(key); reading = true; await barrier; return value; };
	try {
		const task = app.handlePasswordUnlock();
		while (!reading) await new Promise(resolve => setImmediate(resolve));
		assert.equal(cryptoLib.isStorageUnlocked(), true, 'Key was activated before the read boundary');
		app.closeStorageAccessModal(); release(); await task;
		assert.equal(cryptoLib.isStorageUnlocked(), false);
		assert.equal(state.currentDistrict.district, '');
	} finally { global.loadStorageDecrypted = original; }
});

for (const channel of ['share', 'copy', 'line', 'email']) {
	test(`security output: district ${channel} never falls back or opens another app after a pending clipboard rejects on lock`, async () => {
		prepare();
		let reject;
		const originalEncrypt = global.encryptPayload;
		global.encryptPayload = async () => 'ENC:2:' + 'a'.repeat(3000);
		const emitted = [];
		global.downloadTextFile = (...args) => emitted.push(args);
		window.open = (...args) => emitted.push(args);
		navigator.clipboard.writeText = () => new Promise((_, fail) => { reject = fail; });
		try {
			const task = district.shareDistrictData(channel);
			while (!reject) await new Promise(resolve => setImmediate(resolve));
			cryptoLib.lockStorage(); reject(new Error('denied')); await task;
			assert.deepEqual(emitted, []);
		} finally { global.encryptPayload = originalEncrypt; }
	});
}

for (const share of [false, true]) {
	test(`security output: district ${share ? 'share' : 'file'} metadata matches its encrypted snapshot during concurrent edits`, async () => {
		prepare();
		const original = global.encryptPayload;
		let release;
		global.encryptPayload = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
		let captured;
		global.downloadTextFile = (content, filename) => { captured = { content, filename }; };
		navigator.clipboard.writeText = async content => { captured = { content }; };
		try {
			const task = share ? district.shareDistrictData('copy') : district.exportDistrictTxt();
			assert.equal(typeof release, 'function');
			state.currentDistrict.district = '別の地区'; state.currentDistrict.han = '別班';
			release(); await task;
			const cipher = captured.content.match(/BEGIN_DATA:\s*([\s\S]+?)\s*:END_DATA/)[1];
			const decoded = JSON.parse(await cryptoLib.decryptPayload(cipher, 'Submission123!'));
			assert.equal(decoded.district, '地区');
			assert.ok(captured.content.includes(`(${decoded.district} /`), 'Header identifies the encrypted snapshot');
			if (!share) assert.ok(captured.filename.startsWith('校外地区データ_地区_'));
		} finally { global.encryptPayload = original; }
	});
}

test('security output: representative split discards late encryption failures after lock without stale alerts', async () => {
	prepare();
	const original = global.encryptPayload;
	let reject;
	global.encryptPayload = () => new Promise((_, fail) => { reject = fail; });
	const alerts = [];
	global.alert = message => alerts.push(message);
	try {
		const task = rep.exportSingleDistrictFromRep(0, 'Submission123!', 'copy');
		assert.equal(typeof reject, 'function');
		cryptoLib.lockStorage(); reject(new Error('late encryption failure'));
		assert.equal(await task, false);
		assert.deepEqual(alerts, [], 'An old exporter does not notify in the locked context');
	} finally { global.encryptPayload = original; }
});

test('security output: representative clipboard rejection after lock cannot trigger a fallback or a stale notification', async () => {
	prepare();
	let reject;
	const alerts = [], downloads = [];
	global.alert = message => alerts.push(message);
	global.downloadTextFile = (...args) => downloads.push(args);
	navigator.clipboard.writeText = () => new Promise((_, fail) => { reject = fail; });
	const task = rep.exportSingleDistrictFromRep(0, 'Submission123!', 'copy');
	while (!reject) await new Promise(resolve => setImmediate(resolve));
	cryptoLib.lockStorage(); reject(new Error('late clipboard failure'));
	assert.equal(await task, false);
	assert.deepEqual(alerts, []);
	assert.deepEqual(downloads, []);
});

test('security output: authentication deletion without a storage event cancels an already pending export', async () => {
	prepare(); await cryptoLib.setupStorageEncryption('DeviceDatabase123!');
	const original = global.encryptPayload;
	let release;
	global.encryptPayload = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
	const emitted = [];
	global.downloadTextFile = (...args) => emitted.push(args);
	try {
		const task = rep.exportSingleDistrictFromRep(0, 'Submission123!');
		assert.equal(typeof release, 'function');
		localStorage.removeItem('kogai_auth_meta');
		release(); await task;
		assert.deepEqual(emitted, [], 'Late output is rejected before cross-tab notification delivery');
	} finally { global.encryptPayload = original; }
});

test('security output: unavailable authentication state fails closed during capture and output validation', () => {
	prepare();
	const get = localStorage.getItem;
	const guard = cryptoLib.captureStorageOutputGuard();
	localStorage.getItem = () => { throw new Error('Access denied'); };
	try {
		assert.equal(guard(), false, 'Validation failure cannot authorize output');
		assert.equal(cryptoLib.captureStorageOutputGuard()(), false, 'Capture failure cannot authorize output');
	} finally { localStorage.getItem = get; }
});
