// What a plant LOOKS like, solved from what it is made of.
//
// This is the file that turns a species sheet into a picture, and the rule it
// obeys is the project's rule: no shape is drawn by hand. A trunk is as thick
// as the wood in it says; a tree carries as many twigs as its trunk's
// cross-section can supply; a crown is as dense as its leaf area makes it. Give
// the sheet a heavier oak and the trunk thickens on its own, because the
// thickness was never a number anybody typed.
//
// THE VIEW IS FROM ABOVE, which decides what matters. Height barely shows;
// crown width is everything; and a branch's contribution to the picture is its
// horizontal projection, not its length. So the geometry below is worked in
// ground-plan metres throughout, and the one thing height is really used for is
// solving the trunk.
//
// THE FOUR DERIVATIONS, in the order they depend on each other:
//
//   1. TRUNK DIAMETER, from the bole's mass and the wood's density. Volume is
//      mass over density; a stem is a tapered solid whose volume is its basal
//      area times its length times a FORM FACTOR that foresters have measured
//      at about a half for two centuries. Turn it round and the diameter falls
//      out. This is checked across four orders of magnitude -- an oak bole near
//      half a metre, a hazel pole near three centimetres, a bramble cane near
//      nine millimetres, a wheat straw near two and a half -- and not one of
//      those four numbers appears in any source file.
//
//   2. TWIG COUNT, by Leonardo da Vinci's rule: the summed cross-section of the
//      branches above a fork equals the cross-section below it. Applied all the
//      way up, the number of twigs a trunk can supply is (trunk diameter /
//      twig diameter) squared, and nothing else. An oak comes out near ten
//      thousand twigs, which is what an oak has.
//
//   3. TWIG DIAMETER, which the same rule gives for free and which is the
//      pretty one. The twig part's total volume is (number of twigs) x (one
//      twig's volume); substitute the count from rule 2 and the count cancels,
//      leaving twig diameter as a function of the twig mass, the trunk diameter
//      and how slender a twig is. So the sheet says how much twig there is and
//      the geometry says how it must be divided up.
//
//   4. CROWN DENSITY, by Beer's law. Leaf area over crown ground area is the
//      leaf area index; the fraction of the ground it hides is 1 - exp(-k.LAI).
//      This is the same Poisson argument flora.ts uses for canopy cover BETWEEN
//      trees, applied WITHIN one crown, and it means a tree in a poor year
//      draws a thinner crown without anything being told to.
//
// WHAT IS NOT DERIVED, said plainly. The overall crown WIDTH is the species'
// measured mature spread, scaled by growth -- the branch ratios below give the
// crown's shape but not its size, and pretending otherwise would mean claiming
// to predict an oak's spread from its mass, which nothing here can do. And the
// fork angle and the jitter are appearance: they move where a twig sits, never
// how many there are or how thick.

import { dexp, dlog, dsin, dcos, PI } from '../gen/mathx.ts';
import { seed, below, type RngState } from '../rng.ts';
import {
  type Species, type PartSpec, Part, Habit, isBuried, partColour, isPresent,
  massAt, spreadAt,
} from './plant.ts';

// --- measured constants ------------------------------------------------------

/**
 * Stem form factor: what fraction of the enclosing cylinder a real stem fills.
 *
 * Measured, and old. Foresters have been solving standing volume from girth and
 * height since the eighteenth century, and the factor for broadleaves sits
 * between 0.45 and 0.55 across every published table. Half is the middle of it.
 */
const FORM_FACTOR = 0.5;

/**
 * How slender a twig is: length over diameter.
 *
 * A year's growth on an oak is about three hundred millimetres long and five
 * thick. Sixty is that ratio, and it holds across woody species because the
 * constraint behind it -- a cantilever that must not droop under its own
 * leaves -- is the same for all of them.
 */
const TWIG_SLENDERNESS = 60;

/**
 * Specific leaf area, m2 of leaf per kg of leaf.
 *
 * Measured, and one of the most-collected numbers in plant ecology. Temperate
 * deciduous broadleaves cluster near 15; a conifer needle is far lower and a
 * shade herb far higher, which is a difference worth carrying per species
 * later, not now.
 *
 * Note the mass basis: part shares are of the plant's DRY mass, while a
 * composition's fractions describe the material as it stands. So this
 * multiplies the share directly and not the wet composition.
 */
const SLA_M2_PER_KG = 15;

