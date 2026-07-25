import {
    type ComponentInstance,
    type DevelopmentWarning,
    type DomElement,
    type DomSculptorOptions,
    type DevDomSculptor
} from 'domsculptor';

export interface TestHarness {
    sculptor: DevDomSculptor;
    root: DomElement;
    warnings: DevelopmentWarning[];
    mount<T extends DomElement | ComponentInstance>(value: T): T;
    flush(): this;
    assertClean(): this;
    dispose(): void;
    readonly disposed: boolean;
}

export function createTestHarness(
    parent?: string | Node | DomElement | null,
    options?: Omit<DomSculptorOptions, 'development'>
): TestHarness;
