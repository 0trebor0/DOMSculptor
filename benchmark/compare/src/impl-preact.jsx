import { render } from 'preact';

export let name = 'Preact';

let Row = ({ item, selected, onSelect, onRemove }) => (
    <tr class={selected ? 'danger' : undefined}>
        <td class="col-md-1">{item.id}</td>
        <td class="col-md-4"><a class="lbl" onClick={() => onSelect(item.id)}>{item.label}</a></td>
        <td class="col-md-1">
            <a class="remove" onClick={() => onRemove(item.id)}>
                <span class="glyphicon glyphicon-remove" aria-hidden="true" />
            </a>
        </td>
        <td class="col-md-6" />
    </tr>
);

export let create = container => {
    let rows = [];
    let selected = -1;

    // Preact batches hook updates into a microtask; rendering from the top is
    // synchronous, which is what lets each operation be timed exactly.
    let commit = () => render(
        rows.map(item => (
            <Row
                key={item.id}
                item={item}
                selected={item.id === selected}
                onSelect={id => { selected = id; commit(); }}
                onRemove={id => { rows = rows.filter(row => row.id !== id); commit(); }}
            />
        )),
        container
    );
    commit();

    return {
        run(data) { selected = -1; rows = data.slice(); commit(); },
        add(data) { rows = rows.concat(data); commit(); },
        update() {
            rows = rows.map((item, index) => (
                index % 10 === 0 ? { id: item.id, label: `${item.label} !!!` } : item
            ));
            commit();
        },
        swap() {
            if (rows.length <= 998) return;
            let next = rows.slice();
            next[1] = rows[998];
            next[998] = rows[1];
            rows = next;
            commit();
        },
        select(index) { selected = rows[index].id; commit(); },
        remove(index) { rows = rows.filter((_, position) => position !== index); commit(); },
        clear() { selected = -1; rows = []; commit(); }
    };
};
