const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const runUnits = require('../scripts/run-units');
const { withTempDir, withTempDirAsync, capturedAsync, quietAsync, running, waitStopped, cleanupHung, gitAvailable } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: run-units.js（単位ごとの実行と記録。Stage 4・Stage 7）の判定と実行を確かめる。

const SCRIPT = path.resolve(__dirname, '../scripts/run-units.js');
// 単位の記録の置き場所を環境変数に持つプロセスを /proc で探せる環境か（ない環境では、プロセスグループだけを止める。4.6 の (3)）。
const PROC = fs.existsSync('/proc/self/environ');
// 権限の確かめが利用者の umask に依らないよう（umask 077 では権限を指定しなくても 0o600 になる）、この試験の間は 022 にする。
process.umask(0o022);

// 試料のリポジトリ。scripts/unit.js が最上位のプロセスで、子のプロセス scripts/child.js を起こす（どちらの読取りも記録される。
// 写しの根を写した最上位のプロセス（copier）の読取りは入力にしない）。
const FIXTURE = {
	'package.json': '{ "name": "fixture" }\n',
	'lib/top.js': 'module.exports = 1;\n',
	'lib/value.js': "module.exports = require('node:fs').readFileSync(require('node:path').join(__dirname, '../data/value.txt'), 'utf8').trim();\n",
	'data/value.txt': 'ok\n',
	'data/other.txt': 'other\n',
	'data/top.txt': 'top\n',
	'data/mode.txt': 'ok\n',
	'docs/spec.md': 'spec\n',
	'docs/reviews/r1.md': 'review\n',
	'docs/review_backlog.md': 'backlog\n',
	// 名前の先頭だけが審査の記録・docs/ と同じもの（審査の記録ではなく、docs/ の中でもない）。
	'docs/reviews-index.md': 'index\n',
	'docs/review_backlog.md.bak': 'old backlog\n',
	'docsx/page.html': '<p>page</p>\n',
	'tests/unit/x.test.js': '// not read\n',
	'.git/HEAD': 'ref\n',
	'sub/node_modules/m.js': '// nested\n',
	'node_modules/dep/index.js': "module.exports = 'dep';\n",
	'lib/esm.mjs': 'export const value = 1;\n',
	'scripts/fail.js': 'process.exit(3);\n',
	'scripts/unit.js': [
		"const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawnSync } = require('node:child_process');",
		"require('../lib/top.js');",
		"fs.readFileSync(path.join(__dirname, '../data/top.txt'));",
		'const [mode, ...rest] = process.argv.slice(2);',
		"if (mode === 'copier') { fs.cpSync('.', path.join(os.tmpdir(), 'whole-copy'), { recursive: true }); spawnSync('sh', ['-c', 'true']); fs.globSync('lib/*/../*.js'); }",
		// glob（trace-reads.js は走査の範囲を決めず、パターンを whole と記録する）。
		"if (mode === 'glob-up') fs.globSync('lib/*/../*.js');",
		// 写しの上のディレクトリの recursive の一覧（写しの全体を含む）。
		"if (mode === 'above') fs.readdirSync('..', { recursive: true });",
		"if (mode === 'mutate-copy') {",
		"	for (const [name, file] of [[`kogai-mutate-${process.pid}-AbC123`, 'mapped.txt'], ['kogai-mutate-1-AbC123', 'other-pid.txt']]) {",
		"		fs.mkdirSync(path.join(os.tmpdir(), name, 'data'), { recursive: true });",
		"		fs.writeFileSync(path.join(os.tmpdir(), name, 'data', file), 'x');",
		'	}',
		"	fs.writeFileSync(path.join(os.tmpdir(), 'plain.txt'), 'x');",
		'}',
		"const result = spawnSync(process.execPath, [path.join(__dirname, 'child.js'), mode, ...rest], { stdio: 'inherit' });",
		'process.exit(result.status ?? 1);',
		''
	].join('\n'),
	'scripts/child.js': [
		"const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawn, spawnSync } = require('node:child_process');",
		'const [mode, arg] = process.argv.slice(2);',
		"if (require('../lib/value.js') !== 'ok') process.exit(1);",
		"const hang = () => { fs.appendFileSync(process.env.KOGAI_HANG_RECORD, JSON.stringify({ pid: process.pid, cwd: process.cwd() }) + '\\n'); for (const end = Date.now() + 20000; Date.now() < end;) {} };",
		"const hung = () => (fs.existsSync(process.env.KOGAI_HANG_RECORD) ? fs.readFileSync(process.env.KOGAI_HANG_RECORD, 'utf8').split('\\n').filter(Boolean).length : 0);",
		// 孫のプロセスを起こし、それが記録を書くまで待ってから終わる（detached なら別のプロセスグループ）。
		"const leave = (detached, env) => { const before = hung(); spawn(process.execPath, [__filename, 'hang'], { stdio: 'ignore', detached, env }).unref(); for (const end = Date.now() + 15000; Date.now() < end && hung() === before;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); };",
		"if (mode === 'info') console.log(JSON.stringify({ vars: [process.env.TMP, process.env.TEMP], cwd: process.cwd(), pwd: process.env.PWD ?? null, paths: ['OLDPWD', 'INIT_CWD', 'npm_package_json', 'npm_config_local_prefix'].map(name => process.env[name] ?? null), tmp: os.tmpdir(), reviews: fs.existsSync('docs/reviews'), backlog: fs.existsSync('docs/review_backlog.md'), git: fs.existsSync('.git'), nested: fs.existsSync('sub/node_modules'), dep: require('dep'), coverage: process.env.NODE_V8_COVERAGE ?? null, context: process.env.NODE_TEST_CONTEXT ?? null }));",
		"if (mode === 'tree') fs.cpSync('data', path.join(os.tmpdir(), 'tree-copy'), { recursive: true });",
		"if (mode === 'siblings') console.log(JSON.stringify(fs.readdirSync(path.dirname(process.cwd())).sort()));",
		"if (mode === 'write') fs.writeFileSync('data/new.txt', 'x');",
		"if (mode === 'outside') fs.writeFileSync(arg, 'changed');",
		"if (mode === 'browser') spawnSync(arg);",
		"if (mode === 'program') spawnSync('sh', ['-c', 'true']);",
		"if (mode === 'node-link') spawnSync(arg, ['-e', '0']);",
		"if (mode === 'remove-tmp') fs.rmSync(os.tmpdir(), { recursive: true });",
		"if (mode === 'link') fs.symlinkSync('value.txt', 'data/made-link');",
		// 単位の一時ディレクトリの親（run-units.js の写しの置き場所）ごと消す。
		"if (mode === 'remove-units') { fs.rmSync(path.dirname(os.tmpdir()), { recursive: true }); if (arg === 'hang') hang(); }",
		"if (mode === 'untraced') spawnSync(process.execPath, ['-e', '0'], { env: {} });",
		"if (mode === 'mutate-copy') for (const name of [`kogai-mutate-${process.ppid}-AbC123/data/mapped.txt`, 'kogai-mutate-1-AbC123/data/other-pid.txt', 'plain.txt']) fs.readFileSync(path.join(os.tmpdir(), name));",
		"if (mode === 'sleep') { console.log(`start ${Date.now()}`); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); console.log(`end ${Date.now()}`); }",
		"if (mode === 'grandchild') leave(false, { KOGAI_HANG_RECORD: process.env.KOGAI_HANG_RECORD });",
		// 別のプロセスグループへ、単位の記録の置き場所（KOGAI_TRACE_DIR）だけを持って出る孫（KOGAI_TRACE_UNITS はない）。
		"if (mode === 'detached') leave(true, { KOGAI_HANG_RECORD: process.env.KOGAI_HANG_RECORD, KOGAI_TRACE_DIR: process.env.KOGAI_TRACE_DIR });",
		"if (mode === 'options') console.log(process.env.NODE_OPTIONS);",
		"if (mode === 'esm') import('../lib/esm.mjs').then(module => console.log(module.value));",
		"if (mode === 'hang') hang();",
		"if (mode === 'maybe') { if (fs.readFileSync('data/mode.txt', 'utf8').trim() === 'hang') hang(); console.log('maybe ok'); }",
		''
	].join('\n')
};

/**
 * 試料のリポジトリ（dir/repo）と、その外の記録の置き場所（dir/records）・単位の一覧（dir/units.json）で run を実行する。
 * 試料の node_modules を、run-units.js が写しにシンボリックリンクで置くので、これを使う試験は Windows では除く。
 */
function withFixture(run) {
	return withTempDirAsync(Object.fromEntries(Object.entries(FIXTURE).map(([file, text]) => [`repo/${file}`, text])), async dir => {
		const repo = path.join(dir, 'repo');
		const records = path.join(dir, 'records');
		const unitsFile = path.join(dir, 'units.json');
		const main = async (units, ...args) => {
			fs.writeFileSync(unitsFile, JSON.stringify(units));
			return capturedAsync(() => runUnits.main(['--root', repo, '--units', unitsFile, '--records', records, ...args]));
		};
		const record = name => JSON.parse(fs.readFileSync(path.join(records, `${runUnits.recordId(name)}.json`), 'utf8'));
		return run({ dir, repo, records, main, record });
	});
}

/** このプロセスの run-units.js が作った写し（kogai-units-<プロセス番号>-*）。 */
const leftCopies = (pid = process.pid, base = os.tmpdir()) => fs.readdirSync(base).filter(name => name.startsWith(`kogai-units-${pid}-`));

test('run-units: arguments, the records outside the working tree and the option values', () => {
	const root = path.resolve('/r/repo');
	assert.deepEqual(runUnits.parseArgs(['--root', root, '--units', 'u.json', '--records', '/r/records', '--jobs', '2', '--list']), { root, units: path.resolve('u.json'), records: path.resolve('/r/records'), jobs: 2, list: true });
	assert.equal(runUnits.parseArgs(['--root', root, '--units', 'u', '--records', '/r/records', '--only', 'a.b']).only.source, 'a.b');
	assert.equal(runUnits.parseArgs(['--units', 'u', '--records', '/elsewhere']).jobs, 1);
	assert.equal(runUnits.parseArgs(['--units', 'u', '--records', '/elsewhere']).root, path.resolve(__dirname, '../..'), 'The default root is the repository');
	for (const args of [[], ['--units', 'u'], ['--records', '/x'], ['--units'], ['--units', 'u', '--records'], ['--units', 'u', '--records', '/x', '--root'], ['--units', 'u', '--records', '/x', '--only'], ['--units', 'u', '--records', '/x', '--jobs'],
		['--units', 'u', '--records', '/x', '--jobs', '0'], ['--units', 'u', '--records', '/x', '--jobs', '1.5'], ['--units', 'u', '--records', '/x', '--jobs', 'x'], ['--units', 'u', '--records', '/x', '--only', '('], ['--units', 'u', '--records', '/x', '--lists'], ['--units', 'u', '--records', '/x', 'extra']]) {
		assert.ok(runUnits.parseArgs(args).error, args.join(' '));
	}
	for (const records of [root, path.join(root, 'records'), path.join(root, '..records')]) assert.match(runUnits.parseArgs(['--root', root, '--units', 'u', '--records', records]).error, /外に置く/, records);
	for (const records of [path.resolve('/r'), path.resolve('/r/records'), path.resolve('/other')]) assert.equal(runUnits.parseArgs(['--root', root, '--units', 'u', '--records', records]).error, undefined, records);
	assert.equal(runUnits.outside(root, path.join(root, '..', 'x')), true);
	assert.equal(runUnits.outside(root, path.join(root, 'x')), false);
	assert.equal(runUnits.outside(root, root), false);
});

test('run-units: a missing or non-directory --root stops before anything is made, and a unit that cannot start is reported', () => withTempDirAsync({ 'file.txt': 'x', 'units.json': '[]' }, async dir => {
	const records = path.join(dir, 'records');
	for (const root of [path.join(dir, 'missing'), path.join(dir, 'file.txt')]) {
		const result = await capturedAsync(() => runUnits.main(['--root', root, '--units', path.join(dir, 'units.json'), '--records', records]));
		assert.equal(result.code, 2, root);
		assert.match(result.text, /run-units: --root がない/, root);
		assert.ok(!fs.existsSync(records), 'Nothing is made');
	}
	// 起動できない単位（作業ディレクトリがない）は、例外でなく結果の error で返す（'exit' は起きない）。
	const state = { active: new Map(), tracer: path.resolve(__dirname, '../scripts/trace-reads.js') };
	const outcome = await runUnits.execute(['-e', '0'], { cwd: path.join(dir, 'missing'), tmp: dir, trace: path.join(dir, 'trace'), output: path.join(dir, 'out.txt'), state });
	assert.deepEqual([outcome.status, outcome.signal], [null, null]);
	assert.match(outcome.error, /ENOENT/);
	assert.equal(state.active.size, 0);
	// 終わった単位は実行中の一覧から除く（後の stopAll が、終わった単位のプロセス番号のグループを止めない）。出力は標準出力と標準エラー。
	const ended = await runUnits.execute(['-e', "console.log('to stdout'); console.error('to stderr');"], { cwd: dir, tmp: dir, trace: path.join(dir, 'trace'), output: path.join(dir, 'ended.txt'), state });
	assert.deepEqual([ended.status, ended.signal, ended.error], [0, null, null]);
	assert.equal(state.active.size, 0, 'A unit that ended is not running');
	assert.deepEqual(fs.readFileSync(path.join(dir, 'ended.txt'), 'utf8').split('\n').filter(Boolean).sort(), ['to stderr', 'to stdout']);
}));

