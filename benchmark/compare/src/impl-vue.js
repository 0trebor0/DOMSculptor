import { createApp, h, nextTick, ref } from 'vue';

export let name = 'Vue';

export let create = container => {
    let rows = ref([]);
    let selected = ref(-1);
    let removeById = id => { rows.value = rows.value.filter(item => item.id !== id); };

    let App = {
        setup() {
            return () => rows.value.map(row => h('tr', {
                key: row.id,
                class: row.id === selected.value ? 'danger' : null
            }, [
                h('td', { class: 'col-md-1' }, row.id),
                h('td', { class: 'col-md-4' }, [
                    h('a', { class: 'lbl', onClick: () => { selected.value = row.id; } }, row.label)
                ]),
                h('td', { class: 'col-md-1' }, [
                    h('a', { class: 'remove', onClick: () => removeById(row.id) }, [
                        h('span', { class: 'glyphicon glyphicon-remove', 'aria-hidden': 'true' })
                    ])
                ]),
                h('td', { class: 'col-md-6' })
            ]));
        }
    };
    createApp(App).mount(container);

    // Vue queues its render job on the microtask queue, so every operation waits
    // for that flush before the clock is stopped.
    let commit = () => nextTick();

    return {
        run(data) { selected.value = -1; rows.value = data.slice(); return commit(); },
        add(data) { rows.value = rows.value.concat(data); return commit(); },
        update() {
            rows.value = rows.value.map((item, index) => (
                index % 10 === 0 ? { id: item.id, label: `${item.label} !!!` } : item
            ));
            return commit();
        },
        swap() {
            if (rows.value.length <= 998) return commit();
            let next = rows.value.slice();
            next[1] = rows.value[998];
            next[998] = rows.value[1];
            rows.value = next;
            return commit();
        },
        select(index) { selected.value = rows.value[index].id; return commit(); },
        remove(index) {
            rows.value = rows.value.filter((_, position) => position !== index);
            return commit();
        },
        clear() { selected.value = -1; rows.value = []; return commit(); }
    };
};
