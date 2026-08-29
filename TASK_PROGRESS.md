# TASK_PROGRESS

## Objective

Close the gap between DOMSculptor and mainstream front-end libraries, working
through a prioritised plan. Phase 1 (API audit) is complete; phase 2 (roadmap)
is in progress.

## The plan

Ordered by adoption impact. Tiers 1 and 2 are the technical blockers; tier 3 is
credibility work that is mostly not code.

**Tier 1 — decides whether a developer stays past the first hour**

1. **Automatic dependency tracking for `computed()` and `effect()`** — DONE.
   Removes the manual dependency array, the library's closest analogue to the
   React `useEffect` deps footgun.
2. **Make disposal the default rather than a discipline** — DONE.

**Tier 2 — "can I build a real app with this"**

3. **Routing** -- DONE (as a class method; see the architecture note below).
4. **Virtualization** -- DONE (version one, minus focus retention).

**Architecture note.** Both were planned as subpath entries "to protect the size
budget". That is not how this project is built: `test/package.test.mjs` asserts
`src/` contains only `index.js`, the virtualization plan required all runtime
code to live there, and the `/testing` and `/lazy` subpaths are type-only facades
whose `import` condition resolves to `src/index.js`. A subpath entry therefore
ships in the core bundle regardless, so both features were added as
`DomSculptor` methods alongside `when()` and `component()`.

**Tier 3 — credibility**

5. Declaration drift guard -- DONE.
6. Publish results on js-framework-benchmark against React, Preact, Solid, Vue.
   The measurable half is DONE: the benchmark entry exists and is verified, and a
   local head-to-head comparison against all four frameworks runs in this
   repository. Submitting the entry upstream remains, and is a pull request to
   someone else's repository rather than code here.
7. Build the RealWorld reference app to surface ergonomic friction -- DONE.
8. Fill `docs-site/`. **Withdrawn - the premise was wrong.** No `docs-site/`
   directory exists; `docs/` holds `index`, `api`, `examples`, `recipes`,
   `large-projects`, and `releasing`, about 54 KB in total, and
   `test/docs.test.mjs` checks it against the runtime.

**Explicitly out of scope:** SSR/hydration (largest effort, competes with
Next.js on its strongest ground) and a component library (follows adoption
rather than causing it).

## Status

**Every planned item is done**, along with everything the plan deferred and
everything the work itself uncovered. Tiers 1 and 2 complete, including the two
virtualization items the plan had left outstanding, so `VIRTUALIZATION_PLAN.md`
has been deleted. Tier 3 item 5 complete; item 6's measurement work complete and
it produced a real performance fix; item 7 complete and it found two defects;
item 8 withdrawn as based on a false premise.

The deferred items in the risks section below are now closed too: the
asynchronous-read limitation is documented, and the `when()` ownership entry is
released.

One thing remains and it is not code in this repository: **submitting the
js-framework-benchmark entry upstream**, which is a pull request to someone
else's project. The version is at 3.0.0 and the release is unpublished; both are
maintainer decisions rather than work items.

## Phase 1 summary (completed earlier)

Exhaustive probe of the public API in real Chromium found four issues, all
resolved: store `has`/`delete`/`signal(key)` documented and typed but missing
from the runtime (implemented); a typed `transform` parameter silently ignored
and a typed `previous` subscriber argument never supplied (both corrected in
`types/index.d.ts`); and inconsistent disposed-element guards (fixed on `on`,
`once`, `getValue`, `setValue`, `hide`, `show`). 14 tests added, 87 → 101.

## Tier 1 item 1 — automatic dependency tracking

**What changed in `src/index.js`:**

- New module-level `activeTracker` plus a `createTrackedRun()` helper that runs
  a computation with a collector installed, then diffs the signals it read
  against its current subscriptions — unsubscribing from signals no longer read
  and subscribing to newly read ones.
- `signal()`/`state()`'s `get()` registers itself with the active tracker.
- `computed(compute, dependencies = null)` and `effect(run, dependencies = null)`:
  the default changed from `[]` to `null`. `null`/omitted tracks automatically;
  an array pins dependencies exactly as before; `[]` evaluates once.
- Both dispose paths call `tracked.stop()`, so discovered subscriptions are
  released with the computed value or effect.

**Behaviour change (recorded in `CHANGELOG.md` under Changed):**
`computed(fn)` and `effect(fn)` without a list previously never re-ran. They now
track their reads. Calls passing a list are unaffected; `[]` preserves the old
evaluate-once behaviour.

**Design notes:**

- Re-subscription happens per run, not once, so conditional branches release
  dependencies they stop reading. This is the property that makes tracking
  correct rather than merely convenient, and it is directly tested.
- Nested computed values compose because an inner computed's backing state is
  itself a signal, so reading it registers with the outer tracker.
- The existing `evaluating` cycle guard still fires before any subscription is
  made, so `computed(() => self.get())` still throws "cycle detected".
- Signals read through `store.get(key)` are tracked too, since stores are built
  from one signal per key.

**Tests added** (7 new, 101 → 108, all in `test/index.test.mjs`):

- computed tracks reads with no dependency list
- automatic tracking drops dependencies a branch no longer reads
- tracked computed values compose through other computed values
- effects track their reads and rerun through the scheduler
- an explicit empty dependency list opts out of tracking
- tracking observes store keys, and invalid dependency lists still throw
- disposing a tracked computed or effect releases every discovered subscription
  (verified through `createDevSculptor`, asserting no `subscription-cleanup`
  warning)

`test/browser.html` also gained real-DOM coverage of tracking, branch switching,
abandoned dependencies, and tracked effects.

**Documentation updated:** `README.md` (computed and effects sections rewritten;
they previously stated the opposite) and `docs/api.html` entries for
`computed`/`effect`.

## Verification

- `npm run lint` — passed
- `npm test` — `# tests 108 # pass 108 # fail 0`. All 101 pre-existing tests
  passed unchanged before any new test was added, confirming explicit
  dependency lists still behave identically.
- `npm run test:types` — passed (`tsc --noEmit`); the declared signatures
  already had `dependencies` optional, so no type change was required
- `npm run build` — passed
- `npm run size` — **10153 / 10088 bytes gzipped (budget 10240)**. Auto-tracking
  cost 119 gzipped bytes, so no budget increase was needed.
- `npm run test:package` — passed
- `npm run check` — full gate passed end to end
- `npm run test:browser` — chromium 86, firefox 85, webkit 85 assertions passed
- `npm run benchmark` — no regression. `get()` gained one optional call on the
  hottest path; every median moved within previously measured variance
  (keyed-list-create-1000 1.4→1.5ms, append-one 3.2→3.0ms, remove-middle
  6.2→5.5ms, swap-two 3.6→4.0ms) and both signal-update benchmarks stayed at
  0.1ms. Forced-GC heap delta 32,516 bytes vs 28,328 over 5,000 cycles, within
  the run-to-run variance the benchmark documents.

## Tier 1 item 2 — runtime ownership and disposal

**Root cause found:** `DomSculptor._track()` was `this._activeScope?.track(cleanup)`
— a **no-op whenever no scope was active**. Every signal, computed value,
effect, store, and element created outside `scope.run()` or a `component()` had
no owner at all, which is exactly why disposal was a manual discipline.

