const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stripScriptNoise } = require('../scripts/lib/js-lexer');
const checkDocs = require('../scripts/check-docs');
const repeatTests = require('../scripts/repeat-tests');
const { withTempDir, withTempDirAsync, quiet, running, waitStopped, captured } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: repeat-tests.js（不安定な試験の検出）の判定を確かめる。

test('repeat-tests: arguments, JUnit results, failures and the limit for tests outside the table are reported', () => {
	assert.deepEqual(repeatTests.parseArgs(['--times', '3', '--coverage', '--load', '2', '--limits', 'l.json', '--max-test-ms', '100', 'a.test.js']), { times: 3, coverage: true, load: 2, limits: 'l.json', maxTestMs: 100, files: ['a.test.js'] });
	for (const args of [['--times', '0', 'a'], ['--times', '2'], ['--load', '-1', 'a'], ['--max-test-ms', '0', 'a'], ['a', '--root'], ['a', '--times'], ['a', '--load'], ['a', '--limits'], ['a', '--max-test-ms'], ['--max-tests-ms', '10', 'a']]) assert.ok(repeatTests.parseArgs(args).error, args.join(' '));
	assert.deepEqual(repeatTests.parseJunit('<testcase name="a &amp; b" time="0.5" file="x"/>\n<testcase name="c" time="1.25" file="x">\n<failure message="x"/>\n</testcase>'), [{ name: 'a & b', ms: 500, failed: false }, { name: 'c', ms: 1250, failed: true }]);
	const summary = repeatTests.summarize([{ file: 'a', status: 0, tests: [{ name: 'x', ms: 10, failed: false }] }, { file: 'a', status: 1, tests: [{ name: 'x', ms: 30, failed: true }, { name: 'y', ms: 5, failed: false }] }], 20);
	assert.deepEqual(summary, { files: [{ file: 'a', runs: 2, failures: 1, failedTests: ['x'], slowest: [{ name: 'x', ms: 30, limit: 20, exempt: undefined }, { name: 'y', ms: 5, limit: 20, exempt: undefined }], overLimit: [{ name: 'x', ms: 30, limit: 20, exempt: undefined }] }], staleRules: [] });
	assert.deepEqual(repeatTests.summarize([{ file: 'a', status: 0, tests: Array.from({ length: 6 }, (_, index) => ({ name: `t${index}`, ms: index, failed: false })) }]).files[0].slowest.map(test => test.name), ['t5', 't4', 't3', 't2', 't1'], 'The five slowest tests are kept');
	let loadStarted = 0;
	let loadStopped = 0;
	const load = count => { loadStarted = count; return () => { loadStopped++; }; };
	withTempDir({ a: '' }, dir => {
		assert.equal(quiet(() => repeatTests.main(['--times', '1', '--load', '2', 'a'], { cwd: dir, run: () => ({ status: 0, tests: [] }), load })), 0);
		assert.deepEqual([loadStarted, loadStopped], [2, 1], 'The load is started and always stopped');
		assert.equal(quiet(() => repeatTests.main(['--times', '1', '--max-test-ms', '10', 'a'], { cwd: dir, run: () => ({ status: 0, tests: [{ name: 'slow', ms: 50, failed: false }] }) })), 1, 'Exceeding the limit for tests outside the table fails');
		assert.equal(quiet(() => repeatTests.main(['--times', '1', 'a'], { cwd: dir, run: () => ({ status: 1, tests: [] }) })), 1);
		// ない試験ファイル・--root は、試験の失敗（1）と区別して引数の誤り（2）にし、試験を実行しない。
		let ran = 0;
		const counted = () => { ran++; return { status: 0, tests: [] }; };
		assert.equal(quiet(() => repeatTests.main(['--times', '1', 'a', 'missing.test.js'], { cwd: dir, run: counted })), 2, 'A missing test file is an argument error');
		assert.equal(quiet(() => repeatTests.main(['--times', '1', '.'], { cwd: dir, run: counted })), 2, 'A directory is not a test file');
		assert.equal(quiet(() => repeatTests.main(['--root', path.join(dir, 'no-such-root'), '--times', '1', 'a'], { run: counted })), 2, 'A missing --root is an argument error');
		assert.equal(ran, 0, 'Nothing runs after an argument error');
	});
	assert.equal(quiet(() => repeatTests.main(['--times', 'x', 'a'])), 2);
});

