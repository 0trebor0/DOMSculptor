import { createDevSculptor, DomElement } from '../src/index.js';

let createTestHarness = (parent = document.body, options = {}) => {
    let warnings = [];
    let onWarning = options.onWarning;
    let sculptor = createDevSculptor({
        ...options,
        onWarning(warning) {
            warnings.push(warning);
            onWarning?.(warning);
        }
    });
    let root = sculptor.create('div');
    if (parent != null) sculptor.mount(root, parent);
    let components = new Set();
    let disposed = false;
    let harness = {
        sculptor,
        root,
        warnings,
        mount(value) {
            if (disposed) throw new Error('DOMSculptor testing: harness has been disposed.');
            let mounted = sculptor.mount(value, root);
            if (value?.root instanceof DomElement && typeof value.dispose === 'function') {
                components.add(value);
            }
            return mounted;
        },
        flush() {
            sculptor.flush();
            return harness;
        },
        assertClean() {
            let leaks = sculptor.reportLeaks();
            if (leaks) throw new Error(`DOMSculptor testing: ${leaks} component scope(s) remain active.`);
            return harness;
        },
        dispose() {
            if (disposed) return;
            disposed = true;
            let errors = [];
            components.forEach(component => {
                try { component.dispose(); } catch (error) { errors.push(error); }
            });
            components.clear();
            try { root.dispose(); } catch (error) { errors.push(error); }
            if (errors.length === 1) throw errors[0];
            if (errors.length) throw new AggregateError(errors, 'DOMSculptor testing: multiple fixture cleanups failed.');
        },
        get disposed() {
            return disposed;
        }
    };
    return harness;
};

export { createTestHarness };
