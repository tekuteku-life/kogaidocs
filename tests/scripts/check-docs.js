#!/usr/bin/env node
/*
 * 文書の機械的チェック（開発プロセス定義書 4.6）。
 * - プレースホルダー（GATE<n>_R<n>・GATE<n>_ROUND<n>・GATE<n>_DIFF<n>・…GATE<n>_RESULT・…_SUMMARY）の消し忘れ
 *   （インラインコードの中の例示は数えない。--pending <記録> でその記録の結果待ちのものだけ許す）
 * - 要件・外部仕様・内部仕様の文書版と改訂日の一致、開発プロセス定義書の文書バージョンと改訂日の記述の一致
 * - 追跡表・設計書のリンクの試験ファイル・行の実在。*.test.js へのアンカーの行が試験の宣言であること
 *   （隣に試験名を書いたリンクは、その試験名の宣言であること）。リンクの文字の行番号（[名前:N]・[同N行]）とアンカーの一致。
 *   `xxx.test.js` の実在
 * - 設計書の逆引用符の中の識別子（キャメルケース）が、本番のコード（js・sw.js。コメントを除く）・index.html・
 *   試験のコード（tests/。文字列・コメントを除き、tests/scripts/ と dev-scripts*.test.js を除く）に実在すること
 * - --base <比較元>:
 *   - 比較元から変わった設計書・追跡表・開発プロセス定義書の版が上がり、改訂日（追跡表は最後の追補の日）が変更の日以降であること。
 *     変更の日は、その文書の内容を最後に変えた日（--date を与えたら、比較元から変わった文書すべてについてその日。
 *     与えなければ、未コミットならファイルの更新日時の日、コミット済みなら比較元より後でその文書を変えた最後のコミットの作者の日付。
 *     作者の日付は --amend・rebase・cherry-pick で変わらない）。
 *   - 上の各検査を比較元の木にも当て、比較元にもある問題（同じ文書・同じ内容）は「変更外」として分けて出す（終了コードに数えない）。
 * 使い方: node tests/scripts/check-docs.js --base <比較元> [--root <リポジトリ>] [--date <YYYY-MM-DD>] [--pending <記録>]
 *         node tests/scripts/check-docs.js --fix-anchors [--base <比較元>] [--root <リポジトリ>]
 *   --base: 比較元（今回の作業の着手前のコミット。開発プロセス定義書 4.1 の 6.）。--fix-anchors のときだけ省略できる（省略すると比較元と比べない）
 *   --fix-anchors: 試験名から宣言の行が一意に決まるリンクのアンカーと、リンクの文字の行番号を直す（ファイルを書き換える）
 * 終了コード: 0 問題なし（変更外だけを含む）、1 問題あり、2 引数の誤り・git が必要なのにない・比較元を使えない（木の項目のパスに .. があるものを含む）
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripScriptNoise } = require('./lib/js-lexer');
const { git, DIFF_FORMAT, UNTRACKED } = require('./lib/git');

const PLACEHOLDER = /\bGATE\d+_(?:R\d+|ROUND\d+|DIFF\d+|RESULT|SUMMARY)(?:_[A-Z0-9_]+)?\b|\b(?:[A-Z][A-Z0-9]*_)+GATE\d+_[A-Z0-9_]+\b/g;
const DESIGN_DOCS = ['docs/requirements.md', 'docs/external_design.md', 'docs/internal_design.md'];
const TRACEABILITY = 'docs/specification_traceability.md';
const PROCESS = 'docs/development_process.md';
// 比較元の木へ写すもの（文書の検査が読むファイル）。
const CHECKED_PATHS = ['docs', 'tests', 'js', 'sw.js', 'index.html'];
// 設計書で触れるが、アプリのコード・試験のコードに現れないことが正しい名前（試験の文字列・コメントは語の集合に入れないため、ここに挙げる）。
const KNOWN_EXTERNAL_NAMES = new Set([
	// ブラウザ・Service Worker・WebAuthn の API（CSP と静的試験で使わないことを確かめる名前）
	'insertAdjacentHTML', 'postMessage', 'requestSubmit', 'setAttributeNS', 'toggleAttribute', 'httpEquiv', 'fetchLater', 'importScripts',
	'webkitRTCPeerConnection', 'webkitSpeechRecognition', 'speechSynthesis', 'openWindow', 'showNotification', 'pushManager', 'backgroundFetch',
	'largeBlob', 'credBlob', 'rpId',
	// Chrome DevTools Protocol のイベント名（Network.loadingFailed）
	'loadingFailed',
	// 設計書が引用する試験の試料の文字列の中の名前（tests/system/csp-external-block.test.js）
	'importedModel'
]);
// 試験の宣言（test(・browserTest(・t.test(・test.skip( など。行の先頭の呼出し）。
const DECLARATION = /^\s*(?:await\s+)?(?:[\w$]+\.)?[\w$]*(?:test|Test)(?:\.(?:only|skip|todo))?\(/;

/** 文字列の中のプレースホルダーを、行番号とともに返す。インラインコード（`…`）の中は例示として数えない。 */
function findPlaceholders(text) {
	return text.split('\n').flatMap((line, index) => [...line.replace(/`[^`]*`/g, ' ').matchAll(PLACEHOLDER)].map(found => ({ line: index + 1, token: found[0] })));
}

const lineOf = (text, pattern) => {
	const index = text.split('\n').findIndex(line => pattern.test(line));
	return index < 0 ? 0 : index + 1;
};
const parseVersion = text => (text.match(/\*\*文書版\*\*: ([0-9.]+)/) || [])[1];
const parseRevision = text => {
	const found = text.match(/\*\*改訂日\*\*: (\d{4})年(\d{1,2})月(\d{1,2})日/);
	return found ? `${found[1]}-${found[2].padStart(2, '0')}-${found[3].padStart(2, '0')}` : '';
};
const isDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** 追跡表の作成日の行の、最後の追補の日（年の書かれない「M月D日」は直前の年とし、月が戻ったら翌年とする）。 */
function lastSupplement(text) {
	const line = text.split('\n').find(entry => entry.startsWith('**作成日**')) || '';
	let year = null;
	let lastMonth = 0;
	let last = '';
	for (const found of line.matchAll(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/g)) {
		const month = Number(found[2]);
		if (found[1]) year = Number(found[1]);
		else if (year !== null && month < lastMonth) year++;
		lastMonth = month;
		if (year !== null) last = `${year}-${String(month).padStart(2, '0')}-${found[3].padStart(2, '0')}`;
	}
	return last;
}

/** 版の比較（1.10 は 1.9 より新しい）。 */
function compareVersions(a, b) {
	const left = a.split('.').map(Number);
	const right = b.split('.').map(Number);
	for (let i = 0; i < Math.max(left.length, right.length); i++) if ((left[i] || 0) !== (right[i] || 0)) return (left[i] || 0) - (right[i] || 0);
	return 0;
}

/** 要件・外部仕様・内部仕様の文書版と改訂日が一致することを確かめる。design: { ファイル: 内容 } */
function checkDesignHeaders(design) {
	const issues = [];
	const headers = Object.entries(design).map(([file, text]) => ({ file, text, version: parseVersion(text), date: parseRevision(text) }));
	for (const header of headers) {
		if (!header.version) issues.push({ file: header.file, line: 1, message: '文書版の行がない' });
		if (!header.date) issues.push({ file: header.file, line: 1, message: '改訂日の行がない' });
	}
	const [first, ...rest] = headers.filter(header => header.version && header.date);
	for (const header of rest) {
		if (header.version !== first.version) issues.push({ file: header.file, line: lineOf(header.text, /\*\*文書版\*\*/), message: `文書版 ${header.version} が ${first.file} の ${first.version} と異なる` });
		if (header.date !== first.date) issues.push({ file: header.file, line: lineOf(header.text, /\*\*改訂日\*\*/), message: `改訂日 ${header.date} が ${first.file} の ${first.date} と異なる` });
	}
	return issues;
}

/**
 * 比較元から変わった設計書・追跡表・開発プロセス定義書の日付と版を確かめる。
 * changes: { ファイル: { text（今の内容）, baseText（比較元の内容。新規なら null）, date（変更の日 YYYY-MM-DD） } }
 */
function checkChangedDocs(changes) {
	const issues = [];
	for (const [file, change] of Object.entries(changes)) {
		if (file === TRACEABILITY) {
			const last = lastSupplement(change.text);
			if (last < change.date) issues.push({ file, line: lineOf(change.text, /^\*\*作成日\*\*/), message: `変更があるのに最後の追補の日（${last || 'なし'}）が変更の日（${change.date}）より前` });
			continue;
		}
		const date = parseRevision(change.text);
		if (date < change.date) issues.push({ file, line: lineOf(change.text, /^\*\*改訂日\*\*/), message: `変更があるのに改訂日（${date || 'なし'}）が変更の日（${change.date}）より前` });
		const versionPattern = file === PROCESS ? /\*\*文書バージョン\*\*: ([0-9.]+)/ : /\*\*文書版\*\*: ([0-9.]+)/;
		const now = (change.text.match(versionPattern) || [])[1];
		const before = change.baseText ? (change.baseText.match(versionPattern) || [])[1] : null;
		if (now && before && compareVersions(now, before) <= 0) issues.push({ file, line: lineOf(change.text, versionPattern), message: `変更があるのに版 ${now} が比較元の ${before} から上がっていない` });
	}
	return issues;
}

/** 開発プロセス定義書の文書バージョンが、改訂日の行の最新の版の記述と一致することを確かめる。 */
function checkProcessHeader(file, text) {
	const version = (text.match(/\*\*文書バージョン\*\*: ([0-9.]+)/) || [])[1];
	const revised = text.split('\n').find(line => line.startsWith('**改訂日**')) || '';
	const latest = (revised.match(/\(v([0-9.]+):/) || [])[1];
	if (!version || !latest) return [{ file, line: 1, message: '文書バージョンまたは改訂日の版の記述がない' }];
	return version === latest ? [] : [{ file, line: lineOf(text, /^\*\*改訂日\*\*/), message: `文書バージョン ${version} と改訂日の最新の版 v${latest} が異なる` }];
}

/** lines[index] が試験の宣言（行の先頭の test(・browserTest(・t.test( など。行コメントは除く）であるか。 */
function isTestDeclaration(lines, index) {
	return DECLARATION.test(lines[index] || '');
}

/**
 * lines[index] が、試験名（${…} は任意の文字列とする）の試験の宣言であるか。
 * 試験名が次の行以降に続く宣言（三項演算子で名前を選ぶものなど）に備え、宣言の行から3行先までの文字列も照合する。
 */
function declaresTest(lines, index, title) {
	const first = lines[index] || '';
	const call = first.match(DECLARATION);
	if (!call) return false;
	// 照合の範囲は宣言から3行先までで、次の試験の宣言の行の手前で切る（1つ前の試験の行を指すアンカーを通さない）。
	const following = [];
	for (let next = index + 1; next < Math.min(index + 4, lines.length) && !isTestDeclaration(lines, next); next++) following.push(lines[next]);
	const window = [first.slice(call[0].length), ...following].join('\n');
	const unescape = value => value.replace(/\\(['"`\\])/g, '$1');
	const pattern = new RegExp(`^${title.split(/\$\{[^}]*\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 's');
	return [...window.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].some(found => pattern.test(unescape(found[2])));
}

/** リンクの文字の行番号（[名前:N] の N、[同N行] の N）。なければ null。 */
function labelLine(label) {
	const found = label.match(/:(\d+)$|^同(\d+)行$/);
	return found ? found[1] || found[2] : null;
}

/** リンクの文字の行番号を直す。 */
const relabel = (label, line) => /^同\d+行$/.test(label) ? `同${line}行` : label.replace(/:\d+$/, `:${line}`);

/** 文書から参照する試験ファイル・行・試験名を確かめる。 */
function checkTestReferences(file, text, root, testBasenames) {
	const issues = [];
	const dir = path.dirname(path.join(root, file));
	text.split('\n').forEach((line, index) => {
		for (const found of line.matchAll(/\[([^\]]*)\]\(((?:\.\.\/)*tests\/[^)#\s]+)(?:#L(\d+))?\)(?:\s*`([^`]+)`)?/g)) {
			const [, label, target, anchor, rawTitle] = found;
			const full = path.resolve(dir, target);
			if (!fs.existsSync(full)) {
				issues.push({ file, line: index + 1, message: `参照先の試験ファイルがない: ${target}` });
				continue;
			}
			const lines = fs.readFileSync(full, 'utf8').split('\n');
			const written = labelLine(label);
			if (anchor && written && written !== anchor) issues.push({ file, line: index + 1, message: `リンクの文字の行番号 ${written} とアンカー #L${anchor} が異なる（${target}）` });
			if (anchor && Number(anchor) > lines.length) {
				issues.push({ file, line: index + 1, message: `参照先の行 ${anchor} が ${target} の行数を超える` });
				continue;
			}
			// Markdown の表の中では | を \| と書くため、元に戻して照合する。
			const title = rawTitle && rawTitle.replace(/\\\|/g, '|');
			if (title && anchor && !declaresTest(lines, Number(anchor) - 1, title)) issues.push({ file, line: index + 1, message: `${target}:${anchor} が試験「${title}」の宣言ではない` });
			if (title && !anchor && !lines.some((entry, lineIndex) => declaresTest(lines, lineIndex, title))) issues.push({ file, line: index + 1, message: `試験名が ${target} にない: ${title}` });
			if (!title && anchor && target.endsWith('.test.js') && !isTestDeclaration(lines, Number(anchor) - 1)) issues.push({ file, line: index + 1, message: `${target}:${anchor} が試験の宣言の行ではない` });
		}
		for (const found of line.matchAll(/`([\w.-]+\.test\.js)`/g)) {
			if (!testBasenames.has(found[1])) issues.push({ file, line: index + 1, message: `試験ファイルが tests/ の下にない: ${found[1]}` });
		}
	});
	return issues;
}

