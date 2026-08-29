import { api } from '../api.js';
import { defaultImage, formatDate, tagPills } from '../parts.js';

let profileHref = username => `#/profile/${encodeURIComponent(username)}`;

export let articleView = ({ sculptor, session, navigate, params, scope }) => {
    let slug = params.slug;
    let article = sculptor.signal(null);
    let following = sculptor.signal(false);
    let favorited = sculptor.signal(false);
    let favoritesCount = sculptor.signal(0);
    let comments = sculptor.signal([]);
    let failure = sculptor.signal(null);

    let isAuthor = () => {
        let current = session.user.get();
        return Boolean(current && article.get() && current.username === article.get().author.username);
    };

    let requireLogin = () => {
        if (session.authenticated) return false;
        navigate('/login');
        return true;
    };

    let toggleFollow = async () => {
        if (requireLogin()) return;
        let call = following.get() ? api.unfollow : api.follow;
        let { profile } = await call(article.get().author.username, session.options());
        if (!scope.disposed) following.set(profile.following);
    };

    let toggleFavorite = async () => {
        if (requireLogin()) return;
        let call = favorited.get() ? api.unfavorite : api.favorite;
        let payload = await call(slug, session.options());
        if (scope.disposed) return;
        favorited.set(payload.article.favorited);
        favoritesCount.set(payload.article.favoritesCount);
    };

    let remove = async () => {
        await api.deleteArticle(slug, session.options());
        navigate('/');
    };

    // The meta block appears twice on this page, once in the banner and once under
    // the body, so it is built by a factory rather than copied.
    let meta = () => {
        let author = article.get().author;
        let children = [
            {
                tag: 'a',
                attributes: { href: profileHref(author.username) },
                children: [{ tag: 'img', attributes: { src: author.image || defaultImage } }]
            },
            {
                tag: 'div',
                class: 'info',
                children: [
                    {
                        tag: 'a',
                        class: 'author',
                        attributes: { href: profileHref(author.username) },
                        text: author.username
                    },
                    { tag: 'span', class: 'date', text: formatDate(article.get().createdAt) }
                ]
            }
        ];

        if (isAuthor()) {
            children.push({
                tag: 'a',
                class: ['btn', 'btn-outline-secondary', 'btn-sm'],
                attributes: { href: `#/editor/${encodeURIComponent(slug)}` },
                children: [{ tag: 'i', class: 'ion-edit' }, { tag: 'span', text: ' Edit Article' }]
            }, {
                tag: 'button',
                class: ['btn', 'btn-outline-danger', 'btn-sm'],
                on: { click: remove },
                children: [{ tag: 'i', class: 'ion-trash-a' }, { tag: 'span', text: ' Delete Article' }]
            });
        } else {
            children.push({
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
                        text: sculptor.computed(() =>
                            ` ${following.get() ? 'Unfollow' : 'Follow'} ${author.username}`)
                    }
                ]
            }, {
                tag: 'button',
                class: {
                    btn: true,
                    'btn-sm': true,
                    'btn-primary': favorited,
                    'btn-outline-primary': sculptor.computed(() => !favorited.get())
                },
                on: { click: toggleFavorite },
                children: [
                    { tag: 'i', class: 'ion-heart' },
                    {
                        tag: 'span',
                        text: sculptor.computed(() =>
                            ` ${favorited.get() ? 'Unfavorite' : 'Favorite'} Article (${favoritesCount.get()})`)
                    }
                ]
            });
        }
        return sculptor.tree({ tag: 'div', class: 'article-meta', children });
    };

    // The API returns markdown. Rendering it would mean either a dependency or a
    // hand-rolled parser writing HTML from user input, so paragraphs are rendered
    // as text and everything else is left as written.
    let renderBody = text => sculptor.tree({
        tag: 'div',
        children: String(text || '').split(/\n{2,}/).map(paragraph => ({ tag: 'p', text: paragraph }))
    });

    let commentCard = comment => {
        let footer = [
            {
                tag: 'a',
                class: 'comment-author',
                attributes: { href: profileHref(comment.author.username) },
                children: [{
                    tag: 'img',
                    class: 'comment-author-img',
                    attributes: { src: comment.author.image || defaultImage }
                }]
            },
            {
                tag: 'a',
                class: 'comment-author',
                attributes: { href: profileHref(comment.author.username) },
                text: ` ${comment.author.username}`
            },
            { tag: 'span', class: 'date-posted', text: formatDate(comment.createdAt) }
        ];
        let current = session.user.get();
        if (current && current.username === comment.author.username) {
            footer.push({
                tag: 'span',
                class: 'mod-options',
                children: [{
                    tag: 'i',
                    class: 'ion-trash-a',
                    on: {
                        click: async () => {
                            await api.deleteComment(slug, comment.id, session.options());
                            if (!scope.disposed) {
                                comments.set(comments.get().filter(other => other.id !== comment.id));
                            }
                        }
                    }
                }]
            });
        }
        return sculptor.tree({
            tag: 'div',
            class: 'card',
            children: [
                {
                    tag: 'div',
                    class: 'card-block',
                    children: [{ tag: 'p', class: 'card-text', text: comment.body }]
                },
                { tag: 'div', class: 'card-footer', children: footer }
            ]
        });
    };

    let commentBox = () => {
        if (!session.authenticated) {
            return sculptor.tree({
                tag: 'p',
                children: [
                    { tag: 'a', attributes: { href: '#/login' }, text: 'Sign in' },
                    { tag: 'span', text: ' or ' },
                    { tag: 'a', attributes: { href: '#/register' }, text: 'sign up' },
                    { tag: 'span', text: ' to add comments on this article.' }
                ]
            });
        }
        let formRefs = {};
        let current = session.user.get();
        return sculptor.tree({
            tag: 'form',
            class: ['card', 'comment-form'],
            refs: formRefs,
            on: {
                submit: async event => {
                    event.preventDefault();
                    let text = formRefs.body.getValue().trim();
                    if (!text) return;
                    let { comment } = await api.addComment(slug, text, session.options());
                    if (scope.disposed) return;
                    comments.set([comment].concat(comments.get()));
                    formRefs.body.setValue('');
                }
            },
            children: [
                {
                    tag: 'div',
                    class: 'card-block',
                    children: [{
                        tag: 'textarea',
                        ref: 'body',
                        class: 'form-control',
                        attributes: { rows: '3', placeholder: 'Write a comment...' }
                    }]
                },
                {
                    tag: 'div',
                    class: 'card-footer',
                    children: [
                        {
                            tag: 'img',
                            class: 'comment-author-img',
                            attributes: { src: current?.image || defaultImage }
                        },
                        { tag: 'button', class: ['btn', 'btn-sm', 'btn-primary'], text: 'Post Comment' }
                    ]
                }
            ]
        });
    };

    // The skeleton is built once. Only the parts that depend on the loaded article
    // are refilled, and the comment list is declared as reactive children so it is
    // never rebuilt by hand.
    let refs = {};
    let root = sculptor.tree({
        tag: 'div',
        class: 'article-page',
        refs,
        children: [
            { tag: 'div', class: 'banner', children: [{ tag: 'div', class: 'container', ref: 'banner' }] },
            {
                tag: 'div',
                class: ['container', 'page'],
                children: [
                    { tag: 'div', ref: 'body' },
                    {
                        tag: 'div',
                        class: 'row',
                        children: [{
                            tag: 'div',
                            class: ['col-xs-12', 'col-md-8', 'offset-md-2'],
                            children: [
                                { tag: 'div', ref: 'commentBox' },
                                {
                                    tag: 'div',
                                    children: {
                                        each: comments,
                                        key: comment => comment.id,
                                        render: commentCard
                                    }
                                }
                            ]
                        }]
                    }
                ]
            }
        ]
    });

    let render = () => {
        refs.banner.child.clear();
        refs.body.child.clear();
        if (failure.get()) {
            return void refs.body.child.append(sculptor.tree({
                tag: 'p',
                text: `Could not load this article: ${failure.get()}`
            }));
        }
        let value = article.get();
        if (!value) return void refs.body.child.append(sculptor.tree({ tag: 'p', text: 'Loading article...' }));

        refs.banner.child.append(sculptor.tree({ tag: 'h1', text: value.title }));
        refs.banner.child.append(meta());
        refs.body.child.append(sculptor.tree({
            tag: 'div',
            class: ['row', 'article-content'],
            children: [{
                tag: 'div',
                class: 'col-md-12',
                children: [
                    renderBody(value.body),
                    tagPills(sculptor, value.tagList, ['tag-default', 'tag-pill', 'tag-outline'])
                ]
            }]
        }));
        refs.body.child.append(sculptor.tree({ tag: 'hr' }));
        refs.body.child.append(sculptor.tree({ tag: 'div', class: 'article-actions', children: [meta()] }));
        refs.commentBox.child.clear();
        refs.commentBox.child.append(commentBox());
    };

    render();
    article.subscribe(render);
    failure.subscribe(render);

    Promise.all([
        api.article(slug, session.options()),
        api.comments(slug, session.options())
    ]).then(([articlePayload, commentPayload]) => {
        if (scope.disposed) return;
        following.set(articlePayload.article.author.following);
        favorited.set(articlePayload.article.favorited);
        favoritesCount.set(articlePayload.article.favoritesCount);
        comments.set(commentPayload.comments || []);
        article.set(articlePayload.article);
    }).catch(error => {
        if (!scope.disposed) failure.set(error.message);
    });

    return root;
};
