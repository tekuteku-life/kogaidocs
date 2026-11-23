/*
 * 開発用のスクリプト（tests/scripts）の試験（tests/unit/dev-scripts-*.test.js）が共通に使う補助。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/** 一時ディレクトリにファイルを置き、試験の後に消す。 */
function withTempDir(files, run) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-dev-scripts-'));
	try {
		for (const [file, text] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
			fs.writeFileSync(path.join(dir, file), text);
		}
		return run(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** withTempDir の非同期版。 */
async function withTempDirAsync(files, run) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kogai-dev-scripts-'));
	try {
		for (const [file, text] of Object.entries(files)) {
			fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
			fs.writeFileSync(path.join(dir, file), text);
		}
		return await run(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

/** 一時の Git のリポジトリで git を実行する（利用者の設定・フックを読まず、親の GIT_ の環境変数を引き継がない。失敗したら試験を失敗にする）。 */
function runGit(dir, args, input) {
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));
	const result = spawnSync('git', ['-c', 'user.name=kogai-test', '-c', 'user.email=kogai-test@example.invalid', '-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${os.devNull}`, ...args], { cwd: dir, input, encoding: 'utf8', env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull } });
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

/** 一時の Git のリポジトリで git を実行し、標準出力（前後の空白を除く）を返す。 */
function git(dir, ...args) {
	return runGit(dir, args);
}

/** git に標準入力を与えて実行する（hash-object --stdin・mktree など）。 */
function gitInput(dir, input, ...args) {
	return runGit(dir, args, input);
}

const gitAvailable = !spawnSync('git', ['--version']).error;

/** quiet の非同期版。 */
async function quietAsync(run) {
	const log = console.log;
	const error = console.error;
	console.log = () => {};
	console.error = () => {};
	try {
		return await run();
	} finally {
		console.log = log;
		console.error = error;
	}
}

const quiet = run => {
	const log = console.log;
	const error = console.error;
	console.log = () => {};
	console.error = () => {};
	try {
		return run();
	} finally {
		console.log = log;
		console.error = error;
	}
};

/** プロセスが動いているか（Linux では、止まって回収待ちのゾンビを動いていないとみなす）。 */
function running(pid) {
	try {
		return !/^\d+ \(.*\) [ZX] /.test(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
	} catch {
		if (fs.existsSync('/proc/self')) return false;
		try {
			process.kill(pid, 0);
			return true;
		} catch {
			return false;
		}
	}
}

/** 指定のプロセスが止まるまで待ち（上限 ms）、まだ動いているものを返す。 */
async function waitStopped(pids, limit = 10000) {
	for (let waited = 0; waited < limit && pids.some(running); waited += 100) await new Promise(resolve => setTimeout(resolve, 100));
	return pids.filter(running);
}

/** captured の非同期版。 */
async function capturedAsync(run) {
	const lines = [];
	const log = console.log;
	const error = console.error;
	console.log = (...args) => lines.push(args.join(' '));
	console.error = (...args) => lines.push(args.join(' '));
	try {
		return { code: await run(), text: lines.join('\n') };
	} finally {
		console.log = log;
		console.error = error;
	}
}

/** console.log・console.error の出力を集めて、戻り値とともに返す。 */
function captured(run) {
	const lines = [];
	const log = console.log;
	const error = console.error;
	console.log = (...args) => lines.push(args.join(' '));
	console.error = (...args) => lines.push(args.join(' '));
	try {
		return { code: run(), text: lines.join('\n') };
	} finally {
		console.log = log;
		console.error = error;
	}
}

/** dir より上のリポジトリを git に探させない（一時ディレクトリが Git の作業ツリーの中にある環境でも「Git の外」を作る）。 */
function outsideGit(dir, run) {
	const saved = process.env.GIT_CEILING_DIRECTORIES;
	process.env.GIT_CEILING_DIRECTORIES = path.dirname(fs.realpathSync(dir));
	try {
		return run();
	} finally {
		if (saved === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
		else process.env.GIT_CEILING_DIRECTORIES = saved;
	}
}

/**
 * 無限ループの試料のコード。後始末を壊す変異を当てても残り続けないよう、期限（既定 60 秒）で自ら終わる。
 * 写しの消失や親の変化では終わらない（mutate.js が止め損ねたことを、試験が見分けられるようにする）。
 * record に環境変数の名前を与えると、ループの前に、プロセス番号と作業ディレクトリ（写し）を1行の JSON でそのファイルに追記する。
 */
const hangCode = (record, seconds = 60) => `${record ? `require('node:fs').appendFileSync(process.env.${record}, JSON.stringify({ pid: process.pid, cwd: process.cwd() }) + '\\n'); ` : ''}for (const end = Date.now() + ${seconds * 1000}; Date.now() < end;) {}`;

/**
 * 試料が書き残したプロセスを止め、記録のファイルを消す（後始末が壊れていても残さない）。写しは cleanupCopies で消す。
 * プロセス番号の使い回しで別のプロセスを止めないよう、作業ディレクトリが記録と同じプロセスだけを止める（/proc のない環境では止めない）。
 */
function cleanupHung(file) {
	if (!fs.existsSync(file)) return;
	for (const { pid, cwd } of fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))) {
		let same = false;
		try {
			same = fs.readlinkSync(`/proc/${pid}/cwd`).startsWith(cwd);
		} catch {
			// 終わったプロセス、または /proc のない環境
		}
		if (same) process.kill(pid, 'SIGKILL');
	}
	fs.rmSync(file, { force: true });
}

/** プロセス pid（既定はこのプロセス）が作った mutate.js の写し（kogai-mutate-<pid>-*）を消し、消したものの名前を返す。 */
function cleanupCopies(pid = process.pid) {
	const left = fs.readdirSync(os.tmpdir()).filter(name => name.startsWith(`kogai-mutate-${pid}-`));
	for (const name of left) fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
	return left;
}

module.exports = { withTempDir, withTempDirAsync, git, gitInput, gitAvailable, quietAsync, quiet, running, waitStopped, capturedAsync, captured, outsideGit, hangCode, cleanupHung, cleanupCopies };
