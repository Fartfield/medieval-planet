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
  lineCap = '';
  fills = 0;
  strokes = 0;
  arcs = 0;
  images = 0;
  rects = 0;
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
  fillRect(x: number, y: number, w: number, h: number): void {
    this.note(x, y, w, h);
    this.rects++;
  }
  fillText(t: string): void { this.texts.push(t); }
  setTransform(): void {}
  clip(): void {}
  save(): void {}
  restore(): void {}
  translate(x: number, y: number): void { this.note(x, y); }
  rotate(a: number): void { this.note(a); }
  scale(x: number, y: number): void { this.note(x, y); }
  // The plant stamps. Counted, and checked for NaN geometry like everything
  // else -- a tree drawn at NaN is invisible and silent, which is the exact
  // failure mode this whole harness was built after.
  drawImage(_img: unknown, x: number, y: number, w: number, h: number): void {
    this.note(x, y, w, h);
    this.images++;
  }
  // A pattern the harness can hand back. Returning null -- which a stub can
  // honestly do, since it has no pixels to repeat -- silently switched the
  // whole turf path off and reported zero swards at every layer, which read
  // exactly like a bug in the renderer.
  createPattern(): Record<string, unknown> { return { setTransform: () => {} }; }
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

const client = await import('../client/src/main.ts');
const assets = await import('../client/src/flora_render.ts');

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

// Which layers grew plants, so the answer to "I cannot see trees" is a row of
// numbers rather than an opinion.
const plantsByLayer = new Map<string, number>();

