// Turning a plant into pixels, once, and then stamping it.
//
// form.ts gives a ground plan in metres. This bakes that plan into a small
// image and reuses it, because a wood on screen is several hundred plants and
// re-tracing an oak's sixty-three branches for each of them, sixty times a
// second, is not a thing a browser will do.
//
// WHAT IS BAKED, AND WHY THAT MUCH. Four seasons and five sizes for each
// species -- twenty images, built the first time each is asked for and kept.
// Enough that a sapling is a differently shaped thing from a standard rather
// than a smaller one, and that an oak in October is not an oak in June. Not so
// much that the cache becomes the problem it was avoiding: a week-by-week,
// year-by-year bake would be fifty-two times four hundred images for one
// species, nearly all drawn once and never looked at again.
//
// The variety that twenty images cannot give comes at stamp time. Every plant
// is turned by its own angle and scaled to its own true spread, so a wood is
// not a row of clones and no plant is the wrong size for its age -- the SHAPE
// is quantised into five classes; the SIZE never is.
//
// TRUE TO SCALE, AND GONE WHEN TINY. An oak is eighteen metres across, so it is
// a large shape at the parish layer and a fifth of a pixel at the shire layer.
// Below three pixels -- `VANISH_PX`, which lives with the model rather than
// here -- nothing individual is drawn and the tile's own colour carries the
// wood, which is what it was doing at every scale before this file existed. The
// handover is a SIZE and not a zoom level, so it moves on its own when the
// plant is a bramble instead of an oak.

import { formOf, type Form } from '../../sim/model/form.ts';
import {
  type Species, Part, massAt, spreadAt, ageAtFraction, isBuried,
} from '../../sim/model/plant.ts';
import { type Individual, worthDrawing, VANISH_PX } from '../../sim/model/stand.ts';
import { GRASS } from '../../sim/model/species.ts';
import { beastOf } from '../../sim/model/beastform.ts';
import { type Beastie } from '../../sim/model/herd.ts';
import { seed, below } from '../../sim/rng.ts';

/**
 * The four weeks that stand for the four seasons.
 *
 * Not evenly spaced, and they should not be: they are the weeks at which a
 * temperate plant is most ITSELF. Week 1 is bare midwinter, 16 is new leaf, 30
 * is full summer with the grain in ear, and 43 is the turn, when the
 * chlorophyll has gone and the carotenoid underneath is showing. Weeks are
 * counted from the northern winter solstice, as season.ts defines them.
 */
export const SEASON_WEEKS: readonly number[] = [1, 16, 30, 43];

/** Which of the four a week belongs to. */
export function seasonOf(week: number, weeksPerYear: number): number {
  const w = ((week % weeksPerYear) + weeksPerYear) % weeksPerYear;
  if (w < 10 || w >= 45) return 0;
  if (w < 22) return 1;
  if (w < 37) return 2;
  return 3;
}

/**
 * The five sizes, as shares of a plant's mature mass.
 *
 * Geometric rather than even, because growth is: the interesting differences in
 * a young plant are all in its first few per cent, and the difference between
 * 80% and 100% of an oak is a decade nobody can see.
 */
const SIZE_FRACTIONS: readonly number[] = [0.02, 0.08, 0.25, 0.55, 0.9];

/** Which of the five a plant of this age belongs in. */
export function sizeClassOf(s: Species, ageYears: number, site: number): number {
  const f = massAt(s, ageYears, site) / Math.max(1e-9, s.matureMassKg);
  let cls = 0;
  for (let i = 1; i < SIZE_FRACTIONS.length; i++) {
    // The nearer of the two boundaries it lies between, in log space, which is
    // the space the classes were laid out in.
    const mid = Math.sqrt(SIZE_FRACTIONS[i - 1] * SIZE_FRACTIONS[i]);
    if (f >= mid) cls = i;
  }
  return cls;
}

