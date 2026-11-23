const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const impact = require('../scripts/impact');
const { withTempDir, quiet, captured } = require('../helpers/dev-scripts');

// 開発プロセス定義書 4.6: impact.js（影響範囲の一覧）の判定を確かめる。

test('impact: occurrences carry the enclosing function, cover production and tests, and callers are traced', () => withTempDir({
	'js/a.js': ['function inner(x) {', '\treturn x.szNeighborChecks; // szNeighborChecks', '}', 'function outer() {', '\treturn inner({}) + /szNeighborChecks/.test("");', '}', 'const arrow = () => outer();', 'const other = { szNeighborChecksResolved: true };'].join('\n'),
	'index.html': '<button data-click="arrow">x</button>',
	'css/a.css': '.szNeighborChecks { color: red; }',
	'tests/unit/a.test.js': 'assert.deepEqual(entry.szNeighborChecks, {});',
	'tests/unit/dev-scripts.test.js': 'const fixture = { szNeighborChecks: 1 };',
	'tests/unit/dev-scripts-other.test.js': 'const fixture = { szNeighborChecks: 2 };',
	'tests/helpers/dev-scripts.js': 'const fixture = { szNeighborChecks: 3 };',
	'tests/helpers/other.js': 'module.exports = x => x.szNeighborChecks;',
	'tests/scripts/s.js': 'const szNeighborChecks = 1;'
}, root => {
	const [result] = impact.impact(root, ['szNeighborChecks']);
	assert.deepEqual(result.occurrences.map(found => `${found.kind} ${found.file}:${found.line} [${found.function}]`), [
		'本番 js/a.js:2 [inner]',
		'本番 css/a.css:1 []',
		'試験 tests/helpers/other.js:1 []',
		'試験 tests/unit/a.test.js:1 []'
	], 'Comments, regular expressions, longer names and the development scripts, their tests and their helper are not occurrences');
	assert.deepEqual(impact.callers(root, ['inner'], 3).map(level => `${level.depth} ${level.function}: ${level.calledFrom.map(caller => `${caller.file}:${caller.line} [${caller.function}]`).join(', ')}`), [
		'1 inner: js/a.js:5 [outer]',
		'2 outer: js/a.js:7 [arrow]',
		'3 arrow: index.html:1 []'
	]);
	assert.deepEqual(impact.enclosingFunctions('function a() {\n\tx;\n}\nif (y) {\n\tz;\n}'), ['a', 'a', 'a', '', '', '']);
	assert.equal(quiet(() => impact.main(['--root', root])), 2, 'A name is required');
	assert.equal(quiet(() => impact.main(['--root', path.join(root, 'no-such-root'), 'szNeighborChecks'])), 2, 'A missing --root is an argument error, not a name without occurrences');
	assert.equal(quiet(() => impact.main(['--root', root, '--callers', '1', 'szNeighborChecks'])), 0);
}));

test('impact: defaults, skipped directories, per-file counts, the depth limit, top-level callers and the printed list', () => withTempDir({
	'js/a.js': ['function inner() {', '\treturn 1;', '}', 'inner();', 'function outer() {', '\treturn inner();', '}', 'function top() {', '\treturn outer();', '}', 'const single = x => inner(x);'].join('\n'),
	'js/node_modules/x.js': 'inner();',
	'js/.hidden/y.js': 'inner();',
	'tests/unit/a.test.js': 'inner();'
}, root => {
	assert.deepEqual(impact.findOccurrences('Foo foo', 'foo').map(found => found.line), [1], 'Case matters by default');
	assert.deepEqual(impact.findOccurrences('// foo\nfoo', 'foo').map(found => found.line), [2], 'Comments are skipped by default');
	const [result] = impact.impact(root, ['inner']);
	assert.deepEqual(result.perFile, { 'js/a.js': 4, 'tests/unit/a.test.js': 1 }, 'node_modules and hidden directories are skipped');
	assert.deepEqual(result.occurrences.filter(found => found.line === 11).map(found => found.function), ['single'], 'An arrow function with one bare parameter is a function');
	assert.deepEqual(impact.callers(root, ['inner'], 1).map(level => level.function), ['inner'], 'Tracing stops at the depth');
	assert.deepEqual(impact.callers(root, ['inner'], 3).map(level => level.function), ['inner', 'outer', 'single', 'top'], 'A top-level caller is not traced further');
	withTempDir({ 'js/c.js': ['function a() {', '\treturn b();', '}', 'function b() {', '\treturn a();', '}', ''].join('\n') }, cycle => assert.deepEqual(impact.callers(cycle, ['a'], 4).map(level => level.function), ['a', 'b'], 'A function already traced is not traced again'));
	assert.equal(impact.parseArgs(['x']).ignoreCase, false);
	assert.equal(impact.parseArgs(['--ignore-case', 'x']).ignoreCase, true);
	assert.ok(captured(() => impact.main(['--root', root, '--ignore-case', 'INNER'])).text.split('\n').includes('## INNER（5か所）'), '--ignore-case reaches the matching');
	assert.equal(impact.parseArgs(['--callers', '0', 'x']).error, undefined);
	assert.ok(impact.parseArgs(['--callers', 'x', 'n']).error);
	for (const args of [['n', '--root'], ['n', '--callers'], ['--bogus', 'n']]) assert.ok(impact.parseArgs(args).error, args.join(' '));
	const printed = captured(() => impact.main(['--root', root, '--callers', '1', 'inner', 'missingName']));
	assert.equal(printed.code, 0);
	for (const line of ['## inner（5か所）', 'js/a.js 4・tests/unit/a.test.js 1', '### 呼出元（深さ 1）: inner', '## missingName（0か所）', '（出現なし）']) assert.ok(printed.text.split('\n').includes(line), `${line} in\n${printed.text}`);
	assert.doesNotMatch(printed.text, /### 呼出元（深さ \d）: $/m, 'Only production functions are traced');
}));
