/*
 * 描画の補助（js/utils.js の renderHtml）と Trusted Types のポリシー、Service Worker の登録の URL（内部仕様書 I-15-01〜I-15-04・I-15-06）。
 * 単体試験の DOM（tests/helpers/dom-mock.js）は template を簡易に解析する。HTML の解析そのもの（svg・template の入れ子など）は実Chromium の試験で確かめる。
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { setupDomEnvironment } = require('../helpers/dom-mock.js');

const UTILS = path.resolve(__dirname, '../../js/utils.js');

/** js/utils.js を読み直す（ポリシーは読込の時点の window.trustedTypes で決まる）。 */
function loadUtils(trustedTypes) {
	setupDomEnvironment();
	if (trustedTypes) window.trustedTypes = trustedTypes;
	else delete window.trustedTypes;
	delete require.cache[UTILS];
	return require(UTILS);
}

/** console.error の呼出しを集める。 */
function captureErrors(fn) {
	const calls = [];
	const original = console.error;
	console.error = (...args) => calls.push(args);
	try { return { result: fn(), calls }; } finally { console.error = original; }
}

/** 偽の Trusted Types（ポリシーの作成と、作った値の記録）。 */
function fakeTrustedTypes() {
	const created = [];
	return {
		created,
		createPolicy(name, rules) {
			const policy = {
				createHTML: html => { created.html = (created.html || []).concat(html); return { trusted: 'html', value: rules.createHTML(html), toString() { return this.value; } }; },
				createScriptURL: url => ({ trusted: 'url', value: rules.createScriptURL(url), toString() { return this.value; } })
			};
			created.push({ name, rules, policy });
			return policy;
		}
	};
}

test('renderHtml: allowed markup is inserted unchanged and nothing is reported', () => {
	const utils = loadUtils();
	const host = document.createElement('div');
	const html = '<table><tbody><tr><td colspan="2" class="u-ta-center">名簿</td></tr></tbody></table><input type="text" maxlength="4096" value="山田" placeholder="氏名" data-field="lastName" data-index="0" spellcheck="false" inputmode="text" autocorrect="off" autocapitalize="off"><button type="button" class="btn" data-click="addNeighborRow" title="追加" aria-expanded="false">追加</button><select data-change="x"><option value="1" selected>1</option></select><label><input type="checkbox" checked disabled></label><p><strong>強調</strong><br><span id="x">文</span></p><hr><div><table><thead><tr><th>見出し</th></tr></thead></table></div><input type="tel"><input type="email"><input type="password">';
	const { result, calls } = captureErrors(() => utils.renderHtml(host, html));
	assert.deepStrictEqual(result, { elements: [], attributes: [] });
	assert.strictEqual(calls.length, 0, 'No removal is logged for application markup');
	assert.strictEqual(host.innerHTML, html, 'The rendered HTML reads back unchanged');
	assert.strictEqual(host.querySelector('input').value, '山田');
});

test('renderHtml: disallowed elements are removed with their subtree and only names are logged', () => {
	const utils = loadUtils();
	const host = document.createElement('div');
	const { result, calls } = captureErrors(() => utils.renderHtml(host, '<div class="keep"><script>window.__x = "秘密の値"</script><img src="x" onerror="1"><svg><div>中</div></svg><a href="https://example.com">リンク</a><form action="x"><input></form><iframe srcdoc="x"></iframe><style>p{}</style><link rel="stylesheet" href="x.css"><meta http-equiv="refresh" content="0"><template><div></div></template><object data="x"></object><span>残る</span></div>'));
	const keep = host.querySelector('.keep');
	assert.ok(keep, 'The allowed parent remains');
	assert.deepStrictEqual(keep.children.map(child => child.tagName), ['span'], 'Only the allowed child remains');
	assert.deepStrictEqual(result.elements.sort(), ['a', 'form', 'iframe', 'img', 'link', 'meta', 'object', 'script', 'style', 'svg', 'template'].sort());
	assert.strictEqual(host.querySelectorAll('div').length, 1, 'The div inside svg is removed with the svg');
	assert.strictEqual(calls.length, 1, 'The removal is logged once');
	const logged = JSON.stringify(calls[0]);
	assert.ok(logged.includes('script') && logged.includes('svg'), 'Element names are logged');
	assert.ok(!logged.includes('秘密の値') && !logged.includes('example.com') && !logged.includes('リンク'), 'Values and text are not logged');
});

