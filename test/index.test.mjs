import test from 'node:test';
import assert from 'node:assert/strict';

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
    createDevSculptor,
    signal,
    computed,
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

test('create mounts one parented element per frame while preserving chaining and order', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let items = ['one', 'two', 'three'];
        let created = items.map(item => sculptor.create('li', container).setText(item));

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

test('create progressively mounts 100 elements without losing order or configuration', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let elements = Array.from({ length: 100 }, (_, index) =>
            sculptor.create('li', container)
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

test('create handles nested parents without requiring mount', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul', document.body);
        let first = sculptor.create('li', container).setText('one');
        let second = sculptor.create('li', container).setText('two');

        assert.equal(container.html.parentNode, document.body);
        assert.deepEqual(container.children, [first]);
        assert.equal(second.html.parentNode, null);
        assert.equal(sculptor.rendering, true);

        await frames.runNext();
        await frames.runNext();
        assert.deepEqual(container.children, [first, second]);
        assert.equal(sculptor.rendering, false);
        container.dispose();
    });
});

test('queued create supports configuration, events, bindings, children, and lifecycle hooks', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('section');
        sculptor.create('p', container).setText('first');
        let label = sculptor.signal('queued');
        let clicks = 0;
        let mounts = 0;
        let callbackElement = null;
        let queued = sculptor.create('button', container, element => {
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

test('create skips a queued element disposed before its frame', async () => {
    await withManualAnimationFrames(async frames => {
        let sculptor = new DomSculptor();
        let container = sculptor.create('ul');
        let first = sculptor.create('li', container).setText('one');
        let removed = sculptor.create('li', container).setText('two');
        removed.dispose();
        await frames.runNext();
        assert.deepEqual(container.children, [first]);
        assert.equal(sculptor.rendering, false);
    });
});

test('create uses a timer when animation frames are unavailable', async () => {
    let sculptor = new DomSculptor();
    let container = sculptor.create('ul');
    sculptor.create('li', container).setText('1');
    sculptor.create('li', container).setText('2');
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
