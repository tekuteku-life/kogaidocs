const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const password = 'SecurityMaster1!';
const keys = ['district', 'rep', 'neighbor', 'transfer'].map(mode => `kogai_${mode}_v2`);
const authKey = 'kogai_auth_meta';
const sources = ['utils', 'crypto', 'state'].map(name => fs.readFileSync(path.resolve(__dirname, `../../js/${name}.js`), 'utf8'));

function storage() {
	const values = new Map();
	return {
		getItem: key => values.has(key) ? values.get(key) : null,
		setItem: (key, value) => values.set(key, String(value)),
		removeItem: key => values.delete(key),
		clear: () => values.clear(),
		snapshot: () => Object.fromEntries(values)
	};
}

// origin内で共有するFIFOロック。shared同士の並行とexclusiveの排他を別々に表現する。
function lockManager() {
	const names = new Map();
	const requests = [];
	const drain = state => {
		while (state.queue.length) {
			const next = state.queue[0];
			if (state.active.some(job => job.mode === 'exclusive') || (next.mode === 'exclusive' && state.active.length)) return;
			state.queue.shift(); state.active.push(next); next.state = 'held';
			Promise.resolve().then(() => next.callback({ name: next.name, mode: next.mode })).then(value => {
				state.active.splice(state.active.indexOf(next), 1); next.state = 'released'; drain(state); next.resolve(value);
			}, error => {
				state.active.splice(state.active.indexOf(next), 1); next.state = 'released'; drain(state); next.reject(error);
			});
			if (next.mode === 'exclusive') return;
		}
	};
	return {
		requests,
		request(name, options, callback) {
			if (typeof options === 'function') { callback = options; options = {}; }
			const mode = options.mode || 'exclusive';
			assert.ok(mode === 'shared' || mode === 'exclusive');
			if (!names.has(name)) names.set(name, { active: [], queue: [] });
			return new Promise((resolve, reject) => {
				const job = { name, mode, callback, resolve, reject, state: 'pending' };
				requests.push(job); names.get(name).queue.push(job); drain(names.get(name));
			});
		}
	};
}
const sharedLocks = new WeakMap();

// タブごとのJSとWebCryptoを分離し、同じ保存領域のタブはLockManagerも共有する。
function createTab(localStorage = storage()) {
	if (!sharedLocks.has(localStorage)) sharedLocks.set(localStorage, lockManager());
	const locks = sharedLocks.get(localStorage);
	const listeners = new Map();
	const subtle = {};
	for (const method of ['generateKey', 'exportKey', 'importKey', 'deriveKey', 'encrypt', 'decrypt']) {
		subtle[method] = webcrypto.subtle[method].bind(webcrypto.subtle);
	}
	const prf = new Uint8Array(32).fill(7);
	const credential = id => ({ rawId: id || new Uint8Array([1, 2, 3, 4]), getClientExtensionResults: () => ({ prf: { results: { first: prf } } }) });
	const sandbox = {
		localStorage, crypto: { subtle, getRandomValues: value => webcrypto.getRandomValues(value) },
		TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, URLSearchParams, btoa, atob,
		setTimeout, clearTimeout, console: { warn() {}, error() {}, log() {} },
		isSecureContext: true, PublicKeyCredential: class {},
		location: { protocol: 'https:', hostname: 'localhost', origin: 'https://localhost', href: 'https://localhost/kogai/index.html' },
		navigator: { locks, credentials: { create: async () => credential(), get: async options => credential(options?.publicKey?.allowCredentials?.[0]?.id) } },
		addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
		removeEventListener() {},
		document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null }
	};
	sandbox.window = sandbox;
	const context = vm.createContext(sandbox);
	for (const source of sources) vm.runInContext(source, context);
	vm.runInContext("currentDistrict.district = '保護する地区'; neighborState.district = '保護する自治会';", context);
	return {
		context, localStorage, subtle, locks, credentials: sandbox.navigator.credentials,
		run: code => vm.runInContext(code, context),
		data: () => JSON.parse(vm.runInContext('JSON.stringify([currentDistrict, repState, neighborState, transferState])', context))
	};
}

async function configured(localStorage) {
	const tab = createTab(localStorage);
	await tab.run(`setupStorageEncryption('${password}', false)`);
	return tab;
}

async function ignoredRejection(promise) {
	try { await promise; } catch (_) { /* 拒否方法でなく、保存値と鍵の保全を検査する。 */ }
}

