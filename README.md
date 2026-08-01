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
button.dispose();
count.dispose();
```

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

All executable package APIs resolve to `src/index.js`. The testing and lazy
subpaths keep separate declaration files only so editors show focused types.

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
- [Manage children](#children), [render large collections](#incremental-rendering), and [traverse DOM](#dom-traversal)
- [Understand mounting and cleanup](#lifecycle-hooks)

### Reactive UI

- [Signals, computed values, effects, forms, and lists](#reactive-state)
- [Async loading and cancellation](#async-state)
- [Reactive object stores](#reactive-data)
- [Declarative trees](#tree-creation) and [conditional UI](#conditional-rendering)
- [Components, contexts, and disposal scopes](#components-and-disposal-scopes)

Continue with the [practical recipes](docs/recipes.html), use the
[complete API reference](docs/api.html) while coding, or open the
[full examples](docs/examples.html). For application structure, routing,
testing, lazy loading, and service boundaries, read the
[large-project guide](docs/large-projects.html).

## Creating Elements

`create(tagName, parent?, callback?)` creates a detached element. Pass a parent
to mount immediately, or call `mount()` after composing the subtree. A parent can
be a CSS selector string, a `DomElement`, or a native `Node`.

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

Parented `create()` calls automatically mount one element per animation frame.
The first element mounts immediately and later calls wait in DOMSculptor's
internal queue, preventing a large collection from mounting in one turn.

```js
let list = sculptor.create('ul', '#app');

items.forEach(item => {
    sculptor.create('li', list).setText(item.label);
});

console.log(sculptor.rendering); // true while mounts remain queued
```

`create()` still returns each `DomElement` immediately, so normal chaining works.
Only its insertion into the supplied parent is deferred. Queues are tracked per
parent, so creating the list does not delay its first child. Detached `create()`
and `element.child.create()` remain immediate for synchronous tree construction.

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
    matched.remove();
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

Computed values use an explicit dependency list and skip notifications when the
derived result is unchanged:

```js
let firstName = sculptor.signal('Ada');
let lastName = sculptor.signal('Lovelace');
let fullName = sculptor.computed(
    () => `${firstName.get()} ${lastName.get()}`,
    [firstName, lastName]
);

fullName.get();
fullName.dispose();
```

### Effects and batching

Effects run once immediately, then once per queued rendering pass. A returned
cleanup function runs before the next execution and when the effect is stopped.

```js
let stop = sculptor.effect(() => {
    document.title = fullName.get();
    return () => console.log('effect cleanup');
}, [fullName]);

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

`sync(input, transform?)` remains as an alias for compatibility. Binding options
can select an event, parser, checkbox-group behavior, or custom accessors.

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
`run()` and `retry()` return Promises and reject when work fails or is aborted.

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
`npm run size` enforces a 10 KB gzip budget for the full builds.

## Compatibility

DOMSculptor follows semantic versioning. Patch releases fix compatible defects,
minor releases add compatible APIs, and breaking behavior is reserved for major
releases with changelog and migration entries. In 2.0, `create(tag)` became
detached by default; use `createIn(parent, tag)` or `mount()` for insertion.

## Contributing

Contributions are welcome! Please feel free to submit a pull request.

Maintainers should use the [release checklist](./docs/releasing.md) before
creating a tag or publishing a package.
