import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class FakeNode extends EventTarget {
    constructor(tagName = '') {
        super();
        this.tagName = tagName;
        this.nodeName = tagName.toUpperCase();
        this.parentNode = null;
        this.childNodes = [];
        this.nodeType = tagName === '#text' ? 3 : 1;
        this._textContent = '';
        this.style = {};
        this.attributes = new Map();
        this._classes = new Set();
        this.classList = {
            add: (...values) => values.forEach(value => this._classes.add(value)),
            remove: (...values) => values.forEach(value => this._classes.delete(value)),
            toggle: value => this._classes.has(value) ? !this._classes.delete(value) : Boolean(this._classes.add(value)),
            contains: value => this._classes.has(value)
        };
    }

    appendChild(child) { return this._insert(child, this.childNodes.length); }
    prepend(child) { return this._insert(child, 0); }
    insertBefore(child, reference) {
        return this._insert(child, reference === null ? this.childNodes.length : this.childNodes.indexOf(reference));
    }
    replaceChild(next, previous) {
        if (!this.childNodes.includes(previous)) throw new Error('Child not found');
        if (next.parentNode) next.parentNode.removeChild(next);
        let index = this.childNodes.indexOf(previous);
        this.childNodes[index] = next;
        previous.parentNode = null;
        next.parentNode = this;
        return previous;
    }
    _insert(child, index) {
        if (child.parentNode) child.parentNode.removeChild(child);
        this.childNodes.splice(index, 0, child);
        child.parentNode = this;
        return child;
    }
    removeChild(child) {
        let index = this.childNodes.indexOf(child);
        if (index !== -1) this.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
    }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() {
        if (!this.parentNode) return null;
        return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;
    }
    get children() { return this.childNodes.filter(node => node.nodeType === 1); }
    get textContent() {
        if (this.nodeType === 3) return this._textContent;
        return this.childNodes.length
            ? this.childNodes.map(node => node.textContent).join('')
            : this._textContent;
    }
    set textContent(value) {
        let next = String(value ?? '');
        if (this.nodeType === 3) {
            this._textContent = next;
            return;
        }
        this.childNodes.forEach(child => { child.parentNode = null; });
        this.childNodes = [];
        this._textContent = '';
        if (next) {
            let text = new FakeNode('#text');
            text.textContent = next;
            this.appendChild(text);
        }
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    removeAttribute(name) { this.attributes.delete(name); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    matches(selector) {
        if (selector.startsWith('.')) return this._classes.has(selector.slice(1));
        if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1);
        return this.tagName === selector;
    }
    querySelectorAll(selector) {
        return this.childNodes.flatMap(node => [
            ...(node.matches?.(selector) ? [node] : []),
            ...node.querySelectorAll(selector)
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) {
        for (let node = this; node; node = node.parentNode) {
            if (node.matches?.(selector)) return node;
        }
        return null;
    }
}

globalThis.Node = FakeNode;
globalThis.document = {
    body: new FakeNode('body'),
    createElement: tag => new FakeNode(tag),
    createTextNode: text => Object.assign(new FakeNode('#text'), { textContent: text }),
    querySelector: () => null
};

let {
    default: DomSculptor,
    DevDomSculptor,
    createDevSculptor,
    signal,
    computed,
    effect,
    flush,
    tree,
    asyncState
} = await import('../src/index.js');
let { createTestHarness, createLazyComponent } = await import('../src/index.js');

let withManualAnimationFrames = async callback => {
    let originalRequest = globalThis.requestAnimationFrame;
    let originalCancel = globalThis.cancelAnimationFrame;
    let callbacks = new Map();
    let nextId = 1;
    globalThis.requestAnimationFrame = frameCallback => {
        let id = nextId++;
        callbacks.set(id, frameCallback);
        return id;
    };
    globalThis.cancelAnimationFrame = id => callbacks.delete(id);
    try {
        await callback({
            pending: () => callbacks.size,
            async runNext() {
                let next = callbacks.entries().next().value;
                if (!next) throw new Error('Expected a pending animation frame.');
                callbacks.delete(next[0]);
                next[1](0);
                await Promise.resolve();
            }
        });
    } finally {
        if (originalRequest === undefined) delete globalThis.requestAnimationFrame;
        else globalThis.requestAnimationFrame = originalRequest;
        if (originalCancel === undefined) delete globalThis.cancelAnimationFrame;
        else globalThis.cancelAnimationFrame = originalCancel;
    }
};

test('main module exposes convenience APIs from the single source entry', () => {
    let value = signal(1);
    let doubled = computed(() => value.get() * 2, [value]);
    assert.equal(doubled.get(), 2);
    let node = tree({ tag: 'div', text: 'main entry' });
    assert.equal(node.html.textContent, 'main entry');
    assert.equal(asyncState().get().status, 'idle');
    doubled.dispose();
    value.dispose();
    node.dispose();
});

test('development entry point emits structured diagnostics without changing production defaults', async () => {
    let warnings = [];
    let first = createDevSculptor({ onWarning: warning => warnings.push(warning) });
    let second = createDevSculptor({ onWarning: warning => warnings.push(warning) });
    let node = first.create('div');
    second.wrap(node.html);

    let value = first.signal(0);
    value.subscribe(() => {});
    value.dispose();

    let disposed = first.create('span');
    disposed.dispose();
    assert.throws(() => disposed.setText('invalid'), /disposed/);
    assert.throws(() => first.create('div').child.append(null), TypeError);

    let writeTarget = first.signal(0);
    let scope = first.createScope();
    scope.track(() => writeTarget.set(1));
    scope.dispose();

    let LeakingComponent = first.component(() => first.create('section'), { name: 'LeakingComponent' });
    let component = LeakingComponent();
    assert.equal(first.reportLeaks(), 1);
    let leakWarning = warnings.find(warning => warning.code === 'component-scope-leak');
    assert.equal(leakWarning.details.name, 'LeakingComponent');
    assert.match(leakWarning.details.createdAt, /Error/);
    component.dispose();
    assert.equal(first.reportLeaks(), 0);
    assert.deepEqual(warnings.map(warning => warning.code), [
        'wrapper-ownership',
        'subscription-cleanup',
        'disposed-element-operation',
        'invalid-child',
        'write-during-disposal',
        'component-scope-leak'
    ]);
});

test('testing harness owns fixtures, flushes deterministically, and reports component leaks', () => {
    let harness = createTestHarness(document.body);
    let value = harness.sculptor.signal('before');
    let element = harness.sculptor.create('span');
    value.bindText(element);
    harness.mount(element);
    value.set('after');
    harness.flush();
    assert.equal(element.html.textContent, 'after');

    let Leaking = harness.sculptor.component(() => harness.sculptor.create('section'));
    let component = Leaking();
    assert.throws(() => harness.assertClean(), /1 component scope/);
    component.dispose();
    harness.assertClean();

    let Mounted = harness.sculptor.component(() => harness.sculptor.create('article'));
    let mounted = Mounted();
    harness.mount(mounted);
    harness.dispose();
    harness.dispose();
    assert.equal(mounted.disposed, true);
    assert.equal(harness.disposed, true);

    let failingHarness = createTestHarness(document.body);
    let cleanupCalls = [];
    let Failing = failingHarness.sculptor.component(() => ({
        root: failingHarness.sculptor.create('div'),
        dispose() { cleanupCalls.push('failing'); throw new Error('cleanup failed'); }
    }));
    let Following = failingHarness.sculptor.component(() => ({
        root: failingHarness.sculptor.create('div'),
        dispose() { cleanupCalls.push('following'); }
    }));
    failingHarness.mount(Failing());
    failingHarness.mount(Following());
    assert.throws(() => failingHarness.dispose(), /cleanup failed/);
    assert.deepEqual(cleanupCalls, ['failing', 'following']);
    assert.equal(failingHarness.root.html, null);
});

test('lazy components load native modules, expose status, and abort on disposal', async () => {
    let sculptor = new DomSculptor();
    let Loaded = sculptor.component((props) => ({
        root: sculptor.create('strong').setText(props.label),
        api: { loaded: true }
    }));
    let Lazy = createLazyComponent(
        sculptor,
        async ({ signal }) => {
            assert.equal(signal.aborted, false);
            return { default: Loaded };
        },
        { loading: 'Loading', name: 'LazyFeature' }
    );

    let instance = Lazy({ label: 'Ready' });
    assert.equal(instance.name, 'LazyFeature');
    assert.equal(instance.root.html.textContent, 'Loading');
    assert.equal(instance.api.status.get().status, 'loading');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(instance.root.html.textContent, 'Ready');
    assert.equal(instance.api.status.get().status, 'success');
    instance.dispose();

    let observedSignal;
    let Never = createLazyComponent(sculptor, ({ signal }) => {
        observedSignal = signal;
        return new Promise(() => {});
    });
    let pending = Never({});
    await Promise.resolve();
    pending.dispose();
    assert.equal(observedSignal.aborted, true);
});

test('off cancels a once listener', () => {
    let el = new DomSculptor().create('button');
    let calls = 0;
    let listener = () => calls++;
    el.once('click', listener).off('click', listener);
    el.html.dispatchEvent(new Event('click'));
    assert.equal(calls, 0);
});

test('once fires exactly once', () => {
    let el = new DomSculptor().create('button');
    let calls = 0;
    el.once('click', () => calls++);
    el.html.dispatchEvent(new Event('click'));
    el.html.dispatchEvent(new Event('click'));
    assert.equal(calls, 1);
});

test('event options are accepted and capture listeners are removed correctly', () => {
    let el = new DomSculptor().create('button');
    let calls = 0;
    let listener = () => calls++;
    el.on('click', listener, { capture: true, passive: true });
    el.off('click', listener);
    el.html.dispatchEvent(new Event('click'));
    assert.equal(calls, 0);
});

test('aborting event listeners releases internal callback references', () => {
    let element = new DomSculptor().create('button');
    let controller = new AbortController();
    let calls = 0;
    element.on('click', () => calls++, { signal: controller.signal });
    assert.equal(element._listeners.click.length, 1);
    controller.abort();
    assert.equal(element._listeners.click, undefined);
    element.html.dispatchEvent(new Event('click'));
    assert.equal(calls, 0);

    let aborted = new AbortController();
    aborted.abort();
    element.once('click', () => calls++, { signal: aborted.signal });
    assert.equal(element._listeners.click, undefined);
});

test('remove cleans up regular and once listeners', () => {
    let el = new DomSculptor().create('button');
    let node = el.html;
    let calls = 0;
    el.on('click', () => calls++).once('click', () => calls++);
    el.remove();
    node.dispatchEvent(new Event('click'));
    assert.equal(calls, 0);
});

test('moving a child transfers parent ownership', () => {
    let sculptor = new DomSculptor();
    let first = sculptor.create('div');
    let second = sculptor.create('div');
    let child = first.child.create('span');
    second.child.append(child);
    assert.deepEqual(first.children, []);
    assert.deepEqual(second.children, [child]);
    first.remove();
    assert.notEqual(child.html, null);
});

test('moving a known native node transfers wrapper ownership', () => {
    let sculptor = new DomSculptor();
    let first = sculptor.create('div');
    let second = sculptor.create('div');
    let child = first.child.create('span');
    second.child.append(child.html);
    assert.deepEqual(first.children, []);
    assert.deepEqual(second.children, [child]);
    assert.equal(child.parent(), second);
});

test('parent traversal reconciles ownership after an external native move', () => {
    let sculptor = new DomSculptor();
    let first = sculptor.create('div');
    let second = sculptor.create('div');
    let child = first.child.create('span');
    second.html.appendChild(child.html);
    assert.equal(child.parent(), second);
    assert.deepEqual(first.children, []);
    assert.deepEqual(second.children, [child]);
});

test('sibling insertion uses the actual parent after an external move', () => {
    let sculptor = new DomSculptor();
    let first = sculptor.create('div');
    let second = sculptor.create('div');
    let reference = first.child.create('span');
    let sibling = sculptor.create('strong');
    second.html.appendChild(reference.html);
    reference.before(sibling);
    assert.deepEqual(first.children, []);
    assert.deepEqual(second.children, [sibling, reference]);
    assert.equal(sibling.parent(), second);
});

test('multiple sculptor instances reuse one wrapper per native node', () => {
    let firstSculptor = new DomSculptor();
    let secondSculptor = new DomSculptor();
    let element = firstSculptor.create('div');
    assert.equal(secondSculptor.wrap(element.html), element);
});

test('creating through a known native parent tracks wrapper ownership', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let child = sculptor.create('span', parent.html);
    assert.deepEqual(parent.children, [child]);
    assert.equal(child.parent(), parent);
});

test('creating with a removed parent throws without creating stale ownership', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    parent.remove();
    assert.throws(() => sculptor.create('span', parent), /parent has been disposed/);
    assert.deepEqual(parent.children, []);
});

test('failed native insertion preserves existing ownership', () => {
    let sculptor = new DomSculptor();
    let source = sculptor.create('div');
    let target = sculptor.create('div');
    let child = source.child.create('span');
    target.html.appendChild = () => { throw new Error('append failed'); };
    assert.throws(() => target.child.append(child), /append failed/);
    assert.deepEqual(source.children, [child]);
    assert.deepEqual(target.children, []);
    assert.equal(child.parent(), source);
});

test('failed create insertion does not record phantom children', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    parent.html.appendChild = () => { throw new Error('append failed'); };
    assert.throws(() => sculptor.create('span', parent), /append failed/);
    assert.deepEqual(parent.children, []);
});

