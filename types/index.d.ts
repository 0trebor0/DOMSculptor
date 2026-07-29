export type Unsubscribe = () => void;
export type DomChild = DomElement | Node | string;
export type ElementForTag<K extends string> =
    K extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[K] :
    K extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[K] :
    HTMLElement;

export interface DevelopmentWarning {
    code: string;
    message: string;
    details?: unknown;
}

export interface DomSculptorOptions {
    development?: boolean;
    onWarning?: (warning: DevelopmentWarning) => void;
}

export interface SubscriptionOptions {
    immediate?: boolean;
    signal?: AbortSignal;
}

export interface Readable<T> {
    get(): T;
    subscribe(callback: (value: T, previous?: T) => void, options?: SubscriptionOptions): Unsubscribe;
}

export interface DisposalScope {
    track<T extends () => unknown>(cleanup: T): T;
    run<T>(callback: () => T): T;
    dispose(): void;
    readonly disposed: boolean;
}

export type ContextKey<T> = symbol & { readonly __domSculptorType?: T };

export interface Context {
    get<T>(key: ContextKey<T>, fallback?: T): T;
    has(key: symbol): boolean;
    set<T>(key: ContextKey<T>, value: T): this;
    delete(key: symbol): boolean;
    child(initial?: Map<symbol, unknown> | Record<PropertyKey, unknown> | null): Context;
}

export interface ComponentDefinition<A extends object = Record<string, never>> {
    root: DomElement | Node;
    api?: A;
    dispose?: () => void;
}

export interface ComponentInstance<A extends object = Record<string, never>> {
    root: DomElement;
    api: A;
    scope: DisposalScope;
    context: Context;
    name: string;
    createdAt?: string;
    dispose(): void;
    readonly disposed: boolean;
}

export type ComponentResult<A extends object = Record<string, never>> =
    DomElement | Node | ComponentDefinition<A>;

export type ComponentFactory<P, A extends object> =
    keyof P extends never
        ? (props?: P, context?: Context) => ComponentInstance<A>
        : (props: P, context?: Context) => ComponentInstance<A>;

export interface DomAttributes {
    set(name: string | Record<string, unknown>, value?: unknown): DomElement;
    remove(name: string): DomElement;
    get(name: string): string | null;
    has(name: string): boolean;
}

export interface DomClasses {
    add(...values: string[]): DomElement;
    remove(...values: string[]): DomElement;
    toggle(value: string): DomElement;
    contains(value: string): boolean;
}

export interface DomChildren {
    append(child: DomChild): DomElement;
    prepend(child: DomChild): DomElement;
    find(selector: string): DomElement | null;
    findAll(selector: string): DomElement[];
    create<K extends string>(
        name: K,
        callback?: ((element: DomElement<ElementForTag<K>>) => void) | null
    ): DomElement<ElementForTag<K>>;
    remove(): void;
    clear(): DomElement;
    replace(previous: DomElement | Node, next: DomChild): DomElement;
}

export class DomElement<T extends Node = HTMLElement> {
    html: T | null;
    readonly children: readonly DomElement[];
    attribute: DomAttributes;
    class: DomClasses;
    child: DomChildren;

    setText(text: unknown): this;
    text<V>(readable: Readable<V>, transform?: (value: V) => unknown): this;
    attr<V>(name: string, readable: Readable<V>, transform?: (value: V) => unknown): this;
    classToggle<V>(name: string, readable: Readable<V>, transform?: (value: V) => boolean): this;
    styleValue<V>(name: string, readable: Readable<V>, transform?: (value: V) => unknown): this;
    getValue(): unknown;
    setValue(value: unknown): this;
    setStyle(property: string | Record<string, unknown>, value?: unknown): this;
    hide(): this;
    show(): this;
    focus(options?: FocusOptions): this;
    blur(): this;
    isFocused(): boolean;
    parent(): DomElement | null;
    closest(selector: string): DomElement | null;
    childrenOf(): DomElement[];
    before(value: DomChild): this;
    after(value: DomChild): this;
    onMount(callback: (element: this) => void): this;
    onUnmount(callback: (element: this) => void): this;
    onDispose(callback: (element: this) => void): this;
    onRemove(callback: (element: this) => void): this;
    on<K extends keyof GlobalEventHandlersEventMap>(
        event: K,
        callback: (event: GlobalEventHandlersEventMap[K]) => void,
        options?: AddEventListenerOptions | boolean
    ): this;
    on(
        event: string,
        selector: string,
        callback: (event: Event, matched: Element) => void,
        options?: AddEventListenerOptions | boolean
    ): this;
    on(events: Record<string, EventListener>, options?: AddEventListenerOptions | boolean): this;
    once<K extends keyof GlobalEventHandlersEventMap>(
        event: K,
        callback: (event: GlobalEventHandlersEventMap[K]) => void,
        options?: AddEventListenerOptions | boolean
    ): this;
    off(event: string, callback?: EventListener | null): this;
    remove(): void;
    dispose(): void;
}

