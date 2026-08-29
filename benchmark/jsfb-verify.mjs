// Builds and exercises the js-framework-benchmark implementation the way the
// upstream harness drives it, so the submission folder is known to work before
// it is copied into that repository.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';
import webpack from 'webpack';

let root = normalize(join(import.meta.dirname, '..'));
let appDir = join(root, 'benchmark', 'js-framework-benchmark');
let baseConfig = (await import(`file://${join(appDir, 'webpack.config.cjs')}`)).default;

let build = () => new Promise((done, fail) => {
    webpack({
        ...baseConfig,
        context: appDir,
        // The submission resolves the published package; here it must resolve the
        // working tree, so the verified bundle is the code under review.
        resolve: { alias: { domsculptor: resolve(root, 'src/index.js') } }
    }, (error, stats) => {
        if (error) return fail(error);
        if (stats.hasErrors()) return fail(new Error(stats.toString({ all: false, errors: true })));
        done();
    });
});

let contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8']
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

let failures = [];
let check = (name, condition, detail = '') => {
    if (condition) console.log(`ok   ${name}`);
    else {
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

await build();
await new Promise(done => server.listen(0, '127.0.0.1', done));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });

try {
    let page = await browser.newPage();
    let errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    // /css/currentStyle.css is supplied by the upstream harness, not by the
    // submission, so its absence here is expected and not a failure.
    page.on('console', message => {
        if (message.type() !== 'error') return;
        if (message.text().includes('404')) return;
        errors.push(message.text());
    });
    await page.goto(`http://127.0.0.1:${port}/benchmark/js-framework-benchmark/index.html`);

    let rowCount = () => page.locator('#tbody tr').count();
    let click = async selector => {
        await page.click(selector);
        await page.waitForTimeout(50);
    };
    let labels = () => page.$$eval('#tbody tr td:nth-child(2) a', nodes => nodes.map(n => n.textContent));
    let ids = () => page.$$eval('#tbody tr td:first-child', nodes => nodes.map(n => n.textContent));

    check('markup starts empty', await rowCount() === 0);

    await click('#run');
    check('create 1,000 rows', await rowCount() === 1_000, `got ${await rowCount()}`);
    let shape = await page.$eval('#tbody tr', row => ({
        cells: row.children.length,
        classes: Array.from(row.children, cell => cell.className),
        label: row.querySelector('td:nth-child(2) a.lbl') !== null,
        remove: row.querySelector('td:nth-child(3) a.remove span.glyphicon.glyphicon-remove') !== null
    }));
    check('row has the four benchmark cells', shape.cells === 4, JSON.stringify(shape.classes));
    check('row cell classes match the specification',
        JSON.stringify(shape.classes) === JSON.stringify(['col-md-1', 'col-md-4', 'col-md-1', 'col-md-6']),
        JSON.stringify(shape.classes));
    check('row exposes a.lbl and a.remove', shape.label && shape.remove);

    await click('#run');
    check('create replaces rather than appends', await rowCount() === 1_000, `got ${await rowCount()}`);

    let firstIds = await ids();
    await click('#add');
    check('append 1,000 rows', await rowCount() === 2_000, `got ${await rowCount()}`);
    check('append keeps the existing rows in place',
        JSON.stringify((await ids()).slice(0, 1_000)) === JSON.stringify(firstIds));

    let beforeUpdate = await labels();
    await click('#update');
    let afterUpdate = await labels();
    let updatedCorrectly = afterUpdate.every((label, index) => (
        index % 10 === 0 ? label === `${beforeUpdate[index]} !!!` : label === beforeUpdate[index]
    ));
    check('update touches every tenth row and nothing else', updatedCorrectly);

    await page.click('#tbody tr:nth-child(4) td:nth-child(2) a');
    await page.waitForTimeout(50);
    check('clicking a label selects its row',
        await page.$$eval('#tbody tr.danger', nodes => nodes.length) === 1);
    check('the selected row is the one clicked',
        await page.$eval('#tbody tr:nth-child(4)', row => row.classList.contains('danger')));
    await page.click('#tbody tr:nth-child(6) td:nth-child(2) a');
    await page.waitForTimeout(50);
    check('selection moves rather than accumulating',
        await page.$$eval('#tbody tr.danger', nodes => nodes.length) === 1);

    let beforeSwap = await ids();
    await click('#swaprows');
    let afterSwap = await ids();
    check('swap exchanges rows 1 and 998',
        afterSwap[1] === beforeSwap[998] && afterSwap[998] === beforeSwap[1],
        `${beforeSwap[1]}/${beforeSwap[998]} -> ${afterSwap[1]}/${afterSwap[998]}`);
    check('swap leaves every other row untouched',
        afterSwap.every((id, index) => (index === 1 || index === 998 ? true : id === beforeSwap[index])));

    let removedId = (await ids())[2];
    // The remove link holds only an icon glyph, which has no size without the
    // harness stylesheet, so it is clicked through the DOM rather than the mouse.
    await page.$eval('#tbody tr:nth-child(3) td:nth-child(3) a', node => node.click());
    await page.waitForTimeout(50);
    check('remove deletes one row', await rowCount() === 1_999, `got ${await rowCount()}`);
    check('remove deletes the row that was clicked', !(await ids()).includes(removedId));

    await click('#clear');
    check('clear empties the table', await rowCount() === 0, `got ${await rowCount()}`);

    await click('#runlots');
    check('create 10,000 rows', await rowCount() === 10_000, `got ${await rowCount()}`);
    await click('#clear');
    check('clear empties a large table', await rowCount() === 0, `got ${await rowCount()}`);
    check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
    await browser.close();
    server.close();
}

console.log(`\n${failures.length ? `${failures.length} failed` : 'all checks passed'}`);
if (failures.length) process.exitCode = 1;