// 開発用のスクリプトの試験と、その共通の補助（名前を試料として含むため、識別子の語に入れない）。tests/scripts/ はディレクトリごと除く。
const DEVELOPMENT_TEST_FILE = /^tests\/(?:unit\/dev-scripts(?:-[\w-]+)?\.test\.js|helpers\/dev-scripts\.js)$/;

/** 識別子の語の集合を作るコード（本番はコメントを除き、試験は文字列・コメントも除く。tests/scripts/ と DEVELOPMENT_TEST_FILE は除く）。 */
function vocabularyText(root) {
	const read = full => fs.readFileSync(full, 'utf8');
	const production = [...listFiles(path.join(root, 'js'), /\.js$/), ...['sw.js'].map(file => path.join(root, file)).filter(full => fs.existsSync(full))].map(full => stripScriptNoise(read(full)));
	const html = fs.existsSync(path.join(root, 'index.html')) ? [read(path.join(root, 'index.html')).replace(/<!--[\s\S]*?-->/g, ' ')] : [];
	const tests = listFiles(path.join(root, 'tests'), /\.js$/, new Set(['node_modules', '.git']))
		.map(full => ({ full, relative: path.relative(root, full).split(path.sep).join('/') }))
		.filter(({ relative }) => !relative.startsWith('tests/scripts/') && !DEVELOPMENT_TEST_FILE.test(relative))
		.map(({ full }) => full)
		.map(full => stripScriptNoise(read(full), { blankStrings: true }));
	return [...production, ...html, ...tests].join('\n');
}

