import { api } from '../api.js';
import { defaultImage, formatDate, tagPills } from '../parts.js';

export let articleView = ({ sculptor, session, navigate, params }) => {
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
        let username = article.get().author.username;
        let call = following.get() ? api.unfollow : api.follow;
        let { profile } = await call(username, session.options());
        following.set(profile.following);
    };

    let toggleFavorite = async () => {
        if (requireLogin()) return;
        let call = favorited.get() ? api.unfavorite : api.favorite;
        let payload = await call(slug, session.options());
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
        let value = article.get();
        let author = value.author;
        let block = sculptor.tree({
            tag: 'div',
            class: 'article-meta',
            children: [
                {
                    tag: 'a',
                    attributes: { href: `#/profile/${encodeURIComponent(author.username)}` },
                    children: [{ tag: 'img', attributes: { src: author.image || defaultImage } }]
                },
                {
                    tag: 'div',
                    class: 'info',
                    children: [
                        {
                            tag: 'a',
                            class: 'author',
                            attributes: { href: `#/profile/${encodeURIComponent(author.username)}` },
                            text: author.username
                        },
                        { tag: 'span', class: 'date', text: formatDate(value.createdAt) }
                    ]
                }
            ]
        });

        if (isAuthor()) {
            block.child.append(sculptor.tree({
                tag: 'a',
                class: ['btn', 'btn-outline-secondary', 'btn-sm'],
                attributes: { href: `#/editor/${encodeURIComponent(slug)}` },
                children: [{ tag: 'i', class: 'ion-edit' }, { tag: 'span', text: ' Edit Article' }]
            }));
            block.child.append(sculptor.tree({
                tag: 'button',
                class: ['btn', 'btn-outline-danger', 'btn-sm'],
                on: { click: remove },
                children: [{ tag: 'i', class: 'ion-trash-a' }, { tag: 'span', text: ' Delete Article' }]
            }));
            return block;
        }

        let follow = sculptor.tree({
            tag: 'button',
            class: ['btn', 'btn-sm', 'action-btn'],
            on: { click: toggleFollow },
            children: [{ tag: 'i', class: 'ion-plus-round' }]
        });
        follow.child.append(sculptor.createDetached('span').text(sculptor.computed(() =>
            ` ${following.get() ? 'Unfollow' : 'Follow'} ${author.username}`
        )));
        follow.classToggle('btn-secondary', sculptor.computed(() => following.get()));
        follow.classToggle('btn-outline-secondary', sculptor.computed(() => !following.get()));

        let favorite = sculptor.tree({
            tag: 'button',
            class: ['btn', 'btn-sm'],
            on: { click: toggleFavorite },
            children: [{ tag: 'i', class: 'ion-heart' }]
        });
        favorite.child.append(sculptor.createDetached('span').text(sculptor.computed(() =>
            ` ${favorited.get() ? 'Unfavorite' : 'Favorite'} Article (${favoritesCount.get()})`
        )));
        favorite.classToggle('btn-primary', sculptor.computed(() => favorited.get()));
        favorite.classToggle('btn-outline-primary', sculptor.computed(() => !favorited.get()));

        block.child.append(follow);
        block.child.append(favorite);
        return block;
    };

    // The API returns markdown. Rendering it would mean either a dependency or a
    // hand-rolled parser writing HTML from user input, so paragraphs are rendered
    // as text and everything else is left as written.
    let renderBody = text => sculptor.tree({
        tag: 'div',
        children: String(text || '').split(/\n{2,}/).map(paragraph => ({ tag: 'p', text: paragraph }))
    });

    let commentCard = comment => {
        let card = sculptor.tree({
            tag: 'div',
            class: 'card',
            children: [
                {
                    tag: 'div',
                    class: 'card-block',
                    children: [{ tag: 'p', class: 'card-text', text: comment.body }]
                },
                {
                    tag: 'div',
                    class: 'card-footer',
                    children: [
                        {
                            tag: 'a',
                            class: 'comment-author',
                            attributes: { href: `#/profile/${encodeURIComponent(comment.author.username)}` },
                            children: [{
                                tag: 'img',
                                class: 'comment-author-img',
                                attributes: { src: comment.author.image || defaultImage }
                            }]
                        },
                        {
                            tag: 'a',
                            class: 'comment-author',
                            attributes: { href: `#/profile/${encodeURIComponent(comment.author.username)}` },
                            text: ` ${comment.author.username}`
                        },
                        { tag: 'span', class: 'date-posted', text: formatDate(comment.createdAt) }
                    ]
                }
            ]
        });
        let current = session.user.get();
        if (current && current.username === comment.author.username) {
            card.child.find('.card-footer').child.append(sculptor.tree({
                tag: 'span',
                class: 'mod-options',
                children: [{
                    tag: 'i',
                    class: 'ion-trash-a',
                    on: {
                        click: async () => {
                            await api.deleteComment(slug, comment.id, session.options());
                            comments.set(comments.get().filter(other => other.id !== comment.id));
                        }
                    }
                }]
            }));
        }
        return card;
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
        let area = sculptor.tree({
            tag: 'textarea',
            class: 'form-control',
            attributes: { rows: '3', placeholder: 'Write a comment...' }
        });
        let form = sculptor.tree({
            tag: 'form',
            class: ['card', 'comment-form'],
            on: {
                submit: async event => {
                    event.preventDefault();
                    let text = area.getValue().trim();
                    if (!text) return;
                    let { comment } = await api.addComment(slug, text, session.options());
                    comments.set([comment].concat(comments.get()));
                    area.setValue('');
                }
            }
        });
        let block = sculptor.tree({ tag: 'div', class: 'card-block' });
        block.child.append(area);
        form.child.append(block);
        let current = session.user.get();
        form.child.append(sculptor.tree({
            tag: 'div',
            class: 'card-footer',
            children: [
                { tag: 'img', class: 'comment-author-img', attributes: { src: current?.image || defaultImage } },
                { tag: 'button', class: ['btn', 'btn-sm', 'btn-primary'], text: 'Post Comment' }
            ]
        }));
        return form;
    };

    // The page skeleton is built once. Only the parts that depend on the loaded
    // article are cleared and refilled, so the comment list keeps its identity and
    // its single subscription instead of acquiring a new one per render.
    let root = sculptor.tree({
        tag: 'div',
        class: 'article-page',
        children: [
            { tag: 'div', class: 'banner', children: [{ tag: 'div', class: 'container' }] },
            {
                tag: 'div',
                class: ['container', 'page'],
                children: [
                    { tag: 'div', class: 'article-body' },
                    {
                        tag: 'div',
                        class: 'row',
                        children: [{
                            tag: 'div',
                            class: ['col-xs-12', 'col-md-8', 'offset-md-2'],
                            children: [
                                { tag: 'div', class: 'comment-box' },
                                { tag: 'div', class: 'comment-list' }
                            ]
                        }]
                    }
                ]
            }
        ]
    });
    let banner = root.child.find('.banner .container');
    let articleBody = root.child.find('.article-body');
    let commentBoxSlot = root.child.find('.comment-box');
    let commentList = root.child.find('.comment-list');

    comments.subscribe(items => {
        if (!commentList.html) return;
        commentList.child.clear();
        items.forEach(comment => commentList.child.append(commentCard(comment)));
    }, { immediate: true });

    let render = () => {
        let value = article.get();
        banner.child.clear();
        articleBody.child.clear();
        if (failure.get()) {
            articleBody.child.append(sculptor.tree({
                tag: 'p',
                text: `Could not load this article: ${failure.get()}`
            }));
            return;
        }
        if (!value) {
            articleBody.child.append(sculptor.tree({ tag: 'p', text: 'Loading article...' }));
            return;
        }
        banner.child.append(sculptor.tree({ tag: 'h1', text: value.title }));
        banner.child.append(meta());

        let content = sculptor.tree({
            tag: 'div',
            class: ['row', 'article-content'],
            children: [{ tag: 'div', class: 'col-md-12' }]
        });
        let column = content.child.find('.col-md-12');
        column.child.append(renderBody(value.body));
        column.child.append(tagPills(sculptor, value.tagList, ['tag-default', 'tag-pill', 'tag-outline']));
        articleBody.child.append(content);
        articleBody.child.append(sculptor.tree({ tag: 'hr' }));

        let actions = sculptor.tree({ tag: 'div', class: 'article-actions' });
        actions.child.append(meta());
        articleBody.child.append(actions);

        commentBoxSlot.child.clear();
        commentBoxSlot.child.append(commentBox());
    };

    render();
    article.subscribe(render);
    failure.subscribe(render);

    Promise.all([
        api.article(slug, session.options()),
        api.comments(slug, session.options())
    ]).then(([articlePayload, commentPayload]) => {
        if (!root.html) return;
        following.set(articlePayload.article.author.following);
        favorited.set(articlePayload.article.favorited);
        favoritesCount.set(articlePayload.article.favoritesCount);
        comments.set(commentPayload.comments || []);
        article.set(articlePayload.article);
    }).catch(error => {
        if (root.html) failure.set(error.message);
    });

    return root;
};