/**
 * Beer's law extinction coefficients, for a canopy seen from straight above.
 *
 * Measured at about 0.5 for broadleaf canopies and about 0.3 for the erect
 * leaves of a grass -- which is exactly why a wheat field lets light down to
 * its own lower leaves and a wood does not.
 */
const EXTINCTION_BROAD = 0.5;
const EXTINCTION_ERECT = 0.3;

/**
 * The angle a branch leaves its parent at, degrees.
 *
 * FREE PARAMETER 1. Measured at 30 to 45 for temperate broadleaves, and one
 * number here stands for what is really a species trait. It moves where twigs
 * sit and nothing else -- not their number, not their thickness, not the
 * crown's density, none of which read it.
 */
const FORK_ANGLE_DEG = 35;

/** Branches per fork. Dichotomous, which is what Leonardo's rule is stated on. */
const BIFURCATION = 2;

// --- the four derivations ----------------------------------------------------

/** The parts that make up the load-bearing stem, which differs by habit. */
export function bolePartsOf(s: Species): PartSpec[] {
  const wanted: Part[] = s.habit === Habit.Tree || s.habit === Habit.Shrub
    ? [Part.Heartwood, Part.Sapwood]
    : [Part.Branch];
  return s.parts.filter((p) => wanted.includes(p.part));
}

/** Volume of the bole, m3: mass over density, part by part. */
export function boleVolumeM3(s: Species, ageYears: number, site: number): number {
  const mass = massAt(s, ageYears, site);
  let v = 0;
  for (const p of bolePartsOf(s)) v += (mass * p.share) / p.densityKgM3;
  return v;
}

/**
 * How tall it is at this age, metres.
 *
 * Height follows mass by the cube root, as spread does -- a plant at a
 * hundredth of its final mass is about a fifth of its final size in every
 * linear dimension. Against the species' own mature mass, not the site's
 * reduced ceiling: see the note on spreadAt, where taking the site off twice
 * left a stunted oak with a thriving oak's trunk.
 */
export function heightM(s: Species, ageYears: number, site: number): number {
  const m = massAt(s, ageYears, site);
  if (m <= 0 || s.matureMassKg <= 0) return 0;
  return s.matureHeightM * Math.cbrt(m / s.matureMassKg);
}

/**
 * The length the bole's volume is spread along, metres.
 *
 * A tree's bole runs its height. A cane does not: a bramble's stem arches out
 * and back down, so what it is long IS how far it reaches, and using its height
 * instead would come out four times too thick.
 */
export function boleLengthM(s: Species, ageYears: number, site: number): number {
  return s.habit === Habit.Climber
    ? spreadAt(s, ageYears, site)
    : heightM(s, ageYears, site);
}

/**
 * DERIVATION 1. Diameter of one stem at its base, metres.
 *
 * V = f . (pi d^2 / 4) . L . n, for n stems of length L and form factor f,
 * solved for d. Every input is measured; the output is in no file.
 */
export function stemDiameterM(s: Species, ageYears: number, site: number): number {
  const v = boleVolumeM3(s, ageYears, site);
  const len = boleLengthM(s, ageYears, site);
  const n = Math.max(1, s.stems);
  if (v <= 0 || len <= 0) return 0;
  const area = v / (FORM_FACTOR * len * n);
  return 2 * Math.sqrt(area / PI);
}

/** The twig part, if the species has one. Not everything does. */
function twigSpecOf(s: Species): PartSpec | undefined {
  return s.parts.find((p) => p.part === Part.Twig);
}

/**
 * DERIVATION 3. Diameter of one twig, metres.
 *
 * From Leonardo's rule the twig count is (D/d)^2, and the twig part's volume is
 * that count times one twig's volume, (pi d^2 / 4)(lambda d). Substitute, and
 * the d^2 cancels:
 *
 *     V_twig = (pi lambda / 4) D^2 d      ->      d = 4 V_twig / (pi lambda D^2)
 *
 * so the count never has to be assumed in order to get the size. Worked PER
 * STEM, because a coppice stool's seven poles each supply their own crown of
 * twigs, and treating them as one bole would come out seven times too fat.
 */
export function twigDiameterM(s: Species, ageYears: number, site: number): number {
  const spec = twigSpecOf(s);
  if (!spec) return 0;
  const trunk = stemDiameterM(s, ageYears, site);
  if (trunk <= 0) return 0;
  const n = Math.max(1, s.stems);
  const vTwig = (massAt(s, ageYears, site) * spec.share) / spec.densityKgM3 / n;
  return (4 * vTwig) / (PI * TWIG_SLENDERNESS * trunk * trunk);
}

