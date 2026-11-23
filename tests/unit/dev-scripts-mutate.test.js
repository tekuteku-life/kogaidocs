const test = require('node:test');
const { afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const mutate = require('../scripts/mutate');
const { withTempDir, withTempDirAsync, git, gitAvailable, quietAsync, running, waitStopped, capturedAsync, hangCode, cleanupHung, cleanupCopies } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: mutate.js（変異の当て込み）の判定を確かめる。

// 試験の後に、このプロセスが作った写しが残っていないこと（残っていれば消してから失敗にする。後始末を壊す変異を当てても写しを残さない）。
afterEach(() => assert.deepEqual(cleanupCopies(), [], 'No copy of the repository is left behind'));

test('mutate: a mutation must match exactly once unless an occurrence is given', () => {
	assert.equal(mutate.countOccurrences('a+a+a', 'a'), 3);
	assert.equal(mutate.applyMutation('x >= 18', { find: '>= 18', replace: '>= 19' }), 'x >= 19');
	assert.throws(() => mutate.applyMutation('x > 18', { find: '>= 18', replace: '' }), /一致が 0 件/);
	assert.throws(() => mutate.applyMutation('a; a;', { find: 'a', replace: 'b' }), /一致が 2 件/);
	assert.equal(mutate.applyMutation('a; a;', { find: 'a', replace: 'b', occurrence: 2 }), 'a; b;');
	assert.throws(() => mutate.applyMutation('a; a;', { find: 'a', replace: 'b', occurrence: 3 }), /範囲外/);
	assert.throws(() => mutate.applyMutation('a', { find: '', replace: 'b' }), /空/);
	assert.equal(mutate.applyMutation('aaaa', { find: 'aa', replace: 'X', occurrence: 2 }), 'aaX', 'occurrence counts the same non-overlapping matches as the count');
	assert.equal(mutate.applyMutation('aaaa', { find: 'aa', replace: 'X', occurrence: 1 }), 'Xaa');
});

test('mutate: automatic operator mutants touch only code in the given line ranges', () => {
	const text = ['function f(a, b) {', '\t// a === b && c', "\tif (a === b && !c || d <= 2 || e >= 3 || g < 1 || h > 4) return true;", "\tconst s = '<td> === false'; const r = /a|b/g; return () => false;", '}'].join('\n');
	const mutants = mutate.autoMutations(text, [[2, 4]]);
	assert.deepEqual(mutants.map(mutant => mutant.name), [
		'3:8 === → !==', '3:14 && → ||', '3:20 || → &&', '3:30 || → &&', '3:40 || → &&', '3:49 || → &&', '3:25 <= → <', '3:35 >= → >', '3:45 < → <=', '3:54 > → >=', '3:66 true → false', '3:17 否定の除去',
		'4:61 false → true'
	]);
	assert.equal(mutants[0].mutated.split('\n')[2], "\tif (a !== b && !c || d <= 2 || e >= 3 || g < 1 || h > 4) return true;");
	assert.ok(mutants.every(mutant => mutant.mutated.split('\n')[1] === '\t// a === b && c'), 'Comments are not mutated');
	assert.deepEqual(mutate.autoMutations(text, [[4, 4], [1, 1], [4, 9]]).map(mutant => mutant.name), ['4:61 false → true'], 'Ranges are merged, ordered and clipped to the file');
	assert.deepEqual(mutate.parseRanges('3-5,10-10'), [[3, 5], [10, 10]]);
	for (const value of ['5-3', '0-2', '3', '3-5,', undefined]) assert.equal(mutate.parseRanges(value), null, String(value));
	const equivalent = [{ name: 'a' }, { name: 'b' }];
	assert.deepEqual(mutate.applyEquivalents(equivalent, { b: '向きだけ', gone: '古い指定' }), ['gone'], 'An equivalence that matches no mutant is returned');
	assert.deepEqual(equivalent, [{ name: 'a' }, { name: 'b', equivalent: '向きだけ' }]);
	for (const [result, problem] of [['生存', true], ['生存（等価: x）', false], ['検出', false], ['検出（時間切れ）', false], ['無効（構文が壊れる）', true], ['合格', false], ['不合格', true], ['不合格（時間切れ）', true]]) assert.equal(mutate.isProblem(result), problem, result);
	for (const args of [['--auto', 'a.js', '--tests', 't'], ['--auto', 'a.js', '--lines', '1-2', '--since', 'd.js', '--tests', 't'], ['--auto', 'a.js', '--lines', '2-1', '--tests', 't'], ['--auto', 'a.js', '--lines', '1-2'], ['--spec', 's.json', '--timeout', '0']]) assert.ok(mutate.parseArgs(args).error, args.join(' '));
	assert.deepEqual(mutate.parseArgs(['--auto', 'a.js', '--since', 'd.js', '--tests', 't1,t2', '--equivalents', 'e.json']).tests, ['t1', 't2']);
});

test('mutate: --since takes the lines changed after the draft, including the lines around a deletion', { skip: !gitAvailable }, () => withTempDir({
	'draft.js': 'a\nb\nc\nd\ne\nf\n',
	'final.js': 'a\nB\nc\nd\nf\nnew\n',
	'first-draft.js': 'gone;\nb === c;\n',
	'first-final.js': 'b === c;\n'
}, dir => {
	assert.deepEqual(mutate.changedRanges(path.join(dir, 'draft.js'), path.join(dir, 'final.js')), [[2, 2], [4, 5], [6, 6]]);
	// 先頭の行を消すと、git は「+0,0」を出す。範囲は1行目からにする（0 行目は読まない）。
	const first = mutate.changedRanges(path.join(dir, 'first-draft.js'), path.join(dir, 'first-final.js'));
	assert.deepEqual(first, [[1, 1]], 'Deleting the first line takes the new first line');
	assert.deepEqual(mutate.autoMutations('b === c;\n', first).map(mutant => mutant.name), ['1:3 === → !=='], 'and the automatic mutants run on that range');
	assert.deepEqual(mutate.changedRanges(path.join(dir, 'draft.js'), path.join(dir, 'draft.js')), []);
	assert.throws(() => mutate.changedRanges(path.join(dir, 'missing.js'), path.join(dir, 'final.js')), /下書きとの差を取れない/);
}));

test('mutate: a baseline run comes first, and results separate detected, surviving, equivalent, invalid and expected-pass mutants', async () => withTempDirAsync({
	'js/lib.js': "function isAdult(age) {\n\tconst label = '<td>';\n\treturn age >= 18 && label !== '';\n}\nmodule.exports = { isAdult };\n",
	'tests/lib.test.js': "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { isAdult } = require('../js/lib');\ntest('adult', () => { assert.equal(isAdult(18), true); assert.equal(isAdult(17), false); });\n"
}, async root => {
	const tests = ['tests/lib.test.js'];
	const before = mutate.treeHashes(root);
	const { baseline, results } = await mutate.runMutants(root, [
		{ name: 'threshold', file: 'js/lib.js', find: 'age >= 18', replace: 'age >= 19', tests },
		{ name: 'equivalent', file: 'js/lib.js', find: 'age >= 18', replace: '18 <= age', tests, equivalent: '向きを変えただけ' },
		{ name: 'survivor', file: 'js/lib.js', find: "label !== ''", replace: "label !== 'x'", tests },
		{ name: 'missing', file: 'js/lib.js', find: 'age > 18', replace: 'age > 19', tests },
		{ name: 'syntax', file: 'js/lib.js', find: 'age >= 18', replace: 'age >=', tests },
		{ name: 'stress', file: 'js/lib.js', find: "'<td>'", replace: "'<th>'", tests, expect: 'pass' },
		{ name: 'unstable', file: 'js/lib.js', find: 'age >= 18', replace: 'age >= 19', tests, expect: 'pass' }
	]);
	assert.deepEqual(baseline.map(entry => entry.status), [0]);
	assert.deepEqual(results.map(result => `${result.name}: ${result.result}`), ['threshold: 検出', 'equivalent: 生存（等価: 向きを変えただけ）', 'survivor: 生存', 'missing: 無効（置換が成立しない）', 'syntax: 無効（構文が壊れる）', 'stress: 合格', 'unstable: 不合格']);
	assert.deepEqual(results.filter(result => mutate.isProblem(result.result)).map(result => result.name), ['survivor', 'missing', 'syntax', 'unstable']);
	assert.deepEqual(mutate.treeHashes(root), before, 'The working tree is never changed');
	// 無限ループの変異は、試験ファイルを実行する子のプロセス番号を書き残す。時間切れの後、その子が残っていないことを確かめる。
	const pidFile = path.join(root, '..', `${path.basename(root)}-hang-pids.txt`);
	const loop = `${hangCode('KOGAI_HANG_PIDS')} return age >= 18`;
	process.env.KOGAI_HANG_PIDS = pidFile;
	try {
		const hang = await mutate.runMutants(root, [
			{ name: 'hang', file: 'js/lib.js', find: 'return age >= 18', replace: loop, tests },
			{ name: 'hang-stress', file: 'js/lib.js', find: 'return age >= 18', replace: loop, tests, expect: 'pass' }
		], { timeout: 3000 });
		assert.deepEqual(hang.results.map(result => `${result.name}: ${result.result}`), ['hang: 検出（時間切れ）', 'hang-stress: 不合格（時間切れ）'], 'A stopped test counts as detected, but fails an expected-pass mutant');
		const hungPids = fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid);
		assert.equal(hungPids.length, 2);
		assert.deepEqual(await waitStopped(hungPids), [], 'No test process of a timed-out mutant is left running');
		mutate.stopGroup(0);
		mutate.stopGroup(hungPids[0]);
	} finally {
		delete process.env.KOGAI_HANG_PIDS;
		cleanupHung(pidFile);
	}
	const equivalents = path.join(root, '..', `${path.basename(root)}-equivalents.json`);
	try {
		fs.writeFileSync(equivalents, JSON.stringify({ '3:13 >= → >': '検出されるので使われない', '9:1 === → !==': '古い位置' }));
		assert.equal(await quietAsync(() => mutate.main(['--root', root, '--auto', 'js/lib.js', '--lines', '3-3', '--tests', tests[0], '--equivalents', equivalents])), 1, 'An equivalence that matches no automatic mutant fails the run');
		fs.writeFileSync(equivalents, JSON.stringify({ '3:13 >= → >': '検出されるので使われない' }));
		assert.equal(await quietAsync(() => mutate.main(['--root', root, '--auto', 'js/lib.js', '--lines', '3-3', '--tests', tests[0], '--equivalents', equivalents])), 0);
	} finally {
		fs.rmSync(equivalents, { force: true });
	}
	// 基準の実行は試験の組ごとに行う。2つ目の組だけが元から落ちるときも、変異を1つも実行しない（その組の変異がすべて「検出」になるのを防ぐ）。
	fs.writeFileSync(path.join(root, 'tests/ok.test.js'), "require('node:test')('ok', () => {});\n");
	fs.writeFileSync(path.join(root, 'tests/lib.test.js'), "require('node:test')('broken', () => { throw new Error('x'); });\n");
	const broken = await mutate.runMutants(root, [
		{ name: 'first set', file: 'js/lib.js', find: 'age >= 18', replace: 'age >= 19', tests: ['tests/ok.test.js'] },
		{ name: 'second set', file: 'js/lib.js', find: 'age >= 18', replace: 'age >= 19', tests }
	]);
	assert.deepEqual([broken.baseline.map(entry => `${entry.tests.join(',')}: ${entry.status !== 0}`), broken.results], [['tests/ok.test.js: false', 'tests/lib.test.js: true'], []], 'A failing baseline of any set stops before any mutant');
	for (const args of [[], ['--auto', 'js/lib.js'], ['--bogus']]) assert.ok(mutate.parseArgs(args).error, args.join(' '));
}));

