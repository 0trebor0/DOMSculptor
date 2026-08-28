// Preserve every cleanup failure so one faulty callback cannot hide later failures.
let throwCollectedErrors = (errors, message) => {
    if (!errors.length) return;
    if (errors.length === 1) throw errors[0];
    if (typeof AggregateError === 'function') throw new AggregateError(errors, message);
    throw errors[0];
};

// Auto-tracking records the signals a computation reads so no dependency list is needed.
let activeTracker = null;
let createTrackedRun = onDependencyChange => {
    let subscriptions = new Map();
    return {
        run(compute) {
            let seen = new Set();
            let previousTracker = activeTracker;
            activeTracker = readable => seen.add(readable);
            let value;
            try { value = compute(); }
            finally { activeTracker = previousTracker; }
            subscriptions.forEach((unsubscribe, readable) => {
                // A branch that stopped reading a signal must stop depending on it.
                if (seen.has(readable)) return;
                unsubscribe();
                subscriptions.delete(readable);
            });
            seen.forEach(readable => {
                if (!subscriptions.has(readable)) {
                    subscriptions.set(readable, readable.subscribe(onDependencyChange));
                }
            });
            return value;
        },
        stop() {
            subscriptions.forEach(unsubscribe => unsubscribe());
            subscriptions.clear();
        }
    };
};

// Scopes give components and tests one deterministic owner for disposable resources.
class DisposalScope {
    constructor(sculptor) {
        this._sculptor = sculptor;
        // A set lets a resource release its own entry when it is disposed individually.
        this._cleanups = new Set();
        this._disposed = false;
    }

    track(cleanup) {
        if (typeof cleanup !== 'function') throw new TypeError('DomSculptor.scope.track: expected a function.');
        if (this._disposed) {
            cleanup();
            return cleanup;
        }
        this._cleanups.add(cleanup);
        return cleanup;
    }

    _untrack(cleanup) {
        this._cleanups.delete(cleanup);
    }

    run(callback) {
        if (this._disposed) throw new Error('DomSculptor: cannot run a disposed scope.');
        if (typeof callback !== 'function') throw new TypeError('DomSculptor.scope.run: expected a function.');
        let previous = this._sculptor._activeScope;
        this._sculptor._activeScope = this;
        try { return callback(); }
        finally { this._sculptor._activeScope = previous; }
    }

    dispose() {
        if (this._disposed) return;
        this._disposed = true;
        let cleanups = Array.from(this._cleanups).reverse();
        this._cleanups.clear();
        let errors = [];
        this._sculptor._disposalDepth++;
        try {
            cleanups.forEach(cleanup => {
                try { cleanup(); } catch (error) { errors.push(error); }
            });
        } finally {
            this._sculptor._disposalDepth--;
        }
        throwCollectedErrors(errors, 'Multiple disposal scope cleanups failed.');
    }

    get disposed() {
        return this._disposed;
    }
}

// Accept cross-realm and test-double nodes without relying only on instanceof.
let isNode = value => {
    if (typeof Node !== 'undefined' && value instanceof Node) return true;
    return value !== null && typeof value === 'object' &&
        typeof value.nodeType === 'number' && typeof value.nodeName === 'string';
};

