import DomSculptor, { DomElement } from '../src/index.js';

let createLazyComponent = (sculptor, loader, options = {}) => {
    if (!(sculptor instanceof DomSculptor)) {
        throw new TypeError('DOMSculptor lazy: expected a DomSculptor instance.');
    }
    if (typeof loader !== 'function') {
        throw new TypeError('DOMSculptor lazy: expected a loader function.');
    }
    return sculptor.component((props, context) => {
        let root = sculptor.create(options.tag || 'div');
        let status = sculptor.signal({ status: 'loading', error: null });
        let controller = new AbortController();
        let child = null;
        let active = true;

        let show = value => {
            root.child.clear();
            if (value == null || value === false) return;
            let rendered = typeof value === 'function' ? value(props, context) : value;
            if (rendered instanceof DomElement || rendered?.root instanceof DomElement) {
                sculptor.mount(rendered, root);
            } else if (
                typeof rendered === 'string' ||
                rendered && typeof rendered === 'object' && typeof rendered.nodeType === 'number'
            ) {
                root.child.append(rendered);
            } else {
                root.child.append(sculptor.tree(rendered));
            }
        };

        root.attribute.set('aria-busy', 'true');
        show(options.loading);
        Promise.resolve()
            .then(() => loader({ signal: controller.signal, props, context }))
            .then(module => {
                if (!active) return;
                let loaded = module?.default ?? module;
                let result = typeof loaded === 'function' ? loaded(props, context) : loaded;
                child = result?.root instanceof DomElement && typeof result.dispose === 'function'
                    ? result
                    : sculptor.component(() => result)(props, context);
                root.child.clear();
                sculptor.mount(child, root);
                root.attribute.remove('aria-busy');
                status.set({ status: 'success', error: null });
            })
            .catch(error => {
                if (!active || controller.signal.aborted) return;
                root.attribute.remove('aria-busy');
                status.set({ status: 'error', error });
                show(options.error ? () => options.error(error, props, context) : 'Unable to load this feature.');
                options.onError?.(error);
            });

        return {
            root,
            api: { status },
            dispose() {
                active = false;
                controller.abort();
                child?.dispose();
            }
        };
    }, { name: options.name || 'LazyComponent' });
};

export { createLazyComponent };
