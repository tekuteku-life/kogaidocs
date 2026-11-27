const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withTempDir } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: trace-reads.js（run-units.js が単位の Node のプロセスに読み込ませ、読んだファイルを記録する）を確かめる。

const TRACE = path.resolve(__dirname, '../scripts/trace-reads.js');
const OPTIONS = `--require ${JSON.stringify(TRACE)}`;

/** dir の script を、記録の設定（KOGAI_TRACE_DIR=logs と、trace-reads.js を読み込ませる NODE_OPTIONS）つきで実行する。 */
function traced(dir, script, { env = {}, logs = path.join(dir, 'logs'), create = true } = {}) {
	if (create) fs.mkdirSync(logs, { recursive: true });
	const { NODE_TEST_CONTEXT, ...rest } = process.env;
	return spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { ...rest, NODE_V8_COVERAGE: undefined, NODE_OPTIONS: OPTIONS, KOGAI_TRACE_DIR: logs, ...env } });
}

/** 記録の置き場所の、プロセスごとの記録の行（プロセス番号の順ではなく、すべての行の集合と、ファイルの数）。 */
function lines(logs) {
	const files = fs.readdirSync(logs).filter(name => name.endsWith('.log'));
	return { files, all: files.flatMap(name => fs.readFileSync(path.join(logs, name), 'utf8').split('\n').filter(Boolean)) };
}

test('trace-reads: without KOGAI_TRACE_DIR nothing is wrapped and nothing is written', () => withTempDir({
	'main.js': "const fs = require('node:fs'); const cp = require('node:child_process'); const Module = require('node:module');\nconsole.log(JSON.stringify([fs.readFileSync.toString().startsWith('function readFileSync'), cp.spawn.toString().startsWith('function spawn'), Module._extensions['.js'].toString().includes('note(')]));\n"
}, raw => {
	// 記録の行は実パスで書かれる（一時ディレクトリがリンクを通る環境でも、期待するパスを実パスから作る）。
	const dir = fs.realpathSync(raw);
	const { NODE_TEST_CONTEXT, ...rest } = process.env;
	const result = spawnSync(process.execPath, ['main.js'], { cwd: dir, encoding: 'utf8', env: { ...rest, NODE_V8_COVERAGE: undefined, NODE_OPTIONS: OPTIONS, KOGAI_TRACE_DIR: '' } });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), [true, true, false]);
	assert.deepEqual(fs.readdirSync(dir), ['main.js'], 'No record is written');
}));

