// Drawing. Nothing in here is allowed to decide anything about the world.
//
// The globe is drawn in orthographic projection -- what a sphere actually looks
// like from far away -- rather than unrolled flat. That costs a hemisphere of
// visibility and buys the thing an unrolled map cannot have: no distortion at
// the poles, no seam, and a shape a player can rotate and believe.
//
// Below the globe every layer is a flat hex field, so the same routine draws
// realm and ground with nothing but a scale change.

import { CELL_COUNT, centres, outline } from '../../sim/geo/sphere.ts';
import { RADIUS, SUBCELL_COUNT, toPixel, fromPixel } from '../../sim/geo/hexgrid.ts';
import { BIOME_COLOURS, Biome } from '../../sim/model/biome.ts';
import type { Planet } from '../../sim/gen/planet.ts';
import type { SubMap } from '../../sim/gen/submap.ts';

/**
 * Corner offsets of a pointy-top hexagon.
 *
 * Lives here rather than in sim/geo, where it started, because it needs
 * Math.cos and Math.sin and the simulation is not allowed them -- see
 * docs/determinism.md. Drawing a shape is not simulating one, so the function
 * moved to the renderer instead of the rule acquiring an exception.
 */
export function corners(size: number, rotationDeg = -30): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + rotationDeg);
    out.push({ x: size * Math.cos(a), y: size * Math.sin(a) });
  }
  return out;
}

export interface Camera {
  /** Globe rotation, radians. */
  yaw: number;
  pitch: number;
  /** Flat-view pan, in world units, and zoom. */
  panX: number;
  panY: number;
  zoom: number;
}

export function newCamera(): Camera {
  return { yaw: 0.6, pitch: 0.35, panX: 0, panY: 0, zoom: 1 };
}

/** Rotate a direction into view space. Yaw about the pole, then pitch. */
export function rotate(cam: Camera, x: number, y: number, z: number): [number, number, number] {
  const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  return [x1, y * cp - z1 * sp, y * sp + z1 * cp];
}

/** And back, for turning a click into a point on the sphere. */
export function unrotate(cam: Camera, x: number, y: number, z: number): [number, number, number] {
  const cp = Math.cos(-cam.pitch), sp = Math.sin(-cam.pitch);
  const y1 = y * cp - z * sp;
  const z1 = y * sp + z * cp;
  const cy = Math.cos(-cam.yaw), sy = Math.sin(-cam.yaw);
  return [x * cy - z1 * sy, y1, x * sy + z1 * cy];
}

/**
 * Shade a colour by relief.
 *
 * A biome map with flat fills reads as a chart. One cheap lambert term against
 * a fixed light makes it read as ground -- and it costs one multiply, because
 * on a sphere the surface normal is the position.
 */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = Math.max(0.25, Math.min(1.55, amount));
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/**
 * The colour a cell should be, given the land one layer below it.
 *
 * ONE LAYER DOWN, NEVER MORE. A region asks its 91 children what colour they
 * average to, and paints itself that. It stays a single hexagon -- it just
 * tells the truth about what is inside it, so a region that is half desert and
 * half steppe reads as neither one nor the other.
 *
 * This replaced drawing the children as a visible mosaic of little tiles. That
 * did put real information on screen and it looked like noise: ninety-one
 * shapes inside one hexagon reads as a dither pattern, not as terrain, and the
 * hexagon stopped reading as a hexagon at all.
 *
 * Recursing would mean the globe eventually asking for all 4.75 quadrillion
 * cells to paint twelve hexagons, which is the thing generate-on-demand exists
 * to prevent. Returning null is always safe: the cell keeps its own colour.
 */
export type CellTint = (cell: number) => string | null;

/**
 * The map one layer below a cell, for drawing that cell out of its own tiles.
 *
 * ONE LAYER DOWN, NEVER MORE. A region drawn from its 91 children shows real
 * terrain -- a coastline, a range, the edge of a desert -- without the world
 * map resolving anything below the layer under it. Recursing would mean the
 * globe eventually asking for all 4.75 quadrillion cells to paint twelve
 * shapes, which is what generate-on-demand exists to prevent.
 *
 * Returning null is always safe: the cell keeps its own colour.
 */
export type ChildLookup = (cell: number) => {
  dirs: Float64Array;
  biome: Uint8Array;
  elevationM: Float32Array;
} | null;

