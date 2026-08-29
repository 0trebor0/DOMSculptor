// The RealWorld demo API. api.realworld.io was returning 530 when this was
// written; api.realworld.show serves the same specification and is the one the
// project currently points people at.
export let base = 'https://api.realworld.show/api';

export class ApiError extends Error {
    constructor(status, payload) {
        // The specification returns { errors: { field: [message, ...] } }, which is
        // what every form in this app renders, so it is kept rather than flattened
        // into a single message.
        let errors = payload && typeof payload.errors === 'object' ? payload.errors : null;
        let summary = errors
            ? Object.entries(errors).map(([field, messages]) => `${field} ${[].concat(messages).join(', ')}`).join('; ')
            : `Request failed with status ${status}`;
        super(summary);
        this.name = 'ApiError';
        this.status = status;
        this.errors = errors;
    }
}

let request = async (method, path, { body = null, token = null, signal = null } = {}) => {
    let headers = {};
    if (body != null) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Token ${token}`;
    let response = await fetch(base + path, {
        method,
        headers,
        signal,
        body: body == null ? undefined : JSON.stringify(body)
    });
    if (response.status === 204) return null;
    let payload = await response.json().catch(() => null);
    if (!response.ok) throw new ApiError(response.status, payload);
    return payload;
};

let query = params => {
    let search = new URLSearchParams();
    for (let [name, value] of Object.entries(params)) {
        if (value != null && value !== '') search.set(name, String(value));
    }
    let text = search.toString();
    return text ? `?${text}` : '';
};

export let api = {
    login: (credentials, options) => request('POST', '/users/login', { ...options, body: { user: credentials } }),
    register: (details, options) => request('POST', '/users', { ...options, body: { user: details } }),
    currentUser: options => request('GET', '/user', options),
    updateUser: (details, options) => request('PUT', '/user', { ...options, body: { user: details } }),

    articles: (params, options) => request('GET', `/articles${query(params)}`, options),
    feed: (params, options) => request('GET', `/articles/feed${query(params)}`, options),
    article: (slug, options) => request('GET', `/articles/${encodeURIComponent(slug)}`, options),
    createArticle: (article, options) => request('POST', '/articles', { ...options, body: { article } }),
    updateArticle: (slug, article, options) =>
        request('PUT', `/articles/${encodeURIComponent(slug)}`, { ...options, body: { article } }),
    deleteArticle: (slug, options) => request('DELETE', `/articles/${encodeURIComponent(slug)}`, options),

    favorite: (slug, options) => request('POST', `/articles/${encodeURIComponent(slug)}/favorite`, options),
    unfavorite: (slug, options) => request('DELETE', `/articles/${encodeURIComponent(slug)}/favorite`, options),

    comments: (slug, options) => request('GET', `/articles/${encodeURIComponent(slug)}/comments`, options),
    addComment: (slug, body, options) =>
        request('POST', `/articles/${encodeURIComponent(slug)}/comments`, { ...options, body: { comment: { body } } }),
    deleteComment: (slug, id, options) =>
        request('DELETE', `/articles/${encodeURIComponent(slug)}/comments/${id}`, options),

    profile: (username, options) => request('GET', `/profiles/${encodeURIComponent(username)}`, options),
    follow: (username, options) => request('POST', `/profiles/${encodeURIComponent(username)}/follow`, options),
    unfollow: (username, options) => request('DELETE', `/profiles/${encodeURIComponent(username)}/follow`, options),

    tags: options => request('GET', '/tags', options)
};
