#!/usr/bin/env node
/*
 * 単位ごとの実行と記録（開発プロセス定義書 Stage 4「単位ごとの実行と記録」・Stage 7・4.6）。
 * 着手前の一掃（repeat-tests.js）と変異の当て込み（mutate.js）を単位ごとに、作業ツリーを固めた写しの上で実行し、
 * 結果・実行のしかた・入力のファイルごとの SHA-256 を記録する。記録を使える単位は、実行せずに記録を使う。
 * 使い方: node tests/scripts/run-units.js --units <単位の一覧.json> --records <記録の置き場所> [--root <リポジトリ>] [--only <正規表現>] [--jobs <数>] [--list]
 *   一覧: [{ "name": "一掃 tests/unit/app.test.js",
 *            "command": ["tests/scripts/repeat-tests.js", "--times", "10", "--coverage", "--load", "2", "tests/unit/app.test.js"],
 *            "inputs": ["…"]（省略可。決まった入力）, "wholeCopy": false（省略可） }]
 *   --records: 作業ツリーの外のディレクトリ。なければ利用者だけが読み書きできる権限で作って印のファイル（.run-units-records）を置く。既にある
 *     ディレクトリは、空か印のファイルがあるときだけ使う。単位ごとの記録（<識別子>.json）・出力（<識別子>.out）と結果の表（summary.md。扱った単位だけ）を、
 *     利用者だけが読み書きできる権限で置く。単位を実行し直すときは、初めに前の記録を消す（途中で止まったとき、前の合格の記録が止まった回の出力を指さない）。
 *     summary.md は実行の初めに消し、その実行で終わった単位と記録を使った単位の行だけを書く。
 *   --only: 名前が一致する単位だけを扱う。--jobs: 並べて実行する単位の数（既定 1）。--list: 記録を使うか実行するか（理由）だけを出す。
 * 信頼: 単位の一覧はコードとして実行され（先頭のスクリプトと引数。mutate.js の一覧の replace なども）、記録の置き場所の記録は合格の判定と
 *   入力の SHA-256 をそのまま信じて実行を省く。どちらも自分で作ったものか中身を確かめたものだけを使い、記録の置き場所は他人が書き込めない場所に置く
 *   （このスクリプトの検査は誤りを防ぐもので、悪意のある一覧・記録は防がない）。
 * 写し: 実行の初めに作業ツリーを一時ディレクトリ（kogai-units-<プロセス番号>-…）へ1回写し（.git・node_modules と審査の記録
 *   docs/reviews/・docs/review_backlog.md を除く。最上位の node_modules はあればリンクする）、trace-reads.js もそこへ写す。
 *   写しの元は作業ツリーの実パスとする（--root がリンクでも、写しが作業ツリーへのリンクにならない）。
 *   最上位の node_modules の下（リンクを通した読取り・モジュールの相対の読取り・書込み）は作業ツリーに届き、入力にならない。
 *   写しにシンボリックリンクがあれば、向き先によらず写しを消して終わる（写しの中から写しの外を読みうるため。終了コード 2）。
 *   単位ごとにその写しをさらに写して作業ディレクトリとし、単位が終わったらすぐに消す。
 * 実行: 単位のコマンドを process.execPath で、新しいプロセスグループで起こす。一時ファイルは単位ごとの一時ディレクトリ（TMPDIR・TMP・TEMP）に置かせる。
 *   親の網羅の設定と NODE_TEST_CONTEXT は渡さず、NODE_OPTIONS の先頭に trace-reads.js の写しを加える。PWD は単位の写しにし、
 *   作業ツリーを指しうるパスの変数（OLDPWD・INIT_CWD・npm_package_json・npm_config_local_prefix）は渡さない。ほかの環境変数が作業ツリーの
 *   中のパスを持つと（NODE_OPTIONS の --require など）、単位はそれを通して作業ツリーを読み、その読取りは入力にならない。
 *   単位が終わったとき・信号を受けたとき・実行の例外で終わるときは、実行中の単位のプロセスグループと、単位の記録の置き場所を環境変数
 *   （KOGAI_TRACE_DIR、入れ子の run-units.js の単位にも受け継がれる KOGAI_TRACE_UNITS）に持つプロセス（Linux の /proc で探す。
 *   別のプロセスグループのものと親を失ったものを含む）を止めてから、写しを消す。例外のときは、新しい単位を始めず、止めた単位の記録は書かない。
 *   run-units.js 自身が SIGKILL で止められたときと、環境変数を除いて別のプロセスグループへ出たプロセスは、後始末できない。
 * 入力:
 *   1. 決まった入力: コマンドの先頭のスクリプト、コマンドの引数（コンマで区切った各部分を含む）のうち写しの中のパスか作業ツリーの外の絶対パスとして
 *      実在するもの、inputs、写しの中のすべての package.json（モジュールの形式を決める）、あれば package-lock.json。ディレクトリはその下のすべてを含める。
 *   2. 実行の間に読んだもの: trace-reads.js の記録のうち、単位の写しの中のパスと、最上位のプロセスが作った mutate.js の写し
 *      （<単位の一時ディレクトリ>/kogai-mutate-<最上位のプロセス番号>-<6文字>）の中のパス（node_modules・.git の下を除く）。
 *      写しの根を写した最上位のプロセス（mutate.js）の読取りは入力にせず、それが起こした Node 以外のプログラムで入力を広げない（全体を読むため）。
 *      そのプログラム（--since の git など）は、起こしたプログラムとして照合する。
 *      そのようなスクリプトが引数のほかに読むファイルは inputs に書く。
 *   3. 記録できない読取り: ブラウザー（名前に chrom を含むプログラム）を起こした単位は、docs/ の外のすべてのファイルを加える。
 *      そのほかの Node 以外のプログラムを起こした単位、記録の設定を受け継がない Node のプロセスを起こした単位、glob を使った単位（trace-reads.js の
 *      whole）、一覧で wholeCopy を真にした単位は、写しの全体（ディレクトリを含む）を入力とする。recursive の一覧・写しの対象が写しの根かその祖先、
 *      または mutate.js の写しを置く一時ディレクトリかその祖先のときも、写しの全体を入力とする。
 *   入力ごとの SHA-256（ファイルは内容、ディレクトリは名前の一覧、ないパスはないこと）は、固めた写しから（作業ツリーの外の入力は実行の前に）求める。
 * 実行の後: 単位の写しのファイルを変えた単位と、作業ツリーの外の入力が実行の前後で変わった単位は不合格とする。
 * 再利用: 前の記録が合格で、実行のしかた（コマンド、Node.js の版、実行の仕組みの SHA-256、実行の環境（ENVIRONMENT の環境変数の値の SHA-256。
 *   値そのものは記録しない）、起こしたプログラムの実パス・大きさ・更新日時）が同じで、記録した入力がすべて今の写しで同じで、今の決まった入力（記録が入力を写しの全体・docs/ の外のファイルに
 *   広げていれば、今のそれも）がすべて記録の入力に含まれる単位は、実行せずに記録を使う。
 * 同じ記録の置き場所を同時に2つの run-units.js で使わない（run-units.lock。持ち主のプロセスが終わっていれば、引継ぎの印を作れた1つだけが引き継ぐ）。
 * 終了コード: 0 扱った単位がすべて合格（記録の再利用を含む）・--list、1 不合格の単位がある、2 引数の誤り（一覧の誤り、作業ツリーの中の --records、
 *   空でなく印のない記録の置き場所、一致する単位のない --only、ほかの run-units.js が使っている記録の置き場所を含む）・写しや記録を作れない環境
 *   （実行の途中の例外を含む。それまでに終わった単位の記録は残る）、
 *   130・143・129 信号で止めた
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { insideRoot, stopGroup, treeHashes, UNCOPIED } = require('./mutate');

const TRACE = path.join(__dirname, 'trace-reads.js');
const FORMAT = 2;
const KEYS = new Set(['name', 'command', 'inputs', 'wholeCopy']);
const MARKER = '.run-units-records';
// 写しに入れない審査の記録（試験は読まない。結果を記録に書くたびに、写しの全体を入力とする単位の入力が変わらないようにする）。
const REVIEW_RECORDS = /^docs\/(?:reviews(?:\/|$)|review_backlog\.md$)/;
const BROWSER = /chrom/i;
// ブラウザーが file:// で読みうるファイル（アプリのファイルと試験のページ）。
const BROWSER_FILE = file => !/^docs\//.test(file);
// 結果に効く環境変数（実行の環境）。網羅の設定と node:test の子の印は単位に渡さないので除く。記録の設定は run-units.js が単位ごとに決める。
const ENVIRONMENT = name => (/^(?:TZ|LANG|LANGUAGE|CHROMIUM_PATH)$/.test(name) || /^LC_/.test(name) || (/^NODE_/.test(name) && !/^NODE_(?:V8_COVERAGE|TEST_CONTEXT)$/.test(name)) || (/^KOGAI_/.test(name) && !/^KOGAI_TRACE_/.test(name)));

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const slash = file => file.split(path.sep).join('/');
/** target が root の外（上のディレクトリ・その下・別のドライブ）か。「..records」のような名前は中。 */
function outside(root, target) {
	const relative = path.relative(root, target);
	return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}