export interface FormBindingOptions<T> {
    event?: string;
    parse?: (value: unknown, element: DomElement) => T;
    format?: (value: T, element: DomElement) => unknown;
    get?: (element: DomElement) => T;
    set?: (element: DomElement, value: T) => void;
    multiple?: boolean;
    value?: unknown;
}

export interface KeyedListOptions<T, K> {
    key(item: T, index: number): K;
    render(item: T, index: number): DomElement;
    update?(element: DomElement, item: T, index: number): void;
}

export interface State<T> extends Readable<T> {
    set(next: T): void;
    update(updater: (value: T) => T): void;
    bind(element: DomElement, updater?: ((value: T, element: DomElement) => void) | FormBindingOptions<T>): DomElement;
    bindText(element: DomElement, transform?: (value: T) => unknown): DomElement;
    bindValue(element: DomElement, transform?: (value: T) => unknown): DomElement;
    bindAttribute(element: DomElement, name: string, transform?: (value: T) => unknown): DomElement;
    bindClass(element: DomElement, name: string, transform?: (value: T) => boolean): DomElement;
    bindStyle(element: DomElement, name: string, transform?: (value: T) => unknown): DomElement;
    bindVisible(element: DomElement, transform?: (value: T) => boolean): DomElement;
    bindHidden(element: DomElement, transform?: (value: T) => boolean): DomElement;
    bindProperty(element: DomElement, name: string, transform?: (value: T) => unknown): DomElement;
    sync(element: DomElement, options?: FormBindingOptions<T>): DomElement;
    list<K>(container: DomElement, options: KeyedListOptions<T extends readonly (infer I)[] ? I : never, K>): DomElement;
    list(container: DomElement, render: (item: T extends readonly (infer I)[] ? I : never, index: number) => DomElement): DomElement;
    dispose(): void;
    readonly disposed: boolean;
}

export interface Computed<T> extends Readable<T> {
    dispose(): void;
    readonly disposed: boolean;
}

export interface AsyncSnapshot<T> {
    status: 'idle' | 'loading' | 'refreshing' | 'success' | 'error';
    data: T | null;
    error: unknown;
}

export interface AsyncState<T> extends Readable<AsyncSnapshot<T>> {
    run<R extends T = T>(
        task: (context: { signal: AbortSignal }) => Promise<R> | R,
        options?: { abortPrevious?: boolean }
    ): Promise<R>;
    retry(): Promise<T>;
    cancel(): void;
    reset(): void;
}

export interface DataStore<T extends Record<string, unknown>> {
    get(): T;
    get<K extends keyof T>(key: K): T[K];
    set<K extends keyof T>(key: K, value: T[K]): this;
    set(values: Partial<T>): this;
    update<K extends keyof T>(key: K, updater: (value: T[K]) => T[K]): this;
    has(key: PropertyKey): boolean;
    delete(key: keyof T): boolean;
    signal<K extends keyof T>(key: K): State<T[K]>;
    onChange<K extends keyof T>(
        key: K,
        callback: (value: T[K], previous: T[K] | undefined, key: K) => void,
        options?: SubscriptionOptions
    ): Unsubscribe;
    offChange<K extends keyof T>(key: K, callback?: ((value: T[K]) => void) | null): this;
    onAnyChange(
        callback: <K extends keyof T>(key: K, value: T[K], previous: T[K] | undefined) => void,
        options?: SubscriptionOptions
    ): Unsubscribe;
    dispose(): void;
    readonly disposed: boolean;
}

export type TreeChild = string | Node | DomElement | TreeConfig | readonly TreeChild[];
export interface TreeConfig<K extends string = string> {
    tag: K;
    text?: unknown | Readable<unknown>;
    attributes?: Record<string, unknown>;
    class?: string | readonly string[];
    properties?: Record<string, unknown>;
    on?: Record<string, EventListener | { handler: EventListener; options?: AddEventListenerOptions | boolean }>;
    children?: readonly TreeChild[];
}

export class DevDomSculptor extends DomSculptor {
    reportLeaks(): number;
}

