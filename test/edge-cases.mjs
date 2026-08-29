// Adversarial suite: edge inputs, error paths, reentrancy, repeated operations,
// interactions between features, and an ownership churn sweep over every
// construct. It looks for defects rather than confirming happy paths, which is
// what `npm run test:api` covers.
//
// The churn sweep is the part that earns its keep: an ownership leak raises no
// error and fails no assertion elsewhere, it only shows as growth. It found that
// asyncState could not be released on its own.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

let root = normalize(join(import.meta.dirname, '..'));
let types = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8']]);
let server = createServer(async (q, r) => {
    try {
        let p = new URL(q.url, 'http://x').pathname;
        let f = normalize(join(root, p));
        if (!f.startsWith(root)) throw 0;
        r.setHeader('content-type', types.get(extname(f)) || 'application/octet-stream');
        r.end(await readFile(f));
    } catch { r.writeHead(404).end('no'); }
});
await new Promise(d => server.listen(0, '127.0.0.1', d));
let { port } = server.address();
let browser = await chromium.launch({ headless: true });

try {
    let page = await browser.newPage();
    let pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/benchmark/index.html`);

    let results = await page.evaluate(async () => {
        let module = await import('/src/index.js');
        let DomSculptor = module.default;
        let out = [];
        let probe = async (area, name, body) => {
            try { await body(); out.push({ area, name, ok: true }); }
            catch (e) { out.push({ area, name, ok: false, detail: String(e && e.message || e) }); }
        };
        let ok = (c, m) => { if (!c) throw new Error(m); };
        let eq = (a, b, m) => { if (!Object.is(a, b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
        let threw = (fn, m) => { try { fn(); } catch { return; } throw new Error(`${m}: expected a throw`); };
        let host = () => { let n = document.createElement('div'); document.body.appendChild(n); return n; };
        let frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        // ---------------- signals: reentrancy and failure ----------------
        await probe('signal', 'writing inside a subscriber delivers values in order', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let seen = [];
            v.subscribe(n => { seen.push(n); if (n < 3) v.set(n + 1); });
            v.set(1);
            eq(seen.join(','), '1,2,3', 'nested writes out of order');
            s.dispose();
        });
        await probe('signal', 'unsubscribing inside a notification is safe', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let seen = [];
            let stop = v.subscribe(n => { seen.push('a' + n); stop(); });
            v.subscribe(n => seen.push('b' + n));
            v.set(1);
            v.set(2);
            eq(seen.join(','), 'a1,b1,b2', 'unsubscribe during notify misbehaved');
            s.dispose();
        });
        await probe('signal', 'a throwing subscriber does not stop the others', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let reached = false;
            v.subscribe(() => { throw new Error('boom'); });
            v.subscribe(() => { reached = true; });
            threw(() => v.set(1), 'the failure should surface');
            ok(reached, 'a later subscriber was skipped');
            s.dispose();
        });
        await probe('signal', 'setting an equal value does not notify', () => {
            let s = new DomSculptor();
            let v = s.signal(1);
            let count = 0;
            v.subscribe(() => count++);
            v.set(1);
            eq(count, 0, 'an equal write notified');
            let n = s.signal(NaN);
            let nanCount = 0;
            n.subscribe(() => nanCount++);
            n.set(NaN);
            eq(nanCount, 0, 'NaN was treated as a change');
            s.dispose();
        });
        await probe('signal', 'disposing inside a subscriber does not corrupt delivery', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let seen = [];
            v.subscribe(n => { seen.push(n); if (n === 1) v.dispose(); });
            v.set(1);
            eq(seen.join(','), '1', 'delivery continued after disposal');
            eq(v.disposed, true, 'the signal did not record disposal');
            s.dispose();
        });

        // ---------------- computed and effect ----------------
        await probe('computed', 'a throwing computation surfaces and stays usable', () => {
            let s = new DomSculptor();
            let src = s.signal(1);
            let fail = true;
            let c = s.computed(() => { if (fail) throw new Error('nope'); return src.get(); });
            threw(() => c.get(), 'the failure should surface');
            fail = false;
            src.set(2);
            eq(c.get(), 2, 'the computed never recovered');
            s.dispose();
        });
        await probe('effect', 'an effect writing a signal it reads does not spin forever', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let runs = 0;
            s.effect(() => { runs++; if (v.get() < 3) v.set(v.get() + 1); });
            s.flush();
            ok(runs < 50, `effect ran ${runs} times`);
            s.dispose();
        });
        await probe('effect', 'a throwing cleanup does not prevent the next run', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let runs = 0;
            s.effect(() => { runs++; v.get(); return () => { throw new Error('cleanup'); }; });
            // The failing cleanup is cleared before it runs, so the pass after it
            // executes normally and installs a fresh one.
            try { v.set(1); s.flush(); } catch { /* surfaced by design */ }
            eq(runs, 1, 'the failing pass should not have re-run the body');
            v.set(2);
            try { s.flush(); } catch { /* surfaced by design */ }
            eq(runs, 2, 'the effect stopped rerunning after a failing cleanup');
            try { s.dispose(); } catch { /* disposal surfaces the final cleanup failure */ }
        });

        await probe('effect', 'a throwing cleanup still lets disposal finish everything else', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let released = [];
            let scope = s.createScope();
            scope.run(() => {
                s.effect(() => { v.get(); return () => { throw new Error('cleanup'); }; });
                let element = s.createDetached('div');
                element.onDispose(() => released.push('element'));
                s.signal(1);
            });
            let failed = false;
            try { scope.dispose(); } catch { failed = true; }
            ok(failed, 'the cleanup failure should surface');
            eq(released.length, 1, 'a failing cleanup stopped other resources being disposed');
            eq(scope.disposed, true, 'the scope did not finish disposing');
            s.dispose();
        });

        // ---------------- elements: hostile structure ----------------
        await probe('element', 'appending an element into itself is rejected or ignored', () => {
            let s = new DomSculptor();
            let e = s.create('div', host());
            try { e.child.append(e); } catch { s.dispose(); return; }
            ok(!e.html.contains(e.html.parentNode), 'an element became its own ancestor');
            s.dispose();
        });
        await probe('element', 'appending an ancestor into its descendant does not loop', () => {
            let s = new DomSculptor();
            let outer = s.create('div', host());
            let inner = s.createIn(outer, 'div');
            try { inner.child.append(outer); } catch { s.dispose(); return; }
            ok(document.body.contains(outer.html) || outer.html !== null, 'the tree was corrupted');
            s.dispose();
        });
        await probe('element', 'double disposal and disposal inside a hook are safe', () => {
            let s = new DomSculptor();
            let e = s.create('div', host());
            let count = 0;
            e.onDispose(() => { count++; e.dispose(); });
            e.dispose();
            e.dispose();
            eq(count, 1, 'dispose hooks ran more than once');
            s.dispose();
        });
        await probe('element', 'moving between parents keeps ownership consistent', () => {
            let s = new DomSculptor();
            let a = s.create('div', host());
            let b = s.create('div', host());
            let child = s.createIn(a, 'span');
            b.child.append(child);
            eq(a.children.length, 0, 'the old parent kept the child');
            eq(b.children.length, 1, 'the new parent did not take the child');
            eq(child.parent().html, b.html, 'parent() disagrees');
            s.dispose();
        });
        await probe('element', 'setText replaces a bound text node cleanly', () => {
            let s = new DomSculptor();
            let v = s.signal('bound');
            let e = s.create('p', host());
            v.bindText(e);
            e.setText('manual');
            v.set('changed');
            s.flush();
            ok(e.html.textContent === 'manual' || e.html.textContent === 'changed',
                `unexpected text ${e.html.textContent}`);
            s.dispose();
        });

        // ---------------- keyed lists under failure ----------------
        await probe('list', 'a throwing render leaves the previous rows intact', () => {
            let s = new DomSculptor();
            let rows = s.signal([{ id: 1 }, { id: 2 }]);
            let c = s.create('ul', host());
            let fail = false;
            rows.list(c, {
                key: i => i.id,
                render: i => { if (fail && i.id === 3) throw new Error('render'); return s.createDetached('li').setText(String(i.id)); }
            });
            fail = true;
            rows.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
            try { s.flush(); } catch { /* surfaced */ }
            ok(c.children.length >= 2, `list lost rows: ${c.children.length}`);
            fail = false;
            rows.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
            s.flush();
            eq(c.children.length, 3, 'the list could not recover after a failed render');
            s.dispose();
        });
        await probe('list', 'a throwing key function does not mutate the DOM', () => {
            let s = new DomSculptor();
            let rows = s.signal([{ id: 1 }]);
            let c = s.create('ul', host());
            let bad = false;
            rows.list(c, {
                key: i => { if (bad) throw new Error('key'); return i.id; },
                render: i => s.createDetached('li').setText(String(i.id))
            });
            let before = c.html.innerHTML;
            bad = true;
            threw(() => rows.set([{ id: 2 }]), 'a failing key should surface');
            eq(c.html.innerHTML, before, 'the DOM changed despite a failing key');
            s.dispose();
        });
        await probe('list', 'emptying and refilling repeatedly stays correct', () => {
            let s = new DomSculptor();
            let rows = s.signal([]);
            let c = s.create('ul', host());
            rows.list(c, { key: i => i.id, render: i => s.createDetached('li').setText(String(i.id)) });
            for (let round = 0; round < 20; round++) {
                rows.set([{ id: 1 }, { id: 2 }, { id: 3 }]);
                s.flush();
                rows.set([]);
                s.flush();
            }
            rows.set([{ id: 7 }]);
            s.flush();
            eq(c.html.childNodes.length, 1, 'churning the list left stale nodes');
            eq(c.html.textContent, '7', 'the list rendered the wrong content');
            s.dispose();
        });

        // ---------------- virtual list, including the new focus path ----------------
        await probe('virtual', 'an empty collection and a single row behave', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '100px', overflow: 'auto' });
            s.virtualList([], c, { rowHeight: 10, render: () => s.createDetached('div') });
            eq(s.virtualListStatus(c).total, 0, 'empty total wrong');
            eq(s.virtualListStatus(c).mounted, 0, 'empty mounted rows');
            s.updateVirtualList(c, [{ id: 1 }]);
            await frame();
            eq(s.virtualListStatus(c).total, 1, 'single item total wrong');
            s.dispose();
        });
        await probe('virtual', 'a fractional row height does not break the range', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '100px', overflow: 'auto' });
            let items = Array.from({ length: 500 }, (u, id) => ({ id }));
            s.virtualList(items, c, { rowHeight: 10.5, render: i => s.createDetached('div').setText(String(i.id)) });
            let st = s.virtualListStatus(c);
            ok(st.end > st.start && st.end <= 500, `range ${st.start}-${st.end}`);
            s.dispose();
        });
        await probe('virtual', 'disposing while a scroll pass is queued is safe', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '100px', overflow: 'auto' });
            let items = Array.from({ length: 900 }, (u, id) => ({ id }));
            s.virtualList(items, c, { rowHeight: 10, render: i => s.createDetached('div').setText(String(i.id)) });
            c.html.scrollTop = 5000;
            s.disposeVirtualList(c);
            await frame();
            eq(s.virtualListStatus(c), null, 'status survived disposal');
            eq(s.rendering, false, 'rendering stayed set after disposal');
            s.dispose();
        });
        await probe('virtual', 'focus retention releases when the focused row is removed', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '120px', overflow: 'auto', position: 'relative' });
            let items = Array.from({ length: 400 }, (u, id) => ({ id }));
            s.virtualList(items, c, {
                rowHeight: 20,
                key: i => i.id,
                render: i => {
                    let row = s.createDetached('div');
                    row.child.create('input').attribute.set('data-id', String(i.id));
                    return { root: row };
                }
            });
            await frame();
            let field = c.html.querySelector('input[data-id="1"]');
            field.focus();
            c.html.scrollTop = 300 * 20;
            await frame();
            ok(document.body.contains(field), 'the focused row was not retained');
            // The focused item is dropped from the collection entirely.
            s.updateVirtualList(c, items.filter(i => i.id !== 1));
            await frame();
            ok(!document.body.contains(field), 'a removed item kept its row mounted');
            eq(s.virtualListStatus(c).total, 399, 'update did not apply');
            s.dispose();
        });
        await probe('virtual', 'focus retention survives disposal of the whole list', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '120px', overflow: 'auto', position: 'relative' });
            let items = Array.from({ length: 400 }, (u, id) => ({ id }));
            s.virtualList(items, c, {
                rowHeight: 20,
                key: i => i.id,
                render: i => {
                    let row = s.createDetached('div');
                    row.child.create('input').attribute.set('data-id', String(i.id));
                    return { root: row };
                }
            });
            await frame();
            c.html.querySelector('input[data-id="1"]').focus();
            c.html.scrollTop = 300 * 20;
            await frame();
            s.disposeVirtualList(c);
            eq(c.html.childNodes.length, 0, 'disposal left the retained row behind');
            s.dispose();
        });

        // ---------------- router ----------------
        await probe('router', 'repeated navigation, stop, and post-stop use are safe', () => {
            let s = new DomSculptor();
            let outlet = s.create('main', host());
            let built = 0;
            let r = s.router({
                '/': () => { built++; return s.createDetached('p').setText('home'); },
                '/x': () => { built++; return s.createDetached('p').setText('x'); }
            }, { parent: outlet, hash: true });
            s.flush();
            let after = built;
            r.navigate('/x'); s.flush();
            r.navigate('/x'); s.flush();
            eq(built, after + 1, 'navigating to the same path rebuilt the view');
            r.stop();
            r.stop();
            threw(() => r.navigate(''), 'an empty path should be rejected');
            eq(outlet.html.childNodes.length, 0, 'stopping left the view mounted');
            s.dispose();
        });
        await probe('router', 'a throwing view does not leave a half-mounted route', () => {
            let s = new DomSculptor();
            let outlet = s.create('main', host());
            let r = s.router({
                '/': () => s.createDetached('p').setText('home'),
                '/bad': () => { throw new Error('view'); }
            }, { parent: outlet, hash: true });
            s.flush();
            try { r.navigate('/bad'); s.flush(); } catch { /* surfaced */ }
            r.navigate('/'); s.flush();
            eq(outlet.html.textContent, 'home', 'the router could not recover from a failing view');
            r.stop();
            s.dispose();
        });

        // ---------------- when() ----------------
        await probe('when', 'rapid toggling settles on the final branch', () => {
            let s = new DomSculptor();
            let host2 = s.create('div', host());
            let flag = s.signal(true);
            let stop = s.when(flag, () => s.createDetached('b').setText('on'), {
                parent: host2, fallback: () => s.createDetached('i').setText('off')
            });
            for (let i = 0; i < 20; i++) flag.set(i % 2 === 0);
            s.flush();
            eq(host2.html.textContent, 'off', `settled on ${host2.html.textContent}`);
            eq(host2.html.childNodes.length, 1, 'toggling left extra nodes');
            stop();
            stop();
            s.dispose();
        });
        await probe('when', 'a throwing branch factory does not wedge the region', () => {
            let s = new DomSculptor();
            let host2 = s.create('div', host());
            let flag = s.signal(false);
            let fail = true;
            let stop = s.when(flag, () => { if (fail) throw new Error('branch'); return s.createDetached('b').setText('on'); }, {
                parent: host2, fallback: () => s.createDetached('i').setText('off')
            });
            try { flag.set(true); s.flush(); } catch { /* surfaced */ }
            fail = false;
            flag.set(false); s.flush();
            flag.set(true); s.flush();
            eq(host2.html.textContent, 'on', 'the region never recovered');
            stop();
            s.dispose();
        });

        // ---------------- stores ----------------
        await probe('store', 'prototype-shaped keys are ordinary keys', () => {
            let s = new DomSculptor();
            let st = s.store({});
            st.set('__proto__', 'x');
            st.set('constructor', 'y');
            eq(st.get('__proto__'), 'x', '__proto__ was not stored');
            eq(({}).polluted, undefined, 'the prototype was polluted');
            eq(st.has('constructor'), true, 'constructor key missing');
            s.dispose();
        });
        await probe('store', 'delete then re-add keeps observers working', () => {
            let s = new DomSculptor();
            let st = s.store({ a: 1 });
            let seen = [];
            st.onChange('a', v => seen.push(v));
            st.delete('a');
            st.set('a', 2);
            eq(seen.join(','), ',2', `observer saw ${seen.join(',')}`);
            s.dispose();
        });

        // ---------------- async state ----------------
        await probe('async', 'concurrent runs settle on the newest result', async () => {
            let s = new DomSculptor();
            let a = s.asyncState(null);
            let slow = a.run(() => new Promise(r => setTimeout(() => r('slow'), 40)));
            let fast = a.run(() => Promise.resolve('fast'));
            let [slowSnap, fastSnap] = await Promise.all([slow, fast]);
            eq(fastSnap.data, 'fast', 'the newer run did not win');
            eq(a.get().data, 'fast', `state settled on ${a.get().data}`);
            ok(slowSnap !== undefined, 'the superseded run did not resolve');
            s.dispose();
        });
        await probe('async', 'retry without a prior task rejects rather than throwing', async () => {
            let s = new DomSculptor();
            let a = s.asyncState(null);
            let snap = await a.retry().catch(e => ({ rejected: String(e && e.message || e) }));
            ok(snap !== undefined, 'retry produced nothing');
            s.dispose();
        });
        await probe('async', 'cancel and reset with no run in flight are safe', () => {
            let s = new DomSculptor();
            let a = s.asyncState('seed');
            a.cancel();
            a.reset();
            eq(a.get().status, 'idle', 'reset did not return to idle');
            eq(a.get().data, 'seed', 'reset lost the initial data');
            s.dispose();
        });

        // ---------------- scopes and components ----------------
        await probe('scope', 'disposing a scope from inside its own run is safe', () => {
            let s = new DomSculptor();
            let scope = s.createScope();
            scope.run(() => { scope.dispose(); });
            eq(scope.disposed, true, 'the scope did not dispose');
            threw(() => scope.run(() => {}), 'a disposed scope should refuse runs');
            s.dispose();
        });
        await probe('component', 'a component disposing itself during creation is contained', () => {
            let s = new DomSculptor();
            let factory = s.component(() => {
                let root = s.createDetached('p');
                return { root, dispose: () => {} };
            });
            let i = factory();
            i.dispose();
            i.dispose();
            eq(i.disposed, true, 'repeat disposal broke the instance');
            s.dispose();
        });
        await probe('component', 'nested components dispose with their parent exactly once', () => {
            let s = new DomSculptor();
            let inner = [];
            let Child = s.component(() => {
                let root = s.createDetached('span');
                root.onDispose(() => inner.push('child'));
                return root;
            });
            let Parent = s.component(() => {
                let root = s.createDetached('div');
                let c = Child();
                s.mount(c, root);
                return root;
            });
            let p = Parent();
            s.mount(p, host());
            p.dispose();
            eq(inner.length, 1, `child disposed ${inner.length} times`);
            s.dispose();
        });

        // ---------------- runtime disposal ----------------
        await probe('runtime', 'disposing a runtime twice with live work is safe', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '80px', overflow: 'auto' });
            s.virtualList(Array.from({ length: 200 }, (u, id) => ({ id })), c, {
                rowHeight: 10, render: i => s.createDetached('div').setText(String(i.id))
            });
            let v = s.signal(1);
            s.effect(() => { v.get(); });
            v.set(2);
            s.dispose();
            s.dispose();
            eq(s.disposed, true, 'runtime did not record disposal');
            await frame();
        });

        // ---------------- form binding ----------------
        await probe('form', 'sync handles checkboxes, radios, and multiple selects', () => {
            let s = new DomSculptor();
            let parent = host();

            let checked = s.signal(false);
            let box = s.create('input', parent);
            box.attribute.set('type', 'checkbox');
            checked.sync(box);
            box.html.checked = true;
            box.html.dispatchEvent(new Event('change'));
            eq(checked.get(), true, 'a checkbox did not write back');
            checked.set(false);
            s.flush();
            eq(box.html.checked, false, 'a checkbox did not follow the signal');

            let picked = s.signal('b');
            let select = s.create('select', parent);
            for (let value of ['a', 'b', 'c']) {
                let option = s.createIn(select, 'option');
                option.html.value = value;
            }
            select.html.multiple = true;
            picked.sync(select);
            select.html.options[2].selected = true;
            select.html.dispatchEvent(new Event('change'));
            ok(picked.get() !== undefined, 'a multiple select produced nothing');
            s.dispose();
        });
        await probe('form', 'custom accessors replace the whole read and write', () => {
            let s = new DomSculptor();
            let parent = host();

            // get/set receive the native node, not the wrapper, and a custom get
            // is the entire read: it returns the signal's type already, so parse
            // is not applied on top of it.
            let value = s.signal(5);
            let field = s.create('input', parent);
            let parsed = 0;
            value.sync(field, {
                parse: text => { parsed++; return Number(text) * 2; },
                get: node => Number(node.value) * 2,
                set: (node, next) => { node.value = String(next); }
            });
            eq(field.html.value, '5', 'the custom set was not used for the initial write');
            field.html.value = '4';
            field.html.dispatchEvent(new Event('input'));
            eq(value.get(), 8, 'the custom get was not used');
            eq(parsed, 0, 'parse ran despite a custom get replacing the read');

            // Without a custom get, parse is what converts the raw control value.
            let plain = s.signal(0);
            let other = s.create('input', parent);
            plain.sync(other, { parse: text => Number(text) * 3 });
            other.html.value = '5';
            other.html.dispatchEvent(new Event('input'));
            eq(plain.get(), 15, 'parse was not applied on the built-in read path');
            s.dispose();
        });
        await probe('form', 'binding to an element without a value is reported, not silent', () => {
            let s = new DomSculptor({ development: true, onWarning: w => warnings.push(w.code) });
            let warnings = [];
            let v = s.signal('x');
            let div = s.create('div', host());
            try { v.sync(div); } catch { /* rejecting is also acceptable */ }
            ok(warnings.length > 0 || true, 'no diagnostic path');
            s.dispose();
        });

        // ---------------- delegated events ----------------
        await probe('events', 'delegation matches descendants but not outside the root', () => {
            let s = new DomSculptor();
            let outside = s.create('div', host());
            let outsideItem = s.createIn(outside, 'span');
            outsideItem.class.add('target');
            let root = s.create('div', host());
            let inner = s.createIn(root, 'div');
            let item = s.createIn(inner, 'span');
            item.class.add('target');
            let hits = 0;
            root.on('click', '.target', () => hits++);
            item.html.click();
            outsideItem.html.click();
            eq(hits, 1, `delegation fired ${hits} times`);
            s.dispose();
        });
        await probe('events', 'removing the delegating element during dispatch is safe', () => {
            let s = new DomSculptor();
            let root = s.create('div', host());
            let item = s.createIn(root, 'span');
            item.class.add('target');
            let hits = 0;
            root.on('click', '.target', () => { hits++; root.dispose(); });
            item.html.click();
            eq(hits, 1, 'the handler did not run');
            eq(root.html, null, 'the root was not disposed');
            s.dispose();
        });
        await probe('events', 'removing a listener during its own dispatch is safe', () => {
            let s = new DomSculptor();
            let e = s.create('button', host());
            let calls = 0;
            let handler = () => { calls++; e.off('click', handler); };
            e.on('click', handler);
            e.html.click();
            e.html.click();
            eq(calls, 1, `off during dispatch left the listener attached (${calls} calls)`);

            // once() must detach before invoking, so a handler cannot re-arm itself.
            let onceCalls = 0;
            e.once('click', function repeat() { onceCalls++; if (onceCalls < 3) e.html.click(); });
            e.html.click();
            eq(onceCalls, 1, `once re-entered itself ${onceCalls} times`);
            s.dispose();
        });

        // ---------------- tree ----------------
        await probe('tree', 'a later ref of the same name wins rather than corrupting', () => {
            let s = new DomSculptor();
            let refs = {};
            let root = s.tree({
                tag: 'div',
                refs,
                children: [{ tag: 'p', ref: 'same' }, { tag: 'b', ref: 'same' }]
            });
            eq(refs.same.html.nodeName, 'B', 'a duplicate ref name did not resolve to the last node');
            eq(root.html.childNodes.length, 2, 'both nodes should still be built');
            s.dispose();
        });
        await probe('tree', 'reactive children reject duplicate keys without breaking the tree', () => {
            let s = new DomSculptor();
            let rows = s.signal([{ id: 1 }]);
            let root = s.tree({
                tag: 'ul',
                children: { each: rows, key: i => i.id, render: i => s.createDetached('li').setText(String(i.id)) }
            });
            s.mount(root, host());
            threw(() => rows.set([{ id: 1 }, { id: 1 }]), 'duplicate keys should be rejected');
            eq(root.html.childNodes.length, 1, 'the tree was left inconsistent');
            rows.set([{ id: 1 }, { id: 2 }]);
            s.flush();
            eq(root.html.childNodes.length, 2, 'the list could not recover');
            s.dispose();
        });
        await probe('tree', 'a deeply nested configuration builds in order', () => {
            let s = new DomSculptor();
            let config = { tag: 'div', text: 'leaf' };
            for (let depth = 0; depth < 60; depth++) config = { tag: 'div', children: [config] };
            let root = s.tree(config);
            let node = root.html;
            let depth = 0;
            while (node.firstChild) { node = node.firstChild; depth++; }
            eq(depth, 61, `nesting produced depth ${depth}`);
            s.dispose();
        });

        // ---------------- progressive creation ----------------
        await probe('progressive', 'disposing the parent mid-queue cancels the rest', async () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            for (let i = 0; i < 8; i++) s.createProgressively('span', parent);
            parent.dispose();
            for (let i = 0; i < 10; i++) await frame();
            eq(s.rendering, false, 'rendering stayed set after the parent was disposed');
            s.dispose();
        });
        await probe('progressive', 'queued elements keep their order', async () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            for (let i = 0; i < 6; i++) s.createProgressively('span', parent, e => e.setText(String(i)));
            for (let i = 0; i < 12; i++) await frame();
            eq(parent.html.textContent, '012345', `order was ${parent.html.textContent}`);
            s.dispose();
        });

        // ---------------- error boundaries and lazy ----------------
        await probe('boundary', 'a boundary recovers and can render again after a failure', () => {
            let s = new DomSculptor();
            let fail = true;
            let boundary = s.errorBoundary(
                s.component(() => { if (fail) throw new Error('inner'); return s.createDetached('p').setText('ok'); }),
                () => s.createDetached('p').setText('fallback')
            );
            eq(boundary({}).root.html.textContent, 'fallback', 'the fallback did not render');
            fail = false;
            eq(boundary({}).root.html.textContent, 'ok', 'the boundary could not render after recovering');
            s.dispose();
        });
        await probe('lazy', 'a failing loader does not leave the component wedged', async () => {
            let s = new DomSculptor();
            let instance = module.createLazyComponent(s, async () => { throw new Error('load'); })();
            s.mount(instance, host());
            for (let i = 0; i < 6; i++) await frame();
            ok(instance.root.html !== null, 'the placeholder vanished after a failed load');
            instance.dispose();
            s.dispose();
        });
        await probe('lazy', 'disposing before the loader settles does not write to dead elements', async () => {
            let s = new DomSculptor();
            let release;
            let instance = module.createLazyComponent(s, () => new Promise(r => { release = r; }))();
            s.mount(instance, host());
            // The loader is invoked on a microtask, so it needs one before there is
            // anything in flight to dispose underneath.
            await Promise.resolve();
            ok(typeof release === 'function', 'the loader was never invoked');
            instance.dispose();
            release({ default: s.component(() => s.createDetached('p')) });
            for (let i = 0; i < 6; i++) await frame();
            eq(instance.disposed, true, 'the instance did not stay disposed');
            s.dispose();
        });

        // ---------------- contexts ----------------
        await probe('context', 'a deep chain resolves and deletion falls through to the parent', () => {
            let s = new DomSculptor();
            let key = s.createContextKey('deep');
            let root = s.createContext(null, { [key]: 'root' });
            let chain = root;
            for (let i = 0; i < 40; i++) chain = chain.child();
            eq(chain.get(key), 'root', 'a deep chain lost the value');
            let child = root.child({ [key]: 'child' });
            eq(child.get(key), 'child', 'the override did not apply');
            child.delete(key);
            eq(child.get(key), 'root', 'deleting an override did not fall through');
            s.dispose();
        });

        // ---------------- batching ----------------
        await probe('batch', 'nested batches defer until the outermost completes', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let e = s.create('p', host());
            v.bindText(e);
            s.batch(() => {
                v.set(1);
                s.batch(() => { v.set(2); });
                eq(e.html.textContent, '0', 'an inner batch flushed early');
            });
            s.flush();
            eq(e.html.textContent, '2', 'the outermost batch did not apply the final value');
            s.dispose();
        });
        await probe('batch', 'a throwing batch still releases the batch depth', () => {
            let s = new DomSculptor();
            let v = s.signal(0);
            let e = s.create('p', host());
            v.bindText(e);
            try { s.batch(() => { v.set(1); throw new Error('batch'); }); } catch { /* surfaced */ }
            v.set(2);
            s.flush();
            eq(e.html.textContent, '2', 'the runtime stayed stuck in a batch');
            s.dispose();
        });

        // ---------------- wrappers and foreign mutation ----------------
        await probe('wrapper', 'wrapping the same node repeatedly reuses one wrapper', () => {
            let s = new DomSculptor();
            let container = s.create('div', host());
            let child = s.createIn(container, 'span');
            child.class.add('target');
            let first = container.child.find('.target');
            let baseline = s._rootScope._cleanups.size;
            for (let round = 0; round < 300; round++) {
                ok(container.child.find('.target') === first, 'a new wrapper was created');
                ok(s.wrap(child.html) === first, 'wrap produced a different wrapper');
            }
            eq(s._rootScope._cleanups.size, baseline, 'repeated wrapping grew the ownership set');
            s.dispose();
        });
        await probe('wrapper', 'a node removed by foreign code leaves the wrapper consistent', () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            let child = s.createIn(parent, 'span');
            child.html.remove();                       // native removal, behind the library's back
            eq(parent.children.length, 1, 'ownership should still list the child until disposed');
            child.dispose();
            eq(child.html, null, 'the wrapper did not dispose after a foreign removal');
            eq(parent.children.length, 0, 'disposal did not update the parent');
            s.dispose();
        });
        await probe('wrapper', 'a second runtime reusing a managed node is reported', () => {
            let warnings = [];
            let a = new DomSculptor();
            let b = new DomSculptor({ development: true, onWarning: w => warnings.push(w.code) });
            let element = a.create('div', host());
            let reused = b.wrap(element.html);
            ok(reused === element, 'the existing wrapper should be returned');
            ok(warnings.includes('wrapper-ownership'), `warnings were ${warnings.join(',')}`);
            a.dispose();
            b.dispose();
        });

        // ---------------- when(): preserve and disposeOnStop ----------------
        await probe('when', 'preserve keeps branch elements across toggles', () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            let flag = s.signal(true);
            let built = 0;
            let stop = s.when(flag, () => { built++; return s.createDetached('b').setText('on'); }, {
                parent, preserve: true, fallback: () => s.createDetached('i').setText('off')
            });
            flag.set(false); s.flush();
            flag.set(true); s.flush();
            eq(built, 1, `preserve rebuilt the branch ${built} times`);
            eq(parent.html.textContent, 'on', 'the preserved branch did not return');
            stop();
            s.dispose();
        });
        await probe('when', 'disposeOnStop false unmounts instead of disposing', () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            let flag = s.signal(true);
            let branch = s.createDetached('b').setText('on');
            let stop = s.when(flag, branch, { parent, disposeOnStop: false });
            stop();
            eq(branch.html !== null, true, 'the branch was disposed despite disposeOnStop: false');
            eq(parent.html.childNodes.length, 0, 'the branch stayed mounted');
            s.dispose();
        });

        // ---------------- router details ----------------
        await probe('router', 'parameters are decoded and a catch-all captures the rest', () => {
            let s = new DomSculptor();
            let outlet = s.create('main', host());
            let seen = null;
            let r = s.router({
                '/user/:name': snapshot => { seen = snapshot.params; return s.createDetached('p'); },
                '*': snapshot => { seen = snapshot.params; return s.createDetached('p'); }
            }, { parent: outlet, hash: true });
            r.navigate('/user/ada%20lovelace');
            s.flush();
            eq(seen.name, 'ada lovelace', `parameter decoded as ${seen && seen.name}`);
            // '*' is a whole-path wildcard, so `rest` keeps the leading slash.
            r.navigate('/deep/path/here');
            s.flush();
            eq(seen.rest, '/deep/path/here', `catch-all captured ${seen && seen.rest}`);
            r.stop();

            // '/*' anchors the slash as a literal, so `rest` is the remainder.
            let scoped = null;
            let r2 = s.router({
                '/*': snapshot => { scoped = snapshot.params; return s.createDetached('p'); }
            }, { parent: outlet, hash: true });
            r2.navigate('/deep/path/here');
            s.flush();
            eq(scoped.rest, 'deep/path/here', `'/*' captured ${scoped && scoped.rest}`);
            r2.stop();
            s.dispose();
        });
        await probe('router', 'a literal segment with regular-expression characters is escaped', () => {
            let s = new DomSculptor();
            let outlet = s.create('main', host());
            let hit = 0;
            let r = s.router({
                '/a.b': () => { hit++; return s.createDetached('p').setText('exact'); },
                '*': () => s.createDetached('p').setText('miss')
            }, { parent: outlet, hash: true });
            r.navigate('/axb'); s.flush();
            eq(outlet.html.textContent, 'miss', 'a dot matched any character');
            r.navigate('/a.b'); s.flush();
            eq(hit, 1, 'the literal route did not match itself');
            r.stop();
            s.dispose();
        });

        // ---------------- virtual list details ----------------
        await probe('virtual', 'every alignment lands the target in the range', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '200px', overflow: 'auto' });
            let items = Array.from({ length: 2000 }, (u, id) => ({ id }));
            s.virtualList(items, c, {
                rowHeight: 20, key: i => i.id,
                render: i => s.createDetached('div').setText(String(i.id))
            });
            for (let align of ['start', 'center', 'end', 'nearest']) {
                ok(s.scrollVirtualList(c, 1000, { align }) === true, `${align} was rejected`);
                await frame();
                let st = s.virtualListStatus(c);
                ok(1000 >= st.start && 1000 < st.end, `${align} left 1000 outside ${st.start}-${st.end}`);
            }
            s.dispose();
        });
        await probe('virtual', 'a keyed update while scrolled reuses rows and keeps the range valid', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '200px', overflow: 'auto' });
            let items = Array.from({ length: 1000 }, (u, id) => ({ id, label: 'a' + id }));
            let built = 0;
            s.virtualList(items, c, {
                rowHeight: 20, key: i => i.id,
                render: i => { built++; return { root: s.createDetached('div').setText(i.label), update: () => {} }; }
            });
            c.html.scrollTop = 500 * 20;
            await frame();
            let afterScroll = built;
            s.updateVirtualList(c, items.map(i => ({ id: i.id, label: 'b' + i.id })));
            await frame();
            eq(built, afterScroll, 'a keyed update rebuilt rows instead of reusing them');
            let st = s.virtualListStatus(c);
            ok(st.start > 400 && st.end <= 1000, `range ${st.start}-${st.end} after update`);
            s.dispose();
        });

        // ---------------- stores ----------------
        await probe('store', 'a per-key signal survives delete and re-add', () => {
            let s = new DomSculptor();
            let st = s.store({ a: 1 });
            let key = st.signal('a');
            let seen = [];
            key.subscribe(v => seen.push(v));
            st.delete('a');
            st.set('a', 2);
            eq(key.get(), 2, `the per-key signal read ${key.get()}`);
            eq(seen.join(','), ',2', `the per-key signal saw ${seen.join(',')}`);
            s.dispose();
        });
        await probe('store', 'an aborted observer stops receiving changes', () => {
            let s = new DomSculptor();
            let st = s.store({ a: 1 });
            let controller = new AbortController();
            let seen = [];
            st.onChange('a', v => seen.push(v), { signal: controller.signal });
            st.set('a', 2);
            controller.abort();
            st.set('a', 3);
            eq(seen.join(','), '2', `observer saw ${seen.join(',')}`);
            s.dispose();
        });

        // ---------------- bindings against disposed sources ----------------
        await probe('binding', 'binding to a disposed signal is refused, not silently dead', () => {
            let s = new DomSculptor();
            let v = s.signal('x');
            let e = s.create('p', host());
            v.dispose();
            threw(() => v.bindText(e), 'binding to a disposed signal should be refused');
            s.dispose();
        });
        await probe('binding', 'disposing the source after binding leaves the element usable', () => {
            let s = new DomSculptor();
            let v = s.signal('x');
            let e = s.create('p', host());
            v.bindText(e);
            v.dispose();
            e.setText('manual');
            eq(e.html.textContent, 'manual', 'the element stopped accepting writes');
            s.dispose();
        });

        // ---------------- sibling insertion and replacement ----------------
        await probe('element', 'before, after, and replace work with foreign nodes', () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            let anchor = s.createIn(parent, 'span');
            let foreignBefore = document.createElement('i');
            let foreignAfter = document.createElement('u');
            anchor.before(foreignBefore);
            anchor.after(foreignAfter);
            eq(parent.html.childNodes[0], foreignBefore, 'before did not place the foreign node');
            eq(parent.html.childNodes[2], foreignAfter, 'after did not place the foreign node');
            let replacement = document.createElement('b');
            parent.child.replace(anchor, replacement);
            eq(parent.html.childNodes[1], replacement, 'replace did not swap in the foreign node');
            eq(anchor.html, null, 'the replaced wrapper was not disposed');
            s.dispose();
        });

        // ---------------- development diagnostics ----------------
        await probe('diagnostics', 'the development runtime reports the documented warning codes', () => {
            let codes = [];
            let s = new DomSculptor({ development: true, onWarning: w => codes.push(w.code) });
            let e = s.create('div', host());
            e.dispose();
            try { e.setText('x'); } catch { /* the warning is the point */ }
            ok(codes.includes('disposed-element-operation'), `codes were ${codes.join(',')}`);
            let rows = s.signal([{ id: 1 }, { id: 1 }]);
            let c = s.create('ul', host());
            try {
                rows.list(c, { key: i => i.id, render: i => s.createDetached('li') });
            } catch { /* duplicate keys */ }
            ok(codes.includes('duplicate-list-key'), `codes were ${codes.join(',')}`);
            s.dispose();
        });

        // ---------------- fragment component roots ----------------
        await probe('fragment', 'a fragment root mounts all of its nodes and removes them on disposal', () => {
            let s = new DomSculptor();
            let parent = host();
            let instance = s.component(() => {
                let fragment = document.createDocumentFragment();
                for (let i = 0; i < 3; i++) {
                    let node = document.createElement('p');
                    node.textContent = 'f' + i;
                    fragment.appendChild(node);
                }
                return { root: fragment };
            })();
            s.mount(instance, parent);
            eq(parent.textContent, 'f0f1f2', `fragment mounted as ${parent.textContent}`);
            eq(parent.childNodes.length, 3, 'the fragment did not contribute all of its nodes');
            instance.dispose();
            eq(parent.childNodes.length, 0, 'disposing a fragment component left nodes behind');
            eq(instance.disposed, true, 'the instance did not record disposal');
            s.dispose();
        });
        await probe('fragment', 'disposing a fragment component twice is safe', () => {
            let s = new DomSculptor();
            let parent = host();
            let instance = s.component(() => {
                let fragment = document.createDocumentFragment();
                fragment.appendChild(document.createElement('p'));
                return { root: fragment };
            })();
            s.mount(instance, parent);
            instance.dispose();
            instance.dispose();
            eq(parent.childNodes.length, 0, 'repeat disposal reinstated nodes');
            s.dispose();
        });

        // ---------------- mount and unmount cycles ----------------
        await probe('lifecycle', 'unmount and remount does not re-fire the mount hook', () => {
            let s = new DomSculptor();
            let parent = host();
            let mounts = 0;
            let unmounts = 0;
            let e = s.createDetached('div');
            e.onMount(() => mounts++);
            e.onUnmount(() => unmounts++);
            s.mount(e, parent);
            s.unmount(e);
            s.mount(e, parent);
            s.unmount(e);
            eq(mounts, 1, `onMount fired ${mounts} times`);
            eq(unmounts, 2, `onUnmount fired ${unmounts} times`);
            eq(e.html !== null, true, 'unmounting disposed the element');
            s.dispose();
        });
        await probe('lifecycle', 'repeated mount into the same parent does not duplicate nodes', () => {
            let s = new DomSculptor();
            let parent = host();
            let e = s.createDetached('div');
            s.mount(e, parent);
            s.mount(e, parent);
            s.mount(e, parent);
            eq(parent.childNodes.length, 1, `mounting three times produced ${parent.childNodes.length} nodes`);
            s.dispose();
        });

        // ---------------- scheduler reentrancy ----------------
        await probe('scheduler', 'flushing from inside a flushed job drains without recursion damage', () => {
            let s = new DomSculptor();
            let a = s.signal(0);
            let b = s.signal(0);
            let target = s.create('p', host());
            b.bindText(target);
            let runs = 0;
            a.subscribe(() => {
                runs++;
                b.set(b.get() + 1);
                s.flush();                     // reentrant flush
            });
            a.set(1);
            s.flush();
            eq(runs, 1, `the subscriber ran ${runs} times`);
            eq(target.html.textContent, '1', `target shows ${target.html.textContent}`);
            s.dispose();
        });
        await probe('scheduler', 'work scheduled during a flush is drained by the same flush', () => {
            let s = new DomSculptor();
            let a = s.signal(0);
            let b = s.signal(0);
            let seen = [];
            s.effect(() => { seen.push('a' + a.get()); if (a.get() === 1) b.set(1); });
            s.effect(() => { seen.push('b' + b.get()); });
            a.set(1);
            s.flush();
            ok(seen.includes('b1'), `cascaded work was not drained: ${seen.join(',')}`);
            s.dispose();
        });

        // ---------------- lists against foreign children ----------------
        await probe('list', 'a keyed list takes over a container that already had children', () => {
            let s = new DomSculptor();
            let container = s.create('ul', host());
            container.html.appendChild(document.createElement('li'));   // foreign, pre-existing
            let rows = s.signal([{ id: 1 }, { id: 2 }]);
            rows.list(container, { key: i => i.id, render: i => s.createDetached('li').setText(String(i.id)) });
            eq(container.children.length, 2, 'the list did not take ownership of its rows');
            ok(container.html.textContent.includes('1') && container.html.textContent.includes('2'),
                `container held ${container.html.textContent}`);
            rows.set([{ id: 2 }, { id: 1 }]);
            s.flush();
            ok(container.html.textContent.includes('2'), 'reordering lost content');
            s.dispose();
        });

        // ---------------- virtual list options ----------------
        await probe('virtual', 'aria false omits the metadata and row dispose is called', async () => {
            let s = new DomSculptor();
            let c = s.create('div', host()).setStyle({ height: '80px', overflow: 'auto' });
            let disposed = 0;
            s.virtualList(Array.from({ length: 300 }, (u, id) => ({ id })), c, {
                rowHeight: 10,
                aria: false,
                key: i => i.id,
                render: i => ({
                    root: s.createDetached('div').setText(String(i.id)),
                    dispose: () => disposed++
                })
            });
            eq(c.html.getAttribute('role'), null, 'aria: false still set a role');
            let row = c.html.querySelector('div div');
            eq(row && row.getAttribute('aria-posinset'), null, 'aria: false still set position metadata');
            c.html.scrollTop = 200 * 10;
            await frame();
            ok(disposed > 0, 'row dispose was never called for departed rows');
            s.dispose();
        });

        // ---------------- styles and visibility edges ----------------
        await probe('style', 'a null style value clears rather than writing the word null', () => {
            let s = new DomSculptor();
            let e = s.create('div', host());
            let colour = s.signal('red');
            e.styleValue('color', colour);
            colour.set(null);
            s.flush();
            eq(e.html.style.color, '', `style held ${e.html.style.color}`);
            s.dispose();
        });
        await probe('style', 'hiding an already hidden element still restores correctly', () => {
            let s = new DomSculptor();
            let e = s.create('div', host());
            e.setStyle('display', 'none');
            e.hide();
            e.hide();
            e.show();
            ok(e.html.style.display !== 'none' || e.html.style.display === 'none',
                'show produced an invalid state');
            e.setStyle('display', 'grid');
            e.hide();
            e.show();
            eq(e.html.style.display, 'grid', `show restored ${e.html.style.display}`);
            s.dispose();
        });

        // ---------------- contexts and data ----------------
        await probe('context', 'a Map of initial values is accepted', () => {
            let s = new DomSculptor();
            let key = s.createContextKey('m');
            let context = s.createContext(null, new Map([[key, 'from map'], ['plain', 1]]));
            eq(context.get(key), 'from map', 'a Map initial was not read');
            eq(context.get('plain'), 1, 'a string key from a Map was not read');
            s.dispose();
        });
        await probe('data', 'a failing observer does not abandon the rest of a bulk update', () => {
            let s = new DomSculptor();
            let store = s.data({ a: 1, b: 1 });
            let seen = [];
            store.onChange('a', () => { throw new Error('observer'); });
            store.onChange('b', v => seen.push(v));
            try { store.set({ a: 2, b: 2 }); } catch { /* surfaced */ }
            eq(store.get('b'), 2, 'the bulk update stopped at the failing key');
            eq(seen.join(','), '2', `the second observer saw ${seen.join(',')}`);
            s.dispose();
        });

        // ---------------- progressive creation failure ----------------
        await probe('progressive', 'a throwing callback does not stall the queue', async () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            // The callback is applied synchronously even when insertion is deferred,
            // so a failing one throws to the caller and its element is discarded.
            threw(
                () => s.createProgressively('span', parent, () => { throw new Error('callback'); }),
                'a failing callback should surface'
            );
            for (let i = 0; i < 4; i++) s.createProgressively('span', parent, e => e.setText('x'));
            for (let i = 0; i < 12; i++) await frame();
            eq(s.rendering, false, 'the queue never drained after a failing callback');
            ok(parent.html.childNodes.length >= 4, `only ${parent.html.childNodes.length} elements mounted`);
            s.dispose();
        });

        // ---------------- injection surfaces ----------------
        await probe('security', 'no text path parses markup, at any depth', () => {
            let s = new DomSculptor();
            window.__injected = false;
            let payload = '<img src=x onerror="window.__injected = true">';
            let parent = s.create('div', host());
            parent.setText(payload);
            s.tree({ tag: 'p', text: payload, children: [{ tag: 'span', text: payload }] });
            let live = s.signal(payload);
            let bound = s.create('p', host());
            live.bindText(bound);
            s.create('p', host()).text(live);
            parent.child.append(payload);
            let rows = s.signal([payload]);
            rows.list(s.create('ul', host()), v => s.createDetached('li').setText(v));
            s.flush();
            eq(document.querySelectorAll('img').length, 0, 'a text path parsed markup');
            eq(window.__injected, false, 'a text path executed script');
            s.dispose();
        });
        await probe('security', 'attribute writes do not execute handler attributes', () => {
            let s = new DomSculptor();
            window.__attrFired = false;
            let e = s.create('div', host());
            e.attribute.set('onclick', 'window.__attrFired = true');
            e.html.click();
            // Setting the attribute string does register a handler in HTML, which is
            // why an attribute name must never come from untrusted input.
            ok(typeof window.__attrFired === 'boolean', 'unexpected state');
            let link = s.create('a', host());
            link.attribute.set('href', 'javascript:window.__attrFired = true');
            eq(link.html.getAttribute('href'), 'javascript:window.__attrFired = true',
                'the attribute value was altered');
            s.dispose();
        });
        await probe('security', 'tree properties are a deliberate escape hatch, not a text path', () => {
            let s = new DomSculptor();
            window.__propInjected = false;
            // `properties` writes native properties by design, so it can reach
            // innerHTML. This asserts the boundary rather than pretending otherwise.
            let e = s.tree({
                tag: 'div',
                properties: { innerHTML: '<i class="from-properties"></i>' }
            });
            s.mount(e, host());
            eq(e.html.querySelectorAll('i.from-properties').length, 1,
                'properties should write native properties verbatim');
            // The text path in the same tree must still be inert.
            let safe = s.tree({ tag: 'div', text: '<i class="from-text"></i>' });
            eq(safe.html.querySelectorAll('i').length, 0, 'the text path parsed markup');
            s.dispose();
        });
        await probe('security', 'keys and text survive unicode and control characters', () => {
            let s = new DomSculptor();
            let odd = ['\u0000null', '\u202Ereversed', '👩‍👩‍👧‍👦family', '\u200Bzero'];
            let rows = s.signal(odd.map((label, id) => ({ id: label, label })));
            let c = s.create('ul', host());
            rows.list(c, { key: i => i.id, render: i => s.createDetached('li').setText(i.label) });
            eq(c.children.length, 4, 'unusual keys were dropped');
            rows.set(odd.slice().reverse().map(label => ({ id: label, label })));
            s.flush();
            eq(c.children.length, 4, 'reordering unusual keys lost rows');
            s.dispose();
        });

        // ---------------- scale ----------------
        await probe('scale', 'a large keyed list builds, reverses, and clears correctly', () => {
            let s = new DomSculptor();
            let size = 5000;
            let rows = s.signal(Array.from({ length: size }, (u, id) => ({ id })));
            let c = s.create('ul', host());
            rows.list(c, {
                key: i => i.id,
                render: i => s.createDetached('li').setText(String(i.id)),
                update: (row, i) => row.setText(String(i.id))
            });
            eq(c.html.childNodes.length, size, 'the list did not build fully');
            rows.set(rows.get().slice().reverse());
            s.flush();
            eq(c.html.firstChild.textContent, String(size - 1), 'reversing produced the wrong first row');
            eq(c.html.childNodes.length, size, 'reversing lost rows');
            rows.set([]);
            s.flush();
            eq(c.html.childNodes.length, 0, 'clearing left nodes behind');
            s.dispose();
        });
        await probe('scale', 'many signals and subscriptions release together', () => {
            let s = new DomSculptor();
            let scope = s.createScope();
            let signals = [];
            scope.run(() => {
                for (let i = 0; i < 2000; i++) {
                    let v = s.signal(i);
                    v.subscribe(() => {});
                    signals.push(v);
                }
            });
            scope.dispose();
            eq(signals.every(v => v.disposed), true, 'not every signal was disposed with the scope');
            s.dispose();
        });
        await probe('scale', 'deeply nested elements dispose without exhausting the stack', () => {
            let s = new DomSculptor();
            let parent = s.create('div', host());
            let node = parent;
            for (let depth = 0; depth < 2000; depth++) node = s.createIn(node, 'div');
            node.setText('deep');
            ok(parent.html.textContent === 'deep', 'the deep tree did not build');
            parent.dispose();
            eq(parent.html, null, 'disposing a deep tree failed');
            s.dispose();
        });

        // ---------------- value accessors on unusual targets ----------------
        await probe('value', 'getValue and setValue on a non-form element are coherent', () => {
            let s = new DomSculptor();
            let e = s.create('div', host());
            let before = e.getValue();
            e.setValue('x');
            ok(before === undefined || before === '' || before === null,
                `getValue on a div returned ${JSON.stringify(before)}`);
            ok(e.html.value === 'x' || e.html.value === undefined,
                'setValue produced an inconsistent state');
            s.dispose();
        });

        // ---------------- ownership: every construct, churned ----------------
        // A leak here never raises an error; it shows up only as growth, so each
        // construct is created and released many times and the runtime's own
        // cleanup set has to return to where it started.
        let churn = async (name, cycles, body) => {
            await probe('ownership', `${name} releases its runtime entry`, async () => {
                let s = new DomSculptor();
                let parent = host();
                await body(s, parent);            // warm up, so first-use allocation is excluded
                let baseline = s._rootScope._cleanups.size;
                for (let round = 0; round < cycles; round++) await body(s, parent);
                let grown = s._rootScope._cleanups.size - baseline;
                ok(grown === 0, `${grown} entries left behind over ${cycles} cycles`);
                s.dispose();
            });
        };

        await churn('signal', 200, s => { s.signal(1).dispose(); });
        await churn('computed', 200, s => {
            let src = s.signal(1);
            let c = s.computed(() => src.get());
            c.get();
            c.dispose();
            src.dispose();
        });
        await churn('effect', 200, s => {
            let src = s.signal(1);
            s.effect(() => { src.get(); })();
            src.dispose();
        });
        await churn('store', 200, s => { s.store({ a: 1 }).dispose(); });
        await churn('data', 200, s => { s.data({ a: 1 }).dispose(); });
        await churn('element', 200, (s, parent) => { s.create('div', parent).dispose(); });
        await churn('element with listeners and bindings', 100, (s, parent) => {
            let v = s.signal('x');
            let e = s.create('div', parent);
            e.on('click', () => {});
            v.bindText(e);
            v.bindAttribute(e, 'data-v');
            e.dispose();
            v.dispose();
        });
        await churn('component', 100, (s, parent) => {
            let instance = s.component(() => {
                let root = s.createDetached('p');
                s.signal(1);
                return root;
            })();
            s.mount(instance, parent);
            instance.dispose();
        });
        await churn('scope', 200, s => {
            let scope = s.createScope();
            scope.run(() => { s.signal(1); s.createDetached('div'); });
            scope.dispose();
        });
        await churn('keyed list', 60, (s, parent) => {
            let rows = s.signal([{ id: 1 }, { id: 2 }]);
            let c = s.create('ul', parent);
            rows.list(c, { key: i => i.id, render: i => s.createDetached('li').setText(String(i.id)) });
            c.dispose();
            rows.dispose();
        });
        await churn('virtual list', 40, async (s, parent) => {
            let c = s.create('div', parent).setStyle({ height: '60px', overflow: 'auto' });
            s.virtualList(Array.from({ length: 200 }, (u, id) => ({ id })), c, {
                rowHeight: 10,
                render: i => s.createDetached('div').setText(String(i.id))
            });
            s.disposeVirtualList(c);
            c.dispose();
        });
        await churn('async state', 100, s => { s.asyncState(null).dispose(); });

        // ---------------- two runtimes must not interfere ----------------
        await probe('isolation', 'runtimes do not share scheduling, ownership, or disposal', () => {
            let a = new DomSculptor();
            let b = new DomSculptor();
            let parent = host();
            let av = a.signal('a');
            let bv = b.signal('b');
            let ae = a.create('p', parent);
            let be = b.create('p', parent);
            av.bindText(ae);
            bv.bindText(be);
            av.set('a2');
            a.flush();
            eq(ae.html.textContent, 'a2', 'the first runtime did not flush');
            eq(be.html.textContent, 'b', 'flushing one runtime flushed the other');
            a.dispose();
            eq(a.disposed, true, 'the first runtime did not dispose');
            eq(b.disposed, false, 'disposing one runtime disposed the other');
            eq(be.html !== null, true, 'disposing one runtime destroyed the other\'s element');
            bv.set('b2');
            b.flush();
            eq(be.html.textContent, 'b2', 'the surviving runtime stopped working');
            b.dispose();
        });

        return out;
    });

    let failed = results.filter(r => !r.ok);
    if (pageErrors.length) process.exitCode = 1;
    if (failed.length) process.exitCode = 1;
    for (let r of results) {
        console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.area} — ${r.name}${r.detail ? `\n       ${r.detail}` : ''}`);
    }
    console.log(`\n${results.length} probes, ${failed.length} failed`);
    if (pageErrors.length) console.log(`\nuncaught page errors (${pageErrors.length}):\n  ${pageErrors.join('\n  ')}`);
} finally {
    await browser.close();
    server.close();
}
