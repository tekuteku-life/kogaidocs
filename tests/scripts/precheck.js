#!/usr/bin/env node
/*
 * Stage 7・コミットの前の機械的チェック（開発プロセス定義書 Stage 7・Stage 10・4.6）。
 * - js/・sw.js・tests/ の全 js の node --check
 * - index.html の読込みの順に連結した js の構文検査（let・const の重複は構文の誤り）と、トップレベルの function・var の重複
 *   （宣言のファイルの組・件数・本文がすべて比較元と同じ重複だけを「変更外」として分けて出す）
 * - git diff --check <比較元>（コミット済み・ステージ済み・未ステージの変更の末尾空白・空行など）
 * - 比較元からの追加の行と、未追跡の新規テキストファイルの末尾空白・行頭の空白（タブ規約。JSDoc の " *" の行を除く）
 *   未追跡の新規テキストファイルは、ファイルの末尾の余分な空行も確かめる（git diff --check は未追跡のファイルを見ない）
 * - 文書の機械的チェック（check-docs.js。--pending はその記録の結果待ちのプレースホルダーだけ許す）
 * - --verified <検証記録>: 記録に書いた「検証したコードの SHA-256」が、今のコード（docs/ を除く）の集約値と一致すること
 * 使い方: node tests/scripts/precheck.js --base <比較元> [--root <リポジトリ>] [--date <YYYY-MM-DD>] [--verified <検証記録>] [--pending <記録>]
 *   --base: 比較元（今回の作業の着手前のコミット。開発プロセス定義書 4.1 の 6.）。省略できない
 *   --date: 比較元から変わった文書の変更の日（check-docs.js に渡す）
 * 終了コード: 0 問題なし（変更外だけを含む）、1 問題あり、2 引数の誤り（ない・読めない検証記録を含む）・git が必要なのにない（--verified を含む）
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { checkDocs, report, isDate } = require('./check-docs');
const { stripScriptNoise } = require('./lib/js-lexer');
const { git, DIFF_FORMAT, UNTRACKED, diffTarget } = require('./lib/git');
const { codeDigest } = require('./verify-twice');

const TEXT_EXTENSIONS = new Set(['.js', '.md', '.html', '.css', '.json', '.svg', '.sh', '.yml', '.yaml', '.txt']);

/** 構文検査の対象（js/・sw.js・tests/ の下の全 js）。 */
function scriptFiles(root) {
	const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
		const full = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(full) : entry.name.endsWith('.js') ? [full] : [];
	}) : [];
	return [...walk(path.join(root, 'js')), ...(fs.existsSync(path.join(root, 'sw.js')) ? [path.join(root, 'sw.js')] : []), ...walk(path.join(root, 'tests'))].map(full => path.relative(root, full)).sort();
}

/** 1行の末尾空白（CRLF の CR を含む。git diff --check の blank-at-eol と同じ）と、行頭の空白（タブ規約）を返す。JSDoc・ブロックコメントの継続行（" *"）は除く。 */
function lineWhitespaceIssues(file, line, number) {
	const issues = [];
	if (/[ \t\r]+$/.test(line)) issues.push({ file, line: number, message: '末尾空白' });
	// 空白で始まる行（タブの前の空白を含む）。JSDoc の続きの行（空白の後に *）と、空白だけの行（末尾空白として出す）は除く。
	if (/^ +(?![ *])/.test(line) && /\S/.test(line)) issues.push({ file, line: number, message: '行頭の空白（タブでインデントする）' });
	return issues;
}

/** テキスト全体の末尾空白と、行頭の空白と、ファイルの末尾の余分な空行（最後の改行の前の空白だけの行）を返す。 */
function whitespaceIssues(file, text) {
	const lines = text.split('\n');
	const issues = lines.flatMap((line, index) => lineWhitespaceIssues(file, line, index + 1));
	const trailing = text.match(/\n(?:[ \t\r]*\n)+$/);
	if (trailing) issues.push({ file, line: lines.length - (trailing[0].match(/\n/g).length - 1), message: 'ファイルの末尾の余分な空行' });
	return issues;
}

/**
 * git diff -U0 の出力から、追加の行（ファイル・行番号・内容）を返す。
 * 「+++ 」の行は、ファイルの見出し（diff --git の後、最初の hunk の前）の中だけで読む（追加の行の内容が ++ で始まっても見出しとしない）。
 */