test('renderHtml: disallowed attributes and attribute values are removed and the rest is kept', () => {
	const utils = loadUtils();
	const host = document.createElement('div');
	const { result, calls } = captureErrors(() => utils.renderHtml(host, '<div id="a" class="c" style="color:red" onclick="x()" onmouseover="y()" data-click="clearAll" data-="2" data-Index="3" aria-label="名前" aria-2="4" title="t" href="h" src="s" formaction="f" srcset="s"><input type="file" value="v"><input type="TEXT"><button type="submit">送信</button><button type="button">ボタン</button><span type="text">文</span><input spellcheck="true"><input spellcheck="false"><input spellcheck=""></div>'));
	const div = host.querySelector('#a');
	assert.deepStrictEqual(Object.keys(div.attrs).sort(), ['aria-label', 'class', 'data-click', 'data-index', 'id', 'title'].sort(), 'Only allowed attributes remain (data- and aria- by pattern)');
	const inputs = host.querySelectorAll('input');
	assert.strictEqual(inputs[0].getAttribute('type'), null, 'type="file" is removed');
	assert.strictEqual(inputs[0].getAttribute('value'), 'v', 'value is kept');
	assert.strictEqual(inputs[1].getAttribute('type'), 'TEXT', 'The type value is compared without case and kept unchanged');
	const buttons = host.querySelectorAll('button');
	assert.strictEqual(buttons[0].getAttribute('type'), null, 'type="submit" is removed');
	assert.strictEqual(buttons[1].getAttribute('type'), 'button');
	assert.strictEqual(host.querySelector('span').getAttribute('type'), null, 'type on other elements is removed');
	assert.strictEqual(inputs[2].getAttribute('spellcheck'), null, 'spellcheck="true" is removed');
	assert.strictEqual(inputs[3].getAttribute('spellcheck'), 'false', 'spellcheck="false" is kept');
	assert.strictEqual(inputs[4].getAttribute('spellcheck'), null, 'An empty spellcheck is removed');
	assert.deepStrictEqual(result.elements, []);
	assert.deepStrictEqual(result.attributes.sort(), ['aria-2', 'data-', 'formaction', 'href', 'onclick', 'onmouseover', 'spellcheck', 'src', 'srcset', 'style', 'type'].sort(), 'Each removed attribute name is reported once');
	assert.strictEqual(calls.length, 1);
	assert.ok(!JSON.stringify(calls[0]).includes('clearAll') && !JSON.stringify(calls[0]).includes('color:red'), 'Attribute values are not logged');
	assert.notStrictEqual(host.innerHTML.includes('style'), true, 'The read-back HTML is built from what remains');
});

test('renderHtml: nodes other than elements and text are removed, and empty HTML clears the element', () => {
	const utils = loadUtils();
	const host = document.createElement('div');
	host.innerHTML = '<span>古い</span>';
	// 単体試験の DOM はコメントを作らないため、コメントのノードを持つ template を差し込む。
	const createElement = document.createElement;
	const removedComment = { value: false };
	document.createElement = tag => {
		const element = createElement.call(document, tag);
		if (tag !== 'template') return element;
		const content = { nodeType: 11, template: element };
		Object.defineProperty(element, 'content', { get: () => content });
		const comment = { nodeType: 8, nodeName: '#comment', remove: () => { removedComment.value = true; content.childNodes.splice(content.childNodes.indexOf(comment), 1); element._dirty = true; } };
		const text = { nodeType: 3, nodeName: '#text' };
		Object.defineProperty(element, 'innerHTML', { set: () => { content.childNodes = [comment, text]; content.children = []; element._innerHTML = ''; } });
		return element;
	};
	try {
		const { result } = captureErrors(() => utils.renderHtml(host, '<!-- x -->文'));
		assert.strictEqual(removedComment.value, true, 'The comment is removed');
		assert.deepStrictEqual(result.elements, ['#comment']);
	} finally {
		document.createElement = createElement;
	}
	const { result, calls } = captureErrors(() => utils.renderHtml(host, ''));
	assert.deepStrictEqual(result, { elements: [], attributes: [] });
	assert.strictEqual(calls.length, 0);
	assert.strictEqual(host.children.length, 0, 'Empty HTML removes the old children');
	assert.strictEqual(host.innerHTML, '');
});

