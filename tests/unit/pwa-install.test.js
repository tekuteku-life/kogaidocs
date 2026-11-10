const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setupDomEnvironment } = require('../helpers/dom-mock');
setupDomEnvironment();
require('../../js/utils');
require('../../js/crypto');
require('../../js/state');
const app = require('../../js/app');

test('PWA: iOS HTTPS guide visibility, iPad desktop UA, file/HTTP exclusion and installed state', () => {
	setupDomEnvironment();
	window.location = { protocol: 'https:', hostname: 'example.test' };
	Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
	app.updatePwaInstallButton();
	assert.equal(document.getElementById('pwa-install-btn').style.display, 'inline-flex');
	assert.match(document.getElementById('pwa-install-btn').textContent, /ホーム画面に追加/);
	const messages = [];
	global.alert = message => messages.push(message);
	app.triggerPwaInstall();
	assert.ok(messages.some(message => message.includes('Safari')));
	window.location.protocol = 'http:';
	app.updatePwaInstallButton();
	assert.equal(document.getElementById('pwa-install-btn').style.display, 'none');
	window.location.protocol = 'file:';
	window.location.hostname = 'localhost';
	app.updatePwaInstallButton();
	assert.equal(document.getElementById('pwa-install-btn').style.display, 'none');
	window.location.protocol = 'https:';
	Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Macintosh' });
	navigator.platform = 'MacIntel'; navigator.maxTouchPoints = 5;
	assert.equal(app.isIosDevice(), true);
	navigator.standalone = true;
	app.updatePwaInstallButton();
	assert.equal(document.getElementById('pwa-install-btn').style.display, 'none');
	navigator.standalone = false;
	window.matchMedia = () => ({ matches: true });
	assert.equal(app.isStandaloneApp(), true);
	navigator.maxTouchPoints = 0;
	assert.equal(app.isIosDevice(), false);
});

test('PWA: Apple icon is an existing PNG asset', () => {
	const icon = fs.readFileSync(path.resolve(__dirname, '../../icons/icon-192.png'));
	assert.equal(icon.subarray(1, 4).toString(), 'PNG');
	assert.equal(icon.readUInt32BE(16), 192);
	assert.equal(icon.readUInt32BE(20), 192);
});

test('PWA: leaving warns only while flag settings have an unsaved file change', () => {
	setupDomEnvironment();
	const event = { type: 'beforeunload', prevented: false, preventDefault() { this.prevented = true; } };
	global.hataHasUnsavedChanges = true;
	window.dispatchEvent(event);
	assert.equal(event.prevented, true);
	assert.equal(event.returnValue, '');
	global.hataHasUnsavedChanges = false;
	event.prevented = false;
	window.dispatchEvent(event);
	assert.equal(event.prevented, false);
	delete global.hataHasUnsavedChanges;
});

test('PWA: prompt lifecycle hides consumed or installed prompts and standalone cannot prompt again', async () => {
	setupDomEnvironment();
	window.location = { protocol: 'https:', hostname: 'example.test' };
	window.matchMedia = () => ({ matches: false });
	let prompts = 0;
	const event = { type: 'beforeinstallprompt', preventDefault() {}, prompt() { prompts++; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) };
	window.dispatchEvent(event);
	assert.equal(document.getElementById('pwa-install-btn').style.display, 'inline-flex');
	app.triggerPwaInstall();
	await event.userChoice;
	assert.equal(prompts, 1);
	assert.equal(document.getElementById('pwa-install-btn').style.display, 'none');
	app.triggerPwaInstall();
	assert.equal(prompts, 1, 'Consumed prompt cannot be reused');
	navigator.standalone = true;
	app.triggerPwaInstall();
	assert.equal(prompts, 1, 'Installed standalone cannot prompt');
	navigator.standalone = false;
	window.dispatchEvent(event);
	window.dispatchEvent({ type: 'appinstalled' });
	assert.equal(document.getElementById('pwa-install-btn').style.display, 'none');
	document.elements['pwa-install-btn'] = null;
	assert.doesNotThrow(() => app.updatePwaInstallButton());
});
