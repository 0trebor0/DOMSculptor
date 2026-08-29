// Prose and worked examples for docs/reference.html, merged with signatures
// extracted from types/index.d.ts by build.mjs. Keys are `Type.member`.
//
// `Type.__order` puts the members of a type in a reading order rather than the
// order they happen to be declared in.

export let intro = `Every public member, with what it takes, what it gives back, how it fails, and a
worked example. Read the <a href="./index.html">concept tour</a> first if you are
new; use this page while you are writing code.`;

export let groups = [
    {
        id: 'runtime',
        eyebrow: 'Runtime and ownership',
        title: 'DomSculptor',
        summary: `A runtime owns a scheduler, a scope stack, and an element registry. Create one per
            application, or several when interfaces need isolated flushing and diagnostics.
            Everything created through a runtime has an owner, so nothing needs manual cleanup
            that the runtime cannot do for you.`,
        types: ['DomSculptor', 'DomSculptorOptions', 'DevDomSculptor', 'DevelopmentWarning']
    },
    {
        id: 'elements',
        eyebrow: 'Elements',
        title: 'DomElement',
        summary: `A thin, owned wrapper around one native node. Mutating methods return the same
            wrapper so calls chain; <code>html</code> is the escape hatch to the node itself.`,
        types: ['DomElement', 'DomAttributes', 'DomClasses', 'DomChildren']
    },
    {
        id: 'state',
        eyebrow: 'Reactive state',
        title: 'Signals, computed values, and bindings',
        summary: `A signal holds a value and notifies on change. Bindings connect one to the DOM and
            release themselves with the element they wrote into.`,
        types: ['State', 'Computed', 'Readable', 'SubscriptionOptions', 'KeyedListOptions', 'FormBindingOptions']
    },
    {
        id: 'stores',
        eyebrow: 'Keyed state',
        title: 'Stores',
        summary: `A store is an object of independently observable keys, with a signal available per
            key when you want to bind one field.`,
        types: ['DataStore']
    },
    {
        id: 'async',
        eyebrow: 'Asynchronous work',
        title: 'Async state',
        summary: `Status, data, and error in one snapshot, with cancellation built in. Runs never
            reject: the snapshot is the result.`,
        types: ['AsyncState', 'AsyncSnapshot']
    },
    {
        id: 'structure',
        eyebrow: 'Declarative structure',
        title: 'Trees',
        summary: `<code>tree()</code> builds a detached hierarchy from a configuration object. Text is
            always text; reactive values are accepted for text, attributes, classes, and children.`,
        types: ['TreeConfig', 'TreeList']
    },
    {
        id: 'virtual',
        eyebrow: 'Large collections',
        title: 'Virtual lists',
        summary: `Only the visible range plus overscan exists in the DOM, while a spacer of the full
            collection height keeps the scrollbar honest.`,
        types: ['VirtualListOptions', 'VirtualRow', 'VirtualListStatus', 'VirtualScrollOptions']
    },
    {
        id: 'routing',
        eyebrow: 'Routing',
        title: 'Router',
        summary: `One route mounted at a time, each view in its own scope, with the previous view
            disposed on every change.`,
        types: ['Router', 'RouteSnapshot', 'RouteViewSnapshot', 'RouterOptions']
    },
    {
        id: 'components',
        eyebrow: 'Composition and lifetime',
        title: 'Components, scopes, and contexts',
        summary: `A component is a factory with a disposal scope. A scope owns whatever is created
            inside it. A context passes values down without threading them through props.`,
        types: ['ComponentDefinition', 'ComponentInstance', 'DisposalScope', 'Context']
    }
];

import { runtime } from './parts/runtime.mjs';
import { elements } from './parts/elements.mjs';
import { state } from './parts/state.mjs';
import { data } from './parts/data.mjs';

export let content = { ...runtime, ...elements, ...state, ...data };
