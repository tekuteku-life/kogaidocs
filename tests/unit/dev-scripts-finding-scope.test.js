const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const findingScope = require('../scripts/finding-scope');
const { withTempDir, git, gitAvailable, quiet, captured, outsideGit } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: finding-scope.js（指摘の範囲の判定の補助）の判定を確かめる。

test('finding-scope: findings in the observed forms are parsed, resolved and classified against the diff', () => {
	const findings = findingScope.parseFindings([
		'- docs/a.md:10: 文書: wording',
		'- 将来: b.js:20: future path',
		'* js/b.js:200: 変更外: old problem',
		'  js/new.js:1: in a new file',
		'- external_design.md:215・internal_design.md:635: two places',
		'- review83.md:182-184: a range',
		'- specification_traceability.md:410（文書）: noted',
		'- review92:14: a name without an extension',
		'- dev-scripts.test.js:46 ほか: a note without brackets',
		'- js/名前.js:2: a path with non-ASCII characters',
		'- a.js:10（文書、軽微）・b.js:2: a comma inside a bracketed note',
		'- c.js:3（将来, x）: an ASCII comma inside a bracketed note',
		'- d.js:4: 20:30 starts the text without a note',
		'- tests/scripts/mutate.js:10 と tests/scripts/zzz.js:20: two references joined by a word',
		'- a.js:10 と b.js:20 ほか: joined references with a note after the second',
		'- a.js:10 および b.js:20-22（文書） の2か所: a range and a bracketed note before the note',
		// 括弧のない注記が、2つ目の参照の前の : で切れる（2つ目の参照が内容に入る）。
		'- js/a.js:10 ほか（同じ形: js/b.js:20）: a second reference after a colon inside the note',
		'- a.js:10 ほか 変更外: b.js:20: a kind word in the note before the second reference',
		'- a.js:10 ほか（注: 下）と b.js:20: a second reference in the text after the note',
		'- 参照のない説明の行',
		'\t- 字下げした続きの箇条',
		'前置き（指摘ではない）'
	].join('\n'));
	assert.deepEqual(findings.map(finding => [finding.refs.map(ref => `${ref.file}:${ref.line}-${ref.end}`).join(' '), finding.kind]), [
		['docs/a.md:10-10', '文書'], ['b.js:20-20', '将来'], ['js/b.js:200-200', '変更外'], ['js/new.js:1-1', ''],
		['external_design.md:215-215 internal_design.md:635-635', ''], ['review83.md:182-184', ''], ['specification_traceability.md:410-410', '文書'],
		['review92:14-14', ''], ['dev-scripts.test.js:46-46', ''], ['js/名前.js:2-2', ''],
		['a.js:10-10 b.js:2-2', '文書'], ['c.js:3-3', '将来'], ['d.js:4-4', ''], ['（解析できない行）:0-0', ''], ['（解析できない行）:0-0', ''], ['（解析できない行）:0-0', ''], ['（解析できない行）:0-0', ''], ['（解析できない行）:0-0', ''], ['（解析できない行）:0-0', ''], ['（解析できない行）:0-0', '']
	], 'Names without an extension, notes without brackets and non-ASCII paths are references; separators inside a bracketed note do not split; references joined by a word, a reference in the text after a note without brackets and a top-level bullet without one are kept as unparsed, an indented one is a continuation');
	assert.equal(findings[12].text, '20:30 starts the text without a note', 'Without a note, text starting with digits and a colon is the text');
	assert.match(findingScope.classify([findings[13]], { ranges: {}, untracked: [], files: [] })[0].scope, /^解決できない（指摘の形式を解析できない: tests\/scripts\/mutate\.js:10 と tests\/scripts\/zzz\.js:20/, 'The second reference is not dropped silently');
	assert.match(findingScope.classify([findings[findings.length - 1]], { ranges: {}, untracked: [], files: [] })[0].scope, /^解決できない（指摘の形式を解析できない: 参照のない説明の行）$/);
	withTempDir({}, dir => {
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 'none.json'), path.join(dir, 'missing.txt')])), 2, 'A missing snapshot is an environment error');
	});
	const diff = [
		'+++ b/early.js', '@@ -1 +1 @@',
		'diff --git a/js/b.js b/js/b.js', '--- a/js/b.js', '+++ b/js/b.js', '@@ -18,2 +18,3 @@ x', '@@ -50 +51 @@ y', '@@ -70,3 +72,0 @@ z', '@@ -80 +82 @@ w', '+++ b/fake.js',
		'diff --git a/gone.js b/gone.js', '--- a/gone.js', '+++ /dev/null', '@@ -1,2 +0,0 @@',
		'diff --git a/my file.js b/my file.js', '--- a/my file.js\t', '+++ b/my file.js\t', '@@ -2 +2 @@',
		'diff --git "a/q\\"x.js" "b/q\\"x.js"', '--- "a/q\\"x.js"', '+++ "b/q\\"x.js"', '@@ -1 +1 @@'
	].join('\n');
	const ranges = findingScope.parseDiffRanges(diff);
	assert.deepEqual([...ranges.entries()], [['js/b.js', [[18, 20], [51, 51], [72, 72], [82, 82]]], ['my file.js', [[2, 2]]], ['q"x.js', [[1, 1]]]], 'An added line starting with ++ and lines before the first diff --git are not file headers; the tab after a name with a space and the quoting are removed');
	assert.deepEqual(findingScope.resolveFile('b.js', ['js/b.js', 'docs/a.md']), { file: 'js/b.js', candidates: ['js/b.js'] });
	assert.equal(findingScope.resolveFile('a.md', ['docs/a.md', 'tests/a.md']).file, null);
	const snapshot = { base: 'x', ranges: Object.fromEntries(ranges), untracked: ['js/new.js'], files: ['docs/a.md', 'js/b.js', 'js/new.js', 'docs/external_design.md', 'docs/internal_design.md'] };
	const classified = findingScope.classify([...findings, { refs: [{ file: 'js/b.js', line: 23, end: 23 }, { file: 'js/b.js', line: 24, end: 24 }, { file: 'js/b.js', line: 10, end: 16 }], kind: '', text: '' }], snapshot);
	assert.deepEqual(classified.map(result => `${result.file}:${result.line} ${result.scope.split('（')[0]}`), [
		'docs/a.md:10 差分の外', 'js/b.js:20 差分の中', 'js/b.js:200 差分の外', 'js/new.js:1 差分の中',
		'docs/external_design.md:215 差分の外', 'docs/internal_design.md:635 差分の外', 'review83.md:182 解決できない', 'specification_traceability.md:410 解決できない',
		'review92:14 解決できない', 'dev-scripts.test.js:46 解決できない', 'js/名前.js:2 差分の外', 'a.js:10 解決できない', 'js/b.js:2 差分の外', 'c.js:3 解決できない', 'd.js:4 解決できない',
		'（解析できない行）:0 解決できない', '（解析できない行）:0 解決できない', '（解析できない行）:0 解決できない', '（解析できない行）:0 解決できない', '（解析できない行）:0 解決できない', '（解析できない行）:0 解決できない', '（解析できない行）:0 解決できない',
		'js/b.js:23 差分の中', 'js/b.js:24 差分の外', 'js/b.js:10 差分の中'
	], 'Three lines around a change count as inside, and a range overlapping that window counts as inside');
	assert.equal(quiet(() => findingScope.main([])), 2, '--base or --from-snapshot is required');
	withTempDir({}, dir => outsideGit(dir, () => assert.equal(quiet(() => findingScope.main(['--base', 'HEAD', '--root', dir], { input: '- js/a.js:1: x' })), 2, 'A directory outside Git is reported, not thrown')));
	withTempDir({ 's.json': JSON.stringify(snapshot) }, dir => {
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json')], { input: '- js/b.js:20: x' })), 0);
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json')], { input: '- nothing.md:1: x' })), 1, 'An unresolved reference is reported with exit code 1');
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json')], { input: '- 参照のない指摘' })), 1, 'A finding that cannot be parsed is reported with exit code 1');
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json'), path.join(dir, 'missing.txt')])), 2, 'A missing findings file is an argument error');
		const unreadable = captured(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json'), dir]));
		assert.equal(unreadable.code, 2, 'A findings path that cannot be read (a directory) is an argument error');
		assert.match(unreadable.text, /がない・読めない（EISDIR）/, 'The error code is printed');
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json')], { input: '- js/b.js:20 と js/b.js:21: x' })), 1, 'References joined by a word are reported with exit code 1');
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json')], { input: '- js/b.js:20 と js/b.js:21 ほか: x' })), 1, 'References joined by a word with a note after the second are reported with exit code 1');
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json')], { input: '- js/b.js:20 ほか（同じ形: js/b.js:21）: x' })), 1, 'A second reference after a colon inside a note without brackets is reported with exit code 1');
		// JSON だが差分の保存の形でないファイル（単位の記録・変異の一覧の取り違え）は、引数の誤り（2）。
		const valid = { ranges: { 'js/b.js': [[18, 20]] }, untracked: [], files: ['js/b.js'] };
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 's.json')], { input: '- js/b.js:20: x' })), 0);
		for (const shape of [[], null, {}, { ...valid, ranges: [] }, { ...valid, ranges: 5 }, { ...valid, ranges: { 'js/b.js': 5 } }, { ...valid, ranges: { 'js/b.js': [[1]] } }, { ...valid, ranges: { 'js/b.js': [[1, 'x']] } }, { ...valid, untracked: 'x' }, { ...valid, untracked: [1] }, { ...valid, files: 'x' }, { ...valid, files: [1] }]) {
			fs.writeFileSync(path.join(dir, 'shape.json'), JSON.stringify(shape));
			const shaped = captured(() => findingScope.main(['--from-snapshot', path.join(dir, 'shape.json')], { input: '- js/b.js:20: x' }));
			assert.equal(shaped.code, 2, JSON.stringify(shape));
			assert.match(shaped.text, /shape\.json は差分の保存（--snapshot で作ったもの）の形でない/);
		}
		fs.writeFileSync(path.join(dir, 'shape.json'), JSON.stringify(valid));
		assert.equal(quiet(() => findingScope.main(['--from-snapshot', path.join(dir, 'shape.json')], { input: '- js/b.js:20: x' })), 0, 'The smallest snapshot of the right shape is used');
	});
});

