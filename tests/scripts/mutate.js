#!/usr/bin/env node
/*
 * 変異の当て込み（開発プロセス定義書 Stage 4・Stage 7・4.6）。Gate 2 の前（実装の下書きへ）と、Gate 3 の前（最終のコードへ）に実装者が実行する。
 * リポジトリを一時ディレクトリへ写し、変異を1つずつ入れて指定の試験を実行し、検出（失敗）・生存（合格）の表を出す。
 * 作業ツリーは変えない（実行の前後で、作業ツリーのファイルの SHA-256 が変わらないことを確かめる）。
 * 使い方:
 *   node tests/scripts/mutate.js --spec <変異の一覧.json> [--root <リポジトリ>] [--timeout <ms>]
 *     一覧: [{ "name": "…", "file": "js/x.js", "find": "…", "replace": "…", "occurrence": 1（省略可）,
 *             "tests": ["tests/unit/x.test.js"], "skipPattern": "除く試験の名前の形（省略可。--test-skip-pattern として渡す）",
 *             "equivalent": "等価の理由（省略可）", "expect": "pass（省略可。合格を期待する変異）" }]
 *   node tests/scripts/mutate.js --auto <ファイル> (--lines <開始-終了>[,<開始-終了>...] | --since <下書きの写し>) --tests <試験>[,<試験>...]
 *                                [--skip-pattern <除く試験の名前の形>] [--equivalents <等価の一覧.json>] [--max <件数>] [--root] [--timeout]
 *     比較の反転・論理演算の入替え・否定の除去・真偽値の反転を、指定の行の範囲のコード（文字列・コメント・正規表現を除く）に自動で入れる。
 *     --since: 下書きの写し（Gate 2 に出した時点のファイル）から今のファイルへ変わった行（削除の前後の行を含む）を範囲とする。
 *     --equivalents: { "<行>:<列> <演算子>": "等価の理由" }（表の「変異」の列の名前）。一致する変異がない指定は問題とする。
 *     --lines の範囲がファイルの行の外なら引数の誤り、範囲に変異の候補が0件なら問題（終了コード 1）とする。
 *     --since で変わった行に候補が0件のときは、そのことを出して終了コード 0 とする（変わった行がコメントだけなど）。
 *   --max: 自動の変異の件数の上限（正の整数）。--timeout: 1回の試験の実行の上限（ms。既定 600000）。
 * 試験は新しいプロセスグループで実行し、終わった後（時間切れを含む）にグループごと止める。試験の一時ファイルは、写しごとの一時ディレクトリ
 * （<写し>-tmp。TMPDIR・TMP・TEMP で渡す）に置かせ、試験の実行のたびに空にし、写しと一緒に消す。
 * SIGINT・SIGTERM・SIGHUP を受けたら、実行中の試験のプロセスグループを止め、写しを消してから終わる（終了コード 130・143・129）。
 * 一覧の項目の file・tests（--auto のファイルと --tests も）は、リポジトリの中の正規の形の相対パスで（絶対パスと、末尾の区切り・. と .. の要素・
 * 重なった区切りを含むパスを拒む。写しへの書込みと node の引数は与えたパスのまま使うので、検査したパスと同じ形に限る）、リンクと、写しに入らない
 * .git・node_modules（どの深さでも。大文字小文字を区別しない。Windows の短い名前も、実パスを長い名前に直して比べて拒む）を通らない
 * 実在するファイルに限る（写しの外のファイルを書き換えない・実行しない）。
 * tests は node の引数（node --test は glob として展開する）になるので、- で始まる項目と、glob の記号（* ? [ ] { } ( ) !、
 * Windows 以外では逃がしの \ も）を含む項目を拒む（{..,w}/t.test.js は写しの外の ../t.test.js に展開され、\ を含む名前は node が見つけない）。
 * 一覧の replace・mutated は写しの中で試験として実行されるコードなので、一覧（と等価の一覧）は、コードと同じく信頼できるものだけを使う
 * （上の検査は誤りを防ぐもので、悪意のある一覧は防がない。他人の一覧は、中身を読んで確かめてから使う）。
 * 項目の誤り、読めない・JSON でない一覧と等価の一覧、ない対象のファイルと下書き、git がない（--since）は、変異を当てる前に終了コード 2 とする。
 * 手順: 変異なしで試験ごとの基準の実行を行い（合格しなければ中止）、変異を1つずつ入れて node --check のあと試験を実行する。
 * 結果: 検出／検出（時間切れ）／生存／生存（等価: 理由）／無効（置換が成立しない）／無効（構文が壊れる）、
 *       合格を期待する変異は 合格／不合格／不合格（時間切れ）。
 * 終了コード: 0 生存（等価の理由なし）・無効・不合格・基準の失敗・一致しない等価の指定がない、1 それ以外、
 *   2 引数の誤り（項目の誤り・読めないファイルを含む）・git がない（--since）・実行の間に作業ツリーが変わった（それまでの表を出す）
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { stripScriptNoise } = require('./lib/js-lexer');
const { git, DIFF_FORMAT } = require('./lib/git');

/** 文字列の出現の数。 */
function countOccurrences(text, find) {
	let count = 0;
	for (let index = text.indexOf(find); index >= 0; index = text.indexOf(find, index + find.length)) count++;
	return count;
}