/** 実パス（ないパスは、あるところまでの実パスに残りをつなぐ）。 */
function realResolve(target) {
	const missing = [];
	let current = path.resolve(target);
	for (;;) {
		try {
			return path.join(fs.realpathSync.native(current), ...missing.reverse());
		} catch {
			const parent = path.dirname(current);
			if (parent === current) return path.resolve(target);
			missing.push(path.basename(current));
			current = parent;
		}
	}
}

function parseArgs(argv) {
	const options = { root: path.resolve(__dirname, '../..'), jobs: 1, list: false };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		if (['--units', '--records', '--root', '--only', '--jobs'].includes(argv[i]) && value === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--units') { options.units = path.resolve(value); i++; }
		else if (argv[i] === '--records') { options.records = path.resolve(value); i++; }
		else if (argv[i] === '--root') { options.root = path.resolve(value); i++; }
		else if (argv[i] === '--only') { options.only = value; i++; }
		else if (argv[i] === '--jobs') { options.jobs = Number(value); i++; }
		else if (argv[i] === '--list') options.list = true;
		else return { error: `不明な引数: ${argv[i]}` };
	}
	if (!options.units) return { error: '--units に単位の一覧を指定する' };
	if (!options.records) return { error: '--records に記録の置き場所を指定する' };
	if (!Number.isInteger(options.jobs) || options.jobs < 1) return { error: '--jobs には 1 以上の整数を指定する' };
	if (options.only !== undefined) {
		try {
			options.only = new RegExp(options.only);
		} catch (error) {
			return { error: `--only が正規表現でない: ${error.message}` };
		}
	}
	// 作業ツリーを指すリンクを通しても中に置けないよう、実パスで比べる。
	if (!outside(realResolve(options.root), realResolve(options.records))) return { error: `--records は作業ツリー（${options.root}）の外に置く` };
	return options;
}

/** root の中の相対パス file（正規の形）が、リンクと .git・node_modules を通らずに、写しに入る実在するファイル・ディレクトリを指すか。 */
function copiedPath(root, file) {
	if (!insideRoot(root, file) || REVIEW_RECORDS.test(slash(file)) || file.split(/[\\/]/).some(part => UNCOPIED.test(part))) return false;
	try {
		return fs.realpathSync.native(path.join(root, file)) === path.join(fs.realpathSync.native(root), file);
	} catch {
		return false;
	}
}

