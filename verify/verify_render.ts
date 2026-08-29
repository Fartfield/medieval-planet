// The renderer, driven against a stub canvas.
//
// A browser is not available here, so this stands in for one: a fake 2D
// context that records what it was asked to draw. It cannot tell you the map
// looks right. It can tell you the draw path runs at all, which is most of
// what goes wrong -- a moved import, a projection that returns NaN, a picking
// routine that disagrees with the drawing routine about where a hexagon is.
//
// The NaN check is the one that earns its place. A single NaN coordinate makes
// canvas silently skip the shape, so a bad projection does not throw and does
// not warn; it just quietly draws nothing, and you spend an afternoon deciding
// whether the generator or the renderer is broken.

import { World } from '../sim/world.ts';
import { MAX_DEPTH } from '../sim/geo/address.ts';
import { CELL_COUNT, centres, outline, neighbourCount } from '../sim/geo/sphere.ts';
import {
  RADIUS, SUBCELL_COUNT, toPixel, indexOf, subNeighbours,
} from '../sim/geo/hexgrid.ts';
import { Biome } from '../sim/model/biome.ts';
import {
  newCamera, globeView, flatView, drawGlobe, drawSubMap,
  pickGlobe, pickSubMap, corners, rotate, unrotate, houseColour,
  blendColours, tilePolygons, TINT_MIN_PX, MOSAIC_MIN_PX, GRID_MIN_PX,
  type CellTint, type ChildLookup,
} from '../client/src/render.ts';
import { bestRegion } from './sites.ts';
import { check, measure, assert, suite } from './harness.ts';

/** Records coordinates so the suite can look for NaN and for an empty frame. */
class StubContext {
  canvas = { width: 1200, height: 800 };
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  font = '';

  points: number[] = [];
  fills = 0;
  strokes = 0;
  arcs = 0;
  rects = 0;
  clips = 0;
  /** Depth of save/restore nesting, which must come back to zero. */
  depth = 0;
  maxDepth = 0;
  unbalanced = false;

  beginPath(): void {}
  closePath(): void {}
  moveTo(x: number, y: number): void { this.points.push(x, y); }
  lineTo(x: number, y: number): void { this.points.push(x, y); }
  arc(x: number, y: number, r: number): void { this.points.push(x, y, r); this.arcs++; }
  fill(): void { this.fills++; }
  stroke(): void { this.strokes++; }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.points.push(x, y, w, h);
    this.rects++;
  }
  fillText(): void {}
  setTransform(): void {}
  clip(): void { this.clips++; }
  save(): void { this.depth++; this.maxDepth = Math.max(this.maxDepth, this.depth); }
  restore(): void {
    this.depth--;
    // A clip that is never restored leaks onto everything drawn afterwards,
    // and on a canvas that shows up as the rest of the frame silently
    // vanishing rather than as an error.
    if (this.depth < 0) this.unbalanced = true;
  }

  get nans(): number { return this.points.filter((v) => !Number.isFinite(v)).length; }
}

const stub = (): CanvasRenderingContext2D =>
  new StubContext() as unknown as CanvasRenderingContext2D;

const W = 1200;
const H = 800;

suite('render geometry', () => {
  const shape = corners(10);
  check('a hexagon has six corners', shape.length, 6, 0);
  let worstRadius = 0;
  for (const c of shape) {
    worstRadius = Math.max(worstRadius, Math.abs(Math.hypot(c.x, c.y) - 10));
  }
  check('every corner is at the circumradius', worstRadius, 0, 1e-9);

  // Rotation must be invertible, or clicking the globe lands somewhere else.
  const cam = newCamera();
  let worstRound = 0;
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    const x = Math.cos(a) * 0.6;
    const y = Math.sin(a) * 0.5;
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    const [rx, ry, rz] = rotate(cam, x, y, z);
    const [bx, by, bz] = unrotate(cam, rx, ry, rz);
    worstRound = Math.max(worstRound, Math.abs(bx - x), Math.abs(by - y), Math.abs(bz - z));
  }
  check('rotate and unrotate are inverses', worstRound, 0, 1e-12);

  assert('house colours are distinct', houseColour(0) !== houseColour(1));
});

