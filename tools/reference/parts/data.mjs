// Store, async-state, tree, virtual-list, router, and component entries.
let ex = strings => strings.raw.join('').replace(/^\n/, '');

export let data = {
    // -------------------------------------------------------------------- stores
    'DataStore.__order': ['get', 'set', 'update', 'has', 'delete', 'signal', 'onChange', 'onAnyChange', 'offChange', 'dispose', 'disposed'],
    'DataStore.get': {
        description: 'Reads one key, or the whole record when called with no argument.',
        returns: 'The value for the key, or a snapshot of every key.',
        example: ex`
profile.get('theme');   // 'dark'
profile.get();          // { name: 'Ada', theme: 'dark' }`
    },
    'DataStore.set': {
        description: `Writes one key, or several from an object. Each key notifies independently, so a binding
            on one field is not woken by a change to another.`,
        returns: 'The store.',
        example: ex`
profile.set('theme', 'light');
profile.set({ name: 'Grace', theme: 'dark' });`
    },
    'DataStore.update': {
        description: 'Writes one key from its current value.',
        returns: 'The store.',
        throws: '<code>TypeError</code> without an updater function.',
        example: ex`
cart.update('count', n => n + 1);`
    },
    'DataStore.has': { description: 'Whether a key is present.', returns: '<code>boolean</code>.' },
    'DataStore.delete': {
        description: `Removes a key, notifying its observers with <code>undefined</code>. Listeners stay
            attached, so they fire again if the key is set later.`,
        returns: '<code>boolean</code>, whether the key existed.'
    },
    'DataStore.signal': {
        description: 'A readable for one key, so a single field can be bound without re-rendering anything else.',
        returns: 'A readable signal for that key.',
        example: ex`
profile.signal('theme').bindText(themeLabel);`
    },
    'DataStore.onChange': {
        description: 'Observes one key. Accepts an <code>AbortSignal</code> to stop observing.',
        returns: 'An unsubscribe function.'
    },
    'DataStore.onAnyChange': { description: 'Observes every key, receiving <code>(key, value, previous)</code>.', returns: 'An unsubscribe function.' },
    'DataStore.offChange': { description: 'Removes an observer by key and callback.' },
    'DataStore.dispose': { description: 'Releases the store, its per-key signals, and every observer.' },
    'DataStore.disposed': { description: 'Whether the store has been disposed.' },

    // ----------------------------------------------------------------- async
    'AsyncState.__order': ['run', 'retry', 'cancel', 'reset', 'dispose', 'disposed'],
    'AsyncState.run': {
        description: `Runs a task, moving through <code>loading</code> (or <code>refreshing</code> when data is
            already held) to <code>success</code> or <code>error</code>. A later run aborts the earlier
            one by default, and a superseded result can never overwrite a newer one.`,
        params: [['task', 'Receives <code>{ signal }</code> to pass to <code>fetch</code> or any abortable work.'],
                 ['options', '<code>abortPrevious: false</code> lets runs overlap.']],
        returns: 'A promise resolving to the resulting snapshot. It never rejects — read <code>error</code>.',
        example: ex`
let { status, data, error } = await users.run(({ signal }) =>
    fetch('/api/users', { signal }).then(response => response.json())
);
if (status === 'error') report(error);`
    },
    'AsyncState.retry': { description: 'Runs the previous task again.', returns: 'A promise resolving to the resulting snapshot.' },
    'AsyncState.cancel': { description: 'Aborts work in flight and returns to <code>idle</code>, or to <code>success</code> when data is already held.' },
    'AsyncState.reset': { description: 'Aborts work in flight and returns to the initial data and <code>idle</code>.' },
    'AsyncState.dispose': {
        description: `Aborts work in flight and releases the state from its scope, without waiting for the scope
            itself. Idempotent.`,
        note: 'Disposal aborts but does not announce: subscribers are not notified, because they are being disposed alongside it.'
    },
    'AsyncState.disposed': { description: 'Whether the async state has been disposed.' },
    'AsyncSnapshot.status': { description: 'One of <code>idle</code>, <code>loading</code>, <code>refreshing</code>, <code>success</code>, or <code>error</code>. <code>refreshing</code> means existing data is retained while a new request runs.' },
    'AsyncSnapshot.data': { description: 'The last successful value, retained across a refresh and across a failure.' },
    'AsyncSnapshot.error': { description: 'The failure, when the status is <code>error</code>.' },

    // ---------------------------------------------------------------- structure
    'TreeConfig.tag': { description: 'The tag to create. Required.' },
    'TreeConfig.text': { description: 'Text content, or a readable for reactive text. Always written as a text node; markup is never parsed.' },
    'TreeConfig.attributes': {
        description: 'Attributes to set. A value may be a readable, which binds the attribute.',
        example: ex`
{ tag: 'button', attributes: { type: 'button', disabled: busy } }`
    },
    'TreeConfig.class': {
        description: `A class name, an array of them, or a map of name to readable or boolean, which binds each
            class.`,
        example: ex`
{ tag: 'div', class: { panel: true, 'is-busy': busy } }`
    },
    'TreeConfig.properties': {
        description: 'Native properties written verbatim.',
        note: `This is a deliberate escape hatch, not a text path: <code>properties: { innerHTML }</code>
            parses markup exactly as the DOM would. Never pass untrusted input through it.`
    },
    'TreeConfig.on': { description: 'An event map. A value may be a handler, or <code>{ handler, options }</code> for listener options.' },
    'TreeConfig.children': {
        description: `An array of child configurations, elements, nodes, or strings — or a reactive list, which
            renders the container's entire contents.`,
        example: ex`
{
    tag: 'ul',
    children: {
        each: rows,
        key: row => row.id,
        render: row => sculptor.tree({ tag: 'li', text: row.label }),
        update: (element, row) => element.setText(row.label)
    }
}`
    },
    'TreeConfig.ref': { description: 'Names this node in the <code>refs</code> object given at the root, so it can be reached without a selector.' },
    'TreeConfig.refs': {
        description: 'Root level only: an object filled with every node in the tree that declares a <code>ref</code>.',
        example: ex`
let refs = {};
sculptor.tree({ tag: 'form', refs, children: [{ tag: 'input', ref: 'email' }] });
refs.email.setValue('someone@example.com');`
    },
    'TreeList.each': { description: 'The readable holding the collection.' },
    'TreeList.key': { description: 'Optional. With a key the list is keyed and rows keep their identity; without one, rows are replaced.' },
    'TreeList.render': { description: 'Builds a row.' },
    'TreeList.update': { description: 'Applies changed data to a reused row.' },

    // ------------------------------------------------------------------ virtual
    'VirtualListOptions.rowHeight': { description: 'Fixed row height in pixels. Required, and the basis for every range calculation.' },
    'VirtualListOptions.render': { description: 'Builds a row from an item. May return a <code>DomElement</code> or a reusable <code>VirtualRow</code>.' },
    'VirtualListOptions.overscan': { description: 'Extra rows kept above and below the viewport, smoothing fast scrolling. Defaults to 4.' },
    'VirtualListOptions.key': { description: 'Stable identity per item, enabling row reuse across updates. Duplicates are rejected before any DOM change.' },
    'VirtualListOptions.aria': { description: 'Set <code>false</code> to omit the <code>role</code> and position metadata when you are supplying your own.' },
    'VirtualRow.root': { description: 'The row element.' },
    'VirtualRow.update': {
        description: 'Applies a different item to a reused row.',
        note: 'Not called while the row holds focus, so a refresh cannot overwrite a half-typed value.'
    },
    'VirtualRow.dispose': { description: 'Releases anything the row owns beyond its element, called when the row leaves the mounted range.' },
    'VirtualListStatus.rendering': { description: 'Whether a pass is queued.' },
    'VirtualListStatus.start': { description: 'First mounted index, including overscan.' },
    'VirtualListStatus.end': { description: 'One past the last mounted index.' },
    'VirtualListStatus.mounted': { description: 'How many rows exist in the DOM — the number to watch against <code>total</code>.' },
    'VirtualListStatus.total': { description: 'Size of the whole collection.' },
    'VirtualScrollOptions.align': { description: '<code>start</code>, <code>center</code>, <code>end</code>, or <code>nearest</code>. Defaults to <code>nearest</code>.' },

    // ------------------------------------------------------------------ routing
    'Router.current': { description: 'A readable snapshot of the active route, for titles, navigation state, and derived values.' },
    'Router.navigate': { description: 'Navigates by <code>pushState</code>, or by fragment in hash mode.', throws: '<code>TypeError</code> for an empty path.' },
    'Router.replace': { description: 'As <code>navigate</code>, replacing the current history entry.' },
    'Router.stop': { description: 'Stops routing, removes the listener, and disposes the mounted view and its scope. Idempotent.' },
    'Router.stopped': { description: 'Whether the router has been stopped.' },
    'RouteSnapshot.path': { description: 'The matched path.' },
    'RouteSnapshot.route': { description: 'The pattern that matched, or <code>null</code> when nothing did.' },
    'RouteSnapshot.params': {
        description: 'Decoded parameters. A <code>*</code> route provides <code>rest</code>.',
        note: `<code>*</code> is a whole-path wildcard, so <code>'*'</code> keeps the leading slash in
            <code>rest</code> while <code>'/*'</code> captures only the remainder.`
    },
    'RouteViewSnapshot.scope': {
        description: `The scope the router created for this view. Ask <code>scope.disposed</code> in an
            asynchronous continuation to find out whether the route is still on screen.`,
        example: ex`
'/posts/:slug': ({ params, scope }) => {
    let post = sculptor.signal(null);
    load(params.slug).then(value => {
        if (scope.disposed) return;   // the reader navigated away
        post.set(value);
    });
    return view(post);
}`
    },
    'RouterOptions.parent': { description: 'The outlet the active view is mounted into. Defaults to <code>document.body</code>.' },
    'RouterOptions.hash': { description: 'Route on the URL fragment instead of the path, for static hosting and extensions that cannot rewrite server paths.' },

    // --------------------------------------------------------------- components
    'ComponentDefinition.root': { description: 'The element the component renders. Required.' },
    'ComponentDefinition.api': { description: 'Methods the parent may call, kept separate from the DOM so a component exposes behaviour rather than internals.' },
    'ComponentDefinition.dispose': { description: 'Extra cleanup, run with the component’s scope.' },
    'ComponentInstance.root': { description: 'The rendered element.' },
    'ComponentInstance.api': { description: 'Whatever the definition exposed.' },
    'ComponentInstance.scope': { description: 'The disposal scope owning everything the factory created.' },
    'ComponentInstance.context': { description: 'The context the instance was created with.' },
    'ComponentInstance.name': { description: 'The name from options, or the factory’s name. Used in diagnostics.' },
    'ComponentInstance.createdAt': { description: 'A creation stack, captured only on a development runtime, for tracing a leaked instance back to its origin.' },
    'ComponentInstance.dispose': { description: 'Disposes the scope, and with it the root and everything created inside the factory. Idempotent.' },
    'ComponentInstance.disposed': { description: 'Whether the instance has been disposed.' },

    'DisposalScope.track': {
        description: 'Registers custom cleanup, for resources the library does not own itself.',
        returns: 'The cleanup function.',
        throws: '<code>TypeError</code> without a function.',
        example: ex`
scope.track(() => clearInterval(timer));`
    },
    'DisposalScope.run': {
        description: 'Runs a callback with this scope active, so everything created inside belongs to it.',
        returns: 'Whatever the callback returns.',
        throws: '<code>Error</code> if the scope is already disposed.'
    },
    'DisposalScope.dispose': {
        description: `Releases everything in reverse order of creation, so a subscription made after the element
            it writes into is released first. Every cleanup is attempted even when some fail, and
            multiple failures are reported together as an <code>AggregateError</code>.`
    },
    'DisposalScope.disposed': { description: 'Whether the scope has been disposed.' },
    'Context.get': { description: 'Reads a value, falling back through parent contexts and then to the supplied default.', returns: 'The value, or the fallback.' },
    'Context.has': { description: 'Whether the key resolves here or in a parent.', returns: '<code>boolean</code>.' },
    'Context.set': { description: 'Sets a value on this context.', returns: 'The context.' },
    'Context.delete': { description: 'Removes a local value, after which the key resolves through the parent again.', returns: '<code>boolean</code>.' },
    'Context.child': { description: 'Creates a child context that inherits from this one and may override any key.', returns: 'The child <code>Context</code>.' }
};
