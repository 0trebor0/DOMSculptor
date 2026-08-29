import { api, ApiError } from '../api.js';
import { errorMessages } from '../parts.js';

export let settingsView = ({ sculptor, session, navigate }) => {
    if (!session.authenticated) {
        navigate('/login');
        return sculptor.createDetached('div');
    }

    let errors = sculptor.signal(null);
    let busy = sculptor.signal(false);

    let input = (type, placeholder, large = true) => sculptor.tree({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'input',
            class: large ? ['form-control', 'form-control-lg'] : 'form-control',
            attributes: { type, placeholder }
        }]
    });

    let image = input('text', 'URL of profile picture', false);
    let username = input('text', 'Your Name');
    let bio = sculptor.tree({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'textarea',
            class: ['form-control', 'form-control-lg'],
            attributes: { rows: '8', placeholder: 'Short bio about you' }
        }]
    });
    let email = input('email', 'Email');
    let password = input('password', 'New Password');

    let control = wrapper => wrapper.child.find('input') || wrapper.child.find('textarea');
    let fill = user => {
        if (!user) return;
        control(image).setValue(user.image || '');
        control(username).setValue(user.username || '');
        control(bio).setValue(user.bio || '');
        control(email).setValue(user.email || '');
    };
    // The current user may not have been fetched yet when this view mounts, so the
    // form fills itself whenever the session resolves.
    session.user.subscribe(fill, { immediate: true });

    let submit = sculptor.tree({
        tag: 'button',
        class: ['btn', 'btn-lg', 'btn-primary', 'pull-xs-right'],
        text: 'Update Settings'
    });
    submit.attr('disabled', busy);

    let send = async event => {
        event.preventDefault();
        if (busy.get()) return;
        busy.set(true);
        errors.set(null);
        try {
            let details = {
                image: control(image).getValue(),
                username: control(username).getValue(),
                bio: control(bio).getValue(),
                email: control(email).getValue()
            };
            let secret = control(password).getValue();
            if (secret) details.password = secret;
            let payload = await api.updateUser(details, session.options());
            session.update(payload.user);
            navigate(`/profile/${encodeURIComponent(payload.user.username)}`);
        } catch (error) {
            errors.set(error instanceof ApiError && error.errors
                ? error.errors
                : { request: [error.message || 'failed'] });
        } finally {
            busy.set(false);
        }
    };

    let group = sculptor.tree({ tag: 'fieldset' });
    [image, username, bio, email, password].forEach(part => group.child.append(part));
    group.child.append(submit);
    let form = sculptor.tree({ tag: 'form', on: { submit: send } });
    form.child.append(group);

    let errorSlot = sculptor.createDetached('div');
    errors.subscribe(value => {
        errorSlot.child.clear();
        if (value) errorSlot.child.append(errorMessages(sculptor, value));
    }, { immediate: true });

    let root = sculptor.tree({
        tag: 'div',
        class: 'settings-page',
        children: [{
            tag: 'div',
            class: ['container', 'page'],
            children: [{
                tag: 'div',
                class: 'row',
                children: [{
                    tag: 'div',
                    class: ['col-md-6', 'offset-md-3', 'col-xs-12'],
                    children: [{ tag: 'h1', class: 'text-xs-center', text: 'Your Settings' }]
                }]
            }]
        }]
    });

    let column = root.child.find('.col-md-6');
    column.child.append(errorSlot);
    column.child.append(form);
    column.child.append(sculptor.tree({ tag: 'hr' }));
    column.child.append(sculptor.tree({
        tag: 'button',
        class: ['btn', 'btn-outline-danger'],
        text: 'Or click here to logout.',
        on: {
            click: () => {
                session.clear();
                navigate('/');
            }
        }
    }));
    return root;
};
