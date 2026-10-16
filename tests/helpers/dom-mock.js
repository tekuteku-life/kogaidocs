/* =========================================================================
   テスト用 DOM・ブラウザ環境モック（Node.js用）
========================================================================= */

const fs = require('fs');
const path = require('path');

class MockClassList {
	constructor(el) {
		this.el = el;
		this.classes = new Set();
	}
	add(...cls) {
		cls.forEach(c => c && this.classes.add(c));
		this._sync();
	}
	remove(...cls) {
		cls.forEach(c => this.classes.delete(c));
		this._sync();
	}
	toggle(c, force) {
		let res = force !== undefined ? !!force : !this.classes.has(c);
		if (res) this.classes.add(c); else this.classes.delete(c);
		this._sync();
		return res;
	}
	contains(c) {
		return this.classes.has(c);
	}
	_sync() {
		this.el._className = Array.from(this.classes).join(' ');
	}
	_parse(str) {
		this.classes = new Set((str || '').split(/\s+/).filter(Boolean));
	}
}

class MockElement {
	constructor(tagName = 'div') {
		this.tagName = tagName.toLowerCase();
		this.id = '';
		this._className = '';
		this.classList = new MockClassList(this);
		this.attrs = {};
		this.dataset = {};
		this.style = {};
		this.children = [];
		this.parentElement = null;
		this._value = '';
		this.textContent = '';
		this.checked = false;
		this.selected = false;
		this.type = '';
		this.files = [];
		this.listeners = {};
		this.rows = 0;
		this.title = '';
		this.placeholder = '';
	}

	get className() {
		return this._className;
	}
	set className(val) {
		this._className = val || '';
		this.classList._parse(this._className);
	}

	get value() {
		return this._value;
	}
	set value(v) {
		this._value = String(v ?? '');
	}

	get innerHTML() {
		if (this.children.length > 0 && !this._innerHTML) {
			return this.children.map(c => c.outerHTML).join('');
		}
		return this._innerHTML || '';
	}
	set innerHTML(html) {
		this._innerHTML = html;
		this.children = [];
		if (!html) {
			this.textContent = '';
			return;
		}
		parseHtmlToChildren(html, this);
	}

	get outerHTML() {
		const tag = this.tagName.toLowerCase();
		const attrs = Object.entries(this.attrs).map(([k, v]) => ` ${k}="${v}"`).join('');
		return `<${tag}${attrs}>${this.innerHTML}</${tag}>`;
	}

	setAttribute(k, v) {
		const strVal = String(v ?? '');
		this.attrs[k] = strVal;
		if (k === 'id') this.id = strVal;
		if (k === 'class') this.className = strVal;
		if (k === 'value') this.value = strVal;
		if (k === 'type') this.type = strVal;
		if (k === 'checked') this.checked = true;
		if (k === 'selected') this.selected = true;
		if (k.startsWith('data-')) {
			const prop = k.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
			this.dataset[prop] = strVal;
		}
	}

	getAttribute(k) {
		if (k === 'id') return this.id || null;
		if (k === 'class') return this.className || null;
		if (k === 'value') return this.value || null;
		if (k === 'type') return this.type || null;
		return this.attrs[k] !== undefined ? this.attrs[k] : null;
	}

	removeAttribute(k) {
		delete this.attrs[k];
		if (k === 'id') this.id = '';
		if (k === 'class') this.className = '';
		if (k.startsWith('data-')) {
			const prop = k.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
			delete this.dataset[prop];
		}
	}

	appendChild(child) {
		this.children.push(child);
		child.parentElement = this;
		return child;
	}

	removeChild(child) {
		const idx = this.children.indexOf(child);
		if (idx >= 0) this.children.splice(idx, 1);
		child.parentElement = null;
		return child;
	}

	addEventListener(evt, fn) {
		this.listeners[evt] = this.listeners[evt] || [];
		this.listeners[evt].push(fn);
	}

	dispatchEvent(evt) {
		const list = this.listeners[evt.type] || [];
		list.forEach(fn => fn(evt));
		if (typeof this['on' + evt.type] === 'function') {
			this['on' + evt.type](evt);
		}
	}

	closest(sel) {
		let curr = this;
		while (curr) {
			if (matchesSelector(curr, sel)) return curr;
			curr = curr.parentElement;
		}
		return null;
	}

	querySelector(sel) {
		const all = this.querySelectorAll(sel);
		return all.length ? all[0] : null;
	}

