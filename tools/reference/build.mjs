// Builds docs/reference.html.
//
// Signatures come from types/index.d.ts, parsed with the TypeScript compiler, so
// the reference cannot drift from the declarations the package ships. Prose and
// examples come from content.mjs and are merged in by name. A member with no
// entry still appears, with its signature and any JSDoc, and is listed at the end
// of the run so the gap is visible rather than silent.
import ts from 'typescript';
import { readFile, writeFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { content, groups, intro } from './content.mjs';

let root = normalize(join(import.meta.dirname, '..', '..'));
let declarationPath = join(root, 'types', 'index.d.ts');
let source = ts.createSourceFile(
    'index.d.ts',
    await readFile(declarationPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true
);

let escape = text => String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// The declaration text is the single source of truth for a signature; it is
// collapsed onto one line so it reads as a heading.
let signatureOf = member => member.getText(source)
    .replace(/\/\*\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/;$/, '')
    .trim();

let jsDocOf = member => (member.jsDoc || [])
    .map(doc => (typeof doc.comment === 'string' ? doc.comment : ''))
    .join(' ')
    .trim();

let types = new Map();
let collect = (name, members) => {
    let entries = [];
    for (let member of members) {
        let memberName = member.name?.getText(source);
        if (!memberName || memberName.startsWith('_')) continue;
        entries.push({ name: memberName, signature: signatureOf(member), doc: jsDocOf(member) });
    }
    if (entries.length) types.set(name, entries);
};

for (let statement of source.statements) {
    if (ts.isInterfaceDeclaration(statement) || ts.isClassDeclaration(statement)) {
        collect(statement.name.getText(source), statement.members);
    }
}

let missing = [];
let seen = new Set();
let renderMember = (typeName, entry) => {
    let key = `${typeName}.${entry.name}`;
    // An overload shares its prose with the first signature rather than repeating it.
    if (seen.has(key)) {
        return `<article class="overload">
        <h3><code>${escape(entry.signature)}</code></h3>
        `
            + `<p class="note">Overload of <code>${escape(entry.name)}</code> above.</p>
        </article>`;
    }
    seen.add(key);
    let extra = content[key];
    if (!extra) missing.push(key);
    let described = extra?.description || entry.doc;
    let parts = [`<article id="${escape(key.replace(/\W+/g, '-').toLowerCase())}">`];
    parts.push(`<h3><code>${escape(entry.signature)}</code></h3>`);
    if (described) parts.push(`<p>${described}</p>`);
    if (extra?.params?.length) {
        parts.push('<table class="params"><tbody>');
        for (let [name, note] of extra.params) {
            parts.push(`<tr><th scope="row"><code>${escape(name)}</code></th><td>${note}</td></tr>`);
        }
        parts.push('</tbody></table>');
    }
    if (extra?.returns) parts.push(`<p class="returns"><strong>Returns.</strong> ${extra.returns}</p>`);
    if (extra?.throws) parts.push(`<p class="throws"><strong>Throws.</strong> ${extra.throws}</p>`);
    if (extra?.example) {
        parts.push(`<pre><code>${escape(extra.example.trim())}</code></pre>`);
    }
    if (extra?.note) parts.push(`<p class="note">${extra.note}</p>`);
    parts.push('</article>');
    return parts.join('\n        ');
};

let sections = [];
let navigation = [];
for (let group of groups) {
    let rendered = [];
    for (let typeName of group.types) {
        let entries = types.get(typeName);
        if (!entries) continue;
        rendered.push(`<h3 class="type-name">${escape(typeName)}</h3>`);
        let order = content[`${typeName}.__order`];
        if (order) {
            entries = [
                ...order.map(name => entries.find(e => e.name === name)).filter(Boolean),
                ...entries.filter(e => !order.includes(e.name))
            ];
        }
        for (let entry of entries) rendered.push(renderMember(typeName, entry));
    }
    if (!rendered.length) continue;
    navigation.push(`<a href="#${group.id}">${escape(group.title)}</a>`);
    sections.push(`    <section id="${group.id}">
      <p class="eyebrow">${escape(group.eyebrow)}</p>
      <h2>${escape(group.title)}</h2>
      ${group.summary ? `<p class="lede">${group.summary}</p>` : ''}
      <div class="reference">
        ${rendered.join('\n        ')}
      </div>
    </section>`);
}

let version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
let page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="In-depth DOMSculptor reference: every public member with its signature, parameters, return value, failures, and a worked example.">
  <title>In-depth reference · DOMSculptor</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="topbar">
    <a class="brand" href="./index.html"><span aria-hidden="true">DS</span> DOMSculptor</a>
    <nav aria-label="Primary navigation"><a href="./index.html">Start</a><a href="./api.html">API summary</a><a href="./recipes.html">Recipes</a><a href="./examples.html">Examples</a></nav>
  </header>
  <aside aria-label="Reference navigation">
    <strong>In-depth reference</strong>
    ${navigation.join('\n    ')}
  </aside>
  <main>
    <section class="hero">
      <p class="eyebrow">In-depth reference</p>
      <h1>Every member, with what it takes and what it does.</h1>
      <p class="lede">${intro}</p>
      <p class="note">Signatures on this page are extracted from <code>types/index.d.ts</code> when the page is built, so they cannot drift from the declarations the package ships. Rebuild with <code>npm run docs:reference</code>.</p>
    </section>
${sections.join('\n')}
  </main>
  <footer><span>DOMSculptor in-depth reference</span><span>Version ${escape(version)}</span></footer>
</body>
</html>
`;

await writeFile(join(root, 'docs', 'reference.html'), page);

let total = [...types.values()].reduce((sum, entries) => sum + entries.length, 0);
console.log(`docs/reference.html written: ${types.size} types, ${total} members`);
console.log(`${total - missing.length} have prose and examples, ${missing.length} have signature and JSDoc only`);
if (missing.length) console.log(`  ${missing.join('\n  ')}`);
