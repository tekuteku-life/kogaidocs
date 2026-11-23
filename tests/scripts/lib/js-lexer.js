/*
 * 簡易な字句解析（開発用。外部ライブラリなし）。
 * js のコメントと正規表現リテラルを取り除き、文字列とテンプレートの文字は残す（blankStrings で中身も空白にできる）。行の数と文字の位置は保つ。
 * tests/system/csp-external-block.test.js（R-25・I-14-02）にあった関数を移したもの（blankStrings を省けば同じ動作）。
 * csp-external-block.test.js と tests/scripts/impact.js・mutate.js・check-docs.js・precheck.js が読み込む。
 */
/**
 * I-14-02: 簡易な字句解析で、js のコメントと正規表現リテラルを空白に置き換える（行の数と文字の位置は保つ）。
 * 文字列とテンプレートの文字は残し、テンプレートの ${…} の中はコードとして扱う。
 */
function stripScriptNoise(code, { blankStrings = false } = {}) {
	let out = '';
	let i = 0;
	let last = '';
	const blank = text => text.replace(/[^\n]/g, ' ');
	const regexAllowedAfter = /^(?:|[(,=:[!&|?{};+\-*%<>~^]|return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/;
	const templateDepth = [];
	while (i < code.length) {
		const ch = code[i];
		const next = code[i + 1];
		if (ch === '/' && next === '/') {
			const end = code.indexOf('\n', i);
			const stop = end === -1 ? code.length : end;
			out += blank(code.slice(i, stop));
			i = stop;
			continue;
		}
		if (ch === '/' && next === '*') {
			const end = code.indexOf('*/', i + 2);
			const stop = end === -1 ? code.length : end + 2;
			out += blank(code.slice(i, stop));
			i = stop;
			continue;
		}
		if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < code.length && code[j] !== ch && code[j] !== '\n') j += code[j] === '\\' ? 2 : 1;
			// blankStrings のときは、引用符を残して中身を空白にする（演算子の変異などで文字列の中を対象にしない）。
			out += blankStrings ? ch + blank(code.slice(i + 1, j)) + code.slice(j, j + 1) : code.slice(i, j + 1);
			i = j + 1;
			last = 'str';
			continue;
		}
		if (ch === '`' || (ch === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === 0)) {
			if (ch === '}') templateDepth.pop();
			let j = i + 1;
			while (j < code.length && code[j] !== '`' && !(code[j] === '$' && code[j + 1] === '{')) j += code[j] === '\\' ? 2 : 1;
			const text = part => blankStrings ? code[i] + blank(code.slice(i + 1, j)) + part : code.slice(i, j) + part;
			if (code[j] === '$') { out += text('${'); i = j + 2; templateDepth.push(0); last = '{'; }
			else { out += text(code.slice(j, j + 1)); i = j + 1; last = 'str'; }
			continue;
		}
		if (ch === '{' && templateDepth.length) templateDepth[templateDepth.length - 1]++;
		if (ch === '}' && templateDepth.length) templateDepth[templateDepth.length - 1]--;
		if (ch === '/' && regexAllowedAfter.test(last)) {
			let j = i + 1;
			let inClass = false;
			while (j < code.length && code[j] !== '\n') {
				if (code[j] === '\\') { j += 2; continue; }
				if (code[j] === '[') inClass = true;
				else if (code[j] === ']') inClass = false;
				else if (code[j] === '/' && !inClass) break;
				j++;
			}
			j++;
			while (/[a-z]/i.test(code[j] || '')) j++;
			// 構文の検査ができるよう、正規表現リテラルは同じ長さの「0 と空白」に置き換える（値として残る）。
			out += '0' + blank(code.slice(i + 1, j));
			i = j;
			last = 'regex';
			continue;
		}
		// 後置・前置の ++・-- は1つの字句とし、その後の / を除算とみなす。
		if ((ch === '+' || ch === '-') && code[i + 1] === ch) {
			out += ch + ch;
			last = ch + ch;
			i += 2;
			continue;
		}
		out += ch;
		if (/\s/.test(ch)) { i++; continue; }
		if (/[\w$]/.test(ch)) {
			let j = i;
			while (j < code.length && /[\w$]/.test(code[j])) j++;
			out += code.slice(i + 1, j);
			last = code.slice(i, j);
			i = j;
			continue;
		}
		last = ch;
		i++;
	}
	return out;
}

module.exports = { stripScriptNoise };