function drewThisLayer(label: string): void {
  context.fills = 0;
  context.strokes = 0;
  context.nans = 0;
  context.images = 0;
  // Reset too, now that the tile test subtracts them: left running, the arc
  // count from earlier layers outgrew the fills and every layer reported FLAT.
  context.arcs = 0;
  // Force a redraw. The dirty flag means an unchanged view draws nothing, and
  // a resize is the one event that invalidates without also changing what is
  // being looked at.
  fire('resize', {});
  frames(2);
  // POLYGON fills, not every fill. A plant drawn branch by branch at the
  // deepest layer paints thousands of leaf discs, and counting those as
  // evidence of a mosaic made a flat layer 7 report itself as tiled -- an arc
  // is a leaf or a river and a bare fill is a tile.
  const tiles = context.fills - context.arcs > 500;
  // The renderer's own count, which is the only honest one now: a plant close
  // enough to be traced branch by branch is never handed to drawImage, so the
  // image counter reads zero exactly where the biggest tree on screen is.
  const grew = client.floraLastFrame();
  plantsByLayer.set(label, grew.plants);
  console.log(`    ${label.padEnd(28)} ${String(context.fills).padStart(6)} fills  `
    + `${String(grew.plants).padStart(6)} plants  `
    + `${String(grew.hidden).padStart(5)} hidden  `
    + `${String(grew.ground).padStart(5)} turf  `
    + `${String(grew.beasts).padStart(4)} cattle  `
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
  if (depth === 2 || depth === 4 || depth === 5 || depth === 7) dragTest(`dragging on layer ${depth}`);
}
console.log('');

// BACK UP THE LADDER, which is the path nobody had tested. The world view is
// drawn once on load and again every time the player comes back to it, and
// "it worked and then it did not" is exactly what a second visit failing looks
// like.
// ZOOMED OUT, which is where a wider range shows. At the default zoom the view
// fits one map and everything beyond it is culled, so more maps drawn is more
// maps generated and the same picture; zoom out and the extra ground appears.
// SCROLLING, TIMED. This is the thing that has to feel like real time: a drag
// moves the view, new ground comes in at the leading edge, and every map and
// every tile of it has to be built before it can be drawn.
function dragTest(label: string): void {
  const times: number[] = [];
  fire('canvas:mousedown', { clientX: 800, clientY: 450, button: 0 });
  let x = 800;
  for (let i = 0; i < 30; i++) {
    x -= 40;
    fire('mousemove', { clientX: x, clientY: 450 });
    const t0 = Date.now();
    frames(1);
    times.push(Date.now() - t0);
  }
  fire('mouseup', {});
  times.sort((a, b) => a - b);
  const total = times.reduce((a, b) => a + b, 0);
  console.log(`    ${label}: median ${times[15]} ms, 90th ${times[27]} ms, worst ${times[29]} ms,`
    + ` total ${total} ms, ${times.filter((t) => t > 16).length} of 30 over 16 ms`);
}

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

// THE THING THIS WAS BUILT FOR. "I do not see trees" was a true report about a
// renderer that tinted tiles green and drew no plant at any zoom. Individuals
// are affordable below a scale that is solved from the draw budget, so the deep
// layers must stamp them and the shallow ones must not -- and both halves are
// the claim, because a world view stamping a million oaks would be the other
// failure.
console.log('  where the plants are');
let plantedLayers = 0;
let deepest = 0;
for (const [label, n] of plantsByLayer) {
  if (n > 0) plantedLayers++;
  if (/^layer [4-7]$/.test(label)) deepest = Math.max(deepest, n);
}
for (const [label, n] of plantsByLayer) {
  if (n > 0) console.log(`    ${label.padEnd(28)} ${n} plants stamped`);
}
console.log(`    layers that grew anything: ${plantedLayers}`);
console.log('');

// THE CLAIM, and it is the one that "I do not see trees" was about. Individuals
// have to appear once they are affordable and to keep appearing all the way
// down -- one layer with plants and none below it was the fault the crown
// lattice was built to fix, and it is worth failing over rather than reading.
if (plantedLayers < 3) {
  console.log('  PLANTS APPEAR AT FEWER THAN THREE LAYERS. The lattice is not');
  console.log('  finding the stems whose crowns cover the deep views.');
  process.exit(1);
}
// THE CATTLE, EXERCISED DIRECTLY, because the descent above cannot reach them.
//
// A herd is drawn only on ground within reach of a settlement, and a freshly
// generated world has no settlements in it at all -- so every layer reports
// zero cattle and that is the predicate working, not the drawing failing. The
// distinction matters: one of those is a feature and the other would be a bug
// that nothing in this harness could see.
//
// So the drawing path is called on its own, against the same stub canvas, and
// held to the same standard as everything else: it must paint, and it must not
// paint at coordinates that are not numbers.
console.log('  the cattle, driven directly');
{
  const herdMod = await import('../sim/model/herd.ts');
  const cattleMod = await import('../sim/model/cattle.ts');
  const biomeMod = await import('../sim/model/biome.ts');
  const before = { fills: context.fills, strokes: context.strokes, nans: context.nans };
  context.fills = 0;
  context.strokes = 0;
  context.nans = 0;
  const herd = herdMod.herdOn({
    biome: biomeMod.Biome.TemperateGrassland, nppGm2: 700,
    dirX: 0.3, dirY: 0.5, dirZ: Math.sqrt(1 - 0.09 - 0.25),
    radiusM: 6371000, spacingM: 100,
  }, cattleMod.CATTLE, 64);
  const painted = assets.drawHerd(
    context as never, herd.beasts, 800, 450, 20, 1, 0,
  );
  console.log(`    ${herd.beasts.length} beasts on the hectare, ${painted} drawn`);
  console.log(`    ${context.fills} fills, ${context.strokes} strokes, ${context.nans} NaN`);
  if (herd.beasts.length === 0 || painted === 0) {
    console.log('  THE HERD DREW NOTHING. Either the pasture carries no cattle or');
    console.log('  the drawing path is broken; verify_herd says which.');
    process.exit(1);
  }
  if (context.nans > 0) {
    console.log('  A BEAST WAS DRAWN AT COORDINATES THAT ARE NOT NUMBERS.');
    process.exit(1);
  }
  // Fourteen shapes a beast: eight strokes and six blobs.
  if (context.fills < painted * 6 || context.strokes < painted * 8) {
    console.log('  A BEAST CAME OUT WITH PIECES MISSING.');
    process.exit(1);
  }
  context.fills = before.fills;
  context.strokes = before.strokes;
  context.nans = before.nans;
}
console.log('');

// THE CACHES ARE THE WHOLE ARGUMENT FOR BAKING. Twenty images a species and a
// handful of sward tiles, or the bake was not worth doing and the numbers here
// would say so by climbing after a session of walking about.
console.log(`    baked plant images: ${assets.stampCacheSize()}`);
console.log(`    baked sward tiles:  ${assets.groundCacheSize()}`);
if (assets.stampCacheSize() > 400 || assets.groundCacheSize() > 60) {
  console.log('  THE ASSET CACHE IS NOT BOUNDED. Something is keying a bake on');
  console.log('  a value that varies continuously -- a zoom, a week, an age.');
  process.exit(1);
}
console.log('');

if (deepest === 0) {
  console.log('  NOTHING GROWS AT THE DEEP LAYERS, which is where a plant is');
  console.log('  meant to be drawn branch by branch.');
  process.exit(1);
}

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