// storage.clearや旧アプリ等、協調ロックを通らない外部変更の検出は引き続き必要である。
async function changeOutsideApp(owner, action) {
	if (action === 'clear') {
		owner.localStorage.removeItem(authKey);
		keys.forEach(key => owner.localStorage.removeItem(key));
	} else {
		const replacement = createTab();
		await replacement.run("setupStorageEncryption('ChangedMaster2!', false)");
		owner.localStorage.clear();
		for (const [key, value] of Object.entries(replacement.localStorage.snapshot())) owner.localStorage.setItem(key, value);
	}
}

function tamper(ciphertext) {
	const prefix = ciphertext.startsWith('STORAGE_ENC:2:') ? 'STORAGE_ENC:2:' : 'STORAGE_ENC:';
	const bytes = Buffer.from(ciphertext.slice(prefix.length), 'base64');
	bytes[bytes.length - 1] ^= 1;
	return prefix + bytes.toString('base64');
}

async function legacyFixture({ malformed = false } = {}) {
	const tab = createTab();
	const data = tab.data();
	if (malformed) data[0].district = { invalid: 'authenticated but not a valid district string' };
	const master = await tab.run('generateMasterKey()');
	const raw = await webcrypto.subtle.exportKey('raw', master);
	tab.context.legacyRaw = raw;
	const passwordMeta = await tab.run(`wrapKeyWithPassword(legacyRaw, '${password}', undefined, 100000)`);
	const webauthn = await tab.run('registerWebAuthnPrf(legacyRaw)');
	for (const [index, key] of keys.entries()) {
		const iv = webcrypto.getRandomValues(new Uint8Array(12));
		const cipher = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, master, new TextEncoder().encode(JSON.stringify(data[index])));
		tab.localStorage.setItem(key, 'STORAGE_ENC:' + Buffer.concat([Buffer.from(iv), Buffer.from(cipher)]).toString('base64'));
	}
	new Uint8Array(raw).fill(0);
	delete tab.context.legacyRaw;
	tab.localStorage.setItem(authKey, JSON.stringify({ isEncrypted: true, version: 1, createdAt: '2026-10-21T00:00:00.000Z', password: passwordMeta, webauthn }));
	return { tab, data };
}

for (const action of ['clear', 'rekey']) {
	test(`security crypto: ${action} in another tab invalidates a stale writer without plaintext resurrection`, async () => {
		const owner = await configured();
		const stale = createTab(owner.localStorage);
		await stale.run(`unlockStorageWithPassword('${password}')`);
		if (action === 'clear') await owner.run('clearStorageSecurity()');
		else await owner.run("setupStorageEncryption('ChangedMaster2!', false)");
		const before = owner.localStorage.snapshot();
		await ignoredRejection(stale.run(`saveStorageData('${keys[0]}', {district:'消去済みの秘密'})`));
		assert.deepEqual(owner.localStorage.snapshot(), before, 'Old tab cannot write under deleted or replaced security metadata');
		assert.equal(stale.run('isStorageUnlocked()'), false, 'Old key is invalidated');
	});
}

for (const corruption of ['missing', 'invalid-json', 'disabled', 'replaced-wrap']) {
	test(`security crypto: ${corruption} metadata fails closed before save and does not downgrade to plaintext`, async () => {
		const tab = await configured();
		if (corruption === 'missing') tab.localStorage.removeItem(authKey);
		else if (corruption === 'invalid-json') tab.localStorage.setItem(authKey, '{broken');
		else {
			const meta = JSON.parse(tab.localStorage.getItem(authKey));
			if (corruption === 'disabled') meta.isEncrypted = false;
			else meta.password.wrappedKey = 'AAAA';
			tab.localStorage.setItem(authKey, JSON.stringify(meta));
		}
		const before = tab.localStorage.snapshot();
		await ignoredRejection(tab.run(`saveStorageData('${keys[0]}', {district:'平文へ降格させない'})`));
		assert.deepEqual(tab.localStorage.snapshot(), before);
		assert.equal(tab.run('isStorageUnlocked()'), false);
		await assert.rejects(tab.run(`loadStorageDecrypted('${keys[0]}')`));
	});
}

