import DomSculptor from 'domsculptor';

export let name = 'DOMSculptor';

export let create = container => {
    let sculptor = new DomSculptor();
    let rows = sculptor.signal([]);
    let selectedNode = null;

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
        row.labelNode = label.html.firstChild;
        row.item = item;
        return row;
    };

    let updateRow = (row, item) => {
        if (row.item === item) return;
        row.item = item;
        row.labelNode.nodeValue = item.label;
    };

    let tbody = sculptor.wrap(container);
    rows.list(tbody, { key: item => item.id, render: renderRow, update: updateRow });

    let commit = () => { sculptor.flush(); };

    return {
        run(data) { selectedNode = null; rows.set(data.slice()); commit(); },
        add(data) { rows.set(rows.get().concat(data)); commit(); },
        update() {
            rows.set(rows.get().map((item, index) => (
                index % 10 === 0 ? { id: item.id, label: `${item.label} !!!` } : item
            )));
            commit();
        },
        swap() {
            let items = rows.get();
            if (items.length <= 998) return;
            let next = items.slice();
            next[1] = items[998];
            next[998] = items[1];
            rows.set(next);
            commit();
        },
        select(index) {
            let node = container.children[index];
            if (selectedNode === node) return;
            selectedNode?.classList.remove('danger');
            selectedNode = node;
            node?.classList.add('danger');
        },
        remove(index) {
            let items = rows.get();
            rows.set(items.filter((_, position) => position !== index));
            commit();
        },
        clear() { selectedNode = null; rows.set([]); commit(); }
    };
};