test('run-units: unit entries are checked before anything runs', { skip: process.platform === 'win32' }, () => withTempDir({
	'scripts/u.js': '', 'scripts/u.txt': '', 'scripts/dir.js/a.txt': '', 'data/a.txt': '', '.git/x.js': '', 'node_modules/m/x.js': '', 'docs/reviews/r.md': '', 'docs/review_backlog.md': '', 'docs/spec.md': ''
}, root => {
	fs.symlinkSync(path.join(root, 'scripts'), path.join(root, 'linked'));
	const outsideFile = path.join(path.dirname(root), `outside-${process.pid}.json`);
	fs.writeFileSync(outsideFile, '[]');
	// 木の外から木を指すリンク（その下の絶対パスは、字面では外でも作業ツリーを読む）。
	const rootLink = path.join(path.dirname(root), `root-link-${process.pid}`);
	fs.symlinkSync(root, rootLink);
	// 木の中から木の外を指すリンクの下のパス（実パスは外でも、字面では作業ツリーの中にある）。
	fs.symlinkSync('../..', path.join(root, 'node_modules/out'));
	const throughOut = path.join(root, 'node_modules/out', path.basename(outsideFile));
	try {
		const ok = { name: 'a', command: ['scripts/u.js', '--spec', outsideFile, 'data/a.txt', 'not-a-path'], inputs: ['data', 'docs/spec.md', outsideFile], wholeCopy: true };
		assert.equal(runUnits.unitError(ok, root, new Set()), null);
		assert.equal(runUnits.unitError({ name: 'a', command: ['scripts/u.js'] }, root, new Set()), null);
		const bad = [
			[null, /オブジェクト/], [[], /オブジェクト/], ['x', /オブジェクト/],
			[{ name: 'a', command: ['scripts/u.js'], input: [] }, /知らないキー: input/],
			[{ command: ['scripts/u.js'] }, /name/], [{ name: ' ', command: ['scripts/u.js'] }, /name/], [{ name: 1, command: ['scripts/u.js'] }, /name/],
			[{ name: 'a', command: 'scripts/u.js' }, /command/], [{ name: 'a', command: [] }, /command/], [{ name: 'a', command: ['scripts/u.js', 1] }, /command/],
			[{ name: 'a', command: ['scripts/u.txt'] }, /先頭/], [{ name: 'a', command: ['scripts/missing.js'] }, /先頭/], [{ name: 'a', command: ['./scripts/u.js'] }, /先頭/],
			[{ name: 'a', command: [path.join(root, 'scripts/u.js')] }, /先頭/], [{ name: 'a', command: ['../u.js'] }, /先頭/], [{ name: 'a', command: ['linked/u.js'] }, /先頭/],
			[{ name: 'a', command: ['.git/x.js'] }, /先頭/], [{ name: 'a', command: ['node_modules/m/x.js'] }, /先頭/], [{ name: 'a', command: ['scripts'] }, /先頭/], [{ name: 'a', command: ['scripts/dir.js'] }, /先頭/],
			[{ name: 'a', command: ['scripts/u.js', path.join(root, 'data/a.txt')] }, /作業ツリーの中を指す絶対パスの引数/],
			[{ name: 'a', command: ['scripts/u.js', `--tests=x,${path.join(root, 'data')}`] }, /作業ツリーの中を指す絶対パスの引数/],
			[{ name: 'a', command: ['scripts/u.js', root] }, /作業ツリーの中を指す絶対パスの引数/],
			[{ name: 'a', command: ['scripts/u.js', path.join(rootLink, 'data/a.txt')] }, /作業ツリーの中を指す絶対パスの引数/],
			[{ name: 'a', command: ['scripts/u.js', throughOut] }, /作業ツリーの中を指す絶対パスの引数/],
			[{ name: 'a', command: ['scripts/u.js', '..'] }, /写しの外を指す相対パスの引数/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: 'data' }, /inputs/], [{ name: 'a', command: ['scripts/u.js'], inputs: [''] }, /inputs/], [{ name: 'a', command: ['scripts/u.js'], inputs: [1] }, /inputs/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: [path.join(root, 'data')] }, /作業ツリーの中を指す/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: [path.join(rootLink, 'data')] }, /作業ツリーの中を指す/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: [throughOut] }, /作業ツリーの中を指す/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: [path.join(path.dirname(root), 'no-such-input')] }, /inputs のパスがない/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: ['missing'] }, /inputs のパス/], [{ name: 'a', command: ['scripts/u.js'], inputs: ['./data'] }, /inputs のパス/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: ['linked/u.js'] }, /inputs のパス/], [{ name: 'a', command: ['scripts/u.js'], inputs: ['node_modules/m'] }, /inputs のパス/],
			[{ name: 'a', command: ['scripts/u.js'], inputs: ['docs/reviews/r.md'] }, /inputs のパス/], [{ name: 'a', command: ['scripts/u.js'], inputs: ['docs/review_backlog.md'] }, /inputs のパス/],
			[{ name: 'a', command: ['scripts/u.js'], wholeCopy: 'yes' }, /wholeCopy/]
		];
		for (const [unit, message] of bad) assert.match(runUnits.unitError(unit, root, new Set()) || '', message, JSON.stringify(unit));
		assert.match(runUnits.unitError({ name: 'a', command: ['scripts/u.js'] }, root, new Set(['a'])), /重なる/);
		// --root がリンクのときは、作業ツリーの実パスも木の中とする。
		const real = fs.realpathSync(root);
		assert.match(runUnits.unitError({ name: 'a', command: ['scripts/u.js', path.join(real, 'data/a.txt')] }, rootLink, new Set()) || '', /作業ツリーの中を指す絶対パスの引数/);
		assert.match(runUnits.unitError({ name: 'a', command: ['scripts/u.js'], inputs: [path.join(real, 'data')] }, rootLink, new Set()) || '', /作業ツリーの中を指す/);
		assert.equal(runUnits.unitError({ name: 'a', command: ['scripts/u.js', outsideFile], inputs: [outsideFile] }, rootLink, new Set()), null, 'A path outside the tree is fine through a linked root');
		const file = path.join(path.dirname(root), `units-${process.pid}.json`);
		try {
			fs.writeFileSync(file, JSON.stringify([ok, { name: 'b', command: ['scripts/u.js'] }]));
			assert.deepEqual(runUnits.loadUnits(file, root), [{ name: 'a', command: ok.command, inputs: ok.inputs, wholeCopy: true }, { name: 'b', command: ['scripts/u.js'], inputs: [], wholeCopy: false }]);
			for (const [text, message] of [['{', /読めない/], ['{}', /空でない配列/], ['[]', /空でない配列/], [JSON.stringify([ok, ok]), /2 番目: name が重なる/]]) {
				fs.writeFileSync(file, text);
				assert.throws(() => runUnits.loadUnits(file, root), message);
			}
			assert.throws(() => runUnits.loadUnits(path.join(root, 'missing.json'), root), /読めない/);
		} finally {
			fs.rmSync(file, { force: true });
		}
		assert.equal(runUnits.copiedPath(root, 'data'), true);
		assert.equal(runUnits.copiedPath(root, 'docs/spec.md'), true);
		assert.equal(runUnits.copiedPath(root, 'docs/reviews'), false);
		// 作業ツリーの中かどうかは実パスで比べる（外のリンクを通しても中に置けない）。
		const link = path.join(path.dirname(root), `link-${process.pid}`);
		fs.symlinkSync(root, link);
		try {
			assert.match(runUnits.parseArgs(['--root', root, '--units', 'u', '--records', path.join(link, 'records')]).error, /外に置く/);
			assert.match(runUnits.parseArgs(['--root', link, '--units', 'u', '--records', path.join(root, 'records')]).error, /外に置く/);
			assert.equal(runUnits.realResolve(path.join(link, 'no/such')), path.join(fs.realpathSync(root), 'no/such'));
		} finally {
			fs.rmSync(link, { force: true });
		}
		// 記録の置き場所: ないものは作って印を置く。空のものは印を置いて使う。空でなく印のないものとファイルは使わない。
		const records = path.join(path.dirname(root), `records-${process.pid}`);
		try {
			runUnits.prepareRecords(records, false);
			assert.ok(!fs.existsSync(records), 'Nothing is made without create (--list)');
			runUnits.prepareRecords(records, true);
			assert.deepEqual(fs.readdirSync(records), [runUnits.MARKER]);
			fs.writeFileSync(path.join(records, 'summary.md'), 'kept');
			runUnits.prepareRecords(records, true);
			fs.rmSync(path.join(records, runUnits.MARKER));
			assert.throws(() => runUnits.prepareRecords(records, true), /記録の置き場所でない/);
			assert.throws(() => runUnits.prepareRecords(records, false), /記録の置き場所でない/);
			assert.equal(fs.readFileSync(path.join(records, 'summary.md'), 'utf8'), 'kept', 'A directory that is not a record place is not touched');
			fs.rmSync(path.join(records, 'summary.md'));
			runUnits.prepareRecords(records, false);
			assert.deepEqual(fs.readdirSync(records), [], 'An empty directory gets no marker without create');
			runUnits.prepareRecords(records, true);
			assert.deepEqual(fs.readdirSync(records), [runUnits.MARKER], 'An empty directory gets the marker');
			assert.equal(fs.statSync(path.join(records, runUnits.MARKER)).mode & 0o777, 0o600, 'The marker in an existing directory is private too');
			assert.throws(() => runUnits.prepareRecords(path.join(records, runUnits.MARKER), true), /ディレクトリでない/);
			runUnits.prepareRecords(path.join(records, 'deep', 'er'), true);
			// 印のファイルの名前は .run-units-records（4.6 の (6)）。その名前のファイルだけがある置き場所は使える。
			const named = path.join(records, 'named');
			fs.mkdirSync(named);
			fs.writeFileSync(path.join(named, '.run-units-records'), '');
			fs.writeFileSync(path.join(named, 'summary.md'), 'old');
			runUnits.prepareRecords(named, true);
			assert.deepEqual(fs.readdirSync(path.join(records, 'deep', 'er')), [runUnits.MARKER], 'A place whose parent is missing is made with its parents');
		} finally {
			fs.rmSync(records, { recursive: true, force: true });
		}
	} finally {
		fs.rmSync(outsideFile, { force: true });
		fs.rmSync(rootLink, { force: true });
	}
}));

