import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

let bundle = await readFile(new URL('../dist/domsculptor.min.js', import.meta.url));
let gzipBytes = gzipSync(bundle, { level: 9 }).byteLength;
let budgetBytes = 13 * 1024;

console.log(`dist/domsculptor.min.js: ${gzipBytes} bytes minified and gzipped (budget: ${budgetBytes})`);
assert.ok(gzipBytes <= budgetBytes, `Bundle exceeds the 13 KB gzip budget by ${gzipBytes - budgetBytes} bytes`);

let esmBundle = await readFile(new URL('../dist/domsculptor.esm.min.js', import.meta.url));
let esmGzipBytes = gzipSync(esmBundle, { level: 9 }).byteLength;
console.log(`dist/domsculptor.esm.min.js: ${esmGzipBytes} bytes minified and gzipped (budget: ${budgetBytes})`);
assert.ok(
    esmGzipBytes <= budgetBytes,
    `Browser ESM bundle exceeds the 13 KB gzip budget by ${esmGzipBytes - budgetBytes} bytes`
);
