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
import { CELL_COUNT } from '../sim/geo/sphere.ts';
import { SUBCELL_COUNT } from '../sim/geo/hexgrid.ts';
import { Biome } from '../sim/model/biome.ts';
import {
  newCamera, globeView, flatView, drawGlobe, drawSubMap,
  pickGlobe, pickSubMap, corners, rotate, unrotate, houseColour,
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

  beginPath(): void {}
  closePath(): void {}
  moveTo(x: number, y: number): void { this.points.push(x, y); }
  lineTo(x: number, y: number): void { this.points.push(x, y); }
  arc(x: number, y: number, r: number): void { this.points.push(x, y, r); this.arcs++; }
  fill(): void { this.fills++; }
  stroke(): void { this.strokes++; }
  fillRect(): void {}
  fillText(): void {}
  setTransform(): void {}

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
