/* =========================================================================
	バージョン整合性・単一情報源（SSOT）機械検証テスト
========================================================================= */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('Version Consistency Suite: SSOT verification across all configuration files', async (t) => {
	const rootDir = path.resolve(__dirname, '../../');

	await t.test('All version definitions (package.json, version.json, sw.js, js/app.js) must be identical and semver compliant', () => {
		// 1. package.json
		const pkgPath = path.join(rootDir, 'package.json');
		assert.ok(fs.existsSync(pkgPath), 'package.json exists');
		const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
		const pkgVersion = pkgJson.version;
		assert.ok(pkgVersion, 'package.json version is defined');
		assert.match(pkgVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/, 'package.json version matches semver format');

		// 2. version.json
		const verPath = path.join(rootDir, 'version.json');
		assert.ok(fs.existsSync(verPath), 'version.json exists');
		const verJson = JSON.parse(fs.readFileSync(verPath, 'utf8'));
		const jsonVersion = verJson.version;
		assert.ok(jsonVersion, 'version.json version is defined');
		assert.match(jsonVersion, /^[0-9]+\.[0-9]+\.[0-9]+$/, 'version.json version matches semver format');

		// 3. sw.js
		const swPath = path.join(rootDir, 'sw.js');
		assert.ok(fs.existsSync(swPath), 'sw.js exists');
		const swContent = fs.readFileSync(swPath, 'utf8');
		const swMatch = swContent.match(/CACHE_NAME\s*=\s*['"]kogai-cache-v([0-9]+\.[0-9]+\.[0-9]+)['"]/);
		assert.ok(swMatch, 'sw.js contains valid CACHE_NAME with semver version');
		const swVersion = swMatch[1];

		// 4. js/app.js
		const appPath = path.join(rootDir, 'js/app.js');
		assert.ok(fs.existsSync(appPath), 'js/app.js exists');
		const appContent = fs.readFileSync(appPath, 'utf8');
		const appMatch = appContent.match(/const\s+CURRENT_APP_VERSION\s*=\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/);
		assert.ok(appMatch, 'js/app.js contains valid CURRENT_APP_VERSION definition');
		const appVersion = appMatch[1];

		// 5. Strict SSOT consistency assertion
		assert.strictEqual(
			jsonVersion,
			pkgVersion,
			`version.json version (${jsonVersion}) must match package.json version (${pkgVersion})`
		);
		assert.strictEqual(
			swVersion,
			pkgVersion,
			`sw.js CACHE_NAME version (${swVersion}) must match package.json version (${pkgVersion})`
		);
		assert.strictEqual(
			appVersion,
			pkgVersion,
			`js/app.js CURRENT_APP_VERSION (${appVersion}) must match package.json version (${pkgVersion})`
		);
	});
});