test('mutate: the stress specification delays the encrypted save in the real code', () => {
	const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/stress/save-delay.json'), 'utf8'));
	const crypto = fs.readFileSync(path.join(__dirname, '../../js/crypto.js'), 'utf8');
	assert.ok(spec.length >= 2);
	for (const entry of spec) {
		assert.equal(entry.expect, 'pass');
		assert.match(mutate.applyMutation(crypto, entry), /await new Promise\(resolve => setTimeout\(resolve, /, `${entry.name} applies to js/crypto.js`);
	}
});

test('mutate: occurrence bounds, range starts, skipped directories, non-js files, the shebang, draft diff failures and a changing tree', { skip: !gitAvailable }, async () => withTempDirAsync({
	'.git/x': 'x',
	'node_modules/y': 'y',
	'a.txt': 'a'
}, async dir => {
	assert.equal(mutate.applyMutation('a; a;', { find: 'a', replace: 'b', occurrence: 1 }), 'b; a;');
	for (const occurrence of [0, 1.5]) assert.throws(() => mutate.applyMutation('a; a;', { find: 'a', replace: 'b', occurrence }), /範囲外/, String(occurrence));
	assert.deepEqual(mutate.parseRanges('1-2'), [[1, 2]]);
	assert.deepEqual(Object.keys(mutate.treeHashes(dir)), ['a.txt'], '.git and node_modules are not hashed');
	const copy = mutate.copyRepository(dir);
	assert.deepEqual([fs.readdirSync(copy).sort(), fs.lstatSync(path.join(copy, 'node_modules')).isSymbolicLink()], [['a.txt', 'node_modules'], true], 'The copy has no .git, and node_modules is linked, not copied');
	fs.rmSync(copy, { recursive: true, force: true });
	assert.deepEqual(mutate.parseArgs(['--auto', 'a.js', '--lines', '1-1', '--tests', 'x.js,,y.js']).tests, ['x.js', 'y.js'], 'Empty names in --tests are dropped');
	assert.equal(mutate.syntaxOk(path.join(dir, 'a.json')), true, 'Only js files are syntax-checked');
	assert.equal(mutate.parseArgs(['--spec', 's.json', '--timeout', '5']).timeout, 5);
	assert.deepEqual(mutate.autoMutations('#!/usr/bin/env node\nif (!a) x();', [[1, 2]]).map(mutant => mutant.name), ['2:5 否定の除去'], 'The #! line is not mutated');
	if (process.getuid?.() !== 0) {
		fs.writeFileSync(path.join(dir, 'draft.js'), 'a\n');
		fs.writeFileSync(path.join(dir, 'locked.js'), 'b\n');
		fs.chmodSync(path.join(dir, 'locked.js'), 0o000);
		try {
			assert.throws(() => mutate.changedRanges(path.join(dir, 'draft.js'), path.join(dir, 'locked.js')), /下書きとの差を取れない: \S+/, 'A failing git diff is reported with its reason');
		} finally {
			fs.chmodSync(path.join(dir, 'locked.js'), 0o644);
		}
	}
	// 試験の実行の間に作業ツリーへ書き込むと、それまでの結果を付けて止まる。
	fs.mkdirSync(path.join(dir, 'tests'));
	fs.writeFileSync(path.join(dir, 'tests/touch.test.js'), "require('node:fs').writeFileSync(process.env.KOGAI_TOUCH, String(Date.now()));\nrequire('node:test')('touch', () => {});\n");
	fs.writeFileSync(path.join(dir, 'lib.js'), 'module.exports = 1;\n');
	const spec = path.join(dir, '..', `${path.basename(dir)}-spec.json`);
	fs.writeFileSync(spec, JSON.stringify([{ name: 'one', file: 'lib.js', find: '1', replace: '2', tests: ['tests/touch.test.js'] }]));
	process.env.KOGAI_TOUCH = path.join(dir, 'touched.txt');
	try {
		const printed = await capturedAsync(() => mutate.main(['--root', dir, '--spec', spec, '--timeout', '30000']));
		assert.equal(printed.code, 2);
		assert.match(printed.text, /^\| 変異 \| ファイル \| 結果 \| 備考 \|$/m, 'The table so far is printed');
		assert.match(printed.text, /実行の間に作業ツリーが変わった（結果は使えない）: touched\.txt/);
		fs.writeFileSync(path.join(dir, 'tests/touch.test.js'), "require('node:test')('broken', () => { throw new Error('x'); });\n");
		fs.rmSync(path.join(dir, 'touched.txt'), { force: true });
		const baseline = await capturedAsync(() => mutate.main(['--root', dir, '--spec', spec, '--timeout', '30000']));
		assert.equal(baseline.code, 1);
		assert.match(baseline.text, /変異なしの基準の実行が合格しない（終了コード 1）: tests\/touch\.test\.js/);
	} finally {
		delete process.env.KOGAI_TOUCH;
		fs.rmSync(spec, { force: true });
	}
}));

test('mutate: restoring across files, argument checks, line ranges without candidates and the timeout reaching the run', { skip: !gitAvailable, timeout: 120000 }, async () => withTempDirAsync({
	'lib.js': 'module.exports = 1;\n',
	'other.js': 'module.exports = 1 + 1;\n',
	'comment.js': '// only a comment\nconst a = 1;\n',
	'two.js': 'module.exports = [1 === 1, 2 === 2];\n',
	'bare.js': '// no final newline\nconst a = 1;',
	'tests/coverage.test.js': "require('node:test')('no parent coverage', () => { if (process.env.NODE_V8_COVERAGE) throw new Error(process.env.NODE_V8_COVERAGE); });\n",
	'tests/both.test.js': "const test = require('node:test');\nconst assert = require('node:assert');\ntest('both', () => { assert.equal(require('../lib.js'), 1); assert.equal(require('../other.js'), 2); });\n",
	// 試験の一時ファイル: KOGAI_LEFT_NAME の名前で os.tmpdir() に書く（mutate.js が写しごとの一時ディレクトリを渡し、後で消すことを確かめる）。
	'tests/temp.test.js': "const fs = require('node:fs');\nconst os = require('node:os');\nconst path = require('node:path');\nrequire('node:test')('temp', () => { fs.writeFileSync(path.join(os.tmpdir(), process.env.KOGAI_LEFT_NAME), 'x'); });\n",
	'tests/hang.test.js': `require('node:test')('hang', () => { if (require('../lib.js') === 3) { ${hangCode('KOGAI_HANG_PIDS')} } });\n`,
	'node_modules/pkg/index.js': 'module.exports = 1;\n',
	'.git/HEAD': 'ref: refs/heads/main\n',
	'sub/node_modules/x.js': 'module.exports = 1;\n',
	'Node_Modules/x.js': 'module.exports = 1;\n',
	'tests/{a,b}.test.js': "require('node:test')('braces', () => {});\n",
	...(path.sep === '/' ? { 'tests/a\\b.test.js': "require('node:test')('backslash', () => {});\n" } : {}),
	// 作業ツリー（root）の中で実行されたら、自分のディレクトリに印を書く（写しの中で実行されたら写しに書かれ、写しと一緒に消える）。
	'tests/marker.test.js': "require('node:test')('marker', () => { require('node:fs').writeFileSync(require('node:path').join(__dirname, 'marker-ran.txt'), 'ran'); });\n",
	'tests/skip.test.js': "const test = require('node:test');\ntest('kept', () => {});\ntest('slow copies', () => { throw new Error('not skipped'); });\n"
}, async dir => {
	const tests = ['tests/both.test.js'];
	const leftName = `kogai-left-${process.pid}-${Date.now()}`;
	process.env.KOGAI_LEFT_NAME = leftName;
	try {
		const { results } = await mutate.runMutants(dir, [
			{ name: 'first', file: 'lib.js', find: '1', replace: '5', tests },
			{ name: 'second', file: 'other.js', find: '1 + 1', replace: '2', tests },
			{ name: 'temp', file: 'other.js', find: '1 + 1', replace: '2', tests: ['tests/temp.test.js'] }
		]);
		assert.deepEqual(results.map(result => `${result.name}: ${result.result}`), ['first: 検出', 'second: 生存', 'temp: 生存'], 'The first file is restored before the second mutant runs');
		assert.equal(fs.existsSync(path.join(os.tmpdir(), leftName)), false, 'The test runs write temporary files into the private directory of the copy, which is removed');
	} finally {
		delete process.env.KOGAI_LEFT_NAME;
		fs.rmSync(path.join(os.tmpdir(), leftName), { force: true });
	}
	// 一時ディレクトリを与えると、試験の一時ファイルはそこに置かれ、実行の後に空になる。
	const tmp = path.join(dir, '..', `${path.basename(dir)}-private-tmp`);
	fs.mkdirSync(tmp);
	const saved = process.env.NODE_V8_COVERAGE;
	process.env.NODE_V8_COVERAGE = path.join(dir, 'parent-coverage');
	process.env.KOGAI_LEFT_NAME = 'left.txt';
	try {
		assert.equal(await mutate.runTests(dir, ['tests/coverage.test.js'], 30000), 0, 'The parent coverage does not reach the test run');
		assert.equal(await mutate.runTests(dir, ['tests/temp.test.js'], 30000, tmp), 0);
		// 除く試験の名前の形は --test-skip-pattern として渡す（tests に node の引数を入れない）。
		assert.notEqual(await mutate.runTests(dir, ['tests/skip.test.js'], 30000, tmp), 0, 'Without a skip pattern the failing test runs');
		assert.equal(await mutate.runTests(dir, ['tests/skip.test.js'], 30000, tmp, 'slow copies'), 0, 'The skip pattern leaves out the named test');
		assert.deepEqual(fs.readdirSync(tmp), [], 'The private temporary directory is emptied after the run');
		assert.equal(fs.existsSync(path.join(os.tmpdir(), 'left.txt')), false, 'Nothing is written to the real temporary directory');
	} finally {
		if (saved === undefined) delete process.env.NODE_V8_COVERAGE;
		else process.env.NODE_V8_COVERAGE = saved;
		delete process.env.KOGAI_LEFT_NAME;
		fs.rmSync(tmp, { recursive: true, force: true });
	}
	const skipped = await mutate.runMutants(dir, [
		{ name: 'skip', file: 'lib.js', find: '1', replace: '5', tests: ['tests/skip.test.js'], skipPattern: 'slow copies' },
		{ name: 'both', file: 'lib.js', find: '1', replace: '5', tests }
	]);
	assert.deepEqual(skipped.baseline, [{ tests: ['tests/skip.test.js'], skipPattern: 'slow copies', status: 0 }, { tests, status: 0 }], 'Each test set with its skip pattern has its own baseline run');
	assert.deepEqual(skipped.results.map(result => `${result.name}: ${result.result}`), ['skip: 生存', 'both: 検出']);
	for (const args of [['--spec', 's', '--max', '0'], ['--spec', 's', '--max', 'abc'], ['--spec', 's', '--max', '-1']]) assert.match(mutate.parseArgs(args).error, /--max/, args.join(' '));
	assert.equal(mutate.parseArgs(['--spec', 's', '--max', '3']).max, 3);
	assert.equal(mutate.parseArgs(['--auto', 'a.js', '--lines', '1-1', '--tests', 't.js', '--skip-pattern', 'slow copies']).skipPattern, 'slow copies');
	assert.match(mutate.parseArgs(['--spec', 's', '--skip-pattern']).error, /--skip-pattern に値を指定する/);
	assert.deepEqual([...new Set(mutate.loadMutants({ root: dir, auto: 'two.js', lines: '1-1', tests, skipPattern: 'slow copies', max: Infinity }).mutants.map(mutant => mutant.skipPattern))], ['slow copies'], 'The --auto mutants carry the skip pattern');
	assert.equal(mutate.parseArgs(['--spec', 's']).timeout, 600000, 'The default timeout is 600000ms');
	assert.equal(await quietAsync(() => mutate.main(['--bogus'])), 2);
	const outside = path.join(dir, '..', `${path.basename(dir)}-spec.json`);
	const draft = path.join(dir, '..', `${path.basename(dir)}-draft.js`);
	const pidFile = path.join(dir, '..', `${path.basename(dir)}-hang-pids.txt`);
	try {
		fs.writeFileSync(outside, '[]');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--spec', outside])), 2, 'An empty list is an argument error');
		// 一覧の項目の検査: 写しの外のファイルを書き換えない・実行しない。誤りは、変異を当てる前に引数の誤り（2）にする。
		const victim = path.join(dir, '..', `${path.basename(dir)}-victim.js`);
		fs.writeFileSync(victim, 'module.exports = 1;\n');
		// node の引数になる - で始まる tests（--require で写しの外のコードを実行し、--test-reporter-destination で写しの外に書く）。
		const ran = path.join(dir, '..', `${path.basename(dir)}-evil-ran.txt`);
		const evil = path.join(dir, '..', `${path.basename(dir)}-evil.js`);
		const written = path.join(dir, '..', `${path.basename(dir)}-written.txt`);
		fs.writeFileSync(evil, `require('node:fs').writeFileSync(${JSON.stringify(ran)}, 'ran');\n`);
		// リンクを通るパス（写しでは作業ツリーを指すリンクになる）。リンクを作れない環境では、この組を除く。
		const links = [];
		try {
			fs.symlinkSync('lib.js', path.join(dir, 'link.js'));
			fs.symlinkSync('both.test.js', path.join(dir, 'tests/link.test.js'));
			links.push('link.js', 'tests/link.test.js');
		} catch {
			// Windows で権限がないなど
		}
		const entry = { name: 'x', file: 'lib.js', find: '1', replace: '5', tests };
		for (const [mutant, message] of [
			[{ ...entry, tests: [`--require=${evil}`, ...tests] }, /tests がリポジトリの中のパスの配列でない（- で始まる項目・glob の記号を含む項目・絶対パス・正規の形でないパスを含む）/],
			// 正規の形でないパス（写しへの書込みと node の引数は与えたパスのまま使うので、末尾の区切りのある試験は node が見つけない）。
			[{ ...entry, tests: ['tests/both.test.js/'] }, /tests がリポジトリの中のパスの配列でない/],
			[{ ...entry, tests: ['./tests/both.test.js'] }, /tests がリポジトリの中のパスの配列でない/],
			// root の中を指す絶対パスの tests は、写しではなく作業ツリーの試験を実行する。
			[{ ...entry, tests: [path.join(dir, 'tests/marker.test.js')] }, /tests がリポジトリの中のパスの配列でない/],
			// node --test は tests を glob として展開する（{..,w}/t.test.js は写しの外の ../t.test.js になる）。
			[{ ...entry, tests: ['tests/{a,b}.test.js'] }, /tests がリポジトリの中のパスの配列でない/],
			...(path.sep === '/' ? [[{ ...entry, tests: ['tests/a\\b.test.js'] }, /tests がリポジトリの中のパスの配列でない/]] : []),
			[{ ...entry, tests: [`--test-reporter-destination=${written}`, '--test-reporter=tap', ...tests] }, /tests がリポジトリの中のパスの配列でない/],
			[{ ...entry, tests: ['tests/missing.test.js'] }, /tests の tests\/missing\.test\.js がない/],
			[{ ...entry, tests: ['tests'] }, /tests の tests がない/],
			[{ ...entry, skipPattern: '' }, /skipPattern が空でない文字列でない/],
			[{ ...entry, skipPattern: 3 }, /skipPattern が空でない文字列でない/],
			[{ ...entry, file: 'node_modules/pkg/index.js' }, /file（node_modules\/pkg\/index\.js）がない（リンク・\.git・node_modules を通るパスを含む）/],
			// 写しに入らない .git の下と入れ子の node_modules の下、大文字小文字の違う node_modules（区別しないファイルシステムでは同じディレクトリ）。
			[{ ...entry, file: '.git/HEAD' }, /file（\.git\/HEAD）がない/],
			[{ ...entry, file: 'sub/node_modules/x.js' }, /file（sub\/node_modules\/x\.js）がない/],
			[{ ...entry, file: 'Node_Modules/x.js' }, /file（Node_Modules\/x\.js）がない/],
			[{ ...entry, tests: ['sub/node_modules/x.js'] }, /tests の sub\/node_modules\/x\.js がない/],
			[{ ...entry, file: path.join(dir, 'lib.js') }, /file がリポジトリの中のパスでない/],
			// 正規の形でないパス（末尾の区切りのある file は、写しの中で読めない）。
			[{ ...entry, file: 'lib.js/' }, /file がリポジトリの中のパスでない（絶対パス・\.\.・正規の形でないパス（末尾の区切りなど）を含む）/],
			[{ ...entry, file: './lib.js' }, /file がリポジトリの中のパスでない/],
			[{ ...entry, file: 'tests//both.test.js' }, /file がリポジトリの中のパスでない/],
			[{ ...entry, file: 'tests/../lib.js' }, /file がリポジトリの中のパスでない/],
			...(links.length ? [
				[{ ...entry, file: 'link.js' }, /file（link\.js）がない（リンク/],
				[{ ...entry, tests: ['tests/link.test.js'] }, /tests の tests\/link\.test\.js がない/]
			] : []),
			[{ ...entry, file: `../${path.basename(victim)}` }, /file がリポジトリの中のパスでない/],
			[{ ...entry, file: path.resolve(victim) }, /file がリポジトリの中のパスでない/],
			[{ ...entry, file: 'missing.js' }, /file（missing\.js）がない/],
			[{ ...entry, file: 'tests' }, /file（tests）がない/],
			[{ ...entry, name: '' }, /name がない/],
			[{ ...entry, find: '' }, /find・replace/],
			[{ ...entry, replace: undefined }, /find・replace/],
			[{ ...entry, tests: undefined }, /tests がリポジトリの中のパスの配列でない/],
			[{ ...entry, tests: [] }, /tests がリポジトリの中のパスの配列でない/],
			[{ ...entry, tests: ['../outside.test.js'] }, /tests がリポジトリの中のパスの配列でない/],
			['text', /オブジェクトでない/]
		]) {
			fs.writeFileSync(outside, JSON.stringify([entry, mutant]));
			const checked = await capturedAsync(() => mutate.main(['--root', dir, '--spec', outside]));
			assert.equal(checked.code, 2, JSON.stringify(mutant));
			assert.match(checked.text, /一覧の 2 件目/);
			assert.match(checked.text, message);
		}
		assert.equal(fs.readFileSync(victim, 'utf8'), 'module.exports = 1;\n', 'A file outside the copy is never written');
		assert.deepEqual([fs.existsSync(ran), fs.existsSync(written)], [false, false], 'Code outside the copy is never run and nothing is written outside it');
		assert.equal(fs.readFileSync(path.join(dir, 'lib.js'), 'utf8'), 'module.exports = 1;\n', 'The file behind a link is never written');
		assert.equal(fs.existsSync(path.join(dir, 'tests/marker-ran.txt')), false, 'A test given by an absolute path is not run in the working tree');
		for (const link of links) fs.rmSync(path.join(dir, link), { force: true });
		for (const file of [victim, evil, ran, written]) fs.rmSync(file, { force: true });
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'lib.js', '--lines', '1-1', '--tests', `--require=${evil}`])), 2, 'An --auto test starting with - is an argument error');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'lib.js', '--lines', '1-1', '--tests', 'tests/missing.test.js'])), 2, 'A missing --auto test is an argument error, not a failed baseline');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', '../x.js', '--lines', '1-1', '--tests', tests[0]])), 2, 'An --auto file outside the repository is an argument error');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'lib.js', '--lines', '1-1', '--tests', '../x.test.js'])), 2, 'A test outside the repository is an argument error');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'lib.js', '--lines', '1-1', '--tests', path.join(dir, 'tests/marker.test.js')])), 2, 'An --auto test given by an absolute path is an argument error');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', path.join(dir, 'lib.js'), '--lines', '1-1', '--tests', tests[0]])), 2, 'An --auto file given by an absolute path is an argument error');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'lib.js/', '--lines', '1-1', '--tests', tests[0]])), 2, 'An --auto file with a trailing separator is an argument error');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'lib.js', '--lines', '1-1', '--tests', `${tests[0]}/`])), 2, 'An --auto test with a trailing separator is an argument error, not a failed baseline');
		assert.equal(fs.existsSync(path.join(dir, 'tests/marker-ran.txt')), false, 'The --auto test given by an absolute path is not run');
		// 読めない・JSON でない一覧と等価の一覧、ない --auto のファイルと下書き、値のない引数は、引数の誤り（2）。
		fs.writeFileSync(outside, '[not json');
		for (const args of [['--spec', outside], ['--spec', path.join(dir, 'no-such.json')], ['--auto', 'missing.js', '--lines', '1-1', '--tests', tests[0]], ['--auto', 'lib.js', '--since', path.join(dir, 'no-draft.js'), '--tests', tests[0]], ['--auto', 'two.js', '--lines', '1-1', '--tests', tests[0], '--equivalents', outside], ['--tests'], ['--spec', outside, '--root']]) {
			assert.equal(await quietAsync(() => mutate.main(['--root', dir, ...args])), 2, args.join(' '));
		}
		// git がないと --since の差分を取れない（環境の誤り。2）。
		const savedPath = process.env.PATH;
		process.env.PATH = path.join(dir, 'no-bin');
		try {
			assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'lib.js', '--since', path.join(dir, 'lib.js'), '--tests', tests[0]])), 2, 'Without git, --since is an environment error');
		} finally {
			process.env.PATH = savedPath;
		}
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'comment.js', '--lines', '50-60', '--tests', tests[0]])), 2, 'Lines outside the file are an argument error');
		const after = await capturedAsync(() => mutate.main(['--root', dir, '--auto', 'comment.js', '--lines', '3-3', '--tests', tests[0]]));
		assert.deepEqual([after.code, after.text], [2, 'mutate: --lines の範囲が comment.js の行（2行）の外にある'], 'The line after the final newline is outside the file');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'comment.js', '--lines', '2-2', '--tests', tests[0]])), 1, 'The last line is inside the file (no candidates there)');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'bare.js', '--lines', '2-2', '--tests', tests[0]])), 1, 'The last line of a file without a final newline is inside');
		assert.equal(await quietAsync(() => mutate.main(['--root', dir, '--auto', 'bare.js', '--lines', '3-3', '--tests', tests[0]])), 2, 'The line after it is outside');
		const none = await capturedAsync(() => mutate.main(['--root', dir, '--auto', 'comment.js', '--lines', '1-1', '--tests', tests[0]]));
		assert.deepEqual([none.code, none.text], [1, 'mutate: 指定の行（1-1）に変異の候補がない'], 'Lines without candidates are a problem');
		const listeners = () => ['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => process.listenerCount(signal));
		const before = listeners();
		const limited = await capturedAsync(() => mutate.main(['--root', dir, '--auto', 'two.js', '--lines', '1-1', '--tests', tests[0], '--max', '1']));
		assert.match(limited.text, /mutate: 1件中/, '--max limits the automatic mutants');
		assert.deepEqual(listeners(), before, 'The signal handlers are removed after the run');
		fs.writeFileSync(draft, '// draft comment\nconst a = 1;\n');
		const unchanged = await capturedAsync(() => mutate.main(['--root', dir, '--auto', 'comment.js', '--since', draft, '--tests', tests[0]]));
		assert.deepEqual([unchanged.code, unchanged.text], [0, 'mutate: 下書きから変わった行に変異の候補がない'], 'A changed comment only is reported and passes');
		fs.writeFileSync(outside, JSON.stringify([{ name: 'hang', file: 'lib.js', find: '1', replace: '3', tests: ['tests/hang.test.js'] }]));
		process.env.KOGAI_HANG_PIDS = pidFile;
		const started = Date.now();
		const timed = await capturedAsync(() => mutate.main(['--root', dir, '--spec', outside, '--timeout', '3000']));
		assert.match(timed.text, /\| hang \| lib\.js \| 検出（時間切れ） \|/);
		assert.ok(Date.now() - started < 60000, '--timeout reaches the test run');
		assert.deepEqual(await waitStopped(fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid)), [], 'The timed-out test process is stopped');
	} finally {
		delete process.env.KOGAI_HANG_PIDS;
		cleanupHung(pidFile);
		fs.rmSync(outside, { force: true });
		fs.rmSync(draft, { force: true });
	}
}));