/** A representative age for a class, on good ground. */
export function ageOfClass(s: Species, cls: number): number {
  return ageAtFraction(s, SIZE_FRACTIONS[Math.max(0, Math.min(4, cls))], 1);
}

/** A baked plant: the image, and how many metres across it really is. */
export interface Stamp {
  image: CanvasImageSource;
  /** Half-width of what the image covers, in metres of ground. */
  extentM: number;
}

/**
 * How much of the branching to draw at a given image size.
 *
 * Sixteen pixels cannot show five orders of forking and two hundred and
 * fifty-six can. Derived from the size rather than fixed, so the close view is
 * detailed and the far one is cheap without either being told which it is.
 */
function detailFor(px: number): number {
  return Math.max(2, Math.min(6, Math.round(Math.log2(px)) - 2));
}

/**
 * The image sizes that get baked, as powers of two from 16 to 256.
 *
 * Quantised so that a slow zoom does not bake a new image every frame. A plant
 * drawn at 40 px uses the 64 px bake scaled down, which is what a browser is
 * good at and what a cache needs.
 */
function quantise(wantPx: number): number {
  const p = Math.ceil(Math.log2(Math.max(4, wantPx)));
  return 1 << Math.max(4, Math.min(8, p));
}

const stampCache = new Map<string, Stamp | null>();

/** How far the drawn plant actually reaches, metres from its own stem. */
function extentOf(f: Form): number {
  let e = 0;
  for (const s of f.strokes) {
    e = Math.max(e, Math.hypot(s.x1, s.y1) + s.widthM / 2);
    e = Math.max(e, Math.hypot(s.x0, s.y0) + s.widthM / 2);
  }
  for (const b of f.blobs) {
    if (b.buried) continue;
    e = Math.max(e, Math.hypot(b.x, b.y) + b.radiusM);
  }
  return e;
}

function rgb(c: readonly number[]): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Bake one plant.
 *
 * Strokes first and blobs after, which is the order the view demands: from
 * above you see the leaves and the branches BETWEEN them, not the other way
 * round. Leaves before fruit for the same reason -- a blackberry hangs in front
 * of the leaf it grew on.
 *
 * Returns null when there is nothing to draw, which happens honestly: a carrot
 * in February is entirely underground.
 */