// DomElement wraps a native node while tracking ownership, listeners, and lifecycle.
class DomElement {
    constructor(tagNameOrNode, sculptor) {
        this.html = isNode(tagNameOrNode) ? tagNameOrNode : document.createElement(tagNameOrNode);
        this._sculptor = sculptor;
        this._children = [];
        this._parent = null;
        this._listeners = {};
        this._mountCallbacks = [];
        this._unmountCallbacks = [];
        this._removeCallbacks = [];
        this._removing = false;
        this._displayBeforeHide = null;
        this._untrackers = [];
        sculptor?._elements?.set(this.html, this);
        if (sculptor) DomSculptor._owners.set(this.html, this);

        let el = this;

        // Fluent namespaces keep common DOM operations grouped without extra wrappers.
        this.attribute = {
            set(name, value = '') {
                el._assertLive('attribute.set');
                if (typeof name === 'object' && name !== null) {
                    for (let key in name) {
                        if (Object.hasOwnProperty.call(name, key)) el.html.setAttribute(key, name[key]);
                    }
                } else if (typeof name === 'string') {
                    el.html.setAttribute(name, value);
                } else {
                    throw new TypeError('DomSculptor.attribute.set: expected a string or attribute object.');
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

        // Child operations update native DOM and DOMSculptor ownership together.
        this.child = {
            append(child) {
                el._assertLive('child.append');
                let childElement = el._elementFor(child);
                if (childElement) {
                    el.html.appendChild(childElement.html);
                    childElement._detachFromParent();
                    el._children.push(childElement);
                    childElement._parent = el;
                    childElement._notifyMount();
                } else if (isNode(child)) {
                    el.html.appendChild(child);
                } else if (typeof child === 'string') {
                    el.html.appendChild(document.createTextNode(child));
                } else {
                    el._sculptor?._warn('invalid-child', 'child.append received an invalid child.', child);
                    throw new TypeError('DomSculptor.child.append: expected a DomElement, Node, or string.');
                }
                return el;
            },
            prepend(child) {
                el._assertLive('child.prepend');
                let childElement = el._elementFor(child);
                if (childElement) {
                    el.html.prepend(childElement.html);
                    childElement._detachFromParent();
                    el._children.unshift(childElement);
                    childElement._parent = el;
                    childElement._notifyMount();
                } else if (isNode(child)) {
                    el.html.prepend(child);
                } else if (typeof child === 'string') {
                    el.html.prepend(document.createTextNode(child));
                } else {
                    el._sculptor?._warn('invalid-child', 'child.prepend received an invalid child.', child);
                    throw new TypeError('DomSculptor.child.prepend: expected a DomElement, Node, or string.');
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
            create(name, opts = null) { return sculptor.createIn(el, name, opts); },
            remove() { el.remove(); },
            clear() { el._clearChildren(); return el; },
            replace(previous, next) { return el._replaceChild(previous, next); }
        };
    }

    get children() {
        // Callers receive a snapshot so internal ownership cannot be mutated externally.
        return Object.freeze(this._children.slice());
    }

    _own(cleanup) {
        // Scope cleanup for this element is released again when the element is disposed.
        let untrack = this._sculptor?._track(cleanup);
        if (untrack) this._untrackers.push(untrack);
    }

    _assertLive(operation) {
        if (this.html) return;
        this._sculptor?._warn(
            'disposed-element-operation',
            `Ignored ${operation} on a disposed element.`
        );
        throw new Error(`DomSculptor.${operation}: element has been disposed.`);
    }

    setText(text) {
        this._assertLive('setText');
        let cleanupError = null;
        try { this._clearChildren(); } catch (error) { cleanupError = error; }
        this.html.textContent = text;
        if (cleanupError) throw cleanupError;
        return this;
    }

    text(readable) {
        this._assertLive('text');
        if (!readable || typeof readable.get !== 'function' || typeof readable.subscribe !== 'function') {
            throw new TypeError('DomSculptor.text: expected a readable signal.');
        }
        let textNode = document.createTextNode(String(readable.get() ?? ''));
        this.html.appendChild(textNode);
        return this._bindReadable(readable, value => {
            textNode.textContent = String(value ?? '');
        });
    }

    attr(name, readable) {
        this._assertLive('attr');
        if (typeof name !== 'string' || !name) {
            throw new TypeError('DomSculptor.attr: expected an attribute name.');
        }
        return this._bindReadable(readable, value => {
            if (value == null || value === false) this.attribute.remove(name);
            else this.attribute.set(name, value === true ? '' : value);
        });
    }

    classToggle(name, readable) {
        this._assertLive('classToggle');
        if (typeof name !== 'string' || !name) {
            throw new TypeError('DomSculptor.classToggle: expected a class name.');
        }
        return this._bindReadable(readable, value => {
            if (value) this.class.add(name);
            else this.class.remove(name);
        });
    }

    styleValue(property, readable) {
        this._assertLive('styleValue');
        if (typeof property !== 'string' || !property) {
            throw new TypeError('DomSculptor.styleValue: expected a style property.');
        }
        return this._bindReadable(readable, value => {
            this.setStyle(property, value == null ? '' : value);
        });
    }

    _bindReadable(readable, apply) {
        if (!readable || typeof readable.get !== 'function' || typeof readable.subscribe !== 'function') {
            throw new TypeError('DomSculptor: expected a readable signal.');
        }
        apply(readable.get());
        let render = () => {
            if (this.html) apply(readable.get());
        };
        // Reactive writes share the runtime scheduler and automatically stop on disposal.
        let unsubscribe = readable.subscribe(() => this._sculptor._schedule(render));
        let cleanup = () => {
            this._sculptor._scheduledJobs.delete(render);
            unsubscribe();
        };
        this.onRemove(cleanup);
        this._own(cleanup);
        return this;
    }

    getValue() {
        this._assertLive('getValue');
        return this.html.value;
    }

    setValue(value) {
        this._assertLive('setValue');
        this.html.value = value;
        return this;
    }

    setStyle(property, value) {
        this._assertLive('setStyle');
        if (typeof property === 'object' && property !== null) {
            for (let key in property) {
                if (Object.hasOwnProperty.call(property, key)) this.html.style[key] = property[key];
            }
        } else if (typeof property === 'string' && value !== undefined) {
            this.html.style[property] = value;
        } else {
            throw new TypeError('DomSculptor.setStyle: expected a style object or property and value.');
        }
        return this;
    }

    hide() {
        this._assertLive('hide');
        if (this.html.style.display !== 'none') this._displayBeforeHide = this.html.style.display;
        this.html.style.display = 'none';
        return this;
    }
    show() {
        this._assertLive('show');
        this.html.style.display = this._displayBeforeHide ?? '';
        this._displayBeforeHide = null;
        return this;
    }

    focus(options = undefined) {
        this._assertLive('focus');
        if (typeof this.html.focus !== 'function') {
            throw new TypeError('DomSculptor.focus: element is not focusable.');
        }
        this.html.focus(options);
        return this;
    }

    blur() {
        this._assertLive('blur');
        if (typeof this.html.blur !== 'function') {
            throw new TypeError('DomSculptor.blur: element is not focusable.');
        }
        this.html.blur();
        return this;
    }

    isFocused() {
        this._assertLive('isFocused');
        return this.html.ownerDocument?.activeElement === this.html;
    }

    parent() {
        // Native code may move nodes, so reconcile cached ownership with the real DOM.
        let parentNode = this.html?.parentNode || null;
        if (this._parent?.html === parentNode) return this._parent;
        if (this._parent) this._detachFromParent();
        if (!parentNode) return null;

        let parent = this._sculptor._wrapNode(parentNode);
        parent._children = parent._children.filter(child => child !== this && child.html?.parentNode === parentNode);
        parent._children.push(this);
        let nodeOrder = Array.from(parentNode.childNodes || []);
        parent._children.sort((a, b) => nodeOrder.indexOf(a.html) - nodeOrder.indexOf(b.html));
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
        if (typeof callback !== 'function') throw new TypeError('DomSculptor.onMount: expected a function.');
        if (this._isMounted()) callback(this);
        else this._mountCallbacks.push(callback);
        return this;
    }

    onUnmount(callback) {
        if (typeof callback !== 'function') throw new TypeError('DomSculptor.onUnmount: expected a function.');
        this._unmountCallbacks.push(callback);
        return this;
    }

    onDispose(callback) {
        if (typeof callback !== 'function') throw new TypeError('DomSculptor.onDispose: expected a function.');
        this._removeCallbacks.push(callback);
        return this;
    }

    onRemove(callback) {
        return this.onDispose(callback);
    }

    on(event, callback, options = undefined, delegatedOptions = undefined) {
        this._assertLive('on');
        if (typeof event === 'object' && event !== null) {
            for (let key in event) {
                if (Object.hasOwnProperty.call(event, key) && typeof event[key] === 'function') {
                    this.on(key, event[key], options);
                }
            }
        } else if (typeof event === 'string' && typeof callback === 'string') {
            // Delegation keeps one listener on the managed root for repeated children.
            if (typeof options !== 'function') {
                throw new TypeError('DomSculptor.on: delegated events require a handler function.');
            }
            let selector = callback;
            let handler = options;
            let wrapped = eventObject => {
                let matched = eventObject.target?.closest?.(selector) || null;
                if (!matched) return;
                let withinRoot = false;
                for (let node = matched; node; node = node.parentNode) {
                    if (node === this.html) {
                        withinRoot = true;
                        break;
                    }
                }
                if (withinRoot) handler.call(matched, eventObject, matched);
            };
            wrapped._domSculptorOriginal = handler;
            if (delegatedOptions?.signal?.aborted) return this;
            this.html.addEventListener(event, wrapped, delegatedOptions);
            this._rememberListener(event, wrapped, delegatedOptions);
            this._own(() => {
                if (this.html) this.off(event, handler);
            });
        } else if (typeof event === 'string' && typeof callback === 'function') {
            if (options?.signal?.aborted) return this;
            this.html.addEventListener(event, callback, options);
            this._rememberListener(event, callback, options);
            this._own(() => {
                if (this.html) this.off(event, callback);
            });
        } else {
            throw new TypeError('DomSculptor.on: invalid event arguments.');
        }
        return this;
    }

    once(event, callback, options = undefined) {
        this._assertLive('once');
        if (typeof event === 'string' && typeof callback === 'function') {
            let wrapped = (...args) => {
                this._forgetListener(event, wrapped);
                callback.apply(this.html, args);
            };
            wrapped._domSculptorOriginal = callback;
            let listenerOptions = typeof options === 'boolean'
                ? { capture: options, once: true }
                : { ...options, once: true };
            if (listenerOptions.signal?.aborted) return this;
            this.html.addEventListener(event, wrapped, listenerOptions);
            this._rememberListener(event, wrapped, listenerOptions);
            this._own(() => {
                if (this.html) this.off(event, callback);
            });
        } else {
            throw new TypeError('DomSculptor.once: expected an event name and callback.');
        }
        return this;
    }

    off(event, callback = null) {
        if (!this._listeners[event]) {
            if (callback) this.html.removeEventListener(event, callback);
            return this;
        }
        if (callback) {
            let matches = this._listeners[event].filter(listener =>
                listener.callback === callback || listener.callback._domSculptorOriginal === callback
            );
            matches.forEach(listener => {
                listener.removeAbortTracking?.();
                this.html.removeEventListener(event, listener.callback, listener.options);
            });
            this._listeners[event] = this._listeners[event].filter(listener => !matches.includes(listener));
            if (!this._listeners[event].length) delete this._listeners[event];
        } else {
            this._listeners[event].forEach(listener => {
                listener.removeAbortTracking?.();
                this.html.removeEventListener(event, listener.callback, listener.options);
            });
            delete this._listeners[event];
        }
        return this;
    }

    _forgetListener(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(listener => {
            if (listener.callback !== callback) return true;
            listener.removeAbortTracking?.();
            return false;
        });
        if (!this._listeners[event].length) delete this._listeners[event];
    }

    _rememberListener(event, callback, options) {
        if (!this._listeners[event]) this._listeners[event] = [];
        let listener = { callback, options };
        let signal = typeof options === 'object' && options !== null ? options.signal : null;
        if (signal) {
            let forget = () => this._forgetListener(event, callback);
            signal.addEventListener('abort', forget, { once: true });
            listener.removeAbortTracking = () => signal.removeEventListener('abort', forget);
        }
        this._listeners[event].push(listener);
    }

    _detachFromParent() {
        if (!this._parent) return;
        this._parent._children = this._parent._children.filter(child => child !== this);
        this._parent = null;
    }

    _isMounted() {
        if (!this.html) return false;
        return typeof this.html.isConnected === 'boolean' ? this.html.isConnected : this.html.parentNode !== null;
    }

    _notifyMount() {
        if (!this._isMounted()) return;
        let callbacks = this._mountCallbacks.splice(0);
        let errors = [];
        callbacks.forEach(callback => {
            try { callback(this); } catch (error) { errors.push(error); }
        });
        // Descendants mounted inside a detached tree become mounted with their root.
        this._children.forEach(child => {
            try { child._notifyMount(); } catch (error) { errors.push(error); }
        });
        throwCollectedErrors(errors, 'Multiple mount hooks failed.');
    }

    _notifyUnmount() {
        let errors = [];
        this._children.slice().reverse().forEach(child => {
            try { child._notifyUnmount(); } catch (error) { errors.push(error); }
        });
        this._unmountCallbacks.slice().forEach(callback => {
            try { callback(this); } catch (error) { errors.push(error); }
        });
        throwCollectedErrors(errors, 'Multiple unmount hooks failed.');
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
        // Dispose known wrappers before removing unknown native children.
        let firstError = null;
        this._children.slice().forEach(child => {
            if (child._parent !== this && child.html?.parentNode !== this.html) return;
            try { child.remove(); } catch (error) { if (!firstError) firstError = error; }
        });
        while (this.html?.firstChild) {
            let node = this.html.firstChild;
            try { this._cleanupKnownNode(node); } catch (error) { if (!firstError) firstError = error; }
            if (node.parentNode === this.html) this.html.removeChild(node);
        }
        this._children = [];
        if (firstError) throw firstError;
    }

    _replaceChild(previous, next) {
        let previousNode = this._toNode(previous);
        let nextNode = this._toNode(next);
        let previousElement = this._elementFor(previous);
        let nextElement = this._elementFor(next);
        if (!previousNode || !nextNode || previousNode.parentNode !== this.html) {
            this._sculptor?._warn('invalid-child', 'child.replace received invalid children.', { previous, next });
            throw new TypeError('DomSculptor.child.replace: expected an existing child and a replacement.');
        }
        if (previousNode === nextNode) return this;

        // Perform the native replacement first, then rebuild wrapper ownership.
        this.html.replaceChild(nextNode, previousNode);
        if (nextElement) nextElement._detachFromParent();

        let firstError = null;
        try { this._cleanupKnownNode(previousNode); } catch (error) { firstError = error; }
        this._children = this._children.filter(child => child !== previousElement && child !== nextElement);
        if (nextElement) {
            let nodeOrder = Array.from(this.html.childNodes);
            this._children.push(nextElement);
            this._children.sort((a, b) => nodeOrder.indexOf(a.html) - nodeOrder.indexOf(b.html));
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
            owner._children = owner._children.filter(child => child !== valueElement);
            owner._children.push(valueElement);
            owner._children.sort((a, b) => nodeOrder.indexOf(a.html) - nodeOrder.indexOf(b.html));
            valueElement._parent = owner;
            valueElement._notifyMount();
        }
        return this;
    }

    dispose() {
        // Disposal is permanent and reentrancy-safe; unmounting remains reversible.
        if (!this.html || this._removing) return;
        this._removing = true;
        let errors = [];
        this._detachFromParent();
        try { this._clearChildren(); } catch (error) { errors.push(error); }
        let disposeCallbacks = this._removeCallbacks.splice(0);
        disposeCallbacks.forEach(callback => {
            try { callback(this); } catch (error) { errors.push(error); }
        });
        for (let eventType in this._listeners) {
            if (Object.hasOwnProperty.call(this._listeners, eventType)) {
                this._listeners[eventType].forEach(listener =>
                    {
                        listener.removeAbortTracking?.();
                        this.html.removeEventListener(eventType, listener.callback, listener.options);
                    }
                );
            }
        }
        this._listeners = {};
        this._untrackers.forEach(untrack => untrack());
        this._untrackers = [];
        if (this.html?.parentNode) this.html.parentNode.removeChild(this.html);
        this._sculptor?._elements?.delete(this.html);
        DomSculptor._owners.delete(this.html);
        this.html = null;
        this._removing = false;
        throwCollectedErrors(errors, 'Multiple dispose operations failed.');
    }

    remove() {
        return this.dispose();
    }
}

// DomSculptor owns scheduling, wrappers, rendering queues, state, and components.
class DomSculptor {
    static _owners = new WeakMap();

    constructor(options = {}) {
        if (!options || typeof options !== 'object') {
            throw new TypeError('DomSculptor: constructor options must be an object.');
        }
        this._elements = new WeakMap();
        this._scheduledJobs = new Set();
        this._flushPending = false;
        this._batchDepth = 0;
        this._activeScope = null;
        this._rootScope = new DisposalScope(this);
        this._disposalDepth = 0;
        // A queue per parent lets unrelated DOM branches render independently.
        this._renderQueues = new WeakMap();
        this._activeRenderQueues = 0;
        // The container node keys each virtual list so one runtime cannot drive another's.
        this._virtualLists = new WeakMap();
        this._activeVirtualRenders = 0;
        this.rendering = false;
        this._development = Boolean(options.development);
        this._onWarning = options.onWarning;
        this._activeComponents = new Set();
        if (this._onWarning != null && typeof this._onWarning !== 'function') {
            throw new TypeError('DomSculptor: onWarning must be a function.');
        }
    }

    _warn(code, message, details = undefined) {
        if (!this._development) return;
        let warning = { code, message, details };
        if (this._onWarning) this._onWarning(warning);
        else if (typeof console !== 'undefined') console.warn(`[DOMSculptor ${code}] ${message}`, details);
    }

    _flushJobs() {
        // Drain jobs added during a flush before returning to keep flush deterministic.
        this._flushPending = false;
        let errors = [];
        while (this._scheduledJobs.size) {
            let jobs = Array.from(this._scheduledJobs);
            this._scheduledJobs.clear();
            jobs.forEach(job => {
                try { job(); } catch (error) { errors.push(error); }
            });
        }
        throwCollectedErrors(errors, 'Multiple scheduled DOMSculptor jobs failed.');
    }

    _requestFlush() {
        if (!this._scheduledJobs.size || this._flushPending || this._batchDepth) return;
        this._flushPending = true;
        // Microtasks coalesce reactive writes without delaying them to a visual frame.
        queueMicrotask(() => {
            try { this._flushJobs(); }
            catch (error) { setTimeout(() => { throw error; }); }
        });
    }

    _schedule(job) {
        this._scheduledJobs.add(job);
        this._requestFlush();
    }

    _updateRenderingStatus() {
        // One path owns the flag so create queues and virtual lists cannot clear each other.
        this.rendering = this._activeRenderQueues > 0 || this._activeVirtualRenders > 0;
    }

    _track(cleanup) {
        // Without an explicit scope the runtime itself owns the resource, so
        // nothing created through a sculptor is left without a disposer.
        let scope = this._activeScope ?? this._rootScope;
        scope.track(cleanup);
        return () => scope._untrack(cleanup);
    }

    dispose() {
        if (this._rootScope.disposed) return;
        this._scheduledJobs.clear();
        this._rootScope.dispose();
    }

    get disposed() {
        return this._rootScope.disposed;
    }

    _wrapNode(node) {
        let existing = this._elements.get(node);
        if (existing) return existing;
        // One wrapper per native node prevents ownership splits across instances.
        let owned = DomSculptor._owners.get(node);
        if (owned) {
            this._warn(
                'wrapper-ownership',
                'A node already managed by another DOMSculptor instance was reused.',
                node
            );
            return owned;
        }
        return new DomElement(node, this);
    }

    createScope() {
        return new DisposalScope(this);
    }

    createContextKey(description = undefined) {
        return Symbol(description);
    }

    createContext(parent = null, initial = null) {
        // Context lookup walks parents, allowing local overrides without copying values.
        if (parent != null && typeof parent.get !== 'function') {
            throw new TypeError('DomSculptor.createContext: parent must be a context.');
        }
        let sculptor = this;
        let values = new Map();
        if (initial instanceof Map) initial.forEach((value, key) => values.set(key, value));
        else if (initial && typeof initial === 'object') {
            Reflect.ownKeys(initial).forEach(key => values.set(key, initial[key]));
        } else if (initial != null) {
            throw new TypeError('DomSculptor.createContext: initial values must be an object or Map.');
        }
        let context = {
            get(key, fallback = undefined) {
                if (values.has(key)) return values.get(key);
                return parent ? parent.get(key, fallback) : fallback;
            },
            has(key) {
                return values.has(key) || Boolean(parent?.has(key));
            },
            set(key, value) {
                values.set(key, value);
                return context;
            },
            delete(key) {
                return values.delete(key);
            },
            child(childValues = null) {
                return sculptor.createContext(context, childValues);
            }
        };
        return context;
    }

    component(factory, options = {}) {
        // Each component factory invocation receives an isolated disposal scope.
        if (typeof factory !== 'function') throw new TypeError('DomSculptor.component: expected a factory.');
        if (!options || typeof options !== 'object') {
            throw new TypeError('DomSculptor.component: options must be an object.');
        }
        let sculptor = this;
        return (props = {}, context = sculptor.createContext()) => {
            let parentScope = sculptor._activeScope;
            let scope = sculptor.createScope();
            let result;
            try {
                result = scope.run(() => factory(props, context));
            } catch (error) {
                let errors = [error];
                try { scope.dispose(); } catch (cleanupError) { errors.push(cleanupError); }
                throwCollectedErrors(errors, 'Component creation and cleanup failed.');
            }
            let definition = result instanceof DomElement || isNode(result)
                ? { root: result }
                : result;
            if (!definition || typeof definition !== 'object') {
                scope.dispose();
                throw new TypeError('DomSculptor.component: factory must return a root or component definition.');
            }
            let root = definition.root instanceof DomElement
                ? definition.root
                : isNode(definition.root) ? sculptor._wrapNode(definition.root) : null;
            if (!root || !root.html) {
                scope.dispose();
                throw new TypeError('DomSculptor.component: root must be a live DomElement or Node.');
            }
            let fragmentNodes = root.html.nodeType === 11 ? Array.from(root.html.childNodes) : null;
            scope.track(() => root.remove());
            if (fragmentNodes) {
                scope.track(() => {
                    let errors = [];
                    fragmentNodes.forEach(node => {
                        let wrapped = sculptor._elements.get(node);
                        try {
                            if (wrapped?.html) wrapped.remove();
                            else {
                                root._cleanupKnownNode(node);
                                node.parentNode?.removeChild(node);
                            }
                        } catch (error) {
                            errors.push(error);
                        }
                    });
                    throwCollectedErrors(errors, 'Multiple fragment component nodes failed to dispose.');
                });
            }
            if (definition.dispose != null) {
                if (typeof definition.dispose !== 'function') {
                    scope.dispose();
                    throw new TypeError('DomSculptor.component: dispose must be a function.');
                }
                scope.track(definition.dispose);
            }
            let instance = {
                root,
                api: definition.api || {},
                scope,
                context,
                name: options.name || factory.name || 'AnonymousComponent',
                createdAt: sculptor._development ? new Error().stack : undefined,
                _fragmentNodes: fragmentNodes,
                dispose() { scope.dispose(); },
                get disposed() { return scope.disposed; }
            };
            if (sculptor._development) {
                sculptor._activeComponents.add(instance);
                scope.track(() => sculptor._activeComponents.delete(instance));
            }
            parentScope?.track(() => instance.dispose());
            return instance;
        };
    }

    errorBoundary(componentFactory, fallback) {
        // Failed component scopes are disposed before constructing the fallback UI.
        if (typeof componentFactory !== 'function') {
            throw new TypeError('DomSculptor.errorBoundary: expected a component factory.');
        }
        if (typeof fallback !== 'function') {
            throw new TypeError('DomSculptor.errorBoundary: expected a fallback function.');
        }
        let sculptor = this;
        return (props = {}, context = sculptor.createContext()) => {
            try {
                return componentFactory(props, context);
            } catch (error) {
                let replacement = fallback(error, props, context);
                if (replacement?.root instanceof DomElement && typeof replacement.dispose === 'function') {
                    return replacement;
                }
                return sculptor.component(() => replacement)(props, context);
            }
        };
    }

    _resolveParent(parent) {
        // Resolve selectors once and retain a wrapper when ownership is already known.
        if (parent instanceof DomElement) {
            if (!parent.html) {
                this._warn('invalid-parent', 'Mount received a disposed parent.');
                throw new Error('DomSculptor.mount: parent has been disposed.');
            }
            return { node: parent.html, element: parent };
        }
        if (isNode(parent)) return { node: parent, element: this._elements.get(parent) || null };
        if (typeof parent === 'string') {
            let node = document.querySelector(parent);
            if (!node) {
                this._warn('invalid-parent', `Mount could not find parent "${parent}".`);
                throw new Error(`DomSculptor.mount: could not find parent "${parent}".`);
            }
            return { node, element: this._elements.get(node) || null };
        }
        this._warn('invalid-parent', 'Mount received an invalid parent value.', parent);
        throw new TypeError('DomSculptor.mount: expected a selector, Node, or DomElement parent.');
    }

    createDetached(tagName, callback = null) {
        if (typeof tagName !== 'string' || !tagName) {
            throw new TypeError('DomSculptor.createDetached: expected a tag name.');
        }
        let element = new DomElement(tagName, this);
        element._own(() => element.remove());
        if (callback != null && typeof callback !== 'function') {
            element.remove();
            throw new TypeError('DomSculptor.createDetached: callback must be a function.');
        }
        callback?.(element);
        return element;
    }

    mount(element, parent) {
        // Components delegate mounting to their root while fragments restore their nodes.
        if (element && element.root instanceof DomElement && element._fragmentNodes) {
            if (element.disposed) throw new Error('DomSculptor.mount: component has been disposed.');
            let resolved = this._resolveParent(parent);
            element._fragmentNodes.forEach(node => {
                if (node.parentNode !== element.root.html) element.root.html.appendChild(node);
            });
            resolved.node.appendChild(element.root.html);
            let errors = [];
            try { element.root._notifyMount(); } catch (error) { errors.push(error); }
            element._fragmentNodes.forEach(node => {
                let wrapped = this._elements.get(node);
                if (!wrapped) return;
                try { wrapped._notifyMount(); } catch (error) { errors.push(error); }
            });
            throwCollectedErrors(errors, 'Multiple fragment component mount hooks failed.');
            return element;
        }
        if (element && element.root instanceof DomElement) {
            this.mount(element.root, parent);
            return element;
        }
        if (!(element instanceof DomElement) || !element.html) {
            throw new TypeError('DomSculptor.mount: expected a live DomElement.');
        }
        let resolved = this._resolveParent(parent);
        resolved.node.appendChild(element.html);
        element._detachFromParent();
        if (resolved.element) {
            resolved.element._children = resolved.element._children.filter(child => child !== element);
            resolved.element._children.push(element);
            element._parent = resolved.element;
        }
        element._notifyMount();
        return element;
    }

    tryMount(element, parent) {
        try {
            return this.mount(element, parent);
        } catch {
            return null;
        }
    }

    unmount(element) {
        // Unmount preserves wrappers and resources so the value can be mounted again.
        if (element && element.root instanceof DomElement && element._fragmentNodes) {
            if (element.disposed) throw new Error('DomSculptor.unmount: component has been disposed.');
            let errors = [];
            element._fragmentNodes.slice().reverse().forEach(node => {
                let wrapped = this._elements.get(node);
                if (!wrapped) return;
                try { wrapped._notifyUnmount(); } catch (error) { errors.push(error); }
            });
            try { element.root._notifyUnmount(); } catch (error) { errors.push(error); }
            element._fragmentNodes.forEach(node => element.root.html.appendChild(node));
            throwCollectedErrors(errors, 'Multiple fragment component unmount hooks failed.');
            return element;
        }
        if (element && element.root instanceof DomElement) {
            this.unmount(element.root);
            return element;
        }
        if (!(element instanceof DomElement) || !element.html) {
            throw new TypeError('DomSculptor.unmount: expected a live DomElement.');
        }
        let error = null;
        if (element.html.parentNode) {
            try { element._notifyUnmount(); } catch (hookError) { error = hookError; }
        }
        element._detachFromParent();
        element.html.parentNode?.removeChild(element.html);
        if (error) throw error;
        return element;
    }

    adopt(node) {
        if (!isNode(node)) throw new TypeError('DomSculptor.adopt: expected a Node.');
        return this._wrapNode(node);
    }

    createIn(parent, tagName, callback = null) {
        let element = this.createDetached(tagName);
        this.mount(element, parent);
        if (callback != null && typeof callback !== 'function') {
            element.remove();
            throw new TypeError('DomSculptor.createIn: callback must be a function.');
        }
        callback?.(element);
        return element;
    }

    create(tagName, parent = null, callback = null) {
        if (typeof parent === 'function' && callback == null) {
            callback = parent;
            parent = null;
        }
        if (callback != null && typeof callback !== 'function') {
            throw new TypeError('DomSculptor.create: callback must be a function.');
        }
        let element = this.createDetached(tagName);
        try {
            if (parent != null) this.mount(element, parent);
            callback?.(element);
            return element;
        } catch (error) {
            element.remove();
            throw error;
        }
    }

    createProgressively(tagName, parent, callback = null) {
        if (parent == null) {
            throw new TypeError('DomSculptor.createProgressively: parent is required.');
        }
        if (callback != null && typeof callback !== 'function') {
            throw new TypeError('DomSculptor.createProgressively: callback must be a function.');
        }
        let element = this.createDetached(tagName);
        try {
            let resolved = this._resolveParent(parent);
            let queue = this._renderQueues.get(resolved.node);
            if (queue) {
                // Return the configured element now, but defer its DOM insertion.
                queue.push(element);
            } else {
                // Mount the first element immediately so small renders stay instant.
                this.mount(element, resolved.element || resolved.node);
                queue = [];
                this._renderQueues.set(resolved.node, queue);
                this._activeRenderQueues++;
                this._updateRenderingStatus();
                let active = true;
                let cancelQueue;
                let finishQueue = () => {
                    if (!active) return;
                    active = false;
                    this._renderQueues.delete(resolved.node);
                    this._activeRenderQueues--;
                    this._updateRenderingStatus();
                    if (resolved.element) {
                        resolved.element._removeCallbacks = resolved.element._removeCallbacks
                            .filter(callback => callback !== cancelQueue);
                    }
                };
                cancelQueue = () => {
                    let errors = [];
                    while (queue.length) {
                        let queued = queue.shift();
                        try { queued.remove(); } catch (error) { errors.push(error); }
                    }
                    finishQueue();
                    throwCollectedErrors(errors, 'Multiple queued elements failed to dispose.');
                };
                resolved.element?.onDispose(cancelQueue);
                let proceed = () => {
                    // Each callback mounts at most one queued element for this parent.
                    let next = queue.shift();
                    if (!next) {
                        finishQueue();
                        return;
                    }
                    try {
                        // Disposed elements remain harmless while waiting in the queue.
                        if (next.html) this.mount(next, resolved.element || resolved.node);
                    } catch (error) {
                        if (next.html) next.remove();
                        setTimeout(() => { throw error; });
                    }
                    if (queue.length) {
                        typeof requestAnimationFrame === 'function'
                            ? requestAnimationFrame(proceed)
                            : setTimeout(proceed, 0);
                    } else {
                        finishQueue();
                    }
                };
                typeof requestAnimationFrame === 'function'
                    ? requestAnimationFrame(proceed)
                    : setTimeout(proceed, 0);
            }
            callback?.(element);
            return element;
        } catch (error) {
            element.remove();
            throw error;
        }
    }

    tree(config) {
        // Tree configuration is applied to detached nodes before any optional mounting.
        if (!config || typeof config !== 'object' || Array.isArray(config)) {
            throw new TypeError('DomSculptor.tree: expected a configuration object.');
        }
        if (typeof config.tag !== 'string' || !config.tag) {
            throw new TypeError('DomSculptor.tree: expected a tag.');
        }
        let element = this.createDetached(config.tag);
        if (config.attributes != null) {
            if (typeof config.attributes !== 'object') throw new TypeError('DomSculptor.tree: attributes must be an object.');
            element.attribute.set(config.attributes);
        }
        if (config.properties != null) {
            if (typeof config.properties !== 'object') throw new TypeError('DomSculptor.tree: properties must be an object.');
            Object.keys(config.properties).forEach(name => { element.html[name] = config.properties[name]; });
        }
        if (typeof config.class === 'string') element.class.add(config.class);
        else if (Array.isArray(config.class)) element.class.add(...config.class);
        else if (config.class != null) throw new TypeError('DomSculptor.tree: class must be a string or array.');
        if (config.on != null) {
            if (typeof config.on !== 'object') throw new TypeError('DomSculptor.tree: on must be an event map.');
            Object.keys(config.on).forEach(name => {
                let definition = config.on[name];
                if (typeof definition === 'function') element.on(name, definition);
                else if (definition && typeof definition.handler === 'function') {
                    element.on(name, definition.handler, definition.options);
                } else {
                    throw new TypeError(`DomSculptor.tree: invalid "${name}" event handler.`);
                }
            });
        }
        if (config.text != null) {
            if (config.text && typeof config.text.get === 'function' && typeof config.text.subscribe === 'function') {
                let textNode = document.createTextNode(String(config.text.get() ?? ''));
                element.child.append(textNode);
                let renderText = () => { textNode.textContent = String(config.text.get() ?? ''); };
                let unsubscribe = config.text.subscribe(() => this._schedule(renderText));
                element.onRemove(() => {
                    this._scheduledJobs.delete(renderText);
                    unsubscribe();
                });
            } else {
                element.child.append(String(config.text));
            }
        }
        let append = child => {
            if (Array.isArray(child)) {
                child.forEach(append);
            } else if (child && typeof child === 'object' && !isNode(child) && !(child instanceof DomElement)) {
                element.child.append(this.tree(child));
            } else if (child instanceof DomElement || isNode(child) || typeof child === 'string') {
                element.child.append(child);
            } else if (child != null && child !== false) {
                element.child.append(String(child));
            }
        };
        if (config.children != null) append(config.children);
        return element;
    }

    when(condition, branch, options = {}) {
        // Conditional branches reuse preserved nodes or dispose factory-owned nodes.
        if (!condition || typeof condition.get !== 'function' || typeof condition.subscribe !== 'function') {
            throw new TypeError('DomSculptor.when: expected a signal condition.');
        }
        if (!(branch instanceof DomElement) && typeof branch !== 'function') {
            throw new TypeError('DomSculptor.when: branch must be a DomElement or factory.');
        }
        if (options.fallback != null &&
            !(options.fallback instanceof DomElement) &&
            typeof options.fallback !== 'function') {
            throw new TypeError('DomSculptor.when: fallback must be a DomElement or factory.');
        }
        let parent = options.parent;
        if (parent == null && branch instanceof DomElement) parent = branch.parent();
        if (parent == null) throw new Error('DomSculptor.when: a parent is required for a detached or factory branch.');
        let parentElement = parent instanceof DomElement
            ? parent
            : this._wrapNode(this._resolveParent(parent).node);
        let active = null;
        let activeSource = Symbol('uninitialized');
        let preserved = new Map();
        let stopped = false;
        if (branch instanceof DomElement && branch.html?.parentNode === parentElement.html) {
            active = branch;
            activeSource = branch;
        }
        let sourceFor = visible => visible ? branch : options.fallback;
        let createBranch = source => {
            if (source == null) return null;
            if (preserved.has(source)) return preserved.get(source);
            let element = typeof source === 'function' ? source() : source;
            if (!(element instanceof DomElement) || !element.html) {
                throw new TypeError('DomSculptor.when: branch factories must return a live DomElement.');
            }
            if (options.preserve || typeof source !== 'function') preserved.set(source, element);
            return element;
        };
        let render = () => {
            if (stopped || !parentElement.html) return;
            let source = sourceFor(Boolean(condition.get()));
            if (source === activeSource) return;
            if (active?.html) {
                if (options.preserve || typeof activeSource !== 'function') this.unmount(active);
                else active.remove();
            }
            activeSource = source;
            active = createBranch(source);
            if (active) this.mount(active, parentElement);
        };
        render();
        let unsubscribe = condition.subscribe(() => this._schedule(render));
        let stop = () => {
            if (stopped) return;
            stopped = true;
            this._scheduledJobs.delete(render);
            unsubscribe();
            if (active?.html) {
                if (options.disposeOnStop === false) this.unmount(active);
                else active.remove();
            }
            preserved.forEach(element => {
                if (element !== active && element.html && element.html.parentNode == null) element.remove();
            });
            preserved.clear();
        };
        parentElement.onRemove(stop);
        this._track(stop);
        return stop;
    }

    router(routes, options = {}) {
        // One route is mounted at a time and leaving a route disposes its view,
        // so route changes cannot accumulate detached DOM or subscriptions.
        if (!routes || typeof routes !== 'object') {
            throw new TypeError('DomSculptor.router: expected a routes object.');
        }
        let compiled = Object.keys(routes).map(pattern => {
            let view = routes[pattern];
            if (typeof view !== 'function') {
                throw new TypeError(`DomSculptor.router: route "${pattern}" must be a function.`);
            }
            let names = [];
            let source = pattern.split('/').map(segment => {
                if (segment === '*') {
                    names.push('rest');
                    return '(.*)';
                }
                if (segment[0] === ':') {
                    names.push(segment.slice(1));
                    return '([^/]+)';
                }
                return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            }).join('/');
            return { pattern, view, names, matcher: new RegExp(`^${source}$`) };
        });
        let parent = options.parent ?? document.body;
        let parentElement = parent instanceof DomElement
            ? parent
            : this._wrapNode(this._resolveParent(parent).node);
        let readPath = () => options.hash
            ? (location.hash.slice(1) || '/')
            : location.pathname;
        let match = path => {
            for (let route of compiled) {
                let found = route.matcher.exec(path);
                if (!found) continue;
                let params = {};
                route.names.forEach((name, index) => {
                    params[name] = decodeURIComponent(found[index + 1]);
                });
                return { path, route: route.pattern, params };
            }
            return { path, route: null, params: {} };
        };

        let current = this.signal(match(readPath()));
        let active = null;
        let stopped = false;
        let render = () => {
            if (stopped) return;
            if (active) {
                active.dispose();
                active = null;
            }
            let snapshot = current.get();
            let route = compiled.find(entry => entry.pattern === snapshot.route);
            if (!route) return;
            active = route.view(snapshot);
            if (active) this.mount(active, parentElement);
        };
        let apply = path => {
            let snapshot = match(path);
            if (snapshot.path === current.get().path && snapshot.route === current.get().route) return;
            current.set(snapshot);
        };
        let navigate = (path, replace) => {
            if (typeof path !== 'string' || !path) {
                throw new TypeError('DomSculptor.router.navigate: expected a path.');
            }
            let target = options.hash ? `#${path}` : path;
            history[replace ? 'replaceState' : 'pushState']({}, '', target);
            apply(path);
        };
        let onLocationChange = () => apply(readPath());
        let event = options.hash ? 'hashchange' : 'popstate';
        window.addEventListener(event, onLocationChange);
        let unsubscribe = current.subscribe(() => this._schedule(render));
        render();

        let stop = () => {
            if (stopped) return;
            stopped = true;
            untrack();
            window.removeEventListener(event, onLocationChange);
            this._scheduledJobs.delete(render);
            unsubscribe();
            if (active) {
                active.dispose();
                active = null;
            }
            current.dispose();
        };
        let untrack = this._track(stop);
        return {
            current,
            navigate: path => navigate(path, false),
            replace: path => navigate(path, true),
            stop,
            get stopped() { return stopped; }
        };
    }

    virtualList(items, container, options = {}) {
        // Only the visible range plus overscan exists in the DOM; a spacer of the
        // full collection height keeps the scrollbar representing every record.
        if (!Array.isArray(items)) {
            throw new TypeError('DomSculptor.virtualList: expected an items array.');
        }
        if (!(container instanceof DomElement)) {
            throw new TypeError('DomSculptor.virtualList: expected a DomElement container.');
        }
        container._assertLive('virtualList');
        if (this._virtualLists.has(container.html)) {
            throw new Error('DomSculptor.virtualList: container is already virtualized.');
        }
        let rowHeight = options.rowHeight;
        if (typeof rowHeight !== 'number' || !(rowHeight > 0)) {
            throw new TypeError('DomSculptor.virtualList: rowHeight must be a positive number.');
        }
        if (typeof options.render !== 'function') {
            throw new TypeError('DomSculptor.virtualList: render must be a function.');
        }
        let overscan = options.overscan ?? 4;
        let keyOf = options.key ?? null;
        let aria = options.aria !== false;
        let keyFor = (item, index) => keyOf ? keyOf(item, index) : index;
        let copyItems = list => {
            if (!Array.isArray(list)) {
                throw new TypeError('DomSculptor.virtualList: expected an items array.');
            }
            if (keyOf) {
                // Reject duplicates before any DOM mutation so a failed update leaves the list intact.
                let seen = new Set();
                list.forEach((item, index) => {
                    let key = keyOf(item, index);
                    if (seen.has(key)) {
                        throw new TypeError(`DomSculptor.virtualList: duplicate key "${String(key)}".`);
                    }
                    seen.add(key);
                });
            }
            return list.slice();
        };

        let stored = copyItems(items);
        let spacer = this.createDetached('div');
        let content = this.createDetached('div');
        spacer.setStyle({ position: 'relative', width: '100%' });
        content.setStyle({ position: 'absolute', top: '0px', left: '0px', right: '0px' });
        spacer.child.append(content);
        if (aria) container.attribute.set('role', 'list');

        let state = {
            items: stored,
            rows: new Map(),
            start: 0,
            end: 0,
            pendingFrame: null,
            disposed: false,
            rowHeight,
            keyFor,
            spacer,
            content,
            copyItems
        };

        let apply = () => {
            if (state.disposed || !container.html) return;
            let node = container.html;
            let total = state.items.length;
            let viewport = node.clientHeight || 0;
            let scrollTop = node.scrollTop || 0;
            spacer.setStyle('height', `${total * rowHeight}px`);
            let firstVisible = total ? Math.min(Math.floor(scrollTop / rowHeight), total - 1) : 0;
            let start = total ? Math.max(0, firstVisible - overscan) : 0;
            let end = total
                ? Math.min(total, firstVisible + Math.ceil(viewport / rowHeight) + overscan + 1)
                : 0;

            let needed = new Map();
            for (let index = start; index < end; index++) needed.set(keyFor(state.items[index], index), index);
            let ordered = [];
            let added = [];
            let release = key => {
                let row = state.rows.get(key);
                state.rows.delete(key);
                try { row.dispose?.(); } finally { row.root.dispose(); }
            };
            // Build first so a failing render can be rolled back with the old rows intact.
            try {
                needed.forEach((index, key) => {
                    let item = state.items[index];
                    let row = state.rows.get(key);
                    if (!row) {
                        let produced = options.render(item, index);
                        row = produced instanceof DomElement ? { root: produced } : produced;
                        if (!row || !(row.root instanceof DomElement)) {
                            throw new TypeError('DomSculptor.virtualList: render must return a DomElement or a row object.');
                        }
                        row.root.setStyle('height', `${rowHeight}px`);
                        if (aria) row.root.attribute.set('role', 'listitem');
                        state.rows.set(key, row);
                        added.push(key);
                        content.child.append(row.root);
                    } else {
                        row.update?.(item, index);
                    }
                    if (aria) {
                        row.root.attribute.set({ 'aria-posinset': index + 1, 'aria-setsize': total });
                    }
                    ordered.push(row.root);
                });
            } catch (error) {
                added.forEach(release);
                throw error;
            }
            state.rows.forEach((row, key) => {
                if (!needed.has(key)) release(key);
            });

            // Reorder in place so scrolling upward keeps rows in index order.
            ordered.forEach((row, position) => {
                let existing = content.html.childNodes[position];
                if (existing === row.html) return;
                if (existing) content.html.insertBefore(row.html, existing);
                else content.html.appendChild(row.html);
            });

            content.setStyle('transform', `translateY(${start * rowHeight}px)`);
            state.start = start;
            state.end = end;
        };

        let schedule = () => {
            if (state.disposed || state.pendingFrame != null) return;
            this._activeVirtualRenders++;
            this._updateRenderingStatus();
            let frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : setTimeout;
            state.pendingFrame = frame(() => {
                state.pendingFrame = null;
                try { apply(); } finally {
                    this._activeVirtualRenders--;
                    this._updateRenderingStatus();
                }
            });
        };

        container.html.addEventListener('scroll', schedule);
        let observer = null;
        let resizing = false;
        if (typeof ResizeObserver === 'function') {
            observer = new ResizeObserver(schedule);
            observer.observe(container.html);
        } else if (typeof window !== 'undefined' && window.addEventListener) {
            resizing = true;
            window.addEventListener('resize', schedule);
        }

        state.apply = apply;
        state.teardown = () => {
            container.html?.removeEventListener('scroll', schedule);
            observer?.disconnect();
            if (resizing) window.removeEventListener('resize', schedule);
            if (state.pendingFrame != null && typeof cancelAnimationFrame === 'function') {
                cancelAnimationFrame(state.pendingFrame);
            }
            if (state.pendingFrame != null) {
                state.pendingFrame = null;
                this._activeVirtualRenders--;
                this._updateRenderingStatus();
            }
        };
        this._virtualLists.set(container.html, state);
        container.onDispose(() => this.disposeVirtualList(container));
        container.child.append(spacer);
        apply();
        return container;
    }

    updateVirtualList(container, nextItems) {
        let state = this._virtualLists.get(container?.html);
        if (!state || state.disposed) {
            throw new Error('DomSculptor.updateVirtualList: container is not virtualized.');
        }
        state.items = state.copyItems(nextItems);
        let node = container.html;
        let maxScroll = Math.max(0, state.items.length * state.rowHeight - (node.clientHeight || 0));
        // A shrunken collection must not leave the viewport scrolled past its end.
        if ((node.scrollTop || 0) > maxScroll) node.scrollTop = maxScroll;
        state.apply();
        return container;
    }

    scrollVirtualList(container, target, options = {}) {
        let state = this._virtualLists.get(container?.html);
        if (!state || state.disposed) return false;
        let index = target;
        if (target && typeof target === 'object') {
            options = target;
            index = state.items.findIndex((item, position) => Object.is(state.keyFor(item, position), target.key));
        }
        if (!Number.isInteger(index) || index < 0 || index >= state.items.length) return false;
        let node = container.html;
        let viewport = node.clientHeight || 0;
        let rowTop = index * state.rowHeight;
        let scrollTop = node.scrollTop || 0;
        let align = options.align || 'start';
        let target_ = rowTop;
        if (align === 'end') target_ = rowTop - viewport + state.rowHeight;
        else if (align === 'center') target_ = rowTop - viewport / 2 + state.rowHeight / 2;
        else if (align === 'nearest') {
            if (rowTop >= scrollTop && rowTop + state.rowHeight <= scrollTop + viewport) return true;
            target_ = rowTop < scrollTop ? rowTop : rowTop - viewport + state.rowHeight;
        }
        let maxScroll = Math.max(0, state.items.length * state.rowHeight - viewport);
        node.scrollTop = Math.max(0, Math.min(target_, maxScroll));
        state.apply();
        return true;
    }

    virtualListStatus(container) {
        let state = this._virtualLists.get(container?.html);
        if (!state) return null;
        return Object.freeze({
            rendering: state.pendingFrame != null,
            start: state.start,
            end: state.end,
            mounted: state.rows.size,
            total: state.items.length
        });
    }

    disposeVirtualList(container) {
        let state = this._virtualLists.get(container?.html);
        if (!state || state.disposed) return container;
        state.disposed = true;
        state.teardown();
        this._virtualLists.delete(container.html);
        state.rows.forEach(row => {
            try { row.dispose?.(); } finally { row.root.dispose(); }
        });
        state.rows.clear();
        state.items = [];
        state.content.dispose();
        state.spacer.dispose();
        return container;
    }

    wrap(selectorOrNode) {
        // Strict wrapping reports invalid selectors; tryWrap provides the nullable form.
        let node;
        if (typeof selectorOrNode === 'string') {
            node = document.querySelector(selectorOrNode);
            if (!node) throw new Error(`DomSculptor.wrap: could not find "${selectorOrNode}".`);
        } else if (isNode(selectorOrNode)) {
            node = selectorOrNode;
        } else {
            throw new TypeError('DomSculptor.wrap: expected a selector or Node.');
        }
        return this._wrapNode(node);
    }

    tryWrap(selectorOrNode) {
        try {
            return this.wrap(selectorOrNode);
        } catch {
            return null;
        }
    }

    state(initial) {
        // Signals deliver nested writes in order and remain synchronous at their core.
        let sculptor = this;
        let value = initial;
        let subscribers = [];
        let disposed = false;
        let notifying = false;
        let pendingNotifications = [];

        let autoUnsub = (element, unsub) => {
            // DOM bindings cannot outlive the element that owns their subscription.
            element.onRemove(unsub);
            element._own(unsub);
        };

        let store = {
            get() {
                activeTracker?.(store);
                return value;
            },
            set(next) {
                if (disposed) throw new Error('DomSculptor: cannot write to a disposed signal.');
                if (sculptor._disposalDepth) {
                    sculptor._warn('write-during-disposal', 'A signal was written while a scope was disposing.');
                }
                if (Object.is(value, next)) return;
                value = next;
                let errors = [];
                // Queue nested writes so every subscriber sees the same value order.
                pendingNotifications.push(next);
                if (notifying) return;
                notifying = true;
                try {
                    while (pendingNotifications.length) {
                        let delivered = pendingNotifications.shift();
                        subscribers.slice().forEach(subscription => {
                            try { subscription.callback(delivered); } catch (error) { errors.push(error); }
                        });
                    }
                } finally {
                    notifying = false;
                }
                throwCollectedErrors(errors, 'Multiple signal subscribers failed.');
            },
            update(fn) {
                if (typeof fn !== 'function') throw new TypeError('DomSculptor.signal.update: expected a function.');
                store.set(fn(value));
            },
            subscribe(fn, options = {}) {
                if (disposed) throw new Error('DomSculptor: cannot subscribe to a disposed signal.');
                if (typeof fn !== 'function') throw new TypeError('DomSculptor.signal.subscribe: expected a function.');
                if (options.signal?.aborted) return () => {};
                let subscription = { callback: fn, active: true };
                subscribers.push(subscription);
                let unsubscribe = () => {
                    if (!subscription.active) return;
                    subscription.active = false;
                    let i = subscribers.indexOf(subscription);
                    if (i > -1) subscribers.splice(i, 1);
                    options.signal?.removeEventListener('abort', unsubscribe);
                };
                subscription.unsubscribe = unsubscribe;
                options.signal?.addEventListener('abort', unsubscribe, { once: true });
                if (options.immediate) fn(value);
                return unsubscribe;
            },
            bind(element, updater = null) {
                if (!(element instanceof DomElement)) throw new TypeError('DomSculptor.signal.bind: expected a DomElement.');
                if (updater == null || (typeof updater === 'object' && !Array.isArray(updater))) {
                    return store.sync(element, updater || {});
                }
                if (typeof updater !== 'function') {
                    throw new TypeError('DomSculptor.signal.bind: expected an updater function or binding options.');
                }
                updater(value, element);
                let active = true;
                let render = () => { if (active && element.html) updater(store.get(), element); };
                let unsub = store.subscribe(() => sculptor._schedule(render));
                let cleanup = () => { active = false; unsub(); sculptor._scheduledJobs.delete(render); };
                autoUnsub(element, cleanup);
                return element;
            },
            bindText(element, transform = v => v) {
                if (!(element instanceof DomElement) || !element.html) {
                    throw new TypeError('DomSculptor.signal.bindText: expected a live DomElement.');
                }
                if (typeof transform !== 'function') {
                    throw new TypeError('DomSculptor.signal.bindText: transform must be a function.');
                }
                let initial = String(transform(value) ?? '');
                element.setText(initial);
                // Update one text node instead of replacing unrelated DOM on every write.
                let textNode = element.html.firstChild;
                if (!textNode || textNode.nodeType !== 3) {
                    textNode = document.createTextNode(initial);
                    element.html.textContent = '';
                    element.html.appendChild(textNode);
                }
                let render = () => { textNode.textContent = String(transform(store.get()) ?? ''); };
                let unsubscribe = store.subscribe(() => sculptor._schedule(render));
                let cleanup = () => {
                    sculptor._scheduledJobs.delete(render);
                    unsubscribe();
                };
                autoUnsub(element, cleanup);
                return element;
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
            bindHidden(element, transform = v => Boolean(v)) {
                return store.bindProperty(element, 'hidden', transform);
            },
            bindProperty(element, name, transform = v => v) {
                if (typeof name !== 'string' || !name) {
                    throw new TypeError('DomSculptor.signal.bindProperty: expected a property name.');
                }
                return store.bind(element, v => {
                    if (!element.html) return;
                    element.html[name] = transform(v);
                });
            },
            list(container, renderFn) {
                if (!(container instanceof DomElement)) {
                    throw new TypeError('DomSculptor.signal.list: expected a DomElement container.');
                }
                if (renderFn && typeof renderFn === 'object') {
                    // Keyed lists preserve element identity across inserts and reorders.
                    let options = renderFn;
                    if (typeof options.key !== 'function' || typeof options.render !== 'function') {
                        throw new TypeError('DomSculptor.signal.list: keyed lists require key and render functions.');
                    }
                    if (options.update != null && typeof options.update !== 'function') {
                        throw new TypeError('DomSculptor.signal.list: update must be a function.');
                    }
                    let records = new Map();
                    let keysFor = items => {
                        if (!Array.isArray(items)) throw new TypeError('DomSculptor.signal.list: expected an array value.');
                        let keys = items.map((item, index) => options.key(item, index));
                        if (new Set(keys).size !== keys.length) {
                            sculptor._warn('duplicate-list-key', 'A keyed list update contained duplicate keys.', keys);
                            throw new TypeError('DomSculptor.signal.list: duplicate keys are not allowed.');
                        }
                        return keys;
                    };
                    let renderKeyed = items => {
                        let keys = keysFor(items);
                        let ownerDocument = container.html.ownerDocument ||
                            (typeof document !== 'undefined' ? document : null);
                        // Preserve focus and selection while keyed rows move in the DOM.
                        let focused = ownerDocument?.activeElement || null;
                        let selection = focused && typeof focused.selectionStart === 'number'
                            ? {
                                start: focused.selectionStart,
                                end: focused.selectionEnd,
                                direction: focused.selectionDirection
                            }
                            : null;

                        let errors = [];
                        let nextRecords = new Map();
                        items.forEach((item, index) => {
                            let key = keys[index];
                            let record = records.get(key);
                            try {
                                if (record) {
                                    options.update?.(record.element, item, index);
                                    record.item = item;
                                } else {
                                    let element = options.render(item, index);
                                    if (!(element instanceof DomElement) || !element.html) {
                                        throw new TypeError('DomSculptor.signal.list: render must return a live DomElement.');
                                    }
                                    record = { element, item };
                                }
                                nextRecords.set(key, record);
                            } catch (error) {
                                errors.push(error);
                                if (record) nextRecords.set(key, record);
                            }
                        });

                        records.forEach((record, key) => {
                            if (nextRecords.has(key)) return;
                            try { record.element.remove(); } catch (error) { errors.push(error); }
                        });

                        let ordered = Array.from(nextRecords.values(), record => record.element);
                        ordered.forEach((element, index) => {
                            if (!element.html) return;
                            let reference = container.html.childNodes[index] || null;
                            if (reference !== element.html) container.html.insertBefore(element.html, reference);
                            element._detachFromParent();
                            element._parent = container;
                            element._notifyMount();
                        });
                        container._children = ordered.filter(element => element.html);
                        records = nextRecords;
                        if (focused?.isConnected && ownerDocument?.activeElement !== focused &&
                            typeof focused.focus === 'function') {
                            try {
                                focused.focus({ preventScroll: true });
                                if (selection && typeof focused.setSelectionRange === 'function') {
                                    focused.setSelectionRange(
                                        selection.start,
                                        selection.end,
                                        selection.direction || undefined
                                    );
                                }
                            } catch (error) {
                                errors.push(error);
                            }
                        }
                        throwCollectedErrors(errors, 'Multiple keyed list operations failed.');
                    };
                    renderKeyed(value);
                    let renderLatest = () => renderKeyed(store.get());
                    let unsubscribe = store.subscribe(items => {
                        keysFor(items);
                        sculptor._schedule(renderLatest);
                    });
                    let cleanup = () => {
                        sculptor._scheduledJobs.delete(renderLatest);
                        unsubscribe();
                    };
                    autoUnsub(container, cleanup);
                    return container;
                }
                if (typeof renderFn !== 'function') {
                    throw new TypeError('DomSculptor.signal.list: expected a render function.');
                }
                let elements = [];
                // The simple list form replaces all rows when stable keys are unavailable.
                let render = (items) => {
                    let firstError = null;
                    elements.forEach(el => {
                        try { el.remove(); } catch (error) { if (!firstError) firstError = error; }
                    });
                    container._children = container._children.filter(c => c.html !== null);
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
            sync(element, options = {}) {
                // Two-way form bindings normalize native control differences in one path.
                if (!(element instanceof DomElement) || !element.html) {
                    throw new TypeError('DomSculptor.signal.sync: expected a live DomElement.');
                }
                if (typeof options === 'function') options = { parse: options };
                if (!options || typeof options !== 'object') {
                    throw new TypeError('DomSculptor.signal.sync: options must be a function or object.');
                }
                let node = element.html;
                let tagName = String(node.tagName || '').toLowerCase();
                let type = String(node.type || '').toLowerCase();
                if (!['input', 'textarea', 'select'].includes(tagName) &&
                    typeof options.get !== 'function' && typeof options.set !== 'function' &&
                    !('value' in node)) {
                    sculptor._warn(
                        'incompatible-input-binding',
                        'Two-way binding was attached to an element without a value property.',
                        node
                    );
                }
                // IME composition must finish before input is written back to the signal.
                let composing = false;
                let read = () => {
                    if (typeof options.get === 'function') return options.get(node);
                    if (tagName === 'select' && (node.multiple || options.multiple)) {
                        return Array.from(node.selectedOptions || [], option => option.value);
                    }
                    if (type === 'checkbox') {
                        if (Array.isArray(store.get()) || options.group) {
                            let current = Array.isArray(store.get()) ? store.get() : [];
                            return node.checked
                                ? Array.from(new Set([...current, node.value]))
                                : current.filter(item => !Object.is(String(item), String(node.value)));
                        }
                        return Boolean(node.checked);
                    }
                    if (type === 'radio') return node.checked ? node.value : store.get();
                    if ((type === 'number' || type === 'range') && options.parse == null) {
                        return node.value === '' ? null : Number(node.value);
                    }
                    let next = node.value;
                    return typeof options.parse === 'function' ? options.parse(next, node) : next;
                };
                let write = next => {
                    if (typeof options.set === 'function') {
                        options.set(node, next);
                        return;
                    }
                    if (tagName === 'select' && (node.multiple || options.multiple)) {
                        let selected = new Set(Array.isArray(next) ? next.map(String) : []);
                        Array.from(node.options || []).forEach(option => {
                            option.selected = selected.has(String(option.value));
                        });
                        return;
                    }
                    if (type === 'checkbox') {
                        let checked = Array.isArray(next)
                            ? next.some(item => Object.is(String(item), String(node.value)))
                            : Boolean(next);
                        if (node.checked !== checked) node.checked = checked;
                        return;
                    }
                    if (type === 'radio') {
                        let checked = Object.is(String(next), String(node.value));
                        if (node.checked !== checked) node.checked = checked;
                        return;
                    }
                    let desired = next == null ? '' : String(next);
                    if (node.value !== desired) node.value = desired;
                };
                write(value);
                let updateFromElement = () => {
                    if (!composing) store.set(read());
                };
                let eventName = options.event ||
                    (type === 'checkbox' || type === 'radio' || tagName === 'select' ? 'change' : 'input');
                element.on(eventName, updateFromElement);
                element.on('compositionstart', () => { composing = true; });
                element.on('compositionend', () => {
                    composing = false;
                    updateFromElement();
                });
                let render = () => {
                    if (!composing && element.html) write(store.get());
                };
                let unsub = store.subscribe(() => sculptor._schedule(render));
                let cleanup = () => {
                    unsub();
                    sculptor._scheduledJobs.delete(render);
                };
                autoUnsub(element, cleanup);
                return element;
            },
            dispose() {
                if (disposed) return;
                untrack();
                if (subscribers.length) {
                    sculptor._warn(
                        'subscription-cleanup',
                        `Disposed a signal with ${subscribers.length} active subscription(s).`
                    );
                }
                disposed = true;
                subscribers.slice().forEach(subscription => subscription.unsubscribe());
                pendingNotifications = [];
            },
            get disposed() {
                return disposed;
            }
        };
        let untrack = this._track(() => store.dispose());
        return store;
    }

    signal(initial) {
        return this.state(initial);
    }

    computed(compute, dependencies = null) {
        // Computed values are lazy until first read and then cache dependency updates.
        if (typeof compute !== 'function') throw new TypeError('DomSculptor.computed: expected a function.');
        // Omitting the list tracks reads automatically; passing one pins the dependencies.
        let explicit = dependencies != null;
        if (explicit) {
            if (!Array.isArray(dependencies)) {
                throw new TypeError('DomSculptor.computed: dependencies must be an array.');
            }
            dependencies.forEach(dependency => {
                if (!dependency || typeof dependency.subscribe !== 'function') {
                    throw new TypeError('DomSculptor.computed: every dependency must be a signal.');
                }
            });
        }

        let output = this.state(undefined);
        let initialized = false;
        let evaluating = false;
        let disposed = false;
        let tracked = explicit ? null : createTrackedRun(() => {
            if (initialized) evaluate();
        });
        let evaluate = () => {
            if (disposed) throw new Error('DomSculptor: cannot read a disposed computed signal.');
            if (evaluating) throw new Error('DomSculptor.computed: cycle detected.');
            evaluating = true;
            try {
                let next = explicit ? compute() : tracked.run(compute);
                if (!initialized || !Object.is(output.get(), next)) {
                    initialized = true;
                    output.set(next);
                }
                return output.get();
            } finally {
                evaluating = false;
            }
        };
        let unsubscribers = explicit ? dependencies.map(dependency => dependency.subscribe(() => {
            if (initialized) evaluate();
        })) : [];

        let computed = {
            get() {
                if (disposed) throw new Error('DomSculptor: cannot read a disposed computed signal.');
                return initialized ? output.get() : evaluate();
            },
            subscribe(callback, options = {}) {
                if (!initialized) evaluate();
                return output.subscribe(callback, options);
            },
            dispose() {
                if (disposed) return;
                disposed = true;
                untrack();
                unsubscribers.forEach(unsubscribe => unsubscribe());
                tracked?.stop();
                output.dispose();
            },
            get disposed() { return disposed; }
        };
        let untrack = this._track(() => computed.dispose());
        return computed;
    }

    effect(run, dependencies = null) {
        // Effect cleanup runs before reruns and once more when the effect stops.
        if (typeof run !== 'function') throw new TypeError('DomSculptor.effect: expected a function.');
        // Omitting the list tracks reads automatically; passing one pins the dependencies.
        let explicit = dependencies != null;
        if (explicit) {
            if (!Array.isArray(dependencies)) {
                throw new TypeError('DomSculptor.effect: dependencies must be an array.');
            }
            dependencies.forEach(dependency => {
                if (!dependency || typeof dependency.subscribe !== 'function') {
                    throw new TypeError('DomSculptor.effect: every dependency must be a signal.');
                }
            });
        }
        let active = true;
        let cleanup = null;
        let tracked = explicit ? null : createTrackedRun(() => this._schedule(execute));
        let execute = () => {
            if (!active) return;
            if (cleanup) {
                let previousCleanup = cleanup;
                cleanup = null;
                previousCleanup();
            }
            let nextCleanup = explicit ? run() : tracked.run(run);
            if (nextCleanup != null && typeof nextCleanup !== 'function') {
                throw new TypeError('DomSculptor.effect: cleanup must be a function.');
            }
            cleanup = nextCleanup || null;
        };
        let unsubscribers = explicit
            ? dependencies.map(dependency => dependency.subscribe(() => this._schedule(execute)))
            : [];
        execute();
        let stop = () => {
            if (!active) return;
            active = false;
            this._scheduledJobs.delete(execute);
            untrack();
            unsubscribers.forEach(unsubscribe => unsubscribe());
            tracked?.stop();
            if (cleanup) {
                let finalCleanup = cleanup;
                cleanup = null;
                finalCleanup();
            }
        };
        let untrack = this._track(stop);
        return stop;
    }

    batch(callback) {
        // Nested batches defer scheduler flushing until the outermost batch completes.
        if (typeof callback !== 'function') throw new TypeError('DomSculptor.batch: expected a function.');
        this._batchDepth++;
        try { return callback(); }
        finally {
            this._batchDepth--;
            this._requestFlush();
        }
    }

    flush() {
        return this._flushJobs();
    }

    asyncState(initialData = null) {
        // Run identifiers prevent stale async completions from replacing newer state.
        let state = this.state({ status: 'idle', data: initialData, error: null });
        let lastTask = null;
        let runId = 0;
        let controller = null;

        let api = {
            get: state.get,
            subscribe: state.subscribe,
            run(task = lastTask, options = {}) {
                if (typeof task !== 'function' && !(task && typeof task.then === 'function')) {
                    return Promise.reject(new TypeError('DomSculptor.asyncState.run: expected a function or Promise.'));
                }
                lastTask = task;
                let currentRun = ++runId;
                let current = state.get();
                if (options.abortPrevious !== false) controller?.abort();
                let currentController = new AbortController();
                controller = currentController;
                state.set({
                    status: current.data == null ? 'loading' : 'refreshing',
                    data: current.data,
                    error: null
                });

                return Promise.resolve()
                    .then(() => typeof task === 'function' ? task({ signal: currentController.signal }) : task)
                    .then(data => {
                        if (currentRun === runId) state.set({ status: 'success', data, error: null });
                        return data;
                    })
                    .catch(error => {
                        if (currentRun === runId && error?.name !== 'AbortError') {
                            state.set({ status: 'error', data: state.get().data, error });
                        }
                        throw error;
                    });
            },
            retry() { return api.run(lastTask); },
            cancel() {
                runId++;
                controller?.abort();
                controller = null;
                let current = state.get();
                state.set({
                    status: current.data == null ? 'idle' : 'success',
                    data: current.data,
                    error: null
                });
            },
            reset() {
                runId++;
                controller?.abort();
                controller = null;
                state.set({ status: 'idle', data: initialData, error: null });
            }
        };

        this._track(() => {
            if (!state.disposed) api.cancel();
            state.dispose();
        });
        return api;
    }

    data(initial = {}) {
        // Object stores compose one signal per key with keyed and global subscriptions.
        let sculptor = this;
        if (typeof initial !== 'object' || initial === null || Array.isArray(initial)) {
            throw new TypeError('DomSculptor.data: initial value must be an object.');
        }
        let signals = new Map();
        Object.keys(initial).forEach(key => signals.set(key, sculptor.state(initial[key])));
        let keyListeners = new Map();
        let anyListeners = [];
        let disposed = false;

        // Deleted keys retire their signal so listeners survive a later re-set.
        let retired = new Map();

        let ensureSignal = key => {
            if (!signals.has(key)) signals.set(key, retired.get(key) ?? sculptor.state(undefined));
            retired.delete(key);
            return signals.get(key);
        };

        let api = {
            get(key = null) {
                if (key == null) {
                    return Object.fromEntries(Array.from(signals, ([name, signal]) => [name, signal.get()]));
                }
                return signals.get(key)?.get();
            },
            set(key, value) {
                if (disposed) throw new Error('DomSculptor: cannot write to a disposed data store.');
                if (sculptor._disposalDepth) {
                    sculptor._warn('write-during-disposal', 'A data store was written while a scope was disposing.');
                }
                if (typeof key === 'object' && key !== null) {
                    let errors = [];
                    for (let name in key) {
                        if (!Object.hasOwnProperty.call(key, name)) continue;
                        try { api.set(name, key[name]); } catch (error) { errors.push(error); }
                    }
                    throwCollectedErrors(errors, 'Multiple data store updates failed.');
                    return api;
                }

                if (typeof key !== 'string') {
                    throw new TypeError('DomSculptor.data.set: key must be a string.');
                }

                let signal = ensureSignal(key);
                let previous = signal.get();
                if (Object.is(previous, value)) return api;

                let errors = [];
                try { signal.set(value); } catch (error) { errors.push(error); }
                anyListeners.slice().forEach(listener => {
                    try { listener.callback(key, value, previous); } catch (error) { errors.push(error); }
                });
                throwCollectedErrors(errors, 'Multiple data store subscribers failed.');
                return api;
            },
            update(key, fn) {
                if (typeof fn !== 'function') {
                    throw new TypeError('DomSculptor.data.update: updater must be a function.');
                }
                return api.set(key, fn(api.get(key), key));
            },
            has(key) {
                return signals.has(key);
            },
            delete(key) {
                if (disposed) throw new Error('DomSculptor: cannot write to a disposed data store.');
                if (!signals.has(key)) return false;
                // Observers see the value disappear before the key leaves the store.
                api.set(key, undefined);
                retired.set(key, signals.get(key));
                return signals.delete(key);
            },
            signal(key) {
                if (typeof key !== 'string') {
                    throw new TypeError('DomSculptor.data.signal: key must be a string.');
                }
                return ensureSignal(key);
            },
            onChange(key, callback, options = {}) {
                if (disposed) throw new Error('DomSculptor: cannot subscribe to a disposed data store.');
                if (typeof key !== 'string' || typeof callback !== 'function') {
                    throw new TypeError('DomSculptor.data.onChange: expected a string key and callback function.');
                }
                if (options.signal?.aborted) return () => {};

                let signal = ensureSignal(key);
                let previous = signal.get();
                let record = { callback, active: true, unsubscribeSignal: null };
                let wrapped = next => {
                    let prior = previous;
                    previous = next;
                    callback(next, prior, key);
                };
                record.unsubscribeSignal = signal.subscribe(wrapped);
                if (!keyListeners.has(key)) keyListeners.set(key, []);
                keyListeners.get(key).push(record);
                let unsubscribe = () => {
                    if (!record.active) return;
                    record.active = false;
                    record.unsubscribeSignal();
                    let remaining = (keyListeners.get(key) || []).filter(item => item !== record);
                    if (remaining.length) keyListeners.set(key, remaining);
                    else keyListeners.delete(key);
                    options.signal?.removeEventListener('abort', unsubscribe);
                };
                record.unsubscribe = unsubscribe;
                options.signal?.addEventListener('abort', unsubscribe, { once: true });

                if (options.immediate) callback(signal.get(), undefined, key);

                return unsubscribe;
            },
            offChange(key, callback = null) {
                let records = keyListeners.get(key) || [];
                records.slice().forEach(record => {
                    if (callback == null || record.callback === callback) record.unsubscribe();
                });
                return api;
            },
            onAnyChange(callback, options = {}) {
                if (disposed) throw new Error('DomSculptor: cannot subscribe to a disposed data store.');
                if (typeof callback !== 'function') {
                    throw new TypeError('DomSculptor.data.onAnyChange: callback must be a function.');
                }
                if (options.signal?.aborted) return () => {};

                let record = { callback, active: true };
                anyListeners.push(record);

                if (options.immediate) {
                    signals.forEach((signal, key) => callback(key, signal.get(), undefined));
                }

                let unsubscribe = () => {
                    if (!record.active) return;
                    record.active = false;
                    let i = anyListeners.indexOf(record);
                    if (i > -1) anyListeners.splice(i, 1);
                    options.signal?.removeEventListener('abort', unsubscribe);
                };
                record.unsubscribe = unsubscribe;
                options.signal?.addEventListener('abort', unsubscribe, { once: true });
                return unsubscribe;
            },
            dispose() {
                if (disposed) return;
                untrack();
                let listenerCount = anyListeners.length;
                keyListeners.forEach(records => { listenerCount += records.length; });
                if (listenerCount) {
                    sculptor._warn(
                        'subscription-cleanup',
                        `Disposed a data store with ${listenerCount} active subscription(s).`
                    );
                }
                disposed = true;
                keyListeners.forEach(records => records.slice().forEach(record => record.unsubscribe()));
                keyListeners.clear();
                anyListeners.slice().forEach(record => record.unsubscribe());
                signals.forEach(signal => signal.dispose());
                retired.forEach(signal => signal.dispose());
                retired.clear();
            },
            get disposed() {
                return disposed;
            }
        };

        let untrack = this._track(() => api.dispose());
        return api;
    }

    store(initial = {}) {
        return this.data(initial);
    }
}

// Development mode adds diagnostics while preserving production runtime behavior.
class DevDomSculptor extends DomSculptor {
    constructor(options = {}) {
        super({ ...options, development: true });
    }

    reportLeaks() {
        this._activeComponents.forEach(component => {
            this._warn(
                'component-scope-leak',
                `Component "${component.name}" still has an active scope. Dispose it when it is no longer needed.`,
                { component, name: component.name, createdAt: component.createdAt }
            );
        });
        return this._activeComponents.size;
    }
}

// The test harness owns a fixture root, components, warnings, and deterministic cleanup.
let createTestHarness = (parent = document.body, options = {}) => {
    let warnings = [];
    let onWarning = options.onWarning;
    let sculptor = new DevDomSculptor({
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
            if (errors.length) {
                throw new AggregateError(errors, 'DOMSculptor testing: multiple fixture cleanups failed.');
            }
        },
        get disposed() {
            return disposed;
        }
    };
    return harness;
};

// Lazy components expose loading state and abort unresolved work when disposed.
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

        // Fallback values accept the same wrapper, component, node, text, or tree shapes.
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

// Convenience exports share one default runtime; class instances remain isolated.
let defaultSculptor = new DomSculptor();
let signal = initial => defaultSculptor.signal(initial);
let state = initial => defaultSculptor.state(initial);
let store = (initial = {}) => defaultSculptor.store(initial);
let data = (initial = {}) => defaultSculptor.data(initial);
let computed = (compute, dependencies = []) => defaultSculptor.computed(compute, dependencies);
let effect = (run, dependencies = []) => defaultSculptor.effect(run, dependencies);
let batch = callback => defaultSculptor.batch(callback);
let flush = () => defaultSculptor.flush();
let tree = config => defaultSculptor.tree(config);
let when = (condition, branch, options = {}) => defaultSculptor.when(condition, branch, options);
let mount = (value, parent) => defaultSculptor.mount(value, parent);
let unmount = value => defaultSculptor.unmount(value);
let asyncState = initialData => defaultSculptor.asyncState(initialData);
let createDevSculptor = options => new DevDomSculptor(options);
let errorBoundary = (componentFactory, fallback) =>
    defaultSculptor.errorBoundary(componentFactory, fallback);

export {
    DomElement,
    DevDomSculptor,
    signal,
    state,
    store,
    data,
    computed,
    effect,
    batch,
    flush,
    tree,
    when,
    mount,
    unmount,
    asyncState,
    errorBoundary,
    createDevSculptor,
    createTestHarness,
    createLazyComponent
};
export default DomSculptor;
