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

let { default: DomSculptor } = await import('../src/index.js');

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

test('creating with a removed parent does not create stale ownership', () => {
    let sculptor = new DomSculptor();
    let parent = sculptor.create('div');
    parent.remove();
    let child = sculptor.create('span', parent);
    assert.deepEqual(parent.children, []);
    assert.equal(child.parent(), null);
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
    assert.equal(el.class.contains('active'), false);
    assert.equal(el.html.style.display, 'none');
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
    assert.deepEqual(statuses, ['loading', 'success', 'loading', 'success', 'loading', 'error']);
});
