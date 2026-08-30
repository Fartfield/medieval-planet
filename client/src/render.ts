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
  CELL_COUNT, centres, outline, BAND_SIN_LIMIT, CELL_R, COLS, ROWS,
} from '../../sim/geo/sphere.ts';
import {
  RADIUS, SUBCELL_COUNT, coords, DIRECTIONS, toPixel, fromPixel,
} from '../../sim/geo/hexgrid.ts';
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
export type ChildLookup = (cell: number) => ChildFrame | null;

/**
 * How wide a TILE must be on screen before its parent is drawn out of tiles.
 *
 * Measured on the tile, not on the parent, and that is the whole point: it is
 * the tile that either reads as a shape or does not, so it is the tile the
 * question is about. Below four pixels the blend takes over, which is the same
 * information averaged, and at that size averaging is what the eye is doing
 * anyway.
 *
 * IT USED TO BE A THRESHOLD ON THE PARENT, and the globe and the flat maps
 * divide parent by child differently -- 9.5 against 8.7 -- so the same number
 * meant 3.9 px tiles on a sub-map and 7.4 px tiles on the globe. The globe was
 * held to twice the standard, and the moment the world map went from 92 cells
 * to 192 the window needed to clear it grew from about 390 px to 600. Under
 * that, the world view quietly fell back to a flat blend: the same
 * "constituent hexes are not being drawn" that had been fixed twice already,
 * arriving a third time through the one line that decides whether to draw them.
 *
 * Stated once, in tile pixels, both callers ask the identical question.
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
const SQRT3 = Math.sqrt(3);
const COS30 = Math.sqrt(3) / 2;
const SIN30 = 0.5;

/**
 * How far a region's tiles are drawn beyond their own size, so that they cover
 * the region rather than leaving a fringe of flat colour round its edge.
 *
 * A CONSTANT now, and that is the news. It used to be measured per cell,
 * because one global number sized for the widest cell drew a pentagon's tiles
 * 27% too far out -- and later, because the equal-area projection makes cells
 * near the ice caps two and a half times taller than they are wide, so no
 * single number could serve both a squat cell and a stretched one.
 *
 * Both of those were the same bug seen twice: the tiles were being laid out in
 * a tangent plane while their parent lived in the projection. Now that a map's
 * basis carries the projection's own scale factors, a child arrangement is the
 * same shape as its parent at every latitude, and the only gap left is the one
 * every hexagon of hexagons has: 91 tiles at a ninety-first the area span
 * sqrt(3)·RADIUS/sqrt(91) = 90.8% of the parent's radius. The reciprocal of
 * that is this number, and it is exactly what the flat maps have always used.
 */