test('repeat-tests: each test is compared with half of its own limit from the limits table', () => withTempDir({
	'limits.json': JSON.stringify({ rules: [
		{ file: 'tests/system/headless-*.test.js', limitMs: 20000, reason: '既定' },
		{ file: 'tests/system/headless-long.test.js', limitMs: 40000, reason: 'ファイル' },
		{ file: 'tests/system/headless-long.test.js', name: 'longest', limitMs: 80000, reason: '試験' },
		{ file: 'tests/system/headless-runner.test.js', name: 'timeout', exempt: '時間切れそのもの' }
	] }),
	'stale.json': JSON.stringify({ rules: [{ file: 'tests/system/headless-runner.test.js', name: 'renamed', limitMs: 1000, reason: 'x' }] }),
	'both.json': JSON.stringify({ rules: [{ file: 'a', limitMs: 1, exempt: 'both' }] }),
	'zero.json': JSON.stringify({ rules: [{ file: 'a', limitMs: 0 }] }),
	'blank.json': JSON.stringify({ rules: [{ file: 'a', exempt: ' ' }] }),
	'nofile.json': JSON.stringify({ rules: [{ limitMs: 1 }] }),
	'norules.json': JSON.stringify({}),
	'a': '',
	'tests/system/headless-runner.test.js': ''
}, dir => {
	const rules = repeatTests.loadLimits(path.join(dir, 'limits.json'));
	assert.equal(repeatTests.ruleFor(rules, 'tests/system/headless-long.test.js', 'longest').limitMs, 80000, 'A rule with the test name comes first');
	assert.equal(repeatTests.ruleFor(rules, 'tests/system/headless-long.test.js', 'other').limitMs, 40000, 'A file rule beats a wildcard rule');
	assert.equal(repeatTests.ruleFor(rules, 'tests/system/headless-x.test.js', 'any').limitMs, 20000);
	assert.equal(repeatTests.ruleFor(rules, 'tests/system/headless/x.test.js', 'any'), null, 'The wildcard does not cross a directory');
	assert.equal(repeatTests.ruleFor(rules, 'tests/unit/a.test.js', 'any'), null);
	const summary = repeatTests.summarize([
		{ file: 'tests/system/headless-long.test.js', status: 0, tests: [{ name: 'longest', ms: 39000, failed: false }, { name: 'other', ms: 21000, failed: false }] },
		{ file: 'tests/system/headless-runner.test.js', status: 0, tests: [{ name: 'timeout', ms: 99999, failed: false }, { name: 'start', ms: 10001, failed: false }] },
		{ file: 'tests/unit/a.test.js', status: 0, tests: [{ name: 'unit', ms: 99999, failed: false }] }
	], Infinity, rules);
	assert.deepEqual(summary.files.map(entry => entry.overLimit.map(test => `${test.name} ${test.ms}/${test.limit}`)), [['other 21000/20000'], ['start 10001/10000'], []], 'Half of each own limit; exempt tests and tests outside the table without --max-test-ms are not compared');
	assert.deepEqual(summary.staleRules, []);
	for (const file of ['missing.json', 'both.json', 'zero.json', 'blank.json', 'nofile.json', 'norules.json']) assert.throws(() => repeatTests.loadLimits(path.join(dir, file)), file);
	const run = () => ({ status: 0, tests: [{ name: 'timeout', ms: 99999, failed: false }, { name: 'start', ms: 100, failed: false }] });
	assert.equal(quiet(() => repeatTests.main(['--times', '1', '--limits', path.join(dir, 'limits.json'), './tests/system/headless-runner.test.js'], { cwd: dir, run })), 0, 'A relative path with ./ is matched in the table form');
	assert.equal(quiet(() => repeatTests.main(['--times', '1', '--limits', path.join(dir, 'stale.json'), 'tests/system/headless-runner.test.js'], { cwd: dir, run })), 1, 'A named rule whose test did not run is reported');
	assert.equal(quiet(() => repeatTests.main(['--times', '1', '--limits', path.join(dir, 'both.json'), 'a'], { cwd: dir, run })), 2);
	assert.equal(quiet(() => repeatTests.main(['--times', '1', '--limits', path.join(dir, 'missing.json'), 'a'], { cwd: dir, run })), 2, 'A --limits table that does not exist is an error, not a run without limits');
}));

