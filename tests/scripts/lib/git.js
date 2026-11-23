/*
 * 開発用のスクリプト（tests/scripts）が使う git の呼出し（開発プロセス定義書 4.6）。
 * 利用者の環境によって結果が変わらないように、次を固定する。
 * - 別のリポジトリを指す環境変数（GIT_DIR・GIT_WORK_TREE・GIT_INDEX_FILE など。Git のフックの中で設定される）は渡さない。
 * - 差分の形（diff.noprefix・diff.mnemonicPrefix・外部の差分・textconv・色）は DIFF_FORMAT の引数で固定し、
 *   ASCII 以外の文字のパスは引用しない（core.quotepath=false。"・\・制御文字を含むパスは、この設定でも引用される）。
 * - hunk の間の文脈の行数（diff.interHunkContext）も DIFF_FORMAT で 0 に固定する（-U0 の hunk をまとめない）。
 * - 差分の取り方（改名の検出 diff.renames、アルゴリズム diff.algorithm、字下げの手がかり diff.indentHeuristic）も、git の既定の値に固定する。
 *   改名の検出の上限（diff.renameLimit）は上限なし（-l0）に固定する（上限を超えると改名を検出せず、追加と削除の差分になる）。
 * - 改行の変換（core.autocrlf）はしない（CRLF の行の末尾空白を git diff --check が報告するよう、作業ツリーの内容のまま比べる）。
 * - 大きなファイルとみなす大きさ（core.bigFileThreshold）は git の既定の値（512m）に固定する（小さい値では、それを超えるファイルの
 *   git diff がバイナリの差分になって行の差分を出さず、追加した行の検査と差分の範囲から黙って抜ける）。
 * - 空白の検査（git diff --check）の対象は既定の値に固定する（core.whitespace）。
 * - 署名の検証の表示（log.showSignature）はしない（git log の --format の出力に、署名したコミットの検証の行が混ざる）。
 * - 利用者の属性ファイル（core.attributesFile。*.js -diff などで差分をバイナリにする）は読まない。リポジトリの .gitattributes は使う。
 *   クローンの .git/info/attributes は git に読まない設定がないので固定できない（開発プロセス定義書 4.6 に依存として書く）。
 * - git diff の「+++ 」の行のパスは diffTarget で取り出す（空白を含む名前の後のタブを除き、引用された名前を元に戻す）。
 * - 未追跡のファイルの一覧は UNTRACKED（リポジトリの .gitignore だけで除く）で取る。--exclude-standard・git status は、
 *   利用者の core.excludesFile・status.showUntrackedFiles とクローンの .git/info/exclude に従うので使わない。
 */
const os = require('node:os');
const { spawnSync } = require('node:child_process');

// 作業ツリー・リポジトリ・差分の処理を別のものに向ける環境変数。
const REDIRECTING = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PREFIX', 'GIT_QUARANTINE_PATH', 'GIT_EXTERNAL_DIFF', 'GIT_DIFF_OPTS']);

// git diff の出力の形を固定する引数（a/・b/ の接頭辞、外部の差分と textconv を使わない、色なし、hunk をまとめない、改名を上限なしで検出する、myers、字下げの手がかりを使う）。
const DIFF_FORMAT = ['--no-ext-diff', '--no-textconv', '--no-color', '--src-prefix=a/', '--dst-prefix=b/', '--inter-hunk-context=0', '--find-renames', '-l0', '--diff-algorithm=myers', '--indent-heuristic'];

// 未追跡のファイルの一覧（リポジトリの .gitignore だけで除く）。
const UNTRACKED = ['ls-files', '-z', '--others', '--exclude-per-directory=.gitignore'];

/** REDIRECTING の環境変数を除いた環境。 */
function gitEnv(env = process.env) {
	return Object.fromEntries(Object.entries(env).filter(([name]) => !REDIRECTING.has(name)));
}

// すべての呼出しに付ける設定。
const CONFIG = ['-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', '-c', 'core.bigFileThreshold=512m', '-c', 'log.showSignature=false', '-c', 'core.whitespace=blank-at-eol,blank-at-eof,space-before-tab', '-c', `core.attributesFile=${os.devNull}`];

/** git を実行する。encoding に 'buffer' を与えると、出力を Buffer で返す。 */
function git(args, cwd, { encoding = 'utf8', input } = {}) {
	// spawnSync は encoding で入力の文字列も変換するため、Buffer で返すときは encoding を渡さず入力を Buffer にする。
	const options = { cwd, env: gitEnv(), input: typeof input === 'string' ? Buffer.from(input) : input, maxBuffer: 512 * 1024 * 1024 };
	if (encoding !== 'buffer') options.encoding = encoding;
	return spawnSync('git', [...CONFIG, ...args], options);
}

// git が引用した名前の中の逃がし（\t・\n・\"・\\ など。ほかは \<3桁の8進数> のバイト）。
const ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/** git が "…" で引用した名前の中身を、元の名前（UTF-8）に戻す。 */
function unquote(text) {
	const chars = [...text];
	const bytes = [];
	for (let i = 0; i < chars.length; i++) {
		if (chars[i] !== '\\') { bytes.push(...Buffer.from(chars[i])); continue; }
		if (/^[0-7]{3}$/.test(chars.slice(i + 1, i + 4).join(''))) { bytes.push(parseInt(chars.slice(i + 1, i + 4).join(''), 8)); i += 3; continue; }
		i++;
		bytes.push(ESCAPES[chars[i]] ?? chars[i].charCodeAt(0));
	}
	return Buffer.from(bytes).toString('utf8');
}

/**
 * git diff の行が「+++ 」の行なら、変更後のパス（b/ を除く。/dev/null は null）を返し、ほかの行では undefined を返す。
 * 空白を含む名前の後に git が付けるタブを除き、"…" で引用された名前（"・\・制御文字を含む）を元に戻す。
 */
function diffTarget(line) {
	if (!line.startsWith('+++ ')) return undefined;
	let name = line.slice(4);
	if (name.endsWith('\t')) name = name.slice(0, -1);
	if (name === '/dev/null') return null;
	if (name.length > 1 && name.startsWith('"') && name.endsWith('"')) name = unquote(name.slice(1, -1));
	return name.startsWith('b/') ? name.slice(2) : null;
}

module.exports = { REDIRECTING, DIFF_FORMAT, UNTRACKED, CONFIG, gitEnv, git, unquote, diffTarget };