	querySelectorAll(sel) {
		const res = [];
		function walk(node) {
			for (const c of node.children) {
				if (matchesSelector(c, sel)) res.push(c);
				walk(c);
			}
		}
		walk(this);
		return res;
	}

	focus() {}
	select() {}
	click() {
		this.dispatchEvent({ type: 'click', target: this, stopPropagation() {} });
	}
}

function matchesSelector(el, sel) {
	sel = (sel || '').trim();
	if (!sel || sel === '*') return true;
	if (sel === ':checked') return !!el.checked;
	if (sel.endsWith(':checked')) {
		const base = sel.slice(0, -8);
		return matchesSelector(el, base) && !!el.checked;
	}
	if (sel.startsWith('#')) {
		return el.id === sel.slice(1);
	}
	if (sel.startsWith('.')) {
		const cls = sel.slice(1);
		return el.classList.contains(cls);
	}
	if (sel.startsWith('[') && sel.endsWith(']')) {
		const inner = sel.slice(1, -1);
		if (inner.includes('=')) {
			const [k, v] = inner.split('=');
			const cleanV = v.replace(/['"]/g, '');
			return el.getAttribute(k) === cleanV;
		}
		return el.getAttribute(inner) !== null;
	}
	return el.tagName === sel.toLowerCase();
}

function parseHtmlToChildren(html, parent) {
	const selfClosing = new Set(['input', 'img', 'br', 'hr', 'meta', 'link']);
	const tagRe = /<(\/)?([a-zA-Z0-9\-]+)([^>]*?)(\/?)>/g;
	const stack = [parent];
	let lastIndex = 0;
	let match;

	while ((match = tagRe.exec(html)) !== null) {
		const [raw, isClosing, tagNameRaw, attrStr, isSelfCloseSlash] = match;
		const tagName = tagNameRaw.toLowerCase();
		const text = html.slice(lastIndex, match.index).trim();
		if (text && stack.length > 0) {
			const current = stack[stack.length - 1];
			current.textContent = (current.textContent ? current.textContent + ' ' : '') + text;
		}
		lastIndex = tagRe.lastIndex;

		if (isClosing) {
			if (stack.length > 1 && stack[stack.length - 1].tagName === tagName) {
				stack.pop();
			}
		} else {
			const el = new MockElement(tagName);
			const attrRe = /([a-zA-Z0-9\-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^>\s]+)))?/g;
			let am;
			while ((am = attrRe.exec(attrStr)) !== null) {
				const attrName = am[1].toLowerCase();
				const attrVal = am[2] !== undefined ? am[2] : (am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : ''));
				el.setAttribute(attrName, attrVal);
			}
			stack[stack.length - 1].appendChild(el);

			if (tagName === 'option') {
				const selectEl = stack[stack.length - 1];
				if (selectEl && selectEl.tagName === 'select' && el.selected) {
					selectEl.value = el.value || el.textContent;
				}
			}

			const isSelf = isSelfCloseSlash === '/' || selfClosing.has(tagName);
			if (!isSelf) {
				stack.push(el);
			}
		}
	}
}

class MockLocalStorage {
	constructor() {
		this.store = {};
	}
	getItem(k) {
		return this.store[k] !== undefined ? this.store[k] : null;
	}
	setItem(k, v) {
		this.store[k] = String(v);
	}
	removeItem(k) {
		delete this.store[k];
	}
	clear() {
		this.store = {};
	}
}

class MockClipboard {
	constructor() {
		this.text = "";
	}
	async writeText(str) {
		this.text = str;
		return Promise.resolve();
	}
	async readText() {
		return Promise.resolve(this.text);
	}
}

class MockCredentials {
	constructor() {
		this.prfResult = new Uint8Array(32).fill(7);
		this.failCreate = false;
		this.failGet = false;
		this.noPrf = false;
	}

	async create(options) {
		if (this.failCreate) return null;
		const salt = options?.publicKey?.extensions?.prf?.eval?.first || new Uint8Array(32);
		return {
			rawId: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
			getClientExtensionResults: () => {
				if (this.noPrf) return {};
				return {
					prf: {
						results: {
							first: this.prfResult
						}
					}
				};
			}
		};
	}

	async get(options) {
		if (this.failGet) return null;
		return {
			rawId: options?.publicKey?.allowCredentials?.[0]?.id || new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
			getClientExtensionResults: () => {
				if (this.noPrf) return {};
				return {
					prf: {
						results: {
							first: this.prfResult
						}
					}
				};
			}
		};
	}
}