/**
 * DERIVATION 2. How many twigs the whole plant carries.
 *
 * Leonardo's rule, all the way up: cross-section is conserved at every fork, so
 * a stem of diameter D ends in (D/d)^2 twigs of diameter d, whatever route the
 * branching took to get there.
 */
export function twigCount(s: Species, ageYears: number, site: number): number {
  const d = twigDiameterM(s, ageYears, site);
  if (d <= 0) return 0;
  const trunk = stemDiameterM(s, ageYears, site);
  const ratio = trunk / d;
  return ratio * ratio * Math.max(1, s.stems);
}

/** How many forks separate a stem from a twig, given the count above. */
export function branchOrders(s: Species, ageYears: number, site: number): number {
  const tips = twigCount(s, ageYears, site) / Math.max(1, s.stems);
  if (tips <= 1) return 0;
  return dlog(tips) / dlog(BIFURCATION);
}

/** Ground one plant's crown stands over, m2. */
export function crownAreaM2(s: Species, ageYears: number, site: number): number {
  const r = spreadAt(s, ageYears, site) / 2;
  return PI * r * r;
}

/**
 * DERIVATION 4a. Leaf area index of one crown: leaf area over ground under it.
 *
 * Zero out of season, which is what makes a winter oak a skeleton rather than a
 * grey blob.
 */
export function leafAreaIndex(
  s: Species, ageYears: number, site: number, week: number, weeksPerYear: number,
): number {
  const leaf = s.parts.find((p) => p.part === Part.Leaf);
  if (!leaf) return 0;
  if (!isPresent(leaf.phenology, week, weeksPerYear)) return 0;
  const area = crownAreaM2(s, ageYears, site);
  if (area <= 0) return 0;
  return (massAt(s, ageYears, site) * leaf.share * SLA_M2_PER_KG) / area;
}

/**
 * DERIVATION 4b. The fraction of the ground under a crown that the crown
 * actually hides, 0 to 1. Beer's law.
 *
 * The same Poisson argument as canopy cover between trees, one level down: the
 * chance a vertical line misses every leaf is exp(-k.LAI). A grass's leaves
 * stand up rather than lie flat, so they intercept less of a vertical view --
 * which is measured, and is why a standing crop looks thinner from above than
 * its leaf area suggests.
 */
export function crownOpacity(
  s: Species, ageYears: number, site: number, week: number, weeksPerYear: number,
): number {
  const k = s.habit === Habit.Grass ? EXTINCTION_ERECT : EXTINCTION_BROAD;
  return 1 - dexp(-k * leafAreaIndex(s, ageYears, site, week, weeksPerYear));
}

// --- the shape ---------------------------------------------------------------

/** A woody line seen from above: a branch, a cane, a straw. */
export interface Stroke {
  part: Part;
  x0: number; y0: number; x1: number; y1: number;
  /** Thickness on the ground, metres. */
  widthM: number;
  rgb: [number, number, number];
}

/** A round mass seen from above -- or from below, for the buried ones. */
export interface Blob {
  part: Part;
  x: number; y: number;
  radiusM: number;
  rgb: [number, number, number];
  /** True for roots, rhizomes and storage organs: drawn only when dug up. */
  buried: boolean;
}

/** One plant's ground plan, in metres from its own stem. */
export interface Form {
  species: string;
  habit: Habit;
  heightM: number;
  spreadM: number;
  stemDiameterM: number;
  twigCount: number;
  crownOpacity: number;
  strokes: Stroke[];
  blobs: Blob[];
}

export interface FormOptions {
  ageYears: number;
  site: number;
  week: number;
  weeksPerYear: number;
  /** Distinguishes one individual from its neighbours. Nothing else. */
  seed: number;
  /**
   * How many forks to actually draw.
   *
   * FREE PARAMETER 2, and honestly so: an oak has ten thousand twigs and a
   * picture of one is thirty pixels across, so something has to give. Five
   * gives thirty-two drawn tips and reads as a tree. The COUNT above is still
   * the real one, and everything the drawn tips carry -- leaf, acorn, blossom,
   * ear -- is the plant's whole crop divided among them, so the picture stays
   * conserved however coarse it is.
   */
  detail: number;
}

/** A jitter in [-1, 1], from a stream that depends only on the seed. */
function jitter(rng: RngState): number {
  return below(rng, 2001) / 1000 - 1;
}

const DEG = PI / 180;