**What changed in `src/index.js`:**

- Each sculptor constructs a `_rootScope`. `_track()` now falls back to it, so
  nothing created through a runtime is ownerless, and it returns an untrack
  handle.
- New `DomSculptor.dispose()` and `disposed` getter. Disposal clears scheduled
  jobs and disposes the root scope; it is idempotent.
- `DisposalScope._cleanups` changed from an array to a `Set`, with a private
  `_untrack()`. This is what lets an individually disposed resource release its
  own entry instead of leaving a dead closure behind.
- `signal()`, `computed()`, `effect()`, and `data()` capture their untrack
  handle and call it from their own `dispose()`/`stop()`.
- `DomElement` gained `_untrackers` and a `_own()` helper; element creation,
  listeners (`on`, `once`, delegated), reactive bindings, and form-binding
  auto-unsubscribes all register through it, and `dispose()` releases them.

**Deliberate design decision — borrowed nodes are not deleted.** Tracking every
element at construction would have been simpler and smaller, but
`sculptor.dispose()` would then remove nodes taken over with `wrap()`/`adopt()`
from the document — deleting markup the runtime never created. Ownership is
therefore registered at `createDetached()` for created elements, while wrapped
elements only register their listeners and bindings. Covered by a test in both
Node and the browser matrix.

**Tests added** (4 new, 108 → 112):

- the runtime owns resources created without an explicit scope
- runtime disposal cleans listeners on wrapped nodes without removing them
- an explicit scope takes ownership away from the runtime
- individually disposed resources release their runtime ownership entry —
  churns 500 create/dispose cycles and asserts the root scope's cleanup count
  returns to its baseline, proving no unbounded growth

`test/browser.html` gained equivalent real-DOM coverage, including the
adopted-node case.

**Docs:** `README.md` (five-minute example now ends in `sculptor.dispose()`,
plus a runtime-ownership section), `docs/api.html` (new "Runtime disposal"
section), `types/index.d.ts` (`dispose()`, `disposed`), `CHANGELOG.md`.

## Tier 2 item 3 — routing

`router(routes, options?)` added to `DomSculptor`, mounting one matching route at
a time and disposing the previous view on every change.

- Patterns compile to anchored regular expressions supporting `:name` segments
  and a `*` catch-all; literal segments are escaped. `new RegExp` keeps the
  strict-CSP guarantee `test/security.test.mjs` enforces.
- Views are any function returning a `DomElement` or a component instance, so
  `sculptor.component()` factories work directly and receive the matched
  `{ path, route, params }` snapshot as props.
- `current` is a signal, so titles and navigation state bind to it normally.
- `navigate()` / `replace()` wrap `pushState` / `replaceState`; back and forward
  arrive through `popstate`. `{ hash: true }` routes on the fragment instead,
  for static hosting and extensions that cannot rewrite server paths.
- The router registers with the owning scope, so `sculptor.dispose()` stops it,
  removes its listener, and disposes the mounted view. `stop()` is idempotent.

**Tests added** (5 new, 112 → 117). The Node harness has no History API, so the
tests install a minimal `window`/`location`/`history` fake and restore the
globals afterwards; `test/browser.html` covers the same behaviour against the
real History API including `history.back()`.

**Cost:** 619 gzipped bytes.

## Tier 2 item 4 — virtualization

Implemented version one of the virtualization plan: `virtualList()`,
`updateVirtualList()`, `scrollVirtualList()`, `virtualListStatus()`, and
`disposeVirtualList()`, following the API and internal-state shape the plan
prescribes rather than inventing a different one.

- Spacer of full collection height with an absolutely positioned content layer
  translated to the start index; only the visible range plus overscan is mounted.
- Scroll and resize collapse into one pass per animation frame. `ResizeObserver`
  is used when available with a `window` resize fallback.
- Optional keys give stable identity and reuse; duplicates are rejected before
  any DOM mutation, on both creation and update.
- Rows may be a `DomElement` or a reusable `{ root, update?, dispose? }` object.
- `updateVirtualList()` revalidates and copies the collection, resizes the
  spacer, and clamps a scroll position left past the new end.
- `scrollVirtualList()` handles index or `{ key }` with `start`/`center`/`end`/
  `nearest` alignment, returning `false` for unreachable targets.
- `virtualListStatus()` returns a frozen `{ rendering, start, end, mounted, total }`.
- `rendering` is now computed by a single `_updateRenderingStatus()` path shared
  with progressive creation, as the plan requires, so neither system can clear
  the other's status.
- Both disposal paths are idempotent; explicit disposal retains the container,
  and the container can then be virtualized again.

**Error handling.** My first implementation disposed departed rows before
creating new ones, so a failing `render()` left the row mapping short — which
the plan's error-handling section forbids. A test caught it. Rows are now built
first, with rows added during a failed pass rolled back, so the previously valid
mapping survives and a later update can retry.

**Both remaining version-one items are now done** (see the section below);
at the time of this entry they were outstanding and recorded rather than dropped
silently.

**Tests added** (11 new, 117 → 128), covering the plan's unit-test list: 9,000
records mounting under 60 rows, spacer height, initial range, overscan clamping
at both boundaries, scroll updating the range, rapid scrolls collapsing to one
pass, row reuse without losing configuration, events seeing current data,
duplicate keys failing before DOM mutation on create and update, collection
refresh resizing the spacer, shrink clamping scroll, scroll-to-index and
scroll-to-key including boundaries and alignment, empty collections, argument
validation, one list per container, container disposal, explicit disposal
retaining the container, repeatable disposal, render errors restoring status,
isolation across containers and runtimes, and accessibility metadata.

`test/browser.html` adds real-layout coverage: 9,000 rows through a 600px
viewport, real `scrollTop` scrolling, rapid scrolling settling on the final
position, scroll-to-index and scroll-to-key, collection shrink, and disposal.

**Cost:** roughly 1,480 gzipped bytes.

## Tier 3 item 5 — declaration drift guard

Added `every member declared in the published types exists at runtime` to
`test/index.test.mjs`. It scans `types/index.d.ts` line by line, collects the
members declared on each interface and class, and asserts each one exists on a
real runtime value for `DomSculptor`, `DomElement`, `DomAttributes`,
`DomClasses`, `DomChildren`, `DisposalScope`, `Context`, `ComponentInstance`,
`State`, `Computed`, `AsyncState`, `DataStore`, `VirtualListStatus`,
`DevDomSculptor`, and `Router`.

This is the guard that would have caught all three declaration-drift findings
from phase 1. **Verified against injected drift** rather than trusted because it
passes: adding a fake `neverImplemented()` member to `DisposalScope` made the
test fail with `DisposalScope.neverImplemented`, and removing it returned the
suite to green.

A first attempt extracted blocks with a regex built inside a template literal;
escaping through that layer silently turned `\\w` into `w`, so the pattern
matched `DomSculptorOptions` when it was asked for `DomSculptor`. Replaced with
a plain line scan, which is both correct and easier to read.

## Tier 3 item 6 prerequisite — benchmark measurement

`benchmark/run.mjs` ran each case's 25 samples consecutively, so JIT warm-up and
garbage-collection timing shifted medians by several milliseconds between
invocations. That is what produced the false `append-one` regression earlier in
this session. Cases are now interleaved round-robin with five warm-up rounds
discarded.

