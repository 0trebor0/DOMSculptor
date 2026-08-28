import DomSculptor, {
    asyncState,
    computed,
    createDevSculptor,
    errorBoundary,
    signal,
    store,
    tree,
    type AsyncState,
    type ComponentInstance,
    type DomElement
} from 'domsculptor';
import { createTestHarness } from 'domsculptor/testing';
import { createLazyComponent } from 'domsculptor/lazy';
import BrowserDomSculptor from 'domsculptor/browser';
// @ts-expect-error the prebuilt browser entry intentionally exposes only the default runtime
import { signal as browserSignal } from 'domsculptor/browser';

let sculptor = new DomSculptor();
let browserSculptor = new BrowserDomSculptor();
let browserRendering: boolean = browserSculptor.rendering;
let input = sculptor.create('input');
input.html?.select();
let textValue = sculptor.signal('');
textValue.sync(input, (value, nativeInput) => {
    nativeInput.select();
    return String(value);
});
textValue.bind(input, {
    get: nativeInput => nativeInput.value,
    set: (nativeInput, value) => { nativeInput.value = value; }
});
// @ts-expect-error input elements do not expose canvas methods
input.html?.getContext('2d');

let clickTarget = sculptor.create('button');
clickTarget.on('click', event => event.clientX);

let count = signal(0);
let doubled = computed(() => count.get() * 2, [count]);
let form = store({ name: 'Ada', age: 36 });
form.set('age', 37);
// @ts-expect-error age must remain a number
form.set('age', 'old');
// @ts-expect-error unknown store key
form.set('missing', true);
let virtualHost = sculptor.create('div');
sculptor.virtualList([{ id: 1, name: 'Ada' }], virtualHost, {
    rowHeight: 48,
    overscan: 6,
    key: person => person.id,
    render: person => sculptor.create('div').setText(person.name)
});
sculptor.updateVirtualList(virtualHost, [{ id: 2, name: 'Grace' }]);
let scrolled: boolean = sculptor.scrollVirtualList(virtualHost, 0, { align: 'center' });
let scrolledToKey: boolean = sculptor.scrollVirtualList(virtualHost, { key: 2, align: 'nearest' });
let mountedRows: number | undefined = sculptor.virtualListStatus(virtualHost)?.mounted;
sculptor.disposeVirtualList(virtualHost);
// @ts-expect-error rowHeight is required
sculptor.virtualList([], virtualHost, { render: () => sculptor.create('div') });

let appRouter = sculptor.router({
    '/': () => sculptor.create('div'),
    '/posts/:slug': snapshot => sculptor.create('article').setText(snapshot.params.slug)
}, { parent: '#app' });
appRouter.navigate('/posts/hello');
appRouter.replace('/');
let routePath: string = appRouter.current.get().path;
appRouter.stop();
// @ts-expect-error routes must return a view
sculptor.router({ '/': () => 42 });

let hasAge: boolean = form.has('age');
let ageSignal = form.signal('age');
ageSignal.set(38);
// @ts-expect-error per-key signals stay typed
ageSignal.set('old');
let removedAge: boolean = form.delete('age');

let view = tree({ tag: 'section', class: ['panel', 'active'], children: ['safe', input] });
// @ts-expect-error the tree API uses class, not classes
tree({ tag: 'section', classes: ['invalid'] });
let chunkContainer = sculptor.create('ul');
sculptor.createProgressively('li', chunkContainer).setText('one');
let renderingStatus: boolean = sculptor.rendering;
let request: AsyncState<string> = asyncState<string>();
request.run(async ({ signal: abortSignal }) => abortSignal.aborted ? 'cancelled' : 'done');

let Counter = sculptor.component((props: { initial: number }) => ({
    root: sculptor.create('button'),
    api: { count: sculptor.signal(props.initial) }
}));
let SafeCounter = errorBoundary(Counter, () => sculptor.create('p'));
let counter: ComponentInstance<{ count: ReturnType<typeof sculptor.signal<number>> }> =
    SafeCounter({ initial: 1 });
// @ts-expect-error required component props
SafeCounter();

let dev = createDevSculptor();
dev.reportLeaks();
let harness = createTestHarness(null);
harness.mount(sculptor.create('div'));
harness.flush().dispose();

let LazyAccount = createLazyComponent(
    sculptor,
    async () => Counter,
    { loading: 'Loading account' }
);
let lazyAccount = LazyAccount({ initial: 1 });
lazyAccount.api.status.get().status;

let element: DomElement<HTMLInputElement> = input;
void doubled;
void form;
void view;
void renderingStatus;
void request;
void counter;
void element;
void textValue;
void browserSculptor;
void browserRendering;
void browserSignal;
