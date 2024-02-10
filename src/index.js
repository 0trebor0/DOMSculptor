class App {

    create(name, parent = null, callback = null) {
        var e = document.createElement(name);

        var addChild = (child) => {
            if (parent instanceof HTMLElement) {
                parent.appendChild(child);
            } else if (typeof parent === 'string') {
                document.querySelector(parent)?.appendChild(child);
            } else {
                document.body.appendChild(child);
            }
        };

        var setAttributes = (attributes) => {
            for (var [name, value] of Object.entries(attributes)) {
                e.setAttribute(name, value);
            }
        };

        var addClass = (className) => {
            e.classList.add(className);
        };

        var setText = (text) => {
            e.textContent = text;
        };

        var setStyle = (styles) => {
            Object.assign(e.style, styles);
        };

        var hide = () => {
            e.style.display = 'none';
        };

        var createChild = (childName, childCallback = null) => {
            var childElement = this.create(childName, e, childCallback);
            e.appendChild(childElement);
            return childElement;
        };

        var on = (event, handler) => {
            e.addEventListener(event, handler);
        };

        var off = (event, handler) => {
            e.removeEventListener(event, handler);
        };

        if (parent) {
            addChild(e);
        }

        if (callback && typeof callback === 'function') {
            callback(e);
        }

        return {
            html: e,
            setAttribute: setAttributes,
            addClass,
            setText,
            setStyle,
            hide,
            createChild,
            on,
            off,
        };
    }
}
