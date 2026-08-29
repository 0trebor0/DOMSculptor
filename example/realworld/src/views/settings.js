import { api } from '../api.js';
import { errorLines, errorList } from '../parts.js';

export let settingsView = ({ sculptor, session, navigate, scope }) => {
    if (!session.authenticated) {
        navigate('/login');
        return sculptor.createDetached('div');
    }

    let failures = sculptor.signal([]);
    let busy = sculptor.signal(false);

    let input = (ref, type, placeholder, large = true) => ({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'input',
            ref,
            class: large ? ['form-control', 'form-control-lg'] : 'form-control',
            attributes: { type, placeholder }
        }]
    });

    let send = async event => {
        event.preventDefault();
        if (busy.get()) return;
        busy.set(true);
        failures.set([]);
        try {
            let details = {
                image: refs.image.getValue(),
                username: refs.username.getValue(),
                bio: refs.bio.getValue(),
                email: refs.email.getValue()
            };
            let secret = refs.password.getValue();
            if (secret) details.password = secret;
            let payload = await api.updateUser(details, session.options());
            session.update(payload.user);
            navigate(`/profile/${encodeURIComponent(payload.user.username)}`);
        } catch (error) {
            // The route can change while the request is in flight; the scope says
            // whether this view is still the one on screen.
            if (!scope.disposed) failures.set(errorLines(error));
        } finally {
            if (!scope.disposed) busy.set(false);
        }
    };

    let refs = {};
    let root = sculptor.tree({
        tag: 'div',
        class: 'settings-page',
        refs,
        children: [{
            tag: 'div',
            class: ['container', 'page'],
            children: [{
                tag: 'div',
                class: 'row',
                children: [{
                    tag: 'div',
                    class: ['col-md-6', 'offset-md-3', 'col-xs-12'],
                    children: [
                        { tag: 'h1', class: 'text-xs-center', text: 'Your Settings' },
                        errorList(sculptor, failures),
                        {
                            tag: 'form',
                            on: { submit: send },
                            children: [{
                                tag: 'fieldset',
                                children: [
                                    input('image', 'text', 'URL of profile picture', false),
                                    input('username', 'text', 'Your Name'),
                                    {
                                        tag: 'fieldset',
                                        class: 'form-group',
                                        children: [{
                                            tag: 'textarea',
                                            ref: 'bio',
                                            class: ['form-control', 'form-control-lg'],
                                            attributes: { rows: '8', placeholder: 'Short bio about you' }
                                        }]
                                    },
                                    input('email', 'email', 'Email'),
                                    input('password', 'password', 'New Password'),
                                    {
                                        tag: 'button',
                                        class: ['btn', 'btn-lg', 'btn-primary', 'pull-xs-right'],
                                        attributes: { disabled: busy },
                                        text: 'Update Settings'
                                    }
                                ]
                            }]
                        },
                        { tag: 'hr' },
                        {
                            tag: 'button',
                            class: ['btn', 'btn-outline-danger'],
                            text: 'Or click here to logout.',
                            on: {
                                click: () => {
                                    session.clear();
                                    navigate('/');
                                }
                            }
                        }
                    ]
                }]
            }]
        }]
    });

    // The current user may not have been fetched yet when this view mounts, so the
    // form fills itself whenever the session resolves. The subscription belongs to
    // the view's scope, so leaving the route releases it.
    session.user.subscribe(user => {
        if (!user) return;
        refs.image.setValue(user.image || '');
        refs.username.setValue(user.username || '');
        refs.bio.setValue(user.bio || '');
        refs.email.setValue(user.email || '');
    }, { immediate: true });

    return root;
};
