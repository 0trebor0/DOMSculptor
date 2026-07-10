import DomSculptor, {
    type AsyncSnapshot,
    type AsyncState,
    type DataStore,
    type DomElement,
    type State
} from '../src/index.js';

let sculptor = new DomSculptor();
let parent: DomElement = sculptor.create('div');
let child = parent.child.create('span').setText('hello');
let found: DomElement | null = parent.child.find('span');
let all: DomElement[] = parent.child.findAll('span');

parent.child.append(child).child.prepend('text');
parent.child.replace(child, sculptor.create('strong'));
parent.child.clear();
parent.onMount(element => element.class.add('mounted'));
parent.onRemove(element => element.class.remove('mounted'));

let count: State<number> = sculptor.state(0);
count.bindText(parent, value => String(value));
count.bindAttribute(parent, 'data-count');
count.bindClass(parent, 'active', value => value > 0);
count.bindStyle(parent, 'opacity', value => String(value));
count.bindVisible(parent, value => value > 0);

let request: AsyncState<string> = sculptor.asyncState<string>();
request.subscribe((snapshot: AsyncSnapshot<string>) => snapshot.status);
request.run(async () => 'done');
request.retry();

let data: DataStore = sculptor.data({ count: 0 });
data.set('count', 1).update('count', value => Number(value) + 1);

void found;
void all;