/** 変異を1つ入れる。occurrence がなければ一致がちょうど1つであることを要求する（置換が成立しない変異を見逃さない）。 */
function applyMutation(text, { find, replace, occurrence }) {
	if (typeof find !== 'string' || !find) throw new Error('find が空である');
	const count = countOccurrences(text, find);
	if (occurrence === undefined && count !== 1) throw new Error(`find の一致が ${count} 件である（1件である必要がある。複数なら occurrence を指定する）`);
	if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1 || occurrence > count)) throw new Error(`occurrence ${occurrence} が一致の件数 ${count} の範囲外である`);
	// 件数と同じく、重ならない一致の n 番目を探す。
	let index = text.indexOf(find);
	for (let n = 1; n < (occurrence || 1); n++) index = text.indexOf(find, index + find.length);
	return text.slice(0, index) + replace + text.slice(index + find.length);
}

// 自動の演算子変異。[名前, 正規表現, 置換]。
const OPERATORS = [
	['=== → !==', /===/g, '!=='],
	['!== → ===', /!==/g, '==='],
	['&& → ||', /&&/g, '||'],
	['|| → &&', /\|\|/g, '&&'],
	['<= → <', /<=/g, '<'],
	['>= → >', />=/g, '>'],
	['< → <=', /(?<![<=!])<(?![<=])/g, '<='],
	['> → >=', /(?<![>=!-])>(?![>=])/g, '>='],
	['true → false', /\btrue\b/g, 'false'],
	['false → true', /\bfalse\b/g, 'true'],
	['否定の除去', /!(?=[\w$(])/g, '']
];

/** --lines の値（"10-20" または "10-20,30-35"）を [[開始, 終了], ...] にする。不正なら null。 */
function parseRanges(value) {
	if (!/^\d+-\d+(?:,\d+-\d+)*$/.test(value || '')) return null;
	const ranges = value.split(',').map(range => range.split('-').map(Number));
	return ranges.every(([from, to]) => from >= 1 && from <= to) ? ranges : null;
}

/** 下書きの写しから今のファイルへ変わった行の範囲（今のファイルの行番号。削除は前後の行）。 */
function changedRanges(draftFile, currentFile) {
	for (const file of [draftFile, currentFile]) if (!fs.existsSync(file)) throw new Error(`下書きとの差を取れない: ${file} がない`);
	const result = git(['diff', '--no-index', ...DIFF_FORMAT, '-U0', '--', draftFile, currentFile], process.cwd());
	if (result.error || ![0, 1].includes(result.status) || (result.status === 1 && !result.stdout)) throw new Error(`下書きとの差を取れない: ${(result.error?.message || result.stderr || '').split('\n')[0]}`);
	return [...result.stdout.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map(found => {
		const start = Number(found[1]);
		const count = found[2] === undefined ? 1 : Number(found[2]);
		return count === 0 ? [Math.max(1, start), start + 1] : [start, start + count - 1];
	});
}

/** 指定の行の範囲（[[開始, 終了], ...]）のコード（文字列・テンプレートの文字・コメント・正規表現を除く）に、演算子変異の候補を作る。 */
function autoMutations(text, ranges) {
	const original = text.split('\n');
	// 先頭の #! の行はコードではないので変異の対象にしない（同じ長さの空白にする）。
	const masked = stripScriptNoise(text.replace(/^#![^\n]*/, line => ' '.repeat(line.length)), { blankStrings: true }).split('\n');
	const mutants = [];
	const lines = [...new Set(ranges.flatMap(([from, to]) => Array.from({ length: Math.max(0, Math.min(to, original.length) - from + 1) }, (_, offset) => from - 1 + offset)))].sort((a, b) => a - b);
	for (const index of lines) {
		for (const [name, pattern, replacement] of OPERATORS) {
			for (const found of masked[index].matchAll(pattern)) {
				const line = original[index];
				const mutatedLine = line.slice(0, found.index) + replacement + line.slice(found.index + found[0].length);
				const lines = [...original];
				lines[index] = mutatedLine;
				mutants.push({ name: `${index + 1}:${found.index + 1} ${name}`, line: index + 1, mutated: lines.join('\n') });
			}
		}
	}
	return mutants;
}

/** リポジトリを一時ディレクトリへ写す（.git と node_modules は写さず、node_modules はあればリンクする）。 */
function copyRepository(root) {
	// 名前にプロセス番号を入れる（残った写しを作ったプロセスが分かり、試験が自分の写しだけを片付けられる）。
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kogai-mutate-${process.pid}-`));
	fs.cpSync(root, dir, { recursive: true, filter: source => !/(^|[\\/])(\.git|node_modules)([\\/]|$)/.test(path.relative(root, source)) });
	if (fs.existsSync(path.join(root, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
	return dir;
}

/** ディレクトリの中のファイル（.git・node_modules を除く）の SHA-256 の一覧。 */
function treeHashes(root) {
	const hashes = {};
	const walk = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === '.git' || entry.name === 'node_modules') continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.isFile()) hashes[path.relative(root, full)] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
		}
	};
	walk(root);
	return hashes;
}

/** プロセスグループごと止める（すでに終わっていれば何もしない）。Windows はプロセスグループがないため、子のプロセスが残りうる。 */
function stopGroup(pid) {
	if (!pid || process.platform === 'win32') return;
	try {
		process.kill(-pid, 'SIGKILL');
	} catch (error) {
		if (error.code !== 'ESRCH') throw error;
	}
}

// 実行中の試験のプロセスと、写し・その一時ディレクトリ（信号を受けたときの後始末に使う）。
const active = { pid: null, dir: null, tmp: null };

/**
 * 写しの中で試験を実行し、終了コードを返す Promise（時間切れは null）。
 * node --test は試験ファイルごとに子のプロセスを起こすため、親だけを止めると、無限ループの変異を実行している子が残る。
 * そのため新しいプロセスグループで起こし、終わった後（時間切れを含む）にグループごと止める。
 * tmp を与えると、試験の一時ファイル（os.tmpdir()）をそこに置かせ、終わった後に空にする（止めた試験のプロセスが作った写し・一時ファイルを残さない。
 * 一時ディレクトリの全体を掃除する処理は、mutate.js 自身に変異を入れたときにほかの実行の写しまで消しうるので使わない）。
 * 信号を受けたときに後始末できるよう、同期の spawnSync ではなく spawn で待つ。
 */
function runTests(dir, tests, timeout, tmp, skipPattern) {
	// Node は親の NODE_V8_COVERAGE を、env から除いても子に渡す。undefined を明示して、変異の試験で網羅を集めない。
	const { NODE_TEST_CONTEXT, ...rest } = process.env;
	const env = { ...rest, NODE_V8_COVERAGE: undefined, ...(tmp ? { TMPDIR: tmp, TMP: tmp, TEMP: tmp } : {}) };
	return new Promise(resolve => {
		// 試験の選び方は、mutate.js が作る --test-skip-pattern だけを渡す（tests には node の引数を入れさせない）。
		const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...(skipPattern ? [`--test-skip-pattern=${skipPattern}`] : []), ...tests], { cwd: dir, env, stdio: 'ignore', detached: process.platform !== 'win32' });
		active.pid = child.pid;
		let timedOut = false;
		// 時間切れでは親だけを止める。グループ（子の試験のプロセス）は exit の処理で止める。
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill('SIGKILL');
		}, timeout);
		child.on('exit', status => {
			clearTimeout(timer);
			stopGroup(child.pid);
			if (tmp) {
				fs.rmSync(tmp, { recursive: true, force: true });
				fs.mkdirSync(tmp);
			}
			active.pid = null;
			// 時間切れは null。それ以外でシグナルで止まった（status が null）ときは失敗として 1 を返す。
			resolve(timedOut ? null : status ?? 1);
		});
	});
}

/** SIGINT・SIGTERM・SIGHUP を受けたら、実行中の試験を止めて写しを消してから終わる処理を登録し、解除する関数を返す。 */
function installCleanup() {
	const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
	const handler = signal => {
		stopGroup(active.pid);
		for (const dir of [active.dir, active.tmp]) if (dir) fs.rmSync(dir, { recursive: true, force: true });
		console.error(`mutate: ${signal} を受けたので、実行中の試験を止めて写しを消した`);
		process.exit(codes[signal]);
	};
	for (const signal of Object.keys(codes)) process.on(signal, handler);
	return () => { for (const signal of Object.keys(codes)) process.off(signal, handler); };
}

/** 変異後のファイルの構文を確かめる（js のときだけ）。 */
function syntaxOk(file) {
	if (!file.endsWith('.js')) return true;
	return spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }).status === 0;
}

/**
 * 変異を順に入れて試験を実行する。mutants: [{ name, file, mutated（変異後の内容）| find/replace/occurrence, tests, equivalent?, expect? }]。
 * 戻り値: Promise<{ baseline: [{ tests, status }], results: [{ name, file, result, detail }] }>
 */
async function runMutants(root, mutants, { timeout = 600000 } = {}) {
	const before = treeHashes(root);
	const dir = copyRepository(root);
	const tmp = `${dir}-tmp`;
	fs.mkdirSync(tmp);
	Object.assign(active, { dir, tmp });
	const results = [];
	const baseline = [];
	try {
		// 基準の実行: 変異なしで、使う試験の組（試験と除く試験の名前の形）ごとに合格することを確かめる（不安定・元から落ちる試験で全変異が「検出」になるのを防ぐ）。
		for (const [tests, skipPattern] of [...new Set(mutants.map(mutant => JSON.stringify([mutant.tests, mutant.skipPattern ?? null])))].map(entry => JSON.parse(entry))) {
			const status = await runTests(dir, tests, timeout, tmp, skipPattern);
			baseline.push({ tests, ...(skipPattern ? { skipPattern } : {}), status });
		}
		if (baseline.some(entry => entry.status !== 0)) return { baseline, results };
		const originals = new Map();
		for (const mutant of mutants) {
			const target = path.join(dir, mutant.file);
			if (!originals.has(mutant.file)) originals.set(mutant.file, fs.readFileSync(target, 'utf8'));
			const original = originals.get(mutant.file);
			let mutated;
			try {
				mutated = mutant.mutated ?? applyMutation(original, mutant);
			} catch (error) {
				results.push({ name: mutant.name, file: mutant.file, result: '無効（置換が成立しない）', detail: error.message });
				continue;
			}
			fs.writeFileSync(target, mutated);
			try {
				if (!syntaxOk(target)) {
					results.push({ name: mutant.name, file: mutant.file, result: '無効（構文が壊れる）', detail: '' });
					continue;
				}
				const status = await runTests(dir, mutant.tests, timeout, tmp, mutant.skipPattern);
				let result;
				// 時間切れは、通常の変異では検出（試験が止まった）、合格を期待する変異では不合格とする。
				if (status === null) result = mutant.expect === 'pass' ? '不合格（時間切れ）' : '検出（時間切れ）';
				else if (mutant.expect === 'pass') result = status === 0 ? '合格' : '不合格';
				else if (status !== 0) result = '検出';
				else result = mutant.equivalent ? `生存（等価: ${mutant.equivalent}）` : '生存';
				results.push({ name: mutant.name, file: mutant.file, result, detail: '' });
			} finally {
				fs.writeFileSync(target, original);
			}
		}
		return { baseline, results };
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(tmp, { recursive: true, force: true });
		Object.assign(active, { dir: null, tmp: null });
		const after = treeHashes(root);
		const changed = Object.keys({ ...before, ...after }).filter(file => before[file] !== after[file]);
		// 実行の間に作業ツリーが変わったら、それまでの結果を付けて止める（結果は変わる前の内容に対するもの）。
		if (changed.length) throw Object.assign(new Error(`実行の間に作業ツリーが変わった（結果は使えない）: ${changed.join('、')}`), { partial: { baseline, results } });
	}
}

/** 結果が終了コード 1 に当たるか。 */
const isProblem = result => result === '生存' || result.startsWith('無効') || result.startsWith('不合格');

/** 等価の一覧を変異に当てる。戻り値: 一致する変異がない指定の名前。 */
function applyEquivalents(mutants, equivalents) {
	const names = new Set(mutants.map(mutant => mutant.name));
	for (const mutant of mutants) if (Object.hasOwn(equivalents, mutant.name)) mutant.equivalent = equivalents[mutant.name];
	return Object.keys(equivalents).filter(name => !names.has(name));
}

// 値を取る引数。
const VALUE_OPTIONS = new Set(['--spec', '--auto', '--lines', '--since', '--equivalents', '--tests', '--skip-pattern', '--max', '--root', '--timeout']);

function parseArgs(argv) {
	const options = { root: path.resolve(__dirname, '../..'), timeout: 600000, max: Infinity };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		if (VALUE_OPTIONS.has(argv[i]) && value === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--spec') { options.spec = value; i++; }
		else if (argv[i] === '--auto') { options.auto = value; i++; }
		else if (argv[i] === '--lines') { options.lines = value; i++; }
		else if (argv[i] === '--since') { options.since = value; i++; }
		else if (argv[i] === '--equivalents') { options.equivalents = value; i++; }
		else if (argv[i] === '--tests') { options.tests = value.split(',').filter(Boolean); i++; }
		else if (argv[i] === '--skip-pattern') { options.skipPattern = value; i++; }
		else if (argv[i] === '--max') { options.max = Number(value); i++; }
		else if (argv[i] === '--root') { options.root = path.resolve(value); i++; }
		else if (argv[i] === '--timeout') { options.timeout = Number(value); i++; }
		else return { error: `不明な引数: ${argv[i]}` };
	}
	if (!options.spec && !options.auto) return { error: '--spec か --auto を指定する' };
	if (options.auto && (!options.lines === !options.since || (options.lines && !parseRanges(options.lines)) || !options.tests?.length)) return { error: '--auto には --lines <開始-終了>[,…] か --since <下書きの写し> のどちらかと、--tests を指定する' };
	if (!(options.timeout > 0)) return { error: '--timeout には正の数を指定する' };
	if (options.max !== Infinity && (!Number.isInteger(options.max) || options.max < 1)) return { error: '--max には 1 以上の整数を指定する' };
	return options;
}

/**
 * root からの相対パス file が、正規の形で root の中を指すか（絶対パスでない・.. で外に出ない）。
 * 写しへの書込みと node の引数は file をそのまま使うので、検査に使う正規化したパスと同じ形に限る（末尾の区切りのある js/x.js/ は、
 * 正規化すると検査を通るが、写しの中で読めず、node も見つけない。./x.js・js//x.js・js/../x.js も同じく拒む）。
 */
function insideRoot(root, file) {
	if (path.isAbsolute(file)) return false;
	const relative = path.relative(root, path.resolve(root, file));
	if (relative.split(path.sep).join('/') !== file.split(path.sep).join('/')) return false;
	return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// 写しに入らない名前（copyRepository）。大文字小文字を区別しないファイルシステムでは Node_Modules も同じディレクトリなので、区別せずに比べる。
const UNCOPIED = /^(?:\.git|node_modules)$/i;

// node --test が glob として扱う記号。Windows 以外では \ が逃がし（\ を含む名前のファイルを node が見つけない）なので、それも含める。
const GLOB = path.sep === '\\' ? /[*?[\]{}()!]/ : /[*?[\]{}()!\\]/;

/**
 * root の中のパス file が、リンクを通らずに root の中の実在するファイルを指すか。
 * 写しの node_modules は作業ツリーへのリンクで、fs.cpSync はリポジトリの中のリンクを元の作業ツリーを指すリンクとして写すので、
 * node_modules の下とリンクを通るパスは、写しの中で書き換えても作業ツリーに届く。.git・入れ子の node_modules の下は写しにない。そのため除く。
 * 実パスは fs.realpathSync.native で比べる（Windows の 8.3 形式の短い名前 NODE_M~1・GIT~1 は UNCOPIED にかからず、JS の
 * fs.realpathSync は長い名前に直さないので、短い名前を通ると node_modules・.git の下でも比べた実パスが一致してしまう）。
 */
function repositoryFile(root, file) {
	const relative = path.relative(root, path.resolve(root, file));
	if (relative.split(path.sep).some(part => UNCOPIED.test(part))) return false;
	try {
		const full = path.join(root, relative);
		return fs.statSync(full).isFile() && fs.realpathSync.native(full) === path.join(fs.realpathSync.native(root), relative);
	} catch {
		return false;
	}
}

/**
 * 一覧の項目を検査し、誤りの文を返す（なければ null）。写しの外のファイルを書き換えない・実行しないよう、file と tests は root の中の正規の形の相対パスで、
 * リンクと .git・node_modules を通らない実在するファイルに限る。tests は node の引数（glob）になるので、- で始まる項目（--require=… など）と
 * glob の記号を含む項目を拒む。
 * 項目: name（文字列）・file・find（空でない文字列）か mutated（文字列）・tests（試験ファイルの空でない配列）・skipPattern（任意。空でない文字列）。
 * 一覧の replace・mutated は写しの中で試験として実行されるコードなので、一覧はコードと同じく信頼できるものだけを使う（この検査は誤りを防ぐもの）。
 */
function mutantError(root, mutant, index) {
	const at = `一覧の ${index + 1} 件目`;
	if (!mutant || typeof mutant !== 'object') return `${at}がオブジェクトでない`;
	if (typeof mutant.name !== 'string' || !mutant.name) return `${at}に name がない`;
	if (typeof mutant.file !== 'string' || !insideRoot(root, mutant.file)) return `${at}（${mutant.name}）の file がリポジトリの中のパスでない（絶対パス・..・正規の形でないパス（末尾の区切りなど）を含む）`;
	if (!repositoryFile(root, mutant.file)) return `${at}（${mutant.name}）の file（${mutant.file}）がない（リンク・.git・node_modules を通るパスを含む）`;
	if (typeof mutant.mutated !== 'string' && (typeof mutant.find !== 'string' || !mutant.find || typeof mutant.replace !== 'string')) return `${at}（${mutant.name}）に find・replace（または mutated）がない`;
	if (!Array.isArray(mutant.tests) || !mutant.tests.length || mutant.tests.some(test => typeof test !== 'string' || test.startsWith('-') || GLOB.test(test) || !insideRoot(root, test))) return `${at}（${mutant.name}）の tests がリポジトリの中のパスの配列でない（- で始まる項目・glob の記号を含む項目・絶対パス・正規の形でないパスを含む）`;
	const missing = mutant.tests.find(test => !repositoryFile(root, test));
	if (missing) return `${at}（${mutant.name}）の tests の ${missing} がない（リンク・.git・node_modules を通るパスを含む）`;
	if (mutant.skipPattern !== undefined && (typeof mutant.skipPattern !== 'string' || !mutant.skipPattern)) return `${at}（${mutant.name}）の skipPattern が空でない文字列でない`;
	return null;
}

/** 一覧の変異（--spec）か、自動の変異（--auto）を読む。引数・ファイル・環境の誤りは { error }、候補がないときは { none: 終了コード }。 */
function loadMutants(options) {
	if (options.spec) {
		const mutants = JSON.parse(fs.readFileSync(path.resolve(options.spec), 'utf8'));
		if (!Array.isArray(mutants) || !mutants.length) return { error: '変異の一覧が空である' };
		const problem = mutants.map((mutant, index) => mutantError(options.root, mutant, index)).find(Boolean);
		return problem ? { error: problem } : { mutants };
	}
	const problem = mutantError(options.root, { name: '--auto', file: options.auto, find: 'x', replace: 'x', tests: options.tests, skipPattern: options.skipPattern }, 0);
	if (problem) return { error: problem.replace('一覧の 1 件目（--auto）', '--auto') };
	const current = path.join(options.root, options.auto);
	const text = fs.readFileSync(current, 'utf8');
	const ranges = options.lines ? parseRanges(options.lines) : changedRanges(path.resolve(options.since), current);
	const lineCount = text.split('\n').length - (text.endsWith('\n') ? 1 : 0); // 末尾の改行の後は行にしない
	if (options.lines && ranges.some(([from]) => from > lineCount)) return { error: `--lines の範囲が ${options.auto} の行（${lineCount}行）の外にある` };
	const mutants = autoMutations(text, ranges).slice(0, options.max).map(mutant => ({ ...mutant, file: options.auto, tests: options.tests, ...(options.skipPattern ? { skipPattern: options.skipPattern } : {}) }));
	if (!mutants.length) {
		console.log(`mutate: ${options.lines ? `指定の行（${options.lines}）` : '下書きから変わった行'}に変異の候補がない`);
		return { none: options.lines ? 1 : 0 };
	}
	return { mutants };
}

/** 結果の表を出す。 */
function printTable(results) {
	console.log('| 変異 | ファイル | 結果 | 備考 |');
	console.log('| :--- | :--- | :--- | :--- |');
	for (const result of results) console.log(`| ${result.name} | ${result.file} | ${result.result} | ${result.detail} |`);
}

async function main(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`mutate: ${options.error}`);
		return 2;
	}
	let mutants;
	let unmatched;
	// 一覧・等価の一覧・対象のファイル・下書きが読めない、JSON でない、git がない（--since）ときは、理由を出して 2 にする。
	try {
		const loaded = loadMutants(options);
		if (loaded.error) {
			console.error(`mutate: ${loaded.error}`);
			return 2;
		}
		if (loaded.none !== undefined) return loaded.none;
		mutants = loaded.mutants;
		unmatched = options.equivalents ? applyEquivalents(mutants, JSON.parse(fs.readFileSync(path.resolve(options.equivalents), 'utf8'))) : [];
	} catch (error) {
		console.error(`mutate: ${error.message}`);
		return 2;
	}
	let outcome;
	const uninstall = installCleanup();
	try {
		outcome = await runMutants(options.root, mutants, { timeout: options.timeout });
	} catch (error) {
		if (!error.partial) throw error;
		printTable(error.partial.results);
		console.error(`mutate: ${error.message}`);
		return 2;
	} finally {
		uninstall();
	}
	const { baseline, results } = outcome;
	const failedBaseline = baseline.filter(entry => entry.status !== 0);
	if (failedBaseline.length) {
		for (const entry of failedBaseline) console.log(`mutate: 変異なしの基準の実行が合格しない（${entry.status === null ? '時間切れ' : `終了コード ${entry.status}`}）: ${entry.tests.join(' ')}`);
		return 1;
	}
	printTable(results);
	for (const name of unmatched) console.log(`mutate: 等価の指定に一致する変異がない（一覧を直す）: ${name}`);
	const problems = results.filter(result => isProblem(result.result)).length;
	console.log(`mutate: ${results.length}件中 問題 ${problems}件（生存・無効・不合格）${unmatched.length ? `、一致しない等価の指定 ${unmatched.length}件` : ''}`);
	return problems || unmatched.length ? 1 : 0;
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = { GLOB, UNCOPIED, repositoryFile, countOccurrences, applyMutation, OPERATORS, parseRanges, changedRanges, autoMutations, copyRepository, treeHashes, stopGroup, runTests, installCleanup, syntaxOk, runMutants, isProblem, applyEquivalents, insideRoot, mutantError, loadMutants, parseArgs, main };
