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
let withParams = view => snapshot => view({ ...context, params: snapshot.params });

let router = sculptor.router({
    '/': () => homeView(context),
    '/login': () => authView('login')(context),
    '/register': () => authView('register')(context),
    '/settings': () => settingsView(context),
    '/editor': withParams(editorView),
    '/editor/:slug': withParams(editorView),
    '/article/:slug': withParams(articleView),
    '/profile/:username': withParams(profileView),
    '/profile/:username/favorites': snapshot => profileView({
        ...context,
        params: { ...snapshot.params, tab: 'favorited' }
    }),
    '*': () => sculptor.tree({
        tag: 'div',
        class: ['container', 'page'],
        children: [
            { tag: 'h1', text: 'Not found' },
            { tag: 'p', children: [{ tag: 'a', attributes: { href: '#/' }, text: 'Back to the home page' }] }
        ]
    })
}, { hash: true, parent: '#view' });

let navLink = (href, label, extra = null) => {
    let active = sculptor.computed(() => `#${router.current.get().path}` === href);
    let link = sculptor.tree({
        tag: 'a',
        class: 'nav-link',
        attributes: { href },
        children: extra ? [{ tag: 'i', class: extra }, { tag: 'span', text: ` ${label}` }] : [{ tag: 'span', text: label }]
    });
    link.classToggle('active', active);
    return sculptor.tree({ tag: 'li', class: 'nav-item' }).child.append(link);
};

let navigation = sculptor.tree({ tag: 'ul', class: ['nav', 'navbar-nav', 'pull-xs-right'] });
let renderNavigation = () => {
    if (!navigation.html) return;
    navigation.child.clear();
    navigation.child.append(navLink('#/', 'Home'));
    let user = session.user.get();
    if (session.authenticated && user) {
        navigation.child.append(navLink('#/editor', 'New Article', 'ion-compose'));
        navigation.child.append(navLink('#/settings', 'Settings', 'ion-gear-a'));
        let profileHref = `#/profile/${encodeURIComponent(user.username)}`;
        let link = sculptor.tree({
            tag: 'a',
            class: 'nav-link',
            attributes: { href: profileHref },
            children: [
                { tag: 'img', class: 'user-pic', attributes: { src: user.image || defaultImage } },
                { tag: 'span', text: ` ${user.username}` }
            ]
        });
        link.classToggle('active', sculptor.computed(() => `#${router.current.get().path}` === profileHref));
        navigation.child.append(sculptor.tree({ tag: 'li', class: 'nav-item' }).child.append(link));
        return;
    }
    if (session.authenticated) return;
    navigation.child.append(navLink('#/login', 'Sign in'));
    navigation.child.append(navLink('#/register', 'Sign up'));
};

let header = sculptor.tree({
    tag: 'nav',
    class: ['navbar', 'navbar-light'],
    children: [{
        tag: 'div',
        class: 'container',
        children: [{ tag: 'a', class: 'navbar-brand', attributes: { href: '#/' }, text: 'conduit' }]
    }]
});
header.child.find('.container').child.append(navigation);
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