test('security crypto: new ciphertext authenticates its version and storage slot for every mode', async () => {
	const tab = await configured();
	const originals = keys.map(key => tab.localStorage.getItem(key));
	assert.equal(JSON.parse(tab.localStorage.getItem(authKey)).storageFormat, 2);
	assert.ok(originals.every(value => value.startsWith('STORAGE_ENC:2:')));
	for (const [index, key] of keys.entries()) {
		for (const [otherIndex, other] of originals.entries()) {
			if (index === otherIndex) continue;
			tab.localStorage.setItem(key, other);
			await assert.rejects(tab.run(`loadStorageDecrypted('${key}')`), `${keys[otherIndex]} must not authenticate as ${key}`);
			tab.localStorage.setItem(key, originals[index]);
		}
		tab.localStorage.setItem(key, tamper(originals[index]));
		await assert.rejects(tab.run(`loadStorageDecrypted('${key}')`), `${key} authentication tag must be checked`);
		tab.localStorage.setItem(key, originals[index].replace('STORAGE_ENC:2:', 'STORAGE_ENC:'));
		await assert.rejects(tab.run(`loadStorageDecrypted('${key}')`), 'Format-2 metadata must reject a legacy-prefix downgrade');
		tab.localStorage.setItem(key, originals[index]);
	}
});

for (const target of keys) {
	for (const origin of keys.filter(key => key !== target)) {
		test(`security crypto: ciphertext from ${origin} cannot authenticate as ${target}`, async () => {
			const tab = await configured();
			tab.localStorage.setItem(target, tab.localStorage.getItem(origin));
			await assert.rejects(tab.run(`loadStorageDecrypted('${target}')`));
		});
	}
}

for (const action of ['clear', 'rekey']) {
	test(`security crypto: external ${action} invalidates an encrypted save already in flight`, async () => {
		const owner = await configured();
		const writer = createTab(owner.localStorage);
		await writer.run(`unlockStorageWithPassword('${password}')`);
		const encrypt = writer.subtle.encrypt;
		let release, reached;
		const gate = new Promise(resolve => { release = resolve; });
		const started = new Promise(resolve => { reached = resolve; });
		writer.subtle.encrypt = async (...args) => { const result = await encrypt(...args); reached(); await gate; return result; };
		const pending = writer.run(`saveStorageData('${keys[0]}', {district:'遅延した旧保存'})`);
		await started;
		await changeOutsideApp(owner, action);
		const before = owner.localStorage.snapshot();
		release();
		await ignoredRejection(pending);
		assert.deepEqual(owner.localStorage.snapshot(), before, 'Late encryption cannot write into a different security epoch');
		assert.equal(writer.run('isStorageUnlocked()'), false);
	});

	test(`security crypto: external ${action} invalidates a decrypt already in flight`, async () => {
		const owner = await configured();
		const reader = createTab(owner.localStorage);
		await reader.run(`unlockStorageWithPassword('${password}')`);
		const decrypt = reader.subtle.decrypt;
		let release, reached;
		const gate = new Promise(resolve => { release = resolve; });
		const started = new Promise(resolve => { reached = resolve; });
		reader.subtle.decrypt = async (...args) => { const result = await decrypt(...args); reached(); await gate; return result; };
		const pending = reader.run(`loadStorageDecrypted('${keys[0]}')`);
		await started;
		await changeOutsideApp(owner, action);
		release();
		await assert.rejects(pending, 'A stale decryption result must not cross the security epoch boundary');
		assert.equal(reader.run('isStorageUnlocked()'), false);
	});
}

for (const method of ['password', 'webauthn']) {
	for (const action of ['clear', 'rekey']) {
		test(`security crypto: external ${action} invalidates an in-flight ${method} unlock`, async () => {
			const owner = await configured();
			if (method === 'webauthn') await owner.run('registerWebAuthnForActiveKey()');
			const reader = createTab(owner.localStorage);
			const decrypt = reader.subtle.decrypt;
			let release, reached;
			const gate = new Promise(resolve => { release = resolve; });
			const started = new Promise(resolve => { reached = resolve; });
			reader.subtle.decrypt = async (...args) => { const result = await decrypt(...args); reached(); await gate; return result; };
			const pending = reader.run(method === 'password' ? `unlockStorageWithPassword('${password}')` : 'unlockStorageWithWebAuthn()');
			await started;
			await changeOutsideApp(owner, action);
			const before = owner.localStorage.snapshot();
			release();
			await assert.rejects(pending);
			assert.deepEqual(owner.localStorage.snapshot(), before, 'A stale unlock must not migrate or overwrite new security values');
			assert.equal(reader.run('isStorageUnlocked()'), false);
		});
	}
}

// prefixの期待値より先に各認証タグの実検査も独立して実行する。
for (const key of keys) {
	test(`security crypto: tampered ${key} cannot be decrypted`, async () => {
		const tab = await configured();
		tab.localStorage.setItem(key, tamper(tab.localStorage.getItem(key)));
		await assert.rejects(tab.run(`loadStorageDecrypted('${key}')`));
	});
}

