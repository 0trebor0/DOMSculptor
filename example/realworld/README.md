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

Two defects and eight pieces of friction. Both defects and seven of the eight are
now fixed in the library, each with a test that fails if the fix is reverted, and
this app was rewritten onto the new APIs so the improvement could be counted
rather than claimed.

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

## Friction, and what came of it

Counted over the app, before the library changed and after it was rewritten onto
the new APIs. Seven of the eight are fixed; the counts are the evidence.

| | before | after |
| --- | ---: | ---: |
| `child.find()` calls | 25 | 2 |
| post-hoc `.classToggle()` / `.attr()` | 13 | 2 |
| `classToggle()` calls | 10 | 2 |
| element liveness guards | 5 | 3 |

**1. `tree()` could not name a node, so parts were addressed by CSS selector.**
25 `child.find()` calls existed only to reach a node the same file had just
built, and one of those selectors matched the profile header's column instead of
the article column — a real bug whose fix at the time was to invent a class name
purely for wiring. **Fixed:** a `refs` object at the root and `ref` on any node.
The two that remain are inside a keyed list's `update`, where the row is handed
to you and there is no tree to have named it.

**2. `tree()` could not express a reactive list**, so every view split into a
declarative shell and an imperative fill. **Fixed:** `children` accepts
`{ each, key?, render, update? }`. The tab strips, the tag sidebar, the editor's
tag pills, the comment list, and the form error lists are now declared, not
filled.

**3. `text:` accepted a signal but `class:` and `attributes:` did not.** All 13
reactive class and attribute bindings sat outside the `tree()` block. **Fixed:**
attribute values may be signals and `class` accepts a map. The two that remain
are, again, inside a keyed `update`.

**4. `classToggle()` took one class, so an either/or pair cost four objects.**
**Fixed:** it accepts a map, and plain booleans as well as signals.

**5. `child.append()` returns the parent, not the child.** **Not fixed, and
deliberately so.** Changing it would break every chained call in every program
using the library to trade one inconvenience for another.

**6. `asyncState.run()` both rejects and records the failure.** **Not fixed.**
Four `.catch(() => {})` calls remain. The rejection is documented behaviour that
callers awaiting `run()` depend on, and the redundancy only appears when the
snapshot is what renders.

**7. A bare `signal.subscribe()` was owned by nothing.** Element bindings
released themselves with their element; a plain `subscribe` did not, even inside
a scope. I leaked one inside a re-render in the article view and had to
restructure it around a static skeleton. This was the last place where disposal
was a discipline rather than a default. **Fixed:** a subscription made inside a
scope belongs to it.

**8. There was no way to ask whether the current scope is alive**, so five async
continuations guarded on `root.html`. **Fixed:** the router hands each view its
scope on the snapshot, and `scope.disposed` answers directly. The three guards
that remain are in code that is not a route view, so nothing hands it a scope.

One thing the rewrite taught that the first pass did not: **keyed rows are
reused, so anything applied when a row was created has to be reapplied in
`update`**. Declaring a row's active class in `render` alone leaves stale classes
on reused rows — the tab strips needed an `update` to fix exactly that.
