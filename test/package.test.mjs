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
assert.equal(typeof rootInstance.renderEach, 'function');
assert.equal(packageRoot.renderEach, undefined);
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
assert.equal(manifest.version, '2.0.0');
assert.ok(manifest.files.includes('benchmark'));
assert.ok(manifest.files.includes('docs'));
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