const COVER = Math.sqrt(SUBCELL_COUNT) / (Math.sqrt(3) * RADIUS);


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

  // Then the storms, before the cells, so the cells paint over their inner
  // edge and no gap can open between them. The grid is a band that stops short
  // of the poles -- that is what buys a world with no pentagons in it -- and
  // what lies beyond is not a hole in the map, it is a storm cap.
  drawStormCaps(ctx, cam, view);

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

    // Light from the upper left, plus a lift with altitude so ranges read.
    const lambert = 0.55 + 0.45 * Math.max(0, cz * 0.75 + cyy * 0.35);
    const altitude = 1 + Math.min(0.5, Math.max(0, planet.elevationM[c]) / 6000);

    globeCellPath(ctx, c, cam, view);
    // Under a mosaic this is the blend of the very tiles about to be drawn on
    // top, so the sliver between a hexagon-of-hexagons and the Goldberg cell
    // holding it -- they are not the same shape, and for the twelve pentagons
    // not even the same number of sides -- reads as part of the ground rather
    // than as a rim of some other colour.
    const base = (tint !== null && regionPx >= TINT_MIN_PX ? tint(c) : null)
      ?? BIOME_COLOURS[planet.biome[c]];
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
        drawGlobeChildren(ctx, kids, cam, view, lambert, childEdges);
        ctx.restore();
      }
    }

    // The grid itself. Every cell gets an edge, because the hexagons ARE the
    // map -- a filled cell with no outline reads as a colour field, and the
    // player is choosing between cells rather than between colours. A house
    // border replaces it rather than adding to it, so ownership reads as the
    // strongest line on the globe.
    const owner = owned.get(c);
    if (owner !== undefined) {
      // The path was consumed by the mosaic, so lay it down again.
      globeCellPath(ctx, c, cam, view);
      ctx.strokeStyle = houseColour(owner);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (!wantMosaic && regionPx >= GRID_MIN_PX) {
      // ONLY WHEN THERE IS NO MOSAIC. A region is 2,500 km across, so its
      // outline is a line drawn across a continent -- and at that weight it
      // wins. Every landmass came out as a honeycomb of enormous hexagons with
      // the real coastline, which the tiles inside were drawing perfectly
      // well, reduced to texture inside the facets.
      //
      // The tile grid is the grid the player is looking at once it is being
      // drawn. Region borders still appear where they carry information --
      // ownership below, and the selection -- but not merely to say where one
      // administrative hexagon stops.
      globeCellPath(ctx, c, cam, view);
      // Fainter towards the limb, where cells are edge-on and their outlines
      // crowd into a solid band that reads as a rim rather than as a grid.
      ctx.strokeStyle = `rgba(12,20,30,${(0.2 + 0.45 * cz).toFixed(3)})`;
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

  drawAxis(ctx, cam, view);

  // The limb, so the sphere has an edge.
  ctx.strokeStyle = '#2c3038';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
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
  const rowCentre = BAND_SIN_LIMIT - 0.75 * CELL_R;
  const columns = COLS * 3;

  for (const pole of [1, -1]) {
    const palette = pole > 0 ? STORM_NORTH : STORM_SOUTH;

    // The cap is drawn down to the NOTCH -- the lower of the two heights the
    // band's upper edge takes, where two hexagons meet shoulder to shoulder --
    // and the cells are drawn afterwards over the top of it.
    //
    // The band's edge is a zigzag rather than a circle, because a pointy-top
    // hexagon reaches its full radius at its top vertex and only half of it at
    // the two upper corners. Fanning to that zigzag is exactly right and looks
    // wrong: near the pole the projection stretches half a cell radius into
    // degrees of latitude, so the cap runs down into every notch and the pole
    // wears a spiked crown.
    //
    // Taking the notch line instead, the cap is a clean disc and the hexagons
    // poke their top vertices into it. Same boundary, opposite colour on the
    // in-between bit, and no gap either way.
    const notch = rowCentre + 0.5 * CELL_R;

    // Rings in sine-latitude, from the notch up to the pole. Spaced by the
    // square of the normalised radius so the pieces stay a similar size on
    // screen: sine-latitude compresses hard as it approaches 1.
    const ringSin: number[] = [];
    for (let r = 0; r <= STORM_RINGS; r++) {
      const u = r / STORM_RINGS;
      ringSin.push(notch + (1 - notch) * (1 - (1 - u) * (1 - u)));
    }

    for (let r = 0; r < STORM_RINGS; r++) {
      const sInner = ringSin[r];
      const sOuter = ringSin[r + 1];
      // 1 at the band edge, 0 at the eye.
      const uMid = 1 - (0.5 * (sInner + sOuter) - notch) / (1 - notch);

      for (let col = 0; col < columns; col++) {
        const a0 = (col / columns) * 2 * Math.PI;
        const a1 = ((col + 1) / columns) * 2 * Math.PI;

        const quad: number[][] = [];
        for (const [sv, av] of [[sInner, a0], [sInner, a1], [sOuter, a1], [sOuter, a0]]) {
          const sp = sv * pole;
          const cp = Math.sqrt(Math.max(0, 1 - sp * sp));
          quad.push(rotate(cam, cp * Math.cos(av), sp, cp * Math.sin(av)));
        }

        // Wholly behind the limb: skip.
        const zSum = quad[0][2] + quad[1][2] + quad[2][2] + quad[3][2];
        if (zSum < 0) continue;

        // The arms, as a log spiral. The two poles wind OPPOSITE ways -- the
        // `pole` factor on the angle -- which is both what Coriolis does either
        // side of an equator and, here, the point: they are opposed.
        const aMid = 0.5 * (a0 + a1);
        const swirl = Math.sin(
          STORM_ARMS * (aMid * pole + STORM_TWIST * Math.log(Math.max(uMid, 0.05))));
        const armT = 0.5 + 0.5 * swirl;

        // Arms show across most of the cap, fading only at the rim where the
        // storm frays into ordinary weather and in the eye's glare. A plain
        // sin(pi.u) was too narrow a window -- it confined the arms to a thin
        // annulus and what was left either side read as plain banding.
        const band = Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, uMid))), 0.45);
        const eyeT = Math.max(0, 1 - uMid * 2.6);

        let colour = mixHex(palette.deep, palette.arm, armT * armT * band * 0.95);
        colour = mixHex(colour, palette.eye, eyeT * eyeT * eyeT);

        ctx.beginPath();
        ctx.moveTo(cx + quad[0][0] * radius, cy - quad[0][1] * radius);
        for (let i = 1; i < 4; i++) {
          ctx.lineTo(cx + quad[i][0] * radius, cy - quad[i][1] * radius);
        }
        ctx.closePath();
        // Lit the way the ground is, so the cap belongs to the same ball.
        const lambert = 0.55 + 0.45 * Math.max(0, zSum / 4);
        ctx.fillStyle = shade(colour, lambert);
        ctx.fill();
      }
    }
  }
}

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