test('run-units: record ids, digests, declared inputs, the trace and the input expansions', { skip: process.platform === 'win32' }, () => withTempDir({
	'scripts/u.js': '', 'data/a.txt': 'A', 'data/sub/b.txt': 'B', 'data/.git/c': '', 'data/node_modules/d': '', 'package.json': '{}', 'none.txt': 'none', 'empty.txt': '', 'pkg/package.json': '{ "type": "module" }'
}, root => {
	// 記録の識別子: 英数字の部分と名前の SHA-256 の先頭。英数字が同じ名前も分かれる。
	assert.match(runUnits.recordId('一掃 tests/unit/a.test.js'), /^tests_unit_a\.test\.js-[0-9a-f]{12}$/);
	assert.notEqual(runUnits.recordId('一掃 a'), runUnits.recordId('変異 a'));
	assert.match(runUnits.recordId('一覧'), /^unit-[0-9a-f]{12}$/);
	assert.ok(runUnits.recordId('x'.repeat(200)).length <= 73);
	// SHA-256: ファイルの内容・ディレクトリの名前の一覧・ないことを区別する。
	const digests = ['none.txt', 'missing', 'data', 'data/a.txt', 'empty.txt'].map(file => runUnits.digestOf(path.join(root, file)));
	assert.equal(new Set(digests).size, 5, 'A file, an empty file, a directory and a missing path all differ');
	const before = runUnits.digestOf(path.join(root, 'data'));
	fs.writeFileSync(path.join(root, 'data/new.txt'), '');
	assert.notEqual(runUnits.digestOf(path.join(root, 'data')), before, 'A new name changes the directory digest');
	fs.rmSync(path.join(root, 'data/new.txt'));
	assert.equal(runUnits.digestOf(path.join(root, 'data')), before);
	assert.deepEqual(runUnits.walk(path.join(root, 'data'), 'data').sort(), ['data/a.txt', 'data/sub', 'data/sub/b.txt']);
	assert.deepEqual(runUnits.expand(root, ['data/a.txt', 'missing']), ['data/a.txt', 'missing']);
	// 決まった入力: 先頭のスクリプト・package.json・あれば package-lock.json・inputs・引数のうち実在するパス（コンマで区切った部分、作業ツリーの外の絶対パス）。
	const outsideFile = path.join(path.dirname(root), `spec-${process.pid}.json`);
	fs.writeFileSync(outsideFile, '[]');
	try {
		const unit = { command: ['scripts/u.js', '--spec', outsideFile, '--tests', 'data/a.txt,data/sub', 'nothing', path.join(path.dirname(root), 'no-such'), './none.txt', ''], inputs: ['data/a.txt'] };
		assert.deepEqual(runUnits.declaredInputs(unit, root).sort(), [outsideFile, 'data/a.txt', 'data/sub', 'data/sub/b.txt', 'none.txt', 'package.json', 'scripts/u.js'].sort());
		assert.deepEqual(runUnits.declaredInputs({ command: ['scripts/u.js'], inputs: ['data/sub'] }, root).sort(), ['data/sub', 'data/sub/b.txt', 'package.json', 'scripts/u.js'], 'A directory in inputs is expanded');
		fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
		assert.ok(runUnits.declaredInputs({ command: ['scripts/u.js'], inputs: [] }, root).includes('package-lock.json'));
		assert.ok(runUnits.declaredInputs({ command: ['scripts/u.js', '.'], inputs: [] }, root).includes('data/sub/b.txt'), 'The copy root as an argument is the whole copy');
		assert.ok(runUnits.makeContext(root).declared({ command: ['scripts/u.js'], inputs: [] }).includes('pkg/package.json'), 'Every package.json in the copy is a declared input (it sets the module format)');
	} finally {
		fs.rmSync(outsideFile, { force: true });
	}
	// 記録: 写しの中（実パスを含む）と、最上位のプロセスの mutate.js の写しの中だけを、写しの中の相対パスにする。記録の行はその環境の区切りで書く。
	// 一時ディレクトリがリンクを通る環境でも、記録の行は実パスで書かれる。
	const at = (...parts) => path.join(...parts);
	const real = at(fs.realpathSync(root), 'trace-real');
	fs.mkdirSync(real);
	const copy = at(root, 'u0');
	fs.symlinkSync(real, copy);
	// 単位の一時ディレクトリの実パスには、正規表現の記号（+）を含める。
	const realTmp = at(fs.realpathSync(root), 'tmp+real');
	fs.mkdirSync(realTmp);
	const tmp = `${copy}-tmp`;
	fs.symlinkSync(realTmp, tmp);
	const copied = at(tmp, 'kogai-mutate-77-AbC123');
	const traceDir = at(root, 'trace');
	fs.mkdirSync(traceDir);
	fs.writeFileSync(at(traceDir, '1.log'), [
		`read ${at(copy, 'a.txt')}`, `read ${copy}`, `list ${at(copy, 'dir')}`, `tree ${at(copy, 'tree')}`, `read ${at(real, 'b.txt')}`, `read ${at(copy, 'node_modules', 'x', 'index.js')}`, `read ${at(copy, 'sub', '.git', 'config')}`,
		`read ${at(copied, 'js', 'x.js')}`, `list ${copied}`, `read ${at(tmp, 'kogai-mutate-78-AbC123', 'js', 'y.js')}`, `read ${at(tmp, 'kogai-mutate-77-AbC123-tmp', 'z')}`,
		`read ${at(tmp, 'kogai-mutate-77-AbC1234', 'w')}`, `read ${at(tmp, 'other.txt')}`, `read ${at(`${copy}-trace`, '1.log')}`, `read ${at(`${copy}-x`, 'a')}`, `read ${path.resolve('/elsewhere/file')}`,
		`read ${at(realTmp, 'kogai-mutate-77-AbC123', 'js', 'real.js')}`, `read ${at(path.dirname(realTmp), 'tmpppreal', 'kogai-mutate-77-AbC123', 'js', 'not.js')}`, ''
	].join('\n'));
	fs.writeFileSync(at(traceDir, '2.log'), ['exec /usr/lib/chromium/chromium', 'exec git', 'node /opt/node/bin/node', 'untraced /usr/bin/node', 'whole fs.glob "x/*/../y"', `load ${at(copy, 'lib.js')}`, `copy ${at(copy, 'copied')}`, ''].join('\n'));
	const traced = runUnits.readTrace(traceDir, { copy, tmp, top: 77 });
	assert.deepEqual([...traced.keys].sort(), ['.', 'a.txt', 'b.txt', 'dir', 'js/real.js', 'js/x.js', 'lib.js'].sort(), 'The mutate.js copy is mapped by the real path of the temporary directory too, with its characters taken as they are');
	assert.deepEqual([...traced.trees].sort(), ['copied', 'tree']);
	assert.deepEqual([...traced.nodes], ['/opt/node/bin/node'], 'A Node of another path is a program to check, not one that widens the inputs');
	assert.deepEqual([...traced.programs].sort(), ['/usr/lib/chromium/chromium', 'git'].sort());
	assert.deepEqual([...traced.untraced], ['/usr/bin/node']);
	assert.deepEqual([...traced.whole], ['fs.glob "x/*/../y"'], 'A glob is kept as its pattern (not a path or a program)');
	assert.equal(traced.copier, false);
	assert.deepEqual(runUnits.readTrace(at(root, 'no-trace'), { copy, tmp, top: 1 }).keys.size, 0, 'A unit that left no record has no traced input');
	// 写しの根を写した最上位のプロセスの記録は、モジュールの読込みと untraced だけを使う。ほかのプロセスが根を写しても同じ扱いにしない。
	const copierDir = at(root, 'trace-copier');
	fs.mkdirSync(copierDir);
	fs.writeFileSync(at(copierDir, '77.log'), [`copy ${real}`, `read ${at(copy, 'all.txt')}`, `list ${at(copy, 'dir')}`, 'exec git', `load ${at(copy, 'lib.js')}`, 'untraced /usr/bin/node', ''].join('\n'));
	fs.writeFileSync(at(copierDir, '78.log'), [`copy ${copy}`, `read ${at(copy, 'child.txt')}`, ''].join('\n'));
	const copier = runUnits.readTrace(copierDir, { copy, tmp, top: 77 });
	assert.equal(copier.copier, true);
	assert.deepEqual([...copier.keys].sort(), ['child.txt', 'lib.js']);
	assert.deepEqual([...copier.trees], ['.'], 'A child that copies the root still makes the whole copy its input');
	assert.deepEqual([...copier.programs], [], 'Programs of the copier do not widen the inputs');
	assert.deepEqual([...copier.checked], ['git'], 'Programs of the copier are still checked as programs');
	assert.deepEqual([...copier.untraced], ['/usr/bin/node']);
	fs.writeFileSync(at(copierDir, '77.log'), [`copy ${at(copy, 'sub')}`, `read ${at(copy, 'all.txt')}`, ''].join('\n'));
	assert.equal(runUnits.readTrace(copierDir, { copy, tmp, top: 77 }).keys.has('all.txt'), true, 'Copying a directory below the root is not copying the root');
	fs.writeFileSync(at(copierDir, '77.log'), [`tree ${copy}`, `read ${at(copy, 'all.txt')}`, ''].join('\n'));
	assert.equal(runUnits.readTrace(copierDir, { copy, tmp, top: 77 }).copier, false, 'A recursive listing of the root is not a copy of it');
	// 写しの根の祖先と、mutate.js の写しを置く一時ディレクトリとその祖先の recursive の一覧・写しは、写しの全体とする。名前の一覧（list）は広げない。
	const aboveDir = at(root, 'trace-above');
	fs.mkdirSync(aboveDir);
	for (const [line, trees] of [[`tree ${root}`, ['.']], [`tree ${path.dirname(real)}`, ['.']], [`copy ${path.dirname(root)}`, ['.']], [`tree ${tmp}`, ['.']], [`tree ${realTmp}`, ['.']], [`list ${root}`, []], [`tree ${at(tmp, 'other')}`, []], [`tree ${at(root, 'elsewhere')}`, []]]) {
		fs.writeFileSync(at(aboveDir, '1.log'), `${line}\n`);
		const above = runUnits.readTrace(aboveDir, { copy, tmp, top: 77 });
		assert.deepEqual([...above.trees], trees, line);
		assert.equal(above.keys.size, 0, line);
	}
	// 一時ディレクトリの祖先でない、写しの根だけの祖先。
	const deepCopy = at(root, 'deep', 'u1');
	fs.mkdirSync(deepCopy, { recursive: true });
	fs.writeFileSync(at(aboveDir, '1.log'), `tree ${at(root, 'deep')}\n`);
	assert.deepEqual([...runUnits.readTrace(aboveDir, { copy: deepCopy, tmp, top: 77 }).trees], ['.'], 'An ancestor of the copy root only is the whole copy');
	// 実行の環境: 結果に効く環境変数だけ（名前の順）。
	const hash = value => crypto.createHash('sha256').update(value).digest('hex');
	assert.deepEqual(runUnits.environment({ TZ: 'a', LANG: 'b', LC_ALL: 'c', LANGUAGE: 'd', CHROMIUM_PATH: 'e', NODE_OPTIONS: 'f', NODE_V8_COVERAGE: 'x', NODE_TEST_CONTEXT: 'y', KOGAI_X: 'g', KOGAI_TRACE_DIR: 'z', KOGAI_TRACE_UNITS: 'z', PATH: 'p', HOME: 'h', XLANG: 'q', TZX: 'r' }), { CHROMIUM_PATH: hash('e'), KOGAI_X: hash('g'), LANG: hash('b'), LANGUAGE: hash('d'), LC_ALL: hash('c'), NODE_OPTIONS: hash('f'), TZ: hash('a') }, 'Only the variables that change results, by the SHA-256 of their values');
	assert.deepEqual(Object.keys(runUnits.environment({ B: '1', TZ: '1', LANG: '1' })), ['LANG', 'TZ']);
	// 起こしたプログラム: 絶対パス、名前は PATH から、区切りを含む相対パスは base から。ディレクトリは飛ばし、見つからなければ path は null。
	fs.mkdirSync(path.join(root, 'bin/tool'), { recursive: true });
	fs.mkdirSync(path.join(root, 'bin2'));
	fs.writeFileSync(path.join(root, 'bin2/tool'), 'tool');
	const identity = runUnits.programIdentity(path.join(root, 'bin2/tool'), root);
	assert.deepEqual([identity.path, identity.size, typeof identity.mtimeMs], [fs.realpathSync(path.join(root, 'bin2/tool')), 4, 'number']);
	assert.deepEqual(runUnits.programIdentity('tool', root, { PATH: [path.join(root, 'bin'), path.join(root, 'bin2')].join(path.delimiter) }), identity, 'A name is looked up in PATH, skipping directories');
	assert.deepEqual(runUnits.programIdentity('bin2/tool', root), identity);
	fs.symlinkSync(path.join(root, 'bin2/tool'), path.join(root, 'linked-tool'));
	assert.deepEqual(runUnits.programIdentity(path.join(root, 'linked-tool'), root), identity, 'A link is identified by its real path');
	assert.deepEqual(runUnits.programIdentity('tool', root, { PATH: path.join(root, 'none') }), { path: null });
	assert.deepEqual(runUnits.programIdentity('tool', root, {}), { path: null });
	// 広げる理由: ブラウザーは docs/ の外のファイル、ほかのプログラム・受け継がない Node・一覧の wholeCopy は写しの全体。
	const none = { programs: new Set(), untraced: new Set(), whole: new Set() };
	assert.deepEqual(runUnits.expansions({ wholeCopy: false }, none), { wholeCopy: null, browser: null });
	assert.deepEqual(runUnits.expansions({ wholeCopy: false }, { programs: new Set(['/opt/google/chrome/google-chrome', '/usr/bin/chromium']), untraced: new Set(), whole: new Set() }), { wholeCopy: null, browser: 'ブラウザー（/opt/google/chrome/google-chrome・/usr/bin/chromium）' });
	const whole = runUnits.expansions({ wholeCopy: true }, { programs: new Set(['git', 'chromium']), untraced: new Set(['/usr/bin/node']), whole: new Set(['fs.glob "a/*/../b"', 'fs.glob "{/c,d}/*"']) });
	assert.equal(whole.wholeCopy, '一覧の wholeCopy、記録の設定を受け継がない Node のプロセス（/usr/bin/node）、走査の範囲を記録しない glob（fs.glob "a/*/../b"・fs.glob "{/c,d}/*"）、Node 以外のプログラム（git）');
	assert.equal(whole.browser, 'ブラウザー（chromium）');
	assert.match(runUnits.expansions({ wholeCopy: false }, { programs: new Set(['sh']), untraced: new Set(), whole: new Set() }).wholeCopy, /Node 以外のプログラム（sh）/);
	assert.deepEqual(runUnits.expansions({ wholeCopy: false }, { programs: new Set(['/opt/chromium/bin/git']), untraced: new Set(), whole: new Set() }), { wholeCopy: 'Node 以外のプログラム（/opt/chromium/bin/git）', browser: null }, 'The browser is told by the program name, not its directory');
	assert.match(runUnits.expansions({ wholeCopy: false }, { programs: new Set(), untraced: new Set(['node']), whole: new Set() }).wholeCopy, /受け継がない/);
	assert.equal(runUnits.expansions({ wholeCopy: false }, { programs: new Set(), untraced: new Set(), whole: new Set(['fs.glob "a/{..,b}/*"']) }).wholeCopy, '走査の範囲を記録しない glob（fs.glob "a/{..,b}/*"）');
	assert.deepEqual(runUnits.differences({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' }), ['b', 'c']);
	assert.deepEqual(runUnits.differences({ a: '1' }, {}), ['a']);
}));

test('run-units: a record is reused only when it passed, runs the same way, and no recorded or current input changed', { skip: process.platform === 'win32' }, () => withTempDir({
	'scripts/u.js': '', 'js/app.js': 'A', 'tests/a.test.js': 'T', 'docs/spec.md': 'S', 'data/x.txt': 'X', 'bin/tool': 'tool'
}, root => {
	const context = runUnits.makeContext(root);
	assert.deepEqual(context.files, ['bin/tool', 'data/x.txt', 'docs/spec.md', 'js/app.js', 'scripts/u.js', 'tests/a.test.js']);
	{
		// 写しのファイルの一覧とディレクトリの SHA-256 は名前の順で、readdir の返す順によらない（写しを作り直しても同じ値）。
		const rootDigest = runUnits.digestOf(root);
		const readdirSync = fs.readdirSync;
		fs.readdirSync = function (...args) {
			const names = readdirSync.apply(this, args);
			return Array.isArray(names) ? [...names].reverse() : names;
		};
		try {
			assert.deepEqual(runUnits.makeContext(root).files, context.files, 'The files are sorted whatever order readdir gives');
			assert.equal(runUnits.digestOf(root), rootDigest, 'A directory digest does not depend on the order readdir gives');
		} finally {
			fs.readdirSync = readdirSync;
		}
	}
	const tool = path.join(root, 'bin/tool');
	const unit = { name: 'u', command: ['scripts/u.js'], inputs: [], wholeCopy: false };
	const inputs = Object.fromEntries(['scripts/u.js', 'package.json', 'js/app.js'].map(key => [key, context.digest(key)]));
	const previous = { format: runUnits.FORMAT, passed: true, command: unit.command, node: process.version, runner: 'R', environment: runUnits.environment(), programs: { [tool]: runUnits.programIdentity(tool, root) }, inputs, expanded: { wholeCopy: null, browser: null }, finished: 'T' };
	const decide = (changes = {}, current = unit, runner = 'R') => runUnits.reuseDecision({ ...previous, ...changes }, current, context, runner);
	assert.deepEqual(decide(), { reuse: true, reason: '合格 T' });
	assert.deepEqual(runUnits.reuseDecision(null, unit, context, 'R'), { reuse: false, reason: '記録なし' });
	for (const changes of [{ format: runUnits.FORMAT + 1 }, { inputs: null }, { inputs: 'x' }, { programs: undefined }, { programs: 'x' }]) {
		assert.deepEqual(decide(changes), { reuse: false, reason: '記録の形式が違う' }, JSON.stringify(changes));
	}
	assert.equal(decide({ environment: { ...runUnits.environment(), TZ: 'Other/Zone' } }).reason, '実行のしかたが変わった（実行の環境）');
	assert.equal(decide({ programs: { [tool]: { path: null } } }).reason, `実行のしかたが変わった（起こしたプログラム（${tool}））`);
	assert.equal(decide({ passed: false }).reason, '前の結果が不合格');
	assert.equal(decide({ passed: 'yes' }).reason, '前の結果が不合格');
	assert.equal(decide({}, { ...unit, command: ['scripts/u.js', 'x'] }).reason, '実行のしかたが変わった（コマンド）');
	assert.equal(decide({ node: 'v0.0.0' }).reason, '実行のしかたが変わった（Node.js の版）');
	assert.equal(decide({}, unit, 'other').reason, '実行のしかたが変わった（実行の仕組み）');
	assert.equal(decide({ node: 'v0.0.0' }, unit, 'other').reason, '実行のしかたが変わった（Node.js の版・実行の仕組み）');
	assert.equal(decide({ inputs: { ...inputs, 'js/app.js': 'old' } }).reason, '入力が変わった（js/app.js）');
	assert.equal(decide({ inputs: { ...inputs, 'gone.txt': 'old' } }).reason, '入力が変わった（gone.txt）', 'A recorded input that no longer exists has changed');
	assert.equal(decide({ inputs: { 'scripts/u.js': inputs['scripts/u.js'] } }).reason, '記録の入力にない今の入力（package.json）');
	assert.equal(decide({}, { ...unit, inputs: ['data/x.txt'] }).reason, '記録の入力にない今の入力（data/x.txt）');
	assert.equal(decide({}, { ...unit, wholeCopy: true }).reason, '記録の入力にない今の入力（.・bin・bin/tool・data・data/x.txt ほか6件）', 'The whole copy includes its directories');
	assert.equal(decide({ expanded: { wholeCopy: 'git', browser: null } }).reason, '記録の入力にない今の入力（.・bin・bin/tool・data・data/x.txt ほか6件）', 'A record expanded to the whole copy needs every current file and directory');
	assert.equal(decide({ expanded: { wholeCopy: null, browser: 'chromium' } }).reason, '記録の入力にない今の入力（bin/tool・data/x.txt・tests/a.test.js）', 'A record expanded for a browser needs every current file outside docs/');
	const all = Object.fromEntries(context.everything().map(key => [key, context.digest(key)]));
	assert.equal(decide({ inputs: { ...inputs, ...all }, expanded: { wholeCopy: 'git', browser: null } }).reuse, true);
	const filesOnly = Object.fromEntries(context.files.map(key => [key, context.digest(key)]));
	assert.equal(decide({ inputs: { ...inputs, ...filesOnly }, expanded: { wholeCopy: 'git', browser: null } }).reason, '記録の入力にない今の入力（.・bin・data・docs・js ほか2件）', 'Files without the directories are not the whole copy');
	assert.equal(decide({ inputs: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`x${index}`, 'old']).concat(Object.entries(inputs))) }).reason, '入力が変わった（x0・x1・x2・x3・x4 ほか2件）');
	assert.equal(decide({ inputs: Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`x${index}`, 'old']).concat(Object.entries(inputs))) }).reason, '入力が変わった（x0・x1・x2・x3・x4）', 'Five are listed without the rest');
	fs.appendFileSync(tool, ' changed');
	assert.equal(decide().reason, `実行のしかたが変わった（起こしたプログラム（${tool}））`, 'A program that changed (size or time) is not the same way of running');
	{
		// 写しの中のシンボリックリンク（単位が作ったものなど）も写しのファイルの一覧に入り、その SHA-256 は向き先で変わる（向き先の中身が同じでも）。
		fs.writeFileSync(path.join(root, 'data/y.txt'), 'X');
		fs.symlinkSync('x.txt', path.join(root, 'data/link'));
		const linked = runUnits.makeContext(root);
		assert.ok(linked.files.includes('data/link'), 'A link is a file of the copy');
		const pointed = linked.digest('data/link');
		fs.rmSync(path.join(root, 'data/link'));
		fs.symlinkSync('y.txt', path.join(root, 'data/link'));
		assert.notEqual(runUnits.makeContext(root).digest('data/link'), pointed, 'Another target is another input');
		assert.notEqual(runUnits.copyHashes(root)['data/link'], linked.hashes['data/link']);
	}
	// 写しの中のパスの SHA-256 は覚える（写しは実行の間に変わらない）。作業ツリーの外の絶対パスは毎回求める。
	const first = context.digest('data/x.txt');
	fs.writeFileSync(path.join(root, 'data/x.txt'), 'changed');
	assert.equal(context.digest('data/x.txt'), first);
	const outsideFile = path.join(path.dirname(root), `outside-${process.pid}.txt`);
	try {
		fs.writeFileSync(outsideFile, '1');
		const outsideBefore = context.digest(outsideFile);
		fs.writeFileSync(outsideFile, '2');
		assert.notEqual(context.digest(outsideFile), outsideBefore);
	} finally {
		fs.rmSync(outsideFile, { force: true });
	}
	assert.equal(runUnits.readRecord(path.join(root, 'missing.json')), null);
	fs.writeFileSync(path.join(root, 'broken.json'), '{');
	assert.equal(runUnits.readRecord(path.join(root, 'broken.json')), null);
}));

