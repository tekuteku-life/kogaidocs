const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripScriptNoise } = require('../scripts/lib/js-lexer');
const checkDocs = require('../scripts/check-docs');
const { withTempDir, git, gitInput, gitAvailable, quiet, captured } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: check-docs.js（文書の機械的チェック）の判定を確かめる。

test('check-docs: placeholders of the defined forms are found outside inline code and identifiers are not placeholders', () => {
	const text = ['GATE1_R1', 'CSP_GATE3_RESULT と GATE2_DIFF27・GATE3_ROUND4・GATE3_SUMMARY', '例: `GATE1_R2` は例示', 'R-25・SEC-30・I-14-01・BL-001・TODO_R1・API_RESULT・REVIEW_SUMMARY・GATE3_DONE', 'GATE3_R1_FIX と R25_GATE2_TBD'].join('\n');
	assert.deepEqual(checkDocs.findPlaceholders(text), [
		{ line: 1, token: 'GATE1_R1' },
		{ line: 2, token: 'CSP_GATE3_RESULT' },
		{ line: 2, token: 'GATE2_DIFF27' },
		{ line: 2, token: 'GATE3_ROUND4' },
		{ line: 2, token: 'GATE3_SUMMARY' },
		{ line: 5, token: 'GATE3_R1_FIX' },
		{ line: 5, token: 'R25_GATE2_TBD' }
	], 'A suffix after the round and a prefix before GATE<n>_ are placeholders too; words without GATE<n>_ and GATE<n>_ with another word are not');
});

test('check-docs: design headers must agree on version and revision date', () => {
	const doc = (version, date) => `# t\n\n**文書版**: ${version}（アプリケーション 2.12.1 対応）<br>\n**改訂日**: ${date}<br>\n`;
	assert.deepEqual(checkDocs.checkDesignHeaders({ 'a.md': doc('1.10', '2026年11月21日'), 'b.md': doc('1.10', '2026年11月21日') }), []);
	assert.deepEqual(checkDocs.checkDesignHeaders({ 'a.md': doc('1.10', '2026年11月21日'), 'b.md': doc('1.9', '2026年11月20日'), 'c.md': '# 版なし' }).map(issue => `${issue.file}:${issue.line}: ${issue.message}`), [
		'c.md:1: 文書版の行がない',
		'c.md:1: 改訂日の行がない',
		'b.md:3: 文書版 1.9 が a.md の 1.10 と異なる',
		'b.md:4: 改訂日 2026-11-20 が a.md の 2026-11-21 と異なる'
	]);
});

test('check-docs: changed documents need a revision or supplement date on or after the change and a raised version', () => {
	assert.equal(checkDocs.lastSupplement('**作成日**: 2026年10月24日（2026年11月19日・11月20日・11月21日 追補）<br>'), '2026-11-21');
	assert.equal(checkDocs.lastSupplement('**作成日**: 2026年12月24日（1月5日 追補）<br>'), '2027-01-05', 'A month going back means the next year');
	assert.ok(checkDocs.compareVersions('1.10', '1.9') > 0);
	assert.equal(checkDocs.compareVersions('1.8.0', '1.8'), 0);
	const changes = {
		'docs/requirements.md': { text: '**文書版**: 1.10<br>\n**改訂日**: 2026年11月20日<br>', baseText: '**文書版**: 1.10<br>', date: '2026-11-21' },
		'docs/internal_design.md': { text: '**文書版**: 1.11<br>\n**改訂日**: 2026年11月21日<br>', baseText: '**文書版**: 1.10<br>', date: '2026-11-21' },
		'docs/external_design.md': { text: '**文書版**: 1.10<br>\n**改訂日**: 2026年11月21日<br>', baseText: null, date: '2026-11-21' },
		'docs/specification_traceability.md': { text: '**作成日**: 2026年10月24日（11月20日 追補）<br>', baseText: '', date: '2026-11-21' },
		'docs/development_process.md': { text: '**文書バージョン**: 1.7.0<br>\n**改訂日**: 2026年11月21日 (v1.7.0: x)<br>', baseText: '**文書バージョン**: 1.7.0<br>', date: '2026-11-21' }
	};
	assert.deepEqual(checkDocs.checkChangedDocs(changes).map(issue => `${issue.file}: ${issue.message}`), [
		'docs/requirements.md: 変更があるのに改訂日（2026-11-20）が変更の日（2026-11-21）より前',
		'docs/requirements.md: 変更があるのに版 1.10 が比較元の 1.10 から上がっていない',
		'docs/specification_traceability.md: 変更があるのに最後の追補の日（2026-11-20）が変更の日（2026-11-21）より前',
		'docs/development_process.md: 変更があるのに版 1.7.0 が比較元の 1.7.0 から上がっていない'
	], 'A new document (no base text) is not checked for a version raise');
});