/** 単位の項目を検査し、誤りの文を返す（なければ null）。 */
function unitError(unit, root, names) {
	if (!unit || typeof unit !== 'object' || Array.isArray(unit)) return '項目がオブジェクトでない';
	const unknown = Object.keys(unit).filter(key => !KEYS.has(key));
	if (unknown.length) return `知らないキー: ${unknown.join('、')}`;
	if (typeof unit.name !== 'string' || !unit.name.trim()) return 'name が空でない文字列でない';
	if (names.has(unit.name)) return `name が重なる: ${unit.name}`;
	if (!Array.isArray(unit.command) || !unit.command.length || unit.command.some(part => typeof part !== 'string')) return 'command が空でない文字列の配列でない';
	const [script, ...args] = unit.command;
	if (!script.endsWith('.js') || !copiedPath(root, script) || !fs.statSync(path.join(root, script)).isFile()) return `command の先頭が、作業ツリーの中の正規の形の相対パスで実在する .js のファイルでない: ${script}`;
	// 作業ツリーの中を指す絶対パス（字面と実パスで比べる。リンクを通したパスと、--root がリンクのときの実パスを含む）。
	const realRoot = realResolve(root);
	const inTree = target => !outside(root, target) || !outside(realRoot, realResolve(target));
	for (const part of args.flatMap(arg => arg.split(','))) {
		const full = path.resolve(root, part);
		if (path.isAbsolute(part) && inTree(part)) return `作業ツリーの中を指す絶対パスの引数（写しでなく作業ツリーを読む。相対パスで書く）: ${part}`;
		if (!path.isAbsolute(part) && part && fs.existsSync(full) && outside(root, full)) return `写しの外を指す相対パスの引数: ${part}`;
	}
	if (unit.inputs !== undefined) {
		if (!Array.isArray(unit.inputs) || unit.inputs.some(entry => typeof entry !== 'string' || !entry)) return 'inputs が空でない文字列の配列でない';
		for (const entry of unit.inputs) {
			if (path.isAbsolute(entry)) {
				if (inTree(entry)) return `inputs の絶対パスが作業ツリーの中を指す（相対パスで書く）: ${entry}`;
				if (!fs.existsSync(entry)) return `inputs のパスがない: ${entry}`;
			} else if (!copiedPath(root, entry)) return `inputs のパスが、作業ツリーの中の正規の形の相対パスで写しに入る実在するものでない: ${entry}`;
		}
	}
	if (unit.wholeCopy !== undefined && typeof unit.wholeCopy !== 'boolean') return 'wholeCopy が真偽値でない';
	return null;
}

/** 単位の一覧を読み、検査する。誤りは例外（引数の誤り）。 */
function loadUnits(file, root) {
	let list;
	try {
		list = JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch (error) {
		throw new Error(`単位の一覧を読めない: ${error.message}`);
	}
	if (!Array.isArray(list) || !list.length) throw new Error('単位の一覧は空でない配列とする');
	const names = new Set();
	return list.map((unit, index) => {
		const error = unitError(unit, root, names);
		if (error) throw new Error(`単位の一覧の ${index + 1} 番目: ${error}`);
		names.add(unit.name);
		return { name: unit.name, command: unit.command, inputs: unit.inputs || [], wholeCopy: unit.wholeCopy === true };
	});
}

/**
 * 記録の置き場所を使えるようにする（create が偽なら作らない）。ないディレクトリは作って印のファイルを置く。既にあるディレクトリは、空なら印のファイルを置き、
 * 空でなければ印のファイルがあるときだけ使う（ほかのディレクトリのファイルを上書きしない）。使えなければ例外。
 */
function prepareRecords(records, create) {
	if (!fs.existsSync(records)) {
		if (!create) return;
		fs.mkdirSync(records, { recursive: true, mode: 0o700 });
		fs.writeFileSync(path.join(records, MARKER), 'run-units.js の記録の置き場所\n', { mode: 0o600 });
		return;
	}
	if (!fs.statSync(records).isDirectory()) throw new Error(`記録の置き場所がディレクトリでない: ${records}`);
	const entries = fs.readdirSync(records);
	if (entries.includes(MARKER)) return;
	if (entries.length) throw new Error(`記録の置き場所でない（空でなく、印のファイル ${MARKER} がない）: ${records}`);
	if (create) fs.writeFileSync(path.join(records, MARKER), 'run-units.js の記録の置き場所\n', { mode: 0o600 });
}

/** 記録の識別子（名前の英数字の部分と、名前の SHA-256 の先頭）。 */
const recordId = name => `${name.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|_+$/g, '').slice(0, 60) || 'unit'}-${sha256(name).slice(0, 12)}`;

/** パスの SHA-256。ファイルは内容、ディレクトリは名前の一覧、ないパスはないこと。 */
function digestOf(full) {
	let link = null;
	try {
		if (fs.lstatSync(full).isSymbolicLink()) link = fs.readlinkSync(full);
	} catch {
		// ないパス
	}
	let stat = null;
	try {
		stat = fs.statSync(full);
	} catch {
		// ないパス・向き先のないリンク
	}
	const target = !stat ? sha256('none')
		: stat.isDirectory() ? sha256(`dir\n${fs.readdirSync(full).sort().join('\n')}`)
			: crypto.createHash('sha256').update('file\n').update(fs.readFileSync(full)).digest('hex');
	// シンボリックリンクは、向き先の文字も含める（向き先を変えれば変わる）。
	return link === null ? target : sha256(`link\n${link}\n${target}`);
}

/** 写しの中のファイルとシンボリックリンクの SHA-256（写しの中の相対パス → 値。リンクは向き先の文字。.git・node_modules の下を除く）。 */
function copyHashes(root) {
	const hashes = Object.fromEntries(Object.entries(treeHashes(root)).map(([file, hash]) => [slash(file), hash]));
	const visit = dir => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (UNCOPIED.test(entry.name)) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) visit(full);
			else if (entry.isSymbolicLink()) hashes[slash(path.relative(root, full))] = sha256(`link\n${fs.readlinkSync(full)}`);
		}
	};
	visit(root);
	return hashes;
}

/** ディレクトリの下のファイルとディレクトリ（.git・node_modules を除く）を、base からつないだ名前で返す。 */
function walk(full, base) {
	const found = [];
	for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
		if (UNCOPIED.test(entry.name)) continue;
		const key = base === '.' ? entry.name : `${base}/${entry.name}`;
		found.push(key);
		if (entry.isDirectory()) found.push(...walk(path.join(full, entry.name), key));
	}
	return found;
}

/** 入力の一覧のディレクトリを、その下のすべてに広げる。 */
function expand(master, keys) {
	return keys.flatMap(key => {
		const full = path.isAbsolute(key) ? key : path.join(master, key);
		return fs.existsSync(full) && fs.statSync(full).isDirectory() ? [key, ...walk(full, key)] : [key];
	});
}

