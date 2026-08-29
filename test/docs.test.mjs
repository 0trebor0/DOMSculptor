import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let docsUrl = new URL('../docs/', import.meta.url);

test('static documentation covers required guides and practical examples without a framework', async () => {
    let [html, examples, largeProjects, api, recipes, releasing, css] = await Promise.all([
        readFile(new URL('index.html', docsUrl), 'utf8'),
        readFile(new URL('examples.html', docsUrl), 'utf8'),
        readFile(new URL('large-projects.html', docsUrl), 'utf8'),
        readFile(new URL('api.html', docsUrl), 'utf8'),
        readFile(new URL('recipes.html', docsUrl), 'utf8'),
        readFile(new URL('releasing.md', docsUrl), 'utf8'),
        readFile(new URL('styles.css', docsUrl), 'utf8')
    ]);

    for (let section of [
        'Five-minute start',
        'DOM creation',
        'Signals, computed values, effects, and batching',
        'Keyed lists',
        'Components and disposal scopes',
        'Forms',
        'Async state',
        'Accessibility and security',
        'TypeScript',
        'Migration guide',
        'Compatibility policy',
        'Apache License 2.0',
        'API reference',
        'Performance guidance',
        'Comparison and non-goals'
    ]) {
        assert.match(html, new RegExp(section));
    }

    for (let example of [
        'Counter',
        'Keyed todo list',
        'Searchable table',
        'Accessible modal',
        'Validated form',
        'Async user search',
        'Extension popup',
        'Progressive enhancement'
    ]) {
        assert.match(html + examples, new RegExp(example));
    }

    assert.match(examples, /domsculptor@3\.0\.0/);
    assert.match(html, /From an empty page to reactive UI/);
    for (let step of ['Install:', 'Add a mount point:', 'Create:', 'Connect:', 'Clean up:']) {
        assert.match(html, new RegExp(step));
    }
    assert.match(html, /Mental model:/);
    assert.match(html, /domsculptor\/testing/);
    assert.match(html, /domsculptor\/lazy/);
    for (let referenceTopic of [
        'Runtime and ownership',
        'DomElement',
        'Signals, computed values, and effects',
        'Stores',
        'Components, scopes, contexts, and boundaries',
        'Async state',
        'Named convenience exports',
        'domsculptor/testing',
        'domsculptor/lazy',
        'Failure and cleanup rules'
    ]) assert.match(api, new RegExp(referenceTopic));
    for (let recipe of [
        'Create a card',
        'Enhance existing HTML',
        'Bind a form',
        'Render a keyed collection',
        'Load remote data',
        'Own a route lifetime',
        'Share a service with context',
        'Clean up a feature'
    ]) assert.match(recipes, new RegExp(recipe));
    assert.match(html, /onMount.*onUnmount.*onDispose/s);
    assert.match(html, /Error policy/);
    for (let licenseTopic of [
        'commercial and closed-source software',
        'When redistributing',
        'Patent grant',
        'What is not granted',
        'not legal advice'
    ]) assert.match(html, new RegExp(licenseTopic));
    assert.equal((api.match(/<code>create\(tag, parent\?, callback\?\)<\/code>/g) || []).length, 1);
    assert.equal((api.match(/<code>createProgressively\(tag, parent, callback\?\)<\/code>/g) || []).length, 1);
    assert.match(api, /text\(readable\)/);
    assert.match(api, /attr\(name, readable\)/);
    assert.doesNotMatch(api, /text\(readable, transform\?/);
    assert.doesNotMatch(api, /attr\(name, readable, transform\?/);
    assert.match(api, /hook failure can leave the value mounted/);
    assert.match(api, /first call even though that element mounts immediately/);
    assert.match(api, /shared default <code>DomSculptor<\/code> instance/);
    assert.match(examples, /adopted wrapper remains reusable/);
    assert.match(html, /domsculptor@3\.0\.0\/dist\/domsculptor\.esm\.min\.js/);
    assert.ok((examples.match(/dispose\(\)/g) || []).length >= 8);
    assert.ok((examples.match(/<pre><code>/g) || []).length >= 8);
    assert.match(css, /@media \(max-width: 780px\)/);
    assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.topbar nav \{[^}]*overflow-x: auto/s);
    assert.match(css, /main\.examples-page \+ footer/);
    assert.match(largeProjects, /class="topbar"/);
    assert.match(largeProjects, /class="examples-page"/);
    for (let topic of [
        'Recommended structure',
        'Routing with browser APIs',
        'Lazy feature loading',
        'Error boundaries',
        'domsculptor/testing',
        'Accessibility patterns',
        'Service boundaries'
    ]) assert.match(largeProjects, new RegExp(topic));
    for (let releaseGate of [
        'npm ci',
        'npm run check',
        'npm run test:browser',
        'npm pack --dry-run --json',
        'npm publish --access public',
        'npm whoami',
        'annotated'
    ]) assert.match(releasing, new RegExp(releaseGate));
    assert.doesNotMatch(html + examples + api + recipes + css, /\b(?:next\.js|react|vinext|tailwind)\b/i);
});


test('the in-depth reference covers every declared member and is not stale', async () => {
    let ts = (await import('typescript')).default;
    let [declarations, reference] = await Promise.all([
        readFile(new URL('../types/index.d.ts', import.meta.url), 'utf8'),
        readFile(new URL('../docs/reference.html', import.meta.url), 'utf8')
    ]);

    let source = ts.createSourceFile('index.d.ts', declarations, ts.ScriptTarget.Latest, true);
    let expected = [];
    for (let statement of source.statements) {
        if (!ts.isInterfaceDeclaration(statement) && !ts.isClassDeclaration(statement)) continue;
        let typeName = statement.name.getText(source);
        for (let member of statement.members) {
            let name = member.name?.getText(source);
            if (!name || name.startsWith('_')) continue;
            expected.push(`${typeName}.${name}`);
        }
    }
    assert.ok(expected.length > 150, `only found ${expected.length} declared members`);

    // The page is generated from the declarations, so a member missing from it means
    // the declarations changed and `npm run docs:reference` was not run afterwards.
    let missing = [...new Set(expected)].filter(entry => {
        let anchor = entry.replace(/\W+/g, '-').toLowerCase();
        return !reference.includes(`id="${anchor}"`);
    });
    assert.deepEqual(missing, [], `docs/reference.html is stale; run npm run docs:reference`);

    // Every section named in the page's own navigation must exist as a section.
    for (let id of ['runtime', 'elements', 'state', 'stores', 'async', 'structure', 'virtual', 'routing', 'components']) {
        assert.match(reference, new RegExp(`<section id="${id}"`), `missing section ${id}`);
    }
    assert.match(reference, /Signatures on this page are extracted from/);
});


test('the routing guide covers the behaviour the router actually has', async () => {
    let [routing, recipes, largeProjects] = await Promise.all([
        readFile(new URL('../docs/routing.html', import.meta.url), 'utf8'),
        readFile(new URL('../docs/recipes.html', import.meta.url), 'utf8'),
        readFile(new URL('../docs/large-projects.html', import.meta.url), 'utf8')
    ]);

    for (let topic of [
        'The smallest router',
        'Patterns and matching',
        'Parameters',
        'Hash or history',
        'Each view runs in its own scope',
        'Asynchronous views',
        'Guards and redirects',
        'Active links',
        'Components as views',
        'Stopping',
        'Common mistakes'
    ]) assert.match(routing, new RegExp(topic), `the guide is missing "${topic}"`);

    // The two behaviours readers get wrong most often must be stated explicitly.
    assert.match(routing, /scope\.disposed/, 'the guide must show the asynchronous guard');
    assert.match(routing, /params\.rest === "\/deep\/path"/, 'the guide must show that * keeps the leading slash');
    assert.match(routing, /params\.rest === "deep\/path"/, 'the guide must show that \/* drops it');
    assert.match(routing, /replace/, 'the guide must cover redirecting without a history entry');

    // These two pages predated router() and taught readers to hand-roll it.
    for (let [name, page] of [['recipes', recipes], ['large-projects', largeProjects]]) {
        assert.match(page, /sculptor\.router\(/, `${name} must use router() rather than a hand-rolled switcher`);
        assert.doesNotMatch(page, /activeRoute/, `${name} still hand-rolls route disposal`);
        assert.match(page, /routing\.html/, `${name} should link the routing guide`);
    }
    assert.doesNotMatch(
        largeProjects,
        /Keep route matching, guards, and URL parsing outside the runtime/,
        'large-projects still advises against the shipped router'
    );
});
