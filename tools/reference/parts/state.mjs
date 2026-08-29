// Signal, computed, and binding entries for the in-depth reference.
let ex = strings => strings.raw.join('').replace(/^\n/, '');

export let state = {
    'State.__order': [
        'set', 'update', 'bind', 'sync', 'list', 'bindText', 'bindValue', 'bindAttribute',
        'bindClass', 'bindStyle', 'bindProperty', 'bindVisible', 'bindHidden', 'dispose', 'disposed'
    ],
    'Readable.get': {
        description: 'Reads the current value. Synchronous, and registers with an enclosing computed value or effect so it is tracked.',
        returns: 'The current value.'
    },
    'Readable.subscribe': {
        description: `Calls back on every change until unsubscribed. A subscription made inside a scope belongs
            to that scope and is released with it; outside a scope, the returned function is yours to
            call.`,
        params: [['callback', 'Receives the new value.'],
                 ['options', '<code>immediate</code> delivers the current value at once; <code>signal</code> unsubscribes on abort.']],
        returns: 'An unsubscribe function.',
        throws: '<code>TypeError</code> without a function, or if the signal is disposed.',
        example: ex`
let stop = total.subscribe(value => console.log(value), { immediate: true });
stop();`
    },
    'SubscriptionOptions.immediate': { description: 'Deliver the current value to the callback as soon as it subscribes.' },
    'SubscriptionOptions.signal': { description: 'An <code>AbortSignal</code>; aborting unsubscribes. An already-aborted signal never subscribes.' },

    'State.set': {
        description: `Writes a new value and notifies. A write equal to the current value by <code>Object.is</code>
            does nothing, so <code>NaN</code> is not treated as a change. Writes made inside a
            subscriber are queued so every subscriber sees the same order.`,
        throws: '<code>Error</code> if the signal is disposed.',
        example: ex`
count.set(1);
count.set(1);   // no notification: equal by Object.is`
    },
    'State.update': {
        description: 'Writes a value derived from the current one.',
        throws: '<code>TypeError</code> without a function.',
        example: ex`
count.update(n => n + 1);
items.update(list => list.filter(item => item.id !== id));`
    },
    'State.bind': {
        description: `The general binding. Given a function it runs on every change with
            <code>(value, element)</code>; given an options object it behaves as <code>sync</code>. The
            binding is released when the element is disposed.`,
        returns: 'The element.',
        example: ex`
progress.bind(bar, (value, el) => el.setStyle('width', value + '%'));`
    },
    'State.sync': {
        description: `Two-way form binding. Writes the signal into the control and the control back into the
            signal, normalising checkboxes, radio groups, numbers, multiple selects, and IME
            composition.`,
        params: [['element', 'The control.'],
                 ['options', 'A parser function, or <code>FormBindingOptions</code>.']],
        returns: 'The element.',
        example: ex`
name.sync(input);
quantity.sync(numberInput, { parse: Number });
tags.sync(checkbox, { group: true });`
    },
    'State.list': {
        description: `Renders an array into a container. The keyed form preserves element identity across
            reorders, so focus, scroll position, and uncontrolled input survive; the simple form
            replaces all rows and suits data with no stable identity.`,
        params: [['container', 'The container element, whose children the list owns.'],
                 ['renderFn', 'A render function, or <code>KeyedListOptions</code>.']],
        returns: 'The container.',
        throws: '<code>TypeError</code> for duplicate keys — raised before any DOM change, so a rejected update leaves the list intact.',
        note: `Reorders move the minimum number of nodes: rows whose relative order has not changed stay
            where they are.`,
        example: ex`
rows.list(list, {
    key: row => row.id,
    render: row => sculptor.tree({ tag: 'li', text: row.label }),
    update: (element, row) => element.setText(row.label)
});`
    },
    'State.bindText': { description: 'One-way binding to a single text node, with an optional transform.', returns: 'The element.' },
    'State.bindValue': {
        description: 'One-way binding to a control value.',
        returns: 'The element.',
        note: 'One-way by design. Use <code>sync</code> when user input should write back.'
    },
    'State.bindAttribute': { description: 'One-way binding to one attribute.', returns: 'The element.' },
    'State.bindClass': { description: 'One-way binding that adds or removes one class.', returns: 'The element.' },
    'State.bindStyle': { description: 'One-way binding to one style property.', returns: 'The element.' },
    'State.bindProperty': { description: 'One-way binding to a native property, for cases an attribute cannot express.', returns: 'The element.' },
    'State.bindVisible': {
        description: 'Shows the element while the value is truthy, hiding it otherwise, through <code>show()</code> and <code>hide()</code>.',
        returns: 'The element.'
    },
    'State.bindHidden': {
        description: 'The exact mirror of <code>bindVisible</code>: hides while the value is truthy. Both restore the element’s previous display value.',
        returns: 'The element.'
    },
    'State.dispose': {
        description: 'Releases the signal and every subscription to it. Reads and writes afterwards throw rather than failing quietly.',
        example: ex`
value.dispose();
value.disposed;  // true
value.set(1);    // throws`
    },
    'State.disposed': { description: 'Whether the signal has been disposed.' },

    'Computed.dispose': { description: 'Releases the computed value and the subscriptions it discovered.' },
    'Computed.disposed': { description: 'Whether the computed value has been disposed.' },

    'KeyedListOptions.key': {
        description: `Returns a stable identity per item. Identity is what lets a row keep its node across a
            reorder. Duplicates are rejected before the DOM is touched.`
    },
    'KeyedListOptions.render': { description: 'Builds a row. Called once per new key; must return a live <code>DomElement</code>.' },
    'KeyedListOptions.update': {
        description: `Applies changed data to a row that already exists. Keyed rows are reused, so anything
            applied in <code>render</code> that depends on the item must be reapplied here — or bound to
            a signal, which cannot go stale.`
    },

    'FormBindingOptions.event': { description: 'The DOM event that writes back. Defaults to <code>input</code> for text and <code>change</code> for the rest.' },
    'FormBindingOptions.parse': {
        description: `Converts the raw control value before it reaches the signal. Ignored when
            <code>get</code> is supplied, because a custom read already returns the value the signal
            should hold.`
    },
    'FormBindingOptions.get': {
        description: `Replaces the entire read, including <code>parse</code>. Receives the <strong>native
            node</strong>, not the wrapper.`,
        example: ex`
picked.sync(control, {
    get: node => node.dataset.value,
    set: (node, value) => { node.dataset.value = value; }
});`
    },
    'FormBindingOptions.set': { description: 'Replaces the entire write. Receives the native node.' },
    'FormBindingOptions.group': { description: 'Treats a checkbox as part of a group whose signal holds an array of the checked values.' },
    'FormBindingOptions.multiple': { description: 'Treats a select as multiple, so the signal holds an array.' }
};