// 試料の中でシンボリックリンクを作るので、Windows では除く。
test('trace-reads: fs reads, existence checks, listings, copies, globs and module loads are recorded by kind once, with absolute paths, without changing the results', { skip: process.platform === 'win32' }, () => withTempDir({
	'a.txt': 'A', 'b.txt': 'B', 'c.txt': 'C', 'd.txt': 'D', 'e.txt': 'E', 'f.txt': 'F', 'g.txt': 'G', 'h.txt': 'H', 'i.txt': 'I', 'j.txt': 'J', 'k.txt': 'K', 'l.txt': 'L', 'm.txt': 'M', 'n.txt': 'N', 'o.txt': 'O', 'p.txt': 'P',
	'q.txt': 'Q', 'r.txt': 'R', 's.txt': 'S', 't.txt': 'T', 'u.txt': 'U', 'v.txt': 'V',
	'dir/x.txt': 'X', 'dir2/x2.txt': 'X', 'dir3/x3.txt': 'X', 'dir4/x4.txt': 'X', 'tree/y.txt': 'Y', 'tree2/y2.txt': 'Y', 'glob/z.txt': 'Z', 'glob2/z2.txt': 'Z', 'glob3/z3.txt': 'Z', 'mod.js': 'module.exports = 42;\n', 'data.json': '{"value":1}\n',
	'main.js': [
		"const fs = require('node:fs'); const path = require('node:path'); const util = require('node:util');",
		'(async () => {',
		'	const results = {};',
		"	results.relative = fs.readFileSync('a.txt', 'utf8');",
		"	results.buffer = fs.readFileSync(Buffer.from(path.join(__dirname, 'b.txt')), 'utf8');",
		"	results.url = fs.readFileSync(new URL(`file://${path.join(__dirname, 'c.txt')}`), 'utf8');",
		"	const fd = fs.openSync('d.txt', 'r'); results.fd = fs.readFileSync(fd, 'utf8'); fs.closeSync(fd);",
		"	results.again = fs.readFileSync('a.txt', 'utf8');",
		"	results.missing = fs.existsSync('missing.txt');",
		"	results.stat = fs.statSync('e.txt').size; results.lstat = fs.lstatSync('f.txt').size; fs.accessSync('g.txt');",
		"	results.realpath = path.basename(fs.realpathSync('h.txt')); results.native = path.basename(fs.realpathSync.native('i.txt'));",
		"	fs.symlinkSync('j.txt', 'link'); results.link = fs.readlinkSync('link');",
		"	fs.copyFileSync('k.txt', 'copied.txt');",
		"	results.callback = await new Promise(resolve => fs.readFile('l.txt', 'utf8', (error, text) => resolve(text)));",
		"	results.promise = await fs.promises.readFile('m.txt', 'utf8'); results.promiseStat = (await fs.promises.stat('n.txt')).size;",
		"	results.stream = await new Promise(resolve => { let text = ''; fs.createReadStream('o.txt', 'utf8').on('data', chunk => { text += chunk; }).on('end', () => resolve(text)); });",
		"	results.exists = await util.promisify(fs.exists)('p.txt');",
		"	results.list = fs.readdirSync('dir'); results.promiseList = await fs.promises.readdir('dir'); const opened = fs.opendirSync('dir4'); opened.closeSync();",
		// 包む名前ごとに別のファイルを読む（コールバックと Promise の関数）。
		"	results.lstat2 = await new Promise(resolve => fs.lstat('q.txt', (error, stat) => resolve(stat.size)));",
		// fs.realpath（コールバック）は中で呼出しの時点の fs.lstat を呼ぶので、realpath の名前は Promise の関数で確かめる。
		"	results.realpath2 = path.basename(await fs.promises.realpath('r.txt'));",
		"	results.native2 = await new Promise(resolve => fs.realpath.native('s.txt', (error, file) => resolve(path.basename(file))));",
		"	fs.symlinkSync('t.txt', 'link2'); results.link2 = await new Promise(resolve => fs.readlink('link2', (error, target) => resolve(target)));",
		"	await fs.promises.copyFile('u.txt', 'u-copy.txt'); results.blob = await (await fs.openAsBlob('v.txt')).text();",
		"	results.list2 = await new Promise(resolve => fs.readdir('dir2', (error, names) => resolve(names))); const opened3 = await fs.promises.opendir('dir3'); await opened3.close();",
		"	await new Promise(resolve => fs.cp('tree2', 'tree2-copy', { recursive: true }, resolve)); results.glob2 = await new Promise(resolve => fs.glob('z2*.txt', { cwd: 'glob2' }, (error, names) => resolve(names)));",
		"	fs.cpSync('tree', 'tree-copy', { recursive: true });",
		"	results.glob = fs.globSync('*.json'); results.globCwd = fs.globSync('*.txt', { cwd: 'glob' });",
		// glob は走査の範囲を決めず、パターン（文字列・配列）をそのまま記録する（作業ディレクトリ・.. によらない）。
		"	results.globMany = fs.globSync(['glob3/*.txt', '../*/glob3/../glob3/z3.txt'], { cwd: __dirname }).sort(); results.globPromise = []; for await (const name of fs.promises.glob('glob3/*.txt')) results.globPromise.push(name);",
		"	results.module = require('./mod.js'); results.json = require('./data.json').value;",
		"	try { fs.readFileSync('nope.txt'); } catch (error) { results.error = error.code; }",
		"	results.called = fs.readFileSync.call(fs, 'a.txt', 'utf8');",
		"	results.names = [fs.readFileSync.name, typeof fs.realpathSync.native, typeof require('node:child_process').execFile[util.promisify.custom]];",
		'	console.log(JSON.stringify(results));',
		'})();',
		''
	].join('\n')
}, raw => {
	// 記録の行は実パスで書かれる（一時ディレクトリがリンクを通る環境でも、期待するパスを実パスから作る）。
	const dir = fs.realpathSync(raw);
	const result = traced(dir, 'main.js');
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), {
		relative: 'A', buffer: 'B', url: 'C', fd: 'D', again: 'A', missing: false, stat: 1, lstat: 1, realpath: 'h.txt', native: 'i.txt', link: 'j.txt',
		callback: 'L', promise: 'M', promiseStat: 1, stream: 'O', exists: true, list: ['x.txt'], promiseList: ['x.txt'], glob: ['data.json'], globCwd: ['z.txt'], globMany: [`../${path.basename(dir)}/glob3/z3.txt`, 'glob3/z3.txt'].sort(), globPromise: ['glob3/z3.txt'],
		lstat2: 1, realpath2: 'r.txt', native2: 's.txt', link2: 't.txt', blob: 'V', list2: ['x2.txt'], glob2: ['z2.txt'],
		module: 42, json: 1, error: 'ENOENT', called: 'A', names: ['readFileSync', 'function', 'function']
	}, 'The wrapped functions keep their results, errors, this and attached properties');
	assert.equal(fs.readFileSync(path.join(dir, 'copied.txt'), 'utf8'), 'K');
	assert.deepEqual(fs.readdirSync(path.join(dir, 'tree-copy')), ['y.txt'], 'Copies still work');
	assert.deepEqual(fs.readdirSync(path.join(dir, 'tree2-copy')), ['y2.txt']);
	const { files, all } = lines(path.join(dir, 'logs'));
	assert.equal(files.length, 1);
	const at = file => path.join(dir, file);
	const expected = [
		...['a.txt', 'b.txt', 'c.txt', 'd.txt', 'missing.txt', 'e.txt', 'f.txt', 'g.txt', 'h.txt', 'i.txt', 'link', 'k.txt', 'l.txt', 'm.txt', 'n.txt', 'o.txt', 'p.txt', 'nope.txt', 'q.txt', 'r.txt', 's.txt', 'link2', 'u.txt', 'v.txt'].map(file => `read ${at(file)}`),
		...['dir', 'dir2', 'dir3', 'dir4'].map(name => `list ${at(name)}`), `copy ${at('tree')}`, `copy ${at('tree2')}`, ...['"*.json"', '"*.txt"', '"z2*.txt"', '["glob3/*.txt","../*/glob3/../glob3/z3.txt"]', '"glob3/*.txt"'].map(patterns => `whole fs.glob ${patterns}`), `load ${at('mod.js')}`, `load ${at('data.json')}`
	];
	for (const line of expected) assert.ok(all.includes(line), `${line} is recorded`);
	assert.equal(all.filter(line => line === `read ${at('a.txt')}`).length, 1, 'A path is recorded once per kind');
	assert.ok(!all.some(line => line.endsWith(` ${at('copied.txt')}`) || line.endsWith(` ${at('u-copy.txt')}`)), 'The copy target of copyFile is not recorded');
	assert.ok(!all.includes(`tree ${at('tree-copy')}`) && !all.includes(`copy ${at('tree-copy')}`), 'The copy target of cp is not a copy or tree input (cp only checks whether it exists)');
	assert.ok(!all.includes(`read ${at('j.txt')}`), 'readlink records the link, not its target');
	assert.ok(!all.some(line => line.includes(path.join(dir, 'logs'))), 'The record itself is not recorded');
	assert.ok(!all.some(line => line.startsWith('tree ')), 'A glob records no directory (the range it scans is not decided)');
	assert.ok(all.every(line => /^(?:read|list|copy|load) \//.test(line) || line.startsWith('whole fs.glob ')), 'Every path is absolute (a whole line holds the pattern)');
}));