test('mutate: an interrupt, a termination or a hangup stops the running test process group, removes the copy and exits with the signal code', { skip: !gitAvailable || process.platform === 'win32', timeout: 60000 }, async () => withTempDirAsync({
	'lib.js': 'module.exports = 1;\n',
	'tests/hang.test.js': `require('node:test')('hang', () => { if (require('../lib.js') === 3) { ${hangCode('KOGAI_HANG_INFO')} } });\n`
}, async dir => {
	const spec = path.join(dir, '..', `${path.basename(dir)}-spec.json`);
	const info = path.join(dir, '..', `${path.basename(dir)}-hang.json`);
	fs.writeFileSync(spec, JSON.stringify([{ name: 'hang', file: 'lib.js', find: '1', replace: '3', tests: ['tests/hang.test.js'] }]));
	const { spawn } = require('node:child_process');
	const children = [];
	try {
		for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
			const child = spawn(process.execPath, [path.join(__dirname, '../scripts/mutate.js'), '--root', dir, '--spec', spec], { env: { ...process.env, KOGAI_HANG_INFO: info }, stdio: ['ignore', 'pipe', 'pipe'] });
			children.push(child.pid);
			let stderr = '';
			child.stderr.on('data', chunk => { stderr += chunk; });
			const exited = new Promise(resolve => child.on('exit', status => resolve(status)));
			for (let waited = 0; waited < 30000 && !fs.existsSync(info); waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
			const hung = JSON.parse(fs.readFileSync(info, 'utf8').split('\n')[0]);
			child.kill(signal);
			assert.equal(await exited, code, `${signal} ends mutate.js with ${code}`);
			assert.match(stderr, new RegExp(`${signal} を受けたので、実行中の試験を止めて写しを消した`));
			assert.deepEqual(await waitStopped([hung.pid]), [], `${signal}: the hanging test process is stopped`);
			assert.equal(fs.existsSync(hung.cwd), false, `${signal}: the copy is removed`);
			cleanupHung(info);
			assert.deepEqual(cleanupCopies(child.pid), [], `${signal}: no other copy is left behind`);
		}
	} finally {
		cleanupHung(info);
		for (const pid of children) cleanupCopies(pid);
		fs.rmSync(spec, { force: true });
	}
}));
