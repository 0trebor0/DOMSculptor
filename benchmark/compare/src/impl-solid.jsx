import { createSignal, For } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { render } from 'solid-js/web';

export let name = 'Solid';

export let create = container => {
    let [rows, setRows] = createStore([]);
    let [selected, setSelected] = createSignal(-1);
    let removeById = id => setRows(current => current.filter(item => item.id !== id));

    render(() => (
        <For each={rows}>{row => (
            <tr class={selected() === row.id ? 'danger' : ''}>
                <td class="col-md-1">{row.id}</td>
                <td class="col-md-4"><a class="lbl" onClick={() => setSelected(row.id)}>{row.label}</a></td>
                <td class="col-md-1">
                    <a class="remove" onClick={() => removeById(row.id)}>
                        <span class="glyphicon glyphicon-remove" aria-hidden="true" />
                    </a>
                </td>
                <td class="col-md-6" />
            </tr>
        )}</For>
    ), container);

    return {
        run(data) { setSelected(-1); setRows(data.slice()); },
        add(data) { setRows(current => current.concat(data)); },
        // A store lets the label be written in place, so only the changed text
        // nodes update. This is how the upstream Solid entry is written.
        update() {
            setRows(produce(current => {
                for (let index = 0; index < current.length; index += 10) {
                    current[index].label = `${current[index].label} !!!`;
                }
            }));
        },
        swap() {
            if (rows.length <= 998) return;
            setRows(produce(current => {
                let first = current[1];
                current[1] = current[998];
                current[998] = first;
            }));
        },
        select(index) { setSelected(rows[index].id); },
        remove(index) { setRows(current => current.filter((_, position) => position !== index)); },
        clear() { setSelected(-1); setRows([]); }
    };
};