for (const method of ['password', 'webauthn']) {
	const unlock = method === 'password' ? `unlockStorageWithPassword('${password}')` : 'unlockStorageWithWebAuthn()';
	test(`security crypto: legacy ${method} unlock migrates all four valid local models atomically`, async () => {
		const { tab, data } = await legacyFixture();
		await tab.run(unlock);
		assert.equal(JSON.parse(tab.localStorage.getItem(authKey)).storageFormat, 2);
		for (const [index, key] of keys.entries()) {
			assert.ok(tab.localStorage.getItem(key).startsWith('STORAGE_ENC:2:'));
			assert.deepEqual(JSON.parse(JSON.stringify(await tab.run(`loadStorageDecrypted('${key}')`))), data[index]);
		}
	});
	for (const failure of ['tag', 'schema', 'encrypt', 'quota']) {
		test(`security crypto: legacy ${method} migration ${failure} failure retains old values and discards the key`, async () => {
			const { tab } = await legacyFixture({ malformed: failure === 'schema' });
			if (failure === 'tag') tab.localStorage.setItem(keys[3], tamper(tab.localStorage.getItem(keys[3])));
			if (failure === 'encrypt') tab.subtle.encrypt = async () => { throw new Error('migration encryption failed'); };
			if (failure === 'quota') {
				const setItem = tab.localStorage.setItem;
				tab.localStorage.setItem = (key, value) => {
					if (key === keys[2] && String(value).startsWith('STORAGE_ENC:2:')) throw new Error('migration quota');
					setItem(key, value);
				};
			}
			const before = tab.localStorage.snapshot();
			await assert.rejects(tab.run(unlock));
			assert.deepEqual(tab.localStorage.snapshot(), before, 'Failed migration preserves all original ciphertext and metadata');
			assert.equal(tab.run('isStorageUnlocked()'), false);
		});
	}
}

test('security crypto: wrapping failure zeroes the exported setup key', async () => {
	const tab = createTab();
	let captured;
	const exportKey = tab.subtle.exportKey;
	tab.subtle.exportKey = async (...args) => { captured = await exportKey(...args); return captured; };
	tab.subtle.encrypt = async () => { throw new Error('wrap failed'); };
	await assert.rejects(tab.run(`setupStorageEncryption('${password}', false)`));
	assert.equal(captured.byteLength, 32);
	assert.ok(new Uint8Array(captured).every(value => value === 0), 'Owned raw setup buffer is wiped on failure');
});

test('security crypto: rejected biometric registration zeroes the exported active master key', async () => {
	const tab = await configured();
	let captured;
	const exportKey = tab.subtle.exportKey;
	tab.subtle.exportKey = async (...args) => { captured = await exportKey(...args); return captured; };
	tab.credentials.create = async () => { throw new Error('biometric cancelled'); };
	await assert.rejects(tab.run('registerWebAuthnForActiveKey()'));
	assert.equal(captured.byteLength, 32);
	assert.ok(new Uint8Array(captured).every(value => value === 0), 'Owned registration buffer is wiped on rejection');
});

for (const method of ['password', 'webauthn']) {
	test(`security crypto: ${method} unwrapped raw key is wiped when CryptoKey import fails`, async () => {
		const { tab } = await legacyFixture();
		const meta = JSON.parse(tab.localStorage.getItem(authKey));
		tab.context.wrapMeta = method === 'password' ? meta.password : meta.webauthn;
		const importKey = tab.subtle.importKey;
		const decrypt = tab.subtle.decrypt;
		let decrypted;
		let captured;
		tab.subtle.decrypt = async (...args) => { decrypted = await decrypt(...args); return decrypted; };
		tab.subtle.importKey = async (...args) => {
			if (args[0] === 'raw' && args[2]?.name === 'AES-GCM' && decrypted && (args[1] === decrypted || args[1]?.buffer === decrypted)) {
				captured = args[1];
				throw new Error('master import failed');
			}
			return importKey(...args);
		};
		await assert.rejects(tab.run(method === 'password' ? `unwrapKeyWithPassword(wrapMeta, '${password}')` : 'unwrapKeyWithWebAuthn(wrapMeta)'));
		assert.equal(captured.byteLength, 32);
		assert.ok(new Uint8Array(captured).every(value => value === 0), 'Decrypted master buffer is wiped after failed import');
	});
}

