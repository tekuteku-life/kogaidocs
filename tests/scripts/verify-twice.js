#!/usr/bin/env node
/*
 * Stage 8 の検証（開発プロセス定義書 Stage 8・4.6）。package.json の test を同一コードで2回（--runs で変更可）実行し、
 * 各回の前後の SHA-256 の照合、検証したコードの SHA-256 の集約値（docs/ を除く）、件数・時間・終了コード、
 * 試験ファイルごとの件数、時間のかかる試験、本番モジュール（js/*.js）のカバレッジの表を Markdown で出す。
 * 作業ツリーの js/*.js のうち、カバレッジの出力にないもの（どの試験も読み込まないもの）も問題とする。
 * JUnit 形式の出力を、--out の中に回ごとに保存する（試験ファイルごとの件数と所要時間に使う）。
 * --out は作業ツリーの外に置く（中に置くと、記録が未追跡のファイルとして集約値・空白の検査に入るため、終了コード 2 とする）。
 * 使い方: node tests/scripts/verify-twice.js [--out <作業ツリーの外のディレクトリ>] [--runs <回数>] [--root <リポジトリ>]
 *         node tests/scripts/verify-twice.js --report-only <ディレクトリ>（保存した記録から表を作り直す）
 * 終了コード: 0 全件合格・fail/cancelled/skipped/todo 0・Line 100%・Branch 95%以上・SHA 不変、1 それ以外、2 引数の誤り・git がない
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { git, UNTRACKED } = require('./lib/git');

const THRESHOLDS = { line: 100, branch: 95 };

/** 追跡対象と無視されていない未追跡のファイルの SHA-256 の一覧（ファイル名 → ハッシュ）。 */
function snapshot(root) {
	const listed = git([...UNTRACKED, '--cached'], root);
	if (listed.error || listed.status !== 0) throw new Error('git ls-files に失敗した（Git の作業ツリーで実行する）');
	const hashes = {};
	for (const file of listed.stdout.split('\0').filter(Boolean).sort()) {
		const full = path.join(root, file);
		if (fs.existsSync(full) && fs.statSync(full).isFile()) hashes[file] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
	}
	return hashes;
}

