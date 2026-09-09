// What an animal LOOKS like, solved from what it weighs.
//
// The same bargain the plants got, and it works for the same reason: a body is
// a volume, a volume is a mass over a density, and everything else is
// proportion. Feed this a 450 kg cow and it gives a trunk 1.56 m long and
// 0.65 m across, which is a cow; feed it a 2 kg hen and it gives 0.26 m by
// 0.11 m, which is a hen. Neither of those four numbers is in a file.
//
// FLESH IS WATER, which is what makes it easy. Living tissue is within a couple
// of per cent of 1,000 kg/m3 -- a swimmer floats with their lungs full and
// sinks with them empty, which is the everyday measurement of it -- so an
// animal's volume is very nearly its mass in litres and there is no density to
// look up per species. The plants needed a density per part; an animal does not.
//
// THE VIEW IS STILL FROM ABOVE, so what shows is the trunk, the head, the four
// legs splayed either side of it, and the tail. What does NOT show is height,
// which is most of what tells a cow from a sheep at eye level and none of what
// tells them apart from a hawk. It is computed anyway, because a shadow will
// want it and because it is the check that the proportions are right.
//
// WHAT IS ON THE SHEET AND NOT DERIVED: the coat. Colour is a bred trait and a
// pigment question, exactly as it was for the plants, and bulk chemistry has
// nothing to say about it. Medieval cattle were dun and red-brown because that
// is what the landraces were, and no allometry predicts that.

import { dpow, dsin, dcos, PI } from '../gen/mathx.ts';
import { seed, below, type RngState } from '../rng.ts';
import { type Animal, massAtAge } from './animal.ts';
import { type Blob, type Stroke } from './form.ts';
import { Part } from './plant.ts';

/**
 * Density of living tissue, kg/m3.
 *
 * Measured, and remarkably constant: muscle is 1,060, fat is 900, bone is
 * 1,900, and the mix in a whole animal comes to within a per cent or two of
 * water either side. Which is why a body floats, just.
 */
const FLESH_DENSITY = 1000;

/**
 * The proportions of a four-legged trunk, as ratios to its width.
 *
 * Measured off cattle and true enough of any large quadruped: a trunk is about
 * two and a half times as long as it is wide and about a third deeper than
 * wide. Modelled as an ellipsoid, which is what a barrel-chested animal is to
 * within the accuracy anybody can see from above.
 *
 * These three and the mass are the whole of the body: solving
 * V = (4/3).pi.(L/2)(W/2)(H/2) for W gives every dimension at once.
 */
const TRUNK_LENGTH_RATIO = 2.4;
const TRUNK_DEPTH_RATIO = 1.3;

/** The share of the trunk's volume that is not trunk: head, neck, legs, tail. */
const LIMB_SHARE = 0.30;

/**
 * Leg length at 450 kg, metres, and the exponent it scales by.
 *
 * McMahon's elastic similarity again -- the same rule that set a tree's branch
 * lengths, and for the same reason: a limb must not buckle under the animal
 * standing on it, which makes length go as diameter to the two thirds and
 * therefore as mass to the quarter. Anchored at a cow's 0.65 m from ground to
 * elbow, it puts a hen's leg at 0.167 m, which is a hen's leg.
 */
const LEG_AT_REFERENCE_M = 0.65;
const LEG_REFERENCE_KG = 450;
const LEG_EXPONENT = 0.25;

/** Head mass as a share of the body. Measured at about six per cent for cattle. */
const HEAD_SHARE = 0.06;

/** The size of an animal, all of it out of the mass. */
export interface Build {
  trunkLengthM: number;
  trunkWidthM: number;
  trunkDepthM: number;
  legLengthM: number;
  /** Ground to the top of the back. What a person sees; what a hawk does not. */
  shoulderHeightM: number;
  headLengthM: number;
  /** Longest dimension seen from above, which is what the renderer scales by. */
  overallLengthM: number;
}

export function buildOf(massKg: number): Build {
  if (massKg <= 0) {
    return {
      trunkLengthM: 0, trunkWidthM: 0, trunkDepthM: 0, legLengthM: 0,
      shoulderHeightM: 0, headLengthM: 0, overallLengthM: 0,
    };
  }
  const volume = (massKg / FLESH_DENSITY) * (1 - LIMB_SHARE);
  // V = (4/3).pi.(rL.w/2)(w/2)(rD.w/2) = (pi/6).rL.rD.w^3, solved for w.
  const k = (PI / 6) * TRUNK_LENGTH_RATIO * TRUNK_DEPTH_RATIO;
  const w = dpow(volume / k, 1 / 3);
  const legLengthM = LEG_AT_REFERENCE_M * dpow(massKg / LEG_REFERENCE_KG, LEG_EXPONENT);
  const headLengthM = dpow((massKg * HEAD_SHARE) / FLESH_DENSITY, 1 / 3) * 1.8;
  const trunkLengthM = TRUNK_LENGTH_RATIO * w;
  return {
    trunkLengthM,
    trunkWidthM: w,
    trunkDepthM: TRUNK_DEPTH_RATIO * w,
    legLengthM,
    shoulderHeightM: legLengthM + TRUNK_DEPTH_RATIO * w,
    headLengthM,
    // Nose to rump: the trunk, the neck and the head, which is what a drawn
    // animal actually occupies and what its stamp has to be scaled by.
    overallLengthM: trunkLengthM * 1.25 + headLengthM,
  };
}