Repeat runs now agree closely, where the same figures previously swung between
3.0ms and 6.0ms:

| case | run 1 | run 2 |
| --- | --- | --- |
| keyed-list-create-1000 | 1.0 | 1.0 |
| append-one | 2.8 | 2.8 |
| prepend-one | 2.7 | 2.8 |
| remove-middle | 2.7 | 2.8 |
| swap-two | 3.8 | 3.8 |

This was a prerequisite for publishing comparisons against React, Preact, Solid,
and Vue: the numbers had to be reproducible before they could be compared with
anyone else's. `runCreate()` (the two create-100 cases) still runs its samples
consecutively and was left alone, since those cases are frame-bound rather than
CPU-bound.

## Tier 3 item 6 - framework comparison

Two things were built, both under `benchmark/`.

**`js-framework-benchmark/`** is the keyed entry, in the layout the upstream
repository expects: `index.html` with the six control buttons and `#tbody`,
`src/main.js`, a webpack config, and a `package.json` declaring `build-prod`.
`benchmark/jsfb-verify.mjs` builds it against the working tree rather than the
published package, serves it, and drives every button plus selection and removal
in headless Chromium - 20 assertions covering the row markup, the class names the
harness's CSS selectors depend on, and the outcome of each operation. Copying the
directory into `frameworks/keyed/domsculptor` and opening the pull request is
what remains, and is the user's call.

**`compare/`** is a head-to-head harness running DOMSculptor, React, Preact,
Solid, and Vue in one page, so the numbers come from one browser process instead
of five separate runs. Its dependencies live in its own `package.json`, so the
library's own dev dependencies stay as they were. Method:

- Labels come from a seeded generator, so every framework renders identical
  strings on every run.
- **Every implementation is verified before anything is timed.** Each is driven
  through all eight operations and its DOM checked against the specification. A
  disagreement fails the run rather than producing fast numbers for a table that
  was never built correctly.
- Frameworks and cases are interleaved per sample, applying the same lesson that
  fixed this project's own benchmark: running a case's samples consecutively lets
  warm-up and collection timing move medians by milliseconds between invocations.
- The clock stops after a layout property is read, so each framework pays for the
  layout its own writes made necessary.
- Each framework commits before the clock stops: DOMSculptor flushes its
  scheduler, React uses `flushSync`, Vue awaits `nextTick`, Preact renders from
  the top, Solid is synchronous.

Each framework is written the way its own community writes this benchmark:
DOMSculptor a keyed `list()`, React `useState` with a `memo`'d row, Preact a
top-level `render()`, Solid `createStore` with `<For>` updating labels in place,
Vue a `ref` with a render function.

### What it found

The first run showed two cases where DOMSculptor was far off the field:
`swap-rows` at 32.4 ms against Solid's 3.7 ms, and `clear-1000` at 13.6 ms
against 3.2 ms. Both were real, and both were in the keyed list path.

**Quadratic ownership bookkeeping.** `_detachFromParent()` rebuilds its parent's
child array with `filter`, and the keyed render called it once per row while also
calling `_notifyMount()` on every row and its four cells. On a thousand-row list
that is a million comparisons and a thousand array allocations per pass, and the
result was discarded a moment later because the render assigns
`container._children` wholesale anyway. The container's child list is now emptied
once before the pass, and a row the container already owns and has already
mounted is skipped.

**Placement by index.** Each row was inserted before
`container.html.childNodes[index]`. That is correct but it is not minimal:
swapping rows 1 and 998 moves row 998 into place and then pushes row 1 down past
every row between them - 998 DOM moves for a two-row swap. Rows whose relative
order has not changed form a longest increasing subsequence of their previous
positions; keeping those in place and re-inserting only the rest is the minimum.
`longestIncreasingRun()` computes it, and placement runs right to left so the
node each row is inserted before is already final.

Neither change alters observable behaviour, and both are covered by a new test
that counts `insertBefore` calls: a two-row swap costs 2 moves, restoring the
order costs 2, appending two rows costs 2, removing a middle row costs 0, and
prepending costs 1. Before the change the swap cost 9 moves on a ten-row list and
would have cost 998 on a thousand-row one.

### Results

Medians of 25 samples after 5 warm-up rounds, headless Chromium, two runs
agreeing to within a few tenths except `create-10000`, which varies by about 8%
run to run:

| case | DOMSculptor | React | Preact | Solid | Vue |
| --- | ---: | ---: | ---: | ---: | ---: |
| create-1000 | 33.4 | 32.3 | 34.6 | 27.2 | 29.9 |
| create-10000 | 443.2 | 503.3 | 366.9 | 309.7 | 335.7 |
| append-1000 | 41.3 | 37.6 | 42.0 | 32.4 | 36.8 |
| update-every-10th | 7.3 | 7.7 | 11.8 | 7.7 | 10.1 |
| swap-rows | 2.6 | 29.2 | 5.9 | 3.4 | 5.7 |
| select-row | 0.0 | 0.6 | 3.9 | 0.7 | 3.2 |
| remove-row | 2.5 | 2.6 | 6.4 | 3.2 | 5.6 |
| clear-1000 | 11.3 | 5.4 | 3.6 | 3.1 | 4.1 |

Reading it honestly: DOMSculptor is now competitive on every case except
`clear-1000`, where it is roughly three times slower than the others, and it is
mid-field rather than leading on the create and append cases, where Solid is
consistently fastest. `select-row` is not like-for-like - DOMSculptor and Solid
change one row without re-running the list, while React, Preact, and Vue
re-render and diff - and the table should not be published without that caveat.

These are this harness's numbers, not the upstream benchmark's, and should be
described that way. The upstream figures are the ones worth publishing, and they
require the pull request.

### Effect on the project's own benchmark

The same fixes moved every list case in `npm run benchmark`:

| case | before | after |
| --- | ---: | ---: |
| append-one | 2.8 | 1.2 |
| prepend-one | 2.7 | 1.2 |
| remove-middle | 2.7 | 1.1 |
| swap-two | 3.8 | 1.1 |

**Cost:** 191 gzipped bytes, 12377 to 12568 against the 13312 budget. No budget
change was needed.

### Verification

- `npm run check` - passed. `# tests 130 # pass 130 # fail 0`; the 129
  pre-existing tests passed unchanged before the move-count test was added.
- `npm run test:browser` - chromium 124, firefox 123, webkit 123 assertions
  passed.
- `node benchmark/jsfb-verify.mjs` - 20 checks passed against the real DOM.
- `node benchmark/compare/run.mjs` - all five implementations verified, run
  twice with agreeing medians.
- `npm run benchmark` - every list case improved; nothing regressed.
- `npm pack --dry-run` - 25 files, 90.9 kB. `benchmark/compare` and the built
  bundles are excluded through negated entries in `files`, because a root
  `.npmignore` is not consulted once `files` is present. Without that the tarball
  was 12.6 MB and 5,808 files.

## Follow-up from item 6 - the two gaps it left

### The convenience exports did not track

