import { memo, useCallback, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

export let name = 'React';

let Row = memo(({ item, selected, onSelect, onRemove }) => (
    <tr className={selected ? 'danger' : undefined}>
        <td className="col-md-1">{item.id}</td>
        <td className="col-md-4"><a className="lbl" onClick={() => onSelect(item.id)}>{item.label}</a></td>
        <td className="col-md-1">
            <a className="remove" onClick={() => onRemove(item.id)}>
                <span className="glyphicon glyphicon-remove" aria-hidden="true" />
            </a>
        </td>
        <td className="col-md-6" />
    </tr>
));

let Table = ({ rows, selected, onSelect, onRemove }) => rows.map(item => (
    <Row
        key={item.id}
        item={item}
        selected={item.id === selected}
        onSelect={onSelect}
        onRemove={onRemove}
    />
));

export let create = container => {
    let controls = {};
    let App = () => {
        let [rows, setRows] = useState([]);
        let [selected, setSelected] = useState(-1);
        controls.setRows = setRows;
        controls.setSelected = setSelected;
        controls.rows = rows;
        let onSelect = useCallback(id => setSelected(id), []);
        let onRemove = useCallback(id => setRows(current => current.filter(item => item.id !== id)), []);
        return <Table rows={rows} selected={selected} onSelect={onSelect} onRemove={onRemove} />;
    };

    // The benchmark drives a <tbody>, which React renders into directly.
    let root = createRoot(container);
    flushSync(() => root.render(<App />));

    let commit = change => flushSync(change);

    return {
        run(data) {
            commit(() => {
                controls.setSelected(-1);
                controls.setRows(data.slice());
            });
        },
        add(data) { commit(() => controls.setRows(current => current.concat(data))); },
        update() {
            commit(() => controls.setRows(current => current.map((item, index) => (
                index % 10 === 0 ? { id: item.id, label: `${item.label} !!!` } : item
            ))));
        },
        swap() {
            commit(() => controls.setRows(current => {
                if (current.length <= 998) return current;
                let next = current.slice();
                next[1] = current[998];
                next[998] = current[1];
                return next;
            }));
        },
        select(index) { commit(() => controls.setSelected(controls.rows[index].id)); },
        remove(index) {
            commit(() => controls.setRows(current => current.filter((_, position) => position !== index)));
        },
        clear() {
            commit(() => {
                controls.setSelected(-1);
                controls.setRows([]);
            });
        }
    };
};
