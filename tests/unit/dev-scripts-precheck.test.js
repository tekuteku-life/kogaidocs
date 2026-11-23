const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripScriptNoise } = require('../scripts/lib/js-lexer');
const precheck = require('../scripts/precheck');
const verifyTwice = require('../scripts/verify-twice');
const { withTempDir, git, gitAvailable, quiet, captured } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: precheck.js（Stage 7・コミットの前の機械的チェック）の判定を確かめる。

test('precheck: whitespace, added lines, script order and global duplicates are checked', () => {
	const text = ['\tconst a = 1;', 'const b = 2; ', '    const c = 3;', ' * JSDoc の継続行', ' */', '\t'].join('\n');
	assert.deepEqual(precheck.whitespaceIssues('x.js', text).map(issue => `${issue.line}: ${issue.message}`), ['2: 末尾空白', '3: 行頭の空白（タブでインデントする）', '6: 末尾空白']);
	assert.deepEqual(precheck.whitespaceIssues('n.md', 'a\n\n\t\n').map(issue => `${issue.line}: ${issue.message}`), ['3: 末尾空白', '2: ファイルの末尾の余分な空行'], 'Blank lines before the final newline are reported from the first one');
	assert.deepEqual(precheck.whitespaceIssues('n.md', 'a\n'), [], 'A single final newline is fine');
	assert.deepEqual(precheck.whitespaceIssues('s.js', ' \tspaceBeforeTab();\n   \n  * jsdoc\n').map(issue => `${issue.line}: ${issue.message}`), ['1: 行頭の空白（タブでインデントする）', '2: 末尾空白'], 'A space before a tab is reported; a JSDoc line is not, and a line of spaces only is trailing whitespace');
	const diff = ['+++ b/early.js', '@@ -0,0 +1 @@', '+early', 'diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1,0 +2,3 @@', '+    spaced();', '+\tfine();', '+++ b/z.js', 'diff --git a/c.js b/c.js', '--- a/c.js', '+++ b/c.js', '@@ -5 +7 @@', '+x'].join('\n');
	assert.deepEqual(precheck.addedLines(diff), [{ file: 'a.js', line: 2, text: '    spaced();' }, { file: 'a.js', line: 3, text: '\tfine();' }, { file: 'a.js', line: 4, text: '++ b/z.js' }, { file: 'c.js', line: 7, text: 'x' }], 'An added line starting with ++ is an added line, not a file header, and lines before the first diff --git are not read');
	// 空白を含む名前の後のタブと、引用された名前（" を含む・ASCII 以外の文字を 8進数で逃がした名前）。
	const named = ['diff --git a/my file.js b/my file.js', '--- a/my file.js\t', '+++ b/my file.js\t', '@@ -0,0 +1 @@', '+  a();', 'diff --git "a/q\\"x.js" "b/q\\"x.js"', '--- "a/q\\"x.js"', '+++ "b/q\\"x.js"', '@@ -0,0 +1 @@', '+  b();', 'diff --git "a/\\345\\220\\215.js" "b/\\345\\220\\215.js"', '+++ "b/\\345\\220\\215.js"', '@@ -0,0 +1 @@', '+  c();'].join('\n');
	assert.deepEqual(precheck.addedLines(named).map(added => added.file), ['my file.js', 'q"x.js', '名.js'], 'The names are read back as the files');
	assert.deepEqual(precheck.whitespaceIssues('crlf.js', 'x();\r\n\tz(); \r\n').map(issue => `${issue.line}: ${issue.message}`), ['1: 末尾空白', '2: 末尾空白'], 'A CR at the end of a line is trailing whitespace, as for git diff --check');
	assert.deepEqual(precheck.whitespaceIssues('crlf.md', 'a\r\n\r\n').map(issue => `${issue.line}: ${issue.message}`), ['1: 末尾空白', '2: 末尾空白', '2: ファイルの末尾の余分な空行'], 'A blank CRLF line before the end is an extra blank line');
	assert.deepEqual(precheck.scriptOrder('<script src="js/a.js"></script>\n<script defer src="./js/b.js"></script>'), ['js/a.js', 'js/b.js']);
	const duplicates = precheck.globalDuplicates([{ file: 'js/a.js', text: 'function save() {}\nvar shared = 1;\nconst only = 1;' }, { file: 'js/b.js', text: 'function save() {}\nvar shared = 2;' }]);
	assert.deepEqual(duplicates.map(issue => `${issue.file}:${issue.line}: ${issue.message}`), ['js/b.js:1: トップレベルの宣言 save が js/a.js:1 と重複する', 'js/b.js:2: トップレベルの宣言 shared が js/a.js:2 と重複する']);
	const baseScripts = [{ file: 'js/a.js', text: 'function save() {\n\treturn "}";\n}\nvar keep = 1;' }, { file: 'js/b.js', text: 'function save() {\n\treturn 2;\n}' }];
	assert.equal(precheck.declarationBody(stripScriptNoise(baseScripts[0].text, { blankStrings: true }).split('\n'), baseScripts[0].text.split('\n'), 0), 'function save() {\n\treturn "}";\n}', 'A brace inside a string does not end the body');
	const signatures = precheck.duplicateSignatures(baseScripts);
	assert.deepEqual([...signatures.keys()], ['save']);
	const scoped = scripts => precheck.globalDuplicates(scripts, signatures).map(issue => `${issue.file}:${issue.line} ${issue.scope || '報告'}`);
	assert.deepEqual(scoped(baseScripts), ['js/b.js:1 変更外'], 'The same files, count and bodies as the base are out of change');
	assert.deepEqual(scoped([baseScripts[0], { file: 'js/b.js', text: 'function save() {\n\treturn 3;\n}' }]), ['js/b.js:1 報告'], 'Rewriting a declaration body is reported');
	assert.deepEqual(scoped([...baseScripts, { file: 'js/c.js', text: 'function save() {}' }]), ['js/b.js:1 報告', 'js/c.js:1 報告'], 'Adding a third declaration is reported');
	assert.deepEqual(scoped([{ file: 'js/b.js', text: baseScripts[1].text }, baseScripts[0]]).length, 1, 'A changed load order changes the signature');
	assert.equal(scoped([{ file: 'js/b.js', text: baseScripts[1].text }, baseScripts[0]])[0].endsWith('報告'), true);
	assert.match(precheck.globalDuplicates([{ file: 'js/a.js', text: 'const x = 1;' }, { file: 'js/b.js', text: 'const x = 2;' }])[0].message, /構文の誤り/);
	withTempDir({ 'js/a.js': '', 'js/sub/b.js': '', 'sw.js': '', 'tests/unit/c.test.js': '', 'tests/node_modules/x.js': '', 'tests/.hidden/y.js': '', 'css/a.css': '' }, root => {
		assert.deepEqual(precheck.scriptFiles(root), ['js/a.js', 'js/sub/b.js', 'sw.js', 'tests/unit/c.test.js']);
	});
	assert.ok(precheck.parseArgs(['--bogus']).error);
	assert.ok(precheck.parseArgs(['--base', 'x', '--date', '2026/11/22']).error);
	assert.equal(precheck.parseArgs(['--base', 'x', '--date', '2026-11-22']).date, '2026-11-22');
	assert.match(precheck.parseArgs([]).error, /--base/, '--base is required');
});

