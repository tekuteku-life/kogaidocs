const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const precheck = require('../scripts/precheck');
const verifyTwice = require('../scripts/verify-twice');
const { withTempDir, git, gitAvailable, quiet, captured, outsideGit } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: verify-twice.js（Stage 8 の検証）の判定を確かめる。

test('verify-twice: counts, nested coverage, JUnit files, thresholds, digests and file changes produce the report and its problems', () => {
	const log = [
		'ℹ tests 12', 'ℹ suites 0', 'ℹ pass 12', 'ℹ fail 0', 'ℹ cancelled 0', 'ℹ skipped 0', 'ℹ todo 0', 'ℹ duration_ms 1234.5',
		'ℹ start of coverage report',
		'ℹ file                  | line % | branch % | funcs % | uncovered lines',
		'ℹ js                    |        |          |         | ',
		'ℹ  app.js               | 100.00 |    95.45 |  100.00 | ',
		'ℹ  seat.js              |  99.50 |    94.10 |  100.00 | 10',
		'ℹ tests                 |        |          |         | ',
		'ℹ  helpers              |        |          |         | ',
		'ℹ   dom-mock.js         |  95.52 |    84.34 |   91.46 | 124-131',
		'ℹ  scripts              |        |          |         | ',
		'ℹ   app.js              |  10.00 |    10.00 |   10.00 | 1-9',
		'ℹ all files             |  98.46 |    96.57 |   98.28 | '
	].join('\n');
	assert.deepEqual(verifyTwice.parseSummary(log), { tests: 12, pass: 12, fail: 0, cancelled: 0, skipped: 0, todo: 0, durationMs: 1234.5 });
	const coverage = verifyTwice.parseCoverage(log);
	assert.deepEqual(Object.keys(coverage), ['js/app.js', 'js/seat.js', 'tests/helpers/dom-mock.js', 'tests/scripts/app.js']);
	assert.deepEqual(verifyTwice.coverageShortfalls(coverage), ['js/seat.js の Line 99.5% が 100% 未満', 'js/seat.js の Branch 94.1% が 95% 未満']);
	assert.deepEqual(verifyTwice.compareSnapshots({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }), ['b', 'c']);
	assert.equal(verifyTwice.digestOf({ 'js/a.js': '1', 'docs/x.md': '2' }), verifyTwice.digestOf({ 'js/a.js': '1', 'docs/x.md': '3' }), 'docs/ is excluded from the digest');
	assert.notEqual(verifyTwice.digestOf({ 'js/a.js': '1' }), verifyTwice.digestOf({ 'js/a.js': '2' }));
	const junit = verifyTwice.parseJunitByFile('<testcase name="a" time="0.1" classname="test" file="/r/tests/unit/a.test.js"/>\n<testcase name="b &amp; c" time="2.5" classname="test" file="/r/tests/unit/a.test.js">\n<failure/>\n</testcase>\n<testcase name="d" time="0.2" classname="test" file="/r/tests/system/d.test.js"/>', '/r');
	assert.deepEqual(junit.files, { 'tests/unit/a.test.js': { tests: 2, failed: 1 }, 'tests/system/d.test.js': { tests: 1, failed: 0 } });
	const good = log.replace('ℹ  seat.js              |  99.50 |    94.10 |', 'ℹ  seat.js              | 100.00 |    97.44 |');
	const report = verifyTwice.renderReport([{ status: 0, log: good, junit }, { status: 0, log: good }], { count: 191, digest: 'f'.repeat(64), changedByRun: [[], []] });
	assert.deepEqual(report.problems, []);
	assert.match(report.markdown, /\| `npm test`（1回目） \| 12\/12件成功、fail 0・cancelled 0・skipped 0・todo 0、1235ms、終了コード0 \|/);
	assert.match(report.markdown, /計191ファイルについて、2回の実行の前後で変更がないことを確認した/);
	assert.match(report.markdown, new RegExp(`検証したコードの SHA-256 \\| ${'f'.repeat(64)}`));
	assert.match(report.markdown, /\| `js\/seat\.js` \| 100\.00 \| 97\.44 \| 97\.44 \|/);
	assert.match(report.markdown, /\| `tests\/unit\/a\.test\.js` \| 2 \|/);
	assert.match(report.markdown, /\| b & c \| `tests\/unit\/a\.test\.js` \| 2500ms \|/);
	assert.doesNotMatch(report.markdown, /dom-mock|tests\/scripts\/app/, 'Only production modules are tabulated');
	const bad = verifyTwice.renderReport([{ status: 1, log: log.replace('ℹ fail 0', 'ℹ fail 1') }, { status: 0, log: good.replace('ℹ todo 0', 'ℹ todo 1') }], { count: 3, digest: '0', changedByRun: [['js/app.js'], []] });
	assert.deepEqual(bad.problems.map(problem => problem.split('（')[0]), ['1回目の npm test が全件合格でない', '2回目の npm test が全件合格でない', '実行の前後でファイルが変わった: js/app.js', '1回目: js/seat.js の Line 99.5% が 100% 未満', '1回目: js/seat.js の Branch 94.1% が 95% 未満']);
	assert.deepEqual(verifyTwice.renderReport([{ status: 0, log: 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0' }], { count: 1, digest: '0', changedByRun: [[]] }).problems, ['本番モジュールのカバレッジが出力にない']);
	for (const args of [['--runs', '0'], ['--x']]) assert.ok(verifyTwice.parseArgs(args).error, args.join(' '));
	withTempDir({ 'package.json': JSON.stringify({ scripts: { test: 'node --test a.test.js' } }) }, root => {
		assert.equal(verifyTwice.testCommand(root, 'linux'), 'node --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination="$KOGAI_VERIFY_JUNIT" --test a.test.js', 'The JUnit path is not in the command text; the shell reads it from the variable');
		assert.equal(verifyTwice.testCommand(root, 'win32'), 'node --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination="%KOGAI_VERIFY_JUNIT%" --test a.test.js', 'cmd.exe reads it from the variable too (%name% in the value is not expanded again)');
		assert.equal(verifyTwice.JUNIT_VARIABLE, 'KOGAI_VERIFY_JUNIT');
		// 変数の値の $(…)・逆引用符・$名前・単引用符・%名前%・空白は、展開されずにそのまま1つの引数になる。
		const tricky = "/o/rec$(echo X)`echo Y`$HOME %USERNAME% it's.xml";
		if (process.platform !== 'win32') assert.equal(spawnSync('sh', ['-c', 'printf %s "$KOGAI_VERIFY_JUNIT"'], { encoding: 'utf8', env: { ...process.env, KOGAI_VERIFY_JUNIT: tricky } }).stdout, tricky);
	});
});

test('verify-twice: a run in a temporary repository refuses --out inside the tree, writes the record, keeps the parent coverage out and reports problems', { skip: !gitAvailable }, () => withTempDir({
	'package.json': JSON.stringify({ scripts: { test: 'node --test --experimental-test-coverage tests/a.test.js' } }),
	'.gitignore': 'ignored.txt\n',
	'ignored.txt': 'not part of the code',
	'js/a.js': 'function add(a, b) { return a + b; }\nmodule.exports = { add };\n',
	'tests/a.test.js': "const test = require('node:test');\nconst assert = require('node:assert');\nconst { add } = require('../js/a');\ntest('add', () => assert.equal(add(1, 2), 3));\n"
}, root => {
	git(root, 'init', '-q');
	git(root, 'add', '-A');
	git(root, 'commit', '-q', '-m', 'base');
	assert.equal(quiet(() => verifyTwice.main(['--root', root, '--out', path.join(root, 'verify-out'), '--runs', '1'])), 2, '--out inside the working tree is refused');
	assert.ok(verifyTwice.parseArgs(['--root', root, '--out', root]).error, 'The working tree itself is refused');
	assert.equal(verifyTwice.parseArgs([]).runs, 2, 'The default is two runs of the same code (Stage 8)');
	for (const args of [['--out'], ['--runs'], ['--root'], ['--report-only']]) assert.equal(quiet(() => verifyTwice.main(args)), 2, `${args[0]} without a value is an argument error`);
	assert.ok(verifyTwice.parseArgs(['--root', root, '--out', path.join(root, '..records')]).error, 'A directory named ..records is inside the tree');
	assert.equal(verifyTwice.parseArgs(['--root', root, '--out', path.join(root, '..')]).error, undefined, 'The parent directory is outside');
	assert.deepEqual(Object.keys(verifyTwice.snapshot(root)), ['.gitignore', 'js/a.js', 'package.json', 'tests/a.test.js'], 'Ignored files are not part of the digest');
	// 記録の置き場所の名前に $(…) を含めても、JUnit の出力はその名前のディレクトリに書かれる（シェルで展開されない）。
	const out = path.join(root, '..', `${path.basename(root)}-verify $(echo out)`);
	// 親が網羅を集めているとき（npm test の中など）も、親の網羅の置き場所に子の網羅を書かない。
	const parentCoverage = path.join(root, '..', `${path.basename(root)}-parent-coverage`);
	const saved = process.env.NODE_V8_COVERAGE;
	try {
		process.env.NODE_V8_COVERAGE = parentCoverage;
		try {
			assert.equal(quiet(() => verifyTwice.main(['--root', root, '--out', out, '--runs', '1'])), 0);
		} finally {
			if (saved === undefined) delete process.env.NODE_V8_COVERAGE;
			else process.env.NODE_V8_COVERAGE = saved;
		}
		assert.equal(fs.existsSync(parentCoverage), false, 'The parent coverage directory receives nothing');
		const text = fs.readFileSync(path.join(out, 'record.json'), 'utf8');
		assert.deepEqual(JSON.parse(text).sha.changedByRun, [[]]);
		assert.deepEqual(precheck.whitespaceIssues('record.json', text), [], 'The record is indented with tabs');
		assert.ok(fs.existsSync(path.join(out, 'run_1.junit.xml')));
		assert.equal(quiet(() => verifyTwice.main(['--report-only', out])), 0);
		fs.writeFileSync(path.join(root, 'js/b.js'), 'module.exports = 2;\n');
		const unloaded = captured(() => verifyTwice.main(['--root', root, '--out', out, '--runs', '1']));
		assert.equal(unloaded.code, 1, unloaded.text);
		assert.match(unloaded.text, /本番モジュール js\/b\.js がカバレッジの出力にない/, 'A real run records the modules, so an unloaded module is a problem');
		fs.rmSync(path.join(root, 'js/b.js'));
		fs.writeFileSync(path.join(root, 'tests/a.test.js'), "require('node:test')('skipped', { skip: true }, () => {});\n");
		assert.equal(quiet(() => verifyTwice.main(['--root', root, '--out', out, '--runs', '1'])), 1, 'A skipped test is a problem');
	} finally {
		fs.rmSync(out, { recursive: true, force: true });
		fs.rmSync(parentCoverage, { recursive: true, force: true });
	}
}));

test('verify-twice: each count makes a problem, the branch boundary, snapshots outside Git, deleted files, stderr and the report-only root', { skip: !gitAvailable }, () => {
	assert.deepEqual(verifyTwice.coverageShortfalls({ 'js/a.js': { line: 100, branch: 95 } }), [], 'Exactly 95% branches is enough');
	assert.deepEqual(verifyTwice.coverageShortfalls({ 'js/sub/b.js': { line: 50, branch: 50 } }), [], 'Only modules directly under js/ are production modules');
	withTempDir({ 'a.txt': 'a' }, root => {
		git(root, 'init', '-q');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'base');
		git(root, 'update-index', '--add', '--cacheinfo', `160000,${git(root, 'rev-parse', 'HEAD')},sub`);
		fs.mkdirSync(path.join(root, 'sub'));
		assert.deepEqual(Object.keys(verifyTwice.snapshot(root)), ['a.txt'], 'A submodule directory in the index is not hashed');
	});
	const ok = 'ℹ tests 1\nℹ pass 1\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0';
	const failing = run => verifyTwice.renderReport([run], { count: 1, digest: '0', changedByRun: [[]] }).problems.filter(problem => problem.includes('全件合格でない')).length;
	assert.equal(failing({ status: 0, log: ok }), 0);
	for (const run of [{ status: 1, log: ok }, { status: 0, log: 'no summary' }, ...['fail', 'cancelled', 'skipped', 'todo'].map(name => ({ status: 0, log: ok.replace(`${name} 0`, `${name} 1`) }))]) assert.equal(failing(run), 1, JSON.stringify(run));
	withTempDir({ 'a.txt': 'x' }, dir => outsideGit(dir, () => assert.throws(() => verifyTwice.snapshot(dir), /git ls-files/)));
	withTempDir({
		'package.json': JSON.stringify({ scripts: { test: 'node --test tests/a.test.js && node -e "console.error(\'stderr-marker\')"' } }),
		'tests/a.test.js': "require('node:test')('fine', () => {});\n",
		'gone.txt': 'x'
	}, root => {
		git(root, 'init', '-q');
		git(root, 'add', '-A');
		git(root, 'commit', '-q', '-m', 'base');
		fs.rmSync(path.join(root, 'gone.txt'));
		assert.deepEqual(Object.keys(verifyTwice.snapshot(root)).sort(), ['package.json', 'tests/a.test.js'], 'A deleted tracked file is left out');
		const out = path.join(root, '..', `${path.basename(root)}-verify-out`);
		try {
			quiet(() => verifyTwice.main(['--root', root, '--out', out, '--runs', '1']));
			assert.match(fs.readFileSync(path.join(out, 'run_1.log'), 'utf8'), /stderr-marker/, 'The log keeps stderr');
			const printed = captured(() => verifyTwice.main(['--report-only', out]));
			assert.match(printed.text, /\| `tests\/a\.test\.js` \| 1 \|/, 'The report-only run uses the recorded root for the file table');
		} finally {
			fs.rmSync(out, { recursive: true, force: true });
		}
	});
});

test('verify-twice: environment errors exit 2, other test commands pass through, ten slow tests are listed, and unloaded modules are problems', { skip: !gitAvailable }, () => {
	withTempDir({ 'a.txt': 'x' }, dir => {
		const records = () => fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('kogai-verify-'));
		const before = records();
		outsideGit(dir, () => assert.equal(quiet(() => verifyTwice.main(['--root', dir, '--runs', '1'])), 2, 'Outside Git no test runs and the exit code is 2'));
		assert.deepEqual(records().filter(name => !before.includes(name)), [], 'An environment error leaves no record directory behind');
		assert.equal(quiet(() => verifyTwice.main(['--report-only', dir])), 2, 'A missing record is an environment error');
	});
	withTempDir({ 'package.json': JSON.stringify({ scripts: { test: 'npm run other' } }) }, root => assert.equal(verifyTwice.testCommand(root, 'linux'), 'npm run other'));
	const junit = { files: { 'tests/a.test.js': { tests: 11, failed: 0 } }, tests: Array.from({ length: 11 }, (_, index) => ({ name: `t${index}`, file: 'tests/a.test.js', ms: (index + 1) * 100 })) };
	const ok = 'ℹ tests 11\nℹ pass 11\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\nℹ start of coverage report\nℹ file | line % | branch % | funcs % | uncovered lines\nℹ js | | | |\nℹ  a.js | 100.00 | 100.00 | 100.00 |\nℹ all files | 100.00 | 100.00 | 100.00 |';
	const report = verifyTwice.renderReport([{ status: 0, log: ok, junit }], { count: 1, digest: '0', changedByRun: [[]], modules: ['js/a.js', 'js/b.js'] });
	const slow = report.markdown.split('\n').filter(line => /^\| t\d+ \|/.test(line)).map(line => line.split(' | ')[0].slice(2));
	assert.deepEqual(slow, ['t10', 't9', 't8', 't7', 't6', 't5', 't4', 't3', 't2', 't1'], 'The ten slowest tests, slowest first');
	assert.deepEqual(report.problems, ['1回目: 本番モジュール js/b.js がカバレッジの出力にない（どの試験も読み込んでいない）']);
});
