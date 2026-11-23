#!/usr/bin/env node
/*
 * 影響範囲の一覧（開発プロセス定義書 Stage 2・4.2・4.6）。
 * 名前の出現を、本番（js/*.js・sw.js・index.html・css/*.css）と試験（tests/ の下の js。既存の assertion の書き換えの候補。
 * 開発用のスクリプト tests/scripts/ とその試験 tests/unit/dev-scripts*.test.js は除く）について、
 * ファイル・行・その行を含む関数で一覧にする。js はコメントと正規表現リテラルを除いて照合する。
 * --callers <深さ> で、出現を含む関数の呼出元（index.html の data-* の処理名を含む）を、指定の深さまでたどる。
 * 語の境界は英数字・_・$（szNeighborChecks と szNeighborChecksResolved は別の名前）。
 * 使い方: node tests/scripts/impact.js [--root <リポジトリ>] [--ignore-case] [--callers <深さ>] <名前>...
 * 終了コード: 0（一覧を出すだけ）、2 引数の誤り（ない --root を含む）
 */
const fs = require('node:fs');
const path = require('node:path');
const { stripScriptNoise } = require('./lib/js-lexer');

const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 行ごとに、その行を含むトップレベルの関数の名前（なければ空）を返す。 */
function enclosingFunctions(text) {
	const names = [];
	let current = '';
	for (const line of stripScriptNoise(text).split('\n')) {
		const found = line.match(/^(?:async\s+)?function\s*\*?\s*([\w$]+)\s*\(|^(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[\w$]+\s*=>)/);
		if (found) current = found[1] || found[2];
		else if (/^\S/.test(line) && !/^[})\]]/.test(line)) current = '';
		names.push(current);
	}
	return names;
}

/** 語としての出現を、行番号・行の内容・含む関数で返す。js はコメントと正規表現リテラルを除いて照合する。 */
function findOccurrences(text, name, { ignoreCase = false, js = true } = {}) {
	const pattern = new RegExp(`(?<![\\w$])${escape(name)}(?![\\w$])`, ignoreCase ? 'gi' : 'g');
	const original = text.split('\n');
	const searched = js ? stripScriptNoise(text).split('\n') : original;
	const functions = js ? enclosingFunctions(text) : [];
	return searched.flatMap((line, index) => [...line.matchAll(pattern)].map(() => ({ line: index + 1, text: original[index].trim(), function: functions[index] || '' })));
}

// 開発用のスクリプトとその試験・試験の共通の補助（名前を試料として含むため、影響範囲の一覧に入れない）。
const isDevelopmentFile = relative => relative === 'tests/scripts' || /^tests\/(?:unit\/dev-scripts(?:-[\w-]+)?\.test\.js|helpers\/dev-scripts\.js)$/.test(relative);

function listFiles(root, dir, extension) {
	const full = path.join(root, dir);
	if (!fs.existsSync(full)) return [];
	return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
		if (entry.name === 'node_modules' || entry.name.startsWith('.') || isDevelopmentFile(`${dir}/${entry.name}`)) return [];
		const relative = `${dir}/${entry.name}`;
		return entry.isDirectory() ? listFiles(root, relative, extension) : entry.name.endsWith(extension) ? [relative] : [];
	}).sort();
}

/** 対象のファイル。kind は「本番」か「試験」。 */
function targetFiles(root) {
	const production = [...listFiles(root, 'js', '.js'), ...['sw.js', 'index.html'].filter(file => fs.existsSync(path.join(root, file))), ...listFiles(root, 'css', '.css')];
	return [...production.map(file => ({ file, kind: '本番' })), ...listFiles(root, 'tests', '.js').map(file => ({ file, kind: '試験' }))];
}