test('precheck: a temporary repository reports base-relative whitespace, syntax, new duplicates, docs with --pending and --date, and the verified digest', { skip: !gitAvailable }, () => withTempDir({
	'index.html': '<script src="js/a.js"></script><script src="js/b.js"></script>',
	'js/a.js': 'function save() {}\nfunction old() {}\n',
	'js/b.js': 'function old() {}\n',
	'tests/unit/a.test.js': '',
	'docs/r.md': '',
	...Object.fromEntries(['requirements', 'external_design', 'internal_design'].map(name => [`docs/${name}.md`, '**文書版**: 1.0<br>\n**改訂日**: 2026年11月21日<br>\n']))
}, root => {
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	const base = git(root, 'rev-parse', 'HEAD');
	assert.deepEqual(precheck.precheck(root, { base }).map(issue => `${issue.file}:${issue.line}: ${issue.scope}`), ['js/b.js:1: 変更外'], 'The duplicate already present at the base is out of change');
	assert.equal(quiet(() => precheck.main(['--root', root, '--base', base])), 0, 'Out-of-change problems alone do not fail');
	fs.writeFileSync(path.join(root, 'js/b.js'), 'function old() {}\nfunction save() {} \n    spaced();\n');
	git(root, 'add', 'js/b.js');
	fs.writeFileSync(path.join(root, 'js/c.js'), 'function ( \n');
	fs.writeFileSync(path.join(root, 'docs/r.md'), 'GATE2_R1\n');
	// ASCII 以外の文字の名前は、git diff --check の行では（core.quotepath によらず）引用されず、元のまま報告する。
	fs.writeFileSync(path.join(root, 'js/名.js'), 'named(); \n');
	git(root, 'add', 'js/名.js');
	const issues = precheck.precheck(root, { base }).map(issue => `${issue.file}:${issue.line}: ${issue.message}`);
	for (const expected of [/^js\/名\.js:1: git diff --check/, /^js\/c\.js:1: 構文エラー/, /^js\/b\.js:2: トップレベルの宣言 save が js\/a\.js:1 と重複する/, /^js\/b\.js:2: git diff --check/, /^js\/b\.js:3: 行頭の空白/, /^js\/c\.js:1: 末尾空白/, /^docs\/r\.md:1: プレースホルダーが残っている: GATE2_R1/]) {
		assert.ok(issues.some(issue => expected.test(issue)), `${expected} in ${JSON.stringify(issues)}`);
	}
	assert.equal(precheck.precheck(root, { base, pending: 'docs/r.md' }).some(issue => /プレースホルダー/.test(issue.message)), false, '--pending reaches the document check');
	fs.appendFileSync(path.join(root, 'docs/internal_design.md'), 'changed\n');
	const edited = new Date(2026, 10, 20, 12);
	fs.utimesSync(path.join(root, 'docs/internal_design.md'), edited, edited);
	const dated = options => precheck.precheck(root, { base, ...options }).filter(issue => /改訂日/.test(issue.message)).map(issue => issue.message);
	assert.deepEqual(dated({}), [], 'The file date (2026-11-20) is not after the revision date');
	assert.deepEqual(dated({ date: '2026-11-25' }), ['変更があるのに改訂日（2026-11-21）が変更の日（2026-11-25）より前'], '--date reaches the document check');
	fs.writeFileSync(path.join(root, 'data.json'), '{ "a": 1 } \n');
	assert.ok(precheck.precheck(root, { base }).some(issue => `${issue.file}:${issue.line}: ${issue.message}` === 'data.json:1: 末尾空白'), 'An untracked .json file is checked');
	fs.rmSync(path.join(root, 'data.json'));
	fs.writeFileSync(path.join(root, 'docs/v.md'), `| 検証したコードの SHA-256 | ${verifyTwice.codeDigest(root)} |`);
	assert.equal(precheck.precheck(root, { base, verified: 'docs/v.md' }).filter(issue => issue.file === 'docs/v.md').length, 0, 'A matching digest passes');
	fs.appendFileSync(path.join(root, 'js/a.js'), '// changed after verification\n');
	assert.match(precheck.precheck(root, { base, verified: 'docs/v.md' }).find(issue => issue.file === 'docs/v.md').message, /一致しない/);
	fs.writeFileSync(path.join(root, 'docs/v.md'), 'no digest');
	assert.match(precheck.precheck(root, { base, verified: 'docs/v.md' }).find(issue => issue.file === 'docs/v.md').message, /SHA-256」がない/);
	assert.equal(quiet(() => precheck.main(['--root', root, '--base', base])), 1);
	assert.equal(quiet(() => precheck.main(['--root', root, '--date', 'x'])), 2);
	for (const args of [['--root'], ['--base'], ['--base', base, '--verified'], ['--base', base, '--pending'], ['--base', base, '--date']]) assert.equal(quiet(() => precheck.main(args)), 2, `${args.join(' ')} without a value is an argument error`);
	assert.equal(quiet(() => precheck.main(['--root', root, '--base', base, '--verified', 'docs/none.md'])), 2, 'A missing verification record is an argument error');
	const unreadable = captured(() => precheck.main(['--root', root, '--base', base, '--verified', 'docs']));
	assert.equal(unreadable.code, 2, 'A verification record that cannot be read (a directory) is an argument error');
	assert.match(unreadable.text, /検証記録 docs がない・読めない（EISDIR）/, 'The error code is printed');
	// git がないと検証したコードの集約値を求められない（環境の誤り。2）。
	const savedPath = process.env.PATH;
	process.env.PATH = path.join(root, 'no-bin');
	try {
		assert.equal(quiet(() => precheck.main(['--root', root, '--base', base, '--verified', 'docs/v.md'])), 2, 'Without git, --verified is an environment error');
	} finally {
		process.env.PATH = savedPath;
	}
}));

