// Head-to-head keyed-list comparison. Every framework performs the same eight
// operations on identical data in one page, interleaved sample by sample, and
// each implementation's DOM is verified before any timing is reported.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

let root = normalize(join(import.meta.dirname, '..', '..'));
let samples = Number(process.env.SAMPLES || 25);
let warmup = Number(process.env.WARMUP || 5);

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

await new Promise(done => server.listen(0, '127.0.0.1', done));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });

try {
    let page = await browser.newPage();
    let pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/benchmark/compare/index.html`);
    await page.waitForFunction(() => window.__bench !== undefined);

    let problems = await page.evaluate(async () => {
        let found = [];
        let complain = (framework, message) => found.push(`${framework}: ${message}`);
        let { implementations, data } = window.__bench;

        for (let [framework, impl] of Object.entries(implementations)) {
            let tbody = document.getElementById(`tbody-${framework.toLowerCase()}`);
            let rows = () => Array.from(tbody.children);
            let labels = () => rows().map(row => row.children[1].firstElementChild.textContent);
            let ids = () => rows().map(row => row.children[0].textContent);

            await impl.run(data.thousand);
            if (rows().length !== 1_000) complain(framework, `create produced ${rows().length} rows`);
            let first = rows()[0];
            let classes = Array.from(first.children, cell => cell.className);
            if (classes.join(',') !== 'col-md-1,col-md-4,col-md-1,col-md-6') {
                complain(framework, `row cells are ${classes.join(',')}`);
            }
            if (!first.querySelector('td:nth-child(2) a.lbl')) complain(framework, 'row has no a.lbl');
            if (!first.querySelector('td:nth-child(3) a.remove span.glyphicon.glyphicon-remove')) {
                complain(framework, 'row has no remove control');
            }
            if (ids()[0] !== String(data.thousand[0].id)) complain(framework, 'first row shows the wrong id');
            if (labels()[0] !== data.thousand[0].label) complain(framework, 'first row shows the wrong label');

            await impl.add(data.appended);
            if (rows().length !== 2_000) complain(framework, `append produced ${rows().length} rows`);

            await impl.run(data.thousand);
            let before = labels();
            await impl.update();
            let after = labels();
            if (!after.every((label, index) => (
                index % 10 === 0 ? label === `${before[index]} !!!` : label === before[index]
            ))) complain(framework, 'update did not change exactly every tenth label');

            await impl.run(data.thousand);
            let beforeSwap = ids();
            await impl.swap();
            let afterSwap = ids();
            if (afterSwap[1] !== beforeSwap[998] || afterSwap[998] !== beforeSwap[1]) {
                complain(framework, 'swap did not exchange rows 1 and 998');
            }
            if (!afterSwap.every((id, index) => (
                index === 1 || index === 998 || id === beforeSwap[index]
            ))) complain(framework, 'swap disturbed other rows');

            await impl.run(data.thousand);
            await impl.select(500);
            let selected = rows().filter(row => row.classList.contains('danger'));
            if (selected.length !== 1) complain(framework, `select marked ${selected.length} rows`);
            else if (selected[0] !== rows()[500]) complain(framework, 'select marked the wrong row');

            await impl.run(data.thousand);
            let removedId = ids()[500];
            await impl.remove(500);
            if (rows().length !== 999) complain(framework, `remove produced ${rows().length} rows`);
            if (ids().includes(removedId)) complain(framework, 'remove deleted the wrong row');

            await impl.clear();
            if (rows().length !== 0) complain(framework, `clear left ${rows().length} rows`);
        }
        return found;
    });

    if (problems.length) {
        console.error('Implementations disagree with the benchmark specification:');
        for (let problem of problems) console.error(`  ${problem}`);
        process.exitCode = 1;
    } else {
        console.log(`All five implementations verified. Timing ${samples} samples after ${warmup} warm-up rounds.\n`);
        let results = await page.evaluate(
            options => window.__bench.run(options),
            { samples, warmup }
        );
        let frameworks = await page.evaluate(() => window.__bench.frameworks);
        let width = Math.max(...Object.keys(results).map(name => name.length));
        console.log(`| ${'case'.padEnd(width)} | ${frameworks.map(name => name.padStart(12)).join(' | ')} |`);
        console.log(`| ${'-'.repeat(width)} | ${frameworks.map(() => '-----------:').join(' | ')} |`);
        for (let [name, row] of Object.entries(results)) {
            let cells = frameworks.map(framework => `${row[framework].median.toFixed(2)} ms`.padStart(12));
            console.log(`| ${name.padEnd(width)} | ${cells.join(' | ')} |`);
        }
        console.log('\nMedian of the timed samples. Full distribution:');
        console.log(JSON.stringify(results, null, 2));
    }

    if (pageErrors.length) {
        console.error(`\nPage errors: ${pageErrors.join(' | ')}`);
        process.exitCode = 1;
    }
} finally {
    await browser.close();
    server.close();
}