test('security crypto: failed raw-key export preserves an existing protected session and saved values', async () => {
	const tab = await configured();
	const before = tab.localStorage.snapshot();
	tab.subtle.exportKey = async () => { throw new Error('export failed'); };
	await assert.rejects(tab.run("setupStorageEncryption('ChangedMaster2!', false)"));
	await assert.rejects(tab.run('registerWebAuthnForActiveKey()'));
	assert.deepEqual(tab.localStorage.snapshot(), before);
	assert.equal(tab.run('isStorageUnlocked()'), true);
});

test('security crypto: reversed encryption completion cannot replace the latest value with an older save', async () => {
	const tab = await configured();
	const encrypt = tab.subtle.encrypt;
	let releaseFirst, firstStarted, secondStarted;
	const firstGate = new Promise(resolve => { releaseFirst = resolve; });
	const started = new Promise(resolve => { firstStarted = resolve; });
	const second = new Promise(resolve => { secondStarted = resolve; });
	let calls = 0;
	tab.subtle.encrypt = async (...args) => {
		const index = ++calls;
		const result = await encrypt(...args);
		if (index === 1) { firstStarted(); await firstGate; }
		else secondStarted();
		return result;
	};
	const older = tab.run(`saveStorageData('${keys[0]}', {district:'古い地区'})`);
	await started;
	const latest = tab.run(`saveStorageData('${keys[0]}', {district:'最新地区'})`);
	try {
		// 直列化実装では第2暗号化を開始できない。並列実装では第2保存を先に完了させる。
		const parallel = await Promise.race([second.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 50))]);
		if (parallel) await latest;
	} finally { releaseFirst(); }
	await Promise.all([older, latest]);
	const result = await tab.run(`loadStorageDecrypted('${keys[0]}')`);
	assert.equal(result.district, '最新地区');
});

function pauseNextEncryption(tab) {
	const encrypt = tab.subtle.encrypt;
	let release, reached;
	const gate = new Promise(resolve => { release = resolve; });
	const started = new Promise(resolve => { reached = resolve; });
	let paused = false;
	tab.subtle.encrypt = async (...args) => {
		const value = await encrypt(...args);
		if (!paused) { paused = true; reached(); await gate; }
		return value;
	};
	return { started, release };
}

function assertOneExclusiveNamespace(locks) {
	assert.ok(locks.requests.length > 0, 'Application operations acquire Web Locks');
	assert.equal(new Set(locks.requests.map(request => request.name)).size, 1, 'All storage operations use one application lock name');
	assert.ok(locks.requests.some(request => request.mode === 'exclusive'), 'Writers require an exclusive lock');
}

test('security crypto locks fixture: readers can overlap, queued writers exclude later readers, and errors release', async () => {
	const locks = lockManager();
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const first = locks.request('fixture', { mode: 'shared' }, () => gate);
	const second = locks.request('fixture', { mode: 'shared' }, () => gate);
	const writer = locks.request('fixture', { mode: 'exclusive' }, () => { throw new Error('writer failure'); });
	const observedWriter = assert.rejects(writer, /writer failure/);
	let lastRan = false;
	const last = locks.request('fixture', { mode: 'shared' }, () => { lastRan = true; });
	assert.deepEqual(locks.requests.map(request => request.state), ['held', 'held', 'pending', 'pending']);
	release();
	await Promise.all([first, second, observedWriter, last]);
	assert.equal(lastRan, true);
	assert.ok(locks.requests.every(request => request.state === 'released'));
});

test('security crypto locks: clear requested between setup commit keys waits and leaves every storage key empty', async () => {
	const owner = createTab();
	const clearer = createTab(owner.localStorage);
	const setItem = owner.localStorage.setItem;
	let clearTask, statesAtCommit, keysAtCommit;
	let requested = false;
	owner.localStorage.setItem = (key, value) => {
		setItem(key, value);
		if (!requested && key === keys[0]) {
			requested = true;
			clearTask = clearer.run('clearStorageSecurity()');
			statesAtCommit = owner.locks.requests.map(request => ({ mode: request.mode, state: request.state }));
			keysAtCommit = Object.keys(owner.localStorage.snapshot());
		}
	};
	await owner.run(`setupStorageEncryption('${password}', false)`);
	await clearTask;
	assert.equal(requested, true, 'The competing clear is requested inside the real multi-key commit');
	assert.deepEqual(statesAtCommit, [{ mode: 'exclusive', state: 'held' }, { mode: 'exclusive', state: 'pending' }]);
	assert.ok(keysAtCommit.includes(keys[0]), 'The queued clear cannot remove a partially committed key');
	assert.deepEqual(owner.localStorage.snapshot(), {}, 'Clear executes last and no setup result can resurrect stored values');
	assertOneExclusiveNamespace(owner.locks);
});