suite('globe rendering', () => {
  const world = new World({ seed: 20260826 });
  const cam = newCamera();
  const view = globeView(W, H);
  const ctx = stub();
  const raw = ctx as unknown as StubContext;

  drawGlobe(ctx, world.planet, cam, view, 10, new Map([[20, 0]]));

  check('the globe produced no NaN coordinates', raw.nans, 0, 0);
  // Twenty-seven land cells on a 92-cell globe, half of them facing us.
  assert('the globe drew something', raw.fills > 3);
  measure('land cells drawn on one hemisphere', raw.fills);
  assert('every drawn point is on the canvas', raw.points.every((v) => Math.abs(v) < 5000));

  // Picking must agree with drawing: the centre of the disc is the point the
  // camera is looking at, and clicking it must return a real region.
  const centre = pickGlobe(cam, view, view.cx, view.cy);
  assert('the centre of the globe picks a direction', centre !== null);
  if (centre !== null) {
    const region = world.regionAt(centre[0], centre[1], centre[2]);
    assert('and that direction is a real region', region >= 0 && region < CELL_COUNT);
  }
  assert('a click outside the disc picks nothing',
    pickGlobe(cam, view, view.cx + view.radius * 1.5, view.cy) === null);

  // Rotating must change what is visible, or the drag does nothing.
  const ctx2 = stub();
  drawGlobe(ctx2, world.planet, { ...cam, yaw: cam.yaw + 2.0 }, view, -1, new Map());
  assert('rotating shows a different hemisphere',
    (ctx2 as unknown as StubContext).fills !== raw.fills);
});

suite('sub-map rendering', () => {
  const world = new World({ seed: 20260826 });
  const region = bestRegion(world);

  const cam = newCamera();
  const view = flatView(W, H, cam);
  const ctx = stub();
  const raw = ctx as unknown as StubContext;

  drawSubMap(ctx, world.subMap([region]), view, 45,
    new Map([[10, 0]]), new Map([[10, 50]]));

  check('the sub-map produced no NaN coordinates', raw.nans, 0, 0);
  assert('the sub-map drew something', raw.fills > 50);
  measure('sub-map cells drawn', raw.fills);
  assert('rivers were drawn', raw.arcs > 0);
  measure('river and settlement marks', raw.arcs);

  // Picking must be the exact inverse of the layout, at every zoom.
  for (const zoom of [0.5, 1, 4, 12]) {
    const v = flatView(W, H, { ...cam, zoom });
    let wrong = 0;
    for (let c = 0; c < SUBCELL_COUNT; c += 7) {
      // Where the renderer puts this cell, then back again.
      const px = v.cx + (v.size * Math.sqrt(3)) * (cellQ(c) + cellR(c) / 2);
      const py = v.cy + v.size * 1.5 * cellR(c);
      if (pickSubMap(v, px, py) !== c) wrong++;
    }
    check(`picking is exact at zoom ${zoom}`, wrong, 0, 0);
  }

  // At full zoom most cells are off screen and must be skipped, or a ground
  // map costs ten thousand fills to show forty hexagons.
  const zoomed = stub();
  drawSubMap(zoomed, world.subMap([region]), flatView(W, H, { ...cam, zoom: 60 }),
    -1, new Map(), new Map());
  const zoomedFills = (zoomed as unknown as StubContext).fills;
  measure('cells drawn at zoom 60', zoomedFills);
  assert('off-screen cells are culled', zoomedFills < raw.fills);
});

// The renderer reads these off the grid; the suite needs them too.
import { coords } from '../sim/geo/hexgrid.ts';
function cellQ(c: number): number { return coords[c * 2]; }
function cellR(c: number): number { return coords[c * 2 + 1]; }

suite('the map fills the window', () => {
  // A sub-map has to be drawn at a size somebody can see. This was a hardcoded
  // divisor sized for the old 115-cell-wide maps, so an 11-cell one rendered
  // at a tenth of the window and no test noticed -- nothing measures how big a
  // picture is unless it is asked to.
  const cam = newCamera();
  const view = flatView(W, H, cam);
  const widthPx = view.size * Math.sqrt(3) * (2 * RADIUS + 1);
  const heightPx = view.size * (3 * RADIUS + 2);
  measure('sub-map width in pixels', widthPx);
  measure('sub-map height in pixels', heightPx);
  measure('cell circumradius in pixels', view.size);
  assert('the map fits inside the window', widthPx <= W && heightPx <= H);
  assert('and comes close to filling it',
    Math.max(widthPx / W, heightPx / H) > 0.85);
});