// Windows のファイル名に使えない " を含む試料を作るので、Windows では除く。
test('run-units: the result rows, the NODE_OPTIONS quoting and the runner digest', { skip: process.platform === 'win32' }, () => withTempDir({ 'a b"c\\d.js': "console.log('loaded');\n" }, dir => {
	const base = { name: 'a|b', digest: 'f'.repeat(64), inputs: { x: '1', y: '2' }, output: '/r/o.out', ms: 2400, finished: 'T', status: 0, signal: null, problems: [], passed: true, expanded: { wholeCopy: null, browser: null } };
	assert.equal(runUnits.row({ name: 'a|b' }, base, false), `| a\\|b | ${'f'.repeat(12)}（2件） | 合格（2秒） | /r/o.out |`);
	assert.equal(runUnits.row({ name: 'a' }, base, true), `| a | ${'f'.repeat(12)}（2件） | 再利用（合格 T） | /r/o.out |`);
	assert.match(runUnits.row({ name: 'a' }, { ...base, passed: false, status: 3 }, false), /不合格（終了コード 3）/);
	assert.match(runUnits.row({ name: 'a' }, { ...base, passed: false, status: null, signal: 'SIGKILL' }, false), /不合格（信号 SIGKILL）/);
	assert.match(runUnits.row({ name: 'a' }, { ...base, passed: false, problems: ['写しのファイルを変えた（x）'] }, false), /不合格（写しのファイルを変えた（x））/);
	assert.match(runUnits.row({ name: 'a' }, { ...base, passed: false, status: null }, false), /不合格（終了コードなし）/);
	assert.match(runUnits.row({ name: 'a' }, { ...base, expanded: { wholeCopy: 'git', browser: 'chromium' } }, false), /（2件。写しの全体・docs\/ の外のファイルを含む）/);
	assert.match(runUnits.row({ name: 'a' }, { ...base, expanded: { wholeCopy: null, browser: 'chromium' } }, false), /（2件。docs\/ の外のファイルを含む）/);
	// 空白・引用符・逆斜線を含むパスも、NODE_OPTIONS の --require で読み込まれる。
	const file = path.join(dir, 'a b"c\\d.js');
	const { NODE_TEST_CONTEXT, ...rest } = process.env;
	const loaded = spawnSync(process.execPath, ['-e', '0'], { encoding: 'utf8', env: { ...rest, NODE_V8_COVERAGE: undefined, NODE_OPTIONS: `--require ${runUnits.quoteOption(file)}` } });
	assert.equal(loaded.stdout.trim(), 'loaded', loaded.stderr);
	assert.equal(runUnits.quoteOption('a\\"b'), '"a\\\\\\"b"');
	// 実行の仕組みの SHA-256: 置き場所によらず、単位に読み込ませる trace-reads.js（写し）・run-units.js・読み込む tests/scripts のファイルの内容で決まる。
	const copied = path.join(dir, 'scripts');
	fs.cpSync(path.dirname(SCRIPT), copied, { recursive: true });
	const other = require(path.join(copied, 'run-units.js'));
	assert.equal(other.runnerDigest(), runUnits.runnerDigest());
	const traceCopy = path.join(dir, 'trace-copy.js');
	fs.copyFileSync(runUnits.TRACE, traceCopy);
	assert.equal(runUnits.runnerDigest(traceCopy), runUnits.runnerDigest(), 'The digest uses the trace-reads.js given (the copy the units load)');
	fs.appendFileSync(traceCopy, '\n');
	assert.notEqual(runUnits.runnerDigest(traceCopy), runUnits.runnerDigest());
	for (const file of ['trace-reads.js', 'mutate.js', 'lib/js-lexer.js', 'run-units.js']) {
		const full = path.join(copied, file);
		const text = fs.readFileSync(full, 'utf8');
		fs.writeFileSync(full, `${text}\n`);
		assert.notEqual(other.runnerDigest(), runUnits.runnerDigest(), `${file} is part of the runner`);
		fs.writeFileSync(full, text);
	}
	fs.writeFileSync(path.join(copied, 'check-docs.js'), '// changed\n');
	assert.equal(other.runnerDigest(), runUnits.runnerDigest(), 'A script the runner does not load is not part of it');
	for (const key of Object.keys(require.cache)) if (key.startsWith(copied)) delete require.cache[key];
}));

test('run-units: a run records what each unit reads, reuses passed units, and reruns failed units and units whose inputs changed', { skip: process.platform === 'win32' }, () => withFixture(async ({ dir, repo, records, main, record }) => {
	const units = [{ name: 'info', command: ['scripts/unit.js', 'info'] }, { name: 'fails', command: ['scripts/fail.js'] }];
	const first = await main(units);
	assert.equal(first.code, 1, first.text);
	assert.match(first.text, /\| info \| [0-9a-f]{12}（\d+件） \| 合格（\d+秒） \|/);
	assert.match(first.text, /\| fails \| [0-9a-f]{12}（\d+件） \| 不合格（終了コード 3） \|/);
	assert.match(first.text, /run-units: 2単位（実行 2・再利用 0・不合格 1）/);
	const info = record('info');
	assert.equal(info.passed, true);
	assert.deepEqual([info.status, info.signal, info.node, info.format, info.command], [0, null, process.version, runUnits.FORMAT, ['scripts/unit.js', 'info']]);
	for (const key of ['package.json', 'scripts/unit.js', 'lib/top.js', 'data/top.txt', 'scripts/child.js', 'lib/value.js', 'data/value.txt']) assert.ok(Object.hasOwn(info.inputs, key), `${key} is an input (reads of the top-level process and of its child)`);
	for (const key of ['data/other.txt', 'tests/unit/x.test.js', 'docs/spec.md']) assert.ok(!Object.hasOwn(info.inputs, key), `${key} is not an input`);
	assert.deepEqual([info.expanded, info.copier, info.programs], [{ wholeCopy: null, browser: null }, false, {}]);
	assert.deepEqual(info.environment, runUnits.environment());
	assert.deepEqual(fs.readdirSync(records).filter(name => name.startsWith('.')), [runUnits.MARKER], 'The record place is marked');
	assert.equal(fs.statSync(records).mode & 0o777, 0o700, 'The record place is private');
	for (const name of fs.readdirSync(records)) assert.equal(fs.statSync(path.join(records, name)).mode & 0o777, 0o600, `${name} is private`);
	assert.equal(info.inputs['data/value.txt'], runUnits.digestOf(path.join(repo, 'data/value.txt')));
	assert.equal(info.digest.length, 64);
	assert.ok(fs.readFileSync(info.output, 'utf8').includes('"reviews":false'), 'The output holds the unit output');
	assert.equal(record('fails').passed, false);
	assert.equal(record('fails').status, 3);
	const summary = fs.readFileSync(path.join(records, 'summary.md'), 'utf8');
	assert.match(summary, /^\| 単位 \| 入力の SHA-256（件数） \| 結果 \| 出力 \|\n\| :--- \| :--- \| :--- \| :--- \|\n\| info \|.*\n\| fails \|.*\n$/);
	assert.ok(!fs.existsSync(path.join(records, 'run-units.lock')), 'The lock is released');
	assert.deepEqual(leftCopies(), [], 'The frozen copies are removed');
	const list = async () => (await main(units, '--list')).text;
	assert.match(await list(), /\| info \| 記録を使う（合格 .*） \|\n\| fails \| 実行する（前の結果が不合格） \|/);
	fs.writeFileSync(path.join(repo, 'data/other.txt'), 'changed');
	assert.match(await list(), /\| info \| 記録を使う/, 'Files the unit did not read do not matter');
	const savedZone = process.env.TZ;
	process.env.TZ = savedZone === 'Pacific/Apia' ? 'Asia/Tokyo' : 'Pacific/Apia';
	try {
		assert.match(await list(), /\| info \| 実行する（実行のしかたが変わった（実行の環境）） \|/, 'Another TZ is another way of running');
	} finally {
		if (savedZone === undefined) delete process.env.TZ;
		else process.env.TZ = savedZone;
	}
	const second = await main(units);
	assert.equal(second.code, 1);
	assert.match(second.text, /\| info \| .* \| 再利用（合格 .*） \|/);
	assert.match(second.text, /run-units: 2単位（実行 1・再利用 1・不合格 1）/);
	fs.writeFileSync(path.join(repo, 'data/value.txt'), 'ok\n\n');
	assert.match(await list(), /\| info \| 実行する（入力が変わった（data\/value\.txt）） \|/);
	const third = await main(units, '--only', '^info$');
	assert.equal(third.code, 0, third.text);
	const rerun = record('info');
	assert.notEqual(rerun.digest, info.digest, 'The digest of the inputs changes with their contents');
	assert.match(third.text, new RegExp(`\\| info \\| ${rerun.digest.slice(0, 12)}（`), 'The table shows the digest of the record');
	assert.match(third.text, /\| info \| .* \| 合格（\d+秒） \|/);
	assert.doesNotMatch(third.text, /fails/, '--only leaves the other units alone');
	fs.writeFileSync(path.join(repo, 'data/top.txt'), 'changed');
	assert.match(await list(), /\| info \| 実行する（入力が変わった（data\/top\.txt）） \|/, 'A read of the top-level process is an input');
	assert.equal((await main(units, '--only', '^info$')).code, 0);
	assert.match((await main([{ ...units[0], inputs: ['data/other.txt'] }], '--list')).text, /実行する（記録の入力にない今の入力（data\/other\.txt））/);
	assert.match((await main([{ ...units[0], command: ['scripts/unit.js', 'info', 'x'] }], '--list')).text, /実行する（実行のしかたが変わった（コマンド））/);
	fs.writeFileSync(path.join(repo, 'docs/reviews/r2.md'), 'new review');
	fs.writeFileSync(path.join(repo, 'docs/review_backlog.md'), 'changed');
	assert.match((await main([{ ...units[0], wholeCopy: true }, { name: 'whole', command: ['scripts/unit.js', 'info'], wholeCopy: true }])).text, /\| whole \| [0-9a-f]{12}（\d+件。写しの全体を含む） \| 合格/);
	const whole = record('whole');
	assert.ok(!Object.keys(whole.inputs).some(key => key === 'node_modules' || key.startsWith('node_modules/')), 'The node_modules linked into the copy is not an input');
	assert.ok(Object.hasOwn(whole.inputs, 'tests/unit/x.test.js') && Object.hasOwn(whole.inputs, 'docs/spec.md'), 'wholeCopy makes every file of the copy an input');
	assert.ok(!Object.keys(whole.inputs).some(key => key.startsWith('docs/reviews/')), 'The review records are not in the copy');
	assert.ok(Object.hasOwn(whole.inputs, 'docs/reviews-index.md') && Object.hasOwn(whole.inputs, 'docs/review_backlog.md.bak'), 'Names that only begin like the review records are copied');
	assert.equal(whole.inputs['docs/review_backlog.md'], runUnits.digestOf(path.join(repo, 'no-such')), 'The backlog is not in the copy (the unit only saw that it does not exist)');
	fs.writeFileSync(path.join(repo, 'docs/reviews/r3.md'), 'another review');
	assert.match((await main([{ name: 'whole', command: ['scripts/unit.js', 'info'], wholeCopy: true }], '--list')).text, /記録を使う/, 'A new review record does not change a whole-copy unit');
	assert.ok(Object.hasOwn(whole.inputs, '.') && Object.hasOwn(whole.inputs, 'data'), 'The whole copy includes its directories (their name lists)');
	fs.mkdirSync(path.join(repo, 'data/empty'));
	assert.match((await main([{ name: 'whole', command: ['scripts/unit.js', 'info'], wholeCopy: true }], '--list')).text, /\| whole \| 実行する（記録の入力にない今の入力（data\/empty）） \|/, 'A new empty directory changes a whole-copy unit');
	fs.rmdirSync(path.join(repo, 'data/empty'));
	assert.equal((await main([{ name: 'x', command: ['scripts/unit.js'] }], '--only', 'nothing')).code, 2, 'No unit matching --only is an argument error');
	assert.equal((await quietAsync(() => runUnits.main(['--root', path.join(repo, 'missing'), '--units', path.join(repo, 'package.json'), '--records', records]))), 2);
	assert.equal((await quietAsync(() => runUnits.main(['--units', 'u']))), 2);
	fs.writeFileSync(path.join(path.dirname(records), 'records-file'), '');
	assert.equal((await quietAsync(() => runUnits.main(['--root', repo, '--units', path.join(path.dirname(records), 'units.json'), '--records', path.join(path.dirname(records), 'records-file')]))), 2, 'Records that cannot be made are an argument error');
	const other = path.join(path.dirname(records), 'other');
	fs.mkdirSync(other);
	fs.writeFileSync(path.join(other, 'summary.md'), 'kept');
	for (const args of [[], ['--list']]) assert.equal((await quietAsync(() => runUnits.main(['--root', repo, '--units', path.join(path.dirname(records), 'units.json'), '--records', other, ...args]))), 2, `A directory that is not a record place is an argument error ${args}`);
	assert.deepEqual(fs.readdirSync(other), ['summary.md']);
	assert.equal(fs.readFileSync(path.join(other, 'summary.md'), 'utf8'), 'kept', 'Its files are not overwritten');
	// コマンドとして起こしたときの終了コード: 合格 0、不合格 1、引数の誤り 2。
	const { NODE_TEST_CONTEXT, ...rest } = process.env;
	const cli = (list, ...args) => {
		fs.writeFileSync(path.join(dir, 'cli.json'), JSON.stringify(list));
		return spawnSync(process.execPath, [SCRIPT, '--root', repo, '--units', path.join(dir, 'cli.json'), '--records', records, ...args], { env: { ...rest, NODE_V8_COVERAGE: undefined }, stdio: 'ignore' }).status;
	};
	assert.deepEqual([cli([units[0]]), cli([units[1]]), cli([units[0]], '--jobs', '0')], [0, 1, 2]);
}));