test('trace-reads: child processes that are not Node, Node processes without the trace settings, and inheriting Node processes are told apart', { skip: process.platform === 'win32' }, () => withTempDir({
	'child.js': "require('node:fs').statSync(require('node:path').join(__dirname, 'child.txt'));\n",
	'child.txt': 'C',
	'main.js': [
		"const cp = require('node:child_process'); const path = require('node:path');",
		"const child = path.join(__dirname, 'child.js');",
		// 条件ごとに、Node へのリンク（名前は node）を別のディレクトリに置いて起こし、どの条件で記録の設定を受け継がないとしたかを見分ける。
		"const node = name => path.join(__dirname, name, 'node');",
		'cp.spawnSync(process.execPath, [child]);',
		"cp.spawnSync(node('extended'), [child], { env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS} --no-warnings` } });",
		"cp.spawnSync(node('empty'), ['-e', '0'], { env: {} });",
		"cp.spawnSync(node('options'), ['-e', '0'], { env: { ...process.env, NODE_OPTIONS: '--no-warnings' } });",
		"cp.spawnSync(node('dir'), ['-e', '0'], { env: { ...process.env, KOGAI_TRACE_DIR: path.join(__dirname, 'elsewhere') } });",
		"cp.spawnSync(node('unrelated'), ['-e', '0'], { env: { ...process.env, UNRELATED_SETTING: '1' } });",
		"cp.spawnSync(node('plain'), ['-e', '0'], { stdio: 'ignore' });",
		"try { cp.execFileSync('node', ['-e', '0'], { env: {} }); } catch {}",
		"cp.spawnSync('sh', ['-c', 'true']);",
		"try { cp.execSync('true', { shell: path.join(__dirname, 'exec-shell') }); } catch {}",
		"cp.execSync('true');",
		"cp.spawnSync(process.execPath, ['-e', '0'], { shell: true });",
		"cp.spawnSync('true', [], { shell: path.join(__dirname, 'spawn-shell') });",
		// node で始まる名前の Node でないプログラム（ないので起動に失敗する）。
		"cp.spawnSync(path.join(__dirname, 'nodeish'), []);",
		// 非同期の起動: spawn・execFile（受け継がない Node と Node 以外のプログラム）と exec（与えたシェル）。それぞれ終わってから次へ進む。
		"const done = child => new Promise(resolve => child.on('close', resolve));",
		"const asyncLaunches = async () => {",
		"	await done(cp.spawn(node('spawn'), ['-e', '0'], { env: {}, stdio: 'ignore' })); await done(cp.spawn('echo', ['x'], { stdio: 'ignore' }));",
		"	await new Promise(resolve => cp.execFile(node('execfile'), ['-e', '0'], { env: {} }, resolve)); await new Promise(resolve => cp.execFile('true', [], resolve));",
		"	await new Promise(resolve => cp.exec('true', { shell: path.join(__dirname, 'exec-callback-shell') }, resolve));",
		"};",
		// 最後に、process.env の記録の置き場所を変えてから・記録の設定を process.env から消してから、環境変数を与えずに起こす
		// （読み込んだ時点の設定と比べるので untraced になる）。fork は shell を与えても shell を使わない。
		"const moved = () => { const saved = process.env.KOGAI_TRACE_DIR; process.env.KOGAI_TRACE_DIR = path.join(__dirname, 'elsewhere'); cp.spawnSync(node('moved'), ['-e', '0']); process.env.KOGAI_TRACE_DIR = saved; };",
		"asyncLaunches().then(() => cp.fork(child, [], { env: {} }).on('exit', () => cp.fork(child, [], { execPath: node('fork'), env: {} }).on('exit', () => cp.fork(child, [], { execPath: node('forkshell'), shell: true, env: {} }).on('exit', () => cp.fork(child).on('exit', () => { moved(); delete process.env.NODE_OPTIONS; cp.spawnSync(node('deleted'), ['-e', '0']); console.log('done'); })))));",
		''
	].join('\n')
}, raw => {
	// 記録の行は実パスで書かれる（一時ディレクトリがリンクを通る環境でも、期待するパスを実パスから作る）。
	const dir = fs.realpathSync(raw);
	for (const name of ['extended', 'empty', 'options', 'dir', 'unrelated', 'plain', 'fork', 'forkshell', 'moved', 'deleted', 'spawn', 'execfile']) {
		fs.mkdirSync(path.join(dir, name));
		fs.symlinkSync(process.execPath, path.join(dir, name, 'node'));
	}
	const result = traced(dir, 'main.js');
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), 'done');
	const { files, all } = lines(path.join(dir, 'logs'));
	const untraced = all.filter(line => line.startsWith('untraced ')).map(line => line.slice('untraced '.length));
	assert.deepEqual(untraced.sort(), [...['empty', 'options', 'dir', 'fork', 'forkshell', 'moved', 'deleted', 'spawn', 'execfile'].map(name => path.join(dir, name, 'node')), process.execPath, 'node'].sort(), 'Node without the settings (no env, other NODE_OPTIONS, other record place, fork with or without execPath and with shell, node by name, the record place changed in or settings removed from process.env) is untraced; inherited settings, NODE_OPTIONS that keeps them and other variables are traced');
	assert.deepEqual(all.filter(line => line.startsWith('exec ')).sort(), ['exec /bin/sh', 'exec sh', 'exec echo', 'exec true', `exec ${path.join(dir, 'exec-shell')}`, `exec ${path.join(dir, 'spawn-shell')}`, `exec ${path.join(dir, 'exec-callback-shell')}`, `exec ${path.join(dir, 'nodeish')}`].sort(), 'Other programs (also by spawn and execFile, and one whose name only starts with node) and the shell (the default of execSync and shell: true, and one given to execSync, spawnSync and exec) are recorded; fork with shell is Node');
	assert.deepEqual(all.filter(line => line.startsWith('node ')).map(line => line.slice('node '.length)).sort(), [...['extended', 'empty', 'options', 'dir', 'unrelated', 'plain', 'fork', 'forkshell', 'moved', 'deleted', 'spawn', 'execfile'].map(name => path.join(dir, name, 'node')), 'node'].sort(), 'Node started by another path (a link, a name, the execPath of fork) is recorded; process.execPath is not');
	assert.equal(all.filter(line => line === `read ${path.join(dir, 'child.txt')}`).length, 3, 'Each inheriting child (spawn, spawn with extra options, fork) records its own reads');
	assert.equal(files.length, 4, 'The parent and the three inheriting children each have a record');
}));

