/*
 * 単位の実行が読んだファイルの記録（開発プロセス定義書 Stage 4「単位ごとの実行と記録」・4.6）。
 * run-units.js が、単位のすべての Node のプロセスに NODE_OPTIONS の --require で読み込ませる（直接は実行しない）。
 * 環境変数 KOGAI_TRACE_DIR がなければ何もしない。同じスレッドに2つ読み込まれたときは、先に読み込まれたもの（run-units.js が NODE_OPTIONS の先頭に
 * 置いた、内側のもの）だけが記録する。
 * 記録は、プロセスごとのファイル（<KOGAI_TRACE_DIR>/<プロセス番号>.log）に、初めて見た「種類 パス」の行を同期で追記する
 * （SIGKILL で止められたプロセスの分も残る。Worker のスレッドも同じファイルに書く）。種類:
 *   read      fs の読取り・開く・存在の確認・状態・アクセス権・実パス・リンクの読取り・写しの元のファイル
 *   list      ディレクトリの一覧
 *   copy      写しの元のディレクトリ・ファイル（cp。その下のすべてを入力とする。run-units.js は、最上位のプロセスが写しの根を写したかをこれで見る）
 *   tree      recursive の一覧（その下のすべてを入力とする）
 *   whole     glob（fs.glob・fs.globSync・fs.promises.glob。パターン（文字列・配列）を JSON で書き、走査の範囲は決めない。
 *             記号・波括弧の展開・.. を真似ると端の形が尽きないため。run-units.js は写しの全体を入力とする）
 *   load      モジュールの読込み（require と、module.registerHooks があれば ESM の import も）
 *   exec      Node 以外のプログラムの起動（シェルを通す起動はシェル）
 *   node      process.execPath でない Node の起動（名前だけの node・ほかのパス。run-units.js が起こしたプログラムとして照合する）
 *   untraced  記録の設定を受け継がない Node のプロセスと Worker のスレッド（worker_threads.Worker）の起動（渡す環境変数（与えたもの、なければ
 *             起動の時点の process.env）の KOGAI_TRACE_DIR が読み込んだ時点の値と違うか、その NODE_OPTIONS が読み込んだ時点の NODE_OPTIONS を含まないもの）
 * どのプロセスも同じく記録する（写しの根を写した最上位のプロセスの読取りを入力から除くのは run-units.js）。
 * 元の関数の戻り値・例外・this・付随するプロパティ（util.promisify.custom・realpathSync.native）は変えない（util.promisify.custom も記録してから呼ぶ）。
 * 対象外: Node の内部が先に取り出した関数による読取り（node --test の試験ファイルの探索、モジュールの解決の探索（拡張子の補い・index.js）と
 * package.json の探索など。試験ファイルは子のプロセスの読込みで記録され、写しの中の package.json は run-units.js が決まった入力にする）、
 * module.registerHooks のない Node での ESM の import。
 */
