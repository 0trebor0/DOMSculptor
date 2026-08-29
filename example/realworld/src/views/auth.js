import { api } from '../api.js';
import { errorLines, errorList } from '../parts.js';

export let authView = mode => ({ sculptor, session, navigate }) => {
    let registering = mode === 'register';
    let failures = sculptor.signal([]);
    let busy = sculptor.signal(false);

    let field = (ref, type, placeholder) => ({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'input',
            ref,
            class: ['form-control', 'form-control-lg'],
            attributes: { type, placeholder }
        }]
    });

    let send = async event => {
        event.preventDefault();
        if (busy.get()) return;
        busy.set(true);
        failures.set([]);
        try {
            let credentials = { email: refs.email.getValue(), password: refs.password.getValue() };
            if (registering) credentials.username = refs.username.getValue();
            let payload = registering
                ? await api.register(credentials)
                : await api.login(credentials);
            session.adopt(payload.user);
            navigate('/');
        } catch (error) {
            failures.set(errorLines(error));
        } finally {
            busy.set(false);
        }
    };

    let refs = {};
    return sculptor.tree({
        tag: 'div',
        class: 'auth-page',
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
                        { tag: 'h1', class: 'text-xs-center', text: registering ? 'Sign up' : 'Sign in' },
                        {
                            tag: 'p',
                            class: 'text-xs-center',
                            children: [{
                                tag: 'a',
                                attributes: { href: registering ? '#/login' : '#/register' },
                                text: registering ? 'Have an account?' : 'Need an account?'
                            }]
                        },
                        errorList(sculptor, failures),
                        {
                            tag: 'form',
                            on: { submit: send },
                            children: [
                                ...(registering ? [field('username', 'text', 'Username')] : []),
                                field('email', 'email', 'Email'),
                                field('password', 'password', 'Password'),
                                {
                                    tag: 'button',
                                    class: ['btn', 'btn-lg', 'btn-primary', 'pull-xs-right'],
                                    attributes: { disabled: busy },
                                    text: registering ? 'Sign up' : 'Sign in'
                                }
                            ]
                        }
                    ]
                }]
            }]
        }]
    });
};
