import { api } from '../api.js';
import { articleListView, defaultImage } from '../parts.js';

let limit = 5;

export let profileView = ({ sculptor, session, navigate, params, scope }) => {
    let username = params.username;
    let image = sculptor.signal(defaultImage);
    let bio = sculptor.signal('');
    let following = sculptor.signal(false);
    let tab = sculptor.signal(params.tab === 'favorited' ? 'favorited' : 'authored');
    let page = sculptor.signal(0);
    let articles = sculptor.asyncState(null);
    let tabs = sculptor.signal([]);

    let load = () => {
        let query = { limit, offset: page.get() * limit };
        if (tab.get() === 'authored') query.author = username;
        else query.favorited = username;
        articles.run(({ signal }) => api.articles(query, { ...session.options(), signal })).catch(() => {});
    };

    let toggleFollow = async () => {
        if (!session.authenticated) return navigate('/login');
        let call = following.get() ? api.unfollow : api.follow;
        let payload = await call(username, session.options());
        if (!scope.disposed) following.set(payload.profile.following);
    };

    let describeTabs = () => tabs.set([
        { label: 'My Articles', key: 'authored' },
        { label: 'Favorited Articles', key: 'favorited' }
    ].map(item => ({ ...item, active: tab.get() === item.key })));

    let actions = sculptor.createDetached('div');
    let renderActions = () => {
        if (!actions.html) return;
        actions.child.clear();
        let current = session.user.get();
        if (current && current.username === username) {
            return void actions.child.append(sculptor.tree({
                tag: 'a',
                class: ['btn', 'btn-sm', 'btn-outline-secondary', 'action-btn'],
                attributes: { href: '#/settings' },
                children: [{ tag: 'i', class: 'ion-gear-a' }, { tag: 'span', text: ' Edit Profile Settings' }]
            }));
        }
        actions.child.append(sculptor.tree({
            tag: 'button',
            class: {
                btn: true,
                'btn-sm': true,
                'action-btn': true,
                'btn-secondary': following,
                'btn-outline-secondary': sculptor.computed(() => !following.get())
            },
            on: { click: toggleFollow },
            children: [
                { tag: 'i', class: 'ion-plus-round' },
                {
                    tag: 'span',
                    text: sculptor.computed(() => ` ${following.get() ? 'Unfollow' : 'Follow'} ${username}`)
                }
            ]
        }));
    };

    let refs = {};
    let root = sculptor.tree({
        tag: 'div',
        class: 'profile-page',
        refs,
        children: [
            {
                tag: 'div',
                class: 'user-info',
                children: [{
                    tag: 'div',
                    class: 'container',
                    children: [{
                        tag: 'div',
                        class: 'row',
                        children: [{
                            tag: 'div',
                            class: ['col-xs-12', 'col-md-10', 'offset-md-1'],
                            children: [
                                { tag: 'img', class: 'user-img', attributes: { src: image } },
                                { tag: 'h4', text: username },
                                { tag: 'p', text: bio },
                                actions
                            ]
                        }]
                    }]
                }]
            },
            {
                tag: 'div',
                class: 'container',
                children: [{
                    tag: 'div',
                    class: 'row',
                    children: [{
                        tag: 'div',
                        class: ['col-xs-12', 'col-md-10', 'offset-md-1'],
                        ref: 'articles',
                        children: [{
                            tag: 'div',
                            class: 'articles-toggle',
                            children: [{
                                tag: 'ul',
                                class: ['nav', 'nav-pills', 'outline-active'],
                                children: {
                                    each: tabs,
                                    key: item => item.key,
                                    render: item => sculptor.tree({
                                        tag: 'li',
                                        class: 'nav-item',
                                        children: [{
                                            tag: 'a',
                                            class: item.active ? ['nav-link', 'active'] : 'nav-link',
                                            attributes: { href: '' },
                                            text: item.label,
                                            on: {
                                                click: event => {
                                                    event.preventDefault();
                                                    if (tab.get() === item.key) return;
                                                    page.set(0);
                                                    tab.set(item.key);
                                                }
                                            }
                                        }]
                                    }),
                                    update: (row, item) => {
                                        row.child.find('a').classToggle({ active: item.active });
                                    }
                                }
                            }]
                        }]
                    }]
                }]
            }
        ]
    });

    refs.articles.child.append(articleListView(sculptor, {
        state: articles,
        limit,
        page,
        onPage: next => page.set(next),
        session,
        navigate,
        emptyText: 'No articles are here... yet.'
    }));

    renderActions();
    describeTabs();
    session.user.subscribe(renderActions);
    tab.subscribe(() => {
        describeTabs();
        load();
    });
    page.subscribe(load);

    load();
    api.profile(username, session.options()).then(payload => {
        if (scope.disposed) return;
        following.set(payload.profile.following);
        image.set(payload.profile.image || defaultImage);
        bio.set(payload.profile.bio || '');
    }).catch(() => {});

    return root;
};