suite('a hex is drawn out of its own tiles', () => {
  // Every cell is painted from its 91 children, ONE LAYER DOWN AND NO MORE.
  // That "no more" is the load-bearing part: a globe that recursed would end
  // up asking for all 4.75 quadrillion cells to paint twelve shapes.
  const world = new World({ seed: 20260826 });
  const cam = newCamera();
  const view = globeView(W, H);

  const asked: number[] = [];
  const kids: ChildLookup = (cell) => { asked.push(cell); return world.subMap([cell]); };

  const flat = stub();
  drawGlobe(flat, world.planet, cam, view, -1, new Map(), null, null);
  const mosaic = stub();
  drawGlobe(mosaic, world.planet, cam, view, -1, new Map(), null, kids);

  const flatRaw = flat as unknown as StubContext;
  const mosaicRaw = mosaic as unknown as StubContext;

  measure('shapes drawn flat', flatRaw.fills);
  measure('shapes drawn from the tiles below', mosaicRaw.fills);
  measure('child maps requested', asked.length);

  assert('a mosaic draws far more shapes than a flat globe',
    mosaicRaw.fills > flatRaw.fills * 10);
  check('the mosaic produced no NaN coordinates', mosaicRaw.nans, 0, 0);

  // Hexagons, not rectangles. The first attempt drew padded axis-aligned
  // squares, which leave a lattice of gaps and read as dither rather than as
  // ground -- see docs/fix-attempts.md. Nothing here may call fillRect.
  check('nothing is drawn as a rectangle', mosaicRaw.rects, 0, 0);

  // ONE LAYER. Each visible region is asked for its children exactly once and
  // nothing is ever asked for a grandchild.
  check('every region is asked at most once', asked.length, new Set(asked).size, 0);
  assert('only regions are asked, never anything deeper',
    asked.every((c) => c >= 0 && c < CELL_COUNT));

  // The parent is filled underneath its own mosaic. A hexagon of hexagons has
  // a serrated edge and the ocean would show through every notch.
  assert('parents are still filled underneath', mosaicRaw.fills >= flatRaw.fills);

  // Every clip is restored. An unbalanced one leaks onto the rest of the
  // frame, which on a canvas looks like everything after it disappearing.
  measure('clips taken', mosaicRaw.clips);
  assert('the mosaic clips to each parent', mosaicRaw.clips > 0);
  check('every save is restored', mosaicRaw.depth, 0, 0);
  assert('and never restored too often', !mosaicRaw.unbalanced);
  check('clip nesting never goes deeper than one', mosaicRaw.maxDepth, 1, 0);

  // Below the threshold nothing is asked for at all, however small it gets.
  const asked2: number[] = [];
  const tiny = stub();
  drawGlobe(tiny, world.planet, cam, { cx: 50, cy: 50, radius: 30 }, -1, new Map(), null,
    (c) => { asked2.push(c); return world.subMap([c]); });
  check('a small globe asks for no children', asked2.length, 0, 0);
  check('and draws no rectangles either', (tiny as unknown as StubContext).rects, 0, 0);

  // No children is always allowed: it is what the finest layer returns.
  let threw = false;
  try {
    const none = stub();
    drawGlobe(none, world.planet, cam, view, -1, new Map(), null, () => null);
    assert('a globe with no children still draws', (none as unknown as StubContext).fills > 0);
  } catch { threw = true; }
  assert('no children is not an error', !threw);

  // The same on a flat sub-map, where the children lay out in local
  // coordinates rather than being projected.
  const region = bestRegion(world);
  const subAsked: number[] = [];
  const sub = stub();
  drawSubMap(sub, world.subMap([region]), flatView(W, H, cam), -1,
    new Map(), new Map(), null, null,
    (c) => { subAsked.push(c); return world.subMap([region, c]); });
  const subRaw = sub as unknown as StubContext;
  measure('shapes drawn on a mosaicked sub-map', subRaw.fills);
  assert('a sub-map is drawn from its tiles too', subRaw.fills > SUBCELL_COUNT * 10);
  check('a sub-map draws no rectangles', subRaw.rects, 0, 0);
  check('each sub-map cell is asked at most once', subAsked.length, new Set(subAsked).size, 0);
  check('a mosaicked sub-map produced no NaN', subRaw.nans, 0, 0);
  measure('max depth', MAX_DEPTH);
});