/**
 * The band's top edge, flattened to a circle for drawing.
 *
 * A pointy-top hexagon reaches its full radius at its top vertex and half of
 * it at the two upper corners, so the outermost row ends in a zigzag. Near the
 * pole the equal-area projection stretches that half-radius into ten degrees
 * of latitude, and the ice cap meeting it comes out as a crown of white spikes
 * between dark tips -- correct, and unreadable.
 *
 * Trimming the outermost corners back to the notch line gives the band a flat
 * edge for the ice to meet. It is a drawing decision and lives here rather
 * than in `outline`, because the simulation's cells really are that shape:
 * they are equal-area, the geometry suite measures them, and a renderer's
 * convenience has no business changing what a cell IS.
 */
function flattenToBand(x: number, y: number, z: number): [number, number, number] {
  const cap = BAND_SIN_LIMIT - 0.25 * CELL_R;
  if (Math.abs(y) <= cap) return [x, y, z];
  const clamped = y > 0 ? cap : -cap;
  // Back onto the sphere: keep the longitude, take the latitude down to the
  // cap, and rescale what is left in the equatorial plane.
  const was = Math.sqrt(Math.max(1e-12, 1 - y * y));
  const now = Math.sqrt(Math.max(0, 1 - clamped * clamped));
  const k = now / was;
  return [x * k, clamped, z * k];
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
  basis: { lon: number; sinLat: number };
  cellRadiusRad: number;
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
export function tilePolygons(
  kids: ChildFrame,
  cam: Camera,
  view: GlobeView,
): (Float64Array | null)[] {
  const { cx, cy, radius } = view;
  const b = kids.basis;
  const r = kids.cellRadiusRad;

  // Every lattice point the region needs, one ring wider than the map itself
  // so the outermost tiles have corners to be built from. The halo points are
  // positions only -- no data, and none needed: a corner is a position.
  const SPAN = 2 * (RADIUS + 1) + 1;
  const px = new Float64Array(SPAN * SPAN);
  const py = new Float64Array(SPAN * SPAN);
  const ok = new Uint8Array(SPAN * SPAN);
  const at = (q: number, rr: number): number => (q + RADIUS + 1) * SPAN + (rr + RADIUS + 1);

  for (let q = -(RADIUS + 1); q <= RADIUS + 1; q++) {
    for (let rr = -(RADIUS + 1); rr <= RADIUS + 1; rr++) {
      const ss = -q - rr;
      if (ss < -(RADIUS + 1) || ss > RADIUS + 1) continue;
      // Lattice position, then onto the sphere, then onto the screen: the same
      // three steps the generator used to place the cell, so a corner lands
      // exactly where the cell that owns it thinks it is.
      // Through the projection, the same way the generator placed the cell,
      // so a drawn corner lands exactly where the cell that owns it thinks it
      // is. Approximating this with a linear frame is what put one cell's
      // tiles at 76% of its own outline.
      const lon = b.lon + COVER * r * Math.sqrt(3) * (q + rr / 2);
      const sinLat = Math.max(-1, Math.min(1, b.sinLat + COVER * r * 1.5 * rr));
      const cosLat = Math.sqrt(1 - sinLat * sinLat);
      const [rx, ry] = rotate(cam, cosLat * Math.cos(lon), sinLat, cosLat * Math.sin(lon));
      const i = at(q, rr);
      px[i] = cx + rx * radius;
      py[i] = cy - ry * radius;
      ok[i] = 1;
    }
  }

  const out: (Float64Array | null)[] = new Array(SUBCELL_COUNT).fill(null);
  for (let k = 0; k < SUBCELL_COUNT; k++) {
    const [, , pz] = rotate(cam, kids.dirs[k * 3], kids.dirs[k * 3 + 1], kids.dirs[k * 3 + 2]);
    if (pz < 0) continue;

    const q = coords[k * 2];
    const rr = coords[k * 2 + 1];
    const self = at(q, rr);
    const poly = new Float64Array(12);
    let usable = true;
    for (let d = 0; d < 6; d++) {
      const da = DIRECTIONS[d];
      const db = DIRECTIONS[(d + 1) % 6];
      const ia = at(q + da[0], rr + da[1]);
      const ib = at(q + db[0], rr + db[1]);
      if (ok[ia] === 0 || ok[ib] === 0) { usable = false; break; }
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

  for (let k = 0; k < SUBCELL_COUNT; k++) {
    const poly = polys[k];
    if (poly === null) continue;

    const alt = 1 + Math.min(0.5, Math.max(0, kids.elevationM[k]) / 6000);
    ctx.fillStyle = kids.elevationM[k] < 0
      ? shade(OCEAN, lambert)
      : shade(BIOME_COLOURS[kids.biome[k]], lambert * alt);

    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 1; i < 6; i++) ctx.lineTo(poly[i * 2], poly[i * 2 + 1]);
    ctx.closePath();
    ctx.fill();
    if (drawEdges) ctx.stroke();
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
  // The same question the globe asks, in the same unit: is a TILE big enough
  // to be worth drawing?
  const childSize = size * CHILD_SCALE;
  const wantMosaic = children !== null && childSize * 2 >= MOSAIC_MIN_PX;
  const wantTint = !wantMosaic && tint !== null && size * 2 >= TINT_MIN_PX;
  // Children lay out as their own hex grid inside this cell, turned thirty
  // degrees so their grain runs with the parent's edges rather than across
  // them. Flat coordinates, so this is exact -- no projection, no lookup.
  const childShape = corners(childSize, -30 + CHILD_TURN_DEG);
  // Tile edges, on the same terms as the globe's. Without them a run of tiles
  // sharing a biome merges into one flat area and the grid disappears exactly
  // where the ground is uniform -- which is most of a map.
  const childEdges = tileEdgeWidth(childSize * 2);

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
        if (childEdges > 0) {
          ctx.strokeStyle = 'rgba(10,16,24,0.30)';
          ctx.lineWidth = childEdges;
        }
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
          if (childEdges > 0) ctx.stroke();
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
