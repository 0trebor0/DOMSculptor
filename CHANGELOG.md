# Changelog

All notable changes to DOMSculptor will be documented in this file. The project
uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Explicit `createProgressively(tag, parent, callback?)` mounting. The first
  element mounts immediately, later elements mount one per animation frame, and
  the `rendering` property reports whether queued work remains. Parented
  `create()` calls remain synchronous.
- `has(key)`, `delete(key)`, and `signal(key)` on `store()` and `data()`. These
  were already documented and typed but missing from the runtime, so calling
  them threw a `TypeError`. Deleting a key notifies observers with `undefined`
  and keeps that key's listeners attached, so they fire again if the key is set
  later.

- Automatic dependency tracking for `computed()` and `effect()`. Omitting the
  dependency list now discovers the signals the computation reads, including
  values read through a `store()`, and re-subscribes on every run so a branch
  that stops reading a signal stops depending on it. Passing a list still pins
  dependencies explicitly, and an empty list evaluates once.

- Virtualized collections through `virtualList()`, `updateVirtualList()`,
  `scrollVirtualList()`, `virtualListStatus()`, and `disposeVirtualList()`.
  Fixed-height rows, configurable overscan, optional stable keys, reusable rows,
  scroll-to-index and scroll-to-key with alignment, resize handling, and
  automatic `role`/`aria-posinset`/`aria-setsize` metadata. Nine thousand records
  mount roughly 20-60 rows instead of nine thousand nodes. Scroll and resize
  collapse into one pass per animation frame, and `rendering` now reports
  progressive creation and virtual work through a single status path.
- `router(routes, options?)`. Maps path patterns to views, keeps one route
  mounted, and disposes the previous view on every change. Patterns support
  `:name` parameters and a `*` catch-all; views may return a `DomElement` or a
  component instance and receive `{ path, route, params }`. Provides `navigate`,
  `replace`, a readable `current` signal, and an idempotent `stop()`. Handles
  browser back and forward through `popstate`, with `{ hash: true }` for
  fragment routing. The runtime owns the router, so `sculptor.dispose()` stops
  it and disposes the mounted view.
- `sculptor.dispose()` and `sculptor.disposed`. Every runtime now owns whatever
  is created outside an explicit scope, so signals, computed values, effects,
  stores, async state, and elements always have a disposer. Nodes created by the
  runtime are removed; nodes taken over with `wrap()` or `adopt()` stay in the
  document and only have their listeners and bindings released. Disposing a
  resource directly releases its ownership entry, so repeated create/dispose
  cycles do not accumulate cleanup callbacks.

### Changed

- Keyed lists reorder with the minimum number of DOM moves. Rows whose relative
  order is unchanged now stay where they are, and only the rows that actually
  moved are re-inserted; previously each row was placed by its index, so a single
  swap of two rows moved every row between them. Swapping two rows in a
  thousand-row list went from 32.4 ms to 2.7 ms.
- Keyed list updates no longer re-register ownership for rows the container
  already owns, and the container's child list is rebuilt once per pass rather
  than spliced per row. Both were quadratic in the length of the list. In the
  project's own benchmark, and together with the disposal change below,
  append-one went from 2.8 ms to 0.7 ms, prepend-one from 2.7 ms to 0.8 ms,
  remove-middle from 2.7 ms to 0.8 ms, and swap-two from 3.8 ms to 0.7 ms.
- Disposing an element now removes its node from the document before its subtree
  is torn down, so every descendant is disposed off the document where removal
  costs the engine no layout or style work. Clearing a thousand rows of eight
  elements went from 14.4 ms to 9.0 ms. `onRemove` and `onDispose` hooks
  consequently observe a node whose `parentNode` is already `null`; they
  previously saw it still attached.
- The gzip budget enforced by `npm run size` moved from 10 KB to 13 KB to make
  room for automatic dependency tracking, runtime ownership, routing, and
  virtualization. The build currently measures 12572 bytes.
- `computed(fn)` and `effect(fn)` called without a dependency list previously
  never re-ran; they now track their reads. Calls that pass a dependency list
  are unaffected. Pass an empty list to keep the evaluate-once behavior.

### Fixed

- The standalone `computed()` and `effect()` exports now track their reads like
  the methods of the same name. They kept the old empty-list default when
  automatic tracking was added, so `import { computed } from 'domsculptor'`
  produced a value that never re-ran, which is the opposite of what this file
  and the README describe. Passing a dependency list is unaffected.
- `npm run benchmark` now interleaves its cases and discards warm-up rounds.
  Running each case's samples consecutively let JIT warm-up and garbage
  collection move medians by several milliseconds between invocations, which
  made unrelated changes look like regressions. Repeat runs now agree to about a
  tenth of a millisecond.
- `on()`, `once()`, `getValue()`, `setValue()`, `hide()`, and `show()` now
  report use of a disposed element with the same error as the other element
  methods instead of throwing a raw null-reference `TypeError`.
- Corrected `types/index.d.ts`, which declared behavior the runtime does not
  implement: an optional `transform` argument on `text()`, `attr()`,
  `classToggle()`, and `styleValue()` (silently ignored at runtime), and a
  `previous` argument for signal subscribers (never supplied). `DataStore`
  observers are unaffected and still receive the previous value.

## 2.0.0

### Added

- Package exports, browser metadata, a publish allow-list, and size-budget checks.
- Automated unit, browser-matrix, build, lint, and package checks.
- Native event listener options and improved native element/event inference.
- `signal`, lazy `computed` values, cleanup-aware `effect`, `batch`, and `flush`.
- Abort-aware subscriptions with immediate delivery and idempotent cleanup.
- Async cancellation, reset, refresh state, and stale-request protection.
- Keyed list reconciliation with stable node identity and duplicate-key checks.
- Detached creation, explicit mounting/unmounting/adoption, and safe `tree()` composition.
- Conditional branch rendering with optional preservation.
- Native property and element-aware form bindings, including IME handling.
- Disposal scopes with automatic resource ownership and aggregate cleanup.
- Thin component factories with props, public APIs, context, and deterministic disposal.
- Hierarchical key/value contexts.
- Read-only ownership snapshots and explicit unmount/dispose lifecycle hooks.
- Delegated events with standard listener options and cleanup.
- Disposable object stores through `store()`.
- Targeted reactive text, attribute, class, and style nodes.
- DocumentFragment component roots with reversible mounting.
- A single `src/index.js` implementation and public package entry.
- Structured development diagnostics and reproducible browser benchmarks.
- Component construction error boundaries with deterministic fallback cleanup.
- Optional typed testing and lazy-component package entries.
- Runtime-instance isolation for scheduling, scopes, batching, and disposal.

### Changed

- Package positioning, keywords, and licence metadata now match the project.
- Installation documentation uses immutable, versioned package URLs.
- `create(tag)` now creates a detached element. Use `createIn(parent, tag)` or
  `mount(element, parent)` when immediate insertion is required.
- `wrap()` and `mount()` now throw on failure; `tryWrap()` and `tryMount()` are
  the explicit non-throwing alternatives.

### Removed

- Implicit insertion of parentless `create()` calls into `<body>`.
- Mutable public ownership arrays; `children` is now a frozen snapshot.
- The deprecated `jsontohtml()` compatibility API; use `tree()`.

### Migration

Replace code that relied on implicit body insertion:

```js
// 1.x
const panel = sculptor.create('section');

// 2.0
const panel = sculptor.createIn(document.body, 'section');
// or
const panel = sculptor.create('section');
sculptor.mount(panel, document.body);
```

## 1.0.6

- Current public release.