test('check-docs: the process document version must match the latest version in its revision line', () => {
	const doc = (version, latest) => `**文書バージョン**: ${version}<br>\n**改訂日**: 2026年11月22日 (v${latest}: 追加。v1.7.0: 旧)<br>\n`;
	assert.deepEqual(checkDocs.checkProcessHeader('p.md', doc('1.8.0', '1.8.0')), []);
	assert.deepEqual(checkDocs.checkProcessHeader('p.md', doc('1.8.0', '1.7.1')), [{ file: 'p.md', line: 2, message: '文書バージョン 1.8.0 と改訂日の最新の版 v1.7.1 が異なる' }]);
	assert.equal(checkDocs.checkProcessHeader('p.md', '# 版なし').length, 1);
});

test('check-docs: anchors must be test declarations (of the named test when given), and both label forms must match anchors', () => withTempDir({
	'tests/unit/a.test.js': ["test('alpha || beta', () => {});", "browserTest(`mode=${m} restores`, async () => {});", "test(x === 'file'", "\t? `life: ${r} refuses`", "\t: 'other', () => {});", "// test('gamma')", "\tawait t.test('sub', () => {});", "test.after(() => {});"].join('\n'),
	'tests/helpers/h.js': 'const helper = 1;\n',
	'docs/x.md': ''
}, root => {
	const names = new Set(['a.test.js']);
	const check = text => checkDocs.checkTestReferences('docs/x.md', text, root, names).map(issue => issue.message);
	assert.deepEqual(check('| [a.test.js:1](../tests/unit/a.test.js#L1) `alpha \\|\\| beta` | [a.test.js:2](../tests/unit/a.test.js#L2) `mode=${queryMode} restores` | [a](../tests/unit/a.test.js#L3) `life: ${route} refuses` | `a.test.js` |'), []);
	assert.deepEqual(check('[同1行](../tests/unit/a.test.js#L1) [a:7](../tests/unit/a.test.js#L7) [h](../tests/helpers/h.js#L1)'), [], 'Untitled anchors on declarations (also t.test) and anchors into helpers pass');
	assert.deepEqual(check('[b](../tests/unit/b.test.js#L1)'), ['参照先の試験ファイルがない: ../tests/unit/b.test.js']);
	assert.deepEqual(check('[a](../tests/unit/a.test.js#L9)'), ['参照先の行 9 が ../tests/unit/a.test.js の行数を超える']);
	assert.deepEqual(check('[a.test.js:2](../tests/unit/a.test.js#L1) `alpha \\|\\| beta`'), ['リンクの文字の行番号 2 とアンカー #L1 が異なる（../tests/unit/a.test.js）']);
	assert.deepEqual(check('[同2行](../tests/unit/a.test.js#L1)'), ['リンクの文字の行番号 2 とアンカー #L1 が異なる（../tests/unit/a.test.js）'], 'The 同N行 label form is compared too');
	assert.deepEqual(check('[a](../tests/unit/a.test.js#L2) `alpha \\|\\| beta`'), ['../tests/unit/a.test.js:2 が試験「alpha || beta」の宣言ではない']);
	assert.deepEqual(check('[a](../tests/unit/a.test.js#L6) `gamma`'), ['../tests/unit/a.test.js:6 が試験「gamma」の宣言ではない'], 'A commented-out test is not a declaration');
	assert.deepEqual(check('[a](../tests/unit/a.test.js#L4) [a](../tests/unit/a.test.js#L6) [a](../tests/unit/a.test.js#L8)'), ['../tests/unit/a.test.js:4 が試験の宣言の行ではない', '../tests/unit/a.test.js:6 が試験の宣言の行ではない', '../tests/unit/a.test.js:8 が試験の宣言の行ではない'], 'An untitled anchor into a test file must be a declaration (not a continuation, comment or hook)');
	assert.deepEqual(check('[a](../tests/unit/a.test.js) `delta`'), ['試験名が ../tests/unit/a.test.js にない: delta']);
	assert.deepEqual(check('`missing.test.js`'), ['試験ファイルが tests/ の下にない: missing.test.js']);
	assert.deepEqual([checkDocs.labelLine('a.test.js:12'), checkDocs.labelLine('同34行'), checkDocs.labelLine('上記テスト')], ['12', '34', null]);
}));