/**
 * How wide a cell must be on screen before it is worth drawing its children.
 *
 * A child is a ninth of its parent across, so at 34 px the children are around
 * 3.5 px each -- about the smallest a shape can be and still read as a shape.
 * Below it the tint takes over, which is the same information averaged, and at
 * that size averaging is what the eye is doing anyway.
 *
 * THIS IS WHY THE FIRST MOSAIC FAILED. It drew at 26 px, so the children were
 * 2.5 px, and it drew them as padded axis-aligned SQUARES rather than as
 * hexagons -- ninety-one little rectangles scattered inside a hexagon with
 * gaps between them. That reads as dither, not as terrain, and the parent
 * stopped reading as a hexagon at all. The information was right and the
 * geometry was wrong.
 */
export const MOSAIC_MIN_PX = 34;

/**
 * A child hexagon's circumradius against its parent's, and the turn that makes
 * their edges parallel.
 *
 * Ninety-one hexes of radius r arrange into a hexagon of circumradius
 * sqrt(3)*RADIUS*r, so r = size/(sqrt(3)*RADIUS) makes the arrangement span
 * exactly as far as the parent does.
 *
 * The arrangement comes out flat-topped -- its corners land at 0, 60, 120
 * degrees -- while a cell drawn by `corners` is pointy-topped, at 30, 90, 150.
 * Turning the children thirty degrees puts the two in register, so the grain
 * of the small hexes runs parallel to the big one's edges instead of cutting
 * across them at an angle. It is the difference between a hexagon made of
 * hexagons and a hexagon with something spilled in it.
 */
const CHILD_SCALE = 1 / (Math.sqrt(3) * RADIUS);
const CHILD_TURN_DEG = 30;
const COS30 = Math.sqrt(3) / 2;
const SIN30 = 0.5;

/** Angular circumradius of a layer-0 cell, for sizing children on the globe. */
const L0_RADIUS_RAD = Math.sqrt(
  (4 * Math.PI) / CELL_COUNT / ((3 * Math.sqrt(3)) / 2),
);

/**
 * Below this many pixels across, a cell is not worth asking about.
 *
 * Blending a cell's children costs generating them, and a cell three pixels
 * wide looks the same either way.
 */
export const TINT_MIN_PX = 6;

/**
 * The average colour of a set of cells, as the eye would see them mixed.
 *
 * Averaged in linear light rather than in the sRGB values, because sRGB is
 * perceptual and mixing it directly makes everything muddy -- half green and
 * half sand comes out a dull olive rather than the pale khaki it should be.
 * Squaring in and rooting out is the cheap approximation of that and it is
 * close enough for a hexagon.
 *
 * Water is mixed in as water, so a region that is a third coast reads bluer
 * than one that is not -- which is most of what makes a coastline legible on
 * a map with 92 cells on it.
 */
export function blendColours(colours: readonly string[]): string {
  if (colours.length === 0) return '#000000';
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of colours) {
    const n = parseInt(c.slice(1), 16);
    const cr = (n >> 16) & 255;
    const cg = (n >> 8) & 255;
    const cb = n & 255;
    r += cr * cr;
    g += cg * cg;
    b += cb * cb;
  }
  const k = colours.length;
  const hex = (v: number): string =>
    Math.round(Math.sqrt(v / k)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}


export interface GlobeView {
  cx: number;
  cy: number;
  radius: number;
}

export function globeView(w: number, h: number): GlobeView {
  return { cx: w / 2, cy: h / 2, radius: Math.min(w, h) * 0.42 };
}

/**
 * Draw the planet.
 *
 * Only the near hemisphere is drawn -- a cell whose rotated z is negative is
 * round the back. Testing the cell *centre* rather than each corner means a
 * cell exactly on the limb is either wholly drawn or wholly skipped, which is
 * invisible at this size and halves the work.
 */
