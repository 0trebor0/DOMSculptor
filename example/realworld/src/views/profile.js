import { api } from '../api.js';
import { articleListView, defaultImage } from '../parts.js';

let limit = 5;

export let profileView = ({ sculptor, session, navigate, params }) => {
    let username = params.username;
    let profile = sculptor.signal(null);
    let following = sculptor.signal(false);
    let tab = sculptor.signal(params.tab === 'favorited' ? 'favorited' : 'authored');
    let page = sculptor.signal(0);
    let articles = sculptor.asyncState(null);

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
        following.set(payload.profile.following);
    };

    let actions = sculptor.createDetached('div');
    let renderActions = () => {
        actions.child.clear();
        let current = session.user.get();
        if (current && current.username === username) {
            actions.child.append(sculptor.tree({
                tag: 'a',
                class: ['btn', 'btn-sm', 'btn-outline-secondary', 'action-btn'],
                attributes: { href: '#/settings' },
                children: [{ tag: 'i', class: 'ion-gear-a' }, { tag: 'span', text: ' Edit Profile Settings' }]
            }));
            return;
        }
        let button = sculptor.tree({
            tag: 'button',
            class: ['btn', 'btn-sm', 'action-btn'],
            on: { click: toggleFollow },
            children: [{ tag: 'i', class: 'ion-plus-round' }]
        });
        button.child.append(sculptor.createDetached('span').text(sculptor.computed(() =>
            ` ${following.get() ? 'Unfollow' : 'Follow'} ${username}`
        )));
        button.classToggle('btn-secondary', sculptor.computed(() => following.get()));
        button.classToggle('btn-outline-secondary', sculptor.computed(() => !following.get()));
        actions.child.append(button);
    };

    let tabLink = (label, key) => ({
        tag: 'li',
        class: 'nav-item',
        children: [{
            tag: 'a',
            class: tab.get() === key ? ['nav-link', 'active'] : 'nav-link',
            attributes: { href: '' },
            text: label,
            on: {
                click: event => {
                    event.preventDefault();
                    if (tab.get() === key) return;
                    page.set(0);
                    tab.set(key);
                }
            }
        }]
    });

    let toggle = sculptor.createDetached('div');
    toggle.class.add('articles-toggle');
    let renderToggle = () => {
        toggle.child.clear();
        toggle.child.append(sculptor.tree({
            tag: 'ul',
            class: ['nav', 'nav-pills', 'outline-active'],
            children: [tabLink('My Articles', 'authored'), tabLink('Favorited Articles', 'favorited')]
        }));
    };

    let root = sculptor.tree({
        tag: 'div',
        class: 'profile-page',
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
                                { tag: 'img', class: 'user-img', attributes: { src: defaultImage } },
                                { tag: 'h4', text: username },
                                { tag: 'p', class: 'user-bio' }
                            ]
                        }]
                    }]
                }]
            },
            {
                tag: 'div',
                class: ['container', 'articles-container'],
                children: [{
                    tag: 'div',
                    class: 'row',
                    children: [{ tag: 'div', class: ['col-xs-12', 'col-md-10', 'offset-md-1'] }]
                }]
            }
        ]
    });

    root.child.find('.user-info .col-xs-12').child.append(actions);
    let column = root.child.find('.articles-container .col-xs-12');
    column.child.append(toggle);
    column.child.append(articleListView(sculptor, {
        state: articles,
        limit,
        page,
        onPage: next => page.set(next),
        session,
        navigate,
        emptyText: 'No articles are here... yet.'
    }));

    renderActions();
    renderToggle();
    session.user.subscribe(renderActions);
    tab.subscribe(() => {
        renderToggle();
        load();
    });
    page.subscribe(load);
    profile.subscribe(value => {
        if (!value || !root.html) return;
        root.child.find('.user-img').attribute.set('src', value.image || defaultImage);
        root.child.find('.user-bio').setText(value.bio || '');
    });

    load();
    api.profile(username, session.options()).then(payload => {
        if (!root.html) return;
        following.set(payload.profile.following);
        profile.set(payload.profile);
    }).catch(() => {});

    return root;
};