test('renderHtml: with Trusted Types, one policy named kogai parses the HTML and only ./sw.js is a script URL', () => {
	const trusted = fakeTrustedTypes();
	const utils = loadUtils(trusted);
	assert.deepStrictEqual(trusted.created.map(entry => entry.name), ['kogai'], 'One policy is created at load');
	const host = document.createElement('div');
	utils.renderHtml(host, '<span class="a">文</span>');
	assert.strictEqual(host.innerHTML, '<span class="a">文</span>', 'The policy value is parsed');
	assert.deepStrictEqual(trusted.created.html, ['<span class="a">文</span>'], 'The HTML is parsed through the policy');
	const rules = trusted.created[0].rules;
	assert.strictEqual(rules.createHTML('<b>x</b>'), '<b>x</b>', 'createHTML returns the string unchanged');
	assert.strictEqual(rules.createScriptURL('./sw.js'), './sw.js');
	for (const url of ['sw.js', './sw.js?x', 'https://example.com/sw.js', './js/app.js', '']) {
		assert.throws(() => rules.createScriptURL(url), TypeError, `Rejects ${url}`);
	}
	const value = utils.trustedServiceWorkerUrl();
	assert.strictEqual(value.trusted, 'url', 'The service worker URL comes from the policy');
	assert.strictEqual(String(value), './sw.js');
	for (const name of Object.keys(utils)) assert.notStrictEqual(utils[name], trusted.created[0].policy, `${name} is not the policy`);
	for (const name of Object.keys(global)) assert.notStrictEqual(global[name], trusted.created[0].policy, `The global ${name} is not the policy`);
});

test('renderHtml: without Trusted Types the HTML string is parsed and the service worker URL is the string ./sw.js', () => {
	const utils = loadUtils();
	assert.strictEqual(utils.trustedServiceWorkerUrl(), './sw.js');
	const host = document.createElement('div');
	utils.renderHtml(host, 7);
	assert.strictEqual(host.innerHTML, '7', 'Non-string values are converted to strings');
	// createPolicy を持たない値は Trusted Types として扱わない。
	const other = loadUtils({});
	assert.strictEqual(other.trustedServiceWorkerUrl(), './sw.js');
});

test('Service Worker registration passes the trusted URL and keeps updateViaCache none', async () => {
	setupDomEnvironment();
	delete window.trustedTypes;
	// tests/unit/app.test.js と同じモジュールを1回だけ読み込む（js/handoff.js の起動の処理は、単体試験の DOM の URL では動かない）。
	for (const file of ['crypto', 'state', 'hata', 'seat', 'rep', 'district', 'app']) require(path.resolve(__dirname, `../../js/${file}.js`));
	const sentinel = { trusted: 'url', toString: () => './sw.js' };
	const calls = [];
	global.trustedServiceWorkerUrl = () => sentinel;
	navigator.serviceWorker.register = async (...args) => { calls.push(args); return {}; };
	window.location.protocol = 'https:';
	window.dispatchEvent({ type: 'DOMContentLoaded' });
	await new Promise(resolve => setTimeout(resolve, 50));
	assert.ok(calls.length >= 1, 'The service worker is registered');
	assert.strictEqual(calls[0][0], sentinel, 'The first argument is the value from trustedServiceWorkerUrl');
	assert.deepStrictEqual(calls[0][1], { updateViaCache: 'none' });
});

test('setPassFeedbackState replaces only the state class and keeps the other classes of the element', () => {
	const utils = loadUtils();
	const message = document.createElement('div');
	message.className = 'pass-feedback-msg u-mt-6px u-mb-8px';
	for (const [state, expected] of [
		['mismatch', ['pass-feedback-msg', 'u-mt-6px', 'u-mb-8px', 'mismatch']],
		['match', ['pass-feedback-msg', 'u-mt-6px', 'u-mb-8px', 'match']],
		['pass-msg-ng', ['pass-feedback-msg', 'u-mt-6px', 'u-mb-8px', 'pass-msg-ng']],
		['pass-msg-ok', ['pass-feedback-msg', 'u-mt-6px', 'u-mb-8px', 'pass-msg-ok']],
		['', ['pass-feedback-msg', 'u-mt-6px', 'u-mb-8px']]
	]) {
		utils.setPassFeedbackState(message, state);
		assert.deepStrictEqual([...message.classList.classes].sort(), expected.sort(), `State ${state || '(none)'}`);
	}
	const bare = document.createElement('div');
	utils.setPassFeedbackState(bare, 'match');
	assert.deepStrictEqual([...bare.classList.classes].sort(), ['match', 'pass-feedback-msg'], 'The base class is added when missing');
});

test('resetPasswordInputs resets every password message state except the unlock error', () => {
	const utils = loadUtils();
	const message = document.getElementById('d-pass-match-msg');
	message.className = 'pass-feedback-msg u-mt-6px mismatch';
	const unlock = document.getElementById('modal-unlock-error');
	unlock.className = 'pass-feedback-msg mismatch';
	utils.resetPasswordInputs(document);
	assert.deepStrictEqual([...message.classList.classes].sort(), ['pass-feedback-msg', 'u-mt-6px'], 'The state class is removed and the other classes are kept');
	assert.ok(unlock.classList.contains('mismatch'), 'The unlock error keeps its state class');
});