test('trace-reads: every process records alike, a second loaded copy does not record twice, and ESM imports and recursive listings are recorded', () => withTempDir({
	'lib.js': 'module.exports = 1;\n', 'data.txt': 'D', 'm.mjs': 'export const value = 2;\n', 'n.mjs': "import { value } from './m.mjs'; export default value;\n", 'deep/a/b.txt': 'B',
	'main.js': [
		"const fs = require('node:fs'); const path = require('node:path');",
		"require('./lib.js'); fs.readFileSync(path.join(__dirname, 'data.txt'));",
		"fs.readdirSync(path.join(__dirname, 'deep'), { recursive: true }); fs.readdirSync(path.join(__dirname, 'deep'));",
		"import('./n.mjs').then(module => console.log(module.default));",
		''
	].join('\n')
}, raw => {
	// 記録の行は実パスで書かれる（一時ディレクトリがリンクを通る環境でも、期待するパスを実パスから作る）。
	const dir = fs.realpathSync(raw);
	const second = path.join(dir, 'second-trace.js');
	fs.copyFileSync(TRACE, second);
	const result = traced(dir, 'main.js', { env: { NODE_OPTIONS: `${OPTIONS} --require ${JSON.stringify(second)}` } });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), '2');
	const { files, all } = lines(path.join(dir, 'logs'));
	assert.equal(files.length, 1);
	for (const line of [`load ${path.join(dir, 'main.js')}`, `load ${path.join(dir, 'lib.js')}`, `read ${path.join(dir, 'data.txt')}`, `load ${path.join(dir, 'n.mjs')}`, `load ${path.join(dir, 'm.mjs')}`, `tree ${path.join(dir, 'deep')}`, `list ${path.join(dir, 'deep')}`]) {
		assert.equal(all.filter(entry => entry === line).length, 1, `${line} is recorded once (the second copy of the tracer does not record)`);
	}
}));