test('removing a child clears parent tracking', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let child = parent.child.create('span');
    child.remove();
    assert.deepEqual(parent.children, []);
});

test('setText cleans wrappers for replaced children', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let child = parent.child.create('span');
    parent.setText('replacement');
    assert.equal(child.html, null);
    assert.deepEqual(parent.children, []);
    assert.equal(parent.html.textContent, 'replacement');
});

test('clear cleans known wrappers inside pre-existing DOM', () => {
    let nativeParent = new FakeNode('div');
    let nativeMiddle = new FakeNode('section');
    let nativeChild = new FakeNode('span');
    nativeMiddle.appendChild(nativeChild);
    nativeParent.appendChild(nativeMiddle);
    let sculptor = new DomSculptor();
    let parent = sculptor.wrap(nativeParent);
    let child = sculptor.wrap(nativeChild);
    parent.child.clear();
    assert.equal(child.html, null);
    assert.equal(nativeParent.childNodes.length, 0);
});

test('clear does not remove a sibling moved by an earlier removal hook', () => {
    let sculptor = new DomSculptor();
    let source = sculptor.create('div');
    let destination = sculptor.create('div');
    let first = source.child.create('span');
    let rescued = source.child.create('span');
    first.onRemove(() => destination.child.append(rescued));
    source.child.clear();
    assert.equal(rescued.html.parentNode, destination.html);
    assert.deepEqual(destination.children, [rescued]);
});

test('state notification is stable when a subscriber unsubscribes', () => {
    let state = new DomSculptor().state(0);
    let calls = [];
    let unsubscribeSecond;
    state.subscribe(() => { calls.push('first'); unsubscribeSecond(); });
    unsubscribeSecond = state.subscribe(() => calls.push('second'));
    state.subscribe(() => calls.push('third'));
    state.set(1);
    assert.deepEqual(calls, ['first', 'second', 'third']);
});

test('nested signal writes update immediately and deliver each value in order', () => {
    let signal = new DomSculptor().signal(0);
    let calls = [];
    signal.subscribe(value => {
        calls.push(`first:${value}:${signal.get()}`);
        if (value === 1) signal.set(2);
    });
    signal.subscribe(value => calls.push(`second:${value}:${signal.get()}`));
    signal.set(1);
    assert.equal(signal.get(), 2);
    assert.deepEqual(calls, [
        'first:1:1',
        'second:1:2',
        'first:2:2',
        'second:2:2'
    ]);
});

test('detached creation separates creation, mounting, adoption, and unmounting', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('main');
    let element = sculptor.createDetached('article');
    assert.equal(element.html.parentNode, null);
    assert.equal(sculptor.mount(element, parent), element);
    assert.equal(element.parent(), parent);
    assert.equal(sculptor.unmount(element), element);
    assert.equal(element.html.parentNode, null);
    assert.notEqual(element.html, null);
    sculptor.mount(element, parent.html);
    assert.equal(sculptor.adopt(element.html), element);
    assert.throws(() => sculptor.mount(element, '#missing'), /could not find parent/);
});

test('create is detached by default and supports a detached callback overload', () => {
    let sculptor = new DomSculptor();
    let bodyChildren = document.body.childNodes.length;
    let callbackElement;
    let element = sculptor.create('article', created => {
        callbackElement = created;
        created.setText('detached');
    });
    assert.equal(callbackElement, element);
    assert.equal(element.html.parentNode, null);
    assert.equal(document.body.childNodes.length, bodyChildren);
    assert.equal(element.html.textContent, 'detached');
});

test('strict wrapping and mounting have explicit non-throwing alternatives', () => {
    let sculptor = new DomSculptor();
    let element = sculptor.createDetached('div');

    assert.throws(() => sculptor.wrap('#missing'), /could not find/);
    assert.equal(sculptor.tryWrap('#missing'), null);
    assert.throws(() => sculptor.wrap(null), TypeError);
    assert.equal(sculptor.tryWrap(null), null);

    assert.throws(() => sculptor.mount(element, '#missing'), /could not find parent/);
    assert.equal(sculptor.tryMount(element, '#missing'), null);
    assert.equal(element.parent(), null);
    assert.equal(sculptor.tryMount(element, document.body), element);
});

test('programmer errors throw TypeError instead of logging and continuing', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let child = parent.child.create('span');
    let data = sculptor.data();

    assert.throws(() => parent.attribute.set(null), TypeError);
    assert.throws(() => parent.child.append(null), TypeError);
    assert.throws(() => parent.child.prepend(false), TypeError);
    assert.throws(() => parent.child.replace(child, null), TypeError);
    assert.throws(() => parent.setStyle('display'), TypeError);
    assert.throws(() => parent.once('click', null), TypeError);
    assert.throws(() => sculptor.create('div', null, 'invalid'), TypeError);
    assert.throws(() => data.set(1, 'value'), TypeError);
    assert.throws(() => data.update('key', null), TypeError);
    assert.throws(() => data.onChange('key', null), TypeError);
    assert.throws(() => data.onAnyChange(null), TypeError);
});

test('tree creates a detached safe hierarchy with reactive text and events', () => {
    let sculptor = new DomSculptor();
    let title = sculptor.signal('Initial');
    let clicks = 0;
    let card = sculptor.tree({
        tag: 'article',
        class: ['card', 'raised'],
        attributes: { role: 'region' },
        properties: { tabIndex: 0 },
        children: [
            { tag: 'h2', text: title },
            ['body ', { tag: 'button', text: 'Close', on: { click: () => clicks++ } }]
        ]
    });
    assert.equal(card.html.parentNode, null);
    assert.equal(card.class.contains('card'), true);
    assert.equal(card.attribute.get('role'), 'region');
    assert.equal(card.html.tabIndex, 0);
    let heading = card.child.find('h2');
    let button = card.child.find('button');
    assert.equal(heading.html.firstChild.textContent, 'Initial');
    title.set('Updated');
    sculptor.flush();
    assert.equal(heading.html.firstChild.textContent, 'Updated');
    button.html.dispatchEvent(new Event('click'));
    assert.equal(clicks, 1);
});

test('conditional rendering switches branches and disposes factory branches', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('main');
    let open = sculptor.signal(false);
    let panel = sculptor.createIn(parent, 'section').setText('open');
    let closedDisposed = 0;
    let stop = sculptor.when(open, panel, {
        fallback: () => sculptor.createDetached('p')
            .setText('closed')
            .onRemove(() => closedDisposed++)
    });
    assert.equal(panel.html.parentNode, null);
    assert.equal(parent.children[0].html.textContent, 'closed');
    open.set(true);
    sculptor.flush();
    assert.equal(parent.children[0], panel);
    assert.equal(closedDisposed, 1);
    open.set(false);
    sculptor.flush();
    assert.equal(panel.html.parentNode, null);
    stop();
    assert.equal(parent.children.length, 0);
});

test('disposal scopes clean resources in reverse order and aggregate failures', () => {
    let sculptor = new DomSculptor();
    let scope = sculptor.createScope();
    let order = [];
    let failure = new Error('cleanup failed');
    scope.track(() => order.push('first'));
    scope.track(() => { order.push('second'); throw failure; });
    scope.track(() => order.push('third'));
    assert.throws(() => scope.dispose(), failure);
    assert.deepEqual(order, ['third', 'second', 'first']);
    scope.dispose();
    assert.equal(scope.disposed, true);
    assert.throws(() => scope.run(() => {}), /disposed scope/);
});

test('scopes automatically dispose elements, signals, effects, and async state', async () => {
    let sculptor = new DomSculptor();
    let scope = sculptor.createScope();
    let element;
    let signal;
    let effectCleanups = 0;
    let request;
    let aborted = false;
    scope.run(() => {
        element = sculptor.createDetached('button');
        signal = sculptor.signal(0);
        sculptor.effect(() => () => effectCleanups++, [signal]);
        request = sculptor.asyncState();
        request.run(({ signal: abortSignal }) => new Promise((resolve, reject) => {
            abortSignal.addEventListener('abort', () => {
                aborted = true;
                reject(new DOMException('Aborted', 'AbortError'));
            });
        })).catch(() => {});
    });
    await Promise.resolve();
    scope.dispose();
    assert.equal(element.html, null);
    assert.equal(signal.disposed, true);
    assert.equal(effectCleanups, 1);
    assert.equal(aborted, true);
});

test('scopes release listeners and bindings attached to external elements', () => {
    let sculptor = new DomSculptor();
    let scope = sculptor.createScope();
    let native = new FakeNode('button');
    let external = sculptor.adopt(native);
    let value = sculptor.signal('first');
    let clicks = 0;
    scope.run(() => {
        external.on('click', () => clicks++);
        value.bindText(external);
    });
    native.dispatchEvent(new Event('click'));
    assert.equal(clicks, 1);
    assert.equal(native.textContent, 'first');

    scope.dispose();
    native.dispatchEvent(new Event('click'));
    value.set('second');
    sculptor.flush();
    assert.equal(clicks, 1);
    assert.equal(native.textContent, 'first');
    assert.notEqual(external.html, null);
    value.dispose();
    external.dispose();
});

test('components created inside another component scope dispose with their parent', () => {
    let sculptor = new DomSculptor();
    let Child = sculptor.component(() => ({
        root: sculptor.create('span'),
        api: { value: sculptor.signal(1) }
    }));
    let Parent = sculptor.component(() => {
        let child = Child();
        let root = sculptor.create('div');
        root.child.append(child.root);
        return { root, api: { child } };
    });
    let parent = Parent();
    parent.dispose();
    assert.equal(parent.api.child.disposed, true);
    assert.equal(parent.api.child.api.value.disposed, true);
});

test('factory components expose props, API, context, and deterministic cleanup', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('main');
    let themeKey = Symbol('theme');
    let context = sculptor.createContext().set(themeKey, 'dark');
    let userCleanup = 0;
    let Counter = sculptor.component((props, componentContext) => {
        let count = sculptor.signal(props.initial ?? 0);
        let root = sculptor.tree({
            tag: 'section',
            attributes: { 'data-theme': componentContext.get(themeKey) },
            children: [
                { tag: 'span', text: count },
                { tag: 'button', text: '+', on: { click: () => count.update(value => value + 1) } }
            ]
        });
        return {
            root,
            api: { count },
            dispose() { userCleanup++; }
        };
    });
    let counter = Counter({ initial: 2 }, context);
    assert.equal(counter.api.count.get(), 2);
    assert.equal(counter.root.html.parentNode, null);
    assert.equal(sculptor.mount(counter, parent), counter);
    counter.root.child.find('button').html.dispatchEvent(new Event('click'));
    sculptor.flush();
    assert.equal(counter.root.child.find('span').html.textContent, '3');
    sculptor.unmount(counter);
    assert.notEqual(counter.root.html, null);
    sculptor.mount(counter, parent);
    counter.dispose();
    counter.dispose();
    assert.equal(counter.disposed, true);
    assert.equal(counter.root.html, null);
    assert.equal(counter.api.count.disposed, true);
    assert.equal(userCleanup, 1);
});

test('component error boundaries clean failed scopes and render deterministic fallbacks', () => {
    let sculptor = new DomSculptor();
    let failedSignal;
    let failure = new Error('component failed');
    let Broken = sculptor.component(() => {
        failedSignal = sculptor.signal(1);
        throw failure;
    });
    let Safe = sculptor.errorBoundary(Broken, (error, props) => ({
        root: sculptor.create('p').setText(`${props.label}: ${error.message}`),
        api: { error }
    }));

    let instance = Safe({ label: 'Fallback' });
    assert.equal(instance.root.html.textContent, 'Fallback: component failed');
    assert.equal(instance.api.error, failure);
    assert.equal(failedSignal.disposed, true);
    instance.dispose();
    assert.equal(instance.disposed, true);

    assert.throws(() => sculptor.errorBoundary(null, () => {}), TypeError);
    assert.throws(() => sculptor.errorBoundary(Broken, null), TypeError);
});