const dir = process.env.KOGAI_TRACE_DIR;
const LOADED = Symbol.for('kogai.trace-reads');
if (dir && !globalThis[LOADED]) {
	globalThis[LOADED] = true;
	const fs = require('node:fs');
	const path = require('node:path');
	const Module = require('node:module');
	const childProcess = require('node:child_process');
	const { fileURLToPath } = require('node:url');
	const util = require('node:util');
	// 読み込んだ時点の記録の設定（後で process.env から消されても、受け継がない起動を見分けられるようにする）。
	const settings = { dir, options: process.env.NODE_OPTIONS ?? '' };
	const log = path.join(dir, `${process.pid}.log`);
	const append = fs.appendFileSync;
	const seen = new Set();
	let writing = false;

	/** 記録の行を1回だけ書く（書く間の fs の呼出しは記録しない。記録の置き場所が消えた後は書かない）。 */
	const write = line => {
		if (seen.has(line) || writing) return;
		seen.add(line);
		writing = true;
		try {
			append(log, `${line}\n`);
		} catch {
			// 単位が終わって記録の置き場所が消えた後
		} finally {
			writing = false;
		}
	};
	/** パスの引数（文字列・Buffer・file: の URL）を絶対パスにする。ファイル記述子などは null。 */
	const toPath = target => {
		if (typeof target === 'string') return path.resolve(target);
		if (Buffer.isBuffer(target)) return path.resolve(target.toString());
		if (target instanceof URL) return target.protocol === 'file:' ? fileURLToPath(target) : null;
		return null;
	};
	const note = (kind, target) => {
		const file = kind === 'exec' || kind === 'node' || kind === 'untraced' || kind === 'whole' ? target : toPath(target);
		if (file) write(`${kind} ${file}`);
	};
	/** 先に記録してから fn を呼ぶ関数（this・引数・戻り値・例外は fn のまま）。 */
	const recorded = (fn, record) => function (...args) {
		try {
			record(...args);
		} catch {
			// 記録の失敗で元の処理を変えない
		}
		return fn.apply(this, args);
	};
	/**
	 * object[name] を、先に記録してから元の関数を呼ぶ関数に置き換える（元の関数の付随するプロパティを写す）。
	 * util.promisify.custom（execFile などの Promise の版。元の関数を直接呼ぶ）も、記録してから呼ぶものにする。
	 */
	const wrap = (object, name, record) => {
		const original = object[name];
		if (typeof original !== 'function') return;
		const wrapped = recorded(original, record);
		const descriptors = Object.getOwnPropertyDescriptors(original);
		const custom = descriptors[util.promisify.custom];
		if (custom && typeof custom.value === 'function') descriptors[util.promisify.custom] = { ...custom, value: recorded(custom.value, record) };
		Object.defineProperties(wrapped, descriptors);
		object[name] = wrapped;
	};

	// createReadStream は fs.open を、exists は fs.access を、呼出しの時点の fs から呼ぶので、包まなくても記録される。
	const READ = ['readFileSync', 'readFile', 'openSync', 'open', 'existsSync', 'statSync', 'stat', 'lstatSync', 'lstat', 'accessSync', 'access', 'realpathSync', 'realpath', 'readlinkSync', 'readlink', 'copyFileSync', 'copyFile', 'openAsBlob'];
	const LIST = ['readdirSync', 'readdir', 'opendirSync', 'opendir'];
	const COPY = ['cpSync', 'cp'];
	const GLOB = ['globSync', 'glob'];
	for (const target of [fs, fs.promises]) {
		for (const name of READ) wrap(target, name, file => note('read', file));
		for (const name of LIST) wrap(target, name, (file, options) => note(options && options.recursive ? 'tree' : 'list', file));
		for (const name of COPY) wrap(target, name, source => note('copy', source));
		for (const name of GLOB) wrap(target, name, patterns => note('whole', `fs.glob ${JSON.stringify(patterns)}`));
	}
	for (const target of [fs.realpathSync, fs.realpath]) wrap(target, 'native', file => note('read', file));

	for (const extension of Object.keys(Module._extensions)) {
		const original = Module._extensions[extension];
		Module._extensions[extension] = function (module, filename) {
			note('load', filename);
			return original.call(this, module, filename);
		};
	}
	// ESM の import も記録する（module.registerHooks は require も通るが、同じ行は1回だけ書く）。
	if (typeof Module.registerHooks === 'function') {
		Module.registerHooks({
			load(url, context, nextLoad) {
				try {
					// file: でない URL（node: の組込みなど）は toPath が除く。
					note('load', new URL(url));
				} catch {
					// 記録の失敗で読込みを変えない
				}
				return nextLoad(url, context);
			}
		});
	}

	const isNode = program => program === process.execPath || /^node(?:\.exe)?$/i.test(path.basename(String(program)));
	/** 渡す環境変数が、読み込んだ時点の記録の設定を受け継ぐか。 */
	const inherits = env => env.KOGAI_TRACE_DIR === settings.dir && String(env.NODE_OPTIONS ?? '').includes(settings.options);
	/** 引数の列から、options の対象（配列・関数でないオブジェクト）を探す。 */
	const optionsOf = rest => rest.find(value => value !== null && typeof value === 'object' && !Array.isArray(value)) || null;
	/** 起動するプログラムを記録する。shell の起動はシェルとする（中で何を実行するかは分からない）。 */
	const launched = (program, options, viaShell) => {
		const shell = (options && options.shell) || viaShell;
		if (shell) {
			note('exec', typeof shell === 'string' ? shell : process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh');
			return;
		}
		if (!isNode(program)) {
			note('exec', String(program));
			return;
		}
		if (program !== process.execPath) note('node', String(program));
		// 環境変数を与えなければ、起動の時点の process.env を渡す（記録の設定が消されていれば受け継がない）。
		if (!inherits(options && options.env && typeof options.env === 'object' ? options.env : process.env)) note('untraced', String(program));
	};
	for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) wrap(childProcess, name, (program, ...rest) => launched(program, optionsOf(rest), false));
	wrap(childProcess, 'fork', (modulePath, ...rest) => {
		const options = optionsOf(rest);
		// fork は shell を使わない。
		launched(options && options.execPath ? options.execPath : process.execPath, { ...options, shell: false }, false);
	});
	// exec は呼出しの時点の execFile を（shell を与えて）呼ぶので、execFile の包みで記録される。execSync は中の spawnSync を直接呼ぶので包む。
	wrap(childProcess, 'execSync', (command, ...rest) => launched(null, optionsOf(rest), true));
	// 環境変数を与えた Worker のスレッドは、記録の設定を受け継がないことがある（スレッドの process.env に KOGAI_TRACE_DIR がなければ記録しない）。
	const workerThreads = require('node:worker_threads');
	const OriginalWorker = workerThreads.Worker;
	workerThreads.Worker = class Worker extends OriginalWorker {
		constructor(filename, options) {
			try {
				// SHARE_ENV（シンボル）は、このスレッドの process.env を共有する。
				const env = options && options.env && typeof options.env === 'object' ? options.env : process.env;
				if (!inherits(env)) note('untraced', 'worker_threads.Worker');
			} catch {
				// 記録の失敗で起動を変えない
			}
			super(filename, options);
		}
	};
}
