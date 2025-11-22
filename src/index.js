class DomSculptor {

    // The create method is an instance method of the DomSculptor class
    create(name, parent = null, callback = null) {

        // Create the core object that will hold the element and methods
        let ele = {
            html:document.createElement(name),
            children:[],
            _listeners:{},
            attribute:{
                set: (name, value = '') => {
                    if (typeof name === 'object' && name !== null) {
                        for (let key in name) {
                            if (Object.hasOwnProperty.call(name, key)) {
                                ele.html.setAttribute(key, name[key]);
                            }
                        }
                    } else if (typeof name === 'string') {
                        ele.html.setAttribute(name, value);
                    } else {
                        console.warn('DomSculptor: attribute.set received invalid name type.', name);
                    }
                    return ele;
                },
                remove: (name) => {
                    ele.html.removeAttribute(name);
                    return ele;
                },
                get: (name) => {
                    return ele.html.getAttribute(name);
                },
                has: (name) => {
                    return ele.html.hasAttribute(name);
                }
            },
            setText:(text)=>{
                ele.html.textContent = text;
                return ele;
            },
            setStyle:(property, value) => {
                if (typeof property === 'string' && value !== undefined) {
                    ele.html.style[property] = value;
                } else {
                    console.warn('DomSculptor: setStyle received invalid arguments.', property, value);
                }
                return ele;
           },
           hide:() =>{
                ele.setStyle('display', 'none');
           },
           show:()=>{
                ele.setStyle('display', '')
           },
           child:{
                append: (child) => {
                    if (child && child.html && child.html instanceof Node) {
                        ele.html.appendChild(child.html);
                        ele.children.push(child);
                    } else if (child instanceof Node) {
                        ele.html.appendChild(child);
                    } else if (typeof child === 'string') {
                        ele.html.appendChild(document.createTextNode(child));
                    } else {
                        console.warn('DomSculptor: child.append received invalid child type.', child);
                    }
                    return ele;
                },
                create: (name, callbackOrOptions = null) => {
                    let childEle = this.create(name, ele, callbackOrOptions);
                    return childEle;
                },
                remove: () => { ele.remove(); }
            },
            class:{
                add: (...values) => {
                    if (values.length > 0) { ele.html.classList.add(...values); }
                    return ele;
                },
                remove: (...values) => {
                     if (values.length > 0) { ele.html.classList.remove(...values); }
                    return ele;
                },
                contains: (value) => {
                    return ele.html.classList.contains(value);
                }
            },
            on:(event, callback) => {
                if (typeof event === 'object' && event !== null) {
                     for (let key in event) {
                          if (Object.hasOwnProperty.call(event, key) && typeof event[key] === 'function') {
                              ele.on(key, event[key]);
                          }
                     }
                     return ele;
                 } else if (typeof event === 'string' && typeof callback === 'function') {
                     ele.html.addEventListener(event, callback);
                     if (!ele._listeners[event]) { ele._listeners[event] = []; }
                     ele._listeners[event].push(callback);
                 } else {
                      console.warn(`DomSculptor: Invalid arguments for .on('${event}', ${callback})`);
                 }
                 return ele;
            },
            off:(event, callback = null) => {
                if (!ele._listeners[event]) {
                   if (callback) { ele.html.removeEventListener(event, callback); }
                   return ele;
                }
                if (callback) {
                    ele.html.removeEventListener(event, callback);
                    ele._listeners[event] = ele._listeners[event].filter(cb => cb !== callback);
                    if (ele._listeners[event].length === 0) { delete ele._listeners[event]; }
                } else {
                    ele._listeners[event].forEach(cb => { ele.html.removeEventListener(event, cb); });
                    delete ele._listeners[event];
                }
               return ele;
            },
            remove:() => {
                for (let eventType in ele._listeners) {
                     if (Object.hasOwnProperty.call(ele._listeners, eventType)) {
                          ele._listeners[eventType].forEach(callback => {
                              ele.html.removeEventListener(eventType, callback);
                          });
                     }
                 }
                 ele._listeners = {};
    
                ele.children.forEach(child => {
                     if (child && child.remove && typeof child.remove === 'function') { child.remove(); }
                });
                ele.children = [];
    
                if (ele.html && ele.html.parentNode) {
                    ele.html.parentNode.removeChild(ele.html);
                }
                ele.html = null; // Clean up reference
            }
        }

        // --- Parent Appending Logic ---
        let parentNode = null;

        if (parent == null) { parentNode = document.body; }
        else if (parent && typeof parent === 'object' && 'html' in parent && parent.html instanceof Node) {
             parentNode = parent.html;
             if (parent.children && Array.isArray(parent.children)) { parent.children.push(ele); } else { parent.children = [ele]; }
        }
        else if (parent instanceof Node) { parentNode = parent; }
        else if (typeof parent === 'string') {
             parentNode = document.querySelector(parent);
             if (!parentNode) { console.warn(`DomSculptor.create: Could not find parent element with selector: "${parent}". Element not appended.`); }
        } else { console.warn('DomSculptor.create: Invalid parent type provided. Element not appended.', parent); }

        if (parentNode) { parentNode.appendChild(ele.html); }

        // Execute the optional callback function, passing the created element object
        if (typeof callback == 'function') { callback(ele); }

        return ele;
    }
    jsontohtml(config) {
        if (typeof config !== 'object' || config === null) {
            throw new Error('DomSculptor.jsontohtml: Configuration must be a valid object.');
        }
        if (!config.type) throw new Error('DomSculptor.jsontohtml: Must specify "type".');
        if (!config.parent) throw new Error('DomSculptor.jsontohtml: Must specify "parent".');
    
        // Create the element
        let element = this.create(config.type, config.parent);
    
        // Apply attributes
        if (config.attributes && typeof config.attributes === 'object') {
            element.attribute.set(config.attributes);
        }
    
        // Apply classes
        if (Array.isArray(config.classes)) {
            element.class.add(...config.classes);
        }
    
        // Apply text content
        if (typeof config.text === 'string') {
            element.setText(config.text);
        }
    
        // Optional callback
        if (typeof config.oncreate === 'function') {
            config.oncreate(element);
        }
    
        // Recursively create children
        if (Array.isArray(config.children)) {
            config.children.forEach(childConfig => {
                if (typeof childConfig === 'object' && childConfig !== null) {
                    this.jsontohtml({ ...childConfig, parent: element });
                } else if (typeof childConfig === 'string') {
                    element.child.append(childConfig);
                } else {
                    console.warn('DomSculptor.jsontohtml: Invalid child configuration.', childConfig);
                }
            });
        }
    
        return element;
    }


}