/** 単位の決まった入力（ディレクトリは広げる）。packages は写しの中の package.json（モジュールの形式を決める。Node の内部の探索は記録されない）。 */
function declaredInputs(unit, master, packages = []) {
	const [script, ...args] = unit.command;
	const keys = [script, 'package.json', ...packages, ...unit.inputs];
	if (fs.existsSync(path.join(master, 'package-lock.json'))) keys.push('package-lock.json');
	for (const part of args.flatMap(arg => arg.split(','))) {
		if (!part) continue;
		if (path.isAbsolute(part)) {
			if (fs.existsSync(part)) keys.push(part);
			continue;
		}
		const full = path.resolve(master, part);
		if (fs.existsSync(full) && !outside(master, full)) keys.push(slash(path.relative(master, full)) || '.');
	}
	return [...new Set(expand(master, keys.map(key => path.isAbsolute(key) ? key : slash(key))))];
}

const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const realpath = dir => {
	try {
		return fs.realpathSync.native(dir);
	} catch {
		return dir;
	}
};

/**
 * 記録の置き場所 traceDir の記録を読み、写しの中の相対パスの入力（keys）・その下のすべてを入力とするディレクトリ（trees。copy と tree）・
 * 起こした Node 以外のプログラム（programs。入力を広げる）・写し手が起こした Node 以外のプログラム（checked。照合だけ）・
 * process.execPath でない Node（nodes）・記録の設定を受け継がない Node のプロセス（untraced）・glob（whole）を返す。
 * tree・copy の対象が写しの祖先か、mutate.js の写しを置く一時ディレクトリかその祖先なら、写しの全体（.）とする。
 * copy の中と、最上位のプロセス top が tmp に作った mutate.js の写しの中だけを入力とする。
 * 写しの根を写した（copy の記録がある）最上位のプロセスの記録は、モジュールの読込み・untraced と、照合だけをするプログラム（exec・node）を使う
 * （写しの作成とハッシュのために全体を読むため。--since の git などは、入力を広げずに照合する）。
 */
function readTrace(traceDir, { copy, tmp, top }) {
	const roots = [...new Set([copy, realpath(copy)])];
	const tmps = [...new Set([tmp, realpath(tmp)])];
	const copies = tmps.map(base => new RegExp(`^${escapeRegExp(base + path.sep)}kogai-mutate-${top}-[A-Za-z0-9]{6}(?:${escapeRegExp(path.sep)}(.*))?$`));
	const keyOf = target => {
		let relative = null;
		for (const root of roots) {
			if (target === root) relative = '';
			else if (target.startsWith(root + path.sep)) relative = target.slice(root.length + 1);
		}
		for (const copied of copies) {
			const found = target.match(copied);
			if (found) relative = found[1] || '';
		}
		if (relative === null) return null;
		const key = slash(relative) || '.';
		return key.split('/').some(part => UNCOPIED.test(part)) ? null : key;
	};
	const result = { keys: new Set(), trees: new Set(), programs: new Set(), checked: new Set(), nodes: new Set(), untraced: new Set(), whole: new Set(), copier: false };
	for (const log of fs.existsSync(traceDir) ? fs.readdirSync(traceDir) : []) {
		let entries = fs.readFileSync(path.join(traceDir, log), 'utf8').split('\n').filter(Boolean).map(line => {
			const space = line.indexOf(' ');
			return { kind: line.slice(0, space), target: line.slice(space + 1) };
		});
		const copier = log === `${top}.log` && entries.some(entry => entry.kind === 'copy' && roots.includes(entry.target));
		if (copier) {
			result.copier = true;
			entries = entries.filter(entry => ['load', 'untraced', 'exec', 'node'].includes(entry.kind));
		}
		for (const { kind, target } of entries) {
			if (kind === 'exec') result[copier ? 'checked' : 'programs'].add(target);
			else if (kind === 'node') result.nodes.add(target);
			else if (kind === 'untraced') result.untraced.add(target);
			else if (kind === 'whole') result.whole.add(target);
			else {
				const subtree = kind === 'tree' || kind === 'copy';
				// 写しの根とその祖先、mutate.js の写しを置く一時ディレクトリとその祖先の下のすべては、写しの全体を含む。
				const encloses = subtree && [...roots, ...tmps].some(base => !outside(target, base));
				const key = encloses ? '.' : keyOf(target);
				if (key !== null) result[subtree ? 'trees' : 'keys'].add(key);
			}
		}
	}
	return result;
}

/** 記録の後で広げた入力の理由（写しの全体・docs/ の外のファイル）。 */
function expansions(unit, traced) {
	const others = [...traced.programs].filter(program => !BROWSER.test(path.basename(program)));
	const whole = [
		...(unit.wholeCopy ? ['一覧の wholeCopy'] : []),
		...(traced.untraced.size ? [`記録の設定を受け継がない Node のプロセス（${[...traced.untraced].join('・')}）`] : []),
		...(traced.whole.size ? [`走査の範囲を記録しない glob（${[...traced.whole].join('・')}）`] : []),
		...(others.length ? [`Node 以外のプログラム（${others.join('・')}）`] : [])
	];
	const browser = [...traced.programs].filter(program => BROWSER.test(path.basename(program)));
	return { wholeCopy: whole.length ? whole.join('、') : null, browser: browser.length ? `ブラウザー（${browser.join('・')}）` : null };
}

/** 実行の環境（結果に効く環境変数の値の SHA-256。名前の順。値には秘密（NODE_AUTH_TOKEN など）がありうるので、値そのものは記録しない）。 */
function environment(env = process.env) {
	return Object.fromEntries(Object.keys(env).filter(ENVIRONMENT).sort().map(name => [name, sha256(String(env[name]))]));
}

/** 起こしたプログラムの実パス・大きさ・更新日時（名前だけのものは PATH から探す。区切りを含む相対パスは base から）。見つからなければ path は null。 */
function programIdentity(program, base, env = process.env) {
	const candidates = path.isAbsolute(program) ? [program]
		: /[\\/]/.test(program) ? [path.resolve(base, program)]
			: String(env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, program));
	for (const candidate of candidates) {
		try {
			const stat = fs.statSync(candidate);
			if (stat.isFile()) return { path: fs.realpathSync.native(candidate), size: stat.size, mtimeMs: stat.mtimeMs };
		} catch {
			// 次の候補
		}
	}
	return { path: null };
}