test('run-units: each unit runs in its own frozen copy without the review records, coverage settings or the parent temporary files, and changing the copy or an outside input fails', { skip: process.platform === 'win32' }, () => withFixture(async ({ dir, repo, main, record }) => {
	const outsideFile = path.join(dir, 'outside.txt');
	fs.writeFileSync(outsideFile, 'before');
	const hung = path.join(dir, 'hung.jsonl');
	const saved = { coverage: process.env.NODE_V8_COVERAGE, context: process.env.NODE_TEST_CONTEXT, hang: process.env.KOGAI_HANG_RECORD, options: process.env.NODE_OPTIONS, token: process.env.NODE_AUTH_TOKEN, pwd: process.env.PWD, oldpwd: process.env.OLDPWD, init: process.env.INIT_CWD, json: process.env.npm_package_json, prefix: process.env.npm_config_local_prefix };
	// 作業ツリーを指すパスの変数（npm から起こしたとき、シェルの前の作業ディレクトリ）。
	for (const name of ['PWD', 'OLDPWD', 'INIT_CWD', 'npm_config_local_prefix']) process.env[name] = repo;
	process.env.npm_package_json = path.join(repo, 'package.json');
	process.env.NODE_OPTIONS = [saved.options, '--no-deprecation'].filter(Boolean).join(' ');
	process.env.NODE_AUTH_TOKEN = 'kogai-secret-token';
	process.env.NODE_V8_COVERAGE = path.join(dir, 'coverage');
	process.env.NODE_TEST_CONTEXT = saved.context ?? 'child-v8';
	process.env.KOGAI_HANG_RECORD = hung;
	try {
		// 別のプロセスグループへ出た孫（detached）を止めるのは /proc で探すとき。
		const list = [
			{ name: 'info', command: ['scripts/unit.js', 'info'] },
			{ name: 'write', command: ['scripts/unit.js', 'write'] },
			{ name: 'outside', command: ['scripts/unit.js', 'outside', outsideFile] },
			{ name: 'grandchild', command: ['scripts/unit.js', 'grandchild'] },
			...(PROC ? [{ name: 'detached', command: ['scripts/unit.js', 'detached'] }] : []),
			{ name: 'options', command: ['scripts/unit.js', 'options'] },
			{ name: 'siblings', command: ['scripts/unit.js', 'siblings'] },
			{ name: 'remove-tmp', command: ['scripts/unit.js', 'remove-tmp'] },
			{ name: 'link', command: ['scripts/unit.js', 'link'] }
		];
		const result = await main(list);
		assert.equal(result.code, 1, result.text);
		assert.equal(record('remove-tmp').passed, true, 'A unit that removes its temporary directory is still cleaned up and recorded');
		const info = JSON.parse(fs.readFileSync(record('info').output, 'utf8').trim());
		// 一時ディレクトリがリンクを通る環境では、process.cwd() は実パスになる。
		const inCopies = file => [os.tmpdir(), fs.realpathSync(os.tmpdir())].some(base => file.startsWith(path.join(base, `kogai-units-${process.pid}-`)));
		assert.ok(inCopies(info.cwd), `The unit runs in the frozen copy: ${info.cwd}`);
		assert.deepEqual(info.vars, [info.tmp, info.tmp], 'TMP and TEMP are the temporary directory of the unit too');
		assert.ok(inCopies(info.pwd) && path.basename(info.pwd) === path.basename(info.cwd), `PWD is the copy of the unit: ${info.pwd}`);
		assert.deepEqual(info.paths, [null, null, null, null], 'Variables with paths into the working tree do not reach the unit');
		assert.match(record('link').problems.join(), /写しのファイルを変えた（data\/made-link）/, 'A link the unit made in its copy is a change of the copy');
		assert.deepEqual([info.reviews, info.backlog, info.coverage, info.context], [false, false, null, null], 'The review records and the coverage and test-runner settings do not reach the unit');
		assert.deepEqual([info.git, info.nested, info.dep], [false, false, 'dep'], '.git and nested node_modules are not copied, and the top-level node_modules is linked');
		assert.ok(inCopies(info.tmp) && info.tmp.endsWith('-tmp'), `The unit has its own temporary directory: ${info.tmp}`);
		assert.ok(!fs.existsSync(info.tmp) && !fs.existsSync(info.cwd), 'The copy and the temporary directory are removed');
		assert.deepEqual(leftCopies(), []);
		assert.match(record('write').problems.join(), /写しのファイルを変えた（data\/new\.txt）/);
		assert.equal(record('write').passed, false);
		assert.ok(!fs.existsSync(path.join(repo, 'data/new.txt')), 'The working tree is not changed');
		const outside = record('outside');
		assert.match(outside.problems.join(), /作業ツリーの外の入力が実行の間に変わった（.*outside\.txt）/);
		assert.equal(outside.passed, false);
		fs.writeFileSync(path.join(dir, 'before.txt'), 'before');
		assert.equal(outside.inputs[outsideFile], runUnits.digestOf(path.join(dir, 'before.txt')), 'The outside input is recorded as it was before the run');
		assert.match(result.text, /\| write \| .* \| 不合格（写しのファイルを変えた（data\/new\.txt）） \|/);
		assert.equal(record('grandchild').passed, true);
		if (PROC) assert.equal(record('detached').passed, true);
		assert.ok(!fs.readFileSync(path.join(path.dirname(record('info').output), `${runUnits.recordId('info')}.json`), 'utf8').includes('kogai-secret-token'), 'The value of a secret variable is not written');
		assert.equal(record('info').environment.NODE_AUTH_TOKEN, crypto.createHash('sha256').update('kogai-secret-token').digest('hex'));
		assert.deepEqual(JSON.parse(fs.readFileSync(record('siblings').output, 'utf8').trim()), ['trace-reads.js', 'tree', ...['', '-tmp', '-trace'].map(end => `u${list.findIndex(unit => unit.name === 'siblings')}${end}`)], 'The copies of the units that finished are already removed');
		const options = fs.readFileSync(record('options').output, 'utf8').trim();
		assert.ok(options.startsWith('--require "') && inCopies(options.slice('--require "'.length)) && /^--require "[^"]*kogai-units-\d+-[^/]+\/trace-reads\.js" /.test(options), `The units load the copy of trace-reads.js first: ${options}`);
		assert.ok(options.endsWith(' --no-deprecation'), 'The parent NODE_OPTIONS follows the tracer');
		const pids = fs.readFileSync(hung, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid);
		assert.equal(pids.length, PROC ? 2 : 1);
		assert.deepEqual(await waitStopped(pids), [], 'Processes the unit left behind, in its process group without the trace settings or detached into another with only KOGAI_TRACE_DIR, are stopped');
	} finally {
		cleanupHung(hung);
		for (const [name, value] of [['NODE_V8_COVERAGE', saved.coverage], ['NODE_TEST_CONTEXT', saved.context], ['KOGAI_HANG_RECORD', saved.hang], ['NODE_OPTIONS', saved.options], ['NODE_AUTH_TOKEN', saved.token], ['PWD', saved.pwd], ['OLDPWD', saved.oldpwd], ['INIT_CWD', saved.init], ['npm_package_json', saved.json], ['npm_config_local_prefix', saved.prefix]]) {
			if (value === undefined) delete process.env[name];
			else process.env[name] = value;
		}
	}
}));

test('run-units: a browser adds the files outside docs/, other programs and untraced Node processes make the whole copy the input, a top-level process that copies the root adds no reads, and only its mutate.js copy is mapped', { skip: process.platform === 'win32' }, () => withFixture(async ({ dir, main, record }) => {
	const chromium = path.join(dir, 'bin', 'chromium');
	fs.mkdirSync(path.dirname(chromium));
	fs.writeFileSync(chromium, '#!/bin/sh\nexit 0\n');
	fs.chmodSync(chromium, 0o755);
	const nodeLink = path.join(dir, 'node-bin', 'node');
	fs.mkdirSync(path.dirname(nodeLink));
	fs.symlinkSync(process.execPath, nodeLink);
	const result = await main([
		{ name: 'browser', command: ['scripts/unit.js', 'browser', chromium] },
		{ name: 'node-link', command: ['scripts/unit.js', 'node-link', nodeLink] },
		{ name: 'program', command: ['scripts/unit.js', 'program'] },
		{ name: 'untraced', command: ['scripts/unit.js', 'untraced'] },
		{ name: 'glob-up', command: ['scripts/unit.js', 'glob-up'] },
		{ name: 'above', command: ['scripts/unit.js', 'above'] },
		{ name: 'mutate-copy', command: ['scripts/unit.js', 'mutate-copy'] },
		{ name: 'tree', command: ['scripts/unit.js', 'tree'] },
		{ name: 'copier', command: ['scripts/unit.js', 'copier'] },
		{ name: 'esm', command: ['scripts/unit.js', 'esm'] }
	], '--jobs', '2');
	assert.equal(result.code, 0, result.text);
	const browser = record('browser');
	assert.match(browser.expanded.browser, /chromium/);
	assert.equal(browser.expanded.wholeCopy, null);
	for (const key of ['data/other.txt', 'data/top.txt', 'lib/top.js', 'package.json', 'tests/unit/x.test.js', chromium]) assert.ok(Object.hasOwn(browser.inputs, key), `${key} is an input of a browser unit`);
	assert.ok(!Object.hasOwn(browser.inputs, 'docs/spec.md'), 'docs/ is not read by the browser');
	assert.ok(Object.hasOwn(browser.inputs, 'docsx/page.html'), 'A directory that only begins like docs/ is read by the browser');
	assert.ok(!Object.keys(browser.inputs).some(key => key === 'node_modules' || key.startsWith('node_modules/')), 'The node_modules linked into the copy is not a browser input');
	assert.match(result.text, /\| browser \| [0-9a-f]{12}（\d+件。docs\/ の外のファイルを含む） \|/);
	assert.deepEqual(Object.keys(browser.programs), [chromium]);
	assert.equal(browser.programs[chromium].path, fs.realpathSync(chromium));
	for (const [name, reason] of [['program', /Node 以外のプログラム（sh）/], ['untraced', /記録の設定を受け継がない Node のプロセス/]]) {
		const entry = record(name);
		assert.match(entry.expanded.wholeCopy, reason);
		assert.ok(Object.keys(entry.programs).length === 1, `${name} records the program it started`);
		for (const key of ['tests/unit/x.test.js', 'docs/spec.md', 'data/other.txt']) assert.ok(Object.hasOwn(entry.inputs, key), `${key} is an input of ${name}`);
	}
	const globbed = record('glob-up');
	assert.match(globbed.expanded.wholeCopy, /走査の範囲を記録しない glob（fs\.glob "lib\/\*\/\.\.\/\*\.js"）/);
	assert.deepEqual(globbed.programs, {}, 'A glob is not a program');
	for (const key of ['tests/unit/x.test.js', 'docs/spec.md', 'data/other.txt']) assert.ok(Object.hasOwn(globbed.inputs, key), `${key} is an input of glob-up`);
	for (const key of ['tests/unit/x.test.js', 'docs/spec.md', 'data/other.txt']) assert.ok(Object.hasOwn(record('above').inputs, key), `${key} is an input of a unit that lists above its copy`);
	const linked = record('node-link');
	assert.deepEqual(Object.keys(linked.programs), [nodeLink], 'Node started by another path is recorded as a program');
	assert.equal(linked.programs[nodeLink].path, fs.realpathSync(process.execPath));
	assert.deepEqual(linked.expanded, { wholeCopy: null, browser: null }, 'Node that keeps the trace settings does not widen the inputs');
	const mapped = record('mutate-copy');
	assert.ok(Object.hasOwn(mapped.inputs, 'data/mapped.txt'), 'A read in the top-level mutate.js copy is an input with the path in the copy');
	assert.ok(!Object.keys(mapped.inputs).some(key => key.includes('other-pid') || key.includes('plain')), 'Reads in other copies and temporary files are not inputs');
	assert.deepEqual(mapped.expanded, { wholeCopy: null, browser: null });
	assert.ok(Object.hasOwn(record('tree').inputs, 'data/other.txt'), 'A copied directory makes every file under it an input');
	assert.ok(!Object.hasOwn(record('tree').inputs, 'docs/spec.md'));
	const copier = record('copier');
	assert.equal(copier.copier, true);
	assert.deepEqual(copier.expanded, { wholeCopy: null, browser: null }, 'The program the copier started and its glob are not counted');
	assert.ok(!Object.hasOwn(copier.inputs, 'data/top.txt') && !Object.hasOwn(copier.inputs, 'data/other.txt'), 'Reads of a top-level process that copied the root are not inputs');
	assert.ok(Object.hasOwn(copier.inputs, 'lib/top.js') && Object.hasOwn(copier.inputs, 'data/value.txt'), 'Its module loads and its child reads are inputs');
	assert.ok(Object.hasOwn(record('esm').inputs, 'lib/esm.mjs'), 'An ESM import is an input');
	// 起こしたプログラムが変われば実行し直す。
	fs.appendFileSync(chromium, '# updated\n');
	assert.match((await main([{ name: 'browser', command: ['scripts/unit.js', 'browser', chromium] }], '--list')).text, /実行する（実行のしかたが変わった（起こしたプログラム（.*chromium））） \|/);
}));

