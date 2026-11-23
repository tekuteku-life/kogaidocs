#!/usr/bin/env node
/*
 * 指摘の範囲の判定の補助（開発プロセス定義書 4.1 の 6.・4.6）。ゲートの指摘（<file>:<line>: …）ごとに、
 * 行が比較元と作業ツリー（未追跡の新規ファイルを含む）の差分（前後3行を含む）の中か外かを表にする。
 * js の参照（差分の中・外とも）は、その行を含む関数の呼出元を --callers の深さ（既定 3）までたどり（impact.js）、
 * 比較元から変わった呼出元（呼出しの行が差分の中、または呼出元の関数の本文が変わったもの。前後の行の幅は付けない）を「呼出元の変更」の列に出す。
 * 変更外とするかの判定は、比較元と作業ツリーで同じ再現手順の結果が一致するか（呼出元の変更があればその経路でも）による（4.1 の 6.）。この表は補助である。
 * 解析の規則:
 *   - 区分の接頭辞（文書:・将来:・変更外:）は、参照の前でも後ろでもよい。箇条の記号と行頭の空白は無視する。
 *   - 1件に複数の参照（a.md:1・b.md:2、a.md:1、b.md:2）と、行の範囲（a.md:10-12）、行の後の注記（a.md:10（文書）。注記の中の「、」「,」は区切りとしない）に対応する。
 *   - 参照を「と」「および」などの語でつなぐ行（a.md:1 と b.md:2: …、a.md:1 と b.md:2 ほか: …）は、解析できない行として表に出す。
 *     括弧のない注記は最初の : で終わるので、後ろの参照がどこで切れても落とさないよう、括弧のない注記のある行は、内容に参照の形
 *     （ファイル:行）があるか、内容が数字で始まれば、すべてこれとみなす（参照や数字で始まる内容は、注記を括弧に入れて書く）。
 *   - ディレクトリのない名前は、リポジトリのファイル（追跡対象と未追跡）で一意に決まれば解決し、決まらなければ「解決できない」とする。
 * 行番号はゲートに出した時点のもの。--snapshot でその時点の差分を保存し、結果を受けたときに --from-snapshot で使う。
 * 使い方: node tests/scripts/finding-scope.js --base <比較元> [--root <リポジトリ>] [--context <行数>] --snapshot <保存先>
 *         node tests/scripts/finding-scope.js [--base <比較元> | --from-snapshot <保存先>] [--root] [--context] [--callers <深さ>] [指摘のファイル]（省略時は標準入力）
 *   呼出元は今の作業ツリーでたどるため、--from-snapshot のときは指摘を直す前に実行する。
 * 行頭の箇条で解析できない行は「解決できない（指摘の形式を解析できない）」として表に出す（字下げした箇条は前の指摘の続きとして飛ばす）。
 * 終了コード: 0 表を出した（または差分を保存した）、1 解決できない参照・解析できない指摘あり、2 引数の誤り（ない・読めない指摘のファイル、書けない --snapshot の保存先、差分の保存の形でない --from-snapshot を含む）・git がない
 */
const fs = require('node:fs');
const path = require('node:path');
const { enclosingFunctions, callers } = require('./impact');
const { git, DIFF_FORMAT, UNTRACKED, diffTarget } = require('./lib/git');

const KIND = '(文書|将来|変更外)';
// 参照: ファイル（空白・:・区切り・括弧のほかの文字。拡張子のない名前・ASCII 以外の文字を含む）:行[-行]（注記）。
const REF = '[^\\s:・、,（）]+:\\d+(?:-\\d+)?(?:（[^）]*）)?';
// 括弧のない注記の後の内容の中の参照の形（ファイル:行）。
const REF_FORM = /[^\s:・、,（）]+:\d/;

/**
 * 指摘の行から、参照（ファイル・開始行・終了行）・区分・内容を取り出す。参照の後の括弧のない注記（a.js:46 ほか:）も許す。
 * 行頭の箇条（- か *。字下げした箇条は前の指摘の続きとする）で解析できないものは、unparsed の参照として返す（黙って飛ばさない）。
 * 括弧のない注記のある行は、内容に参照の形があるか内容が数字で始まれば（a.js:10 と b.js:20 ほか: …、a.js:10 ほか（同じ形: b.js:20）: …）、解析できない行とする。
 */
