const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupDomEnvironment } = require('../helpers/dom-mock');
let transfer, utils, crypto, state, district, rep;
beforeEach(() => {
	setupDomEnvironment();
	for (const name of ['state', 'utils', 'crypto', 'transfer', 'district', 'rep']) delete require.cache[require.resolve(`../../js/${name}.js`)];
	state = require('../../js/state'); utils = require('../../js/utils'); crypto = require('../../js/crypto');
	transfer = require('../../js/transfer'); district = require('../../js/district'); rep = require('../../js/rep'); require('../../js/seat');
	transfer.transferState = { address: '中央町1-2', tel: '090-1234-5678', memo: '', children: [
		{ id: 'c1', lastName: '山田', firstName: '太郎', grade: '1', className: '未定' }
	] };
	document.getElementById('transfer-export-pass').value = 'Household123!';
	document.getElementById('transfer-export-pass-confirm').value = 'Household123!';
});

test('household: file and clipboard retain shared contact data through district and representative intake', async () => {
	transfer.transferState.children[0].lastNameKana = '不要な読み';
	transfer.transferState.children[0].guardianName = '不要な項目';
	transfer.addTransferChildRow();
	transfer.updateTransferChild(1, 'firstName', '次郎');
	let download, copied;
	global.downloadTextFile = (content, filename) => { download = { content, filename }; };
	navigator.clipboard.writeText = async text => { copied = text; };
	assert.equal(await transfer.exportTransferTxt(), true);
	assert.equal(download.filename, '家庭情報データ.txt');
	assert.ok(!download.content.includes('山田'));
	const payload = await crypto.parseTxtContent(download.content, 'Household123!');
	assert.equal(payload.guardianName, undefined);
	assert.equal(payload.children.length, 2);
	for (const child of payload.children) {
		assert.equal(child.guardianName, undefined);
		assert.equal(child.address, '中央町1-2');
		assert.equal(child.tel, '090-1234-5678');
		assert.equal(child.lastNameKana, undefined);
	}
	assert.equal(await transfer.copyTransferEncryptedText(), true);
	const copy = await crypto.parseTxtContent(copied, 'Household123!');
	assert.deepEqual(copy.children, payload.children);
	state.currentDistrict = { district: '地区', han: '1班', students: [], officers: [], neighborhood: [] };
	global.prompt = () => '1班';
	assert.equal(await district.integrateTransferDataIntoDistrict(payload, 'Household123!'), true);
	assert.equal(state.currentDistrict.students[0].address, '中央町1-2');
	state.repState = { districts: [], szExternals: [] };
	assert.equal(await rep.integrateTransferDataIntoRep(payload, 'Household123!'), true);
	assert.equal(state.repState.districts[0].students[1].tel, '090-1234-5678');
});

test('household: missing household or child fields reject both outputs without side effects', async () => {
	let effects = 0;
	global.downloadTextFile = () => effects++;
	navigator.clipboard.writeText = async () => effects++;
	for (const [target, field] of [
		[transfer.transferState, 'address'], [transfer.transferState, 'tel'],
		...[ 'lastName', 'firstName', 'grade', 'className' ].map(field => [transfer.transferState.children[0], field])
	]) {
		const old = target[field]; target[field] = '　 ';
		assert.equal(await transfer.exportTransferTxt(), false, field);
		assert.equal(await transfer.copyTransferEncryptedText(), false, field);
		target[field] = old;
	}
	transfer.transferState.children[0].grade = '7';
	assert.equal(await transfer.exportTransferTxt(), false);
	assert.equal(effects, 0);
});

test('household: old draft migration, local restore and complete privacy reset', async () => {
	transfer.transferState = { children: [{ lastName: '旧姓', firstName: '児童', address: '旧住所', tel: '旧電話', grade: '1', className: '', class: '3' }] };
	transfer.renderTransferForm();
	assert.equal(transfer.transferState.address, '旧住所');
	assert.equal(transfer.transferState.tel, '旧電話');
	assert.equal(transfer.transferState.children[0].className, '3');
	transfer.updateTransferHousehold('address', '');
	transfer.renderTransferForm();
	assert.equal(transfer.transferState.address, '', 'An intentional blank is not restored from legacy child fields');
	transfer.updateTransferHousehold('address', '更新住所');
	transfer.updateTransferHousehold('__proto__', 'ignored');
	await transfer.saveTransferLocal();
	transfer.clearTransferForm();
	assert.equal(document.getElementById('transfer-address').value, '');
	await transfer.loadTransferLocal();
	assert.equal(transfer.transferState.address, '更新住所');
	assert.equal(document.getElementById('transfer-address').value, '更新住所');
	await transfer.resetTransferForm();
	assert.equal(transfer.transferState.address, '');
	assert.equal(transfer.transferState.tel, '');
	assert.ok(!localStorage.getItem('kogai_transfer_v2').includes('更新住所'));
});

test('household: new field types and version 2 required data are validated at intake', () => {
	for (const field of ['address', 'tel']) {
		assert.doesNotThrow(() => utils.validateStoredData({ ...transfer.transferState, [field]: 'x'.repeat(4096) }, 'kogai_transfer_v2'));
		for (const value of [null, {}, 42, 'x'.repeat(4097)]) {
			assert.throws(() => utils.validateStoredData({ ...transfer.transferState, [field]: value }, 'kogai_transfer_v2'));
		}
	}
	const child = { ...transfer.transferState.children[0], address: '住所', tel: '電話' };
	const payload = { ...transfer.transferState, version: 2, isTransferData: true, children: [child] };
	assert.doesNotThrow(() => utils.validateImportData(payload, 'transfer'));
	for (const field of ['address', 'tel']) {
		assert.throws(() => utils.validateImportData({ ...payload, [field]: ' ' }, 'transfer'));
	}
	for (const patch of [{ grade: '7' }, { grade: '' }, { className: '' }, { className: ' ' }]) {
		assert.throws(() => utils.validateImportData({ ...payload, children: [{ ...child, ...patch }] }, 'transfer'));
	}
	assert.doesNotThrow(() => utils.validateImportData({ isTransferData: true, children: [child] }, 'transfer'));
});