test('contexts inherit values and allow local overrides', () => {
    let sculptor = new DomSculptor();
    let key = Symbol('service');
    let parent = sculptor.createContext().set(key, 'parent');
    let child = parent.child();
    assert.equal(child.get(key), 'parent');
    child.set(key, 'child');
    assert.equal(child.get(key), 'child');
    assert.equal(parent.get(key), 'parent');
    assert.equal(child.get('missing', 'fallback'), 'fallback');
});

test('signal subscriptions support immediate delivery, abort cleanup, and disposal', () => {
    let signal = new DomSculptor().signal(2);
    let controller = new AbortController();
    let calls = [];
    let unsubscribe = signal.subscribe(value => calls.push(value), {
        immediate: true,
        signal: controller.signal
    });
    signal.set(3);
    controller.abort();
    unsubscribe();
    unsubscribe();
    signal.set(4);
    assert.deepEqual(calls, [2, 3]);
    signal.dispose();
    assert.equal(signal.disposed, true);
    assert.throws(() => signal.set(5), /disposed signal/);
    assert.throws(() => signal.subscribe(() => {}), /disposed signal/);
});

test('signals validate callbacks and aggregate multiple subscriber failures', () => {
    let signal = new DomSculptor().signal(0);
    assert.throws(() => signal.subscribe(null), TypeError);
    assert.throws(() => signal.update(null), TypeError);
    signal.subscribe(() => { throw new Error('first'); });
    signal.subscribe(() => { throw new Error('second'); });
    assert.throws(
        () => signal.set(1),
        error => error instanceof AggregateError && error.errors.length === 2
    );
});

test('computed values update only when changed and can be disposed', () => {
    let sculptor = new DomSculptor();
    let first = sculptor.signal('Ada');
    let last = sculptor.signal('Lovelace');
    let evaluations = 0;
    let full = sculptor.computed(() => {
        evaluations++;
        return `${first.get()} ${last.get()}`;
    }, [first, last]);
    let values = [];
    assert.equal(evaluations, 0);
    assert.equal(full.get(), 'Ada Lovelace');
    full.subscribe(value => values.push(value));
    first.set('Ada');
    last.set('Byron');
    assert.deepEqual(values, ['Ada Byron']);
    assert.equal(evaluations, 2);
    full.dispose();
    last.set('King');
    assert.throws(() => full.get(), /disposed computed/);
});

test('computed values reject direct evaluation cycles', () => {
    let sculptor = new DomSculptor();
    let recursive;
    recursive = sculptor.computed(() => recursive.get());
    assert.throws(() => recursive.get(), /cycle detected/);
    recursive.dispose();
});

test('effects clean up and batch deduplicates scheduled work', () => {
    let sculptor = new DomSculptor();
    let first = sculptor.signal(0);
    let second = sculptor.signal(0);
    let runs = [];
    let cleanups = 0;
    let stop = sculptor.effect(() => {
        runs.push([first.get(), second.get()]);
        return () => cleanups++;
    }, [first, second]);
    sculptor.batch(() => {
        first.set(1);
        second.set(2);
        first.set(3);
    });
    assert.deepEqual(runs, [[0, 0]]);
    sculptor.flush();
    assert.deepEqual(runs, [[0, 0], [3, 2]]);
    assert.equal(cleanups, 1);
    stop();
    stop();
    assert.equal(cleanups, 2);
});

test('DOM bindings are queued and flush uses the latest signal value', () => {
    let sculptor = new DomSculptor();
    let signal = sculptor.signal('first');
    let element = sculptor.create('p');
    signal.bindText(element);
    signal.set('second');
    signal.set('third');
    assert.equal(element.html.textContent, 'first');
    let child = sculptor.createDetached('strong').setText('preserved');
    element.child.append(child);
    sculptor.flush();
    assert.equal(element.html.textContent, 'thirdpreserved');
    assert.notEqual(child.html, null);
});

test('runtime instances isolate scheduling, flushing, scopes, and disposal state', () => {
    let first = new DomSculptor();
    let second = new DomSculptor();
    let firstValue = first.signal('first');
    let secondValue = second.signal('second');
    let firstElement = first.create('span');
    let secondElement = second.create('span');

    firstValue.bindText(firstElement);
    secondValue.bindText(secondElement);
    firstValue.set('first updated');
    secondValue.set('second updated');

    first.flush();
    assert.equal(firstElement.html.textContent, 'first updated');
    assert.equal(secondElement.html.textContent, 'second');
    second.flush();
    assert.equal(secondElement.html.textContent, 'second updated');

    let firstScope = first.createScope();
    let secondScopedValue;
    firstScope.run(() => {
        secondScopedValue = second.signal(1);
    });
    firstScope.dispose();
    assert.equal(secondScopedValue.disposed, false);

    secondScopedValue.dispose();
    firstValue.dispose();
    secondValue.dispose();
    firstElement.dispose();
    secondElement.dispose();
});

test('state notifies every subscriber before rethrowing listener errors', () => {
    let state = new DomSculptor().state(0);
    let calls = [];
    let failure = new Error('subscriber failed');
    state.subscribe(() => { calls.push('first'); throw failure; });
    state.subscribe(() => calls.push('second'));
    assert.throws(() => state.set(1), failure);
    assert.equal(state.get(), 1);
    assert.deepEqual(calls, ['first', 'second']);
    let nanState = new DomSculptor().state(0);
    let nanCalls = 0;
    nanState.subscribe(() => nanCalls++);
    nanState.set(Number.NaN);
    nanState.set(Number.NaN);
    assert.equal(nanCalls, 1);
});

test('state list finishes rerendering and later notifications when cleanup throws', () => {
    let sculptor = new DomSculptor();
    let state = sculptor.state(['first', 'second']);
    let container = sculptor.create('ul');
    state.list(container, item => sculptor.create('li').setText(item));
    let failure = new Error('list cleanup failed');
    container.children[0].onRemove(() => { throw failure; });
    let laterSubscriberCalled = false;
    state.subscribe(() => { laterSubscriberCalled = true; });
    assert.throws(() => state.set(['third', 'fourth']), failure);
    assert.equal(laterSubscriberCalled, true);
    assert.deepEqual(container.children.map(child => child.html.textContent), ['third', 'fourth']);
});

test('lifecycle hooks run on mount and once on removal', () => {
    let sculptor = new DomSculptor();
    let el = sculptor.create('section');
    let calls = [];
    el.onMount(mounted => calls.push(['mount', mounted]))
        .onRemove(removed => calls.push(['remove', removed]));
    sculptor.mount(el, document.body);
    el.remove();
    el.remove();
    assert.deepEqual(calls, [['mount', el], ['remove', el]]);
});

test('remove completes cleanup when lifecycle hooks throw or reenter', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let first = parent.child.create('span');
    let second = parent.child.create('span');
    let failure = new Error('hook failed');
    let calls = [];
    first.onRemove(element => { calls.push('first'); element.remove(); throw failure; });
    first.onRemove(() => calls.push('second'));
    assert.throws(() => parent.remove(), failure);
    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(parent.html, null);
    assert.equal(first.html, null);
    assert.equal(second.html, null);
});

test('DOM traversal returns wrapped parents, matches, and descendants', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('section').class.add('panel');
    let first = parent.child.create('span').class.add('item');
    parent.child.create('span').class.add('item');
    assert.equal(first.parent(), parent);
    assert.equal(first.closest('.panel').html, parent.html);
    assert.equal(parent.child.findAll('.item').length, 2);
    assert.equal(parent.childrenOf().length, 2);
    assert.equal(parent.childrenOf()[0], first);
    assert.equal(sculptor.wrap(first.html), first);
});

test('removing a traversed child clears its original parent ownership', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let child = parent.child.create('span');
    let traversed = parent.child.find('span');
    assert.equal(traversed, child);
    traversed.remove();
    assert.deepEqual(parent.children, []);
});

test('child manipulation replaces, orders, and clears wrapped elements', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let first = parent.child.create('p');
    let second = parent.child.create('p');
    let replacement = sculptor.create('strong', new FakeNode('detached'));
    parent.child.replace(first, replacement);
    assert.equal(parent.html.childNodes[0], replacement.html);
    let before = sculptor.create('i', new FakeNode('detached'));
    let after = sculptor.create('b', new FakeNode('detached'));
    second.before(before).after(after);
    assert.deepEqual(parent.children, [replacement, before, second, after]);
    parent.child.clear();
    assert.equal(parent.html.childNodes.length, 0);
    assert.deepEqual(parent.children, []);
});

test('replacing with a sibling keeps ownership in DOM order', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let first = parent.child.create('span');
    let second = parent.child.create('span');
    let third = parent.child.create('span');
    parent.child.replace(second, first);
    assert.deepEqual(parent.children, [first, third]);
    assert.deepEqual(parent.html.childNodes, [first.html, third.html]);
});

test('replacing known native nodes cleans and transfers wrapper ownership', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let previous = parent.child.create('span');
    let next = sculptor.create('strong');
    let previousNode = previous.html;
    parent.child.replace(previousNode, next.html);
    assert.equal(previous.html, null);
    assert.deepEqual(parent.children, [next]);
    assert.equal(next.parent(), parent);
});

test('replacing an unwrapped subtree cleans known descendant wrappers', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let nativeContainer = new FakeNode('section');
    let nativeChild = new FakeNode('span');
    nativeContainer.appendChild(nativeChild);
    parent.child.append(nativeContainer);
    let child = sculptor.wrap(nativeChild);
    parent.child.replace(nativeContainer, 'replacement');
    assert.equal(child.html, null);
});

test('replace finishes ownership updates when removal hooks throw', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let previous = parent.child.create('span');
    let next = sculptor.create('strong');
    let failure = new Error('replace cleanup failed');
    previous.onRemove(() => { throw failure; });
    assert.throws(() => parent.child.replace(previous, next), failure);
    assert.equal(previous.html, null);
    assert.deepEqual(parent.children, [next]);
    assert.equal(parent.html.childNodes[0], next.html);
});

test('direct bindings update text, value, attributes, classes, styles, and visibility', () => {
    let sculptor = new DomSculptor();
    let state = sculptor.state('ready');
    let el = sculptor.create('input');
    state.bindText(el);
    state.bindValue(el, value => value.toUpperCase());
    state.bindAttribute(el, 'aria-label');
    state.bindClass(el, 'active', value => value === 'ready');
    state.bindStyle(el, 'color', value => value === 'ready' ? 'green' : 'red');
    state.bindVisible(el, value => value !== 'hidden');
    assert.equal(el.html.textContent, 'ready');
    assert.equal(el.getValue(), 'READY');
    assert.equal(el.attribute.get('aria-label'), 'ready');
    assert.equal(el.class.contains('active'), true);
    assert.equal(el.html.style.color, 'green');
    state.set('hidden');
    sculptor.flush();
    assert.equal(el.class.contains('active'), false);
    assert.equal(el.html.style.display, 'none');
});

test('targeted reactive nodes update without clearing unrelated children', () => {
    let sculptor = new DomSculptor();
    let label = sculptor.signal('first');
    let expanded = sculptor.signal(false);
    let active = sculptor.signal(false);
    let opacity = sculptor.signal(0.5);
    let parent = sculptor.create('div');
    let child = parent.child.create('strong').setText('stable');

    parent
        .text(label)
        .attr('aria-expanded', expanded)
        .classToggle('active', active)
        .styleValue('opacity', opacity);
    assert.equal(parent.html.textContent, 'stablefirst');
    assert.equal(parent.children[0], child);

    label.set('second');
    expanded.set(true);
    active.set(true);
    opacity.set(1);
    sculptor.flush();
    assert.equal(parent.html.textContent, 'stablesecond');
    assert.equal(parent.attribute.get('aria-expanded'), '');
    assert.equal(parent.class.contains('active'), true);
    assert.equal(parent.html.style.opacity, 1);
    assert.equal(child.html.textContent, 'stable');
});

test('hide and show restore the previous inline display value', () => {
    let el = new DomSculptor().create('div').setStyle('display', 'grid');
    el.hide().hide().show();
    assert.equal(el.html.style.display, 'grid');
});

test('data notifies all listeners and completes bulk updates before rethrowing', () => {
    let data = new DomSculptor().data({ first: 0, second: 0 });
    let calls = [];
    let failure = new Error('data listener failed');
    data.onChange('first', () => { calls.push('key'); throw failure; });
    data.onAnyChange(key => calls.push(key));
    assert.throws(() => data.set({ first: 1, second: 2 }), failure);
    assert.deepEqual(data.get(), { first: 1, second: 2 });
    assert.deepEqual(calls, ['key', 'first', 'second']);
});

test('data treats prototype names as ordinary safe keys', () => {
    let data = new DomSculptor().data();
    let value = { safe: true };
    data.set('__proto__', value);
    assert.equal(data.get('__proto__'), value);
    assert.equal(Object.getPrototypeOf(data.get()), Object.prototype);
    assert.equal(Object.prototype.safe, undefined);
});

