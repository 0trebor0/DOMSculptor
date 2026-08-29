// Runtime and ownership entries for the in-depth reference.
let ex = strings => strings.raw.join('').replace(/^\n/, '');

export let runtime = {
    // ------------------------------------------------------------------ runtime
    'DomSculptor.__order': [
        'createDetached', 'create', 'createIn', 'createProgressively', 'mount', 'tryMount', 'unmount',
        'wrap', 'tryWrap', 'adopt', 'tree', 'when', 'signal', 'state', 'computed', 'effect', 'batch',
        'flush', 'store', 'data', 'asyncState', 'component', 'errorBoundary', 'createScope',
        'createContext', 'createContextKey', 'router', 'virtualList', 'updateVirtualList',
        'scrollVirtualList', 'virtualListStatus', 'disposeVirtualList', 'rendering', 'dispose', 'disposed'
    ],
    'DomSculptor.createDetached': {
        description: `Creates an element that is <strong>not</strong> in the document. Nothing appears until you
            mount it, which lets you build and configure a subtree in one pass and pay a single
            insertion.`,
        params: [['tagName', 'Any tag name. TypeScript infers the native element type from it.'],
                 ['callback', 'Optional. Receives the element before it is returned.']],
        returns: 'The new <code>DomElement</code>.',
        example: ex`
let card = sculptor.createDetached('article', el => el.class.add('card'));
card.child.create('h2').setText('Offline first');
sculptor.mount(card, '#app');       // one insertion, fully built`
    },
    'DomSculptor.create': {
        description: `Creates an element and mounts it immediately when a parent is given. Without a parent it
            behaves exactly like <code>createDetached</code>.`,
        params: [['tagName', 'The tag to create.'],
                 ['parent', 'Optional selector, native <code>Node</code>, or <code>DomElement</code>.'],
                 ['callback', 'Optional configuration callback.']],
        returns: 'The new <code>DomElement</code>.',
        throws: '<code>TypeError</code> if a selector matches nothing, or if the parent is disposed.',
        example: ex`
let button = sculptor.create('button', '#toolbar', el => el.setText('Save'));`
    },
    'DomSculptor.createIn': {
        description: 'Creates an element inside a parent you already hold. The argument order mirrors the nesting.',
        returns: 'The new child <code>DomElement</code>.',
        example: ex`
let list = sculptor.create('ul', '#app');
let row = sculptor.createIn(list, 'li');`
    },
    'DomSculptor.createProgressively': {
        description: `Mounts the first element immediately and one more per animation frame after that, so a
            large render does not block interaction. The element is returned configured straight away;
            only its insertion is deferred.`,
        returns: 'The new <code>DomElement</code>, already configured.',
        note: `<code>rendering</code> reports whether queued work remains. Disposing the parent cancels
            whatever is still queued.`,
        example: ex`
for (let row of thousands) {
    sculptor.createProgressively('div', container, el => el.setText(row.label));
}
// sculptor.rendering === true until the queue drains`
    },
    'DomSculptor.mount': {
        description: `Attaches an element or component instance to a parent. Mounting an element that is
            already mounted moves it rather than duplicating it.`,
        returns: 'The mounted element or instance.',
        throws: '<code>TypeError</code> when the parent cannot be resolved or has been disposed.',
        example: ex`
sculptor.mount(view, '#app');
sculptor.mount(view, otherParent);   // moves it; no duplicate`
    },
    'DomSculptor.tryMount': {
        description: 'The non-throwing form of <code>mount</code>, for parents that may not exist yet.',
        returns: 'The mounted value, or <code>null</code> when the parent could not be resolved.',
        example: ex`
if (!sculptor.tryMount(banner, '#optional-slot')) {
    // the slot is not on this page
}`
    },
    'DomSculptor.unmount': {
        description: `Detaches without disposing. The element keeps its listeners, bindings, and children and
            can be mounted again. Unmount hooks run child-first; mount hooks do <em>not</em> run again
            on a later mount.`,
        example: ex`
sculptor.unmount(panel);      // reversible
sculptor.mount(panel, '#app');`
    },
    'DomSculptor.wrap': {
        description: `Takes over an existing node so the library can manage it. One wrapper exists per node, so
            wrapping the same node twice returns the same object.`,
        returns: 'The <code>DomElement</code> for that node.',
        throws: '<code>TypeError</code> when a selector matches nothing.',
        note: `A wrapped node is not deleted by <code>sculptor.dispose()</code> — the runtime did not create
            it, so it only releases the listeners and bindings it added.`,
        example: ex`
let form = sculptor.wrap('#signup');
form.on('submit', event => event.preventDefault());`
    },
    'DomSculptor.tryWrap': {
        description: 'The non-throwing form of <code>wrap</code>.',
        returns: 'The <code>DomElement</code>, or <code>null</code> when nothing matched.'
    },
    'DomSculptor.adopt': {
        description: `Takes ownership of a node you already have a reference to, without a selector lookup.`,
        returns: 'The <code>DomElement</code> for that node.'
    },
    'DomSculptor.tree': {
        description: `Builds a detached hierarchy from a plain configuration object. Text is written as text
            nodes, never parsed, and <code>attributes</code>, <code>class</code>, and
            <code>children</code> all accept reactive values.`,
        returns: 'The root <code>DomElement</code>.',
        throws: '<code>TypeError</code> for a missing <code>tag</code> or an invalid <code>class</code>, <code>attributes</code>, <code>on</code>, or <code>ref</code>.',
        example: ex`
let refs = {};
let panel = sculptor.tree({
    tag: 'section',
    refs,
    class: { panel: true, 'is-busy': busy },
    children: [
        { tag: 'h2', ref: 'title', text: heading },
        { tag: 'button', text: 'Save', attributes: { disabled: busy },
          on: { click: save } }
    ]
});
refs.title.class.add('lead');`
    },
    'DomSculptor.when': {
        description: `Mounts one of two branches according to a condition, in a single queued pass. Factory
            branches are disposed when they leave unless <code>preserve</code> is set.`,
        returns: 'A stop function that releases the region.',
        throws: '<code>TypeError</code> without a readable condition, or when no parent can be determined.',
        example: ex`
let stop = sculptor.when(loggedIn,
    () => sculptor.tree({ tag: 'p', text: 'Welcome back' }),
    { parent: '#app', fallback: () => sculptor.tree({ tag: 'a', text: 'Sign in' }) }
);
stop();   // releases the region and its ownership entry`
    },
    'DomSculptor.signal': {
        description: `Creates a signal: a value plus change notification. Reads are synchronous; DOM bindings
            are queued into one pass per frame.`,
        returns: 'A <code>State</code>.',
        example: ex`
let count = sculptor.signal(0);
count.get();          // 0
count.set(1);
count.update(n => n + 1);`
    },
    'DomSculptor.state': { description: 'An alias for <code>signal</code>, kept for readability where the value is a record rather than a scalar.' },
    'DomSculptor.computed': {
        description: `A value derived from other signals. With no dependency list it discovers what it reads
            on every run, so a branch that stops reading a signal stops depending on it.`,
        params: [['compute', 'Function producing the value.'],
                 ['dependencies', 'Omit to track automatically. An array pins dependencies. <code>[]</code> evaluates once.']],
        returns: 'A <code>Computed</code>.',
        throws: '<code>TypeError</code> for an invalid dependency list; <code>Error</code> on a read cycle.',
        note: 'Tracking is synchronous: a signal read after an <code>await</code> is not discovered.',
        example: ex`
let total = sculptor.computed(() => items.get().length);
let pinned = sculptor.computed(() => expensive(), []);   // evaluated once`
    },
    'DomSculptor.effect': {
        description: `Runs immediately, then again whenever a signal it read changes. Returning a function
            registers cleanup, which runs before each rerun and once when the effect stops.`,
        returns: 'A stop function.',
        note: `An arrow with an implicit return hands its value back as a cleanup, so write
            <code>() =&gt; { read(); }</code> rather than <code>() =&gt; read()</code>.`,
        example: ex`
let stop = sculptor.effect(() => {
    document.title = title.get();
    return () => console.log('cleaning up');
});`
    },
    'DomSculptor.batch': {
        description: 'Groups writes so the DOM updates once at the end. Nested batches defer until the outermost completes.',
        example: ex`
sculptor.batch(() => {
    first.set('Grace');
    last.set('Hopper');
});   // one rendering pass`
    },
    'DomSculptor.flush': {
        description: 'Applies queued DOM work immediately instead of waiting for the scheduled pass. Useful in tests and when measuring layout.',
        example: ex`
value.set('next');
sculptor.flush();
element.html.textContent;   // already 'next'`
    },
    'DomSculptor.store': { description: 'Creates a keyed store. An alias for <code>data</code>.' },
    'DomSculptor.data': {
        description: `Creates an object whose keys are independently observable, with a signal available per key.`,
        returns: 'A <code>DataStore</code>.',
        example: ex`
let profile = sculptor.data({ name: 'Ada', theme: 'dark' });
profile.set('theme', 'light');
profile.signal('theme').bindText(label);`
    },
    'DomSculptor.asyncState': {
        description: 'Tracks status, data, and error for asynchronous work, aborting a superseded run by default.',
        returns: 'An <code>AsyncState</code>.',
        example: ex`
let users = sculptor.asyncState([]);
let { status, data, error } = await users.run(({ signal }) =>
    fetch('/api/users', { signal }).then(r => r.json())
);`
    },
    'DomSculptor.component': {
        description: `Wraps a factory so each invocation gets its own disposal scope. Everything created inside
            is released when the instance is disposed.`,
        params: [['factory', 'Receives <code>(props, context)</code> and returns a root or a <code>{ root, api?, dispose? }</code> definition.'],
                 ['options', '<code>name</code> improves diagnostics.']],
        returns: 'A factory function producing a <code>ComponentInstance</code>.',
        example: ex`
let Counter = sculptor.component(({ start = 0 }) => {
    let count = sculptor.signal(start);
    let root = sculptor.tree({ tag: 'button', text: sculptor.computed(() => String(count.get())) });
    root.on('click', () => count.update(n => n + 1));
    return { root, api: { reset: () => count.set(start) } };
}, { name: 'Counter' });

let counter = Counter({ start: 5 });
sculptor.mount(counter, '#app');
counter.api.reset();
counter.dispose();`
    },
    'DomSculptor.errorBoundary': {
        description: `Wraps a component factory so a failure during creation renders a fallback instead of
            propagating. The failed scope is disposed before the fallback is built.`,
        returns: 'A factory producing either the component or the fallback.',
        example: ex`
let Safe = sculptor.errorBoundary(Risky, error =>
    sculptor.tree({ tag: 'p', text: 'Could not load this panel' })
);`
    },
    'DomSculptor.createScope': {
        description: `Creates an ownership scope. Anything created inside <code>scope.run()</code> belongs to it
            and is released together, in reverse order of creation.`,
        returns: 'A <code>DisposalScope</code>.',
        example: ex`
let scope = sculptor.createScope();
scope.run(() => {
    let value = sculptor.signal(0);
    value.subscribe(render);     // released with the scope
});
scope.dispose();`
    },
    'DomSculptor.createContext': {
        description: 'Creates a context, optionally inheriting from a parent and seeded with an object or <code>Map</code>.',
        returns: 'A <code>Context</code>.'
    },
    'DomSculptor.createContextKey': {
        description: 'Creates a unique symbol key, so two features can use the same name without colliding.',
        returns: 'A <code>symbol</code>.'
    },
    'DomSculptor.router': {
        description: `Maps path patterns to views and keeps one mounted. Patterns support <code>:name</code>
            segments and a <code>*</code> catch-all; literal segments are escaped, so <code>/a.b</code>
            matches only <code>/a.b</code>. Each view runs in its own scope, disposed on the way out.`,
        params: [['routes', 'An object of pattern to view function.'],
                 ['options', '<code>parent</code> selects the outlet; <code>hash: true</code> routes on the fragment.']],
        returns: 'A <code>Router</code>.',
        throws: '<code>TypeError</code> when routes are missing or a view is not a function.',
        note: `<code>*</code> is a whole-path wildcard: a route of <code>'*'</code> puts the entire path in
            <code>params.rest</code> including its leading slash, while <code>'/*'</code> captures only the
            remainder.`,
        example: ex`
let router = sculptor.router({
    '/': () => Home(),
    '/posts/:slug': ({ params, scope }) => Post({ slug: params.slug, scope }),
    '*': () => sculptor.tree({ tag: 'p', text: 'Not found' })
}, { parent: '#app', hash: true });

router.navigate('/posts/hello');`
    },
    'DomSculptor.virtualList': {
        description: `Renders a large collection by mounting only the visible range plus overscan. A spacer of
            the full collection height keeps the scrollbar representing every record.`,
        params: [['items', 'The collection. Copied, so later mutation of your array does not affect the list.'],
                 ['container', 'A scrollable <code>DomElement</code>, not already virtualized.'],
                 ['options', 'See <code>VirtualListOptions</code>.']],
        returns: 'The container.',
        throws: '<code>TypeError</code> for a missing <code>rowHeight</code> or <code>render</code>, or duplicate keys; <code>Error</code> if the container is already virtualized.',
        note: `A row holding the focused element is kept mounted outside the visible range and is not
            updated while it holds focus, so scrolling cannot pull an input out from under someone
            typing.`,
        example: ex`
let list = sculptor.create('div', '#app')
    .setStyle({ height: '600px', overflow: 'auto' });

sculptor.virtualList(records, list, {
    rowHeight: 48,
    overscan: 6,
    key: record => record.id,
    render: record => sculptor.createDetached('div').setText(record.name)
});
// 9,000 records, roughly 20-60 rows in the DOM`
    },
    'DomSculptor.updateVirtualList': {
        description: `Replaces the collection, resizing the spacer and clamping a scroll position left past the
            new end. Rows for surviving keys are reused.`,
        returns: 'The container.',
        throws: '<code>TypeError</code> on duplicate keys, before any DOM change.'
    },
    'DomSculptor.scrollVirtualList': {
        description: 'Scrolls to an index or to <code>{ key }</code>, with <code>start</code>, <code>center</code>, <code>end</code>, or <code>nearest</code> alignment.',
        returns: '<code>true</code> when the target was reachable, <code>false</code> otherwise.',
        example: ex`
sculptor.scrollVirtualList(list, 5000, { align: 'center' });
sculptor.scrollVirtualList(list, { key: 'user-42', align: 'nearest' });`
    },
    'DomSculptor.virtualListStatus': {
        description: 'Reads the current range as a frozen snapshot, for tests and diagnostics.',
        returns: 'A <code>VirtualListStatus</code>, or <code>null</code> when the container is not virtualized.'
    },
    'DomSculptor.disposeVirtualList': {
        description: 'Removes virtualization and every mounted row while keeping the container, which can then be virtualized again.',
        returns: 'The container.'
    },
    'DomSculptor.rendering': {
        description: 'Whether queued progressive creation or virtual-list work remains. One status path covers both.'
    },
    'DomSculptor.dispose': {
        description: `Releases everything the runtime owns: scheduled work, signals, effects, stores, and the
            elements it created. Idempotent. Nodes taken over with <code>wrap</code> or
            <code>adopt</code> stay in the document; only their listeners and bindings are released.`,
        example: ex`
sculptor.dispose();
sculptor.disposed;   // true`
    },
    'DomSculptor.disposed': { description: 'Whether the runtime has been disposed.' },

    'DomSculptorOptions.development': {
        description: 'Enables structured diagnostics. Leave it off in production; the checks are skipped entirely when disabled.'
    },
    'DomSculptorOptions.onWarning': {
        description: 'Receives every diagnostic instead of the console, which makes them assertable in tests.',
        example: ex`
let warnings = [];
let sculptor = new DomSculptor({ development: true, onWarning: w => warnings.push(w.code) });`
    },
    'DevDomSculptor.reportLeaks': {
        description: 'Counts component scopes that are still active, for use at the end of a test.',
        returns: 'The number of undisposed component scopes.'
    },
    'DevelopmentWarning.code': { description: 'A stable identifier such as <code>duplicate-list-key</code> or <code>disposed-element-operation</code>, safe to assert on.' },
    'DevelopmentWarning.message': { description: 'A human-readable explanation.' },
    'DevelopmentWarning.details': { description: 'The offending value, when there is one.' }
};
