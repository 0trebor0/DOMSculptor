# Conduit — the RealWorld app in DOMSculptor

A full [RealWorld](https://github.com/gothinkster/realworld) client: sign up and
sign in, the global and personal feeds, tag filtering, pagination, articles with
comments, favouriting, following, profiles, the article editor, and settings.

It exists to answer a question the unit tests cannot: what does this library feel
like to build a real application with? The findings are at the bottom, and they
are the point of the exercise.

## Running it

```bash
node example/realworld/serve.mjs
```

Then open <http://127.0.0.1:8123/>. `PORT` overrides the port.

There is **no build step**. The page loads `src/main.js` as an ES module and that
imports `../../../src/index.js` directly, so what runs in the browser is the
library source.

## Checking it

```bash
node example/realworld/verify.mjs
```

25 checks in headless Chromium against the live API: the feeds, tags, tag
filtering, an article and its meta blocks, profiles and their tabs, both auth
forms, the redirects that protect the editor and settings, the not-found route,
that only one view is mounted at a time, and the back button.

**Only unauthenticated flows are exercised.** Signing up and publishing would
write to a shared public service, so those paths are implemented but left for a
person to run by hand.

## The backend

`https://api.realworld.show/api`, set in `src/api.js`. The older
`api.realworld.io` was returning HTTP 530 when this was written. Being a live
public service, it can be down, and its data changes under you.

## Two things that are deliberately not what a production app would do

**Article bodies are rendered as plain paragraphs, not markdown.** Rendering the
markdown the API returns would mean either taking a dependency or hand-rolling a
parser that writes HTML from user input. Neither belongs in an example whose job
is to show the library.

**Favouriting updates the count before the request returns** and rolls back on
failure, because the alternative is a button that feels dead on a slow network.

---

# What building it found

Two defects, both fixed in the library with tests that fail if the fix is
reverted, and seven pieces of friction that are still there.

## Defect: every route change leaked

A router view that returns a plain element had no scope of its own. Its signals,
computed values, and effects were therefore owned by the **runtime root scope**,
which nothing releases until the whole runtime is disposed. Navigating between
sign-in and sign-up in this app added four permanent entries per round trip:

```
204 -> 82 -> 86 -> 90 -> 94 -> 98 -> 102     (before)
181 -> 84 -> 84 -> 84 -> 84 -> 84 -> 84      (after)
```

`router()` now creates a scope per view and disposes it on the way out. This was
invisible to the unit tests because they navigate synchronously, and route
changes are scheduled — forty synchronous navigations coalesce into one render
and create one view. The regression test flushes between navigations for exactly
that reason.

## Defect: async state announced its own disposal

`asyncState`'s scope cleanup called `cancel()`, which **writes a final snapshot**.
That notifies subscribers, and on scope disposal those subscribers are rendering
into elements the same disposal has already removed — and writing to a disposed
element throws, as it should. The result was an `AggregateError` on every
navigation away from a page with a pending request. Disposal now aborts the work
without announcing it.

Note the shape of this one: it only became reachable once views had scopes. The
first fix exposed the second.

## Friction

Counted over 1,438 lines across 10 modules.

**1. `tree()` has no way to name a node, so parts are addressed by CSS selector.**
25 `child.find()` calls exist only to reach a node the same file just built. It
caused a real bug: `.container .row .col-xs-12` matched the profile header's
column instead of the article column, and the fix was to invent a class name that
exists purely for wiring. A `ref` key returning a map of named nodes would remove
the whole category.

**2. `tree()` cannot express a reactive list.** `children:` takes an array, and
`signal.list()` works on a container element, not inside a config. So every view
splits into a declarative shell and an imperative fill, and that seam is visible
in all six of them.

**3. `text:` accepts a signal but `class:` and `attributes:` do not.** Every
reactive class or attribute is a `.classToggle()` or `.attr()` call after the
`tree()` block — 13 of them here. The declarative form covers static markup and
dynamic text, and stops exactly where a real UI needs it most.

**4. `classToggle()` takes one class, so an either/or pair costs four objects:**

```js
button.classToggle('btn-primary', sculptor.computed(() => favorited.get()));
button.classToggle('btn-outline-primary', sculptor.computed(() => !favorited.get()));
```

Ten of these, five duplicated negations.

**5. `child.append()` returns the parent, not the child.** Convenient for adding
siblings, but you can never chain into what you just appended, so building depth
outside `tree()` means a temporary variable per level.

**6. `asyncState.run()` both rejects and records the failure.** The snapshot is
what the UI renders, so the rejection is always redundant: four
`.catch(() => {})` calls whose only purpose is silence.

**7. A bare `signal.subscribe()` is owned by nothing.** Element bindings
(`bind`, `bindText`, `list`) release themselves when the element goes, but a
plain `subscribe` does not, even inside a scope. I wrote one inside a re-render
function in the article view and it accumulated a subscription per render, all
pointing at replaced elements; fixing it meant restructuring the view around a
static skeleton. After the runtime-ownership work, this is the one place where
disposal is still a discipline rather than a default.

**8. There is no way to ask whether the current scope is still alive.** Writing
to a signal after its scope is disposed throws, which is right, but every async
continuation therefore needs a liveness guard, and the only thing available to
guard on is an element: `if (!root.html) return`. Five of those. `sculptor.disposed`
exists for the runtime and `ComponentInstance.disposed` for components, but a view
built from `tree()` has neither.