test('run-units: any symbolic link in the copied working tree, also one made while copying, stops the run and leaves no copy, and links under what is not copied are fine', { skip: process.platform === 'win32' }, () => withFixture(async ({ dir, repo, main, record }) => {
	const units = [{ name: 'info', command: ['scripts/unit.js', 'info'] }];
	// 向き先によらない（木の中・木の外・絶対パス・向き先がない・ディレクトリ・自分自身）。写しの中のリンクは写しの外を読みうる。
	fs.mkdirSync(path.join(repo, 'data/a'));
	for (const [name, target] of [['data/inside', 'value.txt'], ['data/up-inside', '../lib/top.js'], ['data/absolute', path.join(repo, 'data/value.txt')], ['data/up', '../../outside.txt'], ['data/later', 'not-yet.txt'], ['data/a/dir', '..'], ['lib/loop', 'loop'], ['top', 'data']]) {
		fs.symlinkSync(target, path.join(repo, name));
		const result = await main(units);
		assert.equal(result.code, 2, name);
		assert.match(result.text, new RegExp(`作業ツリーの中にシンボリックリンクがある.*: ${name}$`, 'm'), name);
		assert.deepEqual(leftCopies(), [], 'No copy is left');
		fs.rmSync(path.join(repo, name));
	}
	// いくつもあれば名前の順に挙げる（ディレクトリのリンクの下はたどらない）。
	fs.symlinkSync('..', path.join(repo, 'data/a/dir'));
	fs.symlinkSync('value.txt', path.join(repo, 'data/inside'));
	fs.symlinkSync('data', path.join(repo, 'top'));
	assert.deepEqual(runUnits.linksIn(repo), ['data/a/dir', 'data/inside', 'top']);
	const repoLink = path.join(dir, 'repo-link');
	fs.symlinkSync(repo, repoLink);
	assert.deepEqual(runUnits.linksIn(repoLink), ['data/a/dir', 'data/inside', 'top'], 'A tree given through a link is read the same');
	// 名前の順に並べる（readdir の返す順によらない）。
	const readdirSync = fs.readdirSync;
	fs.readdirSync = function (...args) {
		const names = readdirSync.apply(this, args);
		return Array.isArray(names) ? [...names].reverse() : names;
	};
	try {
		assert.deepEqual(runUnits.linksIn(repo), ['data/a/dir', 'data/inside', 'top'], 'The links are sorted whatever order readdir gives');
	} finally {
		fs.readdirSync = readdirSync;
	}
	for (const name of ['data/a/dir', 'data/inside', 'top']) fs.rmSync(path.join(repo, name));
	// --root をリンクで与えても、写しは作業ツリーの実パスから作ったディレクトリで、単位はその写しの中で動き、作業ツリーを変えない。
	const throughLink = units => capturedAsync(() => runUnits.main(['--root', repoLink, '--units', path.join(dir, 'units.json'), '--records', path.join(dir, 'records'), ...units]));
	const linkedRoot = await throughLink([]);
	assert.equal(linkedRoot.code, 0, linkedRoot.text);
	const linkedInfo = JSON.parse(fs.readFileSync(record('info').output, 'utf8').trim());
	assert.ok(linkedInfo.cwd.includes(`${path.sep}kogai-units-${process.pid}-`) && !linkedInfo.cwd.startsWith(fs.realpathSync(repo)), `The unit runs in a copy, not in the working tree: ${linkedInfo.cwd}`);
	assert.deepEqual([linkedInfo.reviews, linkedInfo.backlog, linkedInfo.git, linkedInfo.nested], [false, false, false, false], 'Through a linked root, the review records, .git and nested node_modules are still not copied');
	fs.writeFileSync(path.join(dir, 'units.json'), JSON.stringify([{ name: 'write', command: ['scripts/unit.js', 'write'] }]));
	assert.equal((await throughLink([])).code, 1, 'A unit that writes its copy fails');
	assert.ok(!fs.existsSync(path.join(repo, 'data/new.txt')), 'The working tree is not written');
	// 写す途中に作業ツリーにできたリンクも、写した後の写しで見つけて、写しごと消す。
	const cpSync = fs.cpSync;
	fs.cpSync = function (source, ...rest) {
		// freeze は作業ツリーの実パスから写す（一時ディレクトリがリンクを通る環境でも働くよう、両方と比べる）。
		if ([repo, fs.realpathSync(repo)].includes(path.resolve(String(source))) && !fs.existsSync(path.join(repo, 'data/raced'))) fs.symlinkSync('value.txt', path.join(repo, 'data/raced'));
		return cpSync.call(this, source, ...rest);
	};
	try {
		const raced = await main(units);
		assert.equal(raced.code, 2, raced.text);
		assert.match(raced.text, /作業ツリーの中にシンボリックリンクがある.*: data\/raced$/m);
		assert.deepEqual(leftCopies(), [], 'The copy with the link is removed');
	} finally {
		fs.cpSync = cpSync;
		fs.rmSync(path.join(repo, 'data/raced'), { force: true });
	}
	// 写さない node_modules・.git（どの深さでも）と審査の記録の下のリンクは、どこを指していても止めない。
	fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
	fs.mkdirSync(path.join(repo, 'sub/.git'), { recursive: true });
	fs.mkdirSync(path.join(repo, 'sub/node_modules/.bin'), { recursive: true });
	fs.symlinkSync('../x/tool.js', path.join(repo, 'sub/node_modules/.bin/tool'));
	fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(repo, 'sub/.git/out'));
	fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(repo, 'node_modules/dep/out'));
	fs.symlinkSync('../..', path.join(repo, 'node_modules/up'));
	fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(repo, '.git/out'));
	fs.symlinkSync(path.join(dir, 'outside.txt'), path.join(repo, 'docs/reviews/out'));
	const fine = await main(units);
	assert.equal(fine.code, 0, `Links under what is not copied are fine: ${fine.text}`);
}));

test('run-units: a copy that fails partway is removed, and the run ends with exit code 2', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => withFixture(async ({ repo, records, main }) => {
	// 読めないファイル（root では読めるので除く）で、写しの途中（cpSync）で止まる。
	const unreadable = path.join(repo, 'data/unreadable.txt');
	fs.writeFileSync(unreadable, 'x');
	fs.chmodSync(unreadable, 0o000);
	try {
		const result = await main([{ name: 'info', command: ['scripts/unit.js', 'info'] }]);
		assert.equal(result.code, 2, result.text);
		assert.match(result.text, /EACCES/);
		assert.deepEqual(leftCopies(), [], 'The partial copy is removed');
		assert.ok(!fs.existsSync(path.join(records, 'run-units.lock')), 'The lock is released');
	} finally {
		fs.chmodSync(unreadable, 0o644);
	}
}));

test('run-units: --jobs runs units side by side, and --list neither runs nor records', { skip: process.platform === 'win32' }, () => withFixture(async ({ records, main, record }) => {
	const interval = name => {
		const text = fs.readFileSync(record(name).output, 'utf8');
		return [Number(text.match(/start (\d+)/)[1]), Number(text.match(/end (\d+)/)[1])];
	};
	const together = await main([{ name: 'a', command: ['scripts/unit.js', 'sleep'] }, { name: 'b', command: ['scripts/unit.js', 'sleep'] }], '--jobs', '2');
	assert.equal(together.code, 0, together.text);
	const [a, b] = [interval('a'), interval('b')];
	assert.ok(a[0] < b[1] && b[0] < a[1], `--jobs 2 overlaps the units: ${a} ${b}`);
	assert.match(together.text, /\| a \|.*\n\| b \|/, 'The rows keep the order of the list');
	const alone = await main([{ name: 'c', command: ['scripts/unit.js', 'sleep'] }, { name: 'd', command: ['scripts/unit.js', 'sleep'] }]);
	assert.equal(alone.code, 0, alone.text);
	const [c, d] = [interval('c'), interval('d')];
	assert.ok(c[1] <= d[0] || d[1] <= c[0], `--jobs 1 runs one unit at a time: ${c} ${d}`);
	const before = fs.readdirSync(records).sort();
	const listed = await main([{ name: 'e', command: ['scripts/unit.js', 'sleep'] }, { name: 'a', command: ['scripts/unit.js', 'sleep'] }], '--list');
	assert.equal(listed.code, 0);
	assert.match(listed.text, /\| e \| 実行する（記録なし） \|\n\| a \| 記録を使う（合格 /);
	assert.deepEqual(fs.readdirSync(records).sort(), before, '--list writes nothing');
	const fresh = path.join(path.dirname(records), 'fresh-records');
	assert.equal((await quietAsync(() => runUnits.main(['--root', path.join(path.dirname(records), 'repo'), '--units', path.join(path.dirname(records), 'units.json'), '--records', fresh, '--list']))), 0);
	assert.ok(!fs.existsSync(fresh), '--list does not make the record place');
	assert.deepEqual(leftCopies(), []);
}));

test('run-units: a live owner of the records stops another runner, and a finished, broken or own lock is taken over', { skip: process.platform === 'win32' }, () => withFixture(async ({ records, main }) => {
	const units = [{ name: 'info', command: ['scripts/unit.js', 'info'] }];
	fs.mkdirSync(records);
	fs.writeFileSync(path.join(records, runUnits.MARKER), '');
	const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
	try {
		fs.writeFileSync(path.join(records, 'run-units.lock'), String(sleeper.pid));
		const blocked = await main(units);
		assert.equal(blocked.code, 2);
		assert.match(blocked.text, new RegExp(`ほかの run-units\\.js（プロセス ${sleeper.pid}）`));
		assert.equal(fs.readFileSync(path.join(records, 'run-units.lock'), 'utf8'), String(sleeper.pid), 'The lock of a live owner is kept');
		assert.equal((await main(units, '--list')).code, 0, '--list does not need the lock');
	} finally {
		sleeper.kill('SIGKILL');
	}
	await waitStopped([sleeper.pid]);
	assert.equal((await main(units)).code, 0, 'The lock of a finished owner is taken over');
	fs.writeFileSync(path.join(records, 'run-units.lock'), 'garbage');
	assert.equal((await main(units)).code, 0, 'A broken lock is taken over');
	fs.writeFileSync(path.join(records, 'run-units.lock'), '0');
	assert.equal((await main(units)).code, 0, 'A lock with 0 (not a process number; kill(0) would reach this process group) is taken over');
	fs.writeFileSync(path.join(records, 'run-units.lock'), String(process.pid));
	assert.equal((await main(units)).code, 0, 'A lock left with this process number is this process');
	if (process.getuid && process.getuid() !== 0) {
		// プロセス 1 は別の利用者（root）のプロセスで、確かめると EPERM になる（動いている持ち主とみなす）。
		fs.writeFileSync(path.join(records, 'run-units.lock'), '1');
		assert.equal((await main(units)).code, 2, 'A lock owned by a process of another user is kept');
		fs.rmSync(path.join(records, 'run-units.lock'));
	}
	assert.ok(!fs.existsSync(path.join(records, 'run-units.lock')));
}));