test('check-docs: stale anchors are repointed to the unique declaration of the named test', () => withTempDir({
	'tests/unit/a.test.js': ['// header', "test('alpha', () => {});", "test('beta', () => {});", "test('beta', () => {});"].join('\n')
}, root => {
	const text = '[a.test.js:1](../tests/unit/a.test.js#L1) `alpha` / [b](../tests/unit/a.test.js#L1) `beta` / [a.test.js:2](../tests/unit/a.test.js#L2) `alpha` / [同1行](../tests/unit/a.test.js#L2) `alpha` / [同1行](../tests/unit/a.test.js#L1) `alpha` / [x](../tests/unit/a.test.js#L1) `alpha`';
	assert.deepEqual(checkDocs.fixAnchors('docs/x.md', text, root), { text: '[a.test.js:2](../tests/unit/a.test.js#L2) `alpha` / [b](../tests/unit/a.test.js#L1) `beta` / [a.test.js:2](../tests/unit/a.test.js#L2) `alpha` / [同2行](../tests/unit/a.test.js#L2) `alpha` / [同2行](../tests/unit/a.test.js#L2) `alpha` / [x](../tests/unit/a.test.js#L2) `alpha`', fixed: 4 }, 'Both label forms follow the anchor, a plain label is kept, and an ambiguous name is left as it is');
}));

test('check-docs: camelCase identifiers in design documents must exist in code or tests', () => {
	const code = "function saveRepLocal() {}\nconst re = /\\bbackgroundFetch\\b/;\nwindow.getActiveAppMode = 1;";
	const text = ['`saveRepLocal()` と `getActiveAppMode`、`backgroundFetch`', '`setActiveAppMode(null)`・`insertAdjacentHTML`・`default-src`・`data-click`', '`wrongNameHere`', '`navigator.sendBeacon`・`data-someName`・`someName-x`・`$someName`'].join('\n');
	assert.deepEqual(checkDocs.checkIdentifiers('d.md', text, code).map(issue => `${issue.line}: ${issue.message}`), [
		'2: 識別子がコード・試験にない: setActiveAppMode',
		'3: 識別子がコード・試験にない: wrongNameHere'
	], 'Escapes like \\b are removed before splitting, so backgroundFetch inside the regular expression counts; names after a dot, a hyphen or $, and before a hyphen, are not checked');
	assert.ok(checkDocs.KNOWN_EXTERNAL_NAMES.has('insertAdjacentHTML'));
});

test('check-docs: the identifier vocabulary is code only, without test strings, comments or the development scripts', () => withTempDir({
	'js/a.js': "function liveName() {}\n// commentName\nconst key = 'storageKeyName';\n",
	'sw.js': 'self.swName = 1;\n',
	'index.html': '<button data-click="htmlName"></button><!-- htmlCommentName -->',
	'tests/unit/a.test.js': "const helperName = 1;\nassert.equal(x, 'testStringName'); // testCommentName\nconst t = `tpl ${templateExprName}`;\n",
	'tests/unit/dev-scripts.test.js': 'const devFixtureName = 1;\n',
	'tests/unit/dev-scripts-other.test.js': 'const devOtherFixtureName = 1;\n',
	'tests/helpers/dev-scripts.js': 'const devHelperName = 1;\n',
	'tests/helpers/other.js': 'const otherHelperName = 1;\n',
	'tests/system/scripts/nested.js': 'const nestedScriptName = 1;\n',
	'tests/scripts/s.js': 'const scriptName = 1;\n'
}, root => {
	const words = new Set(checkDocs.vocabularyText(root).match(/[\w$]+/g));
	for (const name of ['liveName', 'storageKeyName', 'swName', 'htmlName', 'helperName', 'templateExprName', 'otherHelperName', 'nestedScriptName']) assert.ok(words.has(name), `${name} counts`);
	for (const name of ['commentName', 'htmlCommentName', 'testStringName', 'testCommentName', 'devFixtureName', 'devOtherFixtureName', 'devHelperName', 'scriptName']) assert.ok(!words.has(name), `${name} does not count`);
}));