test('trace-reads: worker threads record into the process record, and a removed record place does not change the program', () => withTempDir({
	'data.txt': 'D',
	'other.txt': 'O',
	'main.js': "const { Worker } = require('node:worker_threads'); const path = require('node:path');\nnew Worker(`require('node:fs').readFileSync(${JSON.stringify(path.join(__dirname, 'other.txt'))})`, { eval: true, env: {} }).on('exit', () => new Worker(`require('node:fs').readFileSync(${JSON.stringify(path.join(__dirname, 'data.txt'))})`, { eval: true }).on('exit', () => console.log(require('node:fs').readFileSync(path.join(__dirname, 'data.txt'), 'utf8'))));\n"
}, raw => {
	// 記録の行は実パスで書かれる（一時ディレクトリがリンクを通る環境でも、期待するパスを実パスから作る）。
	const dir = fs.realpathSync(raw);
	const result = traced(dir, 'main.js');
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), 'D');
	const { files, all } = lines(path.join(dir, 'logs'));
	assert.equal(files.length, 1);
	assert.equal(all.filter(line => line === `read ${path.join(dir, 'data.txt')}`).length, 2, 'The worker and the main thread each record the read');
	assert.ok(all.includes('untraced worker_threads.Worker') && !all.includes(`read ${path.join(dir, 'other.txt')}`), 'A worker given another env does not record, and is recorded as untraced');
	assert.equal(all.filter(line => line.startsWith('untraced ')).length, 1, 'A worker with no env given is not untraced');
	fs.writeFileSync(path.join(dir, 'inherit.js'), "const { Worker, SHARE_ENV } = require('node:worker_threads');\nnew Worker('0', { eval: true, env: { ...process.env } }); new Worker('0', { eval: true, env: SHARE_ENV });\n");
	const inherit = traced(dir, 'inherit.js', { logs: path.join(dir, 'logs-inherit') });
	assert.equal(inherit.status, 0, inherit.stderr);
	assert.ok(!lines(path.join(dir, 'logs-inherit')).all.some(line => line.startsWith('untraced ')), 'A worker given an env that keeps the trace settings, or SHARE_ENV, is not untraced');
	fs.writeFileSync(path.join(dir, 'w.js'), '0;\n');
	fs.writeFileSync(path.join(dir, 'moved.js'), "process.env.KOGAI_TRACE_DIR = require('node:path').join(__dirname, 'elsewhere');\nnew (require('node:worker_threads').Worker)(require('node:path').join(__dirname, 'w.js'));\n");
	const moved = traced(dir, 'moved.js', { logs: path.join(dir, 'logs-moved') });
	assert.equal(moved.status, 0, moved.stderr);
	assert.ok(lines(path.join(dir, 'logs-moved')).all.includes('untraced worker_threads.Worker'), 'A worker without options takes the process.env of the time it starts, and is untraced when the record place there was changed');
	const gone = traced(dir, 'main.js', { logs: path.join(dir, 'logs-removed'), create: false });
	assert.equal(gone.status, 0, gone.stderr);
	assert.equal(gone.stdout.trim(), 'D', 'Reads still work when the record place is gone');
	assert.ok(!fs.existsSync(path.join(dir, 'logs-removed')));
	// 記録の置き場所が後からできたときは、そこから書く（書けなかった行の後も記録を続ける）。
	fs.writeFileSync(path.join(dir, 'late.js'), "const fs = require('node:fs'); const path = require('node:path');\nfs.readFileSync(path.join(__dirname, 'other.txt')); fs.mkdirSync(process.env.KOGAI_TRACE_DIR); fs.readFileSync(path.join(__dirname, 'data.txt'));\n");
	const late = traced(dir, 'late.js', { logs: path.join(dir, 'logs-late'), create: false });
	assert.equal(late.status, 0, late.stderr);
	assert.ok(lines(path.join(dir, 'logs-late')).all.includes(`read ${path.join(dir, 'data.txt')}`), 'Records are written after a write failed');
}));

