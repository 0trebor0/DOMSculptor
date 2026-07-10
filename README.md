# DomSculptor

A lightweight JavaScript framework for reactive DOM manipulation — no dependencies, no build step required.

[![Maintenance](https://img.shields.io/badge/Maintained%3F-yes-green.svg)](https://GitHub.com/0trebor0/DOMSculptor/graphs/commit-activity)
[![GitHub Stars](https://img.shields.io/github/stars/0trebor0/DOMSculptor?style=social)](https://github.com/0trebor0/DOMSculptor/stargazers)

## Table of Contents

* [Getting Started](#getting-started)
* [Creating Elements](#creating-elements)
* [Wrapping Existing Elements](#wrapping-existing-elements)
* [Content](#content)
* [Attributes](#attributes)
* [Classes](#classes)
* [Styles](#styles)
* [Children](#children)
* [DOM Traversal](#dom-traversal)
* [Lifecycle Hooks](#lifecycle-hooks)
* [Events](#events)
* [Reactive State](#reactive-state)
* [Async State](#async-state)
* [Reactive Data](#reactive-data)
* [jsontohtml](#jsontohtml)
* [TypeScript](#typescript)
* [Contributing](#contributing)

## Getting Started

**CDN**

```html
<script type="module">
    import DomSculptor from 'https://cdn.jsdelivr.net/gh/0trebor0/DOMSculptor@master/src/index.js';

    let sculptor = new DomSculptor();
</script>
```

**ES Module**

```js
import DomSculptor from './src/index.js';
```

Create an instance:

```js
let sculptor = new DomSculptor();
```

## Creating Elements

`create(tagName, parent?, callback?)` creates an element and appends it to `parent`. If `parent` is omitted it appends to `<body>`. `parent` can be a CSS selector string, a `DomElement`, or a native `Node`.

```js
let div = sculptor.create('div');
let p   = sculptor.create('p', div).setText('Hello world');
let btn = sculptor.create('button', '#app', el => el.setText('Click me'));
```

## Wrapping Existing Elements

`wrap(selectorOrNode)` gives you a `DomElement` around an element already in the page.

```js
let header = sculptor.wrap('#site-header');
let nav    = sculptor.wrap(document.querySelector('nav'));

header.class.add('sticky');
nav.setText('Updated nav');
```

## Content

```js
el.setText('Hello');        // sets textContent
el.getValue();              // returns .value (inputs, selects)
el.setValue('new value');   // sets .value — chainable
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

Use lifecycle hooks for setup and cleanup associated with an element. Both methods are chainable.

```js
let panel = sculptor.create('section')
    .onMount(el => console.log('mounted', el.html))
    .onRemove(el => console.log('removing', el.html));
```

`onMount()` runs immediately when the element is already attached. Otherwise, it runs when the element is appended through DomSculptor. `onRemove()` runs once before listeners, bindings, children, and the native node are cleaned up.

## Events

```js
el.on('click', handler);
el.on({ mouseover: handlerA, mouseout: handlerB }); // bulk

el.once('click', handler);       // fires once, then auto-removes

el.off('click', handler);        // remove specific handler
el.off('click');                 // remove all click handlers

el.remove();                     // removes element and cleans up all listeners
```

## Reactive State

`sculptor.state(initialValue)` returns a reactive store for a single value. All state methods that accept an element auto-unsubscribe when that element is removed.

### Basic usage

```js
let count = sculptor.state(0);

count.get();              // 0
count.set(5);             // triggers subscribers (skips if value unchanged)
count.update(v => v + 1); // functional update
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
```

Use `bindValue()` for a one-way value binding. Use `sync()` when user input should also update the state.

```js
let name = sculptor.state('Ada');
let input = sculptor.create('input');

name.bindValue(input);
```

### `sync(inputElement, transform?)` — two-way binding

Keeps an input and a state value in sync. Optional `transform` coerces the string input value.

```js
let name = sculptor.state('');
let input = sculptor.create('input', document.body);

name.sync(input);
```

For numeric inputs:

```js
let age = sculptor.state(0);
let ageInput = sculptor.create('input', document.body);

age.sync(ageInput, Number);
```

### `list(container, renderFn)` — reactive list rendering

Renders an array state into a container. Re-renders automatically when the array changes.

```js
let todos = sculptor.state(['Buy milk', 'Walk dog']);
let ul = sculptor.create('ul', document.body);

todos.list(ul, text => sculptor.create('li').setText(text));

todos.update(items => [...items, 'New item']); // list updates automatically
```

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

`asyncState(initialData?)` tracks the status, data, and error for asynchronous work. It accepts a function or Promise and ignores late state updates from older runs.

```js
let users = sculptor.asyncState([]);

users.subscribe(({ status, data, error }) => {
    if (status === 'loading') console.log('Loading...');
    if (status === 'success') console.log(data);
    if (status === 'error') console.error(error);
});

await users.run(() => fetch('/api/users').then(response => response.json()));
await users.retry();
```

Snapshots use the statuses `idle`, `loading`, `success`, and `error`. `run()` and `retry()` return Promises and reject when the task fails.

## Reactive Data

`sculptor.data(initialObject?)` returns a small reactive data object for named values. Use it when you want to watch fields like `color`, `theme`, `open`, or `activeTab`.

This is useful when you want something similar to:

```js
let color = 'red';

watch('color', () => {
    // run when color changes
});
```

With DomSculptor, you can write:

```js
let data = sculptor.data({
    color: 'red'
});

data.onChange('color', (next, previous) => {
    console.log('color changed from', previous, 'to', next);
});

data.set('color', 'blue');
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

## jsontohtml

Build a DOM tree from a plain config object.

```js
sculptor.jsontohtml({
    type: 'div',
    parent: '#app',
    attributes: { id: 'card' },
    class: ['card', 'elevated'],
    text: 'Hello',
    oncreate: (el) => el.setStyle('padding', '16px'),
    children: [
        { type: 'h2', text: 'Title' },
        { type: 'p',  text: 'Body text.' },
        {
            type: 'button',
            text: 'OK',
            oncreate: (el) => el.on('click', () => console.log('clicked'))
        }
    ]
});
```

## TypeScript

DomSculptor remains a JavaScript library. TypeScript declarations are included only to provide optional editor completion and type checking; no TypeScript compiler or build step is required for normal JavaScript usage.

```js
import DomSculptor from 'domsculptor';

let sculptor = new DomSculptor();
let message = sculptor.create('p').setText('Still plain JavaScript');
```

## Contributing

Contributions are welcome! Please feel free to submit a pull request.
