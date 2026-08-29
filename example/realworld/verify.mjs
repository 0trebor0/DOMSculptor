// Drives the example in headless Chromium against the live RealWorld API and
// checks what it renders. Only unauthenticated flows are exercised: signing up
// and publishing would write to a shared public service, so those paths are
// implemented but left for a person to run.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

let root = normalize(join(import.meta.dirname, '..', '..'));
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
        failures.push(name);
        console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
    }
};

await new Promise(done => server.listen(0, '127.0.0.1', done));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });

try {
    let page = await browser.newPage();
    let errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
        if (message.type() !== 'error') return;
        // The example loads the RealWorld stylesheet and icon font from their
        // public hosts; those are cosmetic and may be blocked or slow.
        if (/main\.css|ionicons|fonts\.googleapis/.test(message.text())) return;
        errors.push(message.text());
    });

    let base = `http://127.0.0.1:${port}/example/realworld/index.html`;
    let go = async hash => {
        await page.goto(`${base}${hash}`);
        await page.waitForFunction(() => window.conduit !== undefined);
    };
    let settle = () => page.waitForTimeout(1_200);

    await go('#/');
    await settle();

    check('the header renders the brand', await page.textContent('.navbar-brand') === 'conduit');
    check('an anonymous reader is offered sign in and sign up',
        (await page.locator('.navbar-nav a', { hasText: 'Sign in' }).count()) === 1 &&
        (await page.locator('.navbar-nav a', { hasText: 'Sign up' }).count()) === 1);
    check('the banner renders', await page.textContent('.banner h1') === 'conduit');
    check('the global feed is the only tab for an anonymous reader',
        await page.locator('.feed-toggle .nav-link').count() === 1);

    let previews = await page.locator('.article-preview').count();
    check('the global feed lists articles', previews > 0, `${previews} previews`);
    let firstPreview = page.locator('.article-preview').first();
    check('a preview shows an author, a date, and a favourite count',
        (await firstPreview.locator('.article-meta .author').count()) === 1 &&
        (await firstPreview.locator('.article-meta .date').count()) === 1 &&
        (await firstPreview.locator('button.btn-outline-primary').count()) === 1);
    check('a preview links to its article',
        (await firstPreview.locator('a.preview-link').getAttribute('href') || '').startsWith('#/article/'));

    let tagCount = await page.locator('.sidebar .tag-list a').count();
    check('popular tags load', tagCount > 0, `${tagCount} tags`);

    await page.locator('.sidebar .tag-list a').first().click();
    await settle();
    check('choosing a tag adds a tab for it',
        (await page.locator('.feed-toggle .nav-link').count()) === 2 &&
        (await page.textContent('.feed-toggle .nav-link.active') || '').startsWith('#'));

    await go('#/');
    await settle();
    let articleHref = await page.locator('a.preview-link').first().getAttribute('href');
    let authorName = await page.locator('.article-preview .author').first().textContent();

    await go(articleHref);
    await settle();
    check('the article page renders a title', (await page.textContent('.banner h1') || '').length > 0);
    check('the article page renders a body', await page.locator('.article-content p').count() > 0);
    check('the article page shows the meta block twice',
        await page.locator('.article-meta').count() === 2);
    check('an anonymous reader is invited to sign in before commenting',
        (await page.locator('.col-md-8 a', { hasText: 'Sign in' }).count()) === 1);
    check('an anonymous reader gets no comment form',
        await page.locator('.comment-form').count() === 0);

    await go(`#/profile/${encodeURIComponent(authorName.trim())}`);
    await settle();
    check('the profile page names the author',
        (await page.textContent('.user-info h4') || '').trim() === authorName.trim());
    check('the profile page offers both article tabs',
        await page.locator('.articles-toggle .nav-link').count() === 2);
    await page.locator('.articles-toggle .nav-link').nth(1).click();
    await settle();
    check('the favorited tab becomes active',
        (await page.textContent('.articles-toggle .nav-link.active') || '') === 'Favorited Articles');

    await go('#/login');
    check('the sign in form renders',
        await page.locator('.auth-page input[type=email]').count() === 1 &&
        await page.locator('.auth-page input[type=password]').count() === 1 &&
        await page.locator('.auth-page input[type=text]').count() === 0);
    await go('#/register');
    check('the sign up form adds a username field',
        await page.locator('.auth-page input[type=text]').count() === 1);

    await go('#/settings');
    await settle();
    check('settings redirects an anonymous reader to sign in',
        (await page.evaluate(() => location.hash)) === '#/login');

    await go('#/editor');
    await settle();
    check('the editor redirects an anonymous reader to sign in',
        (await page.evaluate(() => location.hash)) === '#/login');

    await go('#/nowhere');
    check('an unknown route renders the not-found view',
        (await page.textContent('#view h1') || '') === 'Not found');

    await go('#/');
    await settle();
    await page.locator('.sidebar .tag-list a').first().click();
    await settle();
    await page.evaluate(() => window.conduit.router.navigate('/login'));
    await settle();
    check('only one view is mounted at a time',
        await page.evaluate(() => document.getElementById('view').children.length) === 1);
    await page.goBack();
    await settle();
    check('the back button returns to the previous route',
        (await page.evaluate(() => location.hash)) === '#/');

    check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
    await browser.close();
    server.close();
}

console.log(`\n${failures.length ? `${failures.length} failed` : 'all checks passed'}`);
if (failures.length) process.exitCode = 1;