test('precheck: removed lines, unclosed bodies, braces in strings, binary files, syntax messages and git failures', { skip: !gitAvailable }, () => {
	assert.deepEqual(precheck.addedLines(['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1,2 +1,2 @@', '-removed', '+added', ' context'].join('\n')), [{ file: 'a.js', line: 1, text: 'added' }], 'Removed and context lines are not added lines');
	assert.equal(precheck.declarationBody(['function f() {', '\tx'], ['function f() {', '\tx'], 0), 'function f() {\n\tx', 'An unclosed body runs to the end of the file');
	const base = [{ file: 'js/a.js', text: 'function save() {\n\treturn "}";\n\tx();\n}' }, { file: 'js/b.js', text: 'function save() {}' }];
	const current = [{ file: 'js/a.js', text: 'function save() {\n\treturn "}";\n\ty();\n}' }, base[1]];
	assert.deepEqual(precheck.globalDuplicates(current, precheck.duplicateSignatures(base)).map(issue => issue.scope || '報告'), ['報告'], 'A change after a brace inside a string is part of the body');
	withTempDir({ 'index.html': '<script src="js/a.js"></script>', 'js/a.js': 'function a() {}\n' }, root => {
		git(root, 'init', '-q');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'base');
		const head = git(root, 'rev-parse', 'HEAD');
		fs.writeFileSync(path.join(root, 'img.png'), 'x \n\n');
		fs.writeFileSync(path.join(root, 'js/c.js'), 'function (\n');
		const issues = precheck.precheck(root, { base: head });
		assert.ok(!issues.some(issue => issue.file === 'img.png'), 'An untracked file that is not text is not checked');
		assert.match(issues.find(issue => issue.file === 'js/c.js').message, /^構文エラー: SyntaxError/);
		const failed = precheck.precheck(root, { base: 'no-such-commit' }).find(issue => issue.message.startsWith('git diff --check no-such-commit'));
		assert.match(failed.message, /を実行できない: \S+/, 'The reason from git is kept');
	});
});