test('security crypto locks: save requested behind an earlier clear cannot resurrect erased data as plaintext', async () => {
	const owner = await configured();
	let release;
	const gate = new Promise(resolve => { release = resolve; });
	const blocker = owner.locks.request('kogaidocs:storage', { mode: 'exclusive' }, () => gate);
	await new Promise(resolve => setImmediate(resolve));
	const clear = owner.run('clearStorageSecurity()');
	const save = owner.run(`saveStorageData('${keys[0]}', {district:'復活させない消去前データ'})`);
	assert.deepEqual(owner.locks.requests.slice(-3).map(request => request.state), ['held', 'pending', 'pending']);
	release();
	await blocker;
	await clear;
	assert.equal(await save, false, 'A save request from the erased generation is explicitly rejected');
	assert.deepEqual(owner.localStorage.snapshot(), {}, 'The clear remains final and no plaintext data is resurrected');
});

test('security crypto locks: plaintext save queued during initial encryption reevaluates protection after acquiring the lock', async () => {
	const owner = createTab();
	const other = createTab(owner.localStorage);
	const gate = pauseNextEncryption(owner);
	const setup = owner.run(`setupStorageEncryption('${password}', false)`);
	await gate.started;
	const save = other.run(`saveStorageData('${keys[0]}', {district:'待機中の平文秘密'})`);
	const saveOutcome = Promise.resolve(save).then(value => ({ value }), error => ({ error }));
	let during, snapshotDuring;
	try {
		await new Promise(resolve => setImmediate(resolve));
		during = owner.locks.requests.map(request => ({ mode: request.mode, state: request.state }));
		snapshotDuring = owner.localStorage.snapshot();
	} finally { gate.release(); }
	await setup;
	const result = await saveOutcome;
	assert.deepEqual(during, [{ mode: 'exclusive', state: 'held' }, { mode: 'exclusive', state: 'pending' }]);
	assert.ok(!JSON.stringify(snapshotDuring).includes('待機中の平文秘密'), 'A pending plaintext writer cannot bypass setup');
	if (result.value === true) {
		assert.equal((await owner.run(`loadStorageDecrypted('${keys[0]}')`)).district, '待機中の平文秘密', 'Reported success must persist the requested value under encryption');
	} else assert.ok(result.value === false || result.error, 'A queued save reports rejection explicitly');
	assert.ok(keys.every(key => localStorageEncrypted(owner.localStorage.getItem(key))), 'No mode is downgraded to plaintext');
	assert.ok(!JSON.stringify(owner.localStorage.snapshot()).includes('待機中の平文秘密'));
	assertOneExclusiveNamespace(owner.locks);
});

function localStorageEncrypted(value) {
	return typeof value === 'string' && value.startsWith('STORAGE_ENC:2:');
}

for (const action of ['clear', 'rekey']) {
	test(`security crypto locks: ordinary encrypted save serializes with ${action} in another tab`, async () => {
		const owner = await configured();
		const other = createTab(owner.localStorage);
		await other.run(`unlockStorageWithPassword('${password}')`);
		const gate = pauseNextEncryption(owner);
		const save = owner.run(`saveStorageData('${keys[0]}', {district:'保存完了待ちの地区'})`);
		await gate.started;
		const mutation = other.run(action === 'clear' ? 'clearStorageSecurity()' : "setupStorageEncryption('ChangedMaster2!', false)");
		let during;
		try {
			await new Promise(resolve => setImmediate(resolve));
			during = owner.locks.requests.slice(-2).map(request => ({ mode: request.mode, state: request.state }));
		} finally { gate.release(); }
		await Promise.all([save, mutation]);
		assert.deepEqual(during, [{ mode: 'exclusive', state: 'held' }, { mode: 'exclusive', state: 'pending' }]);
		if (action === 'clear') assert.deepEqual(owner.localStorage.snapshot(), {});
		else {
			other.run('lockStorage()');
			await other.run("unlockStorageWithPassword('ChangedMaster2!')");
			for (const key of keys) assert.ok(await other.run(`loadStorageDecrypted('${key}')`), 'Every committed mode authenticates under the replacement key');
		}
		assertOneExclusiveNamespace(owner.locks);
	});
}

