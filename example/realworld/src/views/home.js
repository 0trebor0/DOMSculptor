import { api } from '../api.js';
import { articleListView } from '../parts.js';

let limit = 10;

export let homeView = ({ sculptor, session, navigate }) => {
    let tab = sculptor.signal(session.authenticated ? { kind: 'feed' } : { kind: 'global' });
    let page = sculptor.signal(0);
    let articles = sculptor.asyncState(null);
    let tags = sculptor.asyncState([]);

    let load = () => {
        let params = { limit, offset: page.get() * limit };
        let active = tab.get();
        articles.run(({ signal }) => {
            let options = { ...session.options(), signal };
            if (active.kind === 'feed') return api.feed(params, options);
            if (active.kind === 'tag') return api.articles({ ...params, tag: active.tag }, options);
            return api.articles(params, options);
        // run() rejects as well as recording the failure in its snapshot, and the
        // snapshot is what the list renders, so the rejection is absorbed here.
        }).catch(() => {});
    };

    let select = next => {
        page.set(0);
        tab.set(next);
    };

    let tabLink = (label, isActive, onClick) => ({
        tag: 'li',
        class: 'nav-item',
        children: [{
            tag: 'a',
            class: isActive ? ['nav-link', 'active'] : 'nav-link',
            attributes: { href: '' },
            text: label,
            on: {
                click: event => {
                    event.preventDefault();
                    onClick();
                }
            }
        }]
    });

    let toggle = sculptor.tree({ tag: 'div', class: 'feed-toggle' });
    let renderToggle = () => {
        let active = tab.get();
        toggle.child.clear();
        let items = [];
        if (session.authenticated) {
            items.push(tabLink('Your Feed', active.kind === 'feed', () => select({ kind: 'feed' })));
        }
        items.push(tabLink('Global Feed', active.kind === 'global', () => select({ kind: 'global' })));
        if (active.kind === 'tag') items.push(tabLink(`#${active.tag}`, true, () => {}));
        toggle.child.append(sculptor.tree({ tag: 'ul', class: ['nav', 'nav-pills', 'outline-active'], children: items }));
    };

    let sidebar = sculptor.tree({ tag: 'div', class: 'sidebar', children: [{ tag: 'p', text: 'Popular Tags' }] });
    let renderTags = snapshot => {
        let existing = sidebar.child.find('.tag-list');
        if (existing) existing.remove();
        let names = snapshot.status === 'success' ? snapshot.data : [];
        sidebar.child.append(sculptor.tree({
            tag: 'div',
            class: 'tag-list',
            children: (names || []).map(name => ({
                tag: 'a',
                class: ['tag-pill', 'tag-default'],
                attributes: { href: '' },
                text: name,
                on: {
                    click: event => {
                        event.preventDefault();
                        select({ kind: 'tag', tag: name });
                    }
                }
            }))
        }));
    };

    let list = articleListView(sculptor, {
        state: articles,
        limit,
        page,
        onPage: next => page.set(next),
        session,
        navigate,
        emptyText: 'No articles are here... yet.'
    });

    let root = sculptor.tree({
        tag: 'div',
        class: 'home-page',
        children: [
            {
                tag: 'div',
                class: 'banner',
                children: [{
                    tag: 'div',
                    class: 'container',
                    children: [
                        { tag: 'h1', class: 'logo-font', text: 'conduit' },
                        { tag: 'p', text: 'A place to share your knowledge.' }
                    ]
                }]
            },
            {
                tag: 'div',
                class: ['container', 'page'],
                children: [{
                    tag: 'div',
                    class: 'row',
                    children: [
                        { tag: 'div', class: 'col-md-9' },
                        { tag: 'div', class: 'col-md-3' }
                    ]
                }]
            }
        ]
    });
    root.child.find('.col-md-9').child.append(toggle);
    root.child.find('.col-md-9').child.append(list);
    root.child.find('.col-md-3').child.append(sidebar);

    renderToggle();
    tab.subscribe(() => {
        renderToggle();
        load();
    });
    page.subscribe(load);
    tags.subscribe(renderTags, { immediate: true });

    load();
    tags.run(({ signal }) => api.tags({ signal }).then(payload => payload.tags)).catch(() => {});

    return root;
};
