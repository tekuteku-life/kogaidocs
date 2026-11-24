const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripScriptNoise } = require('../scripts/lib/js-lexer');

// R-26・E-15・I-15-03・I-15-05・I-15-06: 描画の多層防御の字句の固定と、style 属性の移し先のクラスの静的な確かめ。
// 字句の固定は、アプリ自身のコードが将来、描画の補助を通らない HTML の書込み・スタイルの文字列を持ち込むことを検出するためのものである。
// 照合は tests/system/csp-external-block.test.js と同じく、js のコメントと正規表現リテラルを取り除いた内容に対して行う。
// 現行コードには禁止する形がないため、照合の関数ごとに違反の試料と除く形の試料を与えて検出力も確かめる。
const root = path.resolve(__dirname, '../..');
const readRaw = file => fs.readFileSync(path.join(root, file), 'utf8');
const blank = (text, pattern) => text.replace(pattern, comment => comment.replace(/[^\n]/g, ' '));
const read = file => {
	const text = readRaw(file);
	if (file.endsWith('.js')) return stripScriptNoise(text);
	if (file.endsWith('.html')) return blank(text, /<!--[\s\S]*?-->/g);
	if (file.endsWith('.css')) return blank(text, /\/\*[\s\S]*?\*\//g);
	return text;
};
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(name => name.endsWith('.js')).sort().map(name => `js/${name}`);
const codeFiles = [...jsFiles, 'sw.js'];

/** 語としての出現（前後が語の文字（英数字・_・$・-）でない。大文字小文字を区別しない）を行の内容で返す。 */
const wordLines = name => text => text.split('\n').flatMap(line => [...line.matchAll(new RegExp(`(?<![\\w$-])${name}(?![\\w$-])`, 'gi'))].map(() => line.trim()));
const HTML_SINK_NAMES = ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'DOMParser', 'createContextualFragment', 'execCommand', 'srcdoc', 'setHTMLUnsafe', 'parseHTMLUnsafe'];
const STYLE_API_NAMES = ['insertRule', 'replaceSync', 'CSSStyleSheet', 'adoptedStyleSheets', 'styleSheets', 'attributeStyleMap'];
// 代入の演算子（=・+=・論理代入）。比較（==・===）は除く。
const ASSIGN = String.raw`(?:\+|\|\||&&|\?\?)?=(?!=)`;
const CLASS_REPLACEMENTS = [
	String.raw`\.\s*className\s*${ASSIGN}`,
	String.raw`\[\s*['"\x60]className['"\x60]\s*\]\s*${ASSIGN}`,
	// Object.assign・Object.defineProperties の引数の className（省略記法・引用符・計算された名前を含む。文の終わりの ; まで）。
	String.raw`Object\s*\.\s*(?:assign|defineProperties)\s*\([^;]*?\bclassName\b`,
	String.raw`\b(?:set|remove|toggle)Attribute(?:NS)?\s*\([^)]*['"\x60]class['"\x60]`,
	String.raw`\b(?:getAttributeNode|createAttribute|getNamedItem|removeNamedItem)(?:NS)?\s*\([^)]*['"\x60]class['"\x60]`,
	String.raw`\b(?:setAttributeNode|setNamedItem)(?:NS)?\s*\(`,
	String.raw`\.\s*attributes\s*(?:\.\s*class\b|\[\s*['"\x60]class['"\x60]\s*\])`,
	String.raw`\.\s*classList\s*(?:\.\s*value\s*)?${ASSIGN}`,
	String.raw`\b(?:Reflect\s*\.\s*(?:set|defineProperty)|Object\s*\.\s*defineProperty)\s*\([^)]*\b(?:className|classList)\b`,
	// 分割代入の対象（[el.className] = …・({ a: el.classList.value } = …)）。
	String.raw`[\[{][^\]};]*\.\s*(?:className|classList)\b[^\]};]*[\]}]\s*${ASSIGN}`
].map(source => new RegExp(source, 'gi'));
/** 改行を空白にした内容（行をまたぐ書き方も照合する。文字の位置は変わらない）に照合し、一致の始まりの行を、出現の順に1回ずつ返す。 */
const statementLines = patterns => text => {
	const lines = text.split('\n');
	const starts = [];
	for (let i = 0, at = 0; i < lines.length; at += lines[i].length + 1, i++) starts.push(at);
	const joined = text.replace(/\n/g, ' ');
	const found = new Set();
	for (const pattern of patterns) for (const hit of joined.matchAll(pattern)) {
		let line = starts.length - 1;
		while (starts[line] > hit.index) line--;
		found.add(line);
	}
	return [...found].sort((a, b) => a - b).map(line => lines[line].trim());
};

