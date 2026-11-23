const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const precheck = require('../scripts/precheck');
const verifyTwice = require('../scripts/verify-twice');
const findingScope = require('../scripts/finding-scope');
const checkDocs = require('../scripts/check-docs');
const mutate = require('../scripts/mutate');
const { withTempDir, git, gitInput, gitAvailable } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: lib/git.js（利用者の Git の設定・環境変数によらない git の呼出し）の判定を確かめる。

test('scripts give the same results whatever the user Git settings, the clone settings and repository variables are', { skip: !gitAvailable }, () => withTempDir({
	'index.html': '<script src="js/a.js"></script>',
	'js/a.js': ['function a() {}', 'one();', 'two();', 'three();', 'four();', 'five();', 'six();', 'seven();', 'eight();', 'nine();', 'ten();', ''].join('\n'),
	'js/名前.js': 'x;\n',
	// 改名する前のファイル（比較元から行頭が空白の行がある。改名を検出しないと、その行も追加の行になる）。
	'js/old.js': ['function legacy() {', '    kept();', '\tfirst();', '}', ''].join('\n'),
	// 2つ目の改名（改名の検出の上限 diff.renameLimit = 1 を超える）。
	'js/old2.js': ['function older() {', '    held();', '\tthird();', '}', ''].join('\n'),
	// 改行を CRLF に変える追跡対象のファイル（core.autocrlf で変換すると、CR の末尾空白と変えた行が見えなくなる）。
	'js/crlf.js': 'a();\nb();\n',
	// 比較元の後に、署名したコミットで変える文書（利用者の log.showSignature で、変更の日に検証の行が混ざる）。docs/ は後で未追跡の新しいディレクトリとして作るので、別のディレクトリに置く。
	'notes/signed.md': 'v1\n',
	// 差分の範囲の試料（mutate.js の --since が使う git diff --no-index）。.gitignore で検査と集約値から外す。
	'.gitignore': 'ranges/\n',
	'ranges/algorithm-draft.js': ['c', 'a', 'a', 'b', 'b', 'b', ''].join('\n'),
	'ranges/algorithm-final.js': ['a', 'a', 'a', 'b', 'b', 'c', ''].join('\n'),
	'ranges/heuristic-draft.js': ['\ty();', '}', '}', '\ty();', '\tx();', 'if (a) {', 'if (a) {', ''].join('\n'),
	'ranges/heuristic-final.js': ['\ty();', '}', '}', '\ty();', '}', '}', '\ty();', '\tx();', 'if (a) {', 'if (a) {', ''].join('\n'),
	// リポジトリの属性: diff ドライバー prefix は、利用者の設定が textconv を定めたときだけ効く。js/名前.js には属性がなく、
	// 利用者の属性ファイル（*.js -diff）が読まれると、その差分がバイナリになる（リポジトリの属性が優先するので js/a.js には当たらない）。
	'.gitattributes': 'js/a.js diff=prefix\n'
}, root => {
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	const base = git(root, 'rev-parse', 'HEAD');
	// 偽の署名の検証のプログラム（検証は常に成功とし、gpg と同じく人の読む行を標準エラーに出す）。利用者の設定 log.showSignature で使われる。
	// .git の中に置き、検査の対象に入れない。
	const fakeGpg = path.join(root, '.git', 'kogai-fake-gpg.sh');
	fs.writeFileSync(fakeGpg, ['#!/bin/sh', 'cat >/dev/null', "echo '[GNUPG:] GOODSIG 0000000000000000 fake'", 'echo \'gpg: Good signature from "fake"\' >&2', ''].join('\n'), { mode: 0o755 });
	fs.appendFileSync(path.join(root, 'notes/signed.md'), 'v2\n');
	git(root, 'add', 'notes/signed.md');
	// 署名したコミットは、署名のプログラムを実行せず、署名（gpgsig のヘッダー）を持つコミットのオブジェクトとして作る（一時ディレクトリが noexec でもよい）。
	const stamp = `${Math.floor(Date.now() / 1000)} +0000`;
	const signedCommit = gitInput(root, [`tree ${git(root, 'write-tree')}`, `parent ${base}`, `author kogai-test <kogai-test@example.invalid> ${stamp}`, `committer kogai-test <kogai-test@example.invalid> ${stamp}`, 'gpgsig -----BEGIN PGP SIGNATURE-----', ' ', ' ZmFrZQ==', ' -----END PGP SIGNATURE-----', '', 'signed docs', ''].join('\n'), 'hash-object', '-t', 'commit', '-w', '--stdin');
	git(root, 'update-ref', 'HEAD', signedCommit);
	const committed = git(root, 'log', '-1', '--format=%as');
	// クローンの除外（.git/info/exclude）。リポジトリの .gitignore ではないので、未追跡のファイルの検査と集約値には入る。
	fs.writeFileSync(path.join(root, '.git/info/exclude'), 'notes.md\n');
	// 9行離れた2か所の変更（hunk の間の文脈で1つにまとめない）、行頭の空白（自前の検査）、末尾空白とファイル末尾の空行（git diff --check）、
	// 未追跡のファイルの末尾空白、未追跡の新しいディレクトリの中の設計書。
	fs.writeFileSync(path.join(root, 'js/a.js'), ['function a() {}', 'uno();', 'two();', 'three();', 'four();', 'five();', 'six();', 'seven();', 'eight();', 'nine();', 'ten();', '    spaced(); ', '', ''].join('\n'));
	fs.appendFileSync(path.join(root, 'js/名前.js'), 'y;\n');
	git(root, 'mv', 'js/old.js', 'js/new.js');
	fs.writeFileSync(path.join(root, 'js/new.js'), ['function legacy() {', '    kept();', '\tsecond();', '}', ''].join('\n'));
	git(root, 'mv', 'js/old2.js', 'js/new2.js');
	fs.writeFileSync(path.join(root, 'js/new2.js'), ['function older() {', '    held();', '\tfourth();', '}', ''].join('\n'));
	fs.writeFileSync(path.join(root, 'js/crlf.js'), 'a();\r\nb();\r\nc();\r\n');
	const range = name => mutate.changedRanges(path.join(root, `ranges/${name}-draft.js`), path.join(root, `ranges/${name}-final.js`));
	fs.writeFileSync(path.join(root, 'notes.md'), 'note \n');
	fs.mkdirSync(path.join(root, 'docs'));
	fs.writeFileSync(path.join(root, 'docs/internal_design.md'), 'new\n');
	const summary = () => ({
		precheck: precheck.precheck(root, { base }).map(issue => `${issue.file}:${issue.line}: ${issue.message}`).filter(issue => !issue.startsWith('docs/')).sort(),
		ranges: findingScope.captureDiff(root, base).ranges,
		files: Object.keys(verifyTwice.snapshot(root)),
		docs: checkDocs.changedDocs(root, base, undefined, ['docs/internal_design.md', 'notes/signed.md']),
		algorithm: range('algorithm'),
		heuristic: range('heuristic')
	});
	const expected = summary();
	for (const issue of ['js/a.js:12: 行頭の空白（タブでインデントする）', 'js/a.js:12: git diff --check: trailing whitespace.', 'js/a.js:13: git diff --check: new blank line at EOF.', 'js/crlf.js:1: git diff --check: trailing whitespace.', 'js/crlf.js:3: git diff --check: trailing whitespace.', 'notes.md:1: 末尾空白']) assert.ok(expected.precheck.includes(issue), `${issue}: ${JSON.stringify(expected.precheck)}`);
	assert.deepEqual(expected.ranges, { 'notes/signed.md': [[2, 2]], 'js/a.js': [[2, 2], [12, 13]], 'js/crlf.js': [[1, 3]], 'js/new.js': [[3, 3]], 'js/new2.js': [[3, 3]], 'js/名前.js': [[2, 2]] }, 'Separate hunks stay separate, renamed files have only their changed lines, CRLF lines are changed lines, and a path with non-ASCII characters is not quoted');
	assert.ok(!expected.precheck.some(issue => /^js\/new2?\.js:2:/.test(issue)), 'The unchanged indented lines of renamed files are not added lines');
	assert.deepEqual([expected.algorithm, expected.heuristic], [[[1, 1], [6, 6]], [[3, 5]]], 'The draft ranges use the myers algorithm and the indent heuristic');
	assert.ok(expected.files.includes('notes.md'), 'The clone exclusion does not hide an untracked file');
	assert.deepEqual(Object.keys(expected.docs).sort(), ['docs/internal_design.md', 'notes/signed.md']);
	assert.equal(expected.docs['notes/signed.md'].date, committed, 'A committed document takes the author date of the last commit');
	withTempDir({
		'prefix.js': "process.stdout.write(require('node:fs').readFileSync(process.argv[2], 'utf8').replace(/^/gm, 'X'));\n",
		'fail.js': 'process.exit(1);\n',
		'attributes': '*.js -diff\n',
		'excludes': 'notes.md\n'
	}, other => {
		fs.writeFileSync(path.join(other, 'user.gitconfig'), [
			'[diff]', '\tnoprefix = true', '\tmnemonicPrefix = true', '\tinterHunkContext = 10', '\trenames = false', '\trenameLimit = 1', '\talgorithm = histogram', '\tindentHeuristic = false', `\texternal = node ${path.join(other, 'fail.js')}`,
			'[diff "prefix"]', `\ttextconv = node ${path.join(other, 'prefix.js')}`,
			'[color]', '\tui = always',
			'[status]', '\tshowUntrackedFiles = no',
			'[log]', '\tshowSignature = true',
			'[gpg]', `\tprogram = ${fakeGpg}`,
			// 大きなファイルとみなす大きさを試料のファイルより小さくする（差分がバイナリになり、行の差分が出なくなる）。
			'[core]', '\tbigFileThreshold = 10', '\tautocrlf = true', '\twhitespace = -trailing-space,-blank-at-eof', `\tattributesFile = ${path.join(other, 'attributes')}`, `\texcludesFile = ${path.join(other, 'excludes')}`,
			''
		].join('\n'));
		git(other, 'init', '-q');
		const variables = {
			GIT_CONFIG_GLOBAL: path.join(other, 'user.gitconfig'),
			// Git のフックの中で設定される、別のリポジトリ・索引・オブジェクトを指す変数。
			GIT_DIR: path.join(other, '.git'),
			GIT_WORK_TREE: other,
			GIT_INDEX_FILE: path.join(other, '.git/index'),
			GIT_OBJECT_DIRECTORY: path.join(other, '.git/objects'),
			GIT_COMMON_DIR: path.join(other, '.git')
		};
		const saved = Object.fromEntries(Object.keys(variables).map(name => [name, process.env[name]]));
		Object.assign(process.env, variables);
		try {
			assert.deepEqual(summary(), expected, 'Prefixes, hunk merging, renames and their limit, the diff algorithm and indent heuristic, line ending conversion, the big file threshold, signature display, an external diff, textconv, color, untracked listing, core.whitespace, the user attributes and excludes files, and the repository variables of a hook do not change the results');
		} finally {
			for (const [name, value] of Object.entries(saved)) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
	});
}));

test('the +++ line of a diff gives the new path, without the tab after a name with a space and with quoted names read back', () => {
	const { diffTarget, unquote } = require('../scripts/lib/git');
	assert.equal(diffTarget('--- a/x.js'), undefined, 'Other lines are not +++ lines');
	assert.equal(diffTarget('+++ /dev/null'), null, 'A deleted file has no new path');
	assert.equal(diffTarget('+++ b/js/a.js'), 'js/a.js');
	assert.equal(diffTarget('+++ b/my file.js\t'), 'my file.js', 'The tab after a name with a space is not part of the name');
	assert.equal(diffTarget('+++ "b/a\\tb\\\\c\\"d.js"'), 'a\tb\\c"d.js', 'Escaped tab, backslash and quote');
	assert.equal(diffTarget('+++ "b/\\345\\220\\215.js"'), '名.js', 'Octal bytes are read back as UTF-8');
	assert.equal(diffTarget('+++ x.js'), null, 'A path without the b/ prefix is not taken');
	assert.equal(diffTarget('+++ "'), null, 'A lone quote is not a quoted name');
	assert.equal(unquote('\\a\\b\\v\\f\\r\\n名'), '\x07\x08\x0b\x0c\r\n名', 'The named escapes and characters outside ASCII');
});
