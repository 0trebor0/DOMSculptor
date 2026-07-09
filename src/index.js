class DomElement {
    constructor(tagNameOrNode, sculptor) {
        this.html = tagNameOrNode instanceof Node ? tagNameOrNode : document.createElement(tagNameOrNode);
        this.children = [];
        this._listeners = {};

        const el = this;

        this.attribute = {
            set(name, value = '') {
                if (typeof name === 'object' && name !== null) {
                    for (const key in name) {
                        if (Object.hasOwnProperty.call(name, key)) el.html.setAttribute(key, name[key]);
                    }
                } else if (typeof name === 'string') {
                    el.html.setAttribute(name, value);
                } else {
                    console.warn('DomSculptor: attribute.set received invalid name type.', name);
                }
                return el;
            },
            remove(name) { el.html.removeAttribute(name); return el; },
            get(name) { return el.html.getAttribute(name); },
            has(name) { return el.html.hasAttribute(name); }
        };

        this.class = {
            add(...values) { if (values.length) el.html.classList.add(...values); return el; },
            remove(...values) { if (values.length) el.html.classList.remove(...values); return el; },
            toggle(value) { el.html.classList.toggle(value); return el; },
            contains(value) { return el.html.classList.contains(value); }
        };

        this.child = {
            append(child) {
                if (child instanceof DomElement) {
                    el.html.appendChild(child.html);
                    el.children.push(child);
                } else if (child instanceof Node) {
                    el.html.appendChild(child);
                } else if (typeof child === 'string') {
                    el.html.appendChild(document.createTextNode(child));
                } else {
                    console.warn('DomSculptor: child.append received invalid child type.', child);
                }
                return el;
            },
            prepend(child) {
                if (child instanceof DomElement) {
                    el.html.prepend(child.html);
                    el.children.unshift(child);
                } else if (child instanceof Node) {
                    el.html.prepend(child);
                } else if (typeof child === 'string') {
                    el.html.prepend(document.createTextNode(child));
                } else {
                    console.warn('DomSculptor: child.prepend received invalid child type.', child);
                }
                return el;
            },
            find(selector) {
                const node = el.html.querySelector(selector);
                return node ? new DomElement(node, sculptor) : null;
            },
            create(name, opts = null) { return sculptor.create(name, el, opts); },
            remove() { el.remove(); }
        };
    }

    setText(text) { this.html.textContent = text; return this; }
    getValue() { return this.html.value; }
    setValue(value) { this.html.value = value; return this; }

    setStyle(property, value) {
        if (typeof property === 'object' && property !== null) {
            for (const key in property) {
                if (Object.hasOwnProperty.call(property, key)) this.html.style[key] = property[key];
            }
        } else if (typeof property === 'string' && value !== undefined) {
            this.html.style[property] = value;
        } else {
            console.warn('DomSculptor: setStyle received invalid arguments.', property, value);
        }
        return this;
    }

    hide() { this.html.style.display = 'none'; return this; }
    show() { this.html.style.display = ''; return this; }

    on(event, callback) {
        if (typeof event === 'object' && event !== null) {
            for (const key in event) {
                if (Object.hasOwnProperty.call(event, key) && typeof event[key] === 'function') {
                    this.on(key, event[key]);
                }
            }
        } else if (typeof event === 'string' && typeof callback === 'function') {
            this.html.addEventListener(event, callback);
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(callback);
        } else {
            console.warn(`DomSculptor: Invalid arguments for .on('${event}', ${callback})`);
        }
        return this;
    }

    once(event, callback) {
        if (typeof event === 'string' && typeof callback === 'function') {
            this.html.addEventListener(event, callback, { once: true });
        } else {
            console.warn(`DomSculptor: Invalid arguments for .once()`);
        }
        return this;
    }

    off(event, callback = null) {
        if (!this._listeners[event]) {
            if (callback) this.html.removeEventListener(event, callback);
            return this;
        }
        if (callback) {
            this.html.removeEventListener(event, callback);
            this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
            if (!this._listeners[event].length) delete this._listeners[event];
        } else {
            this._listeners[event].forEach(cb => this.html.removeEventListener(event, cb));
            delete this._listeners[event];
        }
        return this;
    }

    remove() {
        for (const eventType in this._listeners) {
            if (Object.hasOwnProperty.call(this._listeners, eventType)) {
                this._listeners[eventType].forEach(cb => this.html.removeEventListener(eventType, cb));
            }
        }
        this._listeners = {};
        this.children.forEach(child => { if (child?.remove) child.remove(); });
        this.children = [];
        if (this.html?.parentNode) this.html.parentNode.removeChild(this.html);
        this.html = null;
    }
}

class DomSculptor {
    create(tagName, parent = null, callback = null) {
        const ele = new DomElement(tagName, this);

        let parentNode = null;
        if (parent == null) {
            parentNode = document.body;
        } else if (parent instanceof DomElement) {
            parentNode = parent.html;
            parent.children.push(ele);
        } else if (parent instanceof Node) {
            parentNode = parent;
        } else if (typeof parent === 'string') {
            parentNode = document.querySelector(parent);
            if (!parentNode) console.warn(`DomSculptor.create: Could not find parent "${parent}". Element not appended.`);
        } else {
            console.warn('DomSculptor.create: Invalid parent type. Element not appended.', parent);
        }

        if (parentNode) parentNode.appendChild(ele.html);
        if (typeof callback === 'function') callback(ele);

        return ele;
    }

