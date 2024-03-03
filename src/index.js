class App {

    create(name, parent = null, callback = null) {

        let e = {};

        e.html = document.createElement(name);

        e.children = [];

        e.setAttribute = (name, value = '') => {

            e.html.setAttribute(name, value);

            return e;

        }

        e.removeAttribute = (name) => {

            e.html.removeAttribute(name);

            return e;

        }

        e.getAttribute = (name) => {

            e.html.getAttribute(name);

            return e;

        }

        e.hasAttribute = (name) => {

            e.html.hasAttribute(name);

            return e;

        }

        e.addClass = (value) => {

            e.html.classList.add(value);

            return e;

        }

        e.removeClass = (value) => {

            e.html.classList.remove(value);

            return e;

        }

        e.containsClass = (value) => {

            e.html.classList.contains(value);

            return e;

        }

        e.setText = (text) => {

            e.html.textContent = text;

            return e;

        }

        e.setStyle = (property, value) => {

            e.html.style[property] = value;

            return e;

        }

        e.hide = () => {

            e.setStyle('display', 'none');

            return e;

        }

        e.appendChild = (child) => {

            e.html.appendChild(child);

            return e;

        }

        e.createChild = (name, callback = null) => {

            if (typeof callback !== 'function') {
                callback = null;
            }

            return this.create(name, e, callback);

        }

        e.on = (event, callback) => {

            e.html.addEventListener(event, callback);

            return e;

        }

        e.off = (event, callback) => {

            e.html.removeEventListener(event, callback);

            return e;

        }

        if (parent == null) {

            document.body.lastChild.appendChild(e.html);

        } else if ('html' in parent) {

            parent.children.push(e);

            parent.html.appendChild(e.html);

        } else if ('nodeType' in parent && parent.nodeType === 1) {

            parent.appendChild(e.html);

        } else if (document.querySelector(parent)) {

            document.querySelector(parent).appendChild(e.html);

        }

        if (typeof callback == 'function') {

            callback(e);

        }

        return e;

    }

}