/** 設計書の逆引用符の中のキャメルケースの識別子（関数・変数・プロパティの名前）が、コード・試験に実在することを確かめる。 */
function checkIdentifiers(file, text, codeText) {
	const issues = [];
	// 正規表現の \b などのエスケープを外してから語を切り出す（\bbackgroundFetch を bbackgroundFetch としない）。
	const known = new Set([...(codeText.replace(/\\[a-zA-Z]/g, ' ').match(/[A-Za-z_$][\w$]*/g) || []), ...KNOWN_EXTERNAL_NAMES]);
	text.split('\n').forEach((line, index) => {
		for (const found of line.matchAll(/`([^`]+)`/g)) {
			for (const name of found[1].match(/(?<![\w$.-])[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*(?![\w$-])/g) || []) {
				if (!known.has(name)) issues.push({ file, line: index + 1, message: `識別子がコード・試験にない: ${name}` });
			}
		}
	});
	return issues;
}

/** 試験名から宣言の行が一意に決まるリンクのアンカーと、リンクの文字の行番号を直した内容と、直した件数を返す。 */
function fixAnchors(file, text, root) {
	const dir = path.dirname(path.join(root, file));
	let fixed = 0;
	const result = text.replace(/\[([^\]]*)\]\(((?:\.\.\/)*tests\/[^)#\s]+)#L(\d+)\)(\s*`([^`]+)`)/g, (whole, label, target, anchor, titlePart, rawTitle) => {
		const full = path.resolve(dir, target);
		if (!fs.existsSync(full)) return whole;
		const lines = fs.readFileSync(full, 'utf8').split('\n');
		const title = rawTitle.replace(/\\\|/g, '|');
		const written = labelLine(label);
		if (declaresTest(lines, Number(anchor) - 1, title) && (!written || written === anchor)) return whole;
		const matches = lines.map((line, index) => declaresTest(lines, index, title) ? index + 1 : 0).filter(Boolean);
		if (matches.length !== 1) return whole;
		fixed++;
		return `[${written ? relabel(label, matches[0]) : label}](${target}#L${matches[0]})${titlePart}`;
	});
	return { text: result, fixed };
}

function listFiles(dir, pattern, skip = new Set(['node_modules', '.git'])) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		if (skip.has(entry.name)) return [];
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? listFiles(full, pattern, skip) : pattern.test(entry.name) ? [full] : [];
	});
}