function addedLines(diffText) {
	const added = [];
	let file = null;
	let line = 0;
	let header = false;
	for (const raw of diffText.split('\n')) {
		if (raw.startsWith('diff --git ')) { header = true; file = null; continue; }
		const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunk) { header = false; line = Number(hunk[1]); continue; }
		if (header) {
			const target = diffTarget(raw);
			if (target !== undefined) file = target;
			continue;
		}
		if (file && raw.startsWith('+')) added.push({ file, line: line++, text: raw.slice(1) });
	}
	return added;
}

/** index.html の読込みの順の js（js/ の下）。 */
function scriptOrder(html) {
	return [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+\.js)"[^>]*>/g)].map(found => found[1].replace(/^\.\//, ''));
}

/**
 * 宣言の行から、括弧の対応で宣言の本文の終わりまでを返す（文字列・コメント・正規表現の中の括弧は数えない）。
 * 関数は最初の { まで読み進めてから（引数を複数行に書いた宣言）、括弧が閉じるまでを本文とする。var は { がなければその行だけとする。
 */
function declarationBody(masked, original, index) {
	const isFunction = /^(?:async\s+)?function\b/.test(masked[index]);
	let depth = 0;
	let opened = false;
	for (let i = index; i < masked.length; i++) {
		for (const ch of masked[i]) {
			if (ch === '{') { depth++; opened = true; }
			else if (ch === '}') depth--;
		}
		if (opened ? depth <= 0 : !isFunction) return original.slice(index, i + 1).join('\n');
	}
	return original.slice(index).join('\n');
}

