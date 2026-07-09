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
* [Events](#events)
* [Reactive State](#reactive-state)
* [Reactive Data](#reactive-data)
* [jsontohtml](#jsontohtml)
* [Contributing](#contributing)

## Getting Started

**CDN**

```html
<script src="https://cdn.jsdelivr.net/gh/0trebor0/DOMSculptor@master/src/index.js"></script>
```

**ES Module**

```js
import DomSculptor from './src/index.js';
```

Create an instance:

```js
const sculptor = new DomSculptor();
```

## Creating Elements

`create(tagName, parent?, callback?)` creates an element and appends it to `parent`. If `parent` is omitted it appends to `<body>`. `parent` can be a CSS selector string, a `DomElement`, or a native `Node`.

```js
const div = sculptor.create('div');
const p   = sculptor.create('p', div).setText('Hello world');
const btn = sculptor.create('button', '#app', el => el.setText('Click me'));
```

## Wrapping Existing Elements

`wrap(selectorOrNode)` gives you a `DomElement` around an element already in the page.

```js
const header = sculptor.wrap('#site-header');
const nav    = sculptor.wrap(document.querySelector('nav'));

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
el.child.create('span');         // create a child element and append it
el.child.remove();               // remove el from the DOM
```

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
const count = sculptor.state(0);

count.get();              // 0
count.set(5);             // triggers subscribers (skips if value unchanged)
count.update(v => v + 1); // functional update
```

### `subscribe(fn)` — run code on change

```js
const unsub = count.subscribe(v => console.log('count is', v));

count.set(10);

unsub(); // stop listening
```

### `bind(element, updater)` — one-way state → DOM

Runs `updater(value, element)` immediately and on every change. Auto-unsubscribes when the element is removed.

```js
const label = sculptor.create('p', document.body);

count.bind(label, (v, el) => el.setText(`Count: ${v}`));
```

### `sync(inputElement, transform?)` — two-way binding

Keeps an input and a state value in sync. Optional `transform` coerces the string input value.

```js
const name = sculptor.state('');
const input = sculptor.create('input', document.body);

name.sync(input);
```

For numeric inputs:

```js
const age = sculptor.state(0);
const ageInput = sculptor.create('input', document.body);

age.sync(ageInput, Number);
```

### `list(container, renderFn)` — reactive list rendering

Renders an array state into a container. Re-renders automatically when the array changes.

```js
const todos = sculptor.state(['Buy milk', 'Walk dog']);
const ul = sculptor.create('ul', document.body);

todos.list(ul, text => sculptor.create('li').setText(text));

todos.update(items => [...items, 'New item']); // list updates automatically
```

### Full example — reactive todo list

```js
const sculptor = new DomSculptor();
const todos = sculptor.state([]);
const text  = sculptor.state('');

const input = sculptor.create('input', document.body);
const btn   = sculptor.create('button', document.body).setText('Add');
const ul    = sculptor.create('ul', document.body);

text.sync(input);

btn.on('click', () => {
    if (!text.get().trim()) return;

    todos.update(items => [...items, text.get()]);
    text.set('');
});

todos.list(ul, item => sculptor.create('li').setText(item));
```

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
const data = sculptor.data({
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
const data = sculptor.data({
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
const data = sculptor.data({
    count: 0
});

data.update('count', value => value + 1);
```

### `onChange(key, callback, options?)` — watch one value

Runs `callback(next, previous, key)` when a specific key changes.

```js
const unsub = data.onChange('color', (next, previous, key) => {
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
const sculptor = new DomSculptor();

const data = sculptor.data({
    color: 'red'
});

const button = sculptor.create('button', document.body).setText('Change color');
const preview = sculptor.create('div', document.body).setText('Preview');

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

## Contributing

Contributions are welcome! Please feel free to submit a pull request.