test('security crypto locks: a shared read finishes before a queued exclusive clear', async () => {
	const owner = await configured();
	const other = createTab(owner.localStorage);
	const decrypt = owner.subtle.decrypt;
	let release, reached;
	const gate = new Promise(resolve => { release = resolve; });
	const started = new Promise(resolve => { reached = resolve; });
	owner.subtle.decrypt = async (...args) => { const value = await decrypt(...args); reached(); await gate; return value; };
	const read = owner.run(`loadStorageDecrypted('${keys[0]}')`);
	const readResult = read.then(value => ({ value }), error => ({ error }));
	await started;
	const clear = other.run('clearStorageSecurity()');
	let during;
	try {
		await new Promise(resolve => setImmediate(resolve));
		during = owner.locks.requests.slice(-2).map(request => ({ mode: request.mode, state: request.state }));
	} finally { release(); }
	const result = await readResult;
	await clear;
	assert.deepEqual(during, [{ mode: 'shared', state: 'held' }, { mode: 'exclusive', state: 'pending' }]);
	assert.equal(result.error, undefined);
	assert.equal(result.value.district, '保護する地区');
	assert.deepEqual(owner.localStorage.snapshot(), {});
	assertOneExclusiveNamespace(owner.locks);
});

for (const method of ['password', 'webauthn']) {
	for (const action of ['clear', 'rekey', 'save']) {
		test(`security crypto locks: legacy ${method} migration excludes a queued ${action}`, async () => {
			const { tab: owner } = await legacyFixture();
			const other = createTab(owner.localStorage);
			const before = owner.localStorage.snapshot();
			const gate = pauseNextEncryption(owner);
			const unlocking = owner.run(method === 'password' ? `unlockStorageWithPassword('${password}')` : 'unlockStorageWithWebAuthn()');
			const unlockOutcome = Promise.resolve(unlocking).then(value => ({ value }), error => ({ error }));
			await gate.started;
			const mutation = other.run(action === 'clear' ? 'clearStorageSecurity()'
				: action === 'rekey' ? "setupStorageEncryption('ChangedMaster2!', false)"
					: `saveStorageData('${keys[0]}', {district:'移行への割込み'})`);
			const mutationOutcome = Promise.resolve(mutation).then(value => ({ value }), error => ({ error }));
			let during, savedDuring;
			try {
				await new Promise(resolve => setImmediate(resolve));
				during = owner.locks.requests.slice(-2).map(request => ({ mode: request.mode, state: request.state }));
				savedDuring = owner.localStorage.snapshot();
			} finally { gate.release(); }
			const unlocked = await unlockOutcome;
			await mutationOutcome;
			assert.deepEqual(during, [{ mode: 'exclusive', state: 'held' }, { mode: 'exclusive', state: 'pending' }]);
			assert.deepEqual(savedDuring, before, 'A queued writer cannot alter the legacy transaction while it is preparing migration');
			assert.equal(unlocked.error, undefined);
			assert.equal(unlocked.value, true);
			if (action === 'clear') assert.deepEqual(owner.localStorage.snapshot(), {});
			else {
				assert.equal(JSON.parse(owner.localStorage.getItem(authKey)).storageFormat, 2);
				assert.ok(keys.every(key => localStorageEncrypted(owner.localStorage.getItem(key))));
			}
			assertOneExclusiveNamespace(owner.locks);
		});
	}
}

for (const method of ['password', 'webauthn']) {
	test(`security crypto locks: current-format ${method} unlock holds an exclusive lock before a competing clear`, async () => {
		const owner = await configured();
		if (method === 'webauthn') await owner.run('registerWebAuthnForActiveKey()');
		owner.run('lockStorage()');
		const other = createTab(owner.localStorage);
		const decrypt = owner.subtle.decrypt;
		let release, reached;
		const gate = new Promise(resolve => { release = resolve; });
		const started = new Promise(resolve => { reached = resolve; });
		let paused = false;
		owner.subtle.decrypt = async (...args) => {
			const value = await decrypt(...args);
			if (!paused) { paused = true; reached(); await gate; }
			return value;
		};
		const unlocking = owner.run(method === 'password' ? `unlockStorageWithPassword('${password}')` : 'unlockStorageWithWebAuthn()');
		const unlockOutcome = Promise.resolve(unlocking).then(value => ({ value }), error => ({ error }));
		await started;
		const clear = other.run('clearStorageSecurity()');
		let during;
		try {
			await new Promise(resolve => setImmediate(resolve));
			during = owner.locks.requests.slice(-2).map(request => ({ mode: request.mode, state: request.state }));
		} finally { release(); }
		const result = await unlockOutcome;
		await clear;
		assert.deepEqual(during, [{ mode: 'exclusive', state: 'held' }, { mode: 'exclusive', state: 'pending' }]);
		assert.equal(result.error, undefined);
		assert.equal(result.value, true);
		assert.deepEqual(owner.localStorage.snapshot(), {});
		assertOneExclusiveNamespace(owner.locks);
	});
}