/** Which parts hang from the tips rather than being structure themselves. */
function hangsFromTips(s: Species, spec: PartSpec): boolean {
  if (isBuried(spec.part)) return false;
  // Sap is inside the wood and a bud is under a scale: neither shows from above.
  if (spec.part === Part.Sap || spec.part === Part.Bud) return false;
  // Bark and twig are the strokes themselves, already drawn.
  if (spec.part === Part.Bark || spec.part === Part.Twig) return false;
  if (bolePartsOf(s).some((b) => b.part === spec.part)) return false;
  // A tree's branch part is structure; a straw or a cane IS the branch part,
  // and has already been drawn as a stroke.
  if (spec.part === Part.Branch) return false;
  return true;
}

/**
 * The ground plan of one plant.
 *
 * Everything in it is metres, centred on the stem, so a caller scales by
 * whatever a metre is worth at its zoom and never has to know a plant's size in
 * advance.
 */
export function formOf(s: Species, o: FormOptions): Form {
  const rng = seed(o.seed);
  const spread = spreadAt(s, o.ageYears, o.site);
  const radius = spread / 2;
  const trunk = stemDiameterM(s, o.ageYears, o.site);
  const strokes: Stroke[] = [];
  const blobs: Blob[] = [];
  const mass = massAt(s, o.ageYears, o.site);

  const opacity = crownOpacity(s, o.ageYears, o.site, o.week, o.weeksPerYear);
  const barkSpec = s.parts.find((p) => p.part === Part.Bark);
  const woodSpec = barkSpec ?? bolePartsOf(s)[0] ?? s.parts[0];
  const woodColour = partColour(woodSpec, o.week, o.weeksPerYear);

  // THE TIPS. Every plant, whatever its habit, ends in a set of points on the
  // ground plan where its leaves and its crop hang. How those points are
  // reached differs by habit; that they exist is what lets ONE rule below share
  // the crop out, rather than a rule per species.
  const tips: { x: number; y: number }[] = [];
  const orders = Math.max(
    0, Math.min(o.detail, Math.round(branchOrders(s, o.ageYears, o.site))),
  );

  if (s.habit === Habit.Tree || s.habit === Habit.Shrub) {
    // The branch RATIOS come from the two rules and nothing else. Under
    // Leonardo's rule a child of a two-way fork is 1/sqrt(2) of its parent's
    // diameter. Under elastic similarity -- McMahon's measured result, and the
    // reason a branch neither snaps nor droops -- length goes as diameter to
    // the two thirds, so a child is that ratio to the two thirds in length.
    const widthRatio = 1 / Math.sqrt(BIFURCATION);
    const lengthRatio = Math.cbrt(widthRatio * widthRatio);

    // The absolute SCALE is set so the outermost tip lands on the measured
    // spread. Ratios derived; size the species' own number, as the header says.
    let reach = 0;
    let term = 1;
    for (let i = 0; i <= orders; i++) { reach += term; term *= lengthRatio; }
    const first = reach > 0 ? radius / reach : radius;

    const grow = (
      x: number, y: number, angle: number, len: number, width: number,
      depth: number,
    ): void => {
      const x1 = x + len * dcos(angle);
      const y1 = y + len * dsin(angle);
      strokes.push({
        part: depth >= orders ? Part.Twig : Part.Branch,
        x0: x, y0: y, x1, y1, widthM: width, rgb: woodColour,
      });
      if (depth >= orders) { tips.push({ x: x1, y: y1 }); return; }
      for (let k = 0; k < BIFURCATION; k++) {
        const turn = (k === 0 ? 1 : -1) * FORK_ANGLE_DEG * DEG * (0.7 + 0.5 * jitter(rng));
        grow(x1, y1, angle + turn, len * lengthRatio, width * widthRatio, depth + 1);
      }
    };

    // A stool's poles start apart. A tree's single bole does not.
    const poles = Math.max(1, Math.min(12, s.stems));
    const stoolR = poles > 1 ? radius * 0.08 : 0;
    for (let stem = 0; stem < poles; stem++) {
      const a0 = (2 * PI * stem) / poles + jitter(rng) * 0.4;
      grow(stoolR * dcos(a0), stoolR * dsin(a0), a0, first, trunk, 0);
    }
  } else if (s.habit === Habit.Climber) {
    // A cane goes out, kinks where it caught on something, and tips over. No
    // forking worth the name: what makes a bramble impassable is many canes,
    // not one of them branching finely.
    const canes = Math.max(1, Math.min(s.stems, 1 << Math.max(1, o.detail)));
    const segments = 3;
    for (let c = 0; c < canes; c++) {
      let a = (2 * PI * c) / canes + jitter(rng) * 0.5;
      let x = 0;
      let y = 0;
      for (let i = 0; i < segments; i++) {
        const len = radius / segments;
        a += jitter(rng) * 0.5;
        const x1 = x + len * dcos(a);
        const y1 = y + len * dsin(a);
        strokes.push({
          part: Part.Branch, x0: x, y0: y, x1, y1,
          // A cane tapers: the same volume, thinner the further it has gone.
          widthM: trunk * (1 - i / (segments + 1)), rgb: woodColour,
        });
        x = x1;
        y = y1;
        tips.push({ x, y });
      }
    }
  } else {
    // A grass or a herb: shoots and leaves from one point. A wheat plant's
    // straws stand almost upright, so from above they are nearly a single dot
    // with the leaves fanning off -- which is why a field reads as texture and
    // never as individuals, and a carrot top, whose leaves lie open, does not.
    const shoots = Math.max(1, Math.min(s.stems * (1 << Math.max(0, o.detail - 2)), 24));
    // Foreshortening: an erect shoot shows little of its length from straight
    // above; a rosette's leaf shows nearly all of it.
    const lie = s.habit === Habit.Grass ? 0.45 : 0.95;
    for (let i = 0; i < shoots; i++) {
      const a = (2 * PI * i) / shoots + jitter(rng) * 0.3;
      const len = radius * lie * (0.7 + (0.3 * (i % 3)) / 2);
      const x1 = len * dcos(a);
      const y1 = len * dsin(a);
      strokes.push({
        part: Part.Branch, x0: 0, y0: 0, x1, y1,
        widthM: Math.max(trunk, 0.001), rgb: woodColour,
      });
      tips.push({ x: x1, y: y1 });
    }
  }

  // THE CROP, DIVIDED AMONG THE TIPS. One rule for every part that hangs.
  // Leaves are spread to match the crown's derived opacity; everything else --
  // acorn, blossom, blackberry, ear of wheat -- is that part's whole volume
  // shared out and drawn as the lump it makes. So a picture at any detail
  // carries the same crop, and stripping a drawn wheat plant of its Seed blobs
  // leaves exactly the Husk and the straw behind, which is threshing.
  const n = Math.max(1, tips.length);
  for (const spec of s.parts) {
    if (!hangsFromTips(s, spec)) continue;
    if (!isPresent(spec.phenology, o.week, o.weeksPerYear)) continue;
    const rgb = partColour(spec, o.week, o.weeksPerYear);

    if (spec.part === Part.Leaf) {
      if (opacity <= 0) continue;
      // n discs over the crown's area hiding the fraction the leaf area says:
      // 1 - exp(-n.pi.r^2/A) = opacity, solved for r. Poisson again.
      const area = crownAreaM2(s, o.ageYears, o.site);
      const want = Math.min(0.999, opacity);
      const r = Math.sqrt((-area * dlog(1 - want)) / (PI * n));
      for (const t of tips) {
        blobs.push({ part: spec.part, x: t.x, y: t.y, radiusM: r, rgb, buried: false });
      }
      continue;
    }
    const v = (mass * spec.share) / spec.densityKgM3 / n;
    if (v <= 0) continue;
    const r = Math.cbrt((3 * v) / (4 * PI));
    for (const t of tips) {
      blobs.push({ part: spec.part, x: t.x, y: t.y, radiusM: r, rgb, buried: false });
    }
  }

  // WHAT YOU CANNOT SEE. A carrot has a form too; it is simply under the
  // ground, and the whole of finding one is that nothing above says where. It
  // is sized the same way as everything else -- volume from mass and density --
  // so a carrot comes out about two and a half centimetres across because that
  // is what seventy-four grammes at 1,040 kg/m3 is, and for no other reason.
  for (const spec of s.parts) {
    if (!isBuried(spec.part)) continue;
    if (!isPresent(spec.phenology, o.week, o.weeksPerYear)) continue;
    const v = (mass * spec.share) / spec.densityKgM3;
    if (v <= 0) continue;
    blobs.push({
      part: spec.part, x: 0, y: 0, radiusM: Math.cbrt((3 * v) / (4 * PI)),
      rgb: partColour(spec, o.week, o.weeksPerYear), buried: true,
    });
  }

  return {
    species: s.name,
    habit: s.habit,
    heightM: heightM(s, o.ageYears, o.site),
    spreadM: spread,
    stemDiameterM: trunk,
    twigCount: twigCount(s, o.ageYears, o.site),
    crownOpacity: opacity,
    strokes,
    blobs,
  };
}