suite('the tiles line up with the hex that holds them', () => {
  // Ninety-one hexes of circumradius r arrange into a hexagon of circumradius
  // sqrt(3)*RADIUS*r, and that arrangement comes out flat-topped where a cell
  // drawn by `corners` is pointy-topped. Turning the children thirty degrees
  // puts the two in register. Get either half of that wrong -- the scale or
  // the turn -- and the tiling sits skew inside its own parent.
  const parent = corners(100);
  const child = corners(100 * (1 / (Math.sqrt(3) * RADIUS)), 0);

  // The parent's vertices sit at 30, 90, 150 degrees and the turned child's at
  // 0, 60, 120, so their edges run parallel.
  const angleOf = (p: { x: number; y: number }): number =>
    ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360;
  measure('first parent vertex, degrees', angleOf(parent[0]));
  measure('first child vertex, degrees', angleOf(child[0]));
  check('the parent is pointy-topped', angleOf(parent[0]), 330, 0.001);
  check('a child is turned to meet it', angleOf(child[0]), 0, 0.001);

  // The arrangement spans exactly as far as the parent does.
  const childSize = 100 / (Math.sqrt(3) * RADIUS);
  const spanOfArrangement = Math.sqrt(3) * RADIUS * childSize;
  measure('arrangement circumradius against parent', spanOfArrangement / 100);
  check('the children reach the parent edge', spanOfArrangement, 100, 1e-9);

  // And the far corner of the real grid lands there, which is the check that
  // the layout and the scale agree rather than each being right alone.
  const far = toPixel(indexOf(RADIUS, 0), childSize);
  const turned = {
    x: far.x * (Math.sqrt(3) / 2) - far.y * 0.5,
    y: far.x * 0.5 + far.y * (Math.sqrt(3) / 2),
  };
  measure('outermost child distance from centre', Math.hypot(turned.x, turned.y));
  check('the outermost child sits on the parent corner',
    Math.hypot(turned.x, turned.y), 100, 1e-9);
  check('and at a parent corner angle', angleOf(turned), 30, 1e-6);
});

suite('tint from one layer below', () => {
  // Every hex stays a single hexagon and is coloured by the average of its own
  // 91 children. The claim under test is the "own" -- a globe that recursed
  // would end up asking for all 4.75 quadrillion cells to paint twelve shapes.
  const world = new World({ seed: 20260826 });
  const cam = newCamera();
  const view = globeView(W, H);

  // Blending, on its own.
  check('one colour blends to itself',
    blendColours(['#c2bb6b']) === '#c2bb6b' ? 1 : 0, 1, 0);
  const mostlyOcean = blendColours([...Array(90).fill('#1b3a5c'), '#3d6b34']);
  assert('a mostly-ocean blend stays ocean', mostlyOcean.startsWith('#1'));
  const half = blendColours(['#3d6b34', '#d9c08a']);
  assert('green and sand blend to neither', half !== '#3d6b34' && half !== '#d9c08a');
  check('an empty blend is safe', blendColours([]) === '#000000' ? 1 : 0, 1, 0);

  // Asked once per visible cell, and only for cells of the layer on screen.
  const asked: number[] = [];
  const tint: CellTint = (cell) => { asked.push(cell); return '#123456'; };

  const flat = stub();
  drawGlobe(flat, world.planet, cam, view, -1, new Map(), null, null);
  const tinted = stub();
  drawGlobe(tinted, world.planet, cam, view, -1, new Map(), tint, null);

  const flatRaw = flat as unknown as StubContext;
  const tintRaw = tinted as unknown as StubContext;

  measure('cells asked for a tint', asked.length);
  check('tinting draws no extra shapes', tintRaw.fills, flatRaw.fills, 0);
  check('and no mosaic tiles at all', tintRaw.rects, 0, 0);
  check('every cell is asked at most once', asked.length, new Set(asked).size, 0);
  assert('only cells of the visible layer are asked',
    asked.every((c) => c >= 0 && c < CELL_COUNT));
  check('the tinted globe produced no NaN', tintRaw.nans, 0, 0);

  // Below the threshold nothing is asked at all.
  const asked2: number[] = [];
  const tiny = stub();
  drawGlobe(tiny, world.planet, cam, { cx: 50, cy: 50, radius: 4 }, -1, new Map(),
    (c) => { asked2.push(c); return '#123456'; }, null);
  check('a tiny globe asks for no tints', asked2.length, 0, 0);

  // A tint of null is always safe -- that is what the finest layer returns.
  let threw = false;
  try {
    const nulled = stub();
    drawGlobe(nulled, world.planet, cam, view, -1, new Map(), () => null, null);
    assert('a null tint still draws', (nulled as unknown as StubContext).fills > 0);
  } catch { threw = true; }
  assert('a null tint is not an error', !threw);

  // The same on a flat sub-map.
  const region = bestRegion(world);
  const subAsked: number[] = [];
  const sub = stub();
  drawSubMap(sub, world.subMap([region]), flatView(W, H, cam), -1,
    new Map(), new Map(), null, (c) => { subAsked.push(c); return '#654321'; }, null);
  const subRaw = sub as unknown as StubContext;
  check('a sub-map draws no mosaic tiles either', subRaw.rects, 0, 0);
  check('each sub-map cell is asked once', subAsked.length, new Set(subAsked).size, 0);
  assert('a sub-map asks for tints', subAsked.length > 0);
  check('a tinted sub-map produced no NaN', subRaw.nans, 0, 0);
  measure('max depth', MAX_DEPTH);
});