test('check-docs: --base checks every line and separates only the problems the base tree also has', { skip: !gitAvailable }, () => withTempDir({
	'docs/requirements.md': '**文書版**: 1.10<br>\n**改訂日**: 2026年11月21日<br>\n',
	'docs/external_design.md': '**文書版**: 1.10<br>\n**改訂日**: 2026年11月21日<br>\n',
	'docs/internal_design.md': '**文書版**: 1.10<br>\n**改訂日**: 2026年11月21日<br>\n`oldStaleName`\n',
	'docs/specification_traceability.md': '**作成日**: 2026年10月24日（11月21日 追補）<br>\n| [a.test.js:1](../tests/unit/a.test.js#L1) `alpha` |\n',
	'docs/development_process.md': '**文書バージョン**: 1.8.0<br>\n**改訂日**: 2026年11月21日 (v1.8.0: x)<br>\n',
	'docs/reviews/r.md': '## 1回目\n\nGATE1_R1\n',
	'tests/unit/a.test.js': "test('alpha', () => {});\n"
}, root => {
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	const base = git(root, 'rev-parse', 'HEAD');
	const summary = issues => issues.map(issue => `${issue.scope ? `${issue.scope}: ` : ''}${issue.message}`);
	const options = { base, pending: 'docs/reviews/r.md' };
	assert.deepEqual(summary(checkDocs.checkDocs(root, {})), ['プレースホルダーが残っている: GATE1_R1', '識別子がコード・試験にない: oldStaleName'], 'Without --base every problem blocks');
	assert.deepEqual(summary(checkDocs.checkDocs(root, options)), ['変更外: 識別子がコード・試験にない: oldStaleName'], 'The stale name the base also has is separated, and --pending allows that record');
	// 文書を変えずに試験ファイルの行をずらすと、変えていない追跡表の行の参照が壊れる（退行）。比較元にないので変更外にならない。
	fs.writeFileSync(path.join(root, 'tests/unit/a.test.js'), "// moved\ntest('alpha', () => {});\n");
	assert.deepEqual(summary(checkDocs.checkDocs(root, options)), ['../tests/unit/a.test.js:1 が試験「alpha」の宣言ではない', '変更外: 識別子がコード・試験にない: oldStaleName']);
	fs.writeFileSync(path.join(root, 'tests/unit/a.test.js'), "test('alpha', () => {});\n");
	fs.appendFileSync(path.join(root, 'docs/internal_design.md'), '`newWrongName` `oldStaleName`\n');
	const edited = new Date(2026, 10, 21, 12);
	fs.utimesSync(path.join(root, 'docs/internal_design.md'), edited, edited);
	assert.deepEqual(summary(checkDocs.checkDocs(root, options)), [
		'変更外: 識別子がコード・試験にない: oldStaleName',
		'識別子がコード・試験にない: newWrongName',
		'識別子がコード・試験にない: oldStaleName',
		'変更があるのに版 1.10 が比較元の 1.10 から上がっていない'
	], 'A second mention of the stale name is new, and the change date is the file modification date (2026-11-21, not later)');
	assert.deepEqual(summary(checkDocs.checkDocs(root, { ...options, date: '2026-11-23' })).filter(message => message.includes('改訂日')), ['変更があるのに改訂日（2026-11-21）が変更の日（2026-11-23）より前'], '--date gives the change date of uncommitted documents');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'edit', '--date=2026-11-20T12:00:00');
	assert.equal(checkDocs.changedDocs(root, base, undefined, ['docs/internal_design.md'])['docs/internal_design.md'].date, '2026-11-20', 'A committed change is dated by the author date, which --amend and rebase keep');
	assert.equal(checkDocs.changedDocs(root, base, '2026-11-19', ['docs/internal_design.md'])['docs/internal_design.md'].date, '2026-11-19', '--date also applies to committed documents');
	assert.equal(quiet(() => checkDocs.main(['--root', root, '--base', 'no-such-commit'])), 2, 'A base that git cannot use is an environment error');
	assert.equal(quiet(() => checkDocs.main(['--root', root, '--base', base, '--pending', 'docs/reviews/r.md'])), 1);
	assert.equal(quiet(() => checkDocs.main(['--date', '2026/11/22'])), 2);
	assert.equal(quiet(() => checkDocs.main(['--root', root])), 2, '--base is required');
	for (const args of [['--root'], ['--base'], ['--base', 'x', '--date'], ['--base', 'x', '--pending']]) assert.equal(quiet(() => checkDocs.main(args)), 2, `${args.join(' ')} without a value is an argument error`);
	assert.equal(checkDocs.parseArgs(['--fix-anchors']).error, undefined, '--fix-anchors alone may omit --base');
}));

