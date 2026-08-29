# DOMSculptor

DOMSculptor is a tiny, dependency-free, client-side reactive DOM toolkit for widgets, browser extensions, embedded interfaces, progressive enhancement, and small applications. It provides direct DOM control without JSX, a compiler, a virtual DOM, or a required build step.

[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://GitHub.com/0trebor0/DOMSculptor/graphs/commit-activity)
[![GitHub Stars](https://img.shields.io/github/stars/0trebor0/DOMSculptor?style=social)](https://github.com/0trebor0/DOMSculptor/stargazers)

## Start here

Use DOMSculptor when you want reactive browser UI without adopting a framework,
compiler, JSX transform, or virtual DOM.

The basic workflow is always the same:

1. Create one `DomSculptor` runtime.
2. Create detached DOM.
3. Connect state and events.
4. Mount the result.
5. Dispose it when the feature is finished.

### Five-minute counter

```sh
npm install domsculptor
```

Add `<div id="app"></div>` to the page, then:

```js
import DomSculptor from 'domsculptor';

let sculptor = new DomSculptor();
let count = sculptor.signal(0);
let button = sculptor.create('button');

count.bindText(button, value => `Count: ${value}`);
button.on('click', () => count.update(value => value + 1));
sculptor.mount(button, '#app');

// At page, route, or widget teardown:
sculptor.dispose();
```

Disposing the runtime releases everything it created. Individual `dispose()`
calls remain available when a resource should go away sooner.

`create()` is detached, `mount()` inserts it, and `dispose()` permanently removes
its DOM, listeners, bindings, and owned descendants.

### Choose an entry point

| Use case | Import |
| --- | --- |
| npm or a bundler | `import DomSculptor from 'domsculptor'` |
| Browser ES module | `import DomSculptor from '.../domsculptor.esm.min.js'` |
| Classic script tag | `<script src=".../domsculptor.min.js"></script>` |
| Test helpers | `import { createTestHarness } from 'domsculptor/testing'` |
| Lazy components | `import { createLazyComponent } from 'domsculptor/lazy'` |

The root, testing, and lazy package entries resolve to `src/index.js`. The
prebuilt `domsculptor/browser` entry resolves to `dist/domsculptor.esm.min.js`.
Testing and lazy subpaths keep separate declaration files so editors show
focused types.

### Browser ES module

```html
<script type="module">
    import DomSculptor from 'https://cdn.jsdelivr.net/npm/domsculptor@2.0.0/dist/domsculptor.esm.min.js';

    let sculptor = new DomSculptor();
</script>
```

The version is pinned deliberately. Do not import production code from a mutable repository branch.

### Script tag

```html
<div id="app"></div>
<script src="https://cdn.jsdelivr.net/npm/domsculptor@2.0.0/dist/domsculptor.min.js"></script>
<script>
    let sculptor = new DomSculptor();
    sculptor.create('button', '#app').setText('Hello DOMSculptor');
</script>
```

### One-file example

Save this as an HTML file and open it in a browser:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>DOMSculptor counter</title>
<button id="counter"></button>
<script type="module">
    import DomSculptor from 'https://cdn.jsdelivr.net/npm/domsculptor@2.0.0/dist/domsculptor.esm.min.js';

    let sculptor = new DomSculptor();
    let count = sculptor.state(0);
    let button = sculptor.wrap('#counter');

    count.bindText(button, value => `Count: ${value}`);
    button.on('click', () => count.update(value => value + 1));
    window.addEventListener('pagehide', () => {
        button.dispose();
        count.dispose();
    }, { once: true });
</script>
```

## Find what you need

### Everyday DOM

- [Create and mount elements](#creating-elements)
- [Wrap existing markup](#wrapping-existing-elements)
- [Set content](#content), [attributes](#attributes), [classes](#classes), and [styles](#styles)
- [Manage children](#children), [render large collections](#incremental-rendering), [virtualize thousands of rows](#virtual-lists), and [traverse DOM](#dom-traversal)
- [Understand mounting and cleanup](#lifecycle-hooks)

### Reactive UI

- [Signals, computed values, effects, forms, and lists](#reactive-state)
- [Async loading and cancellation](#async-state)
- [Reactive object stores](#reactive-data)
- [Declarative trees](#tree-creation), [conditional UI](#conditional-rendering), and [routing](#routing)
- [Components, contexts, and disposal scopes](#components-and-disposal-scopes)

Continue with the [practical recipes](docs/recipes.html), use the
[complete API reference](docs/api.html) while coding, or open the
[full examples](docs/examples.html). For application structure, routing,
testing, lazy loading, and service boundaries, read the
[large-project guide](docs/large-projects.html).

## Creating Elements

`create(tagName, parent?, callback?)` creates an element synchronously. Without
a parent it stays detached, so call `mount()` after composing the subtree. With
a parent it mounts immediately. A parent can be a CSS selector string, a
`DomElement`, or a native `Node`.

```js
let div = sculptor.create('div');
let p   = sculptor.create('p', div).setText('Hello world');
let btn = sculptor.create('button', '#app', el => el.setText('Click me'));
```

`createDetached()` remains as an explicit alias. `createIn()` is the concise
immediate-insertion form.

```js
let card = sculptor.create('article');
sculptor.mount(card, '#app');
sculptor.unmount(card);       // detach without cleanup
sculptor.mount(card, '#app'); // mount the same live element again

let badge = sculptor.createIn('#app', 'span').setText('New');
```

## Wrapping Existing Elements

`wrap(selectorOrNode)` gives you a `DomElement` around an element already in the page.

```js
let header = sculptor.wrap('#site-header');
let nav    = sculptor.wrap(document.querySelector('nav'));

header.class.add('sticky');
nav.setText('Updated nav');
```

`adopt(node)` is the strict node-only form and throws for invalid input.

## Content

```js
el.setText('Hello');        // sets textContent
el.getValue();              // returns .value (inputs, selects)
el.setValue('new value');   // sets .value and remains chainable
el.focus({ preventScroll: true });
el.blur();
el.isFocused();
```

Targeted reactive nodes update only their own content without clearing unrelated
descendants:

```js
el.text(label);
el.attr('aria-expanded', open);
el.classToggle('active', open);
// A map sets several classes at once, and takes plain booleans as well as signals.
el.classToggle({ open, closed: sculptor.computed(() => !open.get()), fixed: true });
el.styleValue('opacity', opacity);
```

## Attributes

```js
el.attribute.set('id', 'main');
el.attribute.set({ role: 'button', tabindex: '0' }); // bulk set
el.attribute.get('id');       // 'main'
el.attribute.has('role');     // true
el.attribute.remove('tabindex');
```

## Classes

```js
el.class.add('active', 'highlight');
el.class.remove('highlight');
el.class.toggle('active');
el.class.contains('active'); // true
```

## Styles

```js
el.setStyle('color', 'red');
el.setStyle({ fontSize: '16px', fontWeight: 'bold' }); // bulk set
el.hide(); // display: none
el.show(); // restores display
```

## Children

```js
el.child.append(otherEl);        // append a DomElement, Node, or string
el.child.prepend(otherEl);       // insert at the front
el.child.find('.item');          // querySelector scoped to el, returns DomElement or null
el.child.findAll('.item');       // all matching descendants as DomElement wrappers
el.child.create('span');         // create a child element and append it
el.child.replace(oldEl, newEl);  // replace a child
el.child.clear();                // remove all children and clean up their listeners
el.child.remove();               // remove el from the DOM
```

Elements can also be inserted next to another wrapped element:

```js
item.before(previousItem);
item.after(nextItem);
```

## Incremental Rendering

`createProgressively(tagName, parent, callback?)` mounts one element per
animation frame. The first element mounts immediately and later calls wait in
DOMSculptor's internal queue, preventing a large collection from mounting in one
turn.

```js
let list = sculptor.create('ul', '#app');

items.forEach(item => {
    sculptor.createProgressively('li', list).setText(item.label);
});

console.log(sculptor.rendering); // true while progressive mounts remain queued
```

`createProgressively()` returns each `DomElement` immediately, so normal chaining
works. Only its insertion into the supplied parent is deferred. Queues are
tracked per parent, so creating the list does not delay its first child. Regular
`create()`, `createIn()`, and `element.child.create()` remain immediate for
synchronous tree construction.

## DOM Traversal

Traversal methods return wrapped `DomElement` instances, so the regular DomSculptor API remains available.

```js
let parent = item.parent();
let panel = item.closest('.panel');
let directChildren = panel.childrenOf();
let buttons = panel.child.findAll('button');
```

`parent()` and `closest()` return `null` when no matching node exists.

## Lifecycle Hooks

Lifecycle hooks distinguish temporary detachment from permanent cleanup. All
hook methods are chainable.

```js
let panel = sculptor.create('section')
    .onMount(el => console.log('mounted', el.html))
    .onUnmount(el => console.log('temporarily detached', el.html))
    .onDispose(el => console.log('permanently disposing', el.html));
```

`onMount()` runs once per element lifetime: immediately when already connected,
or on its first DOMSculptor mount. `onUnmount()` runs on every explicit temporary
unmount, child before parent. `onDispose()` runs once during permanent cleanup,
also child before parent. Every hook is attempted when several throw, with
multiple failures reported as `AggregateError`.

A subscription made inside a scope belongs to that scope and is released with
it, the same way element bindings are released with their element. Outside a
scope the caller still owns the unsubscribe function.

Disposal detaches the node before it tears the subtree down, which is what keeps
clearing a large list cheap: only the element you disposed leaves the DOM, and
its descendants are discarded with it rather than each removing itself. So inside
a dispose hook the whole subtree is already out of the document, but only the
element disposal started at has `el.html.parentNode === null`; a descendant still
points at its parent. Read whatever you need about an element's position before
disposing it, not from the hook.

`onRemove()` and `remove()` remain compatibility aliases for `onDispose()` and
`dispose()`. Moving an element between parents does not dispose or invoke
temporary-unmount hooks.

## Events

```js
el.on('click', handler);
el.on('scroll', handler, { passive: true });
el.on('click', handler, { once: true, capture: false, signal: controller.signal });
el.on({ mouseover: handlerA, mouseout: handlerB }); // bulk
el.on('click', '.delete-button', (event, matched) => {
    sculptor.wrap(matched).dispose();
}); // delegation

el.once('click', handler);       // fires once, then auto-removes

el.off('click', handler);        // remove specific handler
el.off('click');                 // remove all click handlers

el.dispose();                    // permanent recursive cleanup
```

## Reactive State

`sculptor.signal(initialValue)` returns a reactive signal. `state()` remains as a compatibility alias. All methods that bind an element auto-unsubscribe when that element is removed.

### Basic usage

```js
let count = sculptor.signal(0);

count.get();              // 0
count.set(5);             // triggers subscribers (skips if value unchanged)
count.update(v => v + 1); // functional update
```

Signals notify ordinary subscribers synchronously. DOM bindings and effects are
deduplicated into one microtask, so several synchronous writes produce one DOM
pass. Use `sculptor.flush()` when a test needs to apply queued work immediately.

`subscribe()` validates its callback and supports immediate delivery and native
abort cleanup:

```js
let controller = new AbortController();
let unsubscribe = count.subscribe(value => console.log(value), {
    immediate: true,
    signal: controller.signal
});

controller.abort();
unsubscribe(); // safe to call again
count.dispose();
```

### Computed values

Computed values discover the signals they read and skip notifications when the
derived result is unchanged:

```js
let firstName = sculptor.signal('Ada');
let lastName = sculptor.signal('Lovelace');
let fullName = sculptor.computed(() => `${firstName.get()} ${lastName.get()}`);

fullName.get();
fullName.dispose();
```

Tracking is per evaluation, so a branch that stops reading a signal stops
depending on it:

```js
let nickname = sculptor.signal('Ada L.');
let useNickname = sculptor.signal(false);
let displayName = sculptor.computed(
    () => useNickname.get() ? nickname.get() : fullName.get()
);
```

While `useNickname` is `false`, writes to `nickname` do not recompute anything.

Pass an explicit list to pin dependencies instead. An empty list never
recomputes, which is useful for a value that should be evaluated once:

```js
let pinned = sculptor.computed(() => expensiveRead(), []);
let watched = sculptor.computed(() => summarise(), [firstName, lastName]);
```

### Effects and batching

Effects run once immediately, then once per queued rendering pass. They track
the signals they read, exactly like computed values, and a returned cleanup
function runs before the next execution and when the effect is stopped.

```js
let stop = sculptor.effect(() => {
    document.title = fullName.get();
    return () => console.log('effect cleanup');
});

sculptor.batch(() => {
    firstName.set('Grace');
    lastName.set('Hopper');
});

stop();
```

### `subscribe(fn)` — run code on change

```js
let unsub = count.subscribe(v => console.log('count is', v));

count.set(10);

unsub(); // stop listening
```

### `bind(element, updater)` — one-way state → DOM

Runs `updater(value, element)` immediately and on every change. Auto-unsubscribes when the element is removed.

```js
let label = sculptor.create('p', document.body);

count.bind(label, (v, el) => el.setText(`Count: ${v}`));
```

### Direct bindings

Common bindings do not require a custom updater:

```js
let status = sculptor.state('ready');
let label = sculptor.create('p');

status.bindText(label);
status.bindAttribute(label, 'data-status');
status.bindClass(label, 'is-ready', value => value === 'ready');
status.bindStyle(label, 'color', value => value === 'ready' ? 'green' : 'red');
status.bindVisible(label, value => value !== 'hidden');
status.bindProperty(label, 'hidden', value => value === 'hidden');
```

Use `bindValue()` for a one-way value binding. Use `sync()` when user input should also update the state.

`bindVisible()` and `bindHidden()` are exact mirrors of each other. Both go
through the same `show()` and `hide()` pair, so both restore whatever display
value the element had; they differ only in which way round the signal reads.

```js
let name = sculptor.state('Ada');
let input = sculptor.create('input');

name.bindValue(input);
```

### Native form binding

Calling `bind()` without an updater creates an element-aware two-way binding.
It supports text inputs, textareas, selects, multiple selects, boolean and array
checkboxes, radios, numbers, custom accessors, and IME composition.

```js
let name = sculptor.signal('');
let input = sculptor.create('input', document.body);

name.bind(input);
```

For numeric inputs:

```js
let age = sculptor.signal(0);
let ageInput = sculptor.create('input', document.body);
ageInput.html.type = 'number';

age.bind(ageInput); // number inputs produce numbers
```

`sync(input, optionsOrParser?)` remains as an alias for compatibility. A function
argument parses values read from the control. An options object can select an
event, parser, checkbox-group behavior, multiple selection, or custom native-node
accessors.

```js
quantity.bind(numberInput, { parse: Number });
tags.bind(checkbox, { group: true });
query.bind(customInput, {
    event: 'change',
    get: node => node.value,
    set: (node, value) => { node.value = value; }
});
```

### Keyed list rendering

Use keyed rendering when rows have stable identities. Existing keyed nodes are
moved and updated, new keys are created, and removed keys alone are disposed.
This preserves input focus, selection, and row-local browser state.

```js
let todos = sculptor.signal([
    { id: 1, text: 'Buy milk' },
    { id: 2, text: 'Walk dog' }
]);
let ul = sculptor.create('ul', document.body);

todos.list(ul, {
    key: todo => todo.id,
    render: todo => sculptor.createDetached('li').setText(todo.text),
    update: (row, todo) => row.setText(todo.text)
});
```

Duplicate keys throw before the DOM is changed. The legacy render-function form
is still supported but performs a full replacement.

### Full example — reactive todo list

```js
let sculptor = new DomSculptor();
let todos = sculptor.state([]);
let text  = sculptor.state('');

let input = sculptor.create('input', document.body);
let btn   = sculptor.create('button', document.body).setText('Add');
let ul    = sculptor.create('ul', document.body);

text.sync(input);

btn.on('click', () => {
    if (!text.get().trim()) return;

    todos.update(items => [...items, text.get()]);
    text.set('');
});

todos.list(ul, item => sculptor.create('li').setText(item));
```

## Async State

`asyncState(initialData?)` tracks the status, data, and error for asynchronous
work. Starting a new run aborts the previous run by default and older results
cannot overwrite newer state.

```js
let users = sculptor.asyncState([]);

users.subscribe(({ status, data, error }) => {
    if (status === 'loading') console.log('Loading...');
    if (status === 'success') console.log(data);
    if (status === 'error') console.error(error);
});

await users.run(({ signal }) =>
    fetch('/api/users', { signal }).then(response => response.json())
);
await users.retry();
users.cancel();
users.reset();
```

Snapshots use `idle`, `loading`, `refreshing`, `success`, and `error`.
`refreshing` means existing data is retained while a new request is running.

`run()` and `retry()` resolve with the resulting snapshot and never reject, so a
failed or aborted run needs no handler of its own:

```js
let { status, data, error } = await users.run(({ signal }) =>
    fetch('/api/users', { signal }).then(response => response.json())
);
if (status === 'error') console.error(error);
```

## Reactive Data

`sculptor.store(initialObject?)` returns a strongly typed, disposable reactive
object for named values. `data()` remains as a compatibility alias.

This is useful when you want something similar to:

```js
let color = 'red';

watch('color', () => {
    // run when color changes
});
```

With DomSculptor, you can write:

```js
let data = sculptor.store({
    color: 'red'
});

data.onChange('color', (next, previous) => {
    console.log('color changed from', previous, 'to', next);
});

data.set('color', 'blue');
data.dispose();
```

### `get(key?)` — read data

Pass a key to read one value.

```js
let data = sculptor.data({
    color: 'red',
    size: 'large'
});

data.get('color'); // 'red'
```

Call `get()` without a key to receive a shallow copy of all values.

```js
data.get(); // { color: 'red', size: 'large' }
```

### `set(key, value)` — update one value

```js
data.set('color', 'blue');
```

Listeners only run when the value actually changes.

```js
data.set('color', 'blue'); // no change, listeners do not run again
```

### `set(object)` — update multiple values

You can also set multiple values at once.

```js
data.set({
    color: 'green',
    size: 'small'
});
```

Each changed key triggers its own listeners.

### `update(key, fn)` — update from the previous value

```js
let data = sculptor.data({
    count: 0
});

data.update('count', value => value + 1);
```

### `has(key)`, `delete(key)`, and `signal(key)` — inspect and reshape a store

```js
data.has('color');      // true while the key is part of the store
data.delete('color');   // true when a key was removed, false when it was absent
data.signal('color');   // the live signal backing one key
```

`delete()` notifies observers with `undefined` before the key leaves the store,
and `get()` no longer reports it. Listeners registered for that key stay
attached, so they fire again if the key is later set:

```js
data.onChange('color', next => console.log('color is', next));

data.delete('color');      // logs: color is undefined
data.set('color', 'teal'); // logs: color is teal
```

`signal(key)` returns the same signal the store uses internally, so it supports
every binding method and writes back into the store:

```js
let color = data.signal('color');

color.bindText(label);
color.set('amber');
data.get('color'); // 'amber'
```

### `onChange(key, callback, options?)` — watch one value

Runs `callback(next, previous, key)` when a specific key changes.

```js
let unsub = data.onChange('color', (next, previous, key) => {
    console.log(`${key}: ${previous} → ${next}`);
});

data.set('color', 'purple');

unsub(); // stop listening
```

Use `{ immediate: true }` to run the callback right away with the current value.

```js
data.onChange('color', (next, previous) => {
    console.log('current color:', next);
}, { immediate: true });
```

### `offChange(key, callback?)` — remove listeners

Remove one listener:

```js
function handleColor(next, previous) {
    console.log(previous, next);
}

data.onChange('color', handleColor);
data.offChange('color', handleColor);
```

Remove all listeners for a key:

```js
data.offChange('color');
```

### `onAnyChange(callback, options?)` — watch all values

Runs `callback(key, next, previous)` whenever any value changes.

```js
data.onAnyChange((key, next, previous) => {
    console.log(`${key} changed from`, previous, 'to', next);
});

data.set('color', 'orange');
data.set('size', 'medium');
```

Use `{ immediate: true }` to run once for every current key.

```js
data.onAnyChange((key, next) => {
    console.log(`${key} is currently`, next);
}, { immediate: true });
```

### Full example — theme switcher

```js
let sculptor = new DomSculptor();

let data = sculptor.data({
    color: 'red'
});

let button = sculptor.create('button', document.body).setText('Change color');
let preview = sculptor.create('div', document.body).setText('Preview');

data.onChange('color', color => {
    preview.setStyle('color', color);
}, { immediate: true });

button.on('click', () => {
    data.set('color', data.get('color') === 'red' ? 'blue' : 'red');
});
```

## Tree creation

`tree()` builds a safe, detached DOM hierarchy. Text uses text nodes, including
reactive text, and raw HTML is never accepted implicitly.

```js
let card = sculptor.tree({
    tag: 'article',
    attributes: { id: 'card' },
    class: ['card', 'elevated'],
    children: [
        { tag: 'h2', text: titleSignal },
        { tag: 'p', text: 'Body text.' },
        {
            tag: 'button',
            text: 'OK',
            on: { click: () => console.log('clicked') }
        }
    ]
});

sculptor.mount(card, '#app');
```

DOMSculptor 2.0 removes the deprecated `jsontohtml()` compatibility API.
Use detached `tree()` configurations for new and migrated code.

### Building downwards

`child.append()` and `child.prepend()` return the element that was added, so a
structure can be built without a temporary variable for every level. Appending a
raw node or a string returns the container instead, since there is no wrapper to
return.

```js
let leaf = panel.child
    .append(sculptor.createDetached('section'))
    .child.append(sculptor.createDetached('p'))
    .setText('deep');
```

### Naming nodes instead of querying for them

Give the root a `refs` object and any node a `ref`, and the tree fills it in as it
builds. This replaces reaching back into a tree you just built with a CSS
selector, which breaks quietly when a selector matches something else first.

```js
let refs = {};
let form = sculptor.tree({
    tag: 'form',
    refs,
    children: [
        { tag: 'input', ref: 'email', attributes: { type: 'email' } },
        { tag: 'button', text: 'Send' }
    ]
});

refs.email.setValue('someone@example.com');
```

### Reactive attributes, classes, and children

`attributes` values may be signals, `class` accepts a map of class names to
signals or booleans, and `children` accepts a reactive list instead of an array.

```js
let busy = sculptor.signal(false);
let rows = sculptor.signal([{ id: 1, label: 'one' }]);

let panel = sculptor.tree({
    tag: 'div',
    class: {
        panel: true,
        'is-busy': busy,
        'is-idle': sculptor.computed(() => !busy.get())
    },
    children: [
        { tag: 'button', text: 'Save', attributes: { disabled: busy } },
        {
            tag: 'ul',
            // A reactive list owns every child of its container, so it is the
            // container's children rather than one of them.
            children: {
                each: rows,
                key: row => row.id,
                render: row => sculptor.tree({ tag: 'li', text: row.label }),
                update: (element, row) => element.setText(row.label)
            }
        }
    ]
});
```

Keyed rows are reused, so anything applied when a row was created has to be
reapplied in `update`.

## Conditional rendering

`when()` switches branches in one queued rendering pass. Static branches are
temporarily unmounted and factory branches are disposed unless `preserve` is
enabled.

```js
let stop = sculptor.when(isOpen, panel, {
    fallback: () => sculptor.tree({ tag: 'p', text: 'Closed' })
});

stop(); // unsubscribe and dispose managed branches
```

## Virtual lists

`virtualList()` renders thousands of fixed-height records while keeping only the
visible rows and a small overscan buffer in the DOM. A spacer of the full
collection height keeps the scrollbar representing every record.

```js
let list = sculptor.create('div', '#app')
    .setStyle({ height: '600px', overflow: 'auto' });

sculptor.virtualList(items, list, {
    rowHeight: 48,
    overscan: 6,
    key: item => item.id,
    render: item => sculptor.create('div').setText(item.name)
});
```

For 9,000 records this mounts roughly 20-60 rows instead of 9,000 nodes.

```js
sculptor.updateVirtualList(list, nextItems);
sculptor.scrollVirtualList(list, 5000, { align: 'center' });
sculptor.scrollVirtualList(list, { key: 'user-5000', align: 'nearest' });
sculptor.virtualListStatus(list);  // { rendering, start, end, mounted, total }
sculptor.disposeVirtualList(list); // remove virtualization, keep the container
```

Scrolling is coalesced into one rendering pass per animation frame, and
`sculptor.rendering` reports queued virtual work alongside progressive creation.
Alignments are `start`, `center`, `end`, and `nearest`; scrolling to a missing
index or key returns `false`.

### Reusable rows

Returning a row object lets DOMSculptor reuse a node as it scrolls. A reused row
must read its current item from `update()` rather than closing over the item it
was built with:

```js
render(item) {
    let current = item;
    let root = sculptor.create('button');

    root.on('click', () => open(current.id));

    return {
        root,
        update(nextItem) {
            current = nextItem;
            root.setText(nextItem.name);
        },
        dispose() {
            // optional cleanup DOMSculptor does not own
        }
    };
}
```

Keys are optional but recommended: they give stable identity, predictable reuse,
duplicate detection, and `scrollVirtualList()` by key. Duplicate keys are
rejected before any DOM changes, and a failing `render()` rolls back the rows it
created so the previous rows stay mounted.

Rows carry `role="listitem"`, `aria-posinset`, and `aria-setsize` so assistive
technology sees the logical collection; pass `aria: false` to opt out. Disposing
the container disposes the list, and both disposal paths are idempotent.

Focused rows are not yet retained outside the visible range, so scrolling can
unmount a row containing a focused input.

## Routing

`router()` maps paths to views, keeps one route mounted at a time, and disposes
the previous view on every change. Patterns support `:name` parameters and a
`*` catch-all.

```js
let router = sculptor.router({
    '/': () => sculptor.tree({ tag: 'h1', text: 'Home' }),
    '/posts/:slug': ({ params }) => PostPage({ slug: params.slug }),
    '*': () => sculptor.tree({ tag: 'p', text: 'Not found' })
}, { parent: '#app' });

router.navigate('/posts/hello');   // pushState
router.replace('/');               // replaceState
router.current.get();              // { path, route, params }
router.stop();
```

A route view is any function returning a `DomElement` or a component instance,
so `sculptor.component()` factories can be used directly. The matched snapshot
is passed in, making `params` available as component props.

Each view runs inside a scope of its own, so the signals, computed values,
effects, and subscriptions it creates are released when the route changes. That
scope is disposed before the view's elements, and a scope disposes in reverse
order of creation, so a subscription made after the element it writes into is
released before that element is torn down. Create the element, then subscribe,
and the callback cannot outlive what it renders into. That
scope is on the snapshot, which gives an asynchronous continuation a way to ask
whether its route is still on screen:

```js
'/posts/:slug': ({ params, scope }) => {
    let post = sculptor.signal(null);
    load(params.slug).then(value => {
        if (scope.disposed) return;   // the reader navigated away
        post.set(value);
    });
    return sculptor.tree({ tag: 'article', text: sculptor.computed(() => post.get()?.title ?? '') });
}
```

`current` is a readable signal, so page titles and navigation state can bind to
it like any other value:

```js
sculptor.effect(() => {
    document.title = router.current.get().route === '/' ? 'Home' : 'DOMSculptor';
});
```

Browser back and forward are handled through `popstate`. Pass `{ hash: true }`
to route on `location.hash` instead, which suits static hosting and extensions
where the server cannot rewrite paths. The router is owned by the runtime, so
`sculptor.dispose()` stops it and disposes the mounted view; `stop()` does the
same on its own and is idempotent.

## Components and disposal scopes

A component is a factory running inside a disposal scope. It has no hidden
renderer: the factory returns one root, an optional public API, and optional
custom cleanup. Elements, signals, computed values, effects, and async state
created inside the scope are disposed together.

```js
let Counter = sculptor.component((props, context) => {
    let count = sculptor.signal(props.initial ?? 0);
    let root = sculptor.tree({
        tag: 'section',
        children: [
            { tag: 'span', text: count },
            {
                tag: 'button',
                text: '+',
                on: { click: () => count.update(value => value + 1) }
            }
        ]
    });

    return {
        root,
        api: { count },
        dispose() {
            // optional application cleanup
        }
    };
});

let counter = Counter({ initial: 2 });
sculptor.mount(counter, '#app');
counter.dispose();
```

Every sculptor also owns whatever is created outside an explicit scope, so
nothing is left without a disposer:

```js
let sculptor = new DomSculptor();
let count = sculptor.signal(0);
let label = sculptor.create('p');

count.bindText(label);
sculptor.mount(label, '#app');

sculptor.dispose();   // disposes the signal, the binding, and the element
sculptor.disposed;    // true
```

`dispose()` is idempotent. Nodes the runtime created are removed, while nodes
adopted with `wrap()` or `adopt()` stay in the document and only have their
listeners and bindings released — the runtime never deletes markup it did not
create. Disposing a resource yourself releases its ownership entry, so
long-running code that creates and disposes many signals or elements does not
accumulate cleanup callbacks.

Scopes are also available directly. Cleanups run once in reverse registration
order, and every cleanup is attempted even when another throws.

```js
let scope = sculptor.createScope();

scope.run(() => {
    let query = sculptor.signal('');
    sculptor.effect(() => {
        // ...
    }, [query]);
});

scope.track(() => console.log('custom cleanup'));
scope.dispose();
```

Minimal hierarchical contexts carry themes or shared services without a
dependency-injection container:

```js
let themeKey = sculptor.createContextKey('theme');
let context = sculptor.createContext().set(themeKey, 'dark');
let childContext = context.child();

childContext.get(themeKey); // "dark"
```

## Error boundaries

Wrap component construction when a feature needs deterministic fallback UI.
Failed component scopes are cleaned before the fallback is created:

```js
let SafeAccount = sculptor.errorBoundary(
    Account,
    error => ({
        root: sculptor.create('p').setText('Account could not be opened.'),
        api: { error }
    })
);
```

## TypeScript

Declarations are published from `types/index.d.ts` while the JavaScript
implementation remains entirely in `src/index.js`. Native tag names, events,
stores, component props and APIs, contexts, async state, and tree
configuration are typed.

## Testing

The optional test entry stays out of production bundles:

```js
import { createTestHarness } from 'domsculptor/testing';

let test = createTestHarness();
let view = Account({ service: fakeService });
test.mount(view);
test.flush();
test.assertClean();
test.dispose();
```

See the [large-project architecture guide](./docs/large-projects.html) for
feature boundaries, routing cleanup, native dynamic imports, service design,
and accessibility patterns.

Lazy features are available without increasing the main runtime:

```js
import { createLazyComponent } from 'domsculptor/lazy';

let Reports = createLazyComponent(
    sculptor,
    () => import('./features/reports.js'),
    { loading: 'Loading reports…' }
);
```

## Development diagnostics

The main entry exports an opt-in development constructor that reports structured
ownership, disposal, subscription, list-key, parent/child, and binding
diagnostics. The default constructor remains silent.

```js
import { createDevSculptor } from 'domsculptor';

let sculptor = createDevSculptor({
    onWarning: warning => console.warn(warning.code, warning.message)
});

// Call at a route or test boundary to report undisposed component scopes.
sculptor.reportLeaks();
```

## Performance and size

Run `npm run benchmark` after `npm run build` for raw Chromium medians,
variance, forced-GC memory data, runtime versions, and compressed bundle sizes.
`npm run size` enforces a 13 KB gzip budget for the full builds.

## Compatibility

DOMSculptor follows semantic versioning. Patch releases fix compatible defects,
minor releases add compatible APIs, and breaking behavior is reserved for major
releases with changelog and migration entries. In 2.0, `create(tag)` became
detached by default; use `createIn(parent, tag)` or `mount()` for insertion.

## License

DOMSculptor uses the [Apache License 2.0](./LICENSE). It permits private and
commercial use, modification, sublicensing, and redistribution in source or
compiled form. When redistributing DOMSculptor or a derivative work, include the
license, mark modified files, and retain applicable notices. The license also
includes a contributor patent grant that terminates for a party bringing the
patent litigation described in the license.

Apache 2.0 does not grant general trademark rights, and the software is provided
without warranties or contributor liability to the extent allowed by law. This
summary is not legal advice; the complete `LICENSE` text controls.

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

Maintainers should use the [release checklist](./docs/releasing.md) before
creating a tag or publishing a package.