test('finding-scope: callers changed since the base are listed for findings outside the diff', { skip: !gitAvailable }, () => withTempDir({
	'js/a.js': ['function broken(x) {', '\treturn x.y;', '}', 'function caller() {', '\treturn 1;', '}', 'function other() {', '\treturn broken({});', '}', ''].join('\n'),
	'index.html': '<button data-click="caller">x</button>'
}, root => {
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	fs.writeFileSync(path.join(root, 'js/a.js'), ['function broken(x) {', '\treturn x.y;', '}', 'function caller() {', '\treturn 1;', '}', 'function other() {', '\treturn broken({});', '}', 'const flag = 1;', '', '', '', 'function added() {', '\treturn broken(null);', '}', 'function deeper() {', '\treturn other();', '}', ''].join('\n'));
	const diff = findingScope.captureDiff(root, 'HEAD');
	const [inside, outside] = findingScope.classify(findingScope.parseFindings('- js/a.js:15: x\n- js/a.js:2: 変更外: old'), diff);
	assert.equal(inside.scope, '差分の中');
	assert.deepEqual(findingScope.changedCallers(root, inside, diff), { function: 'added', changed: [] }, 'Findings inside the diff are traced too');
	assert.equal(findingScope.changedCallers(root, { file: 'js/a.js', line: 1, scope: '解決できない（候補 0件）' }, diff), null);
	const traced = findingScope.changedCallers(root, outside, diff);
	assert.deepEqual([traced.function, traced.changed.map(caller => `${caller.function} ${caller.file}:${caller.line} ${caller.depth}`)], ['broken', ['added js/a.js:15 1', 'deeper js/a.js:18 2']], 'Only the new callers are listed, not the unchanged one');
	assert.deepEqual(findingScope.changedCallers(root, { ...outside, line: 10 }, diff), { function: '', changed: [] });
	assert.equal(findingScope.changedCallers(root, { file: 'index.html', line: 1, scope: '差分の外' }, diff), null);
	const deep = captured(() => findingScope.main(['--base', 'HEAD', '--root', root], { input: '- js/a.js:2: 変更外: old' }));
	assert.equal(deep.code, 0);
	assert.match(deep.text, /deeper（js\/a\.js:18、深さ 2）/, 'By default callers are traced three levels deep');
	assert.doesNotMatch(captured(() => findingScope.main(['--base', 'HEAD', '--root', root, '--callers', '1'], { input: '- js/a.js:2: 変更外: old' })).text, /deeper/, '--callers reaches the tracing');
	assert.ok(findingScope.parseArgs(['--base', 'x', '--callers', '-1']).error);
	for (const args of [['--base'], ['--base', 'x', '--root'], ['--base', 'x', '--context'], ['--base', 'x', '--snapshot'], ['--from-snapshot'], ['--base', 'x', '--callers'], ['--base', 'x', '--bogus']]) assert.ok(findingScope.parseArgs(args).error, args.join(' '));
}));