function setupDomEnvironment() {
	const elementsMap = {};

	const mockDoc = {
		elements: elementsMap,
		body: new MockElement('body'),
		getElementById(id) {
			if (elementsMap[id] === null) return null;
			if (!elementsMap[id]) {
				const el = new MockElement('div');
				el.id = id;
				elementsMap[id] = el;
				this.body.appendChild(el);
			}
			return elementsMap[id];
		},
		createElement(tag) {
			return new MockElement(tag);
		},
		querySelectorAll(sel) {
			const res = [];
			const seen = new Set();
			function walk(node) {
				if (!node) return;
				if (node.id && elementsMap[node.id] === undefined) elementsMap[node.id] = node;
				if (matchesSelector(node, sel) && !seen.has(node)) {
					seen.add(node);
					res.push(node);
				}
				for (const c of node.children) {
					walk(c);
				}
			}
			for (const rootEl of Object.values(elementsMap)) {
				if (!rootEl) continue;
				walk(rootEl);
			}
			walk(this.body);
			return res;
		},
		querySelector(sel) {
			const list = this.querySelectorAll(sel);
			return list.length ? list[0] : null;
		},
		addEventListener(evt, fn) {
			global.window.addEventListener(evt, fn);
		},
		removeEventListener(evt, fn) {
			global.window.removeEventListener(evt, fn);
		},
		dispatchEvent(evt) {
			global.window.dispatchEvent(evt);
		}
	};

	global.document = mockDoc;
	global.window = global;
	global.window.isSecureContext = true;
	global.window.location = {
		protocol: 'https:',
		hostname: 'localhost',
		reload: () => {}
	};
	global.__lastAlert = '';
	global.print = () => {};
	global.alert = (msg) => { global.__lastAlert = String(msg || ''); };
	global.confirm = () => true;
	global.prompt = (msg, def) => def || '';
	global.window.print = global.print;
	global.window.alert = global.alert;
	global.window.confirm = global.confirm;
	global.window.prompt = global.prompt;
	global.window.listeners = global.window?.listeners ? { ...global.window.listeners } : {};
	global.window.addEventListener = (evt, fn) => {
		global.window.listeners[evt] = global.window.listeners[evt] || [];
		global.window.listeners[evt].push(fn);
	};
	global.window.removeEventListener = (evt, fn) => {
		if (global.window.listeners[evt]) {
			global.window.listeners[evt] = global.window.listeners[evt].filter(f => f !== fn);
		}
	};
	global.window.dispatchEvent = (evt) => {
		const type = typeof evt === 'string' ? evt : evt?.type;
		(global.window.listeners[type] || []).forEach(fn => fn(evt));
	};

	global.PublicKeyCredential = class {};
	global.localStorage = new MockLocalStorage();
	global.sessionStorage = new MockLocalStorage();

	const mockNav = {
		clipboard: new MockClipboard(),
		credentials: new MockCredentials(),
		serviceWorker: {
			register: async () => ({})
		}
	};
	Object.defineProperty(globalThis, 'navigator', {
		value: mockNav,
		configurable: true,
		writable: true
	});

	global.crypto = require('crypto').webcrypto;

	global.Blob = class {
		constructor(parts, opts) {
			this.parts = parts;
			this.type = opts?.type || '';
		}
	};

	global.URL = {
		createObjectURL: () => 'blob:mock-url-' + Math.random(),
		revokeObjectURL: () => {}
	};

	// index.html に存在するIDの初期要素を登録
	try {
		const htmlPath = path.resolve(__dirname, '../../index.html');
		if (fs.existsSync(htmlPath)) {
			const html = fs.readFileSync(htmlPath, 'utf8');
			const idMatches = html.match(/id=["']([^"']+)["']/g) || [];
			idMatches.forEach(m => {
				const id = m.match(/id=["']([^"']+)["']/)[1];
				mockDoc.getElementById(id);
			});

			// タブ切り替えボタンの登録
			const b1 = mockDoc.createElement('button');
			b1.className = 'tab-btn active';
			const b2 = mockDoc.createElement('button');
			b2.className = 'tab-btn';
			const b3 = mockDoc.createElement('button');
			b3.className = 'tab-btn';
			mockDoc.body.appendChild(b1);
			mockDoc.body.appendChild(b2);
			mockDoc.body.appendChild(b3);
		}
	} catch (e) {}

	return { mockDoc, elementsMap };
}

if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		MockElement,
		MockClassList,
		MockLocalStorage,
		MockClipboard,
		MockCredentials,
		setupDomEnvironment
	};
}