suite('the globe turns on its poles', () => {
  // A globe on a stand: yaw spins it about its own axis and must not move the
  // poles at all, pitch tilts the axis toward or away. The alternative -- free
  // rotation about two screen axes -- lets the world tumble, and a tumbled
  // world has no up, so nobody can say where they are.
  const view = { cx: 600, cy: 400, radius: 300 };
  const at = (yaw: number, pitch: number, x: number, y: number, z: number): number[] => {
    const [px, py, pz] = rotate({ yaw, pitch, panX: 0, panY: 0, zoom: 1 }, x, y, z);
    return [view.cx + px * view.radius, view.cy - py * view.radius, pz];
  };

  // Spinning must leave the poles exactly where they were.
  const base = at(0, 0.35, 0, 1, 0);
  let worst = 0;
  for (let i = 1; i <= 12; i++) {
    const spun = at((i * Math.PI) / 6, 0.35, 0, 1, 0);
    worst = Math.max(worst, Math.hypot(spun[0] - base[0], spun[1] - base[1]));
  }
  measure('how far the pole moves over a full spin, px', worst);
  check('spinning does not move the pole', worst, 0, 1e-9);

  // But the ground does move, or nothing is turning.
  const g0 = at(0, 0.35, 1, 0, 0);
  const g1 = at(Math.PI / 2, 0.35, 1, 0, 0);
  measure('how far the equator moves over a quarter turn, px', Math.hypot(g1[0] - g0[0], g1[1] - g0[1]));
  assert('spinning does move the ground', Math.hypot(g1[0] - g0[0], g1[1] - g0[1]) > 100);

  // Upright, the north pole is straight above the centre and the south below.
  const north = at(0, 0, 0, 1, 0);
  const south = at(0, 0, 0, -1, 0);
  check('upright, the north pole is above the centre', north[0], view.cx, 1e-9);
  assert('and it is above rather than below', north[1] < view.cy);
  check('the south pole is directly opposite', south[0], view.cx, 1e-9);
  assert('and below', south[1] > view.cy);

  // Tilting brings a pole toward the viewer and eventually past the horizon,
  // which is what the pitch clamp in the client is there to stop short of.
  assert('tilting turns the north pole away', at(0, -1.4, 0, 1, 0)[2] < 0);
  assert('and the other way brings it forward', at(0, 1.4, 0, 1, 0)[2] > 0);

  // The whole thing is a rotation, so nothing stretches.
  let worstNorm = 0;
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    const [x, y, z] = rotate({ yaw: 0.7, pitch: -0.4, panX: 0, panY: 0, zoom: 1 },
      Math.cos(t), 0.3, Math.sin(t));
    worstNorm = Math.max(worstNorm, Math.abs(Math.hypot(x, y, z) - Math.hypot(Math.cos(t), 0.3, Math.sin(t))));
  }
  measure('worst length change under rotation', worstNorm);
  check('rotation preserves length', worstNorm, 0, 1e-12);
});

