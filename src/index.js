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
        if (!config.type) {
            throw new Error('DomSculptor.jsontohtml: Configuration must specify "type".');
        }
        // Require parent for the *root* config object, consistent with original validation
        if (config.parent === undefined) { // Check explicitly for undefined or check !('parent' in config)
             // Checking !('parent' in config) matches original
             if (!('parent' in config)) {
                throw new Error('DomSculptor.jsontohtml: Must Specify The Parent Element for the root config.');
             }
        }


        // Use the create method to make the element, passing relevant options
        // The create method handles the parent appending and the initial oncreate callback
        let element = this.create(config.type, config.parent, {
             // Pass options recognized by the improved create method
             attributes: config.attributes,
             classes: config.classes,
             styles: config.styles,
             text: config.text, // Use 'text' for simple text content
             events: config.events,
             oncreate: config.oncreate, // Pass the oncreate callback from config
             // Note: The old 'content' property is replaced by 'text' and 'children'
        });

        // Recursively build children from the 'children' array
        if (Array.isArray(config.children)) {
            config.children.forEach(childConfig => {
                if (typeof childConfig === 'object' && childConfig !== null) {
                    // If child is a config object, recursively build it
                    // Pass the current `element` as the parent for the child
                    // This recursive call handles creation and appending to 'element'
                    this.jsontohtml({ ...childConfig, parent: element });
                } else if (typeof childConfig === 'string') {
                    // If child is a string, append it as a text node
                    element.child.append(childConfig); // Use the append method
                } else {
                     console.warn('DomSculptor.jsontohtml: Invalid child configuration type. Expected object or string.', childConfig);
                }
            });
        }
         // Optional: Add backward compatibility for the original 'content' property
         // This part replicates the original logic's intent, fixing the string array issue
         else if (config.content !== undefined) {
             console.warn("DomSculptor.jsontohtml: Using deprecated 'content' property. Use 'text' for strings and 'children' for array of configs/strings.");
             if (typeof config.content === 'string') {
                  element.setText(config.content); // Use the setText method
             } else if (Array.isArray(config.content)) {
                  config.content.forEach(item => {
                       if (typeof item === 'object' && item !== null) {
                           // Recursive call, parent is the current element
                           this.jsontohtml({ ...item, parent: element });
                       } else if (typeof item === 'string') {
                           // Append string as text node (fixes original overwrite issue)
                           element.child.append(item); // Use append method
                       } else {
                           console.warn('DomSculptor.jsontohtml: Invalid item type in "content" array. Expected object or string.', item);
                       }
                  });
             } else {
                 console.warn('DomSculptor.jsontohtml: Invalid "content" type. Expected string or array.', config.content);
             }
         }


        return element; // Return the root element object
    }

}