/**
 * 比較元から変わった（または未追跡の）文書と変更の日。
 * 変更の日: date を与えたらその日。なければ、未コミットの変更があればファイルの更新日時の日、
 * なければ比較元より後でその文書を変えた最後のコミットの作者の日付（--amend・rebase・cherry-pick で変わらない）。
 */
function changedDocs(root, base, date, files) {
	// 未コミットの変更: 追跡しているファイルの HEAD からの変更と、未追跡のファイル（UNTRACKED。git status は利用者の
	// status.showUntrackedFiles とクローンの .git/info/exclude に従うので使わない）。
	const uncommitted = git(['diff', ...DIFF_FORMAT, '--name-only', '-z', 'HEAD', '--', ...files], root);
	const untracked = git([...UNTRACKED, '--', ...files], root);
	const diff = git(['diff', ...DIFF_FORMAT, '--name-only', '-z', base, '--', ...files], root);
	if ([uncommitted, untracked, diff].some(result => result.error || result.status !== 0)) return null;
	const dirty = new Set([...uncommitted.stdout.split('\0'), ...untracked.stdout.split('\0')].filter(Boolean));
	const changes = {};
	// git の呼出しに files を指定して渡すので、出てくるのは files のうちのものだけである。
	for (const file of new Set([...diff.stdout.split('\0').filter(Boolean), ...dirty])) {
		const full = path.join(root, file);
		if (!fs.existsSync(full)) continue;
		const shown = git(['show', `${base}:${file}`], root);
		const committed = git(['log', '-1', '--format=%as', `${base}..HEAD`, '--', file], root).stdout.trim();
		const edited = localDate(fs.statSync(full).mtime);
		changes[file] = { text: fs.readFileSync(full, 'utf8'), baseText: shown.status === 0 ? shown.stdout : null, date: date || (dirty.has(file) ? edited : committed || edited) };
	}
	return changes;
}