/** 固めた写し（master）の SHA-256 の求め方。写しの中のパスは結果を覚える（写しは実行の間に変わらない）。 */
function makeContext(master) {
	const cache = new Map();
	const hashes = copyHashes(master);
	const files = Object.keys(hashes).sort();
	const packages = files.filter(file => path.posix.basename(file) === 'package.json');
	const digest = key => {
		if (path.isAbsolute(key)) return digestOf(key);
		if (!cache.has(key)) cache.set(key, digestOf(path.join(master, key)));
		return cache.get(key);
	};
	// 写しの全体（ディレクトリを含む。写しの全体を入力とする単位と、写しの全体を読んだ記録とで同じものにする）。
	let everything = null;
	return { master, hashes, files, digest, declared: unit => declaredInputs(unit, master, packages), everything: () => (everything ??= expand(master, ['.'])) };
}

/** 再利用するときに、記録の入力に含まれていなければならない今の入力。 */
function requiredInputs(unit, context, previous) {
	const required = new Set(context.declared(unit));
	if (unit.wholeCopy || previous?.expanded?.wholeCopy) for (const key of context.everything()) required.add(key);
	if (previous?.expanded?.browser) for (const file of context.files.filter(BROWSER_FILE)) required.add(file);
	return required;
}

const listOf = keys => `${keys.slice(0, 5).join('・')}${keys.length > 5 ? ` ほか${keys.length - 5}件` : ''}`;

/** 前の記録を使えるか（{ reuse, reason }）。runner は実行の仕組みの SHA-256。 */
function reuseDecision(previous, unit, context, runner) {
	if (!previous) return { reuse: false, reason: '記録なし' };
	if (previous.format !== FORMAT || !previous.inputs || typeof previous.inputs !== 'object' || !previous.programs || typeof previous.programs !== 'object') return { reuse: false, reason: '記録の形式が違う' };
	if (previous.passed !== true) return { reuse: false, reason: '前の結果が不合格' };
	const changedPrograms = Object.keys(previous.programs).filter(program => JSON.stringify(programIdentity(program, context.master)) !== JSON.stringify(previous.programs[program]));
	const how = [
		...(JSON.stringify(previous.command) !== JSON.stringify(unit.command) ? ['コマンド'] : []),
		...(previous.node !== process.version ? ['Node.js の版'] : []),
		...(previous.runner !== runner ? ['実行の仕組み'] : []),
		...(JSON.stringify(previous.environment) !== JSON.stringify(environment()) ? ['実行の環境'] : []),
		...(changedPrograms.length ? [`起こしたプログラム（${listOf(changedPrograms)}）`] : [])
	];
	if (how.length) return { reuse: false, reason: `実行のしかたが変わった（${how.join('・')}）` };
	const missing = [...requiredInputs(unit, context, previous)].filter(key => !Object.hasOwn(previous.inputs, key));
	if (missing.length) return { reuse: false, reason: `記録の入力にない今の入力（${listOf(missing)}）` };
	const changed = Object.keys(previous.inputs).filter(key => context.digest(key) !== previous.inputs[key]);
	if (changed.length) return { reuse: false, reason: `入力が変わった（${listOf(changed)}）` };
	return { reuse: true, reason: `合格 ${previous.finished}` };
}

function readRecord(file) {
	try {
		return JSON.parse(fs.readFileSync(file, 'utf8'));
	} catch {
		return null;
	}
}

/**
 * 実行の仕組みの SHA-256。単位に読み込ませる trace-reads.js（trace。写し）と、run-units.js とそれが読み込むモジュール（mutate.js と lib/ のもの）の
 * 内容で決まる（run-units.js の置き場所からの相対の名前で。置き場所によらない）。
 */
function runnerDigest(trace = TRACE) {
	const files = new Set();
	const visit = mod => {
		if (files.has(mod.filename)) return;
		files.add(mod.filename);
		for (const child of mod.children) visit(child);
	};
	visit(module);
	const parts = [...files].map(file => `${slash(path.relative(__dirname, file))}\n${sha256(fs.readFileSync(file))}`);
	parts.push(`trace-reads.js\n${sha256(fs.readFileSync(trace))}`);
	return sha256(parts.sort().join('\n'));
}

/**
 * dir の下のシンボリックリンク（dir からの相対パス。名前の順）。固めた写しに当てる（写しには .git・node_modules と審査の記録が入らない）。
 * 写しの中のリンクは、向き先によっては写しの外（作業ツリーなど）を読むので、向き先によらず使わない。
 * 向き先を名前の解決を真似て判定すると、端の形が尽きないためである（開発プロセス定義書 4.6 の run-units.js の (2)）。
 */
function linksIn(dir) {
	const found = [];
	const visit = current => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isSymbolicLink()) found.push(slash(path.relative(dir, full)));
			else if (entry.isDirectory()) visit(full);
		}
	};
	visit(dir);
	return found.sort();
}

/**
 * 作業ツリーを一時ディレクトリへ固め、trace-reads.js を写す（.git・node_modules と審査の記録を除く。最上位の node_modules はあればリンクする）。
 * 写しにシンボリックリンクがあれば、写しを消して例外にする（写した後の写しで調べるので、写す前や写す途中に作業ツリーにできたリンクも見つける）。
 * 写しの途中で失敗したら、作りかけの写しを消してから例外を投げ直す（main は置き場所を受け取る前に抜けるので、後始末で消せない）。
 */
function freeze(root) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), `kogai-units-${process.pid}-`));
	try {
		const master = path.join(dir, 'tree');
		const trace = path.join(dir, 'trace-reads.js');
		fs.copyFileSync(TRACE, trace);
		// 作業ツリーの実パスから写す（--root がリンクでも、写しが作業ツリーへのリンクにならない）。
		const real = fs.realpathSync.native(root);
		fs.cpSync(real, master, {
			recursive: true,
			filter: source => {
				const relative = slash(path.relative(real, source));
				return !relative || (!relative.split('/').some(part => UNCOPIED.test(part)) && !REVIEW_RECORDS.test(relative));
			}
		});
		const links = linksIn(master);
		if (links.length) throw new Error(`作業ツリーの中にシンボリックリンクがある（写しの中から写しの外を読みうる。リンクを除くか、写さない node_modules の下に置く）: ${listOf(links)}`);
		if (fs.existsSync(path.join(real, 'node_modules'))) fs.symlinkSync(path.join(real, 'node_modules'), path.join(master, 'node_modules'), 'dir');
		return { dir, master, trace };
	} catch (error) {
		fs.rmSync(dir, { recursive: true, force: true });
		throw error;
	}
}