test('check-docs: out-of-change marking counts each base problem once and the report ignores it for the exit code', () => {
	const issue = (message, line = 1) => ({ file: 'd.md', line, message });
	assert.deepEqual(checkDocs.markOutOfChange([issue('x', 1), issue('x', 9), issue('y')], [issue('x', 3), issue('z')]).map(entry => `${entry.line}:${entry.scope || ''}`), ['1:変更外', '9:', '1:'], 'Only as many as the base has are out of change; line numbers are ignored');
	assert.equal(quiet(() => checkDocs.report([{ ...issue('x'), scope: '変更外' }], 't')), 0);
	assert.equal(quiet(() => checkDocs.report([{ ...issue('x'), scope: '変更外' }, issue('y')], 't')), 1);
	assert.equal(quiet(() => checkDocs.report([{ file: '(git)', line: 0, message: 'x' }], 't')), 2);
});

test('check-docs: first-line positions, partial headers, the supplement boundary, the printed report and failure paths', { skip: !gitAvailable }, () => {
	assert.deepEqual(checkDocs.checkProcessHeader('p.md', '**改訂日**: 2026年11月22日 (v1.7.1: x)<br>\n**文書バージョン**: 1.8.0<br>'), [{ file: 'p.md', line: 1, message: '文書バージョン 1.8.0 と改訂日の最新の版 v1.7.1 が異なる' }], 'A match on the first line is line 1');
	assert.equal(checkDocs.checkProcessHeader('p.md', '**文書バージョン**: 1.8.0<br>')[0].message, '文書バージョンまたは改訂日の版の記述がない', 'A version without the revision line is reported');
	assert.ok(checkDocs.compareVersions('1.9', '1.10') < 0);
	const doc = (version, date) => `# t\n\n**文書版**: ${version}<br>\n**改訂日**: ${date}<br>\n`;
	assert.deepEqual(checkDocs.checkDesignHeaders({ 'a.md': doc('1.10', '2026年11月21日'), 'd.md': '**文書版**: 1.10<br>' }).map(issue => `${issue.file}:${issue.line}: ${issue.message}`), ['d.md:1: 改訂日の行がない'], 'A header without a date is not compared');
	assert.deepEqual(checkDocs.checkChangedDocs({ 'docs/specification_traceability.md': { text: '**作成日**: 2026年10月24日（11月21日 追補）<br>', baseText: '', date: '2026-11-21' } }), [], 'A supplement on the change date is enough');
	assert.equal(checkDocs.parseArgs(['--base', 'x', '--date', '2026-11-22']).error, undefined);
	const printed = captured(() => checkDocs.report([{ file: 'd.md', line: 1, message: 'x', scope: '変更外' }, { file: 'd.md', line: 2, message: 'y' }], 't'));
	assert.equal(printed.code, 1);
	assert.deepEqual(printed.text.split('\n'), ['d.md:2: y', 'd.md:1: 変更外: x', 't: 1件の問題（ほかに比較元にもある変更外 1件。残件台帳で扱う）']);
	withTempDir({ 'docs/requirements.md': doc('1.10', '2026年11月21日'), 'docs/internal_design.md': doc('1.10', '2026年11月21日') }, root => {
		git(root, 'init', '-q');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'base');
		const base = git(root, 'rev-parse', 'HEAD');
		fs.rmSync(path.join(root, 'docs/requirements.md'));
		assert.deepEqual(checkDocs.changedDocs(root, base, undefined, ['docs/requirements.md', 'docs/internal_design.md']), {}, 'A deleted document is skipped');
		assert.equal(checkDocs.changedDocs(root, 'no-such-commit', undefined, ['docs/internal_design.md']), null);
		assert.equal(checkDocs.extractTree(root, 'no-such-commit'), null);
		// 比較元の木の submodule（gitlink。種類は commit）は写さない。
		git(root, 'update-index', '--add', '--cacheinfo', `160000,${base},tests/sub`);
		git(root, 'commit', '-q', '-m', 'submodule');
		const tree = checkDocs.extractTree(root, git(root, 'rev-parse', 'HEAD'));
		try {
			assert.deepEqual([fs.existsSync(path.join(tree, 'tests/sub')), fs.existsSync(path.join(tree, 'docs/internal_design.md'))], [false, true], 'Only blobs of the base tree are written, not a submodule entry');
		} finally {
			fs.rmSync(tree, { recursive: true, force: true });
		}
		// .. という名前の木を含むコミット（git の checkout は拒むが ls-tree・cat-file は拒まない）を比較元にしても、一時ディレクトリの外に書かない。
		// 木とコミットは、親の GIT_ の環境変数（Git のフックの中の GIT_DIR など）によらず root のリポジトリに作り、そこにあることを確かめてから渡す。
		const escaped = path.join(os.tmpdir(), `kogai-escaped-${process.pid}.txt`);
		let crafted = gitInput(root, `100644 blob ${gitInput(root, 'escaped\n', 'hash-object', '-w', '--stdin')}\t${path.basename(escaped)}\n`, 'mktree');
		for (const name of ['..', '..', 'docs']) crafted = gitInput(root, `040000 tree ${crafted}\t${name}\n`, 'mktree');
		const commit = git(root, 'commit-tree', crafted, '-m', 'crafted');
		assert.equal(git(root, 'ls-tree', '-r', '--name-only', commit, '--', 'docs'), `docs/../../${path.basename(escaped)}`, 'The crafted commit is in the repository under test and its blob path climbs out of docs/');
		try {
			assert.equal(checkDocs.extractTree(root, commit), null, 'A base tree with .. in a path cannot be used');
			assert.equal(fs.existsSync(escaped), false, 'Nothing is written outside the temporary directory');
		} finally {
			fs.rmSync(escaped, { force: true });
		}
	});
});