    wrap(selectorOrNode) {
        let node;
        if (typeof selectorOrNode === 'string') {
            node = document.querySelector(selectorOrNode);
            if (!node) { console.warn(`DomSculptor.wrap: Could not find "${selectorOrNode}".`); return null; }
        } else if (selectorOrNode instanceof Node) {
            node = selectorOrNode;
        } else {
            console.warn('DomSculptor.wrap: Invalid argument.', selectorOrNode);
            return null;
        }
        return new DomElement(node, this);
    }

    state(initial) {
        let value = initial;
        const subscribers = [];

        const autoUnsub = (element, unsub) => {
            const orig = element.remove.bind(element);
            element.remove = () => { unsub(); element.remove = orig; orig(); };
        };

        const store = {
            get() { return value; },
            set(next) {
                if (value === next) return;
                value = next;
                subscribers.forEach(fn => fn(value));
            },
            update(fn) { store.set(fn(value)); },
            subscribe(fn) {
                subscribers.push(fn);
                return () => {
                    const i = subscribers.indexOf(fn);
                    if (i > -1) subscribers.splice(i, 1);
                };
            },
            bind(element, updater) {
                updater(value, element);
                const unsub = store.subscribe(v => updater(v, element));
                autoUnsub(element, unsub);
                return element;
            },
            list(container, renderFn) {
                let elements = [];
                const render = (items) => {
                    elements.forEach(el => el.remove());
                    container.children = container.children.filter(c => c.html !== null);
                    elements = items.map((item, i) => {
                        const el = renderFn(item, i);
                        container.child.append(el);
                        return el;
                    });
                };
                render(value);
                const unsub = store.subscribe(render);
                autoUnsub(container, unsub);
                return container;
            },
            sync(element, transform = v => v) {
                element.setValue(value);
                element.on('input', e => store.set(transform(e.target.value)));
                const unsub = store.subscribe(v => element.setValue(v));
                autoUnsub(element, unsub);
                return element;
            }
        };
        return store;
    }

    data(initial = {}) {
        const values = (typeof initial === 'object' && initial !== null) ? { ...initial } : {};
        const listeners = new Map();
        const anyListeners = [];

        const notify = (key, next, previous) => {
            const keyListeners = listeners.get(key) || [];
            keyListeners.slice().forEach(fn => fn(next, previous, key));
            anyListeners.slice().forEach(fn => fn(key, next, previous));
        };

        const api = {
            get(key = null) {
                if (key == null) return { ...values };
                return values[key];
            },
            set(key, value) {
                if (typeof key === 'object' && key !== null) {
                    for (const name in key) {
                        if (Object.hasOwnProperty.call(key, name)) api.set(name, key[name]);
                    }
                    return api;
                }

                if (typeof key !== 'string') {
                    console.warn('DomSculptor.data.set: key must be a string.', key);
                    return api;
                }

                const previous = values[key];
                if (Object.is(previous, value)) return api;

                values[key] = value;
                notify(key, value, previous);
                return api;
            },
            update(key, fn) {
                if (typeof fn !== 'function') {
                    console.warn('DomSculptor.data.update: updater must be a function.');
                    return api;
                }
                return api.set(key, fn(values[key], key));
            },
            onChange(key, callback, options = {}) {
                if (typeof key !== 'string' || typeof callback !== 'function') {
                    console.warn('DomSculptor.data.onChange: expected a string key and callback function.');
                    return () => {};
                }

                if (!listeners.has(key)) listeners.set(key, []);
                listeners.get(key).push(callback);

                if (options.immediate) callback(values[key], undefined, key);

                return () => api.offChange(key, callback);
            },
            offChange(key, callback = null) {
                if (!listeners.has(key)) return api;

                if (callback) {
                    const nextListeners = listeners.get(key).filter(fn => fn !== callback);
                    if (nextListeners.length) listeners.set(key, nextListeners);
                    else listeners.delete(key);
                } else {
                    listeners.delete(key);
                }

                return api;
            },
            onAnyChange(callback, options = {}) {
                if (typeof callback !== 'function') {
                    console.warn('DomSculptor.data.onAnyChange: callback must be a function.');
                    return () => {};
                }

                anyListeners.push(callback);

                if (options.immediate) {
                    Object.keys(values).forEach(key => callback(key, values[key], undefined));
                }

                return () => {
                    const i = anyListeners.indexOf(callback);
                    if (i > -1) anyListeners.splice(i, 1);
                };
            }
        };

        return api;
    }

    jsontohtml(config) {
        if (typeof config !== 'object' || config === null) throw new Error('DomSculptor.jsontohtml: config must be a valid object.');
        if (!config.type) throw new Error('DomSculptor.jsontohtml: Must specify "type".');
        if (!config.parent) throw new Error('DomSculptor.jsontohtml: Must specify "parent".');

        const element = this.create(config.type, config.parent);

        if (config.attributes && typeof config.attributes === 'object') element.attribute.set(config.attributes);
        if (Array.isArray(config.class)) element.class.add(...config.class);
        if (typeof config.text === 'string') element.setText(config.text);
        if (typeof config.oncreate === 'function') config.oncreate(element);

        if (Array.isArray(config.children)) {
            config.children.forEach(child => {
                if (typeof child === 'object' && child !== null) {
                    this.jsontohtml({ ...child, parent: element });
                } else if (typeof child === 'string') {
                    element.child.append(child);
                } else {
                    console.warn('DomSculptor.jsontohtml: Invalid child configuration.', child);
                }
            });
        }

        return element;
    }
}

export default DomSculptor;