/** 比較元の木のうち、文書の検査が読むファイルを一時ディレクトリへ書き出す。git が使えなければ null。 */
function extractTree(root, base) {
	const listed = git(['ls-tree', '-r', '-z', base, '--', ...CHECKED_PATHS], root);
	if (listed.error || listed.status !== 0) return null;
	const entries = listed.stdout.split('\0').filter(Boolean).map(entry => {
		const [meta, file] = entry.split('\t');
		const [, type, sha] = meta.split(' ');
		return { type, sha, file };
	}).filter(entry => entry.type === 'blob');
	const batch = git(['cat-file', '--batch'], root, { encoding: 'buffer', input: entries.map(entry => entry.sha).join('\n') + '\n' });
	if (batch.error || batch.status !== 0) return null;
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-check-docs-'));
	// 木の項目の名前に .. があると、書き出す先が一時ディレクトリの外になる（git の checkout は拒むが ls-tree・cat-file は拒まない）。比較元を使えないとする。
	if (entries.some(entry => path.relative(dir, path.join(dir, entry.file)).split(path.sep).includes('..'))) {
		fs.rmSync(dir, { recursive: true, force: true });
		return null;
	}
	let offset = 0;
	for (const entry of entries) {
		const headerEnd = batch.stdout.indexOf(10, offset);
		const size = Number(batch.stdout.subarray(offset, headerEnd).toString().split(' ')[2]);
		const target = path.join(dir, entry.file);
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, batch.stdout.subarray(headerEnd + 1, headerEnd + 1 + size));
		offset = headerEnd + 1 + size + 1;
	}
	return dir;
}