test('run-units: the lock holds the process number and a random part, only its own lock is removed, and a finished lock is taken over by exactly one runner', { skip: process.platform === 'win32' }, () => withTempDirAsync({}, async dir => {
	const records = path.join(dir, 'records');
	fs.mkdirSync(records);
	// 印の中身はプロセス番号と乱数で、一時のファイルを残さない。自分の印（同じ中身）だけを消す。
	const lockFile = path.join(records, 'run-units.lock');
	const lock = runUnits.acquireLock(records);
	assert.deepEqual(lock.file, lockFile);
	assert.match(lock.content, new RegExp(`^${process.pid} [0-9a-f]{16}\\n$`));
	assert.equal(fs.readFileSync(lockFile, 'utf8'), lock.content);
	assert.ok(!fs.readdirSync(records).some(name => name.endsWith('.new')), 'The temporary file of the lock is removed');
	fs.writeFileSync(lockFile, 'another content');
	runUnits.releaseLock(lock);
	assert.equal(fs.readFileSync(lockFile, 'utf8'), 'another content', 'A lock with another content is not removed');
	fs.writeFileSync(lockFile, lock.content);
	runUnits.releaseLock(lock);
	assert.ok(!fs.existsSync(lockFile));
	// 読めない印（ディレクトリ・壊れたリンク）は、引き継がずに例外にする（繰り返さない）。
	fs.mkdirSync(lockFile);
	assert.throws(() => runUnits.acquireLock(records), /EISDIR/);
	fs.rmdirSync(lockFile);
	fs.symlinkSync(path.join(records, 'no-such'), lockFile);
	assert.throws(() => runUnits.acquireLock(records), /run-units\.lock を読めない（ファイルでない）/);
	fs.rmSync(lockFile);
	assert.ok(!fs.readdirSync(records).some(name => name.endsWith('.new')));
	// 持ち主の終わった印の引継ぎ: 引継ぎの印は中身ごとに1つ。引継ぎの印の持ち主が動いていれば使っているとし、終わっていればその中身でさらに引き継ぐ。
	assert.notEqual(runUnits.lockClaim(lockFile, '5 aa\n'), runUnits.lockClaim(lockFile, '5 bb\n'), 'A claim is per content, not per process number');
	assert.match(path.basename(runUnits.lockClaim(lockFile, 'x')), /^run-units\.lock\.[0-9a-f]{16}\.taken$/, 'The claim is named run-units.lock.<16 hex>.taken (4.6)');
	const claimer = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
	try {
		fs.writeFileSync(lockFile, 'stale-1');
		fs.writeFileSync(runUnits.lockClaim(lockFile, 'stale-1'), `${claimer.pid} 0000000000000000\n`);
		assert.throws(() => runUnits.acquireLock(records), new RegExp(`ほかの run-units\\.js（プロセス ${claimer.pid}）`), 'A live claimer is taking the lock over');
		assert.equal(fs.readFileSync(lockFile, 'utf8'), 'stale-1');
	} finally {
		claimer.kill('SIGKILL');
	}
	await waitStopped([claimer.pid]);
	const taken = runUnits.acquireLock(records);
	assert.equal(fs.readFileSync(lockFile, 'utf8'), taken.content, 'The lock is taken over when the claimer stopped before replacing it');
	assert.ok(fs.existsSync(runUnits.lockClaim(lockFile, `${claimer.pid} 0000000000000000\n`)), 'It claims the content of the stopped claimer');
	runUnits.releaseLock(taken);
	// 負の数は持ち主にしない（kill(-1, 0) は成功するが、プロセス番号ではない）。
	fs.writeFileSync(lockFile, '-1');
	runUnits.releaseLock(runUnits.acquireLock(records));
	assert.ok(!fs.existsSync(lockFile), 'A lock with a negative number is taken over');
	// 印の読み取りの直前・直後に印が変わる場合（fs.readFileSync を包んで、run-units.js が nth 回目に印を読む時に起こす）。
	const readFileSync = fs.readFileSync;
	const onRead = (nth, before, after) => {
		let count = 0;
		fs.readFileSync = function (file, ...rest) {
			if (file !== lockFile || ++count !== nth) return readFileSync.call(this, file, ...rest);
			before();
			try {
				return readFileSync.call(this, file, ...rest);
			} finally {
				after();
			}
		};
	};
	try {
		// 読む前に持ち主が印を消したときは、取り直す。
		fs.writeFileSync(lockFile, 'about-to-go');
		onRead(1, () => fs.rmSync(lockFile), () => {});
		const again = runUnits.acquireLock(records);
		fs.readFileSync = readFileSync;
		assert.equal(fs.readFileSync(lockFile, 'utf8'), again.content, 'A lock removed before it is read is made again');
		runUnits.releaseLock(again);
		// 置き換える前の読み直しの直前に印が消えたときは、置き換えずに初めからやり直して取る。
		fs.writeFileSync(lockFile, 'gone-before-check');
		onRead(2, () => fs.rmSync(lockFile), () => {});
		const remade = runUnits.acquireLock(records);
		fs.readFileSync = readFileSync;
		assert.equal(fs.readFileSync(lockFile, 'utf8'), remade.content, 'A lock removed before the check is made again');
		runUnits.releaseLock(remade);
		// 読み直しで印が消えていて、その直後にほかの run-units.js が印を取ったときは、それを置き換えない（初めからやり直して止まる）。
		const late = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
		try {
			fs.writeFileSync(lockFile, 'gone-before-late');
			onRead(2, () => fs.rmSync(lockFile), () => fs.writeFileSync(lockFile, `${late.pid} 2222222222222222\n`));
			assert.throws(() => runUnits.acquireLock(records), new RegExp(`ほかの run-units\\.js（プロセス ${late.pid}）`), 'A lock taken right after the check found none is not replaced');
			fs.readFileSync = readFileSync;
			assert.equal(fs.readFileSync(lockFile, 'utf8'), `${late.pid} 2222222222222222\n`);
		} finally {
			late.kill('SIGKILL');
		}
		await waitStopped([late.pid]);
		fs.rmSync(lockFile);
		// 読んだ後に、印が「引継ぎの印を作って取り、その後に終わった持ち主」の中身に替わったときは、たどった中身として引き継ぐ（自分の中身の引継ぎの印を作らない）。
		const ended = spawnSync(process.execPath, ['-e', '0']).pid;
		const endedContent = `${ended} 3333333333333333\n`;
		fs.writeFileSync(lockFile, 'gone-before-claim');
		onRead(1, () => {}, () => {
			fs.writeFileSync(runUnits.lockClaim(lockFile, 'gone-before-claim'), endedContent);
			fs.rmSync(lockFile);
			fs.writeFileSync(lockFile, endedContent);
		});
		const followed = runUnits.acquireLock(records);
		fs.readFileSync = readFileSync;
		assert.equal(fs.readFileSync(lockFile, 'utf8'), followed.content, 'The lock of the claimer that ended is taken over');
		assert.ok(!fs.existsSync(runUnits.lockClaim(lockFile, followed.content)), 'No claim of its own content is made (a later runner would follow it forever)');
		runUnits.releaseLock(followed);
		// 終わった持ち主の印を読んだ後に、その印が消されてほかの run-units.js が取り直したときは、置き換えない。
		const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: 'ignore' });
		try {
			fs.writeFileSync(lockFile, 'gone-owner');
			onRead(1, () => {}, () => {
				fs.rmSync(lockFile);
				fs.writeFileSync(lockFile, `${holder.pid} 1111111111111111\n`);
			});
			assert.throws(() => runUnits.acquireLock(records), new RegExp(`ほかの run-units\\.js（プロセス ${holder.pid}）`), 'The lock taken again after the read is not replaced');
			fs.readFileSync = readFileSync;
			assert.equal(fs.readFileSync(lockFile, 'utf8'), `${holder.pid} 1111111111111111\n`);
		} finally {
			holder.kill('SIGKILL');
		}
		await waitStopped([holder.pid]);
	} finally {
		fs.readFileSync = readFileSync;
	}
	fs.rmSync(lockFile);
	// 同時に取る: 6つのプロセスが同時に印を取りにいくと、1つだけが取り、ほかは「ほかの run-units.js が使っている」で止まる。取った印は、取ったプロセスの一時のファイル（*.new）と同じファイル。
	// 印・引継ぎの印を中身を書いた一時のファイルのリンクとして作ることを確かめるため、印・引継ぎの印の名前を書込みで開いてから
	// 中身を書くまでと、rename の前に 50ms 待つ補助を読み込ませる（中身のない印・引継ぎの印を読む間と、2つが読み直した後に続けて置き換える間をつくる）。
	const slow = path.join(dir, 'slow-lock.js');
	fs.writeFileSync(slow, [
		"const fs = require('node:fs'); const path = require('node:path');",
		'const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);',
		"const named = file => { const base = path.basename(String(file)); return base === 'run-units.lock' || base.endsWith('.taken'); };",
		'const { openSync, writeFileSync, copyFileSync, renameSync } = fs;',
		// 印・引継ぎの印の名前を書込みで開いたら、中身を書く前に待つ（openSync の後の writeSync、writeFileSync、copyFileSync のどれでも）。
		"const { O_WRONLY, O_RDWR, O_CREAT } = fs.constants;",
		"const writing = flags => (typeof flags === 'number' ? (flags & (O_WRONLY | O_RDWR | O_CREAT)) !== 0 : /[wa+]/.test(String(flags ?? 'r')));",
		"fs.openSync = function (file, flags, ...rest) { const fd = openSync.call(this, file, flags, ...rest); if (named(file) && writing(flags)) wait(); return fd; };",
		// 一時のファイル（*.new）の ino を覚える（取った印が、それのリンクであることを確かめる）。
		"fs.writeFileSync = function (file, data, options) { if (String(file).endsWith('.new')) { const result = writeFileSync.call(this, file, data, options); globalThis.kogaiOwnIno = fs.statSync(file).ino; return result; } if (!named(file)) return writeFileSync.call(this, file, data, options); const flag = (options && typeof options === 'object' && options.flag) || 'w'; const fd = openSync(file, flag, options && options.mode); wait(); try { fs.writeSync(fd, data); } finally { fs.closeSync(fd); } };",
		"fs.copyFileSync = function (source, target, mode) { if (!named(target)) return copyFileSync.call(this, source, target, mode); const data = fs.readFileSync(source); const fd = openSync(target, (mode ?? 0) & fs.constants.COPYFILE_EXCL ? 'wx' : 'w'); wait(); try { fs.writeSync(fd, data); } finally { fs.closeSync(fd); } };",
		'fs.renameSync = function (...args) { wait(); return renameSync.apply(this, args); };',
		''
	].join('\n'));
	const race = async name => {
		const start = path.join(dir, `${name}-start`);
		const code = `const fs = require('node:fs'); console.log('ready'); while (!fs.existsSync(${JSON.stringify(start)})) {} try { const lock = require(${JSON.stringify(SCRIPT)}).acquireLock(${JSON.stringify(records)}); console.log(fs.statSync(lock.file).ino === globalThis.kogaiOwnIno ? 'taken' : 'taken another file'); setTimeout(() => {}, 1500); } catch (error) { console.log(/^ほかの run-units\\.js（プロセス \\d+）/.test(error.message) ? 'busy' : 'error ' + error.message); }`;
		const takers = Array.from({ length: 6 }, () => {
			const child = spawn(process.execPath, ['--require', slow, '-e', code], { stdio: ['ignore', 'pipe', 'ignore'] });
			let text = '';
			const ready = new Promise(resolve => child.stdout.on('data', chunk => {
				text += chunk;
				if (text.includes('ready')) resolve();
			}));
			return { child, ready, said: new Promise(resolve => child.on('close', () => resolve(text.replace('ready', '').trim()))) };
		});
		// すべてが待ち始めてから、同時に始めさせる。
		await Promise.all(takers.map(taker => taker.ready));
		fs.writeFileSync(start, '');
		const said = await Promise.all(takers.map(taker => taker.said));
		await waitStopped(takers.map(taker => taker.child.pid));
		return said.sort();
	};
	fs.writeFileSync(lockFile, 'stale-2');
	assert.deepEqual(await race('stale'), ['busy', 'busy', 'busy', 'busy', 'busy', 'taken'], 'Only one of the runners that take over a finished lock at once takes it');
	assert.equal(fs.statSync(lockFile).ino, fs.statSync(runUnits.lockClaim(lockFile, 'stale-2')).ino, 'The lock and its claim are links of the same written file');
	fs.rmSync(lockFile);
	assert.deepEqual(await race('empty'), ['busy', 'busy', 'busy', 'busy', 'busy', 'taken'], 'Only one of the runners that take a free record place at once takes it');
	fs.rmSync(lockFile);
}));