export function drawGlobe(
  ctx: CanvasRenderingContext2D,
  planet: Planet,
  cam: Camera,
  view: GlobeView,
  highlight: number,
  owned: Map<number, number>,
  tint: CellTint | null = null,
  children: ChildLookup | null = null,
): void {
  const { cx, cy, radius } = view;

  // The ocean, as one disc behind everything. Cheaper than drawing seven
  // thousand water hexes and it removes the hairline gaps between them.
  ctx.fillStyle = '#0e2740';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  // Three ways to paint a cell, by how big it is on screen: out of its own
  // children, as their average, or flat. The ladder is what keeps a zoomed-out
  // globe from asking for ten thousand sub-maps to fill a dozen shapes.
  const regionPx = (2 * radius) / Math.sqrt(CELL_COUNT);
  const wantMosaic = children !== null && regionPx >= MOSAIC_MIN_PX;
  const wantTint = !wantMosaic && tint !== null && regionPx >= TINT_MIN_PX;
  // A child's own circumradius on screen. Nudged up a little because the
  // sphere's projection compresses cells away from the centre, and a gap
  // between children reads far worse than an overlap the clip will trim.
  const childPx = ((radius * L0_RADIUS_RAD) / Math.sqrt(SUBCELL_COUNT)) * 1.08;

  for (let c = 0; c < CELL_COUNT; c++) {
    const [, cyy, cz] = rotate(cam, centres[c * 3], centres[c * 3 + 1], centres[c * 3 + 2]);
    if (cz < 0) continue;
    if (planet.elevationM[c] < 0) continue;

    // Light from the upper left, plus a lift with altitude so ranges read.
    const lambert = 0.55 + 0.45 * Math.max(0, cz * 0.75 + cyy * 0.35);
    const altitude = 1 + Math.min(0.5, Math.max(0, planet.elevationM[c]) / 6000);

    globeCellPath(ctx, c, cam, view);
    const base = (wantTint ? tint(c) : null) ?? BIOME_COLOURS[planet.biome[c]];
    // Filled whether or not a mosaic follows. The union of 91 hexagons has a
    // serrated edge, and without a solid parent under it the ocean shows
    // through every notch.
    ctx.fillStyle = shade(base, lambert * altitude);
    ctx.fill();

    if (wantMosaic) {
      const kids = children!(c);
      if (kids !== null) {
        ctx.save();
        // Clipped to the parent, so the cell keeps a clean hexagonal
        // silhouette however ragged the tiling inside it is.
        ctx.clip();
        drawGlobeChildren(ctx, kids, cam, view, childPx, lambert);
        ctx.restore();
      }
    }

    const owner = owned.get(c);
    if (owner !== undefined) {
      // The path was consumed by the mosaic, so lay it down again.
      globeCellPath(ctx, c, cam, view);
      ctx.strokeStyle = houseColour(owner);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (wantMosaic) {
      // And a hairline on every cell once it has structure inside it, or the
      // eye loses where one region stops and the next begins.
      globeCellPath(ctx, c, cam, view);
      ctx.strokeStyle = 'rgba(12,20,30,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  if (highlight >= 0) {
    const [, , hz] = rotate(cam, centres[highlight * 3], centres[highlight * 3 + 1], centres[highlight * 3 + 2]);
    if (hz >= 0) {
      const poly = outline(highlight);
      ctx.beginPath();
      for (let i = 0; i < poly.length; i += 3) {
        const [px, py] = rotate(cam, poly[i], poly[i + 1], poly[i + 2]);
        const sx = cx + px * radius;
        const sy = cy - py * radius;
        if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.strokeStyle = '#c9a227';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // The limb, so the sphere has an edge.
  ctx.strokeStyle = '#2c3038';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * Lay down one Goldberg cell's outline as the current path.
 *
 * A function rather than inline because the path has to be laid twice on any
 * cell that gets a mosaic: drawing the children calls beginPath and takes it
 * away, and the border still has to be stroked afterwards. Canvas save/restore
 * does not preserve the current path, so there is nothing to put it back.
 */
function globeCellPath(
  ctx: CanvasRenderingContext2D,
  cell: number,
  cam: Camera,
  view: GlobeView,
): void {
  const { cx, cy, radius } = view;
  const poly = outline(cell);
  ctx.beginPath();
  for (let i = 0; i < poly.length; i += 3) {
    const [px, py] = rotate(cam, poly[i], poly[i + 1], poly[i + 2]);
    const sx = cx + px * radius;
    const sy = cy - py * radius;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

/**
 * Paint one region out of its own ninety-one tiles.
 *
 * The children carry real positions on the sphere, so they are projected the
 * same way their parent was and land where they belong. No separate layout and
 * no assumption that a hexagon of hexagons is itself a hexagon -- which it is
 * not, quite: its edges are serrated, which is what the clip is for.
 *
 * Drawn as hexagons and not as the quads a first version used. At four or five
 * pixels the difference between a hexagon and a square is small and it is not
 * nothing: hexagons tessellate, so the tiling closes up and reads as ground,
 * where squares leave a lattice of gaps and read as noise.
 *
 * Lit with the parent's own lambert term so the whole region still reads as
 * one surface facing one way, with texture on it, rather than as ninety-one
 * separate things that happen to be adjacent.
 */
function drawGlobeChildren(
  ctx: CanvasRenderingContext2D,
  kids: { dirs: Float64Array; biome: Uint8Array; elevationM: Float32Array },
  cam: Camera,
  view: GlobeView,
  childPx: number,
  lambert: number,
): void {
  const { cx, cy, radius } = view;
  const shape = corners(childPx);

  for (let k = 0; k < SUBCELL_COUNT; k++) {
    const [px, py, pz] = rotate(cam, kids.dirs[k * 3], kids.dirs[k * 3 + 1], kids.dirs[k * 3 + 2]);
    if (pz < 0) continue;
    const x = cx + px * radius;
    const y = cy - py * radius;

    const alt = 1 + Math.min(0.5, Math.max(0, kids.elevationM[k]) / 6000);
    ctx.fillStyle = kids.elevationM[k] < 0
      ? shade(OCEAN, lambert)
      : shade(BIOME_COLOURS[kids.biome[k]], lambert * alt);

    ctx.beginPath();
    ctx.moveTo(x + shape[0].x, y + shape[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(x + shape[i].x, y + shape[i].y);
    ctx.closePath();
    ctx.fill();
  }
}

/** Water, as the children see it. Matches the disc behind the globe. */
const OCEAN = '#1b3a5c';

/** Screen point back to a direction on the sphere, or null if off the globe. */
export function pickGlobe(
  cam: Camera, view: GlobeView, sx: number, sy: number,
): [number, number, number] | null {
  const x = (sx - view.cx) / view.radius;
  const y = -(sy - view.cy) / view.radius;
  const r2 = x * x + y * y;
  if (r2 > 1) return null;
  // The near hemisphere: given x and y on a unit sphere, z follows.
  return unrotate(cam, x, y, Math.sqrt(1 - r2));
}

// ---------------------------------------------------------------------------

export interface FlatView {
  cx: number;
  cy: number;
  /** Pixels per hex circumradius. */
  size: number;
}

export function flatView(w: number, h: number, cam: Camera): FlatView {
  // Fit the whole sub-map, derived from the grid rather than written down.
  //
  // This was a hardcoded 128, right for the 115 cells across a radius-57
  // hexagon and wrong by a factor of ten for a radius-5 one -- the map had been
  // drawing at a tenth of the window since the rescale, in a corner, and
  // nothing failed because nothing measures how big a picture is.
  //
  // Both dimensions matter and they are not the same: a pointy-top field of
  // radius R is (2R+1)*sqrt(3) cell-radii wide and (3R+2) tall, so fitting to
  // the shorter window side alone still overflows the other one.
  const wide = (2 * RADIUS + 1) * Math.sqrt(3);
  const tall = 3 * RADIUS + 2;
  const base = Math.min(w / wide, h / tall) * 0.95;
  return { cx: w / 2 + cam.panX, cy: h / 2 + cam.panY, size: base * cam.zoom };
}

/**
 * Draw a sub-map: realm or ground, the same routine for both.
 *
 * Rivers are drawn as a second pass over the fills rather than as a tint on
 * them, because a river is a line through a landscape and a tinted hexagon
 * reads as a wet field. At this scale a channel is narrower than a cell, so
 * what is actually drawn is the chain of cells the water runs through.
 */
export function drawSubMap(
  ctx: CanvasRenderingContext2D,
  map: SubMap,
  view: FlatView,
  highlight: number,
  owned: Map<number, number>,
  populated: Map<number, number>,
  worked: Map<number, number> | null = null,
  tint: CellTint | null = null,
  children: ChildLookup | null = null,
): void {
  const { cx, cy, size } = view;
  const shape = corners(size);
  const wantMosaic = children !== null && size * 2 >= MOSAIC_MIN_PX;
  const wantTint = !wantMosaic && tint !== null && size * 2 >= TINT_MIN_PX;
  // Children lay out as their own hex grid inside this cell, turned thirty
  // degrees so their grain runs with the parent's edges rather than across
  // them. Flat coordinates, so this is exact -- no projection, no lookup.
  const childSize = size * CHILD_SCALE;
  const childShape = corners(childSize, -30 + CHILD_TURN_DEG);

  let lo = Infinity;
  let hi = -Infinity;
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    if (map.elevationM[c] < lo) lo = map.elevationM[c];
    if (map.elevationM[c] > hi) hi = map.elevationM[c];
  }
  const span = Math.max(1, hi - lo);

  for (let c = 0; c < SUBCELL_COUNT; c++) {
    const p = toPixel(c, size);
    const x = cx + p.x;
    const y = cy + p.y;
    // Cull off-screen. At full zoom on a ground map this skips most of them.
    if (x < -size * 2 || y < -size * 2 || x > ctx.canvas.width + size * 2 || y > ctx.canvas.height + size * 2) {
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(x + shape[0].x, y + shape[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(x + shape[i].x, y + shape[i].y);
    ctx.closePath();

    const relief = 0.72 + 0.5 * ((map.elevationM[c] - lo) / span);
    const base = (wantTint ? tint!(c) : null) ?? BIOME_COLOURS[map.biome[c]];
    // Filled first either way: the union of 91 hexagons has a serrated edge
    // and the background would show through every notch.
    ctx.fillStyle = shade(base, relief);
    ctx.fill();

    if (wantMosaic) {
      const kids = children!(c);
      if (kids !== null) {
        ctx.save();
        ctx.clip();
        for (let k = 0; k < SUBCELL_COUNT; k++) {
          const q = toPixel(k, childSize);
          // The thirty-degree turn, applied to the layout as well as to the
          // shape. Turning one and not the other puts them out of register.
          const qx = q.x * COS30 - q.y * SIN30;
          const qy = q.x * SIN30 + q.y * COS30;
          const kx = x + qx;
          const ky = y + qy;
          const alt = 0.72 + 0.5 * ((kids.elevationM[k] - lo) / span);
          ctx.fillStyle = kids.elevationM[k] < 0
            ? OCEAN
            : shade(BIOME_COLOURS[kids.biome[k]], alt);
          ctx.beginPath();
          ctx.moveTo(kx + childShape[0].x, ky + childShape[0].y);
          for (let i = 1; i < 6; i++) ctx.lineTo(kx + childShape[i].x, ky + childShape[i].y);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();

        // The cell's own edge, back on top of its texture.
        ctx.beginPath();
        ctx.moveTo(x + shape[0].x, y + shape[0].y);
        for (let i = 1; i < 6; i++) ctx.lineTo(x + shape[i].x, y + shape[i].y);
        ctx.closePath();
        ctx.strokeStyle = 'rgba(12,20,30,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  // Water second, so channels sit on top of the ground they cut through.
  for (let c = 0; c < SUBCELL_COUNT; c++) {
    if (map.drainage[c] < 0.55 || map.elevationM[c] < 0) continue;
    const p = toPixel(c, size);
    const x = cx + p.x;
    const y = cy + p.y;
    if (x < -size * 2 || y < -size * 2 || x > ctx.canvas.width + size * 2 || y > ctx.canvas.height + size * 2) {
      continue;
    }
    const strength = (map.drainage[c] - 0.55) / 0.45;
    ctx.fillStyle = `rgba(70,130,180,${0.30 + 0.6 * strength})`;
    ctx.beginPath();
    ctx.arc(x, y, size * (0.30 + 0.55 * strength), 0, Math.PI * 2);
    ctx.fill();
  }

  // The fields a settlement is actually working, hatched over the ground.
  // Drawn before claims so a border still reads on top of its own fields.
  if (worked !== null) {
    for (const [cell, share] of worked) {
      const p = toPixel(cell, size);
      const x = cx + p.x;
      const y = cy + p.y;
      if (x < -size * 2 || y < -size * 2 || x > ctx.canvas.width + size * 2 || y > ctx.canvas.height + size * 2) {
        continue;
      }
      ctx.fillStyle = `rgba(201,162,39,${0.20 + 0.45 * share})`;
      ctx.beginPath();
      ctx.moveTo(x + shape[0].x, y + shape[0].y);
      for (let i = 1; i < 6; i++) ctx.lineTo(x + shape[i].x, y + shape[i].y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Claims and settlements.
  for (const [cell, owner] of owned) {
    const p = toPixel(cell, size);
    ctx.strokeStyle = houseColour(owner);
    ctx.lineWidth = Math.max(1, size * 0.12);
    ctx.beginPath();
    ctx.moveTo(cx + p.x + shape[0].x, cy + p.y + shape[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(cx + p.x + shape[i].x, cy + p.y + shape[i].y);
    ctx.closePath();
    ctx.stroke();
  }
  for (const [cell, people] of populated) {
    const p = toPixel(cell, size);
    // Area with population, so a hamlet and a city differ by more than a dot.
    const r = Math.max(2, Math.min(size * 0.8, size * 0.22 * Math.sqrt(Math.max(1, people))));
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.arc(cx + p.x, cy + p.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (highlight >= 0) {
    const p = toPixel(highlight, size);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + p.x + shape[0].x, cy + p.y + shape[0].y);
    for (let i = 1; i < 6; i++) ctx.lineTo(cx + p.x + shape[i].x, cy + p.y + shape[i].y);
    ctx.closePath();
    ctx.stroke();
  }
}

export function pickSubMap(view: FlatView, sx: number, sy: number): number {
  return fromPixel(sx - view.cx, sy - view.cy, view.size);
}

/** A stable colour per house, spread around the wheel by a golden step. */
export function houseColour(house: number): string {
  const hue = (house * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 65%, 58%)`;
}

export { Biome, BIOME_COLOURS };