/** 文書の内容の検査（プレースホルダー・版と改訂日の一致・試験の参照・識別子）。 */
function contentIssues(root, options = {}) {
	const read = file => fs.readFileSync(path.join(root, file), 'utf8');
	const issues = [];
	const pending = options.pending ? path.relative(options.pendingRoot || root, path.resolve(options.pendingRoot || root, options.pending)) : null;
	for (const full of listFiles(path.join(root, 'docs'), /\.md$/)) {
		const file = path.relative(root, full);
		if (file === pending) continue;
		for (const found of findPlaceholders(fs.readFileSync(full, 'utf8'))) issues.push({ file, line: found.line, message: `プレースホルダーが残っている: ${found.token}` });
	}
	const design = Object.fromEntries(DESIGN_DOCS.filter(file => fs.existsSync(path.join(root, file))).map(file => [file, read(file)]));
	issues.push(...checkDesignHeaders(design));
	if (fs.existsSync(path.join(root, PROCESS))) issues.push(...checkProcessHeader(PROCESS, read(PROCESS)));
	const testBasenames = new Set(listFiles(path.join(root, 'tests'), /\.test\.js$/).map(full => path.basename(full)));
	const referenced = [...Object.keys(design), ...(fs.existsSync(path.join(root, TRACEABILITY)) ? [TRACEABILITY] : [])];
	for (const file of referenced) issues.push(...checkTestReferences(file, read(file), root, testBasenames));
	const codeText = vocabularyText(root);
	for (const file of Object.keys(design)) issues.push(...checkIdentifiers(file, design[file], codeText));
	return issues;
}

/** 今の問題のうち、比較元にもある問題（同じ文書・同じ内容。件数まで）に scope: '変更外' を付ける。 */
function markOutOfChange(issues, baseIssues) {
	const remaining = new Map();
	for (const issue of baseIssues) remaining.set(`${issue.file}\n${issue.message}`, (remaining.get(`${issue.file}\n${issue.message}`) || 0) + 1);
	return issues.map(issue => {
		const key = `${issue.file}\n${issue.message}`;
		if (!remaining.get(key)) return issue;
		remaining.set(key, remaining.get(key) - 1);
		return { ...issue, scope: '変更外' };
	});
}