test('store aliases data and provides abort-aware, disposable subscriptions', () => {
    let sculptor = new DomSculptor();
    let store = sculptor.store({ count: 0 });
    let controller = new AbortController();
    let calls = [];
    let unsubscribe = store.onChange(
        'count',
        value => calls.push(value),
        { immediate: true, signal: controller.signal }
    );
    store.set('count', 1);
    controller.abort();
    unsubscribe();
    store.set('count', 2);
    assert.deepEqual(calls, [0, 1]);

    store.dispose();
    store.dispose();
    assert.equal(store.disposed, true);
    assert.equal(store.get('count'), 2);
    assert.throws(() => store.set('count', 3), /disposed data store/);
    assert.throws(() => store.onChange('count', () => {}), /disposed data store/);
});

test('data stores created in a scope are disposed with the scope', () => {
    let sculptor = new DomSculptor();
    let scope = sculptor.createScope();
    let store;
    scope.run(() => {
        store = sculptor.store({ ready: false });
    });
    scope.dispose();
    assert.equal(store.disposed, true);
});

test('async state reports loading, success, errors, and retries', async () => {
    let asyncState = new DomSculptor().asyncState('initial');
    let statuses = [];
    asyncState.subscribe(snapshot => statuses.push(snapshot.status));
    assert.equal(await asyncState.run(async () => 'loaded'), 'loaded');
    assert.deepEqual(asyncState.get(), { status: 'success', data: 'loaded', error: null });
    assert.equal(await asyncState.retry(), 'loaded');
    let failure = new Error('failed');
    await assert.rejects(asyncState.run(() => Promise.reject(failure)), failure);
    assert.equal(asyncState.get().status, 'error');
    assert.equal(asyncState.get().error, failure);
    assert.deepEqual(statuses, ['refreshing', 'success', 'refreshing', 'success', 'refreshing', 'error']);
});

test('ownership children are exposed as frozen snapshots', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    let child = parent.child.create('span');
    let snapshot = parent.children;
    assert.equal(Object.isFrozen(snapshot), true);
    assert.throws(() => snapshot.push(child), TypeError);
    parent.child.create('strong');
    assert.deepEqual(snapshot, [child]);
    assert.equal(parent.children.length, 2);
});

test('unmount is temporary, child-first, and completes when hooks fail', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('section');
    let child = parent.child.create('span');
    let calls = [];
    let first = new Error('child unmount');
    let second = new Error('parent unmount');
    child.onUnmount(() => { calls.push('child'); throw first; });
    parent.onUnmount(() => { calls.push('parent'); throw second; });
    sculptor.mount(parent, document.body);
    assert.throws(
        () => sculptor.unmount(parent),
        error => error instanceof AggregateError && error.errors.length === 2
    );
    assert.deepEqual(calls, ['child', 'parent']);
    assert.notEqual(parent.html, null);
    assert.notEqual(child.html, null);
    assert.equal(parent.html.parentNode, null);
    sculptor.mount(parent, document.body);
    assert.notEqual(parent.html, null);
});

test('dispose runs child hooks before parent hooks and only once', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('section');
    let child = parent.child.create('span');
    let calls = [];
    child.onDispose(() => calls.push('child'));
    parent.onDispose(() => calls.push('parent'));
    parent.dispose();
    parent.dispose();
    assert.deepEqual(calls, ['child', 'parent']);
    assert.equal(parent.html, null);
    assert.equal(child.html, null);
});

test('delegated events match within the managed root and can be removed by handler', () => {
    let root = new DomSculptor().create('button').class.add('delete');
    let calls = 0;
    let handler = (event, matched) => {
        calls++;
        assert.equal(matched, root.html);
    };
    root.on('click', '.delete', handler);
    root.html.dispatchEvent(new Event('click'));
    root.off('click', handler);
    root.html.dispatchEvent(new Event('click'));
    assert.equal(calls, 1);
    assert.throws(() => root.on('click', '.delete', null), TypeError);
});

test('property bindings update native properties through the scheduler', () => {
    let sculptor = new DomSculptor();
    let disabled = sculptor.signal(false);
    let input = sculptor.create('input');
    disabled.bindProperty(input, 'disabled');
    assert.equal(input.html.disabled, false);
    disabled.set(true);
    sculptor.flush();
    assert.equal(input.html.disabled, true);
});

test('element-aware binding handles text, numbers, checkboxes, and radio controls', () => {
    let sculptor = new DomSculptor();
    let name = sculptor.signal('Ada');
    let input = sculptor.create('input');
    input.html.type = 'text';
    name.bind(input);
    input.html.value = 'Grace';
    input.html.dispatchEvent(new Event('input'));
    assert.equal(name.get(), 'Grace');
    name.set('Hopper');
    sculptor.flush();
    assert.equal(input.html.value, 'Hopper');

    let quantity = sculptor.signal(1);
    let number = sculptor.create('input');
    number.html.type = 'number';
    quantity.bind(number);
    number.html.value = '12';
    number.html.dispatchEvent(new Event('input'));
    assert.equal(quantity.get(), 12);

    let accepted = sculptor.signal(false);
    let checkbox = sculptor.create('input');
    checkbox.html.type = 'checkbox';
    accepted.bind(checkbox);
    checkbox.html.checked = true;
    checkbox.html.dispatchEvent(new Event('change'));
    assert.equal(accepted.get(), true);

    let choice = sculptor.signal('a');
    let radio = sculptor.create('input');
    radio.html.type = 'radio';
    radio.html.value = 'b';
    choice.bind(radio);
    radio.html.checked = true;
    radio.html.dispatchEvent(new Event('change'));
    assert.equal(choice.get(), 'b');
});

test('form binding supports checkbox arrays, multiple selects, custom accessors, and composition', () => {
    let sculptor = new DomSculptor();
    let tags = sculptor.signal(['a']);
    let checkbox = sculptor.create('input');
    checkbox.html.type = 'checkbox';
    checkbox.html.value = 'b';
    tags.bind(checkbox, { group: true });
    checkbox.html.checked = true;
    checkbox.html.dispatchEvent(new Event('change'));
    assert.deepEqual(tags.get(), ['a', 'b']);

    let selected = sculptor.signal(['a']);
    let select = sculptor.create('select');
    select.html.multiple = true;
    select.html.options = [
        { value: 'a', selected: false },
        { value: 'b', selected: false }
    ];
    Object.defineProperty(select.html, 'selectedOptions', {
        get() { return this.options.filter(option => option.selected); }
    });
    selected.bind(select, { multiple: true });
    assert.deepEqual(select.html.options.map(option => option.selected), [true, false]);
    select.html.options[0].selected = false;
    select.html.options[1].selected = true;
    select.html.dispatchEvent(new Event('change'));
    assert.deepEqual(selected.get(), ['b']);

    let custom = sculptor.signal('x');
    let customInput = sculptor.create('input');
    custom.bind(customInput, {
        event: 'change',
        get: node => node.customValue,
        set: (node, value) => { node.customValue = value; }
    });
    customInput.html.customValue = 'y';
    customInput.html.dispatchEvent(new Event('change'));
    assert.equal(custom.get(), 'y');

    let composing = sculptor.signal('');
    let imeInput = sculptor.create('input');
    composing.bind(imeInput);
    imeInput.html.dispatchEvent(new Event('compositionstart'));
    imeInput.html.value = '途中';
    imeInput.html.dispatchEvent(new Event('input'));
    assert.equal(composing.get(), '');
    imeInput.html.dispatchEvent(new Event('compositionend'));
    assert.equal(composing.get(), '途中');
});

test('create mounts parented elements immediately', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let items = ['one', 'two', 'three'];
        let created = items.map(item => sculptor.create('li', container).setText(item));

        assert.deepEqual(container.children, created);
        assert.deepEqual(container.children.map(element => element.html.textContent), items);
        assert.equal(sculptor.rendering, false);
        assert.equal(frames.pending(), 0);
    });
});

test('createProgressively mounts one parented element per frame while preserving chaining and order', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let items = ['one', 'two', 'three'];
        let created = items.map(item => sculptor.createProgressively('li', container).setText(item));

        assert.equal(sculptor.rendering, true);
        assert.equal(frames.pending(), 1);
        assert.deepEqual(container.children.map(element => element.html.textContent), ['one']);
        assert.equal(created[1].html.textContent, 'two');
        assert.equal(created[1].html.parentNode, null);

        await frames.runNext();
        assert.deepEqual(container.children.map(element => element.html.textContent), ['one', 'two']);
        assert.equal(sculptor.rendering, true);
        assert.equal(frames.pending(), 1);

        await frames.runNext();
        assert.deepEqual(container.children.map(element => element.html.textContent), items);
        assert.equal(sculptor.rendering, false);
        assert.equal(frames.pending(), 0);
    });
});

test('createProgressively mounts 100 elements without losing order or configuration', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let elements = Array.from({ length: 100 }, (_, index) =>
            sculptor.createProgressively('li', container)
                .setText(`Item ${index}`)
                .attribute.set('data-index', index)
        );

        assert.equal(container.children.length, 1);
        assert.equal(frames.pending(), 1);
        assert.equal(sculptor.rendering, true);

        for (let expected = 2; expected <= 100; expected++) {
            await frames.runNext();
            assert.equal(container.children.length, expected);
            assert.equal(container.children.at(-1), elements[expected - 1]);
        }

        assert.equal(frames.pending(), 0);
        assert.equal(sculptor.rendering, false);
        assert.deepEqual(
            container.children.map(element => Number(element.attribute.get('data-index'))),
            Array.from({ length: 100 }, (_, index) => index)
        );
        container.dispose();
    });
});

test('create handles nested parents immediately without requiring mount', () => {
    let sculptor = new DomSculptor();
    let container = sculptor.create('ul', document.body);
    let first = sculptor.create('li', container).setText('one');
    let second = sculptor.create('li', container).setText('two');

    assert.equal(container.html.parentNode, document.body);
    assert.deepEqual(container.children, [first, second]);
    assert.equal(sculptor.rendering, false);
    container.dispose();
});

test('queued createProgressively supports configuration, events, bindings, children, and lifecycle hooks', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('section');
        sculptor.createProgressively('p', container).setText('first');
        let label = sculptor.signal('queued');
        let clicks = 0;
        let mounts = 0;
        let callbackElement = null;
        let queued = sculptor.createProgressively('button', container, element => {
            callbackElement = element;
            element.attribute.set({ type: 'button', 'data-state': 'ready' });
        })
            .setText('Save')
            .class.add('primary')
            .setStyle({ color: 'red', display: 'inline-block' })
            .attr('aria-label', label)
            .on('click', () => clicks++)
            .once('focus', () => clicks++)
            .onMount(() => mounts++);
        let child = queued.child.create('span').setText(' child');

        assert.equal(callbackElement, queued);
        assert.equal(queued.parent(), null);
        assert.equal(queued.attribute.get('type'), 'button');
        assert.equal(queued.attribute.get('data-state'), 'ready');
        assert.equal(queued.attribute.get('aria-label'), 'queued');
        assert.equal(queued.class.contains('primary'), true);
        assert.equal(queued.html.style.color, 'red');
        assert.equal(queued.children[0], child);
        assert.equal(mounts, 0);

        label.set('mounted');
        sculptor.flush();
        await frames.runNext();

        assert.equal(queued.parent(), container);
        assert.equal(queued.attribute.get('aria-label'), 'mounted');
        assert.equal(mounts, 1);
        queued.html.dispatchEvent(new Event('click'));
        queued.html.dispatchEvent(new Event('focus'));
        queued.html.dispatchEvent(new Event('focus'));
        assert.equal(clicks, 2);

        queued.off('click');
        queued.html.dispatchEvent(new Event('click'));
        assert.equal(clicks, 2);
        label.dispose();
        container.dispose();
    });
});

test('createProgressively requires a parent and validates its callback', () => {
    let sculptor = new DomSculptor();
    let container = sculptor.create('ul');
    assert.throws(
        () => sculptor.createProgressively('li', null),
        /createProgressively: parent is required/
    );
    assert.throws(
        () => sculptor.createProgressively('li', container, 'invalid'),
        /createProgressively: callback must be a function/
    );
});

test('disposing a parent immediately disposes its progressively created elements', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let first = sculptor.createProgressively('li', container).setText('one');
        let second = sculptor.createProgressively('li', container).setText('two');
        let third = sculptor.createProgressively('li', container).setText('three');

        assert.equal(frames.pending(), 1);
        assert.equal(sculptor.rendering, true);
        container.dispose();

        assert.equal(first.html, null);
        assert.equal(second.html, null);
        assert.equal(third.html, null);
        assert.equal(sculptor.rendering, false);

        await frames.runNext();
        assert.equal(sculptor.rendering, false);
    });
});