/** NODE_OPTIONS の値として引用する。 */
const quoteOption = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * 環境変数 KOGAI_TRACE_DIR が trace のプロセスと、KOGAI_TRACE_UNITS（行ごとの記録の置き場所）に trace を持つプロセス（入れ子の run-units.js の単位）。
 * 環境変数の全体に trace の文字を含まないプロセスは、比べる前に除く（下の比べ方を誤っても、ほかの単位と外側の run-units.js の単位のプロセスを
 * 止めない。trace は単位ごとの一時ディレクトリの中のパス）。
 */
function tracedProcesses(trace) {
	if (!fs.existsSync('/proc/self/environ')) return [];
	const needle = `KOGAI_TRACE_DIR=${trace}`;
	const found = [];
	for (const name of fs.readdirSync('/proc')) {
		if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
		try {
			const text = fs.readFileSync(`/proc/${name}/environ`, 'utf8');
			if (!text.includes(trace)) continue;
			const entries = text.split('\0');
			const units = entries.find(entry => entry.startsWith('KOGAI_TRACE_UNITS='));
			if (entries.includes(needle) || (units && units.slice('KOGAI_TRACE_UNITS='.length).split('\n').includes(trace))) found.push(Number(name));
		} catch {
			// 終わったプロセス、ほかの利用者のプロセス
		}
	}
	return found;
}

/** 単位のプロセスグループと、単位の記録の置き場所を環境変数に持つプロセス（別のグループのもの・親を失ったものを含む）を止める。 */
function stopUnit(pid, trace) {
	stopGroup(pid);
	// 止める間に起きたプロセスも止めるよう、見つからなくなるまで繰り返す（上限つき）。
	for (let round = 0; round < 50; round++) {
		const found = tracedProcesses(trace);
		if (!found.length) return;
		for (const target of found) {
			try {
				process.kill(target, 'SIGKILL');
			} catch {
				// すでに終わった
			}
		}
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
	}
}

/** 実行中のすべての単位を止める。 */
function stopAll(state) {
	for (const [pid, trace] of state.active) stopUnit(pid, trace);
}

/** 単位のコマンドを実行する（{ pid, status, signal, error }）。state.active に実行中のプロセス番号と記録の置き場所を置く。 */
function execute(command, { cwd, tmp, trace, output, state }) {
	// 作業ツリーを指しうるパスの変数（前の作業ディレクトリと npm の作業ツリーの変数）は渡さない。PWD は単位の写しにする。
	const { NODE_TEST_CONTEXT, OLDPWD, INIT_CWD, npm_package_json, npm_config_local_prefix, ...rest } = process.env;
	const env = {
		...rest,
		PWD: cwd,
		// Node は親の NODE_V8_COVERAGE を、env から除いても子に渡す。undefined を明示して渡さない。
		NODE_V8_COVERAGE: undefined,
		// 入れ子の run-units.js では、先頭（内側）の trace-reads.js が記録する。
		NODE_OPTIONS: [`--require ${quoteOption(state.tracer)}`, process.env.NODE_OPTIONS].filter(Boolean).join(' '),
		KOGAI_TRACE_DIR: trace,
		// 入れ子の run-units.js は KOGAI_TRACE_DIR を上書きするので、外側の単位の記録の置き場所も受け継がせる（後始末で探す）。
		KOGAI_TRACE_UNITS: [process.env.KOGAI_TRACE_UNITS, trace].filter(Boolean).join('\n'),
		TMPDIR: tmp,
		TMP: tmp,
		TEMP: tmp
	};
	const fd = fs.openSync(output, 'w', 0o600);
	return new Promise(resolve => {
		let done = false;
		const finish = (child, outcome) => {
			if (done) return;
			done = true;
			stopUnit(child.pid, trace);
			state.active.delete(child.pid);
			fs.closeSync(fd);
			resolve({ pid: child.pid, ...outcome });
		};
		const child = spawn(process.execPath, command, { cwd, env, stdio: ['ignore', fd, fd], detached: process.platform !== 'win32' });
		if (child.pid) state.active.set(child.pid, trace);
		child.on('exit', (status, signal) => finish(child, { status, signal, error: null }));
		child.on('error', error => finish(child, { status: null, signal: null, error: error.message }));
	});
}

/** 2つの SHA-256 の一覧の違うパス。 */
function differences(before, after) {
	return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]).sort();
}

