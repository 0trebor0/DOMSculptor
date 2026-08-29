// Drives the ten-route example in headless Chromium.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
let root = normalize(join(import.meta.dirname, '..', '..'));
let types = new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8']]);
let server = createServer(async (q,r)=>{try{let p=new URL(q.url,'http://x').pathname;let f=normalize(join(root,p));if(!f.startsWith(root))throw 0;r.setHeader('content-type',types.get(extname(f))||'application/octet-stream');r.end(await readFile(f));}catch{r.writeHead(404).end('no');}});
await new Promise(d=>server.listen(0,'127.0.0.1',d));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });
let failures = [];
let check = (name, ok, detail='') => { console.log(`${ok?'ok  ':'FAIL'} ${name}${ok?'':' — '+detail}`); if(!ok) failures.push(name); };
try {
    let page = await browser.newPage();
    let errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    page.on('console', m => { if (m.type()==='error') errors.push(m.text()); });
    let base = `http://127.0.0.1:${port}/example/router/advanced.html`;
    let go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(180); };
    await page.goto(base + '#/');
    await page.waitForFunction(() => window.routerExample !== undefined);
    await page.waitForTimeout(200);

    let heading = () => page.textContent('#view h2');
    let side = () => page.textContent('aside');

    check('home renders', (await heading()) === 'Home');
    await go('#/docs');
    check('docs index lists sections', (await page.locator('#view .grid a').count()) === 3);
    await go('#/docs/state');
    check('one parameter resolves the section', (await heading()) === 'Reactive state');
    check('sidebar reports the matched pattern', (await side()).includes('/docs/:section'));
    await go('#/docs/state/effects');
    check('two parameters resolve the page', (await heading()) === 'Effects');
    check('breadcrumbs render the ancestry', (await page.textContent('#view .crumbs')).includes('Reactive state'));
    check('nested page keeps its section link active',
        (await page.locator('.bar a.active').allTextContents()).includes('Docs'));
    await go('#/docs/state/nope');
    check('an unknown page is handled by the route, not the catch-all', (await heading()) === 'Unknown page');

    await go('#/people/1');
    check('async view shows loading first', (await heading()) === 'Loading…');
    await page.waitForTimeout(600);
    check('async view resolves', (await heading()) === 'Ada Lovelace');
    await go('#/people/99');
    await page.waitForTimeout(600);
    check('a missing record is reported', (await heading()) === 'No such person');

    await go('#/search/keyed%20lists');
    check('prefixed catch-all captures the remainder', (await heading()) === 'Search: keyed lists');
    check('rest excludes the prefix', (await page.textContent('#view code')).includes('"keyed lists"'));

    await go('#/legacy/2');
    await page.waitForTimeout(250);
    check('legacy path redirects', (await page.evaluate(() => location.hash)) === '#/people/2');
    await page.waitForTimeout(600);
    check('redirect target renders', (await heading()) === 'Grace Hopper');

    // The guard: signed out, Settings must bounce to /login and come back after.
    check('starts signed out', (await page.textContent('.who')) === 'signed out');
    await go('#/people/1/settings');
    await page.waitForTimeout(250);
    check('guard redirects to login', (await page.evaluate(() => location.hash)) === '#/login');
    check('login explains where it will return', (await page.textContent('#view .notice')).includes('/people/1/settings'));
    await page.click('#view button');
    await page.waitForTimeout(300);
    check('signing in returns to the intended route', (await page.evaluate(() => location.hash)) === '#/people/1/settings');
    check('the guarded view now renders', (await heading()) === 'Settings');
    check('nav reflects the session', (await page.textContent('.who')).startsWith('signed in'));

    await go('#/nowhere/at/all');
    check('unrouted paths hit the catch-all', (await heading()) === 'Not found');

    check('only one view is ever mounted',
        (await page.evaluate(() => document.getElementById('view').children.length)) === 1);
    check('lifecycle log recorded builds and disposals',
        (await side()).includes('dispose') && (await side()).includes('build'));
    check('no page errors', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); server.close(); }
console.log(`\n${failures.length ? failures.length + ' failed' : 'all checks passed'}`);
if (failures.length) process.exitCode = 1;