function parseFindings(text) {
	const findings = [];
	const pattern = new RegExp(`^(?:${KIND}:\\s*)?((?:${REF}\\s*[・、,]\\s*)*${REF})(?:\\s+([^:]*?))?\\s*:\\s*(?:${KIND}:\\s*)?(.*)$`);
	for (const raw of text.split('\n')) {
		const found = raw.replace(/^\s*(?:[-*]\s*)?/, '').match(pattern);
		if (!found) {
			if (/^[-*]\s+\S/.test(raw)) findings.push({ refs: [{ file: '（解析できない行）', line: 0, end: 0, unparsed: true }], kind: '', text: raw.replace(/^[-*]\s+/, '').trim() });
			continue;
		}
		// 括弧のない注記は最初の : で終わるので、後ろの参照は、注記がファイル名で切れれば内容が行番号で始まり（a.js:10 と b.js:20 ほか: …）、
		// 前の : で切れれば内容に入る（a.js:10 ほか（同じ形: b.js:20）: …、a.js:10 ほか 変更外: b.js:20: …）。どちらも黙って落とさず解析できない行とする。
		if (found[3] && (/^\d/.test(found[5]) || REF_FORM.test(found[5]))) {
			findings.push({ refs: [{ file: '（解析できない行）', line: 0, end: 0, unparsed: true }], kind: '', text: raw.replace(/^\s*[-*]\s+/, '').trim() });
			continue;
		}
		// 参照は REF を順に照合して取り出す（区切りで分けると、注記の中の「、」「,」でも分かれる）。
		const refs = found[2].match(new RegExp(REF, 'g')).map(ref => {
			const parts = ref.replace(/（[^）]*）$/, '').match(/^(.+):(\d+)(?:-(\d+))?$/);
			return { file: parts[1], line: Number(parts[2]), end: Number(parts[3] || parts[2]) };
		});
		// 行の後の注記（a.md:10（文書））の区分の語も区分として扱う。
		const noted = (found[2].match(/（(?:[^）]*?)(文書|将来|変更外)(?:[^）]*)）/) || [])[1];
		findings.push({ refs, kind: found[1] || found[4] || noted || '', text: found[5] });
	}
	return findings;
}

/** --from-snapshot の内容が差分の保存（captureDiff の結果）の形か（ranges: { ファイル: [[開始, 終了], …] }、untracked・files: ファイルの配列）。 */
function snapshotShape(diff) {
	const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string');
	const pairs = value => Array.isArray(value) && value.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isInteger));
	return Boolean(diff?.ranges) && typeof diff.ranges === 'object' && !Array.isArray(diff.ranges) && Object.values(diff.ranges).every(pairs) && strings(diff.untracked) && strings(diff.files);
}

/** git diff -U0 の出力から、ファイルごとの変更後の行の範囲を返す（「+++ 」の行は、ファイルの見出しの中だけで読む）。 */
function parseDiffRanges(diffText) {
	const ranges = new Map();
	let file = null;
	let header = false;
	for (const line of diffText.split('\n')) {
		if (line.startsWith('diff --git ')) { header = true; file = null; continue; }
		const target = header ? diffTarget(line) : undefined;
		if (target !== undefined) { file = target; if (file && !ranges.has(file)) ranges.set(file, []); continue; }
		const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
		if (hunk) header = false;
		if (hunk && file) {
			const start = Number(hunk[1]);
			const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
			ranges.get(file).push([start, Math.max(start, start + count - 1)]);
		}
	}
	return ranges;
}

/** ディレクトリのない名前を、リポジトリのファイルの一覧で解決する。決まらなければ null と候補を返す。 */
function resolveFile(file, repositoryFiles) {
	if (file.includes('/')) return { file, candidates: [file] };
	const candidates = repositoryFiles.filter(entry => path.basename(entry) === file);
	return { file: candidates.length === 1 ? candidates[0] : null, candidates };
}

