# Changelog

All notable changes to DOMSculptor will be documented in this file. The project
uses [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Class-only `DomSculptor.renderEach()` progressive rendering that creates one
  element per animation frame, with abort support and lifecycle-aware cleanup.

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
