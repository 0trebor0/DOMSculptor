import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium, firefox, webkit } from 'playwright';

let root = normalize(join(import.meta.dirname, '..'));
let contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8']
]);

let server = createServer(async (request, response) => {
    try {
        let pathname = new URL(request.url, 'http://localhost').pathname;
        let file = normalize(join(root, pathname === '/' ? 'test/browser.html' : pathname));
        if (!file.startsWith(root)) throw new Error('Invalid path');
        response.setHeader('content-type', contentTypes.get(extname(file)) || 'application/octet-stream');
        response.end(await readFile(file));
    } catch {
        response.writeHead(404).end('Not found');
    }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let { port } = server.address();
let failures = [];
let engines = { chromium, firefox, webkit };
let selectedNames = process.env.DOMSCULPTOR_BROWSERS
    ? process.env.DOMSCULPTOR_BROWSERS.split(',').map(name => name.trim()).filter(Boolean)
    : Object.keys(engines);

try {
    for (let name of selectedNames) {
        let engine = engines[name];
        if (!engine) throw new TypeError(`Unknown browser engine "${name}"`);
        let browser;
        try {
            browser = await engine.launch({ headless: true, timeout: 30_000 });
        } catch (error) {
            failures.push(`${name}: browser launch failed\n${error.stack || error}`);
            continue;
        }
        try {
            let page = await browser.newPage();
            await page.goto(`http://127.0.0.1:${port}/test/browser.html`);
            await page.waitForFunction(() => document.querySelector('#result')?.textContent !== 'running');
            let result = JSON.parse(await page.locator('#result').textContent());
            if (!result.ok) failures.push(`${name}: ${result.message}\n${result.stack || ''}`);
            else {
                if (name === 'chromium') {
                    await page.evaluate(async () => {
                        let { default: DomSculptor } = await import('/src/index.js');
                        window.__domSculptorGcRefs = (() => {
                            let sculptor = new DomSculptor();
                            let signal = sculptor.signal(0);
                            let callback = () => {};
                            let element = sculptor.create('button').on('click', callback);
                            signal.subscribe(callback);
                            let refs = {
                                wrapper: new WeakRef(element),
                                node: new WeakRef(element.html),
                                callback: new WeakRef(callback),
                                signal: new WeakRef(signal)
                            };
                            element.dispose();
                            signal.dispose();
                            return refs;
                        })();
                    });
                    let cdp = await page.context().newCDPSession(page);
                    for (let attempt = 0; attempt < 3; attempt++) {
                        await cdp.send('HeapProfiler.collectGarbage');
                        await page.evaluate(() => Array.from({ length: 10_000 }, () => ({})));
                    }
                    let retained = await page.evaluate(() =>
                        Object.entries(window.__domSculptorGcRefs)
                            .filter(([, reference]) => reference.deref() !== undefined)
                            .map(([key]) => key)
                    );
                    if (retained.length) {
                        failures.push(`chromium: disposed values remained reachable after forced GC: ${retained.join(', ')}`);
                    } else {
                        result.assertions++;
                    }
                }
                console.log(`${name}: ${result.assertions} assertions passed`);
            }
        } finally {
            await browser.close();
        }
    }
} finally {
    await new Promise(resolve => server.close(resolve));
}

if (failures.length) throw new AggregateError(failures.map(message => new Error(message)), 'Browser tests failed');
