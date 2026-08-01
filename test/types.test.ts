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
let browserEachContainer = browserSculptor.create('ul');
let browserEachRender = browserSculptor.renderEach([1], browserEachContainer, {
    render: item => browserSculptor.create('li').setText(item)
});
let input = sculptor.create('input');
input.html?.select();
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

let view = tree({ tag: 'section', class: ['panel', 'active'], children: ['safe', input] });
// @ts-expect-error the tree API uses class, not classes
tree({ tag: 'section', classes: ['invalid'] });
let chunkContainer = sculptor.create('ul');
let chunkRender: Promise<typeof chunkContainer> = sculptor.renderEach(
    [{ label: 'one' }],
    chunkContainer,
    {
        render: item => sculptor.create('li').setText(item.label)
    }
);
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
void chunkRender;
void request;
void counter;
void element;
void browserSculptor;
void browserEachRender;
void browserSignal;
