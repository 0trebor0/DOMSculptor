import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

let docsUrl = new URL('../docs/', import.meta.url);

test('static documentation covers required guides and complete examples without a framework', async () => {
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

    assert.match(examples, /domsculptor@2\.0\.0/);
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
    assert.match(html, /domsculptor@2\.0\.0\/dist\/domsculptor\.esm\.min\.js/);
    assert.ok((examples.match(/dispose\(\)/g) || []).length >= 8);
    assert.ok((examples.match(/<pre><code>/g) || []).length >= 8);
    assert.match(css, /@media \(max-width: 780px\)/);
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
