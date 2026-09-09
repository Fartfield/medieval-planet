// Drawing. Nothing in here is allowed to decide anything about the world.
//
// The globe is drawn in orthographic projection -- what a sphere actually looks
// like from far away -- rather than unrolled flat. That costs a hemisphere of
// visibility and buys the thing an unrolled map cannot have: no distortion at
// the poles, no seam, and a shape a player can rotate and believe.
//
// Below the globe every layer is a flat hex field, so the same routine draws
// realm and ground with nothing but a scale change.

import {
  CELL_COUNT, centres, outline, BAND_SIN_LIMIT, CELL_R, CAP_RADIUS_RAD,
} from '../../sim/geo/sphere.ts';
import {
  RADIUS, SUBCELL_COUNT, coords, DIRECTIONS, fromPixel,
} from '../../sim/geo/hexgrid.ts';
import { BIOME_COLOURS, Biome } from '../../sim/model/biome.ts';
import type { Planet } from '../../sim/gen/planet.ts';
import type { SubMap, Basis } from '../../sim/gen/submap.ts';
import { toDirection, toLocal, cellContaining } from '../../sim/gen/submap.ts';
import { uniform3 } from '../../sim/gen/noise.ts';
import { floraAt, FloraKind } from '../../sim/model/flora.ts';
import {
  standOn, siteFrom, individualsAffordable, CROWN_GRID_M, type Stand,
} from '../../sim/model/stand.ts';
import {
  drawStand, groundTileFor, drawGround, seasonOf, drawHerd,
} from './flora_render.ts';
import { herdOn, type Herd } from '../../sim/model/herd.ts';
import * as A from '../../sim/anchors.ts';
import type { Patch } from '../../sim/geo/patch.ts';
import {
  PENT_HALO_COUNT, pentCornerNeighbours,
} from '../../sim/geo/pentgrid.ts';

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
  /**
   * Flat-view turn, degrees, and it is not a control the player has.
   *
   * Walking off the edge of one tile onto the next swaps which map the picture
   * is drawn in the terms of, and neighbouring maps are turned relative to
   * each other -- each one's basis faces its OWN first neighbour, and that is
   * a different direction for each. Swapping frames without compensating spins
   * the whole world under the cursor, by as much as sixty degrees, at the
   * moment the player crosses a boundary they cannot see.
   *
   * So the turn between the old frame and the new one is added here, and the
   * picture does not move. It accumulates as you walk, which is correct: it is
   * the accumulated bearing change of walking across a sphere.
   */
  rot: number;
}

export function newCamera(): Camera {
  return { yaw: 0.6, pitch: 0.35, panX: 0, panY: 0, zoom: 1, rot: 0 };
}

/** Rotate a direction into view space. Yaw about the pole, then pitch. */
export function rotate(cam: Camera, x: number, y: number, z: number): [number, number, number] {
  const t = camTrig(cam);
  const x1 = x * t.cy - z * t.sy;
  const z1 = x * t.sy + z * t.cy;
  return [x1, y * t.cp - z1 * t.sp, y * t.sp + z1 * t.cp];
}

/**
 * The camera's four trig values, taken once instead of per point.
 *
 * `rotate` is a convenience and reads like one -- pass a point, get a point --
 * and on the world view it was called about 125,000 times a frame, once for
 * every lattice point and tile centre of every visible region. Each call took
 * a cosine and a sine of the yaw and of the pitch, so a frame spent half a
 * million transcendentals re-deriving four numbers that do not change within
 * it, and returned a freshly allocated triple each time for the garbage
 * collector to take away again.
 *
 * The hot loops take the four values once and do six multiplies a point into
 * a buffer they already own. `rotate` is kept for everything that runs a
 * handful of times a frame, where the clarity is worth more than the cycles.
 */
export interface CamTrig {
  cy: number;
  sy: number;
  cp: number;
  sp: number;
}