test('trace-reads: on a Node without module.registerHooks, require is recorded through the module loaders, and writing a record is not recorded or thrown when appendFileSync goes through fs.openSync', () => withTempDir({
	'lib.js': 'module.exports = 1;\n', 'data.txt': 'D',
	// 古い Node をまねる: module.registerHooks がなく、appendFileSync が（呼出しの時点の）fs.openSync を通る。trace-reads.js より先に読み込む。
	'old-node.js': [
		"const fs = require('node:fs');",
		"delete require('node:module').registerHooks;",
		"fs.appendFileSync = function appendFileSync(file, data) { const fd = fs.openSync(file, 'a'); try { fs.writeSync(fd, data); } finally { fs.closeSync(fd); } };",
		''
	].join('\n'),
	'main.js': "require('./lib.js'); console.log(require('node:fs').readFileSync(require('node:path').join(__dirname, 'data.txt'), 'utf8'));\n"
}, raw => {
	// 記録の行は実パスで書かれる（一時ディレクトリがリンクを通る環境でも、期待するパスを実パスから作る）。
	const dir = fs.realpathSync(raw);
	const env = { NODE_OPTIONS: `--require ${JSON.stringify(path.join(dir, 'old-node.js'))} ${OPTIONS}` };
	const result = traced(dir, 'main.js', { env });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.trim(), 'D');
	const { all } = lines(path.join(dir, 'logs'));
	for (const line of [`load ${path.join(dir, 'main.js')}`, `load ${path.join(dir, 'lib.js')}`, `read ${path.join(dir, 'data.txt')}`]) assert.ok(all.includes(line), `${line} is recorded`);
	assert.ok(!all.some(line => line.includes(path.join(dir, 'logs'))), 'The record itself is not recorded');
	const gone = traced(dir, 'main.js', { env, logs: path.join(dir, 'logs-removed'), create: false });
	assert.equal(gone.status, 0, gone.stderr);
	assert.equal(gone.stdout.trim(), 'D', 'Loading modules still works when the record place is gone');
}));

