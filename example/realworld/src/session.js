import { api } from './api.js';

let storageKey = 'domsculptor-realworld-token';

// One session object is created by main.js and passed to every view. It holds
// the token and the current user, and it is the only thing in the app that
// touches localStorage.
export let createSession = sculptor => {
    let read = () => {
        try { return localStorage.getItem(storageKey); } catch { return null; }
    };
    let write = value => {
        try {
            if (value) localStorage.setItem(storageKey, value);
            else localStorage.removeItem(storageKey);
        } catch { /* private browsing; the session simply does not persist */ }
    };

    let token = sculptor.signal(read());
    let user = sculptor.signal(null);
    let ready = sculptor.signal(false);

    let session = {
        token,
        user,
        ready,
        get authenticated() { return Boolean(token.get()); },
        options() { return { token: token.get() }; },
        adopt(payload) {
            token.set(payload.token);
            write(payload.token);
            user.set(payload);
        },
        update(payload) {
            if (payload.token) {
                token.set(payload.token);
                write(payload.token);
            }
            user.set(payload);
        },
        clear() {
            token.set(null);
            write(null);
            user.set(null);
        },
        async restore() {
            if (!token.get()) {
                ready.set(true);
                return;
            }
            try {
                let payload = await api.currentUser({ token: token.get() });
                user.set(payload.user);
            } catch {
                // An expired or revoked token should log the reader out rather than
                // leaving the app in a half-authenticated state.
                session.clear();
            } finally {
                ready.set(true);
            }
        }
    };
    return session;
};
