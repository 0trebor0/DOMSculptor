// Drives the router example in headless Chromium.
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
    let base = `http://127.0.0.1:${port}/example/router/index.html`;
    await page.goto(base + '#/');
    await page.waitForFunction(() => window.routerExample !== undefined);
    await page.waitForTimeout(200);

    check('home renders', (await page.textContent('#view h2')) === 'Home');
    check('active link is marked', (await page.textContent('nav a.active')) === 'Home');
    check('three posts listed', (await page.locator('#view ul.posts li').count()) === 3);

    await page.click('#view ul.posts a');
    await page.waitForTimeout(150);
    check('post view shows a loading state first', (await page.textContent('#view h2')) === 'Loading…');
    await page.waitForTimeout(700);
    check('post resolves', (await page.textContent('#view h2')) === 'Why keyed lists keep their nodes');
    check('home was disposed on leaving', (await page.textContent('#log')).includes('disposed  Home'));

    await page.click('nav a[href="#/posts/missing"]');
    await page.waitForTimeout(800);
    check('a missing post reports not found', (await page.textContent('#view h2')) === 'Not found');

    await page.click('nav a[href="#/nowhere"]');
    await page.waitForTimeout(200);
    check('an unrouted path hits the catch-all', (await page.textContent('#view h2')) === 'Not found');
    check('catch-all reports the path', (await page.textContent('#view p')).includes('/nowhere'));

    // Navigate away mid-request: the late response must be ignored, not thrown.
    await page.click('nav a[href="#/posts/keyed-lists"]');
    await page.waitForTimeout(100);
    await page.click('nav a[href="#/"]');
    await page.waitForTimeout(900);
    check('a late response is ignored after navigating away',
        (await page.textContent('#log')).includes('ignored  late response'));
    check('home is showing again', (await page.textContent('#view h2')) === 'Home');

    await page.click('nav button');
    await page.waitForTimeout(300);
    check('the back button routes', (await page.evaluate(() => location.hash)) === '#/posts/keyed-lists');
    check('only one view is mounted',
        (await page.evaluate(() => document.getElementById('view').children.length)) === 1);
    check('no page errors', errors.length === 0, errors.join(' | '));
} finally { await browser.close(); server.close(); }
console.log(`\n${failures.length ? failures.length + ' failed' : 'all checks passed'}`);
if (failures.length) process.exitCode = 1;
