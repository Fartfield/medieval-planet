// The client, driven headlessly, because nothing ever drove it.
//
// check_app.ts exists because two crashes shipped that every suite passed,
// both because nothing ran the real server loop. The client had the same hole
// and it cost three wrong diagnoses in a row: the world view stopped drawing
// its tiles, the renderer draws 23,500 of them when called directly with a
// stub canvas, and every attempt to work out from the code what was different
// about the real call was wrong. There was no way to run the real call.
//
// This runs it. The DOM is stubbed just enough for client/src/main.ts to load
// and think it is in a browser -- a canvas that counts what it is asked to
// draw, a socket that never connects, a window with a size -- and then the
// module is imported, handed a welcome message, and its own animation frame is
// called. Whatever main.ts does with that is what a browser would do.
//
// It is not a suite. It reports, the way check_app does, because the useful
// output here is a description of the frame rather than a pass or a fail.

import { World } from '../sim/world.ts';
import { CELL_COUNT } from '../sim/geo/sphere.ts';

// --- a canvas that remembers ------------------------------------------------

class StubContext {
  canvas = { width: 1600, height: 900 };
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  lineWidth = 1;
  font = '';
  fills = 0;
  strokes = 0;
  arcs = 0;
  texts: string[] = [];
  nans = 0;

  private note(...vs: number[]): void {
    for (const v of vs) if (!Number.isFinite(v)) this.nans++;
  }

  beginPath(): void {}
  closePath(): void {}
  moveTo(x: number, y: number): void { this.note(x, y); }
  lineTo(x: number, y: number): void { this.note(x, y); }
  arc(x: number, y: number, r: number): void { this.note(x, y, r); this.arcs++; }
  fill(): void { this.fills++; }
  stroke(): void { this.strokes++; }
  fillRect(): void {}
  fillText(t: string): void { this.texts.push(t); }
  setTransform(): void {}
  clip(): void {}
  save(): void {}
  restore(): void {}
}

const context = new StubContext();

// --- the smallest browser that will do --------------------------------------

const logLines: string[] = [];