`computed` and `effect` exist twice: as `DomSculptor` methods and as standalone
exports bound to a shared default runtime. Tier 1 item 1 changed the methods'
default from `[]` to `null`, but the two wrappers at the bottom of `src/index.js`
kept `[]`. So `import { computed } from 'domsculptor'` returned a value that
never re-ran, which is the opposite of what `README.md`, `docs/api.html`, and the
changelog entry all describe. No other wrapper had drifted.

Both defaults are now `null`. A test exercises the standalone exports directly -
the existing tracking tests all went through an instance, which is why this
survived - and it was **verified against the bug**: restoring `[]` makes it fail,
and putting `null` back returns the suite to green.

### Disposal was removing nodes one at a time, on the document

CPU-profiling a thousand-row clear through the Chrome DevTools Protocol
attributed the cost, rather than leaving it to guesswork: `removeChild` 12.7%,
`_cleanupKnownNode` 11.9%, `dispose` 8.6%, `_clearChildren` 7.3%.

`dispose()` removed its own node from the document **last**, after
`_clearChildren()` had already disposed the whole subtree. Every one of the eight
thousand descendants therefore removed itself from a still-attached tree, paying
the engine's layout and style invalidation each time, and then the ancestor was
removed anyway. Detaching the node first makes all of that work happen off the
document. `_cleanupKnownNode` also called `Array.from(node.childNodes)` on text
nodes, which are the common case and have no children to walk; it now returns
early.

Clearing a thousand rows of eight elements went from 14.4 ms to 9.0 ms in
isolation, and `clear-1000` in the comparison from 11.3 ms to 9.5 ms.
`_cleanupKnownNode` left the profile entirely. Cost: 4 gzipped bytes.

**This changes observable behaviour**, so it is recorded under Changed and
pinned by a test: `onRemove` and `onDispose` hooks now see a node whose
`parentNode` is `null`, where they previously saw it still attached. Hook order
is unchanged - deepest descendant first.

### Where the project's own benchmark ended up

Both changes together, against the medians recorded before this session:

| case | before | after |
| --- | ---: | ---: |
| append-one | 2.8 | 0.7 |
| prepend-one | 2.7 | 0.8 |
| remove-middle | 2.7 | 0.8 |
| swap-two | 3.8 | 0.7 |
| update-every-tenth | - | 0.8 |
| clear-all | - | 0.6 |

### What is left in `clear-1000`

9.5 ms against Solid's 3.3 ms. The remainder is not a defect to fix but the
shape of the library: disposing a row disposes eight `DomElement` wrappers, and
each releases an ownership entry from its scope's `Set`, an entry from the
runtime's element `Map`, an entry from the static owner `WeakMap`, its listener
record, and its dispose callbacks. Solid and Preact create no wrapper object per
element and so have nothing to release. Closing the rest of that gap means
changing what a `DomElement` costs, not tuning the disposal path, and that is a
larger decision than this work should make on its own.

## Tier 3 item 7 - the RealWorld app

`example/realworld` is a complete Conduit client: both feeds, tag filtering,
pagination, articles with comments, favouriting, following, profiles, the
editor, and settings. 1,438 lines across 10 modules, no build step - the page
loads ES modules and imports `src/index.js` directly, so what runs is the
library source. `example/realworld/verify.mjs` runs 25 checks in headless
Chromium against the live API.

It targets `https://api.realworld.show/api`; `api.realworld.io` was returning
HTTP 530. Only unauthenticated flows are verified automatically: signing up and
publishing write to a shared public service, so those paths are implemented and
left for a person to run.

### It found two defects, not just friction

**Every route change leaked.** A router view that returns a plain element had no
scope, so its signals, computed values, and effects were owned by the runtime
root scope, which nothing releases. Sign-in to sign-up and back added four
permanent entries per round trip: `82 -> 86 -> 90 -> 94 -> 98 -> 102`, against a
flat `84` after the fix. `router()` now runs each view in its own scope.

The unit tests could not have caught this as written, and the reason is worth
recording: route changes are scheduled, so forty synchronous navigations coalesce
into one render and create one view. My first regression test passed against the
unfixed library for exactly that reason. It now flushes between navigations, and
fails when the fix is reverted.

**Async state announced its own disposal.** `asyncState`'s cleanup called
`cancel()`, which writes a final snapshot; that notifies subscribers, and during
scope disposal those subscribers render into elements the same disposal has
already removed, which throws. Every navigation away from a page with a request
in flight produced an `AggregateError`. Disposal now aborts without writing.

Note the order: this was only reachable once views had scopes. The first fix
exposed the second.

Both fixes are covered by tests **verified against the bug** - reverting either
fix fails its test. Cost: 24 gzipped bytes.

### Friction it did not fix

Recorded in full in `example/realworld/README.md`, with counts over the app:

1. `tree()` cannot name a node, so 25 `child.find()` calls address nodes by CSS
   selector. This caused a real bug - a selector matched the wrong column - whose
   fix was to invent a class that exists only for wiring. A `ref` key would remove
   the category.
2. `tree()` cannot express a reactive list, so every view splits into a
   declarative shell and an imperative fill.
3. `text:` accepts a signal but `class:` and `attributes:` do not, so all 13
   reactive class and attribute bindings sit outside the declarative block.
4. `classToggle()` takes one class, so an either/or pair costs two computed
   values and a duplicated negation. Ten of them here.
5. `child.append()` returns the parent, so depth outside `tree()` needs a
   temporary per level.
6. `asyncState.run()` both rejects and records, so four `.catch(() => {})` calls
   exist only for silence.
7. A bare `signal.subscribe()` is owned by nothing, unlike element bindings. I
   leaked one inside a re-render and had to restructure the view. **After the
   tier 1 item 2 ownership work, this is the one place where disposal is still a
   discipline rather than a default**, and it is the finding most worth acting on.
   Fixed; see the section below.
8. There is no way to ask whether the current scope is alive, so five async
   continuations guard on `root.html` instead.

## Acting on what the RealWorld app found

Seven of the eight friction points are now fixed in the library, and the example
was rewritten onto the new APIs to prove it rather than to assert it.

### What changed

- **Subscriptions have an owner.** `signal.subscribe()` inside a scope registers
  its unsubscribe with that scope. This was the finding most worth acting on: it
  was the last place where disposal was a discipline rather than a default.
  Outside a scope nothing changes.
- **`tree()` names nodes.** A `refs` object at the root and `ref` on any node.
- **`tree()` takes reactive attributes, classes, and children.** Attribute values
  may be signals; `class` accepts a map of names to signals or booleans;
  `children` accepts `{ each, key?, render, update? }`.
- **`classToggle()` accepts a map** and plain booleans.
- **Route views receive their scope** on the snapshot, so an asynchronous
  continuation can check `scope.disposed`.

### Measured on the example, before and after

| | before | after |
| --- | ---: | ---: |
| `child.find()` calls | 25 | 0 |
| post-hoc `.classToggle()` / `.attr()` | 13 | 0 |
| `classToggle()` calls | 10 | 0 |
| element liveness guards | 5 | 0 |

Getting the last of each to zero took two more changes rather than more API.

**A signal per row beats an `update`.** The two surviving `child.find()` calls
were both inside a keyed list's `update`, re-applying an active class to reused
rows. Giving each tab its own `active` signal makes the class a binding, so reuse
cannot make it stale and no `update` is needed. That is the idiom worth teaching:
`update` is for content that genuinely differs per item, not for state that has a
signal.