test('finding-scope: a snapshot of a temporary repository captures the diff and untracked files', { skip: !gitAvailable }, () => withTempDir({ 'js/a.js': 'one\ntwo\n' }, root => {
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	fs.writeFileSync(path.join(root, 'js/a.js'), 'one\nTWO\n');
	fs.writeFileSync(path.join(root, 'js/new.js'), 'x\n');
	const saved = path.join(root, 'snapshot.json');
	assert.equal(quiet(() => findingScope.main(['--base', 'HEAD', '--root', root, '--snapshot', saved])), 0);
	const snapshot = JSON.parse(fs.readFileSync(saved, 'utf8'));
	assert.deepEqual(snapshot.ranges, { 'js/a.js': [[2, 2]] });
	assert.ok(snapshot.untracked.includes('js/new.js'));
	// 書けない保存先（ない親ディレクトリ・ディレクトリ）は引数の誤り（2）。
	for (const target of [path.join(root, 'no-dir', 's.json'), path.join(root, 'js')]) {
		const failed = captured(() => findingScope.main(['--base', 'HEAD', '--root', root, '--snapshot', target]));
		assert.equal(failed.code, 2, target);
		assert.match(failed.text, /保存先 .* に書けない（(ENOENT|EISDIR)）/, target);
	}
}));