test('createProgressively skips a queued element disposed before its frame', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let first = sculptor.createProgressively('li', container).setText('one');
        let removed = sculptor.createProgressively('li', container).setText('two');
        removed.dispose();
        await frames.runNext();
        assert.deepEqual(container.children, [first]);
        assert.equal(sculptor.rendering, false);
    });
});

test('createProgressively uses a timer when animation frames are unavailable', async () => {
    let sculptor = new DomSculptor();
    let container = sculptor.create('ul');
    sculptor.createProgressively('li', container).setText('1');
    sculptor.createProgressively('li', container).setText('2');
    assert.equal(container.children.length, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(container.children.map(element => element.html.textContent), ['1', '2']);
    assert.equal(sculptor.rendering, false);
});

test('keyed lists preserve identity through reorder, insert, update, and remove', () => {
    let sculptor = new DomSculptor();
    let items = sculptor.signal([
        { id: 1, label: 'one' },
        { id: 2, label: 'two' },
        { id: 3, label: 'three' }
    ]);
    let container = sculptor.create('ul');
    let disposed = [];
    items.list(container, {
        key: item => item.id,
        render: item => sculptor.create('li').setText(item.label)
            .onRemove(() => disposed.push(item.id)),
        update: (row, item) => row.setText(item.label)
    });
    let [one, two, three] = container.children;
    items.set([
        { id: 3, label: 'THREE' },
        { id: 1, label: 'ONE' },
        { id: 4, label: 'four' }
    ]);
    sculptor.flush();
    assert.deepEqual(container.children.map(element => element.html.textContent), ['THREE', 'ONE', 'four']);
    assert.equal(container.children[0], three);
    assert.equal(container.children[1], one);
    assert.equal(two.html, null);
    assert.deepEqual(disposed, [2]);
});

test('keyed lists reject duplicate keys without changing the DOM', () => {
    let sculptor = new DomSculptor();
    let items = sculptor.signal([{ id: 1 }, { id: 2 }]);
    let container = sculptor.create('ul');
    items.list(container, {
        key: item => item.id,
        render: item => sculptor.create('li').setText(item.id)
    });
    let original = container.children.slice();
    assert.throws(() => items.set([{ id: 1 }, { id: 1 }]), /duplicate keys/);
    assert.deepEqual(container.children, original);
    assert.deepEqual(container.html.childNodes, original.map(element => element.html));
});

test('keyed list writes are deduplicated into one rendering pass', () => {
    let sculptor = new DomSculptor();
    let items = sculptor.signal([{ id: 1, label: 'one' }]);
    let container = sculptor.create('ul');
    let updates = 0;
    items.list(container, {
        key: item => item.id,
        render: item => sculptor.createDetached('li').setText(item.label),
        update: (row, item) => {
            updates++;
            row.setText(item.label);
        }
    });
    items.set([{ id: 1, label: 'two' }]);
    items.set([{ id: 1, label: 'three' }]);
    assert.equal(updates, 0);
    sculptor.flush();
    assert.equal(updates, 1);
    assert.equal(container.children[0].html.textContent, 'three');
});

test('keyed reorders move only the rows whose relative order changed', () => {
    let sculptor = new DomSculptor();
    let build = count => Array.from({ length: count }, (unused, id) => ({ id }));
    let items = sculptor.signal(build(10));
    let container = sculptor.create('ul');
    items.list(container, {
        key: item => item.id,
        render: item => sculptor.create('li').setText(String(item.id))
    });

    let moves = 0;
    let insertBefore = container.html.insertBefore.bind(container.html);
    container.html.insertBefore = (child, reference) => {
        moves++;
        return insertBefore(child, reference);
    };
    let apply = next => {
        moves = 0;
        items.set(next);
        sculptor.flush();
        return moves;
    };
    let order = () => container.children.map(element => element.html.textContent);

    let swapped = build(10);
    swapped[1] = { id: 8 };
    swapped[8] = { id: 1 };
    // Two rows changed places, so two rows move. Placing every row by its index
    // instead would move every row between them as well.
    assert.equal(apply(swapped), 2);
    assert.deepEqual(order(), ['0', '8', '2', '3', '4', '5', '6', '7', '1', '9']);

    assert.equal(apply(build(10)), 2);
    assert.deepEqual(order(), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

    assert.equal(apply(build(12)), 2);
    assert.deepEqual(order().slice(9), ['9', '10', '11']);

    assert.equal(apply(build(12).filter(item => item.id !== 5)), 0);
    assert.equal(container.children.length, 11);

    let prepended = [{ id: 99 }, ...build(12).filter(item => item.id !== 5)];
    assert.equal(apply(prepended), 1);
    assert.equal(order()[0], '99');
});

test('keyed lists match an array model through deterministic randomized changes', () => {
    let sculptor = new DomSculptor();
    let items = sculptor.signal([]);
    let container = sculptor.create('ul');
    let activeById = new Map();
    let seed = 0x5eed1234;
    let random = () => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) / 0x100000000;
    };

    items.list(container, {
        key: item => item.id,
        render: item => sculptor.createDetached('li').setText(item.label),
        update: (row, item) => row.setText(item.label)
    });

    for (let iteration = 0; iteration < 250; iteration++) {
        let next = Array.from({ length: 16 }, (_, id) => id)
            .filter(() => random() > 0.35)
            .map(id => ({ id, label: `${id}:${iteration}` }));
        for (let index = next.length - 1; index > 0; index--) {
            let swapIndex = Math.floor(random() * (index + 1));
            [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
        }
        let previousById = new Map(activeById);
        items.set(next);
        sculptor.flush();

        assert.deepEqual(
            container.children.map(row => row.html.textContent),
            next.map(item => item.label)
        );
        activeById = new Map(next.map((item, index) => [item.id, container.children[index]]));
        for (let item of next) {
            if (previousById.has(item.id)) {
                assert.equal(activeById.get(item.id), previousById.get(item.id));
            }
        }
        for (let [id, row] of previousById) {
            if (!activeById.has(id)) assert.equal(row.html, null);
        }
    }
});

test('repeated component disposal releases DOM and scoped cleanup exactly once', () => {
    let sculptor = new DomSculptor();
    let cleanupCalls = 0;
    let initialChildren = document.body.childNodes.length;
    let StressComponent = sculptor.component(() => {
        let value = sculptor.signal(0);
        sculptor.effect(() => {
            value.get();
            return () => cleanupCalls++;
        }, [value]);
        return {
            root: sculptor.createDetached('div'),
            api: { value }
        };
    });

    for (let iteration = 0; iteration < 1_000; iteration++) {
        let instance = StressComponent();
        sculptor.mount(instance, document.body);
        instance.api.value.set(iteration + 1);
        sculptor.flush();
        instance.dispose();
        instance.dispose();
        assert.equal(instance.root.html, null);
        assert.equal(instance.api.value.disposed, true);
    }

    assert.equal(document.body.childNodes.length, initialChildren);
    assert.equal(cleanupCalls, 2_000);
});

test('async state aborts superseded work and supports cancel and reset', async () => {
    let request = new DomSculptor().asyncState();
    let firstSignal;
    let first = request.run(({ signal }) => {
        firstSignal = signal;
        return new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
    });
    await Promise.resolve();
    let second = request.run(async () => 'newer');
    await assert.rejects(first, error => error.name === 'AbortError');
    assert.equal(firstSignal.aborted, true);
    assert.equal(await second, 'newer');
    request.cancel();
    assert.deepEqual(request.get(), { status: 'success', data: 'newer', error: null });
    request.reset();
    assert.deepEqual(request.get(), { status: 'idle', data: null, error: null });
});

test('stores expose key membership, deletion, and per-key signals', () => {
    let sculptor = new DomSculptor();
    let store = sculptor.store({ color: 'red', size: 1 });

    assert.equal(store.has('color'), true);
    assert.equal(store.has('missing'), false);

    let colorSignal = store.signal('color');
    assert.equal(colorSignal.get(), 'red');
    store.set('color', 'blue');
    assert.equal(colorSignal.get(), 'blue');
    colorSignal.set('green');
    assert.equal(store.get('color'), 'green');
    assert.throws(() => store.signal(1), TypeError);

    let seen = [];
    store.onChange('size', (next, previous) => seen.push([next, previous]));
    assert.equal(store.delete('size'), true);
    assert.deepEqual(seen, [[undefined, 1]]);
    assert.equal(store.has('size'), false);
    assert.equal(store.get('size'), undefined);
    assert.equal('size' in store.get(), false);
    assert.equal(store.delete('size'), false);

    // A re-set key keeps the listeners registered before it was deleted.
    store.set('size', 5);
    assert.deepEqual(seen, [[undefined, 1], [5, undefined]]);
    assert.equal(store.has('size'), true);

    store.dispose();
    assert.throws(() => store.delete('color'), /disposed/);
});

test('disposed elements report misuse instead of dereferencing a removed node', () => {
    let sculptor = new DomSculptor();
    let element = sculptor.create('input');
    element.dispose();

    assert.throws(() => element.on('click', () => {}), /disposed/);
    assert.throws(() => element.once('click', () => {}), /disposed/);
    assert.throws(() => element.getValue(), /disposed/);
    assert.throws(() => element.setValue('x'), /disposed/);
    assert.throws(() => element.hide(), /disposed/);
    assert.throws(() => element.show(), /disposed/);
});

test('contexts carry values through child scopes with fallbacks and deletion', () => {
    let sculptor = new DomSculptor();
    let themeKey = sculptor.createContextKey('theme');
    let missingKey = sculptor.createContextKey('missing');
    assert.equal(typeof themeKey, 'symbol');

    let root = sculptor.createContext().set(themeKey, 'dark');
    assert.equal(root.get(themeKey), 'dark');
    assert.equal(root.has(themeKey), true);
    assert.equal(root.get(missingKey, 'fallback'), 'fallback');

    let child = root.child();
    assert.equal(child.get(themeKey), 'dark');
    child.set(themeKey, 'light');
    assert.equal(child.get(themeKey), 'light');
    assert.equal(root.get(themeKey), 'dark');

    assert.equal(root.delete(themeKey), true);
    assert.equal(root.has(themeKey), false);

    let seededKey = sculptor.createContextKey('seeded');
    let seeded = sculptor.createContext(null, new Map([[seededKey, 'value']]));
    assert.equal(seeded.get(seededKey), 'value');
});

test('components receive an injected context', () => {
    let sculptor = new DomSculptor();
    let serviceKey = sculptor.createContextKey('service');
    let Consumer = sculptor.component((props, context) =>
        sculptor.createDetached('div').setText(String(context.get(serviceKey))));

    let instance = Consumer({}, sculptor.createContext().set(serviceKey, 'injected'));
    assert.equal(instance.root.html.textContent, 'injected');
    instance.dispose();
});

test('store observers are removed by key, by callback, and by abort signal', () => {
    let sculptor = new DomSculptor();
    let store = sculptor.store({ a: 1, b: 2 });

    let kept = [];
    let dropped = [];
    let keptCallback = value => kept.push(value);
    let droppedCallback = value => dropped.push(value);
    store.onChange('a', keptCallback);
    store.onChange('a', droppedCallback);
    store.offChange('a', droppedCallback);
    store.set('a', 10);
    assert.deepEqual(kept, [10]);
    assert.deepEqual(dropped, []);

    store.offChange('a');
    store.set('a', 11);
    assert.deepEqual(kept, [10]);

    let immediate = [];
    store.onChange('b', value => immediate.push(value), { immediate: true });
    assert.deepEqual(immediate, [2]);

    let controller = new AbortController();
    let aborted = [];
    store.onChange('b', value => aborted.push(value), { signal: controller.signal });
    controller.abort();
    store.set('b', 3);
    assert.deepEqual(aborted, []);

    let anyChanges = [];
    let stopAny = store.onAnyChange((key, value, previous) => anyChanges.push([key, value, previous]));
    store.set('a', 12);
    assert.deepEqual(anyChanges, [['a', 12, 11]]);
    stopAny();
    store.set('a', 13);
    assert.equal(anyChanges.length, 1);

    store.dispose();
});

test('the development constructor is exported and reports undisposed component scopes', () => {
    let warnings = [];
    let sculptor = createDevSculptor({ onWarning: warning => warnings.push(warning.code) });
    assert.equal(sculptor instanceof DevDomSculptor, true);
    assert.equal(sculptor instanceof DomSculptor, true);

    let Feature = sculptor.component(() => sculptor.createDetached('div'), { name: 'Feature' });
    let first = Feature();
    let second = Feature();
    assert.equal(sculptor.reportLeaks(), 2);

    first.dispose();
    assert.equal(sculptor.reportLeaks(), 1);
    second.dispose();
    assert.equal(sculptor.reportLeaks(), 0);
    assert.equal(warnings.includes('component-scope-leak'), true);
});

test('direct bindings write every supported target', () => {
    let sculptor = new DomSculptor();
    let value = sculptor.signal('ready');

    let attributeTarget = sculptor.create('div');
    value.bindAttribute(attributeTarget, 'data-status');
    assert.equal(attributeTarget.attribute.get('data-status'), 'ready');

    let classTarget = sculptor.create('div');
    value.bindClass(classTarget, 'is-ready', next => next === 'ready');
    assert.equal(classTarget.class.contains('is-ready'), true);

    let styleTarget = sculptor.create('div');
    value.bindStyle(styleTarget, 'color', next => next === 'ready' ? 'green' : 'red');
    assert.equal(styleTarget.html.style.color, 'green');

    let visibleTarget = sculptor.create('div');
    value.bindVisible(visibleTarget, next => next === 'ready');
    assert.notEqual(visibleTarget.html.style.display, 'none');

    let hiddenTarget = sculptor.create('div');
    value.bindHidden(hiddenTarget, next => next === 'ready');
    assert.equal(hiddenTarget.html.hidden, true);

    let propertyTarget = sculptor.create('input');
    value.bindProperty(propertyTarget, 'title');
    assert.equal(propertyTarget.html.title, 'ready');

    let valueTarget = sculptor.create('input');
    value.bindValue(valueTarget);
    assert.equal(valueTarget.html.value, 'ready');

    value.set('busy');
    sculptor.flush();
    assert.equal(attributeTarget.attribute.get('data-status'), 'busy');
    assert.equal(classTarget.class.contains('is-ready'), false);
    assert.equal(styleTarget.html.style.color, 'red');
    assert.equal(visibleTarget.html.style.display, 'none');
    assert.equal(hiddenTarget.html.hidden, false);
    assert.equal(propertyTarget.html.title, 'busy');
    assert.equal(valueTarget.html.value, 'busy');

    value.dispose();
});

test('targeted reactive nodes update without clearing sibling content', () => {
    let sculptor = new DomSculptor();
    let label = sculptor.signal('one');
    let open = sculptor.signal(true);

    let element = sculptor.create('div');
    let sibling = element.child.create('span');
    sibling.setText('kept');
    element.text(label);
    assert.equal(element.html.textContent, 'keptone');

    element.attr('aria-expanded', open);
    element.classToggle('active', open);
    element.styleValue('opacity', label);
    // A `true` value marks attribute presence, so the written value is empty.
    assert.equal(element.attribute.get('aria-expanded'), '');
    assert.equal(element.attribute.has('aria-expanded'), true);
    assert.equal(element.class.contains('active'), true);
    assert.equal(element.html.style.opacity, 'one');

    label.set('two');
    open.set(false);
    sculptor.flush();
    assert.equal(element.html.textContent, 'kepttwo');
    assert.equal(element.attribute.has('aria-expanded'), false);
    assert.equal(element.class.contains('active'), false);
    assert.equal(element.html.style.opacity, 'two');

    label.dispose();
    open.dispose();
});

test('traversal and sibling insertion return wrapped elements', () => {
    let sculptor = new DomSculptor();
    let root = sculptor.create('div');
    root.attribute.set('id', 'root');
    let child = root.child.create('span');

    assert.equal(root.childrenOf().length, 1);
    assert.equal(root.childrenOf()[0].html, child.html);
    assert.equal(root.children.length, 1);
    assert.equal(child.parent().html, root.html);
    assert.equal(child.closest('#root').html, root.html);
    assert.equal(child.closest('#absent'), null);

    let before = sculptor.create('i');
    let after = sculptor.create('u');
    child.before(before);
    child.after(after);
    assert.deepEqual(
        root.html.childNodes.map(node => node.tagName),
        ['i', 'span', 'u']
    );

    root.dispose();
});

test('mounting helpers resolve parents and report unusable targets', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');

    let inside = sculptor.createIn(parent, 'span', element => element.setText('nested'));
    assert.equal(inside.html.parentNode, parent.html);
    assert.equal(inside.html.textContent, 'nested');

    assert.equal(sculptor.tryMount(sculptor.create('div'), '#missing'), null);
    assert.equal(sculptor.tryWrap('#missing'), null);
    assert.throws(() => sculptor.wrap('#missing'), /could not find/);
    assert.throws(() => sculptor.mount(sculptor.create('div'), '#missing'), /could not find/);

    let existing = new FakeNode('section');
    let adopted = sculptor.adopt(existing);
    assert.equal(adopted.html, existing);

    parent.dispose();
});