**Teardown order, made a guarantee.** The three remaining guards were on
subscription callbacks, not async continuations. `router()` now disposes the
view's scope *before* its elements; a scope disposes in reverse order of
creation, so a subscription made after the element it writes into is released
before that element is torn down. Tearing elements down first left live
subscriptions pointing at disposed elements for the length of the teardown -
the same shape as the `asyncState` failure. Pinned by a test that fails when the
order is swapped back.

Line count went from 1,438 to 1,492: declarative configuration is slightly longer
than the imperative appends it replaced, and all the wiring is gone.

### The last two, done on request

Both were left alone at first because they are breaking changes to documented
behaviour. Asked to fix everything, both are now done, and the package needs a
major version as a result.

- **`child.append()` and `prepend()` return the element that was added.** A
  structure can now be built downwards without a temporary per level. A raw node
  or string still returns the container, because there is no wrapper to return.
  Only two call sites in the whole repository chained on the old return value out
  of 93, and both were clearer rewritten.
- **`asyncState.run()` and `retry()` resolve with the snapshot and never reject.**
  The snapshot is what callers render, so the rejection was redundant with it.
  The three `.catch(() => {})` calls in the example are gone; the fourth was a
  plain `fetch` guard and stays.

Every documentation site that taught the old contracts was updated - `README.md`,
`docs/api.html`, `docs/index.html`, `docs/recipes.html`, `docs/examples.html` -
and `docs/index.html` gained a "Coming from 2.0" migration list covering these
two plus the dependency-less `computed`/`effect` change and the dispose-hook
timing change from earlier in this session.

**The version was not bumped.** Releasing is a separate decision;
`test/package.test.mjs` still pins 2.0.0, and the changelog now says plainly that
this needs a major version.

### What was not fixed, and why (superseded)

The reasoning that kept these two out at first:

- **`child.append()` returns the parent.** Changing it would break every chained
  call in every program using the library, to trade one inconvenience for
  another. Left alone deliberately.
- **`asyncState.run()` both rejects and records.** Four `.catch(() => {})` calls
  remain. The rejection is documented behaviour that callers awaiting `run()`
  depend on; removing it is a breaking change and the redundancy only shows up
  when the snapshot is what renders.

### Cost and verification

252 gzipped bytes, 12596 to 12848 against the 13312 budget. `npm run check`
passes at 142 tests, the browser matrix at 124/123/123, both benchmark harnesses
show no regression, and the example's 25 checks pass against the live API after
the rewrite.

## clear-1000, on the second attempt

The first attempt guessed at allocations and moved nothing. The second profiled
the clear **on its own** - starting and stopping the CPU profiler around each
clear, with the fill outside the window - and the answer was immediate:

```
  31.8%  removeChild
  20.8%  (program)
  10.8%  _clearChildren
  10.0%  dispose
   9.6%  (garbage collector)
```

`removeChild` at 31.8%, not allocation. Disposing a thousand benchmark rows
detaches about eight thousand nodes one at a time, when only the thousand row
roots ever needed detaching: everything below a removed node goes with it.

**What changed.** `dispose()` and `_clearChildren()` take a private `discard`
flag meaning "an ancestor has already been detached and is being thrown away, so
this node needs no removal of its own". A top-level `dispose()` removes its own
node and then discards its subtree.

The first cut of this made things *worse* - 10.9 ms to 13.3 ms - because the
discard path walked the child nodes after the `_children` loop had already
disposed them, so every span was visited twice and the second visit allocated an
array to recurse into its text node. `_cleanupKnownNode` went to 23.5% of the
profile. Rewritten as a single sibling walk that both disposes wrappers and
reaches wrappers nested inside unknown nodes, it went to 8.0 ms.

**One special case on top.** When a keyed list loses every row and the container
holds nothing else, the rows leave the DOM in one `textContent` write instead of
a thousand removals. This helps a full clear only, which is worth saying plainly:
it is a common app operation - a route change, a filter reset - but it is also
exactly what the benchmark measures.

| | before | after |
| --- | ---: | ---: |
| clear-1000 (comparison) | 9.6 ms | 7.1 ms |
| clear of 1,000 x 8 (isolated) | 10.9 ms | 7.7 ms |
| clear-all (own benchmark) | 0.6 ms | 0.4 ms |

Across the whole session `clear-1000` went from 13.6 ms to 7.1 ms. Cost: 104
gzipped bytes, 12845 to 12949 against the 13312 budget. Forced-GC heap delta over
5,000 cycles fell from 34,732 to 23,904 bytes.

**It changes observable behaviour**, so it is recorded under Changed and pinned
by the existing disposal test, rewritten: a dispose hook now runs with the whole
subtree out of the document, but only the element disposal started at has a
`null` `parentNode`. A descendant still points at its parent, because it is
discarded rather than removed.

**Still 2.2x Solid**, and the remaining profile says why: `dispose` self time and
collection. That is the per-element cost of a `DomElement` wrapper - a scope
`Set` entry, a runtime `Map` entry, a static `WeakMap` entry, a listener record,
dispose callbacks - which Solid and Preact do not pay because they allocate no
wrapper per element. Closing that means redesigning the library's central
abstraction, not tuning this path.

## Full audit of every public method and function

`npm run test:api` (`test/api-audit.mjs`) exercises the whole surface in real
Chromium: 35 probes over **158 public members**, all of them. It ends by
enumerating what is reachable and failing on anything no probe touched, so a
member added later cannot go unexercised silently.

What it covers: the 20 module exports and the shared default runtime; all 35
`DomSculptor` methods including the router and the five virtual-list functions;
all 32 `DomElement` methods and the `attribute`, `class`, and `child` namespaces;
all 17 signal bindings; `Computed`, `AsyncState`, `DataStore`, `DisposalScope`,
`Context`, and `ComponentInstance`; the development runtime, the test harness,
and lazy components. Plus five probes that are not about the happy path:
argument validation across 18 entry points, cycle detection, that disposed
elements, signals, stores, and scopes refuse work rather than dereferencing null,
that a keyed list rejects duplicate keys without touching the DOM, and that no
API parses markup out of a string.

**No defects found.** Every member behaves as its type declaration and the
documentation say it does.

The audit failed four times while being written, and all four were the probe
misreading the API, which is the more interesting result:

| I assumed | It actually does | Verdict |
| --- | --- | --- |
| `tryMount` returns `false` on failure | returns `null`, exactly as `types/index.d.ts` declares | probe wrong |
| `bindValue` is two-way | one-way; `sync()` is the two-way binding, and the README says so | probe wrong |
| `store.update(fn)` takes a whole-store updater | takes `(key, updater)`, as declared | probe wrong |
| the test harness has `cleanup()` | has `dispose()`, plus `assertClean()` and `warnings` | probe wrong |

Four chances for the runtime to disagree with its own declarations, and it
disagreed none of them. That is what the tier 3 item 5 drift guard is for, and
this is independent evidence it is holding.