export default class DomSculptor {
    constructor(options?: DomSculptorOptions);
    createScope(): DisposalScope;
    createContextKey<T = unknown>(description?: string): ContextKey<T>;
    createContext(parent?: Context | null, initial?: Map<symbol, unknown> | Record<PropertyKey, unknown> | null): Context;
    component<P extends object = Record<string, never>, A extends object = Record<string, never>>(
        factory: (props: P, context: Context) => ComponentResult<A>,
        options?: { name?: string }
    ): ComponentFactory<P, A>;
    errorBoundary<P extends object, A extends object>(
        componentFactory: ComponentFactory<P, A>,
        fallback: (error: unknown, props: P, context: Context) => ComponentResult<A> | ComponentInstance<A>
    ): ComponentFactory<P, A>;
    createDetached<K extends string>(tag: K, callback?: ((element: DomElement<ElementForTag<K>>) => void) | null): DomElement<ElementForTag<K>>;
    createIn<K extends string>(parent: string | Node | DomElement, tag: K, callback?: ((element: DomElement<ElementForTag<K>>) => void) | null): DomElement<ElementForTag<K>>;
    create<K extends string>(tag: K, callback?: ((element: DomElement<ElementForTag<K>>) => void) | null): DomElement<ElementForTag<K>>;
    create<K extends string>(tag: K, parent: string | Node | DomElement, callback?: ((element: DomElement<ElementForTag<K>>) => void) | null): DomElement<ElementForTag<K>>;
    mount<T extends DomElement | ComponentInstance>(element: T, parent: string | Node | DomElement): T;
    tryMount<T extends DomElement | ComponentInstance>(element: T, parent: string | Node | DomElement): T | null;
    unmount<T extends DomElement | ComponentInstance>(element: T): T;
    adopt<T extends Node>(node: T): DomElement<T>;
    wrap(selectorOrNode: string | Node): DomElement;
    tryWrap(selectorOrNode: string | Node): DomElement | null;
    tree<K extends string>(config: TreeConfig<K>): DomElement<ElementForTag<K>>;
    renderChunks<T, C extends DomElement>(items: readonly T[], container: C, options: {
        render(item: T, index: number): DomElement;
        chunkSize?: number;
        signal?: AbortSignal;
    }): Promise<C>;
    when(condition: Readable<unknown>, branch: DomChild | (() => DomChild), options?: {
        fallback?: DomChild | (() => DomChild);
        preserve?: boolean;
        disposeOnStop?: boolean;
        parent?: string | Node | DomElement;
    }): Unsubscribe;
    state<T>(initial: T): State<T>;
    signal<T>(initial: T): State<T>;
    computed<T>(compute: () => T, dependencies?: readonly Readable<unknown>[]): Computed<T>;
    effect(run: () => void | (() => void), dependencies?: readonly Readable<unknown>[]): Unsubscribe;
    batch<T>(callback: () => T): T;
    flush(): void;
    asyncState<T = unknown>(initialData?: T | null): AsyncState<T>;
    data<T extends Record<string, unknown>>(initial: T): DataStore<T>;
    data(): DataStore<Record<string, unknown>>;
    store<T extends Record<string, unknown>>(initial: T): DataStore<T>;
    store(): DataStore<Record<string, unknown>>;
}

export function signal<T>(initial: T): State<T>;
export function state<T>(initial: T): State<T>;
export function store<T extends Record<string, unknown>>(initial: T): DataStore<T>;
export function store(): DataStore<Record<string, unknown>>;
export function data<T extends Record<string, unknown>>(initial: T): DataStore<T>;
export function data(): DataStore<Record<string, unknown>>;
export function computed<T>(compute: () => T, dependencies?: readonly Readable<unknown>[]): Computed<T>;
export function effect(run: () => void | (() => void), dependencies?: readonly Readable<unknown>[]): Unsubscribe;
export function batch<T>(callback: () => T): T;
export function flush(): void;
export function tree<K extends string>(config: TreeConfig<K>): DomElement<ElementForTag<K>>;
export function when(condition: Readable<unknown>, branch: DomChild | (() => DomChild), options?: Record<string, unknown>): Unsubscribe;
export function mount<T extends DomElement | ComponentInstance>(value: T, parent: string | Node | DomElement): T;
export function unmount<T extends DomElement | ComponentInstance>(value: T): T;
export function asyncState<T = unknown>(initialData?: T | null): AsyncState<T>;
export function createDevSculptor(options?: Omit<DomSculptorOptions, 'development'>): DevDomSculptor;
export function errorBoundary<P extends object, A extends object>(
    componentFactory: ComponentFactory<P, A>,
    fallback: (error: unknown, props: P, context: Context) => ComponentResult<A> | ComponentInstance<A>
): ComponentFactory<P, A>;