test('batch defers rendering until the outermost batch completes', () => {
    let sculptor = new DomSculptor();
    let value = sculptor.signal(0);
    let element = sculptor.create('div');
    let writes = 0;
    value.bind(element, (next, target) => {
        writes++;
        target.setText(String(next));
    });
    assert.equal(writes, 1);

    let returned = sculptor.batch(() => {
        value.set(1);
        value.set(2);
        assert.equal(writes, 1);
        return 'batched';
    });
    assert.equal(returned, 'batched');

    sculptor.flush();
    assert.equal(writes, 2);
    assert.equal(element.html.textContent, '2');

    assert.throws(() => sculptor.batch('not a function'), TypeError);
    value.dispose();
});

test('conditional branches dispose factories unless preservation is requested', () => {
    let sculptor = new DomSculptor();
    let visible = sculptor.signal(true);
    let host = sculptor.create('div');
    let built = 0;
    let disposed = 0;

    let stop = sculptor.when(visible, () => {
        built++;
        return sculptor.createDetached('p').onDispose(() => disposed++);
    }, { parent: host });
    sculptor.flush();
    assert.equal(built, 1);
    assert.equal(host.html.childNodes.length, 1);

    visible.set(false);
    sculptor.flush();
    assert.equal(disposed, 1);
    assert.equal(host.html.childNodes.length, 0);

    visible.set(true);
    sculptor.flush();
    assert.equal(built, 2);
    stop();
    assert.equal(disposed, 2);

    let preservedHost = sculptor.create('div');
    let preservedDisposals = 0;
    let keep = sculptor.signal(true);
    let stopPreserved = sculptor.when(keep, () =>
        sculptor.createDetached('p').onDispose(() => preservedDisposals++),
    { parent: preservedHost, preserve: true });
    sculptor.flush();
    keep.set(false);
    sculptor.flush();
    assert.equal(preservedDisposals, 0);

    stopPreserved();
    visible.dispose();
    keep.dispose();
});

test('form binding options cover parsing and custom accessors', () => {
    let sculptor = new DomSculptor();

    let count = sculptor.signal(0);
    let numeric = sculptor.create('input');
    count.sync(numeric, { parse: value => Number(value) });
    numeric.html.value = '42';
    numeric.html.dispatchEvent(new Event('input'));
    assert.equal(count.get(), 42);

    count.set(7);
    sculptor.flush();
    assert.equal(numeric.html.value, '7');

    let custom = sculptor.signal('start');
    let holder = sculptor.create('div');
    custom.sync(holder, {
        event: 'custom-change',
        get: node => node.customValue,
        set: (node, value) => { node.customValue = value; }
    });
    assert.equal(holder.html.customValue, 'start');
    holder.html.customValue = 'edited';
    holder.html.dispatchEvent(new Event('custom-change'));
    assert.equal(custom.get(), 'edited');

    let twoWay = sculptor.signal('typed');
    let input = sculptor.create('input');
    twoWay.bind(input);
    assert.equal(input.html.value, 'typed');
    input.html.value = 'changed';
    input.html.dispatchEvent(new Event('input'));
    assert.equal(twoWay.get(), 'changed');

    count.dispose();
    custom.dispose();
    twoWay.dispose();
});

test('async state retries the previous task and clears state on reset', async () => {
    let sculptor = new DomSculptor();
    let attempts = 0;
    let request = sculptor.asyncState();

    let statuses = [];
    let unsubscribe = request.subscribe(snapshot => statuses.push(snapshot.status));

    await request.run(async () => {
        attempts++;
        return 'attempt-' + attempts;
    });
    assert.equal(request.get().data, 'attempt-1');
    assert.equal(statuses.includes('loading'), true);

    let retried = await request.retry();
    assert.equal(retried, 'attempt-2');
    assert.equal(attempts, 2);
    assert.equal(statuses.includes('refreshing'), true);

    await assert.rejects(request.run(async () => { throw new Error('failed'); }), /failed/);
    assert.equal(request.get().status, 'error');
    assert.equal(request.get().error.message, 'failed');

    request.reset();
    assert.deepEqual(request.get(), { status: 'idle', data: null, error: null });
    unsubscribe();
});

test('computed values track the signals they read when no dependency list is given', () => {
    let sculptor = new DomSculptor();
    let first = sculptor.signal('Ada');
    let last = sculptor.signal('Lovelace');
    let evaluations = 0;
    let full = sculptor.computed(() => {
        evaluations++;
        return first.get() + ' ' + last.get();
    });

    assert.equal(evaluations, 0);
    assert.equal(full.get(), 'Ada Lovelace');
    assert.equal(evaluations, 1);

    let values = [];
    full.subscribe(value => values.push(value));
    last.set('Byron');
    assert.equal(full.get(), 'Ada Byron');
    assert.deepEqual(values, ['Ada Byron']);
    assert.equal(evaluations, 2);

    first.set('Ada');
    assert.equal(evaluations, 2);

    full.dispose();
    first.dispose();
    last.dispose();
});

test('automatic tracking drops dependencies a branch no longer reads', () => {
    let sculptor = new DomSculptor();
    let useFirst = sculptor.signal(true);
    let first = sculptor.signal('first');
    let second = sculptor.signal('second');
    let evaluations = 0;
    let chosen = sculptor.computed(() => {
        evaluations++;
        return useFirst.get() ? first.get() : second.get();
    });

    assert.equal(chosen.get(), 'first');
    assert.equal(evaluations, 1);

    // The untaken branch is not a dependency yet.
    second.set('second updated');
    assert.equal(evaluations, 1);

    useFirst.set(false);
    assert.equal(chosen.get(), 'second updated');
    assert.equal(evaluations, 2);

    // The abandoned branch stops triggering work.
    first.set('first updated');
    assert.equal(evaluations, 2);

    second.set('second again');
    assert.equal(chosen.get(), 'second again');
    assert.equal(evaluations, 3);

    chosen.dispose();
});

test('automatically tracked computed values compose through other computed values', () => {
    let sculptor = new DomSculptor();
    let width = sculptor.signal(2);
    let height = sculptor.signal(3);
    let area = sculptor.computed(() => width.get() * height.get());
    let label = sculptor.computed(() => 'area: ' + area.get());

    assert.equal(label.get(), 'area: 6');
    width.set(4);
    assert.equal(area.get(), 12);
    assert.equal(label.get(), 'area: 12');

    label.dispose();
    area.dispose();
});

test('effects track the signals they read and rerun through the scheduler', () => {
    let sculptor = new DomSculptor();
    let enabled = sculptor.signal(true);
    let value = sculptor.signal(1);
    let unrelated = sculptor.signal('ignored');
    let runs = [];
    let cleanups = 0;

    let stop = sculptor.effect(() => {
        runs.push(enabled.get() ? value.get() : null);
        return () => cleanups++;
    });
    assert.deepEqual(runs, [1]);

    value.set(2);
    sculptor.flush();
    assert.deepEqual(runs, [1, 2]);
    assert.equal(cleanups, 1);

    unrelated.set('still ignored');
    sculptor.flush();
    assert.equal(runs.length, 2);

    enabled.set(false);
    sculptor.flush();
    assert.deepEqual(runs, [1, 2, null]);

    // The effect stopped reading `value`, so writes to it no longer schedule work.
    value.set(3);
    sculptor.flush();
    assert.equal(runs.length, 3);

    stop();
    assert.equal(cleanups, 3);
    enabled.set(true);
    sculptor.flush();
    assert.equal(runs.length, 3);
});

test('disposal detaches the node before tearing the subtree down', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div', document.body);
    let child = sculptor.createIn(parent, 'span');
    let grandchild = sculptor.createIn(child, 'em');
    let root = parent.html.parentNode;
    assert.equal(root, document.body);

    // Removing the node first means every descendant is disposed off the
    // document, which is what makes clearing a large list cheap. Dispose hooks
    // therefore observe a detached node, and that is the contract.
    let observed = [];
    let record = name => element => observed.push([name, element.html.parentNode]);
    parent.onRemove(record('parent'));
    child.onRemove(record('child'));
    grandchild.onRemove(record('grandchild'));

    parent.remove();

    assert.deepEqual(observed, [
        ['grandchild', null],
        ['child', null],
        ['parent', null]
    ]);
    assert.equal(root.childNodes.includes(parent.html), false);
    assert.equal(parent.html, null);
    assert.equal(child.html, null);
    assert.equal(grandchild.html, null);
});

