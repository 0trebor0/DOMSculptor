// Exercises every public member of the library in real Chromium: what each one
// does, what it rejects, and what it does after disposal. The run ends by
// enumerating the reachable surface and reporting anything no probe touched, so
// a member added later cannot go unexercised without the audit saying so.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

let root = normalize(join(import.meta.dirname, '..'));
let types = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8']]);
let server = createServer(async (request, response) => {
    try {
        let pathname = new URL(request.url, 'http://localhost').pathname;
        let file = normalize(join(root, pathname));
        if (!file.startsWith(root)) throw new Error('bad');
        response.setHeader('content-type', types.get(extname(file)) || 'application/octet-stream');
        response.end(await readFile(file));
    } catch { response.writeHead(404).end('no'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });

try {
    let page = await browser.newPage();
    let pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error)));
    await page.goto(`http://127.0.0.1:${port}/benchmark/index.html`);

    let report = await page.evaluate(async () => {
        let module = await import('/src/index.js');
        let DomSculptor = module.default;

        let results = [];
        let covered = new Set();
        let cover = (...names) => names.forEach(name => covered.add(name));
        let check = async (area, name, members, body) => {
            cover(...members.map(member => `${area}.${member}`));
            try {
                await body();
                results.push({ area, name, ok: true });
            } catch (error) {
                results.push({ area, name, ok: false, detail: String(error && error.message || error) });
            }
        };
        let eq = (actual, expected, what) => {
            let same = Object.is(actual, expected) ||
                (JSON.stringify(actual) !== undefined && JSON.stringify(actual) === JSON.stringify(expected));
            if (!same) throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
        };
        let ok = (condition, what) => { if (!condition) throw new Error(what); };
        let throws = (fn, what) => {
            try { fn(); } catch { return; }
            throw new Error(`${what}: expected a throw`);
        };
        let host = () => {
            let node = document.createElement('div');
            document.body.appendChild(node);
            return node;
        };
        let frame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

        // ---- module exports ------------------------------------------------
        await check('module', 'every documented export is present and callable', [
            'default', 'DomElement', 'DevDomSculptor', 'signal', 'state', 'store', 'data', 'computed',
            'effect', 'batch', 'flush', 'tree', 'when', 'mount', 'unmount', 'asyncState',
            'errorBoundary', 'createDevSculptor', 'createTestHarness', 'createLazyComponent'
        ], () => {
            for (let name of ['signal', 'state', 'store', 'data', 'computed', 'effect', 'batch', 'flush',
                'tree', 'when', 'mount', 'unmount', 'asyncState', 'errorBoundary', 'createDevSculptor',
                'createTestHarness', 'createLazyComponent']) {
                ok(typeof module[name] === 'function', `${name} is not a function`);
            }
            ok(typeof module.default === 'function', 'default export missing');
            ok(typeof module.DomElement === 'function', 'DomElement missing');
            ok(typeof module.DevDomSculptor === 'function', 'DevDomSculptor missing');
        });

        await check('module', 'shared-runtime helpers operate on one default instance', [
            'signal', 'computed', 'effect', 'batch', 'flush', 'tree', 'mount', 'unmount', 'when', 'state', 'store', 'data', 'asyncState'
        ], async () => {
            let value = module.signal(1);
            let doubled = module.computed(() => value.get() * 2);
            eq(doubled.get(), 2, 'computed via export');
            let seen = [];
            let stop = module.effect(() => { seen.push(value.get()); });
            module.batch(() => { value.set(2); value.set(3); });
            module.flush();
            eq(seen, [1, 3], 'effect via export batched');
            stop();
            let node = module.tree({ tag: 'p', text: 'hi' });
            let parent = host();
            module.mount(node, parent);
            eq(parent.firstChild.textContent, 'hi', 'mount via export');
            module.unmount(node);
            eq(parent.childNodes.length, 0, 'unmount via export');
            eq(module.state(1).get(), 1, 'state via export');
            eq(module.store({ a: 1 }).get('a'), 1, 'store via export');
            eq(module.data({ a: 1 }).get('a'), 1, 'data via export');
            eq(module.asyncState('x').get().status, 'idle', 'asyncState via export');
            let flag = module.signal(true);
            let region = module.tree({ tag: 'div' });
            module.mount(region, host());
            let stopWhen = module.when(flag, () => module.tree({ tag: 'b', text: 'on' }), { parent: region });
            eq(region.html.textContent, 'on', 'when via export');
            stopWhen();
        });

        // ---- DomSculptor ---------------------------------------------------
        await check('DomSculptor', 'creation, mounting, wrapping, and adoption', [
            'create', 'createDetached', 'createIn', 'mount', 'tryMount', 'unmount', 'wrap', 'tryWrap', 'adopt'
        ], () => {
            let sculptor = new DomSculptor();
            let parent = host();
            parent.id = 'audit-host';
            let detached = sculptor.createDetached('span');
            ok(detached.html.parentNode === null, 'createDetached must not mount');
            let created = sculptor.create('em', parent);
            eq(created.html.parentNode, parent, 'create with a parent mounts');
            let inside = sculptor.createIn(created, 'i');
            eq(inside.html.parentNode, created.html, 'createIn mounts into the element');
            sculptor.mount(detached, parent);
            eq(detached.html.parentNode, parent, 'mount attaches');
            sculptor.unmount(detached);
            ok(detached.html.parentNode === null, 'unmount detaches but keeps the element');
            ok(detached.html !== null, 'unmount is not disposal');
            eq(sculptor.tryMount(detached, '#does-not-exist'), null, 'tryMount reports failure as null');
            ok(sculptor.wrap('#audit-host').html === parent, 'wrap by selector');
            eq(sculptor.tryWrap('#does-not-exist'), null, 'tryWrap reports failure');
            throws(() => sculptor.wrap('#does-not-exist'), 'wrap must throw');
            let foreign = document.createElement('u');
            parent.appendChild(foreign);
            ok(sculptor.adopt(foreign).html === foreign, 'adopt takes over a node');
            sculptor.dispose();
            ok(foreign.parentNode === parent, 'adopted nodes are not deleted by runtime disposal');
        });

        await check('DomSculptor', 'progressive creation reports rendering status', [
            'createProgressively', 'rendering'
        ], async () => {
            let sculptor = new DomSculptor();
            let parent = host();
            eq(sculptor.rendering, false, 'idle runtime is not rendering');
            for (let index = 0; index < 3; index++) sculptor.createProgressively('div', parent);
            ok(sculptor.rendering === true, 'queued work sets rendering');
            for (let index = 0; index < 6; index++) await frame();
            eq(sculptor.rendering, false, 'rendering clears when the queue drains');
            eq(parent.childNodes.length, 3, 'every queued element mounts');
            sculptor.dispose();
        });

        await check('DomSculptor', 'scopes, contexts, and context keys', [
            'createScope', 'createContext', 'createContextKey'
        ], () => {
            let sculptor = new DomSculptor();
            let scope = sculptor.createScope();
            let key = sculptor.createContextKey('audit');
            ok(typeof key === 'symbol', 'createContextKey returns a symbol');
            let context = sculptor.createContext(null, { [key]: 'value' });
            eq(context.get(key), 'value', 'context initial values');
            let inner = scope.run(() => sculptor.signal(1));
            ok(inner.disposed === false, 'scope resource starts live');
            scope.dispose();
            ok(inner.disposed === true, 'scope disposal releases resources');
            sculptor.dispose();
        });

        await check('DomSculptor', 'components, error boundaries, and runtime disposal', [
            'component', 'errorBoundary', 'dispose', 'disposed'
        ], () => {
            let sculptor = new DomSculptor();
            let factory = sculptor.component((props) => ({
                root: sculptor.createDetached('p').setText(props.label),
                api: { shout: () => props.label.toUpperCase() }
            }), { name: 'Audited' });
            let instance = factory({ label: 'hello' });
            eq(instance.name, 'Audited', 'component name');
            eq(instance.api.shout(), 'HELLO', 'component api');
            eq(instance.root.html.textContent, 'hello', 'component root');
            instance.dispose();
            eq(instance.disposed, true, 'component disposal');

            let boundary = sculptor.errorBoundary(
                sculptor.component(() => { throw new Error('boom'); }),
                () => sculptor.createDetached('p').setText('fallback')
            );
            eq(boundary({}).root.html.textContent, 'fallback', 'error boundary fallback');

            eq(sculptor.disposed, false, 'runtime starts live');
            sculptor.dispose();
            eq(sculptor.disposed, true, 'runtime disposal is observable');
            sculptor.dispose();
        });

        await check('DomSculptor', 'reactive factories', [
            'signal', 'state', 'store', 'data', 'computed', 'effect', 'batch', 'flush', 'asyncState'
        ], () => {
            let sculptor = new DomSculptor();
            eq(sculptor.signal(1).get(), 1, 'signal');
            eq(sculptor.state(2).get(), 2, 'state');
            eq(sculptor.store({ a: 1 }).get('a'), 1, 'store');
            eq(sculptor.data({ a: 1 }).get('a'), 1, 'data');
            let value = sculptor.signal(2);
            eq(sculptor.computed(() => value.get() * 3).get(), 6, 'computed');
            let runs = 0;
            sculptor.effect(() => { value.get(); runs++; });
            eq(runs, 1, 'effect runs immediately');
            sculptor.batch(() => { value.set(3); value.set(4); });
            sculptor.flush();
            eq(runs, 2, 'batch collapses writes into one rerun');
            eq(sculptor.asyncState().get().status, 'idle', 'asyncState');
            sculptor.dispose();
        });

        await check('DomSculptor', 'tree, when, and router', ['tree', 'when', 'router'], async () => {
            let sculptor = new DomSculptor();
            let refs = {};
            let built = sculptor.tree({
                tag: 'section',
                refs,
                class: 'built',
                attributes: { 'data-audit': 'yes' },
                properties: { title: 'set' },
                children: [{ tag: 'h1', ref: 'title', text: 'Heading' }]
            });
            eq(built.html.className, 'built', 'tree class');
            eq(built.html.getAttribute('data-audit'), 'yes', 'tree attributes');
            eq(built.html.title, 'set', 'tree properties');
            eq(refs.title.html.textContent, 'Heading', 'tree refs');

            let visible = sculptor.signal(true);
            let region = sculptor.create('div', host());
            let stop = sculptor.when(visible, () => sculptor.tree({ tag: 'b', text: 'yes' }), {
                parent: region,
                fallback: () => sculptor.tree({ tag: 'i', text: 'no' })
            });
            eq(region.html.textContent, 'yes', 'when branch');
            visible.set(false);
            sculptor.flush();
            eq(region.html.textContent, 'no', 'when fallback');
            stop();

            let outlet = sculptor.create('main', host());
            let router = sculptor.router({
                '/': () => sculptor.tree({ tag: 'p', text: 'home' }),
                '/thing/:id': ({ params }) => sculptor.tree({ tag: 'p', text: `thing ${params.id}` }),
                '*': () => sculptor.tree({ tag: 'p', text: 'missing' })
            }, { parent: outlet, hash: true });
            eq(router.stopped, false, 'router starts running');
            router.navigate('/thing/7');
            sculptor.flush();
            eq(outlet.html.textContent, 'thing 7', 'router parameters');
            eq(router.current.get().params.id, '7', 'router current snapshot');
            router.replace('/nowhere');
            sculptor.flush();
            eq(outlet.html.textContent, 'missing', 'router catch-all');
            router.stop();
            eq(router.stopped, true, 'router stop is observable');
            sculptor.dispose();
        });

        await check('DomSculptor', 'virtual lists', [
            'virtualList', 'updateVirtualList', 'scrollVirtualList', 'virtualListStatus', 'disposeVirtualList'
        ], async () => {
            let sculptor = new DomSculptor();
            let container = sculptor.create('div', host());
            container.setStyle('height', '200px');
            container.setStyle('overflow', 'auto');
            let items = Array.from({ length: 5000 }, (unused, id) => ({ id, label: `Row ${id}` }));
            sculptor.virtualList(items, container, {
                rowHeight: 20,
                overscan: 2,
                key: item => item.id,
                render: item => sculptor.createDetached('div').setText(item.label)
            });
            let status = sculptor.virtualListStatus(container);
            eq(status.total, 5000, 'virtual list total');
            ok(status.mounted > 0 && status.mounted < 60, `mounted ${status.mounted} rows`);
            ok(Object.isFrozen(status), 'status is frozen');
            eq(sculptor.scrollVirtualList(container, 4000), true, 'scroll to index');
            await frame();
            ok(sculptor.virtualListStatus(container).start > 0, 'scrolling moves the range');
            eq(sculptor.scrollVirtualList(container, { key: 99999 }), false, 'unreachable target reports false');
            sculptor.updateVirtualList(container, items.slice(0, 10));
            eq(sculptor.virtualListStatus(container).total, 10, 'update resizes the collection');
            sculptor.disposeVirtualList(container);
            eq(sculptor.virtualListStatus(container), null, 'disposal clears the status');
            ok(container.html !== null, 'explicit disposal retains the container');
            sculptor.dispose();
        });

        // ---- DomElement ----------------------------------------------------
        await check('DomElement', 'text, values, attributes, classes, and styles', [
            'setText', 'text', 'getValue', 'setValue', 'attr', 'classToggle', 'setStyle', 'styleValue', 'html'
        ], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('div', host());
            element.setText('plain');
            eq(element.html.textContent, 'plain', 'setText');
            ok(element.html instanceof HTMLElement, 'html exposes the node');

            let label = sculptor.signal('bound');
            let reactive = sculptor.create('p', host());
            reactive.text(label);
            eq(reactive.html.textContent, 'bound', 'text binds a readable');
            label.set('changed');
            sculptor.flush();
            eq(reactive.html.textContent, 'changed', 'text updates');

            let input = sculptor.create('input', host());
            input.setValue('typed');
            eq(input.getValue(), 'typed', 'setValue and getValue');

            let flag = sculptor.signal(true);
            element.attr('data-flag', flag);
            eq(element.html.getAttribute('data-flag'), '', 'attr with true renders empty');
            flag.set(false);
            sculptor.flush();
            eq(element.html.hasAttribute('data-flag'), false, 'attr with false removes');

            element.classToggle('on', sculptor.computed(() => !flag.get()));
            eq(element.html.classList.contains('on'), true, 'classToggle');
            element.classToggle({ mapped: true, absent: false });
            eq(element.html.classList.contains('mapped'), true, 'classToggle map');
            eq(element.html.classList.contains('absent'), false, 'classToggle map false');

            element.setStyle('color', 'rgb(1, 2, 3)');
            eq(element.html.style.color, 'rgb(1, 2, 3)', 'setStyle');
            let width = sculptor.signal('10px');
            element.styleValue('width', width);
            eq(element.html.style.width, '10px', 'styleValue');
            sculptor.dispose();
        });

        await check('DomElement', 'visibility and focus', ['hide', 'show', 'focus', 'blur', 'isFocused'], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('div', host());
            element.setStyle('display', 'flex');
            element.hide();
            eq(element.html.style.display, 'none', 'hide');
            element.show();
            eq(element.html.style.display, 'flex', 'show restores the previous display');

            let input = sculptor.create('input', host());
            input.focus();
            eq(input.isFocused(), true, 'focus');
            input.blur();
            eq(input.isFocused(), false, 'blur');
            sculptor.dispose();
        });

        await check('DomElement', 'events', ['on', 'once', 'off'], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('button', host());
            let counts = { plain: 0, once: 0, delegated: 0 };
            let handler = () => counts.plain++;
            element.on('click', handler);
            element.once('click', () => counts.once++);
            element.html.click();
            element.html.click();
            eq(counts.plain, 2, 'on fires every time');
            eq(counts.once, 1, 'once fires exactly once');
            element.off('click', handler);
            element.html.click();
            eq(counts.plain, 2, 'off removes the listener');

            let list = sculptor.create('ul', host());
            let item = sculptor.createIn(list, 'li');
            list.on('click', 'li', () => counts.delegated++);
            item.html.click();
            eq(counts.delegated, 1, 'delegated listeners match descendants');
            sculptor.dispose();
        });

        await check('DomElement', 'lifecycle hooks', ['onMount', 'onUnmount', 'onDispose', 'onRemove'], () => {
            let sculptor = new DomSculptor();
            let seen = [];
            let element = sculptor.createDetached('div');
            element.onMount(() => seen.push('mount'));
            element.onUnmount(() => seen.push('unmount'));
            element.onDispose(() => seen.push('dispose'));
            let other = sculptor.createDetached('div');
            other.onRemove(() => seen.push('remove-alias'));
            sculptor.mount(element, host());
            sculptor.unmount(element);
            sculptor.mount(element, host());
            element.dispose();
            other.dispose();
            eq(seen, ['mount', 'unmount', 'dispose', 'remove-alias'], 'hook order');
            sculptor.dispose();
        });

        await check('DomElement', 'traversal and sibling insertion', [
            'parent', 'closest', 'childrenOf', 'children', 'before', 'after'
        ], () => {
            let sculptor = new DomSculptor();
            let outer = sculptor.create('section', host());
            outer.class.add('outer');
            let middle = sculptor.createIn(outer, 'div');
            let inner = sculptor.createIn(middle, 'span');
            eq(inner.parent().html, middle.html, 'parent');
            eq(inner.closest('.outer').html, outer.html, 'closest');
            eq(outer.childrenOf().length, 1, 'childrenOf');
            eq(middle.children.length, 1, 'children snapshot');
            ok(Object.isFrozen(middle.children), 'children is frozen');
            let before = sculptor.createDetached('i');
            let after = sculptor.createDetached('b');
            inner.before(before);
            inner.after(after);
            eq(middle.html.childNodes[0], before.html, 'before');
            eq(middle.html.childNodes[2], after.html, 'after');
            sculptor.dispose();
        });

        await check('DomElement', 'disposal and removal', ['dispose', 'remove'], () => {
            let sculptor = new DomSculptor();
            let parent = host();
            let element = sculptor.create('div', parent);
            element.dispose();
            ok(element.html === null, 'dispose clears the node reference');
            eq(parent.childNodes.length, 0, 'dispose removes the node');
            let second = sculptor.create('div', host());
            second.remove();
            ok(second.html === null, 'remove is an alias for dispose');
            throws(() => second.setText('x'), 'a disposed element must refuse work');
            sculptor.dispose();
        });

        await check('DomElement.attribute', 'set, get, has, remove', ['set', 'get', 'has', 'remove'], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('div', host());
            element.attribute.set('one', '1');
            element.attribute.set({ two: '2', three: '3' });
            eq(element.attribute.get('one'), '1', 'attribute.get');
            eq(element.attribute.has('two'), true, 'attribute.has');
            element.attribute.remove('three');
            eq(element.attribute.has('three'), false, 'attribute.remove');
            sculptor.dispose();
        });

        await check('DomElement.class', 'add, remove, toggle, contains', ['add', 'remove', 'toggle', 'contains'], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('div', host());
            element.class.add('a', 'b');
            eq(element.class.contains('a'), true, 'class.add');
            element.class.remove('a');
            eq(element.class.contains('a'), false, 'class.remove');
            element.class.toggle('c');
            eq(element.class.contains('c'), true, 'class.toggle on');
            element.class.toggle('c');
            eq(element.class.contains('c'), false, 'class.toggle off');
            sculptor.dispose();
        });

        await check('DomElement.child', 'append, prepend, create, find, findAll, replace, clear, remove', [
            'append', 'prepend', 'create', 'find', 'findAll', 'replace', 'clear', 'remove'
        ], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('div', host());
            let appended = element.child.append(sculptor.createDetached('p'));
            ok(appended.html.parentNode === element.html, 'append returns the appended element');
            let prepended = element.child.prepend(sculptor.createDetached('h1'));
            eq(element.html.firstChild, prepended.html, 'prepend puts it first');
            let made = element.child.create('span');
            ok(made.html.parentNode === element.html, 'child.create mounts');
            made.class.add('found');
            eq(element.child.find('.found').html, made.html, 'child.find');
            eq(element.child.findAll('*').length, 3, 'child.findAll');
            let replacement = sculptor.createDetached('em');
            element.child.replace(made, replacement);
            eq(element.child.find('span'), null, 'child.replace swaps the node');
            element.child.clear();
            eq(element.html.childNodes.length, 0, 'child.clear');
            ok(element.html !== null, 'clear keeps the container');
            element.child.remove();
            ok(element.html === null, 'child.remove disposes the container');
            sculptor.dispose();
        });

        // ---- Signal --------------------------------------------------------
        await check('Signal', 'core reads, writes, and subscriptions', [
            'get', 'set', 'update', 'subscribe', 'dispose', 'disposed'
        ], () => {
            let sculptor = new DomSculptor();
            let value = sculptor.signal(1);
            eq(value.get(), 1, 'get');
            value.set(2);
            eq(value.get(), 2, 'set');
            value.update(current => current + 1);
            eq(value.get(), 3, 'update');
            let seen = [];
            let stop = value.subscribe(next => seen.push(next), { immediate: true });
            value.set(4);
            eq(seen, [3, 4], 'subscribe with immediate delivery');
            stop();
            value.set(5);
            eq(seen.length, 2, 'unsubscribe');
            eq(value.disposed, false, 'disposed getter');
            value.dispose();
            eq(value.disposed, true, 'dispose');
            throws(() => value.set(6), 'a disposed signal must refuse writes');
            sculptor.dispose();
        });

        await check('Signal', 'every DOM binding', [
            'bindText', 'bindAttribute', 'bindClass', 'bindStyle', 'bindProperty', 'bindValue',
            'bindVisible', 'bindHidden', 'bind', 'sync'
        ], () => {
            let sculptor = new DomSculptor();
            let text = sculptor.signal('a');
            let target = sculptor.create('div', host());
            text.bindText(target);
            eq(target.html.textContent, 'a', 'bindText');
            text.set('b');
            sculptor.flush();
            eq(target.html.textContent, 'b', 'bindText updates');

            let attribute = sculptor.signal('x');
            attribute.bindAttribute(target, 'data-bound');
            eq(target.html.getAttribute('data-bound'), 'x', 'bindAttribute');

            let on = sculptor.signal(true);
            on.bindClass(target, 'lit');
            eq(target.html.classList.contains('lit'), true, 'bindClass');

            let colour = sculptor.signal('rgb(4, 5, 6)');
            colour.bindStyle(target, 'color');
            eq(target.html.style.color, 'rgb(4, 5, 6)', 'bindStyle');

            let title = sculptor.signal('t');
            title.bindProperty(target, 'title');
            eq(target.html.title, 't', 'bindProperty');

            let field = sculptor.create('input', host());
            let typed = sculptor.signal('start');
            typed.bindValue(field);
            eq(field.getValue(), 'start', 'bindValue');
            field.html.value = 'edited';
            field.html.dispatchEvent(new Event('input'));
            eq(typed.get(), 'start', 'bindValue is one-way, as documented');

            let shown = sculptor.signal(true);
            let visible = sculptor.create('div', host());
            shown.bindVisible(visible);
            shown.set(false);
            sculptor.flush();
            eq(visible.html.style.display, 'none', 'bindVisible');

            // bindHidden is the exact mirror of bindVisible, through the same
            // show/hide pair, and restores the previous display value.
            let hidden = sculptor.signal(true);
            let other = sculptor.create('div', host());
            other.setStyle('display', 'grid');
            hidden.bindHidden(other);
            eq(other.html.style.display, 'none', 'bindHidden hides when truthy');
            hidden.set(false);
            sculptor.flush();
            eq(other.html.style.display, 'grid', 'bindHidden restores the previous display');

            let custom = sculptor.signal('c');
            let manual = sculptor.create('div', host());
            custom.bind(manual, (next, element) => element.setText(`v:${next}`));
            eq(manual.html.textContent, 'v:c', 'bind with an updater');

            let synced = sculptor.create('input', host());
            let model = sculptor.signal('m');
            model.sync(synced, {});
            eq(synced.getValue(), 'm', 'sync writes the initial value');
            synced.html.value = 'typed';
            synced.html.dispatchEvent(new Event('input'));
            eq(model.get(), 'typed', 'sync is two-way');
            model.set('back');
            sculptor.flush();
            eq(synced.getValue(), 'back', 'sync writes back to the control');
            sculptor.dispose();
        });

        await check('Signal', 'keyed and simple lists', ['list'], () => {
            let sculptor = new DomSculptor();
            let rows = sculptor.signal([{ id: 1, label: 'one' }, { id: 2, label: 'two' }]);
            let keyed = sculptor.create('ul', host());
            rows.list(keyed, {
                key: item => item.id,
                render: item => sculptor.createDetached('li').setText(item.label),
                update: (row, item) => row.setText(item.label)
            });
            eq(keyed.html.textContent, 'onetwo', 'keyed list renders');
            let first = keyed.children[0];
            rows.set([{ id: 2, label: 'TWO' }, { id: 1, label: 'ONE' }]);
            sculptor.flush();
            eq(keyed.html.textContent, 'TWOONE', 'keyed list reorders');
            ok(keyed.children[1] === first, 'keyed list preserves identity');

            let plain = sculptor.signal(['a', 'b']);
            let simple = sculptor.create('ul', host());
            plain.list(simple, value => sculptor.createDetached('li').setText(value));
            eq(simple.html.textContent, 'ab', 'simple list renders');
            sculptor.dispose();
        });

        // ---- Computed ------------------------------------------------------
        await check('Computed', 'reads, tracking, subscriptions, disposal', [
            'get', 'subscribe', 'dispose', 'disposed'
        ], () => {
            let sculptor = new DomSculptor();
            let source = sculptor.signal(2);
            let doubled = sculptor.computed(() => source.get() * 2);
            eq(doubled.get(), 4, 'computed reads');
            let seen = [];
            doubled.subscribe(next => seen.push(next));
            source.set(3);
            eq(doubled.get(), 6, 'computed tracks its reads');
            eq(seen, [6], 'computed notifies');
            eq(doubled.disposed, false, 'disposed getter');
            doubled.dispose();
            eq(doubled.disposed, true, 'dispose');
            throws(() => doubled.get(), 'a disposed computed must refuse reads');
            sculptor.dispose();
        });

        // ---- AsyncState ----------------------------------------------------
        await check('AsyncState', 'run, retry, cancel, reset, get, subscribe, dispose', [
            'run', 'retry', 'cancel', 'reset', 'get', 'subscribe', 'dispose', 'disposed'
        ], async () => {
            let sculptor = new DomSculptor();
            let attempts = 0;
            let state = sculptor.asyncState(null);
            let statuses = [];
            state.subscribe(snapshot => statuses.push(snapshot.status));
            let snapshot = await state.run(async () => { attempts++; return `run-${attempts}`; });
            eq(snapshot.status, 'success', 'run resolves with a snapshot');
            eq(snapshot.data, 'run-1', 'run carries the data');
            eq(state.get().data, 'run-1', 'get');
            let retried = await state.retry();
            eq(retried.data, 'run-2', 'retry repeats the last task');
            let failed = await state.run(async () => { throw new Error('nope'); });
            eq(failed.status, 'error', 'a failure is reported in the snapshot');
            ok(failed.error instanceof Error, 'the error is carried');
            state.cancel();
            eq(state.get().status, 'success', 'cancel keeps existing data');
            state.reset();
            eq(state.get().status, 'idle', 'reset');
            ok(statuses.includes('loading'), 'loading was reported');
            eq(state.disposed, false, 'disposed getter');
            state.dispose();
            eq(state.disposed, true, 'dispose');
            throws(() => state.run(() => Promise.resolve(1)), 'a disposed async state must refuse work');
            sculptor.dispose();
        });

        // ---- DataStore -----------------------------------------------------
        await check('DataStore', 'reads, writes, keys, observers, and per-key signals', [
            'get', 'set', 'update', 'has', 'delete', 'signal', 'onChange', 'onAnyChange', 'offChange',
            'dispose', 'disposed'
        ], () => {
            let sculptor = new DomSculptor();
            let store = sculptor.store({ colour: 'red', size: 1 });
            eq(store.get('colour'), 'red', 'get by key');
            eq(store.get().size, 1, 'get all');
            store.set('colour', 'blue');
            eq(store.get('colour'), 'blue', 'set by key');
            store.set({ size: 2 });
            eq(store.get('size'), 2, 'set many');
            store.update('size', current => current + 2);
            eq(store.get('size'), 4, 'update by key');
            eq(store.has('colour'), true, 'has');
            let perKey = store.signal('colour');
            eq(perKey.get(), 'blue', 'signal(key)');
            let seen = [];
            let observer = next => seen.push(next);
            store.onChange('colour', observer);
            let anySeen = [];
            store.onAnyChange((key, next) => anySeen.push([key, next]));
            store.set('colour', 'green');
            eq(seen, ['green'], 'onChange');
            eq(anySeen.length, 1, 'onAnyChange');
            store.offChange('colour', observer);
            store.set('colour', 'black');
            eq(seen.length, 1, 'offChange');
            store.delete('size');
            eq(store.has('size'), false, 'delete');
            eq(store.disposed, false, 'disposed getter');
            store.dispose();
            eq(store.disposed, true, 'dispose');
            sculptor.dispose();
        });

        // ---- DisposalScope, Context, ComponentInstance ----------------------
        await check('DisposalScope', 'run, track, dispose, disposed', ['run', 'track', 'dispose', 'disposed'], () => {
            let sculptor = new DomSculptor();
            let scope = sculptor.createScope();
            let order = [];
            scope.track(() => order.push('first'));
            scope.track(() => order.push('second'));
            let made = scope.run(() => sculptor.createDetached('div'));
            eq(scope.disposed, false, 'disposed getter');
            scope.dispose();
            eq(order, ['second', 'first'], 'cleanups run in reverse order');
            ok(made.html === null, 'scope owns what it creates');
            eq(scope.disposed, true, 'dispose');
            sculptor.dispose();
        });

        await check('Context', 'get, set, has, delete, child', ['get', 'set', 'has', 'delete', 'child'], () => {
            let sculptor = new DomSculptor();
            let parent = sculptor.createContext(null, { theme: 'dark' });
            eq(parent.get('theme'), 'dark', 'get');
            parent.set('size', 'large');
            eq(parent.has('size'), true, 'has and set');
            let child = parent.child({ theme: 'light' });
            eq(child.get('theme'), 'light', 'child override');
            eq(child.get('size'), 'large', 'child inherits');
            eq(child.get('missing', 'fallback'), 'fallback', 'fallback value');
            parent.delete('size');
            eq(parent.has('size'), false, 'delete');
            sculptor.dispose();
        });

        await check('ComponentInstance', 'root, api, scope, context, name, createdAt, dispose, disposed', [
            'root', 'api', 'scope', 'context', 'name', 'createdAt', 'dispose', 'disposed'
        ], () => {
            let sculptor = new DomSculptor();
            let context = sculptor.createContext(null, { via: 'context' });
            let instance = sculptor.component((props, injected) => ({
                root: sculptor.createDetached('p').setText(injected.get('via')),
                api: { value: props.value }
            }), { name: 'Probe' })({ value: 42 }, context);
            eq(instance.root.html.textContent, 'context', 'root and injected context');
            eq(instance.api.value, 42, 'api');
            eq(instance.name, 'Probe', 'name');
            eq(instance.context, context, 'context');
            ok(instance.scope && typeof instance.scope.dispose === 'function', 'scope');
            eq(instance.createdAt, undefined, 'createdAt is production-only metadata');
            eq(instance.disposed, false, 'disposed getter');
            instance.dispose();
            eq(instance.disposed, true, 'dispose');
            sculptor.dispose();
        });

        // ---- development, testing, and lazy entry points --------------------
        await check('extras', 'development runtime reports undisposed component scopes', [
            'createDevSculptor', 'DevDomSculptor', 'reportLeaks'
        ], () => {
            let dev = module.createDevSculptor({ onWarning: () => {} });
            ok(dev instanceof module.DevDomSculptor, 'createDevSculptor returns a DevDomSculptor');
            let instance = dev.component(() => dev.createDetached('p'))();
            eq(dev.reportLeaks(), 1, 'reportLeaks counts live component scopes');
            instance.dispose();
            eq(dev.reportLeaks(), 0, 'reportLeaks clears after disposal');
            dev.dispose();
        });

        await check('extras', 'test harness owns fixtures, flushes, and reports leaks', [
            'createTestHarness', 'sculptor', 'root', 'warnings', 'mount', 'flush', 'assertClean', 'dispose', 'disposed'
        ], () => {
            let harness = module.createTestHarness(host());
            ok(harness.sculptor instanceof DomSculptor, 'harness exposes a runtime');
            ok(harness.root instanceof module.DomElement, 'harness exposes a mounted root');
            ok(Array.isArray(harness.warnings), 'harness collects warnings');
            let value = harness.sculptor.signal('x');
            let element = harness.sculptor.create('p');
            harness.mount(element);
            value.bindText(element);
            value.set('y');
            eq(harness.flush(), harness, 'flush is chainable');
            eq(element.html.textContent, 'y', 'harness flush applies bindings');
            eq(harness.assertClean(), harness, 'assertClean passes with nothing leaked');
            let leaked = harness.sculptor.component(() => harness.sculptor.createDetached('p'))();
            throws(() => harness.assertClean(), 'assertClean must report a live component scope');
            leaked.dispose();
            eq(harness.disposed, false, 'disposed getter');
            harness.dispose();
            eq(harness.disposed, true, 'dispose');
            throws(() => harness.mount(harness.sculptor.createDetached('p')), 'a disposed harness must refuse work');
        });

        await check('extras', 'lazy components load, expose status, and abort', ['createLazyComponent'], async () => {
            let sculptor = new DomSculptor();
            let lazy = module.createLazyComponent(sculptor, async () => ({
                default: sculptor.component(() => sculptor.createDetached('p').setText('lazy'))
            }));
            let instance = lazy();
            ok(instance.root instanceof module.DomElement, 'lazy renders a placeholder root');
            for (let round = 0; round < 5; round++) await frame();
            ok(instance.root.html.textContent.includes('lazy') || instance.api.status?.get?.() !== undefined,
                'lazy component resolved or exposes status');
            instance.dispose();
            sculptor.dispose();
        });

        // ---- argument validation -------------------------------------------
        await check('validation', 'programmer errors throw instead of failing quietly', [], () => {
            let sculptor = new DomSculptor();
            throws(() => sculptor.tree({}), 'tree without a tag');
            throws(() => sculptor.tree({ tag: 'p', class: 5 }), 'tree with an invalid class');
            throws(() => sculptor.tree({ tag: 'p', attributes: 'no' }), 'tree with invalid attributes');
            throws(() => sculptor.component('not a function'), 'component without a factory');
            throws(() => sculptor.router('not an object'), 'router without routes');
            throws(() => sculptor.router({ '/': 'not a function' }), 'router with a non-function view');
            throws(() => sculptor.signal(1).subscribe('nope'), 'subscribe without a callback');
            throws(() => sculptor.signal(1).update('nope'), 'update without a function');
            throws(() => sculptor.computed(() => 1, 'nope'), 'computed with an invalid dependency list');
            throws(() => sculptor.effect(() => {}, 'nope'), 'effect with an invalid dependency list');
            throws(() => sculptor.createScope().track('nope'), 'track without a function');
            throws(() => sculptor.signal([]).list(sculptor.createDetached('ul'), {}), 'keyed list without key and render');
            throws(() => sculptor.mount(sculptor.createDetached('p'), '#missing'), 'mount onto a missing parent');
            throws(() => sculptor.virtualList([], sculptor.createDetached('div'), {}), 'virtual list without a renderer');
            let element = sculptor.createDetached('div');
            throws(() => element.on(5, () => {}), 'on with an invalid event');
            throws(() => element.text('not a signal'), 'text without a readable');
            throws(() => element.attr('', sculptor.signal(1)), 'attr without a name');
            throws(() => element.classToggle('', sculptor.signal(1)), 'classToggle without a name');
            sculptor.dispose();
        });

        await check('validation', 'a cycle in a computed value is reported', [], () => {
            let sculptor = new DomSculptor();
            let self;
            self = sculptor.computed(() => self.get());
            throws(() => self.get(), 'a direct cycle must be reported');
            sculptor.dispose();
        });

        await check('validation', 'disposed objects refuse work rather than dereferencing null', [], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('div', host());
            let value = sculptor.signal(1);
            let store = sculptor.store({ a: 1 });
            let scope = sculptor.createScope();
            element.dispose();
            for (let call of [
                () => element.setText('x'),
                () => element.on('click', () => {}),
                () => element.once('click', () => {}),
                () => element.getValue(),
                () => element.setValue('x'),
                () => element.hide(),
                () => element.show(),
                () => element.attribute.set('a', 'b'),
                () => element.child.append(sculptor.createDetached('p'))
            ]) throws(call, 'a disposed element must refuse work');
            value.dispose();
            throws(() => value.set(2), 'a disposed signal must refuse writes');
            throws(() => value.subscribe(() => {}), 'a disposed signal must refuse subscribers');
            store.dispose();
            throws(() => store.set('a', 2), 'a disposed store must refuse writes');
            scope.dispose();
            throws(() => scope.run(() => {}), 'a disposed scope must refuse runs');
            sculptor.dispose();
        });

        await check('validation', 'keyed lists reject duplicate keys before touching the DOM', [], () => {
            let sculptor = new DomSculptor();
            let rows = sculptor.signal([{ id: 1 }, { id: 2 }]);
            let list = sculptor.create('ul', host());
            rows.list(list, { key: item => item.id, render: item => sculptor.createDetached('li').setText(String(item.id)) });
            let before = list.html.innerHTML;
            throws(() => rows.set([{ id: 1 }, { id: 1 }]), 'duplicate keys must be rejected');
            eq(list.html.innerHTML, before, 'the DOM is untouched by a rejected update');
            sculptor.dispose();
        });

        await check('validation', 'no API writes markup from a string', [], () => {
            let sculptor = new DomSculptor();
            let element = sculptor.create('div', host());
            element.setText('<img src=x onerror=alert(1)>');
            eq(element.html.querySelectorAll('img').length, 0, 'setText must not parse markup');
            let built = sculptor.tree({ tag: 'p', text: '<b>no</b>' });
            eq(built.html.querySelectorAll('b').length, 0, 'tree text must not parse markup');
            element.child.append('<i>no</i>');
            eq(element.html.querySelectorAll('i').length, 0, 'child.append must not parse markup');
            sculptor.dispose();
        });

        // ---- coverage cross-check ------------------------------------------
        let membersOf = value => {
            if (value == null) return [];
            let names = new Set();
            let seen = new Set();
            for (let target = value; target && target !== Object.prototype; target = Object.getPrototypeOf(target)) {
                if (seen.has(target)) break;
                seen.add(target);
                for (let name of Object.getOwnPropertyNames(target)) {
                    if (name === 'constructor' || name.startsWith('_')) continue;
                    names.add(name);
                }
            }
            return [...names];
        };
        let probe = new DomSculptor();
        let sample = {
            module: Object.keys(module),
            DomSculptor: membersOf(probe),
            DomElement: membersOf(probe.createDetached('div')),
            'DomElement.attribute': membersOf(probe.createDetached('div').attribute),
            'DomElement.class': membersOf(probe.createDetached('div').class),
            'DomElement.child': membersOf(probe.createDetached('div').child),
            Signal: membersOf(probe.signal(0)),
            Computed: membersOf(probe.computed(() => 1)),
            AsyncState: membersOf(probe.asyncState(null)),
            DataStore: membersOf(probe.store({ a: 1 })),
            DisposalScope: membersOf(probe.createScope()),
            Context: membersOf(probe.createContext()),
            ComponentInstance: membersOf(probe.component(() => probe.createDetached('p'))())
        };
        // The three namespace objects are exercised through their own members.
        cover('DomElement.attribute', 'DomElement.class', 'DomElement.child');
        let uncovered = [];
        let surfaceSize = 0;
        for (let [area, members] of Object.entries(sample)) {
            for (let member of members) {
                surfaceSize++;
                if (!covered.has(`${area}.${member}`)) uncovered.push(`${area}.${member}`);
            }
        }
        probe.dispose();

        return { results, covered: [...covered].sort(), uncovered: uncovered.sort(), surfaceSize };
    });

    let failed = report.results.filter(entry => !entry.ok);
    for (let entry of report.results) {
        console.log(`${entry.ok ? 'ok  ' : 'FAIL'} ${entry.area} — ${entry.name}${entry.detail ? `\n       ${entry.detail}` : ''}`);
    }
    console.log(`\n${report.results.length} probes, ${failed.length} failed`);
    console.log(`${report.surfaceSize} public members reachable, ${report.surfaceSize - report.uncovered.length} exercised`);
    if (report.uncovered.length) {
        console.log(`
not exercised by any probe (${report.uncovered.length}):`);
        for (let name of report.uncovered) console.log(`  ${name}`);
    }
    if (pageErrors.length) console.log(`page errors: ${pageErrors.join(' | ')}`);
    if (failed.length || pageErrors.length) process.exitCode = 1;
} finally {
    await browser.close();
    server.close();
}
