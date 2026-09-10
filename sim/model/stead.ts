// The village's ground plan: where the houses stand.
//
// The economy has known for a long time how many people live on a tile, that
// their houses cost HOUSE_TIMBER_M3 of the woodland's increment, and that a
// hearth holds HOUSE_PEOPLE. What it has never known is what the place LOOKS
// like from above, and that is a question with measured answers, because
// deserted medieval villages have been excavated for a century:
//
//   A peasant longhouse runs four and a half to six metres wide by eight to
//   fifteen long -- the width is fixed by the longest roof timber a village
//   gets cheaply, and the length grows bay by bay. Five by nine is the
//   ordinary starter house.
//
//   Each house sits in a TOFT -- house, yard, garden, midden -- and the toft
//   is the unit village plots were actually laid out in: about a quarter of
//   an acre, a thousand square metres.
//
// So a village's size is not chosen: hearths come from the population at five
// a hearth, the settled area is hearths times a toft, and the radius falls
// out. Twenty people are four hearths on a green thirty-six metres across,
// which is a hamlet; three hundred are sixty hearths at a hundred and forty
// metres, which is a proper village street. Nothing else is needed.
//
// THE LAYOUT IS APPEARANCE, derived deterministically from the settlement's
// own seed: which side of the green a house stands and how its gable turns
// changes nothing downstream, and the same village always draws the same.

import * as A from '../anchors.ts';
import { dsin, dcos, PI } from '../gen/mathx.ts';
import { seed as seedRng, below, type RngState } from '../rng.ts';

/** Measured off the excavations: the ordinary longhouse, metres. */
const HOUSE_W_M = 5;
const HOUSE_L_M = 9;

/** A quarter-acre toft: house, yard, garden, midden. */
const TOFT_M2 = 1000;

/**
 * The byre-barn, where the herd winters and the hay lives. Bigger than a
 * house -- excavated barns run six by twelve and up -- and one per village
 * until the village is large.
 */
const BARN_W_M = 6;
const BARN_L_M = 12;

/** One building, seen from above: a rectangle with a ridge down its length. */
export interface Building {
  /** Metres east and north of the settlement's centre. */
  x: number;
  y: number;
  /** The ridge's bearing, radians. */
  angle: number;
  wM: number;
  lM: number;
  /** True for the byre-barn. */
  byre: boolean;
}

/** Somebody, standing somewhere in the village. */
export interface Folk {
  x: number;
  y: number;
  /** Which way they face, radians. */
  angle: number;
  seed: number;
}

export interface Stead {
  buildings: Building[];
  folk: Folk[];
  /** The village's own ground, metres -- the yard the wood does not enter. */
  radiusM: number;
  hearths: number;
}

/** A jitter in [-1, 1] from the stead's own stream. */
function jitter(rng: RngState): number {
  return below(rng, 2001) / 1000 - 1;
}

/** How many figures one stead will place, however large the town. */
const FOLK_CAP = 60;

/**
 * The ground plan of one settlement.
 *
 * Houses stand on a ring around the green with their gables to it, which is
 * the commonest excavated plan for a nucleated hamlet -- a lane or a green
 * with tofts around it. The byre stands among them when there is a herd or a
 * barn's worth of hay to house.
 */
export function steadOf(
  population: number, herdHead: number, hayKg: number, seedValue: number,
): Stead {
  const hearths = Math.max(1, Math.ceil(population / A.HOUSE_PEOPLE));
  const radiusM = Math.sqrt((hearths * TOFT_M2) / PI);
  const rng = seedRng(seedValue);
  const buildings: Building[] = [];

  // The ring the houses stand on: inside the toft circle, outside the green.
  const ring = radiusM * 0.62;
  for (let h = 0; h < hearths; h++) {
    const a = (2 * PI * h) / hearths + jitter(rng) * (0.6 / Math.max(1, hearths / 4));
    const r = ring * (1 + 0.18 * jitter(rng));
    // Gable to the green: the ridge runs tangent to the ring, give or take
    // the carpenter's eye.
    const angle = a + PI / 2 + jitter(rng) * 0.25;
    buildings.push({
      x: r * dcos(a),
      y: r * dsin(a),
      angle,
      wM: HOUSE_W_M * (1 + 0.1 * jitter(rng)),
      lM: HOUSE_L_M * (1 + 0.15 * jitter(rng)),
      byre: false,
    });
  }

  // The byre-barn, when there is anything to put in it.
  if (herdHead >= 2 || hayKg > 1000) {
    const a = jitter(rng) * PI;
    buildings.push({
      x: radiusM * 0.25 * dcos(a),
      y: radiusM * 0.25 * dsin(a),
      angle: jitter(rng) * PI,
      wM: BARN_W_M,
      lM: BARN_L_M,
      byre: true,
    });
  }

  // THE PEOPLE, capped: a town of hundreds draws a street's worth of figures,
  // not a census. They stand about the green and the lane, which is where
  // people who are not in the fields are.
  const folk: Folk[] = [];
  const count = Math.min(FOLK_CAP, Math.round(population));
  for (let i = 0; i < count; i++) {
    const a = (2 * PI * i) / Math.max(1, count) + jitter(rng) * 1.2;
    const r = radiusM * 0.45 * (0.2 + 0.8 * ((below(rng, 1000) / 1000) ** 0.5));
    folk.push({
      x: r * dcos(a),
      y: r * dsin(a),
      angle: jitter(rng) * PI,
      seed: seedValue * 31 + i,
    });
  }

  return { buildings, folk, radiusM, hearths };
}

/**
 * A person seen from above, in metres: shoulders and a head.
 *
 * Measured, and there is not much to measure: biacromial breadth -- shoulder
 * across -- is 0.39 m for an adult woman and 0.46 for a man, the head is
 * eighteen centimetres of hair, and everything else is hidden under the
 * shoulders from straight overhead. Two blobs and a stroke; the figure reads
 * because the scale around it is right, not because it is detailed.
 */
export interface PersonPlan {
  shoulderWM: number;
  shoulderDM: number;
  headRM: number;
}

export function personPlan(seedValue: number): PersonPlan {
  const rng = seedRng(seedValue);
  const breadth = 0.39 + (below(rng, 1000) / 1000) * 0.07;
  return {
    shoulderWM: breadth,
    shoulderDM: breadth * 0.55,
    headRM: 0.09,
  };
}
