import { api, ApiError } from '../api.js';
import { errorMessages } from '../parts.js';

export let editorView = ({ sculptor, session, navigate, params }) => {
    if (!session.authenticated) {
        navigate('/login');
        return sculptor.createDetached('div');
    }

    let slug = params.slug || null;
    let errors = sculptor.signal(null);
    let busy = sculptor.signal(false);
    let tags = sculptor.signal([]);

    let title = sculptor.tree({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'input',
            class: ['form-control', 'form-control-lg'],
            attributes: { type: 'text', placeholder: 'Article Title' }
        }]
    });
    let description = sculptor.tree({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'input',
            class: 'form-control',
            attributes: { type: 'text', placeholder: "What's this article about?" }
        }]
    });
    let body = sculptor.tree({
        tag: 'fieldset',
        class: 'form-group',
        children: [{
            tag: 'textarea',
            class: 'form-control',
            attributes: { rows: '8', placeholder: 'Write your article (in markdown)' }
        }]
    });

    let tagInput = sculptor.tree({
        tag: 'input',
        class: 'form-control',
        attributes: { type: 'text', placeholder: 'Enter tags' },
        on: {
            keydown: event => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                let value = tagInput.getValue().trim();
                if (!value || tags.get().includes(value)) return;
                tags.set(tags.get().concat(value));
                tagInput.setValue('');
            }
        }
    });
    let tagList = sculptor.createDetached('div');
    tagList.class.add('tag-list');
    tags.subscribe(names => {
        tagList.child.clear();
        names.forEach(name => {
            tagList.child.append(sculptor.tree({
                tag: 'span',
                class: ['tag-default', 'tag-pill'],
                children: [
                    {
                        tag: 'i',
                        class: 'ion-close-round',
                        on: { click: () => tags.set(tags.get().filter(other => other !== name)) }
                    },
                    { tag: 'span', text: name }
                ]
            }));
        });
    }, { immediate: true });

    let tagField = sculptor.tree({ tag: 'fieldset', class: 'form-group' });
    tagField.child.append(tagInput);
    tagField.child.append(tagList);

    let submit = sculptor.tree({
        tag: 'button',
        class: ['btn', 'btn-lg', 'pull-xs-right', 'btn-primary'],
        text: 'Publish Article'
    });
    submit.attr('disabled', busy);

    let control = wrapper => wrapper.child.find('input') || wrapper.child.find('textarea');

    let send = async event => {
        event.preventDefault();
        if (busy.get()) return;
        busy.set(true);
        errors.set(null);
        try {
            let article = {
                title: control(title).getValue(),
                description: control(description).getValue(),
                body: control(body).getValue(),
                tagList: tags.get()
            };
            let payload = slug
                ? await api.updateArticle(slug, article, session.options())
                : await api.createArticle(article, session.options());
            navigate(`/article/${encodeURIComponent(payload.article.slug)}`);
        } catch (error) {
            errors.set(error instanceof ApiError && error.errors
                ? error.errors
                : { request: [error.message || 'failed'] });
        } finally {
            busy.set(false);
        }
    };

    let group = sculptor.tree({ tag: 'fieldset' });
    [title, description, body, tagField].forEach(part => group.child.append(part));
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
        class: 'editor-page',
        children: [{
            tag: 'div',
            class: ['container', 'page'],
            children: [{
                tag: 'div',
                class: 'row',
                children: [{ tag: 'div', class: ['col-md-10', 'offset-md-1', 'col-xs-12'] }]
            }]
        }]
    });
    let column = root.child.find('.col-md-10');
    column.child.append(errorSlot);
    column.child.append(form);

    if (slug) {
        api.article(slug, session.options()).then(({ article }) => {
            // The view can be disposed while this is in flight; writing to a
            // disposed element throws, so the guard is on the element, not a flag.
            if (!root.html) return;
            control(title).setValue(article.title);
            control(description).setValue(article.description);
            control(body).setValue(article.body);
            tags.set(article.tagList || []);
        }).catch(error => {
            if (root.html) errors.set({ article: [error.message] });
        });
    }

    return root;
};