test('check-docs: a test name matches whole, within three lines after the declaration and with escaped quotes; placeholder forms', () => {
	assert.equal(checkDocs.declaresTest(["test('alpha', () => {});", "test('beta', () => {});"], 0, 'beta'), false, 'The window stops before the next declaration');
	const lines = [
		"test('mode=x restores', () => {});",
		'test(cond',
		"\t? 'a'",
		"\t: 'b'",
		"\t|| 'third after', () => {});",
		'test(other',
		"\t? 'a'",
		"\t: 'b'",
		"\t: 'c'",
		"\t|| 'fourth after', () => {});",
		"test('it\\'s fine', () => {});"
	];
	assert.equal(checkDocs.declaresTest(lines, 0, 'mode=x restores'), true);
	assert.equal(checkDocs.declaresTest(lines, 0, 'restores'), false, 'A part at the end is not the name');
	assert.equal(checkDocs.declaresTest(lines, 0, 'mode=x'), false, 'A part at the start is not the name');
	assert.equal(checkDocs.declaresTest(lines, 1, 'third after'), true, 'A name three lines after the declaration counts');
	assert.equal(checkDocs.declaresTest(lines, 5, 'fourth after'), false, 'A name four lines after does not');
	assert.equal(checkDocs.declaresTest(lines, 10, "it's fine"), true, 'Escaped quotes are compared unescaped');
	assert.deepEqual(checkDocs.findPlaceholders('R25_GATE2_TBD と SPEC_Q_GATE1_R1 と SPEC_Q_GATE1_TBD').map(found => found.token), ['R25_GATE2_TBD', 'SPEC_Q_GATE1_R1', 'SPEC_Q_GATE1_TBD'], 'A prefixed placeholder with any suffix, and several prefixes in both forms');
	assert.equal(stripScriptNoise('x = typeof /a/g;'), 'x = typeof 0   ;', 'A regular expression may follow typeof');
});