test('precheck: async and generator duplicates, multi-line parameters, and the trailing blank lines of untracked files', { skip: !gitAvailable }, () => {
	const duplicates = precheck.globalDuplicates([{ file: 'js/a.js', text: 'async function load() {}\nfunction* items() {}\nasync function* stream() {}' }, { file: 'js/b.js', text: 'async function load() {}\nfunction* items() {}\nasync function* stream() {}' }]);
	assert.deepEqual(duplicates.map(issue => issue.name), ['load', 'items', 'stream']);
	const base = [{ file: 'js/a.js', text: 'function f(\n\ta\n) {\n\treturn 1;\n}' }, { file: 'js/b.js', text: 'function f() {}' }];
	const current = [{ file: 'js/a.js', text: 'function f(\n\ta\n) {\n\treturn 2;\n}' }, base[1]];
	assert.deepEqual(precheck.globalDuplicates(current, precheck.duplicateSignatures(base)).map(issue => issue.scope || '報告'), ['報告'], 'A body after multi-line parameters is part of the signature');
	assert.deepEqual(precheck.globalDuplicates(base, precheck.duplicateSignatures(base)).map(issue => issue.scope || '報告'), ['変更外']);
	withTempDir({ 'index.html': '', 'js/a.js': 'x;\n' }, root => {
		git(root, 'init', '-q');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'base');
		const head = git(root, 'rev-parse', 'HEAD');
		fs.mkdirSync(path.join(root, 'docs'));
		fs.writeFileSync(path.join(root, 'docs/n.md'), 'a\n\n');
		fs.writeFileSync(path.join(root, 'js/n.js'), 'y;\n\n\n');
		const blank = precheck.precheck(root, { base: head }).filter(issue => issue.message === 'ファイルの末尾の余分な空行').map(issue => `${issue.file}:${issue.line}`);
		assert.deepEqual(blank.sort(), ['docs/n.md:2', 'js/n.js:2']);
	});
});