suite('the hex grid is drawn on the globe', () => {
  const world = new World({ seed: 20260826 });
  const cam = newCamera();

  // Big enough to see: every visible cell gets an outline, so the map reads as
  // hexagons rather than as a colour field.
  const big = stub();
  drawGlobe(big, world.planet, cam, globeView(W, H), -1, new Map(), null, null);
  const bigRaw = big as unknown as StubContext;
  measure('strokes on a large globe', bigRaw.strokes);
  assert('cells are outlined', bigRaw.strokes > 10);

  // Small enough that an outline would be the whole shape: no grid.
  const small = stub();
  drawGlobe(small, world.planet, cam, { cx: 60, cy: 60, radius: 20 }, -1, new Map(), null, null);
  const smallRaw = small as unknown as StubContext;
  measure('strokes on a tiny globe', smallRaw.strokes);
  assert('a tiny globe is not drawn as a mesh', smallRaw.strokes < bigRaw.strokes / 2);

  // The axis and equator are drawn at every size, because they are what the
  // rotation is read against.
  assert('the axis is drawn even when tiny', smallRaw.strokes > 0);
  check('neither produced a NaN', bigRaw.nans + smallRaw.nans, 0, 0);

  // A REGION OUTLINE IS A LINE DRAWN ACROSS A CONTINENT. At 2,500 km a
  // region's border is wider than most countries, and at the weight it needs
  // to be visible when there is nothing else it buries the tiles inside it:
  // every landmass came out as a honeycomb of enormous hexagons, with the real
  // coastline -- which the tiles were drawing perfectly well -- demoted to
  // texture inside the facets. So once the tiles are being drawn, they are the
  // grid, and the region border stands down.
  const mosaicked = stub();
  drawGlobe(mosaicked, world.planet, cam, globeView(W, H), -1, new Map(), null,
    (c) => world.subMap([c]));
  const mosaicRaw = mosaicked as unknown as StubContext;
  const tiles = mosaicRaw.fills - bigRaw.fills;
  measure('tiles drawn on a mosaicked globe', tiles);
  assert('the tiles are drawn', tiles > 500);
  // Every stroke should belong to a tile, not to a region: at most one per
  // tile drawn, and nowhere near one per region on top of that.
  measure('strokes on a mosaicked globe', mosaicRaw.strokes);
  assert('no region is outlined once its tiles are',
    mosaicRaw.strokes <= tiles + 4);

  // A house border replaces the grid line on an owned cell rather than adding
  // a second stroke over it.
  const owned = new Map<number, number>();
  for (let c = 0; c < CELL_COUNT; c++) if (world.planet.elevationM[c] >= 0) { owned.set(c, 0); break; }
  const bordered = stub();
  drawGlobe(bordered, world.planet, cam, globeView(W, H), -1, owned, null, null);
  measure('strokes with one owned cell', (bordered as unknown as StubContext).strokes);
  check('an owned cell does not stroke twice',
    (bordered as unknown as StubContext).strokes, bigRaw.strokes, 0);
});

