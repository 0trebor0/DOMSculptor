class DomElement {
    constructor(tagName, sculptor) {
        this.html = document.createElement(tagName);
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
            create(name, opts = null) { return sculptor.create(name, el, opts); },
            remove() { el.remove(); }
        };
    }

    setText(text) { this.html.textContent = text; return this; }

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