test('repeat-tests: every timeout written in the tests has the same limit (or an exemption) in the limits table', () => {
	const root = path.join(__dirname, '../..');
	const rules = repeatTests.loadLimits(path.join(root, 'tests/scripts/stress/test-limits.json'));
	const runner = fs.readFileSync(path.join(root, 'tests/system/helpers/headless-runner.js'), 'utf8');
	const runnerDefault = Number((runner.match(/options\.timeoutMs \|\| (\d+)/) || [])[1]);
	assert.equal(repeatTests.ruleFor(rules, 'tests/system/headless-any.test.js', '').limitMs, runnerDefault, 'The headless-* rule is the runner default timeout');
	const files = [];
	const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach(entry => {
		const relative = `${dir}/${entry.name}`;
		if (entry.isDirectory() && relative !== 'tests/scripts' && entry.name !== 'node_modules') walk(relative);
		else if (entry.name.endsWith('.test.js')) files.push(relative);
	});
	walk('tests');
	// 試験の宣言（test・it と、その .only など）と suite の宣言（describe・suite）。
	const declares = (lines, index) => checkDocs.isTestDeclaration(lines, index) || /^\s*(?:[\w$]+\.)?(?:describe|suite)(?:\.(?:only|skip|todo))?\(/.test(lines[index]);
	const checked = [];
	for (const file of files) {
		const text = fs.readFileSync(path.join(root, file), 'utf8');
		const lines = text.split('\n');
		const masked = stripScriptNoise(text, { blankStrings: true }).split('\n');
		if (/require\(\s*['"][^'"]*headless-runner['"]\s*\)/.test(text)) assert.ok(repeatTests.ruleFor(rules, file, ''), `${file} uses the runner and has a rule`);
		masked.forEach((line, index) => {
			// runner の timeoutMs は、オブジェクトの中の位置によらず拾う。node:test の timeout は、試験・suite の宣言の引数
			// （宣言の行から、本文の始まり（=> か function）より前の行まで）にあるものを照合する。宣言の引数でない timeout は、
			// 許した呼出し（mutate.js の runMutants・runTests の引数）だけを通し、それ以外（変数で渡す options など）は問題にする。
			// 上限は表と照合できるよう数値で書く。
			for (const found of line.matchAll(/\b(timeout(?:Ms)?)\s*:\s*([^,}\s)]+)/g)) {
				// その行を含む試験: 直前の試験・suite の宣言（試験名が文字列でなければ、ファイルの規則だけが当たる）。
				let declaration = index;
				while (declaration >= 0 && !declares(lines, declaration)) declaration--;
				if (found[1] === 'timeout' && (declaration < 0 || masked.slice(declaration, index).some(entry => /=>|\bfunction\b/.test(entry)))) {
					// 直前の runMutants( か runTests( の括弧がまだ閉じていない（その呼出しの引数の中にある）ときだけ許す。
					const before = [...masked.slice(0, index), line.slice(0, found.index)].join('\n');
					const call = [...before.matchAll(/\b(?:runMutants|runTests)\(/g)].pop();
					let depth = 0;
					if (call) for (const ch of before.slice(call.index + call[0].length - 1)) depth += ch === '(' ? 1 : ch === ')' ? -1 : 0;
					assert.ok(depth > 0, `${file}:${index + 1}: a timeout outside a test declaration is only allowed inside a call of runMutants or runTests`);
					continue;
				}
				assert.match(found[2], /^\d+$/, `${file}:${index + 1}: the limit is written as a number`);
				const name = declaration >= 0 ? ((lines[declaration].match(/\(\s*(['"`])((?:\\.|(?!\1).)*)\1/) || [])[2] || '') : '';
				const rule = repeatTests.ruleFor(rules, file, name.replace(/\\(['"`\\])/g, '$1'));
				assert.ok(rule, `${file}:${index + 1} has a rule`);
				if (rule.exempt === undefined) assert.equal(rule.limitMs, Number(found[2]), `${file}:${index + 1} (${name || 'ファイルの規則'}) has the same limit`);
				checked.push(`${file}:${index + 1}`);
			}
		});
	}
	assert.ok(checked.length >= 10, `timeouts found: ${checked.length}`);
	assert.equal(checked.filter(entry => entry.startsWith('tests/unit/dev-scripts-mutate.test.js:')).length, 2, 'The test options in the development script tests are checked, and the runMutants argument is not');
});

test('repeat-tests: every named rule in the real limits table names a test declared in its file', () => {
	const root = path.join(__dirname, '../..');
	const rules = repeatTests.loadLimits(path.join(root, 'tests/scripts/stress/test-limits.json'));
	assert.ok(rules.some(rule => rule.exempt) && rules.some(rule => rule.file.includes('*')));
	for (const rule of rules.filter(entry => entry.name !== undefined)) {
		const lines = fs.readFileSync(path.join(root, rule.file), 'utf8').split('\n');
		assert.ok(lines.some((line, index) => checkDocs.declaresTest(lines, index, rule.name)), `${rule.file}: ${rule.name}`);
	}
});

test('repeat-tests: a real run reads JUnit results and the load workers stop', () => withTempDir({ 'fail.test.js': "require('node:test')('broken', () => { throw new Error('x'); });\n", 'pass.test.js': "require('node:test')('fine', () => {});\n" }, dir => {
	const pass = repeatTests.runOnce('pass.test.js', { coverage: false, cwd: dir });
	assert.equal(pass.status, 0);
	assert.deepEqual(pass.tests.map(entry => [entry.name, entry.failed]), [['fine', false]]);
	const failed = repeatTests.runOnce('fail.test.js', { coverage: false, cwd: dir });
	assert.notEqual(failed.status, 0);
	assert.deepEqual(failed.tests.map(entry => [entry.name, entry.failed]), [['broken', true]]);
	const stop = repeatTests.startLoad(1);
	assert.equal(stop.pids.length, 1);
	stop();
}));

test('repeat-tests: load workers end by themselves when their parent stops without stopping them', async () => {
	const script = `const stop = require(${JSON.stringify(path.join(__dirname, '../scripts/repeat-tests.js'))}).startLoad(2); console.log(JSON.stringify(stop.pids)); process.exit(0);`;
	const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
	const pids = JSON.parse(result.stdout);
	const left = await waitStopped(pids);
	for (const pid of left) process.kill(pid, 'SIGKILL');
	assert.deepEqual(left, [], 'The orphaned workers exit');
});

test('repeat-tests: defaults, the equal-limit boundary, the default limits table, run counts and the printed tables', () => withTempDir({
	'a.test.js': '',
	'b.test.js': '',
	'tests/scripts/stress/test-limits.json': JSON.stringify({ rules: [{ file: 'a.test.js', name: 'gone', limitMs: 100, reason: 'x' }] }),
	'empty-file.json': JSON.stringify({ rules: [{ file: '', limitMs: 1 }] }),
	'shown.json': JSON.stringify({ rules: [{ file: 'a.test.js', limitMs: 20, reason: 'x' }, { file: 'a.test.js', name: 'free', exempt: '理由' }] })
}, dir => {
	assert.equal(repeatTests.parseArgs(['a']).coverage, false);
	assert.throws(() => repeatTests.loadLimits(path.join(dir, 'empty-file.json')), /file のない規則/);
	assert.deepEqual(repeatTests.summarize([{ file: 'a', status: 0, tests: [{ name: 'x', ms: 20, failed: false }] }], 20).files[0].overLimit, [], 'A time equal to the limit is within it');
	let calls = 0;
	const counted = () => { calls++; return { status: 0, tests: [] }; };
	assert.equal(quiet(() => repeatTests.main(['--times', '1', 'a.test.js'], { cwd: dir, run: counted })), 1, 'The default limits table is read and its stale rule is reported');
	assert.equal(calls, 1, 'Each file runs exactly --times times');
	let round = 0;
	const run = file => {
		if (file === 'b.test.js') return { status: 0, tests: [{ name: 'x', ms: 5, failed: false }] };
		round++;
		return round === 1 ? { status: 1, tests: [{ name: 'slow', ms: 50, failed: true }, { name: 'free', ms: 99, failed: false }] } : { status: 0, tests: [{ name: 'slow', ms: 5, failed: false }, { name: 'free', ms: 1, failed: false }] };
	};
	const printed = captured(() => repeatTests.main(['--times', '2', '--limits', path.join(dir, 'shown.json'), 'a.test.js', 'b.test.js'], { cwd: dir, run }));
	assert.equal(printed.code, 1);
	for (const line of ['| a.test.js | 2 | 1 | slow | slow（50ms / 上限 10ms） |', '| b.test.js | 2 | 0 | — | — |', '| a.test.js | free（99ms・比べない）、slow（50ms / 上限 10ms） |', '| b.test.js | x（5ms） |']) assert.ok(printed.text.split('\n').includes(line), `${line} in\n${printed.text}`);
}));

test('repeat-tests: load workers keep running while the parent lives, --coverage reaches the test process, and --root moves the run and the table', async () => {
	const stop = repeatTests.startLoad(1);
	await new Promise(resolve => setTimeout(resolve, 500));
	assert.equal(running(stop.pids[0]), true, 'The worker is still running');
	stop();
	assert.deepEqual(await waitStopped(stop.pids), []);
	await withTempDirAsync({
		'cov.test.js': "require('node:test')('cov', () => { if (!process.env.NODE_V8_COVERAGE) throw new Error('no coverage'); });\n",
		'tests/scripts/stress/test-limits.json': JSON.stringify({ rules: [{ file: 'cov.test.js', name: 'gone', limitMs: 100, reason: 'x' }] })
	}, async dir => {
		// 親が網羅を集めている状態（npm test・--coverage の一掃）を作る。親の値は子に届かず、網羅を集めるかは --coverage だけで決まる。
		const saved = process.env.NODE_V8_COVERAGE;
		process.env.NODE_V8_COVERAGE = path.join(dir, 'parent-coverage');
		try {
			assert.equal(repeatTests.runOnce('cov.test.js', { coverage: true, cwd: dir }).status, 0, 'With --coverage the test process collects coverage');
			assert.notEqual(repeatTests.runOnce('cov.test.js', { coverage: false, cwd: dir }).status, 0, 'Without --coverage the parent coverage does not reach the test process');
		} finally {
			if (saved === undefined) delete process.env.NODE_V8_COVERAGE;
			else process.env.NODE_V8_COVERAGE = saved;
		}
		const seen = [];
		const run = (file, options) => { seen.push(options.cwd); return { status: 0, tests: [] }; };
		assert.equal(quiet(() => repeatTests.main(['--root', dir, '--times', '1', 'cov.test.js'], { cwd: os.tmpdir(), run })), 1, 'The limits table under --root is read (its stale rule fails)');
		assert.deepEqual(seen, [dir]);
	});
});
