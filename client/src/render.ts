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
import { SUBCELL_COUNT, toPixel, fromPixel } from '../../sim/geo/hexgrid.ts';
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
export function corners(size: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
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
): void {
  const { cx, cy, radius } = view;

  // The ocean, as one disc behind everything. Cheaper than drawing seven
  // thousand water hexes and it removes the hairline gaps between them.
  ctx.fillStyle = '#0e2740';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();

  for (let c = 0; c < CELL_COUNT; c++) {
    const [, cyy, cz] = rotate(cam, centres[c * 3], centres[c * 3 + 1], centres[c * 3 + 2]);
    if (cz < 0) continue;
    if (planet.elevationM[c] < 0) continue;

    const poly = outline(c);
    ctx.beginPath();
    for (let i = 0; i < poly.length; i += 3) {
      const [px, py] = rotate(cam, poly[i], poly[i + 1], poly[i + 2]);
      const sx = cx + px * radius;
      const sy = cy - py * radius;
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();

    // Light from the upper left, plus a lift with altitude so ranges read.
    const lambert = 0.55 + 0.45 * Math.max(0, cz * 0.75 + cyy * 0.35);
    const altitude = 1 + Math.min(0.5, Math.max(0, planet.elevationM[c]) / 6000);
    ctx.fillStyle = shade(BIOME_COLOURS[planet.biome[c]], lambert * altitude);
    ctx.fill();

    const owner = owned.get(c);
    if (owner !== undefined) {
      ctx.strokeStyle = houseColour(owner);
      ctx.lineWidth = 1.5;
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
  // Fit the whole sub-map by default: a radius-57 hexagon is 115 cells across.
  const base = Math.min(w, h) / 128;
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
): void {
  const { cx, cy, size } = view;
  const shape = corners(size);

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
    ctx.fillStyle = shade(BIOME_COLOURS[map.biome[c]], relief);
    ctx.fill();
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