test('finding-scope: window boundaries, callers whose bodies changed, top-level and markup callers, arguments and the printed table', { skip: !gitAvailable }, () => withTempDir({
	'js/a.js': ['function broken(x) {', '\treturn x.y;', '}', 'function other() {', '\tconst a = 1;', '\treturn broken(a);', '}', 'broken(2);', 'const flag = 1;', ''].join('\n'),
	'index.html': '<button data-click="broken">x</button>'
}, root => {
	const ranges = new Map([['a.js', [[5, 7]]]]);
	assert.deepEqual([4, 5, 7, 8].map(line => findingScope.insideDiff(ranges, new Set(), 'a.js', line, 0)), [false, true, true, false]);
	const window = { ranges: { 'a.js': [[5, 5]] }, untracked: [], files: ['a.js'] };
	assert.deepEqual(findingScope.classify(findingScope.parseFindings('- a.js:1: x\n- a.js:2: y\n- a.js:8: z\n- a.js:9: w'), window).map(result => result.scope), ['差分の外（変更したファイル）', '差分の中', '差分の中', '差分の外（変更したファイル）'], 'The window is three lines on each side, inclusive');
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	fs.writeFileSync(path.join(root, 'js/a.js'), ['function broken(x) {', '\treturn x.y;', '}', 'function other() {', '\tconst a = 2;', '\treturn broken(a);', '}', 'broken(2);', 'const flag = 2;', 'broken(4);', ''].join('\n'));
	const diff = findingScope.captureDiff(root, 'HEAD');
	const traced = findingScope.changedCallers(root, { file: 'js/a.js', line: 2, scope: '差分の外（変更したファイル）' }, diff);
	assert.deepEqual(traced.changed.map(caller => `${caller.function} ${caller.file}:${caller.line}`), ['other js/a.js:6', ' js/a.js:10'], 'A caller whose body changed and a new top-level call are listed; the unchanged top-level call and the markup caller are not');
	assert.equal(findingScope.parseArgs(['--base', 'x', '--callers', '2']).callers, 2);
	assert.equal(findingScope.parseArgs(['--base', 'x']).callers, 3);
	for (const args of [['--context', '0'], ['--callers', '0']]) assert.equal(findingScope.parseArgs(['--base', 'x', ...args]).error, undefined, args.join(' '));
	for (const args of [['--context', 'x'], ['--callers', 'x']]) assert.ok(findingScope.parseArgs(['--base', 'x', ...args]).error, args.join(' '));
	const failed = captured(() => findingScope.main(['--base', 'no-such-commit', '--root', root], { input: '- js/a.js:1: x' }));
	assert.equal(failed.code, 2);
	assert.match(failed.text, /に失敗した: \S+/, 'The reason from git is kept');
	const printed = captured(() => findingScope.main(['--base', 'HEAD', '--root', root], { input: '- js/a.js:2-3: 変更外: old\n- index.html:1: x\n- js/a.js:9: top\n- js/a.js:5: y' }));
	assert.equal(printed.code, 0);
	for (const line of [
		'| js/a.js:2-3 | 変更外 | 差分の中 | broken へ: other（js/a.js:6、深さ 1）、（トップレベル）（js/a.js:10、深さ 1） |',
		'| index.html:1 | （なし） | 差分の外（変更していないファイル） | — |',
		'| js/a.js:9 | （なし） | 差分の中 | （関数の外） |',
		'| js/a.js:5 | （なし） | 差分の中 | other へ: なし |'
	]) assert.ok(printed.text.split('\n').includes(line), `${line} in\n${printed.text}`);
	assert.match(printed.text, /^呼出元の変更がある指摘は/m);
	assert.doesNotMatch(captured(() => findingScope.main(['--base', 'HEAD', '--root', root], { input: '- js/a.js:5: y' })).text, /^呼出元の変更がある指摘は/m, 'The note is only for findings with changed callers');
}));

