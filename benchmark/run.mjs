import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium } from 'playwright';

let root = normalize(join(import.meta.dirname, '..'));
let packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8']
]);
let server = createServer(async (request, response) => {
    try {
        let pathname = new URL(request.url, 'http://localhost').pathname;
        let file = normalize(join(root, pathname));
        if (!file.startsWith(root)) throw new Error('Invalid path');
        response.setHeader('content-type', contentTypes.get(extname(file)) || 'application/octet-stream');
        response.end(await readFile(file));
    } catch {
        response.writeHead(404).end('Not found');
    }
});

let summarize = samples => {
    let sorted = [...samples].sort((a, b) => a - b);
    let median = sorted[Math.floor(sorted.length / 2)];
    let mean = samples.reduce((total, value) => total + value, 0) / samples.length;
    let variance = samples.reduce((total, value) => total + ((value - mean) ** 2), 0) / samples.length;
    return {
        medianMs: Number(median.toFixed(3)),
        varianceMs2: Number(variance.toFixed(3)),
        samples: samples.length
    };
};

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });

try {
    let page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/benchmark/index.html`);
    let raw = await page.evaluate(async () => {
        let { default: DomSculptor } = await import('/src/index.js');
        let run = (name, iterations = 25) => {
            let samples = [];
            for (let sample = 0; sample < iterations; sample++) {
                let sculptor = new DomSculptor();
                let items = Array.from({ length: 1_000 }, (_, id) => ({ id, label: `Row ${id}` }));
                let state;
                let container;
                let start;
                let stop;
                let setupList = () => {
                    state = sculptor.signal(items);
                    container = sculptor.createDetached('div');
                    state.list(container, {
                        key: item => item.id,
                        render: item => sculptor.createDetached('div').setText(item.label),
                        update: (row, item) => row.setText(item.label)
                    });
                    sculptor.mount(container, document.body);
                };

                if (name === 'create-1000') {
                    start = performance.now();
                    setupList();
                    stop = performance.now();
                } else if (name === 'signal-updates-unbatched' || name === 'signal-updates-batched') {
                    let value = sculptor.signal(0);
                    let target = sculptor.createDetached('span');
                    value.bindText(target);
                    start = performance.now();
                    if (name === 'signal-updates-batched') {
                        sculptor.batch(() => {
                            for (let index = 0; index < 1_000; index++) value.set(index);
                        });
                    } else {
                        for (let index = 0; index < 1_000; index++) value.set(index);
                    }
                    sculptor.flush();
                    stop = performance.now();
                    target.dispose();
                    value.dispose();
                } else if (name === 'listener-subscription-cleanup') {
                    let elements = [];
                    let subscriptions = [];
                    for (let index = 0; index < 1_000; index++) {
                        let element = sculptor.createDetached('button').on('click', () => {});
                        let value = sculptor.signal(index);
                        subscriptions.push({ value, unsubscribe: value.subscribe(() => {}) });
                        elements.push(element);
                    }
                    start = performance.now();
                    elements.forEach(element => element.dispose());
                    subscriptions.forEach(({ value, unsubscribe }) => {
                        unsubscribe();
                        value.dispose();
                    });
                    stop = performance.now();
                } else {
                    setupList();
                    let next = items.slice();
                    start = performance.now();
                    if (name === 'append-one') next.push({ id: 1_000, label: 'Row 1000' });
                    if (name === 'prepend-one') next.unshift({ id: 1_000, label: 'Row 1000' });
                    if (name === 'remove-middle') next.splice(500, 1);
                    if (name === 'swap-two') [next[1], next[998]] = [next[998], next[1]];
                    if (name === 'update-every-tenth') {
                        next = next.map((item, index) =>
                            index % 10 === 0 ? { ...item, label: `Updated ${item.id}` } : item
                        );
                    }
                    if (name === 'clear-all') next = [];
                    state.set(next);
                    sculptor.flush();
                    stop = performance.now();
                }
                samples.push(stop - start);
                container?.dispose();
                state?.dispose();
            }
            return samples;
        };
        let runEach = async (iterations = 5) => {
            let samples = [];
            for (let sample = 0; sample < iterations; sample++) {
                let sculptor = new DomSculptor();
                let items = Array.from({ length: 100 }, (_, id) => ({ id, label: `Row ${id}` }));
                let container = sculptor.create('div');
                sculptor.mount(container, document.body);
                let start = performance.now();
                await sculptor.renderEach(items, container, {
                    render: item => sculptor.create('div').setText(item.label)
                });
                samples.push(performance.now() - start);
                container.dispose();
            }
            return samples;
        };

        let names = [
            'create-1000',
            'append-one',
            'prepend-one',
            'remove-middle',
            'swap-two',
            'update-every-tenth',
            'clear-all',
            'signal-updates-unbatched',
            'signal-updates-batched',
            'listener-subscription-cleanup'
        ];
        let results = Object.fromEntries(names.map(name => [name, run(name)]));
        results['render-each-100'] = await runEach();
        return results;
    });

    let cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    let before = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    await page.evaluate(async () => {
        let { default: DomSculptor } = await import('/src/index.js');
        let sculptor = new DomSculptor();
        let Component = sculptor.component(() => ({
            root: sculptor.createDetached('button').on('click', () => {}),
            api: { value: sculptor.signal(0) }
        }));
        for (let index = 0; index < 5_000; index++) {
            let instance = Component();
            sculptor.mount(instance, document.body);
            instance.dispose();
        }
    });
    await cdp.send('HeapProfiler.collectGarbage');
    let after = (await cdp.send('Runtime.getHeapUsage')).usedSize;

    let bundleSizes = {};
    for (let file of [
        'dist/domsculptor.min.js',
        'dist/domsculptor.esm.min.js'
    ]) {
        let bytes = await readFile(join(root, file));
        bundleSizes[file] = { minifiedBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
    }
    let output = {
        library: `domsculptor@${packageJson.version}`,
        browser: `Chromium ${browser.version()}`,
        runtime: process.version,
        platform: `${process.platform} ${process.arch}`,
        results: Object.fromEntries(Object.entries(raw).map(([name, samples]) => [name, summarize(samples)])),
        memory: {
            cycles: 5_000,
            beforeBytes: before,
            afterBytes: after,
            deltaBytes: after - before,
            note: 'Chromium heap usage after forced garbage collection; small run-to-run variance is expected.'
        },
        bundleSizes
    };
    console.log(JSON.stringify(output, null, 2));
} finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
}
