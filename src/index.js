class DomSculptor {

    // The create method is an instance method of the DomSculptor class
    create(name, parent = null, callback = null) {

        // Create the core object that will hold the element and methods
        let ele = {};

        // Create the native DOM element
        ele.html = document.createElement(name);

        // Track sculpted child elements created via ele.child.create
        ele.children = [];

        // Store event listeners correctly (using an array per event type)
        // This replaces the original `ele.events = {};` which only stored the last listener
        ele._listeners = {};

        // Attribute handling object
        ele.attribute = {
            /**
             * Sets one or more attributes. Returns the element for chaining.
             * @param {string|object} name - The attribute name or an object of name-value pairs.
             * @param {string} [value] - The attribute value (only if name is a string).
             * @returns {object} The element object (ele) for chaining.
             */
            set: (name, value = '') => {
                if (typeof name === 'object' && name !== null) {
                    // Set multiple attributes from object
                    for (const key in name) {
                        if (Object.hasOwnProperty.call(name, key)) {
                            ele.html.setAttribute(key, name[key]);
                        }
                    }
                } else if (typeof name === 'string') {
                    // Set single attribute
                    ele.html.setAttribute(name, value);
                } else {
                    console.warn('DomSculptor: attribute.set received invalid name type.', name);
                }
                return ele; // Chainable
            },
            /**
             * Removes an attribute.
             * @param {string} name - The attribute name.
             * @returns {object} The element object (ele) for chaining.
             */
            remove: (name) => {
                ele.html.removeAttribute(name);
                return ele; // Chainable
            },
            /**
             * Gets an attribute value.
             * @param {string} name - The attribute name.
             * @returns {string|null} The attribute value or null if not set.
             */
            get: (name) => {
                return ele.html.getAttribute(name); // <-- Correctly return the value
            },
            /**
             * Checks if the element has a specific attribute.
             * @param {string} name - The attribute name.
             * @returns {boolean} True if the attribute exists, false otherwise.
             */
            has: (name) => {
                return ele.html.hasAttribute(name); // <-- Correctly return the boolean
            }
        };

        /**
         * Sets the text content of the element.
         * @param {string} text - The text content.
         * @returns {object} The element object (ele) for chaining.
         */
        ele.setText = (text) => {
            ele.html.textContent = text;
            return ele; // Chainable
        }

        /**
         * Sets one or more CSS styles. Returns the element for chaining.
         * @param {string|object} property - The style property name or an object of property-value pairs.
         * @param {string} [value] - The style value (only if property is a string).
         * @returns {object} The element object (ele) for chaining.
         */
        ele.setStyle = (property, value) => {
             if (typeof property === 'object' && property !== null) {
                 // Set multiple styles from object
                 for (const key in property) {
                     if (Object.hasOwnProperty.call(property, key)) {
                         ele.html.style[key] = value;
                     }
                 }
             } else if (typeof property === 'string' && value !== undefined) {
                 // Set single style
                 ele.html.style[property] = value;
             } else {
                 console.warn('DomSculptor: setStyle received invalid arguments.', property, value);
             }
             return ele; // Chainable
        }

        /**
         * Hides the element by setting its display style to 'none'.
         * @returns {object} The element object (ele) for chaining.
         */
        ele.hide = () => ele.setStyle('display', 'none');

        /**
         * Shows the element by clearing its display style.
         * Note: This resets display to the browser's default for the element type.
         * @returns {object} The element object (ele) for chaining.
         */
        ele.show = () => ele.setStyle('display', ''); // Or 'block', 'flex', etc.


        // Child handling object
        ele.child = {
            /**
             * Appends a child element or text node.
             * Handles both native DOM nodes and other sculpted element objects.
             * @param {object|Node|string} child - The sculpted element object, native DOM node, or text string to append.
             * @returns {object} The parent element object (ele) for chaining.
             */
            append: (child) => {
                if (child && child.html && child.html instanceof Node) {
                    // If it's another sculpted element object
                    ele.html.appendChild(child.html);
                    // Add it to the parent's sculpted children list
                    ele.children.push(child);
                } else if (child instanceof Node) {
                    // If it's a native DOM node
                    ele.html.appendChild(child);
                } else if (typeof child === 'string') {
                    // If it's a string, append as a text node
                    ele.html.appendChild(document.createTextNode(child));
                } else {
                    console.warn('DomSculptor: child.append received invalid child type.', child);
                }
                return ele; // Chainable
            },
            /**
             * Creates a new child element using the DomSculptor factory and appends it.
             * Returns the newly created child element object.
             * @param {string} name - The tag name of the child element.
             * @param {function|object} [callbackOrOptions=null] - Callback or options for the child.
             * @returns {object} The newly created child element object.
             */
            create: (name, callbackOrOptions = null) => {
                // Use the parent's create method (this refers to the DomSculptor instance)
                // Pass `ele` (the current element object) as the parent
                const childEle = this.create(name, ele, callbackOrOptions);
                // The main create method handles pushing childEle to ele.children
                return childEle; // Return the child object for chaining on the child
            },
            /**
             * Removes this element (redundant, same as calling ele.remove()).
             */
            remove: () => {
                // This is just a shortcut for ele.remove()
                ele.remove();
            }
        };

        // Class handling object
        ele.class = {
            /**
             * Adds one or more CSS classes.
             * @param {...string} values - The classes to add.
             * @returns {object} The element object (ele) for chaining.
             */
            add: (...values) => {
                if (values.length > 0) {
                   ele.html.classList.add(...values);
                }
                return ele; // Chainable
            },
            /**
             * Removes one or more CSS classes.
             * @param {...string} values - The classes to remove.
             * @returns {object} The element object (ele) for chaining.
             */
            remove: (...values) => {
                 if (values.length > 0) {
                    ele.html.classList.remove(...values);
                 }
                return ele; // Chainable
            },
            /**
             * Checks if the element has a specific CSS class.
             * @param {string} value - The class name to check.
             * @returns {boolean} True if the element has the class, false otherwise.
             */
            contains: (value) => {
                return ele.html.classList.contains(value); // <-- Correctly return the boolean
            }
        };

        /**
         * Adds an event listener or multiple listeners to the element.
         * Returns the element for chaining.
         * @param {string|object} event - The event type (e.g., 'click') or an object of eventType-callback pairs.
         * @param {function} [callback] - The callback function (only if event is a string).
         * @returns {object} The element object (ele) for chaining.
         */
        ele.on = (event, callback) => {
            if (typeof event === 'object' && event !== null) {
                 // Add multiple event listeners from object
                 for (const key in event) {
                      if (Object.hasOwnProperty.call(event, key) && typeof event[key] === 'function') {
                          ele.on(key, event[key]); // Recursively call for each event
                      }
                 }
                 return ele; // Chainable
             } else if (typeof event === 'string' && typeof callback === 'function') {
                 // Add single event listener
                 ele.html.addEventListener(event, callback);
                 // Store the listener reference for removal
                 if (!ele._listeners[event]) {
                     ele._listeners[event] = [];
                 }
                 ele._listeners[event].push(callback);
             } else {
                  console.warn(`DomSculptor: Invalid arguments for .on('${event}', ${callback})`);
             }
             return ele; // Chainable
        };

        /**
         * Removes an event listener or all listeners of a specific type.
         * Returns the element for chaining.
         * @param {string} event - The event type.
         * @param {function} [callback] - The specific callback function to remove. If omitted, all listeners for eventType added via .on() are removed.
         * @returns {object} The element object (ele) for chaining.
         */
        ele.off = (event, callback = null) => {
            if (!ele._listeners[event]) {
                 // No listeners of this type were added via .on()
                if (callback) {
                    // Still try to remove if a specific callback was provided (though it won't be tracked)
                    ele.html.removeEventListener(event, callback);
                }
                return ele; // Chainable
            }

            if (callback) {
                // Remove a specific listener
                ele.html.removeEventListener(event, callback);
                // Remove from stored listeners
                ele._listeners[event] = ele._listeners[event].filter(cb => cb !== callback);
                if (ele._listeners[event].length === 0) {
                    delete ele._listeners[event];
                }
            } else {
                // Remove all listeners for this event type added via .on()
                ele._listeners[event].forEach(cb => {
                    ele.html.removeEventListener(event, cb);
                });
                delete ele._listeners[event]; // Clear stored listeners
            }
           return ele; // Chainable
        };

        /**
         * Removes the element from the DOM and cleans up event listeners and child references.
         */
        ele.remove = () => {
            // Remove all registered event listeners
            for (const eventType in ele._listeners) {
                 if (Object.hasOwnProperty.call(ele._listeners, eventType)) {
                      ele._listeners[eventType].forEach(callback => {
                          ele.html.removeEventListener(eventType, callback);
                      });
                 }
             }
             ele._listeners = {}; // Clear stored listeners

            // Recursively remove sculpted children
            ele.children.forEach(child => {
                // Ensure the child still exists and is a sculpted element before removing
                 if (child && child.remove && typeof child.remove === 'function') {
                     child.remove();
                 }
            });
            ele.children = []; // Clear child references

            // Remove the native element from the DOM
            if (ele.html && ele.html.parentNode) {
                ele.html.parentNode.removeChild(ele.html); // <-- Correct DOM removal using parent
                // OR use the modern .remove() method: ele.html.remove();
            }

            // Optional: Nullify references to aid garbage collection
            ele.html = null;
            // ele.children = null; // Already cleared
            // ele._listeners = null; // Already cleared
            // Do NOT set ele = null; here, it only affects the local variable within the remove function.
        };

        // --- Parent Appending Logic ---
        // This logic determines where to attach the newly created element's native html node

        let parentNode = null;

        if (parent == null) {
            // If parent is null, append to the document body
            parentNode = document.body;

        } else if (parent && typeof parent === 'object' && 'html' in parent && parent.html instanceof Node) {
            // If parent is another sculpted element object (duck typing check for .html property)
            parentNode = parent.html;
            // Also add this new element to the parent's sculpted children list
            if (parent.children && Array.isArray(parent.children)) {
                 parent.children.push(ele);
            } else {
                 // Initialize children array if it doesn't exist (shouldn't happen with this structure)
                 parent.children = [ele];
            }


        } else if (parent instanceof Node) {
            // If parent is a native DOM Node
            parentNode = parent;

        } else if (typeof parent === 'string') {
            // If parent is a CSS selector string
            parentNode = document.querySelector(parent);
            if (!parentNode) {
                console.warn(`DomSculptor.create: Could not find parent element with selector: "${parent}". Element not appended.`);
                // If selector doesn't match, parentNode remains null, and it won't be appended.
                // Continue to call callback if it exists, as element was still "created".
            }
        } else {
            console.warn('DomSculptor.create: Invalid parent type provided. Element not appended.', parent);
             // If parent is something else unexpected, parentNode remains null.
             // Continue to call callback if it exists.
        }

        // Perform the actual DOM appending if a parent node was found
        if (parentNode) {
            parentNode.appendChild(ele.html);
        }

        // Execute the optional callback function, passing the created element object
        if (typeof callback == 'function') {
            callback(ele);
        }

        // Return the created element object
        return ele;
    }

    // jsontohtml method is not included as per the request, but could be added here
    // if you wanted to combine the previous functionality into this single class.
    // jsontohtml( object ){ ... }

}