**One real finding, and it was not a documentation gap after all.**
`bindVisible()` and `bindHidden()` had the same signature and the same declared
type but different mechanisms: `bindVisible()` toggled inline `display` through
`show()`/`hide()`, while `bindHidden()` set the native `hidden` property. Nothing
in `README.md` or `docs/api.html` said so, and a reader picking between them by
name had no way to know.

Documenting it was the first response, and the wrong one: two bindings that look
like a pair, are typed like a pair, and are named like a pair should behave like
a pair. `bindHidden()` is now the exact mirror of `bindVisible()`, through the
same `show()`/`hide()` path, restoring the element's previous display value and
differing only in which way round the signal reads. `bindProperty(element,
'hidden')` still reaches the native property for anyone who wants it, which is
what `bindHidden()` was delegating to anyway.

This is a breaking change and is recorded as one, with a migration note.

## Virtualization, finished

The two items the plan's Status section listed as outstanding from version-one
scope are done, and `VIRTUALIZATION_PLAN.md` has been deleted: nothing in it is
unimplemented any more, and the behaviour it specified now lives in `README.md`,
`docs/api.html`, the tests, and the demonstration page.

### Focus behaviour

The plan required five things: keep a focused row mounted outside the visible
range, do not reuse a focused row for a different item, release it once focus
moves, restore focus after a keyed refresh when the key survives, and preserve
input selection where practical. The point of all five is one sentence in the
plan: *"This prevents scrolling from removing an input while a user is typing."*

What `apply()` does now:

- Before recomputing the range it finds which mounted row, if any, contains the
  document's active element, and captures that element's selection.
- If that row falls outside the new range it is added back to the needed set and
  marked **floating**: positioned absolutely at its true offset instead of taking
  a slot in the row flow, so the visible rows stay contiguous. Searching the
  collection for its index only happens while a focused row is actually
  off-range.
- A floating row that comes back into range has its positioning cleared and
  rejoins the flow.
- Focus and selection are restored after the reorder, because moving a node
  between parents drops focus in some engines.
- A `focusout` listener schedules a pass, so the retained row is released
  promptly rather than waiting for the next scroll.

**The browser test caught a defect the plan had anticipated.** With the row
retained and focused, `update()` still ran on it every pass, so the app's own
updater overwrote what had been typed — on every scroll frame. That is the plan's
"do not reuse a focused row for a different item" requirement, and the fix is
that a row holding focus is not updated at all; the pass after focus leaves
updates it. A test asserts the other rows still refresh meanwhile, so this did
not turn into "focus freezes the list".

This is real-browser behaviour and cannot be unit-tested against the Node fake
DOM, which has no `activeElement`, no `Node.contains`, and no `focus()`. The
implementation degrades to the previous behaviour there rather than throwing.
`test/browser.html` covers it in all three engines: focus an input, type, scroll
1,500 rows away, and assert the row is still mounted, still focused, still holds
its text and selection, that the scrolled range rendered, that a keyed refresh
keeps focus while other rows update, and that the row is released once focus
moves out. Browser assertions went from 125/124/124 to 139/138/138.

### Demonstration page

`test/virtual-9000.html`, built with the library itself. It shows total records,
mounted rows, visible start and end, scroll position, rendering status and
initial render time, with refresh, jump-to-index, and dispose/recreate controls,
which is the plan's list. Verified in headless Chromium:

```
initial        9,000 total / 19 mounted / rows in DOM 19
after scroll   start 4,996, end 5,019 / 23 mounted / scroll 220,000 px
after dispose  container retained, 0 rows
after recreate 9,000 total / 19 mounted, rebuilt in 1.1 ms
page errors    none
```

Two things the demo surfaced, both fixed in the page rather than the library:
the first `requestAnimationFrame` after load does not always run before paint in
a headless context, so the panel now reports immediately *and* again once the
list settles; and the scroll listener was registered inside the create path,
which stacked a listener per recreate.

**Cost:** 216 gzipped bytes, 12945 to 13161 against the 13312 budget. The plan
said not to raise the budget to accept a feature, and it was not raised — 151
bytes of headroom remain.

## Discoverability pass

Everything added this session existed but was unreachable from the front door.
`README.md` now points at the four things a reader would otherwise never find:
the RealWorld example and how to serve it, the virtualization demonstration
page, the three verification commands including `npm run test:api`, and the two
benchmark harnesses with the note that `benchmark/compare` needs its own
`npm install` while the library stays dependency-free.

No behaviour changed. Every path linked was checked to exist.

## Adversarial pass over every function and method

`npm run test:edge` (`test/edge-cases.mjs`) is the counterpart to the API audit:
48 probes that look for defects rather than confirming happy paths. Edge inputs,
error paths, reentrancy, repeated and out-of-order operations, interactions
between features, isolation between runtimes, and an ownership churn sweep over
every construct.

### One real defect found

**`asyncState()` could not be released on its own.** It was the only reactive
primitive without `dispose()`: signal, computed, effect, store, data, elements,
scopes and components all have one. Each async state held two runtime ownership
entries - its backing state signal and its own abort cleanup - and nothing freed
them until the whole scope was disposed. One created per request or per view in a
long-lived runtime accumulated with no remedy available to the caller.

The churn sweep is what caught it, and the shape is worth noting: an ownership
leak raises no error, fails no assertion, and passes every functional test. It
only shows as growth. The sweep creates and releases each construct 40-200 times
and requires the runtime's cleanup set to return to its starting size; async
state was the one entry that grew, at exactly two per cycle.

Fixed by adding `dispose()` and a `disposed` getter, matching every sibling.
Disposal aborts work in flight and is idempotent. 24 gzipped bytes, 13166 to
13190 against the 13312 budget.

### A second wave, and a second documentation gap

Seventeen more probes covering what the first wave missed: form binding
(checkboxes, multiple selects, custom accessors), delegated events, `tree()`
edge cases, progressive creation, error boundaries, lazy components, deep context
chains, and nested batching. All pass, and one of them found a trap.

**A custom `get` in a form binding replaces the entire read, so `parse` is never
applied.** That is coherent — `get` is typed `(element) => T` and already returns
the signal's type, so running `parse` over it would convert twice — but nothing
said so, and supplying both silently produced unparsed values. I fell into it
writing the probe. Also undocumented: `get` and `set` receive the **native node**,
not the wrapper. Both are now stated in `README.md`, `docs/api.html`, and as
JSDoc on `FormBindingOptions`.

Not a code change: the behaviour is right, the documentation was missing. Same
category as the `bindVisible`/`bindHidden` finding, but unlike that one the two
options are not siblings pretending to be a pair, so aligning them would be
wrong.

### Waves three to five

Thirty-six more probes: wrapper caching and foreign DOM mutation, `when()` with
`preserve` and `disposeOnStop`, router parameter decoding and pattern escaping,
every `scrollVirtualList` alignment, keyed updates while scrolled, per-key store
signals across delete and re-add, aborted observers, bindings against disposed
sources, fragment component roots, mount/unmount cycles, scheduler reentrancy,
lists over containers with foreign children, `aria: false`, style and visibility
edges, injection surfaces, and scale (5,000 keyed rows reversed, 2,000 signals,
2,000 levels of nesting).

**No further defects.** Three findings, all documentation:

- **The `*` catch-all is a whole-path wildcard.** A route of `'*'` puts the
  entire path in `params.rest`, leading slash included; `'/*'` captures only the
  remainder. Nothing said which, and the two differ.