suite('tiles on the globe tessellate', () => {
  // The property no count of shapes can see, and the one that was wrong.
  //
  // Tiles used to be drawn as fixed-size, fixed-orientation hexagons dropped at
  // each projected centre. Every measurement passed -- the right number of
  // shapes, no NaN, the arithmetic exact -- and the globe was visibly wrong:
  // the tiles were upright wherever they sat while the lattice under them was
  // rotated and foreshortened by the projection, so the background showed
  // through between them and the grid did not follow the curve.
  //
  // ADJACENT TILES MUST SHARE THEIR CORNERS. Two tiles that merely land near
  // each other leave a gap, and the gaps were the whole complaint. Building
  // each corner as the centroid of a triple of touching cells makes two
  // neighbours compute the same corner from the same three cells, so it holds
  // by construction rather than by tolerance.
  const world = new World({ seed: 20260826 });
  const cam = newCamera();
  const view = globeView(W, H);
  const kids = world.subMap([4]);
  const polys = tilePolygons(kids, cam, view, 4);

  let drawn = 0;
  for (const poly of polys) if (poly !== null) drawn++;
  measure('tiles with geometry on a facing region', drawn);
  assert('a facing region yields tiles', drawn > 40);

  let pairs = 0;
  let sharing = 0;
  let worstGap = 0;
  for (let a = 0; a < SUBCELL_COUNT; a++) {
    const pa = polys[a];
    if (pa === null) continue;
    for (let d = 0; d < 6; d++) {
      const b = subNeighbours[a * 6 + d];
      if (b < 0 || b < a) continue;
      const pb = polys[b];
      if (pb === null) continue;
      pairs++;
      let matched = 0;
      let nearest = Infinity;
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 6; j++) {
          const dist = Math.hypot(pa[i * 2] - pb[j * 2], pa[i * 2 + 1] - pb[j * 2 + 1]);
          if (dist < 1e-9) matched++;
          nearest = Math.min(nearest, dist);
        }
      }
      if (matched === 2) sharing++; else worstGap = Math.max(worstGap, nearest);
    }
  }
  measure('adjacent tile pairs', pairs);
  measure('pairs sharing exactly two corners', sharing);
  measure('worst gap between tiles that do not, px', worstGap);
  assert('there are pairs to check', pairs > 100);
  check('every adjacent pair shares its edge exactly', sharing, pairs, 0);

  // A hexagon, not a sliver: the corners must go round in order and enclose
  // real area. A degenerate polygon fills nothing and would pass a corner test.
  let smallest = Infinity;
  for (const poly of polys) {
    if (poly === null) continue;
    let area2 = 0;
    for (let i = 0; i < 6; i++) {
      const j = (i + 1) % 6;
      area2 += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
    }
    smallest = Math.min(smallest, Math.abs(area2) / 2);
  }
  measure('smallest tile area on screen, px2', smallest);
  assert('no tile is degenerate', smallest > 1);

  // Round the back is null rather than folded onto the front.
  const behind = tilePolygons(world.subMap([4]),
    { ...cam, yaw: cam.yaw + Math.PI }, view, 4);
  let front = 0;
  for (const poly of behind) if (poly !== null) front++;
  measure('tiles facing us with the globe turned away', front);
  assert('turning the globe hides the region', front < drawn / 2);
});

suite('every cell is served the same, there being only one kind now', () => {
  // This used to be about the twelve pentagons and how badly they were served:
  // one global tile scale, sized for the widest hexagon, drew a pentagon's
  // tiles 27% too far out and the clip ate a third of them.
  //
  // There are no pentagons any more -- the world map is a hex grid that wraps
  // east to west -- but the scale is still measured per cell, and it has to
  // be, because the equal-area projection makes cells near the ice caps twice
  // as tall as they are wide. Equal area is not equal shape.
  const world = new World({ seed: 20260826 });
  const cam = newCamera();
  const view = globeView(W, H);

  let fives = 0;
  for (let c = 0; c < CELL_COUNT; c++) if (neighbourCount(c) === 5) fives++;
  check('no cell has five neighbours', fives, 0, 0);

  // One cell from each row, so the equator and the cap rows are both covered.
  const ratios: number[] = [];
  for (const cell of [2, 20, 39, 57, 75, 93]) {
    const kids = world.subMap([cell]);
    const facing = {
      ...cam,
      yaw: Math.atan2(centres[cell * 3], centres[cell * 3 + 2]),
      pitch: Math.atan2(centres[cell * 3 + 1],
        Math.hypot(centres[cell * 3], centres[cell * 3 + 2])),
    };
    const polys = tilePolygons(kids, facing, view, cell);

    let furthest = 0;
    for (const poly of polys) {
      if (poly === null) continue;
      for (let i = 0; i < 6; i++) {
        furthest = Math.max(furthest,
          Math.hypot(poly[i * 2] - view.cx, poly[i * 2 + 1] - view.cy));
      }
    }
    let cellReach = 0;
    const poly = outline(cell);
    for (let i = 0; i < poly.length; i += 3) {
      const [px, py] = rotate(facing, poly[i], poly[i + 1], poly[i + 2]);
      cellReach = Math.max(cellReach, Math.hypot(px * view.radius, py * view.radius));
    }
    ratios.push(furthest / cellReach);
  }

  measure('tightest tile coverage of a cell', Math.min(...ratios));
  measure('loosest tile coverage of a cell', Math.max(...ratios));
  assert('no cell is left with a bare fringe', Math.min(...ratios) > 0.9);
  assert('and none has its tiles eaten by the clip', Math.max(...ratios) < 1.25);
});
