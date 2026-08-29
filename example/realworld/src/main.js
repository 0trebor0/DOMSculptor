import DomSculptor from '../../../src/index.js';
import { defaultImage } from './parts.js';
import { createSession } from './session.js';
import { articleView } from './views/article.js';
import { authView } from './views/auth.js';
import { editorView } from './views/editor.js';
import { homeView } from './views/home.js';
import { profileView } from './views/profile.js';
import { settingsView } from './views/settings.js';

let sculptor = new DomSculptor();
let session = createSession(sculptor);

// navigate closes over the router, which is created below; it is only ever called
// from a handler, by which time the binding is initialised.
let context = {
    sculptor,
    session,
    navigate: path => router.navigate(path)
};
// Every view receives the scope the router created for it, so an asynchronous
// continuation can ask whether its route is still on screen.
let withRoute = (view, extra = null) => snapshot => view({
    ...context,
    params: extra ? { ...snapshot.params, ...extra } : snapshot.params,
    scope: snapshot.scope
});

let router = sculptor.router({
    '/': withRoute(homeView),
    '/login': withRoute(authView('login')),
    '/register': withRoute(authView('register')),
    '/settings': withRoute(settingsView),
    '/editor': withRoute(editorView),
    '/editor/:slug': withRoute(editorView),
    '/article/:slug': withRoute(articleView),
    '/profile/:username': withRoute(profileView),
    '/profile/:username/favorites': withRoute(profileView, { tab: 'favorited' }),
    '*': () => sculptor.tree({
        tag: 'div',
        class: ['container', 'page'],
        children: [
            { tag: 'h1', text: 'Not found' },
            { tag: 'p', children: [{ tag: 'a', attributes: { href: '#/' }, text: 'Back to the home page' }] }
        ]
    })
}, { hash: true, parent: '#view' });

let navLink = (href, children) => sculptor.tree({
    tag: 'li',
    class: 'nav-item',
    children: [{
        tag: 'a',
        class: {
            'nav-link': true,
            active: sculptor.computed(() => `#${router.current.get().path}` === href)
        },
        attributes: { href },
        children
    }]
});
let iconLink = (href, label, icon) => navLink(href, [
    { tag: 'i', class: icon },
    { tag: 'span', text: ` ${label}` }
]);

let navigation = sculptor.tree({ tag: 'ul', class: ['nav', 'navbar-nav', 'pull-xs-right'] });
let renderNavigation = () => {
    navigation.child.clear();
    navigation.child.append(navLink('#/', [{ tag: 'span', text: 'Home' }]));
    let user = session.user.get();
    if (session.authenticated && user) {
        navigation.child.append(iconLink('#/editor', 'New Article', 'ion-compose'));
        navigation.child.append(iconLink('#/settings', 'Settings', 'ion-gear-a'));
        navigation.child.append(navLink(`#/profile/${encodeURIComponent(user.username)}`, [
            { tag: 'img', class: 'user-pic', attributes: { src: user.image || defaultImage } },
            { tag: 'span', text: ` ${user.username}` }
        ]));
        return;
    }
    if (session.authenticated) return;
    navigation.child.append(navLink('#/login', [{ tag: 'span', text: 'Sign in' }]));
    navigation.child.append(navLink('#/register', [{ tag: 'span', text: 'Sign up' }]));
};

let header = sculptor.tree({
    tag: 'nav',
    class: ['navbar', 'navbar-light'],
    children: [{
        tag: 'div',
        class: 'container',
        children: [
            { tag: 'a', class: 'navbar-brand', attributes: { href: '#/' }, text: 'conduit' },
            navigation
        ]
    }]
});
sculptor.mount(header, '#header');

sculptor.mount(sculptor.tree({
    tag: 'div',
    class: 'container',
    children: [
        { tag: 'a', class: 'logo-font', attributes: { href: '#/' }, text: 'conduit' },
        {
            tag: 'span',
            class: 'attribution',
            text: ' An interactive learning project from Thinkster. Code licensed under MIT.'
        }
    ]
}), '#footer');

renderNavigation();
session.user.subscribe(renderNavigation);
session.token.subscribe(renderNavigation);
session.restore();

// Exposed so the verification harness can drive the app and inspect its state.
window.conduit = { sculptor, session, router };