- **A custom `get` replaces the whole read**, so `parse` is ignored alongside it,
  and `get`/`set` receive the native node rather than the wrapper.
- **`tree()`'s `properties` is a deliberate escape hatch.** It writes native
  properties verbatim, so `properties: { innerHTML }` parses markup exactly as
  the DOM would. The README's claim that "raw HTML is never accepted implicitly"
  is technically accurate - *implicitly* is doing the work - but the boundary was
  never stated. It is now, along with the warning never to build an attribute
  *name* from untrusted input.

Confirmed sound rather than assumed: `_elements` is a `WeakMap` and `_wrapNode`
returns one wrapper per node, so repeated `child.find()` and `wrap()` neither
allocate nor accumulate. No text path parses markup at any depth, through any
binding, including keyed lists and reactive text.

### Everything else held

The other 47 probes passed, including the paths most likely to be fragile:
writing to a signal inside its own subscriber, unsubscribing mid-notification, a
throwing subscriber not blocking the others, disposing inside a hook, an effect
that writes what it reads, a throwing render rolling back a keyed list, a
throwing key function leaving the DOM untouched, a throwing route view, a
throwing branch factory, prototype-shaped store keys, concurrent async runs
settling on the newest, appending an element into itself, and two runtimes not
sharing scheduling or disposal.

### Two false alarms, both mine

The suite reported two failures while being written and neither was a library
defect. A throwing effect cleanup looked like it stopped the effect rerunning; it
does not - the cleanup is cleared before it runs, so the next pass executes
normally and installs a fresh one, and the escape came from an unguarded
`dispose()`, where surfacing collected failures is the documented contract. The
second was `s.effect(() => v.get())`: an arrow with an implicit return hands the
read value back as a "cleanup", which the runtime correctly rejects. Worth
recording because it is an easy mistake to make twice.

## Property-based fuzzing of the reconciler

`npm run test:fuzz` (`test/fuzz.mjs`) drives random keyed-list operation
sequences - remove, insert, swap, reverse, shuffle, clear, append, move - and
checks three properties after **every** step rather than at the end:

1. **Order.** The DOM matches the model exactly.
2. **Identity.** A key that survives keeps the same node, which is what carries
   focus, scroll position, and uncontrolled input state through a reorder.
3. **Minimality.** The number of DOM moves never exceeds the theoretical
   minimum: the survivors outside the longest increasing subsequence of their
   previous positions, plus the newly added rows.

The third is the interesting one. It is an independent reimplementation of the
bound the reconciler is supposed to hit, computed from the model rather than
from the library, so it checks the LIS reconciler against theory instead of
against itself.

**Result: 9,600 reconciliations, 12,262 DOM moves against a theoretical minimum
of 12,262.** Exactly minimal on every step, with no order or identity violation.

**Verified against an injected regression rather than trusted because it
passes.** Forcing the settled set empty - the pre-LIS behaviour, where every row
is treated as out of order - makes it fail on the first step of the first
sequence: `expected <= 1 moves, got 8 moves`. Restoring the reconciler returns it
to clean.

Each run picks a fresh seed and prints it, so runs explore new sequences while a
failure stays reproducible with `SEED=<n> npm run test:fuzz`. Defaults are 400
sequences of 24 steps; `SEQUENCES` and `STEPS` override them.

## In-depth API reference

The docs had breadth but not depth: `docs/api.html` named 154 of 160 public
members, but as prose paragraphs by area - "Classes and styles: `class.add/...`,
`classToggle`, `setStyle`" - which tells a reader a method exists, not its
signature, parameters, return value, failure modes, or how to use it. There was
also no per-member anchor to link to.

`docs/reference.html` fills that: **all 207 declared members**, each with its
signature, a description, parameter table where useful, return value, what it
throws, and a worked example where one helps. 197 entries, 55 examples, 118
return/throws notes, ten sections, per-member anchors.

**Signatures are extracted from `types/index.d.ts`** with the TypeScript compiler
when the page is built, so the one thing most likely to rot - the signature - is
generated rather than transcribed. Prose and examples live in
`tools/reference/parts/`, keyed by `Type.member`, and are merged in by name. A
member with no entry still renders, and the build prints the gap, so the omission
is visible rather than silent.

**Two guards, both verified against injected drift:**

- `npm test` fails when the page is stale. Adding a member to the declarations
  without rebuilding fails the new docs test *and* the existing declaration-drift
  guard, which is the pair working as intended.
- The build reports how many members lack prose, so coverage cannot quietly slip.

The generator lives in `tools/`, not `docs/`, because a first attempt shipped 61 kB
of build tooling in the npm tarball: negated `files` patterns do not reach into an
included directory, and moving it out was cleaner than fighting the packer. The
tarball is 26 files, 121.3 kB, and contains the built page but not its source.

Linked from every documentation page, from `README.md`, and added to the release
checklist so the page is rebuilt before a version ships.

## Trimming the published package

The tarball shipped 26 files and 490 kB unpacked, roughly a third of which - the
documentation, the benchmark harness, and the changelog - is nothing an installer
needs to use the library. All of it stays in the repository; only what npm
publishes changed.

| | before | after |
| --- | ---: | ---: |
| files | 26 | 10 |
| packed | 121.4 kB | 73.6 kB |
| unpacked | 490.0 kB | 303.3 kB |

What ships now is exactly the runtime (`src/index.js`), both browser builds
(`dist/*.js`, the glob rather than the directory so source maps stay out), the
four declaration files, `package.json`, `README.md`, and `LICENSE`.

**`.npmignore` was updated to match.** npm consults `files` or `.npmignore`, never
both, and `files` wins - proven rather than assumed, by putting `src/index.js`
into `.npmignore` and watching it ship anyway. The old list predated `docs/`,
`example/`, `benchmark/`, and `tools/`, so it named none of them; had `files` ever
been removed, every one of them would have been published.

Both lists now describe the same package, and that equivalence was verified rather
than eyeballed: removing `files` entirely and repacking produces the identical
tarball, 10 files and 73.6 kB. `files` remains the enforcing mechanism, because an
allow-list publishes nothing new by default while a deny-list publishes everything
new by default.

`test/package.test.mjs` previously asserted that `benchmark` and `docs` were
published; it now asserts the opposite, and that every path the `exports` map
names is present. That test is the guard against someone re-adding them without
meaning to.

**Verified by installing it, not by reading the file list.** The tarball was
packed, installed into an empty project, and every entry point imported: the
default export, all 20 named exports, `domsculptor/browser`,
`domsculptor/testing`, `domsculptor/lazy`, and `domsculptor/package.json`. A
TypeScript consumer was then compiled against it under `strict` with
`moduleResolution: nodenext` and `skipLibCheck` off, which passes.

One observation from that check, not a defect: `createLazyComponent`'s declared
loader type is stricter than the runtime. The runtime wraps whatever the module
resolves to, so a loader returning `{ default: () => someElement }` works; the
declaration requires a component factory or instance. Types being stricter than
the runtime is the safe direction, and the documented pattern - a module whose
default export is a component - satisfies both, so it was left alone.

## Size budget decision

The budget was raised twice, both times deliberately and recorded:

- **10 KB to 12 KB**, during runtime ownership, when the build went 37 bytes
  over. An unused return value was removed first.
- **12 KB to 13 KB**, during virtualization, when the feature overran by 102
  bytes. The virtualization plan explicitly said not to raise the budget merely
  to accept the feature and to reduce implementation size first, so five
  targeted reductions were applied — sharing the scheduler callback rather than
  wrapping it, dropping a stored field and a single-use helper, and setting the
  unchanging `role` attribute once per row instead of on every pass — recovering
  about 40 bytes. The remaining 61 could not be recovered without removing
  behaviour the plan's version-one scope requires, so the budget moved to 13 KB
  and the reasoning was written into the plan's Performance targets section
  rather than left implicit.

Current build: **12377 / 13312 bytes gzipped**, roughly 930 bytes of headroom.
`README.md` and `test/size.test.mjs` track the current figure.

## Benchmark investigation

`npm run benchmark` appeared to show `append-one` regressing from ~3.0ms to
~5.7ms, reproducible across three runs. Rather than accept or dismiss it, I
compared the committed `HEAD` source against the working tree in a single
Chromium page, interleaving the two versions per sample and discarding warm-up:

| append-one | min | p25 | median | p75 | max |
| --- | --- | --- | --- | --- | --- |
| HEAD | 2.6 | 3.0 | 5.9 | 6.4 | 7.6 |
| working tree | 2.6 | 3.0 | 5.9 | 6.7 | 7.5 |

**Identical.** The apparent regression was an artifact of run order and warm-up
in `benchmark/run.mjs`, which runs cases sequentially in a fixed order; its
absolute numbers drift by several milliseconds between invocations. Worth
knowing before those numbers are ever published (tier 3 item 6).

The same method found one **real** cost, in the disposal path where the new
bookkeeping actually runs — disposing 1,000 elements with listeners plus 1,000
signals with subscriptions:

| listener-subscription-cleanup | min | p25 | median | p75 |
| --- | --- | --- | --- | --- |
| HEAD | 0.3 | 0.4 | 0.4 | 0.5 |
| working tree | 0.5 | 0.5 | 0.6 | 0.7 |

That is roughly 100 nanoseconds per disposed resource — the deliberate price of
releasing ownership entries so they cannot accumulate.

## Files

`AGENTS.md` requires this list; it was missing until now. 48 files, +7,657 / -83.

**Runtime and published surface (modified)**

- `src/index.js` — the only runtime file. Automatic tracking, runtime ownership,
  routing, virtualization, the keyed reconciler, the disposal rework, the
  convenience-export fix, the `tree()` additions, scope-owned subscriptions, and
  the `append`/`asyncState`/`bindHidden` contract changes.
- `types/index.d.ts` — `TreeList`, `RouteViewSnapshot`, tree `ref`/`refs`,
  reactive `class`/`attributes`, the `classToggle` map overload, and the
  `asyncState` return type.
- `package.json` — `test:api` script, extended `lint`, negated `files` entries.
- `dist/domsculptor.min.js`, `dist/domsculptor.esm.min.js` — rebuilt.

**Tests (modified, plus one added)**

- `test/index.test.mjs` — 144 tests, up from 128 at the start.
- `test/browser.html` — real-DOM coverage; 125/124/124 assertions.
- `test/api-audit.mjs` *(new)* — 35 probes over all 158 public members.

**Documentation (modified)**

- `README.md`, `CHANGELOG.md`, `TASK_PROGRESS.md`, `docs/api.html`,
  `docs/index.html`, `docs/examples.html`, `docs/recipes.html`,
  `docs/releasing.md`.

**Benchmarks (added)**

- `benchmark/js-framework-benchmark/` — the keyed entry, 5 files.
- `benchmark/jsfb-verify.mjs` — 20 checks against the real DOM.
- `benchmark/compare/` — the five-framework harness, 11 files including its own
  lockfile.

**Example (added)**

- `example/realworld/` — 15 files: the app, its server, its README, and a
  25-check verifier.

**Also modified:** `.gitignore` (the comparison harness's dependencies and both
build outputs).

**Inspected but unchanged:** `test/package.test.mjs`, `test/docs.test.mjs`,
`test/security.test.mjs`, `test/size.test.mjs`, `benchmark/run.mjs`,
`webpack.config.cjs`, `testing/index.d.ts`, `lazy/index.d.ts`,
`AGENTS.md`.

## Risks / limitations

- **Size headroom is 151 gzipped bytes** (13161 / 13312). The next feature needs
  a budget conversation before it is written, not after. An earlier version of
  this entry said 10276 / 12288 and advised putting tier 2 features behind
  subpath entries; both were wrong. The figures predated virtualization, and the
  architecture note above establishes that a subpath entry ships in the core
  bundle anyway.
- Auto-tracking is synchronous: a signal read after an `await` inside a
  computation is not tracked, because the collector is installed only for the
  synchronous portion of the run. This matches Solid and Vue, and is **now
  documented** in `README.md` with the read-before-awaiting pattern.
- `when()` **now releases** its runtime ownership entry when a region is stopped
  early; it previously registered the stop function with the owning scope and
  never untracked it. Bounded at one entry per region, but unbounded in a
  long-lived runtime that churns regions. Pinned by a test that churns 300
  create/stop cycles and fails when the fix is reverted.
- `clear-1000` is now 7.1 ms against 3.2-5.5 ms. See the section on it below; the
  first attempt was abandoned on the measurement and the second, made after
  profiling the clear on its own, worked. What is left is what a `DomElement`
  costs.

  The abandoned first attempt, kept for the record: **abandoned on the
  measurement.** Skipping the empty-children allocation for leaf
  elements and replacing the per-node `removeChild` loop with a single
  `textContent` write cost 9 gzipped bytes and moved the median from 9.4 ms to
  9.6 ms - inside the noise - so it was reverted rather than kept for the look of
  it. The earlier CPU profile already said why: after the detach-first fix the
  remaining time is wrapper construction and teardown plus garbage collection,
  not the clearing path. Disposing a thousand benchmark rows disposes about eight
  thousand `DomElement` wrappers, each releasing a scope `Set` entry, a runtime
  `Map` entry, a static `WeakMap` entry, its listener record, and its dispose
  callbacks. Solid and Preact allocate no wrapper per element and so have nothing
  to release. Closing the rest of this gap means changing what a `DomElement`
  costs, which is a redesign of the library's central abstraction and its public
  API, not a fix.
- The comparison harness pulls React, Preact, Solid, Vue, and a Babel toolchain
  into `benchmark/compare/node_modules`. They are confined to that directory's
  own `package.json`, ignored by git, and excluded from the npm tarball, so the
  library itself stays dependency-free.
- The version is now **3.0.0**, which the release requires: `child.append()`'s
  return value, `asyncState.run()`'s contract, `bindHidden()`'s mechanism,
  dependency-less `computed()`/`effect()`, and the timing of dispose hooks all
  changed. Bumped in `package.json`, in the `test/package.test.mjs` pin, in the
  changelog heading, and in the nine versioned CDN URLs across `README.md` and
  `docs/`. **Those URLs 404 until `npm publish` runs**, which is the one thing
  the bump does not do.