test('the standalone computed and effect exports track their reads', () => {
    // These wrap the shared default runtime. They kept the old empty-list default
    // after the class methods moved to automatic tracking, so importing them gave
    // the opposite behaviour to the one the documentation describes.
    let source = signal(1);
    let evaluations = 0;
    let doubled = computed(() => {
        evaluations++;
        return source.get() * 2;
    });

    assert.equal(doubled.get(), 2);
    source.set(4);
    assert.equal(doubled.get(), 8);
    assert.equal(evaluations, 2);

    let seen = [];
    let stop = effect(() => { seen.push(source.get()); });
    assert.deepEqual(seen, [4]);
    source.set(5);
    flush();
    assert.deepEqual(seen, [4, 5]);
    stop();

    let pinned = computed(() => source.get(), []);
    assert.equal(pinned.get(), 5);
    source.set(6);
    assert.equal(pinned.get(), 5);
});

test('an explicit empty dependency list opts out of automatic tracking', () => {
    let sculptor = new DomSculptor();
    let value = sculptor.signal(1);
    let evaluations = 0;
    let pinned = sculptor.computed(() => {
        evaluations++;
        return value.get();
    }, []);

    assert.equal(pinned.get(), 1);
    value.set(2);
    assert.equal(pinned.get(), 1);
    assert.equal(evaluations, 1);

    let runs = 0;
    let stop = sculptor.effect(() => {
        value.get();
        runs++;
    }, []);
    value.set(3);
    sculptor.flush();
    assert.equal(runs, 1);

    stop();
    pinned.dispose();
    value.dispose();
});

test('automatic tracking observes store keys and rejects invalid dependency lists', () => {
    let sculptor = new DomSculptor();
    let store = sculptor.store({ count: 1 });
    let doubled = sculptor.computed(() => store.get('count') * 2);

    assert.equal(doubled.get(), 2);
    store.set('count', 5);
    assert.equal(doubled.get(), 10);

    assert.throws(() => sculptor.computed(() => 1, 'not an array'), TypeError);
    assert.throws(() => sculptor.computed(() => 1, [{}]), TypeError);
    assert.throws(() => sculptor.effect(() => {}, 'not an array'), TypeError);
    assert.throws(() => sculptor.effect(() => {}, [{}]), TypeError);

    doubled.dispose();
    store.dispose();
});

test('disposing a tracked computed or effect releases every discovered subscription', () => {
    let warnings = [];
    let sculptor = createDevSculptor({ onWarning: warning => warnings.push(warning.code) });
    let value = sculptor.signal(0);

    let derived = sculptor.computed(() => value.get() + 1);
    assert.equal(derived.get(), 1);
    let stop = sculptor.effect(() => { value.get(); });

    derived.dispose();
    stop();
    value.dispose();

    assert.deepEqual(warnings.filter(code => code === 'subscription-cleanup'), []);
});

test('the runtime owns resources created without an explicit scope', () => {
    let sculptor = new DomSculptor();
    let parent = new FakeNode('div');
    document.body.appendChild(parent);

    let value = sculptor.signal(1);
    let doubled = sculptor.computed(() => value.get() * 2);
    let store = sculptor.store({ ready: true });
    let request = sculptor.asyncState();
    let element = sculptor.createIn(parent, 'span');
    let effectRuns = 0;
    sculptor.effect(() => { value.get(); effectRuns++; });

    assert.equal(doubled.get(), 2);
    assert.equal(effectRuns, 1);
    assert.equal(sculptor.disposed, false);

    sculptor.dispose();

    assert.equal(sculptor.disposed, true);
    assert.equal(value.disposed, true);
    assert.equal(doubled.disposed, true);
    assert.equal(store.disposed, true);
    assert.equal(element.html, null);
    assert.equal(parent.childNodes.length, 0);
    assert.deepEqual(request.get(), { status: 'idle', data: null, error: null });

    // A stopped effect no longer reacts, and disposal is idempotent.
    sculptor.dispose();
    assert.equal(sculptor.disposed, true);

    document.body.removeChild(parent);
});

test('runtime disposal cleans listeners on wrapped nodes without removing them', () => {
    let sculptor = new DomSculptor();
    let existing = new FakeNode('section');
    document.body.appendChild(existing);

    let wrapped = sculptor.adopt(existing);
    let clicks = 0;
    wrapped.on('click', () => clicks++);
    existing.dispatchEvent(new Event('click'));
    assert.equal(clicks, 1);

    sculptor.dispose();

    // The node was borrowed, not created, so it stays in the document.
    assert.equal(existing.parentNode, document.body);
    existing.dispatchEvent(new Event('click'));
    assert.equal(clicks, 1);

    document.body.removeChild(existing);
});

test('an explicit scope takes ownership away from the runtime', () => {
    let sculptor = new DomSculptor();
    let scope = sculptor.createScope();
    let scoped;
    let outer = sculptor.signal('outer');

    scope.run(() => { scoped = sculptor.signal('scoped'); });

    scope.dispose();
    assert.equal(scoped.disposed, true);
    assert.equal(outer.disposed, false);

    sculptor.dispose();
    assert.equal(outer.disposed, true);
});

test('individually disposed resources release their runtime ownership entry', () => {
    let sculptor = new DomSculptor();
    let parent = new FakeNode('div');
    let baseline = sculptor._rootScope._cleanups.size;

    // Churning resources must not accumulate cleanup entries on the runtime.
    for (let iteration = 0; iteration < 500; iteration++) {
        let value = sculptor.signal(iteration);
        let derived = sculptor.computed(() => value.get() + 1);
        let element = sculptor.createIn(parent, 'span');
        element.on('click', () => {});
        derived.get();
        element.dispose();
        derived.dispose();
        value.dispose();
    }

    assert.equal(sculptor._rootScope._cleanups.size, baseline);
    sculptor.dispose();
});

// The router reads the History API, which the FakeNode document does not provide.
let withFakeHistory = (initialPath, callback) => {
    let originals = {
        window: globalThis.window,
        location: globalThis.location,
        history: globalThis.history
    };
    let listeners = new Map();
    let entries = [initialPath];
    globalThis.location = { pathname: initialPath, hash: '' };
    globalThis.history = {
        pushState(state, title, path) {
            entries.push(path);
            globalThis.location.pathname = path;
        },
        replaceState(state, title, path) {
            entries[entries.length - 1] = path;
            globalThis.location.pathname = path;
        }
    };
    globalThis.window = {
        addEventListener(type, callbackToAdd) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type).add(callbackToAdd);
        },
        removeEventListener(type, callbackToRemove) {
            listeners.get(type)?.delete(callbackToRemove);
        }
    };
    let back = path => {
        globalThis.location.pathname = path;
        listeners.get('popstate')?.forEach(listener => listener());
    };
    try {
        return callback({ back, entries, listenerCount: type => listeners.get(type)?.size ?? 0 });
    } finally {
        for (let key of ['window', 'location', 'history']) {
            if (originals[key] === undefined) delete globalThis[key];
            else globalThis[key] = originals[key];
        }
    }
};

test('the router mounts one matching route at a time and passes parameters', () => {
    withFakeHistory('/', ({ back }) => {
        let sculptor = new DomSculptor();
        let host = sculptor.create('main');
        let seen = [];

        let router = sculptor.router({
            '/': () => sculptor.createDetached('div').setText('home'),
            '/users/:id': snapshot => {
                seen.push(snapshot.params.id);
                return sculptor.createDetached('div').setText('user ' + snapshot.params.id);
            },
            '*': () => sculptor.createDetached('div').setText('not found')
        }, { parent: host });

        assert.equal(host.html.textContent, 'home');
        assert.equal(router.current.get().route, '/');

        router.navigate('/users/42');
        sculptor.flush();
        assert.equal(host.html.textContent, 'user 42');
        assert.deepEqual(seen, ['42']);
        assert.deepEqual(router.current.get().params, { id: '42' });
        assert.equal(host.html.childNodes.length, 1);

        router.navigate('/nothing-here');
        sculptor.flush();
        assert.equal(host.html.textContent, 'not found');
        assert.equal(router.current.get().route, '*');

        // Browser navigation is honoured through popstate.
        back('/users/7');
        sculptor.flush();
        assert.equal(host.html.textContent, 'user 7');

        router.stop();
        sculptor.dispose();
    });
});

test('the router disposes the view it replaces and cleans up when stopped', () => {
    withFakeHistory('/', ({ listenerCount }) => {
        let sculptor = new DomSculptor();
        let host = sculptor.create('main');
        let disposals = [];

        let makeView = name => () => {
            let element = sculptor.createDetached('div').setText(name);
            element.onDispose(() => disposals.push(name));
            return element;
        };
        let router = sculptor.router({
            '/': makeView('home'),
            '/about': makeView('about')
        }, { parent: host });
        assert.equal(listenerCount('popstate'), 1);

        router.navigate('/about');
        sculptor.flush();
        assert.deepEqual(disposals, ['home']);

        router.stop();
        assert.deepEqual(disposals, ['home', 'about']);
        assert.equal(host.html.childNodes.length, 0);
        assert.equal(listenerCount('popstate'), 0);
        assert.equal(router.stopped, true);
        assert.equal(router.current.disposed, true);

        router.stop();
        assert.deepEqual(disposals, ['home', 'about']);
        sculptor.dispose();
    });
});

test('the router mounts component instances and is owned by the runtime', () => {
    withFakeHistory('/', ({ listenerCount }) => {
        let sculptor = new DomSculptor();
        let host = sculptor.create('main');
        let scoped;
        let Page = sculptor.component(props => {
            scoped = sculptor.signal(props.params.slug);
            return { root: sculptor.createDetached('article').setText(props.params.slug) };
        });

        let router = sculptor.router({ '/posts/:slug': Page }, { parent: host });
        router.navigate('/posts/hello');
        sculptor.flush();
        assert.equal(host.html.textContent, 'hello');
        assert.equal(scoped.get(), 'hello');

        // Disposing the runtime stops the router without an explicit stop() call.
        sculptor.dispose();
        assert.equal(router.stopped, true);
        assert.equal(listenerCount('popstate'), 0);
        assert.equal(scoped.disposed, true);
    });
});

test('the router validates routes and navigation targets', () => {
    withFakeHistory('/', () => {
        let sculptor = new DomSculptor();
        let host = sculptor.create('main');

        assert.throws(() => sculptor.router(null, { parent: host }), TypeError);
        assert.throws(() => sculptor.router({ '/': 'not a function' }, { parent: host }), TypeError);

        let router = sculptor.router({ '/': () => sculptor.createDetached('div') }, { parent: host });
        assert.throws(() => router.navigate(''), TypeError);
        assert.throws(() => router.navigate(42), TypeError);

        router.stop();
        sculptor.dispose();
    });
});

test('the router supports hash routing', () => {
    withFakeHistory('/', () => {
        globalThis.location.hash = '#/start';
        let sculptor = new DomSculptor();
        let host = sculptor.create('main');
        let router = sculptor.router({
            '/start': () => sculptor.createDetached('div').setText('start'),
            '/next': () => sculptor.createDetached('div').setText('next')
        }, { parent: host, hash: true });

        assert.equal(host.html.textContent, 'start');
        router.navigate('/next');
        sculptor.flush();
        assert.equal(host.html.textContent, 'next');

        router.stop();
        sculptor.dispose();
    });
});

// Virtual lists read layout, which FakeNode does not model, so viewports are set explicitly.
let virtualContainer = (sculptor, height = 480) => {
    let container = sculptor.create('div');
    container.html.clientHeight = height;
    container.html.scrollTop = 0;
    return container;
};
let records = count => Array.from({ length: count }, (_, id) => ({ id, label: `Row ${id}` }));

test('virtual lists mount only the visible range of a large collection', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor);
    let items = records(9_000);
    let created = 0;

    sculptor.virtualList(items, container, {
        rowHeight: 48,
        overscan: 6,
        key: item => item.id,
        render(item) {
            created++;
            return sculptor.createDetached('div').setText(item.label);
        }
    });

    let status = sculptor.virtualListStatus(container);
    assert.equal(status.total, 9_000);
    assert.equal(status.start, 0);
    // 480px viewport at 48px rows is 10 visible, plus overscan on the trailing edge.
    assert.ok(status.mounted <= 60, `mounted ${status.mounted} rows`);
    assert.ok(status.mounted >= 10, `mounted ${status.mounted} rows`);
    assert.equal(created, status.mounted);

    let spacer = container.html.childNodes[0];
    assert.equal(spacer.style.height, `${9_000 * 48}px`);
    assert.equal(Object.isFrozen(status), true);

    sculptor.dispose();
});

