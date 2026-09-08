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
import { type Individual, worthDrawing } from '../../sim/model/stand.ts';

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

/** How many images are being held, so a suite can say the cache is bounded. */
export function stampCacheSize(): number {
  return stampCache.size;
}

export function clearStampCache(): void {
  stampCache.clear();
}

/** What a call to drawStand actually did, for anything that wants to know. */
export interface StandDrawn {
  drawn: number;
  /** Plants skipped because at this zoom they are smaller than a smudge. */
  tooSmall: number;
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
export function drawStand(
  ctx: CanvasRenderingContext2D,
  plants: readonly Individual[],
  week: number,
  cx: number, cy: number, pxPerM: number, tc: number, ts: number,
): StandDrawn {
  let drawn = 0;
  let tooSmall = 0;
  if (plants.length === 0 || pxPerM <= 0) return { drawn, tooSmall };

  const season = seasonOf(week, 52);
  const baseTurn = Math.atan2(ts, tc);

  for (const p of plants) {
    // Its own true size, not its class's -- the shape is quantised and the
    // scale never is.
    const spreadM = spreadAt(p.species, p.ageYears, 1);
    if (!worthDrawing(spreadM, pxPerM)) { tooSmall++; continue; }

    const cls = sizeClassOf(p.species, p.ageYears, 1);
    const wantPx = spreadM * pxPerM;
    const stamp = stampFor(p.species, cls, season, quantise(wantPx));
    if (stamp === null) { tooSmall++; continue; }

    // The stamp covers `extentM` metres either side of the stem; the plant is
    // `spreadM` across at its class's reference age. Scaling by the ratio of
    // this individual's spread to its class's keeps a young plant small and an
    // old one large within the same image.
    const classSpread = spreadAt(p.species, ageOfClass(p.species, cls), 1);
    const scale = classSpread > 0 ? spreadM / classSpread : 1;
    const halfPx = stamp.extentM * scale * pxPerM;
    if (halfPx < 1) { tooSmall++; continue; }

    const dx = p.x * tc - p.y * ts;
    const dy = p.x * ts + p.y * tc;
    const x = cx + dx * pxPerM;
    const y = cy + dy * pxPerM;

    // Its own turn, which is where the variety comes from once the shape is
    // one of twenty. Derived from the plant's seed so it never changes.
    const turn = ((p.seed % 360) * Math.PI) / 180 + baseTurn;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(turn);
    ctx.drawImage(stamp.image, -halfPx, -halfPx, halfPx * 2, halfPx * 2);
    ctx.restore();
    drawn++;
  }

  return { drawn, tooSmall };
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