test('run-units: a signal stops the running unit and removes the copies, a stopped rerun leaves no record of the earlier pass, and the table is rewritten after each unit', { skip: process.platform === 'win32' }, () => withFixture(async ({ dir, repo, records, main }) => {
	// 信号: 実行中の単位のプロセスグループを止め、写しを消して、信号の終了コードで終わる。
	const tmp = path.join(dir, 'runner-tmp');
	fs.mkdirSync(tmp);
	const hung = path.join(dir, 'hung.jsonl');
	// やり直しの途中で止めた単位は、前の合格の記録を残さない（記録が止めた回の出力を指さない）。
	const maybe = [{ name: 'maybe', command: ['scripts/unit.js', 'maybe'] }];
	assert.equal((await main(maybe)).code, 0);
	assert.ok(fs.readFileSync(path.join(records, `${runUnits.recordId('maybe')}.out`), 'utf8').includes('maybe ok'));
	fs.writeFileSync(path.join(repo, 'data/mode.txt'), 'hang\n');
	fs.writeFileSync(path.join(dir, 'maybe.json'), JSON.stringify(maybe));
	fs.writeFileSync(hung, '');
	{
		const { NODE_TEST_CONTEXT, ...rest } = process.env;
		const runner = spawn(process.execPath, [SCRIPT, '--root', repo, '--units', path.join(dir, 'maybe.json'), '--records', records], { stdio: 'ignore', env: { ...rest, NODE_V8_COVERAGE: undefined, TMPDIR: tmp, TMP: tmp, TEMP: tmp, KOGAI_HANG_RECORD: hung } });
		const exited = new Promise(resolve => runner.on('exit', resolve));
		for (let waited = 0; waited < 15000 && !fs.readFileSync(hung, 'utf8').trim(); waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
		runner.kill('SIGTERM');
		assert.equal(await exited, 143);
		await waitStopped(fs.readFileSync(hung, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid));
	}
	assert.ok(!fs.existsSync(path.join(records, `${runUnits.recordId('maybe')}.json`)), 'The record of the earlier pass is gone once the rerun started');
	assert.ok(!fs.existsSync(path.join(records, 'summary.md')), 'The table of the earlier run is gone too (no row says the stopped unit passed)');
	// 結果の表は単位が終わるたびに書き直す（2つ目の単位の実行中に止めても、1つ目の行がある）。
	fs.writeFileSync(path.join(dir, 'partial.json'), JSON.stringify([{ name: 'first', command: ['scripts/unit.js', 'info'] }, { name: 'hang', command: ['scripts/unit.js', 'hang'] }]));
	fs.writeFileSync(hung, '');
	{
		const { NODE_TEST_CONTEXT, ...rest } = process.env;
		const runner = spawn(process.execPath, [SCRIPT, '--root', repo, '--units', path.join(dir, 'partial.json'), '--records', records], { stdio: 'ignore', env: { ...rest, NODE_V8_COVERAGE: undefined, TMPDIR: tmp, TMP: tmp, TEMP: tmp, KOGAI_HANG_RECORD: hung } });
		const exited = new Promise(resolve => runner.on('exit', resolve));
		for (let waited = 0; waited < 15000 && !fs.readFileSync(hung, 'utf8').trim(); waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
		const table = fs.readFileSync(path.join(records, 'summary.md'), 'utf8');
		runner.kill('SIGTERM');
		assert.equal(await exited, 143);
		await waitStopped(fs.readFileSync(hung, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid));
		assert.match(table, /\n\| first \| [0-9a-f]{12}（\d+件） \| 合格（\d+秒） \|/, 'The finished unit is in the table while the next one runs');
		assert.doesNotMatch(table, /\| hang \|/);
	}
	fs.writeFileSync(path.join(repo, 'data/mode.txt'), 'ok\n');
	assert.match((await main(maybe, '--list')).text, /\| maybe \| 実行する（記録なし） \|/, 'The stopped rerun is not taken for the earlier pass');
	fs.writeFileSync(path.join(dir, 'hang.json'), JSON.stringify([{ name: 'hang', command: ['scripts/unit.js', 'hang'] }]));
	// 単位が写しの置き場所ごと消した後の信号でも、後始末を終えて信号の終了コードで終わる。
	fs.writeFileSync(path.join(dir, 'gone.json'), JSON.stringify([{ name: 'gone', command: ['scripts/unit.js', 'remove-units', 'hang'] }]));
	try {
		for (const [signal, code, list] of [['SIGTERM', 143, 'hang.json'], ['SIGINT', 130, 'hang.json'], ['SIGHUP', 129, 'hang.json'], ['SIGTERM', 143, 'gone.json']]) {
			fs.writeFileSync(hung, '');
			const { NODE_TEST_CONTEXT, ...rest } = process.env;
			const runner = spawn(process.execPath, [SCRIPT, '--root', repo, '--units', path.join(dir, list), '--records', records], { stdio: 'ignore', env: { ...rest, NODE_V8_COVERAGE: undefined, TMPDIR: tmp, TMP: tmp, TEMP: tmp, KOGAI_HANG_RECORD: hung } });
			const exited = new Promise(resolve => runner.on('exit', (status, received) => resolve({ status, received })));
			for (let waited = 0; waited < 15000 && !fs.readFileSync(hung, 'utf8').trim(); waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
			const pids = fs.readFileSync(hung, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid);
			assert.equal(pids.length, 1, `The unit of ${list} started before ${signal}`);
			runner.kill(signal);
			assert.deepEqual(await exited, { status: code, received: null }, `${signal} exits with ${code} (${list})`);
			assert.deepEqual(await waitStopped(pids), [], `${signal} stops the running unit (${list})`);
			assert.deepEqual(leftCopies(runner.pid, tmp), [], `${signal} removes the copies (${list})`);
			assert.ok(!fs.existsSync(path.join(records, 'run-units.lock')), `${signal} releases the lock (${list})`);
		}
	} finally {
		cleanupHung(hung);
	}
}));

test('run-units: an exception in one unit stops the other running units before the copies are removed', { skip: process.platform === 'win32' }, () => withFixture(async ({ dir, records, main }) => {
	const hung = path.join(dir, 'hung.jsonl');
	const saved = process.env.KOGAI_HANG_RECORD;
	process.env.KOGAI_HANG_RECORD = hung;
	try {
		// 2つ目の単位の出力の置き場所をディレクトリにしておき、出力を開けない例外を起こす。1つ目の単位は止めるまで動き続ける。
		await main([{ name: 'first', command: ['scripts/unit.js', 'info'] }]);
		fs.mkdirSync(path.join(records, `${runUnits.recordId('broken')}.out`));
		const started = Date.now();
		const result = await main([{ name: 'hanging', command: ['scripts/unit.js', 'hang'] }, { name: 'broken', command: ['scripts/unit.js', 'info'] }, { name: 'later', command: ['scripts/unit.js', 'sleep'] }], '--jobs', '2');
		assert.equal(result.code, 2, result.text);
		assert.match(result.text, /run-units: .*EISDIR/);
		assert.ok(Date.now() - started < 15000, 'The hanging unit is stopped, not waited for');
		assert.ok(!fs.existsSync(path.join(records, `${runUnits.recordId('hanging')}.json`)), 'A unit stopped by the exception has no record');
		assert.ok(!fs.existsSync(path.join(records, `${runUnits.recordId('later')}.json`)) && !fs.existsSync(path.join(records, `${runUnits.recordId('later')}.out`)), 'No unit starts after the exception');
		assert.deepEqual(leftCopies(), []);
		const pids = fs.existsSync(hung) ? fs.readFileSync(hung, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid) : [];
		assert.deepEqual(await waitStopped(pids), [], 'Nothing the stopped unit started is left');
		assert.ok(!fs.existsSync(path.join(records, 'run-units.lock')));
		// 単位が写しの置き場所ごと消したときも、実行の例外（終了コード 2）で終わり、後始末で例外にならない。
		const gone = await main([{ name: 'gone', command: ['scripts/unit.js', 'remove-units'] }]);
		assert.equal(gone.code, 2, gone.text);
		assert.deepEqual(leftCopies(), []);
		assert.ok(!fs.existsSync(path.join(records, 'run-units.lock')));
	} finally {
		cleanupHung(hung);
		if (saved === undefined) delete process.env.KOGAI_HANG_RECORD;
		else process.env.KOGAI_HANG_RECORD = saved;
	}
}));

test('run-units: the processes to stop are those with the record place as KOGAI_TRACE_DIR or a KOGAI_TRACE_UNITS line, not those that only mention it or have a longer one', { skip: process.platform !== 'linux' }, () => withTempDirAsync({}, async dir => {
	const trace = path.join(dir, 'u0-trace');
	const outer = path.join(dir, 'outer-trace');
	const { NODE_TEST_CONTEXT, KOGAI_TRACE_DIR, KOGAI_TRACE_UNITS, ...rest } = process.env;
	const cases = {
		dir: { KOGAI_TRACE_DIR: trace },
		chain: { KOGAI_TRACE_DIR: path.join(dir, 'inner-trace'), KOGAI_TRACE_UNITS: `${outer}\n${trace}` },
		mentioned: { KOGAI_TRACE_UNITS: outer, KOGAI_NOTE: trace },
		longerDir: { KOGAI_TRACE_DIR: `${trace}-x` },
		longerChain: { KOGAI_TRACE_UNITS: `${trace}-x\n${outer}` },
		other: { KOGAI_TRACE_DIR: outer, KOGAI_TRACE_UNITS: outer }
	};
	const children = {};
	try {
		for (const [name, env] of Object.entries(cases)) {
			// 起動の直後（exec の前）の /proc の環境変数は親のものなので、準備ができたと書くまで待つ。
			const child = spawn(process.execPath, ['-e', "console.log('ready'); setTimeout(() => {}, 30000);"], { env: { ...rest, NODE_V8_COVERAGE: undefined, NODE_OPTIONS: undefined, ...env }, stdio: ['ignore', 'pipe', 'ignore'] });
			children[name] = child;
			await new Promise(resolve => child.stdout.once('data', resolve));
		}
		const byNumber = (a, b) => a - b;
		assert.deepEqual(runUnits.tracedProcesses(trace).sort(byNumber), [children.dir.pid, children.chain.pid].sort(byNumber));
		assert.deepEqual(runUnits.tracedProcesses(outer).sort(byNumber), [children.chain.pid, children.mentioned.pid, children.longerChain.pid, children.other.pid].sort(byNumber), 'Every KOGAI_TRACE_UNITS line is compared');
		runUnits.stopUnit(children.dir.pid, trace);
		assert.deepEqual(await waitStopped([children.dir.pid, children.chain.pid]), [], 'stopUnit stops the found processes');
		const others = ['mentioned', 'longerDir', 'longerChain', 'other'].map(name => children[name].pid);
		assert.deepEqual(others.filter(running), others, 'stopUnit leaves the other processes running');
		// 止める間に、記録の置き場所を持つプロセスが新しく現れても止める（見つからなくなるまで繰り返す）。sh（記録の置き場所を持たない）は、
		// 1つ目の sleep が止められると、記録の置き場所を持つ sleep に置き換わる（exec）。
		const respawn = spawn('sh', ['-c', 'KOGAI_TRACE_DIR="$0" sleep 30; export KOGAI_TRACE_DIR="$0"; exec sleep 30', trace], { env: { ...rest, NODE_OPTIONS: undefined }, stdio: 'ignore' });
		children.respawn = respawn;
		for (let waited = 0; waited < 10000 && runUnits.tracedProcesses(trace).length === 0; waited += 20) await new Promise(resolve => setTimeout(resolve, 20));
		assert.equal(runUnits.tracedProcesses(trace).length, 1, 'The first sleep is running');
		runUnits.stopUnit(respawn.pid, trace);
		assert.deepEqual(await waitStopped([respawn.pid], 3000), [], 'The process that appeared while stopping is stopped too');
		assert.deepEqual(runUnits.tracedProcesses(trace), []);
	} finally {
		for (const child of Object.values(children)) child.kill('SIGKILL');
	}
}));

// 契約の試験: 実物の repeat-tests.js・mutate.js の単位で、最上位と試験の読取り、mutate.js の写しの中の読取り、mutate.js が別のプロセスグループで起こした試験の後始末を確かめる。
test('run-units: real repeat-tests.js and mutate.js units record the files their tests read and leave no process after a signal', { skip: process.platform === 'win32' }, () => withTempDirAsync({
	'repo/package.json': '{ "name": "contract" }\n',
	'repo/src/a.js': 'module.exports = x => x + 1;\n',
	'repo/tests/helpers/h.js': "module.exports = () => require('node:fs').readFileSync(require('node:path').join(__dirname, '../../data/h.txt'), 'utf8');\n",
	'repo/tests/unit/a.test.js': "const test = require('node:test'); const assert = require('node:assert'); const h = require('../helpers/h.js'); const a = require('../../src/a.js');\ntest('a', () => { assert.equal(a(1), 2); assert.equal(h(), 'H'); });\n",
	'repo/tests/unit/hang.test.js': "const test = require('node:test');\ntest('hang', () => { require('node:fs').appendFileSync(process.env.KOGAI_HANG_RECORD, JSON.stringify({ pid: process.pid, cwd: process.cwd() }) + '\\n'); for (const end = Date.now() + 60000; Date.now() < end;) {} });\n",
	'repo/data/h.txt': 'H',
	'repo/scripts/hang.js': "require('node:fs').appendFileSync(process.env.KOGAI_HANG_RECORD, JSON.stringify({ pid: process.pid, cwd: process.cwd() }) + '\\n'); for (const end = Date.now() + 60000; Date.now() < end;) {}\n",
	'repo/scripts/outer.js': [
		"const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawnSync } = require('node:child_process');",
		"const units = path.join(os.tmpdir(), 'inner-units.json');",
		"fs.writeFileSync(units, JSON.stringify([{ name: 'inner', command: ['scripts/hang.js'] }]));",
		"const result = spawnSync(process.execPath, ['tests/scripts/run-units.js', '--root', '.', '--units', units, '--records', path.join(os.tmpdir(), 'inner-records')], { stdio: 'inherit' });",
		'process.exit(result.status ?? 1);',
		''
	].join('\n'),
	'repo/data/unrelated.txt': 'U',
	'spec.json': JSON.stringify([{ name: 'm', file: 'src/a.js', find: 'x + 1', replace: 'x + 2', tests: ['tests/unit/a.test.js'] }]),
	'draft-b.js': 'module.exports = x => x >= 0;\n',
	'repo/src/b.js': 'module.exports = x => x > 0;\n',
	'repo/tests/unit/b.test.js': "const test = require('node:test'); const assert = require('node:assert'); const b = require('../../src/b.js');\ntest('b', () => { assert.equal(b(1), true); assert.equal(b(0), false); });\n",
	'hang-spec.json': JSON.stringify([{ name: 'h', file: 'src/a.js', find: 'x + 1', replace: 'x + 2', tests: ['tests/unit/hang.test.js'] }])
}, async dir => {
	const repo = path.join(dir, 'repo');
	fs.cpSync(path.dirname(SCRIPT), path.join(repo, 'tests/scripts'), { recursive: true });
	fs.writeFileSync(path.join(repo, 'tests/scripts/stress/test-limits.json'), JSON.stringify({ rules: [] }));
	const records = path.join(dir, 'records');
	const unitsFile = path.join(dir, 'units.json');
	const units = [
		{ name: 'repeat', command: ['tests/scripts/repeat-tests.js', '--times', '1', 'tests/unit/a.test.js'] },
		{ name: 'mutate', command: ['tests/scripts/mutate.js', '--spec', path.join(dir, 'spec.json'), '--timeout', '60000'] },
		// --since は git diff --no-index を使う（git のない環境では除く）。
		...(gitAvailable ? [{ name: 'since', command: ['tests/scripts/mutate.js', '--auto', 'src/b.js', '--since', path.join(dir, 'draft-b.js'), '--tests', 'tests/unit/b.test.js'] }] : [])
	];
	fs.writeFileSync(unitsFile, JSON.stringify(units));
	const run = (...args) => capturedAsync(() => runUnits.main(['--root', repo, '--units', unitsFile, '--records', records, ...args]));
	const result = await run('--jobs', '2');
	assert.equal(result.code, 0, result.text);
	const record = name => JSON.parse(fs.readFileSync(path.join(records, `${runUnits.recordId(name)}.json`), 'utf8'));
	const repeat = record('repeat');
	for (const key of ['tests/scripts/repeat-tests.js', 'tests/scripts/stress/test-limits.json', 'tests/unit/a.test.js', 'tests/helpers/h.js', 'src/a.js', 'data/h.txt']) assert.ok(Object.hasOwn(repeat.inputs, key), `${key} is an input of the repeat-tests.js unit`);
	assert.ok(!Object.hasOwn(repeat.inputs, 'data/unrelated.txt'));
	assert.equal(repeat.copier, false);
	const mutate = record('mutate');
	for (const key of ['tests/scripts/mutate.js', 'tests/scripts/lib/js-lexer.js', path.join(dir, 'spec.json'), 'tests/unit/a.test.js', 'tests/helpers/h.js', 'src/a.js', 'data/h.txt']) assert.ok(Object.hasOwn(mutate.inputs, key), `${key} is an input of the mutate.js unit (read in its copy)`);
	assert.ok(!Object.hasOwn(mutate.inputs, 'data/unrelated.txt'), 'What mutate.js reads to copy and hash the tree is not an input');
	assert.equal(mutate.copier, true);
	if (gitAvailable) {
		const since = record('since');
		assert.equal(since.copier, true);
		assert.ok(Object.hasOwn(since.programs, 'git') && since.programs.git.path, 'The git that mutate.js --since starts is checked as a program');
		assert.deepEqual(since.expanded, { wholeCopy: null, browser: null }, 'It does not widen the inputs');
	}
	fs.writeFileSync(path.join(repo, 'tests/scripts/stress/test-limits.json'), JSON.stringify({ rules: [{ file: 'tests/unit/a.test.js', limitMs: 1 }] }));
	assert.match((await run('--list')).text, /\| repeat \| 実行する（入力が変わった（tests\/scripts\/stress\/test-limits\.json）） \|\n\| mutate \| 記録を使う/, 'The default limits table read by repeat-tests.js is an input');
	// 信号: mutate.js が新しいプロセスグループで起こした試験も止める（/proc で探すとき）。
	if (!PROC) return;
	const tmp = path.join(dir, 'runner-tmp');
	fs.mkdirSync(tmp);
	const hung = path.join(dir, 'hung.jsonl');
	fs.writeFileSync(hung, '');
	fs.writeFileSync(path.join(dir, 'hang.json'), JSON.stringify([{ name: 'hang', command: ['tests/scripts/mutate.js', '--spec', path.join(dir, 'hang-spec.json'), '--timeout', '120000'] }]));
	try {
		const { NODE_TEST_CONTEXT, ...rest } = process.env;
		const runner = spawn(process.execPath, [SCRIPT, '--root', repo, '--units', path.join(dir, 'hang.json'), '--records', records], { stdio: 'ignore', env: { ...rest, NODE_V8_COVERAGE: undefined, TMPDIR: tmp, TMP: tmp, TEMP: tmp, KOGAI_HANG_RECORD: hung } });
		const exited = new Promise(resolve => runner.on('exit', (status, received) => resolve({ status, received })));
		for (let waited = 0; waited < 20000 && !fs.readFileSync(hung, 'utf8').trim(); waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
		const pids = fs.readFileSync(hung, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid);
		assert.equal(pids.length, 1, 'The test that mutate.js started is running');
		runner.kill('SIGTERM');
		assert.deepEqual(await exited, { status: 143, received: null });
		assert.deepEqual(await waitStopped(pids), [], 'The test in the process group of mutate.js is stopped too');
		assert.deepEqual(fs.readdirSync(tmp), [], 'No copy of run-units.js or mutate.js is left');
		// 入れ子: 外側の run-units.js の単位の中で動く run-units.js の単位（別のプロセスグループで、KOGAI_TRACE_DIR は内側の値）も止める。
		fs.writeFileSync(hung, '');
		fs.writeFileSync(path.join(dir, 'outer.json'), JSON.stringify([{ name: 'outer', command: ['scripts/outer.js'] }]));
		const outer = spawn(process.execPath, [SCRIPT, '--root', repo, '--units', path.join(dir, 'outer.json'), '--records', records], { stdio: 'ignore', env: { ...rest, NODE_V8_COVERAGE: undefined, TMPDIR: tmp, TMP: tmp, TEMP: tmp, KOGAI_HANG_RECORD: hung } });
		const outerExited = new Promise(resolve => outer.on('exit', (status, received) => resolve({ status, received })));
		for (let waited = 0; waited < 20000 && !fs.readFileSync(hung, 'utf8').trim(); waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
		const inner = fs.readFileSync(hung, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line).pid);
		assert.equal(inner.length, 1, 'The unit of the inner run-units.js is running');
		outer.kill('SIGTERM');
		assert.deepEqual(await outerExited, { status: 143, received: null });
		assert.deepEqual(await waitStopped(inner), [], 'The unit of a nested run-units.js is stopped too');
		assert.deepEqual(fs.readdirSync(tmp), []);
	} finally {
		cleanupHung(hung);
	}
}));