export function camTrig(cam: Camera): CamTrig {
  return {
    cy: Math.cos(cam.yaw), sy: Math.sin(cam.yaw),
    cp: Math.cos(cam.pitch), sp: Math.sin(cam.pitch),
  };
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
/**
 * A colour lightened or darkened, REMEMBERED.
 *
 * This parses a hex string, does three multiplications and builds a new
 * string, and the mosaic calls it once per tile: about 28,000 times a frame at
 * the ground layer. String parsing and allocation at that rate was most of the
 * frame -- measured, dragging went from a median of 16 ms to 3 ms by not doing
 * it twice for the same answer.
 *
 * The brightness is quantised to 64 steps before it becomes a key, because a
 * cache with continuous keys is not a cache: it would hold a separate entry
 * for 0.9312 and 0.9375, which no eye can tell apart and no lookup would ever
 * hit twice. Sixty-four steps over the 0.25 to 1.55 range is a step of two
 * percent, well under what shows on screen.
 *
 * Bounded by construction: a couple of dozen biome colours times 64 steps.
 */
const shadeCache = new Map<string, (string | undefined)[]>();

function shade(hex: string, amount: number): string {
  const f = Math.max(0.25, Math.min(1.55, amount));
  const q = Math.round(f * 64);
  // TWO LEVELS, so the lookup allocates nothing. A single map keyed by
  // `${hex}|${q}` builds a string 28,000 times a frame purely to ask a
  // question, which is most of what the cache was meant to save. The colour
  // string is already interned by the caller, so it can be the key itself.
  let steps = shadeCache.get(hex);
  if (steps === undefined) { steps = []; shadeCache.set(hex, steps); }
  const hit = steps[q];
  if (hit !== undefined) return hit;

  const n = parseInt(hex.slice(1), 16);
  const g = q / 64;
  const out = `rgb(${Math.min(255, Math.round(((n >> 16) & 255) * g))},`
    + `${Math.min(255, Math.round(((n >> 8) & 255) * g))},`
    + `${Math.min(255, Math.round((n & 255) * g))})`;
  steps[q] = out;
  return out;
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
export type ChildLookup = (cell: number) => ChildFrame | null;

/**
 * How wide a tile has to be on screen before a cell is drawn out of its own
 * tiles at all. Below this the blend says the same thing more cheaply.
 *
 * WHERE THIS BITES, measured, because it is a silent switch and worth knowing
 * the size of. The world view's tile width is the globe's radius times CELL_R
 * over sqrt(91), so at four pixels the mosaic turns off below about 458 CSS
 * pixels of window:
 *
 *     window   tile px      window   tile px
 *       900      7.86         500      4.37
 *       700      6.11         450      3.93   <- off
 *       600      5.24         400      3.49   <- off
 *
 * CSS pixels are what innerHeight reports, so browser zoom moves a window
 * across that line without its size changing. It was lowered to 1.5 on the
 * suspicion that this was why the world view kept losing its tiles, and put
 * back: verify_render deliberately asserts a 200 px globe asks for no
 * children, and a window under 458 px is not what was being reported.
 */
export const MOSAIC_MIN_PX = 4;

/**
 * How wide a shape must be on screen before its outline is worth drawing.
 *
 * A grid line costs more than the shape it bounds -- a stroked hexagon is six
 * segments with joins, against one fill -- and below a few pixels the line IS
 * the shape: outlining a 3 px hexagon paints over everything it was supposed
 * to bound and the map turns into a mesh. Eight pixels is where a hexagon has
 * an inside worth showing.
 */
export const GRID_MIN_PX = 8;

/**
 * How heavy a tile's hairline is, as a share of the tile.
 *
 * The tile grid on the world view used to be gated on GRID_MIN_PX, the same
 * eight pixels that guards a REGION's outline -- and the two are not the same
 * question. A region outline is a 1.5 px line at full opacity, and the argument
 * for eight pixels is about that line swamping a small shape. A tile's edge is
 * a 0.5 px hairline at 35% alpha, which cannot swamp anything.
 *
 * Held to eight anyway, it vanished the moment the world map went from 192
 * cells to 546: a tile at a 900 px window fell from 11.98 px to 7.37, the
 * hairlines switched off, and 26,296 filled tiles merged into flat colour.
 * The mosaic was drawing perfectly and none of it was visible -- the fourth
 * time "the constituent hexes are not being drawn" has been reported, and the
 * second time the cause was the line deciding whether to outline them.
 *
 * So the weight scales with the tile instead of the tile being required to
 * reach a weight. A hairline that is always the same fraction of the shape it
 * bounds cannot paint over it, which means it can be drawn wherever a tile is
 * drawn at all, and there is one threshold on this again rather than two.
 * 1/16th reproduces the old 0.5 px exactly at the 8 px tile it was written
 * for.
 */
const TILE_EDGE_SHARE = 1 / 16;
const TILE_EDGE_MIN = 0.25;
const TILE_EDGE_MAX = 0.6;

/** The hairline weight for a tile of this width, or 0 if it is not worth one. */
export function tileEdgeWidth(tilePx: number): number {
  if (tilePx < MOSAIC_MIN_PX) return 0;
  return Math.min(TILE_EDGE_MAX, Math.max(TILE_EDGE_MIN, tilePx * TILE_EDGE_SHARE));
}

/**
 * A child hexagon's circumradius against its parent's.
 *
 * Ninety-one hexes of radius r arrange into a hexagon of circumradius
 * sqrt(3)*RADIUS*r, so r = size/(sqrt(3)*RADIUS) makes the arrangement span
 * exactly as far as the parent does. Used to decide whether children are big
 * enough on screen to be worth drawing, and how fine their edges should be.
 *
 * IT IS NO LONGER USED TO POSITION THEM, and the turn that went with it is
 * gone. The reasoning was that the arrangement comes out flat-topped while a
 * cell drawn by `corners` is pointy-topped, so turning the children thirty
 * degrees puts the two in register -- true of a hexagon of hexagons drawn on a
 * flat page, and not true of this. A child map's own basis faces its own first
 * neighbour, which is thirty degrees from its parent's only by accident, and
 * the ground is a sphere besides. The layer above therefore drew a tile in one
 * place and opening it put the tile somewhere else. Children are placed by the
 * same projection as everything else now; see `unitPlacements`.
 */
const CHILD_SCALE = 1 / (Math.sqrt(3) * RADIUS);
const SQRT3 = Math.sqrt(3);

/**
 * A REGION'S TILES ARE DRAWN WHERE THEY ARE. There used to be a number here.
 *
 * `COVER` scaled every tile 10.15% further out than its true position, so that
 * a region's 91 tiles reached its outline instead of leaving a fringe of flat
 * colour round the edge. The fringe is real -- 91 hexagons span
 * sqrt(3)*RADIUS/sqrt(91) = 90.8% of the hexagon holding them, because a
 * hexagon cannot be cut into hexagons -- and inflating them to hide it was the
 * wrong answer to it, for a reason that only shows when neighbours are drawn:
 * two adjacent regions' tiles, each inflated by a tenth, overlap each other by
 * a fifth and cannot line up at any angle.
 *
 * The right answer is that a region's tiles are not supposed to fill its
 * outline. They form a rosette that pushes past the edge in six places and
 * falls short in six others, and the neighbouring rosette fits those gaps
 * exactly. Measured: the nearest tile of the adjoining region sat 0.453 tile
 * widths away, twelve of them practically on top of each other; it is now
 * 0.991, which is what a lattice neighbour is. See ROSETTE_TURN_RAD.
 */


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
/**
 * What the world view actually did, so a caller can say so out loud.
 *
 * Added because "the world map is not showing its tiles" could not be told
 * apart from "the world map is showing its tiles and they look like this" from
 * outside the function, and every attempt to reason it out from the code was
 * wrong. The renderer draws 23,500 filled tiles when called directly with a
 * stub canvas, so whatever is happening is happening to the CALL, and the only
 * way to find that out is to have the call describe itself.
 */
export interface GlobeDrawn {
  /** Regions facing the camera and therefore drawn at all. */
  regions: number;
  /** Of those, how many were drawn out of their own tiles. */
  mosaics: number;
  /** How wide one tile is on screen, which is what decides the above. */
  tilePx: number;
  /** Whether a tile lookup was supplied at all. */
  offered: boolean;
}

export function drawGlobe(
  ctx: CanvasRenderingContext2D,
  planet: Planet,
  cam: Camera,
  view: GlobeView,
  highlight: number,
  owned: Map<number, number>,
  tint: CellTint | null = null,
  children: ChildLookup | null = null,
): GlobeDrawn {
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
  // How wide a tile is on screen, for deciding whether its edge is worth
  // drawing. Only a threshold now -- the tiles' actual size and shape come
  // from the lattice itself rather than from a number computed here.
  const childPx = (radius * CELL_R) / Math.sqrt(SUBCELL_COUNT);
  const wantMosaic = children !== null && childPx * 2 >= MOSAIC_MIN_PX;
  const childEdges = tileEdgeWidth(childPx * 2);

  // THREE PASSES, NOT ONE, and the reason is the tiling.
  //
  // A cell used to be filled and then drawn out of its own tiles before the
  // next cell was touched. That was safe only while a region's tiles stayed
  // inside its own outline. They do not: 91 hexagons cannot fill a hexagon, so
  // a region's tiles form a rosette that pushes past its edge in six places and
  // falls short in six others -- and the neighbouring region's rosette fits
  // into exactly those gaps. That is what makes the tiling exact.
  //
  // Drawn cell by cell, the next region's FILL painted over the last region's
  // protrusions, and its own tiles never covered the ground it had just erased,
  // because that ground belongs to the neighbour. Every seam came out as a band
  // of flat parent colour between two mosaics. So: all the fills, then all the
  // tiles, then all the edges. Nothing can erase what an earlier pass drew.
  const visible: number[] = [];
  const lambertOf = new Float64Array(CELL_COUNT);

  for (let c = 0; c < CELL_COUNT; c++) {
    const [, cyy, cz] = rotate(cam, centres[c * 3], centres[c * 3 + 1], centres[c * 3 + 2]);
    if (cz < 0) continue;
    // An ocean region is skipped ONLY when it is being painted flat. Once it
    // is being drawn from its own tiles it has to be drawn, because the
    // coastline lives in its children: a region whose average is below sea
    // level still holds the beach on the far side of its border.
    //
    // Skipping them is what made land stop dead at a hexagon edge. Sixty-four
    // of ninety-two regions drew nothing at all, so a coastline was resolved
    // on the land side of every border and simply absent on the other, and the
    // eye reads that as a continent cut out with a hexagonal cookie cutter.
    if (planet.elevationM[c] < 0 && !wantMosaic) continue;
    visible.push(c);
    // Light from the upper left, plus a lift with altitude so ranges read.
    lambertOf[c] = 0.55 + 0.45 * Math.max(0, cz * 0.75 + cyy * 0.35);
  }

  // PASS ONE: the ground, flat. Under a mosaic this is the blend of the very
  // tiles about to be drawn on top, so any sliver the rosette leaves uncovered
  // reads as part of the ground rather than as a rim of some other colour.
  for (const c of visible) {
    const lambert = lambertOf[c];
    const altitude = 1 + Math.min(0.5, Math.max(0, planet.elevationM[c]) / 6000);
    globeCellPath(ctx, c, cam, view);
    const base = (tint !== null && regionPx >= TINT_MIN_PX ? tint(c) : null)
      ?? BIOME_COLOURS[planet.biome[c]];
    ctx.fillStyle = shade(base, lambert * altitude);
    ctx.fill();
    // NOT sealed, unlike the tiles. A region's fill is followed by its own
    // outline in pass three whenever the grid is drawn at all, and that line
    // covers the seam; below the grid's threshold the regions are so small
    // that a hairline between them is narrower than the ocean disc showing
    // through would be visible. Sealing here only added a stroke per region.
  }

  let mosaics = 0;

  // PASS TWO: the tiles, unclipped. The clip used to be here to keep a cell's
  // silhouette clean however ragged the tiling inside it was -- which is the
  // same mistake in the other direction, since it cut off exactly the
  // protrusions that fill the neighbour's gaps.
  if (wantMosaic) {
    for (const c of visible) {
      const kids = children!(c);
      if (kids !== null) {
        drawGlobeChildren(ctx, kids, cam, view, lambertOf[c], childEdges);
        mosaics++;
      }
    }
  }

  // PASS THREE: the grid. Every cell gets an edge, because the hexagons ARE
  // the map -- a filled cell with no outline reads as a colour field, and the
  // player is choosing between cells rather than between colours. A house
  // border replaces it rather than adding to it, so ownership reads as the
  // strongest line on the globe.
  for (const c of visible) {
    const owner = owned.get(c);
    if (owner !== undefined) {
      globeCellPath(ctx, c, cam, view);
      ctx.strokeStyle = houseColour(owner);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (regionPx >= GRID_MIN_PX) {
      globeCellPath(ctx, c, cam, view);
      ctx.strokeStyle = 'rgba(8,14,22,0.5)';
      ctx.lineWidth = Math.min(1.1, Math.max(0.4, regionPx / 90));
      ctx.stroke();
    }
  }

  // The storms LAST, over the cells rather than under them, so their soft edge
  // covers the ragged boundary of the hole in the grid rather than revealing
  // it. See drawStormCaps.
  drawStormCaps(ctx, cam, view);

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

  drawAxis(ctx, cam, view);

  // The limb, so the sphere has an edge.
  ctx.strokeStyle = '#2c3038';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  return { regions: visible.length, mosaics, tilePx: childPx * 2, offered: children !== null };
}

/**
 * The two storm caps: everything poleward of where the hex band stops.
 *
 * WHAT THEY ARE. Not ice. The poles of this world are two permanent storms,
 * and the lore is in docs/world-lore.md: two pantheons face each other across
 * the planet, and the weather over each is the edge of one of them. Nothing
 * makes landfall against either -- the generator drowns the outermost row of
 * cells so the last thing before the wall of weather is open water.
 *
 * HOW THEY ARE DRAWN. A fan of quads from the pole out to the band's edge,
 * keeping only those facing the viewer. A cap is a spherical cap and its
 * outline crosses the limb at most latitudes, so filling it as one polygon
 * means handling that crossing; a fan sidesteps it entirely, because each
 * piece is small enough to be wholly in front or wholly behind.
 *
 * The ice version was a single ring of triangles, which was all a flat white
 * disc needed. A storm needs structure to read as one, so the fan is
 * subdivided radially as well and each piece is coloured by a spiral: the arms
 * are a sine in (angle + twist x radius), which is what a cyclone's arms
 * actually are, and they tighten towards the eye because the twist term grows
 * as the radius falls.
 *
 * The inner edge is still drawn from the NOTCH rather than from the band
 * limit, so it runs under the cells rather than up to them -- see below. That
 * part is unchanged and is what keeps the hex grid clean.
 */

/**
 * The polar axis and the equator.
 *
 * The globe turns about its poles -- yaw spins it around the axis and pitch
 * tilts the axis toward or away -- and without something drawn on it that is
 * hard to see, because a hexagon looks much like any other hexagon and there
 * is nothing to fix the eye on while it moves. The axis and the equator give
 * the rotation something to be relative to.
 *
 * The spindle is drawn past the surface at both ends the way a globe on a
 * stand has one, and only the near half of the equator is solid: the far half
 * is the same circle behind the sphere, and drawing it faintly is what makes
 * the ball read as a ball rather than as a disc.
 */
function drawAxis(ctx: CanvasRenderingContext2D, cam: Camera, view: GlobeView): void {
  const { cx, cy, radius } = view;
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const [px, py, pz] = rotate(cam, x, y, z);
    return [cx + px * radius, cy - py * radius, pz];
  };

  // The equator, in two passes so the far half can be fainter.
  const STEPS = 128;
  for (const near of [false, true]) {
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * Math.PI * 2;
      const [sx, sy, sz] = project(Math.cos(t), 0, Math.sin(t));
      if ((sz >= 0) !== near) { drawing = false; continue; }
      if (!drawing) { ctx.moveTo(sx, sy); drawing = true; } else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = near ? 'rgba(201,162,39,0.30)' : 'rgba(201,162,39,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // The spindle, out past the surface at both poles.
  const OVERHANG = 1.12;
  const [nx, ny, nz] = project(0, OVERHANG, 0);
  const [sx2, sy2] = project(0, -OVERHANG, 0);
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(sx2, sy2);
  ctx.strokeStyle = 'rgba(201,162,39,0.28)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // A cap on whichever pole is facing us, so the near end is legible.
  const [tx, ty] = nz >= 0 ? [nx, ny] : [sx2, sy2];
  ctx.beginPath();
  ctx.arc(tx, ty, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(201,162,39,0.55)';
  ctx.fill();
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
    const [ox, oy, oz] = flattenToBand(poly[i], poly[i + 1], poly[i + 2]);
    const [px, py] = rotate(cam, ox, oy, oz);
    const sx = cx + px * radius;
    const sy = cy - py * radius;
    if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

/** How many rings the fan is cut into. Enough to carry an arm across, cheap. */
const STORM_RINGS = 16;

/**
 * How many arms, and how hard they wind.
 *
 * A LOGARITHMIC spiral, which is the one thing here taken from the real
 * article: a cyclone's rainbands are log spirals, because a band winds by a
 * constant angle for every constant *ratio* of radius rather than for every
 * constant radius. The first attempt used `twist / radius`, which sends the
 * winding to infinity at the eye -- the radial term then swamped the angular
 * one completely and the cap came out as concentric rings with no arms in it
 * at all. A logarithm winds without ever running away.
 *
 * The count and the tightness are ours; a storm is not a measured thing here.
 * Tightness matters more than it sounds: at 2 arms and a twist of 2.2 the
 * spiral turned twice over between rim and eye, and a spiral that wound that
 * fast came out looking like concentric rings -- the arms were there, armT
 * swept its full range, and none of it was legible. Under one turn end to end
 * is what reads as a spiral.
 */
/**
 * How far the storm's edge is spread, in radians.
 *
 * Wide enough to swallow the raggedness it is hiding: the grid's boundary runs
 * from 9.0 to 13.5 degrees, so a fade of about 3.5 degrees either side of the
 * 12.4-degree area radius leaves the whole of it inside the gradient.
 */
const FEATHER_RAD = (3.5 * Math.PI) / 180;

const STORM_ARMS = 3;
const STORM_TWIST = 0.55;

/**
 * A palette each, because the two are opposed.
 *
 * The north storm is cold -- blue-white, lightning on slate. The south is
 * warm against it, violet on near-black. Two pantheons that agree on nothing
 * should not be the same colour, and it is the cheapest possible way to say
 * so on a globe you can spin.
 */
const STORM_NORTH = { deep: '#16233a', arm: '#b9cde8', eye: '#dce9f7' };
const STORM_SOUTH = { deep: '#241733', arm: '#cfb0dd', eye: '#f0dcf2' };

function mixHex(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(((na >> 16) & 255) * (1 - u) + ((nb >> 16) & 255) * u);
  const g = Math.round(((na >> 8) & 255) * (1 - u) + ((nb >> 8) & 255) * u);
  const bl = Math.round((na & 255) * (1 - u) + (nb & 255) * u);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

function drawStormCaps(ctx: CanvasRenderingContext2D, cam: Camera, view: GlobeView): void {
  const { cx, cy, radius } = view;
  const columns = 120;

  // DRAWN OVER THE CELLS, WITH A SOFT EDGE, and that is the whole trick.
  //
  // The storms used to be drawn underneath and the cells painted over them, so
  // what you saw of a storm was the shape of the hole in the grid. That hole is
  // a ring of hexagon sides around a five-fold vertex, which is pentagon-ish
  // and not round: measured, 9.0 degrees across the flats against 13.5 to the
  // points, and it came out on screen as a five-pointed star.
  //
  // Subdividing does not fix it. At frequency 9 the out-of-round ratio is 1.50,
  // which is exactly what it is at 7 -- the five-fold symmetry belongs to the
  // icosahedron, not to the resolution. Frequency 12 reaches 1.30 at three
  // times the cells and a cap a quarter wider, which is a great deal to pay for
  // a shape.
  //
  // A storm does not have a crisp edge in any case. So it is drawn on top, at
  // the radius its AREA implies, fading out across the width of the raggedness
  // -- opaque well inside the hole, gone well outside it, and the ragged
  // boundary somewhere in the gradient where no eye can find it. The cells
  // underneath are untouched and still simulated; this is weather over a map,
  // which is what it is meant to look like.
  const capR = CAP_RADIUS_RAD;
  const solid = capR - FEATHER_RAD;
  const clear = capR + FEATHER_RAD;

  for (const pole of [1, -1]) {
    const palette = pole > 0 ? STORM_NORTH : STORM_SOUTH;

    for (let r = 0; r < STORM_RINGS; r++) {
      const t0 = (r / STORM_RINGS) * clear;
      const t1 = ((r + 1) / STORM_RINGS) * clear;
      const tMid = 0.5 * (t0 + t1);

      // Opaque inside, gone outside, smooth between.
      let alpha = 1;
      if (tMid > solid) {
        const u = Math.min(1, (tMid - solid) / (clear - solid));
        alpha = 1 - u * u * (3 - 2 * u);
      }
      if (alpha <= 0.004) continue;

      // 0 at the eye, 1 at the nominal edge: what the arms are drawn against.
      const uMid = Math.min(1, tMid / capR);

      for (let col = 0; col < columns; col++) {
        const a0 = (col / columns) * 2 * Math.PI;
        const a1 = ((col + 1) / columns) * 2 * Math.PI;

        const quad: number[][] = [];
        for (const [tv, av] of [[t0, a0], [t0, a1], [t1, a1], [t1, a0]]) {
          const sp = Math.cos(tv) * pole;
          const cp = Math.sin(tv);
          quad.push(rotate(cam, cp * Math.cos(av), sp, cp * Math.sin(av)));
        }

        const zSum = quad[0][2] + quad[1][2] + quad[2][2] + quad[3][2];
        if (zSum < 0) continue;

        // Arms as a log spiral, winding opposite ways at the two poles.
        const aMid = 0.5 * (a0 + a1);
        const swirl = Math.sin(
          STORM_ARMS * (aMid * pole + STORM_TWIST * Math.log(Math.max(uMid, 0.05))));
        const armT = 0.5 + 0.5 * swirl;
        const band = Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, uMid))), 0.45);
        const eyeT = Math.max(0, 1 - uMid * 2.6);

        let colour = mixHex(palette.deep, palette.arm, armT * armT * band * 0.95);
        colour = mixHex(colour, palette.eye, eyeT * eyeT * eyeT);

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.moveTo(cx + quad[0][0] * radius, cy - quad[0][1] * radius);
        for (let i = 1; i < 4; i++) {
          ctx.lineTo(cx + quad[i][0] * radius, cy - quad[i][1] * radius);
        }
        ctx.closePath();
        const lambert = 0.55 + 0.45 * Math.max(0, zSum / 4);
        ctx.fillStyle = shade(colour, lambert);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * Nothing to flatten any more.
 *
 * The band ended in a zigzag row whose corners the equal-area projection
 * stretched into ten degrees of latitude, and this trimmed them back so the ice
 * had a straight edge to meet. A geodesic's edge is a ring of ordinary hexagon
 * sides and needs no such help, so a cell is now drawn exactly as the
 * simulation says it is -- which is what the old comment here wished for.
 */
function flattenToBand(x: number, y: number, z: number): [number, number, number] {
  return [x, y, z];
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
export interface ChildFrame {
  dirs: Float64Array;
  biome: Uint8Array;
  elevationM: Float32Array;
  // The WHOLE basis, not the two fields the old cylindrical layout happened to
  // read. `tilePolygons` calls `toDirection` with it now -- the generator's own
  // transform rather than a copy -- and that needs the frame's axes. Typed as
  // the narrow shape it silently worked, because the object passed in has
  // always been a full Basis; the type was the only thing that disagreed.
  basis: Basis;
  cellRadiusRad: number;
  /** 91 hexagons or 76 pentagon-patch cells. See sim/geo/patch.ts. */
  patch: Patch;
  /**
   * Productivity, and the scale the map is drawn at.
   *
   * Both are here because PLANT LIFE is drawn from them: how much grows
   * follows from productivity, and whether a crown can be told from its
   * neighbours follows from how big a tile is against a crown. The spacing in
   * metres and the spacing in radians together also give the sphere's radius,
   * so the renderer never has to be told it separately.
   */
  nppGm2: Float32Array;
  spacingM: number;
}

/**
 * Tile outlines for a pentagonal patch.
 *
 * Same dual construction as the hexagonal path and the same guarantee: two
 * neighbouring tiles build a shared corner from the same three cells, so the
 * tiling closes by construction rather than by tolerance. What differs is only
 * how the three are found.
 *
 * Positions are taken for the halo ring as well as the map, so a rim tile has
 * somewhere to put its outer corners. Nothing addresses the halo as a cell --
 * it exists to be a corner source and for nothing else.
 */
function pentagonTilePolygons(
  kids: ChildFrame,
  cam: Camera,
  view: GlobeView,
): (Float64Array | null)[] {
  const { cx, cy, radius } = view;
  const b = kids.basis;
  const r = kids.cellRadiusRad;
  const dir = new Float64Array(3);

  const sx = new Float64Array(PENT_HALO_COUNT);
  const sy = new Float64Array(PENT_HALO_COUNT);
  const front = new Uint8Array(PENT_HALO_COUNT);
  for (let c = 0; c < PENT_HALO_COUNT; c++) {
    const p = kids.patch.centre(c, r);
    toDirection(b, p.x, p.y, dir, 0);
    const [rx, ry, rz] = rotate(cam, dir[0], dir[1], dir[2]);
    sx[c] = cx + rx * radius;
    sy[c] = cy - ry * radius;
    front[c] = rz >= 0 ? 1 : 0;
  }

  const out: (Float64Array | null)[] = new Array(kids.patch.count).fill(null);
  for (let k = 0; k < kids.patch.count; k++) {
    if (front[k] === 0) continue;
    const ring = pentCornerNeighbours(k);
    if (ring.length < 3) continue;

    const poly = new Float64Array(ring.length * 2);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const c2 = ring[(i + 1) % ring.length];
      poly[i * 2] = (sx[k] + sx[a] + sx[c2]) / 3;
      poly[i * 2 + 1] = (sy[k] + sy[a] + sy[c2]) / 3;
    }
    out[k] = poly;
  }
  return out;
}

/**
 * Where every tile of a region sits on screen, as six corners each.
 *
 * Separated from the painting so the geometry can be checked rather than
 * eyeballed. The property that matters is not visible in any count of shapes:
 * ADJACENT TILES MUST SHARE THEIR CORNERS. Two tiles that merely happen to be
 * near each other leave a gap between them, and a gap is what the whole globe
 * looked like.
 *
 * The corners are the centroids of each triple of touching cells -- the same
 * dual construction sphere.ts uses to outline a Goldberg cell, and the reason
 * it is right here: two neighbouring tiles compute the SAME triple, so they
 * arrive at the same corner and the tiling closes exactly.
 *
 * What this replaced was a fixed-size, fixed-orientation hexagon dropped at
 * each projected centre. That cannot tessellate on a sphere and did not: the
 * tiles were upright wherever they sat while the lattice under them was
 * rotated and foreshortened by the projection, so the background showed
 * through between them and the grid did not follow the curve.
 *
 * Entries are null for tiles round the back of the globe.
 */
/**
 * The lattice a region's tiles are built from, on the sphere, cached.
 *
 * One ring wider than the map so the outermost tiles have corners to be built
 * from; the halo points carry no data because a corner is only a position.
 *
 * These are directions, not screen positions, and that is the whole point of
 * separating them: a lattice point sits where it sits on the sphere no matter
 * where the camera is, so the expensive half -- `toDirection`, which costs an
 * asin and two more transcendentals -- is done once per region and kept. Only
 * the rotation into view space is per frame.
 *
 * Through `toDirection`, the very function the generator used to place the
 * cell. Not a copy of it: the function. This WAS a copy, and it was left
 * behind when the ladder moved off the cylindrical projection onto an
 * isotropic tangent one. Near a pole the stale version clamped its
 * sine-of-latitude at 1 and folded neighbouring lattice points onto each
 * other, so a rim tile came out with duplicate corners -- five pairs of tiles
 * on a map at 67 degrees sharing ten corners instead of two. It left no gap,
 * which is why nothing looked wrong, and it was the third copy of this
 * arithmetic to drift from the original. Now there is no third copy.
 */
const LATTICE_SPAN = 2 * (RADIUS + 1) + 1;
const latticeOk = new Uint8Array(LATTICE_SPAN * LATTICE_SPAN);
const scratchX = new Float64Array(LATTICE_SPAN * LATTICE_SPAN);
const scratchY = new Float64Array(LATTICE_SPAN * LATTICE_SPAN);

function latticeAt(q: number, rr: number): number {
  return (q + RADIUS + 1) * LATTICE_SPAN + (rr + RADIUS + 1);
}

for (let q = -(RADIUS + 1); q <= RADIUS + 1; q++) {
  for (let rr = -(RADIUS + 1); rr <= RADIUS + 1; rr++) {
    const ss = -q - rr;
    if (ss < -(RADIUS + 1) || ss > RADIUS + 1) continue;
    latticeOk[latticeAt(q, rr)] = 1;
  }
}

/**
 * Somewhere to put a region's tile outlines, reused frame to frame.
 *
 * A visible region built 91 fresh Float64Arrays every frame and there are
 * about 240 of them, so the world view allocated 22,000 short-lived arrays a
 * frame purely to hand them straight to the canvas. The caller reads them
 * before asking for the next region's, so one store serves them all.
 */
const hexPolyStore = new Float64Array(SUBCELL_COUNT * 12);
const hexPoly: Float64Array[] = Array.from(
  { length: SUBCELL_COUNT },
  (_, k) => hexPolyStore.subarray(k * 12, k * 12 + 12),
);
const hexOut: (Float64Array | null)[] = new Array(SUBCELL_COUNT).fill(null);

const latticeCache = new WeakMap<ChildFrame, Float64Array>();

function latticeDirections(kids: ChildFrame): Float64Array {
  const hit = latticeCache.get(kids);
  if (hit !== undefined) return hit;

  const b = kids.basis;
  const r = kids.cellRadiusRad;
  const dirs = new Float64Array(LATTICE_SPAN * LATTICE_SPAN * 3);
  for (let q = -(RADIUS + 1); q <= RADIUS + 1; q++) {
    for (let rr = -(RADIUS + 1); rr <= RADIUS + 1; rr++) {
      const i = latticeAt(q, rr);
      if (latticeOk[i] === 0) continue;
      toDirection(b, r * SQRT3 * (q + rr / 2), r * 1.5 * rr, dirs, i * 3);
    }
  }
  latticeCache.set(kids, dirs);
  return dirs;
}

export function tilePolygons(
  kids: ChildFrame,
  cam: Camera,
  view: GlobeView,
): (Float64Array | null)[] {
  const { cx, cy, radius } = view;
  const b = kids.basis;
  const r = kids.cellRadiusRad;

  // A FIVE-FOLD PATCH TAKES A DIFFERENT ROUTE, because the machinery below is
  // axial and a five-fold lattice has no axial coordinates. The construction is
  // the same one -- a corner is the centroid of three touching cells -- but the
  // triples come from the patch's own cyclic neighbour list rather than from
  // walking (q, r) offsets. pentgrid builds one ring past the map for exactly
  // this, so a rim tile has real cells to make its outer corners from.
  if (kids.patch.sides === 5) return pentagonTilePolygons(kids, cam, view);

  // Every lattice point the region needs, one ring wider than the map itself
  // so the outermost tiles have corners to be built from. The halo points are
  // positions only -- no data, and none needed: a corner is a position.
  //
  // THE DIRECTIONS ARE CACHED AND THE SCREEN POSITIONS ARE NOT, because only
  // one of the two depends on the camera. A lattice point's direction is fixed
  // on the sphere for ever; where it lands on screen changes as the globe
  // turns. Recomputing both every frame put a `toDirection` -- an asin and two
  // more transcendentals -- on 169 points for each of ~240 visible regions,
  // forty thousand a frame, and that was 26 ms of the world view's 30. Now the
  // sphere part is done once per region and the frame does six multiplies a
  // point.
  const dirs = latticeDirections(kids);
  const px = scratchX;
  const py = scratchY;
  const t = camTrig(cam);

  const out = hexOut;
  out.fill(null);
  for (let i = 0; i < LATTICE_SPAN * LATTICE_SPAN; i++) {
    if (latticeOk[i] === 0) continue;
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    const z1 = x * t.sy + z * t.cy;
    px[i] = cx + (x * t.cy - z * t.sy) * radius;
    py[i] = cy - (y * t.cp - z1 * t.sp) * radius;
  }

  for (let k = 0; k < kids.patch.count; k++) {
    const x = kids.dirs[k * 3], y = kids.dirs[k * 3 + 1], z = kids.dirs[k * 3 + 2];
    const z1 = x * t.sy + z * t.cy;
    if (y * t.sp + z1 * t.cp < 0) continue;

    const q = coords[k * 2];
    const rr = coords[k * 2 + 1];
    const self = latticeAt(q, rr);
    const poly = hexPoly[k];
    let usable = true;
    for (let d = 0; d < 6; d++) {
      const da = DIRECTIONS[d];
      const db = DIRECTIONS[(d + 1) % 6];
      const ia = latticeAt(q + da[0], rr + da[1]);
      const ib = latticeAt(q + db[0], rr + db[1]);
      if (latticeOk[ia] === 0 || latticeOk[ib] === 0) { usable = false; break; }
      poly[d * 2] = (px[self] + px[ia] + px[ib]) / 3;
      poly[d * 2 + 1] = (py[self] + py[ia] + py[ib]) / 3;
    }
    if (usable) out[k] = poly;
  }
  return out;
}

function drawGlobeChildren(
  ctx: CanvasRenderingContext2D,
  kids: ChildFrame,
  cam: Camera,
  view: GlobeView,
  lambert: number,
  edgeWidth: number,
): void {
  const polys = tilePolygons(kids, cam, view);

  const drawEdges = edgeWidth > 0;
  if (drawEdges) {
    ctx.strokeStyle = 'rgba(10,16,24,0.35)';
    ctx.lineWidth = edgeWidth;
  }

  for (let k = 0; k < kids.patch.count; k++) {
    const poly = polys[k];
    if (poly === null) continue;

    const alt = 1 + Math.min(0.5, Math.max(0, kids.elevationM[k]) / 6000);
    ctx.fillStyle = kids.elevationM[k] < 0
      ? shade(OCEAN, lambert)
      : shade(BIOME_COLOURS[kids.biome[k]], lambert * alt);

    // The polygon's OWN corner count, not six. A pentagonal patch has one cell
    // with five -- its centre, which is the pentagon -- and reading a sixth
    // corner off it gives undefined, which draws as NaN and silently drops the
    // shape.
    const corners = poly.length / 2;
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 1; i < corners; i++) ctx.lineTo(poly[i * 2], poly[i * 2 + 1]);
    ctx.closePath();
    ctx.fill();
    // Sealed the same way the flat maps are: two polygons sharing an edge
    // leave a hairline of background between them on a canvas.
    if (drawEdges) {
      ctx.stroke();
    } else {
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
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
 * The map a picture is drawn in the terms of.
 *
 * A view used to be one map, centred, so every position in drawSubMap could be
 * a bare `patch.centre` in that map's own layout. Showing a tile's NEIGHBOURS
 * around it means several maps in one picture, and neighbouring maps do not
 * share a layout. Three things differ and all three are visible:
 *
 *   * each map's basis faces its own first neighbour, so a neighbour's lattice
 *     is TURNED relative to the middle one, by an angle particular to the pair;
 *   * cells are not all the same size -- a pentagon's are 0.824 of the mean
 *     radius, and its children divide by sqrt(76) where a hexagon's divide by
 *     sqrt(91) -- so a neighbour drawn at the middle map's cell size is drawn
 *     at the wrong scale;
 *   * the projection is a plane laid on a sphere, and over the ground a REGION
 *     map covers, roughly ten degrees of arc, it is not affine.
 *
 * So every cell is placed by running its own direction back through the
 * frame's inverse projection, which is exact and costs one `toLocal` per cell.
 * The turn and the on-screen size at that cell are read off the same
 * projection, by placing a second point one cell-radius along and measuring
 * what came out, rather than assumed to be the map's average.
 *
 * A rotation-and-shift per map was tried first and measured: worst error 11.0
 * pixels at the region layer against a 60-pixel cell, and a floor of 2.04
 * pixels at every depth below it that did not shrink as the maps got smaller,
 * which is the cell-size difference rather than curvature. Exact placement
 * costs about 1,300 extra projections a frame across seven maps, which is
 * nothing beside the polygons they fill.
 */
export interface Frame {
  basis: Basis;
  cellRadiusRad: number;
  /** The view's own turn, degrees. See Camera.rot. */
  rotDeg?: number;
}

/** Where one cell of some map lands in the frame's picture. */
export interface Placed {
  x: number;
  y: number;
  /** Circumradius on screen, which differs between maps and across a map. */
  r: number;
  /** The cell's own turn in the frame, as a unit vector. */
  cos: number;
  sin: number;
}

/** Unit hexagon corners, pointy-top, to be turned and scaled per cell. */
const UNIT_POINTY = corners(1, -30);

export function placeCells(map: ChildFrame, frame: Frame, size: number): Placed[] {
  const perUnit = size / frame.cellRadiusRad;
  // The view's turn, folded into the projection rather than applied as a
  // canvas transform: the cull test and the child layout both need positions
  // in screen terms, and a canvas rotation would leave them in the old ones.
  const vr = ((frame.rotDeg ?? 0) * Math.PI) / 180;
  const vc = Math.cos(vr);
  const vs = Math.sin(vr);
  const probe = new Float64Array(3);
  const out: Placed[] = [];
  for (let c = 0; c < map.patch.count; c++) {
    const o = toLocal(frame.basis, map.dirs[c * 3], map.dirs[c * 3 + 1], map.dirs[c * 3 + 2]);
    // One cell-radius along this map's own x-axis from this cell, projected
    // the same way. The step's image gives the turn and the scale together.
    const q = map.patch.centre(c, map.cellRadiusRad);
    toDirection(map.basis, q.x + map.cellRadiusRad, q.y, probe, 0);
    const t = toLocal(frame.basis, probe[0], probe[1], probe[2]);
    const dx = (t.x - o.x) * perUnit;
    const dy = (t.y - o.y) * perUnit;
    const x = (o.x * vc - o.y * vs) * perUnit;
    const y = (o.x * vs + o.y * vc) * perUnit;
    const r = Math.hypot(dx, dy);
    if (r > 1e-9) {
      const cos = dx / r;
      const sin = dy / r;
      out.push({ x, y, r, cos: cos * vc - sin * vs, sin: sin * vc + cos * vs });
    } else {
      out.push({ x, y, r: size, cos: vc, sin: vs });
    }
  }
  return out;
}

/**
 * The same placement at size 1, kept so a frame does not recompute it.
 *
 * Placement depends only on the map, the frame it is drawn in, and -- linearly
 * -- on the size. So it is computed once per (map, frame) at unit size and
 * multiplied at the point of use, which costs a multiply instead of two
 * spherical projections and allocates nothing per frame.
 *
 * This matters because of the MOSAIC. A cell is drawn out of its own children,
 * so a map of 91 cells asks for 91 child maps of 91 cells each: 8,281
 * placements for one map, and seven maps are on screen. Recomputing those
 * every frame is 116,000 projections a frame; recomputing them when the frame
 * changes is 116,000 projections when the player crosses a tile boundary, and
 * nothing in between.
 *
 * Keyed weakly by the map, so entries fall away when World evicts the SubMap
 * they describe rather than growing without bound as the player walks. One
 * entry per map: the frame changes for every map at once, so a cache holding
 * several frames per map would only ever hold stale ones.
 */
const unitCache = new WeakMap<ChildFrame, { basis: Basis; rotDeg: number; unit: Placed[] }>();

export function unitPlacements(map: ChildFrame, frame: Frame): Placed[] {
  const rotDeg = frame.rotDeg ?? 0;
  const hit = unitCache.get(map);
  if (hit !== undefined && hit.basis === frame.basis && hit.rotDeg === rotDeg) return hit.unit;
  const unit = placeCells(map, frame, 1);
  unitCache.set(map, { basis: frame.basis, rotDeg, unit });
  return unit;
}

/** Trace a hexagon of unit corners, turned and scaled onto one cell. */
function tracePolygon(
  ctx: CanvasRenderingContext2D,
  unit: readonly { x: number; y: number }[],
  cx: number, cy: number, r: number, cos: number, sin: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const ux = unit[i].x * r;
    const uy = unit[i].y * r;
    const x = cx + ux * cos - uy * sin;
    const y = cy + ux * sin + uy * cos;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * The colours plant life is drawn in.
 *
 * Not biome colours -- those say what KIND of place it is. These say what is
 * standing on it, so that a thin wood and a closed one differ on the map by
 * more than their label. Leaf is what a crown looks like from above; ground is
 * what shows between crowns, which is bare earth where nothing grows under
 * them and grass where something does.
 */
const LEAF_TREE = '#2c4a24';
const LEAF_SHRUB = '#4a5a2c';
const LEAF_VINE = '#3a6030';
const GRASS_GREEN = '#7a8b46';
const BARE_GROUND = '#8a7d63';

/**
 * Is this spot under a crown?
 *
 * A noise field at one cycle per crown, thresholded at the canopy cover the
 * flora model derived -- so a wood at 81% cover has 81% of its ground under
 * leaf, and a savanna at 26% has 26%.
 *
 * THE THRESHOLD NEEDS CORRECTING FIRST, and getting this wrong is silent. A
 * smooth noise is not uniformly distributed: measured over 200,000 samples,
 * noise3 is bell-shaped about 0.5 with a standard deviation of 0.130, so
 * asking for values below 0.8 returns 99.4% of the ground rather than 80%. An
 * 81%-cover forest would have drawn as solid leaf and a 26% savanna as almost
 * bare, and nothing about the picture would have said so.
 *
 * Put through its own distribution first the threshold means what it says. A
 * logistic is a close enough stand-in for the normal CDF here -- measured
 * after correction, asking for 0.25 gives 0.272, 0.50 gives 0.499 and 0.80
 * gives 0.780, which is well inside what a canopy estimate is worth.
 */
export function underCanopy(
  dirX: number, dirY: number, dirZ: number,
  radiusM: number, crownM: number, cover: number,
): boolean {
  if (cover <= 0) return false;
  if (cover >= 1) return true;
  const f = radiusM / Math.max(1e-9, crownM);
  // The correction now lives in noise.ts, because a second caller -- stand.ts,
  // drawing a wood's age structure -- fell into exactly the same hole and lost
  // a third of the timber to it. Two callers is where a fix stops being local.
  return uniform3(dirX * f, dirY * f, dirZ * f, 0x10A5) < cover;
}

/**
 * How plant life is drawn, and why it is ONE mechanism at every scale.
 *
 * The obvious way is two ways: a texture standing for density when zoomed out,
 * and individual plants drawn when zoomed in. That is two models of the same
 * wood, and they disagree -- the texture says a third of the ground is covered
 * while the trees you can count say something else, and the picture changes its
 * mind as you descend.
 *
 * So there is one model: a canopy field at the crown's own size. At every point
 * of the world a noise value decides whether that spot is under a crown, and
 * the threshold is the canopy cover the flora model derived. Where a tile is
 * SMALLER than a crown the field resolves into individual crowns, which is a
 * tree drawn as the many tiles it stands on -- branch by branch, because at the
 * yard layer a tile IS part of a tree. Where a tile is LARGER than a crown the
 * same field averages to the cover fraction and reads as a density texture.
 *
 * The two are the same number seen at two distances, so descending through the
 * layers shows the same wood getting nearer rather than a different one.
 *
 * `detail` is what fades between them: one when a crown spans several tiles,
 * zero when a tile swallows a crown whole.
 */
function floraColour(
  hex: string, dirX: number, dirY: number, dirZ: number,
  biome: number, npp: number, radiusM: number, tileSpacingM: number,
): string {
  const flora = floraAt(biome as never, npp);
  if (flora.dominant === FloraKind.None) return hex;

  const crownM = flora.dominant === FloraKind.Tree ? A.TREE_CROWN_M
    : flora.dominant === FloraKind.Vine ? A.VINE_CROWN_M
      : flora.dominant === FloraKind.Shrub ? A.SHRUB_CROWN_M
        : A.SHRUB_CROWN_M / 4;

  // How much of a crown a tile covers decides whether crowns can be told apart
  // at all. Below a third of a crown they resolve; above it they blur.
  const detail = Math.max(0, Math.min(1, crownM / Math.max(1e-9, tileSpacingM * 3)));
  if (detail <= 0.01) return hex;

  const leaf = flora.dominant === FloraKind.Tree ? LEAF_TREE
    : flora.dominant === FloraKind.Vine ? LEAF_VINE
      : flora.dominant === FloraKind.Shrub ? LEAF_SHRUB : GRASS_GREEN;
  // What shows between the crowns: grass if the ground grows any, else earth.
  const between = flora.grassPerM2 > 20 ? GRASS_GREEN : BARE_GROUND;

  // The canopy field, at one cycle per crown.
  const under = underCanopy(dirX, dirY, dirZ, radiusM, crownM, flora.canopyCover);

  // Blend towards what is actually there, by how much of it can be resolved.
  const target = under ? leaf : between;
  return mixHex(hex, target, detail * (under ? 0.75 : 0.55));
}

/**
 * FREE PARAMETER: how much of a tile's colour comes from the tiles around it.
 *
 * Zero draws every tile in its own flat colour, and the hexagons then read as
 * hexagons: a run of ground that is really a gradient comes out as a mosaic of
 * discrete steps, and the eye finds the grid instead of the landscape.
 *
 * A third is ours. It is enough that a slope of the same biome reads as a
 * slope rather than as a tiling, and little enough that a real boundary -- a
 * coast, a treeline, a river's edge -- still lands within one tile instead of
 * being smeared across three. Nothing measures where that line is; it is a
 * judgement about what the picture is for.
 */
const TILE_BLEND = 1 / 3;

/**
 * A map's tile colours, worked out once and kept.
 *
 * Two things at once, and the second is why this is worth a cache rather than
 * a loop. It BLENDS: each tile takes TILE_BLEND of its colour from the mean of
 * its neighbours, which needs six lookups a tile and would be absurd to redo
 * sixty times a second for an answer fixed by the terrain.
 *
 * And it removes the last of the per-tile string work from the frame. The
 * mosaic used to call `shade` once per tile -- 28,000 times a frame -- and
 * even memoised that is a lookup and a fillStyle assignment per tile. Now the
 * colour is an array index.
 *
 * Keyed weakly by the map, and re-made if the relief window it was shaded
 * against moves, which happens when the parent it is drawn inside changes.
 */
interface TileColours {
  lo: number;
  span: number;
  colours: string[];
}

const mosaicCache = new WeakMap<ChildFrame, TileColours>();

function mosaicColours(kids: ChildFrame, lo: number, span: number): string[] {
  const hit = mosaicCache.get(kids);
  if (hit !== undefined && hit.lo === lo && hit.span === span) return hit.colours;

  const n = kids.patch.count;
  // The sphere's radius, recovered from what a map already carries: a cell's
  // spacing in metres over its spacing in radians.
  const radiusM = kids.spacingM / (SQRT3 * kids.cellRadiusRad);
  const r = new Float64Array(n);
  const g = new Float64Array(n);
  const b = new Float64Array(n);

  // Own colour first, in numbers rather than strings, so the blend below is
  // arithmetic instead of parsing.
  for (let k = 0; k < n; k++) {
    const base = kids.elevationM[k] < 0 ? OCEAN : BIOME_COLOURS[kids.biome[k]];
    // What is growing on it, drawn at whatever scale this map is at.
    const hex = kids.elevationM[k] < 0 ? base : floraColour(
      base, kids.dirs[k * 3], kids.dirs[k * 3 + 1], kids.dirs[k * 3 + 2],
      kids.biome[k], kids.nppGm2[k], radiusM, kids.spacingM);
    const v = parseInt(hex.slice(1), 16);
    // The same relief shading the tiles had before, applied here instead.
    const f = Math.max(0.25, Math.min(1.55,
      0.72 + 0.5 * ((kids.elevationM[k] - lo) / span)));
    r[k] = ((v >> 16) & 255) * f;
    g[k] = ((v >> 8) & 255) * f;
    b[k] = (v & 255) * f;
  }

  const colours: string[] = new Array(n);
  for (let k = 0; k < n; k++) {
    let nr = 0, ng = 0, nb = 0, count = 0;
    for (let i = 0; i < 6; i++) {
      const j = kids.patch.neighbours[k * 6 + i];
      if (j < 0) continue;
      nr += r[j]; ng += g[j]; nb += b[j]; count++;
    }
    // A rim tile has fewer neighbours and takes proportionally less from them,
    // rather than pulling in a direction it happens to have one on.
    const t = count === 0 ? 0 : TILE_BLEND;
    const mr = count === 0 ? r[k] : r[k] * (1 - t) + (nr / count) * t;
    const mg = count === 0 ? g[k] : g[k] * (1 - t) + (ng / count) * t;
    const mb = count === 0 ? b[k] : b[k] * (1 - t) + (nb / count) * t;
    colours[k] = `rgb(${Math.min(255, Math.round(mr))},`
      + `${Math.min(255, Math.round(mg))},${Math.min(255, Math.round(mb))})`;
  }

  mosaicCache.set(kids, { lo, span, colours });
  return colours;
}

/**
 * THE CROWN LATTICE: where plants are sampled, and why it is not the tile grid.
 *
 * The first version asked each tile what stood on it. That works at exactly one
 * zoom. Go two layers deeper and a tile is 0.2 m across, which is a millionth
 * of an oak, so the stems whose crowns fill your view stand on ground outside
 * every tile you looked at -- an oak is eighteen metres and the whole view is
 * two. The trees were being generated and were not being FOUND, and the measure
 * of it was blunt: 2,795 plants at layer 5 and zero at layers 6 and 7.
 *
 * So plants are sampled on a lattice of ONE CROWN PER CELL, at every zoom. Then
 * the number of stems in a cell is a property of the ground rather than of how
 * far you have zoomed in; the lattice can be walked one cell past the screen
 * edge to catch what overhangs it; and descending shows the same wood getting
 * nearer instead of a different wood each time.
 *
 * ANCHORED TO THE REGION, which is what makes "the same wood" true. A region's
 * tangent plane covers everything below it, so one lattice serves all eight
 * layers and a tree keeps its place from the shire down to the pace. Anchoring
 * to whichever map is being drawn would be a line shorter and would move every
 * tree in the world each time the player descended one step.
 *
 * It does move at a region boundary, where the maps do not align anyway -- that
 * is the ISEA gap in docs/fix-attempts.md, and this neither fixes nor worsens
 * it.
 */
const STAND_KINDS = [FloraKind.Tree, FloraKind.Shrub, FloraKind.Vine] as const;

/**
 * A lattice cell can hold a crowd -- a cell this size on forest ground is
 * thirty-odd plants -- and all of them are drawn or none are. A cell showing
 * twelve of its thirty-five would be a lie about the wood; a cell showing the
 * ground colour it already had is not.
 */
const STAND_LIMIT = 256;

/** As many lattice cells as one frame will walk before it gives up. */
const MAX_LATTICE_CELLS = 4096;

const standLattice = new Map<string, Stand | null>();
let standLatticeRegion = '';

/**
 * How many screens of canopy are worth painting before the rest is invisible.
 *
 * DERIVED, and from the law this project keeps arriving back at. Crowns
 * overlap, so the fraction of the view still showing what is BEHIND n screens'
 * worth of canopy is exp(-n): one screen leaves 37%, two leaves 14%, three
 * leaves 5%. Past three there is nothing left to hide, and every further stamp
 * is paint applied to paint.
 *
 * This is what makes the deep layers affordable. At the pace layer a two-metre
 * view stands under about a hundred and fifty crowns -- every one of them
 * eighteen metres wide and covering the whole screen -- which is thirty-six
 * screens of fill for a picture indistinguishable from three.
 */
const CANOPY_DEPTH = 3;

/** What one call to drawFlora did, so a harness can say where the plants are. */
export interface FloraDrawn {
  cells: number;
  plants: number;
  /** Plants under a canopy that was already opaque, so not painted. */
  hidden: number;
  /** Lattice cells that got a sward laid under them. */
  ground: number;
  /** Cattle standing on somebody's pasture. */
  beasts: number;
  /** True when the zoom is too far out for individuals to be affordable. */
  texture: boolean;
}

/**
 * Which ground is grazed, asked of the caller.
 *
 * CATTLE ARE NOT WILDLIFE. A herd belongs to somebody, and until a settlement
 * owns one there is no honest way to scatter cattle across every meadow on the
 * planet -- it would be a picture making a claim the simulation cannot back,
 * which is the exact trap the tree work spent three commits climbing out of.
 *
 * So the renderer asks. main.ts answers from the settlements it already knows
 * about, and where there is nobody, there are no cattle.
 */
export type Grazed = (mapIndex: number, cell: number) => boolean;

/**
 * Draw every plant on the screen, once, after every map's ground is finished.
 *
 * Called once a frame rather than once a map, which removes a problem the
 * per-map version would have had: the lattice is anchored to the region, so two
 * adjoining maps would each have claimed the cells along the edge they share
 * and stamped the same trees twice.
 *
 * `anchorKey` names the region, so the cache empties when the player leaves it
 * rather than growing for the life of the session.
 */
export function drawFlora(
  ctx: CanvasRenderingContext2D,
  maps: readonly SubMap[],
  frame: Frame,
  view: FlatView,
  regionBasis: Basis,
  radiusM: number,
  week: number,
  anchorKey: string,
  grazed: Grazed | null = null,
): FloraDrawn {
  const nothing: FloraDrawn = {
    cells: 0, plants: 0, hidden: 0, ground: 0, beasts: 0, texture: true,
  };
  const { cx, cy, size } = view;
  if (maps.length === 0 || radiusM <= 0) return nothing;

  // Pixels a metre, straight from the projection and owing nothing to tiles:
  // pixels per radian of local offset, over metres per radian of arc.
  const perUnit = size / frame.cellRadiusRad;
  const pxPerM = perUnit / radiusM;
  if (!(pxPerM > 0)) return nothing;

  const w = ctx.canvas.width;
  const h = ctx.canvas.height;

  const vr = ((frame.rotDeg ?? 0) * Math.PI) / 180;
  const vc = Math.cos(vr);
  const vs = Math.sin(vr);
  const probe = new Float64Array(3);

  /** Screen pixels to the frame's own local radians, undoing the view turn. */
  const unproject = (px: number, py: number): [number, number] => {
    const u = (px - cx) / perUnit;
    const v = (py - cy) / perUnit;
    return [u * vc + v * vs, -u * vs + v * vc];
  };

  // What is under the middle of the screen decides whether individuals are
  // affordable at all. One lookup, and the whole pass costs that much when the
  // answer is no.
  const mid = unproject(w / 2, h / 2);
  toDirection(frame.basis, mid[0], mid[1], probe, 0);
  const centre = pickAmong(maps, probe[0], probe[1], probe[2]);
  if (centre === null) return nothing;
  const cm = maps[centre.map];
  const midFlora = floraAt(cm.biome[centre.cell] as never, cm.nppGm2[centre.cell]);
  const density = (midFlora.treesPerHa + midFlora.shrubsPerHa + midFlora.vinesPerHa) / 10000;
  if (!individualsAffordable(density, pxPerM, w * h)) return nothing;

  if (standLatticeRegion !== anchorKey) { standLattice.clear(); standLatticeRegion = anchorKey; }

  // The screen's corners in the REGION's plane, so the lattice can be walked in
  // integers. Extended by one cell, because a crown centred just off the screen
  // still hangs over it.
  const S = CROWN_GRID_M / radiusM;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of [[0, 0], [w, 0], [0, h], [w, h]]) {
    const local = unproject(corner[0], corner[1]);
    toDirection(frame.basis, local[0], local[1], probe, 0);
    const r = toLocal(regionBasis, probe[0], probe[1], probe[2]);
    minX = Math.min(minX, r.x); maxX = Math.max(maxX, r.x);
    minY = Math.min(minY, r.y); maxY = Math.max(maxY, r.y);
  }
  const i0 = Math.floor(minX / S) - 1;
  const i1 = Math.ceil(maxX / S) + 1;
  const j0 = Math.floor(minY / S) - 1;
  const j1 = Math.ceil(maxY / S) + 1;
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_LATTICE_CELLS) return nothing;

  const margin = CROWN_GRID_M * pxPerM;
  const step = new Float64Array(3);

  // NEAREST THE MIDDLE FIRST, which matters as soon as the budget below starts
  // biting: without an order, the cells that got cut would be whichever corner
  // the loop reached last, and a wood would be bare down one side. Sorted by
  // distance from the centre of the view, the ones that go are the ones
  // furthest from what the player is looking at.
  const visible: { i: number; j: number; x: number; y: number; d2: number }[] = [];
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      toDirection(regionBasis, i * S, j * S, probe, 0);
      const o = toLocal(frame.basis, probe[0], probe[1], probe[2]);
      const x = cx + (o.x * vc - o.y * vs) * perUnit;
      const y = cy + (o.x * vs + o.y * vc) * perUnit;
      if (x < -margin || y < -margin || x > w + margin || y > h + margin) continue;
      visible.push({ i, j, x, y, d2: (x - w / 2) ** 2 + (y - h / 2) ** 2 });
    }
  }
  visible.sort((a, b) => a.d2 - b.d2);

  let cells = 0;
  let plants = 0;
  let hidden = 0;
  let ground = 0;
  let coverPx2 = 0;
  const coverBudget = w * h * CANOPY_DEPTH;
  const season = seasonOf(week, 52);

  // RESOLVE EVERY CELL FIRST, then draw in two passes over the resolved list.
  //
  // The two drawing passes are needed for the same reason the tile mosaic needs
  // two: a cell's sward fills a square that overlaps its neighbours, so laying
  // grass and trees cell by cell would have each cell's turf painting over the
  // last cell's trunks. Ground first, all of it, then everything standing on
  // the ground -- which is the third time that sentence has earned its place in
  // this file.
  const ready: {
    x: number; y: number; tc: number; ts: number; stand: Stand; herd: Herd | null;
  }[] = [];

  for (const cell of visible) {
    const { i, j, x, y } = cell;
    toDirection(regionBasis, i * S, j * S, probe, 0);
    const dx = probe[0];
    const dy = probe[1];
    const dz = probe[2];
    const o = toLocal(frame.basis, dx, dy, dz);
    cells++;

    const key = i + '|' + j;
    let grazedHere = false;
    let pasture: { biome: number; npp: number } | null = null;
    let stand = standLattice.get(key) ?? null;
    {
      const found = pickAmong(maps, dx, dy, dz);
      const m = found === null ? null : maps[found.map];
      if (m === null || found === null || m.elevationM[found.cell] < 0) {
        standLattice.set(key, null);
        continue;
      }
      grazedHere = grazed !== null && grazed(found.map, found.cell);
      pasture = { biome: m.biome[found.cell], npp: m.nppGm2[found.cell] };
    }
    if (!standLattice.has(key)) {
      const found = pickAmong(maps, dx, dy, dz);
      const m = found === null ? null : maps[found.map];
      if (m === null || found === null || m.elevationM[found.cell] < 0) {
        standLattice.set(key, null);
        continue;
      }
      const npp = m.nppGm2[found.cell];
      const got = standOn({
        biome: m.biome[found.cell] as never,
        nppGm2: npp,
        dirX: dx,
        dirY: dy,
        dirZ: dz,
        radiusM,
        spacingM: CROWN_GRID_M,
        site: siteFrom(npp),
        // A SQUARE cell, not a hexagon: side squared rather than 0.866 of it.
        areaM2: CROWN_GRID_M * CROWN_GRID_M,
      }, STAND_KINDS, STAND_LIMIT);
      stand = got.omitted > 0 ? null : got;
      standLattice.set(key, stand);
    }
    if (stand === null) continue;

    // The cell's own turn on screen, found the way placeCells finds a tile's:
    // project a short step along the lattice's x-axis and see where it went.
    toDirection(regionBasis, i * S + S * 0.01, j * S, step, 0);
    const t = toLocal(frame.basis, step[0], step[1], step[2]);
    const ex = t.x - o.x;
    const ey = t.y - o.y;
    const ax = ex * vc - ey * vs;
    const ay = ex * vs + ey * vc;
    const alen = Math.hypot(ax, ay);
    ready.push({
      x,
      y,
      tc: alen > 1e-12 ? ax / alen : 1,
      ts: alen > 1e-12 ? ay / alen : 0,
      stand,
      herd: grazedHere && pasture !== null
        ? herdOn({
          biome: pasture.biome as never,
          nppGm2: pasture.npp,
          dirX: dx,
          dirY: dy,
          dirZ: dz,
          radiusM,
          spacingM: CROWN_GRID_M,
        })
        : null,
    });
  }

  // PASS ONE: the sward.
  //
  // Laid only where individuals are drawn, which is the honest place for it: at
  // the zooms above this a tile is eight pixels across and a grass texture
  // would be aliasing noise standing where a perfectly good colour already is.
  //
  // Half a cell plus a whisker, so two neighbouring squares meet rather than
  // leaving a hairline of bare ground down the join.
  const halfM = CROWN_GRID_M * 0.52;
  for (const r of ready) {
    // Tufts a square metre, straight from the flora model, which is what makes
    // a heath thinner than a meadow without either being drawn differently.
    const tile = groundTileFor(season, r.stand.flora.grassPerM2, pxPerM);
    if (tile === null) continue;
    if (drawGround(ctx, tile, r.x, r.y, pxPerM, r.tc, r.ts, halfM)) ground++;
  }

  // PASS TWO: everything standing on it.
  for (const r of ready) {
    if (r.stand.plants.length === 0) continue;
    const did = drawStand(
      ctx, r.stand.plants, week, r.x, r.y, pxPerM, r.tc, r.ts,
      Math.max(0, coverBudget - coverPx2),
    );
    plants += did.drawn;
    hidden += did.hidden;
    coverPx2 += did.coverPx2;
  }

  // PASS THREE: the cattle, over the grass and over the plants, because a beast
  // stands on the ground rather than under it.
  let beasts = 0;
  for (const r of ready) {
    if (r.herd === null) continue;
    beasts += drawHerd(ctx, r.herd.beasts, r.x, r.y, pxPerM, r.tc, r.ts);
  }

  return { cells, plants, hidden, ground, beasts, texture: false };
}

/**
 * Is any of this map on screen at all?
 *
 * drawSubMap culls cell by cell, which is the right grain once you are drawing
 * a map and the wrong one for deciding whether to start. The view holds every
 * map within five steps -- up to a hundred and twenty of them -- and at
 * ordinary zoom about seven are in the window. The other hundred and thirteen
 * were each costing a placement lookup, an overlay scan and ninety-one culled
 * cells, every frame, to draw nothing.
 *
 * A map's cells all lie within (radius + 1) spacings of its centre, so one
 * projection and one circle-against-rectangle test dismisses the whole thing.
 * Measured on a drag at the ground layer: median frame 16 ms to 3 ms.
 */
export function mapIsVisible(
  map: ChildFrame, frame: Frame, view: FlatView, width: number, height: number,
): boolean {
  const perUnit = view.size / frame.cellRadiusRad;
  const o = toLocal(frame.basis, map.basis.ox, map.basis.oy, map.basis.oz);
  const vr = ((frame.rotDeg ?? 0) * Math.PI) / 180;
  const vc = Math.cos(vr);
  const vs = Math.sin(vr);
  const x = view.cx + (o.x * vc - o.y * vs) * perUnit;
  const y = view.cy + (o.x * vs + o.y * vc) * perUnit;
  // Every cell of the patch sits inside this, with a ring to spare for the
  // tiles that overhang a cell's own outline.
  const r = (map.patch.radius + 1.5) * SQRT3 * map.cellRadiusRad * perUnit;
  return x + r >= 0 && y + r >= 0 && x - r <= width && y - r <= height;
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
  frame: Frame | null = null,
): void {
  const { cx, cy, size } = view;
  // Its own frame unless told otherwise, so a lone map draws exactly as it did.
  const f = frame ?? { basis: map.basis, cellRadiusRad: map.cellRadiusRad };
  const place = unitPlacements(map, f);
  const at = (cell: number): Placed => place[cell];
  // The same question the globe asks, in the same unit: is a TILE big enough
  // to be worth drawing?
  const childSize = size * CHILD_SCALE;
  const wantMosaic = children !== null && childSize * 2 >= MOSAIC_MIN_PX;
  const wantTint = !wantMosaic && tint !== null && size * 2 >= TINT_MIN_PX;
  // Tile edges, on the same terms as the globe's. Without them a run of tiles
  // sharing a biome merges into one flat area and the grid disappears exactly
  // where the ground is uniform -- which is most of a map.
  const childEdges = tileEdgeWidth(childSize * 2);
  const offScreen = (x: number, y: number): boolean => (
    x < -size * 2 || y < -size * 2
    || x > ctx.canvas.width + size * 2 || y > ctx.canvas.height + size * 2
  );

  let lo = Infinity;
  let hi = -Infinity;
  for (let c = 0; c < map.patch.count; c++) {
    if (map.elevationM[c] < lo) lo = map.elevationM[c];
    if (map.elevationM[c] > hi) hi = map.elevationM[c];
  }
  const span = Math.max(1, hi - lo);

  // THE GROUND FIRST, ALL OF IT, THEN THE TILES ON TOP OF ALL OF IT.
  //
  // A cell used to be filled and then drawn out of its own tiles before the
  // next cell was reached, and the tiles were clipped to the cell that held
  // them. Both were wrong once the tiles were placed where they really are: 91
  // hexagons cannot fill a hexagon, so a cell's tiles form a rosette that
  // pushes past its edge in six places and falls short in six others, and it
  // is the NEIGHBOUR'S rosette that fills those gaps. Clipping cut off exactly
  // the protrusions the neighbour needed, and filling cell by cell painted
  // over the ones that survived.
  for (let c = 0; c < map.patch.count; c++) {
    const g = at(c);
    const x = cx + g.x * size;
    const y = cy + g.y * size;
    if (offScreen(x, y)) continue;
    tracePolygon(ctx, UNIT_POINTY, x, y, g.r * size, g.cos, g.sin);
    const relief = 0.72 + 0.5 * ((map.elevationM[c] - lo) / span);
    const base = (wantTint ? tint!(c) : null) ?? BIOME_COLOURS[map.biome[c]];
    ctx.fillStyle = shade(base, relief);
    ctx.fill();
    // The same seal between cells, for the same reason as between tiles.
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
    // The cell's own outline, only while it is NOT showing its tiles.
    if (!wantMosaic) {
      ctx.strokeStyle = 'rgba(12,20,30,0.5)';
      ctx.stroke();
    }
  }

  if (wantMosaic) {
    for (let c = 0; c < map.patch.count; c++) {
      const g = at(c);
      const x = cx + g.x * size;
      const y = cy + g.y * size;
      if (offScreen(x, y)) continue;
      const kids = children!(c);
      if (kids === null) continue;

      // WHERE THE CHILDREN ACTUALLY ARE, not a flat grid stamped inside the
      // parent. This used to lay the child patch out in the parent cell's own
      // coordinates and turn it thirty degrees, which is a GUESS at the turn.
      // Placed through the same projection as everything else, so a child sits
      // where the sphere says it sits.
      const kplace = unitPlacements(kids, f);
      const kcol = mosaicColours(kids, lo, span);
      for (let k = 0; k < kids.patch.count; k++) {
        const kg = kplace[k];
        const kx = cx + kg.x * size;
        const ky = cy + kg.y * size;
        ctx.fillStyle = kcol[k];
        if (childEdges > 0) {
          ctx.strokeStyle = 'rgba(10,16,24,0.30)';
          ctx.lineWidth = childEdges;
        }
        tracePolygon(ctx, UNIT_POINTY, kx, ky, kg.r * size, kg.cos, kg.sin);
        ctx.fill();
        // SEALED, so no background shows between two tiles that touch.
        //
        // Adjacent tiles share an edge exactly -- measured, the worst point of
        // ground sits 0.5619 tile spacings from a centre against a hexagon's
        // reach of 0.5774, so there is no hole anywhere. What there IS, is the
        // canvas: two polygons sharing an edge each cover about half the pixels
        // along it, and half plus half of a blended pixel is not one, so the
        // background shows through as a hairline. Stroking a tile in its own
        // colour puts the missing half back.
        //
        // Only when no edge line is being drawn, because a line along that
        // seam covers it already.
        if (childEdges > 0) ctx.stroke();
        else { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }

    // NO OUTLINE ROUND A CELL THAT IS SHOWING ITS TILES, and this is a
    // reversal worth recording rather than a tidy-up.
    //
    // A cell used to be outlined over its own mosaic, and the argument for it
    // was good: a sub-map's cells outlined over their children is exactly what
    // makes them read as tiles made of tiles, and it is why the globe was
    // eventually given the same treatment. But once neighbours are on screen
    // the same line is the seam BETWEEN one hex's tiles and the next hex's,
    // and there is no seam there -- the tiles are one lattice across the
    // boundary, and drawing a line along it says otherwise.
    //
    // So the cell keeps its outline while it is drawn flat, where the outline
    // is the only thing saying where the cell is, and loses it once its own
    // tiles are what you are looking at. The selection ring still marks the
    // cell you have chosen.
  }

  // THE PLANTS ARE NOT DRAWN HERE, and that is what drawFlora below is for.
  // They were, for one commit, and it put trees on exactly one layer of eight:
  // a plant drawn by the tile holding its stem cannot be found at all once a
  // tile is a fraction of a crown across. See drawFlora.

  // Water second, so channels sit on top of the ground they cut through.
  for (let c = 0; c < map.patch.count; c++) {
    if (map.drainage[c] < 0.55 || map.elevationM[c] < 0) continue;
    const g = at(c);
    const x = cx + g.x * size;
    const y = cy + g.y * size;
    if (offScreen(x, y)) continue;
    const strength = (map.drainage[c] - 0.55) / 0.45;
    ctx.fillStyle = `rgba(70,130,180,${0.30 + 0.6 * strength})`;
    ctx.beginPath();
    ctx.arc(x, y, g.r * size * (0.30 + 0.55 * strength), 0, Math.PI * 2);
    ctx.fill();
  }

  // The fields a settlement is actually working, hatched over the ground.
  // Drawn before claims so a border still reads on top of its own fields.
  if (worked !== null) {
    for (const [cell, share] of worked) {
      if (cell < 0 || cell >= map.patch.count) continue;
      const g = at(cell);
      const x = cx + g.x * size;
      const y = cy + g.y * size;
      if (offScreen(x, y)) continue;
      ctx.fillStyle = `rgba(201,162,39,${0.20 + 0.45 * share})`;
      tracePolygon(ctx, UNIT_POINTY, x, y, g.r * size, g.cos, g.sin);
      ctx.fill();
    }
  }

  // Claims and settlements.
  for (const [cell, owner] of owned) {
    if (cell < 0 || cell >= map.patch.count) continue;
    const g = at(cell);
    ctx.strokeStyle = houseColour(owner);
    ctx.lineWidth = Math.max(1, g.r * size * 0.12);
    tracePolygon(ctx, UNIT_POINTY, cx + g.x * size, cy + g.y * size, g.r * size, g.cos, g.sin);
    ctx.stroke();
  }
  for (const [cell, people] of populated) {
    if (cell < 0 || cell >= map.patch.count) continue;
    const g = at(cell);
    const gr = g.r * size;
    // Area with population, so a hamlet and a city differ by more than a dot.
    const r = Math.max(2, Math.min(gr * 0.8, gr * 0.22 * Math.sqrt(Math.max(1, people))));
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    ctx.arc(cx + g.x * size, cy + g.y * size, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bounded, because a map in this picture may hold fewer cells than the one
  // the selection was made in: a pentagon's map has 76 and a hexagon's 91.
  if (highlight >= 0 && highlight < map.patch.count) {
    const g = at(highlight);
    ctx.strokeStyle = '#c9a227';
    ctx.lineWidth = 2;
    tracePolygon(ctx, UNIT_POINTY, cx + g.x * size, cy + g.y * size, g.r * size, g.cos, g.sin);
    ctx.stroke();
  }
}

/**
 * Which of the maps on screen holds a direction, and which cell of it.
 *
 * NOT `World.addressAt`, and the reason is worth writing down because the
 * obvious choice is wrong. addressAt descends from the globe and names the
 * tile whose territory contains a point. The view builds addresses the other
 * way, by walking down the map the player opened. The two DISAGREE, and not
 * rarely: a hexagon of 91 hexagons covers about 91% of the hexagon holding it,
 * so a map's outer rings lie outside their own parent tile. Measured, the
 * centre cell of the map at address [6,40] sits in region 11, and asking
 * addressAt about it returns [11,49,...] -- a true answer to a different
 * question, and one that would have made a click jump to a map the player was
 * not looking at.
 *
 * So picking asks the maps that are actually drawn. The middle one is offered
 * first, which is both what the player expects -- the tile under the cursor is
 * the one drawn on top -- and the hysteresis that stops the view flickering
 * between two maps along a seam they share.
 *
 * Falls back to the nearest cell centre when no map claims the point: a cell's
 * territory is a Voronoi region and the hexagon drawn for it is only roughly
 * that, so a click can miss every one of them by a hair.
 */
export function pickAmong(
  maps: readonly SubMap[], x: number, y: number, z: number,
): { map: number; cell: number } | null {
  for (let m = 0; m < maps.length; m++) {
    const map = maps[m];
    const cell = cellContaining(map.basis, map.cellRadiusRad, x, y, z, map.patch);
    if (cell >= 0) return { map: m, cell };
  }

  let best: { map: number; cell: number } | null = null;
  let bestD = Infinity;
  for (let m = 0; m < maps.length; m++) {
    const map = maps[m];
    for (let c = 0; c < map.patch.count; c++) {
      const dot = x * map.dirs[c * 3] + y * map.dirs[c * 3 + 1] + z * map.dirs[c * 3 + 2];
      const d = 1 - dot;
      if (d < bestD) { bestD = d; best = { map: m, cell: c }; }
    }
  }
  return best;
}

/** A stable colour per house, spread around the wheel by a golden step. */
export function houseColour(house: number): string {
  const hue = (house * 137.508) % 360;
  return `hsl(${hue.toFixed(0)}, 65%, 58%)`;
}

export { Biome, BIOME_COLOURS };