test('check-docs: --fix-anchors rewrites the file, an uncommitted edit after a commit is dated by the file, the base tree keeps code, tests and file names, and new directories are listed', { skip: !gitAvailable }, () => {
	withTempDir({
		'docs/specification_traceability.md': '| [a.test.js:1](../tests/unit/a.test.js#L1) `alpha` |\n',
		'tests/unit/a.test.js': "// header\ntest('alpha', () => {});\n"
	}, root => {
		const printed = captured(() => checkDocs.main(['--fix-anchors', '--root', root]));
		assert.equal(printed.code, 0, printed.text);
		assert.match(printed.text, /docs\/specification_traceability\.md のアンカーを 1件直した/);
		assert.equal(fs.readFileSync(path.join(root, 'docs/specification_traceability.md'), 'utf8'), '| [a.test.js:2](../tests/unit/a.test.js#L2) `alpha` |\n');
	});
	const doc = '**文書版**: 1.10<br>\n**改訂日**: 2026年11月21日<br>\n';
	withTempDir({
		'docs/requirements.md': doc,
		'docs/external_design.md': doc,
		'docs/internal_design.md': `${doc}\`liveFunction\` \`htmlOnlyName\` \`oldStaleName\` \`testOnlyHelper\` \`swOnlyName\`\n`,
		'js/a.js': 'function liveFunction() {}\n',
		'index.html': '<button data-click="htmlOnlyName"></button>',
		'tests/unit/b.test.js': 'function testOnlyHelper() {}\n',
		'sw.js': 'function swOnlyName() {}\n'
	}, root => {
		git(root, 'init', '-q');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'base');
		const base = git(root, 'rev-parse', 'HEAD');
		fs.writeFileSync(path.join(root, 'js/a.js'), 'function renamedFunction() {}\n');
		fs.writeFileSync(path.join(root, 'index.html'), '<button data-click="otherName"></button>');
		fs.writeFileSync(path.join(root, 'tests/unit/b.test.js'), 'function renamedHelper() {}\n');
		fs.writeFileSync(path.join(root, 'sw.js'), 'function renamedWorker() {}\n');
		fs.appendFileSync(path.join(root, 'docs/external_design.md'), '`oldStaleName`\n');
		const identifiers = checkDocs.checkDocs(root, { base, date: '2026-11-21' }).filter(issue => issue.message.startsWith('識別子')).map(issue => `${issue.file} ${issue.scope || '報告'} ${issue.message.split(': ')[1]}`);
		assert.deepEqual(identifiers, [
			'docs/external_design.md 報告 oldStaleName',
			'docs/internal_design.md 報告 liveFunction',
			'docs/internal_design.md 報告 htmlOnlyName',
			'docs/internal_design.md 変更外 oldStaleName',
			'docs/internal_design.md 報告 testOnlyHelper',
			'docs/internal_design.md 報告 swOnlyName'
		], 'Renaming code breaks unchanged lines (the base tree has js, index.html, the tests and sw.js), and the same name in another document is new');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'edit', '--date=2026-11-20T12:00:00');
		// external_design.md は比較元の後のコミット（作成者の日付 2026-11-20）に入っている。その後に未コミットで直す。
		fs.appendFileSync(path.join(root, 'docs/external_design.md'), 'more\n');
		const edited = new Date(2026, 10, 22, 12);
		fs.utimesSync(path.join(root, 'docs/external_design.md'), edited, edited);
		const dates = checkDocs.changedDocs(root, base, undefined, ['docs/external_design.md', 'docs/internal_design.md']);
		assert.equal(dates['docs/external_design.md'].date, '2026-11-22', 'An uncommitted edit after a commit is dated by the file, not by the commit');
		assert.equal(dates['docs/internal_design.md'], undefined, 'A document unchanged since the base is not listed');
	});
	withTempDir({ 'js/a.js': 'x;\n' }, root => {
		git(root, 'init', '-q');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'base');
		fs.mkdirSync(path.join(root, 'docs'));
		fs.writeFileSync(path.join(root, 'docs/internal_design.md'), 'new\n');
		assert.deepEqual(Object.keys(checkDocs.changedDocs(root, git(root, 'rev-parse', 'HEAD'), undefined, ['docs/internal_design.md'])), ['docs/internal_design.md'], 'A document in a new, untracked directory is a change');
	});
});
