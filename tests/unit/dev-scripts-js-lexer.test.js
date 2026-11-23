const test = require('node:test');
const assert = require('node:assert/strict');
const { stripScriptNoise } = require('../scripts/lib/js-lexer');

// 開発プロセス定義書 4.6: lib/js-lexer.js（簡易な字句解析）の判定を確かめる。

test('js-lexer: blankStrings also blanks string and template text while keeping template expressions and columns', () => {
	const code = 'if (a === "<td>" && `x ${b < 2} <p>`) return /x/g; // c';
	assert.equal(stripScriptNoise(code), 'if (a === "<td>" && `x ${b < 2} <p>`) return 0   ;     ');
	const blanked = stripScriptNoise(code, { blankStrings: true });
	assert.equal(blanked, 'if (a === "    " && `  ${b < 2}    `) return 0   ;     ');
	assert.equal(blanked.length, code.length);
	assert.equal(stripScriptNoise("'it\\'s' + x", { blankStrings: true }), "'     ' + x", 'Escaped quotes stay inside the string');
	assert.equal(stripScriptNoise('const t = `a {b} $c`; const r = /x/g;'), 'const t = `a {b} $c`; const r = 0   ;', 'Braces and a dollar sign alone stay template text');
	assert.equal(stripScriptNoise('x = [/a\nb/];'), 'x = [0 \n /];', 'An unterminated regular expression ends at the line end');
	assert.equal(stripScriptNoise('const r = /[/]x/g; y'), 'const r = 0      ; y', 'A slash inside a character class does not end the regular expression');
	assert.equal(stripScriptNoise('a /* b */c'), 'a        c', 'A block comment ends right after its */');
	assert.equal(stripScriptNoise('a = "open\nb = /x/; // c'), 'a = "open\nb = 0  ;     ', 'An unclosed string ends at the line end, so the next line is code');
	assert.equal(stripScriptNoise('t = `a\\`b ${x} c`; r = /y/;', { blankStrings: true }), 't = `     ${x}  `; r = 0  ;', 'An escaped backtick does not close the template');
	assert.equal(stripScriptNoise('t = `\\${x}`; r = /y/;', { blankStrings: true }), 't = `     `; r = 0  ;', 'An escaped ${ is template text, not an expression');
	assert.equal(stripScriptNoise('x = "a" / 2 / 3;'), 'x = "a" / 2 / 3;', 'A slash after a string is a division');
	assert.equal(stripScriptNoise('t = `a ${f({ a: 1 })} b`; r = /x/g;', { blankStrings: true }), 't = `  ${f({ a: 1 })}  `; r = 0   ;', 'Braces inside a template expression are counted, so the expression ends at its own brace');
	// 正規表現を許す直前の字句（すべて）。許さない字句の後の / は割り算で、続く ' は文字列の始まりになる。
	for (const token of ['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^', 'return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']) {
		assert.equal(stripScriptNoise(`${token} /'/;`), `${token} 0  ;`, `A regular expression may follow ${token || 'the start'}`);
	}
	for (const token of ['a', ')', ']', '1', 'x++']) assert.equal(stripScriptNoise(`${token} /'/;`), `${token} /'/;`, `A slash after ${token} is a division`);
});