/** リポジトリ全体の文書を確かめ、問題の一覧を返す。--base のとき、比較元にもある問題には scope: '変更外' が付く。 */
function checkDocs(root, options = {}) {
	const issues = contentIssues(root, options);
	if (!options.base) return issues;
	const dated = [];
	const changes = options.changes || changedDocs(root, options.base, options.date, [...DESIGN_DOCS, TRACEABILITY, PROCESS]);
	if (!changes) dated.push({ file: '(git)', line: 0, message: `比較元 ${options.base} との差を取れない（git がない、または比較元がない）` });
	else dated.push(...checkChangedDocs(changes));
	const baseRoot = extractTree(root, options.base);
	if (!baseRoot) return [...issues, ...dated, { file: '(git)', line: 0, message: `比較元 ${options.base} の木を取り出せない` }];
	try {
		return [...markOutOfChange(issues, contentIssues(baseRoot, { pending: options.pending, pendingRoot: root })), ...dated];
	} finally {
		fs.rmSync(baseRoot, { recursive: true, force: true });
	}
}

function parseArgs(argv) {
	const options = { root: path.resolve(__dirname, '../..') };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		if (['--root', '--base', '--date', '--pending'].includes(argv[i]) && value === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--root') { options.root = path.resolve(value); i++; }
		else if (argv[i] === '--base') { options.base = value; i++; }
		else if (argv[i] === '--date') { options.date = value; i++; }
		else if (argv[i] === '--pending') { options.pending = value; i++; }
		else if (argv[i] === '--fix-anchors') options.fixAnchors = true;
		else return { error: `不明な引数: ${argv[i]}` };
	}
	if (options.date !== undefined && !isDate(options.date)) return { error: '--date は YYYY-MM-DD で指定する' };
	if (!options.base && !options.fixAnchors) return { error: '--base <比較元>（今回の作業の着手前のコミット）を指定する' };
	return options;
}

/** 問題の一覧を出し、終了コードを返す（変更外は数えない）。precheck.js も使う。 */
function report(issues, name) {
	const blocking = issues.filter(issue => issue.scope !== '変更外');
	const outside = issues.filter(issue => issue.scope === '変更外');
	for (const issue of blocking) console.log(`${issue.file}:${issue.line}: ${issue.message}`);
	for (const issue of outside) console.log(`${issue.file}:${issue.line}: 変更外: ${issue.message}`);
	console.log(`${name}: ${blocking.length ? `${blocking.length}件の問題` : '問題なし'}${outside.length ? `（ほかに比較元にもある変更外 ${outside.length}件。残件台帳で扱う）` : ''}`);
	if (blocking.some(issue => issue.file === '(git)')) return 2;
	return blocking.length ? 1 : 0;
}

function main(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`check-docs: ${options.error}`);
		return 2;
	}
	if (options.fixAnchors) {
		for (const file of [...DESIGN_DOCS, TRACEABILITY].filter(entry => fs.existsSync(path.join(options.root, entry)))) {
			const result = fixAnchors(file, fs.readFileSync(path.join(options.root, file), 'utf8'), options.root);
			if (result.fixed) {
				fs.writeFileSync(path.join(options.root, file), result.text);
				console.log(`check-docs: ${file} のアンカーを ${result.fixed}件直した`);
			}
		}
	}
	return report(checkDocs(options.root, options), 'check-docs');
}

if (require.main === module) process.exitCode = main();

module.exports = { isDate, PLACEHOLDER, KNOWN_EXTERNAL_NAMES, findPlaceholders, lastSupplement, compareVersions, checkDesignHeaders, checkChangedDocs, checkProcessHeader, isTestDeclaration, declaresTest, labelLine, checkTestReferences, vocabularyText, checkIdentifiers, fixAnchors, changedDocs, extractTree, contentIssues, markOutOfChange, checkDocs, parseArgs, report, main };