test('finding-scope: findings from a file, --context reaching the table, and blank lines after a caller', { skip: !gitAvailable }, () => withTempDir({
	'js/a.js': ['function broken(x) {', '\treturn x.y;', '}', 'function other() {', '\treturn broken(1);', '}', 'const last = 1;', ''].join('\n')
}, root => {
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	fs.writeFileSync(path.join(root, 'js/a.js'), ['function broken(x) {', '\treturn x.y;', '}', 'function other() {', '\treturn broken(1);', '}', '', '', 'const last = 2;', ''].join('\n'));
	const diff = findingScope.captureDiff(root, 'HEAD');
	assert.deepEqual(findingScope.changedCallers(root, { file: 'js/a.js', line: 2, scope: '差分の外（変更したファイル）' }, diff).changed, [], 'Blank lines added after a caller are not a change of its body');
	const findings = path.join(root, '..', `${path.basename(root)}-findings.txt`);
	try {
		fs.writeFileSync(findings, '- js/a.js:5: x\n- js/a.js:4: y\n- js/a.js:3: z\n');
		const wide = captured(() => findingScope.main(['--base', 'HEAD', '--root', root, findings]));
		assert.match(wide.text, /^\| js\/a\.js:5 \| （なし） \| 差分の中 \|/m, 'Findings are read from the file; line 5 is within three lines of the change');
		assert.match(wide.text, /^\| js\/a\.js:4 \| （なし） \| 差分の中 \|/m, 'By default three lines before the change (line 7) are inside');
		assert.match(wide.text, /^\| js\/a\.js:3 \| （なし） \| 差分の外（変更したファイル） \|/m, 'and the fourth line before is outside');
		const narrow = captured(() => findingScope.main(['--base', 'HEAD', '--root', root, '--context', '0', findings]));
		assert.match(narrow.text, /^\| js\/a\.js:5 \| （なし） \| 差分の外（変更したファイル） \|/m, '--context 0 reaches the classification');
	} finally {
		fs.rmSync(findings, { force: true });
	}
}));