const match = {
	// I-15-03: HTML の文字列を入れる操作（名前の出現。書き方によらず検出する）と、文書への書込み（.write(・.writeln(）。
	htmlSink: text => [...HTML_SINK_NAMES.flatMap(name => wordLines(name)(text)), ...text.split('\n').filter(line => /\.\s*write(?:ln)?\s*\(/.test(line)).map(line => line.trim())],
	// I-15-03: style の語は、要素のスタイルの display・gridTemplateColumns の読み書きの形と、スタイルシートのファイル名（style.css）だけを許す。
	styleWord: text => [...text.matchAll(/(?<![\w$-])style(?![\w$-])/gi)].filter(found => !(text[found.index - 1] === '.' && /^\.(?:display|gridTemplateColumns)(?![\w$])/.test(text.slice(found.index + 5))) && !(/[/'"`]/.test(text[found.index - 1] || '') && /^\.css(?![\w$])/.test(text.slice(found.index + 5)))).map(found => text.slice(Math.max(0, found.index - 20), found.index + 25).trim()),
	// I-15-03: スタイルの規則・宣言を文字列で作る API。
	styleApi: text => STYLE_API_NAMES.flatMap(name => wordLines(name)(text)),
	// I-15-05: 要素のクラスを丸ごと置き換える・消す操作（className・classList の代入、Object.assign の className、class の属性の操作）。
	classNameAssignment: statementLines(CLASS_REPLACEMENTS)
};

test('R-26 / I-15-06: every matcher detects its violation samples and ignores the excluded forms', () => {
	const samples = {
		htmlSink: {
			hit: ['el.innerHTML = x', "el['innerHTML'] = x", 'Object.assign(el, { innerHTML: x })', 'el.outerHTML = x', "el.insertAdjacentHTML('beforeend', x)", 'new DOMParser()', 'range.createContextualFragment(x)', 'document.write(x)', 'document.writeln(x)', "document.execCommand('insertHTML', false, x)", 'frame.srcdoc = x', "frame.setAttribute('SRCDOC', x)", 'el.setHTMLUnsafe(x)', 'Document.parseHTMLUnsafe(x)', 'doc . write (x)'],
			miss: ['navigator.clipboard.writeText(x)', 'el.textContent = x', 'innerHTMLish', 'data-innerhtml', 'rewrite(x)']
		},
		styleWord: {
			hit: ["el.style = 'color:red'", 'el.style.cssText = x', 'el.style.color = x', 'Object.assign(el, { style: x })', "el.setAttribute('style', x)", "el.setAttributeNS(null, 'style', x)", 'el.attributes.style.value = x', '\'<div style="x">\'', "'<style>p{}</style>'", "el.getAttributeNode('STYLE')", "el['style'].display = 'none'", "x.style.css = 'a'"],
			miss: ["el.style.display = 'none'", 'el.style.gridTemplateColumns = x', "if (el.style.display === 'flex') {}", "'print-style-x'", 'styles', 'lifestyle', 'data-style', "'./css/style.css'"]
		},
		styleApi: {
			hit: ['document.styleSheets[0].insertRule(x)', 'new CSSStyleSheet()', 'sheet.replaceSync(x)', 'document.adoptedStyleSheets = [s]', "el.attributeStyleMap.set('color', x)", 'DOCUMENT.STYLESHEETS'],
			miss: ['styleSheetsX', 'reinsertRule', 'mystyleSheets']
		},
		classNameAssignment: {
			hit: ["el.className = 'x'", "el.className='x'", "el.className += ' x'", "el['className'] = 'x'", 'el["className"] += x', "Object.assign(el, { className: 'x' })", "el.setAttribute('class', 'x')", "el.setAttribute('CLASS', x)", "el.setAttributeNS(null, 'class', x)", "el.removeAttribute('class')", "el.toggleAttribute('class')", "el.getAttributeNode('class').value = x", 'el.attributes.class.value = x', "el.attributes['class'].value = x", "el.classList.value = 'x'", "el.classList = 'x'", 'el.className ||= x', 'el.className &&= x', 'el.className ??= x', 'el.classList.value ||= x', 'el.className\n\t= x', "el.setAttribute(\n\t'class', x)", 'Object.assign(el, {\n\tclassName: x\n})', "el.attributes.getNamedItem('class').value = x", "el.attributes.removeNamedItem('class')", "el.setAttributeNode(document.createAttribute('class'))", "document.createAttribute('class')", 'el.attributes.setNamedItem(attr)', "Reflect.set(el, 'className', x)", "Object.defineProperty(el, 'className', d)", "Reflect.defineProperty(el, 'className', d)", "Reflect.set(el, 'classList', x)", "Object.defineProperty(el, 'classList', d)", "Reflect.set(el.classList, 'value', x)", "el.attributes.getNamedItemNS(null, 'class').value = x", "el.attributes.removeNamedItemNS(null, 'class')", 'el.setAttributeNodeNS(attr)', "document.createAttributeNS(null, 'class')", "el.removeAttributeNS(null, 'class')", 'Object.assign(el, { className })', "Object.assign(el, { 'className': x })", "Object.assign(el, { ['className']: x })", 'Object.defineProperties(el, { className: d })', '[el.className] = [x]', '({ a: el.className } = o)', '({ a: el.classList.value } = o)'],
			miss: ["if (el.className === 'x') {}", 'const c = el.className;', "el.classList.add('x')", "if (el.classList.value === 'x') {}", "const o = { className: x };", "el.getAttribute('class')", "el.setAttribute('data-class', x)", "el.classList.toggle('x')", "const o = {\n\tclassName: x\n};", "Object.assign(target, defaults); const o = { className: x };", "if (el.className\n=== 'x') {}", "el.attributes.getNamedItem('data-class')", "Reflect.set(model, 'class_name', x)", 'const o = { className: child.className, class: child.className };', 'const list = [el.className];', "Reflect.get(el, 'className')", 'Object.assign(el, { classNames: x })', 'if ([el.className] == x) {}']
		}
	};
	assert.deepEqual(Object.keys(samples).sort(), Object.keys(match).sort(), 'Every matcher has samples');
	for (const [name, { hit, miss }] of Object.entries(samples)) {
		for (const sample of hit) assert.ok(match[name](sample).length > 0, `${name} detects ${sample}`);
		for (const sample of miss) assert.deepEqual(match[name](sample), [], `${name} ignores ${sample}`);
	}
});

test('R-26 / I-15-03: HTML enters the page only through the render helper, with one Trusted Types policy', () => {
	const sinks = codeFiles.flatMap(file => match.htmlSink(read(file)).map(line => `${file} ${line}`));
	assert.deepEqual(sinks, ['js/utils.js template.innerHTML = policy ? policy.createHTML(text) : text;'], 'Only the render helper parses HTML, inside a template');
	const policies = codeFiles.flatMap(file => wordLines('createPolicy')(read(file)).map(line => `${file} ${line}`));
	assert.deepEqual([...new Set(policies)], ["js/utils.js const policy = trustedTypes && typeof trustedTypes.createPolicy === 'function' ? trustedTypes.createPolicy('kogai', {"], 'One policy named kogai is created');
	const trusted = codeFiles.flatMap(file => wordLines('trustedTypes')(read(file)).map(line => `${file} ${line}`));
	assert.deepEqual([...new Set(trusted)], [
		"js/utils.js const trustedTypes = typeof window !== 'undefined' ? window.trustedTypes : undefined;",
		"js/utils.js const policy = trustedTypes && typeof trustedTypes.createPolicy === 'function' ? trustedTypes.createPolicy('kogai', {"
	], 'trustedTypes is read only to create the policy');
	const policyUses = codeFiles.flatMap(file => read(file).split('\n').filter(line => /\bpolicy\b/.test(line)).map(line => `${file} ${line.trim()}`));
	assert.deepEqual(policyUses, [
		"js/utils.js const policy = trustedTypes && typeof trustedTypes.createPolicy === 'function' ? trustedTypes.createPolicy('kogai', {",
		'js/utils.js template.innerHTML = policy ? policy.createHTML(text) : text;',
		"js/utils.js return policy ? policy.createScriptURL('./sw.js') : './sw.js';"
	], 'The policy value is used only by the render helper and the service worker URL');
	assert.match(read('js/utils.js'), /const \{ renderHtml, trustedServiceWorkerUrl \} = \(\(\) => \{/, 'The policy is enclosed in an immediately invoked function');
	assert.match(read('js/utils.js'), /createHTML: html => html,/, 'createHTML is used only to parse into the template');
});

test('R-26 / I-15-03: no style string, style rule API or style element is used, and className is assigned only at the fixed lines', () => {
	assert.deepEqual(codeFiles.flatMap(file => match.styleWord(read(file)).map(found => `${file} ${found}`)), [], 'style appears only as .style.display and .style.gridTemplateColumns');
	assert.deepEqual(codeFiles.flatMap(file => match.styleApi(read(file)).map(found => `${file} ${found}`)), [], 'No style rule API');
	const styleProperties = jsFiles.flatMap(file => [...read(file).matchAll(/\.style\.([A-Za-z]+)/g)].map(found => found[1]));
	assert.deepEqual([...new Set(styleProperties)].sort(), ['display', 'gridTemplateColumns'], 'Only display and gridTemplateColumns are set through CSSOM');
	assert.deepEqual(jsFiles.flatMap(file => match.classNameAssignment(read(file)).map(line => `${file} ${line}`)), [
		"js/district.js box.className = 'officer-item-box';",
		"js/hata.js div.className = 'summary-item';",
		"js/seat.js div.className = 'seat-cell-edit';",
		"js/transfer.js if (child.className === undefined || (child.className === '' && child.class)) child.className = child.class || '1';"
	], 'className is assigned only to just-created elements and to the child data field');
	const html = read('index.html');
	assert.deepEqual([...html.matchAll(/\sstyle\s*=/gi)].length, 0, 'index.html has no style attribute');
	assert.deepEqual([...html.matchAll(/<style\b/gi)].length, 0, 'index.html has no style element');
});

/** css/style.css の移し先のクラスの規則（1行に1つ）と、それ以外の規則の選択子。 */
function stylesheetParts() {
	const css = read('css/style.css');
	const utilityRule = /^\.(us?-[a-z0-9_-]+):not\(#_\):not\(#_\):not\(#_\) \{ ([^{}]+) \}$/;
	const utilities = [];
	const rest = [];
	for (const line of css.split('\n')) {
		const found = line.match(utilityRule);
		if (found) utilities.push({ name: found[1], declarations: found[2].split(';').map(part => part.trim()).filter(Boolean) });
		else rest.push(line);
	}
	const selectors = [...rest.join('\n').matchAll(/([^{}@;]+)\{/g)].map(found => found[1].trim()).filter(selector => selector && !/^(?:from|to|\d+%)$/.test(selector)).flatMap(selector => selector.split(',').map(part => part.trim()));
	return { css, utilities, selectors };
}

test('R-26 / I-15-05: every migrated class is defined once with one declaration, outranks the other rules and is used', () => {
	const { css, utilities, selectors } = stylesheetParts();
	assert.ok(utilities.length > 100, 'The migrated classes are at the end of css/style.css');
	const names = utilities.map(entry => entry.name);
	assert.equal(new Set(names).size, names.length, 'Each class is defined once');
	for (const entry of utilities.filter(item => item.name.startsWith('u-'))) assert.equal(entry.declarations.length, 1, `${entry.name} has one declaration`);
	// 移し先のクラスは css/style.css の末尾にまとめて置く（ほかの規則より後）。
	const lines = css.trimEnd().split('\n');
	const firstUtility = lines.findIndex(line => /^\.us?-/.test(line));
	assert.ok(lines.slice(firstUtility).every(line => /^\.us?-/.test(line)), 'The migrated classes are the last rules');
	// ほかの規則の選択子は :is・:where・:not を使わず（詳細度を id の数で比べるため）、id は2つ以下（移し先のクラスは3つ分）。
	for (const selector of selectors) {
		assert.ok(!/:(?:is|where|not|has)\(/.test(selector), `${selector} uses no functional pseudo-class`);
		assert.ok((selector.match(/#[\w-]+/g) || []).length < 3, `${selector} has fewer than three ids`);
	}
	const used = new Set();
	for (const file of ['index.html', ...jsFiles]) {
		for (const found of read(file).matchAll(/(?<![\w$-])us?-[a-z0-9_]+(?:-[a-z0-9_]+)*(?![\w$-])/g)) used.add(found[0]);
	}
	assert.deepEqual([...used].filter(name => !names.includes(name)), [], 'Every used class is defined');
	assert.deepEqual(names.filter(name => !used.has(name)), [], 'Every defined class is used');
	for (const file of ['index.html', ...jsFiles]) assert.ok(!/\bid\s*=\s*["'`]_["'`]|\.id\s*=\s*["'`]_["'`]/.test(read(file)), `${file} uses no id "_"`);
});

test('R-26 / I-15-05: the landscape print stylesheet is linked after the main stylesheet, inactive until printing, and cached', () => {
	const head = read('index.html');
	const links = [...head.matchAll(/<link rel="stylesheet"[^>]*>/g)].map(found => found[0]);
	assert.deepEqual(links, ['<link rel="stylesheet" href="css/style.css">', '<link rel="stylesheet" href="css/print-landscape.css" media="not all" id="hata-print-landscape">']);
	assert.equal(read('css/print-landscape.css').trim(), '@page { size: A4 landscape; margin: 10mm; }', 'The sheet holds only the landscape page');
	assert.match(readRaw('sw.js'), /\t'\.\/css\/style\.css',\n\t'\.\/css\/print-landscape\.css',\n/, 'The service worker caches the print stylesheet');
	const hata = read('js/hata.js');
	assert.match(hata, /if \(landscapeSheet && hata\?\.orientation === 'landscape'\) landscapeSheet\.media = 'print';/);
	assert.match(hata, /\} finally \{\n\t\tdocument\.title = origTitle;\n\t\tif \(landscapeSheet\) landscapeSheet\.media = 'not all';/, 'The sheet is turned off in finally');
	assert.equal([...hata.matchAll(/landscapeSheet\.media =/g)].length, 2);
});