test('virtual list ranges follow scrolling and clamp overscan at both boundaries', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = virtualContainer(sculptor);
        sculptor.virtualList(records(1_000), container, {
            rowHeight: 20,
            overscan: 3,
            key: item => item.id,
            render: item => sculptor.createDetached('div').setText(item.label)
        });

        assert.equal(sculptor.virtualListStatus(container).start, 0);

        container.html.scrollTop = 4_000;
        container.html.dispatchEvent(new Event('scroll'));
        container.html.dispatchEvent(new Event('scroll'));
        container.html.dispatchEvent(new Event('scroll'));
        // Several scroll events before the frame collapse into one rendering pass.
        assert.equal(frames.pending(), 1);
        assert.equal(sculptor.rendering, true);
        await frames.runNext();

        let scrolled = sculptor.virtualListStatus(container);
        assert.equal(scrolled.start, 200 - 3);
        assert.equal(sculptor.rendering, false);

        container.html.scrollTop = 20_000;
        container.html.dispatchEvent(new Event('scroll'));
        await frames.runNext();
        let last = sculptor.virtualListStatus(container);
        assert.equal(last.end, 1_000);
        assert.ok(last.start >= 0);

        sculptor.dispose();
    });
});

test('virtual rows are reused through the update contract and see current data', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor, 100);
    let constructions = 0;
    let clicked = [];

    sculptor.virtualList(records(500), container, {
        rowHeight: 20,
        overscan: 1,
        key: item => item.id,
        render(item) {
            constructions++;
            let current = item;
            let root = sculptor.createDetached('button');
            root.on('click', () => clicked.push(current.id));
            root.setText(item.label);
            return {
                root,
                update(nextItem) {
                    current = nextItem;
                    root.setText(nextItem.label);
                }
            };
        }
    });

    let afterCreate = constructions;
    sculptor.updateVirtualList(container, records(500).map(item => ({ ...item, label: `Changed ${item.id}` })));
    assert.equal(constructions, afterCreate, 'rows were rebuilt instead of reused');
    assert.match(container.html.textContent, /Changed 0/);

    // A reused row must act on its current item, not the one it was built with.
    container.html.querySelector('button').dispatchEvent(new Event('click'));
    assert.deepEqual(clicked, [0]);

    sculptor.dispose();
});

test('virtual lists reject duplicate keys before touching the DOM', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor);
    let duplicated = [{ id: 1 }, { id: 1 }];

    assert.throws(
        () => sculptor.virtualList(duplicated, container, {
            rowHeight: 10,
            key: item => item.id,
            render: () => sculptor.createDetached('div')
        }),
        /duplicate key/
    );
    assert.equal(container.html.childNodes.length, 0);
    assert.equal(sculptor.virtualListStatus(container), null);

    sculptor.virtualList(records(10), container, {
        rowHeight: 10,
        key: item => item.id,
        render: () => sculptor.createDetached('div')
    });
    let before = sculptor.virtualListStatus(container).total;
    assert.throws(() => sculptor.updateVirtualList(container, duplicated), /duplicate key/);
    assert.equal(sculptor.virtualListStatus(container).total, before, 'a rejected update changed the list');

    sculptor.dispose();
});

test('virtual list updates resize the spacer and clamp a stale scroll position', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor, 200);
    sculptor.virtualList(records(1_000), container, {
        rowHeight: 25,
        key: item => item.id,
        render: item => sculptor.createDetached('div').setText(item.label)
    });
    container.html.scrollTop = 20_000;

    sculptor.updateVirtualList(container, records(10));
    let spacer = container.html.childNodes[0];
    assert.equal(spacer.style.height, `${10 * 25}px`);
    assert.equal(container.html.scrollTop, Math.max(0, 10 * 25 - 200));
    assert.equal(sculptor.virtualListStatus(container).total, 10);

    sculptor.updateVirtualList(container, []);
    assert.equal(sculptor.virtualListStatus(container).mounted, 0);
    assert.equal(sculptor.virtualListStatus(container).total, 0);

    sculptor.dispose();
});

test('virtual lists scroll to an index or a key and report unreachable targets', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor, 200);
    sculptor.virtualList(records(1_000), container, {
        rowHeight: 20,
        key: item => item.id,
        render: item => sculptor.createDetached('div').setText(item.label)
    });

    assert.equal(sculptor.scrollVirtualList(container, 500), true);
    assert.equal(container.html.scrollTop, 500 * 20);

    assert.equal(sculptor.scrollVirtualList(container, 500, { align: 'end' }), true);
    assert.equal(container.html.scrollTop, 500 * 20 - 200 + 20);

    assert.equal(sculptor.scrollVirtualList(container, 500, { align: 'center' }), true);
    assert.equal(container.html.scrollTop, 500 * 20 - 100 + 10);

    assert.equal(sculptor.scrollVirtualList(container, 999), true);
    assert.equal(container.html.scrollTop, Math.min(999 * 20, 1_000 * 20 - 200));

    assert.equal(sculptor.scrollVirtualList(container, { key: 3 }), true);
    assert.equal(container.html.scrollTop, 3 * 20);

    assert.equal(sculptor.scrollVirtualList(container, { key: 'missing' }), false);
    assert.equal(sculptor.scrollVirtualList(container, -1), false);
    assert.equal(sculptor.scrollVirtualList(container, 5_000), false);
    assert.equal(sculptor.scrollVirtualList(sculptor.create('div'), 0), false);

    sculptor.dispose();
});

test('virtual lists validate their arguments and stay one per container', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor);
    let render = () => sculptor.createDetached('div');

    assert.throws(() => sculptor.virtualList('nope', container, { rowHeight: 10, render }), TypeError);
    assert.throws(() => sculptor.virtualList([], container.html, { rowHeight: 10, render }), TypeError);
    assert.throws(() => sculptor.virtualList([], container, { rowHeight: 0, render }), TypeError);
    assert.throws(() => sculptor.virtualList([], container, { rowHeight: 10 }), TypeError);

    sculptor.virtualList(records(5), container, { rowHeight: 10, render });
    assert.throws(() => sculptor.virtualList(records(5), container, { rowHeight: 10, render }), /already virtualized/);
    assert.throws(() => sculptor.updateVirtualList(sculptor.create('div'), []), /not virtualized/);

    sculptor.dispose();
});

test('virtual lists dispose with their container and can be removed on their own', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor);
    let disposedRows = 0;
    let options = {
        rowHeight: 24,
        key: item => item.id,
        render(item) {
            return {
                root: sculptor.createDetached('div').setText(item.label),
                dispose() { disposedRows++; }
            };
        }
    };

    sculptor.virtualList(records(100), container, options);
    let mounted = sculptor.virtualListStatus(container).mounted;
    assert.ok(mounted > 0);

    // Explicit removal keeps the container usable.
    sculptor.disposeVirtualList(container);
    assert.equal(disposedRows, mounted);
    assert.equal(sculptor.virtualListStatus(container), null);
    assert.notEqual(container.html, null);
    assert.equal(container.html.childNodes.length, 0);
    sculptor.disposeVirtualList(container);
    assert.equal(disposedRows, mounted);

    // The container can be virtualized again after explicit removal.
    sculptor.virtualList(records(100), container, options);
    assert.ok(sculptor.virtualListStatus(container).mounted > 0);
    container.dispose();
    assert.equal(container.html, null);
    assert.equal(disposedRows, mounted * 2);

    sculptor.dispose();
});

test('virtual lists stay isolated across containers and runtimes', () => {
    let first = new DomSculptor();
    let second = new DomSculptor();
    let firstContainer = virtualContainer(first);
    let secondContainer = virtualContainer(second);

    first.virtualList(records(50), firstContainer, {
        rowHeight: 10,
        render: item => first.createDetached('div').setText(item.label)
    });
    second.virtualList(records(80), secondContainer, {
        rowHeight: 10,
        render: item => second.createDetached('div').setText(item.label)
    });

    assert.equal(first.virtualListStatus(firstContainer).total, 50);
    assert.equal(second.virtualListStatus(secondContainer).total, 80);
    // One runtime must not see or control another runtime's list.
    assert.equal(first.virtualListStatus(secondContainer), null);
    assert.throws(() => first.updateVirtualList(secondContainer, []), /not virtualized/);

    first.dispose();
    assert.equal(second.virtualListStatus(secondContainer).total, 80);
    second.dispose();
});

test('a failing row render restores rendering status and leaves the list usable', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor, 100);
    let failing = false;

    sculptor.virtualList(records(50), container, {
        rowHeight: 20,
        key: item => item.id,
        render(item) {
            if (failing) throw new Error('row render failed');
            return sculptor.createDetached('div').setText(item.label);
        }
    });
    let before = sculptor.virtualListStatus(container).mounted;

    // New keys force fresh rows, so the failing render runs during the update.
    let replacement = records(60).map(item => ({ ...item, id: item.id + 1_000 }));
    failing = true;
    assert.throws(() => sculptor.updateVirtualList(container, replacement), /row render failed/);
    assert.equal(sculptor.rendering, false);
    // The rows that were valid before the failed pass are still mounted.
    assert.equal(sculptor.virtualListStatus(container).mounted, before);

    // A later update can still recover.
    failing = false;
    sculptor.updateVirtualList(container, replacement);
    assert.equal(sculptor.virtualListStatus(container).total, 60);
    assert.ok(sculptor.virtualListStatus(container).mounted >= before - 1);

    sculptor.dispose();
});

test('virtual rows carry position metadata unless it is disabled', () => {
    let sculptor = new DomSculptor();
    let container = virtualContainer(sculptor, 100);
    sculptor.virtualList(records(300), container, {
        rowHeight: 20,
        key: item => item.id,
        render: item => sculptor.createDetached('div').setText(item.label)
    });

    assert.equal(container.attribute.get('role'), 'list');
    let firstRow = container.html.childNodes[0].childNodes[0].childNodes[0];
    assert.equal(firstRow.getAttribute('role'), 'listitem');
    assert.equal(firstRow.getAttribute('aria-posinset'), '1');
    assert.equal(firstRow.getAttribute('aria-setsize'), '300');

    let plain = virtualContainer(sculptor, 100);
    sculptor.virtualList(records(10), plain, {
        rowHeight: 20,
        aria: false,
        render: item => sculptor.createDetached('div').setText(item.label)
    });
    assert.equal(plain.attribute.has('role'), false);
    assert.equal(plain.html.childNodes[0].childNodes[0].childNodes[0].hasAttribute('aria-posinset'), false);

    sculptor.dispose();
});

test('every member declared in the published types exists at runtime', async () => {
    let declarations = await readFile(new URL('../types/index.d.ts', import.meta.url), 'utf8');
    // Scan declaration blocks by line so nothing depends on escaped regex nesting.
    let lines = declarations.split(/\r?\n/);
    let membersOf = name => {
        let opener = lines.findIndex(line =>
            /^export (?:default )?(?:interface|class) /.test(line) &&
            line.replace(/^export (?:default )?(?:interface|class) /, '').split(/[<\s{]/)[0] === name);
        assert.notEqual(opener, -1, `no declaration found for ${name}`);
        let members = new Set();
        for (let index = opener + 1; index < lines.length && lines[index] !== '}'; index++) {
            // Members sit at one indent level; overloads repeat a name.
            let found = /^ {4}(?:readonly )?([A-Za-z_$][\w$]*)\??[(:<]/.exec(lines[index]);
            if (found) members.add(found[1]);
        }
        return [...members];
    };

    let sculptor = new DomSculptor();
    let element = sculptor.create('div');
    let component = sculptor.component(() => sculptor.createDetached('div'))();
    let virtualHost = sculptor.create('div');
    virtualHost.html.clientHeight = 100;
    sculptor.virtualList([{ id: 1 }], virtualHost, {
        rowHeight: 10,
        render: () => sculptor.createDetached('div')
    });

    let targets = {
        DomSculptor: sculptor,
        DomElement: element,
        DomAttributes: element.attribute,
        DomClasses: element.class,
        DomChildren: element.child,
        DisposalScope: sculptor.createScope(),
        Context: sculptor.createContext(),
        ComponentInstance: component,
        State: sculptor.signal(0),
        Computed: sculptor.computed(() => 1),
        AsyncState: sculptor.asyncState(),
        DataStore: sculptor.store({}),
        VirtualListStatus: sculptor.virtualListStatus(virtualHost),
        DevDomSculptor: createDevSculptor()
    };

    let missing = [];
    for (let [name, target] of Object.entries(targets)) {
        assert.ok(target, `no runtime value for ${name}`);
        for (let member of membersOf(name)) {
            if (!(member in target)) missing.push(`${name}.${member}`);
        }
    }

    // The router needs the History API, which the fake document does not provide.
    withFakeHistory('/', () => {
        let routerSculptor = new DomSculptor();
        let router = routerSculptor.router(
            { '/': () => routerSculptor.createDetached('div') },
            { parent: routerSculptor.create('main') }
        );
        for (let member of membersOf('Router')) {
            if (!(member in router)) missing.push(`Router.${member}`);
        }
        routerSculptor.dispose();
    });

    assert.deepEqual(missing, [], `declared members missing from the runtime: ${missing.join(', ')}`);
    sculptor.dispose();
});