/** 検証したコードの SHA-256 の集約値（docs/ を除くファイルの「名前 ハッシュ」の並びのハッシュ）。 */
function digestOf(hashes) {
	const lines = Object.keys(hashes).filter(file => !file.startsWith('docs/')).sort().map(file => `${file} ${hashes[file]}`);
	return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** 今のコードの集約値（precheck.js --verified が使う）。 */
function codeDigest(root) {
	return digestOf(snapshot(root));
}

/** 2つの一覧の差（追加・削除・変更のファイル名）。 */
function compareSnapshots(before, after) {
	const changed = [];
	for (const file of new Set([...Object.keys(before), ...Object.keys(after)])) if (before[file] !== after[file]) changed.push(file);
	return changed.sort();
}

/** node --test の出力から、件数と時間を取り出す。 */
function parseSummary(log) {
	const number = name => {
		const found = log.match(new RegExp(`^ℹ ${name} ([0-9.]+)`, 'm'));
		return found ? Number(found[1]) : null;
	};
	return { tests: number('tests'), pass: number('pass'), fail: number('fail'), cancelled: number('cancelled'), skipped: number('skipped'), todo: number('todo'), durationMs: number('duration_ms') };
}

/** カバレッジの表から、ファイルのパスごとの Line・Branch・Funcs を取り出す（ディレクトリの段をたどってパスを作る）。 */
function parseCoverage(log) {
	const coverage = {};
	const stack = [];
	for (const raw of log.split('\n')) {
		const found = raw.match(/^ℹ( +)([^|]+?)\s*\|\s*([0-9.]*)\s*\|\s*([0-9.]*)\s*\|\s*([0-9.]*)\s*\|/);
		if (!found || found[2] === 'file' || found[2] === 'all files') continue;
		const depth = found[1].length - 1;
		stack.length = depth;
		stack[depth] = found[2].trim();
		if (found[3] !== '') coverage[stack.join('/')] = { line: Number(found[3]), branch: Number(found[4]), funcs: Number(found[5]) };
	}
	return coverage;
}

const unescapeXml = value => value.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** JUnit 形式の出力から、試験ファイルごとの件数と、試験ごとの所要時間を取り出す（ファイルは root からの相対）。 */
function parseJunitByFile(xml, root) {
	const files = {};
	const tests = [];
	for (const found of xml.matchAll(/<testcase name="([^"]*)" time="([\d.]+)"[^>]*?file="([^"]*)"[^>]*?(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
		const file = path.relative(root, unescapeXml(found[3]));
		const failed = /<failure\b/.test(found[4] || '');
		files[file] = files[file] || { tests: 0, failed: 0 };
		files[file].tests++;
		if (failed) files[file].failed++;
		tests.push({ file, name: unescapeXml(found[1]), ms: Number(found[2]) * 1000 });
	}
	return { files, tests };
}

/** 本番モジュール（js/ 直下）のカバレッジの基準を確かめ、不足の一覧を返す。 */
function coverageShortfalls(coverage) {
	return Object.entries(coverage).filter(([file]) => /^js\/[^/]+\.js$/.test(file)).flatMap(([file, value]) => [
		...(value.line < THRESHOLDS.line ? [`${file} の Line ${value.line}% が ${THRESHOLDS.line}% 未満`] : []),
		...(value.branch < THRESHOLDS.branch ? [`${file} の Branch ${value.branch}% が ${THRESHOLDS.branch}% 未満`] : [])
	]);
}

/**
 * 実行の記録から、検証記録に貼る Markdown と問題の一覧を作る。
 * runs: [{ status, log, junit?: { files, tests } }]、sha: { count, digest, changedByRun: [[...]] }
 */
function renderReport(runs, sha) {
	const problems = [];
	const lines = ['| 検査 | 結果 |', '| :--- | :--- |'];
	runs.forEach((run, index) => {
		const summary = parseSummary(run.log);
		lines.push(`| \`npm test\`（${index + 1}回目${index ? '、同一コード' : ''}） | ${summary.pass}/${summary.tests}件成功、fail ${summary.fail}・cancelled ${summary.cancelled}・skipped ${summary.skipped}・todo ${summary.todo}、${Math.round(summary.durationMs)}ms、終了コード${run.status} |`);
		if (run.status !== 0 || summary.tests === null || summary.fail !== 0 || summary.cancelled !== 0 || summary.skipped !== 0 || summary.todo !== 0) problems.push(`${index + 1}回目の npm test が全件合格でない（fail・cancelled・skipped・todo のいずれかがある、または終了コードが 0 でない）`);
	});
	const changed = [...new Set(sha.changedByRun.flat())];
	lines.push(`| SHA-256 照合 | 追跡対象と未追跡の新規ファイルの計${sha.count}ファイルについて、${runs.length}回の実行の前後で${changed.length ? `変更があった: ${changed.join('、')}` : '変更がないことを確認した'} |`);
	lines.push(`| 検証したコードの SHA-256 | ${sha.digest}（docs/ を除く。コミットの前に \`precheck.js --verified\` で今のコードと照合する） |`);
	if (changed.length) problems.push(`実行の前後でファイルが変わった: ${changed.join('、')}`);
	const coverages = runs.map(run => parseCoverage(run.log));
	const modules = [...new Set(coverages.flatMap(coverage => Object.keys(coverage)))].filter(file => /^js\/[^/]+\.js$/.test(file)).sort();
	lines.push('', `| モジュール | Line % | ${runs.map((_, index) => `Branch %（${index + 1}回目）`).join(' | ')} |`, `| :--- | ---: | ${runs.map(() => '---:').join(' | ')} |`);
	for (const file of modules) {
		const lineValues = [...new Set(coverages.map(coverage => coverage[file]?.line).filter(value => value !== undefined))].map(value => value.toFixed(2));
		lines.push(`| \`${file}\` | ${lineValues.join('・')} | ${coverages.map(coverage => coverage[file] ? coverage[file].branch.toFixed(2) : '—').join(' | ')} |`);
	}
	coverages.forEach((coverage, index) => problems.push(...coverageShortfalls(coverage).map(message => `${index + 1}回目: ${message}`)));
	if (!modules.length) problems.push('本番モジュールのカバレッジが出力にない');
	// どの試験も読み込まない本番モジュールはカバレッジの出力に現れないため、作業ツリーの js/*.js の一覧と照合する。
	for (const file of sha.modules || []) coverages.forEach((coverage, index) => { if (!coverage[file]) problems.push(`${index + 1}回目: 本番モジュール ${file} がカバレッジの出力にない（どの試験も読み込んでいない）`); });
	const junit = runs[0] && runs[0].junit;
	if (junit) {
		lines.push('', '| 試験ファイル | 件数 |', '| :--- | ---: |');
		for (const file of Object.keys(junit.files).sort()) lines.push(`| \`${file}\` | ${junit.files[file].tests} |`);
		lines.push('', '| 時間のかかる試験（1回目） | ファイル | 所要時間 |', '| :--- | :--- | ---: |');
		for (const test of [...junit.tests].sort((a, b) => b.ms - a.ms).slice(0, 10)) lines.push(`| ${test.name.replace(/\|/g, '\\|')} | \`${test.file}\` | ${Math.round(test.ms)}ms |`);
	}
	return { markdown: lines.join('\n'), problems };
}

// JUnit の出力先を渡す環境変数。パスはコマンドの文字に入れない（シェルは変数の値の中の $(…)・逆引用符・$名前 を展開・実行せず、
// cmd.exe も %名前% の展開を1回だけ行い、値の中の %名前% を展開し直さない。Windows のパスは " を含められないので引用も閉じない）。
const JUNIT_VARIABLE = 'KOGAI_VERIFY_JUNIT';

/** package.json の test の node コマンドに、JUnit の出力（先は環境変数 JUNIT_VARIABLE）を加えたコマンドを作る（node で始まらなければそのまま）。 */
function testCommand(root, platform = process.platform) {
	const script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.test;
	const destination = platform === 'win32' ? `"%${JUNIT_VARIABLE}%"` : `"$${JUNIT_VARIABLE}"`;
	return script.replace(/^node\s/, `node --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=${destination} `);
}

function parseArgs(argv) {
	const options = { root: path.resolve(__dirname, '../..'), runs: 2 };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		if (['--out', '--runs', '--root', '--report-only'].includes(argv[i]) && value === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--out') { options.out = path.resolve(value); i++; }
		else if (argv[i] === '--runs') { options.runs = Number(value); i++; }
		else if (argv[i] === '--root') { options.root = path.resolve(value); i++; }
		else if (argv[i] === '--report-only') { options.reportOnly = path.resolve(value); i++; }
		else return { error: `不明な引数: ${argv[i]}` };
	}
	if (!Number.isInteger(options.runs) || options.runs < 1) return { error: '--runs には 1 以上の整数を指定する' };
	// 外: 上のディレクトリ（..）か、その下か、別のドライブ（Windows で relative が絶対パスになる）。「..records」のような名前は中。
	const relative = options.out ? path.relative(options.root, options.out) : '..';
	const outside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
	if (!outside) return { error: `--out は作業ツリー（${options.root}）の外に置く` };
	return options;
}

function main(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`verify-twice: ${options.error}`);
		return 2;
	}
	let runs;
	let sha;
	try {
		if (options.reportOnly) {
			const record = JSON.parse(fs.readFileSync(path.join(options.reportOnly, 'record.json'), 'utf8'));
			runs = record.runs.map((run, index) => {
				const junitFile = path.join(options.reportOnly, `run_${index + 1}.junit.xml`);
				return { ...run, log: fs.readFileSync(path.join(options.reportOnly, `run_${index + 1}.log`), 'utf8'), junit: fs.existsSync(junitFile) ? parseJunitByFile(fs.readFileSync(junitFile, 'utf8'), record.root || options.root) : null };
			});
			sha = record.sha;
		} else {
			// Git の外などの環境の誤りで止まるときに空の記録の置き場所を残さないよう、最初の snapshot の後に作る。
			let previous = snapshot(options.root);
			const out = options.out || fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-verify-'));
			fs.mkdirSync(out, { recursive: true });
			runs = [];
			const changedByRun = [];
			for (let index = 0; index < options.runs; index++) {
				const junitPath = path.join(out, `run_${index + 1}.junit.xml`);
				// Node は親の NODE_V8_COVERAGE を、env から除いても子に渡す。undefined を明示すると子に渡さない（npm test は自分の網羅のフォルダを作る）。
				const { NODE_TEST_CONTEXT, ...rest } = process.env;
				const env = { ...rest, NODE_V8_COVERAGE: undefined, [JUNIT_VARIABLE]: junitPath };
				const started = Date.now();
				const result = spawnSync(testCommand(options.root), { cwd: options.root, env, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
				const log = `${result.stdout || ''}${result.stderr || ''}`;
				fs.writeFileSync(path.join(out, `run_${index + 1}.log`), log);
				runs.push({ status: result.status, ms: Date.now() - started, log, junit: fs.existsSync(junitPath) ? parseJunitByFile(fs.readFileSync(junitPath, 'utf8'), options.root) : null });
				const current = snapshot(options.root);
				changedByRun.push(compareSnapshots(previous, current));
				previous = current;
			}
			sha = { count: Object.keys(previous).length, digest: digestOf(previous), changedByRun, modules: Object.keys(previous).filter(file => /^js\/[^/]+\.js$/.test(file)).sort() };
			fs.writeFileSync(path.join(out, 'record.json'), JSON.stringify({ root: options.root, runs: runs.map(({ status, ms }) => ({ status, ms })), sha }, null, '\t'));
			console.log(`verify-twice: 記録の置き場所 ${out}`);
		}
	} catch (error) {
		console.error(`verify-twice: ${error.message}`);
		return 2;
	}
	const report = renderReport(runs, sha);
	console.log(report.markdown);
	for (const problem of report.problems) console.log(`問題: ${problem}`);
	return report.problems.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { JUNIT_VARIABLE, THRESHOLDS, snapshot, digestOf, codeDigest, compareSnapshots, parseSummary, parseCoverage, parseJunitByFile, coverageShortfalls, renderReport, testCommand, parseArgs, main };
