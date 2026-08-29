import { api } from './api.js';

export let formatDate = value => {
    let date = new Date(value);
    return Number.isNaN(date.getTime())
        ? ''
        : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

export let defaultImage = 'https://api.realworld.io/images/smiley-cyrus.jpeg';

// The specification's error shape is { field: [message, ...] }, rendered as
// "field message" lines above the form.
export let errorMessages = (sculptor, errors) => sculptor.tree({
    tag: 'ul',
    class: 'error-messages',
    children: Object.entries(errors || {}).flatMap(([field, messages]) =>
        [].concat(messages).map(message => ({ tag: 'li', text: `${field} ${message}` }))
    )
});

export let tagPills = (sculptor, tags, className) => sculptor.tree({
    tag: 'ul',
    class: 'tag-list',
    children: (tags || []).map(tag => ({ tag: 'li', class: className, text: tag }))
});

export let articlePreview = (sculptor, article, { session, navigate }) => {
    let favorited = sculptor.signal(article.favorited);
    let count = sculptor.signal(article.favoritesCount);
    let pending = false;

    let toggle = async () => {
        if (!session.authenticated) return navigate('/login');
        if (pending) return;
        pending = true;
        let wasFavorited = favorited.get();
        // The count moves immediately and is corrected from the response, so a
        // slow network does not make the button feel dead.
        favorited.set(!wasFavorited);
        count.update(value => value + (wasFavorited ? -1 : 1));
        try {
            let call = wasFavorited ? api.unfavorite : api.favorite;
            let { article: updated } = await call(article.slug, session.options());
            favorited.set(updated.favorited);
            count.set(updated.favoritesCount);
        } catch {
            favorited.set(wasFavorited);
            count.update(value => value + (wasFavorited ? 1 : -1));
        } finally {
            pending = false;
        }
    };

    let button = sculptor.tree({
        tag: 'button',
        class: ['btn', 'btn-sm', 'pull-xs-right'],
        on: { click: toggle },
        children: [
            { tag: 'i', class: 'ion-heart' },
            { tag: 'span', text: ' ' }
        ]
    });
    button.child.append(sculptor.createDetached('span').text(count));
    button.classToggle('btn-primary', sculptor.computed(() => favorited.get()));
    button.classToggle('btn-outline-primary', sculptor.computed(() => !favorited.get()));

    let author = article.author;
    let preview = sculptor.tree({
        tag: 'div',
        class: 'article-preview',
        children: [
            {
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
                            { tag: 'span', class: 'date', text: formatDate(article.createdAt) }
                        ]
                    }
                ]
            },
            {
                tag: 'a',
                class: 'preview-link',
                attributes: { href: `#/article/${encodeURIComponent(article.slug)}` },
                children: [
                    { tag: 'h1', text: article.title },
                    { tag: 'p', text: article.description },
                    { tag: 'span', text: 'Read more...' }
                ]
            }
        ]
    });
    preview.child.find('.article-meta').child.append(button);
    preview.child.find('.preview-link').child.append(
        tagPills(sculptor, article.tagList, ['tag-default', 'tag-pill', 'tag-outline'])
    );
    return preview;
};

export let pagination = (sculptor, { total, limit, page, onSelect }) => {
    let pages = Math.ceil(total / limit);
    if (pages <= 1) return null;
    return sculptor.tree({
        tag: 'nav',
        children: [{
            tag: 'ul',
            class: 'pagination',
            children: Array.from({ length: pages }, (unused, index) => ({
                tag: 'li',
                class: index === page ? ['page-item', 'active'] : 'page-item',
                children: [{
                    tag: 'a',
                    class: 'page-link',
                    attributes: { href: '' },
                    text: String(index + 1),
                    on: {
                        click: event => {
                            event.preventDefault();
                            onSelect(index);
                        }
                    }
                }]
            }))
        }]
    });
};

// Every list in the app - both home feeds and both profile tabs - renders the
// same four states, so they share one renderer driven by an asyncState.
export let articleListView = (sculptor, { state, limit, page, onPage, session, navigate, emptyText }) => {
    let container = sculptor.createDetached('div');
    let render = snapshot => {
        container.child.clear();
        if (snapshot.status === 'loading' || snapshot.status === 'idle') {
            container.child.append(sculptor.tree({ tag: 'div', class: 'article-preview', text: 'Loading articles...' }));
            return;
        }
        if (snapshot.status === 'error') {
            container.child.append(sculptor.tree({
                tag: 'div',
                class: 'article-preview',
                text: `Could not load articles: ${snapshot.error?.message || 'unknown error'}`
            }));
            return;
        }
        let { articles = [], articlesCount = 0 } = snapshot.data || {};
        if (!articles.length) {
            container.child.append(sculptor.tree({ tag: 'div', class: 'article-preview', text: emptyText }));
            return;
        }
        articles.forEach(article => {
            container.child.append(articlePreview(sculptor, article, { session, navigate }));
        });
        let pager = pagination(sculptor, { total: articlesCount, limit, page: page.get(), onSelect: onPage });
        if (pager) container.child.append(pager);
    };
    state.subscribe(render, { immediate: true });
    return container;
};
