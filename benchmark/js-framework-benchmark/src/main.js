import DomSculptor from 'domsculptor';

let adjectives = [
    'pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint',
    'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly',
    'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'
];
let colours = [
    'red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'brown', 'white', 'black', 'orange'
];
let nouns = [
    'table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger',
    'pizza', 'mouse', 'keyboard'
];

let random = max => Math.round(Math.random() * 1_000) % max;
let nextId = 1;
let buildData = count => Array.from({ length: count }, () => ({
    id: nextId++,
    label: `${adjectives[random(adjectives.length)]} ${colours[random(colours.length)]} ${nouns[random(nouns.length)]}`
}));

let sculptor = new DomSculptor();
let rows = sculptor.signal([]);

// Selection is a single class on a single row, so it is applied directly rather
// than through the list: routing it through the signal would re-run the keyed
// diff over every mounted row to change one attribute.
let selectedNode = null;
let select = node => {
    if (selectedNode === node) return;
    selectedNode?.classList.remove('danger');
    selectedNode = node;
    node?.classList.add('danger');
};

let cell = (className, child = null) => {
    let td = sculptor.createDetached('td');
    td.class.add(className);
    if (child) td.child.append(child);
    return td;
};

let renderRow = item => {
    let row = sculptor.createDetached('tr');

    let id = sculptor.createDetached('td');
    id.class.add('col-md-1');
    id.setText(String(item.id));

    let label = sculptor.createDetached('a');
    label.class.add('lbl');
    label.setText(item.label);

    let icon = sculptor.createDetached('span');
    icon.class.add('glyphicon', 'glyphicon-remove');
    icon.attribute.set('aria-hidden', 'true');

    let removeLink = sculptor.createDetached('a');
    removeLink.class.add('remove');
    removeLink.child.append(icon);

    row.child.append(id);
    row.child.append(cell('col-md-4', label));
    row.child.append(cell('col-md-1', removeLink));
    row.child.append(cell('col-md-6'));

    // The label's text node and the row's current item are kept on the row so an
    // update is one nodeValue write, with no query and no work for rows that did
    // not change.
    row.labelNode = label.html.firstChild;
    row.item = item;
    return row;
};

let updateRow = (row, item) => {
    if (row.item === item) return;
    row.item = item;
    row.labelNode.nodeValue = item.label;
};

let tbody = sculptor.wrap('#tbody');
rows.list(tbody, { key: item => item.id, render: renderRow, update: updateRow });

tbody.on('click', 'a', (event, matched) => {
    event.preventDefault();
    let node = matched.closest('tr');
    if (!node) return;
    if (matched.classList.contains('remove')) {
        let id = Number(node.firstChild.textContent);
        if (node === selectedNode) selectedNode = null;
        rows.set(rows.get().filter(item => item.id !== id));
    } else {
        select(node);
    }
});

let replace = items => {
    select(null);
    rows.set(items);
};

let actions = {
    run: () => replace(buildData(1_000)),
    runlots: () => replace(buildData(10_000)),
    add: () => rows.set(rows.get().concat(buildData(1_000))),
    update: () => rows.set(rows.get().map((item, index) => (
        index % 10 === 0 ? { id: item.id, label: `${item.label} !!!` } : item
    ))),
    clear: () => replace([]),
    swaprows: () => {
        let items = rows.get();
        if (items.length <= 998) return;
        let next = items.slice();
        next[1] = items[998];
        next[998] = items[1];
        rows.set(next);
    }
};

for (let id in actions) sculptor.wrap(`#${id}`).on('click', actions[id]);
