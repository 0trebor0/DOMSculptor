import * as domsculptor from './impl-domsculptor.js';
import * as preact from './impl-preact.jsx';
import * as react from './impl-react.jsx';
import * as solid from './impl-solid.jsx';
import * as vue from './impl-vue.js';

let modules = [domsculptor, react, preact, solid, vue];

let adjectives = [
    'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint',
    'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly',
    'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'
];
let colours = [
    'red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'
];
let nouns = [
    'table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger',
    'pizza', 'mouse', 'keyboard'
];

// Every framework is handed identical rows, so label lengths and text-node churn
// cannot differ between them from one run to the next.
let seeded = seed => () => {
    seed = ((seed * 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
};
let buildData = (count, firstId) => {
    let random = seeded(count + firstId);
    let pick = list => list[Math.floor(random() * list.length)];
    return Array.from({ length: count }, (unused, offset) => ({
        id: firstId + offset,
        label: `${pick(adjectives)} ${pick(colours)} ${pick(nouns)}`
    }));
};

let data = {
    thousand: buildData(1_000, 1),
    appended: buildData(1_000, 1_001),
    tenThousand: buildData(10_000, 1)
};

let cases = [
    { name: 'create-1000', prepare: null, act: impl => impl.run(data.thousand) },
    { name: 'create-10000', prepare: null, act: impl => impl.run(data.tenThousand) },
    { name: 'append-1000', prepare: impl => impl.run(data.thousand), act: impl => impl.add(data.appended) },
    { name: 'update-every-10th', prepare: impl => impl.run(data.thousand), act: impl => impl.update() },
    { name: 'swap-rows', prepare: impl => impl.run(data.thousand), act: impl => impl.swap() },
    { name: 'select-row', prepare: impl => impl.run(data.thousand), act: impl => impl.select(500) },
    { name: 'remove-row', prepare: impl => impl.run(data.thousand), act: impl => impl.remove(500) },
    { name: 'clear-1000', prepare: impl => impl.run(data.thousand), act: impl => impl.clear() }
];

let idle = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

let measure = async (impl, act) => {
    let start = performance.now();
    await act(impl);
    // Reading a layout property inside the measurement charges each framework for
    // the layout its own DOM writes made necessary, not just for its script time.
    void document.body.offsetHeight;
    return performance.now() - start;
};

let summarize = samples => {
    let sorted = [...samples].sort((a, b) => a - b);
    let at = fraction => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
    return {
        min: Number(sorted[0].toFixed(2)),
        p25: Number(at(0.25).toFixed(2)),
        median: Number(at(0.5).toFixed(2)),
        p75: Number(at(0.75).toFixed(2)),
        max: Number(sorted[sorted.length - 1].toFixed(2)),
        samples: sorted.length
    };
};

let instances = modules.map(module => ({
    name: module.name,
    impl: module.create(document.getElementById(`tbody-${module.name.toLowerCase()}`))
}));

window.__bench = {
    frameworks: instances.map(entry => entry.name),
    // Exposed so the runner can check every implementation produces the correct
    // DOM before any of its numbers are reported.
    implementations: Object.fromEntries(instances.map(entry => [entry.name, entry.impl])),
    data,
    cases: cases.map(entry => entry.name),
    async run({ samples = 25, warmup = 5 } = {}) {
        let collected = new Map();
        for (let entry of instances) {
            for (let benchmark of cases) collected.set(`${entry.name}|${benchmark.name}`, []);
        }

        for (let sample = 0; sample < samples + warmup; sample++) {
            for (let benchmark of cases) {
                // Cases and frameworks are interleaved rather than run in blocks:
                // running one case's samples consecutively lets JIT warm-up and
                // collection timing shift the medians between invocations.
                let rotated = instances.map((unused, position) => (
                    instances[(position + sample) % instances.length]
                ));
                for (let entry of rotated) {
                    if (benchmark.prepare) await benchmark.prepare(entry.impl);
                    await idle();
                    let duration = await measure(entry.impl, benchmark.act);
                    await entry.impl.clear();
                    if (sample >= warmup) collected.get(`${entry.name}|${benchmark.name}`).push(duration);
                    await idle();
                }
            }
        }

        let results = {};
        for (let benchmark of cases) {
            results[benchmark.name] = {};
            for (let entry of instances) {
                results[benchmark.name][entry.name] = summarize(collected.get(`${entry.name}|${benchmark.name}`));
            }
        }
        return results;
    }
};
