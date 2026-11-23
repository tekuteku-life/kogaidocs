#!/usr/bin/env node
/*
 * 不安定な試験の検出（開発プロセス定義書 Stage 4・4.6）。指定の試験ファイルを N 回ずつ繰り返し実行する。
 * 試験ごとの所要時間は JUnit 形式の出力から取り、ファイルごとの失敗の回数と、時間のかかる試験の表を出す。
 * 所要時間は、試験ごとの自身の上限（上限の表 tests/scripts/stress/test-limits.json の limitMs。runner の timeoutMs・node:test の timeout）の
 * 半分と比べる。表にない試験は --max-test-ms（指定したとき）と比べ、exempt の試験は比べない。
 * 使い方: node tests/scripts/repeat-tests.js --times <N> [--root <リポジトリ>] [--coverage] [--load <数>] [--limits <上限の表>] [--max-test-ms <ms>] <試験ファイル>...
 *   --load: CPU に負荷をかける子プロセスを、実行中に並行して動かす数
 *   --limits: 上限の表（既定は <リポジトリ>/tests/scripts/stress/test-limits.json。なければ表なし）
 *   --max-test-ms: 上限の表にない試験の所要時間の上限（そのまま比べる）
 * 終了コード: 0 全回合格かつ上限内、1 失敗・上限超過・上限の表の試験名が実行結果にない、2 引数の誤り（-- で始まる知らない引数、ない --root・試験ファイルを含む）・上限の表が読めない
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

/** 引数を解釈する。不正なら error を返す。 */
function parseArgs(argv) {
	const options = { times: 3, coverage: false, load: 0, maxTestMs: Infinity, files: [] };
	for (let i = 0; i < argv.length; i++) {
		if (['--root', '--times', '--load', '--limits', '--max-test-ms'].includes(argv[i]) && argv[i + 1] === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--root') options.root = path.resolve(argv[++i]);
		else if (argv[i] === '--times') options.times = Number(argv[++i]);
		else if (argv[i] === '--coverage') options.coverage = true;
		else if (argv[i] === '--load') options.load = Number(argv[++i]);
		else if (argv[i] === '--limits') options.limits = argv[++i];
		else if (argv[i] === '--max-test-ms') options.maxTestMs = Number(argv[++i]);
		else if (argv[i].startsWith('--')) return { error: `不明な引数: ${argv[i]}` };
		else options.files.push(argv[i]);
	}
	if (!Number.isInteger(options.times) || options.times < 1) return { error: '--times には 1 以上の整数を指定する' };
	if (!Number.isInteger(options.load) || options.load < 0) return { error: '--load には 0 以上の整数を指定する' };
	if (!(options.maxTestMs > 0)) return { error: '--max-test-ms には正の数を指定する' };
	if (!options.files.length) return { error: '試験ファイルを1つ以上指定する' };
	return options;
}

const unescapeXml = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** JUnit 形式の出力から、試験ごとの名前・所要時間（ms）・失敗の有無を取り出す。 */
function parseJunit(xml) {
	return [...xml.matchAll(/<testcase name="([^"]*)" time="([\d.]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)].map(found => ({
		name: unescapeXml(found[1]),
		ms: Number(found[2]) * 1000,
		failed: /<failure\b/.test(found[3] || '')
	}));
}

/** 上限の表を読み、規則を検査する。不正なら例外。 */
function loadLimits(file) {
	const table = JSON.parse(fs.readFileSync(file, 'utf8'));
	if (!Array.isArray(table.rules)) throw new Error(`${file} に rules の配列がない`);
	for (const rule of table.rules) {
		if (typeof rule.file !== 'string' || !rule.file) throw new Error(`${file}: file のない規則がある`);
		if ((rule.limitMs === undefined) === (rule.exempt === undefined)) throw new Error(`${file}: ${rule.file} の規則には limitMs か exempt のどちらか1つを書く`);
		if (rule.limitMs !== undefined && !(rule.limitMs > 0)) throw new Error(`${file}: ${rule.file} の limitMs は正の数とする`);
		if (rule.exempt !== undefined && !String(rule.exempt).trim()) throw new Error(`${file}: ${rule.file} の exempt には理由を書く`);
	}
	return table.rules;
}

const matchesFile = (pattern, file) => new RegExp(`^${pattern.split('*').map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}$`).test(file);

/** 試験（ファイル・名前）に当てる規則（試験名のある規則 > * のないファイルの規則 > * のある規則）。なければ null。 */
function ruleFor(rules, file, name) {
	const candidates = rules.filter(rule => matchesFile(rule.file, file) && (rule.name === undefined || rule.name === name));
	const rank = rule => rule.name !== undefined ? 0 : rule.file.includes('*') ? 2 : 1;
	return candidates.sort((a, b) => rank(a) - rank(b))[0] || null;
}

/**
 * 1回の実行（親の試験ランナーの子として振る舞わないよう NODE_TEST_CONTEXT を引き継がない）。
 * Node は親の NODE_V8_COVERAGE を、env から除いても子に渡す。undefined を明示すると子に渡さない
 * （--coverage でなければ網羅を集めず、--coverage のときは試験の実行が自分の網羅のフォルダを作る）。
 */
function runOnce(file, { coverage, cwd }) {
	const { NODE_TEST_CONTEXT, ...rest } = process.env;
	const env = { ...rest, NODE_V8_COVERAGE: undefined };
	const junit = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-repeat-')), 'result.xml');
	const args = ['--test', '--test-concurrency=1', ...(coverage ? ['--experimental-test-coverage'] : []), '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=junit', `--test-reporter-destination=${junit}`, file];
	const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	const tests = fs.existsSync(junit) ? parseJunit(fs.readFileSync(junit, 'utf8')) : [];
	fs.rmSync(path.dirname(junit), { recursive: true, force: true });
	return { status: result.status, tests };
}