/** 名前ごとの出現（ファイル・行・関数・種別）と、本番のファイルごとの件数。 */
function impact(root, names, options = {}) {
	const files = targetFiles(root);
	return names.map(name => {
		const occurrences = files.flatMap(({ file, kind }) => findOccurrences(fs.readFileSync(path.join(root, file), 'utf8'), name, { ...options, js: file.endsWith('.js') }).map(found => ({ file, kind, ...found })));
		const perFile = {};
		for (const found of occurrences) perFile[found.file] = (perFile[found.file] || 0) + 1;
		return { name, occurrences, perFile };
	});
}

/** 本番の関数の呼出元を、深さまでたどる。戻り値: [{ depth, function, calledFrom: [{ file, line, function }] }] */
function callers(root, functionNames, depth) {
	const production = targetFiles(root).filter(entry => entry.kind === '本番');
	const seen = new Set(functionNames);
	const levels = [];
	let frontier = [...functionNames];
	for (let level = 1; level <= depth && frontier.length; level++) {
		const next = [];
		for (const name of frontier) {
			const calledFrom = production.flatMap(({ file }) => findOccurrences(fs.readFileSync(path.join(root, file), 'utf8'), name, { js: file.endsWith('.js') }).filter(found => found.function !== name).map(found => ({ file, line: found.line, function: found.function })));
			levels.push({ depth: level, function: name, calledFrom });
			for (const caller of calledFrom) if (caller.function && !seen.has(caller.function)) { seen.add(caller.function); next.push(caller.function); }
		}
		frontier = next;
	}
	return levels;
}

function parseArgs(argv) {
	const options = { root: path.resolve(__dirname, '../..'), ignoreCase: false, callers: 0, names: [] };
	for (let i = 0; i < argv.length; i++) {
		if (['--root', '--callers'].includes(argv[i]) && argv[i + 1] === undefined) return { error: `${argv[i]} に値を指定する` };
		if (argv[i] === '--root') options.root = path.resolve(argv[++i]);
		else if (argv[i] === '--ignore-case') options.ignoreCase = true;
		else if (argv[i] === '--callers') options.callers = Number(argv[++i]);
		else if (argv[i].startsWith('--')) return { error: `不明な引数: ${argv[i]}` };
		else options.names.push(argv[i]);
	}
	if (!options.names.length) return { error: '名前を1つ以上指定する' };
	if (!Number.isInteger(options.callers) || options.callers < 0) return { error: '--callers には 0 以上の整数を指定する' };
	return options;
}

function main(argv = process.argv.slice(2)) {
	const options = parseArgs(argv);
	if (options.error) {
		console.error(`impact: ${options.error}（使い方: node tests/scripts/impact.js [--root <リポジトリ>] [--ignore-case] [--callers <深さ>] <名前>...）`);
		return 2;
	}
	// ない --root を「出現なし」としない（引数の誤りにする）。
	if (!fs.existsSync(options.root) || !fs.statSync(options.root).isDirectory()) {
		console.error(`impact: --root ${options.root} がない`);
		return 2;
	}
	for (const result of impact(options.root, options.names, options)) {
		console.log(`## ${result.name}（${result.occurrences.length}か所）`);
		console.log(Object.entries(result.perFile).map(([file, count]) => `${file} ${count}`).join('・') || '（出現なし）');
		for (const found of result.occurrences) console.log(`${found.kind} ${found.file}:${found.line}${found.function ? ` [${found.function}]` : ''}: ${found.text}`);
		if (options.callers) {
			const functions = [...new Set(result.occurrences.filter(found => found.kind === '本番' && found.function).map(found => found.function))];
			for (const level of callers(options.root, functions, options.callers)) {
				console.log(`### 呼出元（深さ ${level.depth}）: ${level.function}`);
				for (const caller of level.calledFrom) console.log(`${caller.file}:${caller.line}${caller.function ? ` [${caller.function}]` : ''}`);
			}
		}
	}
	return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { enclosingFunctions, findOccurrences, targetFiles, impact, callers, parseArgs, main };