for (const action of ['clear', 'rekey', 'save']) {
	test(`security crypto locks: biometric registration excludes a queued ${action}`, async () => {
		const owner = await configured();
		const other = createTab(owner.localStorage);
		const before = owner.localStorage.snapshot();
		const create = owner.credentials.create;
		let release, reached;
		const gate = new Promise(resolve => { release = resolve; });
		const started = new Promise(resolve => { reached = resolve; });
		owner.credentials.create = async (...args) => { reached(); await gate; return create(...args); };
		const registration = owner.run('registerWebAuthnForActiveKey()');
		const registrationOutcome = Promise.resolve(registration).then(value => ({ value }), error => ({ error }));
		await started;
		const mutation = other.run(action === 'clear' ? 'clearStorageSecurity()'
			: action === 'rekey' ? "setupStorageEncryption('ChangedMaster2!', false)"
				: `saveStorageData('${keys[0]}', {district:'登録への割込み'})`);
		const mutationOutcome = Promise.resolve(mutation).then(value => ({ value }), error => ({ error }));
		let during, savedDuring;
		try {
			await new Promise(resolve => setImmediate(resolve));
			during = owner.locks.requests.slice(-2).map(request => ({ mode: request.mode, state: request.state }));
			savedDuring = owner.localStorage.snapshot();
		} finally { release(); }
		const result = await registrationOutcome;
		await mutationOutcome;
		assert.deepEqual(during, [{ mode: 'exclusive', state: 'held' }, { mode: 'exclusive', state: 'pending' }]);
		assert.deepEqual(savedDuring, before, 'Only the lock holder may commit biometric metadata');
		assert.equal(result.error, undefined);
		assert.equal(result.value, true);
		if (action === 'clear') assert.deepEqual(owner.localStorage.snapshot(), {});
		else assert.ok(JSON.parse(owner.localStorage.getItem(authKey)).webauthn);
		assertOneExclusiveNamespace(owner.locks);
	});
}

for (const action of ['setup', 'password unlock', 'webauthn unlock', 'load', 'save', 'register']) {
	test(`security crypto locks: unavailable Web Locks rejects protected ${action} without altering storage`, async () => {
		const owner = action === 'setup' ? createTab() : await configured();
		if (action === 'webauthn unlock') await owner.run('registerWebAuthnForActiveKey()');
		if (action.endsWith('unlock')) owner.run('lockStorage()');
		delete owner.context.navigator.locks;
		const before = owner.localStorage.snapshot();
		const code = {
			setup: `setupStorageEncryption('${password}', false)`,
			'password unlock': `unlockStorageWithPassword('${password}')`,
			'webauthn unlock': 'unlockStorageWithWebAuthn()',
			load: `loadStorageDecrypted('${keys[0]}')`,
			save: `saveStorageData('${keys[0]}', {district:'拒否する保存'})`,
			register: 'registerWebAuthnForActiveKey()'
		}[action];
		const outcome = await Promise.resolve().then(() => owner.run(code)).then(value => ({ value }), error => ({ error }));
		assert.ok(outcome.error || outcome.value === false, 'A protected operation must explicitly reject missing locking support');
		assert.deepEqual(owner.localStorage.snapshot(), before, 'Unsupported locking never changes encrypted or unencrypted source values');
	});
}

test('security crypto locks: unavailable Web Locks still permits unencrypted single-key save, load and complete deletion', async () => {
	const owner = createTab();
	delete owner.context.navigator.locks;
	assert.equal(await owner.run(`saveStorageData('${keys[0]}', {district:'未暗号化で利用する地区'})`), true);
	assert.equal(JSON.parse(owner.localStorage.getItem(keys[0])).district, '未暗号化で利用する地区');
	assert.equal((await owner.run(`loadStorageDecrypted('${keys[0]}')`)).district, '未暗号化で利用する地区');
	await owner.run('clearStorageSecurity()');
	assert.deepEqual(owner.localStorage.snapshot(), {});
});