export function stampFor(
  s: Species, cls: number, season: number, px: number,
): Stamp | null {
  const key = `${s.name}|${cls}|${season}|${px}`;
  const hit = stampCache.get(key);
  if (hit !== undefined) return hit;

  const age = ageOfClass(s, cls);
  const form = formOf(s, {
    ageYears: age, site: 1, week: SEASON_WEEKS[season], weeksPerYear: 52,
    // One seed per class, so the five sizes of a species are five different
    // plants rather than one plant at five scales. Individuals get their
    // variety from the turn they are stamped at.
    seed: 0x5EED + cls * 31 + season, detail: detailFor(px),
  });
  const extentM = extentOf(form);
  if (extentM <= 0) { stampCache.set(key, null); return null; }

  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const c = canvas.getContext('2d');
  if (c === null) { stampCache.set(key, null); return null; }

  // Metres to pixels, with the plant's own reach filling the image.
  const k = (px / 2) / extentM;
  const mid = px / 2;
  c.lineCap = 'round';
  for (const st of form.strokes) {
    c.strokeStyle = rgb(st.rgb);
    c.lineWidth = Math.max(0.6, st.widthM * k);
    c.beginPath();
    c.moveTo(mid + st.x0 * k, mid + st.y0 * k);
    c.lineTo(mid + st.x1 * k, mid + st.y1 * k);
    c.stroke();
  }
  // Leaves, then everything that hangs in front of them.
  for (const pass of [true, false]) {
    for (const b of form.blobs) {
      if (b.buried) continue;
      if ((b.part === Part.Leaf) !== pass) continue;
      const r = Math.max(0.5, b.radiusM * k);
      c.fillStyle = rgb(b.rgb);
      c.beginPath();
      c.arc(mid + b.x * k, mid + b.y * k, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  const stamp: Stamp = { image: canvas, extentM };
  stampCache.set(key, stamp);
  return stamp;
}

/**
 * The largest image that gets baked. Past this, the plant is traced.
 *
 * A stamp is an image at a fixed number of pixels, so drawing one larger than
 * it was baked is an upscale, and at the deepest layer the upscale is
 * fifty-fold: a two-metre view under an eighteen-metre oak asks for a crown
 * fourteen thousand pixels across from a two hundred and fifty-six pixel
 * picture. Baking bigger is no answer -- the same argument would come back one
 * layer down, and a 4,096-pixel bake of one oak is sixty-four megabytes.
 *
 * So past this size the plant is drawn straight from its form, branch by
 * branch, at whatever detail the size deserves. That costs about five hundred
 * strokes for an oak and is affordable precisely BECAUSE it only happens when
 * a crown fills the screen, which means there are two or three of them.
 */
const MAX_STAMP_PX = 256;

/**
 * Trace one plant at true scale, rather than stamping a picture of it.
 *
 * This is the close view the whole system was for: at the pace layer a tile IS
 * part of a tree, and what you are looking at is its branches, in their real
 * places, with its real leaves on them.
 */
export function traceForm(
  ctx: CanvasRenderingContext2D,
  s: Species, ageYears: number, week: number,
  cx: number, cy: number, pxPerM: number, turn: number, seed: number,
): number {
  // Detail from the size, as the bake does, and allowed further because there
  // are only ever a handful of plants big enough to reach this path.
  const detail = Math.max(4, Math.min(8, Math.round(Math.log2(spreadAt(s, ageYears, 1) * pxPerM)) - 2));
  const form = formOf(s, {
    ageYears, site: 1, week, weeksPerYear: 52, seed, detail,
  });
  const c = Math.cos(turn);
  const sn = Math.sin(turn);
  const px = (x: number, y: number): [number, number] =>
    [cx + (x * c - y * sn) * pxPerM, cy + (x * sn + y * c) * pxPerM];

  ctx.lineCap = 'round';
  for (const st of form.strokes) {
    const [x0, y0] = px(st.x0, st.y0);
    const [x1, y1] = px(st.x1, st.y1);
    ctx.strokeStyle = rgb(st.rgb);
    ctx.lineWidth = Math.max(1, st.widthM * pxPerM);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  let drawn = form.strokes.length;
  for (const pass of [true, false]) {
    for (const b of form.blobs) {
      if (b.buried) continue;
      if ((b.part === Part.Leaf) !== pass) continue;
      const [x, y] = px(b.x, b.y);
      ctx.fillStyle = rgb(b.rgb);
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, b.radiusM * pxPerM), 0, Math.PI * 2);
      ctx.fill();
      drawn++;
    }
  }
  return drawn;
}

/** How many images are being held, so a suite can say the cache is bounded. */
export function stampCacheSize(): number {
  return stampCache.size;
}

export function clearStampCache(): void {
  stampCache.clear();
}


// --- the ground between them -------------------------------------------------
//
// A hectare of pasture holds a million tufts of grass, so the sward can never
// be stamped one plant at a time the way the trees are. It is a TEXTURE, and
// the honest way to make one is to bake it out of the same plants: scatter real
// grass forms into a small square that repeats, and lay that under everything.
//
// What that buys over a flat colour is not prettiness. It is that the texture
// is a consequence rather than an asset -- the sward's own species decides its
// shape, its pigment decides its colour, and its phenology decides whether
// there is anything there at all. A winter tile has bare earth in it because
// the grass's Leaf part is out of season, and nothing had to be told that.

/** How much ground one repeat of the texture covers, metres. */
const GROUND_TILE_M = 1.5;

/**
 * And at what resolution -- quantised, and chosen from the zoom.
 *
 * Fixed at 128 the sward blurred at the deepest layers for the same reason the
 * biggest tree did: a 1.5 m tile drawn where a metre is eight hundred pixels is
 * a ninefold upscale. Baking to a power of two between 64 and 512 keeps a tuft
 * near ten pixels at every zoom it is drawn at, and the cache stays small
 * because only one or two of those sizes are ever on screen at once.
 */
const GROUND_TILE_MIN_PX = 64;
const GROUND_TILE_MAX_PX = 512;

function groundPxFor(pxPerM: number): number {
  const want = Math.max(1, pxPerM * GROUND_TILE_M);
  const p = Math.ceil(Math.log2(want));
  return 1 << Math.max(6, Math.min(9, p));
}

/**
 * As many tufts as one bake will draw.
 *
 * A dense sward is 170 tufts a square metre, which is 380 in a tile this size,
 * and drawing every one of them costs more than the picture gains. Past the cap
 * the tufts left are drawn LARGER, by the square root of the ratio, so that the
 * ground they cover is the ground the sward covers -- the same conservation the
 * crop uses across detail levels, and for the same reason.
 */
const MAX_TUFTS = 200;

/** A baked patch of sward: the image and the pixels it was baked at. */
export interface GroundTile {
  image: CanvasImageSource;
  px: number;
}

const groundCache = new Map<string, GroundTile | null>();

/**
 * A repeating patch of sward, baked once.
 *
 * `tuftsPerM2` is quantised into octaves before it becomes a key, because a
 * texture cannot show the difference between 130 tufts and 137 and a cache
 * should not be asked to hold both.
 */
export function groundTileFor(
  season: number, tuftsPerM2: number, pxPerM: number,
): GroundTile | null {
  if (tuftsPerM2 <= 0) return null;
  const octave = Math.round(Math.log2(tuftsPerM2) * 2) / 2;
  const GROUND_TILE_PX = groundPxFor(pxPerM);
  const key = season + '|' + octave + '|' + GROUND_TILE_PX;
  const hit = groundCache.get(key);
  if (hit !== undefined) return hit;

  const density = Math.pow(2, octave);
  const wanted = density * GROUND_TILE_M * GROUND_TILE_M;
  const n = Math.max(1, Math.min(MAX_TUFTS, Math.round(wanted)));
  // Conserve the ground covered when the count is capped: n discs of radius r
  // cover what `wanted` discs of the true radius would, if r grows as the
  // square root of the ratio.
  const swell = Math.sqrt(wanted / n);

  const canvas = document.createElement('canvas');
  canvas.width = GROUND_TILE_PX;
  canvas.height = GROUND_TILE_PX;
  const c = canvas.getContext('2d');
  if (c === null) { groundCache.set(key, null); return null; }

  const k = (GROUND_TILE_PX / GROUND_TILE_M) * swell;
  const T = GROUND_TILE_PX;
  c.lineCap = 'round';
  let painted = 0;

  for (let i = 0; i < n; i++) {
    // A mature tuft, since a sward is perennial and mostly grown. Its own seed,
    // so no two are the same plant.
    const form = formOf(GRASS, {
      ageYears: 3, site: 1, week: SEASON_WEEKS[season], weeksPerYear: 52,
      seed: 0xC5A55 + i, detail: 2,
    });
    if (form.strokes.length === 0 && form.blobs.length === 0) continue;

    // Scattered by the same deterministic stream, so the texture is the same
    // texture on every machine and in every session.
    const rng = seed(0x62055 + i);
    const px = (below(rng, 10000) / 10000) * T;
    const py = (below(rng, 10000) / 10000) * T;

    // SEAMLESS, by drawing anything near an edge again on the far side. A tuft
    // is small, so this is one extra copy for the few that straddle a border
    // rather than nine copies of everything.
    const reach = 0.5 * GROUND_TILE_M * k;
    const wrapX = px < reach ? T : px > T - reach ? -T : 0;
    const wrapY = py < reach ? T : py > T - reach ? -T : 0;
    const xs = wrapX === 0 ? [0] : [0, wrapX];
    const ys = wrapY === 0 ? [0] : [0, wrapY];
    for (const ox of xs) {
      for (const oy of ys) {
        for (const st of form.strokes) {
          c.strokeStyle = rgb(st.rgb);
          c.lineWidth = Math.max(0.5, st.widthM * k);
          c.beginPath();
          c.moveTo(px + ox + st.x0 * k, py + oy + st.y0 * k);
          c.lineTo(px + ox + st.x1 * k, py + oy + st.y1 * k);
          c.stroke();
        }
        for (const b of form.blobs) {
          if (b.buried) continue;
          c.fillStyle = rgb(b.rgb);
          c.beginPath();
          c.arc(px + ox + b.x * k, py + oy + b.y * k, Math.max(0.5, b.radiusM * k), 0, Math.PI * 2);
          c.fill();
        }
        painted++;
      }
    }
  }

  const out: GroundTile | null = painted > 0
    ? { image: canvas as CanvasImageSource, px: GROUND_TILE_PX }
    : null;
  groundCache.set(key, out);
  return out;
}

/** How many ground textures are held, so a suite can say the cache is bounded. */
export function groundCacheSize(): number {
  return groundCache.size;
}

const patternCache = new WeakMap<object, CanvasPattern | null>();

/**
 * Lay the sward over one lattice cell.
 *
 * The pattern is placed through the canvas transform rather than through
 * CanvasPattern.setTransform, which needs a DOMMatrix -- the plainer route
 * works in every browser and in the headless harness, and it anchors the
 * repeat to the cell's own position, so the grass does not swim across the
 * ground when the view is panned.
 */
export function drawGround(
  ctx: CanvasRenderingContext2D,
  tile: GroundTile,
  cx: number, cy: number, pxPerM: number, tc: number, ts: number, halfM: number,
): boolean {
  let pattern = patternCache.get(tile.image as object);
  if (pattern === undefined) {
    pattern = ctx.createPattern(tile.image, 'repeat');
    patternCache.set(tile.image as object, pattern);
  }
  if (pattern === null || pattern === undefined) return false;

  // Metres to the pattern's own pixels.
  const scale = (pxPerM * GROUND_TILE_M) / tile.px;
  if (!(scale > 0)) return false;
  const half = (halfM * pxPerM) / scale;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.atan2(ts, tc));
  ctx.scale(scale, scale);
  ctx.fillStyle = pattern;
  ctx.fillRect(-half, -half, half * 2, half * 2);
  ctx.restore();
  return true;
}

/** What a call to drawStand actually did, for anything that wants to know. */
export interface StandDrawn {
  drawn: number;
  /** Plants skipped because at this zoom they are smaller than a smudge. */
  tooSmall: number;
  /** Plants not drawn because the canopy above them was already opaque. */
  hidden: number;
  /** Screen area their crowns covered, px2, overlaps counted twice. */
  coverPx2: number;
}

/**
 * Stamp a tile's plants onto the map.
 *
 * `cx, cy` is the tile's centre in canvas pixels and `pxPerM` how many pixels a
 * metre of ground is worth there. `tc, ts` is the tile's own turn in the
 * picture as a unit vector -- the same one the hexagon is drawn with, which
 * already carries both the lattice's orientation and the view's rotation. Plant
 * offsets have to go through it or a wood would slide across its own ground
 * whenever the map turned.
 */
/**
 * What never changes about a plant between frames, worked out once.
 *
 * A stand is cached in the lattice, so its plants are the same objects every
 * frame -- and spreadAt, the size class, the class ratio and the turn were
 * being recomputed for three thousand of them sixty times a second, all from
 * inputs that cannot change. Keyed weakly by the plants array itself.
 */
interface PlantDraw {
  spreadM: number;
  cls: number;
  scale: number;
  turn: number;
}

const standDrawCache = new WeakMap<readonly Individual[], PlantDraw[]>();

function drawDataFor(plants: readonly Individual[]): PlantDraw[] {
  const hit = standDrawCache.get(plants);
  if (hit !== undefined) return hit;
  const out: PlantDraw[] = plants.map((p) => {
    const spreadM = spreadAt(p.species, p.ageYears, 1);
    const cls = sizeClassOf(p.species, p.ageYears, 1);
    const classSpread = spreadAt(p.species, ageOfClass(p.species, cls), 1);
    return {
      spreadM,
      cls,
      scale: classSpread > 0 ? spreadM / classSpread : 1,
      turn: ((p.seed % 360) * Math.PI) / 180,
    };
  });
  standDrawCache.set(plants, out);
  return out;
}

/**
 * Below this many pixels across, a stamp is drawn unrotated.
 *
 * Rotating a twelve-pixel blob changes nothing an eye can find, and the
 * save-translate-rotate-restore it cost was most of the price of a dense
 * layer: measured, the plot layer stamps ~2,900 plants a frame and nearly all
 * of them are under this size.
 */
const ROTATE_MIN_PX = 12;

export function drawStand(
  ctx: CanvasRenderingContext2D,
  plants: readonly Individual[],
  week: number,
  cx: number, cy: number, pxPerM: number, tc: number, ts: number,
  budgetPx2 = Infinity,
): StandDrawn {
  let drawn = 0;
  let tooSmall = 0;
  let hidden = 0;
  let coverPx2 = 0;
  if (plants.length === 0 || pxPerM <= 0) {
    return { drawn, tooSmall, hidden, coverPx2 };
  }

  const season = seasonOf(week, 52);
  const baseTurn = Math.atan2(ts, tc);
  const data = drawDataFor(plants);

  for (let idx = 0; idx < plants.length; idx++) {
    const p = plants[idx];
    const d = data[idx];
    // ONCE THE CANOPY IS OPAQUE, THE REST OF IT IS NOT VISIBLE. At the pace
    // layer a two-metre view sits under a hundred and fifty crowns, every one
    // of them eighteen metres wide and covering the whole screen, and drawing
    // all of them is thirty-six screens of paint for a picture identical to
    // three. The caller's budget is Beer's law again -- see drawFlora.
    if (coverPx2 >= budgetPx2) { hidden++; continue; }

    // Its own true size, not its class's -- the shape is quantised and the
    // scale never is.
    if (!worthDrawing(d.spreadM, pxPerM)) { tooSmall++; continue; }
    const wantPx = d.spreadM * pxPerM;

    // BRANCH BY BRANCH, once a stamp would be an upscale rather than a picture.
    if (wantPx > MAX_STAMP_PX) {
      const dx0 = p.x * tc - p.y * ts;
      const dy0 = p.x * ts + p.y * tc;
      traceForm(
        ctx, p.species, p.ageYears, SEASON_WEEKS[season],
        cx + dx0 * pxPerM, cy + dy0 * pxPerM, pxPerM, d.turn + baseTurn, p.seed,
      );
      drawn++;
      coverPx2 += (Math.PI * wantPx * wantPx) / 4;
      continue;
    }

    const stamp = stampFor(p.species, d.cls, season, quantise(wantPx));
    if (stamp === null) { tooSmall++; continue; }

    const halfPx = stamp.extentM * d.scale * pxPerM;
    if (halfPx < 1) { tooSmall++; continue; }

    const dx = p.x * tc - p.y * ts;
    const dy = p.x * ts + p.y * tc;
    const x = cx + dx * pxPerM;
    const y = cy + dy * pxPerM;

    if (halfPx * 2 < ROTATE_MIN_PX) {
      ctx.drawImage(stamp.image, x - halfPx, y - halfPx, halfPx * 2, halfPx * 2);
    } else {
      // Its own turn, which is where the variety comes from once the shape is
      // one of twenty. Derived from the plant's seed so it never changes.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.turn + baseTurn);
      ctx.drawImage(stamp.image, -halfPx, -halfPx, halfPx * 2, halfPx * 2);
      ctx.restore();
    }
    drawn++;
    coverPx2 += Math.PI * halfPx * halfPx;
  }

  return { drawn, tooSmall, hidden, coverPx2 };
}

/**
 * What a plant's crop looks like when it is dug up rather than seen.
 *
 * The other half of what an asset system for plants has to do: a carrot's whole
 * value is buried, and nothing above ground says where it is. Same derivation,
 * same colours, drawn only when something has reason to look.
 */
export function drawBuried(
  ctx: CanvasRenderingContext2D,
  s: Species, ageYears: number, week: number,
  cx: number, cy: number, pxPerM: number,
): number {
  const form = formOf(s, {
    ageYears, site: 1, week, weeksPerYear: 52, seed: 1, detail: 3,
  });
  let drawn = 0;
  for (const b of form.blobs) {
    if (!b.buried || !isBuried(b.part)) continue;
    ctx.fillStyle = rgb(b.rgb);
    ctx.beginPath();
    ctx.arc(cx + b.x * pxPerM, cy + b.y * pxPerM, b.radiusM * pxPerM, 0, Math.PI * 2);
    ctx.fill();
    drawn++;
  }
  return drawn;
}


// --- the beasts --------------------------------------------------------------

/**
 * Stamp a patch's cattle.
 *
 * TRACED, NOT BAKED, and that is the right call for an animal where it was the
 * wrong one for a tree. A cow is fourteen shapes; an oak at full detail is six
 * hundred. There are never more than a few dozen beasts on screen, because a
 * beast is two metres across and needs a close view, so tracing costs a few
 * hundred operations a frame and saves a cache with an age dimension in it.
 *
 * The size is the animal's own, always: a calf is drawn as the calf it is,
 * because beastOf reads its mass and its mass reads its age.
 */
export function drawHerd(
  ctx: CanvasRenderingContext2D,
  beasts: readonly Beastie[],
  cx: number, cy: number, pxPerM: number, tc: number, ts: number,
): number {
  if (beasts.length === 0 || pxPerM <= 0) return 0;
  const baseTurn = Math.atan2(ts, tc);
  let drawn = 0;

  for (const b of beasts) {
    const form = beastOf(b.animal, b.ageYears, b.seed);
    const lengthPx = form.build.overallLengthM * pxPerM;
    // The same vanishing rule the plants get, and it moves on its own: a calf
    // disappears from a view that still shows its mother.
    if (lengthPx < VANISH_PX) continue;

    const dx = b.x * tc - b.y * ts;
    const dy = b.x * ts + b.y * tc;
    const x = cx + dx * pxPerM;
    const y = cy + dy * pxPerM;
    // Which way she is facing. Her own, from her own seed, so a herd is not a
    // parade -- and stable, so she does not spin when the view is dragged.
    const turn = ((b.seed % 360) * Math.PI) / 180 + baseTurn;
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    const at = (px: number, py: number): [number, number] =>
      [x + (px * c - py * sn) * pxPerM, y + (px * sn + py * c) * pxPerM];

    ctx.lineCap = 'round';
    for (const st of form.strokes) {
      const [x0, y0] = at(st.x0, st.y0);
      const [x1, y1] = at(st.x1, st.y1);
      ctx.strokeStyle = rgb(st.rgb);
      ctx.lineWidth = Math.max(0.7, st.widthM * pxPerM);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    for (const bl of form.blobs) {
      const [bx, by] = at(bl.x, bl.y);
      ctx.fillStyle = rgb(bl.rgb);
      ctx.beginPath();
      ctx.arc(bx, by, Math.max(0.7, bl.radiusM * pxPerM), 0, Math.PI * 2);
      ctx.fill();
    }
    drawn++;
  }
  return drawn;
}