test('trace-reads: the wrapped functions pass this, util.promisify of a wrapped function is recorded and keeps its result, a failed record changes nothing, and a relative Buffer path is made absolute', () => withTempDir({
	'w.txt': 'W',
	// trace-reads.js より先に読み込み、包む名前の関数（openAsBlob）を、引数が 'this?' のとき this を返すものにする。
	'this-shim.js': "const fs = require('node:fs'); const openAsBlob = fs.openAsBlob; fs.openAsBlob = function (file, ...rest) { return file === 'this?' ? this : openAsBlob.call(this, file, ...rest); };\n",
	'main.js': [
		"const fs = require('node:fs'); const util = require('node:util'); const cp = require('node:child_process');",
		'(async () => {',
		'	const marker = {};',
		"	const kept = fs.openAsBlob.call(marker, 'this?') === marker;",
		"	const result = await util.promisify(cp.execFile)(process.execPath, ['-e', \"process.stdout.write('x')\"], { env: {} });",
		// 記録が例外になる引数（ホストのある file: の URL。fileURLToPath が投げる）でも、元の関数の戻り値・例外の形を変えない。
		"	const hostExists = fs.existsSync(new URL('file://remote-host/x'));",
		"	let pending; try { pending = fs.promises.readFile(new URL('file://remote-host/x')); } catch { pending = null; }",
		"	const settled = pending ? await pending.then(() => 'resolved', () => 'rejected') : 'thrown';",
		"	console.log(JSON.stringify({ kept, result, w: fs.readFileSync(Buffer.from('w.txt'), 'utf8'), hostExists, settled }));",
		'})();',
		''
	].join('\n')
}, raw => {
	// 記録の行は実パスで書かれる（一時ディレクトリがリンクを通る環境でも、期待するパスを実パスから作る）。
	const dir = fs.realpathSync(raw);
	const result = traced(dir, 'main.js', { env: { NODE_OPTIONS: `--require ${JSON.stringify(path.join(dir, 'this-shim.js'))} ${OPTIONS}` } });
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), { kept: true, result: { stdout: 'x', stderr: '' }, w: 'W', hostExists: false, settled: 'rejected' }, 'this reaches the original function, util.promisify(execFile) still gives { stdout, stderr }, and a failed record does not change a result (false) or turn a rejected Promise into a thrown error');
	const { all } = lines(path.join(dir, 'logs'));
	assert.ok(all.includes(`untraced ${process.execPath}`), 'util.promisify of a wrapped function goes through the record (its util.promisify.custom is wrapped too)');
	assert.ok(all.includes(`read ${path.join(dir, 'w.txt')}`), 'A relative Buffer path is made absolute from the working directory');
}));