/**
 * 実行結果をファイルごとにまとめる。上限: 規則の limitMs の半分、規則がなければ maxTestMs、exempt なら比べない。
 * 戻り値: { files: ファイルごとの集計, staleRules: 実行したファイルに当たる試験名のある規則のうち、その名前の試験が実行結果にないもの }
 */
function summarize(results, maxTestMs = Infinity, rules = []) {
	const byFile = new Map();
	for (const { file, status, tests } of results) {
		const entry = byFile.get(file) || { file, runs: 0, failures: 0, failedTests: new Set(), slowest: new Map() };
		entry.runs++;
		if (status !== 0) entry.failures++;
		for (const test of tests) {
			if (test.failed) entry.failedTests.add(test.name);
			entry.slowest.set(test.name, Math.max(entry.slowest.get(test.name) || 0, test.ms));
		}
		byFile.set(file, entry);
	}
	const files = [...byFile.values()].map(entry => {
		const slowest = [...entry.slowest.entries()].sort((a, b) => b[1] - a[1]).map(([name, ms]) => {
			const rule = ruleFor(rules, entry.file, name);
			return { name, ms, limit: rule ? (rule.exempt !== undefined ? Infinity : rule.limitMs / 2) : maxTestMs, exempt: rule?.exempt };
		});
		return { file: entry.file, runs: entry.runs, failures: entry.failures, failedTests: [...entry.failedTests], slowest: slowest.slice(0, 5), overLimit: slowest.filter(test => test.ms > test.limit) };
	});
	const run = [...byFile.values()];
	const staleRules = rules.filter(rule => rule.name !== undefined && run.some(entry => matchesFile(rule.file, entry.file)) && !run.some(entry => matchesFile(rule.file, entry.file) && entry.slowest.has(rule.name)));
	return { files, staleRules };
}

// 負荷の子プロセスの処理。親が止まって（異常終了を含む）親のプロセスが変わったら、自ら終わる（負荷が残り続けないように）。
// 親のプロセス番号は引数で受け取る（子が起動する前に親が止まると、子の process.ppid は最初から引き取り先になるため）。
const LOAD_WORKER = 'const parent = Number(process.argv[1]); for (let i = 1; ; i++) if (i % 1000000 === 0 && process.ppid !== parent) process.exit(0);';

/** CPU に負荷をかける子プロセスを起こし、止める関数を返す（関数の pids に子のプロセス番号）。 */
function startLoad(count) {
	const workers = Array.from({ length: count }, () => spawn(process.execPath, ['-e', LOAD_WORKER, String(process.pid)], { stdio: 'ignore' }));
	return Object.assign(() => workers.forEach(worker => worker.kill('SIGKILL')), { pids: workers.map(worker => worker.pid) });
}

function main(argv = process.argv.slice(2), { cwd = path.resolve(__dirname, '../..'), run = runOnce, load = startLoad } = {}) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`repeat-tests: ${options.error}`);
		return 2;
	}
	if (options.root) cwd = options.root;
	// ない試験ファイル（ない --root の下のファイルを含む）を、試験の失敗（終了コード 1）と区別して引数の誤りにする。
	const missing = options.files.filter(given => !fs.existsSync(path.resolve(cwd, given)) || !fs.statSync(path.resolve(cwd, given)).isFile());
	if (missing.length) {
		console.error(`repeat-tests: 試験ファイルがない: ${missing.join('、')}`);
		return 2;
	}
	const limitsFile = options.limits ? path.resolve(cwd, options.limits) : path.join(cwd, 'tests/scripts/stress/test-limits.json');
	let rules = [];
	try {
		if (options.limits || fs.existsSync(limitsFile)) rules = loadLimits(limitsFile);
	} catch (error) {
		console.error(`repeat-tests: 上限の表を読めない: ${error.message}`);
		return 2;
	}
	const stop = options.load ? load(options.load) : () => {};
	const results = [];
	try {
		for (const given of options.files) {
			// 上限の表と照合できるよう、リポジトリからの相対の形（/ 区切り）にそろえる。
			const file = path.relative(cwd, path.resolve(cwd, given)).split(path.sep).join('/');
			for (let i = 0; i < options.times; i++) results.push({ file, ...run(file, { coverage: options.coverage, cwd }) });
		}
	} finally {
		stop();
	}
	const summary = summarize(results, options.maxTestMs, rules);
	const show = test => `${test.name}（${Math.round(test.ms)}ms${test.exempt !== undefined ? '・比べない' : Number.isFinite(test.limit) ? ` / 上限 ${Math.round(test.limit)}ms` : ''}）`;
	console.log('| 試験ファイル | 実行 | 失敗 | 失敗した試験 | 上限を超えた試験 |');
	console.log('| :--- | ---: | ---: | :--- | :--- |');
	for (const entry of summary.files) console.log(`| ${entry.file} | ${entry.runs} | ${entry.failures} | ${entry.failedTests.join('、') || '—'} | ${entry.overLimit.map(show).join('、') || '—'} |`);
	console.log('\n| 試験ファイル | 時間のかかる試験（最大の所要時間 / 比べた上限） |\n| :--- | :--- |');
	for (const entry of summary.files) console.log(`| ${entry.file} | ${entry.slowest.map(show).join('、') || '—'} |`);
	for (const rule of summary.staleRules) console.log(`repeat-tests: 上限の表の試験が実行結果にない（表を直す）: ${rule.file}「${rule.name}」`);
	return summary.files.some(entry => entry.failures > 0 || entry.overLimit.length > 0) || summary.staleRules.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { parseArgs, parseJunit, loadLimits, ruleFor, runOnce, summarize, startLoad, main };
