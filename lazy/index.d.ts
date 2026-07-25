import type DomSculptor from 'domsculptor';
import {
    type ComponentFactory,
    type ComponentInstance,
    type ComponentResult,
    type Context,
    type DomElement,
    type State,
    type TreeConfig
} from 'domsculptor';

export interface LazyStatus {
    status: 'loading' | 'success' | 'error';
    error: unknown;
}

export type LazyRenderable = DomElement | Node | string | TreeConfig | false | null;

export interface LazyOptions<P extends object> {
    name?: string;
    tag?: string;
    loading?: LazyRenderable | ((props: P, context: Context) => LazyRenderable);
    error?: (error: unknown, props: P, context: Context) => LazyRenderable;
    onError?: (error: unknown) => void;
}

export function createLazyComponent<P extends object, A extends object>(
    sculptor: DomSculptor,
    loader: (context: {
        signal: AbortSignal;
        props: P;
        context: Context;
    }) => Promise<
        ComponentFactory<P, A> |
        ComponentInstance<A> |
        ComponentResult<A> |
        { default: ComponentFactory<P, A> | ComponentInstance<A> | ComponentResult<A> }
    >,
    options?: LazyOptions<P>
): ComponentFactory<P, { status: State<LazyStatus> }>;
