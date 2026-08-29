import { api, ApiError } from '../api.js';
import { errorMessages } from '../parts.js';

export let authView = mode => ({ sculptor, session, navigate }) => {
    let registering = mode === 'register';
    let errors = sculptor.signal(null);
    let busy = sculptor.signal(false);

    let field = (type, placeholder) => sculptor.tree({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'input',
            class: ['form-control', 'form-control-lg'],
            attributes: { type, placeholder }
        }]
    });

    let username = registering ? field('text', 'Username') : null;
    let email = field('email', 'Email');
    let password = field('password', 'Password');
    let submit = sculptor.tree({
        tag: 'button',
        class: ['btn', 'btn-lg', 'btn-primary', 'pull-xs-right'],
        text: registering ? 'Sign up' : 'Sign in'
    });
    submit.attr('disabled', busy);

    let valueOf = wrapper => wrapper.child.find('input').getValue();

    let send = async event => {
        event.preventDefault();
        if (busy.get()) return;
        busy.set(true);
        errors.set(null);
        try {
            let credentials = { email: valueOf(email), password: valueOf(password) };
            if (registering) credentials.username = valueOf(username);
            let payload = registering
                ? await api.register(credentials)
                : await api.login(credentials);
            session.adopt(payload.user);
            navigate('/');
        } catch (error) {
            errors.set(error instanceof ApiError && error.errors
                ? error.errors
                : { request: [error.message || 'failed'] });
        } finally {
            busy.set(false);
        }
    };

    let form = sculptor.tree({ tag: 'form', on: { submit: send } });
    if (username) form.child.append(username);
    form.child.append(email);
    form.child.append(password);
    form.child.append(submit);

    let errorSlot = sculptor.createDetached('div');
    errors.subscribe(value => {
        errorSlot.child.clear();
        if (value) errorSlot.child.append(errorMessages(sculptor, value));
    }, { immediate: true });

    let root = sculptor.tree({
        tag: 'div',
        class: 'auth-page',
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
                        { tag: 'h1', class: 'text-xs-center', text: registering ? 'Sign up' : 'Sign in' },
                        {
                            tag: 'p',
                            class: 'text-xs-center',
                            children: [{
                                tag: 'a',
                                attributes: { href: registering ? '#/login' : '#/register' },
                                text: registering ? 'Have an account?' : 'Need an account?'
                            }]
                        }
                    ]
                }]
            }]
        }]
    });

    let column = root.child.find('.col-md-6');
    column.child.append(errorSlot);
    column.child.append(form);
    return root;
};
