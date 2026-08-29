import { api } from '../api.js';
import { errorLines, errorList } from '../parts.js';

export let editorView = ({ sculptor, session, navigate, params, scope }) => {
    if (!session.authenticated) {
        navigate('/login');
        return sculptor.createDetached('div');
    }

    let slug = params.slug || null;
    let failures = sculptor.signal([]);
    let busy = sculptor.signal(false);
    let tags = sculptor.signal([]);

    let send = async event => {
        event.preventDefault();
        if (busy.get()) return;
        busy.set(true);
        failures.set([]);
        try {
            let article = {
                title: refs.title.getValue(),
                description: refs.description.getValue(),
                body: refs.body.getValue(),
                tagList: tags.get()
            };
            let payload = slug
                ? await api.updateArticle(slug, article, session.options())
                : await api.createArticle(article, session.options());
            navigate(`/article/${encodeURIComponent(payload.article.slug)}`);
        } catch (error) {
            if (!scope.disposed) failures.set(errorLines(error));
        } finally {
            if (!scope.disposed) busy.set(false);
        }
    };

    let addTag = event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        let value = refs.tag.getValue().trim();
        if (!value || tags.get().includes(value)) return;
        tags.set(tags.get().concat(value));
        refs.tag.setValue('');
    };

    let refs = {};
    let root = sculptor.tree({
        tag: 'div',
        class: 'editor-page',
        refs,
        children: [{
            tag: 'div',
            class: ['container', 'page'],
            children: [{
                tag: 'div',
                class: 'row',
                children: [{
                    tag: 'div',
                    class: ['col-md-10', 'offset-md-1', 'col-xs-12'],
                    children: [
                        errorList(sculptor, failures),
                        {
                            tag: 'form',
                            on: { submit: send },
                            children: [{
                                tag: 'fieldset',
                                children: [
                                    {
                                        tag: 'fieldset',
                                        class: 'form-group',
                                        children: [{
                                            tag: 'input',
                                            ref: 'title',
                                            class: ['form-control', 'form-control-lg'],
                                            attributes: { type: 'text', placeholder: 'Article Title' }
                                        }]
                                    },
                                    {
                                        tag: 'fieldset',
                                        class: 'form-group',
                                        children: [{
                                            tag: 'input',
                                            ref: 'description',
                                            class: 'form-control',
                                            attributes: { type: 'text', placeholder: "What's this article about?" }
                                        }]
                                    },
                                    {
                                        tag: 'fieldset',
                                        class: 'form-group',
                                        children: [{
                                            tag: 'textarea',
                                            ref: 'body',
                                            class: 'form-control',
                                            attributes: { rows: '8', placeholder: 'Write your article (in markdown)' }
                                        }]
                                    },
                                    {
                                        tag: 'fieldset',
                                        class: 'form-group',
                                        children: [
                                            {
                                                tag: 'input',
                                                ref: 'tag',
                                                class: 'form-control',
                                                attributes: { type: 'text', placeholder: 'Enter tags' },
                                                on: { keydown: addTag }
                                            },
                                            {
                                                tag: 'div',
                                                class: 'tag-list',
                                                children: {
                                                    each: tags,
                                                    key: name => name,
                                                    render: name => sculptor.tree({
                                                        tag: 'span',
                                                        class: ['tag-default', 'tag-pill'],
                                                        children: [
                                                            {
                                                                tag: 'i',
                                                                class: 'ion-close-round',
                                                                on: {
                                                                    click: () => tags.set(
                                                                        tags.get().filter(other => other !== name)
                                                                    )
                                                                }
                                                            },
                                                            { tag: 'span', text: name }
                                                        ]
                                                    })
                                                }
                                            }
                                        ]
                                    },
                                    {
                                        tag: 'button',
                                        class: ['btn', 'btn-lg', 'pull-xs-right', 'btn-primary'],
                                        attributes: { disabled: busy },
                                        text: 'Publish Article'
                                    }
                                ]
                            }]
                        }
                    ]
                }]
            }]
        }]
    });

    if (slug) {
        api.article(slug, session.options()).then(({ article }) => {
            if (scope.disposed) return;
            refs.title.setValue(article.title);
            refs.description.setValue(article.description);
            refs.body.setValue(article.body);
            tags.set(article.tagList || []);
        }).catch(error => {
            if (!scope.disposed) failures.set(errorLines(error));
        });
    }

    return root;
};