/** トップレベルの function・var の宣言（読込みの順）を、名前ごとに [{ file, line, body }] で返す。 */
function topLevelDeclarations(scripts) {
	const declarations = new Map();
	for (const script of scripts) {
		const original = script.text.split('\n');
		const masked = stripScriptNoise(script.text, { blankStrings: true }).split('\n');
		masked.forEach((line, index) => {
			const found = line.match(/^(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(|^var\s+([\w$]+)/);
			if (!found) return;
			const name = found[1] || found[2];
			if (!declarations.has(name)) declarations.set(name, []);
			declarations.get(name).push({ file: script.file, line: index + 1, body: declarationBody(masked, original, index) });
		});
	}
	return declarations;
}

/** 重複する名前ごとの、宣言のファイル・件数・本文の署名。 */
function duplicateSignatures(scripts) {
	return new Map([...topLevelDeclarations(scripts)].filter(([, list]) => list.length > 1).map(([name, list]) => [name, JSON.stringify(list.map(entry => [entry.file, entry.body]))]));
}

/**
 * 単一のグローバル環境（<script> の順次の読込み）での重複宣言を返す。
 * baseSignatures（比較元の duplicateSignatures）と宣言のファイル・件数・本文がすべて同じ重複には scope: '変更外' を付ける。
 */
function globalDuplicates(scripts, baseSignatures = new Map()) {
	const issues = [];
	try {
		new vm.Script(scripts.map(script => script.text).join('\n;\n'), { filename: 'index.html の読込みの順に連結した js' });
	} catch (error) {
		issues.push({ file: '(global)', line: 0, message: `読込みの順に連結した js の構文の誤り（let・const の重複など）: ${error.message}` });
	}
	const signatures = duplicateSignatures(scripts);
	for (const [name, list] of topLevelDeclarations(scripts)) {
		if (list.length < 2) continue;
		const unchanged = baseSignatures.get(name) === signatures.get(name);
		for (const entry of list.slice(1)) issues.push({ file: entry.file, line: entry.line, message: `トップレベルの宣言 ${name} が ${list[0].file}:${list[0].line} と重複する`, name, ...(unchanged ? { scope: '変更外' } : {}) });
	}
	return issues;
}

function precheck(root, options = {}) {
	const issues = [];
	const base = options.base;
	for (const file of scriptFiles(root)) {
		const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
		if (result.status !== 0) issues.push({ file, line: 1, message: `構文エラー: ${(result.stderr || '').split('\n').find(line => /Error/.test(line)) || 'node --check に失敗'}` });
	}
	if (fs.existsSync(path.join(root, 'index.html'))) {
		const scripts = scriptOrder(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).filter(file => fs.existsSync(path.join(root, file))).map(file => ({ file, text: fs.readFileSync(path.join(root, file), 'utf8') }));
		// 宣言のファイル・件数・本文がすべて比較元と同じ重複は変更外とする（残件台帳で扱う）。宣言を増やした・書き換えた重複は報告する。
		const baseHtml = git(['show', `${base}:index.html`], root);
		const baseScripts = baseHtml.status === 0 ? scriptOrder(baseHtml.stdout).map(file => ({ file, shown: git(['show', `${base}:${file}`], root) })).filter(entry => entry.shown.status === 0).map(entry => ({ file: entry.file, text: entry.shown.stdout })) : [];
		issues.push(...globalDuplicates(scripts, duplicateSignatures(baseScripts)));
	}
	const diffCheck = git(['diff', ...DIFF_FORMAT, '--check', base, '--'], root);
	if (diffCheck.error || ![0, 2].includes(diffCheck.status)) issues.push({ file: '(git)', line: 0, message: `git diff --check ${base} を実行できない: ${(diffCheck.error?.message || diffCheck.stderr || '').split('\n')[0]}` });
	else if (diffCheck.stdout.trim()) {
		for (const line of diffCheck.stdout.split('\n').filter(entry => /^[^+\s].*:\d+:/.test(entry))) {
			const [file, number, ...rest] = line.split(':');
			issues.push({ file, line: Number(number), message: `git diff --check: ${rest.join(':').trim()}` });
		}
	}
	const diff = git(['diff', ...DIFF_FORMAT, '-U0', base, '--'], root);
	if (!diff.error && diff.status === 0) {
		for (const added of addedLines(diff.stdout)) if (TEXT_EXTENSIONS.has(path.extname(added.file))) issues.push(...lineWhitespaceIssues(added.file, added.text, added.line).filter(issue => issue.message !== '末尾空白'));
	}
	const untracked = git(UNTRACKED, root);
	if (!untracked.error && untracked.status === 0) {
		for (const file of untracked.stdout.split('\0').filter(Boolean)) {
			if (!TEXT_EXTENSIONS.has(path.extname(file)) || !fs.existsSync(path.join(root, file))) continue;
			issues.push(...whitespaceIssues(file, fs.readFileSync(path.join(root, file), 'utf8')));
		}
	}
	issues.push(...checkDocs(root, { base: options.base, date: options.date, pending: options.pending }));
	if (options.verified) {
		const record = fs.readFileSync(path.resolve(root, options.verified), 'utf8');
		const written = (record.match(/検証したコードの SHA-256[^0-9a-f]*([0-9a-f]{64})/) || [])[1];
		let current;
		try {
			current = codeDigest(root);
		} catch (error) {
			// git がない・Git の作業ツリーでない（環境の誤り。終了コード 2）。
			issues.push({ file: '(git)', line: 0, message: `検証したコードの SHA-256 を求められない: ${error.message}` });
			return issues;
		}
		if (!written) issues.push({ file: options.verified, line: 0, message: '検証記録に「検証したコードの SHA-256」がない' });
		else if (written !== current) issues.push({ file: options.verified, line: 0, message: `検証したコードの SHA-256（${written.slice(0, 12)}…）が今のコード（${current.slice(0, 12)}…）と一致しない（Stage 8 をやり直す）` });
	}
	return issues;
}

function parseArgs(argv) {
	const options = { root: path.resolve(__dirname, '../..') };
	for (let i = 0; i < argv.length; i++) {
		const value = argv[i + 1];
		if (['--root', '--base', '--verified', '--pending', '--date'].includes(argv[i]) && value === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--root') { options.root = path.resolve(value); i++; }
		else if (argv[i] === '--base') { options.base = value; i++; }
		else if (argv[i] === '--verified') { options.verified = value; i++; }
		else if (argv[i] === '--pending') { options.pending = value; i++; }
		else if (argv[i] === '--date') { options.date = value; i++; }
		else return { error: `不明な引数: ${argv[i]}` };
	}
	if (options.date !== undefined && !isDate(options.date)) return { error: '--date は YYYY-MM-DD で指定する' };
	if (!options.base) return { error: '--base <比較元>（今回の作業の着手前のコミット）を指定する' };
	return options;
}

function main(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`precheck: ${options.error}`);
		return 2;
	}
	if (options.verified) {
		// ない・読めない（ディレクトリを含む）検証記録は引数の誤り。
		try {
			fs.readFileSync(path.resolve(options.root, options.verified), 'utf8');
		} catch (error) {
			console.error(`precheck: 検証記録 ${options.verified} がない・読めない（${error.code || error.message}）`);
			return 2;
		}
	}
	console.log(`precheck: 構文検査 ${scriptFiles(options.root).length}ファイル`);
	return report(precheck(options.root, options), 'precheck');
}

if (require.main === module) process.exitCode = main();

module.exports = { scriptFiles, lineWhitespaceIssues, whitespaceIssues, addedLines, scriptOrder, declarationBody, topLevelDeclarations, duplicateSignatures, globalDuplicates, precheck, parseArgs, main };
