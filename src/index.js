let elementWrappers = new WeakMap();
let isNode = value => {
    if (typeof Node !== 'undefined' && value instanceof Node) return true;
    return value !== null && typeof value === 'object' &&
        typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
};

class DomElement {
    constructor(tagNameOrNode, sculptor) {
        this.html = isNode(tagNameOrNode) ? tagNameOrNode : document.createElement(tagNameOrNode);
        this._sculptor = sculptor;
        this.children = [];
        this._parent = null;
        this._listeners = {};
        this._mountCallbacks = [];
        this._removeCallbacks = [];
        this._removing = false;
        this._displayBeforeHide = null;
        sculptor?._elements?.set(this.html, this);

        let el = this;

        this.attribute = {
            set(name, value = '') {
                if (typeof name === 'object' && name !== null) {
                    for (let key in name) {
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
                let childElement = el._elementFor(child);
                if (childElement) {
                    el.html.appendChild(childElement.html);
                    childElement._detachFromParent();
                    el.children.push(childElement);
                    childElement._parent = el;
                    childElement._notifyMount();
                } else if (isNode(child)) {
                    el.html.appendChild(child);
                } else if (typeof child === 'string') {
                    el.html.appendChild(document.createTextNode(child));
                } else {
                    console.warn('DomSculptor: child.append received invalid child type.', child);
                }
                return el;
            },
            prepend(child) {
                let childElement = el._elementFor(child);
                if (childElement) {
                    el.html.prepend(childElement.html);
                    childElement._detachFromParent();
                    el.children.unshift(childElement);
                    childElement._parent = el;
                    childElement._notifyMount();
                } else if (isNode(child)) {
                    el.html.prepend(child);
                } else if (typeof child === 'string') {
                    el.html.prepend(document.createTextNode(child));
                } else {
                    console.warn('DomSculptor: child.prepend received invalid child type.', child);
                }
                return el;
            },
            find(selector) {
                let node = el.html.querySelector(selector);
                return node ? sculptor._wrapNode(node) : null;
            },
            findAll(selector) {
                return Array.from(el.html.querySelectorAll(selector), node => sculptor._wrapNode(node));
            },
            create(name, opts = null) { return sculptor.create(name, el, opts); },
            remove() { el.remove(); },
            clear() { el._clearChildren(); return el; },
            replace(previous, next) { return el._replaceChild(previous, next); }
        };
    }

    setText(text) {
        let cleanupError = null;
        try { this._clearChildren(); } catch (error) { cleanupError = error; }
        this.html.textContent = text;
        if (cleanupError) throw cleanupError;
        return this;
    }
    getValue() { return this.html.value; }
    setValue(value) { this.html.value = value; return this; }

    setStyle(property, value) {
        if (typeof property === 'object' && property !== null) {
            for (let key in property) {
                if (Object.hasOwnProperty.call(property, key)) this.html.style[key] = property[key];
            }
        } else if (typeof property === 'string' && value !== undefined) {
            this.html.style[property] = value;
        } else {
            console.warn('DomSculptor: setStyle received invalid arguments.', property, value);
        }
        return this;
    }

    hide() {
        if (this.html.style.display !== 'none') this._displayBeforeHide = this.html.style.display;
        this.html.style.display = 'none';
        return this;
    }
    show() {
        this.html.style.display = this._displayBeforeHide ?? '';
        this._displayBeforeHide = null;
        return this;
    }

    parent() {
        let parentNode = this.html?.parentNode || null;
        if (this._parent?.html === parentNode) return this._parent;
        if (this._parent) this._detachFromParent();
        if (!parentNode) return null;

        let parent = this._sculptor._wrapNode(parentNode);
        parent.children = parent.children.filter(child => child !== this && child.html?.parentNode === parentNode);
        parent.children.push(this);
        let nodeOrder = Array.from(parentNode.childNodes || []);
        parent.children.sort((a, b) => nodeOrder.indexOf(a.html) - nodeOrder.indexOf(b.html));
        this._parent = parent;
        return parent;
    }

    closest(selector) {
        let node = this.html?.closest?.(selector);
        return node ? this._sculptor._wrapNode(node) : null;
    }

    childrenOf() {
        return Array.from(this.html?.children || [], node => this._sculptor._wrapNode(node));
    }

    before(value) { return this._insertSibling(value, false); }
    after(value) { return this._insertSibling(value, true); }

    onMount(callback) {
        if (typeof callback !== 'function') return this;
        if (this._isMounted()) callback(this);
        else this._mountCallbacks.push(callback);
        return this;
    }

    onRemove(callback) {
        if (typeof callback === 'function') this._removeCallbacks.push(callback);
        return this;
    }

    on(event, callback) {
        if (typeof event === 'object' && event !== null) {
            for (let key in event) {
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
            let wrapped = (...args) => {
                this._forgetListener(event, wrapped);
                callback.apply(this.html, args);
            };
            wrapped._domSculptorOriginal = callback;
            this.html.addEventListener(event, wrapped, { once: true });
            if (!this._listeners[event]) this._listeners[event] = [];
            this._listeners[event].push(wrapped);
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
            let matches = this._listeners[event].filter(cb => cb === callback || cb._domSculptorOriginal === callback);
            matches.forEach(cb => this.html.removeEventListener(event, cb));
            this._listeners[event] = this._listeners[event].filter(cb => !matches.includes(cb));
            if (!this._listeners[event].length) delete this._listeners[event];
        } else {
            this._listeners[event].forEach(cb => this.html.removeEventListener(event, cb));
            delete this._listeners[event];
        }
        return this;
    }

    _forgetListener(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
        if (!this._listeners[event].length) delete this._listeners[event];
    }

    _detachFromParent() {
        if (!this._parent) return;
        this._parent.children = this._parent.children.filter(child => child !== this);
        this._parent = null;
    }

    _isMounted() {
        if (!this.html) return false;
        return typeof this.html.isConnected === 'boolean' ? this.html.isConnected : this.html.parentNode !== null;
    }

    _notifyMount() {
        if (!this._isMounted()) return;
        let callbacks = this._mountCallbacks.splice(0);
        let firstError = null;
        callbacks.forEach(callback => {
            try { callback(this); } catch (error) { if (!firstError) firstError = error; }
        });
        this.children.forEach(child => {
            try { child._notifyMount(); } catch (error) { if (!firstError) firstError = error; }
        });
        if (firstError) throw firstError;
    }

    _toNode(value) {
        if (value instanceof DomElement) return value.html;
        if (isNode(value)) return value;
        if (typeof value === 'string') return document.createTextNode(value);
        return null;
    }

    _elementFor(value) {
        if (value instanceof DomElement) return value;
        return isNode(value) ? this._sculptor?._elements?.get(value) || null : null;
    }

    _cleanupKnownNode(node) {
        let element = this._sculptor?._elements?.get(node);
        if (element && element !== this) {
            element.remove();
            return;
        }
        Array.from(node.childNodes || []).forEach(child => this._cleanupKnownNode(child));
    }

    _clearChildren() {
        let firstError = null;
        this.children.slice().forEach(child => {
            if (child._parent !== this && child.html?.parentNode !== this.html) return;
            try { child.remove(); } catch (error) { if (!firstError) firstError = error; }
        });
        while (this.html?.firstChild) {
            let node = this.html.firstChild;
            try { this._cleanupKnownNode(node); } catch (error) { if (!firstError) firstError = error; }
            if (node.parentNode === this.html) this.html.removeChild(node);
        }
        this.children = [];
        if (firstError) throw firstError;
    }

    _replaceChild(previous, next) {
        let previousNode = this._toNode(previous);
        let nextNode = this._toNode(next);
        let previousElement = this._elementFor(previous);
        let nextElement = this._elementFor(next);
        if (!previousNode || !nextNode || previousNode.parentNode !== this.html) {
            console.warn('DomSculptor: child.replace received invalid children.', previous, next);
            return this;
        }
        if (previousNode === nextNode) return this;

        this.html.replaceChild(nextNode, previousNode);
        if (nextElement) nextElement._detachFromParent();

        let firstError = null;
        try { this._cleanupKnownNode(previousNode); } catch (error) { firstError = error; }
        this.children = this.children.filter(child => child !== previousElement && child !== nextElement);
        if (nextElement) {
            let nodeOrder = Array.from(this.html.childNodes);
            this.children.push(nextElement);
            this.children.sort((a, b) => nodeOrder.indexOf(a.html) - nodeOrder.indexOf(b.html));
            nextElement._parent = this;
            try { nextElement._notifyMount(); } catch (error) { if (!firstError) firstError = error; }
        }
        if (firstError) throw firstError;
        return this;
    }

    _insertSibling(value, after) {
        let node = this._toNode(value);
        let parentNode = this.html?.parentNode;
        if (!node || !parentNode || node === this.html) return this;
        let valueElement = this._elementFor(value);

        let reference = after ? this.html.nextSibling : this.html;
        parentNode.insertBefore(node, reference);
        if (valueElement) valueElement._detachFromParent();

        let owner = this.parent();
        if (valueElement && owner) {
            let nodeOrder = Array.from(parentNode.childNodes);
            owner.children = owner.children.filter(child => child !== valueElement);
            owner.children.push(valueElement);
            owner.children.sort((a, b) => nodeOrder.indexOf(a.html) - nodeOrder.indexOf(b.html));
            valueElement._parent = owner;
            valueElement._notifyMount();
        }
        return this;
    }

    remove() {
        if (!this.html || this._removing) return;
        this._removing = true;
        let firstError = null;
        this._detachFromParent();
        let removeCallbacks = this._removeCallbacks.splice(0);
        removeCallbacks.forEach(callback => {
            try { callback(this); } catch (error) { if (!firstError) firstError = error; }
        });
        for (let eventType in this._listeners) {
            if (Object.hasOwnProperty.call(this._listeners, eventType)) {
                this._listeners[eventType].forEach(cb => this.html.removeEventListener(eventType, cb));
            }
        }
        this._listeners = {};
        try { this._clearChildren(); } catch (error) { if (!firstError) firstError = error; }
        if (this.html?.parentNode) this.html.parentNode.removeChild(this.html);
        this._sculptor?._elements?.delete(this.html);
        this.html = null;
        this._removing = false;
        if (firstError) throw firstError;
    }
}

class DomSculptor {
    constructor() {
        this._elements = elementWrappers;
    }

    _wrapNode(node) {
        return this._elements.get(node) || new DomElement(node, this);
    }

    create(tagName, parent = null, callback = null) {
        let ele = new DomElement(tagName, this);

        let parentNode = null;
        let parentElement = null;
        if (parent == null) {
            parentNode = document.body;
        } else if (parent instanceof DomElement) {
            parentNode = parent.html;
            parentElement = parent;
        } else if (isNode(parent)) {
            parentNode = parent;
        } else if (typeof parent === 'string') {
            parentNode = document.querySelector(parent);
            if (!parentNode) console.warn(`DomSculptor.create: Could not find parent "${parent}". Element not appended.`);
        } else {
            console.warn('DomSculptor.create: Invalid parent type. Element not appended.', parent);
        }

        if (!parentElement && parentNode) parentElement = this._elements.get(parentNode) || null;
        if (parentNode) parentNode.appendChild(ele.html);
        if (parentElement && parentNode) {
            parentElement.children.push(ele);
            ele._parent = parentElement;
        }
        ele._notifyMount();
        if (typeof callback === 'function') callback(ele);

        return ele;
    }

    wrap(selectorOrNode) {
        let node;
        if (typeof selectorOrNode === 'string') {
            node = document.querySelector(selectorOrNode);
            if (!node) { console.warn(`DomSculptor.wrap: Could not find "${selectorOrNode}".`); return null; }
        } else if (isNode(selectorOrNode)) {
            node = selectorOrNode;
        } else {
            console.warn('DomSculptor.wrap: Invalid argument.', selectorOrNode);
            return null;
        }
        return this._wrapNode(node);
    }

    state(initial) {
        let value = initial;
        let subscribers = [];

        let autoUnsub = (element, unsub) => {
            element.onRemove(unsub);
        };

        let store = {
            get() { return value; },
            set(next) {
                if (Object.is(value, next)) return;
                value = next;
                let firstError = null;
                subscribers.slice().forEach(fn => {
                    try { fn(value); } catch (error) { if (!firstError) firstError = error; }
                });
                if (firstError) throw firstError;
            },
            update(fn) { store.set(fn(value)); },
            subscribe(fn) {
                subscribers.push(fn);
                return () => {
                    let i = subscribers.indexOf(fn);
                    if (i > -1) subscribers.splice(i, 1);
                };
            },
            bind(element, updater) {
                updater(value, element);
                let unsub = store.subscribe(v => updater(v, element));
                autoUnsub(element, unsub);
                return element;
            },
            bindText(element, transform = v => v) {
                return store.bind(element, v => element.setText(transform(v)));
            },
            bindValue(element, transform = v => v) {
                return store.bind(element, v => element.setValue(transform(v)));
            },
            bindAttribute(element, name, transform = v => v) {
                return store.bind(element, v => {
                    let next = transform(v);
                    if (next == null || next === false) element.attribute.remove(name);
                    else element.attribute.set(name, next === true ? '' : next);
                });
            },
            bindClass(element, name, transform = v => Boolean(v)) {
                return store.bind(element, v => {
                    if (transform(v)) element.class.add(name);
                    else element.class.remove(name);
                });
            },
            bindStyle(element, property, transform = v => v) {
                return store.bind(element, v => element.setStyle(property, transform(v)));
            },
            bindVisible(element, transform = v => Boolean(v)) {
                return store.bind(element, v => {
                    if (transform(v)) element.show();
                    else element.hide();
                });
            },
            list(container, renderFn) {
                let elements = [];
                let render = (items) => {
                    let firstError = null;
                    elements.forEach(el => {
                        try { el.remove(); } catch (error) { if (!firstError) firstError = error; }
                    });
                    container.children = container.children.filter(c => c.html !== null);
                    let nextElements = [];
                    items.forEach((item, i) => {
                        try {
                            let el = renderFn(item, i);
                            container.child.append(el);
                            nextElements.push(el);
                        } catch (error) {
                            if (!firstError) firstError = error;
                        }
                    });
                    elements = nextElements;
                    if (firstError) throw firstError;
                };
                render(value);
                let unsub = store.subscribe(render);
                autoUnsub(container, unsub);
                return container;
            },
            sync(element, transform = v => v) {
                element.setValue(value);
                element.on('input', e => store.set(transform(e.target.value)));
                let unsub = store.subscribe(v => element.setValue(v));
                autoUnsub(element, unsub);
                return element;
            }
        };
        return store;
    }

    asyncState(initialData = null) {
        let state = this.state({ status: 'idle', data: initialData, error: null });
        let lastTask = null;
        let runId = 0;

        let api = {
            get: state.get,
            subscribe: state.subscribe,
            run(task = lastTask) {
                if (typeof task !== 'function' && !(task && typeof task.then === 'function')) {
                    return Promise.reject(new TypeError('DomSculptor.asyncState.run: expected a function or Promise.'));
                }
                lastTask = task;
                let currentRun = ++runId;
                let current = state.get();
                state.set({ status: 'loading', data: current.data, error: null });

                return Promise.resolve()
                    .then(() => typeof task === 'function' ? task() : task)
                    .then(data => {
                        if (currentRun === runId) state.set({ status: 'success', data, error: null });
                        return data;
                    })
                    .catch(error => {
                        if (currentRun === runId) state.set({ status: 'error', data: state.get().data, error });
                        throw error;
                    });
            },
            retry() { return api.run(lastTask); }
        };

        return api;
    }

    data(initial = {}) {
        let values = Object.assign(
            Object.create(null),
            typeof initial === 'object' && initial !== null ? initial : {}
        );
        let listeners = new Map();
        let anyListeners = [];

        let notify = (key, next, previous) => {
            let keyListeners = listeners.get(key) || [];
            let firstError = null;
            keyListeners.slice().forEach(fn => {
                try { fn(next, previous, key); } catch (error) { if (!firstError) firstError = error; }
            });
            anyListeners.slice().forEach(fn => {
                try { fn(key, next, previous); } catch (error) { if (!firstError) firstError = error; }
            });
            if (firstError) throw firstError;
        };

        let api = {
            get(key = null) {
                if (key == null) return { ...values };
                return values[key];
            },
            set(key, value) {
                if (typeof key === 'object' && key !== null) {
                    let firstError = null;
                    for (let name in key) {
                        if (!Object.hasOwnProperty.call(key, name)) continue;
                        try { api.set(name, key[name]); } catch (error) { if (!firstError) firstError = error; }
                    }
                    if (firstError) throw firstError;
                    return api;
                }

                if (typeof key !== 'string') {
                    console.warn('DomSculptor.data.set: key must be a string.', key);
                    return api;
                }

                let previous = values[key];
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
                    let nextListeners = listeners.get(key).filter(fn => fn !== callback);
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
                    let i = anyListeners.indexOf(callback);
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

        let element = this.create(config.type, config.parent);

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