/** A drawn animal, in the same shape the plants use so one renderer draws both. */
export interface Beast {
  animal: string;
  build: Build;
  strokes: Stroke[];
  blobs: Blob[];
}

/** A jitter in [-1, 1] from a stream that depends only on the seed. */
function jitter(rng: RngState): number {
  return below(rng, 2001) / 1000 - 1;
}

function shade(c: readonly [number, number, number], f: number): [number, number, number] {
  return [
    Math.max(0, Math.min(255, Math.round(c[0] * f))),
    Math.max(0, Math.min(255, Math.round(c[1] * f))),
    Math.max(0, Math.min(255, Math.round(c[2] * f))),
  ];
}

/**
 * The ground plan of one animal, in metres, nose pointing along +x.
 *
 * Blobs and strokes, exactly as a plant's form is, so the renderer that stamps
 * an oak stamps an ox with no second code path. The trunk is drawn as a row of
 * overlapping discs down the spine rather than as one ellipse, because a disc
 * is what the drawing primitives have and a row of them is an ellipse with a
 * bit of shoulder and haunch in it, which is better than an ellipse.
 */
export function beastOf(a: Animal, ageYears: number, seedValue: number): Beast {
  const massKg = massAtAge(a, ageYears);
  const build = buildOf(massKg);
  const rng = seed(seedValue);
  const strokes: Stroke[] = [];
  const blobs: Blob[] = [];
  if (build.trunkWidthM <= 0) return { animal: a.name, build, strokes, blobs };

  const coat = a.coat;
  const half = build.trunkLengthM / 2;
  const w = build.trunkWidthM;

  // FOUR LEGS, splayed from the corners of the trunk. From above a standing leg
  // is nearly a dot, so what shows is the shoulder and hip, which is why they
  // are drawn short and thick rather than at their true length.
  const dark = shade(coat, 0.72);
  for (const sx of [0.62, -0.55]) {
    for (const sy of [1, -1]) {
      const x0 = half * sx;
      const y0 = (w / 2) * 0.55 * sy;
      const out = build.legLengthM * 0.30 * (1 + 0.15 * jitter(rng));
      strokes.push({
        part: Part.Branch,
        x0, y0,
        x1: x0 + out * 0.35 * (sx > 0 ? 1 : -1),
        y1: y0 + out * sy,
        widthM: w * 0.16,
        rgb: dark,
      });
    }
  }

  // THE TAIL, which is the one part of a cow that says which end is which from
  // directly overhead.
  const tailAngle = PI + jitter(rng) * 0.5;
  strokes.push({
    part: Part.Branch,
    x0: -half * 0.95, y0: 0,
    x1: -half * 0.95 + build.trunkLengthM * 0.45 * dcos(tailAngle),
    y1: build.trunkLengthM * 0.45 * dsin(tailAngle),
    widthM: w * 0.07,
    rgb: dark,
  });

  // THE TRUNK, as five discs down the spine. The middle is widest and the ends
  // taper, which is a barrel with a shoulder and a haunch.
  const PROFILE = [0.72, 0.94, 1.0, 0.96, 0.80];
  for (let i = 0; i < PROFILE.length; i++) {
    const t = i / (PROFILE.length - 1);
    blobs.push({
      part: Part.Fruit,
      x: half - t * build.trunkLengthM,
      y: 0,
      radiusM: (w / 2) * PROFILE[i],
      rgb: coat,
      buried: false,
    });
  }

  // NECK AND HEAD, forward of the shoulder.
  const neckLength = build.trunkLengthM * 0.25;
  strokes.push({
    part: Part.Branch,
    x0: half * 0.9, y0: 0,
    x1: half + neckLength, y1: 0,
    widthM: w * 0.45,
    rgb: coat,
  });
  const headX = half + neckLength + build.headLengthM * 0.35;
  blobs.push({
    part: Part.Fruit,
    x: headX, y: 0,
    radiusM: build.headLengthM * 0.35,
    rgb: shade(coat, 0.88),
    buried: false,
  });

  // HORNS, because a medieval beast has them and because they are the only
  // thing on a top-down cow that reads instantly as a cow.
  if (a.horned) {
    for (const sy of [1, -1]) {
      strokes.push({
        part: Part.Thorn,
        x0: headX, y0: (build.headLengthM * 0.25) * sy,
        x1: headX + build.headLengthM * 0.35,
        y1: (build.headLengthM * 0.75) * sy,
        widthM: w * 0.05,
        rgb: [226, 216, 190],
      });
    }
  }

  return { animal: a.name, build, strokes, blobs };
}
