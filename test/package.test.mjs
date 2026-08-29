import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';

let [packageRoot, browser, testing, lazy] = await Promise.all([
    import('domsculptor'),
    import('domsculptor/browser'),
    import('domsculptor/testing'),
    import('domsculptor/lazy')
]);

assert.equal(typeof packageRoot.default, 'function');
assert.equal(typeof packageRoot.DomElement, 'function');
assert.equal(typeof browser.default, 'function');
assert.equal(typeof testing.createTestHarness, 'function');
assert.equal(typeof lazy.createLazyComponent, 'function');

let rootInstance = new packageRoot.default();
assert.equal(rootInstance.rendering, false);
assert.equal(typeof rootInstance.createProgressively, 'function');
assert.equal(typeof new browser.default().createProgressively, 'function');
let convenienceMethods = [
    'signal', 'state', 'store', 'data', 'computed', 'effect', 'batch', 'flush',
    'tree', 'when', 'mount', 'unmount', 'asyncState', 'errorBoundary'
];
for (let method of convenienceMethods) {
    assert.equal(typeof packageRoot[method], 'function');
    assert.equal(
        typeof rootInstance[method],
        'function',
        `${method} must remain available from the main DomSculptor class`
    );
}

let manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, '3.0.0');
assert.ok(manifest.files.includes('benchmark'));
assert.ok(manifest.files.includes('docs'));
assert.ok(manifest.files.includes('dist/*.js'));
assert.ok(!manifest.files.includes('dist'));
let gitIgnore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
assert.match(gitIgnore, /^\/dist\/\*\.map$/m);
assert.deepEqual(await readdir(new URL('../src/', import.meta.url)), ['index.js']);
assert.deepEqual(await readdir(new URL('../testing/', import.meta.url)), ['index.d.ts']);
assert.deepEqual(await readdir(new URL('../lazy/', import.meta.url)), ['index.d.ts']);
await Promise.all([
    stat(new URL('../types/index.d.ts', import.meta.url)),
    stat(new URL('../types/browser.d.ts', import.meta.url)),
    stat(new URL('../testing/index.d.ts', import.meta.url)),
    stat(new URL('../lazy/index.d.ts', import.meta.url)),
    stat(new URL('../docs/api.html', import.meta.url)),
    stat(new URL('../docs/recipes.html', import.meta.url)),
    stat(new URL('../docs/large-projects.html', import.meta.url)),
    stat(new URL('../docs/releasing.md', import.meta.url))
]);

console.log('Single source entry, package root, and browser build resolved.');