/** 参照ごとに、差分の中・差分の外（変更したファイル）・差分の外（変更していないファイル）・解決できない を判定する。 */
function classify(findings, diff, context = 3) {
	const ranges = diff.ranges instanceof Map ? diff.ranges : new Map(Object.entries(diff.ranges));
	const untracked = new Set(diff.untracked);
	return findings.flatMap(finding => finding.refs.map(ref => {
		const base = { ...ref, kind: finding.kind, text: finding.text };
		if (ref.unparsed) return { ...base, scope: `解決できない（指摘の形式を解析できない: ${finding.text.slice(0, 60).replace(/\|/g, '\\|')}）` };
		const resolved = resolveFile(ref.file, diff.files);
		if (!resolved.file) return { ...base, scope: `解決できない（候補 ${resolved.candidates.length}件${resolved.candidates.length ? `: ${resolved.candidates.join('、')}` : ''}）` };
		const file = resolved.file;
		if (untracked.has(file)) return { ...base, file, scope: '差分の中（新規ファイル）' };
		const fileRanges = ranges.get(file);
		if (!fileRanges) return { ...base, file, scope: '差分の外（変更していないファイル）' };
		const inside = fileRanges.some(([start, end]) => ref.end >= start - context && ref.line <= end + context);
		return { ...base, file, scope: inside ? '差分の中' : '差分の外（変更したファイル）' };
	}));
}

/** 行が差分（前後 context 行を含む）の中か。 */
const insideDiff = (ranges, untracked, file, line, context) => untracked.has(file) || (ranges.get(file) || []).some(([start, end]) => line >= start - context && line <= end + context);

/**
 * js の参照について、その行を含む関数の呼出元のうち、比較元から変わったもの（呼出しの行が差分の中、または呼出元の関数の本文が変わったもの）を返す。
 * 対象外（js でない・解決できない・ファイルがない）なら null、関数の外の行なら { function: '', changed: [] }。
 */
function changedCallers(root, result, diff, depth = 3) {
	if (!result.file || !result.file.endsWith('.js') || result.scope.startsWith('解決できない')) return null;
	const full = path.join(root, result.file);
	if (!fs.existsSync(full)) return null;
	const ranges = diff.ranges instanceof Map ? diff.ranges : new Map(Object.entries(diff.ranges));
	const untracked = new Set(diff.untracked);
	const name = enclosingFunctions(fs.readFileSync(full, 'utf8'))[result.line - 1];
	if (!name) return { function: '', changed: [] };
	const bodies = new Map();
	// 呼出元の関数の本文の変更（空行は数えない。関数の後の空行は、行ごとの関数の名前でその関数に含まれるため）。
	const bodyChanged = (file, fn) => {
		if (!fn || !file.endsWith('.js')) return false;
		if (!bodies.has(file)) {
			const text = fs.readFileSync(path.join(root, file), 'utf8');
			bodies.set(file, { names: enclosingFunctions(text), lines: text.split('\n') });
		}
		const { names, lines } = bodies.get(file);
		return names.some((entry, index) => entry === fn && lines[index].trim() && insideDiff(ranges, untracked, file, index + 1, 0));
	};
	const changed = callers(root, [name], depth).flatMap(level => level.calledFrom.map(caller => ({ ...caller, depth: level.depth })))
		.filter(caller => insideDiff(ranges, untracked, caller.file, caller.line, 0) || bodyChanged(caller.file, caller.function));
	return { function: name, changed };
}

