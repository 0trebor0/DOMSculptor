# Framework comparison

A head-to-head measurement of DOMSculptor against React, Preact, Solid, and Vue
on the js-framework-benchmark operations, run in one page so the numbers come
from a single browser process rather than from separate runs.

This is not a substitute for the upstream benchmark. It exists so a change to
the library can be checked against other frameworks in a couple of minutes, and
so a claim made about DOMSculptor's performance can be reproduced.

## Running it

```bash
cd benchmark/compare && npm install
```

```bash
node benchmark/compare/run.mjs
```

`SAMPLES` and `WARMUP` override the defaults of 25 and 5.

## Method

- **Identical data.** Row labels come from a seeded generator, so every framework
  renders the same strings on every run.
- **Verification before timing.** Each implementation is driven through all eight
  operations and its DOM is checked against the benchmark's specification — cell
  classes, `a.lbl`, `a.remove`, ids, labels, and the result of each operation.
  A disagreement fails the run instead of producing fast numbers for a table
  that was never built.
- **Interleaved samples.** Frameworks and cases are rotated per sample rather
  than run in blocks. Running one case's samples consecutively lets JIT warm-up
  and collection timing move medians by several milliseconds between
  invocations, which is what made this project's own benchmark unreproducible
  before it was interleaved.
- **Layout is charged to the framework that caused it.** The clock stops after a
  layout property is read, so each framework pays for the layout its own DOM
  writes made necessary, not only for its script time.
- **Each framework commits before the clock stops.** DOMSculptor flushes its
  scheduler, React uses `flushSync`, Vue awaits `nextTick`, Preact renders from
  the top, and Solid is synchronous.

## What each implementation is

Each framework is written the way its own community writes this benchmark, which
is also how the upstream entries are written:

| framework | approach |
| --- | --- |
| DOMSculptor | one `signal()` of rows with a keyed `list()` |
| React | `useState` with a `memo`'d row component |
| Preact | top-level `render()` of the row list |
| Solid | `createStore` with `<For>`, updating labels in place |
| Vue | `ref` of rows with a render function |

`select-row` is the one case where the implementations differ in kind rather
than in detail. DOMSculptor and Solid change one row without re-running the list;
React, Preact, and Vue re-render and diff. Read that row of the table with the
difference in mind.
