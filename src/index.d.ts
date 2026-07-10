type DomChild = DomElement | Node | string;
type Unsubscribe = () => void;

interface DomAttributes {
    set(name: string | Record<string, unknown>, value?: unknown): DomElement;
    remove(name: string): DomElement;
    get(name: string): string | null;
    has(name: string): boolean;
}

interface DomClasses {
    add(...values: string[]): DomElement;
    remove(...values: string[]): DomElement;
    toggle(value: string): DomElement;
    contains(value: string): boolean;
}

interface DomChildren {
    append(child: DomChild): DomElement;
    prepend(child: DomChild): DomElement;
    find(selector: string): DomElement | null;
    findAll(selector: string): DomElement[];
    create(name: string, callback?: ((element: DomElement) => void) | null): DomElement;
    remove(): void;
    clear(): DomElement;
    replace(previous: DomElement | Node, next: DomChild): DomElement;
}

declare class DomElement<T extends Node = HTMLElement> {
    html: T | null;
    children: DomElement[];
    attribute: DomAttributes;
    class: DomClasses;
    child: DomChildren;

    setText(text: unknown): this;
    getValue(): unknown;
    setValue(value: unknown): this;
    setStyle(property: string | Record<string, unknown>, value?: unknown): this;
    hide(): this;
    show(): this;
    parent(): DomElement | null;
    closest(selector: string): DomElement | null;
    childrenOf(): DomElement[];
    before(value: DomChild): this;
    after(value: DomChild): this;
    onMount(callback: (element: this) => void): this;
    onRemove(callback: (element: this) => void): this;
    on(event: string | Record<string, EventListener>, callback?: EventListener): this;
    once(event: string, callback: EventListener): this;
    off(event: string, callback?: EventListener | null): this;
    remove(): void;
}

interface State<T> {
    get(): T;
    set(next: T): void;
    update(updater: (value: T) => T): void;
    subscribe(callback: (value: T) => void): Unsubscribe;
    bind(element: DomElement, updater: (value: T, element: DomElement) => void): DomElement;
    bindText(element: DomElement, transform?: (value: T) => unknown): DomElement;
    bindValue(element: DomElement, transform?: (value: T) => unknown): DomElement;
    bindAttribute(element: DomElement, name: string, transform?: (value: T) => unknown): DomElement;
    bindClass(element: DomElement, name: string, transform?: (value: T) => boolean): DomElement;
    bindStyle(element: DomElement, property: string, transform?: (value: T) => unknown): DomElement;
    bindVisible(element: DomElement, transform?: (value: T) => boolean): DomElement;
    list(container: DomElement, render: (item: T extends readonly (infer I)[] ? I : never, index: number) => DomElement): DomElement;
    sync(element: DomElement, transform?: (value: string) => T): DomElement;
}

interface AsyncSnapshot<T> {
    status: 'idle' | 'loading' | 'success' | 'error';
    data: T | null;
    error: unknown;
}

interface AsyncState<T> {
    get(): AsyncSnapshot<T>;
    subscribe(callback: (value: AsyncSnapshot<T>) => void): Unsubscribe;
    run(task?: (() => T | PromiseLike<T>) | PromiseLike<T>): Promise<T>;
    retry(): Promise<T>;
}

interface DataStore {
    get(): Record<string, unknown>;
    get(key: string): unknown;
    set(values: Record<string, unknown>): this;
    set(key: string, value: unknown): this;
    update(key: string, updater: (value: unknown, key: string) => unknown): this;
    onChange(key: string, callback: (next: unknown, previous: unknown, key: string) => void, options?: { immediate?: boolean }): Unsubscribe;
    offChange(key: string, callback?: ((next: unknown, previous: unknown, key: string) => void) | null): this;
    onAnyChange(callback: (key: string, next: unknown, previous: unknown) => void, options?: { immediate?: boolean }): Unsubscribe;
}

export default class DomSculptor {
    create(tagName: string, parent?: string | Node | DomElement | null, callback?: ((element: DomElement) => void) | null): DomElement;
    wrap(selectorOrNode: string | Node): DomElement | null;
    state<T>(initial: T): State<T>;
    asyncState<T = unknown>(initialData?: T | null): AsyncState<T>;
    data(initial?: Record<string, unknown>): DataStore;
    jsontohtml(config: Record<string, unknown>): DomElement;
}

export type { AsyncSnapshot, AsyncState, DataStore, DomElement, State };