function gitText(args, cwd) {
	const result = git(args, cwd);
	if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} に失敗した: ${(result.error?.message || result.stderr || '').split('\n')[0]}`);
	return result.stdout;
}

/** 比較元と作業ツリー（未追跡の新規ファイルを含む）の差分を取る。 */
function captureDiff(root, base) {
	const ranges = parseDiffRanges(gitText(['diff', ...DIFF_FORMAT, '-U0', base, '--'], root));
	const untracked = gitText(UNTRACKED, root).split('\0').filter(Boolean);
	const files = [...gitText(['ls-files', '-z'], root).split('\0').filter(Boolean), ...untracked];
	return { base, ranges: Object.fromEntries(ranges), untracked, files };
}

function parseArgs(argv) {
	const options = { root: path.resolve(__dirname, '../..'), context: 3, callers: 3, files: [] };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		if (['--base', '--root', '--context', '--snapshot', '--from-snapshot', '--callers'].includes(argv[i]) && value === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--base') { options.base = value; i++; }
		else if (argv[i] === '--root') { options.root = path.resolve(value); i++; }
		else if (argv[i] === '--context') { options.context = Number(value); i++; }
		else if (argv[i] === '--snapshot') { options.snapshot = value; i++; }
		else if (argv[i] === '--from-snapshot') { options.fromSnapshot = value; i++; }
		else if (argv[i] === '--callers') { options.callers = Number(value); i++; }
		else if (argv[i].startsWith('--')) return { error: `不明な引数: ${argv[i]}` };
		else options.files.push(argv[i]);
	}
	if (!options.base && !options.fromSnapshot) return { error: '--base か --from-snapshot を指定する' };
	if (options.snapshot && !options.base) return { error: '--snapshot には --base を指定する' };
	if (!Number.isInteger(options.context) || options.context < 0) return { error: '--context には 0 以上の整数を指定する' };
	if (!Number.isInteger(options.callers) || options.callers < 0) return { error: '--callers には 0 以上の整数を指定する' };
	return options;
}

function main(argv = process.argv.slice(2), { input } = {}) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`finding-scope: ${options.error}`);
		return 2;
	}
	let diff;
	try {
		diff = options.fromSnapshot ? JSON.parse(fs.readFileSync(options.fromSnapshot, 'utf8')) : captureDiff(options.root, options.base);
	} catch (error) {
		console.error(`finding-scope: ${error.message}`);
		return 2;
	}
	// JSON だが差分の保存でないファイル（単位の記録・変異の一覧の取り違え）は、classify の未処理の例外にせず引数の誤りとする。
	if (options.fromSnapshot && !snapshotShape(diff)) {
		console.error(`finding-scope: ${options.fromSnapshot} は差分の保存（--snapshot で作ったもの）の形でない`);
		return 2;
	}
	if (options.snapshot) {
		// 書けない保存先（ない親ディレクトリ・ディレクトリ）は引数の誤り。
		try {
			fs.writeFileSync(options.snapshot, JSON.stringify(diff));
		} catch (error) {
			console.error(`finding-scope: 保存先 ${options.snapshot} に書けない（${error.code || error.message}）`);
			return 2;
		}
		console.log(`finding-scope: 比較元 ${options.base} との差分を ${options.snapshot} に保存した`);
		return 0;
	}
	let text = input;
	if (text === undefined) {
		// ない・読めない（ディレクトリを含む）指摘のファイルは引数の誤り。
		try {
			text = fs.readFileSync(options.files[0] ?? 0, 'utf8');
		} catch (error) {
			console.error(`finding-scope: 指摘のファイル ${options.files[0] ?? '（標準入力）'} がない・読めない（${error.code || error.message}）`);
			return 2;
		}
	}
	const results = classify(parseFindings(text), diff, options.context);
	console.log('| 指摘 | 区分 | 範囲 | 呼出元の変更 |');
	console.log('| :--- | :--- | :--- | :--- |');
	let reached = false;
	for (const result of results) {
		const found = options.callers ? changedCallers(options.root, result, diff, options.callers) : null;
		if (found?.changed.length) reached = true;
		const cell = !found ? '—' : !found.function ? '（関数の外）' : found.changed.length ? `${found.function} へ: ${found.changed.map(caller => `${caller.function || '（トップレベル）'}（${caller.file}:${caller.line}、深さ ${caller.depth}）`).join('、')}` : `${found.function} へ: なし`;
		console.log(`| ${result.file}:${result.line}${result.end !== result.line ? `-${result.end}` : ''} | ${result.kind || '（なし）'} | ${result.scope} | ${cell} |`);
	}
	if (results.some(result => result.scope.startsWith('差分の外'))) console.log('差分の外の指摘も、変更外とするのは比較元と作業ツリーで同じ再現手順の結果が一致したときだけである（4.1 の 6.）。');
	if (reached) console.log('呼出元の変更がある指摘は、その呼出元を通る経路でも比較元と作業ツリーで再現し、比較元で成り立たない経路があれば通常の指摘とする（4.1 の 6.）。');
	return results.some(result => result.scope.startsWith('解決できない')) ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { parseFindings, parseDiffRanges, resolveFile, classify, insideDiff, changedCallers, captureDiff, parseArgs, main };
