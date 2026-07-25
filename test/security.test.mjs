import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('runtime sources remain compatible with strict content security policy', async () => {
    let sources = await Promise.all([
        '../src/index.js',
        '../testing/index.js',
        '../lazy/index.js'
    ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
    let runtime = sources.join('\n');
    assert.doesNotMatch(runtime, /\beval\s*\(/);
    assert.doesNotMatch(runtime, /\bnew\s+Function\s*\(/);
    assert.doesNotMatch(runtime, /\.innerHTML\s*=/);
    assert.doesNotMatch(runtime, /setAttribute\s*\(\s*['"]on[a-z]+['"]/i);
});
