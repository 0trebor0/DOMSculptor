import { api } from '../api.js';
import { articleListView } from '../parts.js';

let limit = 10;

export let homeView = ({ sculptor, session, navigate }) => {
    let tab = sculptor.signal(session.authenticated ? { kind: 'feed' } : { kind: 'global' });
    let page = sculptor.signal(0);
    let articles = sculptor.asyncState(null);
    let tags = sculptor.asyncState([]);
    let tabs = sculptor.signal([]);
    let tagNames = sculptor.signal([]);

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

    let describeTabs = () => {
        let active = tab.get();
        let items = [];
        if (session.authenticated) {
            items.push({ label: 'Your Feed', active: active.kind === 'feed', go: () => select({ kind: 'feed' }) });
        }
        items.push({ label: 'Global Feed', active: active.kind === 'global', go: () => select({ kind: 'global' }) });
        if (active.kind === 'tag') items.push({ label: `#${active.tag}`, active: true, go: () => {} });
        tabs.set(items);
    };

    let link = (label, className, go) => ({
        tag: 'a',
        class: className,
        attributes: { href: '' },
        text: label,
        on: {
            click: event => {
                event.preventDefault();
                go();
            }
        }
    });

    let refs = {};
    let root = sculptor.tree({
        tag: 'div',
        class: 'home-page',
        refs,
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
                        {
                            tag: 'div',
                            class: 'col-md-9',
                            ref: 'feed',
                            children: [{
                                tag: 'div',
                                class: 'feed-toggle',
                                children: [{
                                    tag: 'ul',
                                    class: ['nav', 'nav-pills', 'outline-active'],
                                    // The tab strip is its container's entire contents,
                                    // so it is expressed as reactive children.
                                    children: {
                                        each: tabs,
                                        key: item => item.label,
                                        render: item => sculptor.tree({
                                            tag: 'li',
                                            class: 'nav-item',
                                            children: [
                                                link(item.label, item.active ? ['nav-link', 'active'] : 'nav-link', item.go)
                                            ]
                                        }),
                                        // Keyed rows are reused, so state applied when
                                        // a row was created has to be reapplied here.
                                        update: (row, item) => {
                                            row.child.find('a').classToggle({ active: item.active });
                                        }
                                    }
                                }]
                            }]
                        },
                        {
                            tag: 'div',
                            class: 'col-md-3',
                            children: [{
                                tag: 'div',
                                class: 'sidebar',
                                children: [
                                    { tag: 'p', text: 'Popular Tags' },
                                    {
                                        tag: 'div',
                                        class: 'tag-list',
                                        children: {
                                            each: tagNames,
                                            key: name => name,
                                            render: name => sculptor.tree(
                                                link(name, ['tag-pill', 'tag-default'], () => select({ kind: 'tag', tag: name }))
                                            )
                                        }
                                    }
                                ]
                            }]
                        }
                    ]
                }]
            }
        ]
    });

    refs.feed.child.append(articleListView(sculptor, {
        state: articles,
        limit,
        page,
        onPage: next => page.set(next),
        session,
        navigate,
        emptyText: 'No articles are here... yet.'
    }));

    describeTabs();
    tab.subscribe(() => {
        describeTabs();
        load();
    });
    page.subscribe(load);
    tags.subscribe(snapshot => tagNames.set(snapshot.status === 'success' ? snapshot.data || [] : []));

    load();
    tags.run(({ signal }) => api.tags({ signal }).then(payload => payload.tags)).catch(() => {});

    return root;
};
