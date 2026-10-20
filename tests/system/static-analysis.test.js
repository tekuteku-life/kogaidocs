const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '../../');

test('Mechanical Static Analysis: Syntax, DOM element ID consistency, and listener safety', async (t) => {
	await t.test('Mechanical syntax check: node -c across all production and test JavaScript files', () => {
		const jsFiles = fs.readdirSync(path.join(rootDir, 'js'))
			.filter(f => f.endsWith('.js'))
			.map(f => path.join('js', f));

		const testFiles = [];
		function collectTests(dir) {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					collectTests(fullPath);
				} else if (entry.name.endsWith('.js')) {
					testFiles.push(path.relative(rootDir, fullPath));
				}
			}
		}
		collectTests(path.join(rootDir, 'tests'));

		const allFiles = [...jsFiles, ...testFiles];
		assert.doesNotThrow(() => {
			execFileSync('node', ['-c', ...allFiles], { cwd: rootDir, encoding: 'utf8' });
		}, 'node -c should pass cleanly on all JS files');
	});

	await t.test('Mechanical static inspection: DOM element ID references in JS vs index.html', () => {
		const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
		const htmlIds = new Set();
		for (const match of html.matchAll(/id=["']([^"']+)["']/g)) {
			htmlIds.add(match[1]);
		}

		// Known dynamically generated / modal injected IDs
		const dynamicIds = new Set([
			'modal-set-pass',
			'modal-set-pass-confirm',
			'modal-set-pass-msg',
			'modal-set-enable-bio',
			'btn-manual-check-update',
			'version-check-status',
			'summaryContainer',
			'summaryAccordion',
			'accordionArrow',
			'hata-members',
			'd-file-pass'
		]);

		const jsFiles = fs.readdirSync(path.join(rootDir, 'js')).filter(f => f.endsWith('.js'));
		const missingIds = [];

		for (const f of jsFiles) {
			const content = fs.readFileSync(path.join(rootDir, 'js', f), 'utf8');
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				for (const match of line.matchAll(/getElementById\(['"]([a-zA-Z0-9_-]+)['"]/g)) {
					const id = match[1];
					if (!htmlIds.has(id) && !dynamicIds.has(id)) {
						missingIds.push(`${f}:${i + 1}: getElementById('${id}') referenced but ID does not exist in index.html`);
					}
				}
			}
		}

		assert.strictEqual(missingIds.length, 0, 'No orphaned or typo DOM element IDs in production JS:\n' + missingIds.join('\n'));
	});

	await t.test('Mechanical static inspection: No duplicate DOM event listener registrations on same element/event', () => {
		const jsFiles = fs.readdirSync(path.join(rootDir, 'js')).filter(f => f.endsWith('.js'));
		const listenerRegistrations = new Map();
		const duplicates = [];

		for (const f of jsFiles) {
			const content = fs.readFileSync(path.join(rootDir, 'js', f), 'utf8');
			const lines = content.split('\n');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				const match = line.match(/([a-zA-Z0-9_$.]+)\.addEventListener\(['"]([a-zA-Z0-9_-]+)['"]/);
				if (match) {
					const key = `${match[1]}@${match[2]}`;
					if (listenerRegistrations.has(key)) {
						duplicates.push(`${f}:${i + 1}: Potential duplicate event listener for ${key} (previously at ${listenerRegistrations.get(key)})`);
					} else {
						listenerRegistrations.set(key, `${f}:${i + 1}`);
					}
				}
			}
		}

		assert.strictEqual(duplicates.length, 0, 'No uncontrolled duplicate event listener registrations in global scope:\n' + duplicates.join('\n'));
	});
});