function element(id: string): Record<string, unknown> {
  const el: Record<string, unknown> = {
    id,
    textContent: '',
    className: '',
    innerHTML: '',
    style: {},
    width: 0,
    height: 0,
    getContext: () => context,
    appendChild: (child: { textContent?: string }) => {
      if (id === 'log' && typeof child.textContent === 'string') logLines.push(child.textContent);
    },
    addEventListener: (name: string, fn: (e: unknown) => void) => {
      const key = `${id}:${name}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key)!.push(fn);
    },
    removeEventListener: () => {},
    setAttribute: () => {},
    querySelector: () => null,
    remove: () => {},
    scrollTop: 0,
    scrollHeight: 0,
    lastChild: null,
    firstChild: null,
    children: [],
    classList: { add: () => {}, remove: () => {}, toggle: () => {} },
  };
  return el;
}

const elements = new Map<string, Record<string, unknown>>();
const listeners = new Map<string, ((e: unknown) => void)[]>();
let raf: (() => void) | null = null;
let socketHandlers: Record<string, ((e: unknown) => void)> = {};

function frames(n: number): void {
  for (let i = 0; i < n; i++) {
    const go = raf as (() => void) | null;
    if (go !== null) go();
  }
}

const g = globalThis as Record<string, unknown>;

g.document = {
  getElementById: (id: string) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  },
  createElement: () => element('created'),
  createTextNode: (t: string) => ({ textContent: t, nodeValue: t }),
  addEventListener: () => {},
  body: element('body'),
};
g.window = {
  innerWidth: 1600,
  innerHeight: 900,
  devicePixelRatio: 1,
  addEventListener: (name: string, fn: (e: unknown) => void) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name)!.push(fn);
  },
  requestAnimationFrame: (fn: () => void) => { raf = fn; return 1; },
};
g.location = { host: 'localhost:8080' };
g.localStorage = {
  getItem: () => 'checker',
  setItem: () => {},
};
g.requestAnimationFrame = (fn: () => void) => { raf = fn; return 1; };
g.addEventListener = (g.window as Record<string, unknown>).addEventListener;
g.WebSocket = class {
  onopen: (() => void) | null = null;
  set onmessage(fn: (e: unknown) => void) { socketHandlers.message = fn; }
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send(): void {}
  close(): void {}
};

// --- run it -----------------------------------------------------------------

console.log('');
console.log('  driving the real client against a stub canvas');
console.log('');

await import('../client/src/main.ts');

// The world the server would have sent. Same seed the suites use, so what the
// client builds is the world every other measurement describes.
const SEED = 20260826;
const probe = new World({ seed: SEED });

if (socketHandlers.message === undefined) {
  console.log('  the client never installed a message handler');
  process.exit(1);
}

socketHandlers.message({
  data: JSON.stringify({
    t: 'welcome',
    playerId: 1,
    players: [{ id: 1, name: 'checker' }],
    polities: [],
    turn: 1,
    turnSeconds: 120,
    seed: SEED,
    radiusM: probe.radiusM,
    deltas: [],
  }),
});

if (raf === null) {
  console.log('  the client never asked for an animation frame');
  process.exit(1);
}

// Several frames: the first draws, the rest are the dirty flag's business.
frames(4);

// --- and now walk down the ladder -------------------------------------------
//
// The report is per layer, because the fault reported is per layer: some draw
// their constituent tiles and some do not, and the only way to tell which is
// which is to open each one and count.

function fire(key: string, event: Record<string, unknown>): void {
  for (const fn of listeners.get(key) ?? []) fn(event);
}

function drewThisLayer(label: string): void {
  context.fills = 0;
  context.strokes = 0;
  context.nans = 0;
  // Force a redraw. The dirty flag means an unchanged view draws nothing, and
  // a resize is the one event that invalidates without also changing what is
  // being looked at.
  fire('resize', {});
  frames(2);
  const tiles = context.fills > 500;
  console.log(`    ${label.padEnd(28)} ${String(context.fills).padStart(6)} fills  `
    + `${context.nans > 0 ? `${context.nans} NaN  ` : ''}`
    + (tiles ? 'drawn from its own tiles' : 'FLAT -- no constituent tiles'));
}

console.log('  descending, one layer at a time');
drewThisLayer('world view');
for (let depth = 1; depth <= 7; depth++) {
  // Click the middle to select, then Enter to open it.
  fire('canvas:mousedown', { clientX: 800, clientY: 450, button: 0 });
  fire('canvas:mouseup', { clientX: 800, clientY: 450, button: 0 });
  fire('canvas:click', { clientX: 800, clientY: 450, button: 0 });
  fire('keydown', { key: 'Enter' });
  frames(2);
  drewThisLayer(`layer ${depth}`);
}
console.log('');

// BACK UP THE LADDER, which is the path nobody had tested. The world view is
// drawn once on load and again every time the player comes back to it, and
// "it worked and then it did not" is exactly what a second visit failing looks
// like.
// ZOOMED OUT, which is where a wider range shows. At the default zoom the view
// fits one map and everything beyond it is culled, so more maps drawn is more
// maps generated and the same picture; zoom out and the extra ground appears.
console.log('  the same layer, zoomed out');
for (const steps of [0, 3, 6, 9]) {
  for (let i = 0; i < steps; i++) fire('canvas:wheel', { deltaY: 120, preventDefault: () => {} });
  drewThisLayer(`zoom out x${steps}`);
  for (let i = 0; i < steps; i++) fire('canvas:wheel', { deltaY: -120, preventDefault: () => {} });
}
console.log('');

console.log('  climbing back up');
for (let depth = 7; depth >= 1; depth--) {
  fire('keydown', { key: 'Escape' });
  frames(2);
  drewThisLayer(`back to layer ${depth - 1 === 0 ? 'world view' : String(depth - 1)}`);
}
console.log('');

console.log('  what the client logged');
for (const line of logLines) console.log(`    ${line}`);
console.log('');
console.log('  what it drew on the world view');
console.log(`    fills   ${context.fills}`);
console.log(`    strokes ${context.strokes}`);
console.log(`    arcs    ${context.arcs}`);
console.log(`    NaN coordinates ${context.nans}`);
for (const t of context.texts) console.log(`    text: ${t}`);
console.log('');

const failed = logLines.some((l) => l.startsWith('frame failed'));
const mosaic = logLines.find((l) => l.startsWith('world view:'));

if (failed) {
  console.log('  THE FRAME THREW. That is the fault.');
  process.exit(1);
}
if (mosaic === undefined) {
  console.log('  the world view never reported, so it never drew');
  process.exit(1);
}
console.log(`  ${mosaic}`);
// A region drawn from its own tiles fills far more than one shape, so the fill
// count is the other half of the same answer: 480-odd fills means flat
// regions, tens of thousands means tiles.
console.log(context.fills > CELL_COUNT * 10
  ? '  the world view IS drawing its constituent tiles'
  : '  the world view is NOT drawing its constituent tiles');
