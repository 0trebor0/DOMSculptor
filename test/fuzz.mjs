// Property-based fuzzing of the keyed reconciler against a model.
//
// The unit tests assert specific sequences. This drives random operation
// sequences and checks three properties after every single step:
//
//   1. Order      - the DOM matches the model exactly.
//   2. Identity   - a key that survives keeps the same node, so focus, scroll
//                   position, and uncontrolled input state survive with it.
//   3. Minimality - the number of DOM moves never exceeds the theoretical
//                   minimum, which is the count of survivors outside the longest
//                   increasing subsequence of their previous positions.
//
// Every run is seeded and prints its seed, so a failure is reproducible with
// SEED=<n> npm run test:fuzz.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

let root = normalize(join(import.meta.dirname, '..'));
let seed = Number(process.env.SEED || Math.floor(Math.random() * 1e9));
let sequences = Number(process.env.SEQUENCES || 400);
let steps = Number(process.env.STEPS || 24);

let types = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8']]);
let server = createServer(async (q, r) => {
    try {
        let p = new URL(q.url, 'http://x').pathname;
        let f = normalize(join(root, p));
        if (!f.startsWith(root)) throw 0;
        r.setHeader('content-type', types.get(extname(f)) || 'application/octet-stream');
        r.end(await readFile(f));
    } catch { r.writeHead(404).end('no'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });

try {
    let page = await browser.newPage();
    let pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/benchmark/index.html`);

    let report = await page.evaluate(async ({ seed, sequences, steps }) => {
        let { default: DomSculptor } = await import('/src/index.js');

        let random = state => () => {
            state = ((state * 1664525) + 1013904223) >>> 0;
            return state / 4294967296;
        };

        // The minimum number of moves a keyed reorder needs: every survivor that
        // is not part of the longest increasing subsequence of previous positions.
        let minimumMoves = positions => {
            let tails = [];
            for (let value of positions) {
                if (value < 0) continue;
                let low = 0;
                let high = tails.length;
                while (low < high) {
                    let mid = (low + high) >> 1;
                    if (tails[mid] < value) low = mid + 1;
                    else high = mid;
                }
                tails[low] = value;
            }
            let survivors = positions.filter(p => p >= 0).length;
            return { moved: survivors - tails.length, added: positions.length - survivors };
        };

        let failures = [];
        let totalSteps = 0;
        let totalMoves = 0;
        let totalMinimum = 0;

        for (let sequence = 0; sequence < sequences && failures.length < 5; sequence++) {
            let rng = random(seed + sequence);
            let pick = n => Math.floor(rng() * n);
            let sculptor = new DomSculptor();
            let nextId = 0;
            let model = Array.from({ length: pick(12) }, () => ({ id: nextId++ }));
            let rows = sculptor.signal(model.slice());
            let container = sculptor.create('ul');
            sculptor.mount(container, document.body);

            let nodeFor = new Map();
            let moves = 0;
            let realInsert = container.html.insertBefore.bind(container.html);
            container.html.insertBefore = (child, ref) => { moves++; return realInsert(child, ref); };

            rows.list(container, {
                key: item => item.id,
                render: item => sculptor.createDetached('li').setText(String(item.id)),
                update: (row, item) => row.setText(String(item.id))
            });
            let capture = () => {
                nodeFor.clear();
                Array.from(container.html.childNodes).forEach(node => nodeFor.set(node.textContent, node));
            };
            capture();

            let log = [];
            for (let step = 0; step < steps; step++) {
                let previous = model.map(item => item.id);
                let operation = pick(8);
                if (operation === 0 && model.length) {                 // remove one
                    model.splice(pick(model.length), 1);
                    log.push('remove');
                } else if (operation === 1) {                          // insert one
                    model.splice(pick(model.length + 1), 0, { id: nextId++ });
                    log.push('insert');
                } else if (operation === 2 && model.length > 1) {      // swap two
                    let a = pick(model.length);
                    let b = pick(model.length);
                    [model[a], model[b]] = [model[b], model[a]];
                    log.push('swap');
                } else if (operation === 3) {                          // reverse
                    model.reverse();
                    log.push('reverse');
                } else if (operation === 4) {                          // shuffle
                    for (let i = model.length - 1; i > 0; i--) {
                        let j = pick(i + 1);
                        [model[i], model[j]] = [model[j], model[i]];
                    }
                    log.push('shuffle');
                } else if (operation === 5) {                          // clear
                    model = [];
                    log.push('clear');
                } else if (operation === 6) {                          // append a run
                    for (let i = 0; i < 1 + pick(5); i++) model.push({ id: nextId++ });
                    log.push('append');
                } else {                                               // move one
                    if (model.length > 1) {
                        let [item] = model.splice(pick(model.length), 1);
                        model.splice(pick(model.length + 1), 0, item);
                    }
                    log.push('move');
                }

                let positions = model.map(item => {
                    let at = previous.indexOf(item.id);
                    return at;
                });
                let { moved, added } = minimumMoves(positions);
                let expectedMinimum = moved + added;

                moves = 0;
                rows.set(model.slice());
                sculptor.flush();
                totalSteps++;
                totalMoves += moves;
                totalMinimum += expectedMinimum;

                let actual = Array.from(container.html.childNodes, node => node.textContent);
                let expected = model.map(item => String(item.id));
                if (actual.join(',') !== expected.join(',')) {
                    failures.push({
                        seed: seed + sequence, step, log: log.join(' '),
                        problem: 'order', expected: expected.join(','), actual: actual.join(',')
                    });
                    break;
                }
                let identityBroken = null;
                for (let [id, node] of nodeFor) {
                    if (!expected.includes(id)) continue;
                    let current = Array.from(container.html.childNodes).find(n => n.textContent === id);
                    if (current !== node) { identityBroken = id; break; }
                }
                if (identityBroken !== null) {
                    failures.push({
                        seed: seed + sequence, step, log: log.join(' '),
                        problem: 'identity', expected: `key ${identityBroken} keeps its node`, actual: 'node replaced'
                    });
                    break;
                }
                if (moves > expectedMinimum) {
                    failures.push({
                        seed: seed + sequence, step, log: log.join(' '),
                        problem: 'minimality', expected: `<= ${expectedMinimum} moves`, actual: `${moves} moves`
                    });
                    break;
                }
                capture();
            }
            sculptor.dispose();
        }

        return { failures, totalSteps, totalMoves, totalMinimum };
    }, { seed, sequences, steps });

    console.log(`seed ${seed}, ${sequences} sequences x ${steps} steps`);
    console.log(`${report.totalSteps} reconciliations checked for order, identity, and minimal moves`);
    console.log(`${report.totalMoves} DOM moves against a theoretical minimum of ${report.totalMinimum}`);
    if (report.failures.length) {
        console.log(`\n${report.failures.length} failing sequence(s):`);
        for (let f of report.failures) {
            console.log(`  seed ${f.seed} step ${f.step} [${f.log}]`);
            console.log(`    ${f.problem}: expected ${f.expected}, got ${f.actual}`);
        }
        console.log(`\nreproduce with: SEED=${report.failures[0].seed} npm run test:fuzz`);
        process.exitCode = 1;
    } else {
        console.log('\nno counterexample found');
    }
    if (pageErrors.length) {
        console.log(`page errors: ${pageErrors.join(' | ')}`);
        process.exitCode = 1;
    }
} finally {
    await browser.close();
    server.close();
}