/** 単位を実行して記録を書き、記録を返す。ほかの単位の例外で止めたとき（state.aborted）は記録を書かずに例外にする。 */
async function runUnit(unit, index, { work, context, records, runner, state }) {
	const copy = path.join(work.dir, `u${index}`);
	const tmp = `${copy}-tmp`;
	const trace = `${copy}-trace`;
	fs.cpSync(context.master, copy, { recursive: true, verbatimSymlinks: true });
	fs.mkdirSync(tmp);
	fs.mkdirSync(trace);
	const id = recordId(unit.name);
	const output = path.join(records, `${id}.out`);
	// 途中で止まったとき、前の合格の記録が止まった回の出力を指さないよう、出力を書く前に前の記録を消す。
	fs.rmSync(path.join(records, `${id}.json`), { force: true });
	const declared = context.declared(unit);
	const outsideKeys = declared.filter(key => path.isAbsolute(key));
	const outsideBefore = Object.fromEntries(outsideKeys.map(key => [key, digestOf(key)]));
	const started = Date.now();
	const outcome = await execute(unit.command, { cwd: copy, tmp, trace, output, state });
	const ms = Date.now() - started;
	if (state.aborted) throw new Error(`ほかの単位の例外で止めた: ${unit.name}`);
	const outsideAfter = Object.fromEntries(outsideKeys.map(key => [key, digestOf(key)]));
	const traced = readTrace(trace, { copy, tmp, top: outcome.pid });
	const copyChanged = differences(context.hashes, copyHashes(copy));
	for (const dir of [copy, tmp, trace]) fs.rmSync(dir, { recursive: true, force: true });
	const expanded = expansions(unit, traced);
	const keys = new Set([...declared, ...traced.keys, ...expand(context.master, [...traced.trees])]);
	if (expanded.browser) for (const file of context.files.filter(BROWSER_FILE)) keys.add(file);
	if (expanded.wholeCopy) for (const key of context.everything()) keys.add(key);
	const inputs = Object.fromEntries([...keys].sort().map(key => [key, Object.hasOwn(outsideBefore, key) ? outsideBefore[key] : context.digest(key)]));
	const programs = Object.fromEntries([...new Set([...traced.programs, ...traced.checked, ...traced.nodes, ...traced.untraced])].sort().map(program => [program, programIdentity(program, context.master)]));
	const outsideChanged = differences(outsideBefore, outsideAfter);
	const problems = [
		...(outcome.error ? [`起動できない: ${outcome.error}`] : []),
		...(copyChanged.length ? [`写しのファイルを変えた（${listOf(copyChanged)}）`] : []),
		...(outsideChanged.length ? [`作業ツリーの外の入力が実行の間に変わった（${listOf(outsideChanged)}）`] : [])
	];
	const record = {
		format: FORMAT,
		name: unit.name,
		command: unit.command,
		node: process.version,
		runner,
		environment: environment(),
		programs,
		status: outcome.status,
		signal: outcome.signal,
		passed: outcome.status === 0 && !outcome.signal && !problems.length,
		problems,
		ms,
		finished: new Date().toISOString(),
		output,
		expanded,
		copier: traced.copier,
		digest: sha256(Object.entries(inputs).map(([key, hash]) => `${key} ${hash}`).join('\n')),
		inputs
	};
	fs.writeFileSync(path.join(records, `${id}.json`), `${JSON.stringify(record, null, '\t')}\n`, { mode: 0o600 });
	return record;
}

const cell = text => String(text).replace(/\|/g, '\\|');
/** 結果の表の行。 */
function row(unit, record, reused) {
	const extra = [record.expanded?.wholeCopy ? '写しの全体' : null, record.expanded?.browser ? 'docs/ の外のファイル' : null].filter(Boolean);
	const inputs = `${record.digest.slice(0, 12)}（${Object.keys(record.inputs).length}件${extra.length ? `。${extra.join('・')}を含む` : ''}）`;
	const result = reused
		? `再利用（合格 ${record.finished}）`
		: record.passed
			? `合格（${Math.round(record.ms / 1000)}秒）`
			: `不合格（${[record.signal ? `信号 ${record.signal}` : record.status !== 0 && record.status !== null ? `終了コード ${record.status}` : null, ...record.problems].filter(Boolean).join('、') || '終了コードなし'}）`;
	return `| ${cell(unit.name)} | ${inputs} | ${cell(result)} | ${cell(record.output)} |`;
}
const TABLE_HEAD = '| 単位 | 入力の SHA-256（件数） | 結果 | 出力 |\n| :--- | :--- | :--- | :--- |';

/** 印の中身の先頭のプロセス番号（数でなければ NaN）。 */
const lockOwner = content => Number(String(content).trim().split(/\s+/)[0]);

