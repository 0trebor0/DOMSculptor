// Element entries for the in-depth reference.
let ex = strings => strings.raw.join('').replace(/^\n/, '');

export let elements = {
    'DomElement.__order': [
        'html', 'children', 'attribute', 'class', 'child', 'setText', 'text', 'attr', 'classToggle',
        'setStyle', 'styleValue', 'getValue', 'setValue', 'hide', 'show', 'focus', 'blur', 'isFocused',
        'parent', 'closest', 'childrenOf', 'before', 'after', 'on', 'once', 'off',
        'onMount', 'onUnmount', 'onDispose', 'onRemove', 'remove', 'dispose'
    ],
    'DomElement.html': {
        description: `The native node. Becomes <code>null</code> once disposed, which is the cheapest way to ask
            whether a wrapper is still alive.`,
        example: ex`
element.html.scrollIntoView();
if (!element.html) return;   // disposed`
    },
    'DomElement.children': {
        description: `A frozen snapshot of the owned children, so iterating it cannot be disturbed by changes
            made while you iterate.`,
        returns: 'A frozen array of <code>DomElement</code>.'
    },
    'DomElement.attribute': { description: 'Attribute operations. See <code>DomAttributes</code>.' },
    'DomElement.class': { description: 'Class-list operations. See <code>DomClasses</code>.' },
    'DomElement.child': { description: 'Child operations that keep the DOM and ownership in step. See <code>DomChildren</code>.' },
    'DomElement.setText': {
        description: `Replaces all content with a single text node. Markup is never parsed, so untrusted text is
            safe here.`,
        returns: 'The same element, for chaining.',
        example: ex`
element.setText('<img src=x onerror=alert(1)>');
// renders those characters; nothing is executed`
    },
    'DomElement.text': {
        description: 'Binds a readable to a dedicated text node, so updates do not disturb sibling content.',
        returns: 'The same element.',
        throws: '<code>TypeError</code> unless given something with <code>get</code> and <code>subscribe</code>.',
        example: ex`
let name = sculptor.signal('Ada');
sculptor.create('p', '#app').text(name);
name.set('Grace');   // only the text node changes`
    },
    'DomElement.attr': {
        description: `Binds an attribute to a readable. <code>null</code>, <code>undefined</code>, and
            <code>false</code> remove the attribute; <code>true</code> writes an empty value.`,
        returns: 'The same element.',
        example: ex`
button.attr('disabled', busy);       // present only while busy is truthy
input.attr('aria-invalid', invalid);`
    },
    'DomElement.classToggle': {
        description: `Adds or removes a class from a readable, or several at once from a map. Plain booleans are
            accepted alongside signals.`,
        returns: 'The same element.',
        example: ex`
row.classToggle('selected', isSelected);
row.classToggle({
    'btn-primary': favourited,
    'btn-outline-primary': sculptor.computed(() => !favourited.get()),
    btn: true
});`
    },
    'DomElement.setStyle': {
        description: 'Sets one inline style property, or several from an object.',
        returns: 'The same element.',
        example: ex`
panel.setStyle('color', 'rebeccapurple');
panel.setStyle({ height: '600px', overflow: 'auto' });`
    },
    'DomElement.styleValue': {
        description: 'Binds one style property to a readable. <code>null</code> clears the property rather than writing the word.',
        returns: 'The same element.'
    },
    'DomElement.getValue': { description: 'Reads the control value.', returns: 'The current value.' },
    'DomElement.setValue': { description: 'Writes the control value.', returns: 'The same element.' },
    'DomElement.hide': {
        description: 'Sets <code>display: none</code>, remembering the previous inline value so <code>show()</code> can restore it.',
        returns: 'The same element.',
        example: ex`
panel.setStyle('display', 'grid');
panel.hide();
panel.show();   // display is 'grid' again, not ''`
    },
    'DomElement.show': { description: 'Restores the display value that was in place before <code>hide()</code>.', returns: 'The same element.' },
    'DomElement.focus': { description: 'Focuses the element. Accepts the native options, including <code>preventScroll</code>.', returns: 'The same element.' },
    'DomElement.blur': { description: 'Removes focus.', returns: 'The same element.' },
    'DomElement.isFocused': { description: 'Whether this element currently holds focus.', returns: '<code>boolean</code>.' },
    'DomElement.parent': {
        description: 'The owning parent, reconciled against the real DOM so an external move is reflected.',
        returns: 'The parent <code>DomElement</code>, or <code>null</code>.'
    },
    'DomElement.closest': { description: 'The nearest ancestor matching a selector, including this element.', returns: 'A <code>DomElement</code>, or <code>null</code>.' },
    'DomElement.childrenOf': { description: 'The owned children as an array.', returns: 'An array of <code>DomElement</code>.' },
    'DomElement.before': { description: 'Inserts a sibling before this element.', returns: 'The same element.' },
    'DomElement.after': { description: 'Inserts a sibling after this element.', returns: 'The same element.' },
    'DomElement.on': {
        description: `Adds a listener, or delegates when given a selector between the event name and the
            handler. A delegated handler receives <code>(event, matchedElement)</code> and matches only
            inside this element, so one listener serves rows that do not exist yet.`,
        returns: 'The same element.',
        throws: '<code>TypeError</code> for invalid arguments, or if the element is disposed.',
        example: ex`
button.on('click', () => save());
button.on({ focus: onFocus, blur: onBlur });

// one listener for every row, now and later
list.on('click', 'a.remove', (event, link) => remove(link.dataset.id));`
    },
    'DomElement.once': {
        description: 'Adds a listener that detaches before it is invoked, so a handler cannot re-arm itself.',
        returns: 'The same element.'
    },
    'DomElement.off': {
        description: `Removes a listener by handler, or every listener for an event when the handler is
            omitted. Delegated handlers are removed by the same function you passed in.`,
        returns: 'The same element.'
    },
    'DomElement.onMount': {
        description: `Runs once when the element first becomes connected — immediately if it already is. It
            does not run again on a later mount.`,
        returns: 'The same element.'
    },
    'DomElement.onUnmount': { description: 'Runs on every explicit unmount, child before parent.', returns: 'The same element.' },
    'DomElement.onDispose': {
        description: 'Runs once during permanent cleanup, child before parent.',
        returns: 'The same element.',
        note: `Disposal detaches the node before tearing the subtree down, so a hook sees the subtree
            already out of the document; only the element disposal started at has a <code>null</code>
            <code>parentNode</code>. Read an element's position before disposing it, not from the hook.`
    },
    'DomElement.onRemove': { description: 'A compatibility alias for <code>onDispose</code>.', returns: 'The same element.' },
    'DomElement.remove': { description: 'A compatibility alias for <code>dispose</code>.' },
    'DomElement.dispose': {
        description: `Permanently releases the element: its node, listeners, bindings, children, and its entry
            in the runtime's ownership set. Idempotent, and safe to call from inside a hook.`,
        example: ex`
element.dispose();
element.html;         // null
element.setText('x'); // throws: the element has been disposed`
    },

    'DomAttributes.set': {
        description: 'Sets one attribute, or several from an object.',
        returns: 'The owning element.',
        note: `Never build an attribute <em>name</em> from untrusted input — <code>onclick</code> is an
            ordinary attribute name to the DOM.`,
        example: ex`
element.attribute.set('role', 'list');
element.attribute.set({ 'aria-live': 'polite', tabindex: '0' });`
    },
    'DomAttributes.remove': { description: 'Removes an attribute.', returns: 'The owning element.' },
    'DomAttributes.get': { description: 'Reads an attribute.', returns: 'The value, or <code>null</code>.' },
    'DomAttributes.has': { description: 'Whether the attribute is present.', returns: '<code>boolean</code>.' },

    'DomClasses.add': { description: 'Adds one or more classes.', returns: 'The owning element.' },
    'DomClasses.remove': { description: 'Removes one or more classes.', returns: 'The owning element.' },
    'DomClasses.toggle': { description: 'Toggles one class.', returns: 'The owning element.' },
    'DomClasses.contains': { description: 'Whether the class is present.', returns: '<code>boolean</code>.' },

    'DomChildren.append': {
        description: `Appends a <code>DomElement</code>, native node, or string, keeping the DOM and ownership in
            step. It returns the element that was added, so a structure can be built downwards without a
            temporary variable per level; a raw node or string returns the container instead, because
            there is no wrapper to return.`,
        returns: 'The appended element, or the container.',
        example: ex`
let leaf = panel.child
    .append(sculptor.createDetached('section'))
    .child.append(sculptor.createDetached('p'))
    .setText('deep');`
    },
    'DomChildren.prepend': { description: 'As <code>append</code>, at the start.', returns: 'The prepended element, or the container.' },
    'DomChildren.find': {
        description: `The first descendant matching a selector, wrapped. One wrapper exists per node, so
            repeated calls return the same object and cost nothing extra.`,
        returns: 'A <code>DomElement</code>, or <code>null</code>.'
    },
    'DomChildren.findAll': { description: 'Every matching descendant, wrapped.', returns: 'An array of <code>DomElement</code>.' },
    'DomChildren.create': { description: 'Creates and appends a child in one call, returning the child.', returns: 'The new child.' },
    'DomChildren.remove': {
        description: `Disposes the container itself. Named for symmetry with the other child operations, but it
            removes the parent, not the children.`,
        note: 'Use <code>clear()</code> to empty a container you intend to keep.'
    },
    'DomChildren.clear': { description: 'Disposes every child and empties the container, which survives.', returns: 'The container.' },
    'DomChildren.replace': { description: 'Swaps one child for another, disposing the one replaced and transferring ownership.', returns: 'The container.' }
};