/** 印の中身の持ち主が動いているか（このプロセス自身と、正の整数でないものは動いていないとする。ほかの利用者のプロセスは動いているとする）。 */
function lockAlive(content) {
	const owner = lockOwner(content);
	if (!Number.isInteger(owner) || owner <= 0 || owner === process.pid) return false;
	try {
		process.kill(owner, 0);
		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
}

/** 持ち主の終わった印 content を引き継ぐための引継ぎの印の名前（印の中身ごとに1つ）。 */
const lockClaim = (file, content) => `${file}.${sha256(content).slice(0, 16)}.taken`;

/**
 * 記録の置き場所を使う印（run-units.lock）を取り、{ file, content } を返す（ほかの run-units.js が使っていれば例外）。
 * 印の中身はプロセス番号と乱数で、先に書いた一時のファイルのリンクとして作る（書きかけの印を読ませない）。
 * 持ち主の終わった印は、その中身の引継ぎの印（これも一時のファイルのリンク）を作れた1つだけが、一時のファイルの rename で置き換える（同時に引き継いでも1つだけが取る）。
 * 引継ぎの印がすでにあれば、その持ち主が動いていれば使っているとし、終わっていれば（置き換える前に止まった）その中身でさらに引き継ぐ。
 * 置き換える前に印を読み直し、読んだ印か、たどった引継ぎの印の中身のままのときだけ置き換える（その間に持ち主が印を消し、ほかが取り直していれば
 * 初めからやり直す）。引継ぎの印は消さない（同じ中身を後から読んだ run-units.js に、取り直した印を置き換えさせない）。
 */
function acquireLock(records) {
	const file = path.join(records, 'run-units.lock');
	const content = `${process.pid} ${crypto.randomBytes(8).toString('hex')}\n`;
	const own = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.new`;
	fs.writeFileSync(own, content, { flag: 'wx', mode: 0o600 });
	try {
		take: for (;;) {
			try {
				fs.linkSync(own, file);
				return { file, content };
			} catch (error) {
				if (error.code !== 'EEXIST') throw error;
			}
			let held;
			try {
				held = fs.readFileSync(file, 'utf8');
			} catch (error) {
				if (error.code !== 'ENOENT') throw error;
				// 持ち主が印を消した後は作り直す。名前が残っていれば（壊れたリンク）、読めない印とする（繰り返さない）
				try {
					fs.lstatSync(file);
				} catch {
					continue;
				}
				throw new Error(`run-units.lock を読めない（ファイルでない）: ${file}`);
			}
			// この回に読んだ印と、たどった引継ぎの印の中身（どれも持ち主が終わっている）。
			const seen = [held];
			for (;;) {
				if (lockAlive(held)) throw new Error(`ほかの run-units.js（プロセス ${lockOwner(held)}）がこの記録の置き場所を使っている: ${records}`);
				try {
					// 引継ぎの印も中身を書いた一時のファイルのリンクとして作る（書きかけの空の引継ぎの印を、終わった持ち主と読ませない）。
					fs.linkSync(own, lockClaim(file, held));
				} catch (error) {
					if (error.code !== 'EEXIST') throw error;
					held = fs.readFileSync(lockClaim(file, held), 'utf8');
					seen.push(held);
					continue;
				}
				// 読んだ後に持ち主が印を消し、ほかの run-units.js が取り直していれば置き換えない（初めからやり直す）。
				let now = null;
				try {
					now = fs.readFileSync(file, 'utf8');
				} catch (error) {
					if (error.code !== 'ENOENT') throw error;
				}
				if (!seen.includes(now)) continue take;
				fs.renameSync(own, file);
				return { file, content };
			}
		}
	} finally {
		fs.rmSync(own, { force: true });
	}
}

/** 自分の印（中身が同じもの）だけを消す。 */
function releaseLock(lock) {
	try {
		if (fs.readFileSync(lock.file, 'utf8') === lock.content) fs.rmSync(lock.file);
	} catch {
		// すでにない
	}
}

/** SIGINT・SIGTERM・SIGHUP を受けたら、実行中の単位を止めて写しを消してから終わる処理を登録し、解除する関数を返す。 */
function installCleanup(state) {
	const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
	const handler = signal => {
		stopAll(state);
		if (state.dir) fs.rmSync(state.dir, { recursive: true, force: true });
		if (state.lock) releaseLock(state.lock);
		console.error(`run-units: ${signal} を受けたので、実行中の単位を止めて写しを消した`);
		process.exit(codes[signal]);
	};
	for (const signal of Object.keys(codes)) process.on(signal, handler);
	return () => { for (const signal of Object.keys(codes)) process.off(signal, handler); };
}

async function main(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`run-units: ${options.error}`);
		return 2;
	}
	let units;
	const state = { active: new Map(), dir: null, lock: null, tracer: null, aborted: false };
	try {
		if (!fs.existsSync(options.root) || !fs.statSync(options.root).isDirectory()) throw new Error(`--root がない: ${options.root}`);
		units = loadUnits(options.units, options.root);
		if (options.only) units = units.filter(unit => options.only.test(unit.name));
		if (!units.length) throw new Error(`--only に一致する単位がない: ${options.only}`);
		prepareRecords(options.records, !options.list);
		if (!options.list) state.lock = acquireLock(options.records);
	} catch (error) {
		console.error(`run-units: ${error.message}`);
		return 2;
	}
	const uninstall = installCleanup(state);
	try {
		const work = freeze(options.root);
		state.dir = work.dir;
		state.tracer = work.trace;
		const context = makeContext(work.master);
		const runner = runnerDigest(work.trace);
		const decisions = units.map(unit => reuseDecision(readRecord(path.join(options.records, `${recordId(unit.name)}.json`)), unit, context, runner));
		if (options.list) {
			console.log('| 単位 | 判定 |\n| :--- | :--- |');
			units.forEach((unit, index) => console.log(`| ${cell(unit.name)} | ${cell(decisions[index].reuse ? `記録を使う（${decisions[index].reason}）` : `実行する（${decisions[index].reason}）`)} |`));
			return 0;
		}
		const rows = new Array(units.length);
		const results = new Array(units.length);
		const summary = path.join(options.records, 'summary.md');
		// 前の実行の表を残さない（途中で止まったとき、記録を消した単位を合格とする行が残らない）。
		fs.rmSync(summary, { force: true });
		const writeSummary = () => fs.writeFileSync(summary, `${TABLE_HEAD}\n${rows.filter(Boolean).join('\n')}\n`, { mode: 0o600 });
		let next = 0;
		let failure = null;
		const worker = async () => {
			while (next < units.length && !state.aborted) {
				const index = next++;
				const unit = units[index];
				try {
					if (decisions[index].reuse) {
						results[index] = { passed: true, reused: true };
						rows[index] = row(unit, readRecord(path.join(options.records, `${recordId(unit.name)}.json`)), true);
					} else {
						const record = await runUnit(unit, index, { work, context, records: options.records, runner, state });
						results[index] = { passed: record.passed, reused: false };
						rows[index] = row(unit, record, false);
					}
					writeSummary();
				} catch (error) {
					// 最初の例外で、ほかの実行中の単位を止める（写しは、すべての単位が終わってから消す）。
					if (!state.aborted) {
						failure = error;
						state.aborted = true;
						stopAll(state);
					}
				}
			}
		};
		await Promise.all(Array.from({ length: Math.min(options.jobs, units.length) }, worker));
		if (failure) throw failure;
		console.log(`${TABLE_HEAD}\n${rows.join('\n')}`);
		const failed = results.filter(result => !result.passed).length;
		const reused = results.filter(result => result.reused).length;
		console.log(`run-units: ${units.length}単位（実行 ${units.length - reused}・再利用 ${reused}・不合格 ${failed}）。記録の置き場所 ${options.records}`);
		return failed ? 1 : 0;
	} catch (error) {
		// 写し・記録を作れないなどの実行できない環境（それまでに終わった単位の記録は残る）
		console.error(`run-units: ${error.message}`);
		return 2;
	} finally {
		uninstall();
		stopAll(state);
		if (state.dir) fs.rmSync(state.dir, { recursive: true, force: true });
		if (state.lock) releaseLock(state.lock);
	}
}

if (require.main === module) main().then(code => { process.exitCode = code; });

module.exports = { FORMAT, TRACE, MARKER, ENVIRONMENT, BROWSER_FILE, outside, realResolve, parseArgs, copiedPath, unitError, loadUnits, prepareRecords, recordId, digestOf, copyHashes, linksIn, walk, expand, declaredInputs, readTrace, expansions, environment, programIdentity, makeContext, requiredInputs, reuseDecision, readRecord, runnerDigest, freeze, quoteOption, tracedProcesses, stopUnit, stopAll, execute, differences, runUnit, row, lockOwner, lockAlive, lockClaim, acquireLock, releaseLock, installCleanup, main };
